import { Color, CustomDataSource, HeightReference, JulianDate } from "cesium";
import { describe, expect, it } from "vitest";
import {
  BASE_POINT_DISABLE_DEPTH_TEST_DISTANCE,
  BASE_POINT_PIXEL_SIZE,
  BEAM_ALPHA,
  BEAM_BASE_HEIGHT_M,
  BEAM_FADE_GONE_FRACTION,
  BEAM_FADE_STEPS,
  BEAM_GLOW_POWER,
  BEAM_TAPER_POWER,
  BEAM_WIDTH_PX_DEFAULT,
  beamBasePointGraphics,
  beamFadeAlphaScale,
  beamLineVisible,
  beamVisibleFraction,
  quantizeBeamFade,
} from "./beamGlow";
import { BEAM_ALPHA_DEFAULT } from "../settings/model";
import { BEAM_CORE_WIDTH_PX } from "./beamThinning";

describe("beam contact dot", () => {
  it("stands on the surface instead of above it", () => {
    expect(BEAM_BASE_HEIGHT_M).toBe(0);
  });

  /*
   * The dot, the billed centerline, the request footprint, and the ellipsoid
   * all occupy the same surface. A depth-tested point there flickers as the
   * camera moves. Skipping the depth test keeps it planted without the 1500 m
   * lift that parallaxed it off the road.
   */
  it("does not depth-test the draped ground it sits on", () => {
    expect(BASE_POINT_DISABLE_DEPTH_TEST_DISTANCE).toBe(Number.POSITIVE_INFINITY);
    expect(BASE_POINT_PIXEL_SIZE).toBe(6);

    const graphics = beamBasePointGraphics(Color.BLUE, 1);
    expect(graphics.pixelSize).toBe(6);
    expect(graphics.heightReference).toBe(HeightReference.CLAMP_TO_GROUND);
    expect(graphics.disableDepthTestDistance).toBe(Number.POSITIVE_INFINITY);

    const source = new CustomDataSource("beam-base");
    const entity = source.entities.add({
      point: graphics,
    });

    const now = JulianDate.now();
    expect(entity.point?.pixelSize?.getValue(now)).toBe(6);
    expect(entity.point?.heightReference?.getValue(now)).toBe(HeightReference.CLAMP_TO_GROUND);
    expect(entity.point?.disableDepthTestDistance?.getValue(now)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe("beam width", () => {
  it("defaults to an 8 px glow strip", () => {
    expect(BEAM_WIDTH_PX_DEFAULT).toBe(8);
  });

  it("is the width beam thinning measures its spacing in", () => {
    expect(BEAM_CORE_WIDTH_PX).toBe(BEAM_WIDTH_PX_DEFAULT);
  });

  it("keeps the glow inside the strip instead of bleaching to white", () => {
    expect(BEAM_ALPHA).toBe(BEAM_ALPHA_DEFAULT);
    expect(BEAM_ALPHA).toBeGreaterThan(0.5);
    expect(BEAM_ALPHA).toBeLessThan(1);
    expect(BEAM_GLOW_POWER).toBe(0.14);
    expect(BEAM_GLOW_POWER).toBeLessThan(0.18);
    expect(BEAM_TAPER_POWER).toBeGreaterThan(0);
    expect(BEAM_TAPER_POWER).toBeLessThan(1);
  });
});

/** Cesium's default vertical field of view, near enough for these ratios. */
const FOV = Math.PI / 4;
/** The shortest beam any request gets (MIN_BEAM_HEIGHT_M). */
const SHORTEST_BEAM_M = 680_000;

describe("beamVisibleFraction", () => {
  it("reports the whole beam fitting from a full-disk view", () => {
    expect(beamVisibleFraction(SHORTEST_BEAM_M, 20_000_000, FOV)).toBeGreaterThan(1);
  });

  it("reports a sliver once the camera is inside the beam's own length", () => {
    expect(beamVisibleFraction(SHORTEST_BEAM_M, 50_000, FOV)).toBeLessThan(0.1);
  });

  it("grows as the camera pulls back", () => {
    const near = beamVisibleFraction(SHORTEST_BEAM_M, 200_000, FOV);
    const far = beamVisibleFraction(SHORTEST_BEAM_M, 800_000, FOV);
    expect(far).toBeCloseTo(near * 4);
  });

  it("shows more of a shorter beam at the same distance", () => {
    expect(beamVisibleFraction(680_000, 500_000, FOV)).toBeGreaterThan(
      beamVisibleFraction(6_000_000, 500_000, FOV),
    );
  });

  it("treats a zero-length beam as fitting rather than dividing by zero", () => {
    expect(beamVisibleFraction(0, 1_000, FOV)).toBe(1);
  });
});

describe("beamFadeAlphaScale", () => {
  it("leaves a beam alone while its whole length is on screen", () => {
    expect(beamFadeAlphaScale(1)).toBe(1);
    expect(beamFadeAlphaScale(12)).toBe(1);
  });

  it("removes a beam once almost none of its length fits", () => {
    expect(beamFadeAlphaScale(BEAM_FADE_GONE_FRACTION)).toBe(0);
    expect(beamFadeAlphaScale(0.05)).toBe(0);
  });

  it("fades monotonically in between, with no jump at either end", () => {
    expect(beamFadeAlphaScale(0.31)).toBeGreaterThan(0);
    expect(beamFadeAlphaScale(0.31)).toBeLessThan(0.05);
    expect(beamFadeAlphaScale(0.99)).toBeGreaterThan(0.95);

    let previous = 0;
    for (const fraction of [0.3, 0.4, 0.5, 0.65, 0.8, 0.95, 1]) {
      const alpha = beamFadeAlphaScale(fraction);
      expect(alpha).toBeGreaterThanOrEqual(previous);
      previous = alpha;
    }
  });

  it("survives a camera that reports no useful distance", () => {
    expect(beamFadeAlphaScale(Number.NaN)).toBe(1);
    expect(beamFadeAlphaScale(Infinity)).toBe(1);
  });
});

describe("beam fade over the altitudes people actually use", () => {
  const fadeAt = (altitude: number, height = SHORTEST_BEAM_M): number =>
    beamFadeAlphaScale(beamVisibleFraction(height, altitude, FOV));

  it("keeps every beam at full strength from orbit", () => {
    expect(fadeAt(20_000_000)).toBe(1);
    expect(fadeAt(20_000_000, 6_000_000)).toBe(1);
  });

  it("has beams gone by the time the ground geometry is the point", () => {
    expect(fadeAt(6_000)).toBe(0);
    expect(fadeAt(100_000)).toBe(0);
  });

  it("fades across the band between, rather than switching off", () => {
    const band = [300_000, 500_000, 700_000].map((altitude) => fadeAt(altitude));
    for (const alpha of band) {
      expect(alpha).toBeGreaterThan(0);
      expect(alpha).toBeLessThan(1);
    }
    expect(band[0]).toBeLessThan(band[2]);
  });
});

describe("beamLineVisible", () => {
  it("draws only a facing beam that still has height and fade left", () => {
    expect(beamLineVisible(true, 680_000, 1)).toBe(true);
    expect(beamLineVisible(false, 680_000, 1)).toBe(false);
    expect(beamLineVisible(true, 0, 1)).toBe(false);
    expect(beamLineVisible(true, 680_000, 0)).toBe(false);
  });
});

describe("quantizeBeamFade", () => {
  it("snaps to steps so a still camera rebuilds no materials", () => {
    expect(quantizeBeamFade(0.5)).toBe(quantizeBeamFade(0.5 + 1 / (BEAM_FADE_STEPS * 4)));
  });

  it("keeps the ends exact — a full beam is not dimmed and a gone one is gone", () => {
    expect(quantizeBeamFade(1)).toBe(1);
    expect(quantizeBeamFade(0)).toBe(0);
  });

  it("stays within a step of the value it replaces", () => {
    for (const scale of [0.02, 0.19, 0.37, 0.62, 0.88, 0.97]) {
      expect(Math.abs(quantizeBeamFade(scale) - scale)).toBeLessThanOrEqual(
        1 / (2 * BEAM_FADE_STEPS),
      );
    }
  });
});
