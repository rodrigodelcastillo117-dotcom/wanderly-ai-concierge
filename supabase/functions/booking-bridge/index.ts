// booking-bridge — API del Booking Bridge (Fases 2, 7, 8, 9 y 12). La lógica vive en handler.ts
// (probada con Vitest); aquí solo se conecta con Supabase, SerpApi (caché + bolsa del usuario) y el
// correo. Acciones: list_offers_for_trip, resolve, start_booking, confirm_price_ack, recheck_price,
// mark_returned, attach_user_proof, status, cancel. Contrato: docs/iatos/IATOS_BOOKING_BRIDGE.md §API.
// Nunca compra, cobra ni confirma: guarda la intención, firma la salida al proveedor y registra lo
// que el usuario declara.
import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { redactPii } from "../_shared/redact.ts";
import { sendEmail } from "../_shared/email.ts";
import { liveSearchGateFor, serpFetchFor } from "../_shared/serpRuntime.ts";
import { recheckFlight, recheckHotel } from "../_shared/booking/recheck.ts";
import { signRedirect, targetHash } from "../_shared/booking/redirectToken.ts";
import { safeOrigin } from "../_shared/origin.ts";
import { venueFromPriveRow } from "../_shared/booking/offers.ts";
import { type BridgeDeps, handleBridge } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-prive-session",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
const FIXER_EMAIL = Deno.env.get("FIXER_EMAIL") || "hola@traveliatos.life";
const FROM_ADDRESS = Deno.env.get("FIXER_FROM_ADDRESS") || "IATOS Fixer <hola@traveliatos.life>";
// Banderas (apagadas por defecto): compra exacta de vuelos por booking_request de Google Flights y
// envío del correo de solicitud por el flujo de Reservas IA (grupo reservas).
const FLAG_EXACT_FLIGHT = Deno.env.get("BOOKING_EXACT_FLIGHT_FORM") === "true";
const FLAG_RESERVAS_EMAIL = Deno.env.get("BOOKING_RESERVAS_EMAIL") === "true";

const TRIP_COLS = "id, user_id, destino, pais_destino, ciudad_origen, fecha_salida, fecha_regreso, num_viajeros, quote_needs_update, created_at, " +
  "vuelos_json, hospedaje_json, tours_json, restaurantes_json, itinerario_json";
const INTENT_COLS = "id, trip_id, offer_id, product_type, provider, action_kind, booking_mode, state, verification, title, target_host, processor, channel, " +
  "price, currency, price_checked_at, offer_expires_at, user_report, concierge_request_id, redirected_at, redirect_count, state_changed_at, created_at";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, code: "METHOD_NOT_ALLOWED" });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { ok: false, code: "UNAUTHENTICATED", message: "Tu sesión expiró. Vuelve a iniciar sesión." });
    const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
    const { data: u, error: uErr } = await user.auth.getUser();
    if (uErr || !u?.user) return json(401, { ok: false, code: "UNAUTHENTICATED", message: "Tu sesión expiró. Vuelve a iniciar sesión." });
    const userId = u.user.id;

    const body = await req.json().catch(() => null);
    const action = typeof body?.action === "string" ? body.action : "";
    const rl = await enforceRateLimit(req, `booking-bridge:${action === "recheck_price" ? "recheck" : "api"}`, userId,
      action === "recheck_price" ? { perMinute: 3, perHour: 20, ipPerMinute: 10 } : { perMinute: 40, perHour: 400, ipPerMinute: 120 });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const origin = safeOrigin(body?.origin ?? req.headers.get("origin"));
    const serp = serpFetchFor("booking-bridge", userId, liveSearchGateFor(userId));
    const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY");

    const deps: BridgeDeps = {
      userId,
      userLabel: u.user.email ?? userId,
      priveSession: req.headers.get("x-prive-session"),
      flags: { exact_flight_form: FLAG_EXACT_FLIGHT, reservas_email: FLAG_RESERVAS_EMAIL },
      loadTrip: async (id) => {
        const { data } = await user.from("trips").select(TRIP_COLS).eq("id", id).maybeSingle();
        return (data as any) ?? null;
      },
      venueLookup: async ({ name, city, slug }) => {
        if (slug) {
          const { data } = await admin.from("prive_experiences_v").select("id, slug, name, website, booking_url, booking_method, google_place_id, verified_at, effective_state, destination_id")
            .eq("slug", slug).maybeSingle();
          if (!data || !["VERIFICADO", "CURADO", "ESTIMADO"].includes((data as any).effective_state)) return null;
          const { data: d } = await admin.from("prive_destinations").select("name_es, iso_country").eq("id", (data as any).destination_id).maybeSingle();
          return venueFromPriveRow(data, (d as any)?.name_es ?? null, (d as any)?.iso_country ?? null);
        }
        if (!name || !city) return null;
        const { data, error } = await admin.rpc("booking_venue_lookup", { _name: name, _city: city });
        if (error || !data) return null;
        return venueFromPriveRow(data, (data as any).city, (data as any).iso_country);
      },
      rpc: (fn, args) => admin.rpc(fn, args),
      userRpc: (fn, args) => user.rpc(fn, args),
      listIntents: async (f) => {
        let q = user.from("booking_intents").select(INTENT_COLS).order("created_at", { ascending: false }).limit(100);
        if (f.id) q = q.eq("id", f.id);
        if (f.trip_id) q = q.eq("trip_id", f.trip_id);
        const { data } = await q;
        return (data as any[]) ?? [];
      },
      createAssistRequest: async (row) => {
        const { data, error } = await admin.from("concierge_requests").insert({
          user_id: userId, trip_id: row.trip_id, type: "booking_assist", title: row.title, payload: row.payload, status: "pending",
        }).select("id").single();
        if (error) console.error("booking-bridge concierge_requests:", redactPii(error.message));
        return (data as any)?.id ?? null;
      },
      notifyTeam: async (subject, html) => (await sendEmail({ to: FIXER_EMAIL, from: FROM_ADDRESS, subject, html, ...(u.user.email ? { replyTo: u.user.email } : {}) })).ok,
      tripDocumentOk: async (docId, tripId) => {
        if (!tripId) return false;
        const { data } = await user.from("trip_documents").select("id").eq("id", docId).eq("trip_id", tripId).eq("uploaded_by", userId).maybeSingle();
        return !!data;
      },
      recheckFlight: (q) => recheckFlight(q, { serpKey, serpFetch: serp.fetch }),
      recheckHotel: (q) => recheckHotel(q, { serpKey, serpFetch: serp.fetch }),
      // El token queda atado al destino guardado (huella SHA-256) y a su nivel de confianza (AUD-04).
      goUrl: async (intentId, target) => {
        const t = await signRedirect(SERVICE_KEY, { i: intentId, u: userId, o: origin, h: await targetHash(target.url), t: target.tier === "trusted_source" ? "s" : "a",
          n: target.uses ?? 0 });
        return t ? `${SUPABASE_URL}/functions/v1/booking-go?t=${encodeURIComponent(t)}` : null;
      },
      intentTarget: async (id) => {
        const { data } = await admin.from("booking_intents").select("target_url, offer").eq("id", id).eq("user_id", userId).maybeSingle();
        return data ? { target_url: (data as any).target_url ?? null, action_trust: (data as any).offer?.action?.trust ?? null } : null;
      },
    };
    const out = await handleBridge(action, body ?? {}, deps);
    return json(out.status, out.body);
  } catch (e) {
    console.error("booking-bridge error", redactPii((e as Error)?.message ?? e));
    return json(500, { ok: false, code: "INTERNAL_ERROR", message: "Algo falló. Intenta de nuevo." });
  }
});
