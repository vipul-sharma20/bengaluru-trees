import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoContains } from 'd3';
import { prepareCensus } from '../src/analytics-data.js';

test('plot summaries preserve unidentified records and count distinct labels across wards', () => {
  const census = prepareCensus({ wards: [
    { name: '8', species: [{ name: 'Neem', count: 3 }, { name: 'Mango', count: 2 }] },
    { name: '9', species: [{ name: 'Neem', count: 1 }, { name: 'Others', count: 2011 }] },
  ] });
  assert.equal(census.city.total, 2017);
  assert.equal(census.city.richness, 2);
  assert.equal(census.city.unidentified, 2011);
  assert.deepEqual(census.city.species, [
    { name: 'Others', count: 2011 }, { name: 'Neem', count: 4 }, { name: 'Mango', count: 2 },
  ]);
});

test('unidentified-only and empty surveys do not invent species', () => {
  const census = prepareCensus({ wards: [{ name: '59', species: [{ name: 'Others', count: 976 }] }] });
  assert.equal(census.city.richness, 0);
  assert.equal(census.city.total, census.city.unidentified);
  const empty = prepareCensus({ wards: [] });
  assert.equal(empty.city.total, 0);
  assert.deepEqual(empty.city.species, []);
});

test('historical ward context keeps the 198-ward names and longitude-first Bengaluru geometry', () => {
  const boundaries = JSON.parse(readFileSync(new URL('../src/ward-boundaries.json', import.meta.url)));
  const wards = new Map(boundaries.features.map((f) => [f.properties.WARD_NO, f]));
  assert.equal(wards.size, 198);
  assert.deepEqual([...wards.keys()].sort((a, b) => a - b), Array.from({ length: 198 }, (_, i) => i + 1));
  assert.equal(wards.get(45).properties.WARD_NAME, 'Malleswaram');
  assert.equal(wards.get(160).properties.WARD_NAME, 'Rajarajeshwari Nagar');
  assert.equal(wards.get(196).properties.WARD_NAME, 'Anjanapura');
  assert.ok(geoContains(wards.get(45), [77.5595914, 13.0096269]));
  assert.ok(!geoContains(wards.get(160), [77.5595914, 13.0096269]));
});
