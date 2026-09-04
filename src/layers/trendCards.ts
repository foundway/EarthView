import type { Viewer } from "cesium";
import { posesEqual, readCameraPose, type CameraPose } from "../earth/cameraActivity";
import type { GeographicTrend } from "../data/trendsTypes";
import { pickTrendLeader, trendCardContent } from "./trendCardLabel";
import {
  EMPTY_PLACEMENT_MEMORY,
  planCards,
  type CardAnchor,
  type PlacedCard,
  type PlacementMemory,
} from "./cardPlacement";
import type { VisibleTrendPin } from "./trendBeams";
import {
  chipTranslatePx,
  estimatePinCardSize,
  measuredPinCardWidth,
  PIN_CARD_HEIGHT,
  type Rect,
} from "./pinCardLayout";

const LABEL_TONE_CLASS: Record<string, string> = {
  term: "pin-card-value-term",
  score: "pin-card-value-score",
  count: "pin-card-merge-count",
};

const CLICK_SLOP_PX = 4;
const HIT_PAD_PX = 3;
const TREND_KIND = "perception" as const;
const TREND_UNIT = "score" as const;

export class TrendCardLayer {
  private readonly root: HTMLElement;
  private readonly nodes = new Map<string, HTMLSpanElement>();
  private trends = new Map<string, GeographicTrend>();
  private selectedId: string | null = null;
  private memory: PlacementMemory = EMPTY_PLACEMENT_MEMORY;
  private placed: readonly PlacedCard[] = [];
  private pressedAt: { x: number; y: number } | null = null;
  private lastPose: CameraPose | null = null;
  private cameraStill = false;
  private readonly widthByText = new Map<string, number>();
  private readonly measureCtx: CanvasRenderingContext2D | null;

  constructor(
    private readonly viewer: Viewer,
    private readonly options: {
      readonly overlayHost: HTMLElement;
      readonly avoid: readonly HTMLElement[];
      readonly onSelect: (id: string) => void;
      readonly getPins: () => readonly VisibleTrendPin[];
    },
  ) {
    this.root = document.createElement("div");
    this.root.className = "pin-cards";
    this.root.setAttribute("aria-hidden", "true");
    options.overlayHost.appendChild(this.root);

    this.measureCtx = document.createElement("canvas").getContext("2d");

    const canvas = viewer.scene.canvas;
    canvas.addEventListener("pointerdown", (event) => {
      this.pressedAt = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("pointerup", (event) => {
      const pressed = this.pressedAt;
      this.pressedAt = null;
      if (
        !pressed ||
        Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > CLICK_SLOP_PX
      ) {
        return;
      }
      const hit = this.cardAt(event.clientX, event.clientY);
      if (hit) {
        const leader = pickTrendLeader(this.membersOf(hit.memberIds));
        this.options.onSelect(leader?.id ?? hit.clickMemberId);
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      if (this.pressedAt) {
        return;
      }
      canvas.style.cursor = this.cardAt(event.clientX, event.clientY) ? "pointer" : "";
    });

    viewer.scene.postRender.addEventListener(this.sync);
  }

  public cardAt(clientX: number, clientY: number): PlacedCard | null {
    const bounds = this.viewer.scene.canvas.getBoundingClientRect();
    const x = clientX - bounds.left;
    const y = clientY - bounds.top;

    for (let index = this.placed.length - 1; index >= 0; index -= 1) {
      const card = this.placed[index];
      if (
        x >= card.x - HIT_PAD_PX &&
        x <= card.x + card.width + HIT_PAD_PX &&
        y >= card.y - HIT_PAD_PX &&
        y <= card.y + card.height + HIT_PAD_PX
      ) {
        return card;
      }
    }
    return null;
  }

  public render(trends: readonly GeographicTrend[]): void {
    this.trends = new Map(trends.map((entry) => [entry.id, entry]));
    if (this.selectedId && !this.trends.has(this.selectedId)) {
      this.selectedId = null;
    }
    this.forgetStaleNodes();
  }

  public setSelected(id: string | null): void {
    this.selectedId = id;
  }

  public clear(): void {
    this.trends.clear();
    this.selectedId = null;
    this.memory = EMPTY_PLACEMENT_MEMORY;
    for (const node of this.nodes.values()) {
      node.remove();
    }
    this.nodes.clear();
  }

  private forgetStaleNodes(): void {
    const live = new Set(this.trends.keys());
    for (const [key, node] of this.nodes) {
      if (!live.has(key)) {
        node.remove();
        this.nodes.delete(key);
      }
    }
    this.memory = {
      offsets: new Map([...this.memory.offsets].filter(([key]) => live.has(key))),
      joined: this.memory.joined,
    };
  }

  private membersOf(memberIds: readonly string[]): GeographicTrend[] {
    return memberIds
      .map((id) => this.trends.get(id))
      .filter((entry): entry is GeographicTrend => entry !== undefined);
  }

  private contentFor(memberIds: readonly string[]) {
    return trendCardContent(this.membersOf(memberIds));
  }

  private measureText(text: string): { width: number; height: number } {
    const measured = this.widthByText.get(text);
    if (measured !== undefined) {
      return { width: measured, height: PIN_CARD_HEIGHT };
    }
    if (!this.measureCtx) {
      return estimatePinCardSize(text);
    }
    this.measureCtx.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif';
    return {
      width: measuredPinCardWidth(this.measureCtx.measureText(text).width),
      height: PIN_CARD_HEIGHT,
    };
  }

  private sizeFor(_kind: CardAnchor["kind"], memberIds: readonly string[]): {
    width: number;
    height: number;
  } {
    const content = this.contentFor(memberIds);
    return content ? this.measureText(content.text) : { width: 0, height: 0 };
  }

  private readonly sync = (): void => {
    const pose = readCameraPose(this.viewer);
    this.cameraStill = this.lastPose !== null && posesEqual(this.lastPose, pose);
    this.lastPose = pose;

    const pins = this.options.getPins();
    if (pins.length === 0) {
      if (this.placed.length === 0) {
        return;
      }
      this.memory = EMPTY_PLACEMENT_MEMORY;
      this.placed = [];
      this.draw([]);
      return;
    }

    const canvas = this.viewer.scene.canvas;
    const viewport: Rect = {
      x: 8,
      y: 8,
      width: canvas.clientWidth - 16,
      height: canvas.clientHeight - 16,
    };
    const avoid = this.options.avoid
      .map((element) => inflateDomRect(element.getBoundingClientRect(), 8))
      .filter((rect) => rect.width > 0 && rect.height > 0);

    const anchors: CardAnchor[] = [];
    for (const pin of pins) {
      const members = this.membersOf(pin.memberIds);
      const content = trendCardContent(members);
      if (!content) {
        continue;
      }
      const size = this.measureText(content.text);
      const leader = pickTrendLeader(members);
      const selected = pin.memberIds.includes(this.selectedId ?? "");
      const memberIds = leader
        ? [leader.id, ...pin.memberIds.filter((id) => id !== leader.id)]
        : pin.memberIds;
      anchors.push({
        id: pin.id,
        kind: TREND_KIND,
        memberIds,
        pinX: pin.screenX,
        pinY: pin.screenY,
        priority: (selected ? 1_000_000_000 : 0) + pin.score,
        unit: TREND_UNIT,
        width: size.width,
        height: size.height,
      });
    }

    const { placed, memory } = planCards({
      anchors,
      viewport,
      avoid,
      memory: this.memory,
      measure: (kind, memberIds) => this.sizeFor(kind, memberIds),
    });
    this.memory = memory;
    this.placed = placed;
    this.draw(placed);
  };

  private draw(placed: readonly PlacedCard[]): void {
    const visible = new Set(placed.map((card) => card.key));
    const ratio = window.devicePixelRatio;

    for (const card of placed) {
      const content = this.contentFor(card.memberIds);
      if (!content) {
        continue;
      }

      let node = this.nodes.get(card.key);
      if (!node) {
        node = document.createElement("span");
        this.root.appendChild(node);
        this.nodes.set(card.key, node);
      }
      node.dataset.cardTarget = card.clickMemberId;
      const selected = card.memberIds.includes(this.selectedId ?? "");
      const signature = `${content.text}\0${selected ? 1 : 0}`;
      if (node.dataset.sig !== signature) {
        node.dataset.sig = signature;
        node.className = `pin-card pin-card-trend${selected ? " is-selected" : ""}`;
        node.replaceChildren();
        for (const [index, part] of content.parts.entries()) {
          const span = document.createElement("span");
          span.className = LABEL_TONE_CLASS[part.tone] ?? "pin-card-value-term";
          span.textContent = part.text;
          node.append(span);
          if (index < content.parts.length - 1) {
            node.append(" ");
          }
        }
      }
      node.hidden = false;
      const still = this.cameraStill;
      node.style.transform = `translate3d(${chipTranslatePx(
        card.x,
        ratio,
        still,
      )}px, ${chipTranslatePx(card.y, ratio, still)}px, 0)`;
      this.recordWidth(content.text, node);
    }

    for (const [key, node] of this.nodes) {
      if (!visible.has(key)) {
        node.hidden = true;
      }
    }
  }

  private recordWidth(text: string, node: HTMLElement): void {
    if (this.widthByText.has(text)) {
      return;
    }
    const width = node.offsetWidth;
    if (width > 0) {
      this.widthByText.set(text, width);
    }
  }
}

function inflateDomRect(rect: DOMRect, pad: number): Rect {
  return {
    x: rect.left - pad,
    y: rect.top - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };
}
