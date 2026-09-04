import { Cartesian3, Cartographic, Math as CesiumMath } from "cesium";
import {
  clampBaseZoomSpeedKmPerSecond,
  clampFlightEaseSeconds,
  clampPlaybackZoomSpeedMultiplier,
  FLIGHT_EASE_SECONDS_DEFAULT,
} from "../settings/model";
import { MIN_CAMERA_HEIGHT_M } from "./cameraControls";
import { elevationSpeedScale } from "./screenSpaceMotion";

export { SPEED_REFERENCE_HEIGHT_M } from "./screenSpaceMotion";

const PATH_SAMPLES = 64;
const DEFAULT_FOVY = Math.PI / 3;
const DEFAULT_ASPECT = 16 / 9;
const CESIUM_HEIGHT_POWER = 8;
const CESIUM_HEIGHT_FACTOR = 1_000_000;
const CESIUM_PEAK_SCALE = 0.2;
const CESIUM_PEAK_CAP_METERS = 1_000_000_000;

export interface FlightCamera {
  readonly up?: Cartesian3;
  readonly right?: Cartesian3;
  readonly frustum?: object;
}

export interface CameraFlightPlan {
  readonly duration: number;
  readonly easingFunction: (time: number) => number;
}

export function zoomVelocityMetersPerSecond(
  baseKmPerSecond: number,
  multiplier: number = 1,
): number {
  return (
    clampBaseZoomSpeedKmPerSecond(baseKmPerSecond) *
    1000 *
    clampPlaybackZoomSpeedMultiplier(multiplier)
  );
}

/**
 * World-space cruise at `heightMeters`: the configured km/s at 1,000 km,
 * times elevation / 1,000 km. Higher is faster; a pad is slower. Fade in/out
 * is applied later by {@link planCameraFlight}, not here.
 */
export function cruiseVelocityMetersPerSecond(
  heightMeters: number,
  worldVelocityMetersPerSecond: number,
): number {
  if (!(worldVelocityMetersPerSecond > 0)) {
    return 0;
  }
  const height = Math.max(
    Number.isFinite(heightMeters) ? heightMeters : MIN_CAMERA_HEIGHT_M,
    MIN_CAMERA_HEIGHT_M,
  );
  return worldVelocityMetersPerSecond * elevationSpeedScale(height);
}

/**
 * Camera pose on Cesium's 3D `flyTo` path at parameter `cesiumT` in [0, 1]:
 * lon/lat lerp plus the frustum-derived height boost. The cruise stepper
 * samples this every frame so speed is `v(h) × dt`, not a tween tick.
 */
export function flightPositionAt(
  from: Cartesian3,
  to: Cartesian3,
  cesiumT: number,
  camera?: FlightCamera,
): Cartesian3 {
  const t = Math.min(Math.max(cesiumT, 0), 1);
  const start = Cartographic.fromCartesian(from);
  const end = Cartographic.fromCartesian(to);
  if (!start || !end) {
    return Cartesian3.lerp(from, to, t, new Cartesian3());
  }
  const { startLon, destLon } = shortestFlightLongitudes(start.longitude, end.longitude);
  const heightAt = cesiumHeightFunction(
    start.height,
    end.height,
    peakAltitudeMeters(from, to, camera),
  );
  return Cartesian3.fromRadians(
    CesiumMath.lerp(startLon, destLon, t),
    CesiumMath.lerp(start.latitude, end.latitude, t),
    heightAt(t),
  );
}

/**
 * Length of the path Cesium's 3D `flyTo` actually follows: lon/lat lerp plus
 * the frustum-derived height boost. Straight-line ECEF distance is the chord
 * through the Earth and is why some hops used to scream and others crawled.
 */
export function flightPathLengthMeters(
  from: Cartesian3,
  to: Cartesian3,
  camera?: FlightCamera,
): number {
  let length = 0;
  walkFlightPath(from, to, camera, (distance) => {
    length += distance;
  });
  return length;
}

/**
 * Seconds to traverse Cesium's real path at the local elevation-scaled cruise.
 */
export function flightCruiseSeconds(
  from: Cartesian3,
  to: Cartesian3,
  worldVelocityMetersPerSecond: number,
  camera?: FlightCamera,
): number {
  if (!(worldVelocityMetersPerSecond > 0)) {
    return 0;
  }
  let seconds = 0;
  walkFlightPath(from, to, camera, (distance, heightMeters) => {
    const velocity = cruiseVelocityMetersPerSecond(
      heightMeters,
      worldVelocityMetersPerSecond,
    );
    if (velocity > 0) {
      seconds += distance / velocity;
    }
  });
  return seconds;
}

/**
 * Duration is the path at elevation-scaled cruise (`base × elevation /
 * 1,000 km`). The shape is one sine ease-in-out over that cruise-time —
 * a single S-curve, no ramp–cruise–ramp plateau. Peak speed is ~1.57×
 * average, so the middle does not dump. Mapping is cruise-time → Cesium
 * `t`, so a height-boosted middle is still faster than the low ends.
 *
 * Slider at 0 leaves and arrives at full local cruise (linear in
 * cruise-time). Any positive value uses the sine. Playback 0.5× doubles
 * duration without changing the curve.
 */
export function planCameraFlight(
  from: Cartesian3,
  to: Cartesian3,
  baseKmPerSecond: number,
  multiplier: number = 1,
  camera?: FlightCamera,
  configuredEaseSeconds: number = FLIGHT_EASE_SECONDS_DEFAULT,
): CameraFlightPlan {
  const velocity = zoomVelocityMetersPerSecond(baseKmPerSecond, multiplier);
  const samples = sampleFlightCruise(from, to, velocity, camera);
  const cruiseSeconds = samples[samples.length - 1]?.sigma ?? 0;
  if (!Number.isFinite(cruiseSeconds) || cruiseSeconds <= 0 || velocity <= 0) {
    return { duration: 0, easingFunction: identityEase };
  }

  const alongCruise = (timeFraction: number): number =>
    cesiumTAtSigma(samples, timeFraction * cruiseSeconds);

  const ease = clampFlightEaseSeconds(configuredEaseSeconds);
  return {
    duration: cruiseSeconds,
    easingFunction:
      ease > 0 ? (time: number) => alongCruise(sineInOutEase(time)) : alongCruise,
  };
}

/**
 * Standard sine ease-in-out: `(1 - cos(π t)) / 2`. One S-curve, zero
 * velocity at both ends, gentler mid-peak than cubic-in-out.
 */
export function sineInOutEase(time: number): number {
  const t = Math.min(Math.max(time, 0), 1);
  return (1 - Math.cos(Math.PI * t)) / 2;
}

function identityEase(time: number): number {
  return time;
}

interface CruiseSample {
  readonly cesiumT: number;
  readonly sigma: number;
}

function sampleFlightCruise(
  from: Cartesian3,
  to: Cartesian3,
  worldVelocityMetersPerSecond: number,
  camera?: FlightCamera,
): CruiseSample[] {
  const samples: CruiseSample[] = [{ cesiumT: 0, sigma: 0 }];
  let sigma = 0;
  let index = 0;
  walkFlightPath(from, to, camera, (distance, heightMeters) => {
    index += 1;
    const velocity = cruiseVelocityMetersPerSecond(
      heightMeters,
      worldVelocityMetersPerSecond,
    );
    if (velocity > 0) {
      sigma += distance / velocity;
    }
    samples.push({ cesiumT: index / PATH_SAMPLES, sigma });
  });
  return samples;
}

function cesiumTAtSigma(samples: readonly CruiseSample[], sigma: number): number {
  const last = samples[samples.length - 1];
  if (!last || last.sigma <= 0) {
    return 0;
  }
  if (sigma <= 0) {
    return 0;
  }
  if (sigma >= last.sigma) {
    return 1;
  }
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].sigma <= sigma) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const span = samples[hi].sigma - samples[lo].sigma;
  const frac = span > 0 ? (sigma - samples[lo].sigma) / span : 0;
  return samples[lo].cesiumT + frac * (samples[hi].cesiumT - samples[lo].cesiumT);
}

function walkFlightPath(
  from: Cartesian3,
  to: Cartesian3,
  camera: FlightCamera | undefined,
  visit: (distanceMeters: number, heightMeters: number) => void,
): void {
  const start = Cartographic.fromCartesian(from);
  const end = Cartographic.fromCartesian(to);
  if (!start || !end) {
    const fallback = Cartesian3.distance(from, to);
    if (Number.isFinite(fallback) && fallback > 0) {
      visit(fallback, MIN_CAMERA_HEIGHT_M);
    }
    return;
  }

  const { startLon, destLon } = shortestFlightLongitudes(start.longitude, end.longitude);
  const heightAt = cesiumHeightFunction(
    start.height,
    end.height,
    peakAltitudeMeters(from, to, camera),
  );

  let previous = Cartesian3.fromRadians(startLon, start.latitude, heightAt(0));
  let previousHeight = heightAt(0);
  for (let i = 1; i <= PATH_SAMPLES; i += 1) {
    const t = i / PATH_SAMPLES;
    const height = heightAt(t);
    const next = Cartesian3.fromRadians(
      CesiumMath.lerp(startLon, destLon, t),
      CesiumMath.lerp(start.latitude, end.latitude, t),
      height,
    );
    visit(Cartesian3.distance(previous, next), 0.5 * (previousHeight + height));
    previous = next;
    previousHeight = height;
  }
}

function shortestFlightLongitudes(
  startLongitude: number,
  destLongitude: number,
): { startLon: number; destLon: number } {
  let startLon = CesiumMath.zeroToTwoPi(startLongitude);
  const destLon = CesiumMath.zeroToTwoPi(destLongitude);
  const diff = startLon - destLon;
  if (diff < -CesiumMath.PI) {
    startLon += CesiumMath.TWO_PI;
  } else if (diff > CesiumMath.PI) {
    startLon -= CesiumMath.TWO_PI;
  }
  return { startLon, destLon };
}

function peakAltitudeMeters(from: Cartesian3, to: Cartesian3, camera?: FlightCamera): number {
  const { fovy, aspectRatio } = readFrustum(camera);
  const { east, north } = viewAxes(from, camera);
  const delta = Cartesian3.subtract(from, to, new Cartesian3());
  const vertical = Math.abs(Cartesian3.dot(delta, north));
  const horizontal = Math.abs(Cartesian3.dot(delta, east));
  const tanHalfFov = Math.tan(0.5 * fovy);
  const fit = Math.max(horizontal / (aspectRatio * tanHalfFov), vertical / tanHalfFov);
  return Math.min(fit * CESIUM_PEAK_SCALE, CESIUM_PEAK_CAP_METERS);
}

function cesiumHeightFunction(
  startHeight: number,
  endHeight: number,
  peakAltitude: number,
): (t: number) => number {
  const maxHeight = Math.max(startHeight, endHeight);
  if (maxHeight >= peakAltitude) {
    return (t) => startHeight + (endHeight - startHeight) * t;
  }
  const start = -Math.pow((peakAltitude - startHeight) * CESIUM_HEIGHT_FACTOR, 1 / CESIUM_HEIGHT_POWER);
  const end = Math.pow((peakAltitude - endHeight) * CESIUM_HEIGHT_FACTOR, 1 / CESIUM_HEIGHT_POWER);
  return (t) => {
    const x = t * (end - start) + start;
    return -Math.pow(x, CESIUM_HEIGHT_POWER) / CESIUM_HEIGHT_FACTOR + peakAltitude;
  };
}

function readFrustum(camera?: FlightCamera): { fovy: number; aspectRatio: number } {
  const frustum = camera?.frustum as { fovy?: number; aspectRatio?: number } | undefined;
  const fovy = frustum?.fovy;
  const aspectRatio = frustum?.aspectRatio;
  return {
    fovy: typeof fovy === "number" && fovy > 0 ? fovy : DEFAULT_FOVY,
    aspectRatio: typeof aspectRatio === "number" && aspectRatio > 0 ? aspectRatio : DEFAULT_ASPECT,
  };
}

function viewAxes(
  from: Cartesian3,
  camera?: FlightCamera,
): { east: Cartesian3; north: Cartesian3 } {
  if (camera?.right && camera?.up) {
    return { east: camera.right, north: camera.up };
  }
  const normal = Cartesian3.normalize(from, new Cartesian3());
  const east = Cartesian3.cross(Cartesian3.UNIT_Z, normal, new Cartesian3());
  if (Cartesian3.magnitudeSquared(east) < 1e-12) {
    Cartesian3.clone(Cartesian3.UNIT_X, east);
  } else {
    Cartesian3.normalize(east, east);
  }
  const north = Cartesian3.normalize(Cartesian3.cross(normal, east, new Cartesian3()), new Cartesian3());
  return { east, north };
}
