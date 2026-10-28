// Prueba E2E real en producción (28-oct-2026, "que sea funcional"): cada caso reproduce lo que se vio en
// traveliatos.life con la cuenta demo y fija el arreglo.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { parseTripFallback } from "@/lib/parseTripFallback";
import { understandPlanText } from "@/lib/planDefaults";
import { tourCards, prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards.ts";
import { MAX_EVENTS, partialNote, runEventSearch } from "../../supabase/functions/concierge-chat/events.ts";
import { nearbyRankPreference } from "../../supabase/functions/places-nearby/rank.ts";
import { BookingStateBadge, badgeEstimatedKinds } from "@/components/BookingStateBadge";
import { budgetLabels, trustMatchesSplit } from "@/lib/totalSplit";
import { sameSearchUrlKey } from "@/components/booking/TripPicksCarousel";
import { nextTripAction } from "@/lib/tripCommand";
import { EXP_CACHE_TTL_MS, loadExpTop, saveExpTop } from "@/lib/experiencias";

const TODAY = new Date("2026-10-28T12:00:00");

describe("Planear: 'fin de semana en Valle de Bravo desde CDMX, 2 personas'", () => {
  it("entiende el destino, las fechas del fin de semana y los viajeros", () => {
    const t = "fin de semana en Valle de Bravo desde CDMX, 2 personas";
    expect(parseTripFallback(t, TODAY)).toEqual({ destino: "Valle de Bravo", fechaSalida: "2026-10-30", fechaRegreso: "2026-11-01", viajeros: 2 });
    expect(understandPlanText(t, TODAY)).toMatchObject({ destino: "Valle de Bravo", fechaSalida: "2026-10-30", fechaRegreso: "2026-11-01", viajeros: 2 });
  });

  it("otros arranques: '3 días en San Miguel de Allende', 'viaje a Roma de 5 días'", () => {
    expect(parseTripFallback("3 días en San Miguel de Allende con mi pareja", TODAY).destino).toBe("San Miguel de Allende");
    expect(parseTripFallback("viaje a Roma de 5 días", TODAY).destino).toBe("Roma");
    expect(parseTripFallback("un puente en Tepoztlán, 4 personas", TODAY)).toMatchObject({ destino: "Tepoztlán", viajeros: 4 });
  });

  it("sin mayúscula después de 'en' sigue la regla de antes (no inventa un lugar)", () => {
    expect(parseTripFallback("Oaxaca un fin de semana, 2 personas", TODAY).destino).toBe("Oaxaca");
    expect(parseTripFallback("quiero ir a la playa", TODAY).destino).not.toBe("La");
  });
});

describe("Iato: tours de Viator con enlace en español (/es-MX/tours/)", () => {
  const run = (url: string) => ({ name: "search_tours", result: { ok: true, results: [{ codigo: "342427P6", title: "Tuk-tuk por Lisboa", url, rating: 5, resenas: 297, desde: { monto: 3829, moneda: "MXN" } }] } });
  it("arma la card con 'Ver en Viator' (antes se descartaban todas)", () => {
    const cards = tourCards([run("https://www.viator.com/es-MX/tours/Lisbon/Tuk-tuk/d538-342427P6?mcid=42383")], "2026-10-28T05:43:00Z");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ type: "tour", title: "Tuk-tuk por Lisboa", cta_label: "Ver en Viator" });
    expect(tourCards([run("https://www.viator.com/tours/Lisbon/Tuk-tuk/d538-342427P6")])).toHaveLength(1);
  });
  it("sigue rechazando lo que no es una ficha de tour de Viator", () => {
    expect(tourCards([run("https://www.viator.com/es-MX/Lisbon/d538")])).toHaveLength(0);
    expect(tourCards([run("https://example.com/es-MX/tours/x")])).toHaveLength(0);
  });
});

describe("Iato: eventos de Ticketmaster son los primeros por fecha, no todos", () => {
  it("partialNote solo cuando hubo más que los que se muestran", () => {
    expect(partialNote(MAX_EVENTS, "2026-11-01", "2026-11-30")).toEqual({});
    expect(partialNote(20, "2026-11-01", "2026-11-30")).toMatchObject({ parcial: true, mostrados: MAX_EVENTS });
  });
  it("runEventSearch la marca y el modelo recibe la nota", async () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      title: `Concierto ${i}`, fecha: "2026-11-01", hora: "20:00", url: `https://www.ticketmaster.com.mx/e/${i}`, estado: "En venta",
    }));
    const r = await runEventSearch({ city: "Ciudad de México", date_from: "2026-11-01", date_to: "2026-11-30", query: "conciertos" }, {
      fetchImpl: (async () => { throw new Error("sin red"); }) as unknown as typeof fetch,
      ticketmaster: async () => ({ ok: true, source: "ticketmaster", results: results as never, consulted_at: "2026-10-28T05:45:00Z" }),
    } as never);
    expect(r).toMatchObject({ ok: true, parcial: true, mostrados: MAX_EVENTS });
    expect((r.results as unknown[]).length).toBe(MAX_EVENTS);
    const forModel = prepareToolResultForModel("search_events", r);
    expect(String(forModel.nota_resultados)).toMatch(/primeros .* por fecha/);
  });
});

describe("Cerca de mí: restaurantes por popularidad, emergencias por distancia", () => {
  it("nearbyRankPreference", () => {
    expect(nearbyRankPreference("restaurant")).toBe("POPULARITY");
    expect(nearbyRankPreference("lodging")).toBe("POPULARITY");
    for (const k of ["hospital", "police", "pharmacy", "atm", "embassy", "gas_station"]) expect(nearbyRankPreference(k)).toBe("DISTANCE");
  });
  it("places-nearby usa la regla", () => {
    expect(readFileSync("supabase/functions/places-nearby/index.ts", "utf8")).toContain("rankPreference: nearbyRankPreference(body.kind)");
  });
});

describe("Iato: sin botones de 'elige tu viaje' cuando la pregunta era sobre un lugar", () => {
  it("Concierge solo los muestra si el alcance no es 'requested' ni 'here'", () => {
    const src = readFileSync("src/pages/Concierge.tsx", "utf8");
    expect(src).toContain('msg.tripReason === "ambiguous" && msg.placeScope !== "requested" && msg.placeScope !== "here"');
  });
});

describe("Viaje: insignias y desglose dicen lo mismo que el total", () => {
  const summary = { estado: "cotizado", label: "Cotizado · sin reservar", por_tipo: { vuelo: "cotizado", hospedaje: "cotizado", tour: "cotizado" }, reservas_confirmadas: 0, clics_sin_confirmar: 0 } as never;

  it("vuelo con tarifa en vivo sin elegir no se llama 'Estimado' (Lisboa)", () => {
    const kinds = badgeEstimatedKinds({ sinPrecioReal: [], estimatedKeys: ["vuelos", "hospedaje", "tours", "comida"] });
    expect(kinds).toEqual(["tour"]);
    render(<BookingStateBadge summary={summary} estimated={kinds} />);
    expect(screen.getByText("Vuelo: Cotizado · no reservado")).toBeInTheDocument();
    expect(screen.getByText("Experiencias: Estimado · no reservado")).toBeInTheDocument();
  });

  it("vuelo sin precio verificable sí es 'Estimado'", () => {
    expect(badgeEstimatedKinds({ sinPrecioReal: ["vuelos"], estimatedKeys: ["vuelos"] })).toEqual(["vuelo"]);
  });

  it("por tierra la insignia y el desglose dicen 'Cómo llegar', no 'Vuelo' (Valle de Bravo)", () => {
    render(<BookingStateBadge summary={summary} estimated={["vuelo"]} byLand />);
    expect(screen.getByText("Cómo llegar: Estimado · no reservado")).toBeInTheDocument();
    expect(screen.queryByText(/^Vuelo:/)).toBeNull();
    const ground = { destino: "Valle de Bravo", ciudad_origen: "Ciudad de México", vuelos_json: [{ modo: "auto", aerolinea: "En tu coche" }, { modo: "autobus", aerolinea: "Autobús" }] };
    expect(budgetLabels(ground).vuelos).toBe("Cómo llegar");
    expect(budgetLabels({ destino: "Lisboa", ciudad_origen: "Ciudad de México", vuelos_json: [{ aerolinea: "Iberia" }] }).vuelos).toBeUndefined();
  });

  it("la barra 'consultado en vivo' se oculta si no coincide con 'Total con precios reales'", () => {
    const split = (real: number, estimado: number) => ({ total: real + estimado, real, estimado, realParts: [], estParts: [] });
    expect(trustMatchesSplit({ verified: 67653 }, split(67653, 32500))).toBe(true);
    expect(trustMatchesSplit({ verified: 5368 }, split(6592, 10361))).toBe(false);
    expect(trustMatchesSplit({ verified: 5368 }, null)).toBe(true);
  });

  it("sin alerta de precio de vuelos en un viaje por tierra", () => {
    expect(readFileSync("src/pages/TripDetail.tsx", "utf8")).toContain("isOwner && !brought && !arrivalByLand(trip) && (");
  });
});

describe("Comprar: un solo 'Buscar en OpenTable' por restaurante", () => {
  it("la misma búsqueda con %20 y con + es el mismo botón", () => {
    expect(sameSearchUrlKey("https://www.opentable.com/s?term=Dipao%20Valle%20Valle%20de%20Bravo"))
      .toBe(sameSearchUrlKey("https://www.opentable.com/s?term=Dipao+Valle+Valle+de+Bravo"));
    expect(sameSearchUrlKey("https://www.opentable.com/s?term=A")).not.toBe(sameSearchUrlKey("https://www.thefork.pt/search?searchText=A"));
  });
});

describe("Qué sigue: si sales pronto y falta elegir, primero elegir", () => {
  const trip = { id: "v1", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01", total_estimado: 16953, created_at: "2026-10-28T05:38:00Z" };
  const quote = { created_at: "2026-10-28T05:38:00Z", valid_until: "2026-10-29T05:37:00Z" };
  it("faltan cómo llegar y hotel → 'Elige y reserva'", () => {
    const a = nextTripAction(trip, { today: "2026-10-27", quote, now: new Date("2026-10-28T05:40:00Z"), missing: ["cómo llegar", "hotel"] });
    expect(a).toMatchObject({ key: "reservar", title: "Elige y reserva" });
    expect(a.detail).toBe("Sales en 3 días y aún te falta elegir cómo llegar y hotel.");
  });
  it("todo elegido → la maleta, como antes", () => {
    expect(nextTripAction(trip, { today: "2026-10-27", quote, now: new Date("2026-10-28T05:40:00Z"), missing: [] }).key).toBe("preparar");
  });
});

describe("Experiencias: lo TOP ya buscado vuelve al recargar (12 h, este navegador)", () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  it("guarda y recupera por viaje y ciudad", () => {
    const st = mem();
    saveExpTop("t1", "Lisboa", { ok: true, ciudad: "Lisboa" }, 1000, st);
    expect(loadExpTop("t1", "Lisboa", 2000, st)).toEqual({ ok: true, ciudad: "Lisboa" });
    expect(loadExpTop("t1", "Oporto", 2000, st)).toBeNull();
    expect(loadExpTop("t2", "Lisboa", 2000, st)).toBeNull();
  });
  it("caduca a las 12 h y nunca falla sin almacenamiento", () => {
    const st = mem();
    saveExpTop("t1", "Lisboa", { ok: true }, 0, st);
    expect(loadExpTop("t1", "Lisboa", EXP_CACHE_TTL_MS + 1, st)).toBeNull();
    expect(loadExpTop("t1", "Lisboa", 1, null)).toBeNull();
    const broken = { getItem: () => { throw new Error("bloqueado"); }, setItem: () => { throw new Error("bloqueado"); } };
    expect(() => saveExpTop("t1", "Lisboa", { ok: true }, 0, broken)).not.toThrow();
    expect(loadExpTop("t1", "Lisboa", 1, broken)).toBeNull();
  });
});

describe("Inicio: textos en español claro", () => {
  it("sin 'single o multi-destino' ni 'fechas parecidas'; fecha sin 'De' en mayúscula", () => {
    const src = readFileSync("src/pages/DashboardHome.tsx", "utf8");
    expect(src).not.toMatch(/single o multi|fechas parecidas/);
    expect(src).not.toContain("text-muted-foreground capitalize tracking-wide");
  });
  it("herramientas del viaje: 'En vivo' y 'Equipaje' (no 'Live' ni 'Packing')", () => {
    const src = readFileSync("src/pages/TripDetail.tsx", "utf8");
    expect(src).not.toMatch(/label: "(Live|Packing)"/);
    expect(src).toContain('label: "En vivo"');
    expect(src).toContain('label: "Equipaje"');
  });
});

describe("Portada del viaje: nunca la foto de un hotel", () => {
  it("pickCover solo usa fotos de lugares del destino", () => {
    const src = readFileSync("supabase/functions/analizar-viaje/index.ts", "utf8");
    const fn = src.slice(src.indexOf("function pickCover"), src.indexOf("function pickCover") + 400);
    expect(fn).not.toContain("thumbnail");
  });
});
