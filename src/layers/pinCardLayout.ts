/**
 * Geometry for measure cards: box sizes, the home seat next to a pin, and
 * rectangle helpers. `cardPlacement.ts` owns grouping; this module answers
 * "where does a card sit by default", "do these boxes clash", and the
 * iterative slide that nudges overlapping boxes apart.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The pin a card belongs to, plus the box its label needs. */
export interface PinAnchor {
  readonly pinX: number;
  readonly pinY: number;
  readonly width: number;
  readonly height: number;
}

/** Offset from the pin to the card's top-left corner. */
export interface CardOffset {
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Snaps a chip position to the **device** pixel grid rather than the CSS one.
 *
 * Whole-CSS-pixel rounding is what keeps 11px tabular numbers crisp — a glyph
 * raster that lands between physical pixels goes soft — but on a HiDPI display
 * one CSS pixel spans two device pixels, so a slowly drifting camera parks a
 * chip and then jumps it a whole two pixels. That reads as jitter, and it got
 * worse once the scene started rendering at native resolution.
 *
 * Rounding to `1/ratio` keeps glyphs on the physical grid, so they stay sharp,
 * while shrinking the step to the smallest one the screen can actually show.
 * A ratio of 1 is the old whole-pixel behaviour.
 *
 * Only used once the camera settles — see {@link chipTranslatePx}.
 */
export function snapToDevicePixels(value: number, devicePixelRatio: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.round(value * ratio) / ratio;
}

/**
 * Where to translate a chip this frame.
 *
 * Snapping to a grid — any grid — is what makes a chip *step* instead of glide,
 * because the projection under it moves continuously while the drawn position
 * can only take discrete values. Shrinking the grid to device pixels makes each
 * step smaller but does not remove it, and at 11px a two-thirds-of-a-pixel hop
 * is still legible as jitter on a slow pan.
 *
 * So while the camera moves the position is left at full float precision. The
 * chips are composited layers (`will-change: transform` in styles.css), so the
 * compositor resamples a fractional translate: very slightly soft, and nothing
 * can read that softness on a label that is moving anyway.
 *
 * The frame the camera settles, the chip lands back on the physical pixel grid.
 * That is when the number is actually being read, and it is worth the single
 * sub-pixel nudge it costs to get there.
 */
export function chipTranslatePx(
  value: number,
  devicePixelRatio: number,
  cameraStill: boolean,
): number {
  if (cameraStill) {
    return snapToDevicePixels(value, devicePixelRatio);
  }
  return Number.isFinite(value) ? value : 0;
}

/** Clear space between the pin and the nearest card edge. */
export const PIN_CARD_GAP = 1;
/** Extra air required before a card is allowed into a free spot. */
export const PIN_CARD_SEPARATION = 1;
/**
 * How far a chip may slide from its home seat while resolving overlaps.
 * Far enough for a request and a collect on the same pin to stack; close
 * enough that a chip cannot park over empty ocean.
 */
export const CARD_MAX_DRIFT_PX = 48;
/**
 * Collision ticks per frame when something actually overlaps. A pair clears
 * in one push; a few extra ticks settle a pile. Well-spaced chips never
 * enter this loop.
 */
export const CARD_RELAX_PASSES = 8;
/** Skip the grid when a handful of all-pairs tests is cheaper to build. */
const CARD_GRID_MIN_BOXES = 16;
const CARD_GRID_CELL_PX = 64;

/**
 * Card box metrics. Chips are text-only with 2px of padding, so the box hugs
 * the glyphs; layers replace these estimates with real measured widths.
 * Keep in lockstep with `.pin-card` padding + line-height in styles.css.
 */
export const PIN_CARD_HEIGHT = 18;
export const PIN_CARD_PAD_X = 4;
const PIN_CARD_CHAR_WIDTH = 7.4;
const PIN_CARD_MIN_WIDTH = 20;

export function estimatePinCardSize(label: string): { width: number; height: number } {
  return {
    width: Math.max(
      PIN_CARD_MIN_WIDTH,
      Math.ceil(label.length * PIN_CARD_CHAR_WIDTH + PIN_CARD_PAD_X),
    ),
    height: PIN_CARD_HEIGHT,
  };
}

/** Canvas-measured text width plus the 2px padding on each side. */
export function measuredPinCardWidth(textWidth: number): number {
  return Math.max(PIN_CARD_MIN_WIDTH, Math.ceil(textWidth) + PIN_CARD_PAD_X);
}

export function rectsOverlap(a: Rect, b: Rect, pad = PIN_CARD_SEPARATION): boolean {
  return !(
    a.x + a.width + pad <= b.x ||
    b.x + b.width + pad <= a.x ||
    a.y + a.height + pad <= b.y ||
    b.y + b.height + pad <= a.y
  );
}

export function pointInRect(x: number, y: number, rect: Rect, pad = 0): boolean {
  return (
    x >= rect.x - pad &&
    y >= rect.y - pad &&
    x <= rect.x + rect.width + pad &&
    y <= rect.y + rect.height + pad
  );
}

export function inflateRect(rect: Rect, slack: number): Rect {
  return {
    x: rect.x - slack,
    y: rect.y - slack,
    width: rect.width + slack * 2,
    height: rect.height + slack * 2,
  };
}

export function cardBoxForOffset(
  anchor: Pick<PinAnchor, "pinX" | "pinY" | "width" | "height">,
  offset: CardOffset,
): Rect {
  return {
    x: anchor.pinX + offset.offsetX,
    y: anchor.pinY + offset.offsetY,
    width: anchor.width,
    height: anchor.height,
  };
}

/**
 * Home seat: centered just below the pin. Overlaps are resolved by sliding,
 * not by searching a ring of fallback slots.
 */
export function pinCardOffsets(
  anchor: Pick<PinAnchor, "width" | "height">,
): CardOffset[] {
  return [{ offsetX: -anchor.width / 2, offsetY: PIN_CARD_GAP }];
}

/**
 * A moving label during overlap relaxation. `mass` is how heavy it is —
 * a heavier box yields more slowly when two chips push apart.
 */
export interface RelaxingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  homeX: number;
  homeY: number;
  mass: number;
}

function overlapXY(
  a: Rect,
  b: Rect,
  pad: number,
): { ox: number; oy: number } | null {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + pad;
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + pad;
  if (ox <= 0 || oy <= 0) {
    return null;
  }
  return { ox, oy };
}

function clampToHome(box: RelaxingBox): void {
  const dx = box.x - box.homeX;
  const dy = box.y - box.homeY;
  const dist = Math.hypot(dx, dy);
  if (!(dist > CARD_MAX_DRIFT_PX)) {
    return;
  }
  const scale = CARD_MAX_DRIFT_PX / dist;
  box.x = box.homeX + dx * scale;
  box.y = box.homeY + dy * scale;
}

function separatePair(a: RelaxingBox, b: RelaxingBox, pad: number): boolean {
  const hit = overlapXY(a, b, pad);
  if (!hit) {
    return false;
  }
  const mass = a.mass + b.mass;
  if (!(mass > 0)) {
    return false;
  }
  // Slide out the short way — like a mind-map node slipping past its neighbour
  // instead of jumping to a distant slot.
  if (hit.oy <= hit.ox) {
    const dir = a.y + a.height / 2 <= b.y + b.height / 2 ? -1 : 1;
    a.y += dir * hit.oy * (b.mass / mass);
    b.y -= dir * hit.oy * (a.mass / mass);
  } else {
    const dir = a.x + a.width / 2 <= b.x + b.width / 2 ? -1 : 1;
    a.x += dir * hit.ox * (b.mass / mass);
    b.x -= dir * hit.ox * (a.mass / mass);
  }
  return true;
}

function separateFromObstacle(box: RelaxingBox, wall: Rect, pad: number): boolean {
  const hit = overlapXY(box, wall, pad);
  if (!hit) {
    return false;
  }
  if (hit.oy <= hit.ox) {
    const dir = box.y + box.height / 2 <= wall.y + wall.height / 2 ? -1 : 1;
    box.y += dir * hit.oy;
  } else {
    const dir = box.x + box.width / 2 <= wall.x + wall.width / 2 ? -1 : 1;
    box.x += dir * hit.ox;
  }
  return true;
}

function visitNearbyPairs(
  boxes: RelaxingBox[],
  pad: number,
  visit: (i: number, j: number) => boolean,
): boolean {
  const n = boxes.length;
  if (n < CARD_GRID_MIN_BOXES) {
    let hit = false;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (visit(i, j)) {
          hit = true;
        }
      }
    }
    return hit;
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i += 1) {
    const box = boxes[i];
    const x0 = Math.floor((box.x - pad) / CARD_GRID_CELL_PX);
    const y0 = Math.floor((box.y - pad) / CARD_GRID_CELL_PX);
    const x1 = Math.floor((box.x + box.width + pad) / CARD_GRID_CELL_PX);
    const y1 = Math.floor((box.y + box.height + pad) / CARD_GRID_CELL_PX);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = ((cx + 0x8000) << 16) | ((cy + 0x8000) & 0xffff);
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.push(i);
        } else {
          buckets.set(key, [i]);
        }
      }
    }
  }

  const seen = new Set<number>();
  let hit = false;
  for (const bucket of buckets.values()) {
    for (let a = 0; a < bucket.length; a += 1) {
      for (let b = a + 1; b < bucket.length; b += 1) {
        const i = bucket[a];
        const j = bucket[b];
        if (i === j) {
          continue;
        }
        const lo = i < j ? i : j;
        const hi = i < j ? j : i;
        const pair = lo * n + hi;
        if (seen.has(pair)) {
          continue;
        }
        seen.add(pair);
        if (visit(lo, hi)) {
          hit = true;
        }
      }
    }
  }
  return hit;
}

function boxesOverlapAnything(
  boxes: RelaxingBox[],
  obstacles: readonly Rect[],
  pad: number,
): boolean {
  for (const box of boxes) {
    for (const wall of obstacles) {
      if (overlapXY(box, wall, pad)) {
        return true;
      }
    }
  }
  let clash = false;
  visitNearbyPairs(boxes, pad, (i, j) => {
    if (overlapXY(boxes[i], boxes[j], pad)) {
      clash = true;
      return true;
    }
    return false;
  });
  return clash;
}

function collideAll(
  boxes: RelaxingBox[],
  obstacles: readonly Rect[],
  pad: number,
): boolean {
  let moved = visitNearbyPairs(boxes, pad, (i, j) => separatePair(boxes[i], boxes[j], pad));
  for (const box of boxes) {
    for (const wall of obstacles) {
      if (separateFromObstacle(box, wall, pad)) {
        moved = true;
      }
    }
  }
  return moved;
}

/**
 * Push overlapping boxes apart, then cap each against its home seat so nothing
 * wanders off its pin. Obstacles (HUD) are immovable.
 *
 * The expensive path is skipped when nothing overlaps — the usual case once
 * chips have settled, including ambient globe spin. No home-spring: that
 * fought the pushes and forced dozens of all-pairs ticks every frame.
 */
export function relaxOverlappingBoxes(
  boxes: RelaxingBox[],
  obstacles: readonly Rect[] = [],
  pad: number = PIN_CARD_SEPARATION,
): void {
  if (boxes.length === 0 || !boxesOverlapAnything(boxes, obstacles, pad)) {
    return;
  }
  for (let pass = 0; pass < CARD_RELAX_PASSES; pass += 1) {
    collideAll(boxes, obstacles, pad);
    for (const box of boxes) {
      clampToHome(box);
    }
    if (!boxesOverlapAnything(boxes, obstacles, pad)) {
      return;
    }
  }
  // Non-overlap wins over the drift cap if the two cannot both be satisfied.
  collideAll(boxes, obstacles, pad);
}

/**
 * Whether a pin should carry a card at all. A pin off the canvas or behind the
 * HUD has nowhere to put one. Running out of room is NOT a reason to skip a
 * card — cardPlacement.ts resolves that by combining chips.
 */
export function pinAcceptsCard(
  anchor: Pick<PinAnchor, "pinX" | "pinY">,
  viewport: Rect,
  avoid: readonly Rect[],
): boolean {
  return (
    pointInRect(anchor.pinX, anchor.pinY, viewport) &&
    !avoid.some((rect) => pointInRect(anchor.pinX, anchor.pinY, rect))
  );
}
