import { CameraEventType } from "cesium";
import { describe, expect, it } from "vitest";
import {
  PINCH_SENSITIVITY,
  TILT_EVENT_TYPES,
  ZOOM_EVENT_TYPES,
  pinchZoomDeltaFromWheel,
  pinchZoomDeltaMeters,
} from "./cameraControls";

describe("Earth camera controls", () => {
  it("keeps wheel and touch pinch as Cesium zoom inputs", () => {
    expect(ZOOM_EVENT_TYPES).toContain(CameraEventType.WHEEL);
    expect(ZOOM_EVENT_TYPES).toContain(CameraEventType.PINCH);
  });

  it("does not bind touch pinch to tilt", () => {
    expect(TILT_EVENT_TYPES).not.toContain(CameraEventType.PINCH);
  });

  it("applies the documented 10x trackpad-pinch sensitivity", () => {
    expect(PINCH_SENSITIVITY).toBe(10);
    expect(pinchZoomDeltaMeters(1_000, 1.1)).toBeCloseTo(1_000);

    const unscaled = 5 * 1_000 * Math.min((7.5 * ((10 * Math.PI) / 180)) / 800, 0.1);
    expect(pinchZoomDeltaFromWheel(1_000, -10, 800)).toBeCloseTo(unscaled * 10);
  });
});
