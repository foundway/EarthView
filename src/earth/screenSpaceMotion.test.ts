import { Cartesian3 } from "cesium";
import { describe, expect, it } from "vitest";
import { viewHeightAtDistanceMeters } from "./cameraFrustum";
import { MIN_CAMERA_HEIGHT_M } from "./cameraControls";
import {
  CESIUM_MAXIMUM_MOVEMENT_RATIO,
  CESIUM_ZOOM_FACTOR,
  LOOK_AT_MIN_GRAZE_RADIANS,
  dollyDeltaFromScaleRatio,
  dollyDeltaFromWheel,
  lookAtRangeMeters,
  panMetersPerPixel,
  panOffsetMeters,
  panRadiansPerPixel,
  SPEED_REFERENCE_HEIGHT_M,
  elevationSpeedScale,
} from "./screenSpaceMotion";

const FOVY = Math.PI / 3;
const CANVAS_HEIGHT = 800;

describe("lookAtRangeMeters", () => {
  it("is ellipsoid height when looking nadir", () => {
    const height = 1_000;
    const pose = nadirPose(-119.4, 36.8, height);
    expect(lookAtRangeMeters(pose, MIN_CAMERA_HEIGHT_M)).toBeCloseTo(height, 0);
  });

  it("grows with tilt so a 45° view scales the same as nadir at greater range", () => {
    const height = 1_000;
    const nadir = lookAtRangeMeters(nadirPose(0, 0, height), MIN_CAMERA_HEIGHT_M);
    const tilted = lookAtRangeMeters(tiltedPose(0, 0, height, Math.PI / 4), MIN_CAMERA_HEIGHT_M);
    expect(tilted).toBeGreaterThan(nadir * 1.3);
    expect(tilted).toBeCloseTo(height / Math.cos(Math.PI / 4), -1);
  });

  it("caps a grazing horizon ray so dolly cannot jump a continent", () => {
    const height = 1_000;
    const range = lookAtRangeMeters(tiltedPose(0, 0, height, (85 * Math.PI) / 180), MIN_CAMERA_HEIGHT_M);
    expect(range).toBeCloseTo(height / Math.sin(LOOK_AT_MIN_GRAZE_RADIANS), 4);
  });

  it("falls back to height when the view misses the globe", () => {
    const height = 16_000_000;
    const pose = nadirPose(-119.4, 36.8, height);
    const outward = {
      position: pose.position,
      direction: Cartesian3.negate(pose.direction, new Cartesian3()),
      heightMeters: height,
    };
    expect(lookAtRangeMeters(outward, MIN_CAMERA_HEIGHT_M)).toBe(height);
  });
});

describe("elevationSpeedScale", () => {
  it("is 1 at 1,000 km and scales linearly with height", () => {
    expect(elevationSpeedScale(SPEED_REFERENCE_HEIGHT_M)).toBe(1);
    expect(elevationSpeedScale(2 * SPEED_REFERENCE_HEIGHT_M)).toBe(2);
    expect(elevationSpeedScale(6_000)).toBeCloseTo(0.006, 10);
    expect(elevationSpeedScale(0)).toBe(0);
  });
});

describe("screen-space pan and dolly", () => {
  it("moves the same fraction of the view per pixel at 6 km and at 16,000 km", () => {
    const low = panMetersPerPixel(6_000, FOVY, CANVAS_HEIGHT);
    const high = panMetersPerPixel(16_000_000, FOVY, CANVAS_HEIGHT);
    const pixels = 40;
    expect((pixels * low) / viewHeightAtDistanceMeters(6_000, FOVY)).toBeCloseTo(
      pixels / CANVAS_HEIGHT,
      10,
    );
    expect((pixels * high) / viewHeightAtDistanceMeters(16_000_000, FOVY)).toBeCloseTo(
      pixels / CANVAS_HEIGHT,
      10,
    );
  });

  it("pans by an angle that does not depend on look-at range", () => {
    const radians = panRadiansPerPixel(FOVY, CANVAS_HEIGHT);
    expect(radians * 40).toBeCloseTo((40 / CANVAS_HEIGHT) * 2 * Math.tan(FOVY / 2), 10);
    expect(panMetersPerPixel(6_000, FOVY, CANVAS_HEIGHT)).toBeCloseTo(radians * 6_000, 10);
    expect(panMetersPerPixel(16_000_000, FOVY, CANVAS_HEIGHT)).toBeCloseTo(
      radians * 16_000_000,
      10,
    );
  });

  it("covers the same fraction of elevation per wheel tick at 1 km and 100 km", () => {
    const near = dollyDeltaFromWheel(1_000, -10, CANVAS_HEIGHT);
    const far = dollyDeltaFromWheel(100_000, -10, CANVAS_HEIGHT);
    expect(near / 1_000).toBeCloseTo(far / 100_000, 10);
  });

  it("slows each zoom-in tick as elevation drops", () => {
    const high = dollyDeltaFromWheel(16_000_000, -100, CANVAS_HEIGHT);
    const reference = dollyDeltaFromWheel(1_000_000, -100, CANVAS_HEIGHT);
    const low = dollyDeltaFromWheel(6_000, -100, CANVAS_HEIGHT);
    expect(high).toBeCloseTo(reference * 16, 5);
    expect(low).toBeCloseTo(reference * 0.006, 8);
    expect(high).toBeGreaterThan(reference);
    expect(reference).toBeGreaterThan(low);
  });

  it("keeps Cesium's tick cap against live elevation, not look-at range", () => {
    const tick = dollyDeltaFromWheel(200_000, -10, CANVAS_HEIGHT);
    expect(tick / 200_000).toBeLessThanOrEqual(CESIUM_ZOOM_FACTOR * CESIUM_MAXIMUM_MOVEMENT_RATIO);
  });

  it("treats a pinch scale ratio as a multiplicative zoom of current elevation", () => {
    expect(dollyDeltaFromScaleRatio(2_000, 1.1)).toBeCloseTo(200);
    expect(dollyDeltaFromScaleRatio(20_000_000, 1.1) / 20_000_000).toBeCloseTo(
      dollyDeltaFromScaleRatio(2_000, 1.1) / 2_000,
      10,
    );
  });

  it("doubles pan and dolly when the matching speed is 2×", () => {
    const pan = panOffsetMeters(6_000, FOVY, CANVAS_HEIGHT, 40, 0, 1);
    const panFast = panOffsetMeters(6_000, FOVY, CANVAS_HEIGHT, 40, 0, 2);
    expect(panFast.rightMeters).toBeCloseTo(pan.rightMeters * 2, 10);

    const dolly = dollyDeltaFromWheel(6_000, -10, CANVAS_HEIGHT, 1);
    expect(dollyDeltaFromWheel(6_000, -10, CANVAS_HEIGHT, 2)).toBeCloseTo(dolly * 2, 10);
    expect(dollyDeltaFromScaleRatio(6_000, 1.1, 2)).toBeCloseTo(
      dollyDeltaFromScaleRatio(6_000, 1.1, 1) * 2,
      10,
    );
  });
});

function nadirPose(longitude: number, latitude: number, height: number) {
  const position = Cartesian3.fromDegrees(longitude, latitude, height);
  const surface = Cartesian3.fromDegrees(longitude, latitude, 0);
  return {
    position,
    direction: Cartesian3.normalize(
      Cartesian3.subtract(surface, position, new Cartesian3()),
      new Cartesian3(),
    ),
    heightMeters: height,
  };
}

function tiltedPose(
  longitude: number,
  latitude: number,
  height: number,
  tiltFromNadir: number,
) {
  const nadir = nadirPose(longitude, latitude, height);
  const east = Cartesian3.cross(Cartesian3.UNIT_Z, nadir.position, new Cartesian3());
  Cartesian3.normalize(east, east);
  const direction = new Cartesian3();
  Cartesian3.multiplyByScalar(nadir.direction, Math.cos(tiltFromNadir), direction);
  Cartesian3.add(
    direction,
    Cartesian3.multiplyByScalar(east, Math.sin(tiltFromNadir), new Cartesian3()),
    direction,
  );
  Cartesian3.normalize(direction, direction);
  return { ...nadir, direction };
}
