import { COUNTRY_CENTROIDS } from "../data/countryCentroids";
import type { TrendsMode, TrendsResponse } from "../data/trendsTypes";
import { GEAR_PATH, iconMarkup } from "./icons";

export interface HudFilters {
  readonly mode: TrendsMode;
  readonly country: string;
  readonly term: string;
}

export interface TrendsHudOptions {
  readonly root: HTMLElement;
  readonly onFiltersChange: (filters: HudFilters) => void;
  readonly onSelect: (id: string) => void;
  readonly onVisibilityChange: (visible: boolean) => void;
}

export interface TrendsHud {
  readonly settingsToggle: HTMLButtonElement;
  setLoading(): void;
  setError(message: string): void;
  setData(data: TrendsResponse): void;
  select(id: string | null): void;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

function countryOptions(): string {
  return Object.entries(COUNTRY_CENTROIDS)
    .sort(([, left], [, right]) => left.name.localeCompare(right.name))
    .map(([code, value]) => `<option value="${code}">${escapeHtml(value.name)}</option>`)
    .join("");
}

export function createTrendsHud(options: TrendsHudOptions): TrendsHud {
  options.root.innerHTML = `
    <header class="hud-brand">
      <div>
        <span class="hud-eyebrow">EarthView</span>
        <h1>Search pulse</h1>
      </div>
      <div class="brand-actions">
        <button class="layer-toggle" type="button" aria-pressed="true" aria-label="Hide trend beams" title="Toggle trend beams">
          <span aria-hidden="true">◉</span>
        </button>
        <button type="button" class="settings-toggle" data-slot="settings-toggle" aria-label="Settings" aria-expanded="false">
          ${iconMarkup(GEAR_PATH)}
        </button>
      </div>
    </header>
    <p class="hud-deck">Geographic Google Search Trends on the living Earth.</p>
    <section class="control-stack" aria-label="Trend controls">
      <div class="mode-toggle" role="group" aria-label="Trend type">
        <button type="button" data-mode="top" class="is-active">Top</button>
        <button type="button" data-mode="rising">Rising</button>
      </div>
      <label class="control-field">
        <span>Country focus</span>
        <select>
          <option value="">All mapped countries</option>
          ${countryOptions()}
        </select>
      </label>
      <form class="term-filter">
        <label class="control-field">
          <span>Term contains</span>
          <div class="search-row">
            <input type="search" maxlength="80" placeholder="e.g. weather" autocomplete="off" />
            <button type="submit">Apply</button>
          </div>
        </label>
      </form>
    </section>
    <section class="trend-summary" aria-live="polite">
      <div class="summary-number" data-role="count">—</div>
      <div>
        <div class="summary-label">countries plotted</div>
        <div class="summary-meta" data-role="week">Waiting for data</div>
      </div>
    </section>
    <div class="source-card">
      <span class="source-dot" aria-hidden="true"></span>
      <div>
        <strong data-role="source">Google Trends · BigQuery</strong>
        <span data-role="coverage">Country-centroid coverage</span>
      </div>
    </div>
    <section class="ranking-section">
      <div class="ranking-head">
        <h2>Geographic leaders</h2>
        <span data-role="status">Idle</span>
      </div>
      <ol class="trend-list"></ol>
    </section>
  `;

  const modeButtons = [...options.root.querySelectorAll<HTMLButtonElement>("[data-mode]")];
  const country = options.root.querySelector<HTMLSelectElement>("select");
  const form = options.root.querySelector<HTMLFormElement>(".term-filter");
  const input = options.root.querySelector<HTMLInputElement>('input[type="search"]');
  const visibility = options.root.querySelector<HTMLButtonElement>(".layer-toggle");
  const settingsToggle = options.root.querySelector<HTMLButtonElement>("[data-slot=settings-toggle]");
  const count = options.root.querySelector<HTMLElement>('[data-role="count"]');
  const week = options.root.querySelector<HTMLElement>('[data-role="week"]');
  const source = options.root.querySelector<HTMLElement>('[data-role="source"]');
  const coverage = options.root.querySelector<HTMLElement>('[data-role="coverage"]');
  const status = options.root.querySelector<HTMLElement>('[data-role="status"]');
  const list = options.root.querySelector<HTMLOListElement>(".trend-list");
  if (
    !country ||
    !form ||
    !input ||
    !visibility ||
    !settingsToggle ||
    !count ||
    !week ||
    !source ||
    !coverage ||
    !status ||
    !list
  ) {
    throw new Error("Trends HUD markup is incomplete");
  }

  let mode: TrendsMode = "top";
  let selectedId: string | null = null;
  const filters = (): HudFilters => ({ mode, country: country.value, term: input.value.trim() });
  const notify = (): void => options.onFiltersChange(filters());

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      mode = button.dataset.mode === "rising" ? "rising" : "top";
      modeButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      notify();
    });
  }
  country.addEventListener("change", notify);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    notify();
  });

  visibility.addEventListener("click", () => {
    const visible = visibility.getAttribute("aria-pressed") !== "true";
    visibility.setAttribute("aria-pressed", String(visible));
    visibility.setAttribute("aria-label", `${visible ? "Hide" : "Show"} trend beams`);
    options.onVisibilityChange(visible);
  });

  list.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-trend-id]");
    if (row?.dataset.trendId) options.onSelect(row.dataset.trendId);
  });

  const paintSelection = (): void => {
    for (const row of list.querySelectorAll<HTMLElement>("[data-trend-id]")) {
      row.classList.toggle("is-selected", row.dataset.trendId === selectedId);
    }
  };

  return {
    settingsToggle,
    setLoading() {
      options.root.dataset.state = "loading";
      count.textContent = "…";
      week.textContent = "Loading latest partition";
      status.textContent = "Loading";
      list.innerHTML = '<li class="state-row">Querying geographic trends…</li>';
    },
    setError(message) {
      options.root.dataset.state = "error";
      count.textContent = "—";
      week.textContent = "Data unavailable";
      status.textContent = "Error";
      list.innerHTML = `<li class="state-row state-error">${escapeHtml(message)}</li>`;
    },
    setData(data) {
      options.root.dataset.state = data.trends.length === 0 ? "empty" : "ready";
      count.textContent = String(data.trends.length);
      week.textContent = data.metadata.week
        ? `Week of ${data.metadata.week} · refreshed ${data.metadata.refreshDate}`
        : `Refreshed ${data.metadata.refreshDate}`;
      source.textContent = data.metadata.sourceLabel;
      coverage.textContent = `${data.metadata.coverage}${
        data.metadata.omittedUnmappedRows > 0
          ? ` · ${data.metadata.omittedUnmappedRows} unmapped omitted`
          : ""
      }`;
      status.textContent = data.metadata.mode === "rising" ? "Rising" : "Top";
      if (data.trends.length === 0) {
        list.innerHTML = '<li class="state-row">No mapped results match these filters.</li>';
        return;
      }
      list.innerHTML = data.trends
        .map((trend, index) => {
          const gain =
            trend.percentGain === null
              ? `score ${Math.round(trend.score)}`
              : `+${Math.round(trend.percentGain).toLocaleString("en-US")}%`;
          return `
            <li>
              <button type="button" class="trend-row" data-trend-id="${escapeHtml(trend.id)}">
                <span class="trend-rank">${index + 1}</span>
                <span class="trend-copy">
                  <strong title="${escapeHtml(trend.term)}">${escapeHtml(trend.term)}</strong>
                  <small>${escapeHtml(trend.location.countryName)} · ${trend.contributingRegions} regions</small>
                </span>
                <span class="trend-score">${gain}</span>
              </button>
            </li>`;
        })
        .join("");
      paintSelection();
    },
    select(id) {
      selectedId = id;
      paintSelection();
    },
  };
}
