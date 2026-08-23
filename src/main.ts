import "cesium/Build/Cesium/Widgets/widgets.css";
import { Ion } from "cesium";
import { createEarthViewer } from "./createEarthViewer";
import "./styles.css";

window.CESIUM_BASE_URL = CESIUM_BASE_URL;

// This project deliberately does not use Cesium Ion. Satellite imagery comes
// from the public Esri tile endpoint configured in src/config.ts.
Ion.defaultAccessToken = "";

const earth = document.getElementById("earth");
if (!earth) {
  throw new Error("EarthView markup is missing #earth");
}

createEarthViewer(earth);
