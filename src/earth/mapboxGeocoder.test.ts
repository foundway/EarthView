import { Cartesian3, GeocodeType, Rectangle } from "cesium";
import { describe, expect, it, vi } from "vitest";
import {
  createMapboxGeocoderService,
  mapboxFeatureToResult,
  mapboxSearchUrl,
} from "./mapboxGeocoder";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

const rosenberg = {
  place_name: "Rosenberg, Texas, United States",
  center: [-95.8085, 29.5572],
  bbox: [-95.85, 29.51, -95.75, 29.6],
};

describe("mapboxSearchUrl", () => {
  it("asks Mapbox to complete a partial query and not a submitted one", () => {
    const typed = new URL(mapboxSearchUrl("Rosenb", GeocodeType.AUTOCOMPLETE, "pk.test"));
    const submitted = new URL(mapboxSearchUrl("Rosenberg", GeocodeType.SEARCH, "pk.test"));

    expect(typed.searchParams.get("autocomplete")).toBe("true");
    expect(submitted.searchParams.get("autocomplete")).toBe("false");
  });

  it("sends the token and caps results at the five Cesium will show", () => {
    const url = new URL(mapboxSearchUrl("Austin", GeocodeType.SEARCH, "pk.test"));

    expect(url.searchParams.get("access_token")).toBe("pk.test");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("escapes a query that would otherwise break the path", () => {
    const url = mapboxSearchUrl("Rosenberg, TX / US", GeocodeType.SEARCH, "pk.test");

    expect(url).toContain("mapbox.places/Rosenberg%2C%20TX%20%2F%20US.json");
  });
});

describe("mapboxFeatureToResult", () => {
  it("flies to the feature's bounding box when Mapbox gives one", () => {
    const result = mapboxFeatureToResult(rosenberg);

    expect(result?.displayName).toBe("Rosenberg, Texas, United States");
    expect(result?.destination).toBeInstanceOf(Rectangle);
    expect(result?.destination).toEqual(Rectangle.fromDegrees(-95.85, 29.51, -95.75, 29.6));
  });

  it("falls back to the center point for a street address", () => {
    const result = mapboxFeatureToResult({
      place_name: "1 Main St",
      center: [-95.8085, 29.5572],
    });

    expect(result?.destination).toBeInstanceOf(Cartesian3);
  });

  it("treats a collapsed bounding box as a point", () => {
    const result = mapboxFeatureToResult({
      place_name: "Pin",
      center: [-95.8085, 29.5572],
      bbox: [-95.8085, 29.5572, -95.8085, 29.5572],
    });

    expect(result?.destination).toBeInstanceOf(Cartesian3);
  });

  it("drops a feature with nothing to fly to", () => {
    expect(mapboxFeatureToResult({ place_name: "Nowhere" })).toBeNull();
    expect(mapboxFeatureToResult({ center: [-95.8, 29.5] })).toBeNull();
  });
});

describe("createMapboxGeocoderService", () => {
  it("returns the matches Mapbox found", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ features: [rosenberg] }));
    const service = createMapboxGeocoderService({ token: "pk.test", fetchImpl });

    const results = await service.geocode("Rosenberg, Texas", GeocodeType.SEARCH);

    expect(results).toHaveLength(1);
    expect(results[0].displayName).toBe("Rosenberg, Texas, United States");
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining("access_token=pk.test"));
  });

  it("does not call Mapbox for an empty box", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ features: [rosenberg] }));
    const service = createMapboxGeocoderService({ token: "pk.test", fetchImpl });

    expect(await service.geocode("   ", GeocodeType.AUTOCOMPLETE)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("resolves empty instead of throwing, because Cesium's typeahead has no catch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rejected = createMapboxGeocoderService({
      token: "pk.test",
      fetchImpl: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    const unauthorized = createMapboxGeocoderService({
      token: "pk.test",
      fetchImpl: vi.fn(async () => jsonResponse({ message: "Not Authorized" }, false, 401)),
    });

    await expect(rejected.geocode("Austin", GeocodeType.AUTOCOMPLETE)).resolves.toEqual([]);
    await expect(unauthorized.geocode("Austin", GeocodeType.SEARCH)).resolves.toEqual([]);
    warn.mockRestore();
  });
});
