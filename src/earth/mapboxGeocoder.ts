import { Cartesian3, Credit, GeocodeType, Rectangle, type GeocoderService } from "cesium";

/**
 * Address search for the globe's toolbar.
 *
 * Cesium's default geocoder is Ion's, and EarthView runs without an Ion token
 * (imagery comes from a public Esri endpoint), so every query comes back
 * "(not found)" unless a Mapbox token is supplied via `VITE_MAPBOX_ACCESS_TOKEN`.
 */

const MAPBOX_ENDPOINT = "https://api.mapbox.com/geocoding/v5/mapbox.places";
const RESULT_LIMIT = 5;
const POINT_VIEW_HEIGHT_METERS = 4_000;

const MAPBOX_CREDIT = new Credit(
  '<a href="https://www.mapbox.com/about/maps/">© Mapbox</a> <a href="https://www.openstreetmap.org/about/">© OpenStreetMap</a>',
  false,
);

interface MapboxFeature {
  readonly place_name?: unknown;
  readonly text?: unknown;
  readonly center?: unknown;
  readonly bbox?: unknown;
}

export interface MapboxGeocoderOptions {
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}

export function mapboxSearchUrl(query: string, type: GeocodeType, token: string): string {
  const url = new URL(`${MAPBOX_ENDPOINT}/${encodeURIComponent(query)}.json`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("autocomplete", String(type === GeocodeType.AUTOCOMPLETE));
  url.searchParams.set("limit", String(RESULT_LIMIT));
  return url.toString();
}

function coordinatePair(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const [longitude, latitude] = value;
  return typeof longitude === "number" && typeof latitude === "number"
    ? [longitude, latitude]
    : null;
}

function boundingBox(value: unknown): readonly [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const [west, south, east, north] = value;
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number"
  ) {
    return null;
  }
  return east > west && north > south ? [west, south, east, north] : null;
}

export function mapboxFeatureToResult(feature: MapboxFeature): GeocoderService.Result | null {
  const displayName =
    typeof feature.place_name === "string"
      ? feature.place_name
      : typeof feature.text === "string"
        ? feature.text
        : null;
  if (!displayName) {
    return null;
  }

  const bbox = boundingBox(feature.bbox);
  if (bbox) {
    return { displayName, destination: Rectangle.fromDegrees(...bbox) };
  }

  const center = coordinatePair(feature.center);
  if (!center) {
    return null;
  }
  return {
    displayName,
    destination: Cartesian3.fromDegrees(center[0], center[1], POINT_VIEW_HEIGHT_METERS),
  };
}

export function createMapboxGeocoderService(options: MapboxGeocoderOptions): GeocoderService {
  const token = options.token;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);

  return {
    credit: MAPBOX_CREDIT,

    async geocode(query: string, type: GeocodeType = GeocodeType.SEARCH) {
      const trimmed = query.trim();
      if (trimmed.length === 0) {
        return [];
      }

      try {
        const response = await fetchImpl(mapboxSearchUrl(trimmed, type, token));
        if (!response.ok) {
          console.warn(`[earthview] Mapbox geocoding failed: ${response.status}`);
          return [];
        }
        const body = (await response.json()) as { features?: unknown };
        if (!Array.isArray(body.features)) {
          return [];
        }
        return body.features
          .map((feature) => mapboxFeatureToResult(feature as MapboxFeature))
          .filter((result): result is GeocoderService.Result => result !== null);
      } catch (error) {
        console.warn(`[earthview] Mapbox geocoding failed: ${String(error)}`);
        return [];
      }
    },
  } as GeocoderService;
}
