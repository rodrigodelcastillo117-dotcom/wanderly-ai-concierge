// Conexión real a Google Maps Platform desde una función (llaves del entorno, solo servidor).
// La lógica vive en google-maps.ts / google-places.ts / google-routes.ts (probadas con Vitest).
// Cada llamada facturable queda en ai_usage_log (provider "google_maps", model = SKU) con el
// precio de lista: así el panel de costos cuenta las llamadas contra la franja gratis de cada SKU.
import { createGoogleTransport, type GoogleTransport, googleListPriceUsd } from "./google-maps.ts";
import { logUsage } from "./serpRuntime.ts";

/**
 * null si falta GOOGLE_MAPS_API_KEY: quien llama responde "no disponible".
 * Por defecto va por el conector de Lovable (como las funciones actuales). Con
 * GOOGLE_MAPS_DIRECT=true va directo a Google: el conector tiene un tope de 6,000 solicitudes de
 * servidor cada 24 h por espacio de trabajo (docs.lovable.dev/integrations/google-maps).
 */
export function googleTransportFor(fn: string, userId: string | null): GoogleTransport | null {
  const direct = (Deno.env.get("GOOGLE_MAPS_DIRECT") ?? "").toLowerCase() === "true";
  return createGoogleTransport({
    mapsKey: Deno.env.get("GOOGLE_MAPS_API_KEY"),
    lovableKey: direct ? null : Deno.env.get("LOVABLE_API_KEY"),
    onCall: ({ sku, ok }) => {
      if (!ok) return;
      // Sin await: registrar nunca retrasa la respuesta.
      void logUsage({ user_id: userId, function: fn, provider: "google_maps", model: sku, cost_estimate_usd: googleListPriceUsd(sku) });
    },
  });
}
