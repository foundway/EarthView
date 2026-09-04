import { CameraEventType } from "cesium";
import { describe, expect, it } from "vitest";
import {
  applyEarthCameraControls,
  clampZoomDeltaMeters,
  MIN_CAMERA_HEIGHT_M,
  MAX_CAMERA_HEIGHT_M,
  PINCH_SENSITIVITY,
  ZOOM_EVENT_TYPES,
  pinchZoomDeltaFromWheel,
  pinchZoomDeltaMeters,
} from "./cameraControls";
import { dollyDeltaFromScaleRatio, dollyDeltaFromWheel } from "./screenSpaceMotion";

describe("earth camera controls", () => {
  it("leaves touch pinch on Cesium and takes wheel so dolly can use live elevation", () => {
    expect(ZOOM_EVENT_TYPES).toContain(CameraEventType.PINCH);
    expect(ZOOM_EVENT_TYPES).not.toContain(CameraEventType.WHEEL);
    expect(ZOOM_EVENT_TYPES).not.toContain(CameraEventType.RIGHT_DRAG);
  });

  it("scales pinch zoom by 10 against live elevation", () => {
    expect(PINCH_SENSITIVITY).toBe(10);
    expect(pinchZoomDeltaMeters(1_000, 1.1)).toBeCloseTo(
      dollyDeltaFromScaleRatio(1_000, 1.1) * PINCH_SENSITIVITY,
    );

    const wheelUnscaled = dollyDeltaFromWheel(1_000, -10, 800);
    expect(pinchZoomDeltaFromWheel(1_000, -10, 800)).toBeCloseTo(wheelUnscaled * 10);
    expect(pinchZoomDeltaFromWheel(1_000, -10, 800, 2)).toBeCloseTo(wheelUnscaled * 20);
  });

  /*
   * Under the ellipsoid the globe is backface-culled, so the Earth simply is
   * not drawn — the beams keep standing in an empty starfield and only Home
   * recovers. One pinch can ask for several times the camera's height, so the
   * clamp is the only thing standing between a fast gesture and that state.
   */
  it("never lets a zoom-in carry the camera under the ellipsoid", () => {
    // A single pinch at 1 km asks to travel 5 km — five times the height.
    expect(pinchZoomDeltaFromWheel(1_000, -1_000, 800)).toBeGreaterThan(1_000);

    // Each event may take at most 10% of current elevation, and never the
    // last kilometre, so a burst of zoom-in slows instead of dumping to the floor.
    expect(clampZoomDeltaMeters(10_000, 50_000)).toBe(1_000);
    expect(clampZoomDeltaMeters(2_000, 5_000)).toBe(200);
    expect(clampZoomDeltaMeters(MIN_CAMERA_HEIGHT_M, 10)).toBe(0);
    expect(clampZoomDeltaMeters(10, 10)).toBe(0);
  });

  it("slows successive zoom-in ticks as live elevation drops", () => {
    let height = 16_000_000;
    const ticks: number[] = [];
    for (let i = 0; i < 20; i++) {
      const raw = dollyDeltaFromWheel(height, -100, 800);
      const delta = clampZoomDeltaMeters(height, raw);
      expect(delta).toBeGreaterThan(0);
      ticks.push(delta);
      height -= delta;
    }
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeLessThan(ticks[i - 1]!);
    }
    expect(ticks[ticks.length - 1]!).toBeLessThan(ticks[0]! * 0.2);
    expect(height).toBeGreaterThan(1_000_000);
  });

  it("leaves zoom-outs alone so a buried camera can always climb back", () => {
    expect(clampZoomDeltaMeters(10, -5_000)).toBe(-5_000);
    expect(clampZoomDeltaMeters(Number.NaN, -5_000)).toBe(-5_000);
    expect(clampZoomDeltaMeters(Number.NaN, 5_000)).toBe(0);
  });

  it("caps a zoom-out at the marble ceiling", () => {
    expect(clampZoomDeltaMeters(MAX_CAMERA_HEIGHT_M, -5_000)).toBe(0);
    expect(clampZoomDeltaMeters(MAX_CAMERA_HEIGHT_M - 1_000, -5_000)).toBe(-1_000);
  });

  it("keeps Cesium left-drag rotate and turns tilt and look off", () => {
    const controls = {
      enableZoom: false,
      enableRotate: false,
      enableTilt: true,
      enableLook: true,
      zoomEventTypes: [] as unknown,
      tiltEventTypes: [CameraEventType.RIGHT_DRAG] as unknown,
      lookEventTypes: [CameraEventType.RIGHT_DRAG] as unknown,
      minimumZoomDistance: 1,
      minimumPickingTerrainHeight: 150_000,
      minimumTrackBallHeight: 7_500_000,
      _minimumRotateRate: 1 / 5000,
      _maximumRotateRate: 1.77,
    };

    applyEarthCameraControls(controls as never);

    expect(controls.enableRotate).toBe(true);
    expect(controls.enableTilt).toBe(false);
    expect(controls.enableLook).toBe(false);
    expect(controls.tiltEventTypes).toEqual([]);
    expect(controls.lookEventTypes).toEqual([]);
    expect(controls.minimumZoomDistance).toBe(MIN_CAMERA_HEIGHT_M);
    expect(controls.minimumPickingTerrainHeight).toBe(0);
    expect(controls.minimumTrackBallHeight).toBe(0);
    expect(controls._minimumRotateRate).toBe(0);
    expect(controls._maximumRotateRate).toBe(Number.POSITIVE_INFINITY);
  });
});
