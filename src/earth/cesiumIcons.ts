import type { Viewer } from "cesium";
import {
  CLOSE_PATH,
  HOME_PATH,
  HOME_STROKE_WIDTH,
  ICON_SIZE,
  SEARCH_PATH,
} from "../ui/icons";

/**
 * Cesium draws each widget glyph through its `cesiumSvgPath` knockout binding,
 * which creates one `<svg class="cesium-svgPath-svg">` holding a single
 * `<path>`, then on every update writes `d` on that path and `width`/`height`/
 * `viewBox` on the svg. The viewBox side is the catch: the geocoder hardcodes a
 * 32-unit box and the home button a 28-unit one, so a rooster glyph authored on
 * a 14-unit box would land in the top-left corner at half size.
 *
 * That is also why this can't be a CSS job. Shrinking the svg in CSS — which is
 * how the fullscreen button gets to rooster's `sm` size, see styles.css — only
 * works when the path already fills its own viewBox. Here the path is *smaller*
 * than the box it's been dropped into, and CSS can't rewrite a viewBox.
 *
 * Rather than fight the binding — replacing the svg outright means it gets
 * clobbered the next time the widget re-renders — we write the glyph in the
 * coordinate space Cesium already set up and centre it with a `transform`. The
 * binding only ever touches `d`, `width`, `height`, and `viewBox`, so
 * `transform`, `fill`, `stroke`, and friends survive. And because the geocoder
 * reads its `d` back out of `_startSearchPath` / `_stopSearchPath`, swapping
 * those two properties keeps the magnifier ⇄ cancel state working: Cesium
 * re-renders with *our* glyphs, still correctly centred.
 *
 * Widgets are found by their own button class, **not** by `widget.container`.
 * Cesium hands several widgets the same container — `homeButton.container` is
 * the whole `.cesium-viewer-toolbar`, which also holds the geocoder — so
 * searching a container for "the" svg path silently returns whichever widget
 * comes first in the DOM and paints the wrong button.
 */

interface CesiumGlyph {
  /** Class Cesium puts on the widget's own button element. */
  readonly selector: string;
  /** The `width`/`height` Cesium's binding hardcodes, which sets the viewBox. */
  readonly viewBox: number;
  readonly path: string;
  /** Hairline glyphs have to opt out of the button's `fill`. See icons.ts. */
  readonly stroked?: boolean;
}

const SEARCH_GLYPH: CesiumGlyph = {
  selector: ".cesium-geocoder-searchButton",
  viewBox: 32,
  path: SEARCH_PATH,
};

const HOME_GLYPH: CesiumGlyph = {
  selector: ".cesium-home-button",
  viewBox: 28,
  path: HOME_PATH,
  stroked: true,
};

interface GeocoderPathHost {
  _startSearchPath?: string;
  _stopSearchPath?: string;
}

function paint(root: ParentNode, glyph: CesiumGlyph): boolean {
  const path = root.querySelector<SVGPathElement>(
    `${glyph.selector} svg.cesium-svgPath-svg path`,
  );
  if (!path) {
    return false;
  }

  const offset = (glyph.viewBox - ICON_SIZE) / 2;
  path.setAttribute("transform", `translate(${offset} ${offset})`);
  path.setAttribute("d", glyph.path);

  if (glyph.stroked) {
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(HOME_STROKE_WIDTH));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
  }

  return true;
}

/**
 * Swaps in the glyphs on the two Cesium widgets that had the wrong picture:
 * rooster's search icon on the address search, and a 14-unit globe on Home,
 * whose own artwork is drawn a size step larger than everything beside it.
 * Fullscreen keeps Cesium's own arrows and is sized in CSS instead.
 *
 * Call once, right after the viewer exists. Safe to call when either widget is
 * disabled — it no-ops rather than throwing, so `createViewer`'s options stay
 * the single place that decides which widgets exist.
 */
export function applyCesiumToolbarIcons(viewer: Viewer): void {
  const root = viewer.container;
  if (!root) {
    return;
  }

  if (paint(root, SEARCH_GLYPH)) {
    // Keep the viewModel in step so the cancel state renders rooster's X too.
    const model = viewer.geocoder?.viewModel as unknown as GeocoderPathHost | undefined;
    if (model) {
      model._startSearchPath = SEARCH_PATH;
      model._stopSearchPath = CLOSE_PATH;
    }
  }

  paint(root, HOME_GLYPH);
}
