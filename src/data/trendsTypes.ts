export type TrendsMode = "top" | "rising";

export interface TrendLocation {
  readonly countryCode: string;
  readonly countryName: string;
  readonly latitude: number;
  readonly longitude: number;
}

export interface GeographicTrend {
  readonly id: string;
  readonly term: string;
  readonly rank: number;
  readonly score: number;
  readonly percentGain: number | null;
  readonly week: string;
  readonly location: TrendLocation;
  readonly contributingRegions: number;
}

export interface TrendsMetadata {
  readonly mode: TrendsMode;
  readonly refreshDate: string;
  readonly week: string;
  readonly source: "google-bigquery" | "development-fixture";
  readonly sourceLabel: string;
  readonly coverage: string;
  readonly returnedRows: number;
  readonly omittedUnmappedRows: number;
  readonly filters: {
    readonly country: string | null;
    readonly term: string | null;
  };
}

export interface TrendsResponse {
  readonly trends: readonly GeographicTrend[];
  readonly metadata: TrendsMetadata;
}
