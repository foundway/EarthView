import type { Viewer } from "cesium";
import { type DistanceUnit } from "../settings/units";
import { formatCenterline } from "./format";

/**
 * Camera height above ground, lower right, immediately left of the Cesium
 * credit. Always on. Units follow the HUD distance setting.
 *
 * Marauder renders on `EllipsoidTerrainProvider`, so the ground *is* the WGS84
 * ellipsoid and the camera's cartographic height is its height above ground
 * exactly — no terrain sample needed. If real terrain is ever turned on this
 * becomes an approximation that reads high over mountains, and it should then
 * sample terrain under the camera instead.
 */

/** Clearance between the readout's right edge and the credit bar. */
const CREDIT_GAP_PX = 12;

/**
 * Fallbacks for the frame before the credit bar has been measured, or if
 * Cesium ever stops exposing it. The inset is wide enough to clear the ion
 * logo, the "Data attribution" link, and the fullscreen button's reserved
 * strip; the bottom matches the credit bar's own resting baseline.
 */
const CREDIT_FALLBACK_INSET_PX = 260;
const CREDIT_FALLBACK_BOTTOM_PX = 6;

export function formatElevation(
  meters: number,
  unit?: DistanceUnit,
): string {
  if (!Number.isFinite(meters)) {
    return "—";
  }
  // The camera can dip a hair under the ellipsoid; a negative height reads as a bug.
  return formatCenterline(Math.max(0, meters), unit);
}

export interface ElevationReadoutOptions {
  readonly host: HTMLElement;
  readonly viewer: Viewer;
}

export interface ElevationReadout {
  /** Exposed so the number chips can be told to avoid it. */
  readonly element: HTMLElement;
  /** Re-paint after the HUD distance unit changes. */
  setDistanceUnit(unit: DistanceUnit): void;
  readonly destroy: () => void;
}

export function createElevationReadout({
  host,
  viewer,
}: ElevationReadoutOptions): ElevationReadout {
  const element = document.createElement("div");
  element.className = "elevation-readout";
  // Not a live region on purpose: it changes on every camera move, and
  // announcing that would bury everything else a screen reader has to say.
  element.innerHTML = `<span class="elevation-label">Elevation</span><span class="elevation-value" data-slot="elevation-value">—</span>`;

  const value = element.querySelector<HTMLElement>('[data-slot="elevation-value"]');
  if (!value) {
    throw new Error("Elevation readout markup is incomplete");
  }
  host.append(element);

  // The credit bar's box is measured, not assumed: its width grows with
  // whatever credits Cesium has loaded, so any fixed inset eventually lands on
  // the ion logo. Positioning off its real box is also right on every resize.
  const credit = viewer.bottomContainer as HTMLElement | undefined;
  const alignToCredit = (): void => {
    const bar = credit?.getBoundingClientRect();
    const viewport = document.documentElement;
    const inset = bar ? viewport.clientWidth - bar.left + CREDIT_GAP_PX : 0;
    // An unmeasurable bar or viewport must not park the readout off-screen.
    element.style.right = `${
      bar && bar.left > 0 && inset > 0 ? Math.round(inset) : CREDIT_FALLBACK_INSET_PX
    }px`;

    // Centre the text on the logo rather than sharing its baseline: the label
    // and the number are different sizes, so a common baseline leaves the
    // group sitting low against the artwork.
    const height = element.getBoundingClientRect().height;
    const centred = bar
      ? viewport.clientHeight - bar.bottom + (bar.height - height) / 2
      : 0;
    element.style.bottom = `${
      bar && bar.height > 0 && centred > 0 ? Math.round(centred) : CREDIT_FALLBACK_BOTTOM_PX
    }px`;
  };

  // Credits arrive after construction, and the bar is anchored to the corner,
  // so its box moves on both content and viewport changes.
  const creditResize =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(alignToCredit);
  if (credit) {
    creditResize?.observe(credit);
  }
  creditResize?.observe(document.documentElement);
  alignToCredit();

  // preRender rather than camera.changed, which only fires past a percentage
  // threshold and leaves the number stale mid-zoom. Writing only on a changed
  // string keeps this off the frame budget — most frames touch no DOM at all.
  let drawn = "";
  const sync = (): void => {
    const next = formatElevation(viewer.camera.positionCartographic.height);
    if (next !== drawn) {
      drawn = next;
      value.textContent = next;
    }
  };

  viewer.scene.preRender.addEventListener(sync);
  sync();

  return {
    element,
    setDistanceUnit(_unit: DistanceUnit) {
      drawn = "";
      sync();
    },
    destroy: () => {
      viewer.scene.preRender.removeEventListener(sync);
      creditResize?.disconnect();
      element.remove();
    },
  };
}
