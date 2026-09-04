import { Cartesian3, type Ellipsoid } from "cesium";

const scratchNormal = new Cartesian3();
const scratchToCamera = new Cartesian3();

/**
 * True when `point` is on the camera-facing side of the ellipsoid horizon.
 * Used to hide far-side beams without relying on Cesium's glow+depth cull,
 * which can leave polylines invisible after they come back around.
 */
export function isOnCameraFacingHemisphere(
  point: Cartesian3,
  cameraPosition: Cartesian3,
  ellipsoid: Ellipsoid,
  minDot = 0,
): boolean {
  ellipsoid.geodeticSurfaceNormal(point, scratchNormal);
  Cartesian3.subtract(cameraPosition, point, scratchToCamera);
  if (Cartesian3.magnitudeSquared(scratchToCamera) === 0) {
    return minDot < 0;
  }
  Cartesian3.normalize(scratchToCamera, scratchToCamera);
  return Cartesian3.dot(scratchNormal, scratchToCamera) > minDot;
}

/**
 * Window coordinates a DOM chip may use. `worldToWindowCoordinates` still
 * returns a point on the canvas for a far-side origin — the globe is
 * transparent to that projection — which parks a number over ocean that no
 * longer moves with the visible surface. Drop those, and drop non-finite
 * results so a failed transform cannot freeze the last CSS translate.
 */
export function chipScreenIfFacing(
  facing: boolean,
  screen: { readonly x: number; readonly y: number } | undefined,
): { x: number; y: number } | null {
  if (!facing || screen === undefined) {
    return null;
  }
  if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
    return null;
  }
  return { x: screen.x, y: screen.y };
}

/**
 * Re-projects anchors that already survived thinning. Far-side items stay in
 * the caller's tracked list and come back when they face the camera again;
 * they just do not get a chip this frame.
 */
export function reprojectFacingAnchors<T extends { readonly anchor: Cartesian3 }>(
  items: readonly T[],
  cameraPosition: Cartesian3,
  ellipsoid: Ellipsoid,
  project: (anchor: Cartesian3) => { readonly x: number; readonly y: number } | undefined,
): Array<T & { screenX: number; screenY: number }> {
  const next: Array<T & { screenX: number; screenY: number }> = [];
  for (const item of items) {
    const screen = chipScreenIfFacing(
      isOnCameraFacingHemisphere(item.anchor, cameraPosition, ellipsoid),
      project(item.anchor),
    );
    if (!screen) {
      continue;
    }
    next.push({ ...item, screenX: screen.x, screenY: screen.y });
  }
  return next;
}
