// @vitest-environment jsdom
import type { Viewer } from "cesium";
import { describe, expect, it } from "vitest";
import { CLOSE_PATH, HOME_PATH, SEARCH_PATH } from "../ui/icons";
import { applyCesiumToolbarIcons } from "./cesiumIcons";

/**
 * Reproduces Cesium's real toolbar DOM, because the *nesting* is the thing that
 * bites here: the geocoder lives inside the same `.cesium-viewer-toolbar` as
 * the home button, and Cesium hands both widgets that toolbar as their
 * `container`. Painting "the" svg path found under a widget's container
 * therefore hits the geocoder twice and never touches Home — a fixture with one
 * isolated button per widget would have missed that entirely.
 *
 * Each widget renders one `<svg class="cesium-svgPath-svg">` holding a single
 * `<path>`, which is the contract this module writes against.
 */
function glyph(): string {
  return '<svg class="cesium-svgPath-svg"><path d="cesium" /></svg>';
}

function toolbar({ geocoder = true, home = true, fullscreen = true } = {}): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = `
    <div class="cesium-viewer-toolbar">
      ${
        geocoder
          ? `<div class="cesium-viewer-geocoderContainer">
               <input class="cesium-geocoder-input" />
               <span class="cesium-geocoder-searchButton">${glyph()}</span>
             </div>`
          : ""
      }
      ${
        home
          ? `<button class="cesium-button cesium-toolbar-button cesium-home-button">${glyph()}</button>`
          : ""
      }
    </div>
    ${
      fullscreen
        ? `<div class="cesium-viewer-fullscreenContainer">
             <button class="cesium-button cesium-fullscreenButton">${glyph()}</button>
           </div>`
        : ""
    }`;
  return container;
}

function viewerFor(container: HTMLElement, viewModel?: Record<string, unknown>): Viewer {
  return {
    container,
    geocoder: viewModel ? { viewModel } : undefined,
  } as unknown as Viewer;
}

function pathIn(container: HTMLElement, selector: string): SVGPathElement {
  const path = container.querySelector(`${selector} path`);
  if (!path) {
    throw new Error(`fixture has no path under ${selector}`);
  }
  return path as unknown as SVGPathElement;
}

describe("applyCesiumToolbarIcons", () => {
  it("centers rooster's search glyph in the geocoder's 32-unit viewBox", () => {
    const container = toolbar();
    applyCesiumToolbarIcons(viewerFor(container));

    const path = pathIn(container, ".cesium-geocoder-searchButton");
    expect(path.getAttribute("d")).toBe(SEARCH_PATH);
    // (32 - 14) / 2 — a 14px glyph centered in the box Cesium hardcoded.
    expect(path.getAttribute("transform")).toBe("translate(9 9)");
    // Only the globe overrides fill; the rest inherit the button's.
    expect(path.getAttribute("fill")).toBeNull();
  });

  it("draws Home as a hairline globe centered in its own 28-unit viewBox", () => {
    const container = toolbar();
    applyCesiumToolbarIcons(viewerFor(container));

    const path = pathIn(container, ".cesium-home-button");
    expect(path.getAttribute("d")).toBe(HOME_PATH);
    // (28 - 14) / 2 — the home button's box is smaller than the geocoder's,
    // and the 14-unit glyph is what keeps Home the size of its neighbors.
    expect(path.getAttribute("transform")).toBe("translate(7 7)");
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("stroke")).toBe("currentColor");
    expect(path.getAttribute("stroke-width")).toBe("1.2");
  });

  it("gives each widget its own glyph rather than painting the first one twice", () => {
    const container = toolbar();
    applyCesiumToolbarIcons(viewerFor(container));

    // The regression this guards: both widgets report the toolbar as their
    // container, so a container-scoped lookup put the globe on the magnifier.
    expect(pathIn(container, ".cesium-geocoder-searchButton").getAttribute("d")).toBe(SEARCH_PATH);
    expect(pathIn(container, ".cesium-home-button").getAttribute("d")).toBe(HOME_PATH);
  });

  it("leaves the fullscreen button's artwork alone", () => {
    const container = toolbar();
    applyCesiumToolbarIcons(viewerFor(container));

    // Rooster has no fullscreen glyph, so Cesium's arrows stay and styles.css
    // sizes them. Repainting here would mean inventing a second local glyph.
    const path = pathIn(container, ".cesium-fullscreenButton");
    expect(path.getAttribute("d")).toBe("cesium");
    expect(path.getAttribute("transform")).toBeNull();
  });

  it("keeps the geocoder's cancel state on rooster glyphs", () => {
    const viewModel: Record<string, unknown> = {};
    applyCesiumToolbarIcons(viewerFor(toolbar(), viewModel));

    // Cesium re-reads these two when isSearchInProgress flips; if we only wrote
    // the DOM, the first search would snap back to Cesium's own magnifier.
    expect(viewModel._startSearchPath).toBe(SEARCH_PATH);
    expect(viewModel._stopSearchPath).toBe(CLOSE_PATH);
  });

  it("no-ops when a widget is turned off in createViewer", () => {
    const container = toolbar({ geocoder: false });
    expect(() => applyCesiumToolbarIcons(viewerFor(container))).not.toThrow();
    expect(pathIn(container, ".cesium-home-button").getAttribute("d")).toBe(HOME_PATH);

    const bare = document.createElement("div");
    expect(() => applyCesiumToolbarIcons(viewerFor(bare))).not.toThrow();
  });
});
