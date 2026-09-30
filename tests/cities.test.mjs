import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findPlace, normalizePlace } from '../src/cities.js';
import { answerQuestion } from '../src/chat.js';
import { data, boundaries } from './helpers.mjs';

const cities = JSON.parse(readFileSync(new URL('../data/cities.json', import.meta.url), 'utf8'));
const byName = (n) => cities.find((c) => c.name === n);
const phuOf = (n) => data.phus.find((p) => p.id === byName(n).phu).name;

test('every city points at a real public health unit and lies inside Ontario', () => {
  const ids = new Set(boundaries.features.map((f) => f.properties.id));
  assert.ok(cities.length > 100);
  for (const c of cities) {
    assert.ok(ids.has(c.phu), c.name);
    assert.ok(c.lat > 41.6 && c.lat < 57 && c.lon > -95.2 && c.lon < -74.3, c.name);
  }
  assert.equal(new Set(cities.map((c) => c.name)).size, cities.length, 'no duplicate names');
});

test('well-known places map to the right unit', () => {
  assert.equal(phuOf('Toronto'), 'Toronto Public Health');
  assert.equal(phuOf('Hamilton'), 'Hamilton Public Health Services');
  assert.equal(phuOf('London'), 'Middlesex-London Health Unit');
  assert.equal(phuOf('Mississauga'), 'Peel Public Health');
  assert.equal(phuOf('Kitchener'), 'Region of Waterloo Public Health and Paramedic Services');
  assert.equal(phuOf('Thunder Bay'), 'Thunder Bay District Health Unit');
  assert.equal(phuOf('Kingston'), 'Southeast Public Health');
  assert.equal(phuOf('Peterborough'), 'Lakelands Public Health');
  assert.equal(phuOf('Timmins'), 'Northeastern Public Health');
  assert.equal(phuOf('Brantford'), 'Grand Erie Public Health');
  assert.equal(phuOf('Barrie'), 'Simcoe Muskoka District Health Unit');
});

test('search ignores case, accents and punctuation, and accepts prefixes', () => {
  assert.equal(findPlace('  hamilton ', cities, data.phus).city.name, 'Hamilton');
  assert.equal(findPlace('SAULT STE MARIE', cities, data.phus).city.name, 'Sault Ste. Marie');
  assert.equal(findPlace('st catharines', cities, data.phus).city.name, 'St. Catharines');
  assert.equal(findPlace('saint catharines', cities, data.phus).city.name, 'St. Catharines');
  assert.equal(findPlace('thunder', cities, data.phus).city.name, 'Thunder Bay');
  assert.equal(normalizePlace('Sault Ste. Marie'), 'sault ste marie');
});

test('a public health unit name also works, and junk returns null', () => {
  assert.equal(findPlace('Peel Public Health', cities, data.phus).phu.id, 2253);
  assert.equal(findPlace('', cities, data.phus), null);
  assert.equal(findPlace('x', cities, data.phus), null);
  assert.equal(findPlace('zzzzzz', cities, data.phus), null);
});

test('chat understands city names and says which unit serves them', () => {
  const ask = (q) => answerQuestion(q, { data, regionId: 'ON', indicator: 'pos', cities });
  const a = ask('test positivity in Tobermory');
  assert.match(a.text, /Tobermory is served by Grey Bruce Public Health/);
  const b = ask('What is the latest value in Hamilton?');
  assert.match(b.text, /Hamilton Public Health Services/);
  const c = ask('positivity in London');
  assert.match(c.text, /Middlesex-London Health Unit/);
});
