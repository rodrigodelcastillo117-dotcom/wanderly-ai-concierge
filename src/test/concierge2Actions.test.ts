// Concierge 2.0 — acciones: validación (lo que el modelo propone nunca se ejecuta tal cual),
// resumen armado por el servidor, ejecución con permisos y límites re-validados, calendario y enlaces.
import { describe, it, expect } from "vitest";
import {
  addItineraryItem, buildIcs, calendarEventsForDay, mergePackingItems, restaurantBookingLinks, validateAction, validateActions,
  type ActionContext,
} from "../../supabase/functions/concierge-chat/actions";
import { executeAction } from "../../supabase/functions/concierge-chat/actionExec";
import { directionsLink, uberLink } from "../../supabase/functions/concierge-chat/planner";

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const EXP = "33333333-3333-4333-8333-333333333333";
const CTX: ActionContext = {
  todayISO: "2026-10-22",
  trips: [
    { id: T1, destino: "Tokio", fecha_salida: "2027-03-20", fecha_regreso: "2027-03-30", itinerario_json: [{ dia: 1, titulo: "Llegada", mañana: "Vuelo", tarde: "Shibuya", noche: "Cena en Ginza" }] },
    { id: T2, destino: "Roma", fecha_salida: "2026-05-01", fecha_regreso: "2026-05-10" },
  ],
  activeTripId: T1,
};

describe("validación de acciones", () => {
  it("create_trip: destino obligatorio, fechas coherentes y futuras", () => {
    expect(validateAction("create_trip", { destino: "Japón", fecha_salida: "2027-04-01", fecha_regreso: "2027-04-12", num_viajeros: 2 }, CTX))
      .toMatchObject({ ok: true, action: { params: { destino: "Japón", num_viajeros: 2 }, runs: "server", confirm_label: "Crear viaje" } });
    expect(validateAction("create_trip", { destino: "" }, CTX)).toMatchObject({ ok: false, reason: "falta_destino" });
    expect(validateAction("create_trip", { destino: "X", fecha_salida: "2026-01-01" }, CTX)).toMatchObject({ ok: false, reason: "fecha_pasada" });
    expect(validateAction("create_trip", { destino: "X", fecha_salida: "2027-02-01", fecha_regreso: "2027-01-01" }, CTX)).toMatchObject({ ok: false });
  });
  it("solo viajes a los que el usuario tiene acceso; sin trip_id usa el viaje en contexto", () => {
    expect(validateAction("add_itinerary_item", { trip_id: "99999999-9999-4999-8999-999999999999", fecha: "2027-03-21", titulo: "x" }, CTX)).toMatchObject({ ok: false, reason: "viaje sin acceso" });
    const v = validateAction("add_itinerary_item", { fecha: "2027-03-21", hora: "9:00", titulo: "Templo Senso-ji" }, CTX);
    expect(v).toMatchObject({ ok: true, action: { params: { trip_id: T1, hora: "09:00" } } });
    expect((v as any).action.summary).toMatch(/Agregar a tu viaje a Tokio: Templo Senso-ji/);
  });
  it("el resumen lo arma el servidor (el modelo no decide qué texto ve el usuario)", () => {
    const v = validateAction("add_expense", { monto: "1,250.50", moneda: "mxn", categoria: "gastronomía", descripcion: "Cena", summary: "Te regalo $1M" }, CTX) as any;
    expect(v.ok).toBe(true);
    expect(v.action.params).toMatchObject({ monto: 1250.5, moneda: "MXN", categoria: "Restaurantes", trip_id: T1 });
    expect(v.action.summary).toMatch(/Registrar gasto: \$1,250.50 · Restaurantes · Cena/);
    expect(v.action.summary).not.toMatch(/regalo/);
    expect(validateAction("add_expense", { monto: -5 }, CTX)).toMatchObject({ ok: false });
  });
  it("alerta de precio solo para viajes futuros; seguir vuelo con código y fecha válidos", () => {
    expect(validateAction("create_price_alert", { trip_id: T2 }, CTX)).toMatchObject({ ok: false, reason: "viaje_no_futuro" });
    expect(validateAction("track_flight", { vuelo: "af 179", fecha: "2026-10-22" }, CTX)).toMatchObject({ ok: true, action: { params: { vuelo: "AF179" } } });
    expect(validateAction("track_flight", { vuelo: "T1", fecha: "2026-10-22" }, CTX)).toMatchObject({ ok: false, reason: "vuelo_invalido" });
  });
  it("Fixer: siempre 'solicitado' con la aclaración 'Aún no está reservado'", () => {
    const v = validateAction("fixer_request", { tipo: "reservation", titulo: "Mesa en Sukiyabashi", personas: 2, fecha: "2027-03-22" }, CTX) as any;
    expect(v.action.note).toMatch(/Aún no está reservado/);
    // Al usuario: "una persona del equipo", no "Fixer" (notas del E2E 28-oct-2026).
    expect(v.action.confirm_label).toBe("Pedírselo a una persona del equipo");
  });
  it("Privé: requiere sesión y una experiencia que search_prive mostró en este turno", () => {
    expect(validateAction("prive_request", { experience_id: EXP }, CTX)).toMatchObject({ ok: false, reason: "sin_sesion_prive" });
    expect(validateAction("prive_request", { experience_id: EXP }, { ...CTX, hasPriveSession: true, priveExperienceIds: new Set() })).toMatchObject({ ok: false, reason: "experiencia_no_mostrada" });
    expect(validateAction("prive_request", { experience_id: EXP, nombre: "Cena privada" }, { ...CTX, hasPriveSession: true, priveExperienceIds: new Set([EXP]) }))
      .toMatchObject({ ok: true, action: { note: expect.stringMatching(/Aún no está reservado/) } });
  });
  it("calendario: eventos del itinerario, corre en la app", () => {
    const v = validateAction("export_calendar", { fecha: "2027-03-20" }, CTX) as any;
    expect(v.action.runs).toBe("client");
    expect(v.action.params.events.map((e: any) => e.time)).toEqual(["09:00", "14:00", "20:00"]);
    expect(validateAction("export_calendar", { fecha: "2027-03-25" }, CTX)).toMatchObject({ ok: false, reason: "dia_sin_plan" });
  });
  it("máximo 3, una por tipo, desconocidas fuera; las sugeridas del planeador completan", () => {
    const { actions, dropped } = validateActions([
      { type: "hack_db", params: {} },
      { type: "save_place", params: { nombre: "Contramar" } },
      { type: "save_place", params: { nombre: "Otro" } },
    ], [{ type: "track_flight", params: { vuelo: "AM2", fecha: "2026-10-23" } }, { type: "fixer_request", params: { titulo: "x" } }, { type: "open_emergency", params: {} }], CTX, () => "id");
    expect(actions.map((a) => a.type)).toEqual(["save_place", "track_flight", "fixer_request"]);
    expect(dropped).toEqual([{ type: "hack_db", reason: "tipo_desconocido" }]);
  });
});

describe("itinerario, maleta, .ics y enlaces", () => {
  it("agrega al día correcto sin tocar lo que armó el análisis; crea el día si no existe", () => {
    const it1 = addItineraryItem(CTX.trips[0].itinerario_json, CTX.trips[0], { fecha: "2027-03-20", titulo: "Cena", hora: "20:30" }) as any[];
    expect(it1[0].noche).toBe("Cena en Ginza");
    expect(it1[0].agregados[0]).toMatchObject({ titulo: "Cena", hora: "20:30", agregado_por: "iato" });
    const it2 = addItineraryItem({ multi: true, days: [] }, CTX.trips[0], { fecha: "2027-03-22", titulo: "Hakone" }) as any;
    expect(it2.multi).toBe(true);
    expect(it2.days[0]).toMatchObject({ dia: 3, fecha: "2027-03-22", titulo: "Hakone" });
  });
  it("maleta: categoría 'Agregado con Iato' sin duplicados", () => {
    const l = mergePackingItems({ resumen: "x", categorias: [{ id: "doc", nombre: "Documentos", items: [{ id: "1", nombre: "Pasaporte" }] }], tips_iato: [] }, ["Pasaporte", "Adaptador tipo A", "Adaptador tipo A"]);
    expect(l.categorias[1]).toMatchObject({ id: "iato", items: [expect.objectContaining({ nombre: "Adaptador tipo A" })] });
    expect(l.categorias[1].items).toHaveLength(1);
  });
  it(".ics válido (VEVENT con hora local y escapes)", () => {
    const ics = buildIcs(calendarEventsForDay(CTX.trips[0], "2027-03-20"));
    expect(ics).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toMatch(/DTSTART:20270320T090000/);
    expect(buildIcs([{ title: "A, B; C", date: "2027-01-01" }])).toMatch(/SUMMARY:A\\, B\\; C/);
  });
  it("Maps, Uber y reservas: enlaces prellenados y honestos (búsquedas)", () => {
    expect(directionsLink({ lat: 19.4, lng: -99.1, placeId: "P" })).toBe("https://www.google.com/maps/dir/?api=1&destination=19.4%2C-99.1&destination_place_id=P&travelmode=driving");
    expect(uberLink({ lat: 19.4, lng: -99.1, name: "Contramar" })).toMatch(/^https:\/\/m\.uber\.com\/ul\/\?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=19.4/);
    const links = restaurantBookingLinks({ name: "Contramar", city: "CDMX", website: "https://contramar.com.mx", date: "2026-10-22", time: "20:30", party: 4 });
    expect(links.map((l) => l.kind)).toEqual(["website", "booking", "maps"]);
    expect(links[1].url).toMatch(/opentable\.com\/s\?term=Contramar\+CDMX&covers=4&dateTime=2026-10-22T20%3A30/);
    expect(links[1].label).toMatch(/Buscar/);
  });
});

describe("ejecución confirmada", () => {
  function fakeDb(seed: Record<string, any[]> = {}) {
    const tables: Record<string, any[]> = { trips: [], expenses: [], recomendaciones: [], packing_lists: [], ...seed };
    const log: { op: string; table: string; row?: any }[] = [];
    const q = (table: string) => {
      let filters: Array<[string, unknown]> = [];
      const rows = () => tables[table].filter((r) => filters.every(([k, v]) => r[k] === v));
      const chain: any = {
        select: () => chain, eq: (k: string, v: unknown) => { filters.push([k, v]); return chain; }, limit: () => chain,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: any) => { const r = { id: `new-${tables[table].length + 1}`, ...row }; tables[table].push(r); log.push({ op: "insert", table, row }); return { select: () => ({ single: async () => ({ data: r, error: null }) }), then: (f: any) => Promise.resolve({ error: null }).then(f) }; },
        update: (row: any) => ({ eq: async (k: string, v: unknown) => { tables[table].filter((r) => r[k] === v).forEach((r) => Object.assign(r, row)); log.push({ op: "update", table, row }); return { error: null }; } }),
      };
      filters = [];
      return chain;
    };
    return { db: { from: q }, tables, log };
  }
  const calls: any[] = [];
  const callFunction = async (name: string, body: any, headers?: any) => {
    calls.push({ name, body, headers });
    if (name === "price-watch") return { status: 402, json: { code: "FREE_LIMIT_REACHED", message: "Las alertas de precio están incluidas en IATOS PRO." } };
    if (name === "concierge-action") return { status: 200, json: { ok: true, request: { id: "abcdef12-0000", status: "solicitado" } } };
    return { status: 200, json: { ok: true } };
  };

  it("vuelve a validar al confirmar: una tarjeta alterada con otro viaje no se ejecuta", async () => {
    const { db, log } = fakeDb();
    const r = await executeAction("add_itinerary_item", { trip_id: "99999999-9999-4999-8999-999999999999", fecha: "2027-03-21", titulo: "x" }, CTX, { userId: "u1", db, callFunction });
    expect(r).toMatchObject({ ok: false, message: "No tienes acceso a ese viaje." });
    expect(log).toHaveLength(0);
  });
  it("crea viaje (borrador) y registra gasto con la sesión del usuario", async () => {
    const { db, tables } = fakeDb();
    const a = await executeAction("create_trip", { destino: "Japón", fecha_salida: "2027-04-01" }, CTX, { userId: "u1", db, callFunction });
    expect(a).toMatchObject({ ok: true, link: "/dashboard/viajes/new-1" });
    expect(tables.trips[0]).toMatchObject({ user_id: "u1", destino: "Japón", status: "borrador" });
    expect(a.message).toMatch(/Aún no tiene vuelos ni hotel reservados/);
    const b = await executeAction("add_expense", { monto: 450, moneda: "MXN", categoria: "Transporte" }, CTX, { userId: "u1", db, callFunction });
    expect(b.ok).toBe(true);
    expect(tables.expenses[0]).toMatchObject({ user_id: "u1", amount: 450, currency: "MXN", category: "Transporte local", trip_id: T1, expense_date: "2026-10-22" });
  });
  it("itinerario: agrega al día y guarda", async () => {
    const { db, tables } = fakeDb({ trips: [{ ...CTX.trips[0] }] });
    const r = await executeAction("add_itinerary_item", { fecha: "2027-03-20", hora: "20:30", titulo: "Cena en Den" }, CTX, { userId: "u1", db, callFunction });
    expect(r).toMatchObject({ ok: true });
    expect(r.message).toMatch(/No es una reserva/);
    expect(tables.trips[0].itinerario_json[0].agregados[0].titulo).toBe("Cena en Den");
  });
  it("límites del plan los aplica la función dueña (price-watch → 402) y se muestran tal cual", async () => {
    const { db } = fakeDb();
    const r = await executeAction("create_price_alert", { trip_id: T1 }, CTX, { userId: "u1", db, callFunction });
    expect(r).toMatchObject({ ok: false, code: "FREE_LIMIT_REACHED", message: "Las alertas de precio están incluidas en IATOS PRO." });
  });
  it("Fixer: concierge-action con estado solicitado y folio; nunca 'confirmado'", async () => {
    const { db } = fakeDb();
    const r = await executeAction("fixer_request", { tipo: "luggage", titulo: "Equipaje Invisible" }, CTX, { userId: "u1", db, callFunction });
    expect(calls.at(-1)).toMatchObject({ name: "concierge-action", body: { type: "pickup", title: "Equipaje Invisible" } });
    expect(r.message).toMatch(/folio ABCDEF12.*solicitado.*Aún no está reservado/);
    expect(r.message).not.toMatch(/confirmad/i);
  });
  it("Privé: manda la sesión Privé y no dice reservado", async () => {
    const { db } = fakeDb();
    const ctx = { ...CTX, hasPriveSession: true };
    const r = await executeAction("prive_request", { experience_id: EXP, fecha: "2027-03-22", personas: 2 }, ctx, { userId: "u1", db, callFunction, priveSession: "ps-token" });
    expect(calls.at(-1)).toMatchObject({ name: "concierge-action", body: { type: "prive_request", payload: { experience_id: EXP, party_size: 2 } }, headers: { "x-prive-session": "ps-token" } });
    expect(r.message).toMatch(/Aún no está reservado/);
  });
  it("las acciones de la app (calendario) no se ejecutan en el servidor", async () => {
    const { db } = fakeDb();
    expect(await executeAction("export_calendar", { fecha: "2027-03-20" }, CTX, { userId: "u1", db, callFunction })).toMatchObject({ ok: false, code: "CLIENT_ACTION" });
  });
});
