import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  PolylineCollection,
  SceneTransforms,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer,
} from "cesium";
import { CameraGate, frameNowMs, readCameraPose } from "../earth/cameraActivity";
import { flyViewerCamera } from "../earth/cameraFlight";
import { verticalFovRadians } from "../earth/cameraFrustum";
import { chipScreenIfFacing, isOnCameraFacingHemisphere } from "../earth/horizon";
import { planCameraFlight } from "../earth/zoomSpeed";
import type { GeographicTrend } from "../data/trendsTypes";
import {
  clampBeamAlpha,
  clampBeamLengthMultiplier,
  clampBeamWidthPx,
  DEFAULT_SETTINGS,
  type EarthViewSettings,
} from "../settings/model";
import {
  addBeam,
  applyBeamColor,
  applyBeamWidth,
  beamFadeAlphaScale,
  beamLineVisible,
  beamVisibleFraction,
  quantizeBeamFade,
  type BeamPrimitive,
} from "./beamGlow";
import { mapTrendBeam } from "./trendBeamMapping";

export interface TrendBeamLayerOptions {
  readonly onSelect?: (id: string) => void;
}

export interface VisibleTrendPin {
  readonly id: string;
  readonly memberIds: readonly string[];
  readonly screenX: number;
  readonly screenY: number;
  readonly score: number;
}

interface DrawnBeam {
  readonly id: string;
  readonly trend: GeographicTrend;
  readonly primitive: BeamPrimitive;
  readonly color: Color;
  readonly heightMeters: number;
}

export class TrendBeamLayer {
  private readonly source = new CustomDataSource("google-search-trends");
  private readonly polylines = new PolylineCollection();
  private readonly clickHandler: ScreenSpaceEventHandler;
  private readonly gate = new CameraGate();
  private readonly drawn: DrawnBeam[] = [];
  private visible = true;
  private settings: EarthViewSettings = DEFAULT_SETTINGS;
  private lastTrends: readonly GeographicTrend[] = [];

  constructor(
    private readonly viewer: Viewer,
    options: TrendBeamLayerOptions = {},
  ) {
    void viewer.dataSources.add(this.source);
    viewer.scene.primitives.add(this.polylines);
    viewer.scene.preRender.addEventListener(this.onFrame);
    this.clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.clickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position) as { id?: string } | undefined;
      const id = picked?.id;
      if (id?.startsWith("trend:") && id.endsWith(":beam")) {
        options.onSelect?.(id.slice("trend:".length, -":beam".length));
      }
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  setSettings(settings: EarthViewSettings): void {
    this.settings = settings;
    this.gate.force();
    if (this.lastTrends.length > 0) {
      this.render(this.lastTrends);
    }
  }

  render(trends: readonly GeographicTrend[]): void {
    this.lastTrends = trends;
    this.clearDrawn();
    const length = clampBeamLengthMultiplier(this.settings.beamLengthMultiplier);
    const widthPx = clampBeamWidthPx(this.settings.beamWidthPx);
    const beamAlpha = clampBeamAlpha(this.settings.beamAlpha);

    for (const trend of trends) {
      const visual = mapTrendBeam(trend.score, trend.rank, trend.term);
      const heightMeters = visual.heightMeters * length;
      const color = Color.fromHsl(visual.hue / 360, 0.82, 0.62, 1);
      const primitive = addBeam(this.polylines, this.source, `trend:${trend.id}`, {
        lon: trend.location.longitude,
        lat: trend.location.latitude,
        heightMeters,
        color,
        widthPx,
        beamAlpha,
      });
      this.drawn.push({ id: trend.id, trend, primitive, color, heightMeters });
    }
    this.gate.force();
  }

  clear(): void {
    this.lastTrends = [];
    this.clearDrawn();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.source.show = visible;
    this.polylines.show = visible;
    this.gate.force();
  }

  origins(): Array<{ longitude: number; latitude: number }> {
    return this.drawn.map((beam) => ({
      longitude: beam.trend.location.longitude,
      latitude: beam.trend.location.latitude,
    }));
  }

  getVisiblePins(): readonly VisibleTrendPin[] {
    if (!this.visible) {
      return [];
    }
    const scene = this.viewer.scene;
    const cameraPosition = this.viewer.camera.positionWC;
    const ellipsoid = scene.globe.ellipsoid;
    const pins: VisibleTrendPin[] = [];
    for (const beam of this.drawn) {
      const origin = beam.primitive.positions[1] ?? beam.primitive.positions[0];
      const screen = chipScreenIfFacing(
        isOnCameraFacingHemisphere(origin, cameraPosition, ellipsoid),
        SceneTransforms.worldToWindowCoordinates(scene, origin),
      );
      if (!screen) {
        continue;
      }
      pins.push({
        id: beam.id,
        memberIds: [beam.id],
        screenX: screen.x,
        screenY: screen.y,
        score: beam.trend.score,
      });
    }
    return pins;
  }

  reveal(): void {
    this.gate.force();
  }

  flyTo(id: string): void {
    const beam = this.drawn.find((entry) => entry.id === id);
    if (!beam) return;
    const { longitude, latitude } = beam.trend.location;
    const destination = Cartesian3.fromDegrees(
      longitude,
      latitude,
      Math.max(beam.heightMeters * 1.45, 2_400_000),
    );
    flyViewerCamera(this.viewer, {
      destination,
      ...planCameraFlight(
        this.viewer.camera.positionWC,
        destination,
        this.settings.baseZoomSpeedKmPerSecond,
        1,
        this.viewer.camera,
        this.settings.flightEaseSeconds,
      ),
    });
  }

  destroy(): void {
    this.viewer.scene.preRender.removeEventListener(this.onFrame);
    this.clickHandler.destroy();
    this.viewer.scene.primitives.remove(this.polylines);
    this.viewer.dataSources.remove(this.source, true);
  }

  private clearDrawn(): void {
    this.drawn.length = 0;
    this.polylines.removeAll();
    this.source.entities.removeAll();
  }

  private readonly onFrame = (): void => {
    if (!this.visible || this.drawn.length === 0) {
      return;
    }
    if (!this.gate.shouldRun(readCameraPose(this.viewer), frameNowMs())) {
      return;
    }

    const cameraPosition = this.viewer.camera.positionWC;
    const ellipsoid = this.viewer.scene.globe.ellipsoid;
    const fov = verticalFovRadians(this.viewer);
    const height = this.viewer.camera.positionCartographic.height;
    const beamAlpha = clampBeamAlpha(this.settings.beamAlpha);

    for (const beam of this.drawn) {
      const facing = isOnCameraFacingHemisphere(
        beam.primitive.positions[1] ?? beam.primitive.positions[0],
        cameraPosition,
        ellipsoid,
      );
      const visibleFraction =
        fov === null ? 1 : beamVisibleFraction(beam.heightMeters, height, fov);
      const fade = quantizeBeamFade(beamFadeAlphaScale(visibleFraction));
      const showLine = beamLineVisible(facing, beam.heightMeters, fade);
      beam.primitive.polyline.show = showLine;
      if (showLine) {
        applyBeamColor(beam.primitive.polyline, beam.color, fade, beamAlpha);
        applyBeamWidth(beam.primitive.polyline, clampBeamWidthPx(this.settings.beamWidthPx));
      }
      beam.primitive.baseEntity.show = facing;
    }
  };
}
