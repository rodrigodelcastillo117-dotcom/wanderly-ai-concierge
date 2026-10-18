// Re-quotes watched trips' flights and alerts users when the live fare drops.
import { createClient } from "npm:@supabase/supabase-js@2";
import { cheapestFare, type CheapestFare } from "../_shared/travelpayouts.ts";
import { getUsdMxnRate } from "../_shared/fx.ts";
import { pushToUser } from "../_shared/push.ts";
import { isAuthorizedCron } from "../_shared/cron-auth.ts";
import { decide, formatMxn } from "./rules.ts";

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
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);

  // Trips that already departed (or leave tomorrow) are no longer actionable.
  await admin.from("price_watches").update({ active: false }).eq("active", true).lt("departure_date", tomorrow);

  const { data: watches, error } = await admin
    .from("price_watches")
    .select("*, trips(destino)")
    .eq("active", true)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) return json({ error: "query_failed" }, 500);

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
          { travelpayoutsToken: token, serpKey, marker },
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

      const price = Math.round(fare.priceUsd * fx);
      summary.checked++;
      await admin.from("price_watch_checks").insert({
        watch_id: w.id, user_id: w.user_id, price_mxn: price, approximate_dates: fare.approximateDates,
        source: fare.source,
      });

      const decision = decide(
        {
          baselinePrice: Number(w.baseline_price_mxn),
          baselineApproximate: w.baseline_approximate,
          baselineSource: w.baseline_source,
          lastAlertPrice: w.last_alert_price_mxn == null ? null : Number(w.last_alert_price_mxn),
          lastAlertAt: w.last_alert_at,
        },
        { price, approximate: fare.approximateDates, source: fare.source },
        now,
      );

      const update: Record<string, unknown> = { last_checked_at: checkedAt };
      // The card compares "today" with the baseline, so it only shows prices
      // from the baseline's own source and exact dates.
      const comparable = decision.kind === "rebaseline" ||
        (!fare.approximateDates && fare.source === w.baseline_source);
      if (comparable) {
        update.last_price_mxn = price;
        update.booking_link = fare.bookingLink;
        update.lowest_price_mxn = w.lowest_price_mxn == null ? price : Math.min(Number(w.lowest_price_mxn), price);
      }

      if (decision.kind === "rebaseline") {
        update.baseline_price_mxn = price;
        update.baseline_approximate = false;
        update.baseline_source = fare.source;
        update.lowest_price_mxn = price;
        summary.rebaselined++;
      } else if (decision.kind === "alert") {
        const destino = (w.trips as { destino?: string } | null)?.destino ?? "tu destino";
        const totalSaving = decision.dropMxn * (w.adults ?? 1);
        const title = `Bajó tu vuelo a ${destino}`;
        const body = (w.adults ?? 1) > 1
          ? `Ahora ${formatMxn(price)} por persona (antes ${formatMxn(Number(w.baseline_price_mxn))}). Ahorras ${formatMxn(totalSaving)} para ${w.adults} viajeros.`
          : `Ahora ${formatMxn(price)} (antes ${formatMxn(Number(w.baseline_price_mxn))}). Ahorras ${formatMxn(totalSaving)}.`;
        await admin.from("notifications").insert({
          user_id: w.user_id, type: "price_drop", title, body, related_id: w.trip_id,
        });
        await pushToUser(admin, w.user_id, { title, body, url: `/dashboard/viajes/${w.trip_id}` });
        update.last_alert_at = checkedAt;
        update.last_alert_price_mxn = price;
        update.alerts_sent = (w.alerts_sent ?? 0) + 1;
        summary.alerts++;
      }

      await admin.from("price_watches").update(update).eq("id", w.id);
    } catch (e) {
      summary.failed++;
      console.error("price-watch-cron: watch failed", w.id, (e as Error).message);
    }
  }

  return json({ ok: true, fx, ...summary });
});
