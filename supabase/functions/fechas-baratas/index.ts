// «10 días en diciembre» → las salidas más baratas de ese mes para un viaje de 10 días (pedido del dueño,
// 12-nov-2026). Tarifas reales de referencia del calendario de Aviasales (sin SerpApi): ver _shared/ventanaBarata.ts.
// La persona elige una de las fechas (o cualquier otra en el calendario): nada se fija sin su toque.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { knownCityCode } from "../_shared/fareGuard.ts";
import { flightPlaceMetro } from "../_shared/airports.ts";
import { resolveIata } from "../_shared/travelpayouts.ts";
import { getUsdMxnRateInfo } from "../_shared/fx.ts";
import { fechasBaratas } from "../_shared/ventanaBarata.ts";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);
  const rl = await enforceRateLimit(req, "fechas-baratas", user.id, { perMinute: 10, perHour: 60, ipPerMinute: 30 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);
  try {
    const body = await req.json().catch(() => ({}));
    const city = (v: unknown) => String(v ?? "").trim().slice(0, 80);
    const code = async (s: string) => (s ? knownCityCode(s) ?? flightPlaceMetro(s) ?? (await resolveIata(s).catch(() => null)) : null);
    const [origen, destino] = await Promise.all([code(city(body.origen)), code(city(body.destino))]);
    const hoyISO = new Date(Date.now() - 6 * 3_600_000).toISOString().slice(0, 10); // día de hoy en CDMX
    if (!origen || !destino) return json({ ok: false, motivo: "sin_ruta", ventanas: [] });
    const fx = await getUsdMxnRateInfo().catch(() => null);
    const r = await fechasBaratas(
      { origen, destino, mes: String(body.mes ?? ""), noches: Number(body.noches) },
      { token: Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? "", usdMxn: fx?.rate ?? 0, hoyISO, timeoutMs: 8000 },
    );
    return json(r);
  } catch (e) {
    console.error("fechas-baratas", e instanceof Error ? e.message : e);
    return json({ ok: false, motivo: "sin_datos", ventanas: [] });
  }
});
