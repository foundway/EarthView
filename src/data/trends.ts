import type { TrendsMode, TrendsResponse } from "./trendsTypes";

export interface TrendsFilters {
  readonly mode: TrendsMode;
  readonly country?: string;
  readonly term?: string;
  readonly limit?: number;
}

export async function fetchTrends(
  filters: TrendsFilters,
  signal?: AbortSignal,
): Promise<TrendsResponse> {
  const params = new URLSearchParams({ mode: filters.mode });
  if (filters.country) params.set("country", filters.country);
  if (filters.term) params.set("term", filters.term);
  if (filters.limit) params.set("limit", String(filters.limit));

  const response = await fetch(`/api/trends?${params}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    let message = `Trends request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string") message = body.error;
    } catch {
      // Keep the HTTP status fallback when a platform returns non-JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as TrendsResponse;
}
