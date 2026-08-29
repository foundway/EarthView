export interface TrendBeamVisual {
  readonly heightMeters: number;
  readonly widthPixels: number;
  readonly alpha: number;
  readonly hue: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Stable FNV-1a hue so a term keeps the same color across reloads and countries. */
export function termHue(term: string): number {
  let hash = 0x811c9dc5;
  for (const character of term.normalize("NFKC").toLocaleLowerCase("en-US")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 360;
}

/**
 * Positions run TOP -> BASE. Cesium's glow taper fades the start of the line,
 * so this order puts the needle at the tip and keeps the bloom on the ground.
 */
export function beamPositionsDegrees(
  longitude: number,
  latitude: number,
  heightMeters: number,
): number[] {
  return [longitude, latitude, heightMeters, longitude, latitude, 0];
}

/**
 * Score drives length and opacity; rank adds modest width emphasis.
 * Inputs are clamped because the upstream dataset is expected, not trusted.
 */
export function mapTrendBeam(score: number, rank: number, term: string): TrendBeamVisual {
  const normalizedScore = clamp(Number.isFinite(score) ? score : 0, 0, 100) / 100;
  const normalizedRank = 1 - (clamp(Number.isFinite(rank) ? rank : 25, 1, 25) - 1) / 24;
  return {
    heightMeters: 300_000 + normalizedScore * 2_700_000,
    widthPixels: 2.5 + normalizedScore * 3.5 + normalizedRank * 2,
    alpha: 0.42 + normalizedScore * 0.5,
    hue: termHue(term),
  };
}
