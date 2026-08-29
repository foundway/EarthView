import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./trends";

const credentialKeys = [
  "GOOGLE_CLOUD_PROJECT",
  "GCLOUD_PROJECT",
  "GCP_PROJECT",
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CLIENT_EMAIL",
  "GOOGLE_PRIVATE_KEY",
] as const;

describe("GET /api/trends", () => {
  const original = new Map<string, string | undefined>();

  afterEach(() => {
    for (const [key, value] of original) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    original.clear();
  });

  function withoutCredentials(): void {
    for (const key of credentialKeys) {
      original.set(key, process.env[key]);
      delete process.env[key];
    }
  }

  it("rejects invalid query parameters before querying BigQuery", async () => {
    const response = await GET(new Request("https://example.test/api/trends?mode=popular"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'mode must be either "top" or "rising"',
    });
  });

  it("returns 503 when Google credentials are not configured", async () => {
    withoutCredentials();
    const response = await GET(new Request("https://example.test/api/trends"));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/GOOGLE_CLOUD_PROJECT/);
  });
});
