import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, knownFromBoundaries } from '../src/validate.js';
import { data, boundaries, clone } from './helpers.mjs';

const known = knownFromBoundaries(boundaries);
const check = (mutate, current = data) => {
  const d = clone(data);
  mutate(d);
  return validateSnapshot(d, known, current);
};

test('the shipped snapshot is valid', () => {
  const r = validateSnapshot(data, known, null);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
});

test('an equal date is accepted', () => assert.equal(validateSnapshot(clone(data), known, data).ok, true));
test('a newer date is accepted', () => assert.equal(check((d) => { d.meta.latest_data_date = '2030-01-01'; }).ok, true));
test('an older date is rejected', () => assert.equal(check((d) => { d.meta.latest_data_date = '2020-01-01'; }).ok, false));

test('garbage input is rejected without throwing', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { meta: {} }]) assert.equal(validateSnapshot(x, known, data).ok, false);
});

test('unknown public health unit name is rejected', () => assert.equal(check((d) => { d.phus[0].name = 'Nowhere Health'; }).ok, false));
test('missing region series is rejected', () => assert.equal(check((d) => { delete d.series['3895']; }).ok, false));
test('wrong length series is rejected', () => assert.equal(check((d) => { d.series.ON.pos.pop(); }).ok, false));

test('negative and implausible numbers are rejected', () => {
  assert.equal(check((d) => { d.series.ON.pos[100] = -2; }).ok, false);
  assert.equal(check((d) => { d.series.ON.vax1[100] = 250; }).ok, false);
  assert.equal(check((d) => { d.series.ON.vol[100] = 3; }).ok, false);
  assert.equal(check((d) => { d.series.ON.pos[100] = 'abc'; }).ok, false);
});

test('non-increasing dates are rejected', () => assert.equal(check((d) => { d.dates[5] = d.dates[4]; }).ok, false));
test('sample data cannot replace real data', () => assert.equal(check((d) => { d.meta.synthetic = true; }).ok, false));
