// Start/stop watching a trip's flight price. The baseline is the live fare at the
// moment the user starts watching, so any "drop" we report is measured, not estimated.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { cheapestFare, resolveIata } from "../_shared/travelpayouts.ts";
import { getUsdMxnRate } from "../_shared/fx.ts";
import { primaryPlace } from "./place.ts";

const respond = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "method_not_allowed" }, 405);
  const user = await getAuthUser(req);
  if (!user) return unauthorizedResponse(corsHeaders);

  let body: { action?: string; trip_id?: string };
  try { body = await req.json(); } catch { return respond({ error: "invalid_json" }, 400); }
  const action = body.action;
  const tripId = body.trip_id ?? "";
  if ((action !== "start" && action !== "stop") || !UUID_RE.test(tripId)) {
    return respond({ error: "invalid_request" }, 400);
  }

  const rl = await enforceRateLimit(req, "price-watch", user.id, { perMinute: 6, perHour: 40 });
  if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  if (action === "stop") {
    await admin.from("price_watches").update({ active: false }).eq("trip_id", tripId).eq("user_id", user.id);
    return respond({ ok: true });
  }

  const { data: trip } = await admin
    .from("trips")
    .select("id,user_id,destino,ciudad_origen,fecha_salida,fecha_regreso,num_viajeros")
    .eq("id", tripId)
    .maybeSingle();
  if (!trip || trip.user_id !== user.id) return respond({ error: "trip_not_found" }, 404);

  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (!trip.fecha_salida || trip.fecha_salida < tomorrow) {
    return respond({ error: "trip_not_upcoming", message: "Solo se pueden vigilar viajes con fecha futura." }, 422);
  }

  const token = Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? "";
  const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY") ?? "";
  if (!token && !serpKey) return respond({ error: "price_source_unavailable" }, 503);
  const marker = (Deno.env.get("TRAVELPAYOUTS_MARKER") || "533299").trim();

  const [origin, destination] = await Promise.all([
    resolveIata(primaryPlace(trip.ciudad_origen)),
    resolveIata(primaryPlace(trip.destino)),
  ]);
  if (!origin || !destination || origin === destination) {
    return respond({ error: "route_unresolved", message: "No pudimos identificar los aeropuertos de este viaje." }, 422);
  }

  const fare = await cheapestFare(
    { origin, destination, departureDate: trip.fecha_salida, returnDate: trip.fecha_regreso },
    { travelpayoutsToken: token, serpKey, marker },
  );
  if (!fare) {
    return respond({ error: "no_fare", message: "Aún no hay tarifas publicadas para esta ruta y fecha." }, 422);
  }

  const price = Math.round(fare.priceUsd * (await getUsdMxnRate()));
  const adults = Math.min(9, Math.max(1, Number(trip.num_viajeros) || 1));

  const { data: watch, error } = await admin
    .from("price_watches")
    .upsert({
      user_id: user.id,
      trip_id: trip.id,
      origin_iata: origin,
      destination_iata: destination,
      departure_date: trip.fecha_salida,
      return_date: trip.fecha_regreso,
      adults,
      baseline_price_mxn: price,
      baseline_approximate: fare.approximateDates,
      baseline_source: fare.source,
      last_price_mxn: price,
      lowest_price_mxn: fare.approximateDates ? null : price,
      booking_link: fare.bookingLink,
      last_checked_at: new Date().toISOString(),
      last_alert_at: null,
      last_alert_price_mxn: null,
      active: true,
    }, { onConflict: "trip_id" })
    .select()
    .single();
  if (error || !watch) return respond({ error: "save_failed" }, 500);

  await admin.from("price_watch_checks").insert({
    watch_id: watch.id, user_id: user.id, price_mxn: price, approximate_dates: fare.approximateDates,
    source: fare.source,
  });

  return respond({ ok: true, watch });
});
