import {
  Cartesian3,
  Color,
  type CustomDataSource,
  type Entity,
  HeightReference,
  Material,
  type Polyline,
  type PolylineCollection,
} from "cesium";
import { viewHeightAtDistanceMeters } from "../earth/cameraFrustum";

/**
 * A beam starts ON the surface, not above it — the same rule the collected
 * paths, billed centerlines, and request footprints follow.
 *
 * This used to be 1500 m "so the base doesn't z-fight with the globe", and
 * that lift is visible as parallax the moment you zoom in: a point 1500 m up
 * projects away from its own ground position, so the base and its dot drift
 * off the road the request measures and the beam reads as floating. At street
 * zoom the offset is hundreds of pixels.
 */
export const BEAM_BASE_HEIGHT_M = 0;

/** Screen size of the contact dot that remains after the beam has faded. */
export const BASE_POINT_PIXEL_SIZE = 6;

/**
 * Skip the depth test at every camera distance. The contact dot is clamped to
 * the same surface as the billed centerline, the request footprint, and the
 * ellipsoid, so a depth-tested 6 px point z-fights with those draped
 * primitives — the location point flickers in and out as the camera (or the
 * ambient spin) moves. Infinity never lifts the point; it only stops the GPU
 * from tossing a coin between the dot and the ground it sits on.
 */
export const BASE_POINT_DISABLE_DEPTH_TEST_DISTANCE = Number.POSITIVE_INFINITY;

/**
 * Graphics for the contact dot. Clamped to the globe (no parallax) and
 * depth-test disabled (no z-fight with draped centerlines / footprints).
 */
export function beamBasePointGraphics(
  color: Color,
  alphaScale: number = 1,
): {
  readonly pixelSize: number;
  readonly color: Color;
  readonly heightReference: HeightReference;
  readonly disableDepthTestDistance: number;
} {
  return {
    pixelSize: BASE_POINT_PIXEL_SIZE,
    color: color.withAlpha(0.9 * alphaScale),
    heightReference: HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: BASE_POINT_DISABLE_DEPTH_TEST_DISTANCE,
  };
}

/**
 * Screen-space width of a beam when the settings slider is at its default.
 * One PolylineGlow strip in a batched {@link PolylineCollection}. The glow
 * shader fills that many pixels and no more — 8 px is a visible bloom
 * without the billboard that 64–128 px widths used to paint across the
 * terrain. The slider still exposes 1–16.
 */
export const BEAM_WIDTH_PX_DEFAULT = 8;

/**
 * Resting opacity of a perception beam. The glow shader already falls off
 * to transparent at the edge of the strip; this keeps the bloom from
 * stacking to white where beams overlap. Ingest multiplies by its own scale.
 */
export const BEAM_ALPHA = 0.85;

/**
 * Fraction of the 8 px strip that reads as bright core. The shader drives
 * rgb toward white once glow exceeds 1, so this stays a step under the old
 * 0.18 — same white-hot core, slightly less of it.
 */
export const BEAM_GLOW_POWER = 0.14;

/**
 * Cesium tapers from the *start* of the polyline. Positions run top → base,
 * so this is the needle at the tip: 0 is gone at the start, 1 is no taper.
 * 0.4 leaves the lower half at full bloom and points the top.
 */
export const BEAM_TAPER_POWER = 0.4;

/**
 * A beam encodes its measure as its *length*, so a beam whose top is off screen
 * has lost the only thing it was saying and is just a bar across the view. From
 * roughly 250 km down that is every beam at once, because the shortest is
 * 680 km tall — a field of full-height columns that hides the ground geometry
 * the close-in view exists to show.
 *
 * So beams fade as their length stops fitting: full strength while the whole
 * beam is within the view, gone by the time only {@link BEAM_FADE_GONE_FRACTION}
 * of it is. The base dot does *not* fade — it marks where the request sits and
 * anchors its number chip, so zooming in leaves a clean dot plus chip plus the
 * billed centerline instead of nothing.
 */
export const BEAM_FADE_GONE_FRACTION = 0.3;

/**
 * Fraction of a beam's length that fits in the view at that distance. Above 1
 * the whole beam fits with room to spare.
 *
 * This compares the beam against the frustum's height in ground meters rather
 * than projecting its top to the window, because a 6000 km beam seen from
 * close up has a top that projects behind the camera, where window coordinates
 * stop meaning anything.
 */
export function beamVisibleFraction(
  beamHeightMeters: number,
  cameraDistanceMeters: number,
  verticalFov: number,
): number {
  if (beamHeightMeters <= 0) {
    return 1;
  }
  return viewHeightAtDistanceMeters(cameraDistanceMeters, verticalFov) / beamHeightMeters;
}

/**
 * Alpha multiplier for a beam showing `visibleFraction` of its length.
 * Smoothstepped rather than linear so a beam doesn't appear to lurch as it goes.
 */
export function beamFadeAlphaScale(visibleFraction: number): number {
  if (!Number.isFinite(visibleFraction)) {
    return 1;
  }
  if (visibleFraction >= 1) {
    return 1;
  }
  if (visibleFraction <= BEAM_FADE_GONE_FRACTION) {
    return 0;
  }
  const t = (visibleFraction - BEAM_FADE_GONE_FRACTION) / (1 - BEAM_FADE_GONE_FRACTION);
  return t * t * (3 - 2 * t);
}

/**
 * Fade steps. The color uniform has to be rewritten to change alpha, so a
 * continuous value would touch every beam every frame of a zoom. 24 steps is
 * finer than the eye can follow and means a still camera rebuilds nothing.
 */
export const BEAM_FADE_STEPS = 24;

export function quantizeBeamFade(alphaScale: number): number {
  return Math.round(alphaScale * BEAM_FADE_STEPS) / BEAM_FADE_STEPS;
}

/**
 * Whether the Color line itself should draw. Horizon culling, zero-length
 * measures, and a fully faded beam all drop the primitive rather than leaving
 * a transparent quad in the blend list.
 */
export function beamLineVisible(show: boolean, heightMeters: number, fade: number): boolean {
  return show && heightMeters > 0 && fade > 0;
}

function drawableWidthPx(widthPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0) {
    return BEAM_WIDTH_PX_DEFAULT;
  }
  return Math.max(1, widthPx);
}

function drawableAlpha(alpha: number): number {
  if (!Number.isFinite(alpha) || alpha <= 0) {
    return BEAM_ALPHA;
  }
  return Math.min(1, Math.max(0.1, alpha));
}

/**
 * Rewrites a beam's color. `alphaScale` carries both the layer's own dimming
 * (ingest sits behind perception) and the fade above. `beamAlpha` is the
 * viewer's resting opacity from settings.
 *
 * Mutates the Color uniform in place so a fade step does not allocate a
 * material. glowPower / taperPower stay put — they are not per-frame.
 */
export function applyBeamColor(
  polyline: Polyline,
  color: Color,
  alphaScale: number,
  beamAlpha: number = BEAM_ALPHA,
): void {
  const dest = polyline.material.uniforms.color as Color | undefined;
  if (!dest) {
    return;
  }
  Color.clone(color, dest);
  dest.alpha = drawableAlpha(beamAlpha) * alphaScale;
}

/**
 * Rewrites a beam's screen-space width after the setting moves.
 *
 * Width is the one beam property a settings change can alter without touching
 * geometry or material, so it is written straight onto the polyline rather
 * than folded into the per-frame tint.
 */
export function applyBeamWidth(polyline: Polyline, widthPx: number): void {
  polyline.width = drawableWidthPx(widthPx);
}

/**
 * Positions run TOP → BASE, and that order is load-bearing: Cesium's glow
 * taper fades the start of the line, which is the tip.
 */
export function beamPositionsDegrees(
  lon: number,
  lat: number,
  heightMeters: number,
): number[] {
  return [lon, lat, BEAM_BASE_HEIGHT_M + heightMeters, lon, lat, BEAM_BASE_HEIGHT_M];
}

export interface BeamPrimitive {
  /** Mutated in place so a beam can be re-aimed without rebuilding the polyline. */
  readonly positions: Cartesian3[];
  readonly polyline: Polyline;
  readonly baseEntity: Entity;
}

/**
 * Adds one beam — a PolylineGlow strip in the layer's batched collection,
 * plus its ground point in the entity source.
 *
 * Positions are a plain Cartesian3 array assigned onto the polyline, not a
 * per-frame CallbackProperty. The collection rebuilds a polyline only when
 * that array is reassigned (cluster re-aim) or its uniforms change (quantized
 * fade / width slider).
 *
 * `alphaScale` dims a whole beam — ingest beams sit behind perception beams.
 * `widthPx` is screen pixels, default {@link BEAM_WIDTH_PX_DEFAULT}.
 */
export function addBeam(
  polylines: PolylineCollection,
  source: CustomDataSource,
  idPrefix: string,
  options: {
    readonly lon: number;
    readonly lat: number;
    readonly heightMeters: number;
    readonly color: Color;
    readonly alphaScale?: number;
    readonly widthPx?: number;
    readonly beamAlpha?: number;
  },
): BeamPrimitive {
  const alphaScale = options.alphaScale ?? 1;
  const widthPx = drawableWidthPx(options.widthPx ?? BEAM_WIDTH_PX_DEFAULT);
  const beamAlpha = drawableAlpha(options.beamAlpha ?? BEAM_ALPHA);
  const positions = Cartesian3.fromDegreesArrayHeights(
    beamPositionsDegrees(options.lon, options.lat, options.heightMeters),
  );

  const polyline = polylines.add({
    id: `${idPrefix}:beam`,
    show: options.heightMeters > 0,
    positions,
    width: widthPx,
    material: Material.fromType("PolylineGlow", {
      color: options.color.withAlpha(beamAlpha * alphaScale),
      glowPower: BEAM_GLOW_POWER,
      taperPower: BEAM_TAPER_POWER,
    }),
  });

  const baseEntity = source.entities.add({
    id: `${idPrefix}:base`,
    position: Cartesian3.fromDegrees(options.lon, options.lat, BEAM_BASE_HEIGHT_M),
    point: beamBasePointGraphics(options.color, alphaScale),
  });

  return { positions, polyline, baseEntity };
}
