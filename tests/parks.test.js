import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const inventory = JSON.parse(readFileSync(new URL('../src/cubbon-inventory.json', import.meta.url)));
const boundaries = JSON.parse(readFileSync(new URL('../src/park-boundaries.json', import.meta.url)));

test('Cubbon preserves the historical headline and independently reported zone counts', () => {
  assert.equal(inventory.submitted, '2022-05-31');
  assert.equal(inventory.trees, 8866);
  assert.equal(inventory.species, 196);
  assert.deepEqual(inventory.zones.map(zone => [zone.number, zone.trees, zone.page]), [
    [1, 532, 240], [2, 147, 243], [3, 2604, 246], [4, 300, 251], [5, 53, 254],
    [6, 17, 257], [7, 1878, 260], [8, 1234, 264], [9, 65, 267], [10, 82, 270],
    [11, 648, 273], [12, 42, 276], [13, 81, 279], [14, 155, 282], [15, 419, 287],
    [16, 78, 290], [17, 21, 293], [18, 313, 296], [19, 30, 299],
  ]);
  assert.equal(inventory.zones.reduce((sum, zone) => sum + zone.trees, 0), 8699);
  assert.equal(inventory.separateAreas.reduce((sum, area) => sum + area.trees, 0), 157);
  assert.match(inventory.countNote, /8,856/);
  assert.equal(inventory.zones[11].dominantSpecies.length, 1, 'Do not pad every zone to five species');
});

test('park overlays are attributed Bengaluru polygons, never individual tree locations', () => {
  assert.equal(boundaries.type, 'FeatureCollection');
  assert.deepEqual(boundaries.features.map(feature => feature.properties.id), ['cubbon', 'lalbagh']);
  for (const feature of boundaries.features) {
    assert.equal(feature.geometry.type, 'Polygon');
    assert.match(feature.properties.source, /^https:\/\/www.openstreetmap.org\/way\/\d+$/);
    assert.equal(typeof feature.properties.version, 'number');
    const ring = feature.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.length > 3);
    for (const [lng, lat] of ring) {
      assert.ok(lng > 77.57 && lng < 77.61 && lat > 12.94 && lat < 12.99, 'GeoJSON is longitude first');
    }
    assert.equal(feature.properties.trees, undefined, 'Boundary geometry does not assert an inventory count');
  }
});
