import { describe, expect, it } from "vitest";
import type { GeographicTrend } from "../data/trendsTypes";
import {
  formatTrendValue,
  pickTrendLeader,
  trendCardContent,
  truncateTerm,
} from "./trendCardLabel";

function trend(overrides: Partial<GeographicTrend> = {}): GeographicTrend {
  return {
    id: "US:weather",
    term: "weather",
    rank: 1,
    score: 100,
    percentGain: null,
    week: "2026-08-23",
    contributingRegions: 12,
    location: {
      countryCode: "US",
      countryName: "United States",
      latitude: 39.8,
      longitude: -98.6,
    },
    ...overrides,
  };
}

describe("truncateTerm", () => {
  it("keeps short terms intact", () => {
    expect(truncateTerm("weather")).toBe("weather");
    expect(truncateTerm("台風")).toBe("台風");
  });

  it("ellipsis-truncates long terms by grapheme", () => {
    expect(truncateTerm("international football", 16)).toBe("international f…");
  });
});

describe("formatTrendValue", () => {
  it("shows relative score for top searches", () => {
    expect(formatTrendValue(trend({ score: 94.4 }))).toBe("94");
  });

  it("shows signed percent gain for rising searches", () => {
    expect(formatTrendValue(trend({ percentGain: 420 }))).toBe("+420%");
    expect(formatTrendValue(trend({ percentGain: -12 }))).toBe("-12%");
  });
});

describe("trendCardContent", () => {
  it("pairs the term with the number the beam encodes", () => {
    expect(trendCardContent([trend()])).toEqual({
      parts: [
        { text: "weather", tone: "term" },
        { text: "100", tone: "score" },
      ],
      text: "weather 100",
    });
  });

  it("keeps the strongest term when crowded pins share a chip", () => {
    const content = trendCardContent([
      trend({ id: "GB:football", term: "football", score: 94, rank: 2 }),
      trend({ id: "US:weather", term: "weather", score: 100, rank: 1 }),
    ]);
    expect(content?.text).toBe("weather 100 (2)");
    expect(pickTrendLeader([
      trend({ id: "GB:football", term: "football", score: 94, rank: 2 }),
      trend({ id: "US:weather", term: "weather", score: 100, rank: 1 }),
    ])?.id).toBe("US:weather");
  });
});
