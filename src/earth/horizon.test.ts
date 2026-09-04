import { Cartesian3, Ellipsoid } from "cesium";
import { describe, expect, it } from "vitest";
import {
  chipScreenIfFacing,
  isOnCameraFacingHemisphere,
  reprojectFacingAnchors,
} from "./horizon";

describe("isOnCameraFacingHemisphere", () => {
  it("treats the point under the camera as front-facing", () => {
    const camera = Cartesian3.fromDegrees(-119.4179, 36.7783, 18_000_000);
    const ground = Cartesian3.fromDegrees(-119.4179, 36.7783, 1_500);

    expect(isOnCameraFacingHemisphere(ground, camera, Ellipsoid.WGS84)).toBe(true);
  });

  it("treats the antipode as back-facing", () => {
    const camera = Cartesian3.fromDegrees(-119.4179, 36.7783, 18_000_000);
    const back = Cartesian3.fromDegrees(60.5821, -36.7783, 1_500);

    expect(isOnCameraFacingHemisphere(back, camera, Ellipsoid.WGS84)).toBe(false);
  });

  it("can require a stronger facing threshold", () => {
    const camera = Cartesian3.fromDegrees(-119.4179, 36.7783, 18_000_000);
    const ground = Cartesian3.fromDegrees(-119.4179, 36.7783, 1_500);

    expect(isOnCameraFacingHemisphere(ground, camera, Ellipsoid.WGS84, 0.05)).toBe(true);
    expect(isOnCameraFacingHemisphere(ground, camera, Ellipsoid.WGS84, 1)).toBe(false);
  });
});

describe("chipScreenIfFacing", () => {
  it("drops a far-side projection even when it lands on the canvas", () => {
    expect(chipScreenIfFacing(false, { x: 80, y: 700 })).toBeNull();
  });

  it("drops a missing or non-finite window position", () => {
    expect(chipScreenIfFacing(true, undefined)).toBeNull();
    expect(chipScreenIfFacing(true, { x: Number.NaN, y: 10 })).toBeNull();
    expect(chipScreenIfFacing(true, { x: 10, y: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("keeps a facing, finite window position", () => {
    expect(chipScreenIfFacing(true, { x: 120, y: 80 })).toEqual({ x: 120, y: 80 });
  });
});

describe("reprojectFacingAnchors", () => {
  const camera = Cartesian3.fromDegrees(-119.4179, 36.7783, 18_000_000);
  const ground = Cartesian3.fromDegrees(-119.4179, 36.7783, 1_500);
  const back = Cartesian3.fromDegrees(60.5821, -36.7783, 1_500);

  it("hides a far-side chip that still projects onto the canvas", () => {
    const drawn = reprojectFacingAnchors(
      [{ id: "orphan", anchor: back }],
      camera,
      Ellipsoid.WGS84,
      () => ({ x: 80, y: 700 }),
    );
    expect(drawn).toEqual([]);
  });

  it("reprojects a facing chip and brings a far-side one back once it faces", () => {
    const tracked = [
      { id: "front", anchor: ground },
      { id: "orphan", anchor: back },
    ];
    const onCanvas = (): { x: number; y: number } => ({ x: 80, y: 700 });

    expect(reprojectFacingAnchors(tracked, camera, Ellipsoid.WGS84, onCanvas)).toEqual([
      { id: "front", anchor: ground, screenX: 80, screenY: 700 },
    ]);

    const flipped = Cartesian3.fromDegrees(60.5821, -36.7783, 18_000_000);
    const ids = reprojectFacingAnchors(tracked, flipped, Ellipsoid.WGS84, onCanvas).map(
      (item) => item.id,
    );
    expect(ids).toEqual(["orphan"]);
  });
});
