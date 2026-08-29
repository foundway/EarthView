import {
  loadTrends,
  parseTrendsQuery,
  TrendsConfigError,
  TrendsRequestError,
} from "../server/trends.js";

interface ApiRequest {
  readonly method?: string;
  readonly query: Record<string, string | readonly string[] | undefined>;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const query = parseTrendsQuery(req.query);
    const payload = await loadTrends(query);
    res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");
    res.status(200).json(payload);
  } catch (error) {
    if (error instanceof TrendsRequestError) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof TrendsConfigError) {
      res.status(503).json({ error: error.message });
      return;
    }
    console.error("trends API failed:", error);
    res.status(502).json({
      error:
        "Google Trends could not be queried. Verify BigQuery access, billing project, and Google credentials.",
    });
  }
}
