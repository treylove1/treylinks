import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const review=read('intake-review.js');
const engine=read('local-reader/paddle-reader.js');
const runtime=read('local-reader/paddle-runtime/paddle-runtime.mjs');
const worker=read('local-reader/paddle-runtime/paddle-worker.mjs');
const intake=read('free-intake-reader.mjs');

// The policy file is an IIFE and does not touch document when document is absent.
vm.runInThisContext(review,{filename:'intake-review.js'});
const policy=globalThis.ParcelSnapIntakeReview;

test('worker flow is photo-first and only exact strong customer matches are auto-safe',()=>{
  assert.equal(policy.AUTO_MATCH_POLICY.minScore,.97);
  assert.equal(policy.AUTO_MATCH_POLICY.minMargin,.08);
  assert.deepEqual([...policy.AUTO_MATCH_POLICY.reasons],['exact-line','compact-exact']);
  assert.match(review,/scheduleAutoRead/);
  assert.match(review,/highVolumeAfterRead/);
  assert.match(review,/automaticAttempts/);
});

test('printed carrier and weight parsing is conservative',()=>{
  assert.equal(policy.parsePrintedCarrier('UPS GROUND\nTRACKING 1Z123'),'UPS');
  assert.equal(policy.parsePrintedCarrier('FedEx Home Delivery'),'FedEx');
  assert.equal(policy.parsePrintedWeightLb('WEIGHT: 12.5 LBS'),12.5);
  assert.equal(policy.parsePrintedWeightLb('WT 16 OZ'),1);
  assert.equal(policy.parsePrintedWeightLb('PACKAGE WEIGHT 2 KG'),4.41);
  assert.equal(policy.parsePrintedWeightLb('ORDER 50\nTOTAL 20'),null);
});

test('automatic send remains gated until reviewed commercial release',()=>{
  assert.equal(policy.BUILD.writesEnabled,false);
  assert.match(review,/BUILD\.writesEnabled===true&&save&&!save\.disabled/);
  assert.match(review,/receivePackage/);
});

test('one-shot OCR integrity remains while next worker can prewarm',()=>{
  assert.match(runtime,/if \(predicted\).*exactly one prediction/);
  assert.match(worker,/Exactly one full-frame prediction is permitted/);
  assert.equal((engine.match(/api\.predict\(/g)||[]).length,1);
  assert.match(engine,/async warm\(\)/);
  assert.match(engine,/preparedApi/);
  assert.match(engine,/scheduleNextWarm\(\)/);
  assert.match(intake,/async warm\(\)\{return this\.engine\.warm\(\);\}/);
});

test('ambiguous or incomplete packages do not auto-send',()=>{
  assert.match(review,/recipientButtons\.length!==1/);
  assert.match(review,/!decision\?\.autoSafe/);
  assert.match(review,/!tracking\|\|!name\|\|!address\|\|customerId!==decision\.customerId/);
});
