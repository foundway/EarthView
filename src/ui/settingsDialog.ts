import {
  BEAM_LENGTH_MULTIPLIER_MAX,
  BEAM_LENGTH_MULTIPLIER_MIN,
  BEAM_LENGTH_MULTIPLIER_STEP,
  BEAM_WIDTH_PX_MAX,
  BEAM_WIDTH_PX_MIN,
  BEAM_WIDTH_PX_STEP,
  BEAM_TRANSPARENCY_PERCENT_MAX,
  BEAM_TRANSPARENCY_PERCENT_MIN,
  BEAM_TRANSPARENCY_PERCENT_STEP,
  BASE_ZOOM_SPEED_KM_PER_SECOND_MAX,
  BASE_ZOOM_SPEED_KM_PER_SECOND_MIN,
  BASE_ZOOM_SPEED_KM_PER_SECOND_STEP,
  CAMERA_SPEED_MAX,
  CAMERA_SPEED_MIN,
  CAMERA_SPEED_STEP,
  clampBeamLengthMultiplier,
  clampCameraSpeed,
  clampBeamWidthPx,
  clampBeamAlpha,
  beamAlphaFromTransparencyPercent,
  beamTransparencyPercent,
  clampBaseZoomSpeedKmPerSecond,
  formatBeamLengthMultiplier,
  formatCameraSpeed,
  formatBeamWidthPx,
  formatBeamTransparency,
  formatBaseZoomSpeedKmPerSecond,
  FLIGHT_EASE_SECONDS_DEFAULT,
  type EarthViewSettings,
} from "../settings/model";

export interface SettingsDialogOptions {
  readonly host: HTMLElement;
  readonly toggle: HTMLButtonElement;
  readonly initial: EarthViewSettings;
  readonly onChange: (settings: EarthViewSettings) => void;
}

export interface SettingsDialog {
  readonly dialog: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
}

export function createSettingsDialog(options: SettingsDialogOptions): SettingsDialog {
  const layer = document.createElement("div");
  layer.className = "settings-layer";
  layer.hidden = true;
  layer.innerHTML = `
    <div id="earthview-settings" class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
      <header class="settings-header">
        <h2 id="settings-title" class="settings-title">Settings</h2>
        <button type="button" class="settings-close" aria-label="Close settings">×</button>
      </header>
      <div class="settings-section-title">Display</div>
      <div class="settings-row">
        <span class="settings-copy">
          <span class="settings-label">Measurement units</span>
          <span class="settings-hint">Units for the elevation readout.</span>
        </span>
        <span class="settings-unit-toggle" role="group" aria-label="Measurement units">
          <button type="button" data-role="units-miles">Miles</button>
          <button type="button" data-role="units-kilometers">Kilometers</button>
        </span>
      </div>
      <div class="settings-section-title">Camera</div>
      <label class="settings-row settings-row-stack">
        <span class="settings-copy settings-copy-inline">
          <span class="settings-label">Zoom sensitivity</span>
          <span class="settings-value" data-role="dolly-speed-value"></span>
        </span>
        <span class="settings-hint">Wheel and pinch zoom, applied immediately. 1–10×. Each tick is a fraction of elevation, so a pad is slower than orbit. Marker fly-to still eases.</span>
        <input
          type="range"
          data-role="dolly-speed"
          min="${CAMERA_SPEED_MIN}"
          max="${CAMERA_SPEED_MAX}"
          step="${CAMERA_SPEED_STEP}"
        />
      </label>
      <label class="settings-row settings-row-stack">
        <span class="settings-copy settings-copy-inline">
          <span class="settings-label">Cruise speed</span>
          <span class="settings-value" data-role="base-zoom-value"></span>
        </span>
        <span class="settings-hint">Cruise at 1,000 km. Actual speed is this value times elevation / 1,000 km. Each frame moves by that speed × elapsed time, capped so a hitch cannot spike.</span>
        <input
          type="range"
          data-role="base-zoom"
          min="${BASE_ZOOM_SPEED_KM_PER_SECOND_MIN}"
          max="${BASE_ZOOM_SPEED_KM_PER_SECOND_MAX}"
          step="${BASE_ZOOM_SPEED_KM_PER_SECOND_STEP}"
        />
      </label>
      <div class="settings-section-title">Beams</div>
      <label class="settings-row settings-row-stack">
        <span class="settings-copy settings-copy-inline">
          <span class="settings-label">Beam length</span>
          <span class="settings-value" data-role="beam-length-value"></span>
        </span>
        <span class="settings-hint">Multiplies every trend beam after its score length is computed.</span>
        <input
          type="range"
          data-role="beam-length"
          min="${BEAM_LENGTH_MULTIPLIER_MIN}"
          max="${BEAM_LENGTH_MULTIPLIER_MAX}"
          step="${BEAM_LENGTH_MULTIPLIER_STEP}"
        />
      </label>
      <label class="settings-row settings-row-stack">
        <span class="settings-copy settings-copy-inline">
          <span class="settings-label">Beam width</span>
          <span class="settings-value" data-role="beam-width-value"></span>
        </span>
        <span class="settings-hint">Screen-space thickness of the glow strip, in pixels. Default 8. Tapers to a point at the tip.</span>
        <input
          type="range"
          data-role="beam-width"
          min="${BEAM_WIDTH_PX_MIN}"
          max="${BEAM_WIDTH_PX_MAX}"
          step="${BEAM_WIDTH_PX_STEP}"
        />
      </label>
      <label class="settings-row settings-row-stack">
        <span class="settings-copy settings-copy-inline">
          <span class="settings-label">Beam transparency</span>
          <span class="settings-value" data-role="beam-transparency-value"></span>
        </span>
        <span class="settings-hint">How see-through the glow is. 0% is solid.</span>
        <input
          type="range"
          data-role="beam-transparency"
          min="${BEAM_TRANSPARENCY_PERCENT_MIN}"
          max="${BEAM_TRANSPARENCY_PERCENT_MAX}"
          step="${BEAM_TRANSPARENCY_PERCENT_STEP}"
        />
      </label>
    </div>
  `;

  options.host.appendChild(layer);

  const dialog = layer.querySelector<HTMLElement>(".settings-dialog");
  const closeButton = layer.querySelector<HTMLButtonElement>(".settings-close");
  const milesButton = layer.querySelector<HTMLButtonElement>('[data-role="units-miles"]');
  const kilometersButton = layer.querySelector<HTMLButtonElement>(
    '[data-role="units-kilometers"]',
  );
  const slider = layer.querySelector<HTMLInputElement>('[data-role="beam-length"]');
  const sliderValue = layer.querySelector<HTMLElement>('[data-role="beam-length-value"]');
  const width = layer.querySelector<HTMLInputElement>('[data-role="beam-width"]');
  const widthValue = layer.querySelector<HTMLElement>('[data-role="beam-width-value"]');
  const transparency = layer.querySelector<HTMLInputElement>('[data-role="beam-transparency"]');
  const transparencyValue = layer.querySelector<HTMLElement>('[data-role="beam-transparency-value"]');
  const dollySpeed = layer.querySelector<HTMLInputElement>('[data-role="dolly-speed"]');
  const dollySpeedValue = layer.querySelector<HTMLElement>('[data-role="dolly-speed-value"]');
  const baseZoom = layer.querySelector<HTMLInputElement>('[data-role="base-zoom"]');
  const baseZoomValue = layer.querySelector<HTMLElement>('[data-role="base-zoom-value"]');

  if (
    !dialog ||
    !closeButton ||
    !milesButton ||
    !kilometersButton ||
    !slider ||
    !sliderValue ||
    !width ||
    !widthValue ||
    !transparency ||
    !transparencyValue ||
    !dollySpeed ||
    !dollySpeedValue ||
    !baseZoom ||
    !baseZoomValue
  ) {
    throw new Error("Settings dialog markup is incomplete");
  }

  const normalize = (settings: EarthViewSettings): EarthViewSettings => ({
    ...settings,
    beamLengthMultiplier: clampBeamLengthMultiplier(settings.beamLengthMultiplier),
    beamWidthPx: clampBeamWidthPx(settings.beamWidthPx),
    beamAlpha: clampBeamAlpha(settings.beamAlpha),
    dollySpeed: clampCameraSpeed(settings.dollySpeed),
    baseZoomSpeedKmPerSecond: clampBaseZoomSpeedKmPerSecond(settings.baseZoomSpeedKmPerSecond),
    flightEaseSeconds: FLIGHT_EASE_SECONDS_DEFAULT,
  });

  let current: EarthViewSettings = normalize(options.initial);

  const syncRangeFill = (input: HTMLInputElement): void => {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const span = max - min;
    const t = span === 0 || !Number.isFinite(span) ? 0 : (value - min) / span;
    const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
    input.style.setProperty("--settings-range", `${clamped * 100}%`);
  };

  const paint = (): void => {
    milesButton.setAttribute("aria-pressed", String(current.distanceUnit === "miles"));
    kilometersButton.setAttribute(
      "aria-pressed",
      String(current.distanceUnit === "kilometers"),
    );
    slider.value = String(current.beamLengthMultiplier);
    sliderValue.textContent = formatBeamLengthMultiplier(current.beamLengthMultiplier);
    width.value = String(current.beamWidthPx);
    widthValue.textContent = formatBeamWidthPx(current.beamWidthPx);
    transparency.value = String(beamTransparencyPercent(current.beamAlpha));
    transparencyValue.textContent = formatBeamTransparency(current.beamAlpha);
    dollySpeed.value = String(current.dollySpeed);
    dollySpeedValue.textContent = formatCameraSpeed(current.dollySpeed);
    baseZoom.value = String(current.baseZoomSpeedKmPerSecond);
    baseZoomValue.textContent = formatBaseZoomSpeedKmPerSecond(current.baseZoomSpeedKmPerSecond);

    for (const input of layer.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
      syncRangeFill(input);
    }

    options.toggle.setAttribute("aria-expanded", String(!layer.hidden));
  };

  const emit = (next: EarthViewSettings): void => {
    current = normalize(next);
    paint();
    options.onChange(current);
  };

  const open = (): void => {
    layer.hidden = false;
    options.toggle.setAttribute("aria-expanded", "true");
    dialog.focus();
  };

  const close = (): void => {
    layer.hidden = true;
    options.toggle.setAttribute("aria-expanded", "false");
    options.toggle.focus();
  };

  milesButton.addEventListener("click", () => {
    if (current.distanceUnit !== "miles") emit({ ...current, distanceUnit: "miles" });
  });
  kilometersButton.addEventListener("click", () => {
    if (current.distanceUnit !== "kilometers") {
      emit({ ...current, distanceUnit: "kilometers" });
    }
  });
  dollySpeed.addEventListener("input", () => {
    emit({ ...current, dollySpeed: Number(dollySpeed.value) });
  });
  baseZoom.addEventListener("input", () => {
    emit({ ...current, baseZoomSpeedKmPerSecond: Number(baseZoom.value) });
  });
  slider.addEventListener("input", () => {
    emit({ ...current, beamLengthMultiplier: Number(slider.value) });
  });
  width.addEventListener("input", () => {
    emit({ ...current, beamWidthPx: Number(width.value) });
  });
  transparency.addEventListener("input", () => {
    emit({
      ...current,
      beamAlpha: beamAlphaFromTransparencyPercent(Number(transparency.value)),
    });
  });
  closeButton.addEventListener("click", close);
  options.toggle.addEventListener("click", () => {
    if (layer.hidden) {
      open();
    } else {
      close();
    }
  });
  layer.addEventListener("pointerdown", (event) => {
    if (event.target === layer) {
      close();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !layer.hidden) {
      event.preventDefault();
      close();
    }
  });

  options.toggle.setAttribute("aria-haspopup", "dialog");
  options.toggle.setAttribute("aria-controls", "earthview-settings");
  paint();

  return {
    dialog,
    open,
    close,
    isOpen: () => !layer.hidden,
  };
}
