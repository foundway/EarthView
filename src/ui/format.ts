import { DEFAULT_DISTANCE_UNIT, type DistanceUnit } from "../settings/units";

const METERS_PER_MILE = 1609.344;

let displayDistanceUnit: DistanceUnit = DEFAULT_DISTANCE_UNIT;

export function configureDisplayUnits(unit: DistanceUnit): void {
  displayDistanceUnit = unit;
}

function digitsFor(value: number): number {
  if (value === 0) return 0;
  if (Math.abs(value) >= 100) return 0;
  if (Math.abs(value) >= 0.1) return 1;
  return 3;
}

function formatted(value: number): string {
  const digits = digitsFor(value);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCenterline(
  meters: number | null,
  unit = displayDistanceUnit,
): string {
  if (meters === null || !Number.isFinite(meters)) {
    return "—";
  }
  if (unit === "miles") {
    return `${formatted(meters / METERS_PER_MILE)} mi`;
  }
  if (Math.abs(meters) < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${formatted(km)} km`;
}
