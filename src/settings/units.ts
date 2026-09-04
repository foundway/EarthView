export type DistanceUnit = "miles" | "kilometers";

export const DEFAULT_DISTANCE_UNIT: DistanceUnit = "miles";

export function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === "miles" || value === "kilometers";
}
