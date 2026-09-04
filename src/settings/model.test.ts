import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  parseSettings,
  clampCameraSpeed,
  clampBaseZoomSpeedKmPerSecond,
} from "./model";

describe("earthview settings", () => {
  it("clamps camera controls to the documented ranges", () => {
    expect(clampCameraSpeed(0)).toBe(1);
    expect(clampCameraSpeed(99)).toBe(10);
    expect(clampBaseZoomSpeedKmPerSecond(50)).toBe(100);
    expect(clampBaseZoomSpeedKmPerSecond(9_000)).toBe(4_000);
  });

  it("fills missing blobs with the live defaults", () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ dollySpeed: 3 }).dollySpeed).toBe(3);
  });
});
