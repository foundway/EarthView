import { Cartesian3, Cartographic } from "cesium";
import { describe, expect, it } from "vitest";
import { BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT, FLIGHT_EASE_SECONDS_DEFAULT } from "../settings/model";
import { viewHeightAtDistanceMeters } from "./cameraFrustum";
import { HOME_HEIGHT_METERS, HOME_LATITUDE_DEG, HOME_LONGITUDE_DEG } from "./homeView";
import {
  cruiseVelocityMetersPerSecond,
  SPEED_REFERENCE_HEIGHT_M,
  sineInOutEase,
  flightCruiseSeconds,
  flightPathLengthMeters,
  flightPositionAt,
  planCameraFlight,
  zoomVelocityMetersPerSecond,
} from "./zoomSpeed";

const FLIGHT_EASE_SECONDS = FLIGHT_EASE_SECONDS_DEFAULT;
const CRUISE_KM_S = BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT;
const WORLD_VELOCITY = CRUISE_KM_S * 1_000;
const FOVY = Math.PI / 3;

const home = Cartesian3.fromDegrees(HOME_LONGITUDE_DEG, HOME_LATITUDE_DEG, HOME_HEIGHT_METERS);
const nadir = Cartesian3.fromDegrees(HOME_LONGITUDE_DEG, HOME_LATITUDE_DEG, 0);
const losAngeles = Cartesian3.fromDegrees(-118.24, 34.05, 20_000);
const tokyo = Cartesian3.fromDegrees(139.69, 35.69, 20_000);
const nearby = Cartesian3.fromDegrees(-118.0, 34.2, 20_000);
const globeWest = Cartesian3.fromDegrees(-118, 34, HOME_HEIGHT_METERS);
const globeEast = Cartesian3.fromDegrees(139, 35, HOME_HEIGHT_METERS);

describe("zoomVelocityMetersPerSecond", () => {
  it("converts the configured base km/s to m/s", () => {
    expect(zoomVelocityMetersPerSecond(CRUISE_KM_S)).toBe(WORLD_VELOCITY);
  });

  it("applies the playback multiplier independently", () => {
    expect(zoomVelocityMetersPerSecond(CRUISE_KM_S, 0.1)).toBe(WORLD_VELOCITY / 10);
    expect(zoomVelocityMetersPerSecond(CRUISE_KM_S, 0.5)).toBe(WORLD_VELOCITY / 2);
  });
});

describe("cruiseVelocityMetersPerSecond", () => {
  it("is the configured km/s at 1,000 km and scales with elevation", () => {
    expect(SPEED_REFERENCE_HEIGHT_M).toBe(1_000_000);
    expect(cruiseVelocityMetersPerSecond(SPEED_REFERENCE_HEIGHT_M, WORLD_VELOCITY)).toBe(
      WORLD_VELOCITY,
    );
    expect(cruiseVelocityMetersPerSecond(2 * SPEED_REFERENCE_HEIGHT_M, WORLD_VELOCITY)).toBe(
      2 * WORLD_VELOCITY,
    );
    expect(cruiseVelocityMetersPerSecond(SPEED_REFERENCE_HEIGHT_M / 2, WORLD_VELOCITY)).toBe(
      WORLD_VELOCITY / 2,
    );

    const globe = cruiseVelocityMetersPerSecond(HOME_HEIGHT_METERS, WORLD_VELOCITY);
    const pad = cruiseVelocityMetersPerSecond(6_000, WORLD_VELOCITY);
    expect(globe).toBeCloseTo(WORLD_VELOCITY * (HOME_HEIGHT_METERS / SPEED_REFERENCE_HEIGHT_M), 5);
    expect(pad).toBeCloseTo(WORLD_VELOCITY * (6_000 / SPEED_REFERENCE_HEIGHT_M), 5);
    expect(globe).toBeGreaterThan(WORLD_VELOCITY);
    expect(pad).toBeLessThan(WORLD_VELOCITY);
  });

  it("scales with the configured km/s slider", () => {
    const full = cruiseVelocityMetersPerSecond(HOME_HEIGHT_METERS, WORLD_VELOCITY);
    const half = cruiseVelocityMetersPerSecond(HOME_HEIGHT_METERS, WORLD_VELOCITY / 2);
    expect(full).toBeCloseTo(half * 2, 5);
  });
});

describe("flightPathLengthMeters", () => {
  it("is the altitude drop for a radial home zoom, not a chord through the Earth", () => {
    expect(flightPathLengthMeters(home, nadir)).toBeCloseTo(HOME_HEIGHT_METERS, -2);
  });

  it("is longer than the ECEF chord when Cesium hops up and across an ocean", () => {
    const chord = Cartesian3.distance(losAngeles, tokyo);
    const path = flightPathLengthMeters(losAngeles, tokyo);
    expect(path).toBeGreaterThan(chord * 1.05);
  });
});

describe("flightPositionAt", () => {
  it("starts at the origin and lands on the destination", () => {
    expect(Cartesian3.distance(flightPositionAt(losAngeles, tokyo, 0), losAngeles)).toBeLessThan(1);
    expect(Cartesian3.distance(flightPositionAt(losAngeles, tokyo, 1), tokyo)).toBeLessThan(1);
  });

  it("climbs above both ends in the middle of an ocean hop", () => {
    const mid = Cartographic.fromCartesian(flightPositionAt(losAngeles, tokyo, 0.5));
    expect(mid.height).toBeGreaterThan(20_000);
  });
});

describe("planCameraFlight", () => {
  it("cruises a globe-scale hop faster than the old km/s cap", () => {
    const plan = planCameraFlight(globeWest, globeEast, CRUISE_KM_S);
    const cruise = flightCruiseSeconds(globeWest, globeEast, WORLD_VELOCITY);
    const path = flightPathLengthMeters(globeWest, globeEast);
    expect(plan.duration).toBeCloseTo(cruise, 5);
    expect(path / cruise).toBeGreaterThan(WORLD_VELOCITY);
  });

  it("takes ten times as long in playback at 0.1×", () => {
    const full = planCameraFlight(home, nadir, CRUISE_KM_S);
    const slow = planCameraFlight(home, nadir, CRUISE_KM_S, 0.1);
    expect(slow.duration).toBeCloseTo(full.duration * 10, 5);
  });

  it("takes about the same time to travel one viewport at a pad and at a large-site altitude", () => {
    const low = fractionalViewportHop(6_000, 0.1);
    const high = fractionalViewportHop(220_000, 0.1);
    const lowPlan = planCameraFlight(low.from, low.to, CRUISE_KM_S, 1, undefined, 0);
    const highPlan = planCameraFlight(high.from, high.to, CRUISE_KM_S, 1, undefined, 0);
    expect(lowPlan.duration / highPlan.duration).toBeCloseTo(1, 1);
  });

  it("does not scream through a short hop at site altitude", () => {
    const plan = planCameraFlight(losAngeles, nearby, CRUISE_KM_S, 1, undefined, 0);
    const worldOnly = flightPathLengthMeters(losAngeles, nearby) / WORLD_VELOCITY;
    expect(plan.duration).toBeGreaterThan(worldOnly * 20);
  });

  it("still spends longer on a trans-Pacific hop than a local one", () => {
    const short = planCameraFlight(losAngeles, nearby, CRUISE_KM_S);
    const long = planCameraFlight(losAngeles, tokyo, CRUISE_KM_S);
    expect(long.duration).toBeGreaterThan(short.duration);
  });

  it("does not add wall-clock ease on top of the hop's own cruise time", () => {
    const cruise = flightCruiseSeconds(globeWest, globeEast, WORLD_VELOCITY);
    const plan = planCameraFlight(globeWest, globeEast, CRUISE_KM_S);
    expect(plan.duration).toBeCloseTo(cruise, 5);
    expect(plan.duration).toBeLessThan(FLIGHT_EASE_SECONDS);
  });

  it("follows elevation-scaled cruise so a boosted middle is faster than the low ends", () => {
    const plan = planCameraFlight(losAngeles, tokyo, CRUISE_KM_S, 1, undefined, 0);
    expect(slope(plan.easingFunction, 0.5)).toBeGreaterThan(slope(plan.easingFunction, 0.05));
    expect(slope(plan.easingFunction, 0.5)).toBeGreaterThan(slope(plan.easingFunction, 0.95));
  });

  it("is slower at the ends with sine ease-in-out than with easing off", () => {
    const eased = planCameraFlight(losAngeles, tokyo, CRUISE_KM_S, 1, undefined, 10);
    const linear = planCameraFlight(losAngeles, tokyo, CRUISE_KM_S, 1, undefined, 0);
    expect(eased.duration).toBeCloseTo(linear.duration, 5);
    expect(wallClockSpeed(eased, 0.05)).toBeLessThan(wallClockSpeed(linear, 0.05));
    expect(wallClockSpeed(eased, eased.duration - 0.05)).toBeLessThan(
      wallClockSpeed(linear, linear.duration - 0.05),
    );
  });

  it("uses the same sine curve whether the slider is 1 s or 10 s", () => {
    const low = planCameraFlight(losAngeles, nearby, CRUISE_KM_S, 1, undefined, 1);
    const high = planCameraFlight(losAngeles, nearby, CRUISE_KM_S, 1, undefined, 10);
    expect(low.duration).toBeCloseTo(high.duration, 5);
    expect(low.easingFunction(0.25)).toBeCloseTo(high.easingFunction(0.25), 8);
  });

  it("flies the elevation-scaled cruise with no extra ramp when easing is off", () => {
    const hop = fractionalViewportHop(6_000, 0.1);
    const plan = planCameraFlight(hop.from, hop.to, CRUISE_KM_S, 1, undefined, 0);
    const cruise = flightCruiseSeconds(hop.from, hop.to, WORLD_VELOCITY);

    expect(plan.duration).toBeCloseTo(cruise, 5);
    expect(slope(plan.easingFunction, 0.02)).toBeCloseTo(slope(plan.easingFunction, 0.5), 5);
  });

  it("uses one sine S-curve instead of a ramp–cruise–ramp plateau", () => {
    const ease = planCameraFlight(losAngeles, tokyo, CRUISE_KM_S).easingFunction;
    expect(ease(0)).toBeCloseTo(0, 8);
    expect(ease(1)).toBeCloseTo(1, 8);
    const mid = slope(ease, 0.5);
    expect(slope(ease, 0.35)).toBeLessThan(mid);
    expect(slope(ease, 0.65)).toBeLessThan(mid);
    expect(slope(ease, 0.02)).toBeLessThan(mid * 0.25);
    expect(slope(ease, 0.98)).toBeLessThan(mid * 0.25);
  });
});

describe("sineInOutEase", () => {
  it("is the standard sine ease-in-out S-curve", () => {
    expect(sineInOutEase(0)).toBeCloseTo(0, 8);
    expect(sineInOutEase(1)).toBeCloseTo(1, 8);
    expect(sineInOutEase(0.5)).toBeCloseTo(0.5, 8);
    expect(sineInOutEase(0.25)).toBeCloseTo((1 - Math.SQRT1_2) / 2, 8);
    expect(sineInOutEase(0.75)).toBeCloseTo((1 + Math.SQRT1_2) / 2, 8);
  });
});

function fractionalViewportHop(
  heightMeters: number,
  fraction: number,
): { from: Cartesian3; to: Cartesian3 } {
  const span = viewHeightAtDistanceMeters(heightMeters, FOVY) * fraction;
  const degrees = span / 111_320;
  return {
    from: Cartesian3.fromDegrees(0, 0, heightMeters),
    to: Cartesian3.fromDegrees(degrees, 0, heightMeters),
  };
}

function slope(ease: (time: number) => number, time: number): number {
  const dt = 1e-4;
  return (ease(time + dt) - ease(time - dt)) / (2 * dt);
}

function wallClockSpeed(plan: { duration: number; easingFunction: (time: number) => number }, wallSeconds: number): number {
  return slope(plan.easingFunction, wallSeconds / plan.duration) / plan.duration;
}
