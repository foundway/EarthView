import { BigQuery, type BigQueryOptions } from "@google-cloud/bigquery";
import { COUNTRY_CENTROIDS } from "../src/data/countryCentroids.js";
import type {
  GeographicTrend,
  TrendsMode,
  TrendsResponse,
} from "../src/data/trendsTypes.js";

const TABLES = {
  top: "international_top_terms",
  rising: "international_top_rising_terms",
} as const;

export const DEFAULT_LIMIT = 60;
export const MAX_LIMIT = 100;

export interface TrendsQuery {
  readonly mode: TrendsMode;
  readonly limit: number;
  readonly country: string | null;
  readonly term: string | null;
}

export interface RawTrendRow {
  readonly country_code?: unknown;
  readonly country_name?: unknown;
  readonly term?: unknown;
  readonly rank?: unknown;
  readonly score?: unknown;
  readonly percent_gain?: unknown;
  readonly week?: unknown;
  readonly contributing_regions?: unknown;
}

export class TrendsRequestError extends Error {}
export class TrendsConfigError extends Error {}

function singleValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

export function parseTrendsQuery(
  values: Record<string, string | readonly string[] | undefined>,
): TrendsQuery {
  const modeValue = singleValue(values.mode) ?? "top";
  if (modeValue !== "top" && modeValue !== "rising") {
    throw new TrendsRequestError('mode must be either "top" or "rising"');
  }

  const limitValue = singleValue(values.limit);
  const limit = limitValue === undefined ? DEFAULT_LIMIT : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TrendsRequestError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }

  const countryValue = singleValue(values.country)?.trim().toUpperCase() || null;
  if (countryValue !== null && !/^[A-Z]{2}$/.test(countryValue)) {
    throw new TrendsRequestError("country must be a two-letter ISO country code");
  }

  const termValue = singleValue(values.term)?.trim() || null;
  if (termValue !== null && (termValue.length > 80 || /[\u0000-\u001f\u007f]/.test(termValue))) {
    throw new TrendsRequestError("term must be 80 printable characters or fewer");
  }

  return { mode: modeValue, limit, country: countryValue, term: termValue };
}

export function buildTrendsSql(mode: TrendsMode): string {
  const table = TABLES[mode];
  const gain = mode === "rising" ? "MAX(percent_gain)" : "CAST(NULL AS FLOAT64)";
  return `
    WITH current_week AS (
      SELECT MAX(week) AS week
      FROM \`bigquery-public-data.google_trends.${table}\`
      WHERE refresh_date = @refreshDate
    ),
    country_terms AS (
      SELECT
        country_code,
        ARRAY_AGG(country_name IGNORE NULLS ORDER BY rank LIMIT 1)[SAFE_OFFSET(0)] AS country_name,
        term,
        MIN(rank) AS rank,
        MAX(score) AS score,
        ${gain} AS percent_gain,
        MAX(week) AS week,
        COUNT(DISTINCT region_code) AS contributing_regions
      FROM \`bigquery-public-data.google_trends.${table}\`
      CROSS JOIN current_week
      WHERE refresh_date = @refreshDate
        AND week = current_week.week
        AND country_code IS NOT NULL
        AND (@country IS NULL OR country_code = @country)
        AND (@term IS NULL OR LOWER(term) LIKE CONCAT('%', LOWER(@term), '%'))
      GROUP BY country_code, term
    )
    SELECT *
    FROM country_terms
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY country_code
      ORDER BY rank ASC, score DESC, term ASC
    ) = 1
    ORDER BY score DESC, rank ASC, country_code ASC
    LIMIT @limit
  `;
}

function dateString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && value !== null && "value" in value) {
    return String((value as { value: unknown }).value);
  }
  return "";
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeTrendRows(rows: readonly RawTrendRow[]): {
  readonly trends: GeographicTrend[];
  readonly omittedUnmappedRows: number;
} {
  const trends: GeographicTrend[] = [];
  let omittedUnmappedRows = 0;

  for (const row of rows) {
    const countryCode = String(row.country_code ?? "").toUpperCase();
    const centroid = COUNTRY_CENTROIDS[countryCode];
    if (!centroid) {
      omittedUnmappedRows += 1;
      continue;
    }
    const term = String(row.term ?? "").trim();
    const rank = finiteNumber(row.rank);
    const score = finiteNumber(row.score);
    const week = dateString(row.week);
    if (!term || rank === null || score === null || !week) continue;

    trends.push({
      id: `${countryCode}:${term.toLocaleLowerCase("en-US")}`,
      term,
      rank: Math.max(1, Math.round(rank)),
      score: Math.max(0, Math.min(100, score)),
      percentGain: finiteNumber(row.percent_gain),
      week,
      location: {
        countryCode,
        countryName: String(row.country_name ?? centroid.name),
        latitude: centroid.latitude,
        longitude: centroid.longitude,
      },
      contributingRegions: Math.max(0, Math.round(finiteNumber(row.contributing_regions) ?? 0)),
    });
  }

  return { trends, omittedUnmappedRows };
}

function bigQueryOptionsFromEnv(env: NodeJS.ProcessEnv): BigQueryOptions {
  let jsonCredentials: Record<string, string> | undefined;
  if (env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      jsonCredentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as Record<string, string>;
    } catch {
      throw new TrendsConfigError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON");
    }
  }

  const credentials =
    jsonCredentials ??
    (env.GOOGLE_CLIENT_EMAIL && env.GOOGLE_PRIVATE_KEY
      ? {
          client_email: env.GOOGLE_CLIENT_EMAIL,
          private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }
      : undefined);
  const projectId =
    env.GOOGLE_CLOUD_PROJECT ??
    env.GCLOUD_PROJECT ??
    env.GCP_PROJECT ??
    jsonCredentials?.project_id;

  if (!projectId) {
    throw new TrendsConfigError(
      "Set GOOGLE_CLOUD_PROJECT (and Application Default Credentials) to query Google Trends",
    );
  }
  return { projectId, credentials };
}

export function createBigQueryClient(env: NodeJS.ProcessEnv = process.env): BigQuery {
  return new BigQuery(bigQueryOptionsFromEnv(env));
}

export interface TrendsBigQueryClient {
  query(options: {
    query: string;
    params?: Record<string, unknown>;
    location?: string;
  }): Promise<[unknown[]]>;
}

async function latestPartition(
  client: TrendsBigQueryClient,
  tableName: string,
): Promise<string> {
  const [rows] = await client.query({
    location: "US",
    query: `
      SELECT MAX(partition_id) AS latest_partition
      FROM \`bigquery-public-data.google_trends.INFORMATION_SCHEMA.PARTITIONS\`
      WHERE table_name = @tableName
        AND REGEXP_CONTAINS(partition_id, r'^\\d{8}$')
    `,
    params: { tableName },
  });
  const partition = String(
    (rows[0] as { latest_partition?: unknown } | undefined)?.latest_partition ?? "",
  );
  if (!/^\d{8}$/.test(partition)) {
    throw new Error("Google Trends has no available refresh partition");
  }
  return `${partition.slice(0, 4)}-${partition.slice(4, 6)}-${partition.slice(6, 8)}`;
}

export async function loadTrends(
  query: TrendsQuery,
  client?: TrendsBigQueryClient,
): Promise<TrendsResponse> {
  const activeClient: TrendsBigQueryClient =
    client ??
    (() => {
      const bigQuery = createBigQueryClient();
      return {
        async query(options) {
          const [rows] = await bigQuery.query(options);
          return [rows];
        },
      };
    })();
  const refreshDate = await latestPartition(activeClient, TABLES[query.mode]);
  const [rawRows] = await activeClient.query({
    location: "US",
    query: buildTrendsSql(query.mode),
    params: {
      refreshDate,
      country: query.country,
      term: query.term,
      limit: query.limit,
    },
  });
  const { trends, omittedUnmappedRows } = normalizeTrendRows(rawRows as RawTrendRow[]);
  const week = trends[0]?.week ?? "";

  return {
    trends,
    metadata: {
      mode: query.mode,
      refreshDate,
      week,
      source: "google-bigquery",
      sourceLabel: "Google Trends · BigQuery public dataset",
      coverage: "International regions aggregated to mapped country centroids",
      returnedRows: trends.length,
      omittedUnmappedRows,
      filters: { country: query.country, term: query.term },
    },
  };
}
