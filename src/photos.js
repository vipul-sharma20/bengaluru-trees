import catalog from './species-photos.json';

const dialog = document.querySelector('#photo-dialog');
const frame = dialog.querySelector('.photo-frame');
const dots = dialog.querySelector('.photo-dots');
const credit = dialog.querySelector('.photo-credit');
let photos = [];
let index = 0;
let trigger;
let touchStart;

function sourceLink(label, href) {
  const link = document.createElement('a');
  link.textContent = label;
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  return link;
}

function showPhoto(next) {
  index = (next + photos.length) % photos.length;
  const photo = photos[index];
  const image = document.createElement('img');
  image.alt = photo.alt;
  image.width = photo.width;
  image.height = photo.height;
  image.decoding = 'async';
  image.hidden = true;
  const status = document.createElement('p');
  status.className = 'photo-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading photo…';
  frame.replaceChildren(image, status);
  image.src = photo.src;
  image.decode().then(() => {
    image.hidden = false;
    status.hidden = true;
  }, () => { status.textContent = 'This photo couldn’t load. Try another, or open its source below.'; });
  dialog.querySelector('.photo-position').textContent = `Photo ${index + 1} of ${photos.length}`;
  dots.querySelectorAll('button').forEach((dot, n) => {
    if (n === index) dot.setAttribute('aria-current', 'true');
    else dot.removeAttribute('aria-current');
  });
  credit.open = matchMedia('(min-width: 681px) and (pointer: fine)').matches;
  const summary = document.createElement('summary');
  summary.textContent = `Photo: ${photo.creator} · ${photo.license}`;
  const attribution = document.createElement('dl');
  attribution.className = 'photo-attribution';
  const source = document.createElement('span');
  const title = document.createElement('span');
  title.className = 'photo-source-title';
  title.textContent = photo.title.replace(/^File:/, '');
  source.append(sourceLink('Original photo ↗', photo.sourcePage), title);
  for (const [label, value] of [
    ['Photographer', photo.creator],
    ['Source', source],
    ['License', sourceLink(photo.license, photo.licenseUrl)],
    ['Reference', photo.referenceNotice],
  ]) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.append(value);
    attribution.append(term, description);
  }

  const provenance = document.createElement('details');
  provenance.className = 'photo-provenance';
  const provenanceSummary = document.createElement('summary');
  provenanceSummary.textContent = 'Full attribution';
  const record = document.createElement('div');
  record.className = 'photo-record';
  const history = photo.attribution?.includes(photo.priorChanges) ? '' : photo.priorChanges;
  for (const value of [photo.attribution, history]) {
    if (!value) continue;
    const description = document.createElement('p');
    description.textContent = value;
    record.append(description);
  }
  provenance.append(provenanceSummary, record);
  credit.replaceChildren(summary, attribution, provenance);
}

function openPhotos(entry, button, name) {
  photos = entry.photos;
  trigger = button;
  dialog.querySelector('h2').textContent = name;
  dialog.querySelector('#photo-reference').textContent = entry.referenceNotice || 'Species reference · not this individual tree';
  dots.replaceChildren();
  photos.forEach((photo, n) => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Show photo ${n + 1} of ${photos.length}`);
    dot.innerHTML = '<span aria-hidden="true"></span>';
    dot.onclick = () => showPhoto(n);
    dots.append(dot);
  });
  dialog.querySelectorAll('.photo-arrow').forEach((arrow) => { arrow.hidden = photos.length < 2; });
  dots.hidden = photos.length < 2;
  showPhoto(0);
  dialog.showModal();
}

export function attachSpeciesPhotos(detail, species, name) {
  const entry = catalog[species];
  if (!entry?.photos.length) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'photo-entry';
  button.setAttribute('aria-label', `View ${entry.photos.length} reference photos of ${name}`);
  const thumbnail = document.createElement('img');
  thumbnail.src = entry.photos[0].thumbnail;
  thumbnail.alt = '';
  thumbnail.width = 64;
  thumbnail.height = 48;
  thumbnail.loading = 'lazy';
  thumbnail.onerror = () => { thumbnail.hidden = true; };
  const label = document.createElement('span');
  label.textContent = 'Species photos';
  const count = document.createElement('span');
  count.className = 'photo-entry-count';
  count.textContent = `${entry.photos.length} ↗`;
  button.append(thumbnail, label, count);
  button.onclick = () => openPhotos(entry, button, name);
  detail.querySelector('.detail-meta').before(button);
}

export function closeSpeciesPhotos() {
  if (dialog.open) dialog.close();
}

dialog.querySelector('.close-photos').onclick = closeSpeciesPhotos;
dialog.querySelector('.photo-prev').onclick = () => showPhoto(index - 1);
dialog.querySelector('.photo-next').onclick = () => showPhoto(index + 1);
dialog.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    showPhoto(index + (event.key === 'ArrowRight' ? 1 : -1));
  }
});
frame.addEventListener('pointerdown', (event) => {
  if (event.pointerType === 'touch') touchStart = { x: event.clientX, y: event.clientY };
});
frame.addEventListener('pointerup', (event) => {
  if (!touchStart) return;
  const dx = event.clientX - touchStart.x;
  const dy = event.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) showPhoto(index + (dx < 0 ? 1 : -1));
});
frame.addEventListener('pointercancel', () => { touchStart = null; });
dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSpeciesPhotos();
});
dialog.addEventListener('close', () => {
  frame.replaceChildren();
  touchStart = null;
  if (trigger?.isConnected && !trigger.closest('[hidden]')) trigger.focus({ preventScroll: true });
});
