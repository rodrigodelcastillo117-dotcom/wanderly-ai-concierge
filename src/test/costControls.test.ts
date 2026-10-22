import { describe, it, expect, vi } from "vitest";

const env: Record<string, string> = {};
(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => env[k] } };

import { signInternal, verifyInternal, INTERNAL_HEADER } from "../../supabase/functions/_shared/internalCall";
import { estimateCostUsd, usageFromChat, usageFromClaude, usageRow, SERPAPI_USD_PER_SEARCH } from "../../supabase/functions/_shared/usage";
import { activeLimitDecision, type ActiveDecision } from "../../supabase/functions/_shared/planGate";
import { freePlanDateError, HARD_CAP_ACTIVE_PER_USER, FREE_DAY_OF_FLIGHT_MESSAGE } from "../../supabase/functions/track-flight/rules";
import { freeLimitMessage } from "../../supabase/functions/_shared/quota";
import {
  decideQuote, decorateCachedQuote, quotedAt, quoteKeyParams, refreshAvailableAt,
} from "../../supabase/functions/serpapi-quote/quoteCache";
import { serpLowWarning, SERPAPI_LOW, runChecks } from "../../supabase/functions/health-check/checks";
import { freeLimitCopy, readFunctionError } from "@/lib/functionErrors";
import { priceWatchView } from "@/lib/priceWatchView";

describe("llamada interna firmada (análisis → flights/hotels-search)", () => {
  const secret = "service-role-secreta";
  it("firma y verifica para el mismo usuario", async () => {
    const h = await signInternal(secret, "u1", "analysis", 1_766_000_000_000);
    expect(INTERNAL_HEADER).toBe("x-iatos-internal");
    expect(await verifyInternal(h, secret, "u1", 1_766_000_000_000 + 60_000)).toBe("analysis");
  });
  it("rechaza otro usuario, firma alterada, caducada, sin secreto o un encabezado inventado", async () => {
    const t = 1_766_000_000_000;
    const h = (await signInternal(secret, "u1", "analysis", t))!;
    expect(await verifyInternal(h, secret, "u2", t)).toBeNull();
    expect(await verifyInternal(h.replace(/.$/, (c) => (c === "a" ? "b" : "a")), secret, "u1", t)).toBeNull();
    expect(await verifyInternal(h, secret, "u1", t + 11 * 60_000)).toBeNull();
    expect(await verifyInternal(h, "", "u1", t)).toBeNull();
    expect(await verifyInternal("analysis", secret, "u1", t)).toBeNull();
    expect(await signInternal("", "u1", "analysis")).toBeNull();
  });
});

describe("costo estimado para ai_usage_log", () => {
  it("SerpApi a USD 0.015 por búsqueda", () => {
    expect(SERPAPI_USD_PER_SEARCH).toBe(0.015);
    expect(estimateCostUsd({ function: "flights-search", provider: "serpapi", searches: 2 })).toBe(0.03);
  });
  it("Claude Sonnet 5.5: entrada $2, salida $10, lectura de caché $0.20 por millón", () => {
    const u = usageFromClaude({ model: "claude-sonnet-5-5", usage: { input_tokens: 10_000, output_tokens: 6_000, cache_read_input_tokens: 15_000 } })!;
    expect(u).toMatchObject({ input_tokens: 10_000, output_tokens: 6_000, cache_read_tokens: 15_000, model: "claude-sonnet-5-5" });
    // 10k×2 + 6k×10 + 15k×0.2 = 20,000 + 60,000 + 3,000 = 83,000 / 1e6
    expect(estimateCostUsd({ function: "analizar-viaje", provider: "anthropic", ...u })).toBeCloseTo(0.083, 6);
    const row = usageRow({ function: "analizar-viaje", provider: "anthropic", user_id: "u1", ...u });
    expect(row).toMatchObject({ input_tokens: 25_000, output_tokens: 6_000, searches: 0, cost_estimate_usd: 0.083 });
    expect(Object.keys(row).sort()).toEqual(["cost_estimate_usd", "function", "input_tokens", "model", "output_tokens", "provider", "searches", "user_id"]);
  });
  it("Claude Haiku 5.5: entrada $0.10, salida $0.50, caché $0.01 lectura / $0.125 escritura", () => {
    // 8k entrada + 600 salida + 5k leídos + 5k escritos = 0.0008 + 0.0003 + 0.00005 + 0.000625
    expect(estimateCostUsd({ function: "concierge-chat", provider: "anthropic", model: "claude-haiku-5-5", input_tokens: 8_000, output_tokens: 600, cache_read_tokens: 5_000, cache_write_tokens: 5_000 })).toBeCloseTo(0.001775, 6);
  });
  it("Gemini (estilo OpenAI): el razonamiento cuenta como salida; sin usage no se inventa", () => {
    expect(usageFromChat({ usage: { prompt_tokens: 11_000, completion_tokens: 300, total_tokens: 12_300 } })).toEqual({ input_tokens: 11_000, output_tokens: 1_300 });
    expect(usageFromChat({ choices: [] })).toBeNull();
    expect(estimateCostUsd({ function: "concierge-chat", provider: "gemini", model: "gemini-flash-latest", input_tokens: 1_000_000, output_tokens: 0 })).toBe(0.75);
    expect(estimateCostUsd({ function: "x", provider: "gemini", model: "gemini-2.5-pro", output_tokens: 1_000_000 })).toBe(10);
  });
});

describe("activos a la vez por plan (planLimit + tope de seguridad)", () => {
  it("FREE: 0 alertas de precio → aviso amable de PRO (FREE_LIMIT_REACHED)", () => {
    const d = activeLimitDecision("price_watches", { plan: "free", limit: 0 }, 0, 10) as Extract<ActiveDecision, { kind: "limit" }>;
    expect(d).toMatchObject({ allowed: false, kind: "limit" });
    expect(d.body).toMatchObject({ code: "FREE_LIMIT_REACHED", quota: "price_watches_active", limit: 0, upgrade_available: true, renews_at: null });
    expect(d.body.message).toMatch(/^Las alertas de precio están incluidas en IATOS PRO\./);
  });
  it("prueba: 2 alertas; la tercera se niega con oferta de PRO", () => {
    expect(activeLimitDecision("price_watches", { plan: "trial", limit: 2 }, 1, 10)).toEqual({ allowed: true, limit: 2 });
    const d = activeLimitDecision("price_watches", { plan: "trial", limit: 2 }, 2, 10);
    expect(d.allowed === false && d.kind === "limit" && d.body.message).toMatch(/Ya tienes 2 alertas de precio activas/);
  });
  it("PRO sin pro_limits_enforced (limit null) → solo el tope de seguridad; PRO con límite → sin oferta de mejorar", () => {
    expect(activeLimitDecision("tracked_flights", { plan: "pro", limit: null }, 9, HARD_CAP_ACTIVE_PER_USER)).toEqual({ allowed: true, limit: 10 });
    expect(activeLimitDecision("tracked_flights", { plan: "pro", limit: null }, 10, HARD_CAP_ACTIVE_PER_USER).allowed).toBe(false);
    const d = activeLimitDecision("tracked_flights", { plan: "pro", limit: 4 }, 4, HARD_CAP_ACTIVE_PER_USER);
    expect(d.allowed === false && d.kind === "limit" && d.body).toMatchObject({ upgrade_available: false, limit: 4 });
    // Un límite configurado más alto que el tope de seguridad nunca lo pasa.
    expect(activeLimitDecision("tracked_flights", { plan: "pro", limit: 50 }, 10, 10).allowed).toBe(false);
  });
  it("FREE: 1 vuelo seguido", () => {
    expect(activeLimitDecision("tracked_flights", { plan: "free", limit: 1 }, 0, 10).allowed).toBe(true);
    const d = activeLimitDecision("tracked_flights", { plan: "free", limit: 1 }, 1, 10);
    expect(d.allowed === false && d.kind === "limit" && d.body.message).toMatch(/^Ya sigues 1 vuelo a la vez, el máximo de tu plan\./);
  });
  it("sin plan (la base no respondió): se niega como servicio no disponible, nunca se regala", () => {
    expect(activeLimitDecision("price_watches", null, 0, 10)).toEqual({ allowed: false, kind: "unavailable" });
  });
  it("FREE solo el día del vuelo: hoy o mañana del usuario", () => {
    expect(freePlanDateError("2026-10-22", "2026-10-22")).toBeNull();
    expect(freePlanDateError("2026-10-23", "2026-10-22")).toBeNull();
    expect(freePlanDateError("2026-10-24", "2026-10-22")).toBe(FREE_DAY_OF_FLIGHT_MESSAGE);
    expect(freePlanDateError("2026-10-21", "2026-10-22")).toBe(FREE_DAY_OF_FLIGHT_MESSAGE);
    expect(FREE_DAY_OF_FLIGHT_MESSAGE).toMatch(/hoy o de mañana/);
  });
});

describe("avisos de los nuevos límites: mismo texto en cliente y servidor", () => {
  const quotas = ["price_watches_active", "tracked_flights_active", "live_searches_daily", "live_searches_monthly", "live_searches_trial"] as const;
  it("coinciden para cada límite, con y sin oferta de PRO", () => {
    for (const quota of quotas) {
      for (const upgradeAvailable of [true, false]) {
        for (const limit of [0, 1, 5]) {
          const renewsAt = quota.endsWith("_daily") || quota.endsWith("_monthly") ? "2026-10-23T00:00:00Z" : null;
          expect(freeLimitCopy({ quota, limit, used: limit, renewsAt, upgradeAvailable })).toBe(freeLimitMessage(quota, renewsAt, upgradeAvailable, limit));
        }
      }
    }
  });
  it("sin frases prohibidas ni renovación prometida en límites de activos", () => {
    for (const quota of quotas) {
      const t = freeLimitCopy({ quota, limit: 2, used: 2, renewsAt: null, upgradeAvailable: true });
      expect(t).not.toMatch(/ilimitad|24\/7|con tarjeta|se requiere (una )?tarjeta|renueva automáticamente/i);
      if (quota.endsWith("_active")) expect(t).not.toMatch(/se renuev/);
    }
  });
  it("el 402 de búsquedas en vivo abre el diálogo con su propio texto (no el del análisis)", async () => {
    const res = new Response(JSON.stringify({ code: "FREE_LIMIT_REACHED", quota: "live_searches_daily", limit: 5, used: 5, renews_at: "2026-10-23T00:00:00Z", upgrade_available: true }), { status: 402 });
    const info = await readFunctionError({ context: res }, "x");
    expect(info.freeLimit?.quota).toBe("live_searches_daily");
    expect(info.message).toMatch(/^Usaste tus 5 búsquedas en vivo de hoy \(vuelos y hoteles\); se renuevan el 23 de octubre de 2026\./);
  });
});

describe("cotización en vivo guardada por viaje (serpapi-quote, 24 h)", () => {
  const T0 = Date.parse("2026-10-22T10:00:00Z");
  const row = (savedAt: string, quoteAt = savedAt) => ({ fetched_at: savedAt, response: { total_mxn: 50000, source: "serpapi", fetched_at: quoteAt } });

  it("al abrir el viaje: sin cotización → en vivo; con una de hoy → la guardada (no gasta búsquedas)", () => {
    expect(decideQuote(null, false, T0)).toEqual({ action: "live" });
    expect(decideQuote(row("2026-10-22T08:00:00Z"), false, T0)).toEqual({ action: "serve", fresh: true, refreshBlocked: false });
  });
  it("con una de hace más de 24 h: se muestra como precio guardado (OBSOLETO) y solo se actualiza si el usuario lo pide", () => {
    const old = row("2026-10-20T08:00:00Z");
    expect(decideQuote(old, false, T0)).toEqual({ action: "serve", fresh: false, refreshBlocked: false });
    expect(decorateCachedQuote(old, T0)).toMatchObject({ estado_dato: "OBSOLETO", precio_guardado: true, can_refresh: true, cached: true, fetched_at: "2026-10-20T08:00:00Z" });
    expect(decideQuote(old, true, T0)).toEqual({ action: "live" });
  });
  it("'Actualizar precio' antes de 24 h no vuelve a consultar", () => {
    const fresh = row("2026-10-22T08:00:00Z");
    expect(decideQuote(fresh, true, T0)).toEqual({ action: "serve", fresh: true, refreshBlocked: true });
    expect(refreshAvailableAt(fresh)).toBe("2026-10-23T08:00:00.000Z");
  });
  it("la frescura se mide con la consulta real de los precios, no con la hora en que se guardó", () => {
    // Precios de la caché compartida de hace 20 h guardados como cotización hace 1 h.
    const r = row("2026-10-22T09:00:00Z", "2026-10-21T14:00:00Z");
    expect(quotedAt(r)).toBe("2026-10-21T14:00:00Z");
    expect(decideQuote(r, false, T0 + 5 * 3600_000)).toMatchObject({ fresh: false });
    expect(decorateCachedQuote(r, T0)).toMatchObject({ estado_dato: "CONSULTADO_EN_VIVO", fetched_at: "2026-10-21T14:00:00Z" });
  });
  it("la llave depende del viaje y de los datos con que se cotiza", () => {
    expect(quoteKeyParams("t1", { origin: "CDMX", destination: "Roma", depart: "2026-11-10", return_date: "2026-11-20", nights: 10, travelers: 2 }))
      .toEqual({ trip_id: "t1", origin: "CDMX", destination: "Roma", depart: "2026-11-10", return_date: "2026-11-20", nights: 10, travelers: 2 });
  });
});

describe("aviso de SerpApi por ritmo de gasto (health-check)", () => {
  it("con historial: avisa si al promedio de 7 días alcanza para menos de 7 días", () => {
    expect(serpLowWarning(1000, 200)).toEqual({ warn: true, detail: "1,000 búsquedas disponibles · ~200 al día (promedio de 7 días) · alcanzan para ~5 días" });
    expect(serpLowWarning(1000, 50).warn).toBe(false);
    expect(serpLowWarning(100, 150).detail).toMatch(/se acaban hoy/);
  });
  it("sin historial: umbral fijo de respaldo", () => {
    expect(serpLowWarning(SERPAPI_LOW - 1, null).warn).toBe(true);
    expect(serpLowWarning(SERPAPI_LOW + 1, undefined).warn).toBe(false);
    expect(serpLowWarning(SERPAPI_LOW + 1, 0).warn).toBe(false);
  });
  it("runChecks usa el ritmo (5,000 restantes a 1,000 al día → aviso aunque pase el umbral fijo)", async () => {
    const f = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("serpapi") ? { total_searches_left: 5000 } : { livemode: true }), { status: 200 })) as unknown as typeof fetch;
    const r = await runChecks({ serpKey: "s", serpPerDay: 1000 }, f);
    expect(r.find((x) => x.name.includes("SerpApi"))?.warn).toMatch(/alcanzan para ~5 días/);
  });
});

describe("tarjeta de alerta de precio: compara en la moneda del proveedor", () => {
  const watch = {
    baseline_price_mxn: 10250, baseline_source: "travelpayouts", baseline_currency: "USD",
    baseline_amount_original: 500, last_amount_original: 500, last_price_mxn: 9450, lowest_price_mxn: 9450,
  };
  it("misma tarifa en dólares con otro tipo de cambio: no hay baja", () => {
    const v = priceWatchView(watch, []);
    expect(v).toMatchObject({ sameCurrency: true, deltaMxn: 0, baselineMxn: 9450, currentMxn: 9450, lowestMxn: 9450, currency: "USD" });
  });
  it("baja real de la tarifa: se mide en dólares y se muestra al tipo de cambio de hoy", () => {
    const checks = [
      { price_mxn: 10250, amount_original: 500, currency: "USD", source: "travelpayouts", approximate_dates: false },
      { price_mxn: 8600, amount_original: 455, currency: "USD", source: "travelpayouts", approximate_dates: false },
      { price_mxn: 8505, amount_original: 450, currency: "USD", source: "travelpayouts", approximate_dates: false },
    ];
    const v = priceWatchView({ ...watch, last_amount_original: 450, last_price_mxn: 8505 }, checks);
    // fx de hoy = 8505 / 450 = 18.9 → base 500 × 18.9 = 9450; baja = 50 × 18.9 = 945.
    expect(v).toMatchObject({ baselineMxn: 9450, currentMxn: 8505, deltaMxn: -945, lowestMxn: 8505 });
    expect(v.points).toEqual([500, 455, 450]);
  });
  it("alerta vieja sin monto original: pesos guardados como antes", () => {
    const v = priceWatchView({ baseline_price_mxn: 21000, last_price_mxn: 18500, lowest_price_mxn: 18500, baseline_source: "travelpayouts" }, []);
    expect(v).toMatchObject({ sameCurrency: false, deltaMxn: -2500, baselineMxn: 21000 });
  });
});
