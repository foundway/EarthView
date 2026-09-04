/**
 * Gating for per-frame work that only means anything when the camera moves.
 *
 * Marauder hangs several listeners off `preRender`/`postRender`, and several of
 * them are pure functions of the camera: horizon culling, screen projection,
 * Poisson-disk thinning, beam fade, path LOD. On a still camera every one of
 * them recomputes the identical answer. During a zoom they all change at once,
 * which is why the frame rate falls off a cliff exactly then and looks fine at
 * rest. A hidden layer must return before any of that work — toggling a layer
 * off is not allowed to keep its pass on the drag budget.
 *
 * A {@link CameraGate} answers one question — "should I do my expensive pass on
 * this frame?" — and it deliberately answers *yes* at three moments and no
 * others:
 *
 * - **The frame a gesture starts**, so thinning and fade switch to the
 *   while-moving cadence immediately rather than up to an interval late.
 * - **Every {@link MOVING_INTERVAL_MS} while the camera changes at all**, so
 *   thinning and fade keep tracking it at roughly 12 Hz instead of the
 *   display's 60–120.
 * - **The frame a gesture ends**, which is the one that has to be right: it is
 *   the frame the user is actually looking at, so it lands exact positions.
 *
 * "Moving" here means *gesture-speed* movement, not any movement at all, and
 * that distinction is load-bearing rather than cosmetic — the globe idles under
 * a slow ambient spin, so a gate that treated any delta as motion would leave
 * the app permanently in its degraded render path. See
 * {@link GESTURE_RATE_PER_SECOND}.
 *
 * Callers must also `force()` whenever something *other* than the camera
 * invalidates their work — new data, a settings change, a visibility flip, a
 * `reveal()`. The gate only knows about the camera, so anything it cannot see
 * has to be announced.
 *
 * What a skipped frame must never do is *drop* what it drew last time. Layers
 * hold their previous result (clusters, pins, entity `show` flags) and simply
 * return, so a throttled frame renders the previous answer rather than nothing.
 */
import type { Viewer } from "cesium";

/** Camera state the per-frame passes actually depend on. */
export interface CameraPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Unit view direction — rotation matters even when position does not. */
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
}

/**
 * Position change under half a metre is float noise rather than a camera move.
 * Well under one device pixel at every altitude the globe is legible at, so no
 * change this small can be visible in a projected beam origin.
 */
export const POSE_EPSILON_METERS = 0.5;

/** Direction change under this, on unit vectors, is float noise. */
export const DIRECTION_EPSILON = 1e-9;

/**
 * Roughly 12 Hz. Thinning and fade are both already quantized — fade to 24
 * steps, LOD tolerance to powers of two — so they cannot resolve anything finer
 * than this anyway, and beams keep their slots across frames by hysteresis
 * rather than by being recomputed.
 */
export const MOVING_INTERVAL_MS = 80;

/**
 * No gesture-speed motion for this long counts as settled. Long enough to
 * bridge the gap between two wheel notches, so a slow scroll reads as one
 * continuous gesture instead of flickering between the two render paths.
 */
export const SETTLE_DELAY_MS = 140;

/**
 * View change per second above which the camera is being *driven* rather than
 * drifting, which is the distinction that decides whether to freeze path LOD
 * for the gesture.
 *
 * The threshold has to be scale-invariant, and an absolute distance cannot be:
 * `EarthRotationController` idles the globe at 0.25°/s, and at the 16,000 km
 * home altitude that is already ~97 km of camera travel *per second*. Measuring
 * metres would therefore class the ambient spin as a permanent gesture — path
 * LOD would never advance, which is exactly the regression this constant
 * exists to prevent.
 *
 * In the units {@link viewChangeRate} returns, the ambient spin is 0.0044/s, so
 * 0.05 leaves an order of magnitude of headroom while still catching anything a
 * hand does: a single wheel notch is >10/s and a brisk drag is ~1/s. The
 * fade-to-black seek phase (18°/s) reads as a gesture, which is free — the
 * globe is black through it.
 */
export const GESTURE_RATE_PER_SECOND = 0.05;

/**
 * How much the view changed between two poses, per second, in scale-invariant
 * units: radians swept around the earth's centre, plus radians the camera
 * turned, plus the *fractional* change in altitude. Summed rather than
 * compared separately because any one of them alone is a gesture.
 *
 * Altitude is deliberately relative — dropping 1,000 km is nothing at
 * full-disk and impossible at street level, so a zoom has to be judged as a
 * proportion of where the camera already is.
 */
export function viewChangeRate(a: CameraPose, b: CameraPose, dtSeconds: number): number {
  if (!(dtSeconds > 0)) {
    return 0;
  }
  const radiusA = Math.hypot(a.x, a.y, a.z);
  const radiusB = Math.hypot(b.x, b.y, b.z);
  if (radiusA <= 0 || radiusB <= 0) {
    return 0;
  }

  const clamp = (value: number): number => Math.min(1, Math.max(-1, value));
  const swept = Math.acos(
    clamp((a.x * b.x + a.y * b.y + a.z * b.z) / (radiusA * radiusB)),
  );
  const turned = Math.acos(clamp(a.dx * b.dx + a.dy * b.dy + a.dz * b.dz));
  const zoomed = Math.abs(radiusB - radiusA) / Math.max(radiusA, radiusB);

  return (swept + turned + zoomed) / dtSeconds;
}

export function readCameraPose(viewer: Viewer): CameraPose {
  const position = viewer.camera.positionWC;
  const direction = viewer.camera.directionWC;
  return {
    x: position.x,
    y: position.y,
    z: position.z,
    dx: direction.x,
    dy: direction.y,
    dz: direction.z,
  };
}

export function posesEqual(
  a: CameraPose,
  b: CameraPose,
  epsilonMeters: number = POSE_EPSILON_METERS,
): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  if (dx * dx + dy * dy + dz * dz > epsilonMeters * epsilonMeters) {
    return false;
  }
  // Unit vectors, so the dot product is the cosine of the angle between them.
  return a.dx * b.dx + a.dy * b.dy + a.dz * b.dz >= 1 - DIRECTION_EPSILON;
}

/** Wall clock for the gate. Separate so tests can drive time by hand. */
export function frameNowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Note the two-level design, which exists because the globe is *never* truly
 * still: `EarthRotationController` spins it whenever it is visible.
 *
 * - **Any** pose change drives the throttle, so the ambient spin costs ~12 Hz
 *   of work instead of a full-rate pass on every frame.
 * - Only **gesture-speed** change (see {@link GESTURE_RATE_PER_SECOND}) sets
 *   {@link isMoving}, so path LOD stays frozen while a hand is on the camera
 *   and not for the whole time the app sits idling.
 */
export class CameraGate {
  private pose: CameraPose | null = null;
  private poseAtMs = 0;
  private lastGestureMs = Number.NEGATIVE_INFINITY;
  private lastRunMs = Number.NEGATIVE_INFINITY;
  private forced = true;
  private gesturing = false;

  constructor(
    private readonly intervalMs: number = MOVING_INTERVAL_MS,
    private readonly settleMs: number = SETTLE_DELAY_MS,
    private readonly gestureRate: number = GESTURE_RATE_PER_SECOND,
  ) {}

  /** Something the gate cannot see changed; run the next frame regardless. */
  public force(): void {
    this.forced = true;
  }

  /**
   * Whether the camera is being driven, as opposed to drifting on the ambient
   * spin. Callers freeze path LOD while this is true, so it is only meaningful
   * after {@link shouldRun} has been called for the frame.
   */
  public isMoving(): boolean {
    return this.gesturing;
  }

  /** Call exactly once per frame: it advances the gate's own motion state. */
  public shouldRun(pose: CameraPose, nowMs: number): boolean {
    const previous = this.pose;
    const previousAtMs = this.poseAtMs;
    this.pose = pose;
    this.poseAtMs = nowMs;

    const changed = previous === null || !posesEqual(previous, pose);
    const rate =
      previous === null
        ? Number.POSITIVE_INFINITY
        : viewChangeRate(previous, pose, (nowMs - previousAtMs) / 1000);
    if (rate >= this.gestureRate) {
      this.lastGestureMs = nowMs;
    }

    const gesturing = nowMs - this.lastGestureMs < this.settleMs;
    const gestureChanged = gesturing !== this.gesturing;
    this.gesturing = gesturing;

    // Both edges of a gesture are must-run frames: entering freezes path LOD,
    // leaving lands exact geometry on the frame the user is looking at.
    if (this.forced || gestureChanged) {
      this.forced = false;
      this.lastRunMs = nowMs;
      return true;
    }

    if (changed && nowMs - this.lastRunMs >= this.intervalMs) {
      this.lastRunMs = nowMs;
      return true;
    }

    return false;
  }
}
