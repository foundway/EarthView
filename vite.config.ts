import { defineConfig } from "vitest/config";
import { viteStaticCopy } from "vite-plugin-static-copy";

const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumAssetDir = "cesiumStatic";

// GitHub Pages project sites live under /<repo>/. Pass VITE_BASE=/EarthView/ in CI.
const base = process.env.VITE_BASE || "/";
const cesiumBaseUrl = `${base}${cesiumAssetDir}`.replace(/\/{2,}/g, "/");

export default defineConfig({
  base,
  define: {
    CESIUM_BASE_URL: JSON.stringify(cesiumBaseUrl),
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumAssetDir },
        { src: `${cesiumSource}/Workers`, dest: cesiumAssetDir },
        { src: `${cesiumSource}/Assets`, dest: cesiumAssetDir },
        { src: `${cesiumSource}/Widgets`, dest: cesiumAssetDir },
      ],
    }),
  ],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: "node",
  },
});
