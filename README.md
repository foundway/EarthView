# EarthView

A standalone, full-window 3D Earth built with CesiumJS, TypeScript, and Vite.

EarthView contains only rendering and camera controls. It has no Mach9,
bagel, database, authentication, API, Vercel, analytics, or application-data
hooks.

## What it does

- Renders a WGS84 globe with atmosphere, fog, stars, and lighting
- Drapes public Esri World Imagery satellite tiles over the globe
- Starts from space, centered on North America
- Supports orbit, zoom, tilt, geocoding, Home, and fullscreen
- Supports responsive macOS trackpad pinch in Chrome, Firefox, and Safari
- Requires no API key or environment variables

## Requirements

- Node.js 22 or newer
- npm
- Internet access at runtime for Esri imagery tiles and Cesium's geocoder

## Run locally

```bash
npm install
npm run dev
```

Open <http://localhost:5173>.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite development server on port 5173 |
| `npm test` | Camera-control unit tests |
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
index.html
└── src/main.ts
    └── createEarthViewer.ts
        ├── config.ts             # home camera + imagery URL
        └── cameraControls.ts     # orbit/zoom/tilt + trackpad pinch
```

Cesium owns the globe mesh, WebGL renderer, camera math, atmosphere, imagery
tiling, and default toolbar. EarthView configures those APIs; it does not
implement a globe renderer from scratch.

### Static Cesium assets

Cesium loads workers, widget assets, and other files at runtime.
`vite.config.ts` copies these directories from `node_modules/cesium` into:

```text
dist/cesiumStatic/
```

`src/main.ts` sets `window.CESIUM_BASE_URL` to the same path. Keep those two
values aligned if the asset directory is renamed.

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

## Adding application data later

Keep data concerns outside `createEarthViewer.ts`. A clean pattern is:

```text
src/
├── data/       # fetch + validate domain data
├── layers/     # convert domain data into Cesium entities/primitives
└── ui/         # controls, legends, selection panels
```

Example:

```ts
import { Cartesian3, Color } from "cesium";

viewer.entities.add({
  position: Cartesian3.fromDegrees(-79.9959, 40.4406, 0),
  point: {
    pixelSize: 10,
    color: Color.CYAN,
  },
});
```

For large datasets, prefer `CustomDataSource`, `PrimitiveCollection`, or
Cesium 3D Tiles rather than thousands of independent UI-managed objects.

## Deployment

`npm run build` produces a static `dist/` directory. Deploy it to any static
host:

- GitHub Pages
- Cloudflare Pages
- Netlify
- Vercel
- S3 + CloudFront
- nginx

The host must serve the files under `dist/cesiumStatic/` at
`/cesiumStatic/`. No server runtime is otherwise required.

If deploying under a non-root path such as `/EarthView/`, set Vite's `base`
option and update `CESIUM_BASE_URL` so the copied Cesium assets resolve under
that prefix.

## License

MIT for this application code. CesiumJS and imagery providers retain their
own licenses and attribution requirements.
