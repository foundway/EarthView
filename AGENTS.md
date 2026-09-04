# EarthView

A standalone CesiumJS + TypeScript + Vite 3D Earth globe viewer with a Vercel-backed Google Trends API. There is no database or auth. See `README.md` for full documentation, controls, and architecture.

## Cursor Cloud specific instructions

- Single service: the Vite dev server (`npm run dev`, port 4000, `strictPort`). Standard commands live in `package.json` and the README "Commands" table (`dev`, `test`, `typecheck`, `build`, `preview`). Do not move this back to 5173; the internal Marauder app owns that port.
- There is no linter/ESLint. Static analysis is `npm run typecheck` (`tsc --noEmit`, strict mode).
- Runtime requires internet access for Esri World Imagery tiles (`services.arcgisonline.com`); without it the globe renders blank tiles.
- Address search stays "(not found)" unless `VITE_MAPBOX_ACCESS_TOKEN` is set. That is expected without a Mapbox token (Cesium Ion geocoding is disabled). Verify the globe by drag-orbit, scroll/pinch zoom, and Home instead of search.
