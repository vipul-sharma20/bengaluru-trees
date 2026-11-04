import { select, hierarchy, pack, scaleLog, scaleLinear, scaleSequential, scaleSequentialSqrt,
  interpolateRgb, axisBottom, axisLeft, max, geoMercator, geoPath, zoom, zoomIdentity } from 'd3';
import { prepareCensus } from './analytics-data.js';
import photoCatalog from './species-photos.json';
import { openSpeciesPhotos } from './photos.js';
import wardBoundaries from './ward-boundaries.json';
import { isEmbedded, reportEmbedHeight } from './embed.js';
import './style.css';
import './analytics.css';

const $ = (selector) => document.querySelector(selector);
const number = new Intl.NumberFormat('en-IN');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 0 });
const share = (count, total) => `${(total ? count / total * 100 : 0).toFixed(1)}%`;
const shortName = (name) => name === 'Others' ? 'Unidentified' : name.split(' ').slice(0, 2).join(' ');
const palette = ['#4a7256', '#839b76', '#648b97', '#b29170', '#8d8199', '#b3b688'];
const unknownColour = '#b5aca1';
const remainingColour = '#a7bfa6';
const state = { ward: '', species: null };
let census;
let colours;
const wardNames = new Map(wardBoundaries.features.map((feature) =>
  [String(feature.properties.WARD_NO), feature.properties.WARD_NAME.replace(/\s+ward$/i, '')]));
const areaName = (id) => wardNames.get(id);

function colour(name) {
  return name === 'Others' ? unknownColour : colours.get(name) || remainingColour;
}

function readout(selector, title, value, note = '') {
  const node = select(selector);
  node.selectAll('*').remove();
  node.append('strong').text(title);
  node.append('span').text(value);
  if (note) node.append('small').text(note);
}

function showReference(selector, species) {
  const figure = select(selector);
  if (figure.attr('data-species') === (species || '')) return;
  figure.attr('data-species', species || '').selectAll('*').remove();
  const entry = photoCatalog[species];
  const photo = entry?.photos[0];
  if (!photo) {
    figure.append('div').attr('class', 'reference-empty').text(species === 'Others'
      ? 'Unidentified records · no species photo' : species ? 'No verified reference photos' : 'Explore a species to see its photos');
    return;
  }
  const button = figure.append('button').attr('type', 'button').attr('class', 'reference-image')
    .attr('aria-label', `Open ${entry.photos.length} reference photos of ${species}`);
  button.append('img').attr('src', photo.thumbnail).attr('alt', photo.alt).attr('width', 480).attr('height', 360)
    .on('error', function () {
      select(this).attr('hidden', true);
      button.select('span').text('Photo unavailable · open gallery ↗');
    });
  button.append('span').text(`${shortName(species)} · ${entry.photos.length} photos ↗`);
  button.on('click', function () { openSpeciesPhotos(species, this); });
  const caption = figure.append('figcaption');
  caption.append('p').attr('class', 'reference-scope').text(entry.referenceNotice ||
    (photo.sourceKind === 'kew' ? 'Herbarium reference · not a census tree' : 'Species reference · not a census tree'));
  const credit = caption.append('p');
  credit.append('a').attr('href', photo.sourcePage).attr('target', '_blank').attr('rel', 'noreferrer').text(`Photo: ${photo.creator}`);
  credit.append('span').text(' · ');
  credit.append('a').attr('href', photo.licenseUrl).attr('target', '_blank').attr('rel', 'noreferrer').text(photo.license);
  const details = caption.append('details');
  details.append('summary').text('Reference scope & image credits');
  details.append('p').text(photo.referenceNotice);
  details.append('p').text(photo.attribution);
  details.append('p').text(photo.changes);
}

function plot(selector, width, height, label, describedBy) {
  const svg = select(selector).selectAll('svg').data([null]).join('svg')
    .attr('viewBox', `0 0 ${width} ${height}`).attr('role', 'group').attr('tabindex', 0)
    .attr('aria-label', `${label}. Arrow keys explore marks; Enter selects; Escape clears the selection.`)
    .attr('aria-describedby', describedBy);
  svg.selectAll('*').remove();
  return svg;
}

// A single keyboard stop per plot; every mark remains available with arrow keys.
function explore(svg, marks, describe, activate) {
  let index = 0;
  const nodes = marks.nodes();
  const show = (node) => {
    index = nodes.indexOf(node);
    marks.classed('is-peek', function () { return this === node; });
    describe(select(node).datum());
  };
  marks.attr('role', 'button').attr('tabindex', -1)
    .on('pointerenter', function () { show(this); })
    .on('click', function (_, data) { show(this); activate(data); });
  svg.on('focus', () => { if (nodes.length) show(nodes[index]); });
  svg.on('keydown', (event) => {
    if (!nodes.length) return;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = nodes.length - 1;
      else index = (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + nodes.length) % nodes.length;
      show(nodes[index]);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(select(nodes[index]).datum());
    } else if (event.key === 'Escape') {
      clearSelection();
    }
  });
}

function selectSpecies(name) {
  state.species = state.species === name ? null : name;
  render();
}

function selectWard(name) {
  state.ward = name;
  $('#ward-filter').value = name;
  render();
}

function clearSelection() {
  state.ward = '';
  state.species = null;
  $('#ward-filter').value = '';
  render();
}

function drawCanopy() {
  const scope = census.wards.find((ward) => ward.name === state.ward) || census.city;
  const width = $('#canopy-chart').clientWidth;
  const size = Math.min(width, 620);
  const svg = plot('#canopy-chart', size, size, 'Species canopy. Circle area represents record count', 'canopy-detail');
  const pattern = svg.append('defs').append('pattern').attr('id', 'unknown-hatch')
    .attr('width', 7).attr('height', 7).attr('patternUnits', 'userSpaceOnUse').attr('patternTransform', 'rotate(35)');
  pattern.append('rect').attr('width', 7).attr('height', 7).attr('fill', '#ddd6cd');
  pattern.append('line').attr('y2', 7).attr('stroke', '#b5aca1').attr('stroke-width', 2);
  const root = hierarchy({ children: scope.species }).sum((item) => item.count || 0)
    .sort((a, b) => b.value - a.value);
  // Fixed relative radii preserve area ratios; padding must not inflate the rare labels.
  const leaves = scope.total ? pack().size([size, size]).padding(1.6)(root).leaves() : [];
  const groups = svg.selectAll('.species-node').data(leaves).join('g')
    .attr('class', 'species-node').attr('transform', (d) => `translate(${d.x},${d.y})`)
    .attr('data-species', (d) => d.data.name)
    .attr('aria-label', (d) => `${d.data.name}: ${number.format(d.value)} records, ${share(d.value, scope.total)}`)
    .classed('is-selected', (d) => d.data.name === state.species);
  groups.append('circle').attr('r', (d) => d.r)
    .attr('fill', (d) => d.data.name === 'Others' ? 'url(#unknown-hatch)' : colour(d.data.name));
  groups.filter((d) => d.r > 34).each(function (d) {
    const words = shortName(d.data.name).split(' ');
    const label = select(this).append('text').attr('text-anchor', 'middle').attr('class', 'canopy-label')
      .style('font-size', `${Math.min(13, d.r * 1.7 / (Math.max(...words.map((word) => word.length)) * .56))}px`)
      .style('fill', colour(d.data.name) === palette[0] ? '#fff' : null);
    words.forEach((word, i) => label.append('tspan').attr('x', 0).attr('dy', i ? '1.2em' : `${-(words.length - 1) * .6}em`).text(word));
    if (d.r > 58) label.append('tspan').attr('x', 0).attr('dy', '1.6em').attr('class', 'canopy-share').text(share(d.value, scope.total));
  });
  const describe = (d) => {
    readout('#canopy-detail', d.data.name === 'Others' ? 'Unidentified · “Others”' : d.data.name,
      `${number.format(d.value)} records · ${share(d.value, scope.total)}`);
    showReference('#canopy-photo', d.data.name);
  };
  explore(svg, groups, describe, (d) => selectSpecies(d.data.name));
  const initial = leaves.find((d) => d.data.name === state.species) || leaves.find((d) => d.data.name !== 'Others') || leaves[0];
  if (initial) describe(initial);
  else readout('#canopy-detail', 'No census records', 'There are no records to draw.');
  svg.on('pointerleave', () => { if (state.species && initial) describe(initial); });
  $('#scope-caption').textContent = `${state.ward ? areaName(state.ward) : 'All areas'} · ${scope.richness} identified labels`;
  $('#clear-species').hidden = state.species === null;
  const key = select('#species-key').selectAll('button').data(scope.species.filter((d) => d.name !== 'Others').slice(0, 5), (d) => d.name)
    .join('button').attr('type', 'button').attr('aria-pressed', (d) => d.name === state.species)
    .on('click', (_, d) => selectSpecies(d.name));
  key.selectAll('*').remove();
  key.append('i').style('background', (d) => colour(d.name));
  key.append('span').text((d) => shortName(d.name));
  const unknownKey = select('#species-key').selectAll('.unknown-key').data(scope.unidentified ? [null] : []).join('div').attr('class', 'unknown-key');
  unknownKey.selectAll('*').remove();
  unknownKey.append('i').attr('class', 'hatch-key');
  unknownKey.append('span').text('Unidentified');
}

function drawWards() {
  const width = $('#ward-chart').clientWidth;
  const narrow = width < 580;
  const height = narrow ? 390 : 460;
  const margin = { left: 46, right: 28, top: 36, bottom: 48 };
  const svg = plot('#ward-chart', width, height, 'Areas by recorded trees and identified species labels. One dot per area', 'ward-detail');
  const x = scaleLog().domain([1, Math.max(10, max(census.wards, (d) => d.total) || 1)]).nice()
    .range([margin.left, width - margin.right]);
  const y = scaleLinear().domain([0, Math.max(10, max(census.wards, (d) => d.richness) || 0)]).nice()
    .range([height - margin.bottom, margin.top]);
  const tint = scaleSequential(interpolateRgb('#4a7256', '#b29170')).domain([0, 1]);
  svg.append('g').attr('class', 'chart-grid').attr('transform', `translate(${margin.left},0)`)
    .call(axisLeft(y).ticks(4).tickSize(-(width - margin.left - margin.right)).tickFormat('')).call((g) => g.select('.domain').remove());
  svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(0,${height - margin.bottom})`)
    .call(axisBottom(x).tickValues([1, 10, 100, 1000, 10000, 100000].filter((v) => v <= x.domain()[1])).tickFormat((v) => compact.format(v)).tickSize(0).tickPadding(12));
  svg.append('g').attr('class', 'chart-axis').attr('transform', `translate(${margin.left},0)`)
    .call(axisLeft(y).ticks(4).tickSize(0).tickPadding(10)).call((g) => g.select('.domain').remove());
  svg.append('text').attr('class', 'axis-title').attr('x', margin.left).attr('y', 15).text('Identified labels');
  svg.append('text').attr('class', 'axis-title').attr('x', width - margin.right).attr('y', height - 3).attr('text-anchor', 'end').text('Recorded trees · log scale');
  const marks = svg.append('g').selectAll('.ward-dot').data(census.wards).join('circle')
    .attr('class', 'ward-dot').attr('cx', (d) => x(d.total)).attr('cy', (d) => y(d.richness)).attr('r', narrow ? 4.5 : 5.5)
    .attr('fill', (d) => tint(d.unidentified / d.total)).attr('data-ward', (d) => d.name)
    .classed('is-selected', (d) => d.name === state.ward)
    .attr('aria-label', (d) => `${areaName(d.name)}: ${number.format(d.total)} records, ${d.richness} identified labels, ${share(d.unidentified, d.total)} unidentified`);
  const featured = new Set([census.wards[0]?.name, [...census.wards].sort((a, b) => b.richness - a.richness)[0]?.name, state.ward]);
  svg.append('g').selectAll('text').data(census.wards.filter((d) => featured.has(d.name))).join('text')
    .attr('class', 'ward-annotation').attr('x', (d) => x(d.total) + (x(d.total) < 140 ? 9 : -9))
    .attr('y', (d) => y(d.richness) + (narrow && d.name === census.wards[0]?.name ? 20 : -10))
    .attr('text-anchor', (d) => x(d.total) < 140 ? 'start' : 'end').text((d) => areaName(d.name));
  explore(svg, marks, describeWard, (d) => selectWard(d.name));
  const initial = census.wards.find((d) => d.name === state.ward) || [...census.wards].sort((a, b) => b.richness - a.richness)[0];
  if (initial) describeWard(initial);
  else readout('#ward-detail', 'No areas', 'No records to compare.');
}

function describeWard(ward) {
  readout('#ward-detail', areaName(ward.name), `${number.format(ward.total)} records · ${ward.richness} identified labels`,
    `${share(ward.unidentified, ward.total)} unidentified`);
  selectAllWards(ward.name);
}

function selectAllWards(name) {
  select('#ward-chart').selectAll('.ward-dot').classed('is-peek', (d) => d.name === name);
  select('#ward-map').selectAll('.ward-region').classed('is-peek', (d) => String(d.properties.WARD_NO) === name)
    .filter('.is-peek').raise();
}

function drawWardMap() {
  const width = $('#ward-map').clientWidth;
  // Narrow embeds can lose spare canvas height without shrinking the width-limited outline.
  const height = isEmbedded && width < 430 ? width : width < 580 ? 430 : 460;
  const svg = plot('#ward-map', width, height, 'Bengaluru areas with historical boundaries. Darker green means more recorded trees, on a square-root scale; grey means no records', 'ward-detail');
  const projection = geoMercator().fitExtent([[18, 22], [width - 18, height - 18]], wardBoundaries);
  const path = geoPath(projection);
  const highestCount = max(census.wards, (d) => d.total) || 1;
  const tint = scaleSequentialSqrt(interpolateRgb('#e4efdc', '#24543b')).domain([0, highestCount]);
  $('#map-count-max').textContent = number.format(highestCount);
  const wards = new Map(census.wards.map((ward) => [ward.name, ward]));
  const view = svg.append('g').attr('class', 'area-map-view');
  const regions = view.append('g').selectAll('path').data(wardBoundaries.features).join('path')
    .attr('class', 'ward-region').attr('d', path).attr('data-ward-region', (d) => String(d.properties.WARD_NO))
    .attr('fill', (d) => {
      const ward = wards.get(String(d.properties.WARD_NO));
      return ward ? tint(ward.total) : '#e1e2df';
    }).classed('is-selected', (d) => String(d.properties.WARD_NO) === state.ward)
    .classed('no-records', (d) => !wards.has(String(d.properties.WARD_NO)))
    .attr('aria-label', (d) => `${areaName(String(d.properties.WARD_NO))}${wards.has(String(d.properties.WARD_NO)) ? '' : ': no records in this snapshot'}`);
  explore(svg, regions.filter((d) => wards.has(String(d.properties.WARD_NO))),
    (d) => describeWard(wards.get(String(d.properties.WARD_NO))), (d) => selectWard(String(d.properties.WARD_NO)));
  regions.filter((d) => !wards.has(String(d.properties.WARD_NO))).attr('role', 'img').on('pointerenter', (_, d) => {
    readout('#ward-detail', areaName(String(d.properties.WARD_NO)), 'No records in this census snapshot', 'This does not mean there are no trees here. Historical reference outline.');
    selectAllWards(String(d.properties.WARD_NO));
  });
  const labelled = new Set(width < 400 ? state.ward ? [state.ward] : ['4', '150'] : ['4', '82', '150', '198', state.ward]);
  const labels = view.append('g').attr('class', 'map-labels');
  labels.selectAll('text').data(wardBoundaries.features.filter((d) => labelled.has(String(d.properties.WARD_NO))))
    .join('text').attr('x', (d) => path.centroid(d)[0]).attr('y', (d) => path.centroid(d)[1])
    .attr('text-anchor', (d) => path.centroid(d)[0] < width / 2 ? 'start' : 'end')
    .text((d) => areaName(String(d.properties.WARD_NO)));
  svg.append('text').attr('class', 'axis-title').attr('x', width - 24).attr('y', 18).text('N ↑');
  const navigation = zoom().scaleExtent([1, 8])
    .extent([[0, 0], [width, height]]).translateExtent([[0, 0], [width, height]])
    .clickDistance(4)
    .filter((event) => {
      if (event.button || (event.ctrlKey && event.type !== 'wheel')) return false;
      // Embedded maps must not intercept ordinary article scrolling.
      if (isEmbedded && event.type === 'wheel') return event.ctrlKey || event.metaKey;
      if (isEmbedded && event.type === 'touchstart') return event.touches.length > 1;
      return true;
    })
    .on('zoom', ({ transform }) => {
      view.attr('transform', transform);
      labels.style('font-size', `${10 / transform.k}px`);
      $('#area-zoom-in').disabled = transform.k >= 8;
      $('#area-zoom-out').disabled = transform.k <= 1;
      $('#area-zoom-reset').disabled = transform.k <= 1;
    });
  // D3 keeps the transform on this SVG, including when a selection redraws it.
  // Reapply its scale to constrain the pan after a viewport resize.
  svg.call(navigation).call(navigation.scaleBy, 1);
  $('#area-zoom-in').onclick = () => svg.call(navigation.scaleBy, 2);
  $('#area-zoom-out').onclick = () => svg.call(navigation.scaleBy, .5);
  $('#area-zoom-reset').onclick = () => svg.call(navigation.transform, zoomIdentity);
}

function render() {
  if (!census) return;
  drawCanopy();
  drawWardMap();
  drawWards();
}

async function load() {
  $('#analytics-retry').hidden = true;
  $('#analytics-status').hidden = false;
  $('#analytics-status').textContent = 'Drawing the census…';
  try {
    const response = await fetch('/api/analytics', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('Census unavailable');
    const data = await response.json();
    census = prepareCensus(data);
    colours = new Map(census.city.species.filter((d) => d.name !== 'Others').slice(0, 6).map((d, i) => [d.name, palette[i]]));
    const options = [...census.wards].sort((a, b) => areaName(a.name).localeCompare(areaName(b.name)))
      .map((ward) => new Option(areaName(ward.name), ward.name));
    $('#ward-filter').replaceChildren(new Option('All areas', ''), ...options);
    $('#method-description').textContent = `These charts show ${number.format(data.metadata.count)} tree records from BBMP’s ${data.metadata.release} census, shared by OpenCity.`;
    $('#analytics-source').href = data.metadata.source;
    $('#analytics-content').hidden = false;
    render();
    $('#analytics-status').textContent = 'Census visualizations loaded.';
    $('#analytics-status').classList.add('visually-hidden');
  } catch {
    $('#analytics-content').hidden = true;
    $('#analytics-status').classList.remove('visually-hidden');
    $('#analytics-status').textContent = 'The census could not be drawn. Please try again.';
    $('#analytics-retry').hidden = false;
  }
}

$('#ward-filter').addEventListener('change', () => selectWard($('#ward-filter').value));
$('#clear-species').addEventListener('click', () => { state.species = null; render(); });
$('#analytics-retry').addEventListener('click', load);
$('.method-link').addEventListener('click', () => { $('#method').open = true; });
let plotWidth = 0;
const observer = new ResizeObserver(([entry]) => {
  if (entry.contentRect.width !== plotWidth) {
    plotWidth = entry.contentRect.width;
    render();
  }
});
observer.observe($('.analytics-shell'));
reportEmbedHeight($('.analytics-shell'));
load();
