// "Ya tengo mi viaje" (lógica): crear un viaje con vuelos y hotel que la persona ya compró NO gasta
// nada (0 SerpApi, 0 logistics-plan, 0 IA; solo una llamada a geocode-address por hotel), el hotel queda
// con coordenadas por ciudad (itinerario_json.bases y hospedaje_json), el total no inventa vuelos ni
// hoteles y las fechas por ciudad se validan.
import { describe, expect, it, vi } from "vitest";
import { expandRegions } from "../../supabase/functions/_shared/regions";
import {
  broughtTripInsert, createBroughtTrip, isBroughtTrip, tripBases, validateBroughtTrip, type BroughtCity, type BroughtTripInput,
} from "@/lib/broughtTrip";
import { computeTripDesglose } from "@/lib/quote";
import { restoreSelections } from "@/lib/tripSelections";
import { buildBuyFlow } from "@/lib/buyFlow";
import { tripTotalSummary } from "@/lib/tripTotal";
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute";
import { nextTripAction } from "@/lib/tripCommand";

const TODAY = "2026-10-27";
// Gasto prohibido: búsquedas de SerpApi (directas o vía funciones), el plan de logística y la IA.
const FORBIDDEN = ["logistics-plan", "serpapi-quote", "flights-search", "hotels-search", "travelpayouts-flights", "price-watch", "booking-bridge",
  "analizar-viaje", "parsear-viaje", "editar-viaje-ai", "concierge-chat", "concierge-action", "ai-tool", "resolver-fechas", "recomendar-destinos", "tripadvisor-search", "viator-search"];

const GEO: Record<string, { lat: number; lng: number; name: string; label: string; place_id: string }> = {
  "Hotel Artemide, Roma": { lat: 41.9009, lng: 12.4943, name: "Hotel Artemide", label: "Via Nazionale, 22, 00184 Roma RM, Italia", place_id: "ChIJ-artemide" },
  "Hotel Brunelleschi, Florencia": { lat: 43.7713, lng: 11.2556, name: "Hotel Brunelleschi", label: "Piazza Santa Elisabetta, 3, 50122 Firenze FI, Italia", place_id: "ChIJ-brunelleschi" },
  "Hotel Danieli, Venecia": { lat: 45.4337, lng: 12.3409, name: "Hotel Danieli", label: "Riva degli Schiavoni, 4196, 30122 Venezia VE, Italia", place_id: "ChIJ-danieli" },
  "Grand Hotel Continental, Siena": { lat: 43.3205, lng: 11.3299, name: "Grand Hotel Continental Siena", label: "Via Banchi di Sopra, 85, 53100 Siena SI, Italia", place_id: "ChIJ-continental" },
};

function fakeClient(opts: { geo?: typeof GEO } = {}) {
  const calls: Array<{ fn: string; body: any }> = [];
  const inserts: Array<{ table: string; row: any }> = [];
  const client = {
    functions: {
      invoke: vi.fn(async (fn: string, { body }: { body: any }) => {
        calls.push({ fn, body });
        if (fn === "geocode-address") {
          const g = (opts.geo ?? GEO)[body.address];
          return g ? { data: g, error: null } : { data: null, error: Object.assign(new Error("No se encontró el lugar"), { context: { status: 404 } }) };
        }
        return { data: { ok: true }, error: null };
      }),
    },
    from: vi.fn((table: string) => ({
      insert: (row: any) => {
        inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "trip-traido-1" }, error: null }) }) };
      },
    })),
  };
  return { client, calls, inserts };
}

/** Roma, Florencia, Venecia, Toscana → Roma, Florencia, Venecia, Siena, Lucca (bases de la tabla curada). */
function italia(): { cities: BroughtCity[]; expansions: ReturnType<typeof expandRegions>["expansions"] } {
  const r = expandRegions(["Roma", "Florencia", "Venecia", "Toscana"]);
  const fechas: Array<[string, string]> = [["2027-05-01", "2027-05-04"], ["2027-05-04", "2027-05-06"], ["2027-05-06", "2027-05-08"], ["2027-05-08", "2027-05-10"], ["2027-05-10", "2027-05-12"]];
  const hoteles = ["Hotel Artemide", "Hotel Brunelleschi", "Hotel Danieli", "Grand Hotel Continental", ""];
  return { cities: r.destinations.map((ciudad, i) => ({ ciudad, llegada: fechas[i][0], salida: fechas[i][1], hotel: hoteles[i] || null })), expansions: r.expansions };
}

const input = (over: Partial<BroughtTripInput> = {}): BroughtTripInput => {
  const it = italia();
  return { userId: "u1", cities: it.cities, expansions: it.expansions, personas: 2, origin: "Ciudad de México", flights: [{ numero: "am 17", fecha: "2027-04-30" }], today: TODAY, ...over };
};

describe("crear 'Ya tengo mi viaje' sin gastar", () => {
  it("Roma, Florencia, Venecia y Toscana (con sus bases): 0 SerpApi, 0 logistics-plan, 0 IA; solo geocode-address por hotel", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { client, calls, inserts } = fakeClient();
    const r = await createBroughtTrip(client, input());
    expect(r.ok).toBe(true);
    expect(italia().cities.map((c) => c.ciudad)).toEqual(["Roma", "Florencia", "Venecia", "Siena", "Lucca"]);
    expect(calls.map((c) => c.fn)).toEqual(["geocode-address", "geocode-address", "geocode-address", "geocode-address"]);
    expect(calls.some((c) => FORBIDDEN.includes(c.fn))).toBe(false);
    expect(calls.map((c) => c.body.address)).toEqual(["Hotel Artemide, Roma", "Hotel Brunelleschi, Florencia", "Hotel Danieli, Venecia", "Grand Hotel Continental, Siena"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("trips");
    const row = inserts[0].row;
    expect(row.destino).toBe("Roma → Florencia → Venecia → Siena → Lucca");
    expect(row.pais_destino).toBe("Italia");
    expect(row.fecha_salida).toBe("2027-05-01");
    expect(row.fecha_regreso).toBe("2027-05-12");
    expect(row.num_viajeros).toBe(2);
    expect(row.itinerario_json.traido).toBe(true);
    expect(row.itinerario_json.region_expansions).toEqual([{ region: "Toscana", ciudades: ["Siena", "Lucca"] }]);
    fetchSpy.mockRestore();
  });

  it("reintentar con los hoteles ya ubicados no vuelve a llamar a Google; un hotel que Google no encuentra no se guarda inventado", async () => {
    const { client, calls, inserts } = fakeClient({ geo: { ...GEO, "Grand Hotel Continental, Siena": undefined as any } });
    const first = await createBroughtTrip(client, input());
    expect(first.ok).toBe(false);
    expect("errors" in first && first.errors[0]).toMatchObject({ campo: "hotel", index: 3 });
    expect(inserts).toHaveLength(0);
    const n = calls.length;
    // La persona corrige Siena; los otros tres ya están ubicados (memoria por consulta).
    const fixed = input();
    fixed.cities[3].hotel = "Hotel Danieli"; // cualquier texto distinto; aquí sin resultado en Siena
    const again = await createBroughtTrip(client, { ...fixed, cities: fixed.cities.map((c, i) => (i === 3 ? { ...c, hotel: null } : c)) }, { resolved: first.resolved });
    expect(again.ok).toBe(true);
    expect(calls.length).toBe(n);
  });

  it("seguir el vuelo solo si la persona lo pide (track-flight respeta su plan en el servidor)", async () => {
    const off = fakeClient();
    await createBroughtTrip(off.client, input());
    expect(off.calls.some((c) => c.fn === "track-flight")).toBe(false);
    const on = fakeClient();
    const r = await createBroughtTrip(on.client, input({ flights: [{ numero: "AM 17", fecha: "2027-04-30", seguir: true }] }));
    expect(r.ok).toBe(true);
    expect(on.calls.filter((c) => c.fn === "track-flight")).toEqual([{ fn: "track-flight", body: { flight: "AM17", flight_date: "2027-04-30", trip_id: "trip-traido-1", today: TODAY } }]);
    expect(on.calls.some((c) => FORBIDDEN.includes(c.fn))).toBe(false);
  });
});

describe("el hotel queda con coordenadas por ciudad", () => {
  it("itinerario_json.bases y hospedaje_json llevan place_id, lat/lng y dirección; tripBases() lo lee", async () => {
    const { client, inserts } = fakeClient();
    await createBroughtTrip(client, input());
    const row = inserts[0].row;
    const bases = row.itinerario_json.bases;
    expect(bases.map((b: any) => b.ciudad)).toEqual(["Roma", "Florencia", "Venecia", "Siena", "Lucca"]);
    expect(bases[0]).toMatchObject({ llegada: "2027-05-01", salida: "2027-05-04", noches: 3,
      hotel: { nombre: "Hotel Artemide", direccion: "Via Nazionale, 22, 00184 Roma RM, Italia", place_id: "ChIJ-artemide", lat: 41.9009, lng: 12.4943 } });
    expect(bases[0].hotel.maps_url).toContain("query_place_id=ChIJ-artemide");
    expect(bases[4].hotel).toBeNull(); // Lucca: no dijo hotel → nada inventado
    expect(row.hospedaje_json).toHaveLength(4);
    for (const h of row.hospedaje_json) {
      expect(Number.isFinite(h.lat) && Number.isFinite(h.lng)).toBe(true);
      expect(h).toMatchObject({ ya_lo_tengo: true, precio_por_noche: null, fuente_precio: "propio" });
    }
    const trip = { ...row, id: "trip-traido-1" };
    expect(isBroughtTrip(trip)).toBe(true);
    expect(tripBases(trip)[2]).toMatchObject({ ciudad: "Venecia", hotel: { lat: 45.4337, lng: 12.3409 } });
    // Las fechas por ciudad son las de la persona (no un reparto parejo).
    expect(cityStays(trip).map((s) => [s.city, s.checkin, s.checkout])).toEqual([
      ["Roma", "2027-05-01", "2027-05-04"], ["Florencia", "2027-05-04", "2027-05-06"], ["Venecia", "2027-05-06", "2027-05-08"],
      ["Siena", "2027-05-08", "2027-05-10"], ["Lucca", "2027-05-10", "2027-05-12"]]);
  });

  it("tripBases() también sirve para un viaje generado (hotel con lat/lng en hospedaje_json)", () => {
    const trip = {
      destino: "Roma → Florencia", fecha_salida: "2027-05-01", fecha_regreso: "2027-05-05",
      itinerario_json: { multi: true, destinations: ["Roma", "Florencia"], days: [] },
      hospedaje_json: [{ nombre: "Sin coordenadas", ciudad: "Roma" }, { nombre: "Hotel Roma", ciudad: "Roma", lat: 41.9, lng: 12.5 }],
    };
    const b = tripBases(trip);
    expect(b.map((x) => [x.ciudad, x.llegada, x.salida])).toEqual([["Roma", "2027-05-01", "2027-05-03"], ["Florencia", "2027-05-03", "2027-05-05"]]);
    expect(b[0].hotel).toMatchObject({ nombre: "Hotel Roma", lat: 41.9 });
    expect(b[1].hotel).toBeNull();
  });
});

describe("el total no inventa vuelos ni hoteles", () => {
  const tripOf = () => ({ ...broughtTripInsert(input(), italia().cities.map(() => null)), id: "t1", created_at: "2026-10-27T10:00:00Z" });

  it("sin cotización, vuelo y hoteles en 'Ya lo tengo' (0), nada por elegir ni 'estimado'", () => {
    const trip: any = tripOf();
    expect(trip.total_estimado).toBeNull();
    expect(trip.desglose_presupuesto).toBeNull();
    expect(trip.vuelos_json[0]).toMatchObject({ numero_vuelo: "AM17", fecha: "2027-04-30", ya_lo_tengo: true, precio_por_persona: null });
    const ui = restoreSelections(trip, trip.selections);
    expect(ui.selVuelo).toBe(-2);
    expect(ui.selHospedaje).toBe(-2);
    expect(Object.values(ui.selHoteles ?? {})).toEqual([-2, -2, -2, -2, -2]);
    const sel = { ...ui, nochesHospedaje: 11 };
    const desglose = computeTripDesglose(trip, sel, 2);
    expect(desglose.vuelos).toBe(0);
    expect(desglose.hospedaje).toBe(0);
    expect(Object.values(desglose).reduce((a, b) => a + b, 0)).toBe(0);
    const flow = buildBuyFlow(trip, sel);
    expect(flow.items.some((i) => i.kind === "vuelo" && i.col === "vuelos_json")).toBe(false);
    expect(flow.items.some((i) => i.kind === "hospedaje")).toBe(false);
    expect(flow.steps.filter((s) => s.kind === "hospedaje").map((s) => (s as any).skipped)).toEqual([true, true, true, true, true]);
    expect(flow.steps.find((s) => s.kind === "vuelo")).toMatchObject({ skipped: true });
    const sum = tripTotalSummary({ trip, sel, desglose, items: flow.items });
    expect(sum.total).toBe(0);
    expect(sum.missing).toEqual([]);
    expect(sum.sinPrecioReal).toEqual([]);
    expect(sum.estimadosNote).toBe("");
    expect(sum.estimatedKeys).toEqual([]);
  });

  it("'Qué sigue' no pide cotizar: arma tus días", () => {
    const a = nextTripAction(tripOf() as any, { today: TODAY });
    expect(a.key).toBe("experiencias");
    expect(a.title).toBe("Arma tus días");
  });
});

describe("fechas por ciudad coherentes", () => {
  const base = () => italia().cities.map((c) => ({ ...c }));
  const v = (cities: BroughtCity[], extra: Partial<BroughtTripInput> = {}) => validateBroughtTrip({ cities, personas: 2, today: TODAY, flights: [], ...extra });

  it("válidas: sin errores", () => {
    expect(v(base())).toEqual([]);
  });
  it("salida igual o antes de la llegada", () => {
    const c = base(); c[1].salida = c[1].llegada;
    expect(v(c)).toEqual([expect.objectContaining({ campo: "fechas", index: 1, mensaje: "En Florencia la salida debe ser después de la llegada (al menos una noche)." })]);
  });
  it("llegar a una ciudad antes de salir de la anterior", () => {
    const c = base(); c[2].llegada = "2027-05-05";
    expect(v(c)).toEqual([expect.objectContaining({ campo: "fechas", index: 2, mensaje: "Llegas a Venecia (5 may 2027) antes de salir de Florencia (6 may 2027)." })]);
  });
  it("una noche de tren entre ciudades (hueco) sí se permite", () => {
    const c = base(); c[2].llegada = "2027-05-07";
    expect(v(c)).toEqual([]);
  });
  it("faltan fechas, viaje pasado, demasiado lejos y misma ciudad seguida", () => {
    const c = base(); c[0].salida = "";
    expect(v(c)[0]).toMatchObject({ campo: "fechas", index: 0, mensaje: "Pon el día que llegas y el día que sales de Roma." });
    expect(v(base(), { today: "2027-06-01" })[0].mensaje).toMatch(/ya pasó/);
    expect(v(base(), { today: "2024-01-01" })[0].mensaje).toMatch(/más de dos años/);
    const d = base(); d[1].ciudad = "Roma";
    expect(v(d).some((e) => e.campo === "ciudades" && e.index === 1)).toBe(true);
  });
  it("vuelo: número válido y fecha dentro del viaje (hasta 2 días antes de llegar)", () => {
    expect(v(base(), { flights: [{ numero: "AM 17", fecha: "2027-04-29" }] })).toEqual([]);
    expect(v(base(), { flights: [{ numero: "AM 17", fecha: "2027-04-20" }] })[0]).toMatchObject({ campo: "vuelo", index: 0 });
    expect(v(base(), { flights: [{ numero: "hola", fecha: "2027-05-01" }] })[0].mensaje).toBe("Número de vuelo no válido (ej. AM 17).");
    expect(v(base(), { flights: [{ numero: "AM17", fecha: "" }] })[0].mensaje).toBe("Pon la fecha del vuelo AM17.");
    expect(v(base(), { flights: [{ numero: "", fecha: "" }] })).toEqual([]);
  });
  it("personas entre 1 y 20 y al menos una ciudad", () => {
    expect(v(base(), { personas: 0 })[0].campo).toBe("personas");
    expect(v([])[0].campo).toBe("ciudades");
  });
});
