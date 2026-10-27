import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  root: ".",
  publicDir: "public",
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2022" },
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
});
