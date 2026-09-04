import {
  Cartesian3,
  Credit,
  EllipsoidTerrainProvider,
  HeadingPitchRoll,
  ImageryLayer,
  Math as CesiumMath,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import {
  applyEarthCameraControls,
  bindEarthPointerMotion,
  type CameraSpeedAccess,
} from "./cameraControls";
import { SATELLITE_TILE_URL } from "../config";
import { applyCesiumToolbarIcons } from "./cesiumIcons";
import { HOME_HEIGHT_METERS, HOME_LATITUDE_DEG, HOME_LONGITUDE_DEG } from "./homeView";
import { createMapboxGeocoderService } from "./mapboxGeocoder";

/**
 * MSAA is what actually antialiases 3D rendering here: Cesium draws the scene
 * into its own render targets, and `msaaSamples` is the sample rate on those.
 * It needs a WebGL2 context with multisample render targets, and Cesium
 * quietly stays at one sample when that is missing.
 *
 * The WebGL context's own `antialias` flag is a different mechanism — it only
 * multisamples the default backbuffer, which the scene is not drawn into. It
 * would 4× every globe fragment (lighting, ground atmosphere, fog, imagery)
 * for no gain on top of MSAA, so it stays off and the fill-rate budget goes
 * to the samples that are actually seen.
 */
export const EARTH_MSAA_SAMPLES = 4;
export const EARTH_WEBGL_ANTIALIAS = false;

export interface EarthViewerOptions {
  readonly cameraSpeeds?: CameraSpeedAccess;
}

/**
 * Cesium's `useBrowserRecommendedResolution` substitutes `1` for
 * `window.devicePixelRatio`, so the scene is rasterized in CSS pixels and the
 * browser upscales it to the panel. On a HiDPI display that throws away most
 * of the samples the screen can show, and it is the one thing MSAA cannot get
 * back: the beams are PolylineGlow strips whose soft edge is shader alpha,
 * sampled once per *pixel* no matter the sample count. Under-resolved beams
 * bead into dots, which no coverage AA repairs.
 *
 * Always native resolution (`useBrowserRecommendedResolution: false`) so the
 * scene rasterizes at device pixels.
 */
export function applyEarthResolution(viewer: Viewer): void {
  viewer.useBrowserRecommendedResolution = false;
}

/**
 * `Scene.msaaSamples` is writable. Always 4 samples — the quality settings
 * that used to toggle this were removed.
 */
export function applyEarthMsaa(viewer: Viewer): void {
  viewer.scene.msaaSamples = EARTH_MSAA_SAMPLES;
}

export function createEarthViewer(
  container: HTMLElement,
  options: EarthViewerOptions = {},
): Viewer {
  const imagery = new UrlTemplateImageryProvider({
    url: SATELLITE_TILE_URL,
    maximumLevel: 19,
    credit: new Credit("Esri, Maxar, Earthstar Geographics", false),
  });

  const viewer = new Viewer(container, {
    baseLayer: new ImageryLayer(imagery),
    terrainProvider: new EllipsoidTerrainProvider(),
    animation: false,
    timeline: false,
    vrButton: false,
    geocoder: mapboxGeocoderOption(),
    homeButton: true,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: true,
    infoBox: false,
    selectionIndicator: false,
    useBrowserRecommendedResolution: false,
    msaaSamples: EARTH_MSAA_SAMPLES,
    contextOptions: {
      webgl: {
        antialias: EARTH_WEBGL_ANTIALIAS,
      },
    },
    // Clock must tick so lighting and the scene time keep moving after a
    // fade/seek rebuilds primitives.
    shouldAnimate: true,
  });

  applyCesiumToolbarIcons(viewer);

  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.showGroundAtmosphere = true;
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
  }
  viewer.scene.fog.enabled = true;
  // Beams on the far side of the planet must be hidden by the globe.
  viewer.scene.globe.depthTestAgainstTerrain = true;

  applyEarthCameraControls(viewer.scene.screenSpaceCameraController);
  bindEarthPointerMotion(viewer.scene.canvas, viewer.camera, options.cameraSpeeds);

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(HOME_LONGITUDE_DEG, HOME_LATITUDE_DEG, HOME_HEIGHT_METERS),
    orientation: new HeadingPitchRoll(0, -CesiumMath.PI_OVER_TWO, 0),
  });

  return viewer;
}

function mapboxGeocoderOption(): true | ReturnType<typeof createMapboxGeocoderService>[] {
  const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
  if (typeof token === "string" && token.trim().length > 0) {
    return [createMapboxGeocoderService({ token: token.trim() })];
  }
  // Ion geocoding is disabled without a token; the search box still exists
  // and reports "(not found)" until VITE_MAPBOX_ACCESS_TOKEN is set.
  return true;
}
