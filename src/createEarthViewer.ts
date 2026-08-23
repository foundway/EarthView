import {
  Cartesian3,
  Credit,
  EllipsoidTerrainProvider,
  ImageryLayer,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";
import { applyCameraControls, bindTrackpadPinch } from "./cameraControls";
import { HOME_VIEW, SATELLITE_TILE_URL } from "./config";

/** Create a self-contained Cesium globe with public satellite imagery. */
export function createEarthViewer(container: HTMLElement): Viewer {
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
    geocoder: true,
    homeButton: true,
    sceneModePicker: false,
    baseLayerPicker: false,
    navigationHelpButton: false,
    fullscreenButton: true,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: false,
  });

  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.showGroundAtmosphere = true;
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
  }
  viewer.scene.fog.enabled = true;
  viewer.scene.globe.depthTestAgainstTerrain = false;

  applyCameraControls(viewer.scene.screenSpaceCameraController);
  bindTrackpadPinch(viewer.scene.canvas, viewer.camera);

  viewer.camera.setView({
    destination: Cartesian3.fromDegrees(
      HOME_VIEW.longitudeDegrees,
      HOME_VIEW.latitudeDegrees,
      HOME_VIEW.heightMeters,
    ),
  });

  return viewer;
}
