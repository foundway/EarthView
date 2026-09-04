import type { PerspectiveFrustum, Viewer } from "cesium";

/**
 * The camera's vertical field of view, or null when the frustum isn't
 * perspective — 2D and Columbus view use an orthographic frustum with no
 * `fovy`. Callers treat null as "switch off whatever this drives" rather than
 * substituting an angle, so a non-perspective camera degrades to plain
 * rendering instead of to a wrong number.
 */
export function verticalFovRadians(viewer: Viewer): number | null {
  const frustum = viewer.camera.frustum as PerspectiveFrustum;
  return typeof frustum.fovy === "number" && Number.isFinite(frustum.fovy) ? frustum.fovy : null;
}

/**
 * How tall the view is, in ground meters, at `distanceMeters` from the eye —
 * the vertical extent of the frustum at that depth. Anything longer than this
 * cannot fit on screen at that distance.
 */
export function viewHeightAtDistanceMeters(
  distanceMeters: number,
  verticalFov: number,
): number {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return 0;
  }
  return 2 * distanceMeters * Math.tan(verticalFov / 2);
}
