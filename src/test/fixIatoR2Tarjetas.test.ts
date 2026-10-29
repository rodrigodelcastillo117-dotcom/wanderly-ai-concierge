// Auditoría 10, ronda 2 (N6): el texto y las tarjetas no coincidían. Roma: el texto nombra el "Tour
// privado de Civitavecchia" (sin tarjeta) y había tarjetas de pizza y gelato y de Ponza que el texto no
// menciona. Lisboa: 6 atracciones en el texto y 4 tarjetas. Textos reales (r2-concierge/out).
import { describe, expect, it } from "vitest";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { DATA_SENTINEL } from "../../supabase/functions/concierge-chat/stream";
import { mentionIndex } from "../../supabase/functions/concierge-chat/cards";

const ACTX = { todayISO: "2026-10-28", trips: [], activeTripId: null };
const ROMA_TEXT = "Para Roma, Viator (consultado hoy 28 de octubre) devuelve estas opciones:\n\n- **Clase de pasta, ravioli y tiramisú con vino premium** (3 h, rating 5 con 235 reseñas), desde $2,106 MXN por persona.\n- **Sesión de fotos privada en el Coliseo** (40 min, rating 5 con 241 reseñas), desde $957 MXN.\n- **Tour privado de Civitavecchia a Roma** (8 h, rating 5 con 188 reseñas), desde $15,531 MXN.\n\nLos precios son \"desde\" y pueden cambiar en Viator.";
const tour = (t: string, n: number) => ({ title: t, url: `https://www.viator.com/es-MX/tours/Rome/x/d511-${n}`, codigo: `P${n}`, rating: 5, resenas: 200 + n, desde: { monto: 1000 + n, moneda: "MXN" } });
const ROMA_RUN = { name: "search_tours", args: { city: "Roma" }, result: { disponible: true, results: [
  tour("Experiencia de hacer pizza y gelato con vino italiano fino en Roma", 1),
  tour("Roma: Sesión de fotos en el Coliseo: experiencia privada y personalizada", 2),
  tour("Clase de cocina Roma Pasta, Ravioli y Tiramisu con vino Premium", 3),
  tour("Ponza, viaje en barco a bordo del Zannone 1954", 4),
  tour("Tour privado en tierra desde el puerto de Civitavecchia a Roma", 5),
] } };

const LISBOA_TEXT = "Estas son las atracciones mejor valoradas en Lisboa según Google Maps (consultado hoy, 28 de octubre):\n\n- **Torre de Belém** (4.5, más de 118 mil reseñas): la torre manuelina junto al Tajo, en Belém.\n- **Monumento a los Descubrimientos** (4.6): frente al río, a pocos minutos de la Torre.\n- **Oceanario de Lisboa** (4.7): uno de los acuarios más grandes de Europa, en el Parque das Nações.\n- **Mirador de Portas do Sol** (4.7): el mejor punto para ver Alfama y los tejados al atardecer.\n\nEl Castillo de San Jorge (4.5) y la Plaza del Comercio (4.7) completan la lista.";
const place = (name: string, rating: number, i: number) => ({ id: `ChIJlisboa${String(i).padStart(18, "0")}`, place_id: `ChIJlisboa${String(i).padStart(18, "0")}`, name, rating, address: `Lisboa ${i}`, latitude: 38.7, longitude: -9.1 });
const LISBOA_RUN = { name: "search_attractions", args: { query: "imperdibles Lisboa" }, result: { disponible: true, source: "google_places", results: [
  place("Torre de Belém", 4.5, 1), place("Monumento a los Descubrimientos", 4.6, 2), place("Oceanario de Lisboa", 4.7, 3),
  place("Mirador de Portas do Sol", 4.7, 4), place("Castillo de San Jorge", 4.5, 5), place("Plaza del Comercio", 4.7, 6),
] } };

describe("N6 · las tarjetas son las que el texto menciona", () => {
  it("Roma: tarjetas de los 3 tours del texto (Civitavecchia incluido), sin pizza ni Ponza, en el orden del texto", () => {
    const f = finalizeTurn({ raw: ROMA_TEXT, toolRuns: [ROMA_RUN as any], plan: { cards: [], suggestedActions: [] }, actionCtx: ACTX, liveText: ROMA_TEXT });
    const tours = f.cards.filter((c) => c.type === "tour").map((c) => c.title);
    expect(tours).toEqual([
      "Clase de cocina Roma Pasta, Ravioli y Tiramisu con vino Premium",
      "Roma: Sesión de fotos en el Coliseo: experiencia privada y personalizada",
      "Tour privado en tierra desde el puerto de Civitavecchia a Roma",
    ]);
  });
  it("Lisboa: 6 atracciones en el texto → 6 tarjetas (las 2 que faltaban salen de la búsqueda, con su calificación)", () => {
    const raw = `${LISBOA_TEXT}\n${DATA_SENTINEL}\n${JSON.stringify({ cards: ["Torre de Belém", "Monumento a los Descubrimientos", "Oceanario de Lisboa", "Mirador de Portas do Sol"].map((t) => ({ type: "attraction", title: t })) })}`;
    const f = finalizeTurn({ raw, toolRuns: [LISBOA_RUN as any], plan: { cards: [], suggestedActions: [] }, actionCtx: ACTX, liveText: LISBOA_TEXT });
    const attr = f.cards.filter((c) => c.type === "attraction");
    expect(attr.map((c) => c.title)).toEqual(["Torre de Belém", "Monumento a los Descubrimientos", "Oceanario de Lisboa", "Mirador de Portas do Sol", "Castillo de San Jorge", "Plaza del Comercio"]);
    expect(attr[5]).toMatchObject({ rating: 4.7, fuente: "google_maps" });
    expect(attr[5].links?.some((l) => l.kind === "directions")).toBe(true);
  });
  it("una tarjeta que el texto no nombra no se muestra; sin nombres en el texto, nada cambia", () => {
    expect(mentionIndex(ROMA_TEXT, "Ponza, viaje en barco a bordo del Zannone 1954")).toBe(-1);
    expect(mentionIndex(ROMA_TEXT, "Experiencia de hacer pizza y gelato con vino italiano fino en Roma")).toBe(-1);
    const f = finalizeTurn({ raw: "Aquí tienes tours en Roma.", toolRuns: [ROMA_RUN as any], plan: { cards: [], suggestedActions: [] }, actionCtx: ACTX, liveText: "Aquí tienes tours en Roma." });
    expect(f.cards.filter((c) => c.type === "tour").length).toBe(4);
  });
});
