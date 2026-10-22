// Cliente de la edge function booking-bridge (docs/iatos/IATOS_BOOKING_BRIDGE.md §API).
// Si la función todavía no está desplegada o falla, devuelve { ok:false, unavailable:true } y la
// pantalla sigue funcionando con el enlace ya validado en el cliente (sin guardar la intención).
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_ORIGIN } from "../../supabase/functions/_shared/origin.ts";

export type BridgeSource =
  | { type: "trip_item"; trip_id: string; col: "vuelos_json" | "hospedaje_json" | "tours_json" | "restaurantes_json"; index: number; name?: string }
  | { type: "flight_result"; result: unknown; meta: unknown; trip_id?: string | null }
  | { type: "hotel_result"; result: unknown; meta: unknown; trip_id?: string | null }
  | { type: "venue"; name: string; city?: string | null; country?: string | null; prive_slug?: string | null; product_type?: string; trip_id?: string | null }
  // roadtrip: renta de auto (ciudades y fechas; el servidor arma el enlace con carRental.ts).
  | { type: "car_rental"; pickup_city: string; dropoff_city: string | null; pickup_date: string; dropoff_date: string; trip_id?: string | null };

export type BridgeResult = { ok: boolean; code?: string; message?: string; unavailable?: boolean; [k: string]: any };

export async function bridge(action: string, body: Record<string, unknown> = {}, headers?: Record<string, string>): Promise<BridgeResult> {
  try {
    const origin = typeof window !== "undefined" ? window.location.origin : DEFAULT_ORIGIN;
    const { data, error } = await supabase.functions.invoke("booking-bridge", { body: { action, origin, ...body }, headers });
    if (error) {
      // FunctionsHttpError trae la respuesta: se lee el código estable si existe.
      const ctx = (error as any)?.context;
      const parsed = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
      if (parsed && typeof parsed === "object") return parsed as BridgeResult;
      return { ok: false, unavailable: true, code: "BRIDGE_UNAVAILABLE", message: "No pudimos guardar tu selección ahora." };
    }
    return (data ?? { ok: false, unavailable: true }) as BridgeResult;
  } catch {
    return { ok: false, unavailable: true, code: "BRIDGE_UNAVAILABLE", message: "No pudimos guardar tu selección ahora." };
  }
}

/** Llave de idempotencia por intento (doble toque = misma llave). */
export function newIdempotencyKey(): string {
  const r = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `bk-${r}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60);
}
