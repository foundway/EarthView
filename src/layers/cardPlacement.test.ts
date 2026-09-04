import { describe, expect, it } from "vitest";
import {
  EMPTY_PLACEMENT_MEMORY,
  planCards,
  type CardAnchor,
  type CardKind,
  type PlacementMemory,
} from "./cardPlacement";
import { PIN_CARD_GAP, PIN_CARD_HEIGHT, CARD_MAX_DRIFT_PX, rectsOverlap } from "./pinCardLayout";

const VIEW = { x: 0, y: 0, width: 800, height: 600 };
const CARD_WIDTH = 80;

function anchor(
  id: string,
  pinX: number,
  pinY: number,
  overrides: Partial<CardAnchor> = {},
): CardAnchor {
  return {
    id,
    kind: "perception",
    memberIds: [id],
    pinX,
    pinY,
    priority: 1,
    width: CARD_WIDTH,
    height: PIN_CARD_HEIGHT,
    unit: "distance",
    ...overrides,
  };
}

/** A merged label is a little wider than a single one, as in the real layers. */
function measure(_kind: CardKind, memberIds: readonly string[]) {
  return { width: CARD_WIDTH + (memberIds.length - 1) * 12, height: PIN_CARD_HEIGHT };
}

function plan(
  anchors: readonly CardAnchor[],
  memory: PlacementMemory = EMPTY_PLACEMENT_MEMORY,
  avoid: (typeof VIEW)[] = [],
) {
  return planCards({ anchors, viewport: VIEW, avoid, memory, measure });
}

function representedMembers(placed: ReturnType<typeof plan>["placed"]): Set<string> {
  return new Set(placed.flatMap((card) => card.memberIds));
}

function homeDrift(card: { pinX: number; pinY: number; x: number; y: number; width: number }): number {
  const homeX = card.pinX - card.width / 2;
  const homeY = card.pinY + PIN_CARD_GAP;
  return Math.hypot(card.x - homeX, card.y - homeY);
}

describe("planCards", () => {
  it("gives a well-spaced set one card each", () => {
    const { placed } = plan([
      anchor("a", 150, 150),
      anchor("b", 500, 150),
      anchor("c", 150, 450),
    ]);

    expect(placed).toHaveLength(3);
    expect(placed.every((card) => card.memberIds.length === 1)).toBe(true);
  });

  // The reported bug: a chip vanished at some zoom levels once its neighbours
  // filled the space. Every pin on the canvas must stay accounted for.
  it("accounts for every pin, however crowded", () => {
    const crowd = Array.from({ length: 14 }, (_, index) =>
      anchor(`pin-${index}`, 400 + index * 3, 300 + index * 2, { priority: 20 - index }),
    );
    const { placed } = plan(crowd);

    expect(representedMembers(placed).size).toBe(crowd.length);
    expect(placed.length).toBeLessThan(crowd.length);
  });

  it("combines the pins whose labels would collide, not distant ones", () => {
    const { placed } = plan([
      anchor("near-a", 300, 300),
      anchor("near-b", 316, 306),
      anchor("far", 700, 300),
    ]);

    const combined = placed.find((card) => card.memberIds.length > 1);
    expect(combined?.memberIds).toEqual(["near-a", "near-b"]);
    expect(placed.find((card) => card.key === "far")?.memberIds).toEqual(["far"]);
  });

  it("combines a new chip with an older neighbour of the same unit", () => {
    const { placed } = plan([
      anchor("new-one", 400, 300, { isNew: true }),
      anchor("seen-a", 404, 304),
      anchor("seen-b", 408, 308),
    ]);

    expect(placed).toHaveLength(1);
    expect(placed[0].memberIds).toEqual(["new-one", "seen-a", "seen-b"]);
    expect(placed[0].isNew).toBe(true);
    expect(placed[0].clickMemberId).toBe("new-one");
    expect(placed[0].memberIds[0]).toBe("new-one");
  });

  // The pill stays true when every request under the number is new, so a crowd
  // of new chips collapses like any other instead of stacking up at the pin.
  it("does combine two new chips with each other", () => {
    const { placed } = plan([
      anchor("new-a", 400, 300, { isNew: true }),
      anchor("new-b", 404, 304, { isNew: true }),
    ]);

    expect(placed).toHaveLength(1);
    expect(placed[0].memberIds).toEqual(["new-a", "new-b"]);
    expect(placed[0].isNew).toBe(true);
  });

  it("combines ongoing chips with finished neighbours of the same unit", () => {
    const { placed } = plan([
      anchor("ongoing-a", 400, 300, { isOngoing: true }),
      anchor("ongoing-b", 404, 304, { isOngoing: true }),
      anchor("finished", 408, 308),
    ]);

    expect(placed).toHaveLength(1);
    expect(placed[0].memberIds).toEqual(["ongoing-a", "finished", "ongoing-b"]);
    expect(placed[0].isOngoing).toBe(true);
    expect(placed[0].clickMemberId).toBe("ongoing-a");
  });

  it("prefers a processing member over a new one when both are in the chip", () => {
    const { placed } = plan([
      anchor("aaa-new", 400, 300, { isNew: true }),
      anchor("zzz-proc", 404, 304, { isOngoing: true }),
      anchor("mmm-seen", 408, 308),
    ]);

    expect(placed).toHaveLength(1);
    expect(placed[0].clickMemberId).toBe("zzz-proc");
    expect(placed[0].memberIds[0]).toBe("zzz-proc");
    expect(placed[0].isOngoing).toBe(true);
    expect(placed[0].isNew).toBe(true);
  });

  it("does not combine a distance chip with an area chip", () => {
    const { placed } = plan([
      anchor("km", 400, 300, { unit: "distance" }),
      anchor("sq", 404, 304, { unit: "area" }),
    ]);

    expect(placed).toHaveLength(2);
    expect(placed.every((card) => card.memberIds.length === 1)).toBe(true);
  });

  it("keeps a new chip in a merge it had already joined", () => {
    const joined = plan([anchor("aaa", 300, 300), anchor("bbb", 314, 304)]);
    expect(joined.placed[0].memberIds).toEqual(["aaa", "bbb"]);

    const { placed } = plan(
      [anchor("aaa", 300, 300, { isNew: true }), anchor("bbb", 314, 304)],
      joined.memory,
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].clickMemberId).toBe("aaa");
    expect(placed[0].isNew).toBe(true);
  });

  it("never combines a request chip with a collect chip", () => {
    const { placed } = plan([
      anchor("request", 400, 300),
      anchor("collect", 404, 304, { kind: "ingest" }),
    ]);

    expect(placed).toHaveLength(2);
    expect(placed.every((card) => card.memberIds.length === 1)).toBe(true);
    expect(placed[0].kind).toBe("perception");
    expect(rectsOverlap(placed[0], placed[1], 0)).toBe(false);
  });

  it("slides a collect off a request when they share a pin", () => {
    const { placed } = plan([
      anchor("request", 400, 300),
      anchor("collect", 400, 300, { kind: "ingest" }),
    ]);
    const request = placed.find((card) => card.kind === "perception")!;
    const collect = placed.find((card) => card.kind === "ingest")!;

    expect(rectsOverlap(request, collect, 0)).toBe(false);
    expect(homeDrift(request)).toBeLessThanOrEqual(CARD_MAX_DRIFT_PX);
    expect(homeDrift(collect)).toBeLessThanOrEqual(CARD_MAX_DRIFT_PX);
  });

  it("slides slightly-offset request and collect chips apart", () => {
    // The screenshot case: two different-kind numbers on neighbouring pins,
    // too far apart to merge and too close to both sit on their home seats.
    const { placed } = plan([
      anchor("ingest-km", 400, 300, { kind: "ingest", width: 96 }),
      anchor("request-km", 412, 310, { width: 72 }),
    ]);

    expect(placed).toHaveLength(2);
    expect(rectsOverlap(placed[0], placed[1], 0)).toBe(false);
    expect(placed.every((card) => homeDrift(card) <= CARD_MAX_DRIFT_PX)).toBe(true);
  });

  it("leaves well-spaced chips on their pins instead of walking them apart", () => {
    const crowd = Array.from({ length: 4 }, (_, index) =>
      anchor(`pin-${index}`, 150 + index * 180, 300, { priority: 20 - index }),
    );
    const { placed } = plan(crowd);

    expect(placed).toHaveLength(4);
    for (const card of placed) {
      expect(card.y).toBeCloseTo(card.pinY + PIN_CARD_GAP);
      expect(card.x + card.width / 2).toBeCloseTo(card.pinX);
    }
  });

  it("omits a card only when its pin has nowhere to be", () => {
    const hud = { x: 0, y: 0, width: 200, height: 400 };
    const { placed } = plan(
      [anchor("under-hud", 80, 120), anchor("offscreen", -40, 300), anchor("open", 500, 300)],
      EMPTY_PLACEMENT_MEMORY,
      [hud],
    );

    expect(placed.map((card) => card.key)).toEqual(["open"]);
  });

  it("keeps a card visible even when nothing is free", () => {
    // The only band of free space is taken by chrome the card must avoid.
    const { placed } = plan([anchor("only", 400, 300)], EMPTY_PLACEMENT_MEMORY, [
      { x: 0, y: 0, width: 800, height: 298 },
      { x: 0, y: 302, width: 800, height: 298 },
    ]);

    expect(placed).toHaveLength(1);
    expect(placed[0].key).toBe("only");
  });

  describe("stability across frames", () => {
    it("does not park a chip on empty map from a stale offset", () => {
      const poisoned: PlacementMemory = {
        offsets: new Map([["a", { offsetX: -40, offsetY: -280 }]]),
        joined: new Set(),
      };
      const { placed } = plan([anchor("a", 400, 300)], poisoned);

      expect(placed).toHaveLength(1);
      expect(placed[0].y).toBeCloseTo(300 + PIN_CARD_GAP);
      expect(placed[0].x + placed[0].width / 2).toBeCloseTo(400);
    });

    it("holds each card's offset as the camera pans", () => {
      const first = plan([anchor("a", 300, 300), anchor("b", 340, 316)]);
      const panned = plan(
        [anchor("a", 360, 250), anchor("b", 400, 266)],
        first.memory,
      );

      for (const before of first.placed) {
        const after = panned.placed.find((card) => card.key === before.key)!;
        expect(after.offsetX).toBeCloseTo(before.offsetX);
        expect(after.offsetY).toBeCloseTo(before.offsetY);
      }
    });

    it("does not reshuffle when priorities change", () => {
      const first = plan([
        anchor("a", 300, 300, { priority: 2 }),
        anchor("b", 386, 300, { priority: 1 }),
      ]);
      const flipped = plan(
        [anchor("a", 300, 300, { priority: 1 }), anchor("b", 386, 300, { priority: 9 })],
        first.memory,
      );

      for (const before of first.placed) {
        const after = flipped.placed.find((card) => card.key === before.key)!;
        expect(after.offsetX).toBeCloseTo(before.offsetX);
        expect(after.offsetY).toBeCloseTo(before.offsetY);
      }
    });

    // Without hysteresis a pair sitting right on the join threshold would
    // flip between one chip and two on consecutive frames.
    it("holds a combination together through a small separation", () => {
      const together = plan([anchor("a", 300, 300), anchor("b", 316, 300)]);
      expect(together.placed).toHaveLength(1);

      // Drifted apart enough to stop overlapping, but not clearly apart.
      const nudged = plan(
        [anchor("a", 300, 300), anchor("b", 386, 300)],
        together.memory,
      );
      expect(nudged.placed).toHaveLength(1);

      // Clearly apart now, so they split.
      const apart = plan(
        [anchor("a", 300, 300), anchor("b", 460, 300)],
        together.memory,
      );
      expect(apart.placed).toHaveLength(2);
    });

    it("keeps a chip's identity when a neighbour joins it", () => {
      const alone = plan([anchor("aaa", 300, 300)]);
      expect(alone.placed[0].key).toBe("aaa");

      const joined = plan([anchor("aaa", 300, 300), anchor("bbb", 314, 304)], alone.memory);
      expect(joined.placed).toHaveLength(1);
      // Same key means the same DOM node and the same remembered offset.
      expect(joined.placed[0].key).toBe("aaa");
      expect(joined.placed[0].memberIds).toEqual(["aaa", "bbb"]);
    });

    it("settles after one frame and then stops moving", () => {
      const anchors = [
        anchor("a", 300, 300),
        anchor("b", 330, 320),
        anchor("c", 500, 300),
        anchor("d", 520, 360, { kind: "ingest" }),
      ];
      let memory = EMPTY_PLACEMENT_MEMORY;
      const frames = [];
      for (let frame = 0; frame < 4; frame += 1) {
        const result = plan(anchors, memory);
        memory = result.memory;
        frames.push(result.placed.map((card) => `${card.key}@${card.x},${card.y}`).sort());
      }

      expect(frames[1]).toEqual(frames[2]);
      expect(frames[2]).toEqual(frames[3]);
    });
  });
});
