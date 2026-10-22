// booking-go: salida firmada al proveedor (Fase 12, sin open redirects). Sin Deno.serve (se prueba
// con Vitest). Solo redirige si el token lo firmó booking-bridge, no venció, la intención es del mismo
// usuario y su destino GUARDADO es exactamente el que se firmó (huella `h`) y vuelve a pasar la regla
// del nivel con que se firmó (`t`): lista estricta, o fuente del servidor (catálogo / escaneo del
// sitio oficial). Un token sin huella (anterior a AUD-04) solo sale por la lista estricta. Nunca lee
// una URL de la petición. Cualquier falla regresa a IATOS con un aviso, no a un dominio externo.
import { checkAllowlisted, checkTrustedSource } from "../_shared/booking/allowlist.ts";
import { MAX_TOKEN_USES, targetHash, verifyRedirect } from "../_shared/booking/redirectToken.ts";
import { DEFAULT_ORIGIN, safeOrigin } from "../_shared/origin.ts";

type Target = { ok: boolean; target_url?: string; trip_id?: string | null; code?: string; redirect_count?: number } | null;

export type GoDeps = {
  secret: string;
  /** Lee (sin marcar) el destino guardado de la intención del usuario: se revisa ANTES de marcar la salida. */
  peekTarget?(intentId: string, userId: string): Promise<Target>;
  markRedirected(intentId: string, userId: string): Promise<Target>;
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
  const claims = v.claims;
  const verdict = async (r: Target): Promise<GoResult | { url: string }> => {
    if (!r?.ok || !r.target_url) return back(origin, r?.code === "NOT_READY" ? "comprueba_el_precio" : "no_disponible", r?.trip_id ?? null);
    if (claims.h && (await targetHash(r.target_url)) !== claims.h) return back(origin, "destino_bloqueado", r.trip_id ?? null);
    const safe = claims.h && claims.t === "s" ? checkTrustedSource(r.target_url) : checkAllowlisted(r.target_url);
    return safe.ok ? { url: safe.url } : back(origin, "destino_bloqueado", r.trip_id ?? null);
  };
  // Primero se revisa sin marcar: un destino bloqueado no deja la intención como "salió al proveedor".
  if (deps.peekTarget) {
    const peeked = await deps.peekTarget(claims.i, claims.u);
    const pre = await verdict(peeked);
    if ("status" in pre) return pre;
    // A2-T1: un token firmado con `n` sirve para MAX_TOKEN_USES salidas; después regresa a IATOS.
    if (typeof claims.n === "number" && typeof peeked?.redirect_count === "number" && peeked.redirect_count >= claims.n + MAX_TOKEN_USES) {
      return back(origin, "enlace_usado", peeked.trip_id ?? null);
    }
  }
  const post = await verdict(await deps.markRedirected(claims.i, claims.u));
  if ("status" in post) return post;
  return { status: 302, location: post.url, reason: "ok" };
}
