import {
  Cartesian3,
  HeadingPitchRoll,
  Math as CesiumMath,
  SceneTransforms,
  type Viewer,
} from "cesium";
import { HOME_HEIGHT_METERS, HOME_LATITUDE_DEG, HOME_LONGITUDE_DEG } from "./homeView";
import { isOnCameraFacingHemisphere } from "./horizon";

/** One revolution every 24 minutes while requests remain visible. */
export const SLOW_ROTATION_RADIANS_PER_SECOND = CesiumMath.toRadians(0.25);
/** Fast enough to find the next request while the globe is black. */
export const SEEK_ROTATION_RADIANS_PER_SECOND = CesiumMath.toRadians(18);

const FADE_OUT_SECONDS = 0.7;
const FADE_IN_SECONDS = 0.9;
const MAX_FRAME_SECONDS = 0.1;
const ORIGIN_HEIGHT_METERS = 1_500;

export type RotationPhase = "illuminated" | "fading-out" | "seeking" | "fading-in";

export interface RotationFrame {
  readonly phase: RotationPhase;
  /** 0 = clear, 1 = black. */
  readonly darkness: number;
}

export interface GeographicOrigin {
  readonly longitude: number;
  readonly latitude: number;
}

export function initialRotationFrame(): RotationFrame {
  return { phase: "illuminated", darkness: 0 };
}

/**
 * Pure fade/seek state machine.
 *
 * The globe rotates slowly whenever it is visible. Once the final request
 * origin leaves the camera, it fades to black. Only after fully black does the
 * controller rotate quickly to find another origin; it then fades back in.
 */
export function advanceRotationFrame(
  frame: RotationFrame,
  hasOrigins: boolean,
  originVisible: boolean,
  elapsedSeconds: number,
): RotationFrame {
  if (!hasOrigins) {
    return initialRotationFrame();
  }

  const elapsed = Math.max(0, elapsedSeconds);

  switch (frame.phase) {
    case "illuminated":
      return originVisible
        ? frame
        : {
            phase: "fading-out",
            darkness: Math.min(1, frame.darkness + elapsed / FADE_OUT_SECONDS),
          };

    case "fading-out": {
      if (originVisible) {
        return {
          phase: "fading-in",
          darkness: Math.max(0, frame.darkness - elapsed / FADE_IN_SECONDS),
        };
      }
      const darkness = Math.min(1, frame.darkness + elapsed / FADE_OUT_SECONDS);
      return { phase: darkness >= 1 ? "seeking" : "fading-out", darkness };
    }

    case "seeking":
      return originVisible ? { phase: "fading-in", darkness: 1 } : frame;

    case "fading-in": {
      if (!originVisible) {
        return {
          phase: "fading-out",
          darkness: Math.min(1, frame.darkness + elapsed / FADE_OUT_SECONDS),
        };
      }
      const darkness = Math.max(0, frame.darkness - elapsed / FADE_IN_SECONDS);
      return { phase: darkness <= 0 ? "illuminated" : "fading-in", darkness };
    }
  }
}

export function rotationSpeedForPhase(phase: RotationPhase): number {
  return phase === "seeking"
    ? SEEK_ROTATION_RADIANS_PER_SECOND
    : SLOW_ROTATION_RADIANS_PER_SECOND;
}

/**
 * Development-only accelerator for manually exercising a full fade/seek loop.
 * Vite removes the call's dev branch from production, where this always gets 1.
 */
export function resolveDevRotationSpeedMultiplier(search: string, isDevelopment: boolean): number {
  if (!isDevelopment) return 1;

  const requested = Number(new URLSearchParams(search).get("rotationSpeed") ?? 1);
  return Number.isFinite(requested) ? Math.min(120, Math.max(1, requested)) : 1;
}

/**
 * Home-mode camera motion.
 *
 * Pressing Cesium Home is intercepted and restarts this mode from the home view.
 * Any direct pointer/wheel/touch navigation on the canvas exits rotation mode;
 * pressing Home re-enters it.
 */
export class EarthRotationController {
  private origins: Cartesian3[] = [];
  private frame = initialRotationFrame();
  private running = false;
  private lastFrameTime: number | null = null;
  private homeAction: (() => void) | null = null;

  constructor(
    private readonly viewer: Viewer,
    private readonly fade: HTMLElement,
    /** Development/manual-test aid. Seeking stays at its production speed. */
    private readonly slowSpeedMultiplier = 1,
    /** Fires when the fade/seek phase changes (used to revive culled beams). */
    private readonly onPhaseChange?: (phase: RotationPhase, previous: RotationPhase) => void,
  ) {
    viewer.scene.preRender.addEventListener(this.onFrame);

    const stopOnInput = () => this.stop();
    viewer.scene.canvas.addEventListener("pointerdown", stopOnInput);
    viewer.scene.canvas.addEventListener("wheel", stopOnInput);
    viewer.scene.canvas.addEventListener("touchstart", stopOnInput);

    // Replace Cesium's generic Home destination with the EarthView rotation
    // home. Playback can replace that action after construction without making
    // this low-level ambient-rotation controller own the tour state machine.
    // `cancel` prevents the built-in command from also moving the camera.
    viewer.homeButton?.viewModel.command.beforeExecute.addEventListener((commandInfo) => {
      commandInfo.cancel = true;
      if (this.homeAction) {
        this.homeAction();
      } else {
        this.goHome();
      }
    });
  }

  /** Overrides Home; pass null to restore the ordinary rotation-home action. */
  public setHomeAction(action: (() => void) | null): void {
    this.homeAction = action;
  }

  public setOrigins(origins: readonly GeographicOrigin[]): void {
    this.origins = origins
      .filter(
        ({ longitude, latitude }) =>
          Number.isFinite(longitude) &&
          Number.isFinite(latitude) &&
          longitude >= -180 &&
          longitude <= 180 &&
          latitude >= -90 &&
          latitude <= 90,
      )
      .map(({ longitude, latitude }) =>
        Cartesian3.fromDegrees(longitude, latitude, ORIGIN_HEIGHT_METERS),
      );

    if (this.origins.length === 0) {
      this.frame = initialRotationFrame();
      this.renderFade();
    }
  }

  /** Start rotation at the current camera position. */
  public start(): void {
    this.running = true;
    this.lastFrameTime = null;
    this.frame = initialRotationFrame();
    this.renderFade();
  }

  /** User navigation exits rotation mode and always restores full brightness. */
  public stop(): void {
    this.running = false;
    this.lastFrameTime = null;
    this.frame = initialRotationFrame();
    this.renderFade();
  }

  /** Fly to the home view, then begin slow rotation. */
  public goHome(): void {
    this.stop();
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(
        HOME_LONGITUDE_DEG,
        HOME_LATITUDE_DEG,
        HOME_HEIGHT_METERS,
      ),
      orientation: new HeadingPitchRoll(0, -CesiumMath.PI_OVER_TWO, 0),
      duration: 1.4,
      complete: () => this.start(),
    });
  }

  public isRunning(): boolean {
    return this.running;
  }

  private readonly onFrame = (): void => {
    if (!this.running) return;

    const now = performance.now();
    const elapsedSeconds =
      this.lastFrameTime === null
        ? 0
        : Math.min(MAX_FRAME_SECONDS, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;

    const baseSpeed = rotationSpeedForPhase(this.frame.phase);
    const speed =
      this.frame.phase === "seeking" ? baseSpeed : baseSpeed * this.slowSpeedMultiplier;
    this.viewer.camera.rotate(Cartesian3.UNIT_Z, -speed * elapsedSeconds);

    const originVisible = this.isAnyOriginVisible();
    const previousPhase = this.frame.phase;
    this.frame = advanceRotationFrame(
      this.frame,
      this.origins.length > 0,
      originVisible,
      elapsedSeconds,
    );
    this.renderFade();

    if (this.frame.phase !== previousPhase) {
      this.onPhaseChange?.(this.frame.phase, previousPhase);
    }
  };

  private isAnyOriginVisible(): boolean {
    if (this.origins.length === 0) return false;

    const { scene, camera } = this.viewer;
    const width = scene.canvas.clientWidth;
    const height = scene.canvas.clientHeight;

    return this.origins.some((origin) => {
      if (!isOnCameraFacingHemisphere(origin, camera.positionWC, scene.globe.ellipsoid)) {
        return false;
      }

      const screen = SceneTransforms.worldToWindowCoordinates(scene, origin);
      return (
        screen !== undefined &&
        screen.x >= 0 &&
        screen.x <= width &&
        screen.y >= 0 &&
        screen.y <= height
      );
    });
  }

  private renderFade(): void {
    this.fade.style.opacity = String(this.frame.darkness);
    this.fade.dataset.rotationPhase = this.frame.phase;
    this.fade.toggleAttribute("data-rotation-active", this.running);
  }
}
