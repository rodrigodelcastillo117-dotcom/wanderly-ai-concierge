import { describe, it, expect, beforeEach } from "vitest";
import { deriveTripBookingState, itemBookingState, isConfirmedBooking, bookingsByTrip } from "@/lib/bookingState";
import { restoreSelections, serializeSelections, sameSelections, itemKey } from "@/lib/tripSelections";
import { computeTripDesglose, quoteStaleness, staleQuoteMessage } from "@/lib/quote";
import { tripTotals } from "@/components/RealTripTotal";
import { computeSplit, parseSplitAmount, hasPayments } from "@/lib/split";
import { withTripParam, readTripParam } from "@/lib/tripLink";
import { readFileSync } from "node:fs";
import { buildDocPath, canDeleteDoc, validateDocFile, TRIP_DOC_MAX_BYTES, TRIP_DOC_MIME } from "@/lib/tripDocuments";
import { restoreConversation, loadConversation } from "@/lib/conciergeHistory";
import { converterRateLabel, providerUpdatedAt } from "@/lib/fx";
import { currenciesUsed, readMoney, toMxn } from "../../supabase/functions/parse-trip-file/money.ts";
import { buildLogisticsSnapshot, logisticsReferences } from "../../supabase/functions/logistics-plan/snapshot.ts";
import { tripBookingContext, tripListBookingState, BOOKING_STATE_RULE, computeTripGaps } from "../../supabase/functions/concierge-chat/context.ts";

const TRIP = "11111111-1111-4111-8111-111111111111";

// ───── Reservado vs. cotizado ─────
describe("estado reservado/cotizado derivado de bookings", () => {
  const trip = {
    id: TRIP, total_estimado: 90000,
    vuelos_json: [{ aerolinea: "Aeroméxico", numero_vuelo: "AM 21" }, { aerolinea: "Iberia", numero_vuelo: "IB6400" }],
    hospedaje_json: [{ nombre: "Hotel Indigo" }],
  };
  it("sin reservas confirmadas es 'cotizado' (un clic pending no es reserva)", () => {
    const s = deriveTripBookingState(trip, [{ trip_id: TRIP, category: "flight", status: "pending", title: "MEX → MAD" }]);
    expect(s.estado).toBe("cotizado");
    expect(s.label).toBe("Cotizado · sin reservar");
    expect(s.por_tipo).toEqual({ vuelo: "cotizado", hospedaje: "cotizado" });
    expect(s.clics_sin_confirmar).toBe(1);
  });
  it("vuelo y hotel confirmados → 'reservado'; solo el vuelo → 'parcialmente_reservado'", () => {
    const flight = { trip_id: TRIP, category: "flight", status: "confirmed", title: "Aeroméxico AM21 MEX-MAD" };
    const hotel = { trip_id: TRIP, category: "hotel", status: "pending", confirmation_code: "HX9", title: "Hotel Indigo Gran Vía" };
    expect(deriveTripBookingState(trip, [flight]).estado).toBe("parcialmente_reservado");
    expect(deriveTripBookingState(trip, [flight, hotel]).estado).toBe("reservado");
  });
  it("por elemento: solo el vuelo nombrado queda reservado", () => {
    const confirmed = [{ category: "flight", status: "confirmed", title: "Aeroméxico AM21" }];
    expect(itemBookingState("vuelo", trip.vuelos_json[0], trip.vuelos_json, confirmed)).toBe("reservado");
    expect(itemBookingState("vuelo", trip.vuelos_json[1], trip.vuelos_json, confirmed)).toBe("cotizado");
    expect(itemBookingState("vuelo", { aerolinea: "Volaris", desde_pdf: true }, [{}, {}], [])).toBe("segun_tu_archivo");
  });
  it("viaje sin nada es borrador; reservas de otro viaje no cuentan", () => {
    expect(deriveTripBookingState({ id: TRIP }, []).estado).toBe("sin_cotizacion");
    expect(deriveTripBookingState(trip, [{ trip_id: "otro", category: "flight", status: "confirmed" }]).estado).toBe("cotizado");
  });
  it("isConfirmedBooking y bookingsByTrip", () => {
    expect(isConfirmedBooking({ status: "pending" })).toBe(false);
    expect(isConfirmedBooking({ status: "pending", partner_reference: "R1" })).toBe(true);
    expect([...bookingsByTrip([{ trip_id: "a" }, { trip_id: null }, { trip_id: "a" }]).entries()]).toEqual([["a", [{ trip_id: "a" }, { trip_id: "a" }]]]);
  });
  it("Iato recibe el estado por elemento y la regla para no decir 'tu vuelo' de una cotización", () => {
    const ctx = tripBookingContext(trip, [
      { trip_id: TRIP, category: "flight", status: "confirmed", title: "Iberia IB6400" },
      { trip_id: TRIP, category: "insurance", status: "pending", title: "Seguro" },
    ]);
    expect((ctx.vuelos as any[]).map((v) => v.estado_reserva)).toEqual(["cotizado", "reservado"]);
    expect((ctx.hospedaje as any[])[0].estado_reserva).toBe("cotizado");
    expect(ctx.reservas_confirmadas_bookings).toHaveLength(1);
    expect(ctx.clics_a_socios_sin_confirmar).toBe(1);
    expect(ctx.estado_reservas.estado).toBe("parcialmente_reservado");
    expect(BOOKING_STATE_RULE).toMatch(/nunca 'tu vuelo'/);
    expect(tripListBookingState(trip, [])).toBe("Cotizado · sin reservar");
  });
  it("un clic a un seguro no apaga el aviso 'Sin seguro' (solo cuentan las confirmadas)", () => {
    const ctx = tripBookingContext(trip, [{ trip_id: TRIP, category: "insurance", status: "pending", title: "Seguro de viaje" }]);
    const gaps = computeTripGaps(trip, ctx.reservas_confirmadas_bookings, "2026-10-22");
    expect(gaps.map((g) => g.id)).toContain("seguro");
  });
});

// ───── E-12: selecciones ─────
describe("selecciones de TripDetail (E-12)", () => {
  const trip = {
    vuelos_json: [{ aerolinea: "Aeroméxico", precio_por_persona: 12000 }, { aerolinea: "Iberia", precio_por_persona: 9000 }],
    hospedaje_json: [{ nombre: "Indigo", precio_por_noche: 3000 }, { nombre: "Ritz", precio_por_noche: 9000 }],
    tours_json: [{ nombre: "Prado", precio_por_persona: 500 }, { nombre: "Toledo", precio_por_persona: 1500 }],
    desglose_presupuesto: { vuelos: 24000, hospedaje: 15000, comida: 5000, tours: 0, transporte_local: 0, extras: 0 },
  };
  it("todo por defecto se guarda como null", () => {
    expect(serializeSelections(trip, { selVuelo: -1, selHospedaje: -1, nochesHospedaje: null, selTours: new Set() })).toBeNull();
  });
  it("guarda y restaura vuelo, hotel, noches y tours", () => {
    const saved = serializeSelections(trip, { selVuelo: 1, selHospedaje: -2, nochesHospedaje: 3, selTours: new Set([1]) });
    const back = restoreSelections(trip, JSON.parse(JSON.stringify(saved)));
    expect(back.selVuelo).toBe(1);
    expect(back.selHospedaje).toBe(-2);
    expect(back.nochesHospedaje).toBe(3);
    expect([...back.selTours]).toEqual([1]);
  });
  it("si las opciones cambiaron (re-análisis) no apunta a otra opción: la busca por llave o la descarta", () => {
    const saved = serializeSelections(trip, { selVuelo: 1, selHospedaje: 0, nochesHospedaje: null, selTours: new Set([0]) });
    const reordered = { ...trip, vuelos_json: [trip.vuelos_json[1], trip.vuelos_json[0]], hospedaje_json: [{ nombre: "Otro", precio_por_noche: 1 }], tours_json: [] };
    const back = restoreSelections(reordered, saved);
    expect(back.selVuelo).toBe(0);
    expect(back.selHospedaje).toBe(-1);
    expect(back.selTours.size).toBe(0);
    expect(itemKey(null)).toBe("");
  });
  // Pedido del dueño (E2E 28-oct-2026): antes esta prueba exigía que la selección marcara la cotización.
  it("cambiar la selección NO marca la cotización para actualizar (viajeros/fechas sí)", () => {
    const base = { num_viajeros: 2, fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15", quote_basis: { num_viajeros: 2, fecha_salida: "2026-11-10", fecha_regreso: "2026-11-15" } };
    expect(quoteStaleness({ ...base, selections: null }, null)).toMatchObject({ stale: false, reasons: [] });
    const sel = serializeSelections(trip, { selVuelo: 1, selHospedaje: -1, nochesHospedaje: null, selTours: new Set() });
    const s = quoteStaleness({ ...base, selections: sel }, null);
    expect(s).toMatchObject({ stale: false, reasons: [] });
    const v = quoteStaleness({ ...base, selections: sel, num_viajeros: 3 }, null);
    expect(v).toMatchObject({ stale: true, reasons: ["viajeros"] });
    expect(staleQuoteMessage(v.basis!, v.reasons)).toMatch(/^Cambiaste el número de viajeros\. Cotización para 2 viajeros/);
    expect(quoteStaleness({ ...base, selections: sel, quote_basis: { ...base.quote_basis, selections: sel } }, null).stale).toBe(false);
    expect(sameSelections(sel, JSON.parse(JSON.stringify(sel)))).toBe(true);
  });
  it("tripTotals recalcula el total con la selección y conserva el de la cotización", () => {
    const sel = { selVuelo: 1, selHospedaje: 1, nochesHospedaje: 2, selTours: new Set([1]) };
    const desglose = computeTripDesglose({ ...trip, total_estimado: 44000 }, sel, 2);
    const t = tripTotals({ ...trip, total_estimado: 44000 }, 2, desglose);
    // vuelos 9000×2 + hotel 9000×2 noches×1 hab + comida 5000 + tours 1500×2
    expect(t.total).toBe(18000 + 18000 + 5000 + 3000);
    expect(t.fromSelection).toBe(true);
    expect(t.quotedTotal).toBe(44000);
    expect(tripTotals({ ...trip, total_estimado: 44000 }, 2, null)).toMatchObject({ total: 44000, fromSelection: false });
  });
});

// ───── D-18 TripSplit ─────
describe("gastos compartidos por moneda (D-18)", () => {
  const people = [{ id: "a", name: "Ana" }, { id: "b", name: "Luis" }, { id: "c", name: "Sofía" }];
  it("3 personas, 100 MXN: saldos en centavos que suman 0", () => {
    const r = computeSplit(people, [{ payer_id: "a", amount: 100, currency: "MXN" }]);
    const b = r.balances.MXN;
    expect(Math.round((b.a + b.b + b.c) * 100)).toBe(0);
    expect(r.settlements.every((s) => s.to === "Ana" && s.currency === "MXN")).toBe(true);
    expect(r.settlements.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(66.66, 2);
  });
  it("nunca mezcla monedas: EUR y MXN se saldan por separado", () => {
    const r = computeSplit(people.slice(0, 2), [
      { payer_id: "a", amount: 100, currency: "EUR" },
      { payer_id: "b", amount: 1000, currency: "MXN" },
    ]);
    expect(r.totals).toEqual({ EUR: 100, MXN: 1000 });
    expect(r.settlements).toEqual([
      { from: "Luis", to: "Ana", amount: 50, currency: "EUR" },
      { from: "Ana", to: "Luis", amount: 500, currency: "MXN" },
    ]);
  });
  it("rechaza montos negativos o cero; detecta quién tiene pagos", () => {
    expect(parseSplitAmount("-500")).toBeNull();
    expect(parseSplitAmount("0")).toBeNull();
    expect(parseSplitAmount("12,345")).toBe(12.35);
    expect(computeSplit(people, [{ payer_id: "a", amount: -50 }]).totals).toEqual({});
    expect(hasPayments("a", [{ payer_id: "a", amount: 1 }])).toBe(true);
  });
});

// ───── D-25 conversor y D-08 parse-trip-file ─────
describe("tipo de cambio con fuente y fecha (D-25, D-08)", () => {
  it("el conversor usa la fecha del proveedor, no la del teléfono", () => {
    const d = providerUpdatedAt({ time_last_update_utc: "Wed, 21 Oct 2026 00:02:31 +0000" });
    expect(d?.toISOString()).toBe("2026-10-21T00:02:31.000Z");
    expect(providerUpdatedAt({})).toBeNull();
    expect(converterRateLabel("open.er-api.com", d, false)).toMatch(/^Tipo de cambio de open\.er-api\.com \(actualizado 2\d oct 2026\)$/);
    expect(converterRateLabel("open.er-api.com", null, true)).toMatch(/respaldo.*fecha desconocida/);
  });
  const rates = { USD: { rate: 18.5, source: "frankfurter", fetched_at: "2026-10-21T00:00:00Z", is_fallback: false } };
  it("parse-trip-file convierte en código con fuente y fecha; sin tasa no convierte 1:1", () => {
    expect(toMxn(100, "USD", rates)).toMatchObject({ mxn: 1850, original: { monto: 100, moneda: "USD" }, tipo_cambio: { source: "frankfurter", de: "USD" } });
    expect(toMxn(100, "GBP", rates)).toMatchObject({ mxn: null, sin_convertir: true, original: { moneda: "GBP" } });
    expect(toMxn(2500, "$", rates)).toMatchObject({ mxn: 2500, tipo_cambio: null });
    expect(readMoney({ precio_total_mxn: 9000 }, "precio_total", "USD", rates).mxn).toBe(9000);
    expect(readMoney({ precio_total: 50 }, "precio_total", "USD", rates).mxn).toBe(925);
    expect(currenciesUsed({ moneda_original: "MXN", vuelos: [{ moneda: "usd" }], hoteles: [{ moneda: "EUR" }] }).sort()).toEqual(["EUR", "USD"]);
  });
});

// ───── E-22 herramientas ligadas al viaje ─────
describe("?trip=<id> en las herramientas del viaje (E-22)", () => {
  it("solo se agrega a las herramientas del viaje y solo con un UUID", () => {
    expect(withTripParam("/dashboard/vuelos", TRIP)).toBe(`/dashboard/vuelos?trip=${TRIP}`);
    expect(withTripParam("/dashboard/autos?city=Roma", TRIP)).toBe(`/dashboard/autos?city=Roma&trip=${TRIP}`);
    expect(withTripParam("/dashboard/comparar", TRIP)).toBe("/dashboard/comparar");
    expect(withTripParam("/dashboard/vuelos", "x")).toBe("/dashboard/vuelos");
    expect(readTripParam(`?trip=${TRIP}`)).toBe(TRIP);
    expect(readTripParam("?trip=../../etc")).toBeNull();
  });
});

// ───── Documentos ─────
describe("documentos del viaje: reglas del cliente", () => {
  it("valida tipo y tamaño; arma la ruta {trip_id}/{uuid}-{nombre} sin carpetas", () => {
    expect(validateDocFile({ size: 1000, type: "application/pdf" })).toBeNull();
    expect(validateDocFile({ size: TRIP_DOC_MAX_BYTES + 1, type: "application/pdf" })).toMatch(/10 MB/);
    expect(validateDocFile({ size: 10, type: "application/x-msdownload" })).toMatch(/o un PDF/);
    expect(validateDocFile({ size: 0, type: "image/png" })).toMatch(/vacío/);
    expect(buildDocPath(TRIP, "u1", "../../Boleto Mañana.pdf")).toBe(`${TRIP}/u1-Boleto-Manana.pdf`);
  });
  it("tipos y tamaño iguales en el cliente, el bucket y el CHECK de la tabla (migración)", () => {
    const sql = readFileSync("supabase/migrations/20261022143100_trip_documents.sql", "utf8");
    const bucket = sql.slice(sql.indexOf("INSERT INTO storage.buckets"), sql.indexOf("ON CONFLICT"));
    const check = sql.slice(sql.indexOf("mime         text"), sql.indexOf("size         bigint"));
    const types = (s: string) => [...s.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]).sort();
    expect(types(bucket)).toEqual([...TRIP_DOC_MIME].sort());
    expect(types(check)).toEqual([...TRIP_DOC_MIME].sort());
    expect(bucket).toContain(String(TRIP_DOC_MAX_BYTES));
  });
  it("borra quien lo subió o el dueño del viaje", () => {
    expect(canDeleteDoc({ uploaded_by: "a" }, "a", "o")).toBe(true);
    expect(canDeleteDoc({ uploaded_by: "a" }, "o", "o")).toBe(true);
    expect(canDeleteDoc({ uploaded_by: "a" }, "x", "o")).toBe(false);
    expect(canDeleteDoc({ uploaded_by: "a" }, null, "o")).toBe(false);
  });
});

// ───── E-13 historial y viaje activo con columna faltante ─────
function client(result: { data?: any; error?: any }, calls: any[] = []) {
  const api: any = {
    select: (...a: any[]) => { calls.push(["select", ...a]); return api; },
    eq: (...a: any[]) => { calls.push(["eq", ...a]); return api; },
    is: (...a: any[]) => { calls.push(["is", ...a]); return api; },
    order: () => api, limit: () => api,
    update: (p: any) => { calls.push(["update", p]); return api; },
    maybeSingle: async () => result,
    then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
  };
  return { from: (t: string) => { calls.push(["from", t]); return api; } };
}

describe("historial del concierge (E-13)", () => {
  it("restaura los turnos guardados, los últimos N y sin vacíos", () => {
    const msgs = restoreConversation([
      { role: "user", content: "¿Qué llevo a Roma?", timestamp: "2026-10-20T10:00:00Z" },
      { role: "assistant", content: "Un paraguas." },
      { role: "system", content: "x" },
      { role: "user", content: "  " },
    ]);
    expect(msgs.map((m) => [m.role, m.text])).toEqual([["user", "¿Qué llevo a Roma?"], ["assistant", "Un paraguas."]]);
    expect(msgs[0].id).toBe("hist-0");
    expect(restoreConversation(Array.from({ length: 30 }, (_, i) => ({ role: "user", content: `m${i}` })), 5).map((m) => m.text)).toEqual(["m25", "m26", "m27", "m28", "m29"]);
  });
  it("lee la conversación del viaje activo; sin viaje filtra trip_id null; un error no rompe el chat", async () => {
    const calls: any[] = [];
    await loadConversation(client({ data: { messages: [] } }, calls) as any, "u1", TRIP);
    expect(calls).toContainEqual(["eq", "trip_id", TRIP]);
    const calls2: any[] = [];
    await loadConversation(client({ data: null }, calls2) as any, "u1", null);
    expect(calls2).toContainEqual(["is", "trip_id", null]);
    expect(await loadConversation(client({ error: { message: "boom" } }) as any, "u1", TRIP)).toEqual([]);
  });
});

// ───── Snapshot del plan multi-ciudad ─────
describe("snapshot de logistics-plan en trip_quotes", () => {
  const logistics = {
    total_estimado_mxn: 120000,
    desglose_presupuesto: { vuelos: 50000, hospedaje: 40000, comida: 20000, tours: 6000, transporte_local: 3000, extras: 1000 },
    fx_usd_mxn: 18.4, fx_source: "frankfurter", fx_at: "2026-10-21T00:00:00Z", fx_is_fallback: false,
    nights: 6, rooms: 1, travelers: 2, date_from: "2026-11-01", date_to: "2026-11-07", selected_tier: "equilibrio",
    quoted_at: "2026-10-22T10:00:00Z",
    flights: [{ tier: "equilibrio", fuente_precio: "travelpayouts" }],
    per_destination: [
      { city: "Roma", hospedaje: [{ tier: "equilibrio", fuente_precio: "serpapi" }] },
      { city: "Florencia", hospedaje: [{ tier: "equilibrio", fuente_precio: "serpapi" }] },
    ],
    pricing_sources: { vuelos: "travelpayouts", hospedaje: "serpapi" },
  };
  const trip = { id: TRIP, user_id: "u1", total_estimado: 120000, num_viajeros: 2 };
  it("arma la fila con el plan del servidor (mismo constructor que analizar-viaje)", () => {
    const r = buildLogisticsSnapshot(logistics, trip, "u1", new Date("2026-10-22T11:00:00Z"));
    expect(r.ok).toBe(true);
    const row = (r as any).row;
    expect(row).toMatchObject({ origin: "logistics-plan", trip_id: TRIP, total: 120000, travelers: 2, nights: 6, fx_rate: 18.4, fx_source: "frankfurter", date_from: "2026-11-01" });
    const states = Object.fromEntries(row.line_items.map((l: any) => [l.category, l.state]));
    // Hotel en vivo (SerpApi en todas las ciudades) = COTIZADO; vuelos de caché Travelpayouts = ESTIMADO.
    expect(states.hospedaje).toBe("COTIZADO");
    expect(states.vuelos).toBe("ESTIMADO");
  });
  it("rechaza un viaje ajeno o con otro total, y un plan sin tipo de cambio", () => {
    expect(buildLogisticsSnapshot(logistics, { ...trip, user_id: "x" }, "u1")).toEqual({ ok: false, reason: "trip_not_owned" });
    expect(buildLogisticsSnapshot(logistics, { ...trip, total_estimado: 1 }, "u1")).toEqual({ ok: false, reason: "total_mismatch" });
    expect(buildLogisticsSnapshot({ ...logistics, fx_usd_mxn: 0 }, trip, "u1")).toEqual({ ok: false, reason: "plan_without_fx" });
    expect(buildLogisticsSnapshot(null, trip, "u1")).toEqual({ ok: false, reason: "plan_not_found" });
  });
  it("si una ciudad no tiene hotel en vivo, el hospedaje queda estimado", () => {
    const mixed = { ...logistics, per_destination: [...logistics.per_destination, { city: "Venecia", hospedaje: [{ tier: "equilibrio", fuente_precio: "estimado" }] }] };
    expect(logisticsReferences(mixed).hospedaje.estado_dato).toBe("ESTIMADO");
  });
});
