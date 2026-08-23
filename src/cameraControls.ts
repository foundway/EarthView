import {
  type Camera,
  CameraEventType,
  KeyboardEventModifier,
  type ScreenSpaceCameraController,
} from "cesium";

/** Trackpad pinch is intentionally more responsive than ordinary scrolling. */
export const PINCH_SENSITIVITY = 10;

/**
 * Ordinary wheel/two-finger scroll and real touch pinch remain native Cesium
 * inputs. Chrome/Firefox trackpad pinch is wheel+ctrl and is handled below.
 */
export const ZOOM_EVENT_TYPES = [CameraEventType.WHEEL, CameraEventType.PINCH];

export const TILT_EVENT_TYPES = [
  CameraEventType.RIGHT_DRAG,
  { eventType: CameraEventType.LEFT_DRAG, modifier: KeyboardEventModifier.CTRL },
];

export function applyCameraControls(controls: ScreenSpaceCameraController): void {
  controls.enableZoom = true;
  controls.zoomEventTypes = ZOOM_EVENT_TYPES;
  controls.tiltEventTypes = TILT_EVENT_TYPES;
}

export function pinchZoomDeltaMeters(heightMeters: number, scaleRatio: number): number {
  return heightMeters * (scaleRatio - 1) * PINCH_SENSITIVITY;
}

export function pinchZoomDeltaFromWheel(
  heightMeters: number,
  deltaY: number,
  canvasHeight: number,
): number {
  const cesiumDelta = -deltaY;
  const arcLength = 7.5 * ((cesiumDelta * Math.PI) / 180);
  const rangeWindowRatio = Math.min(arcLength / canvasHeight, 0.1);
  const cesiumZoomFactor = 5;
  return cesiumZoomFactor * heightMeters * rangeWindowRatio * PINCH_SENSITIVITY;
}

function applyZoomDelta(camera: Camera, deltaMeters: number): void {
  if (deltaMeters > 0) {
    camera.zoomIn(deltaMeters);
  } else if (deltaMeters < 0) {
    camera.zoomOut(-deltaMeters);
  }
}

/**
 * macOS trackpad pinch:
 * - Chrome/Firefox emit wheel+ctrl.
 * - Safari emits GestureEvent.
 *
 * preventDefault keeps the browser from zooming the page instead of the globe.
 */
export function bindTrackpadPinch(canvas: HTMLCanvasElement, camera: Camera): void {
  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;

      event.preventDefault();
      const deltaY =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? event.deltaY * 40
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? event.deltaY * 120
            : event.deltaY;

      applyZoomDelta(
        camera,
        pinchZoomDeltaFromWheel(camera.positionCartographic.height, deltaY, canvas.clientHeight),
      );
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
    if (!Number.isFinite(scale) || scale <= 0) return;

    const ratio = scale / lastScale;
    lastScale = scale;
    applyZoomDelta(camera, pinchZoomDeltaMeters(camera.positionCartographic.height, ratio));
  });

  canvas.addEventListener("gestureend", (event) => event.preventDefault());
}
