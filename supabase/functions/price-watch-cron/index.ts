// Re-quotes watched trips' flights and alerts users when the live fare drops.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cheapestFare, type CheapestFare } from "../_shared/travelpayouts.ts";
import { getUsdMxnRate } from "../_shared/fx.ts";
import { PRICE_PUSH_OPTIONS, pushToUser } from "../_shared/push.ts";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { safeErrorMessage } from "../_shared/redact.ts";
import { decide, formatMxn, priceDedupKey } from "./rules.ts";
import { serpFetchFor } from "../_shared/serpRuntime.ts";

// Las dos fuentes (Travelpayouts y Google Flights vía SerpApi) se consultan en dólares.
const PROVIDER_CURRENCY = "USD";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const BATCH = 40;

Deno.serve(async (req) => {
  if (!(await isAuthorizedCron(req))) return json({ error: "unauthorized" }, 401);

  const token = Deno.env.get("TRAVELPAYOUTS_TOKEN") ?? "";
  const serpKey = Deno.env.get("SERPAPI_PRIVATE_KEY") ?? "";
  if (!token && !serpKey) return json({ error: "no_price_source" }, 503);
  const marker = (Deno.env.get("TRAVELPAYOUTS_MARKER") || "533299").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, { auth: { persistSession: false } });

  const now = new Date();

  // Reclamo con FOR UPDATE SKIP LOCKED (migración 20261022142200): dos corridas encimadas reciben
  // alertas distintas y no gastan dos veces la misma búsqueda ni repiten el aviso. La función
  // también apaga las alertas de viajes que ya salieron (o salen mañana).
  let { data: claimed, error } = await admin.rpc("claim_price_watches", { p_limit: BATCH });
  if (error && /claim_price_watches|PGRST202|does not exist/i.test(`${error.code ?? ""} ${error.message ?? ""}`)) {
    // La función se publicó antes que la migración: el SELECT de antes (sin candado).
    console.error("price-watch-cron: falta claim_price_watches; se usa la lectura sin candado");
    await admin.from("price_watches").update({ active: false }).eq("active", true)
      .lt("departure_date", new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10));
    ({ data: claimed, error } = await admin.from("price_watches").select("*").eq("active", true)
      .order("last_checked_at", { ascending: true, nullsFirst: true }).limit(BATCH));
  }
  if (error) {
    console.error("price-watch-cron: claim_price_watches", safeErrorMessage(error));
    return json({ error: "query_failed" }, 500);
  }
  const tripIds = [...new Set(((claimed ?? []) as { trip_id: string }[]).map((w) => w.trip_id))];
  const { data: tripRows } = tripIds.length
    ? await admin.from("trips").select("id, destino").in("id", tripIds)
    : { data: [] as { id: string; destino: string | null }[] };
  const destinoById = new Map((tripRows ?? []).map((t: { id: string; destino: string | null }) => [t.id, t.destino]));
  // deno-lint-ignore no-explicit-any -- filas de price_watches (sin tipos generados en las funciones)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const watches: any[] = ((claimed ?? []) as any[]).map((w) => ({ ...w, trips: { destino: destinoById.get(w.trip_id) ?? null } }));
  // Google Flights pasa por la caché compartida (6 h): alertas de la misma ruta y fechas comparten
  // la búsqueda; cada búsqueda real queda en ai_usage_log.
  const serpFetch = serpFetchFor("price-watch-cron", null).fetch;

  const fx = await getUsdMxnRate();
  const fareCache = new Map<string, CheapestFare | null>();
  const summary = { checked: 0, no_fare: 0, alerts: 0, rebaselined: 0, failed: 0 };

  for (const w of watches ?? []) {
    try {
      const prefer = w.baseline_approximate ? "travelpayouts" : w.baseline_source;
      const key = `${w.origin_iata}|${w.destination_iata}|${w.departure_date}|${w.return_date ?? ""}|${prefer}`;
      if (!fareCache.has(key)) {
        fareCache.set(key, await cheapestFare(
          { origin: w.origin_iata, destination: w.destination_iata, departureDate: w.departure_date, returnDate: w.return_date },
          { travelpayoutsToken: token, serpKey, marker, serpFetch },
          prefer,
        ));
      }
      const fare = fareCache.get(key);
      const checkedAt = new Date().toISOString();
      if (!fare) {
        summary.no_fare++;
        await admin.from("price_watches").update({ last_checked_at: checkedAt }).eq("id", w.id);
        continue;
      }

      const amount = fare.priceUsd;
      const price = Math.round(amount * fx);
      summary.checked++;
      await admin.from("price_watch_checks").insert({
        watch_id: w.id, user_id: w.user_id, price_mxn: price, approximate_dates: fare.approximateDates,
        source: fare.source, amount_original: amount, currency: PROVIDER_CURRENCY, fx_rate: fx,
      });

      const baselineAmount = w.baseline_amount_original == null ? null : Number(w.baseline_amount_original);
      const decision = decide(
        {
          baselineAmount,
          baselineCurrency: w.baseline_currency ?? null,
          baselineApproximate: w.baseline_approximate,
          baselineSource: w.baseline_source,
          lastAlertAmount: w.last_alert_amount_original == null ? null : Number(w.last_alert_amount_original),
          lastAlertAt: w.last_alert_at,
        },
        { amount, currency: PROVIDER_CURRENCY, approximate: fare.approximateDates, source: fare.source, fxToMxn: fx },
        now,
      );

      const update: Record<string, unknown> = { last_checked_at: checkedAt };
      // The card compares "today" with the baseline, so it only shows prices
      // from the baseline's own source and exact dates.
      const comparable = decision.kind === "rebaseline" ||
        (!fare.approximateDates && fare.source === w.baseline_source);
      if (comparable) {
        update.last_price_mxn = price;
        update.last_amount_original = amount;
        update.booking_link = fare.bookingLink;
        update.lowest_price_mxn = w.lowest_price_mxn == null ? price : Math.min(Number(w.lowest_price_mxn), price);
      }

      if (decision.kind === "rebaseline") {
        update.baseline_price_mxn = price;
        update.baseline_amount_original = amount;
        update.baseline_currency = PROVIDER_CURRENCY;
        update.baseline_approximate = false;
        update.baseline_source = fare.source;
        update.lowest_price_mxn = price;
        update.last_alert_amount_original = null;
        summary.rebaselined++;
      } else if (decision.kind === "alert") {
        const destino = (w.trips as { destino?: string } | null)?.destino ?? "tu destino";
        const totalSaving = decision.dropMxn * (w.adults ?? 1);
        // "Antes" se convierte con el tipo de cambio de hoy, igual que "ahora": así el ahorro que se
        // muestra es solo la baja real de la tarifa, no un efecto del dólar.
        const before = Math.round(baselineAmount! * fx);
        const title = `Bajó tu vuelo a ${destino}`;
        const body = (w.adults ?? 1) > 1
          ? `Ahora ${formatMxn(price)} por persona (antes ${formatMxn(before)}, al tipo de cambio de hoy). Ahorras ${formatMxn(totalSaving)} para ${w.adults} viajeros.`
          : `Ahora ${formatMxn(price)} (antes ${formatMxn(before)}, al tipo de cambio de hoy). Ahorras ${formatMxn(totalSaving)}.`;
        // Aviso con llave única: si esta corrida se repite o se encima, no se duplica ni se repite el push.
        const { data: inserted, error: notifyErr } = await admin.rpc("notify_once", {
          p_user_id: w.user_id, p_type: "price_drop", p_title: title, p_body: body, p_related_id: w.trip_id,
          p_dedup_key: priceDedupKey(w.id, baselineAmount!, amount, PROVIDER_CURRENCY),
        });
        if (notifyErr) throw new Error(`notify_failed: ${notifyErr.message}`);
        if (inserted != null) {
          await pushToUser(admin, w.user_id, { title, body, url: `/dashboard/viajes/${w.trip_id}` }, PRICE_PUSH_OPTIONS);
          summary.alerts++;
        }
        update.last_alert_at = checkedAt;
        update.last_alert_price_mxn = price;
        update.last_alert_amount_original = amount;
        update.alerts_sent = (w.alerts_sent ?? 0) + (inserted != null ? 1 : 0);
      }

      await admin.from("price_watches").update(update).eq("id", w.id);
    } catch (e) {
      summary.failed++;
      console.error("price-watch-cron: watch failed", w.id, safeErrorMessage(e));
      // Sin esto, una vigilancia que siempre falla se queda al frente de la fila en cada corrida.
      await admin.from("price_watches").update({ last_checked_at: new Date().toISOString() }).eq("id", w.id);
    }
  }

  return json({ ok: true, fx, ...summary });
});
