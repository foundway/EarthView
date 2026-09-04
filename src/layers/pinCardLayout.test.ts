import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARD_MAX_DRIFT_PX,
  cardBoxForOffset,
  chipTranslatePx,
  estimatePinCardSize,
  inflateRect,
  measuredPinCardWidth,
  PIN_CARD_GAP,
  PIN_CARD_HEIGHT,
  pinAcceptsCard,
  pinCardOffsets,
  pointInRect,
  rectsOverlap,
  relaxOverlappingBoxes,
  snapToDevicePixels,
  type RelaxingBox,
} from "./pinCardLayout";

const VIEW = { x: 0, y: 0, width: 800, height: 600 };

/*
 * Chips are repositioned every frame from a continuously drifting projection.
 * Snapping them to whole CSS pixels is what keeps the glyphs sharp, but on a
 * HiDPI display that step is two device pixels wide and a slow camera makes
 * each one visible as a jump.
 */
describe("snapToDevicePixels", () => {
  it("lands on the physical pixel grid so glyphs stay sharp", () => {
    expect(snapToDevicePixels(10.4, 2)).toBe(10.5);
    expect(snapToDevicePixels(10.24, 2)).toBe(10);
    expect(snapToDevicePixels(10.76, 2)).toBe(11);
  });

  it("quarters the step a chip jumps on a 2x display", () => {
    const drift = [10.1, 10.3, 10.6, 10.9];
    const css = drift.map((v) => snapToDevicePixels(v, 1));
    const retina = drift.map((v) => snapToDevicePixels(v, 2));

    // Whole-pixel rounding parks the chip, then moves it a full pixel at once.
    expect(css).toEqual([10, 10, 11, 11]);
    expect(Math.max(...steps(css))).toBe(1);
    // Device-pixel rounding halves that, and in CSS terms it is a half step.
    expect(retina).toEqual([10, 10.5, 10.5, 11]);
    expect(Math.max(...steps(retina))).toBe(0.5);
  });

  it("is whole-pixel rounding at 1x and survives a nonsense ratio", () => {
    expect(snapToDevicePixels(10.6, 1)).toBe(11);
    expect(snapToDevicePixels(10.6, 0)).toBe(11);
    expect(snapToDevicePixels(10.6, Number.NaN)).toBe(11);
    expect(snapToDevicePixels(Number.NaN, 2)).toBe(0);
  });

  it("handles a fractional ratio like a 1.5x display", () => {
    // The grid is 1/1.5 of a CSS pixel, so the rungs are 10, 10.667, 11.333 —
    // there is no rung at 10.333, and 10.2 is nearer 10 than 10.667.
    expect(snapToDevicePixels(10, 1.5)).toBeCloseTo(10, 6);
    expect(snapToDevicePixels(10.4, 1.5)).toBeCloseTo(10.666667, 5);
    expect(snapToDevicePixels(10.2, 1.5)).toBeCloseTo(10, 6);
    expect(snapToDevicePixels(10.9, 1.5)).toBeCloseTo(10.666667, 5);
  });
});

/*
 * Snapping is what makes a chip step rather than glide, so a moving camera has
 * to draw at full precision — a smaller grid shrinks the hop without removing
 * it, and at 11px even a two-thirds-pixel hop reads as jitter.
 */
describe("chipTranslatePx", () => {
  it("leaves a moving chip unquantized so it glides", () => {
    const drift = [10.1, 10.3, 10.62, 10.94];

    expect(drift.map((v) => chipTranslatePx(v, 1.5, false))).toEqual(drift);
    // Every frame moves; none of them park and then jump.
    expect(Math.min(...steps(drift.map((v) => chipTranslatePx(v, 1.5, false))))).toBeGreaterThan(0);
  });

  it("still parks a moving chip when the grid is used", () => {
    // The same drift snapped to a 1.5x grid stalls, then hops a third of a
    // pixel at once — this is the jitter the moving path exists to avoid.
    const snapped = [10.1, 10.3, 10.62, 10.94].map((v) => chipTranslatePx(v, 1.5, true));
    expect(steps(snapped)).toContain(0);
  });

  it("lands on the physical pixel grid the moment the camera settles", () => {
    expect(chipTranslatePx(10.4, 2, true)).toBe(10.5);
    expect(chipTranslatePx(10.4, 2, false)).toBe(10.4);
  });

  it("survives a non-finite position on either path", () => {
    expect(chipTranslatePx(Number.NaN, 2, false)).toBe(0);
    expect(chipTranslatePx(Number.NaN, 2, true)).toBe(0);
  });
});

function steps(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => Math.abs(v - values[i]));
}

/** Distance from the pin to the nearest edge of the box. */
function edgeDistance(
  box: { x: number; y: number; width: number; height: number },
  pin: { pinX: number; pinY: number },
): number {
  const dx = Math.max(box.x - pin.pinX, pin.pinX - (box.x + box.width), 0);
  const dy = Math.max(box.y - pin.pinY, pin.pinY - (box.y + box.height), 0);
  return Math.hypot(dx, dy);
}

describe("estimatePinCardSize", () => {
  it("grows with the label and stays tall enough to tap", () => {
    const short = estimatePinCardSize("487 m");
    const long = estimatePinCardSize("16.7 km²");
    expect(short.height).toBe(PIN_CARD_HEIGHT);
    expect(long.width).toBeGreaterThan(short.width);
  });
});

describe("measuredPinCardWidth", () => {
  it("adds only the 2px padding on each side, so chips can sit close", () => {
    expect(measuredPinCardWidth(60)).toBe(64);
    expect(measuredPinCardWidth(41.2)).toBe(46);
  });
});

describe("pinCardOffsets", () => {
  it("puts the first choice centered just below the pin", () => {
    const pin = { pinX: 100, pinY: 80, width: 40, height: 20 };
    const box = cardBoxForOffset(pin, pinCardOffsets(pin)[0]);

    expect(box.x + box.width / 2).toBeCloseTo(100);
    expect(box.y).toBeCloseTo(80 + PIN_CARD_GAP);
  });

  it("offers only the home seat, centered just below the pin", () => {
    const pin = { pinX: 200, pinY: 200, width: 56, height: PIN_CARD_HEIGHT };
    const offsets = pinCardOffsets(pin);
    expect(offsets).toHaveLength(1);

    const below = cardBoxForOffset(pin, offsets[0]);
    expect(below.x + below.width / 2).toBeCloseTo(200);
    expect(below.y).toBeCloseTo(200 + PIN_CARD_GAP);
    expect(edgeDistance(below, pin)).toBeCloseTo(PIN_CARD_GAP);
  });
});

describe("rectsOverlap", () => {
  it("treats a gap smaller than the pad as a clash", () => {
    const a = { x: 0, y: 0, width: 50, height: 20 };
    const b = { x: 51, y: 0, width: 50, height: 20 };
    expect(rectsOverlap(a, b, 4)).toBe(true);
    expect(rectsOverlap(a, b, 0)).toBe(false);
  });
});

describe("relaxOverlappingBoxes", () => {
  function box(
    x: number,
    y: number,
    overrides: Partial<RelaxingBox> = {},
  ): RelaxingBox {
    return {
      x,
      y,
      width: 80,
      height: PIN_CARD_HEIGHT,
      homeX: x,
      homeY: y,
      mass: 1,
      ...overrides,
    };
  }

  it("leaves well-spaced boxes on their home seats", () => {
    const a = box(100, 100);
    const b = box(400, 100);
    relaxOverlappingBoxes([a, b]);
    expect(a.x).toBeCloseTo(100);
    expect(a.y).toBeCloseTo(100);
    expect(b.x).toBeCloseTo(400);
    expect(b.y).toBeCloseTo(100);
  });

  it("slides stacked boxes apart instead of leaving them overlapped", () => {
    const a = box(200, 200);
    const b = box(200, 200);
    relaxOverlappingBoxes([a, b]);

    expect(rectsOverlap(a, b, 0)).toBe(false);
    expect(Math.hypot(a.x - a.homeX, a.y - a.homeY)).toBeLessThanOrEqual(CARD_MAX_DRIFT_PX);
    expect(Math.hypot(b.x - b.homeX, b.y - b.homeY)).toBeLessThanOrEqual(CARD_MAX_DRIFT_PX);
  });

  it("keeps a box near home even when a neighbour pushes it", () => {
    const a = box(200, 200);
    const b = box(210, 206, { width: 70 });
    relaxOverlappingBoxes([a, b]);

    expect(rectsOverlap(a, b, 0)).toBe(false);
    expect(Math.hypot(a.x - a.homeX, a.y - a.homeY)).toBeLessThanOrEqual(CARD_MAX_DRIFT_PX);
    expect(Math.hypot(b.x - b.homeX, b.y - b.homeY)).toBeLessThanOrEqual(CARD_MAX_DRIFT_PX);
  });

  it("leaves a crowd of well-spaced boxes unmoved", () => {
    const boxes = Array.from({ length: 40 }, (_, index) =>
      box(40 + (index % 8) * 90, 40 + Math.floor(index / 8) * 80),
    );
    const homes = boxes.map((entry) => ({ x: entry.x, y: entry.y }));
    relaxOverlappingBoxes(boxes);
    for (let i = 0; i < boxes.length; i += 1) {
      expect(boxes[i].x).toBeCloseTo(homes[i].x);
      expect(boxes[i].y).toBeCloseTo(homes[i].y);
    }
  });
});

describe("pinAcceptsCard", () => {
  it("takes a pin on the canvas and clear of the chrome", () => {
    expect(pinAcceptsCard({ pinX: 400, pinY: 300 }, VIEW, [])).toBe(true);
  });

  it("refuses a pin off the canvas or under the HUD", () => {
    expect(pinAcceptsCard({ pinX: -5, pinY: 300 }, VIEW, [])).toBe(false);
    expect(
      pinAcceptsCard({ pinX: 80, pinY: 120 }, VIEW, [
        { x: 0, y: 0, width: 200, height: 400 },
      ]),
    ).toBe(false);
  });
});

describe("inflateRect", () => {
  it("grows a rect on every side", () => {
    expect(inflateRect({ x: 10, y: 10, width: 20, height: 20 }, 5)).toEqual({
      x: 5,
      y: 5,
      width: 30,
      height: 30,
    });
  });
});

describe("pointInRect", () => {
  it("includes the boundary", () => {
    expect(pointInRect(10, 10, { x: 0, y: 0, width: 10, height: 10 })).toBe(true);
    expect(pointInRect(11, 10, { x: 0, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("chip stylesheet lockstep", () => {
  const stylesCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "styles.css"), "utf8");

  function declaration(selector: string, property: string): string | null {
    const block = stylesCss.match(
      new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`),
    )?.[1];
    return block?.match(new RegExp(`${property}:\\s*([^;]+);`))?.[1].trim() ?? null;
  }

  it("keeps placement height equal to padding plus line box", () => {
    const chipLineHeight = Number.parseFloat(declaration(".pin-card", "line-height") ?? "");
    const chipPadding = Number.parseFloat(declaration(".pin-card", "padding") ?? "");
    expect(chipLineHeight + chipPadding * 2).toBe(PIN_CARD_HEIGHT);
  });
});
