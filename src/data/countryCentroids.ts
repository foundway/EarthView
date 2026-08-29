export interface CountryCentroid {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Stable, approximate country centroids keyed by ISO 3166-1 alpha-2 code.
 * They intentionally locate country-level aggregates, not individual regions.
 */
export const COUNTRY_CENTROIDS: Readonly<Record<string, CountryCentroid>> = {
  AR: { name: "Argentina", latitude: -38.42, longitude: -63.62 },
  AT: { name: "Austria", latitude: 47.52, longitude: 14.55 },
  AU: { name: "Australia", latitude: -25.27, longitude: 133.78 },
  BE: { name: "Belgium", latitude: 50.5, longitude: 4.47 },
  BR: { name: "Brazil", latitude: -14.24, longitude: -51.93 },
  CA: { name: "Canada", latitude: 56.13, longitude: -106.35 },
  CH: { name: "Switzerland", latitude: 46.82, longitude: 8.23 },
  CL: { name: "Chile", latitude: -35.68, longitude: -71.54 },
  CO: { name: "Colombia", latitude: 4.57, longitude: -74.3 },
  CZ: { name: "Czechia", latitude: 49.82, longitude: 15.47 },
  DE: { name: "Germany", latitude: 51.17, longitude: 10.45 },
  DK: { name: "Denmark", latitude: 56.26, longitude: 9.5 },
  EG: { name: "Egypt", latitude: 26.82, longitude: 30.8 },
  ES: { name: "Spain", latitude: 40.46, longitude: -3.75 },
  FI: { name: "Finland", latitude: 61.92, longitude: 25.75 },
  FR: { name: "France", latitude: 46.23, longitude: 2.21 },
  GB: { name: "United Kingdom", latitude: 55.38, longitude: -3.44 },
  GR: { name: "Greece", latitude: 39.07, longitude: 21.82 },
  HK: { name: "Hong Kong", latitude: 22.32, longitude: 114.17 },
  HU: { name: "Hungary", latitude: 47.16, longitude: 19.5 },
  ID: { name: "Indonesia", latitude: -0.79, longitude: 113.92 },
  IE: { name: "Ireland", latitude: 53.14, longitude: -7.69 },
  IL: { name: "Israel", latitude: 31.05, longitude: 34.85 },
  IN: { name: "India", latitude: 20.59, longitude: 78.96 },
  IT: { name: "Italy", latitude: 41.87, longitude: 12.57 },
  JP: { name: "Japan", latitude: 36.2, longitude: 138.25 },
  KE: { name: "Kenya", latitude: -0.02, longitude: 37.91 },
  KR: { name: "South Korea", latitude: 35.91, longitude: 127.77 },
  MX: { name: "Mexico", latitude: 23.63, longitude: -102.55 },
  MY: { name: "Malaysia", latitude: 4.21, longitude: 101.98 },
  NG: { name: "Nigeria", latitude: 9.08, longitude: 8.68 },
  NL: { name: "Netherlands", latitude: 52.13, longitude: 5.29 },
  NO: { name: "Norway", latitude: 60.47, longitude: 8.47 },
  NZ: { name: "New Zealand", latitude: -40.9, longitude: 174.89 },
  PE: { name: "Peru", latitude: -9.19, longitude: -75.02 },
  PH: { name: "Philippines", latitude: 12.88, longitude: 121.77 },
  PL: { name: "Poland", latitude: 51.92, longitude: 19.15 },
  PT: { name: "Portugal", latitude: 39.4, longitude: -8.22 },
  RO: { name: "Romania", latitude: 45.94, longitude: 24.97 },
  RU: { name: "Russia", latitude: 61.52, longitude: 105.32 },
  SA: { name: "Saudi Arabia", latitude: 23.89, longitude: 45.08 },
  SE: { name: "Sweden", latitude: 60.13, longitude: 18.64 },
  SG: { name: "Singapore", latitude: 1.35, longitude: 103.82 },
  TH: { name: "Thailand", latitude: 15.87, longitude: 100.99 },
  TR: { name: "Türkiye", latitude: 38.96, longitude: 35.24 },
  TW: { name: "Taiwan", latitude: 23.7, longitude: 120.96 },
  UA: { name: "Ukraine", latitude: 48.38, longitude: 31.17 },
  US: { name: "United States", latitude: 39.83, longitude: -98.58 },
  VN: { name: "Vietnam", latitude: 14.06, longitude: 108.28 },
  ZA: { name: "South Africa", latitude: -30.56, longitude: 22.94 },
};
