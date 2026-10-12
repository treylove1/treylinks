(function (root) {
  "use strict";

  // One review-only shape for the legacy Supabase and hosted Worker readers.
  // Model output is evidence to display, never authorization to save or notify.
  function normalize(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    if (Object.prototype.hasOwnProperty.call(payload, "error")) return null;
    const raw = Object.prototype.hasOwnProperty.call(payload, "result") ? payload.result : payload;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (!["recipient_name", "recipient_business", "recipient_address", "address_line", "tracking", "tracking_code", "confidence"].some(field => Object.prototype.hasOwnProperty.call(raw, field))) return null;

    const warnings = [];
    function text(value, field) {
      if (value == null || value === "") return null;
      if (typeof value !== "string" || value.length > 1000) {
        warnings.push({ field, code: "INVALID_FIELD", message: "Check this field against the photo." });
        return null;
      }
      const trimmed = value.trim();
      return trimmed && !/^(null|n\/a|none|unknown|unreadable)$/i.test(trimmed) ? trimmed : null;
    }
    const result = {};
    for (const field of ["recipient_name", "recipient_business", "address_line", "unit", "city", "state", "zip", "order_reference", "partner_order", "carrier"]) {
      result[field] = text(raw[field], field);
    }
    const legacyTracking = text(raw.tracking_code, "tracking_code");
    const workerTracking = text(raw.tracking, "tracking");
    result.tracking_code = legacyTracking || workerTracking;
    if (legacyTracking && workerTracking && legacyTracking !== workerTracking) {
      result.tracking_code = null;
      result.tracking_candidates = [legacyTracking, workerTracking];
      warnings.push({ field: "tracking_code", code: "CONFLICTING_TRACKING", message: "The reader returned different tracking values. Check the photo." });
    }
    // Preserve all printed components, including unit designators and leading zeros.
    const locality = [result.city, result.state, result.zip].filter(Boolean).join(" ");
    // Compare formatting only; never fuzzy-correct an address or unit identifier.
    const canonicalAddress = value => String(value || "").toUpperCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
    const labelledUnit = value => /^(?:UNIT|APT|APARTMENT|SUITE|STE|ROOM|RM|FLOOR|BUILDING|BLDG|DEPT|LOT)\.?\s*(?:#\s*)?\S+|^#\s*\S+/i.test(value || "");
    const hasUnitMarker = address => /(?:^|[\s,])(?:UNIT|APT|APARTMENT|SUITE|STE|ROOM|RM|FLOOR|BUILDING|BLDG|DEPT|LOT)\.?\s*(?:#\s*)?\S+|(?:^|[\s,])#\s*\S+/i.test(address || "");
    // Bare identifiers (such as "123") must never match a street number.
    const containsUnit = (address, unit) => Boolean(unit && (labelledUnit(unit)
      ? (" " + canonicalAddress(address) + " ").includes(" " + canonicalAddress(unit) + " ")
      : String(address || "").split(/\r?\n/).some(line => canonicalAddress(line) === canonicalAddress(unit))));
    const streetUnitConflict = Boolean(result.unit && hasUnitMarker(result.address_line) && !containsUnit(result.address_line, result.unit));
    const separateUnit = streetUnitConflict || containsUnit(result.address_line, result.unit) ? null : result.unit;
    const structuredAddress = [result.address_line, separateUnit, locality].filter(Boolean).join("\n") || null;
    const legacyAddress = text(raw.recipient_address, "recipient_address");
    result.recipient_address = legacyAddress || structuredAddress;
    function addressWarning(message, candidates) {
      result.address_candidates = [...new Set(candidates.filter(Boolean))];
      warnings.push({ field: "recipient_address", code: "CONFLICTING_ADDRESS", message });
    }
    if (streetUnitConflict) {
      // Never concatenate contradictory unit readings into a fabricated address.
      addressWarning("The street reading already includes a unit; a separate unit was read as " + result.unit + ". Verify the address and unit against the photo.", [legacyAddress, structuredAddress, result.unit]);
    } else if (legacyAddress && result.unit && !containsUnit(legacyAddress, result.unit)) {
      const withoutUnit = [result.address_line, locality].filter(Boolean).join("\n");
      if (result.address_line && !hasUnitMarker(result.address_line) && canonicalAddress(legacyAddress) === canonicalAddress(withoutUnit)) {
        // The two readings agree on the street/locality; include the exact separate unit.
        result.recipient_address = structuredAddress;
      } else {
        // Do not silently append a potentially conflicting unit to another address.
        addressWarning("Address readings differ; a separate unit was read as " + result.unit + ". Verify the address and unit against the photo.", [legacyAddress, structuredAddress]);
      }
    } else if (legacyAddress && result.address_line && structuredAddress && canonicalAddress(legacyAddress) !== canonicalAddress(structuredAddress)) {
      addressWarning("The reader returned different address readings. Verify the full address against the photo.", [legacyAddress, structuredAddress]);
    }
    result.confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) && raw.confidence >= 0 && raw.confidence <= 1 ? raw.confidence : 0;
    if (result.confidence === 0 && raw.confidence !== 0) warnings.push({ field: "confidence", code: "INVALID_CONFIDENCE", message: "Reader confidence was missing or invalid." });

    for (const source of [payload.review_warnings, raw !== payload ? raw.review_warnings : null]) {
      if (!Array.isArray(source)) continue;
      for (const warning of source.slice(0, 30)) {
        if (!warning || typeof warning !== "object") continue;
        const field = typeof warning.field === "string" ? warning.field.slice(0, 80) : "label";
        const code = typeof warning.code === "string" ? warning.code.slice(0, 80) : "REVIEW_REQUIRED";
        const message = typeof warning.message === "string" ? warning.message.slice(0, 500) : "Check the photo.";
        if (!warnings.some(item => item.field === field && item.code === code && item.message === message)) warnings.push({ field, code, message });
      }
    }
    result.review_warnings = warnings;
    result.needs_review = true;
    return result;
  }
  root.ParcelSnapVisionResult = Object.freeze({ normalize });
})(typeof window !== "undefined" ? window : globalThis);
