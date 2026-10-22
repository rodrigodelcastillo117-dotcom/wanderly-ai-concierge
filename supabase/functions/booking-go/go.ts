// booking-go: salida firmada al proveedor (Fase 12, sin open redirects). Sin Deno.serve (se prueba
// con Vitest). Solo redirige si el token lo firmó booking-bridge, no venció, la intención es del mismo
// usuario y su destino GUARDADO vuelve a pasar la lista blanca o la regla de fuente confiable. Nunca
// lee una URL de la petición. Cualquier falla regresa a IATOS con un aviso, no a un dominio externo.
import { checkTrustedSource } from "../_shared/booking/allowlist.ts";
import { verifyRedirect } from "../_shared/booking/redirectToken.ts";
import { DEFAULT_ORIGIN, safeOrigin } from "../_shared/origin.ts";

export type GoDeps = {
  secret: string;
  markRedirected(intentId: string, userId: string): Promise<{ ok: boolean; target_url?: string; trip_id?: string | null; code?: string } | null>;
  now?: () => number;
};

export type GoResult = { status: 302; location: string; reason: string };

function back(origin: string, reason: string, tripId?: string | null): GoResult {
  const path = tripId ? `/dashboard/viajes/${tripId}` : "/dashboard/reservas";
  return { status: 302, location: `${origin}${path}?salida=${encodeURIComponent(reason)}`, reason };
}

export async function resolveGo(url: string, deps: GoDeps): Promise<GoResult> {
  let token: string | null = null;
  try { token = new URL(url).searchParams.get("t"); } catch { /* url inválida */ }
  const v = await verifyRedirect(deps.secret, token, deps.now?.());
  if (!v.ok) return back(DEFAULT_ORIGIN, v.reason === "vencido" ? "enlace_vencido" : "enlace_invalido");
  const origin = safeOrigin(v.claims.o);
  const r = await deps.markRedirected(v.claims.i, v.claims.u);
  if (!r?.ok || !r.target_url) return back(origin, r?.code === "NOT_READY" ? "comprueba_el_precio" : "no_disponible", r?.trip_id ?? null);
  const safe = checkTrustedSource(r.target_url);
  if (!safe.ok) return back(origin, "destino_bloqueado", r.trip_id ?? null);
  return { status: 302, location: safe.url, reason: "ok" };
}
