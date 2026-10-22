import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
// Reparto en chunks vendor y guarda contra chunks circulares (incidente Smart Spend): ver el archivo.
import { chunkCycleGuard, vendorChunk } from "./vite.chunks";
// La pantalla con la que se abre la app se pide desde el HTML, en paralelo con el paquete inicial.
import { routePreloadHints } from "./vite.routePreload";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    target: ["es2019", "safari13"],
    cssTarget: "safari13",
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger(), chunkCycleGuard(), routePreloadHints()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
