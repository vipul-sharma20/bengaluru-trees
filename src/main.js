import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import './style.css';
import { BENGALURU_BOUNDS, searchPlaces } from './places.js';
import { attachSpeciesPhotos, closeSpeciesPhotos } from './photos.js';
import { attachParks } from './parks.js';
import { isEmbedded, openDialog } from './embed.js';

const $ = (selector) => document.querySelector(selector);
const format = new Intl.NumberFormat('en-IN');
const aliases = {
  'Azadirachta Indica A. Juss.': 'Neem',
  'Mangifera Indica L.': 'Mango',
  'Pongamia Pinnata (L.) Pierre': 'Honge · Indian beech',
  'Delonix Regia (Bojer Ex Hook.) Raf.': 'Gulmohar',
  'Ficus Benghalensis L.': 'Banyan',
  'Ficus Religiosa L.': 'Peepal',
  'Syzygium Cumini (L.) Skeels': 'Jamun',
  'Cocos Nucifera L.': 'Coconut',
  'Samanea Saman (Jacq.) Merr.': 'Rain tree',
  'Tabebuia Rosea (Bertol) Dc.': 'Pink trumpet tree',
  'Swietenia Mahagoni (L.) Jacq.': 'West Indian mahogany',
};
const commonName = (species) => aliases[species] || (species === 'Others' ? 'Unidentified species' : species);
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const initialCenter = [12.9783, 77.6395]; // Keep Indiranagar Metro visible in the opening view.
const defaultZoom = () => matchMedia('(max-width: 680px)').matches ? 16 : 17;
const map = L.map('map', {
  zoomControl: false, preferCanvas: true, minZoom: 10, maxZoom: 20,
  ...(isEmbedded ? { dragging: !matchMedia('(pointer: coarse)').matches } : {}),
}).setView(initialCenter, defaultZoom());
if (isEmbedded) {
  const container = map.getContainer();
  container.addEventListener('wheel', (event) => {
    // Skip Leaflet's wheel zoom, but keep native article scrolling. Trackpad pinch
    // arrives as Ctrl+wheel; let Leaflet handle it without resetting its debounce.
    if (!event.ctrlKey && !event.metaKey) event.stopImmediatePropagation();
  }, { capture: true, passive: true });
  let touches = 0;
  let gesture;
  for (const type of ['touchstart', 'touchend', 'touchcancel']) {
    container.addEventListener(type, (event) => { touches = event.touches.length; }, { capture: true, passive: true });
  }
  // Safari trackpads also expose GestureEvent. Leave touchscreen pinches to
  // Leaflet's native TouchZoom rather than processing the same gesture twice.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    container.addEventListener(type, (event) => {
      if (touches) { gesture = null; return; }
      if (type === 'gesturestart') gesture = { zoom: map.getZoom(), point: map.mouseEventToContainerPoint(event) };
      if (!gesture) return;
      event.preventDefault();
      if (type === 'gesturechange') {
        const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), Math.round(map.getScaleZoom(event.scale, gesture.zoom))));
        map.setZoomAround(gesture.point, zoom, { animate: false });
      }
      if (type === 'gestureend') gesture = null;
    }, { passive: false });
  }
}
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ position: 'bottomright', imperial: false }).addTo(map);
setWorkerUrl(workerUrl);
try {
  // Probe WebGL2 before Leaflet attaches the adapter's zoom listeners.
  const gl = document.createElement('canvas').getContext('webgl2', {
    alpha: true, depth: true, stencil: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is unavailable');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const tiles = maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty' }).addTo(map);
  const basemap = tiles.getMaplibreMap();
  basemap.on('error', () => { $('#tile-notice').hidden = false; });
  basemap.on('idle', () => { $('#tile-notice').hidden = basemap.areTilesLoaded(); });
  basemap.on('style.load', () => {
    // Keep the coloured terrain and roads, but replace general POIs with navigation landmarks.
    for (const layer of basemap.getStyle().layers) {
      if (layer['source-layer'] === 'poi') basemap.setLayoutProperty(layer.id, 'visibility', 'none');
    }
    basemap.addLayer({
      id: 'navigation-landmarks', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 12,
      filter: ['all', ['has', 'name'], ['<=', ['get', 'rank'], 25], ['any',
        ['match', ['get', 'class'], ['park', 'museum', 'castle', 'stadium', 'railway'], true, false],
        ['all', ['==', ['get', 'subclass'], 'government'], ['<=', ['get', 'rank'], 10]],
      ]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-max-width': 10, 'text-padding': 12,
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': '#596458', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
    });
  });
} catch {
  // A browser without WebGL can still search and select census points.
  $('#tile-notice').hidden = false;
}
const points = L.layerGroup().addTo(map);
let selectedMarker;
let selectedTreeId = null;
let locationMarker;
let locationCircle;
let catalog = [];
let selectedSpecies = '';
let near = null;
let controller;
let timer;
let locationVersion = 0;
let placeController;
let placeTimer;

function clearLocation() {
  near = null;
  locationVersion += 1;
  $('#near').disabled = false;
  if (locationMarker) map.removeLayer(locationMarker);
  if (locationCircle) map.removeLayer(locationCircle);
}

function hidePlaceSuggestions() {
  clearTimeout(placeTimer);
  placeController?.abort();
  $('#place-suggestions').hidden = true;
  $('#place').setAttribute('aria-expanded', 'false');
}

function suggestPlaces() {
  hideSuggestions();
  hidePlaceSuggestions();
  const text = $('#place').value.trim();
  if (text.length < 3) return;
  const list = $('#place-suggestions');
  list.innerHTML = '<p role="status">Searching Bengaluru…</p>';
  list.hidden = false;
  $('#place').setAttribute('aria-expanded', 'true');
  const active = new AbortController();
  placeController = active;
  placeTimer = setTimeout(async () => {
    try {
      const matches = await searchPlaces(text, AbortSignal.any([active.signal, AbortSignal.timeout(8000)]));
      if (active.signal.aborted) return;
      list.replaceChildren();
      for (const place of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'suggestion';
        button.innerHTML = `<span><strong>${escape(place.name)}</strong><small>${escape(place.context)}</small></span><span aria-hidden="true">↗</span>`;
        button.onclick = () => {
          clearLocation();
          $('#place').value = place.name;
          $('#place').focus();
          hidePlaceSuggestions();
          if (matchMedia('(pointer: coarse)').matches) $('#place').blur();
          const label = document.createElement('span');
          label.textContent = place.name;
          locationMarker = L.circleMarker([place.lat, place.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#4a5f8a', fillOpacity: 1 }).bindTooltip(label).addTo(map);
          map.setView([place.lat, place.lng], 16);
          notice(`Exploring ${place.name}. Census coverage may be incomplete.`);
          scheduleLoad();
        };
        list.append(button);
      }
      if (!matches.length) list.innerHTML = '<p role="status">No Bengaluru locations found. Try a park, area or landmark.</p>';
    } catch (error) {
      if (active.signal.aborted) return;
      list.innerHTML = '<p role="status">Place search is unavailable. Try typing again, or explore the map.</p>';
    }
  }, 500);
}

$('#place').addEventListener('input', suggestPlaces);
$('#place').addEventListener('focus', suggestPlaces);
$('#place').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hidePlaceSuggestions();
  if (event.key === 'ArrowDown' || event.key === 'Enter') {
    if (!$('#place-suggestions').hidden) {
      event.preventDefault();
      const first = $('#place-suggestions button');
      if (event.key === 'Enter') first?.click();
      else first?.focus();
    }
  }
});
$('#place-suggestions').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    $('#place').focus();
    hidePlaceSuggestions();
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const items = [...$('#place-suggestions').querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
$('.place-search').addEventListener('focusout', (event) => {
  if (!event.currentTarget.contains(event.relatedTarget)) hidePlaceSuggestions();
});

function notice(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}

async function request(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Census request failed');
  return response.json();
}

function closeDetail() {
  $('#detail').hidden = true;
  closeSpeciesPhotos();
  selectedTreeId = null;
  if (selectedMarker) map.removeLayer(selectedMarker);
  document.querySelectorAll('.tree-row').forEach((row) => row.classList.remove('selected'));
}

function selectTree(tree) {
  closeDetail();
  selectedTreeId = tree.id;
  selectedMarker = L.circleMarker([tree.lat, tree.lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#cd6b3a', fillOpacity: 1, interactive: false }).addTo(map);
  const detail = $('#detail');
  detail.innerHTML = `<button class="close-detail" aria-label="Close tree details">×</button><h2>${escape(commonName(tree.species))}</h2><p class="botanical">${escape(tree.species === 'Others' ? 'Species not identified in the census' : tree.species)}</p><div class="detail-meta"><span>WARD <strong>${escape(tree.ward)}</strong></span><span>${near ? 'FROM YOU' : 'FROM MAP CENTRE'} <strong>${format.format(Math.round(tree.meters))} m</strong></span></div><p class="tree-id">TREE ID <span>${escape(tree.tree_id)}</span></p><a class="directions" href="https://www.google.com/maps/dir/?api=1&destination=${tree.lat},${tree.lng}&travelmode=walking" target="_blank" rel="noreferrer">Walk to this tree <span>↗</span></a><p class="detail-footnote">Census location · July 2026. GPS may vary.</p>`;
  attachSpeciesPhotos(detail, tree.species, commonName(tree.species));
  detail.hidden = false;
  detail.querySelector('.close-detail').onclick = closeDetail;
  document.querySelector(`[data-id="${tree.id}"]`)?.classList.add('selected');
  if (matchMedia('(pointer: coarse)').matches) detail.scrollIntoView({ block: 'nearest' });
}

async function loadTrees({ locateSpecies = false } = {}) {
  clearTimeout(timer);
  controller?.abort();
  const active = new AbortController();
  controller = active;
  $('#summary').textContent = 'Finding the trees…';
  const bounds = map.getBounds();
  const params = new URLSearchParams({ bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',') });
  if (selectedSpecies) params.set('species', selectedSpecies);
  if (locateSpecies) params.set('locate', '1');
  if (near) params.set('near', `${near.lat},${near.lng}`);
  try {
    const result = await request(`/api/trees?${params}`, active.signal);
    if (active.signal.aborted) return;
    if (result.species_bounds) {
      clearLocation();
      $('#place').value = '';
      notice('');
      map.fitBounds(result.species_bounds, { padding: [30, 30], maxZoom: 17, animate: false });
      scheduleLoad();
      return;
    }
    // Resizing the map behind a modal must not dismiss the photo being viewed.
    if (!$('#photo-dialog').open) closeDetail();
    points.clearLayers();
    const currentTrees = result.trees;
    const touchTargets = matchMedia('(pointer: coarse)').matches;
    const selectNearestTree = (event) => {
      // Use the actual tap: Leaflet snaps small-marker event coordinates to their centre.
      const tap = map.mouseEventToContainerPoint(event.originalEvent);
      let nearest;
      let distance = 24;
      for (const tree of currentTrees) {
        const candidateDistance = map.latLngToContainerPoint([tree.lat, tree.lng]).distanceTo(tap);
        if (candidateDistance <= distance) {
          nearest = tree;
          distance = candidateDistance;
        }
      }
      if (nearest) selectTree(nearest);
    };
    for (const tree of currentTrees) {
      if (touchTargets) {
        // Invisible hit areas share the existing canvas; park controls retain their own hit testing.
        const target = L.circleMarker([tree.lat, tree.lng], { radius: 24, stroke: false, fillOpacity: 0 });
        target.on('click', selectNearestTree);
        points.addLayer(target);
      }
      const marker = L.circleMarker([tree.lat, tree.lng], { radius: 4, color: '#fff', weight: 1, fillColor: '#376d47', fillOpacity: 0.85, interactive: !touchTargets });
      if (!touchTargets) marker.on('click', () => selectTree(tree));
      points.addLayer(marker);
    }
    $('#results-title').textContent = near ? 'BBMP · within 500 m' : 'BBMP records in this map';
    const noun = selectedSpecies ? 'matching trees' : 'recorded trees';
    $('#summary').textContent = result.total > result.limit
      ? `${format.format(result.total)} ${noun} · nearest ${format.format(result.limit)} shown. Zoom in for all points.`
      : `${format.format(result.total)} ${noun} · tap to explore`;
    $('#tree-list').replaceChildren();
    for (const [i, tree] of currentTrees.slice(0, 12).entries()) {
      const row = document.createElement('button');
      row.className = 'tree-row';
      row.classList.toggle('selected', tree.id === selectedTreeId);
      row.dataset.id = tree.id;
      row.innerHTML = `<span class="row-number">${String(i + 1).padStart(2, '0')}</span><span class="row-text"><strong>${escape(commonName(tree.species))}</strong><small>${escape(tree.species === 'Others' ? 'Not identified in census' : tree.species)}</small></span><span class="row-arrow" aria-hidden="true">↗</span>`;
      row.onclick = () => selectTree(tree);
      $('#tree-list').append(row);
    }
    if (!result.total) {
      $('#tree-list').innerHTML = '<div class="empty-state"><span aria-hidden="true">↟</span><h3>No recorded trees here.</h3><p>Try another species or move the map. An empty result doesn’t mean there are no trees.</p></div>';
    } else {
      const note = document.createElement('p');
      note.className = 'list-note';
      note.textContent = `Closest ${Math.min(12, result.total)} to ${near ? 'your location' : 'the map centre'} listed. More on the map.`;
      $('#tree-list').append(note);
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
    points.clearLayers();
    if (!$('#photo-dialog').open) closeDetail();
    $('#summary').textContent = 'Couldn’t load census data.';
    $('#tree-list').innerHTML = '<div class="empty-state"><h3>A small interruption.</h3><p>Check your connection, then try again.</p><button id="retry">Try again ↗</button></div>';
    $('#retry').onclick = loadTrees;
  }
}

function scheduleLoad() {
  clearTimeout(timer);
  controller?.abort();
  timer = setTimeout(loadTrees, 160);
}
new ResizeObserver(() => map.invalidateSize()).observe($('#map'));
map.on('moveend', scheduleLoad);
map.on('dragstart', () => {
  if (near) {
    near = null;
    notice('Exploring the map. Tap Near me to return to your 500 m area.');
  }
});

function hideSuggestions() {
  $('#suggestions').hidden = true;
  $('#species').setAttribute('aria-expanded', 'false');
}
function showSuggestions() {
  hidePlaceSuggestions();
  const input = $('#species').value.trim().toLowerCase();
  const matches = catalog.filter((s) => `${s.name} ${aliases[s.name] || ''}`.toLowerCase().includes(input));
  const list = $('#suggestions');
  list.replaceChildren();
  for (const species of matches.slice(0, 30)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'suggestion';
    button.innerHTML = `<span><strong>${escape(commonName(species.name))}</strong><small>${escape(species.name)}</small></span><span>${format.format(species.count)}</span>`;
    button.onclick = () => {
      selectedSpecies = species.name;
      $('#species').value = commonName(species.name);
      $('#clear').hidden = false;
      hideSuggestions();
      $('#species').focus();
      // Focus can open the suggestions again; keep the selected value closed.
      hideSuggestions();
      if (matchMedia('(pointer: coarse)').matches) $('#species').blur();
      loadTrees({ locateSpecies: true });
    };
    list.append(button);
  }
  if (!matches.length) {
    const message = document.createElement('p');
    message.textContent = 'No species found. Try a botanical name.';
    list.append(message);
  }
  list.hidden = false;
  $('#species').setAttribute('aria-expanded', 'true');
}
$('#species').addEventListener('focus', showSuggestions);
$('#species').addEventListener('input', () => {
  $('#clear').hidden = !$('#species').value;
  if (selectedSpecies) {
    selectedSpecies = '';
    scheduleLoad();
  }
  showSuggestions();
});
$('#species').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') hideSuggestions();
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if ($('#suggestions').hidden) showSuggestions();
    $('#suggestions button')?.focus();
  }
  if (event.key === 'Enter' && !$('#suggestions').hidden) {
    event.preventDefault();
    $('#suggestions button')?.click();
  }
});
$('#suggestions').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { hideSuggestions(); $('#species').focus(); hideSuggestions(); }
  const items = [...$('#suggestions').querySelectorAll('button')];
  const index = items.indexOf(document.activeElement);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.map-section, #photo-dialog')) closeDetail();
  if (!event.target.closest('.species-search')) hideSuggestions();
  if (!event.target.closest('.place-search')) hidePlaceSuggestions();
}, true); // Dismiss the old detail before a clicked tree row opens the new one.
$('#clear').onclick = () => {
  selectedSpecies = '';
  $('#species').value = '';
  $('#clear').hidden = true;
  hideSuggestions();
  loadTrees();
};

$('#near').onclick = () => {
  closeDetail();
  hideSuggestions();
  hidePlaceSuggestions();
  if (!navigator.geolocation) {
    notice('Location is not available in this browser. You can still explore the map.');
    return;
  }
  $('#near').disabled = true;
  const version = ++locationVersion;
  notice('Finding your location…');
  navigator.geolocation.getCurrentPosition((position) => {
    if (version !== locationVersion) return;
    $('#near').disabled = false;
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    const [west, south, east, north] = BENGALURU_BOUNDS;
    if (lat < south || lat > north || lng < west || lng > east) {
      notice('You seem to be outside Bengaluru. Explore the map instead, or try again when you’re in the city.');
      return;
    }
    clearLocation();
    $('#place').value = '';
    near = { lat, lng };
    locationMarker = L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#3e72bc', fillOpacity: 1 }).addTo(map);
    locationCircle = L.circle([lat, lng], { radius: 500, color: '#3e72bc', weight: 1, fillOpacity: 0.035, dashArray: '5 6', interactive: false }).addTo(map);
    map.fitBounds(locationCircle.getBounds(), { padding: [25, 25], animate: false });
    notice(`Trees within 500 m. Location accuracy: about ${Math.round(accuracy)} m.${accuracy > 100 ? ' Your location is approximate.' : ''}`);
    scheduleLoad();
  }, (error) => {
    if (version !== locationVersion) return;
    $('#near').disabled = false;
    notice(error.code === 1 ? 'Location permission was denied. Allow location in your browser settings, or explore the map.' : 'Couldn’t find your location. Check your GPS and try again, or explore the map.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
};
$('#reset').onclick = () => {
  clearLocation();
  $('#place').value = '';
  hidePlaceSuggestions();
  notice('');
  map.setView(initialCenter, defaultZoom());
  scheduleLoad();
};
$('#about').onclick = () => openDialog($('#about-dialog'));
$('.method-link').onclick = (event) => {
  event.preventDefault();
  openDialog($('#about-dialog'));
};
$('#close-about').onclick = () => $('#about-dialog').close();
$('#about-dialog').addEventListener('click', (event) => {
  if (event.target === $('#about-dialog')) {
    const rect = event.target.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
  }
});

async function loadCatalog() {
  try {
    const { species, metadata } = await request('/api/catalog');
    catalog = species;
    $('#source').href = metadata.source;
    $('#data-note').textContent = `${format.format(metadata.count)} records are searchable.`;
  } catch {
    notice('Species list couldn’t load. Check your connection and reload the page; you can still try the map.');
  }
}
attachParks(map, () => {
  clearLocation();
  closeDetail();
  hidePlaceSuggestions();
  hideSuggestions();
  $('#place').value = '';
  notice('');
});
loadCatalog();
loadTrees();
