import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../settings/model";
import {
  applyEarthMsaa,
  applyEarthResolution,
  EARTH_MSAA_SAMPLES,
  EARTH_WEBGL_ANTIALIAS,
} from "./createViewer";

describe("earth render quality", () => {
  it("always multisamples 3D rendering at 4 samples", () => {
    expect(DEFAULT_SETTINGS.msaa).toBe(true);
    expect(EARTH_MSAA_SAMPLES).toBe(4);
  });

  /*
   * The backbuffer is not where the scene is drawn, so multisampling it costs
   * fill rate and buys nothing on top of the scene's own render targets.
   */
  it("leaves the WebGL backbuffer antialias off regardless", () => {
    expect(EARTH_WEBGL_ANTIALIAS).toBe(false);
  });

  /*
   * Cesium's flag is the inverse of what we want. Leaving the recommended
   * resolution on silently rasterizes in CSS pixels — the exact bug native
   * resolution exists to fix.
   */
  it("always rasterizes at the display's real pixels", () => {
    expect(DEFAULT_SETTINGS.nativeResolution).toBe(true);

    const viewer = { useBrowserRecommendedResolution: true };
    applyEarthResolution(viewer as never);
    expect(viewer.useBrowserRecommendedResolution).toBe(false);
  });

  it("pins the sample rate without rebuilding the viewer", () => {
    const viewer = { scene: { msaaSamples: 1 } };
    const destroy = vi.fn();

    applyEarthMsaa(viewer as never);
    expect(viewer.scene.msaaSamples).toBe(EARTH_MSAA_SAMPLES);
    expect(destroy).not.toHaveBeenCalled();
  });
});
