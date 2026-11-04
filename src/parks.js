import L from 'leaflet';
import boundaries from './park-boundaries.json';
import inventory from './cubbon-inventory.json';
import { openDialog } from './embed.js';

const format = new Intl.NumberFormat('en-IN');
const reportLink = (page, label) => `<a href="${inventory.source}#page=${page}" target="_blank" rel="noreferrer">${label} ↗</a>`;

// These are park summaries, never synthetic trees or additions to BBMP results.
export function attachParks(map, onNavigate) {
  const dialog = document.createElement('dialog');
  dialog.className = 'park-dialog';
  dialog.setAttribute('aria-labelledby', 'park-title');
  document.body.append(dialog);

  function showPark(feature) {
    const cubbon = feature.properties.id === 'cubbon';
    dialog.innerHTML = `<button class="close-park" aria-label="Close park information" autofocus>×</button>
      <p class="park-eyebrow">${cubbon ? 'Separate park inventory · 2022' : 'Park census coverage'}</p>
      <h2 id="park-title">${cubbon ? 'Cubbon Park' : 'Lalbagh Botanical Gardens'}</h2>
      ${cubbon ? `<p class="park-subtitle">Sri Chamarajendra Park</p>
        <div class="park-stats"><div><strong>${format.format(inventory.trees)}</strong><span>trees reported</span></div><div><strong>${inventory.species}</strong><span>species reported</span></div><div><strong>${inventory.zones.length}</strong><span>survey zones</span></div></div>
        <p class="park-coverage">A separate 2022 inventory documents the park’s trees. Their individual coordinates aren’t available in this app; sparse BBMP dots do not mean a treeless park.</p>
        <p class="park-filter-note">Historical whole-park figures, not filtered by species or Near me. Not added to BBMP counts.</p>
        <section class="park-zones" aria-label="Survey zones">
          <label for="park-zone">Explore the 19 survey zones</label>
          <select id="park-zone">${inventory.zones.map(zone => `<option value="${zone.number}">Zone ${zone.number} · ${format.format(zone.trees)} trees</option>`).join('')}</select>
          <div id="park-zone-detail" aria-live="polite"></div>
          <p class="park-small">Locations follow the report’s landmarks. Zone boundaries are not plotted; open the report to see its zone maps.</p>
        </section>
        <details class="park-more"><summary>Whole-park species highlights</summary>
          <p class="park-small">Five leading species listed in the report. Names retained as published.</p>
          <ul class="park-species-counts">${inventory.dominantSpecies.map(species => `<li><span>${species.name}</span><strong>${format.format(species.count)}</strong></li>`).join('')}</ul>
          ${reportLink(inventory.dominantSpeciesPage, 'See species counts · PDF p. 304')}
        </details>
        <details class="park-more"><summary>Source & counting limitations</summary>
          <p>${inventory.title}. Submitted by ${inventory.author}, 31 May 2022. This is a historical inventory, not a current tree count or canopy-cover measurement.</p>
          <p>${inventory.countNote}</p>
          <ul>${inventory.separateAreas.map(area => `<li>${reportLink(area.page, `${area.name} · ${area.trees} reported`)}</li>`).join('')}</ul>
          <p>Species highlights are not complete species lists. Absence from a highlight does not establish absence from the park.</p>
        </details>
        <p class="park-source">${reportLink(inventory.summaryPage, 'Read the 2022 inventory · PDF p. 302')}</p>`
      : `<p class="park-coverage">Individual-tree coverage is incomplete in this dataset. A sparse map is not a measure of Lalbagh’s trees or canopy cover.</p>
        <p>We haven’t verified a separate tree inventory for Lalbagh to display here, so no park-wide tree count is shown.</p>
        <p class="park-filter-note">Any BBMP points shown remain individually selectable. This park outline is context, not a tree-density estimate or a species-search result.</p>`}
      <p class="park-boundary-note">Outline: <a href="${feature.properties.source}" target="_blank" rel="noreferrer">OpenStreetMap contributors ↗</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">ODbL</a>. A mapped park boundary, not a verified survey extent.</p>`;
    dialog.querySelector('.close-park').onclick = () => dialog.close();
    if (cubbon) {
      const select = dialog.querySelector('#park-zone');
      const showZone = () => {
        const zone = inventory.zones.find(zone => zone.number === Number(select.value));
        dialog.querySelector('#park-zone-detail').innerHTML = `<h3>Zone ${zone.number} <span>${format.format(zone.trees)} trees reported</span></h3>
          <p>${zone.location}</p>
          <h4>Dominant species reported</h4>
          <ul class="park-species">${zone.dominantSpecies.map(name => `<li>${name}</li>`).join('')}</ul>
          ${reportLink(zone.page, `View zone map & analysis · PDF p. ${zone.page}`)}`;
      };
      select.onchange = showZone;
      showZone();
    }
    openDialog(dialog);
    dialog.scrollTop = 0;
  }

  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });

  // Draw first on the shared canvas so later tree points receive clicks above fills.
  const labels = L.layerGroup();
  const shortcuts = document.querySelector('#park-shortcuts');
  const help = document.querySelector('#park-help');
  document.addEventListener('click', event => {
    if (!help.contains(event.target)) help.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && help.open) {
      help.open = false;
      help.querySelector('summary').focus();
    }
  });
  for (const feature of boundaries.features) {
    const cubbon = feature.properties.id === 'cubbon';
    const name = cubbon ? 'Cubbon Park' : 'Lalbagh';
    const outline = L.geoJSON(feature, {
      style: { color: '#4a5f8a', weight: 2, dashArray: '5 5', fillColor: '#4a5f8a', fillOpacity: 0.1 },
    }).addTo(map);
    outline.on('click', () => showPark(feature));
    const label = L.marker(outline.getBounds().getCenter(), {
      keyboard: false,
      icon: L.divIcon({ className: 'park-marker', iconSize: [148, 40], iconAnchor: [74, 20],
        html: `<button class="park-map-label" aria-label="Explore ${name} ${cubbon ? '2022 inventory' : 'census coverage'}"><strong>${name} ↗</strong><span>${cubbon ? `${format.format(inventory.trees)} trees · 2022 report` : 'Census coverage incomplete'}</span></button>` }),
    });
    label.on('add', () => {
      const button = label.getElement().querySelector('button');
      L.DomEvent.disableClickPropagation(button);
      button.onclick = () => showPark(feature);
    });
    labels.addLayer(label);
    const shortcut = document.createElement('button');
    shortcut.type = 'button';
    shortcut.textContent = `${name} ↗`;
    shortcut.setAttribute('aria-label', `Explore ${name}`);
    shortcut.onclick = () => {
      onNavigate();
      map.fitBounds(outline.getBounds(), { padding: [35, 35], maxZoom: 16, animate: false });
      showPark(feature);
    };
    shortcuts.insertBefore(shortcut, help);
  }
  const updateLabels = () => {
    if (map.getZoom() >= 13) labels.addTo(map);
    else map.removeLayer(labels);
    if (!map.hasLayer(labels)) return;
    labels.eachLayer(label => {
      const element = label.getElement();
      element.hidden = !map.getBounds().contains(label.getLatLng());
      const width = label.options.icon.options.iconSize[0];
      const left = map.latLngToContainerPoint(label.getLatLng()).x - width / 2;
      const offset = Math.max(8, Math.min(map.getSize().x - width - 8, left)) - left;
      element.querySelector('button').style.transform = `translateX(${offset}px)`;
    });
  };
  map.on('zoomend moveend resize', updateLabels);
  updateLabels();
}
