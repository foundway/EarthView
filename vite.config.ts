import { defineConfig } from "vitest/config";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { trendsApiDevPlugin } from "./dev/trendsApiPlugin";

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
    trendsApiDevPlugin(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumAssetDir },
        { src: `${cesiumSource}/Workers`, dest: cesiumAssetDir },
        { src: `${cesiumSource}/Assets`, dest: cesiumAssetDir },
        { src: `${cesiumSource}/Widgets`, dest: cesiumAssetDir },
      ],
    }),
  ],
  // 4000, not Vite's default 5173: Marauder holds that port with strictPort,
  // and two globe apps fighting over it reads as "the globe is broken".
  server: {
    host: "::",
    port: 4000,
    strictPort: true,
  },
  preview: {
    host: "::",
    port: 4000,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "dev/**/*.test.ts"],
  },
});
