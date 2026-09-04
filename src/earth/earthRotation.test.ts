import { describe, expect, it, vi } from "vitest";
import {
  EarthRotationController,
  SEEK_ROTATION_RADIANS_PER_SECOND,
  SLOW_ROTATION_RADIANS_PER_SECOND,
  advanceRotationFrame,
  initialRotationFrame,
  resolveDevRotationSpeedMultiplier,
  rotationSpeedForPhase,
  type RotationFrame,
} from "./earthRotation";
import { HOME_LATITUDE_DEG, HOME_LONGITUDE_DEG } from "./homeView";

function advanceUntil(
  start: RotationFrame,
  predicate: (frame: RotationFrame) => boolean,
  originVisible: boolean,
): RotationFrame {
  let frame = start;
  for (let index = 0; index < 100 && !predicate(frame); index += 1) {
    frame = advanceRotationFrame(frame, true, originVisible, 0.1);
  }
  return frame;
}

describe("rotation home", () => {
  it("faces North America", () => {
    expect(HOME_LONGITUDE_DEG).toBeCloseTo(-98.5795);
    expect(HOME_LATITUDE_DEG).toBeCloseTo(39.8283);
  });
});

describe("rotation fade state machine", () => {
  it("stays fully visible while an origin remains on camera", () => {
    const frame = advanceRotationFrame(initialRotationFrame(), true, true, 1);

    expect(frame).toEqual({ phase: "illuminated", darkness: 0 });
  });

  it("starts fading when the final origin leaves the camera", () => {
    const frame = advanceRotationFrame(initialRotationFrame(), true, false, 0.1);

    expect(frame.phase).toBe("fading-out");
    expect(frame.darkness).toBeGreaterThan(0);
    expect(frame.darkness).toBeLessThan(1);
  });

  it("does not seek until the globe is fully black", () => {
    const partial = advanceRotationFrame(initialRotationFrame(), true, false, 0.1);
    expect(partial.phase).toBe("fading-out");

    const black = advanceUntil(partial, (frame) => frame.phase === "seeking", false);
    expect(black).toEqual({ phase: "seeking", darkness: 1 });
  });

  it("begins fading back in as soon as a source becomes visible", () => {
    const seeking: RotationFrame = { phase: "seeking", darkness: 1 };

    expect(advanceRotationFrame(seeking, true, true, 0.1)).toEqual({
      phase: "fading-in",
      darkness: 1,
    });
  });

  it("returns to full brightness while the new origin stays visible", () => {
    const fadingIn: RotationFrame = { phase: "fading-in", darkness: 1 };
    const frame = advanceUntil(fadingIn, (candidate) => candidate.phase === "illuminated", true);

    expect(frame).toEqual({ phase: "illuminated", darkness: 0 });
  });

  it("never goes dark when the selected range has no origins", () => {
    const seeking: RotationFrame = { phase: "seeking", darkness: 1 };

    expect(advanceRotationFrame(seeking, false, false, 10)).toEqual(initialRotationFrame());
  });

  it("reverses a fade-in if the source leaves again", () => {
    const fadingIn: RotationFrame = { phase: "fading-in", darkness: 0.5 };
    const frame = advanceRotationFrame(fadingIn, true, false, 0.1);

    expect(frame.phase).toBe("fading-out");
    expect(frame.darkness).toBeGreaterThan(0.5);
  });
});

describe("rotation speed", () => {
  it("seeks much faster while black", () => {
    expect(rotationSpeedForPhase("illuminated")).toBe(SLOW_ROTATION_RADIANS_PER_SECOND);
    expect(rotationSpeedForPhase("fading-out")).toBe(SLOW_ROTATION_RADIANS_PER_SECOND);
    expect(rotationSpeedForPhase("fading-in")).toBe(SLOW_ROTATION_RADIANS_PER_SECOND);
    expect(rotationSpeedForPhase("seeking")).toBe(SEEK_ROTATION_RADIANS_PER_SECOND);
    expect(SEEK_ROTATION_RADIANS_PER_SECOND / SLOW_ROTATION_RADIANS_PER_SECOND).toBeGreaterThan(50);
  });

  it("ignores manual speed overrides in production", () => {
    expect(resolveDevRotationSpeedMultiplier("?rotationSpeed=120", false)).toBe(1);
  });

  it("clamps development speed overrides", () => {
    expect(resolveDevRotationSpeedMultiplier("?rotationSpeed=60", true)).toBe(60);
    expect(resolveDevRotationSpeedMultiplier("?rotationSpeed=0", true)).toBe(1);
    expect(resolveDevRotationSpeedMultiplier("?rotationSpeed=999", true)).toBe(120);
    expect(resolveDevRotationSpeedMultiplier("?rotationSpeed=nope", true)).toBe(1);
  });
});

describe("Home delegation", () => {
  it("lets playback replace the ordinary Home action", () => {
    const callbacks: { beforeHome?: (info: { cancel: boolean }) => void } = {};
    const camera = { flyTo: vi.fn() };
    const viewer = {
      camera,
      scene: {
        preRender: { addEventListener: vi.fn() },
        canvas: { addEventListener: vi.fn() },
      },
      homeButton: {
        viewModel: {
          command: {
            beforeExecute: {
              addEventListener: (callback: (info: { cancel: boolean }) => void) => {
                callbacks.beforeHome = callback;
              },
            },
          },
        },
      },
    };
    const fade = {
      style: { opacity: "" },
      dataset: {},
      toggleAttribute: vi.fn(),
    };
    const controller = new EarthRotationController(viewer as never, fade as never);
    const playbackHome = vi.fn();
    controller.setHomeAction(playbackHome);

    const info = { cancel: false };
    callbacks.beforeHome?.(info);

    expect(info.cancel).toBe(true);
    expect(playbackHome).toHaveBeenCalledOnce();
    expect(camera.flyTo).not.toHaveBeenCalled();
  });
});
