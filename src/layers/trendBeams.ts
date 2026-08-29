import {
  ArcType,
  Cartesian2,
  Cartesian3,
  Color,
  CustomDataSource,
  DistanceDisplayCondition,
  HeightReference,
  LabelStyle,
  NearFarScalar,
  PolylineGlowMaterialProperty,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  type Viewer,
} from "cesium";
import type { GeographicTrend } from "../data/trendsTypes";
import { beamPositionsDegrees, mapTrendBeam } from "./trendBeamMapping";

export interface TrendBeamLayerOptions {
  readonly onSelect?: (id: string) => void;
}

export class TrendBeamLayer {
  private readonly source = new CustomDataSource("google-search-trends");
  private readonly clickHandler: ScreenSpaceEventHandler;
  private readonly records = new Map<string, GeographicTrend>();
  private visible = true;

  constructor(
    private readonly viewer: Viewer,
    options: TrendBeamLayerOptions = {},
  ) {
    void viewer.dataSources.add(this.source);
    this.clickHandler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.clickHandler.setInputAction((movement: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position) as { id?: { id?: string } } | undefined;
      const id = picked?.id?.id;
      if (id?.startsWith("trend:")) options.onSelect?.(id.slice("trend:".length));
    }, ScreenSpaceEventType.LEFT_CLICK);
  }

  render(trends: readonly GeographicTrend[]): void {
    this.clear();
    trends.forEach((trend, index) => {
      this.records.set(trend.id, trend);
      const visual = mapTrendBeam(trend.score, trend.rank, trend.term);
      const color = Color.fromHsl(visual.hue / 360, 0.82, 0.62, visual.alpha);
      const { longitude, latitude } = trend.location;
      this.source.entities.add({
        id: `trend:${trend.id}`,
        name: `${trend.term} · ${trend.location.countryName}`,
        position: Cartesian3.fromDegrees(longitude, latitude),
        point: {
          color: color.withAlpha(0.95),
          pixelSize: 6,
          outlineColor: Color.WHITE.withAlpha(0.55),
          outlineWidth: 1,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
        polyline: {
          positions: Cartesian3.fromDegreesArrayHeights(
            beamPositionsDegrees(longitude, latitude, visual.heightMeters),
          ),
          // A beam is vertical, so its endpoints share a longitude and
          // latitude. Geodesic subdivision degenerates on that path and leaves
          // the glow taper pointing the wrong way.
          arcType: ArcType.NONE,
          width: visual.widthPixels,
          material: new PolylineGlowMaterialProperty({
            color,
            glowPower: 0.18,
            taperPower: 0.55,
          }),
        },
        label:
          index < 8
            ? {
                text: trend.term,
                font: "600 12px Inter, sans-serif",
                fillColor: Color.WHITE.withAlpha(0.9),
                outlineColor: Color.BLACK.withAlpha(0.9),
                outlineWidth: 3,
                style: LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cartesian2(0, -14),
                verticalOrigin: VerticalOrigin.BOTTOM,
                distanceDisplayCondition: new DistanceDisplayCondition(0, 16_000_000),
                translucencyByDistance: new NearFarScalar(2_000_000, 1, 16_000_000, 0),
              }
            : undefined,
        show: this.visible,
      });
    });
  }

  clear(): void {
    this.records.clear();
    this.source.entities.removeAll();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.source.show = visible;
  }

  flyTo(id: string): void {
    const trend = this.records.get(id);
    if (!trend) return;
    const { longitude, latitude } = trend.location;
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(longitude, latitude, 4_200_000),
      duration: 1.2,
    });
  }

  destroy(): void {
    this.clickHandler.destroy();
    this.viewer.dataSources.remove(this.source, true);
  }
}
