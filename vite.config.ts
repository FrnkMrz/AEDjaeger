import { defineConfig } from "vite";

export default defineConfig({
  // Workers/Static Assets can serve this plain Vite build; no paid service is needed here.
  build: { outDir: "dist", emptyOutDir: true },
  server: { host: "0.0.0.0" },
});
