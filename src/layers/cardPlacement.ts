/**
 * Decides where every measure card sits, for both perception requests and
 * ingest collects, in one pass.
 *
 * A chip starts centered just below its pin. Overlapping chips then slide
 * apart — short-axis AABB pushes and a drift cap — so a request and a collect
 * on the same pixel stack instead of drawing on top of each other. Well-spaced
 * chips skip that solver. Chips are never clamped into the viewport and a
 * poisoned last-frame offset is ignored; those were how a number ended up
 * over empty ocean, unclickable, with no beam under it.
 *
 * Close pins still share one chip when they are the same kind and unit —
 * NEW and PROCESSING ride on that number rather than forbidding the merge.
 * Re-deriving grouping from scratch each frame flickers, so it has hysteresis:
 * join when boxes nearly touch, split only once clearly apart. A group is
 * keyed by its lowest member so the DOM node survives neighbours joining and
 * leaving.
 *
 * A card is never dropped for lack of room: worst case it slides as far as
 * the drift cap allows. Cards are absent only when the pin itself has
 * nowhere to be — behind the globe, off the canvas, under the HUD.
 */
import {
  CARD_MAX_DRIFT_PX,
  cardBoxForOffset,
  pinAcceptsCard,
  pinCardOffsets,
  rectsOverlap,
  relaxOverlappingBoxes,
  type CardOffset,
  type Rect,
  type RelaxingBox,
} from "./pinCardLayout";
/** Same-kind chips merge only when they share a unit (score with score). */
export type MeasureUnit = "distance" | "area" | "score";

/** Perception chips outrank ingest chips for contested space. */
export type CardKind = "perception" | "ingest";

const KIND_RANK: Record<CardKind, number> = { perception: 0, ingest: 1 };

/** Boxes this close become one chip. */
const CARD_JOIN_PAD = 2;
/** A chip that already merged splits only once its parts are this far apart. */
const CARD_SPLIT_GAP = 10;
/** A merged box can reach a new neighbour, so grouping settles over a few passes. */
const MAX_GROUPING_PASSES = 4;

/** One beam (or beam cluster) that wants a number next to it. */
export interface CardAnchor {
  readonly id: string;
  readonly kind: CardKind;
  /** Requests or datasets behind this anchor, for labels and clicks. */
  readonly memberIds: readonly string[];
  readonly pinX: number;
  readonly pinY: number;
  /** Higher wins a contested spot. */
  readonly priority: number;
  /**
   * Status pills. Close chips of the same kind and unit still share a number
   * whether or not one of them is NEW or PROCESSING — the pill rides along
   * if any member qualifies. A click prefers PROCESSING, then NEW, then others.
   */
  readonly isNew?: boolean;
  readonly isOngoing?: boolean;
  /** Distance chips do not merge with area chips. */
  readonly unit: MeasureUnit;
  /** Box this anchor's own label needs. */
  readonly width: number;
  readonly height: number;
}

export interface CardGroup {
  /** Stable while members join and leave: the lowest anchor id in the group. */
  readonly key: string;
  readonly kind: CardKind;
  readonly anchorIds: readonly string[];
  readonly memberIds: readonly string[];
  readonly pinX: number;
  readonly pinY: number;
  readonly priority: number;
  readonly isNew: boolean;
  readonly isOngoing: boolean;
  readonly unit: MeasureUnit;
  /** Member a click should select: PROCESSING, else NEW, else any. */
  readonly clickMemberId: string;
  readonly width: number;
  readonly height: number;
}

export interface PlacedCard extends CardGroup, Rect, CardOffset {}

export interface PlacementMemory {
  /** Last frame's offset per group key — replayed only if still near home. */
  readonly offsets: ReadonlyMap<string, CardOffset>;
  /** Anchor pairs that shared a chip last frame, for grouping hysteresis. */
  readonly joined: ReadonlySet<string>;
}

export const EMPTY_PLACEMENT_MEMORY: PlacementMemory = {
  offsets: new Map(),
  joined: new Set(),
};

export type MeasureCardLabel = (
  kind: CardKind,
  memberIds: readonly string[],
) => { readonly width: number; readonly height: number };

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function preferredOffset(group: CardGroup): CardOffset {
  return pinCardOffsets(group)[0];
}

function naturalBox(group: CardGroup): Rect {
  return cardBoxForOffset(group, preferredOffset(group));
}

function groupOf(anchor: CardAnchor): CardGroup {
  return {
    key: anchor.id,
    kind: anchor.kind,
    anchorIds: [anchor.id],
    memberIds: anchor.memberIds,
    pinX: anchor.pinX,
    pinY: anchor.pinY,
    priority: anchor.priority,
    isNew: anchor.isNew === true,
    isOngoing: anchor.isOngoing === true,
    unit: anchor.unit,
    clickMemberId: anchor.memberIds[0] ?? anchor.id,
    width: anchor.width,
    height: anchor.height,
  };
}

function wasJoined(a: CardGroup, b: CardGroup, joined: ReadonlySet<string>): boolean {
  for (const left of a.anchorIds) {
    for (const right of b.anchorIds) {
      if (joined.has(pairKey(left, right))) {
        return true;
      }
    }
  }
  return false;
}

function clickRank(group: Pick<CardGroup, "isOngoing" | "isNew">): number {
  if (group.isOngoing) {
    return 0;
  }
  if (group.isNew) {
    return 1;
  }
  return 2;
}

/**
 * A pair joins when their natural boxes nearly touch, and stays joined until
 * clearly apart. The wider "stay" threshold is what stops a chip flickering
 * between one number and two at a zoom level right on the boundary.
 */
function shouldShareCard(
  a: CardGroup,
  b: CardGroup,
  joined: ReadonlySet<string>,
): boolean {
  // Kind is source (request vs collect); unit is mi vs mi². Mixing either
  // would make the summed number a lie. NEW / PROCESSING ride on the chip.
  if (a.kind !== b.kind || a.unit !== b.unit) {
    return false;
  }
  const pad = wasJoined(a, b, joined) ? CARD_SPLIT_GAP : CARD_JOIN_PAD;
  return rectsOverlap(naturalBox(a), naturalBox(b), pad);
}

function combine(
  groups: readonly CardGroup[],
  measure: MeasureCardLabel,
): CardGroup {
  const leader = groups.reduce((best, group) =>
    clickRank(group) < clickRank(best) ||
    (clickRank(group) === clickRank(best) && group.clickMemberId < best.clickMemberId)
      ? group
      : best,
  );
  const anchorIds = [...new Set(groups.flatMap((group) => group.anchorIds))].sort();
  const uniqueMembers = [...new Set(groups.flatMap((group) => group.memberIds))];
  const memberIds = [
    leader.clickMemberId,
    ...uniqueMembers.filter((id) => id !== leader.clickMemberId).sort(),
  ];
  const size = measure(groups[0].kind, memberIds);
  return {
    key: anchorIds[0],
    kind: groups[0].kind,
    anchorIds,
    memberIds,
    pinX: groups.reduce((sum, group) => sum + group.pinX, 0) / groups.length,
    pinY: groups.reduce((sum, group) => sum + group.pinY, 0) / groups.length,
    priority: Math.max(...groups.map((group) => group.priority)),
    isNew: groups.some((group) => group.isNew),
    isOngoing: groups.some((group) => group.isOngoing),
    unit: groups[0].unit,
    clickMemberId: leader.clickMemberId,
    width: size.width,
    height: size.height,
  };
}

/** Connected components over "these two boxes want the same space". */
function groupByOverlap(
  anchors: readonly CardAnchor[],
  joined: ReadonlySet<string>,
  measure: MeasureCardLabel,
): CardGroup[] {
  let groups = anchors.map(groupOf);

  for (let pass = 0; pass < MAX_GROUPING_PASSES; pass += 1) {
    const parent = groups.map((_, index) => index);
    const find = (index: number): number => {
      let current = index;
      while (parent[current] !== current) {
        parent[current] = parent[parent[current]];
        current = parent[current];
      }
      return current;
    };

    let unioned = false;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (find(i) === find(j) || !shouldShareCard(groups[i], groups[j], joined)) {
          continue;
        }
        parent[find(j)] = find(i);
        unioned = true;
      }
    }
    if (!unioned) {
      break;
    }

    const buckets = new Map<number, CardGroup[]>();
    groups.forEach((group, index) => {
      const root = find(index);
      const bucket = buckets.get(root);
      if (bucket) {
        bucket.push(group);
      } else {
        buckets.set(root, [group]);
      }
    });
    groups = [...buckets.values()].map((bucket) =>
      bucket.length === 1 ? bucket[0] : combine(bucket, measure),
    );
  }

  return groups.sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      b.priority - a.priority ||
      a.key.localeCompare(b.key),
  );
}

function seedOffset(group: CardGroup, memory: PlacementMemory): CardOffset {
  const home = preferredOffset(group);
  const remembered = memory.offsets.get(group.key);
  if (!remembered) {
    return home;
  }
  const drift = Math.hypot(
    remembered.offsetX - home.offsetX,
    remembered.offsetY - home.offsetY,
  );
  // A stale offset from the old clamp-to-viewport path parked chips on empty
  // ocean. Only replay a seat that still belongs to this pin.
  if (drift > CARD_MAX_DRIFT_PX) {
    return home;
  }
  return remembered;
}

function placeAll(
  groups: readonly CardGroup[],
  avoid: readonly Rect[],
  memory: PlacementMemory,
): PlacedCard[] {
  const boxes: RelaxingBox[] = groups.map((group) => {
    const seed = cardBoxForOffset(group, seedOffset(group, memory));
    const home = cardBoxForOffset(group, preferredOffset(group));
    return {
      x: seed.x,
      y: seed.y,
      width: group.width,
      height: group.height,
      homeX: home.x,
      homeY: home.y,
      mass: 1,
    };
  });

  relaxOverlappingBoxes(boxes, avoid);

  return groups.map((group, index) => {
    const box = boxes[index];
    return {
      ...group,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      offsetX: box.x - group.pinX,
      offsetY: box.y - group.pinY,
    };
  });
}

/**
 * Groups the anchors that are fighting for the same space, then places one
 * chip per group. Every anchor whose pin is on the canvas ends up represented
 * by exactly one returned card.
 */
export function planCards(options: {
  readonly anchors: readonly CardAnchor[];
  readonly viewport: Rect;
  readonly avoid: readonly Rect[];
  readonly memory: PlacementMemory;
  readonly measure: MeasureCardLabel;
}): { placed: PlacedCard[]; memory: PlacementMemory } {
  const { viewport, avoid, memory, measure } = options;
  const eligible = options.anchors.filter((anchor) => pinAcceptsCard(anchor, viewport, avoid));
  const groups = groupByOverlap(eligible, memory.joined, measure);
  const placed = placeAll(groups, avoid, memory);

  const offsets = new Map<string, CardOffset>();
  const joined = new Set<string>();
  for (const card of placed) {
    offsets.set(card.key, { offsetX: card.offsetX, offsetY: card.offsetY });
    for (let i = 0; i < card.anchorIds.length; i += 1) {
      for (let j = i + 1; j < card.anchorIds.length; j += 1) {
        joined.add(pairKey(card.anchorIds[i], card.anchorIds[j]));
      }
    }
  }

  return { placed, memory: { offsets, joined } };
}
