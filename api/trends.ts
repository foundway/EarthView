import {
  loadTrends,
  parseTrendsQuery,
  TrendsConfigError,
  TrendsRequestError,
} from "../server/trends.js";

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const values: Record<string, string> = {};
    for (const [key, value] of url.searchParams) values[key] = value;

    const query = parseTrendsQuery(values);
    const payload = await loadTrends(query);
    return Response.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600",
      },
    });
  } catch (error) {
    if (error instanceof TrendsRequestError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof TrendsConfigError) {
      return Response.json({ error: error.message }, { status: 503 });
    }
    console.error("trends API failed:", error);
    return Response.json(
      {
        error:
          "Google Trends could not be queried. Verify BigQuery access, billing project, and Google credentials.",
      },
      { status: 502 },
    );
  }
}
