import "cesium/Build/Cesium/Widgets/widgets.css";
import { Ion } from "cesium";
import { createEarthViewer } from "./earth/createViewer";
import {
  EarthRotationController,
  resolveDevRotationSpeedMultiplier,
} from "./earth/earthRotation";
import { fetchTrends } from "./data/trends";
import type { TrendsMode } from "./data/trendsTypes";
import { TrendBeamLayer } from "./layers/trendBeams";
import { TrendCardLayer } from "./layers/trendCards";
import { loadSettings, saveSettings } from "./settings/model";
import { createElevationReadout } from "./ui/elevationReadout";
import { configureDisplayUnits } from "./ui/format";
import { createSettingsDialog } from "./ui/settingsDialog";
import { createTrendsHud, type HudFilters } from "./ui/trendsHud";
import "./styles.css";

window.CESIUM_BASE_URL = CESIUM_BASE_URL;

// This project deliberately does not use Cesium Ion. Satellite imagery comes
// from the public Esri tile endpoint configured in src/config.ts.
Ion.defaultAccessToken = "";

const earth = document.getElementById("earth");
const fadeRoot = document.getElementById("earth-fade");
const hudRoot = document.getElementById("hud");
if (!earth || !fadeRoot || !hudRoot) {
  throw new Error("EarthView markup is missing #earth, #earth-fade, or #hud");
}

let mode: TrendsMode = "top";
let country = "";
let term = "";
let layer: TrendBeamLayer | null = null;
let cards: TrendCardLayer | null = null;
let inFlight: AbortController | null = null;
let beamsVisible = true;

const hud = createTrendsHud({
  root: hudRoot,
  onFiltersChange: (filters: HudFilters) => {
    mode = filters.mode;
    country = filters.country;
    term = filters.term;
    load();
  },
  onSelect: (id) => {
    rotation.stop();
    hud.select(id);
    cards?.setSelected(id);
    layer?.flyTo(id);
  },
  onVisibilityChange: (visible) => {
    beamsVisible = visible;
    layer?.setVisible(visible);
    rotation.setOrigins(visible ? (layer?.origins() ?? []) : []);
  },
});

let settings = loadSettings(window.localStorage);
configureDisplayUnits(settings.distanceUnit);

const viewer = createEarthViewer(earth, {
  cameraSpeeds: {
    dollySpeed: () => settings.dollySpeed,
  },
});

const rotation = new EarthRotationController(
  viewer,
  fadeRoot,
  resolveDevRotationSpeedMultiplier(window.location.search, import.meta.env.DEV),
  (phase) => {
    if (phase === "fading-in") {
      layer?.reveal();
    }
  },
);

earth
  .querySelector<HTMLElement>(".cesium-viewer-geocoderContainer")
  ?.addEventListener("focusin", () => {
    rotation.stop();
  });

layer = new TrendBeamLayer(viewer, {
  onSelect: (id) => {
    rotation.stop();
    hud.select(id);
    cards?.setSelected(id);
    layer?.flyTo(id);
  },
});
layer.setSettings(settings);

const elevation = createElevationReadout({
  host: document.body,
  viewer,
});
elevation.setDistanceUnit(settings.distanceUnit);

const settingsUi = createSettingsDialog({
  host: document.body,
  toggle: hud.settingsToggle,
  initial: settings,
  onChange: (next) => {
    settings = next;
    configureDisplayUnits(next.distanceUnit);
    elevation.setDistanceUnit(next.distanceUnit);
    saveSettings(next, window.localStorage);
    layer?.setSettings(next);
  },
});

const hudChrome = [
  hudRoot,
  settingsUi.dialog,
  elevation.element,
  earth.querySelector<HTMLElement>(".cesium-viewer-toolbar"),
  earth.querySelector<HTMLElement>(".cesium-viewer-bottom"),
].filter((node): node is HTMLElement => node !== null);

cards = new TrendCardLayer(viewer, {
  overlayHost: document.body,
  avoid: hudChrome,
  onSelect: (id) => {
    rotation.stop();
    hud.select(id);
    cards?.setSelected(id);
    layer?.flyTo(id);
  },
  getPins: () => layer?.getVisiblePins() ?? [],
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
      cards?.render(data.trends);
      layer?.setVisible(beamsVisible);
      rotation.setOrigins(beamsVisible ? (layer?.origins() ?? []) : []);
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      hud.setError(error instanceof Error ? error.message : "Failed to load trends");
      layer?.clear();
      cards?.clear();
      rotation.setOrigins([]);
    });
}

rotation.start();
load();
