import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    // Pruebas herméticas (P3-QA-2): valores FALSOS que pisan los del .env (que apunta a producción) y
    // permiten correr sin .env. Ninguna prueba debe salir a la red: src/test/setup.ts bloquea fetch.
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:9",
      VITE_SUPABASE_PUBLISHABLE_KEY: "clave-falsa-de-pruebas",
      VITE_SUPABASE_PROJECT_ID: "proyecto-falso-de-pruebas",
      VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY: "clave-maps-falsa-de-pruebas",
      VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID: "tracking-falso-de-pruebas",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
