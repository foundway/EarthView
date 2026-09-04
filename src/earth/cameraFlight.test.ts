import { Cartesian3, Math as CesiumMath } from "cesium";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cappedFlightDt,
  exceedsDragSlop,
  FLIGHT_MAX_STEP_SECONDS,
  flyViewerCamera,
  interpolateHeading,
  stepFlightElapsed,
} from "./cameraFlight";
import { HOME_HEIGHT_METERS, HOME_LATITUDE_DEG, HOME_LONGITUDE_DEG } from "./homeView";
import { flightPositionAt } from "./zoomSpeed";

const home = Cartesian3.fromDegrees(HOME_LONGITUDE_DEG, HOME_LATITUDE_DEG, HOME_HEIGHT_METERS);
const nearby = Cartesian3.fromDegrees(HOME_LONGITUDE_DEG + 10, HOME_LATITUDE_DEG, HOME_HEIGHT_METERS);

describe("cappedFlightDt", () => {
  it("passes through ordinary frame times", () => {
    expect(cappedFlightDt(1 / 60)).toBeCloseTo(1 / 60, 10);
    expect(cappedFlightDt(1 / 30)).toBeCloseTo(1 / 30, 10);
  });

  it("drops a hitch to the cap so cruise cannot surge", () => {
    expect(cappedFlightDt(0.5)).toBe(FLIGHT_MAX_STEP_SECONDS);
    expect(FLIGHT_MAX_STEP_SECONDS).toBe(0.05);
  });

  it("ignores non-finite and negative dt", () => {
    expect(cappedFlightDt(0)).toBe(0);
    expect(cappedFlightDt(-0.016)).toBe(0);
    expect(cappedFlightDt(Number.NaN)).toBe(0);
    expect(cappedFlightDt(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("stepFlightElapsed", () => {
  it("covers the same cruise-time in one wall-clock second at 30 fps and 60 fps", () => {
    expect(elapsedAfter(1, 60)).toBeCloseTo(1, 10);
    expect(elapsedAfter(1, 30)).toBeCloseTo(1, 10);
    expect(elapsedAfter(1, 30)).toBeCloseTo(elapsedAfter(1, 60), 10);
  });

  it("does not jump a 500 ms stall; duration stretches instead", () => {
    expect(stepFlightElapsed(0.2, 0.5, 10)).toBeCloseTo(0.2 + FLIGHT_MAX_STEP_SECONDS, 10);
  });

  it("time-dilates when frames are slower than the hitch cap", () => {
    expect(elapsedAfter(1, 15)).toBeCloseTo(15 * FLIGHT_MAX_STEP_SECONDS, 10);
    expect(elapsedAfter(1, 15)).toBeLessThan(1);
  });

  it("stops at the planned duration", () => {
    expect(stepFlightElapsed(1.99, 1 / 60, 2)).toBe(2);
    expect(stepFlightElapsed(2, 1 / 60, 2)).toBe(2);
  });
});

describe("interpolateHeading", () => {
  it("takes the short arc across the ±π seam", () => {
    const start = CesiumMath.toRadians(350);
    const end = CesiumMath.toRadians(10);
    expect(interpolateHeading(start, end, 0.5)).toBeCloseTo(0, 6);
  });
});

describe("flyViewerCamera", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("steps the camera by capped dt so a hitch does not dump the pose", () => {
    const harness = createFlightHarness();
    const complete = vi.fn();
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 2,
      easingFunction: (time) => time,
      complete,
    });

    vi.spyOn(performance, "now").mockReturnValueOnce(0);
    harness.frame();
    const afterStart = Cartesian3.clone(harness.camera.positionWC);

    vi.spyOn(performance, "now").mockReturnValueOnce(500);
    harness.frame();
    const afterHitch = harness.camera.positionWC;
    const pathCamera = {
      up: harness.camera.up,
      right: harness.camera.right,
      frustum: harness.camera.frustum,
    };
    const expected = flightPositionAt(
      afterStart,
      nearby,
      FLIGHT_MAX_STEP_SECONDS / 2,
      pathCamera,
    );

    expect(complete).not.toHaveBeenCalled();
    expect(Cartesian3.distance(afterStart, afterHitch)).toBeGreaterThan(1);
    expect(Cartesian3.distance(afterHitch, expected)).toBeLessThan(1);
    expect(Cartesian3.distance(afterStart, afterHitch)).toBeLessThan(
      Cartesian3.distance(
        afterStart,
        flightPositionAt(afterStart, nearby, 0.5 / 2, pathCamera),
      ) * 0.2,
    );
  });

  it("finishes on the destination and fires complete once elapsed catches duration", () => {
    const harness = createFlightHarness();
    const complete = vi.fn();
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 0.1,
      easingFunction: (time) => time,
      complete,
    });

    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    harness.frame();
    now = 50;
    harness.frame();
    expect(complete).not.toHaveBeenCalled();
    now = 100;
    harness.frame();

    expect(complete).toHaveBeenCalledTimes(1);
    expect(Cartesian3.distance(harness.camera.positionWC, nearby)).toBeLessThan(1);
    expect(harness.controller.enableInputs).toBe(true);
  });

  it("a replacement flight cancels the previous one", () => {
    const harness = createFlightHarness();
    const cancel = vi.fn();
    const complete = vi.fn();
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 4,
      easingFunction: (time) => time,
      cancel,
    });
    flyViewerCamera(harness.viewer, {
      destination: home,
      duration: 4,
      easingFunction: (time) => time,
      complete,
    });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it("hands the camera back when the user drags mid-flight", () => {
    const harness = createFlightHarness();
    const cancel = vi.fn();
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 4,
      easingFunction: (time) => time,
      cancel,
    });
    expect(harness.controller.enableInputs).toBe(false);

    harness.emit("pointerdown", { clientX: 100, clientY: 100 });
    harness.emit("pointermove", { clientX: 140, clientY: 100 });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(harness.controller.enableInputs).toBe(true);
  });

  it("keeps flying through a click, which is how the next flight starts", () => {
    const harness = createFlightHarness();
    const cancel = vi.fn();
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 4,
      easingFunction: (time) => time,
      cancel,
    });

    harness.emit("pointerdown", { clientX: 100, clientY: 100 });
    harness.emit("pointermove", { clientX: 102, clientY: 101 });
    harness.emit("pointerup", { clientX: 102, clientY: 101 });
    // A later move with no button down is a hover, not a drag.
    harness.emit("pointermove", { clientX: 400, clientY: 400 });

    expect(cancel).not.toHaveBeenCalled();
    expect(harness.controller.enableInputs).toBe(false);
  });

  it("hands the camera back on the first wheel notch", () => {
    const harness = createFlightHarness();
    const cancel = vi.fn();
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 4,
      easingFunction: (time) => time,
      cancel,
    });

    harness.emit("wheel", { deltaY: -120 });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(harness.controller.enableInputs).toBe(true);
  });

  it("leaves a settled camera alone when there is no flight to interrupt", () => {
    const harness = createFlightHarness();
    const complete = vi.fn();
    // Read the spy before the cancel hook wraps it on the first flight.
    const cancelFlight = harness.camera.cancelFlight;
    flyViewerCamera(harness.viewer, {
      destination: nearby,
      duration: 0,
      easingFunction: (time) => time,
      complete,
    });

    // One call belongs to the flight's own setup, which clears any predecessor.
    const beforeWheel = cancelFlight.mock.calls.length;
    harness.emit("wheel", { deltaY: -120 });

    expect(complete).toHaveBeenCalledTimes(1);
    expect(cancelFlight.mock.calls.length).toBe(beforeWheel);
  });
});

describe("exceedsDragSlop", () => {
  it("separates a click's wobble from a drag", () => {
    expect(exceedsDragSlop(0, 0)).toBe(false);
    expect(exceedsDragSlop(3, 2)).toBe(false);
    expect(exceedsDragSlop(5, 0)).toBe(true);
    expect(exceedsDragSlop(-4, -4)).toBe(true);
  });
});

function elapsedAfter(wallSeconds: number, framesPerSecond: number): number {
  const dt = 1 / framesPerSecond;
  const frames = Math.round(wallSeconds * framesPerSecond);
  let elapsed = 0;
  for (let i = 0; i < frames; i += 1) {
    elapsed = stepFlightElapsed(elapsed, dt, 100);
  }
  return elapsed;
}

function createFlightHarness() {
  let preRender: (() => void) | undefined;
  const controller = { enableInputs: true };
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const canvas = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
  };
  const camera = {
    positionWC: Cartesian3.clone(home),
    heading: 0.2,
    pitch: -Math.PI / 2,
    roll: 0,
    up: new Cartesian3(0, 0, 1),
    right: new Cartesian3(1, 0, 0),
    frustum: { fovy: Math.PI / 3, aspectRatio: 16 / 9 },
    setView: (options: {
      destination: Cartesian3;
      orientation: { heading: number; pitch: number; roll: number };
    }) => {
      camera.positionWC = Cartesian3.clone(options.destination);
      camera.heading = options.orientation.heading;
      camera.pitch = options.orientation.pitch;
      camera.roll = options.orientation.roll;
    },
    cancelFlight: vi.fn(),
  };
  const viewer = {
    camera,
    scene: {
      canvas,
      preRender: {
        addEventListener: (callback: () => void) => {
          preRender = callback;
        },
      },
      screenSpaceCameraController: controller,
    },
  };
  return {
    camera,
    controller,
    viewer: viewer as never,
    frame: () => preRender?.(),
    emit: (type: string, event: unknown = {}) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event);
      }
    },
  };
}
