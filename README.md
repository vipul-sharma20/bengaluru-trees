# Bengaluru Trees

Source code for **[trees.vipul.xyz](https://trees.vipul.xyz)**, a map-based explorer
for Bengaluru's July 2026 BBMP tree census. Search by species or place, inspect
individual census records, and optionally find trees within 500 metres of your
location. Park summaries and curated species-reference photos provide context
where the census is incomplete.

The separate `/analytics` page is a visual exploration: a species canopy
with circle areas proportional to record counts,
and linked area map and scatter plot using historical boundaries. Hover or use arrow keys for
reference-photo previews; click or tap a preview for the existing credited
photo gallery. The species chart defaults to all areas; use its Area dropdown
to filter it explicitly. Map and area-scatter selections do not change that filter. The
plots aggregate the full imported census, not the map's display limit. Record
counts describe survey coverage, not canopy cover or greenness.
The area map supports drag-to-pan, zoom buttons and reset. In an analytics
embed, use Ctrl/⌘ + scroll or two fingers to zoom; ordinary scrolling moves
the article instead.

### Article embeds

Use `/?embed=1` for the map or `/analytics?embed=1` for analytics. Both hide the
site navigation and footer while retaining controls, tree details, data sources,
map attribution and chart methodology. Standalone pages are unchanged. Give the
map iframe an explicit height (1000px gives the tree list more room): it does not
auto-resize. The map workspace fits the frame; only its tree list scrolls.
Outer scrollbar chrome is hidden without clipping content. Analytics still needs
the height-message handler below to show every plot. Ordinary wheel scrolling
moves the article; trackpad pinch, Ctrl/⌘ + scroll or the zoom buttons zoom the map.
On touch devices, one finger scrolls the page; use two fingers to zoom the map.

The analytics embed sends `{type: 'tree-census:resize', height: <positive integer>}`
to its parent on initial load and whenever content size or viewport width changes.
Set the iframe's pixel height from the message. It measures content, not the
iframe viewport, and only sends changed heights to avoid resize feedback loops.
Mark the blog iframe with `data-tree-census-embed="analytics"`. Before applying
a height, validate `event.origin === new URL(iframe.src).origin`,
`event.source === iframe.contentWindow`, the message type and a finite positive
height. No messages are accepted by the app.

The default message target is exactly `https://vipul.xyz`. For an orb or LAN preview,
append `&parentOrigin=` followed by the URL-encoded parent **origin** (scheme,
host and optional port; no path, credentials or trailing slash). HTTPS origins
are accepted, with HTTP allowed only for localhost, `127.0.0.1`, `[::1]`, RFC1918
IPv4 (`10/8`, `172.16/12`, `192.168/16`) and IPv6 unique-local (`fc00::/7`) previews.
For example, use `&parentOrigin=http%3A%2F%2F192.168.1.7%3A3000` for a phone
viewing a local blog server. An invalid override disables messages. This override
changes only the exact destination of public height notifications; it grants no
access or privileged messaging. Public HTTP hosts remain unsupported.

The frontend uses vanilla JavaScript, Vite, Leaflet, MapLibre and D3. A Flask API
queries a local SQLite R-tree index; Gunicorn and WhiteNoise serve the API and
built frontend from the same origin. No accounts or API keys are required.

## Local setup

Requirements:

- Node.js 20.19+ or 22.12+ and npm (Node 22 is used in the Docker build).
- Python 3.10+ with `venv`, SQLite R-tree support and SQLite math functions.
- Linux, including WSL2, for the supplied Gunicorn configuration, which uses
  `/dev/shm`. On macOS or native Windows, use Docker for serving the app.
- Internet access for the initial census download and external map, photo,
  font and place-search services.

From the repository root:

```sh
python -m venv .venv
. .venv/bin/activate
pip install --require-hashes -r requirements.txt
npm ci
npm run data
npm run build
npm start
```

Open `http://localhost:3000`. Set `PORT` to use another port, for example
`PORT=8080 npm start`. Keep the virtual environment activated when running npm
commands that invoke Python or Gunicorn. Geolocation requires HTTPS when the
app is accessed outside localhost.

`npm run data` downloads the pinned OpenCity archive (about 16 MB) and creates
`data/trees.sqlite`. Subsequent runs reuse the downloaded ZIP and rebuild the
database. To import an existing archive instead:

```sh
python import_data.py --archive /path/to/census.zip
```

The archive must have the expected July 2026 census schema. The importer is not
a general-purpose GeoJSON loader. Downloaded data, the generated database,
dependencies and build output are excluded from Git.

## Development and tests

```sh
npm test
npm run build
```

Tests use temporary census fixtures; they do not require the full download or a
running server. They cover the importer, API queries, static serving, place
search, park summaries and photo metadata consistency.

After frontend edits, run `npm run build`, restart `npm start`, and reload the
browser. Restart the server after Python changes or rebuilding the database too:
static files are indexed at startup and the species catalog is cached per worker.
There is no hot-reload or separate frontend dev-server/API proxy setup.

### Where to make changes

| Path | Responsibility |
| --- | --- |
| `src/main.js`, `src/style.css`, `index.html` | Map, search, tree details and page layout |
| `analytics.html`, `src/analytics.js`, `src/analytics.css` | Separate census analytics page |
| `src/analytics-data.js` | Census summaries and complete ward–species grouping for plots |
| `src/ward-boundaries.json` | Unchanged DataMeet historical 198-ward reference geometry and names |
| `vite.config.js` | Builds both map and analytics entry points |
| `src/places.js` | Bengaluru place autocomplete via Photon |
| `src/parks.js`, `src/*inventory.json`, `src/park-boundaries.json` | Park overlays, summaries and source data |
| `src/photos.js`, `src/species-photos.json` | Photo viewer, reference images and attribution |
| `photo-coverage.json` | Photo coverage and curation status; not needed at runtime |
| `import_data.py` | Census download and SQLite index generation |
| `server.py`, `gunicorn.conf.py` | Read-only API, static serving and worker configuration |
| `tests/` | Python unittest and Node test suites |

The API exposes:

- `GET /healthz`: database/catalog and built-entry-point health check.
- `GET /api/catalog`: census metadata and species counts.
- `GET /api/analytics`: census metadata and complete species counts grouped by
  source ward. Cached per worker; replacing the database requires a restart.
- `GET /api/trees?bbox=west,south,east,north`: matching trees in a bounding box.
  Optional `species` matches an exact census label; optional `near=lat,lng`
  additionally restricts results to 500 m of that position. Both filters still
  respect the bounding box. Results are nearest-first, capped at 2,000 records,
  with the full matching `total` and the response `limit` included.

## Docker and hosting

Prepare the database before building the image. The importer uses only Python's
standard library; Docker builds the frontend and installs server dependencies.

```sh
python import_data.py
docker build -t bengaluru-trees .
docker run --rm -p 3000:3000 bengaluru-trees
```

The image includes the database and built assets, runs as a non-root user, and
has a `/healthz` health check. It supports a read-only root filesystem with
Docker's writable `/dev/shm`. Publish it behind an HTTPS reverse proxy for a
public deployment. No particular proxy or hosting provider is required.

Gunicorn runs two workers with two threads each. SQLite connections are
read-only, queries have a five-second execution budget, and API responses use
`Cache-Control: no-store`. Content-hashed static assets are cached immutably;
HTML requires revalidation. Rebuild the image and restart workers when replacing
the database. Size and load-test the deployment for your traffic; the public
third-party services have their own capacity limits.

### External services and fork configuration

- **Maps:** OpenFreeMap tiles rendered with MapLibre; WebGL is needed for the
  basemap. Retain OpenStreetMap/OpenMapTiles attribution.
- **Places:** Photon's public demo API, restricted to Bengaluru results. It has
  no availability guarantee; use a hosted or self-managed instance for heavier
  traffic. The endpoint is in `src/places.js`.
- **Photos:** the committed manifest references WebP images on `images.vipul.xyz`.
  Image binaries and the image-processing pipeline are not included. To serve
  your own copies, update the manifest URLs and preserve each photo's credits,
  license and change notices.
- **Fonts:** Google Fonts, loaded from `src/style.css`.
- **Analytics and branding:** `index.html` includes the live site's Plausible
  snippet and personal-site links. Remove or replace these before deploying a
  fork; they are not required to run the app.

“Near me” sends coordinates to this app's API for the lookup; the app does not
persist them. Gunicorn access logging is disabled. Configure any hosting proxy
to avoid logging location-bearing query strings as well. Photon receives typed
place searches, not device geolocation; map services receive requests for the
viewed area. Google Maps directions open only when requested.

## Data sources and limitations

### BBMP census

The importer pins the [July 2026 OpenCity resource](https://data.opencity.in/dataset/bengaluru-tree-census-data/resource/368572d6-e3dc-4088-acd8-a243c440ebea),
listed by its publisher as “Other (Public Domain)”. Of 702,109 source points,
1,093 records whose `KGISTreeID` contains `loadtesting` are excluded, leaving
701,016 records. Species whitespace is normalized; duplicate tree IDs and other
source records are preserved. `OBJECTID` is the local record key.

This is a survey snapshot, not a complete or current inventory of every tree.
Species and ward names are source labels, not verified taxonomy or current ward
boundaries. “Others” means unidentified. Common-name search aliases do not
change the underlying census labels.

### Historical ward context

Analytics uses DataMeet India community's
[Bangalore Ward Maps 2012](https://github.com/datameet/Municipal_Spatial_Data/blob/9b4d1c2ece54cdeb6f5e8bad9ccad7844f783b17/Bangalore/Readme.md),
not its newer 243-ward file. `src/ward-boundaries.json` is an unchanged copy of
[`BBMP_oldWards.geojson`](https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/9b4d1c2ece54cdeb6f5e8bad9ccad7844f783b17/Bangalore/BBMP_oldWards.geojson)
(SHA-256 `06263e1a1e72fc58844a635c0b95e490962321e8489b476f2379771ce5128633`).
The Bangalore-specific license is
[CC BY-SA 2.5 India](https://creativecommons.org/licenses/by-sa/2.5/in/),
not the repository's default license. Preserve its attribution and share-alike
terms when redistributing or adapting this boundary dataset.

Names join `WARD_NO` to the original census ward tag. All 144 recorded ward
numbers exist in the historical reference. Full-census spatial validation found
673,210 points inside the same-number outline, 20,759 inside another outline,
and 7,047 outside all outlines (96.03% agreement). These are historical names
and reference outlines, not authoritative current or July 2026 survey
boundaries. Disagreement causes are unverified; no census records are reassigned.
Colour uses source-tagged counts, not a spatial recount. The other 54 wards
are marked as having no records in this snapshot, never as having no trees.

### Park context

Cubbon Park and Lalbagh outlines come from OpenStreetMap ways
[22895320](https://www.openstreetmap.org/way/22895320) (version 60) and
[15802464](https://www.openstreetmap.org/way/15802464) (version 33), retrieved on
1 November 2026. Boundary data is © OpenStreetMap contributors, under
[ODbL](https://www.openstreetmap.org/copyright).

Only two census records fall inside the Cubbon outline and none inside Lalbagh.
These are coverage gaps, not estimates of the parks' actual tree populations.
Overlays and summaries do not add synthetic points or change census totals.

Cubbon's summary transcribes counts from the
[2022 Tree Mapping & Inventory Report](https://cubbonpark.in/tree-info/assets/report/Tree_Mapping_Report_Cubbon_Park_compressed.pdf)
by MovingUp Products (FlippAR). It reports 8,866 trees and 196 species. Its zone
and separate-area subtotals sum to 8,856; the app preserves that discrepancy.
PDF links use viewer page numbers, four greater than printed page numbers.
No report images or individual-tree coordinate dataset are included. A separate
Lalbagh inventory has not been verified for display.

### Species photos and licensing

Photos are species references, not images of the individual mapped trees or
verification of census identifications. Coverage is incomplete; unresolved
labels deliberately have no gallery. `photo-coverage.json` records review status
and gaps, while `src/species-photos.json` retains per-photo creators, source
pages, license versions, source hashes and editing notices. Detailed archival
histories and audit records are linked from the coverage file. Photos may come
from Wikimedia Commons, iNaturalist or Kew; licenses are checked per photo, not
inferred from an observation's license or public availability.

Photos have individual licenses: CC0 1.0, CC BY 2.0/3.0/4.0 or CC BY-SA 2.0/3.0/4.0.
Reuse must follow the specific photo's terms, including attribution and
share-alike requirements where applicable. Keep provenance and credit fields
when updating galleries; do not infer reuse permission merely from a photo
being hosted on Wikimedia Commons.

Internal archive locations are omitted from the public manifests. Public source
links, attribution, license notices and evidence hashes are retained; private
research archives are not part of the repository.

## License

The application code and project-authored documentation are available under the
[MIT License](LICENSE), copyright © 2026 Vipul Sharma.

This license does not relicense third-party material: census data, OpenStreetMap
boundaries and map imagery (including the map in `public/social-preview.jpg`),
reference photographs, quoted source material and dependencies retain their
respective terms. Preserve their attribution and license notices. Linking to the
Cubbon Park report does not grant permission to republish it.
