import type { Plugin } from "vite";
import { fixtureTrends } from "../server/trendsFixture.js";
import {
  loadTrends,
  parseTrendsQuery,
  TrendsRequestError,
} from "../server/trends.js";

export function trendsApiDevPlugin(): Plugin {
  return {
    name: "earthview-trends-api",
    configureServer(server) {
      server.middlewares.use("/api/trends", async (req, res) => {
        if (req.method !== "GET") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET");
          res.end(JSON.stringify({ error: "Method not allowed" }));
          return;
        }

        const url = new URL(req.url ?? "/", "http://localhost");
        const values: Record<string, string> = {};
        for (const [key, value] of url.searchParams) values[key] = value;

        try {
          const query = parseTrendsQuery(values);
          let payload;
          try {
            payload = await loadTrends(query);
          } catch (error) {
            server.config.logger.warn(
              `[trends] live BigQuery unavailable; using deterministic development fixture (${error instanceof Error ? error.message : "unknown error"})`,
            );
            payload = fixtureTrends(query);
          }
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify(payload));
        } catch (error) {
          res.statusCode = error instanceof TrendsRequestError ? 400 : 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Failed to load trends",
            }),
          );
        }
      });
    },
  };
}
