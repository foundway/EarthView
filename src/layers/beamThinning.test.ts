import { describe, expect, it } from "vitest";
import { viewHeightAtDistanceMeters } from "../earth/cameraFrustum";
import {
  BEAM_CORE_WIDTH_PX,
  samplingRadiusPx,
  THIN_HOLD_FRACTION,
  THIN_RELEASE_FULL_SPREAD,
  THIN_RELEASE_OFF_SPREAD,
  thinByPartition,
  thinByPoissonDisk,
  thinReleaseScale,
  type ThinCandidate,
} from "./beamThinning";

/** Shortest readable beam height — same floor Marauder uses for a short measure. */
const MIN_BEAM_HEIGHT_M = 680_000;

/** Cesium's default horizontal field of view. */
const CESIUM_FOV = (60 * Math.PI) / 180;

function candidate(id: string, x: number, y = 0, weight = 1): ThinCandidate {
  return { id, x, y, weight };
}

/** Every candidate must come back exactly once, as a sample or absorbed by one. */
function accountedIds(samples: readonly { id: string; absorbedIds: readonly string[] }[]): string[] {
  return samples.flatMap((sample) => [sample.id, ...sample.absorbedIds]).sort();
}

describe("samplingRadiusPx", () => {
  it("measures spacing in beam widths", () => {
    expect(samplingRadiusPx(1)).toBe(BEAM_CORE_WIDTH_PX);
    expect(samplingRadiusPx(2.5)).toBe(BEAM_CORE_WIDTH_PX * 2.5);
  });

  it("treats a non-positive or unusable spacing as no thinning", () => {
    expect(samplingRadiusPx(0)).toBe(0);
    expect(samplingRadiusPx(-3)).toBe(0);
    expect(samplingRadiusPx(Number.NaN)).toBe(0);
  });

  it("widens the spacing with the beams themselves", () => {
    // The viewer's width slider is part of what a core is: fat beams at the
    // old radius would overlap into the wall thinning exists to break up.
    expect(samplingRadiusPx(1, 1, 8)).toBe(8);
    expect(samplingRadiusPx(1, 1, 2)).toBe(2);
    expect(samplingRadiusPx(1, 1, 0)).toBe(BEAM_CORE_WIDTH_PX);
    expect(samplingRadiusPx(1, 1, Number.NaN)).toBe(BEAM_CORE_WIDTH_PX);
  });

  it("scales the spacing by the camera's release", () => {
    expect(samplingRadiusPx(2, 1)).toBe(BEAM_CORE_WIDTH_PX * 2);
    expect(samplingRadiusPx(2, 0.5)).toBe(BEAM_CORE_WIDTH_PX);
    expect(samplingRadiusPx(2, 0)).toBe(0);
    // A released spacing of zero is what makes a zoomed-in globe unthinned.
    expect(thinByPoissonDisk([candidate("a", 0), candidate("b", 1)], samplingRadiusPx(4, 0))).toHaveLength(2);
  });
});

describe("thinReleaseScale", () => {
  it("thins at full spacing while the shortest beam fits many times over", () => {
    expect(thinReleaseScale(THIN_RELEASE_FULL_SPREAD)).toBe(1);
    expect(thinReleaseScale(40)).toBe(1);
  });

  it("stops thinning entirely by the time the shortest beam stops fitting", () => {
    // The floor is where beamFadeAlphaScale starts dimming the shortest beam,
    // so thinning and fading hand off instead of both hiding the same beam.
    expect(thinReleaseScale(THIN_RELEASE_OFF_SPREAD)).toBe(0);
    expect(thinReleaseScale(0.4)).toBe(0);
  });

  it("ramps monotonically in between so beams arrive as you zoom", () => {
    const spreads = [1, 1.5, 2, 2.5, 3, 3.5, 4];
    const scales = spreads.map(thinReleaseScale);
    for (let index = 1; index < scales.length; index += 1) {
      expect(scales[index]).toBeGreaterThan(scales[index - 1]);
    }
    expect(scales.every((scale) => scale >= 0 && scale <= 1)).toBe(true);
  });

  it("is smoothstepped, so it leaves the endpoints flat rather than lurching", () => {
    const band = THIN_RELEASE_FULL_SPREAD - THIN_RELEASE_OFF_SPREAD;
    expect(thinReleaseScale(THIN_RELEASE_OFF_SPREAD + band / 2)).toBeCloseTo(0.5, 5);
    // 15% into the band moves far less than a linear ramp would.
    expect(thinReleaseScale(THIN_RELEASE_OFF_SPREAD + band * 0.15)).toBeLessThan(0.1);
    expect(thinReleaseScale(THIN_RELEASE_FULL_SPREAD - band * 0.15)).toBeGreaterThan(0.9);
  });

  it("keeps thinning when the framing is unknown", () => {
    expect(thinReleaseScale(Number.NaN)).toBe(1);
  });
});

describe("the altitudes the release lands on", () => {
  // Cesium derives fovy from its 60° fov and the window aspect; ~35.9° is a
  // 16:9 window. The point of pinning this is that the thresholds are chosen
  // against what the globe looks like at a given camera height, and reading
  // them as bare spread numbers hides that entirely.
  const FOVY_16_BY_9 = 2 * Math.atan(Math.tan(CESIUM_FOV / 2) / (16 / 9));
  const releaseAt = (cameraHeightMeters: number): number =>
    thinReleaseScale(
      viewHeightAtDistanceMeters(cameraHeightMeters, FOVY_16_BY_9) / MIN_BEAM_HEIGHT_M,
    );

  it("thins at full spacing across the overview, continental view included", () => {
    // A US-wide view sits near 5,000 km, and that is where the wall of
    // overlapping beams shows up — full spacing must still apply there.
    expect(releaseAt(18_000_000)).toBe(1);
    expect(releaseAt(8_000_000)).toBe(1);
    expect(releaseAt(5_000_000)).toBe(1);
  });

  it("gives beams back through the regional zoom", () => {
    const regional = releaseAt(3_000_000);
    expect(regional).toBeGreaterThan(0);
    expect(regional).toBeLessThan(1);
    expect(releaseAt(2_000_000)).toBeLessThan(regional);
  });

  it("is off entirely by the time you are looking at one metro", () => {
    expect(releaseAt(1_000_000)).toBe(0);
    expect(releaseAt(400_000)).toBe(0);
    expect(releaseAt(50_000)).toBe(0);
    // Which is what makes a zoomed-in globe render every request.
    expect(samplingRadiusPx(1, releaseAt(400_000))).toBe(0);
  });
});

describe("thinByPoissonDisk", () => {
  it("keeps every candidate when none of them overlap", () => {
    const samples = thinByPoissonDisk(
      [candidate("a", 0), candidate("b", 40), candidate("c", 80)],
      10,
    );

    expect(samples.map((sample) => sample.id)).toEqual(["a", "b", "c"]);
    expect(samples.every((sample) => sample.absorbedIds.length === 0)).toBe(true);
  });

  it("passes candidates straight through when thinning is off", () => {
    const points = [candidate("a", 0), candidate("b", 1)];
    expect(thinByPoissonDisk(points, 0).map((sample) => sample.id)).toEqual(["a", "b"]);
    expect(thinByPoissonDisk([candidate("only", 0)], 10)).toEqual([
      { id: "only", absorbedIds: [] },
    ]);
  });

  it("gives the slot to the heaviest candidate, not the first", () => {
    const samples = thinByPoissonDisk(
      [candidate("small", 0, 0, 2_000), candidate("big", 3, 0, 400_000)],
      10,
    );

    expect(samples).toEqual([{ id: "big", absorbedIds: ["small"] }]);
  });

  it("breaks equal weights on id so the same camera draws the same beams", () => {
    const points = [candidate("b", 0), candidate("a", 3)];
    expect(thinByPoissonDisk(points, 10)).toEqual([{ id: "a", absorbedIds: ["b"] }]);
    expect(thinByPoissonDisk([...points].reverse(), 10)).toEqual([
      { id: "a", absorbedIds: ["b"] },
    ]);
  });

  it("thins a crowd to the number that fits rather than to one beam", () => {
    // 50 beams packed 2 px apart across 100 px. Merging would draw 1; drawing
    // them all is the solid wall. At 10 px spacing the answer is 10.
    const crowd = Array.from({ length: 50 }, (_, index) =>
      candidate(`p${String(index).padStart(2, "0")}`, index * 2),
    );

    const samples = thinByPoissonDisk(crowd, 10);

    expect(samples).toHaveLength(10);
    expect(accountedIds(samples)).toEqual(crowd.map((point) => point.id).sort());
  });

  it("keeps sparse regions intact while thinning dense ones", () => {
    const dense = Array.from({ length: 20 }, (_, index) =>
      candidate(`d${String(index).padStart(2, "0")}`, index),
    );
    const sparse = [candidate("s0", 200), candidate("s1", 240), candidate("s2", 280)];

    const samples = thinByPoissonDisk([...dense, ...sparse], 10);
    const survivors = new Set(samples.map((sample) => sample.id));

    expect(survivors.has("s0")).toBe(true);
    expect(survivors.has("s1")).toBe(true);
    expect(survivors.has("s2")).toBe(true);
    expect(samples.filter((sample) => sample.id.startsWith("d"))).toHaveLength(2);
  });

  it("attributes a suppressed candidate to the nearest survivor", () => {
    const samples = thinByPoissonDisk(
      [
        candidate("near-origin", 0, 0, 30),
        candidate("far", 30, 0, 20),
        candidate("crowder", 22, 0, 1),
      ],
      10,
    );

    expect(samples).toEqual([
      { id: "far", absorbedIds: ["crowder"] },
      { id: "near-origin", absorbedIds: [] },
    ]);
  });

  it("accounts for every candidate exactly once", () => {
    const scattered = Array.from({ length: 200 }, (_, index) =>
      candidate(
        `n${String(index).padStart(3, "0")}`,
        (index * 37) % 240,
        (index * 91) % 160,
        (index * 13) % 97,
      ),
    );

    const samples = thinByPoissonDisk(scattered, 12);

    expect(accountedIds(samples)).toEqual(scattered.map((point) => point.id).sort());
  });

  it("holds a lit beam through camera drift, then releases it", () => {
    const apart = thinByPoissonDisk([candidate("a", 0, 0, 9), candidate("b", 12, 0, 8)], 10);
    const lit = new Set(apart.map((sample) => sample.id));
    expect(lit).toEqual(new Set(["a", "b"]));

    // 8 px is inside the 10 px accept radius but outside the 7 px release
    // radius, so a pair that was already lit stays lit.
    const held = thinByPoissonDisk([candidate("a", 0, 0, 9), candidate("b", 8, 0, 8)], 10, lit);
    expect(held).toHaveLength(2);

    const released = thinByPoissonDisk(
      [candidate("a", 0, 0, 9), candidate("b", 6, 0, 8)],
      10,
      lit,
    );
    expect(released).toEqual([{ id: "a", absorbedIds: ["b"] }]);
  });

  it("requires the full radius for a beam that was not already lit", () => {
    const fresh = thinByPoissonDisk([candidate("a", 0, 0, 9), candidate("b", 8, 0, 8)], 10);
    expect(fresh).toEqual([{ id: "a", absorbedIds: ["b"] }]);
    expect(THIN_HOLD_FRACTION).toBeLessThan(1);
  });

  it("does not let held beams pile up when the camera zooms out", () => {
    const lit = new Set(["a", "b", "c"]);
    const samples = thinByPoissonDisk(
      [candidate("a", 0, 0, 3), candidate("b", 2, 0, 2), candidate("c", 4, 0, 1)],
      10,
      lit,
    );

    expect(samples).toEqual([{ id: "a", absorbedIds: ["b", "c"] }]);
  });
});

describe("thinByPartition", () => {
  function part(
    id: string,
    x: number,
    partition: string,
    weight = 1,
  ): ThinCandidate & { partition: string } {
    return { ...candidate(id, x, 0, weight), partition };
  }

  it("never absorbs across a partition, however crowded", () => {
    const samples = thinByPartition(
      [
        part("new-heavy", 0, "distance:new", 400_000),
        part("seen-light", 2, "distance:seen", 1_000),
        part("area-one", 4, "area:seen", 9_000),
      ],
      10,
    );

    // One pile of pixels, three partitions: nothing may swallow anything.
    expect(samples).toEqual([
      { id: "area-one", absorbedIds: [] },
      { id: "new-heavy", absorbedIds: [] },
      { id: "seen-light", absorbedIds: [] },
    ]);
  });

  it("thins normally inside a partition, so new beams do not stack up", () => {
    const newCrowd = [
      part("new-a", 0, "distance:new", 300),
      part("new-b", 2, "distance:new", 200),
      part("new-c", 4, "distance:new", 100),
    ];
    const samples = thinByPartition([...newCrowd, part("seen", 3, "distance:seen")], 10);

    expect(samples).toEqual([
      { id: "new-a", absorbedIds: ["new-b", "new-c"] },
      { id: "seen", absorbedIds: [] },
    ]);
    expect(accountedIds(samples)).toEqual(["new-a", "new-b", "new-c", "seen"]);
  });

  it("orders partitions the same way whatever order the candidates arrive in", () => {
    const candidates = [
      part("z", 0, "distance:seen", 5),
      part("a", 60, "area:seen", 5),
      part("m", 120, "distance:new", 5),
    ];
    const forward = thinByPartition(candidates, 10).map((sample) => sample.id);
    const reversed = thinByPartition([...candidates].reverse(), 10).map((sample) => sample.id);

    expect(forward).toEqual(reversed);
  });

  it("accounts for every candidate", () => {
    const crowd = Array.from({ length: 30 }, (_, index) =>
      part(`pin-${index}`, index * 2, index % 3 === 0 ? "distance:new" : "distance:seen", index),
    );
    expect(accountedIds(thinByPartition(crowd, 12))).toEqual(
      crowd.map((entry) => entry.id).sort(),
    );
  });
});
