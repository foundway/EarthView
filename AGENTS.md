# EarthView

A standalone client-side CesiumJS + TypeScript + Vite 3D Earth globe viewer. There is no backend, database, or auth. See `README.md` for full documentation, controls, and architecture.

## Cursor Cloud specific instructions

- Single service: the Vite dev server (`npm run dev`, port 5173). Standard commands live in `package.json` and the README "Commands" table (`dev`, `test`, `typecheck`, `build`, `preview`).
- There is no linter/ESLint. Static analysis is `npm run typecheck` (`tsc --noEmit`, strict mode).
- Runtime requires internet access for Esri World Imagery tiles (`services.arcgisonline.com`); without it the globe renders blank tiles.
- The geocoder/search button will always return "(not found)". This is by design: `Ion.defaultAccessToken` is intentionally empty (no Cesium Ion token), which disables Ion's geocoding service. Do not treat this as a bug or an environment failure. Verify globe functionality via manual navigation (drag to orbit, scroll to zoom, Home button) instead of search.
