import { defineConfig } from "vitest/config";

export default defineConfig({
  // Playwright tests run in a real browser through their own configuration, not inside Vitest.
  test: { exclude: ["tests/e2e/**"] },
  // Workers/Static Assets can serve this plain Vite build; no paid service is needed here.
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "0.0.0.0" },
  plugins: [
    {
      name: "aedjaeger-precache-manifest",
      apply: "build",
      generateBundle(_options, bundle) {
        // The service worker must know Vite's hashed filenames before a first offline launch.
        const appAssets = Object.values(bundle)
          .filter((entry) => entry.type === "chunk" || (entry.type === "asset" && entry.fileName.endsWith(".css")))
          .map((entry) => `/${entry.fileName}`);
        this.emitFile({
          type: "asset",
          fileName: "precache-manifest.json",
          source: JSON.stringify(appAssets),
        });
      },
    },
  ],
});
