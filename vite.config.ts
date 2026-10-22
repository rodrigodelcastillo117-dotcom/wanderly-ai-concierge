import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Paquetes de node_modules agrupados en chunks "vendor" estables (E-23 / IATOS-103). Así el
// navegador los guarda en caché entre despliegues (el código de la app cambia; React o Supabase
// no) y las librerías pesadas que solo usan algunas pantallas (gráficas, 3D, PDF, animaciones,
// analítica) nunca entran al paquete inicial.
const VENDOR_GROUPS: [string, (pkg: string) => boolean][] = [
  // React, el router y ayudantes diminutos que usan varias librerías a la vez. Si no se fijan
  // aquí, Rollup los mete en el primer chunk que los pide (p. ej. clsx dentro de las gráficas) y
  // el paquete inicial termina descargando las gráficas, el 3D o el PDF completos.
  ["vendor-core", (p) => [
    "react", "react-dom", "scheduler", "react-router", "react-router-dom", "@remix-run/router", "use-sync-external-store",
    "clsx", "prop-types", "react-is", "object-assign", "@babel/runtime", "tslib", "tiny-invariant",
  ].includes(p)],
  ["vendor-supabase", (p) => p.startsWith("@supabase/") || p === "iceberg-js"],
  ["vendor-radix", (p) => p.startsWith("@radix-ui/") || p.startsWith("@floating-ui/")],
  ["vendor-motion", (p) => ["framer-motion", "motion-dom", "motion-utils"].includes(p)],
  ["vendor-charts", (p) => p === "recharts" || p.startsWith("d3-") || ["recharts-scale", "react-smooth", "victory-vendor", "decimal.js-light", "internmap"].includes(p)],
  ["vendor-3d", (p) => p === "three" || p.startsWith("three-") || p.startsWith("@react-three/") || ["react-globe.gl", "globe.gl", "kapsule", "react-kapsule"].includes(p)],
  ["vendor-pdf", (p) => ["jspdf", "jspdf-autotable", "html2canvas", "dompurify", "canvg", "fflate"].includes(p)],
  ["vendor-posthog", (p) => p === "posthog-js"],
  ["vendor-sentry", (p) => p.startsWith("@sentry/") || p.startsWith("@sentry-internal/")],
];

function vendorChunk(id: string): string | undefined {
  // Ayudantes que inyecta Vite/Rollup (precarga de import(), interop CommonJS).
  if (/vite\/preload-helper|commonjsHelpers|vite\/modulepreload-polyfill/.test(id)) return "vendor-core";
  const m = /.*node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(id.replace(/\\/g, "/"));
  if (!m) return undefined;
  const pkg = m[1];
  return VENDOR_GROUPS.find(([, test]) => test(pkg))?.[0];
}

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
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
