import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const catalog = JSON.parse(readFileSync(new URL('../src/species-photos.json', import.meta.url)));

test('every reference photo has a hosted image and reusable, image-level provenance', () => {
  const licenses = new Map([
    ['CC0 1.0', '/publicdomain/zero/1.0/'],
    ['CC BY 2.0', '/licenses/by/2.0/'],
    ['CC BY 3.0', '/licenses/by/3.0/'],
    ['CC BY 4.0', '/licenses/by/4.0/'],
    ['CC BY-SA 2.0', '/licenses/by-sa/2.0/'],
    ['CC BY-SA 3.0', '/licenses/by-sa/3.0/'],
    ['CC BY-SA 4.0', '/licenses/by-sa/4.0/'],
  ]);
  assert.ok(Object.keys(catalog).length > 0, 'The library must not be accidentally emptied');
  assert.equal(catalog.Others, undefined, 'Unidentified records must not imply an identification');
  for (const [label, entry] of Object.entries(catalog)) {
    assert.ok(entry.taxonName && entry.taxonId && entry.photos.length, label);
    assert.equal(new Set(entry.photos.map(photo => photo.src)).size, entry.photos.length, 'No duplicate carousel slides');
    for (const photo of entry.photos) {
      for (const field of ['title', 'creator', 'alt', 'retrievedAt', 'changes', 'priorChanges', 'referenceNotice']) {
        assert.equal(typeof photo[field], 'string', `${label}: ${field}`);
        assert.ok(photo[field].trim(), `${label}: empty ${field}`);
      }
      const sourcePage = new URL(photo.sourcePage);
      if (sourcePage.hostname === 'commons.wikimedia.org') {
        assert.match(photo.sourceSha1, /^[a-f0-9]{40}$/, `${label}: source revision hash`);
        assert.ok(Number.isFinite(Date.parse(photo.revisionTimestamp)), `${label}: source revision timestamp`);
      } else {
        // Non-Commons providers have pinned metadata snapshots, not upload histories.
        assert.match(photo.originalSha256, /^[a-f0-9]{64}$/, `${label}: archived original hash`);
        assert.match(photo.sourceSnapshot.sha256, /^[a-f0-9]{64}$/, `${label}: archived source snapshot hash`);
        assert.ok(photo.sourceSnapshot.historyCompleteness, `${label}: source history limitation`);
        if (sourcePage.hostname === 'specimens.kew.org') {
          assert.equal(photo.sourceKind, 'kew');
          assert.match(sourcePage.pathname, /^\/Herbarium\/K\d+$/);
          const snapshot = new URL(photo.sourceSnapshot.sourceUrl);
          assert.equal(snapshot.origin, 'https://api.gbif.org');
          assert.match(snapshot.pathname, /^\/v1\/occurrence\/\d+\/verbatim$/);
          assert.ok(Number.isFinite(Date.parse(photo.retrievedAt)), `${label}: retrieval timestamp`);
          assert.match(photo.referenceNotice, /herbarium/i, `${label}: disclose preserved specimen`);
        } else {
          assert.equal(sourcePage.hostname, 'www.inaturalist.org');
          assert.equal(new URL(photo.sourceSnapshot.sourceUrl).hostname, 'api.inaturalist.org');
          assert.ok(Number.isFinite(Date.parse(photo.sourceSnapshot.snapshotArchivedAt)), `${label}: snapshot timestamp`);
        }
      }
      assert.ok(photo.width > 0 && photo.height > 0, 'Reserve the image aspect ratio');
      for (const field of ['src', 'thumbnail']) {
        const url = new URL(photo[field]);
        assert.equal(url.protocol, 'https:');
        assert.equal(url.hostname, 'images.vipul.xyz');
        assert.ok(url.pathname.startsWith('/trees/'));
      }
      assert.notEqual(photo.src, photo.thumbnail, 'Do not load full images for thumbnail previews');
      // Kew's original specimen permalink is HTTP; hosted images and originals remain HTTPS.
      assert.ok(sourcePage.protocol === 'https:' || (sourcePage.hostname === 'specimens.kew.org' && sourcePage.protocol === 'http:'));
      assert.equal(new URL(photo.originalUrl).protocol, 'https:');
      assert.ok(licenses.has(photo.license), `Review license before adding it: ${photo.license}`);
      const license = new URL(photo.licenseUrl);
      assert.equal(license.protocol, 'https:');
      assert.equal(license.hostname, 'creativecommons.org');
      // Commons also supplies the same license's English deed or slashless URL.
      assert.equal(license.pathname.replace(/(?:\/deed\.en)?\/?$/, '/'), licenses.get(photo.license));
    }
  }
});

test('photo coverage agrees with the galleries available for each exact census label', () => {
  const coverage = JSON.parse(readFileSync(new URL('../photo-coverage.json', import.meta.url)));
  const labels = new Set(coverage.labels.map(entry => entry.censusLabel));
  assert.equal(labels.size, coverage.labels.length, 'Each census label has one coverage record');
  for (const label of Object.keys(catalog)) assert.ok(labels.has(label), `Untracked gallery: ${label}`);
  for (const entry of coverage.labels) {
    const gallery = catalog[entry.censusLabel];
    assert.equal(entry.status === 'covered', Boolean(gallery), entry.censusLabel);
    assert.equal(entry.photoCount || 0, gallery?.photos.length || 0, entry.censusLabel);
    if (gallery) {
      assert.equal(entry.taxonName, gallery.taxonName, entry.censusLabel);
      assert.equal(entry.taxonId, gallery.taxonId, entry.censusLabel);
      if (entry.identityMapping?.acceptedRank === 'GENUS') {
        assert.match(gallery.referenceNotice, /Genus examples.*census species not recorded/, `${entry.censusLabel}: disclose genus-only scope before the photos`);
      }
    }
  }
});
