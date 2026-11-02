import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchPlaces } from '../src/places.js';

test('place autocomplete returns only named Bengaluru results inside the search area', async (t) => {
  const feature = (name, city, coordinates, countrycode = 'IN') => ({
    properties: { name, city, countrycode, district: 'Ashoka Pillar', osm_value: 'park' },
    geometry: { type: 'Point', coordinates },
  });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [
    feature('Lalbagh Botanical Gardens', 'Bengaluru', [77.5869093, 12.948857]),
    feature('Local park', 'Bangalore', [77.64, 12.98]),
    feature('Mysuru Palace', 'Mysuru', [76.655, 12.305]),
    feature('Mislabelled far-away park', 'Bengaluru', [78.1, 13.1]),
    feature('Outside-city result in search box', 'Hosur', [77.82, 12.74]),
    feature('Foreign result', 'Bengaluru', [77.6, 13], 'US'),
    feature('Unknown city', undefined, [77.6, 13]),
    feature(undefined, 'Bengaluru', [77.6, 13]),
  ] }));
  assert.deepEqual(await searchPlaces('Lalbagh'), [
    { name: 'Lalbagh Botanical Gardens', context: 'park · Ashoka Pillar · Bengaluru', lat: 12.948857, lng: 77.5869093 },
    { name: 'Local park', context: 'park · Ashoka Pillar · Bangalore', lat: 12.98, lng: 77.64 },
  ]);
});

test('Bengaluru suburbs without city metadata are searchable, not their out-of-city namesakes', async (t) => {
  const feature = (name, county, coordinates, city) => ({
    properties: { name, county, city, countrycode: 'IN', osm_value: 'suburb' },
    geometry: { type: 'Point', coordinates },
  });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ features: [
    feature('Koramangala', 'Bangalore South', [77.624081, 12.9357366]),
    feature('Indiranagar', 'Bangalore East', [77.6404672, 12.9732913]),
    feature('Koramangala', 'Devanahalli taluku', [77.7519261, 13.2923988]),
    feature('Outside the search area', 'Bangalore South', [77.6, 12.6]),
    feature('Explicitly another city', 'Bangalore South', [77.82, 12.74], 'Hosur'),
  ] }));
  assert.deepEqual(await searchPlaces('Koramangala'), [
    { name: 'Koramangala', context: 'suburb · Bangalore South', lat: 12.9357366, lng: 77.624081 },
    { name: 'Indiranagar', context: 'suburb · Bangalore East', lat: 12.9732913, lng: 77.6404672 },
  ]);
});

test('short queries stay empty and provider failures are not reported as no matches', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }));
  assert.deepEqual(await searchPlaces('  La '), []);
  await assert.rejects(searchPlaces('Lalbagh'), /Place search unavailable/);
});
