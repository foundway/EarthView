import type { GeographicTrend } from "../data/trendsTypes";

export const TREND_TERM_MAX_CHARS = 16;

export type TrendLabelTone = "term" | "score" | "count";

export interface TrendLabelPart {
  readonly text: string;
  readonly tone: TrendLabelTone;
}

export interface TrendCardContent {
  readonly parts: readonly TrendLabelPart[];
  /** Flat text, for width measurement and caching. */
  readonly text: string;
}

function graphemes(value: string): string[] {
  return [...value.normalize("NFC")];
}

/** Keep chips short so Europe still has room to dodge. */
export function truncateTerm(term: string, maxChars: number = TREND_TERM_MAX_CHARS): string {
  const characters = graphemes(term.trim());
  if (characters.length <= maxChars) {
    return characters.join("");
  }
  return `${characters.slice(0, Math.max(1, maxChars - 1)).join("")}…`;
}

/**
 * The number the beam already encodes: relative score for top searches,
 * percent gain for rising. Scores are not summed when chips merge — they are
 * not volumes.
 */
export function formatTrendValue(trend: GeographicTrend): string {
  if (trend.percentGain !== null && Number.isFinite(trend.percentGain)) {
    const gain = Math.round(trend.percentGain);
    return `${gain >= 0 ? "+" : ""}${gain.toLocaleString("en-US")}%`;
  }
  const score = Number.isFinite(trend.score) ? Math.round(trend.score) : 0;
  return String(score);
}

/** Strongest term wins a merged chip: higher score, then better rank, then id. */
export function pickTrendLeader(trends: readonly GeographicTrend[]): GeographicTrend | null {
  if (trends.length === 0) {
    return null;
  }
  return [...trends].sort(
    (left, right) =>
      right.score - left.score ||
      left.rank - right.rank ||
      left.id.localeCompare(right.id),
  )[0];
}

/**
 * Compact pin label: term + the number that sized the beam.
 * Crowded pins share one chip; the extra count rides along.
 */
export function trendCardContent(trends: readonly GeographicTrend[]): TrendCardContent | null {
  const leader = pickTrendLeader(trends);
  if (!leader) {
    return null;
  }
  const parts: TrendLabelPart[] = [
    { text: truncateTerm(leader.term), tone: "term" },
    { text: formatTrendValue(leader), tone: "score" },
  ];
  if (trends.length > 1) {
    parts.push({ text: `(${trends.length})`, tone: "count" });
  }
  return { parts, text: parts.map((part) => part.text).join(" ") };
}
