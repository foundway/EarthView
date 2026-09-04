import {
  type Camera,
  CameraEventType,
  type ScreenSpaceCameraController,
} from "cesium";
import {
  dollyDeltaFromScaleRatio,
  dollyDeltaFromWheel,
  wheelDeltaY,
  CESIUM_MAXIMUM_MOVEMENT_RATIO,
} from "./screenSpaceMotion";

/** Pinch (trackpad + Safari) is this many times stronger than the unscaled delta. */
export const PINCH_SENSITIVITY = 10;

/**
 * Touch pinch stays on Cesium. Wheel — two-finger scroll and mouse — is
 * handled here so dolly can scale by live ellipsoid height (elevation / 1,000 km)
 * instead of look-at range. A tilted look-at is several times the height, and
 * one zoom-in tick of that size dumped the camera to the floor. Trackpad pinch
 * is still WHEEL+CTRL in Chrome/Firefox.
 */
export const ZOOM_EVENT_TYPES = [CameraEventType.PINCH];

/**
 * Floor for every zoom path, and the reason this file clamps at all: Cesium
 * culls the globe's backfaces, so a camera that slips under the ellipsoid draws
 * an empty starfield with the beams still standing in it. The Earth looks like
 * it vanished, and nothing but Home brings it back.
 *
 * Cesium's own default floor is 1 m, which is already inside the ground as far
 * as the imagery is concerned. 1 km keeps the globe a map, not a street view.
 */
export const MIN_CAMERA_HEIGHT_M = 1_000;

/** Zoom-out ceiling — past this the globe is a marble in empty space. */
export const MAX_CAMERA_HEIGHT_M = 40_000_000;

/**
 * Live multipliers from Settings → Camera. Getters so a slider change applies
 * on the next gesture without rebinding the canvas.
 */
export interface CameraSpeedAccess {
  dollySpeed: () => number;
}

const DEFAULT_CAMERA_SPEEDS: CameraSpeedAccess = {
  dollySpeed: () => 1,
};

/**
 * Trims a zoom-in to at most 10% of current elevation (and never through
 * {@link MIN_CAMERA_HEIGHT_M}), and a zoom-out to {@link MAX_CAMERA_HEIGHT_M}.
 * Look-at-range ticks and pinch ×10 used to ask for more than the remaining
 * height in one event, which dumped the camera to the floor — the "zoom-in
 * screams" path.
 */
export function clampZoomDeltaMeters(heightMeters: number, deltaMeters: number): number {
  if (!Number.isFinite(deltaMeters) || deltaMeters === 0) {
    return 0;
  }
  if (deltaMeters < 0) {
    if (!Number.isFinite(heightMeters)) {
      return deltaMeters;
    }
    const room = MAX_CAMERA_HEIGHT_M - heightMeters;
    if (!(room > 0)) {
      return 0;
    }
    return Math.max(deltaMeters, -room);
  }
  if (!Number.isFinite(heightMeters)) {
    return 0;
  }
  const room = Math.max(0, heightMeters - MIN_CAMERA_HEIGHT_M);
  const maxStep = CESIUM_MAXIMUM_MOVEMENT_RATIO * Math.max(heightMeters, 0);
  return Math.min(deltaMeters, room, maxStep);
}

/**
 * Cesium switches pan/zoom algorithms at 150 km and sky-drag at 7,500 km, so
 * a small site (6 km) and a large one (220 km) did not share a control path:
 * pick+strafe vs ellipsoid grab, look vs orbit. Zeroing both keeps grab-orbit
 * at every altitude. Left-drag is Cesium rotate (spin the globe). Tilt and
 * look are off — the globe stays nadir. Wheel is ours; touch pinch stays
 * on Cesium.
 */
export function applyEarthCameraControls(controls: ScreenSpaceCameraController): void {
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.enableTilt = false;
  controls.enableLook = false;
  controls.zoomEventTypes = ZOOM_EVENT_TYPES;
  controls.tiltEventTypes = [];
  controls.lookEventTypes = [];
  controls.minimumZoomDistance = MIN_CAMERA_HEIGHT_M;
  controls.minimumPickingTerrainHeight = 0;
  controls.minimumTrackBallHeight = 0;
  const rates = controls as ScreenSpaceCameraController & {
    _minimumRotateRate: number;
    _maximumRotateRate: number;
  };
  rates._minimumRotateRate = 0;
  rates._maximumRotateRate = Number.POSITIVE_INFINITY;
}

export function pinchZoomDeltaMeters(
  rangeMeters: number,
  scaleRatio: number,
  dollySpeed: number = 1,
): number {
  return dollyDeltaFromScaleRatio(rangeMeters, scaleRatio, dollySpeed) * PINCH_SENSITIVITY;
}

/**
 * Same units Cesium uses for WHEEL, then × PINCH_SENSITIVITY.
 * `deltaY` is the browser wheel delta (positive = pinch in / zoom out).
 */
export function pinchZoomDeltaFromWheel(
  rangeMeters: number,
  deltaY: number,
  canvasHeight: number,
  dollySpeed: number = 1,
): number {
  return dollyDeltaFromWheel(rangeMeters, deltaY, canvasHeight, dollySpeed) * PINCH_SENSITIVITY;
}

/*
 * The clamp lives here rather than in the handlers because this is the one
 * place that reaches past ScreenSpaceCameraController and moves the camera
 * itself — `minimumZoomDistance` governs the events Cesium owns, not these.
 * One pinch can ask for several times the look-at range (the wheel delta is
 * capped at 0.1 of the range window, then multiplied by PINCH_SENSITIVITY),
 * which is more than enough to punch through the globe in a single gesture.
 */
function applyZoomDelta(camera: Camera, deltaMeters: number): void {
  const delta = clampZoomDeltaMeters(camera.positionCartographic.height, deltaMeters);
  if (delta > 0) {
    camera.zoomIn(delta);
  } else if (delta < 0) {
    camera.zoomOut(-delta);
  }
}

/**
 * Wheel and Safari pinch. Left-drag stays with Cesium rotate (orbit).
 * Tilt and look are disabled. Right-click does not move the camera.
 *
 * Each event moves the camera immediately. Marker fly-to still eases in
 * `cameraFlight.ts`; this path is the user's hand, so a ramp reads as lag.
 */
export function bindEarthPointerMotion(
  canvas: HTMLCanvasElement,
  camera: Camera,
  speeds: CameraSpeedAccess = DEFAULT_CAMERA_SPEEDS,
): void {
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const elevation = camera.positionCartographic.height;
      const delta = dollyDeltaFromWheel(
        elevation,
        wheelDeltaY(event),
        canvas.clientHeight,
        speeds.dollySpeed(),
      );
      applyZoomDelta(camera, event.ctrlKey ? delta * PINCH_SENSITIVITY : delta);
    },
    { passive: false },
  );

  let lastScale = 1;

  canvas.addEventListener("gesturestart", (event) => {
    event.preventDefault();
    lastScale = 1;
  });

  canvas.addEventListener("gesturechange", (event) => {
    event.preventDefault();
    const scale = (event as unknown as { scale: number }).scale;
    if (!Number.isFinite(scale) || scale <= 0) {
      return;
    }
    const ratio = scale / lastScale;
    lastScale = scale;
    applyZoomDelta(
      camera,
      pinchZoomDeltaMeters(camera.positionCartographic.height, ratio, speeds.dollySpeed()),
    );
  });

  canvas.addEventListener("gestureend", (event) => event.preventDefault());
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}
