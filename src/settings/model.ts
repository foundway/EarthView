import { DEFAULT_DISTANCE_UNIT, isDistanceUnit, type DistanceUnit } from "./units";

export const SETTINGS_STORAGE_KEY = "earthview:settings";

export const BEAM_LENGTH_MULTIPLIER_MIN = 0.25;
export const BEAM_LENGTH_MULTIPLIER_MAX = 4;
export const BEAM_LENGTH_MULTIPLIER_STEP = 0.05;
export const BEAM_LENGTH_MULTIPLIER_DEFAULT = 1;

export const BEAM_WIDTH_PX_MIN = 1;
export const BEAM_WIDTH_PX_MAX = 16;
export const BEAM_WIDTH_PX_STEP = 1;
export const BEAM_WIDTH_PX_DEFAULT = 8;

export const BEAM_ALPHA_MIN = 0.1;
export const BEAM_ALPHA_MAX = 1;
export const BEAM_ALPHA_STEP = 0.05;
export const BEAM_ALPHA_DEFAULT = 0.85;

export const BEAM_TRANSPARENCY_PERCENT_MIN = 0;
export const BEAM_TRANSPARENCY_PERCENT_MAX = 90;
export const BEAM_TRANSPARENCY_PERCENT_STEP = 5;

export const CAMERA_SPEED_MIN = 1;
export const CAMERA_SPEED_MAX = 10;
export const CAMERA_SPEED_STEP = 0.5;
export const CAMERA_SPEED_DEFAULT = 1;

export const BASE_ZOOM_SPEED_KM_PER_SECOND_MIN = 100;
export const BASE_ZOOM_SPEED_KM_PER_SECOND_MAX = 4_000;
export const BASE_ZOOM_SPEED_KM_PER_SECOND_STEP = 50;
export const BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT = 1_000;
const BASE_ZOOM_SPEED_KM_PER_SECOND_LEGACY_DEFAULT = 500;

export const FLIGHT_EASE_SECONDS_MIN = 0;
export const FLIGHT_EASE_SECONDS_MAX = 20;
export const FLIGHT_EASE_SECONDS_STEP = 0.1;
export const FLIGHT_EASE_SECONDS_DEFAULT = 10;

export const PLAYBACK_ZOOM_MULTIPLIER_MIN = 0.1;
export const PLAYBACK_ZOOM_MULTIPLIER_MAX = 1;
export const PLAYBACK_ZOOM_MULTIPLIER_STEP = 0.05;
export const PLAYBACK_ZOOM_MULTIPLIER_DEFAULT = 1;

export interface EarthViewSettings {
  readonly distanceUnit: DistanceUnit;
  readonly msaa: boolean;
  readonly nativeResolution: boolean;
  readonly beamLengthMultiplier: number;
  readonly beamWidthPx: number;
  readonly beamAlpha: number;
  readonly dollySpeed: number;
  readonly baseZoomSpeedKmPerSecond: number;
  readonly flightEaseSeconds: number;
}

export const DEFAULT_SETTINGS: EarthViewSettings = {
  distanceUnit: DEFAULT_DISTANCE_UNIT,
  msaa: true,
  nativeResolution: true,
  beamLengthMultiplier: BEAM_LENGTH_MULTIPLIER_DEFAULT,
  beamWidthPx: BEAM_WIDTH_PX_DEFAULT,
  beamAlpha: BEAM_ALPHA_DEFAULT,
  dollySpeed: CAMERA_SPEED_DEFAULT,
  baseZoomSpeedKmPerSecond: BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT,
  flightEaseSeconds: FLIGHT_EASE_SECONDS_DEFAULT,
};

function clampStepped(
  value: number,
  min: number,
  max: number,
  step: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const stepped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, stepped));
}

export function clampBeamLengthMultiplier(value: number): number {
  if (!Number.isFinite(value)) {
    return BEAM_LENGTH_MULTIPLIER_DEFAULT;
  }
  const stepped = Math.round(value / BEAM_LENGTH_MULTIPLIER_STEP) * BEAM_LENGTH_MULTIPLIER_STEP;
  return Math.min(BEAM_LENGTH_MULTIPLIER_MAX, Math.max(BEAM_LENGTH_MULTIPLIER_MIN, stepped));
}

export function clampBeamWidthPx(value: number): number {
  if (!Number.isFinite(value)) {
    return BEAM_WIDTH_PX_DEFAULT;
  }
  const stepped = Math.round(value / BEAM_WIDTH_PX_STEP) * BEAM_WIDTH_PX_STEP;
  return Math.min(BEAM_WIDTH_PX_MAX, Math.max(BEAM_WIDTH_PX_MIN, stepped));
}

export function clampBeamAlpha(value: number): number {
  const clamped = clampStepped(
    value,
    BEAM_ALPHA_MIN,
    BEAM_ALPHA_MAX,
    BEAM_ALPHA_STEP,
    BEAM_ALPHA_DEFAULT,
  );
  return Math.round(clamped * 100) / 100;
}

export function beamTransparencyPercent(alpha: number): number {
  return Math.round((1 - clampBeamAlpha(alpha)) * 100);
}

export function beamAlphaFromTransparencyPercent(percent: number): number {
  return clampBeamAlpha(1 - percent / 100);
}

export function clampCameraSpeed(value: number): number {
  return clampStepped(
    value,
    CAMERA_SPEED_MIN,
    CAMERA_SPEED_MAX,
    CAMERA_SPEED_STEP,
    CAMERA_SPEED_DEFAULT,
  );
}

export function clampBaseZoomSpeedKmPerSecond(value: number): number {
  return clampStepped(
    value,
    BASE_ZOOM_SPEED_KM_PER_SECOND_MIN,
    BASE_ZOOM_SPEED_KM_PER_SECOND_MAX,
    BASE_ZOOM_SPEED_KM_PER_SECOND_STEP,
    BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT,
  );
}

export function clampFlightEaseSeconds(value: number): number {
  const stepped = clampStepped(
    value,
    FLIGHT_EASE_SECONDS_MIN,
    FLIGHT_EASE_SECONDS_MAX,
    FLIGHT_EASE_SECONDS_STEP,
    FLIGHT_EASE_SECONDS_DEFAULT,
  );
  return Math.round(stepped * 10) / 10;
}

export function clampPlaybackZoomSpeedMultiplier(value: number): number {
  return clampStepped(
    value,
    PLAYBACK_ZOOM_MULTIPLIER_MIN,
    PLAYBACK_ZOOM_MULTIPLIER_MAX,
    PLAYBACK_ZOOM_MULTIPLIER_STEP,
    PLAYBACK_ZOOM_MULTIPLIER_DEFAULT,
  );
}

function storedFlag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readBaseZoomSpeedKmPerSecond(value: unknown): number {
  if (typeof value !== "number") {
    return BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT;
  }
  if (value === BASE_ZOOM_SPEED_KM_PER_SECOND_LEGACY_DEFAULT) {
    return BASE_ZOOM_SPEED_KM_PER_SECOND_DEFAULT;
  }
  return value;
}

export function parseSettings(raw: unknown): EarthViewSettings {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_SETTINGS;
  }
  const record = raw as Partial<EarthViewSettings>;
  return {
    distanceUnit: isDistanceUnit(record.distanceUnit)
      ? record.distanceUnit
      : DEFAULT_DISTANCE_UNIT,
    msaa: storedFlag(record.msaa, DEFAULT_SETTINGS.msaa),
    nativeResolution: storedFlag(record.nativeResolution, DEFAULT_SETTINGS.nativeResolution),
    beamLengthMultiplier: clampBeamLengthMultiplier(
      typeof record.beamLengthMultiplier === "number"
        ? record.beamLengthMultiplier
        : BEAM_LENGTH_MULTIPLIER_DEFAULT,
    ),
    beamWidthPx: clampBeamWidthPx(
      typeof record.beamWidthPx === "number" ? record.beamWidthPx : BEAM_WIDTH_PX_DEFAULT,
    ),
    beamAlpha: clampBeamAlpha(
      typeof record.beamAlpha === "number" ? record.beamAlpha : BEAM_ALPHA_DEFAULT,
    ),
    dollySpeed: clampCameraSpeed(
      typeof record.dollySpeed === "number" ? record.dollySpeed : CAMERA_SPEED_DEFAULT,
    ),
    flightEaseSeconds: FLIGHT_EASE_SECONDS_DEFAULT,
    baseZoomSpeedKmPerSecond: clampBaseZoomSpeedKmPerSecond(
      readBaseZoomSpeedKmPerSecond(record.baseZoomSpeedKmPerSecond),
    ),
  };
}

export function loadSettings(storage: Pick<Storage, "getItem"> | null): EarthViewSettings {
  if (!storage) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }
    return parseSettings(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(
  settings: EarthViewSettings,
  storage: Pick<Storage, "setItem"> | null,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parseSettings(settings)));
  } catch {
    // Quota / private mode — keep the in-memory value.
  }
}

export function formatBeamLengthMultiplier(value: number): string {
  return `${clampBeamLengthMultiplier(value).toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}×`;
}

export function formatBeamWidthPx(value: number): string {
  return `${clampBeamWidthPx(value)} px`;
}

export function formatBeamTransparency(alpha: number): string {
  return `${beamTransparencyPercent(alpha)}%`;
}

export function formatCameraSpeed(value: number): string {
  const speed = clampCameraSpeed(value);
  return `${speed.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")}×`;
}

export function formatBaseZoomSpeedKmPerSecond(value: number): string {
  return `${clampBaseZoomSpeedKmPerSecond(value).toLocaleString()} km/s`;
}
