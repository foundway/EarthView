import { Cartesian3, Ellipsoid, IntersectionTests, Ray } from "cesium";
import { viewHeightAtDistanceMeters } from "./cameraFrustum";

/**
 * Grazing rays at the horizon hit thousands of kilometres out, so a dolly
 * scaled by that range would jump a continent per tick. Cap the look-at at
 * this elevation above the local tangent: range ≤ height / sin(ε).
 */
export const LOOK_AT_MIN_GRAZE_RADIANS = (15 * Math.PI) / 180;

/** Same formula Cesium's `handleZoom` uses for a WHEEL tick. */
export const CESIUM_ZOOM_FACTOR = 5;
export const CESIUM_WHEEL_PIXELS_PER_DEGREE = 7.5;
export const CESIUM_MAXIMUM_MOVEMENT_RATIO = 0.1;

/** Height at which a 1× speed setting is used as-is. Motion scales with elevation / this. */
export const SPEED_REFERENCE_HEIGHT_M = 1_000_000;

const scratchRay = new Ray();

export interface LookAtPose {
  readonly position: Cartesian3;
  readonly direction: Cartesian3;
  readonly heightMeters: number;
}

/**
 * Distance to the ellipsoid along the view, floored at `minRangeMeters` and
 * capped so a near-horizon pick cannot outrun the current view height.
 *
 * Nadir: this is the camera's ellipsoid height. Tilted: it grows as
 * height / cos(tilt) until the graze cap. Looking at sky: height.
 */
export function lookAtRangeMeters(pose: LookAtPose, minRangeMeters: number): number {
  const height =
    Number.isFinite(pose.heightMeters) && pose.heightMeters > 0
      ? pose.heightMeters
      : minRangeMeters;
  const floor = Math.max(minRangeMeters, 0);
  const safeHeight = Math.max(height, floor);
  const maxRange = safeHeight / Math.sin(LOOK_AT_MIN_GRAZE_RADIANS);

  if (Cartesian3.magnitudeSquared(pose.direction) < 1e-12) {
    return safeHeight;
  }

  Cartesian3.clone(pose.position, scratchRay.origin);
  Cartesian3.normalize(pose.direction, scratchRay.direction);

  const interval = IntersectionTests.rayEllipsoid(scratchRay, Ellipsoid.WGS84);
  if (!interval) {
    return safeHeight;
  }

  const range = interval.start > 0 ? interval.start : interval.stop;
  if (!Number.isFinite(range) || range <= 0) {
    return safeHeight;
  }
  return Math.min(Math.max(range, floor), maxRange);
}

/**
 * `elevation / 1,000 km`. Recomputed from the live camera height so a zoom-in
 * slows as the camera drops. 1 at the reference; 16 at the home globe; 0.006
 * at a 6 km pad.
 */
export function elevationSpeedScale(heightMeters: number): number {
  if (!Number.isFinite(heightMeters) || !(heightMeters > 0)) {
    return 0;
  }
  return heightMeters / SPEED_REFERENCE_HEIGHT_M;
}

/**
 * Radians of view one canvas pixel subtends — independent of altitude, so a
 * drag of N pixels is always the same fraction of the screen.
 */
export function panRadiansPerPixel(verticalFov: number, canvasHeight: number): number {
  if (!(canvasHeight > 0) || !Number.isFinite(verticalFov) || !(verticalFov > 0)) {
    return 0;
  }
  return (2 * Math.tan(verticalFov / 2)) / canvasHeight;
}

/**
 * Ground metres one canvas pixel spans at `rangeMeters` — the pan/truck scale
 * that keeps a drag moving the same fraction of the view at any altitude.
 */
export function panMetersPerPixel(
  rangeMeters: number,
  verticalFov: number,
  canvasHeight: number,
): number {
  if (!(canvasHeight > 0)) {
    return 0;
  }
  return viewHeightAtDistanceMeters(rangeMeters, verticalFov) / canvasHeight;
}

/**
 * View-plane metres a pixel drag should truck the camera. Positive `dxPixels`
 * is drag-right (camera moves left); positive `dyPixels` is drag-down (camera
 * moves up) so the ground follows the pointer.
 */
export function panOffsetMeters(
  rangeMeters: number,
  verticalFov: number,
  canvasHeight: number,
  dxPixels: number,
  dyPixels: number,
  panSpeed: number = 1,
): { rightMeters: number; upMeters: number } {
  const metersPerPixel = panMetersPerPixel(rangeMeters, verticalFov, canvasHeight) * motionSpeed(panSpeed);
  return {
    rightMeters: -dxPixels * metersPerPixel,
    upMeters: dyPixels * metersPerPixel,
  };
}

/**
 * Cesium's WHEEL zoom delta against live ellipsoid height. The 1,000 km tick
 * is `CESIUM_ZOOM_FACTOR × 1,000 km × windowRatio`; actual metres are that
 * times elevation / 1,000 km, so each event must re-read height.
 */
export function dollyDeltaFromWheel(
  elevationMeters: number,
  deltaY: number,
  canvasHeight: number,
  dollySpeed: number = 1,
): number {
  if (!(canvasHeight > 0) || !Number.isFinite(elevationMeters) || elevationMeters <= 0) {
    return 0;
  }
  const cesiumDelta = -deltaY;
  const arcLength = CESIUM_WHEEL_PIXELS_PER_DEGREE * ((cesiumDelta * Math.PI) / 180);
  const rangeWindowRatio = Math.min(arcLength / canvasHeight, CESIUM_MAXIMUM_MOVEMENT_RATIO);
  return (
    CESIUM_ZOOM_FACTOR *
    SPEED_REFERENCE_HEIGHT_M *
    rangeWindowRatio *
    motionSpeed(dollySpeed) *
    elevationSpeedScale(elevationMeters)
  );
}

/** Safari `gesturechange` scale ratio → metres along the view. */
export function dollyDeltaFromScaleRatio(
  elevationMeters: number,
  scaleRatio: number,
  dollySpeed: number = 1,
): number {
  if (
    !Number.isFinite(elevationMeters) ||
    elevationMeters <= 0 ||
    !Number.isFinite(scaleRatio)
  ) {
    return 0;
  }
  return (
    SPEED_REFERENCE_HEIGHT_M *
    (scaleRatio - 1) *
    motionSpeed(dollySpeed) *
    elevationSpeedScale(elevationMeters)
  );
}

/** `WheelEvent.deltaMode`: 0 pixel, 1 line, 2 page. */
export function wheelDeltaY(event: { readonly deltaY: number; readonly deltaMode: number }): number {
  if (event.deltaMode === 1) {
    return event.deltaY * 40;
  }
  if (event.deltaMode === 2) {
    return event.deltaY * 120;
  }
  return event.deltaY;
}

function motionSpeed(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
