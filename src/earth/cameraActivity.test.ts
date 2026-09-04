import { describe, expect, it } from "vitest";
import { Math as CesiumMath } from "cesium";
import {
  CameraGate,
  GESTURE_RATE_PER_SECOND,
  MOVING_INTERVAL_MS,
  POSE_EPSILON_METERS,
  posesEqual,
  SETTLE_DELAY_MS,
  viewChangeRate,
  type CameraPose,
} from "./cameraActivity";
import { SLOW_ROTATION_RADIANS_PER_SECOND } from "./earthRotation";
import { HOME_HEIGHT_METERS } from "./homeView";

function pose(x: number, options: { readonly dx?: number } = {}): CameraPose {
  return { x, y: 0, z: 0, dx: options.dx ?? 1, dy: 0, dz: 0 };
}

/** Camera at the home altitude, `angleRad` around the equator, looking down. */
const HOME_RADIUS_M = 6_371_000 + HOME_HEIGHT_METERS;
function orbitPose(angleRad: number, radius: number = HOME_RADIUS_M): CameraPose {
  const x = Math.cos(angleRad) * radius;
  const y = Math.sin(angleRad) * radius;
  return { x, y, z: 0, dx: -Math.cos(angleRad), dy: -Math.sin(angleRad), dz: 0 };
}

describe("posesEqual", () => {
  it("ignores sub-epsilon position drift", () => {
    expect(posesEqual(pose(0), pose(POSE_EPSILON_METERS / 2))).toBe(true);
  });

  it("sees a position change past the epsilon", () => {
    expect(posesEqual(pose(0), pose(POSE_EPSILON_METERS * 2))).toBe(false);
  });

  it("sees a rotation in place", () => {
    const rotated: CameraPose = { x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0 };
    expect(posesEqual(pose(0), rotated)).toBe(false);
  });
});

describe("viewChangeRate", () => {
  it("reads the ambient globe spin as far below gesture speed", () => {
    // The regression this guards: the spin is ~97 km/s of camera travel at the
    // home altitude, so any absolute-distance threshold classes idling as a
    // permanent gesture and the degraded render path never turns off.
    const dt = 1 / 60;
    const step = SLOW_ROTATION_RADIANS_PER_SECOND * dt;
    const rate = viewChangeRate(orbitPose(0), orbitPose(step), dt);

    expect(rate).toBeCloseTo(SLOW_ROTATION_RADIANS_PER_SECOND * 2, 4);
    expect(rate).toBeLessThan(GESTURE_RATE_PER_SECOND / 5);
  });

  it("reads one wheel notch of zoom as a gesture", () => {
    const dt = 1 / 60;
    const closer = HOME_RADIUS_M * 0.8;
    expect(viewChangeRate(orbitPose(0), orbitPose(0, closer), dt)).toBeGreaterThan(
      GESTURE_RATE_PER_SECOND,
    );
  });

  it("reads a brisk drag as a gesture", () => {
    // 30 degrees of orbit in half a second.
    const rate = viewChangeRate(orbitPose(0), orbitPose(CesiumMath.toRadians(30)), 0.5);
    expect(rate).toBeGreaterThan(GESTURE_RATE_PER_SECOND);
  });

  it("is scale invariant, so the same zoom counts from any altitude", () => {
    const dt = 1 / 60;
    const high = viewChangeRate(orbitPose(0), orbitPose(0, HOME_RADIUS_M * 0.8), dt);
    const low = viewChangeRate(
      orbitPose(0, 6_381_000),
      orbitPose(0, 6_381_000 * 0.8),
      dt,
    );
    expect(low).toBeCloseTo(high, 6);
  });

  it("is zero for a still camera and for a zero time step", () => {
    expect(viewChangeRate(orbitPose(0), orbitPose(0), 1 / 60)).toBe(0);
    expect(viewChangeRate(orbitPose(0), orbitPose(1), 0)).toBe(0);
  });
});

describe("CameraGate", () => {
  it("runs the first frame it ever sees", () => {
    expect(new CameraGate().shouldRun(pose(0), 0)).toBe(true);
  });

  it("stops running once the camera has been still", () => {
    const gate = new CameraGate();
    gate.shouldRun(orbitPose(0), 0);
    // The settle edge is itself a run, so step past it and then keep asking.
    gate.shouldRun(orbitPose(0), SETTLE_DELAY_MS);
    expect(gate.shouldRun(orbitPose(0), SETTLE_DELAY_MS + 1_000)).toBe(false);
    expect(gate.shouldRun(orbitPose(0), SETTLE_DELAY_MS + 10_000)).toBe(false);
    expect(gate.isMoving()).toBe(false);
  });

  it("throttles a continuous gesture to the interval", () => {
    const gate = new CameraGate();
    gate.shouldRun(orbitPose(0), 0);

    // Every frame moves, but only frames past the interval do the work.
    const runs: number[] = [];
    for (let frame = 1; frame <= 20; frame++) {
      const nowMs = frame * 16;
      if (gate.shouldRun(orbitPose(CesiumMath.toRadians(frame)), nowMs)) {
        runs.push(nowMs);
      }
    }

    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThan(20);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i] - runs[i - 1]).toBeGreaterThanOrEqual(MOVING_INTERVAL_MS);
    }
  });

  it("runs on both edges of a gesture so the render path can swap", () => {
    const gate = new CameraGate();
    // Consume the startup run and get to a settled state.
    gate.shouldRun(orbitPose(0), 0);
    gate.shouldRun(orbitPose(0), SETTLE_DELAY_MS);
    expect(gate.shouldRun(orbitPose(0), 1_000)).toBe(false);

    // A zoom starts: must run immediately, and report moving.
    expect(gate.shouldRun(orbitPose(0, HOME_RADIUS_M * 0.8), 1_016)).toBe(true);
    expect(gate.isMoving()).toBe(true);

    // Motion stops: the settling frame must run and report settled, because it
    // is the one that restores the full glow stack.
    expect(gate.shouldRun(orbitPose(0, HOME_RADIUS_M * 0.8), 1_016 + SETTLE_DELAY_MS)).toBe(
      true,
    );
    expect(gate.isMoving()).toBe(false);
  });

  it("never reports moving for the ambient spin, but still throttles it", () => {
    // The whole point of the two-level design: idling must keep the full glow
    // stack and let path LOD advance, while still not paying full frame rate.
    const gate = new CameraGate();
    const dt = 1000 / 60;
    let angle = 0;
    gate.shouldRun(orbitPose(angle), 0);

    const runs: number[] = [];
    let everMoving = false;
    // Two seconds of ambient rotation, well past the settle delay.
    for (let frame = 1; frame <= 120; frame++) {
      const nowMs = frame * dt;
      angle += SLOW_ROTATION_RADIANS_PER_SECOND * (dt / 1000);
      if (gate.shouldRun(orbitPose(angle), nowMs)) {
        runs.push(nowMs);
      }
      if (nowMs > SETTLE_DELAY_MS && gate.isMoving()) {
        everMoving = true;
      }
    }

    expect(everMoving).toBe(false);
    // Still gated: ~12 Hz over two seconds, not 120 frames of full work.
    expect(runs.length).toBeGreaterThan(10);
    expect(runs.length).toBeLessThan(40);
  });

  it("runs the next frame after force(), however still the camera is", () => {
    const gate = new CameraGate();
    gate.shouldRun(orbitPose(0), 0);
    gate.shouldRun(orbitPose(0), SETTLE_DELAY_MS);
    expect(gate.shouldRun(orbitPose(0), 1_000)).toBe(false);

    gate.force();
    expect(gate.shouldRun(orbitPose(0), 1_016)).toBe(true);
    expect(gate.shouldRun(orbitPose(0), 1_032)).toBe(false);
  });
});
