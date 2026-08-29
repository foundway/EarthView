import { describe, expect, it } from "vitest";
import { beamPositionsDegrees, mapTrendBeam, termHue } from "./trendBeamMapping";

describe("trend beam mapping", () => {
  it("scales score into readable bounded geometry", () => {
    const low = mapTrendBeam(0, 25, "weather");
    const high = mapTrendBeam(100, 1, "weather");
    expect(low.heightMeters).toBe(300_000);
    expect(high.heightMeters).toBe(3_000_000);
    expect(high.widthPixels).toBeGreaterThan(low.widthPixels);
    expect(high.alpha).toBeGreaterThan(low.alpha);
  });

  it("clamps malformed values", () => {
    expect(mapTrendBeam(-50, 999, "x").heightMeters).toBe(300_000);
    expect(mapTrendBeam(500, -4, "x").heightMeters).toBe(3_000_000);
  });

  it("orders beam positions top to base so the glow tapers at the tip", () => {
    expect(beamPositionsDegrees(-98.5, 39.8, 1_200_000)).toEqual([
      -98.5, 39.8, 1_200_000, -98.5, 39.8, 0,
    ]);
  });

  it("keeps term colors deterministic and case-insensitive", () => {
    expect(termHue("Weather")).toBe(termHue("weather"));
    expect(termHue("weather")).toBeGreaterThanOrEqual(0);
    expect(termHue("weather")).toBeLessThan(360);
  });
});
