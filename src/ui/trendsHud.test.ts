// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import type { TrendsResponse } from "../data/trendsTypes";
import { createTrendsHud } from "./trendsHud";

const DATA: TrendsResponse = {
  trends: [
    {
      id: "CA:aurora",
      term: "aurora",
      rank: 1,
      score: 100,
      percentGain: null,
      week: "2026-08-23",
      contributingRegions: 13,
      location: {
        countryCode: "CA",
        countryName: "Canada",
        latitude: 56.13,
        longitude: -106.35,
      },
    },
  ],
  metadata: {
    mode: "top",
    refreshDate: "2026-08-28",
    week: "2026-08-23",
    source: "development-fixture",
    sourceLabel: "Deterministic development fixture · not live Google data",
    coverage: "Mapped country centroids",
    returnedRows: 1,
    omittedUnmappedRows: 0,
    filters: { country: null, term: null },
  },
};

describe("trends HUD states", () => {
  it("renders loading, data, selection, and error states", () => {
    const root = document.createElement("aside");
    const onSelect = vi.fn();
    const hud = createTrendsHud({
      root,
      onFiltersChange: vi.fn(),
      onSelect,
      onVisibilityChange: vi.fn(),
    });

    hud.setLoading();
    expect(root.dataset.state).toBe("loading");
    expect(root.textContent).toContain("Querying geographic trends");

    hud.setData(DATA);
    expect(root.dataset.state).toBe("ready");
    expect(root.textContent).toContain("aurora");
    expect(root.textContent).toContain("development fixture");

    root.querySelector<HTMLButtonElement>("[data-trend-id]")?.click();
    expect(onSelect).toHaveBeenCalledWith("CA:aurora");
    hud.select("CA:aurora");
    expect(root.querySelector("[data-trend-id]")?.classList.contains("is-selected")).toBe(true);

    hud.setError("No credentials");
    expect(root.dataset.state).toBe("error");
    expect(root.textContent).toContain("No credentials");
  });

  it("emits validated control values", () => {
    const root = document.createElement("aside");
    const onFiltersChange = vi.fn();
    createTrendsHud({
      root,
      onFiltersChange,
      onSelect: vi.fn(),
      onVisibilityChange: vi.fn(),
    });
    root.querySelector<HTMLSelectElement>("select")!.value = "CA";
    root.querySelector<HTMLSelectElement>("select")!.dispatchEvent(new Event("change"));
    expect(onFiltersChange).toHaveBeenLastCalledWith({ mode: "top", country: "CA", term: "" });
  });
});
