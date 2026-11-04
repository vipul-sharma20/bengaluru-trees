// Plot inputs keep source labels intact; no taxonomy or ward boundaries are inferred.
function summarize(species) {
  const sorted = [...species].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return { species: sorted, total: sorted.reduce((sum, item) => sum + item.count, 0),
    richness: sorted.filter((item) => item.name !== 'Others').length,
    unidentified: sorted.find((item) => item.name === 'Others')?.count || 0 };
}

export function prepareCensus(data) {
  const totals = new Map();
  for (const ward of data.wards) {
    for (const item of ward.species) totals.set(item.name, (totals.get(item.name) || 0) + item.count);
  }
  return {
    city: summarize(Array.from(totals, ([name, count]) => ({ name, count }))),
    wards: data.wards.map((ward) => ({ name: ward.name, ...summarize(ward.species) }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, undefined, { numeric: true })),
  };
}
