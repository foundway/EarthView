# EarthView Search Pulse

A full-window Cesium globe for exploring geographic Google Search Trends.
The browser renders only normalized API data; Google credentials and BigQuery
queries stay in the server runtime.

## What it does

- Renders a WGS84 globe with atmosphere, fog, stars, and lighting
- Drapes public Esri World Imagery satellite tiles over the globe
- Plots score/rank-scaled `PolylineGlow` beams at deterministic country centroids
- Switches between top and rising searches with country and term filters
- Shows source, refresh, coverage, loading, error, and empty states
- Supports orbit, zoom, tilt, geocoding, Home, and fullscreen
- Supports responsive macOS trackpad pinch in Chrome, Firefox, and Safari
- Uses Google's `bigquery-public-data.google_trends` international tables

## Requirements

- Node.js 22 or newer
- npm
- Internet access at runtime for Esri imagery tiles and Cesium's geocoder
- A Google Cloud project with BigQuery API access for live Trends data

## Run locally

```bash
npm install
cp .env.example .env.local
gcloud auth application-default login
npm run dev
```

Open <http://localhost:5173>.

Set `GOOGLE_CLOUD_PROJECT` in `.env.local` to the project that should be billed
for BigQuery queries. ADC can come from `gcloud auth application-default login`
or `GOOGLE_APPLICATION_CREDENTIALS`. Serverless deployments may instead set
`GOOGLE_SERVICE_ACCOUNT_JSON`, or `GOOGLE_CLIENT_EMAIL` plus
`GOOGLE_PRIVATE_KEY`. Never prefix these variables with `VITE_`.

When local credentials or configuration are unavailable, Vite serves a
deterministic demonstration fixture and labels it clearly in the HUD. The
deployed `/api/trends` endpoint never falls back to fixture data.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite development server on port 5173 |
| `npm test` | API, HUD, beam mapping, and camera-control tests |
| `npm run typecheck` | TypeScript validation |
| `npm run build` | Typecheck and produce static output in `dist/` |
| `npm run preview` | Serve the production build locally |

## Controls

| Input | Action |
|---|---|
| Left drag | Orbit |
| Mouse wheel / two-finger scroll | Zoom |
| Trackpad pinch | Zoom with 10× sensitivity |
| Right drag | Tilt |
| Ctrl + left drag | Alternate tilt |
| Home button | Return to initial space view |
| Search button | Cesium geocoder |
| Bottom-right button | Fullscreen |

## Architecture

```text
api/trends.ts                     # Vercel-style production endpoint
server/
├── trends.ts                     # validation, partition lookup, query, normalization
└── trendsFixture.ts              # development-only deterministic fallback
dev/trendsApiPlugin.ts            # local /api/trends Vite middleware
src/
├── main.ts                       # latest-request-wins orchestration
├── createEarthViewer.ts          # unchanged globe and camera setup
├── data/                         # browser fetch/types + country centroids
├── layers/                       # Cesium beams + pure visual mapping
└── ui/trendsHud.ts               # responsive dashboard states and controls
```

The API first reads the latest partition ID from BigQuery
`INFORMATION_SCHEMA.PARTITIONS`, then queries only that exact
`refresh_date` partition and its newest week. Inputs are parameterized,
validated, and capped at 100 rows. One strongest term is returned per country,
with international subregions aggregated explicitly.

## Geographic coverage and semantics

This version deliberately uses a reliable international country-centroid
subset. It does not guess US DMA coordinates or runtime-geocode region names.
The centroid map covers the approximately 50 countries currently represented
by the public international dataset; unmapped ISO codes are omitted and
reported in response metadata and the HUD.

Each beam represents the strongest matching country/term aggregate from the
latest week. Length and alpha encode the dataset's 0–100 score, width also
emphasizes rank, and a deterministic term hash controls color. Google describes
`score` as relative search interest over time, so beam sizes should not be read
as absolute query volume or direct cross-term volume.

### Static Cesium assets

Cesium loads workers, widget assets, and other files at runtime.
`vite.config.ts` copies these directories from `node_modules/cesium` into
`dist/cesiumStatic/` and defines `CESIUM_BASE_URL` as `{base}cesiumStatic`
(so GitHub Pages builds resolve under `/EarthView/cesiumStatic`).
`src/main.ts` assigns that value to `window.CESIUM_BASE_URL`. Keep the copy
destination and the defined URL aligned if the asset directory is renamed.

## Imagery and terrain

The imagery source is configured in `src/config.ts`:

```ts
export const SATELLITE_TILE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
```

The app deliberately uses:

- **Esri World Imagery** for satellite tiles
- **`EllipsoidTerrainProvider`** for a smooth WGS84 surface
- **No Cesium Ion token**

The Esri/Maxar/Earthstar attribution remains visible in Cesium's credit
container and must not be removed.

### Adding real terrain

The current Earth is geometrically smooth. To add mountains/buildings, replace
`EllipsoidTerrainProvider` in `src/createEarthViewer.ts` with a terrain
provider. Cesium World Terrain generally requires a Cesium Ion token; a
self-hosted quantized-mesh provider can avoid Ion.

## Changing the initial view

Edit `HOME_VIEW` in `src/config.ts`:

```ts
export const HOME_VIEW = {
  longitudeDegrees: -98.5795,
  latitudeDegrees: 39.8283,
  heightMeters: 18_000_000,
};
```

## Deployment

Live Trends data requires a Node runtime. Deploy the repository to Vercel so
`api/trends.ts` runs as a serverless function and the Vite output is served
from `dist` (`vercel.json`). Add the same server-only Google variables in
project settings. The service account needs permission to create BigQuery jobs
in the billing project; public Trends tables are read from
`bigquery-public-data`. Live data will not appear until those variables are
set.

The host must serve the files under `dist/cesiumStatic/` at the same path the
app uses for `CESIUM_BASE_URL`. A non-Vercel host needs an equivalent Node
endpoint for `/api/trends`; static hosting alone is not sufficient for live
queries.

GitHub Pages can still publish the static globe (see below), but it cannot run
BigQuery. Without a separate API origin, the HUD will not load live Trends.

### GitHub Pages preview

This repo deploys to GitHub Pages via `.github/workflows/deploy-pages.yml` on
every push to `main` (and via **Actions → Deploy GitHub Pages → Run workflow**).

Preview URL after the first successful deploy:

<https://foundway.github.io/EarthView/>

**One-time repo setup** (required before the workflow can publish):

1. Make the repository **public**, or use a GitHub plan that allows Pages on
   private repos (Pages sites are public by default).
2. Open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.

The workflow builds with `VITE_BASE=/EarthView/` so Vite assets and Cesium
static files resolve under the project-site subpath. Local `npm run dev` /
`npm run build` keep the default base `/` and need no env vars.

To preview a production-style Pages build locally:

```bash
VITE_BASE=/EarthView/ npm run build
npx vite preview --base /EarthView/
```

Then open <http://localhost:4173/EarthView/>.

## License

MIT for this application code. CesiumJS and imagery providers retain their
own licenses and attribution requirements.
