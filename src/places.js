// Photon supports search-as-you-type; the public Nominatim API does not.
export const BENGALURU_BOUNDS = [77.3, 12.7, 77.9, 13.3];

export async function searchPlaces(text, signal) {
  const q = text.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, bbox: BENGALURU_BOUNDS.join(','), lang: 'en', limit: '8' });
  const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
  if (!response.ok) throw new Error('Place search unavailable');
  const { features } = await response.json();
  const [west, south, east, north] = BENGALURU_BOUNDS;
  return features.filter(({ properties: p, geometry: g }) => {
    const [lng, lat] = g.coordinates;
    // Photon omits city for some Bengaluru suburbs, including Koramangala.
    const inCity = p.city ? /^(bengaluru|bangalore)$/i.test(p.city)
      : /^(bengaluru|bangalore)( (urban|north|south|east|west))?$/i.test(p.county || '');
    return p.countrycode === 'IN' && inCity
      && lng >= west && lng <= east && lat >= south && lat <= north;
  }).map(({ properties: p, geometry: g }) => ({
    name: p.name || p.street,
    context: [...new Set([p.osm_value?.replaceAll('_', ' '), p.district, p.city || p.county].filter(Boolean))].join(' · '),
    lat: g.coordinates[1],
    lng: g.coordinates[0],
  })).filter((place) => place.name);
}
