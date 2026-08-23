/** Initial camera: full Earth centered on North America. */
export const HOME_VIEW = {
  longitudeDegrees: -98.5795,
  latitudeDegrees: 39.8283,
  heightMeters: 18_000_000,
} as const;

/**
 * Public Esri World Imagery tiles. The Cesium credit container remains visible
 * so the imagery attribution is shown.
 */
export const SATELLITE_TILE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
