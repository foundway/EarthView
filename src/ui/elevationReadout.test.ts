// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Viewer } from "cesium";
import { configureDisplayUnits } from "./format";
import { createElevationReadout, formatElevation } from "./elevationReadout";

describe("formatElevation", () => {
  it("follows the HUD distance unit", () => {
    expect(formatElevation(1609.344, "miles")).toBe("1.0 mi");
    expect(formatElevation(1500, "kilometers")).toBe("1.5 km");
  });

  it("uses meters below a kilometer in metric", () => {
    expect(formatElevation(742.4, "kilometers")).toBe("742 m");
  });

  it("reads zero rather than negative when the camera dips under the ellipsoid", () => {
    expect(formatElevation(-2, "miles")).toBe("0 mi");
  });

  it("has something to show before the camera reports a height", () => {
    expect(formatElevation(Number.NaN)).toBe("—");
    expect(formatElevation(Infinity)).toBe("—");
  });
});

/** Credit bar geometry the readout measures itself against. */
interface FakeCreditBar {
  readonly left: number;
  readonly bottom: number;
  readonly height: number;
}

/** A bar with no box stands for one that has not been laid out yet. */
const UNLAID_CREDIT_BAR: FakeCreditBar = { left: 0, bottom: 0, height: 0 };

/**
 * Minimal stand-in for the camera height, the preRender hook, and the credit
 * bar the readout positions itself against.
 */
function fakeViewer(initialHeight: number, bar: FakeCreditBar = UNLAID_CREDIT_BAR) {
  const listeners: Array<() => void> = [];
  const camera = { positionCartographic: { height: initialHeight } };
  const bottomContainer = document.createElement("div");
  bottomContainer.getBoundingClientRect = () => bar as DOMRect;
  return {
    viewer: { camera, bottomContainer, scene: { preRender: {
      addEventListener: (listener: () => void) => listeners.push(listener),
      removeEventListener: (listener: () => void) => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    } } } as unknown as Viewer,
    listenerCount: () => listeners.length,
    moveTo: (height: number) => {
      camera.positionCartographic.height = height;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** jsdom reports zero for these and ignores styled sizes, so stub them. */
function withViewport(
  size: { width: number; height: number; readoutHeight?: number },
  run: () => void,
): void {
  for (const [prop, value] of [
    ["clientWidth", size.width],
    ["clientHeight", size.height],
  ] as const) {
    Object.defineProperty(document.documentElement, prop, {
      configurable: true,
      value,
    });
  }
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function rect(this: HTMLElement) {
    if (this.classList.contains("elevation-readout")) {
      return { height: size.readoutHeight ?? 0 } as DOMRect;
    }
    return originalRect.call(this);
  };
  try {
    run();
  } finally {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    for (const prop of ["clientWidth", "clientHeight"] as const) {
      delete (document.documentElement as unknown as Record<string, unknown>)[prop];
    }
  }
}

function valueText(): string {
  const value = document.querySelector('[data-slot="elevation-value"]');
  return value?.textContent ?? "";
}

describe("elevation readout", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    configureDisplayUnits("miles");
  });

  it("shows the camera height before the first frame renders", () => {
    const { viewer } = fakeViewer(1609.344);
    createElevationReadout({ host: document.body, viewer });

    expect(valueText()).toBe("1.0 mi");
  });

  it("is always on", () => {
    const { viewer } = fakeViewer(1609.344);
    const readout = createElevationReadout({ host: document.body, viewer });

    expect(readout.element.hidden).toBe(false);
    expect("setVisible" in readout).toBe(false);
  });

  it("repaints when the HUD distance unit changes", () => {
    const { viewer } = fakeViewer(1500);
    const readout = createElevationReadout({ host: document.body, viewer });
    expect(valueText()).toBe("0.9 mi");

    configureDisplayUnits("kilometers");
    readout.setDistanceUnit("kilometers");
    expect(valueText()).toBe("1.5 km");
  });

  it("follows the camera", () => {
    const { viewer, moveTo } = fakeViewer(20_000_000);
    createElevationReadout({ host: document.body, viewer });

    moveTo(1609.344);
    expect(valueText()).toBe("1.0 mi");
  });

  it("leaves the DOM alone while the displayed number is unchanged", () => {
    const { viewer, moveTo } = fakeViewer(1609.344);
    createElevationReadout({ host: document.body, viewer });
    const value = document.querySelector('[data-slot="elevation-value"]');
    if (!value) throw new Error("missing value");

    let writes = 0;
    new MutationObserver(() => {
      writes += 1;
    }).observe(value, { childList: true, characterData: true, subtree: true });

    moveTo(1610);
    expect(writes).toBe(0);
  });

  /*
   * A fixed inset is what put the number under the ion logo, so the readout
   * has to derive its own from the credit bar's measured left edge.
   */
  it("sits clear of the credit bar's left edge", () => {
    withViewport({ width: 1000, height: 800 }, () => {
      const { viewer } = fakeViewer(1609.344, { left: 700, bottom: 790, height: 24 });
      const readout = createElevationReadout({ host: document.body, viewer });

      // 1000 − 700 = 300px of credit bar, plus the clearance gap.
      expect(readout.element.style.right).toBe("312px");
    });
  });

  /*
   * The label and the number are different sizes, so sharing the credit bar's
   * baseline left the group sitting low against the logo.
   */
  it("centres on the credit bar's midline rather than its baseline", () => {
    withViewport({ width: 1000, height: 800, readoutHeight: 14 }, () => {
      const { viewer } = fakeViewer(1609.344, { left: 700, bottom: 790, height: 24 });
      const readout = createElevationReadout({ host: document.body, viewer });

      // Bar spans 10..34px up from the bottom, so its midline is at 22px; a
      // 14px-tall readout centred on that starts 15px up.
      expect(readout.element.style.bottom).toBe("15px");
    });
  });

  it("falls back to safe insets before the credit bar is laid out", () => {
    withViewport({ width: 1000, height: 800 }, () => {
      const { viewer } = fakeViewer(1609.344);
      const readout = createElevationReadout({ host: document.body, viewer });

      expect(readout.element.style.right).toBe("260px");
      expect(readout.element.style.bottom).toBe("6px");
    });
  });

  /* Negative insets would push the number off-screen entirely. */
  it("falls back rather than going off-screen on an unmeasurable viewport", () => {
    withViewport({ width: 0, height: 0 }, () => {
      const { viewer } = fakeViewer(1609.344, { left: 700, bottom: 790, height: 24 });
      const readout = createElevationReadout({ host: document.body, viewer });

      expect(readout.element.style.right).toBe("260px");
      expect(readout.element.style.bottom).toBe("6px");
    });
  });

  it("cannot swallow wheel or drag over the globe", () => {
    const { viewer } = fakeViewer(1609.344);
    const readout = createElevationReadout({ host: document.body, viewer });

    expect(readout.element.className).toBe("elevation-readout");
  });

  it("detaches cleanly", () => {
    const { viewer, listenerCount } = fakeViewer(1609.344);
    const readout = createElevationReadout({ host: document.body, viewer });

    readout.destroy();
    expect(listenerCount()).toBe(0);
    expect(document.querySelector(".elevation-readout")).toBeNull();
  });
});
