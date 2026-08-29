import "cesium/Build/Cesium/Widgets/widgets.css";
import { Ion } from "cesium";
import { createEarthViewer } from "./createEarthViewer";
import { fetchTrends } from "./data/trends";
import type { TrendsMode } from "./data/trendsTypes";
import { TrendBeamLayer } from "./layers/trendBeams";
import { createTrendsHud, type HudFilters } from "./ui/trendsHud";
import "./styles.css";

window.CESIUM_BASE_URL = CESIUM_BASE_URL;

// This project deliberately does not use Cesium Ion. Satellite imagery comes
// from the public Esri tile endpoint configured in src/config.ts.
Ion.defaultAccessToken = "";

const earth = document.getElementById("earth");
const hudRoot = document.getElementById("hud");
if (!earth || !hudRoot) {
  throw new Error("EarthView markup is missing #earth or #hud");
}

let mode: TrendsMode = "top";
let country = "";
let term = "";
let layer: TrendBeamLayer | null = null;
let inFlight: AbortController | null = null;

const hud = createTrendsHud({
  root: hudRoot,
  onFiltersChange: (filters: HudFilters) => {
    mode = filters.mode;
    country = filters.country;
    term = filters.term;
    load();
  },
  onSelect: (id) => {
    hud.select(id);
    layer?.flyTo(id);
  },
  onVisibilityChange: (visible) => layer?.setVisible(visible),
});

const viewer = createEarthViewer(earth);
layer = new TrendBeamLayer(viewer, {
  onSelect: (id) => {
    hud.select(id);
    layer?.flyTo(id);
  },
});

function load(): void {
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  hud.setLoading();

  void fetchTrends(
    {
      mode,
      country: country || undefined,
      term: term || undefined,
    },
    controller.signal,
  )
    .then((data) => {
      if (controller.signal.aborted) return;
      hud.setData(data);
      layer?.render(data.trends);
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      hud.setError(error instanceof Error ? error.message : "Failed to load trends");
      layer?.clear();
    });
}

load();
