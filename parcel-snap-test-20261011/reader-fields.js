/**
 * Literal, review-only proposals from OCR rows. No network, model, directory,
 * spelling correction, customer matching, or acceptance state is involved.
 *
 * Input: [{ id, text, confidence?, bbox?, frameId? }], plus optional barcodes:
 * [{ id?, rawValue, format, decoded:true, frameId?, bbox? }]. A barcode must
 * explicitly be decoded with a recognized format. Untyped strings stay raw.
 *
 * Output fields: { status, value, alternatives }. Each alternative carries
 * value, rowIds and sources. A row source has the ORIGINAL rowId, rowIndex,
 * frameId, confidence, bbox, text and UTF-16 [start,end) offsets into row.text.
 * Barcode sources have barcodeId (only if supplied), barcodeIndex and offsets
 * into rawValue. Confidence/bounds are copied, never generated or upgraded.
 * Address values join their literal source lines; sources remain authoritative.
 * A nonempty value is only a display proposal, never an accepted field.
 */

const DESTINATION = /^(\s*(?:(?:ship|deliver)\s+to|recipient|consignee|to)(?=\s|:|$)\s*[:\-]?\s*)/i;
const OTHER_ROLE = /^(\s*(?:return(?:\s+(?:address|to))?|ship\s+from|shipper|sender|from|remit\s+to|bill\s+to)(?=\s|:|$)\s*[:\-]?\s*)/i;
const TRACKING_LABEL = /\b(?:package\s+)?tracking(?:\s*(?:code|number|no\.?|#))?\s*[:#\-]?\s*/ig;
const NON_TRACKING_LABEL = /\b(?:phone|telephone|tel|fax|order(?:\s+(?:number|no\.?|id|reference))?|invoice(?:\s+(?:number|no\.?|id))?|customer\s+(?:number|no\.?|id)|account\s+(?:number|no\.?|id)|reference|ref)\b\s*[:#\-]?\s*/ig;
const METADATA = /^\s*(?:tracking\b|package\s+tracking\b|order\s*(?:number|no\b|reference|#)|invoice\b|weight\b|dimensions?\b|postage\b|barcode\b|service\b)/i;
const STREET = /^\s*(?:\d{1,7}[a-z]?(?:[-/]\d{1,7}[a-z]?)?\s+.*\p{L}|P\.?\s*O\.?\s*BOX\s+\S+|POST\s+OFFICE\s+BOX\s+\S+)/iu;
const UNIT = /^\s*(?:UNIT|APT|APARTMENT|SUITE|STE|FLOOR|LEVEL|BUILDING|BLDG|ROOM|RM|#)\s*[-#]?\s*\S+/i;
const LOCALITY = /(?:\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2}\b)/iu;
const POSTAL_ONLY = /^\s*(?:\d{4,6}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d|[A-Z]{1,2}\d[A-Z\d]?\s+\d[A-Z]{2})\s*$/i;
const COUNTRY = /^\s*(?:USA?|U\.?S\.?A?\.?|United States(?: of America)?|United Kingdom|UK|Great Britain|England|Scotland|Wales|Northern Ireland|Canada|Australia|New Zealand|Ireland|France|Germany|Deutschland|Spain|España|Portugal|Italy|Italia|Netherlands|Belgium|Switzerland|Austria|Sweden|Norway|Denmark|Finland|Poland|Czechia|Czech Republic|Mexico|México|Brazil|Brasil|Japan|China|India|Singapore|Hong Kong|South Korea|Taiwan|United Arab Emirates|South Africa)\s*$/iu;
const CARRIER = /\b(?:FedEx|USPS|United States Postal(?: Service)?|UPS|United Parcel Service|DHL|Amazon|Roadie|Canada Post|Royal Mail)\b/gi;
const GENERIC_TRACKING = /\b(?:1Z[A-Z0-9]{16}|TBA\d{12,16}|[A-Z]{2}\d{9}[A-Z]{2}|\d{10,34})\b/gi;
const BARCODE_FORMAT = /^(?:aztec|data_?matrix|qr_?code|code_?(?:128|39|93)|ean_?(?:13|8)|upc_?[ae]|itf|codabar|pdf_?417)$/i;

function typedBarcode(barcode) {
  return barcode && barcode.decoded === true && typeof barcode.rawValue === 'string'
    && typeof barcode.format === 'string' && BARCODE_FORMAT.test(barcode.format);
}

function copy(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copy);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
}
function bounds(item) {
  const b = item?.bbox;
  return b && ['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(b[key])) && b.x1 >= b.x0 && b.y1 >= b.y0 ? b : null;
}
function sameFrame(a, b) { return a.row.frameId === b.row.frameId; }
function sameLane(a, b) {
  const x = bounds(a.row), y = bounds(b.row);
  if (!x || !y) return true; // Missing geometry is recorded, not fabricated.
  const tolerance = Math.max(24, Math.min(x.y1 - x.y0, y.y1 - y.y0) * 3);
  return Math.abs(x.x0 - y.x0) <= tolerance;
}
function nearby(a, b) {
  if (a.rowIndex === b.rowIndex) return true;
  const x = bounds(a.row), y = bounds(b.row);
  if (!x || !y) return true;
  // A large visual break is not evidence that two blocks belong together.
  const height = Math.max(x.y1 - x.y0, y.y1 - y.y0);
  return Math.max(0, x.y0 - y.y1, y.y0 - x.y1) <= Math.max(48, height * 3);
}
function source(line, start = 0, end = line.text.length) {
  return {
    kind: 'row', rowId: line.row.id, rowIndex: line.rowIndex,
    frameId: line.row.frameId, text: line.text.slice(start, end),
    start: line.start + start, end: line.start + end,
    ...(line.row.confidence !== undefined ? { confidence: copy(line.row.confidence) } : {}),
    ...(line.row.bbox !== undefined ? { bbox: copy(line.row.bbox) } : {})
  };
}
function unique(values) { return [...new Set(values)]; }
function alternative(value, sources, details = {}) {
  return { value, rowIds: unique(sources.filter(s => s.kind === 'row').map(s => s.rowId)), sources, ...details };
}
function lineKind(text) {
  if (COUNTRY.test(text)) return 'country';
  if (UNIT.test(text)) return 'unit';
  if (LOCALITY.test(text)) return 'locality-postal';
  if (POSTAL_ONLY.test(text)) return 'postal';
  if (STREET.test(text)) return 'street';
  return '';
}
function metadataPayload(text) {
  const label = [...text.matchAll(NON_TRACKING_LABEL)][0];
  if (!label || label.index !== text.search(/\S/)) return false;
  const payload = text.slice(label.index + label[0].length);
  // Bound the exclusion to an actual leading label plus a code/number or
  // explicit separator. Business names such as "Phone House" and "Order
  // Arts", and unrelated digit-bearing names such as "Studio 54", survive.
  return !payload.trim() || /[:#]/.test(label[0]) || /\d/.test(payload);
}
function fieldBoundary(text) { return METADATA.test(text) || metadataPayload(text); }
function plausibleName(text) {
  return /\p{L}/u.test(text) && text.trim().length <= 160 && !lineKind(text)
    && !fieldBoundary(text) && !DESTINATION.test(text) && !OTHER_ROLE.test(text)
    && !/@|https?:\/\//i.test(text)
    && !/^\s*(?:FedEx|USPS|UPS|DHL|Amazon|Roadie|Canada Post|Royal Mail)\s*$/i.test(text)
    && !/^\s*(?:1Z[A-Z0-9]{16}|TBA\d{12,16}|[A-Z]{2}\d{9}[A-Z]{2})\s*$/i.test(text);
}
function splitRows(rows) {
  const lines = [];
  rows.forEach((row, rowIndex) => {
    if (!row || typeof row.text !== 'string') return;
    const expression = /[^\r\n]+/g;
    for (const match of row.text.matchAll(expression)) {
      if (!match[0].trim()) continue;
      lines.push({ row, rowIndex, text: match[0], start: match.index, index: lines.length });
    }
  });
  return lines;
}
function markerFor(line) {
  const to = line.text.match(DESTINATION), other = line.text.match(OTHER_ROLE);
  if (!to && !other) return null;
  return { line, role: to ? 'destination' : 'sender-or-other', length: (to || other)[0].length };
}
function regionsFor(lines) {
  const markers = lines.map(markerFor).filter(Boolean);
  const regions = markers.map((marker, index) => ({ id: `region-${index}`, role: marker.role, marker, lines: [] }));
  const unmarked = [];
  for (const line of lines) {
    const own = regions.find(region => region.marker.line === line);
    if (own) {
      if (line.text.slice(own.marker.length).trim()) {
        own.lines.push({ ...line, start: line.start + own.marker.length, text: line.text.slice(own.marker.length) });
      }
      continue;
    }
    const eligible = regions.filter(region => {
      const marker = region.marker.line;
      if (!sameFrame(line, marker) || !sameLane(line, marker)) return false;
      if (line.rowIndex === marker.rowIndex) return line.start > marker.start;
      const a = bounds(line.row), b = bounds(marker.row);
      return a && b ? a.y0 >= b.y0 : line.index > marker.index;
    });
    eligible.sort((a, b) => {
      const x = bounds(a.marker.line.row), y = bounds(b.marker.line.row);
      return x && y ? y.y0 - x.y0 : b.marker.line.index - a.marker.line.index;
    });
    const best = eligible[0], second = eligible[1];
    const tied = best && second && bounds(best.marker.line.row) && bounds(second.marker.line.row)
      && bounds(best.marker.line.row).y0 === bounds(second.marker.line.row).y0;
    if (best && !tied) best.lines.push(line);
    else unmarked.push(line);
  }
  // A separate unmarked region per frame prevents stitching different photos.
  const byFrame = new Map();
  for (const line of unmarked) {
    const key = line.row.frameId;
    if (!byFrame.has(key)) byFrame.set(key, { id: `unmarked-${byFrame.size}`, role: 'unverified', marker: null, lines: [] });
    byFrame.get(key).lines.push(line);
  }
  return [...regions, ...byFrame.values()];
}
function joinLiteral(sources, rows) {
  return sources.map((item, index) => {
    if (!index) return item.text;
    const previous = sources[index - 1];
    const gap = previous.rowIndex === item.rowIndex
      ? rows[item.rowIndex].text.slice(previous.end, item.start) : '\n';
    return (/^[\r\n]+$/.test(gap) ? gap : '\n') + item.text;
  }).join('');
}
function fieldsFromRegions(regions, rows) {
  const names = [], addresses = [], blocks = [];
  for (const region of regions) {
    const lines = region.lines;
    const anchors = lines.map((line, index) => lineKind(line.text) === 'street' ? index : -1).filter(index => index >= 0);
    // Postal-only OCR still has useful review evidence, even without a street.
    if (!anchors.length) lines.forEach((line, index) => {
      if (/^(?:locality-postal|postal)$/.test(lineKind(line.text))) anchors.push(index);
    });
    if (!anchors.length && region.role === 'destination') {
      const candidates = [];
      for (const line of lines) {
        if (fieldBoundary(line.text)) break;
        if (plausibleName(line.text)) candidates.push(line);
      }
      for (const line of candidates) names.push(alternative(line.text, [source(line)], { role: region.role, blockId: region.id, reason: 'explicit-destination-line' }));
    }
    anchors.forEach((anchorIndex, blockNumber) => {
      const anchor = lines[anchorIndex], blockId = `${region.id}-address-${blockNumber}`;
      const addressLines = [anchor];
      for (let i = anchorIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!sameFrame(anchor, line) || !sameLane(anchor, line)) continue;
        if (!nearby(addressLines.at(-1), line)) break;
        if (fieldBoundary(line.text) || markerFor(line) || lineKind(line.text) === 'street') break;
        // A new identity immediately before another street is another block.
        const next = lines.slice(i + 1).find(item => sameFrame(line, item) && sameLane(line, item));
        if (plausibleName(line.text) && next && lineKind(next.text) === 'street') break;
        if (/\b\d{10,34}\b|\b1Z[A-Z0-9]{16}\b|\bTBA\d{12,16}\b/i.test(line.text)) break;
        const kind = lineKind(line.text);
        if (kind || plausibleName(line.text)) addressLines.push(line);
        else break;
      }
      const nameLines = [];
      for (let i = anchorIndex - 1; i >= 0; i--) {
        const line = lines[i];
        if (!sameFrame(anchor, line) || !sameLane(anchor, line)) continue;
        if (!nearby(nameLines[0] || anchor, line)) break;
        if (!plausibleName(line.text) || fieldBoundary(line.text)) break;
        nameLines.unshift(line);
        // Unmarked names are only nearby alternatives, never selected by rank.
        if (nameLines.length === 3) break;
      }
      const sources = addressLines.map(line => source(line));
      const address = alternative(joinLiteral(sources, rows), sources, {
        role: region.role, blockId,
        reason: region.role === 'destination' ? 'explicit-destination-address' : 'unverified-address-block',
        parts: addressLines.map(line => ({ kind: lineKind(line.text) || 'address-continuation', value: line.text, source: source(line) }))
      });
      blocks.push({ id: blockId, role: region.role, marker: region.marker ? source(region.marker.line) : null,
        rowIds: unique([...nameLines, ...addressLines].map(line => line.row.id)),
        recipientLines: nameLines.map(line => source(line)), addressLines: sources });
      if (region.role !== 'sender-or-other') {
        addresses.push(address);
        for (const line of nameLines) names.push(alternative(line.text, [source(line)], {
          role: region.role, blockId,
          reason: region.role === 'destination' ? 'explicit-destination-line' : 'nearby-unverified-name'
        }));
      }
    });
  }
  return { names, addresses, blocks };
}
function dedupeAlternatives(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = JSON.stringify([item.value, item.role, item.blockId, item.sources.map(s => [s.rowIndex, s.start, s.end])]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
function identityField(items, destinationCount) {
  const alternatives = dedupeAlternatives(items);
  const destinations = alternatives.filter(item => item.role === 'destination');
  const competingBlocks = new Set(alternatives.map(item => item.blockId)).size > 1;
  if (!alternatives.length) return { status: 'MISSING', value: '', alternatives };
  if (destinationCount > 1 || destinations.length > 1 || competingBlocks)
    return { status: 'AMBIGUOUS', value: '', alternatives };
  if (destinations.length === 1 && alternatives.length === 1)
    return { status: 'REVIEW_REQUIRED', value: alternatives[0].value, alternatives };
  return { status: alternatives.length > 1 ? 'AMBIGUOUS' : 'UNVERIFIED', value: '', alternatives };
}
function spanTrim(text, start, end) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [start, end];
}
function labelledTrackingValue(text) {
  if (!/^(?=.{6,64}$)(?=.*\d)[A-Z0-9]+(?:[ ._\/-][A-Z0-9]+)*$/i.test(text)) return false;
  // Spaced codes are supported, but a line like "12 Fiction Road" is not
  // transformed into a tracking ID merely because it follows a label.
  return !/\s/.test(text) || text.split(/\s+/).every(part => /\d/.test(part));
}
function trackingContext(text) {
  return [
    ...[...text.matchAll(TRACKING_LABEL)].map(match => ({ type: 'tracking', index: match.index, end: match.index + match[0].length })),
    ...[...text.matchAll(NON_TRACKING_LABEL)].map(match => ({ type: 'other', index: match.index, end: match.index + match[0].length }))
  ].sort((a, b) => a.index - b.index);
}
function isNontrackingSpan(line, offset, lines) {
  const latest = trackingContext(line.text).filter(label => label.index <= offset).at(-1);
  if (latest) return latest.type === 'other';
  const previous = lines[line.index - 1];
  if (!previous || !sameFrame(line, previous) || !sameLane(line, previous) || !nearby(line, previous)) return false;
  const inherited = trackingContext(previous.text).at(-1);
  return inherited?.type === 'other' && !previous.text.slice(inherited.end).trim();
}
function trackingProposals(lines, barcodes) {
  const candidates = new Map();
  const add = (value, itemSource, hint) => {
    if (!value) return;
    let item = candidates.get(value);
    if (!item) { item = alternative(value, [], { reasons: [] }); candidates.set(value, item); }
    const key = JSON.stringify([itemSource.kind, itemSource.rowIndex, itemSource.barcodeIndex, itemSource.start, itemSource.end]);
    if (!item.sources.some(s => JSON.stringify([s.kind, s.rowIndex, s.barcodeIndex, s.start, s.end]) === key)) item.sources.push(itemSource);
    item.rowIds = unique(item.sources.filter(s => s.kind === 'row').map(s => s.rowId));
    if (!item.reasons.includes(hint)) item.reasons.push(hint);
  };
  for (const line of lines) {
    for (const match of line.text.matchAll(GENERIC_TRACKING)) {
      if (!isNontrackingSpan(line, match.index, lines)) add(match[0], source(line, match.index, match.index + match[0].length), 'printed-format-candidate');
    }
    // Common printed numeric grouping, retained including every space. A line
    // containing two complete IDs is left to the separate candidates above.
    const [numericStart, numericEnd] = spanTrim(line.text, 0, line.text.length);
    const numeric = line.text.slice(numericStart, numericEnd);
    if (!isNontrackingSpan(line, numericStart, lines) && /^\d{2,8}(?: +\d{2,8}){1,10}$/.test(numeric) && numeric.replace(/ /g, '').length >= 10
      && numeric.replace(/ /g, '').length <= 34) add(numeric, source(line, numericStart, numericEnd), 'printed-spaced-numeric-candidate');
    for (const label of line.text.matchAll(TRACKING_LABEL)) {
      let candidateLine = line, start = label.index + label[0].length, end = line.text.length;
      if (!line.text.slice(start).trim()) {
        const next = lines[line.index + 1];
        if (!next || !sameFrame(line, next) || !sameLane(line, next) || !nearby(line, next) || markerFor(next)) continue;
        candidateLine = next; start = 0; end = next.text.length;
      }
      const followingLabel = trackingContext(candidateLine.text).find(item => item.index >= start);
      if (followingLabel) end = followingLabel.index;
      [start, end] = spanTrim(candidateLine.text, start, end);
      const text = candidateLine.text.slice(start, end);
      const formats = [...text.matchAll(GENERIC_TRACKING)];
      // A spaced identifier is kept literally, never compacted. Multiple full
      // IDs on one line remain separate alternatives instead of one fake ID.
      if (formats.length === 0 && labelledTrackingValue(text)) {
        add(text, source(candidateLine, start, end), 'printed-tracking-label');
      } else {
        for (const match of text.matchAll(/[A-Z0-9][A-Z0-9._\/-]{5,63}/gi)) {
          if (!/\d/.test(match[0])) continue;
          if (formats.some(format => match.index >= format.index && match.index + match[0].length <= format.index + format[0].length)) continue;
          add(match[0], source(candidateLine, start + match.index, start + match.index + match[0].length), 'printed-tracking-label');
        }
      }
    }
  }
  barcodes.forEach((barcode, barcodeIndex) => {
    if (!typedBarcode(barcode)) return;
    const raw = barcode.rawValue;
    const addBarcode = (start, end, reason) => add(raw.slice(start, end), {
      kind: 'barcode', ...(barcode.id !== undefined ? { barcodeId: barcode.id } : {}), barcodeIndex,
      frameId: barcode.frameId, format: barcode.format, text: raw.slice(start, end), start, end,
      ...(barcode.bbox !== undefined ? { bbox: copy(barcode.bbox) } : {})
    }, reason);
    let [start, end] = spanTrim(raw, 0, raw.length);
    const plain = raw.slice(start, end);
    if (/^(?=.{6,128}$)(?=.*\d)[A-Z0-9]+(?:[ ._\/-][A-Z0-9]+)*$/i.test(plain)) addBarcode(start, end, 'typed-barcode-candidate');
    // Match raw encoded payload text; URL decoding and JSON unescaping would
    // destroy literal provenance and are deliberately not performed.
    for (const match of raw.matchAll(/[?&](?:tracking|tracking_number|trackingNumber)=([^&#]+)/g)) {
      const offset = match.index + match[0].indexOf('=') + 1;
      if (/^(?=.*\d)[A-Z0-9._\/-]{6,64}$/i.test(match[1])) addBarcode(offset, offset + match[1].length, 'typed-barcode-tracking-key');
    }
    for (const match of raw.matchAll(/"(?:tracking|tracking_number|trackingNumber)"\s*:\s*"([^"\\]*)"/g)) {
      const offset = match.index + match[0].lastIndexOf('"' + match[1] + '"') + 1;
      if (/^(?=.*\d)[A-Z0-9 ._\/-]{6,64}$/i.test(match[1])) addBarcode(offset, offset + match[1].length, 'typed-barcode-tracking-key');
    }
  });
  const alternatives = [...candidates.values()];
  return { status: alternatives.length > 1 ? 'CONFLICT' : alternatives.length ? 'REVIEW_REQUIRED' : 'MISSING',
    value: alternatives.length === 1 ? alternatives[0].value : '', alternatives };
}
function carrierProposals(lines) {
  const items = new Map();
  for (const line of lines) for (const match of line.text.matchAll(CARRIER)) {
    const evidence = source(line, match.index, match.index + match[0].length);
    if (!items.has(match[0])) items.set(match[0], alternative(match[0], [], { reason: 'printed-carrier-text' }));
    const item = items.get(match[0]); item.sources.push(evidence); item.rowIds = unique(item.sources.map(s => s.rowId));
  }
  const alternatives = [...items.values()];
  return { status: alternatives.length > 1 ? 'AMBIGUOUS' : alternatives.length ? 'REVIEW_REQUIRED' : 'MISSING',
    value: alternatives.length === 1 ? alternatives[0].value : '', alternatives };
}

export function proposeFields(rows, { barcodes = [] } = {}) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  if (!Array.isArray(barcodes)) throw new TypeError('barcodes must be an array');
  const rawRows = copy(rows), rawBarcodes = copy(barcodes), lines = splitRows(rawRows);
  const regions = regionsFor(lines), { names, addresses, blocks } = fieldsFromRegions(regions, rawRows);
  const destinations = regions.filter(region => region.role === 'destination').length;
  const warnings = ['Review every proposal against the photo. Literal OCR can be wrong; no field is accepted automatically.'];
  if (rawRows.some(row => !row || typeof row.text !== 'string')) warnings.push('Some input rows do not contain string text; they remain in rawRows.');
  if (lines.some(line => !bounds(line.row))) warnings.push('Some rows have no usable geometry; grouping uses supplied row order and may be ambiguous.');
  if (destinations > 1) warnings.push('Multiple destination markers were read; destination fields remain ambiguous.');
  if (barcodes.some(b => !typedBarcode(b))) warnings.push('Untyped, unsupported-format or not explicitly decoded barcode payloads were retained raw, not treated as decoded evidence.');
  return {
    reviewOnly: true, rawRows, rawBarcodes,
    rawText: rawRows.filter(row => row && typeof row.text === 'string').map(row => row.text).join('\n'),
    blocks,
    recipient: identityField(names, destinations), address: identityField(addresses, destinations),
    tracking: trackingProposals(lines, rawBarcodes), carrier: carrierProposals(lines), warnings
  };
}

/**
 * A separate, deterministic structural review layer. proposeFields remains the
 * literal evidence extractor; its output is neither mutated nor replaced here.
 *
 * This deliberately recognizes only a supported subset of address layouts:
 * a numbered street (more than a single letter after the premise number) or
 * post-office box, corroborated by a separate locality/postal part in the same
 * block and frame. Other layouts are INCOMPLETE/UNCLASSIFIED, never "invalid".
 * Unmarked names require that supported same-block address. An explicit TO
 * marker is independent name-role evidence, including a name without address.
 * Names, companies, digits, Unicode and confidence scores are not rewritten,
 * scored or filtered. A structurally sufficient reading can still be wrong.
 *
 * Return: { schema, reviewOnly, opticalAccuracy, status, reasons, warnings,
 * recipient, address, tracking, carrier }. Each identity field is { status, value, alternatives,
 * withheld: [{ proposal, reasons }], reasons }. Every candidate appears exactly
 * once, unchanged, in alternatives or withheld[].proposal. Source offsets and
 * metadata remain literal. Original rawRows/blocks/tracking/carrier should be
 * stored alongside this result; this layer does not replace that evidence.
 * Tracking and carrier proposals are copied without additional qualification.
 */
function supportedStreetPart(part) {
  if (part?.kind !== 'street' || typeof part.value !== 'string') return false;
  if (/^\s*(?:P\.?\s*O\.?\s*BOX|POST\s+OFFICE\s+BOX)\s+\S+/iu.test(part.value)) return true;
  const numbered = part.value.match(/^\s*\d{1,7}[a-z]?(?:[-/]\d{1,7}[a-z]?)?\s+(.+)$/iu);
  // "2 e" carries only a number and one letter. Additional independently
  // classified postal evidence cannot reconstruct missing street text.
  return !!numbered && (numbered[1].match(/\p{L}/gu) || []).length > 1;
}
function separatePart(a, b) {
  return a?.kind === 'row' && b?.kind === 'row' && a.frameId === b.frameId
    && (a.rowIndex !== b.rowIndex || a.end <= b.start || b.end <= a.start);
}
function addressQualificationReasons(proposal) {
  const parts = Array.isArray(proposal.parts) ? proposal.parts : [];
  const streets = parts.filter(supportedStreetPart);
  const reasons = [];
  if (!streets.length) {
    reasons.push('No sufficiently structured street or post-office-box anchor was identified. This may be partial evidence or an unsupported address layout.');
  }
  const supported = streets.some(street => parts.some(part =>
    /^(?:locality-postal|postal)$/.test(part.kind)
    && separatePart(street.source, part.source)));
  if (!supported) {
    reasons.push('A street or post-office-box anchor needs separate locality/postal evidence in the same block and frame.');
  }
  return reasons;
}
function qualifiedIdentityField(original, decisions, hasRawEvidence) {
  const alternatives = [], withheld = [];
  decisions.forEach(({ proposal, reasons }) => {
    if (reasons.length) withheld.push({ proposal: copy(proposal), reasons: [...reasons] });
    else alternatives.push(copy(proposal));
  });
  const reasons = unique(withheld.flatMap(item => item.reasons));
  let status, value = '';
  if (!alternatives.length) {
    status = withheld.length ? 'INCOMPLETE' : hasRawEvidence ? 'UNCLASSIFIED' : 'MISSING';
    if (!withheld.length && hasRawEvidence) reasons.push('The literal reading has no classified proposal for this field. Raw evidence remains available; absence of a proposal does not establish absence on the label.');
  } else {
    // Filtering weak evidence must never manufacture certainty or select among
    // previously ambiguous destinations. Preserve the original review status.
    status = original.status;
    if (status === 'REVIEW_REQUIRED' && alternatives.length === 1
      && alternatives[0].value === original.value) value = original.value;
    if (status === 'AMBIGUOUS') reasons.push('Original destination or candidate ambiguity remains unresolved.');
  }
  return { status, value, alternatives, withheld, reasons };
}

export function qualifyFields(proposals) {
  if (!proposals || !Array.isArray(proposals.recipient?.alternatives)
    || !Array.isArray(proposals.address?.alternatives)) {
    throw new TypeError('qualifyFields requires a proposeFields result');
  }
  const hasRawEvidence = Array.isArray(proposals.rawRows)
    && proposals.rawRows.some(row => typeof row?.text === 'string' && row.text.trim());
  const addressDecisions = proposals.address.alternatives.map(proposal => ({
    proposal, reasons: addressQualificationReasons(proposal)
  }));
  const supportedAddresses = addressDecisions.filter(item => !item.reasons.length).map(item => item.proposal);
  const recipientDecisions = proposals.recipient.alternatives.map(proposal => {
    const explicitDestination = proposal.role === 'destination';
    const supportedBlock = supportedAddresses.some(address => address.blockId === proposal.blockId
      && proposal.sources.some(nameSource => address.sources.some(addressSource =>
        nameSource.kind === 'row' && addressSource.kind === 'row' && nameSource.frameId === addressSource.frameId)));
    return { proposal, reasons: explicitDestination || supportedBlock ? [] : [
      'An unmarked name needs a sufficiently structured address in the same block. Its literal text is retained as incomplete evidence.'
    ] };
  });
  const recipient = qualifiedIdentityField(proposals.recipient, recipientDecisions, hasRawEvidence);
  const address = qualifiedIdentityField(proposals.address, addressDecisions, hasRawEvidence);
  const bothSupported = recipient.alternatives.length > 0 && address.alternatives.length > 0;
  const anyCandidates = recipientDecisions.length > 0 || addressDecisions.length > 0;
  const status = bothSupported ? 'REVIEW_REQUIRED' : anyCandidates ? 'INCOMPLETE' : hasRawEvidence ? 'UNCLASSIFIED' : 'MISSING';
  const reasons = unique([...recipient.reasons, ...address.reasons]);
  const warnings = [
    ...(Array.isArray(proposals.warnings) ? copy(proposals.warnings) : []),
    'Structural checks only. They do not measure optical accuracy, verify a recipient, or validate address deliverability. Review every literal against the photo.',
    'Incomplete and unclassified evidence is retained for review. Other address layouts may be legitimate.'
  ];
  return { schema: 'parcel-snap-field-qualification-v1', reviewOnly: true,
    opticalAccuracy: 'NOT_ASSESSED', status, reasons, warnings, recipient, address,
    tracking: copy(proposals.tracking), carrier: copy(proposals.carrier) };
}
