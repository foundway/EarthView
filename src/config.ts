import {
  HOME_HEIGHT_METERS,
  HOME_LATITUDE_DEG,
  HOME_LONGITUDE_DEG,
} from "./earth/homeView";

/** Initial camera: full Earth centered on North America. */
export const HOME_VIEW = {
  longitudeDegrees: HOME_LONGITUDE_DEG,
  latitudeDegrees: HOME_LATITUDE_DEG,
  heightMeters: HOME_HEIGHT_METERS,
} as const;

/**
 * Public Esri World Imagery tiles. The Cesium credit container remains visible
 * so the imagery attribution is shown.
 */
export const SATELLITE_TILE_URL =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
