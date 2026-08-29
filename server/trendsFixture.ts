import type { TrendsResponse } from "../src/data/trendsTypes.js";
import { normalizeTrendRows, type RawTrendRow, type TrendsQuery } from "./trends.js";

const FIXTURE_WEEK = "2026-08-23";
const FIXTURE_REFRESH = "2026-08-28";

const TOP_ROWS: readonly RawTrendRow[] = [
  { country_code: "US", country_name: "United States", term: "weather", rank: 1, score: 100, week: FIXTURE_WEEK, contributing_regions: 210 },
  { country_code: "GB", country_name: "United Kingdom", term: "football", rank: 1, score: 94, week: FIXTURE_WEEK, contributing_regions: 12 },
  { country_code: "IN", country_name: "India", term: "cricket", rank: 1, score: 91, week: FIXTURE_WEEK, contributing_regions: 36 },
  { country_code: "JP", country_name: "Japan", term: "台風", rank: 2, score: 88, week: FIXTURE_WEEK, contributing_regions: 47 },
  { country_code: "BR", country_name: "Brazil", term: "futebol", rank: 2, score: 84, week: FIXTURE_WEEK, contributing_regions: 27 },
  { country_code: "AU", country_name: "Australia", term: "news", rank: 3, score: 78, week: FIXTURE_WEEK, contributing_regions: 8 },
  { country_code: "DE", country_name: "Germany", term: "bundesliga", rank: 3, score: 74, week: FIXTURE_WEEK, contributing_regions: 16 },
  { country_code: "ZA", country_name: "South Africa", term: "load shedding", rank: 4, score: 68, week: FIXTURE_WEEK, contributing_regions: 9 },
  { country_code: "CA", country_name: "Canada", term: "wildfire map", rank: 4, score: 64, week: FIXTURE_WEEK, contributing_regions: 13 },
  { country_code: "FR", country_name: "France", term: "météo", rank: 5, score: 59, week: FIXTURE_WEEK, contributing_regions: 18 },
];

const RISING_ROWS: readonly RawTrendRow[] = TOP_ROWS.map((row, index) => ({
  ...row,
  term: [
    "aurora forecast",
    "rail strikes",
    "lunar eclipse",
    "earthquake alert",
    "world cup qualifiers",
    "solar storm",
    "election results",
    "springboks",
    "air quality",
    "festival programme",
  ][index],
  percent_gain: 5_000 - index * 375,
}));

export function fixtureTrends(query: TrendsQuery): TrendsResponse {
  const source = query.mode === "rising" ? RISING_ROWS : TOP_ROWS;
  const filtered = source.filter((row) => {
    const countryMatches = !query.country || row.country_code === query.country;
    const termMatches =
      !query.term ||
      String(row.term).toLocaleLowerCase("en-US").includes(query.term.toLocaleLowerCase("en-US"));
    return countryMatches && termMatches;
  });
  const { trends, omittedUnmappedRows } = normalizeTrendRows(filtered.slice(0, query.limit));
  return {
    trends,
    metadata: {
      mode: query.mode,
      refreshDate: FIXTURE_REFRESH,
      week: FIXTURE_WEEK,
      source: "development-fixture",
      sourceLabel: "Deterministic development fixture · not live Google data",
      coverage: "International regions aggregated to mapped country centroids",
      returnedRows: trends.length,
      omittedUnmappedRows,
      filters: { country: query.country, term: query.term },
    },
  };
}
