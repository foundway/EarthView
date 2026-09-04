import { describe, expect, it, vi } from "vitest";
import {
  buildTrendsSql,
  createBigQueryClient,
  loadTrends,
  normalizeTrendRows,
  parseTrendsQuery,
  TrendsConfigError,
  TrendsRequestError,
  type TrendsBigQueryClient,
} from "./trends";

describe("trends query validation", () => {
  it("applies safe defaults and normalizes filters", () => {
    expect(parseTrendsQuery({ country: " ca ", term: " weather " })).toEqual({
      mode: "top",
      limit: 60,
      country: "CA",
      term: "weather",
    });
  });

  it("rejects invalid modes, limits, and country codes", () => {
    expect(() => parseTrendsQuery({ mode: "popular" })).toThrow(TrendsRequestError);
    expect(() => parseTrendsQuery({ limit: "101" })).toThrow(TrendsRequestError);
    expect(() => parseTrendsQuery({ country: "USA" })).toThrow(TrendsRequestError);
  });

  it("requires a billing project for ADC", () => {
    expect(() => createBigQueryClient({})).toThrow(TrendsConfigError);
  });
});

describe("trends SQL and normalization", () => {
  it("uses the selected fixed table and an exact partition parameter", () => {
    const sql = buildTrendsSql("rising");
    expect(sql).toContain("international_top_rising_terms");
    expect(sql).toContain("trends.refresh_date = @refreshDate");
    expect(sql).toContain("trends.week = current_week.week");
    expect(sql).toContain("MAX(trends.percent_gain)");
  });

  it("maps known ISO codes and explicitly counts unmapped rows", () => {
    const result = normalizeTrendRows([
      {
        country_code: "CA",
        country_name: "Canada",
        term: "aurora",
        rank: 2,
        score: 120,
        week: { value: "2026-08-23" },
        contributing_regions: 13,
      },
      { country_code: "XX", term: "unknown", rank: 1, score: 100, week: "2026-08-23" },
    ]);
    expect(result.omittedUnmappedRows).toBe(1);
    expect(result.trends[0]).toMatchObject({
      term: "aurora",
      score: 100,
      location: { countryCode: "CA", latitude: 56.13 },
    });
  });

  it("loads the newest partition before the bounded data query", async () => {
    const query = vi
      .fn<TrendsBigQueryClient["query"]>()
      .mockResolvedValueOnce([[{ latest_partition: "20260828" }]])
      .mockResolvedValueOnce([
        [
          {
            country_code: "US",
            country_name: "United States",
            term: "weather",
            rank: 1,
            score: 100,
            week: "2026-08-23",
            contributing_regions: 210,
          },
        ],
      ]);
    const response = await loadTrends(
      { mode: "top", limit: 20, country: null, term: null },
      { query },
    );
    expect(response.metadata.refreshDate).toBe("2026-08-28");
    expect(response.metadata.source).toBe("google-bigquery");
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0].params).toMatchObject({ refreshDate: "2026-08-28", limit: 20 });
    expect(query.mock.calls[1]?.[0].types).toMatchObject({
      refreshDate: "STRING",
      country: "STRING",
      term: "STRING",
      limit: "INT64",
    });
  });
});
