import {
  Cartesian3,
  Math as CesiumMath,
  type Camera,
  type HeadingPitchRoll,
  type Viewer,
} from "cesium";
import type { CameraFlightPlan, FlightCamera } from "./zoomSpeed";
import { flightPositionAt } from "./zoomSpeed";

/**
 * Same hitch cap as fly-to stepping. Cesium's tween clock is wall-time with no
 * cap: a 200 ms stall (tile load, MSAA hitch) jumps 200 ms along the path
 * and cruise looks like it surged. Capping `dt` keeps `v × Δt` stable; a
 * long stall stretches duration instead of teleporting.
 */
export const FLIGHT_MAX_STEP_SECONDS = 0.05;

/**
 * How far a press may travel before it stops being a click and starts being a
 * drag. Same 4 px the chips use to tell a click from camera work, so one
 * gesture cannot read as a click to the chips and a drag to the flight.
 */
export const FLIGHT_DRAG_SLOP_PX = 4;

export interface FlyViewerCameraOptions extends CameraFlightPlan {
  readonly destination: Cartesian3;
  readonly orientation?: HeadingPitchRoll | { heading?: number; pitch?: number; roll?: number };
  readonly complete?: () => void;
  readonly cancel?: () => void;
}

interface ActiveFlight {
  readonly from: Cartesian3;
  readonly to: Cartesian3;
  readonly camera: FlightCamera;
  readonly startHeading: number;
  readonly startPitch: number;
  readonly startRoll: number;
  readonly endHeading: number;
  readonly endPitch: number;
  readonly endRoll: number;
  readonly duration: number;
  readonly easingFunction: (time: number) => number;
  readonly complete?: () => void;
  readonly cancel?: () => void;
  elapsed: number;
  lastTimeMs: number | null;
}

const flights = new WeakMap<Viewer, ActiveFlight>();
const cancelHooks = new WeakSet<Camera>();
const preRenderHooks = new WeakSet<Viewer>();
const interruptHooks = new WeakSet<Viewer>();

/** Whether a press has travelled far enough to be the user taking the camera. */
export function exceedsDragSlop(
  dx: number,
  dy: number,
  slopPx: number = FLIGHT_DRAG_SLOP_PX,
): boolean {
  return Math.hypot(dx, dy) > slopPx;
}

/**
 * Advance cruise-time by this frame's elapsed seconds. Drops non-finite and
 * negative `dt`; clamps a hitch so one slow frame cannot dump the camera.
 */
export function cappedFlightDt(dtSeconds: number): number {
  if (!Number.isFinite(dtSeconds) || dtSeconds <= 0) {
    return 0;
  }
  return Math.min(dtSeconds, FLIGHT_MAX_STEP_SECONDS);
}

/**
 * Integrate cruise-time. 30 fps and 60 fps covering the same wall-clock
 * second land at the same elapsed time (both under the hitch cap).
 */
export function stepFlightElapsed(
  elapsedSeconds: number,
  dtSeconds: number,
  durationSeconds: number,
): number {
  if (!(durationSeconds > 0)) {
    return 0;
  }
  const elapsed = Math.max(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0, 0);
  return Math.min(elapsed + cappedFlightDt(dtSeconds), durationSeconds);
}

/**
 * Fly-to that owns its clock. Cesium `camera.flyTo` still draws the same
 * lon/lat/height path; we sample it each `preRender` with `v × dt` instead
 * of TweenJS's uncapped timestamp jump.
 */
export function flyViewerCamera(viewer: Viewer, options: FlyViewerCameraOptions): void {
  ensureCancelHook(viewer);
  ensurePreRenderHook(viewer);
  ensureInterruptHook(viewer);
  viewer.camera.cancelFlight();

  const destination = Cartesian3.clone(options.destination);
  const from = Cartesian3.clone(viewer.camera.positionWC);
  const duration = options.duration;
  const end = readOrientation(options.orientation);

  if (!Number.isFinite(duration) || duration <= 0) {
    applyFlightView(viewer, destination, end.heading, end.pitch, end.roll);
    options.complete?.();
    return;
  }

  const camera: FlightCamera = {
    up: Cartesian3.clone(viewer.camera.up),
    right: Cartesian3.clone(viewer.camera.right),
    frustum: viewer.camera.frustum,
  };

  setCameraInputs(viewer, false);
  flights.set(viewer, {
    from,
    to: destination,
    camera,
    startHeading: viewer.camera.heading,
    startPitch: viewer.camera.pitch,
    startRoll: viewer.camera.roll,
    endHeading: end.heading,
    endPitch: end.pitch,
    endRoll: end.roll,
    duration,
    easingFunction: options.easingFunction,
    complete: options.complete,
    cancel: options.cancel,
    elapsed: 0,
    lastTimeMs: null,
  });
}

function ensureCancelHook(viewer: Viewer): void {
  const camera = viewer.camera;
  if (cancelHooks.has(camera)) {
    return;
  }
  cancelHooks.add(camera);
  const original = camera.cancelFlight.bind(camera);
  camera.cancelFlight = () => {
    finishFlight(viewer, "cancel");
    original();
  };
}

/**
 * Hands the camera back the moment the user reaches for it.
 *
 * A flight owns the camera outright — it writes the pose every `preRender` and
 * switches the ScreenSpaceCameraController off — so mid-flight input did
 * nothing: Cesium ignored the drag, and the wheel path in `cameraControls.ts`,
 * which moves the camera itself rather than through the controller, wrote a
 * pose the next frame immediately overwrote. Either way the globe looked
 * frozen until the flight landed. Cancelling restores inputs in the same frame
 * the gesture starts, so the drag or scroll that interrupted the flight is
 * also the one that moves the camera.
 *
 * A press on its own is not enough. A click is how the next flight is started
 * (chips) and a stray one on empty globe would otherwise strand the camera
 * between two sites, so the pointer has to clear {@link FLIGHT_DRAG_SLOP_PX}
 * first. The wheel has no such ambiguity and interrupts immediately.
 */
function ensureInterruptHook(viewer: Viewer): void {
  if (interruptHooks.has(viewer)) {
    return;
  }
  const canvas = viewer.scene.canvas;
  if (!canvas) {
    return;
  }
  interruptHooks.add(viewer);

  let pressedAt: { readonly x: number; readonly y: number } | null = null;
  const interrupt = (): void => {
    pressedAt = null;
    if (flights.has(viewer)) {
      viewer.camera.cancelFlight();
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    pressedAt = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointermove", (event) => {
    if (pressedAt && exceedsDragSlop(event.clientX - pressedAt.x, event.clientY - pressedAt.y)) {
      interrupt();
    }
  });
  canvas.addEventListener("pointerup", () => {
    pressedAt = null;
  });
  canvas.addEventListener("pointercancel", () => {
    pressedAt = null;
  });
  canvas.addEventListener("wheel", interrupt, { passive: true });
  canvas.addEventListener("gesturechange", interrupt);
}

function ensurePreRenderHook(viewer: Viewer): void {
  if (preRenderHooks.has(viewer)) {
    return;
  }
  preRenderHooks.add(viewer);
  viewer.scene.preRender.addEventListener(() => stepActiveFlight(viewer));
}

function stepActiveFlight(viewer: Viewer): void {
  const flight = flights.get(viewer);
  if (!flight) {
    return;
  }

  const now = performance.now();
  const dt =
    flight.lastTimeMs === null ? 0 : (now - flight.lastTimeMs) / 1000;
  flight.lastTimeMs = now;
  flight.elapsed = stepFlightElapsed(flight.elapsed, dt, flight.duration);
  applyActivePose(viewer, flight);

  if (flight.elapsed >= flight.duration) {
    finishFlight(viewer, "complete");
  }
}

function applyActivePose(viewer: Viewer, flight: ActiveFlight): void {
  const fraction = flight.elapsed / flight.duration;
  const pathT = flight.easingFunction(fraction);
  const position = flightPositionAt(flight.from, flight.to, pathT, flight.camera);
  applyFlightView(
    viewer,
    position,
    interpolateHeading(flight.startHeading, flight.endHeading, pathT),
    CesiumMath.lerp(flight.startPitch, flight.endPitch, pathT),
    CesiumMath.lerp(flight.startRoll, flight.endRoll, pathT),
  );
}

function applyFlightView(
  viewer: Viewer,
  destination: Cartesian3,
  heading: number,
  pitch: number,
  roll: number,
): void {
  viewer.camera.setView({
    destination,
    orientation: { heading, pitch, roll },
  });
}

function finishFlight(viewer: Viewer, reason: "complete" | "cancel"): void {
  const flight = flights.get(viewer);
  if (!flight) {
    return;
  }
  flights.delete(viewer);
  setCameraInputs(viewer, true);
  if (reason === "complete") {
    flight.complete?.();
  } else {
    flight.cancel?.();
  }
}

function setCameraInputs(viewer: Viewer, enabled: boolean): void {
  const controller = viewer.scene.screenSpaceCameraController;
  if (controller) {
    controller.enableInputs = enabled;
  }
}

function readOrientation(
  orientation: FlyViewerCameraOptions["orientation"],
): { heading: number; pitch: number; roll: number } {
  return {
    heading: orientation?.heading ?? 0,
    pitch: orientation?.pitch ?? -CesiumMath.PI_OVER_TWO,
    roll: orientation?.roll ?? 0,
  };
}

/**
 * Shortest-arc heading lerp, matching Cesium `CameraFlightPath`.
 */
export function interpolateHeading(start: number, end: number, t: number): number {
  let from = start;
  if (CesiumMath.equalsEpsilon(from, CesiumMath.TWO_PI, CesiumMath.EPSILON11)) {
    from = 0;
  }
  if (end > from + Math.PI) {
    from += CesiumMath.TWO_PI;
  } else if (end < from - Math.PI) {
    from -= CesiumMath.TWO_PI;
  }
  return CesiumMath.lerp(from, end, t);
}
