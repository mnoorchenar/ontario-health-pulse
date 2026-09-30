import test from 'node:test';
import assert from 'node:assert/strict';
import { forecast, MIN_POINTS } from '../src/forecast.js';

const line = (n, a, b) => Array.from({ length: n }, (_, i) => a + b * i);
const wave = (n, base, amp, period = 52) => Array.from({ length: n }, (_, i) => base + amp * Math.sin((2 * Math.PI * i) / period));

test('skips politely when there is too little data', () => {
  const f = forecast(line(MIN_POINTS - 1, 1, 1));
  assert.equal(f.skipped, true);
  assert.match(f.reason, /not enough history/i);
});

test('skips on empty or null input without throwing', () => {
  assert.equal(forecast([]).skipped, true);
  assert.equal(forecast(null).skipped, true);
  assert.equal(forecast([null, null, null]).skipped, true);
});

test('linear rise continues upward', () => {
  const f = forecast(line(40, 10, 0.5), { horizon: 6 });
  assert.equal(f.skipped, false);
  assert.equal(f.mean.length, 6);
  assert.ok(f.mean[5] > f.mean[0], 'forecast keeps rising');
  assert.ok(f.mean[0] > 29, 'starts near the last value (29.5)');
});

test('flat series forecasts flat with a narrow band', () => {
  const f = forecast(Array(30).fill(5), { horizon: 6 });
  assert.ok(f.mean.every((v) => Math.abs(v - 5) < 0.01));
  assert.ok(f.hi.every((v, i) => v - f.lo[i] < 0.01));
});

test('band contains the mean and never narrows with horizon', () => {
  const noisy = wave(80, 10, 3, 13).map((v, i) => v + (i % 3) * 0.4);
  const f = forecast(noisy, { horizon: 8 });
  for (let k = 0; k < 8; k++) {
    assert.ok(f.lo[k] <= f.mean[k] && f.mean[k] <= f.hi[k]);
    if (k) assert.ok(f.hi[k] - f.lo[k] >= f.hi[k - 1] - f.lo[k - 1] - 1e-9 || f.lo[k] === 0);
  }
});

test('values are clamped to the allowed range', () => {
  const f = forecast(line(30, 50, -3), { min: 0, horizon: 6 });
  assert.ok(f.mean.every((v) => v >= 0) && f.lo.every((v) => v >= 0));
  const g = forecast(line(30, 60, 2), { max: 100, horizon: 8 });
  assert.ok(g.hi.every((v) => v <= 100));
});

test('uses the seasonal method when two years of a strong yearly pattern exist', () => {
  const f = forecast(wave(160, 10, 5, 52), { horizon: 6, min: 0 });
  assert.equal(f.skipped, false);
  assert.equal(f.method, 'hw');
  // truth for the next weeks continues the sine
  const truth = Array.from({ length: 6 }, (_, k) => 10 + 5 * Math.sin((2 * Math.PI * (160 + k)) / 52));
  f.mean.forEach((v, k) => assert.ok(Math.abs(v - truth[k]) < 1.5, `week ${k}: ${v} vs ${truth[k]}`));
});

test('short history never uses the seasonal method', () => {
  assert.equal(forecast(wave(90, 10, 5, 52)).method, 'holt');
});

test('gaps inside the series are filled, not propagated as NaN', () => {
  const v = line(40, 1, 1);
  v[10] = null; v[11] = null;
  const f = forecast(v);
  assert.equal(f.skipped, false);
  assert.ok(f.mean.every(Number.isFinite));
});

test('is deterministic', () => {
  const v = wave(70, 8, 2, 20);
  assert.deepEqual(forecast(v), forecast(v));
});
