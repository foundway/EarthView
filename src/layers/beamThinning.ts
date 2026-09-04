/**
 * Density-preserving beam thinning — weighted Poisson-disk sampling in screen
 * space.
 *
 * The problem this solves sits between the two things merging already does and
 * neither of them is right. A month of requests over one metro puts dozens of
 * beams inside a few pixels: individually legible, collectively a solid wall
 * that hides both the ground geometry and each other. Merging them all into one
 * beam fixes the wall by deleting the metro — a corridor with 60 collects and a
 * corridor with 3 draw the same single line, so the map stops showing where the
 * work is.
 *
 * Poisson-disk sampling is the standard answer (Bridson 2007 for the generative
 * form; in visualization it is the basis of the "spatially resampled scatterplot"
 * family, e.g. Chen et al., *Recursive Random Sampling*, and Bertini & Santucci's
 * work on overplotting). The property that matters here: samples are at least
 * `radiusPx` apart, so nothing overlaps, but the *number* of samples still scales
 * with the area the data covers. A dense metro keeps as many beams as physically
 * fit at that spacing; a sparse corridor keeps all of them. Density survives,
 * overplotting does not.
 *
 * Two deviations from textbook Poisson-disk, both about this being a per-frame
 * render decision rather than a one-off point-set generation:
 *
 * - **Weighted, not random, priority.** Textbook dart-throwing picks candidates
 *   at random. Here candidates are walked in descending `weight` (billed metres,
 *   area pre-scaled), so a 400 km request wins the slot over ten 2 km ones
 *   instead of whichever the RNG reached first. Ties break on id, so the same
 *   camera always produces the same beams.
 * - **Hysteresis.** A candidate at exactly `radiusPx` would flip accepted /
 *   suppressed on sub-pixel camera drift. A beam that already holds a slot keeps
 *   it until it closes to {@link THIN_HOLD_FRACTION} of the radius, so the
 *   accept and release thresholds differ — the same Schmitt-trigger shape as the
 *   12 px / 18 px merge-split pair.
 *
 * No candidate is ever silently dropped: every suppressed candidate is
 * attributed to the nearest surviving sample, and the layers roll those ids into
 * the surviving beam's cluster. That is what keeps the number chips honest —
 * thinning changes which beams draw, never what the globe reports.
 *
 * Sampling never crosses a **partition** — see {@link thinByPartition}.
 */

/**
 * Width in CSS pixels of a beam at the default setting — what reads as "the
 * beam", and therefore the natural unit for how far apart two beams have to
 * be before they stop overlapping.
 *
 * This is the default glow-strip width, restated so this module (and the
 * settings dialog that labels the slider) stays free of Cesium. A test in
 * `beamGlow.test.ts` pins it to `BEAM_WIDTH_PX_DEFAULT`.
 */
export const BEAM_CORE_WIDTH_PX = 8;

/**
 * A beam that already holds a slot is only suppressed once it closes to this
 * fraction of the sampling radius. Below 1 by exactly as much as it takes to
 * cover camera jitter without letting held beams visibly pile up.
 */
export const THIN_HOLD_FRACTION = 0.7;

export interface ThinCandidate {
  readonly id: string;
  /** Window coordinates in CSS pixels. */
  readonly x: number;
  readonly y: number;
  /** Larger wins the slot. Billed metres, with area already scaled down. */
  readonly weight: number;
}

export interface ThinSample {
  /** The surviving candidate. */
  readonly id: string;
  /** Candidates suppressed by this one, nearest-sample attribution, sorted. */
  readonly absorbedIds: readonly string[];
}

/**
 * Thinning is an **overview** tool, and the sampling radius releases as the
 * camera comes down so that zooming in returns to the unthinned globe.
 *
 * Screen-space sampling is already dynamic — it reruns every frame on window
 * coordinates, so beams do reappear as ground features separate. On its own,
 * though, that reveal is far too slow to read as one: two requests 500 m apart
 * need the camera down near street zoom before their cores clear a core width,
 * and beams have faded out long before that. The net effect is thinning still culling at the
 * regional zoom where you are trying to inspect individual requests, which is
 * the same mistake `pathLod` refuses to make when it says a sub-pixel path
 * decimates but never disappears.
 *
 * So the release is keyed to the *same* quantity the fade is: how many times
 * the shortest beam (`MIN_BEAM_HEIGHT_M`) fits in the view. Full spacing while
 * it fits {@link THIN_RELEASE_FULL_SPREAD} times or more; no thinning at all
 * once it fits {@link THIN_RELEASE_OFF_SPREAD} times or less — and that floor is
 * exactly where `beamFadeAlphaScale` starts dimming the shortest beam. The two
 * mechanisms hand off rather than overlap: thinning owns the overview, the fade
 * owns the descent, and neither is ever the reason a beam you zoomed in to look
 * at is missing.
 *
 * On a typical 16:9 window those thresholds land near **4,200 km** and
 * **1,050 km** of camera height (see the pinning test). Both numbers are
 * chosen against what the globe looks like at that framing, and the top one is
 * the load-bearing one: a continental view of the US sits around 5,000 km, and
 * that is precisely where the wall of overlapping beams appears, so full
 * spacing has to still apply there. An earlier, gentler ramp released most of
 * the spacing by 5,000 km and handed the wall straight back.
 */
export const THIN_RELEASE_FULL_SPREAD = 4;
export const THIN_RELEASE_OFF_SPREAD = 1;

/**
 * Fraction of the configured spacing that applies at the current framing.
 *
 * `spread` is how many times the reference beam fits in the view height —
 * `beamVisibleFraction(MIN_BEAM_HEIGHT_M, cameraHeight, fov)`. Smoothstepped
 * for the same reason the fade is: a linear ramp makes beams arrive in a
 * visible lurch partway through a zoom.
 */
export function thinReleaseScale(spread: number): number {
  if (!Number.isFinite(spread)) {
    return 1;
  }
  if (spread >= THIN_RELEASE_FULL_SPREAD) {
    return 1;
  }
  if (spread <= THIN_RELEASE_OFF_SPREAD) {
    return 0;
  }
  const t =
    (spread - THIN_RELEASE_OFF_SPREAD) / (THIN_RELEASE_FULL_SPREAD - THIN_RELEASE_OFF_SPREAD);
  return t * t * (3 - 2 * t);
}

/**
 * Sampling radius in CSS pixels for a spacing expressed in beam widths, scaled
 * by the camera's release (1 at overview altitudes, 0 once zoomed in).
 *
 * `widthPx` is the viewer's beam-width setting, and it belongs here: "1 core =
 * beams may touch but not overlap" is a claim about the beams being drawn, so
 * widening them without widening the spacing hands back the wall of overlapping
 * columns that thinning exists to prevent.
 */
export function samplingRadiusPx(
  radiusCores: number,
  releaseScale = 1,
  widthPx = BEAM_CORE_WIDTH_PX,
): number {
  if (!Number.isFinite(radiusCores) || radiusCores <= 0) {
    return 0;
  }
  if (!Number.isFinite(releaseScale) || releaseScale <= 0) {
    return 0;
  }
  const width = Number.isFinite(widthPx) && widthPx > 0 ? widthPx : BEAM_CORE_WIDTH_PX;
  return radiusCores * width * Math.min(releaseScale, 1);
}

function finiteWeight(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Picks the subset of `candidates` that can draw without overlapping, and tells
 * each survivor which candidates it stands for.
 *
 * `held` is the previous frame's surviving ids; passing it is what makes the
 * result temporally stable, and passing an empty set makes the function pure in
 * its other arguments.
 *
 * A radius of 0 (or a single candidate) means no thinning: every candidate
 * survives, absorbing nothing.
 */
export function thinByPoissonDisk(
  candidates: readonly ThinCandidate[],
  radiusPx: number,
  held: ReadonlySet<string> = new Set(),
): ThinSample[] {
  if (!(radiusPx > 0) || candidates.length < 2) {
    return candidates.map((candidate) => ({ id: candidate.id, absorbedIds: [] }));
  }

  const holdRadius = radiusPx * THIN_HOLD_FRACTION;
  const order = [...candidates].sort((a, b) => {
    const heldRank = (held.has(b.id) ? 1 : 0) - (held.has(a.id) ? 1 : 0);
    if (heldRank !== 0) {
      return heldRank;
    }
    const byWeight = finiteWeight(b.weight) - finiteWeight(a.weight);
    return byWeight !== 0 ? byWeight : a.id.localeCompare(b.id);
  });

  // Cells are exactly one radius wide, so every sample within a radius of a
  // candidate lives in the 3x3 block around that candidate's own cell.
  const grid = new Map<string, ThinCandidate[]>();
  const absorbed = new Map<string, string[]>();

  for (const candidate of order) {
    const cx = Math.floor(candidate.x / radiusPx);
    const cy = Math.floor(candidate.y / radiusPx);

    let nearest: ThinCandidate | null = null;
    let nearestDistance = Infinity;
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
      for (let iy = cy - 1; iy <= cy + 1; iy += 1) {
        for (const sample of grid.get(cellKey(ix, iy)) ?? []) {
          const distance = Math.hypot(sample.x - candidate.x, sample.y - candidate.y);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = sample;
          }
        }
      }
    }

    const clearance = held.has(candidate.id) ? holdRadius : radiusPx;
    if (nearest !== null && nearestDistance < clearance) {
      absorbed.get(nearest.id)?.push(candidate.id);
      continue;
    }

    absorbed.set(candidate.id, []);
    const bucket = grid.get(cellKey(cx, cy));
    if (bucket) {
      bucket.push(candidate);
    } else {
      grid.set(cellKey(cx, cy), [candidate]);
    }
  }

  return [...absorbed.entries()]
    .map(([id, absorbedIds]) => ({ id, absorbedIds: absorbedIds.slice().sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export interface PartitionedCandidate extends ThinCandidate {
  /** Sampled only against candidates carrying the same value. */
  readonly partition: string;
}

/**
 * One independent {@link thinByPoissonDisk} pass per partition.
 *
 * A partition is a claim that two beams mean *different things*, so crowding
 * must never concatenate one into the other: billing unit (a distance sample
 * absorbing an area request would invent a mixed-unit beam and chip) and
 * highlighted-new (a sample absorbing a new request would carry its metres, so
 * the chip would read `NEW 270 mi (4)` and call three old requests new).
 *
 * Within a partition, nothing is special — new beams thin against each other
 * exactly like any others, and a crowd of them collapses to the ones that fit
 * rather than stacking into a wall.
 *
 * The cost is that spacing only holds *inside* a partition: a distance beam and
 * an area beam, or a new beam and an old one, can still land on top of each
 * other because neither pass can see the other's samples. Overlap between a
 * handful of partitions is the price of never lying about what a beam totals.
 * Every extra partition multiplies that overlap, so add one only for a
 * difference a merged number would actually misreport.
 */
export function thinByPartition(
  candidates: readonly PartitionedCandidate[],
  radiusPx: number,
  held: ReadonlySet<string> = new Set(),
): ThinSample[] {
  const byPartition = new Map<string, PartitionedCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byPartition.get(candidate.partition);
    if (bucket) {
      bucket.push(candidate);
    } else {
      byPartition.set(candidate.partition, [candidate]);
    }
  }

  // Partition order is sorted, not insertion order, so the same camera always
  // produces the same samples in the same order.
  return [...byPartition.keys()]
    .sort()
    .flatMap((partition) =>
      thinByPoissonDisk(byPartition.get(partition) ?? [], radiusPx, held),
    );
}
