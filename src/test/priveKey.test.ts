// THE PRIVÉ KEY (supabase/functions/_shared/priveKey.ts): del deseo escrito a hasta tres propuestas.
// Catálogo: filas REALES de la curaduría (src/test/fixtures/priveKeyCatalog.json, sin precios ni horarios con
// fuente, como hoy) más candidatos sintéticos con precio publicado para probar el presupuesto.
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/priveKeyCatalog.json";
import {
  buildKey, childDestinations, detectPlace, findKeyClaims, missingQuestions, notePriceHint, parseBudget, parseDate, parseMode, parseParty,
  resolveWish, visibleText, type KeyCandidate, type KeyResult, type Wish,
} from "../../supabase/functions/_shared/priveKey";
import { findFalseClaims } from "../../supabase/functions/_shared/booking/iato";

const TODAY = "2026-10-22"; // jueves
const city = (slug: "cdmx" | "mc" | "paris") => (fixture as any).cities[slug].items as KeyCandidate[];
const run = (text: string, slug: "cdmx" | "mc" | "paris", extra: Partial<Parameters<typeof resolveWish>[2]> = {}, answers = {}) => {
  const wish = resolveWish(text, answers, { todayISO: TODAY, ...extra });
  return { wish, r: buildKey(city(slug), wish, { todayISO: TODAY, seed: "t" }) };
};
const ids = (r: KeyResult) => r.proposals.flatMap((p) => p.steps.map((s) => s.experience.id));

describe("leer el deseo (sin IA)", () => {
  it("presupuesto en sus formas comunes; sin moneda explícita con $ se toma MXN y se dice", () => {
    expect(parseBudget("Tengo $10,000 MXN para celebrar")).toEqual({ amount: 10000, currency: "MXN", assumed_currency: false });
    expect(parseBudget("unos 10 mil pesos")).toMatchObject({ amount: 10000, currency: "MXN" });
    expect(parseBudget("presupuesto 2000 euros")).toMatchObject({ amount: 2000, currency: "EUR" });
    expect(parseBudget("€800 en total")).toMatchObject({ amount: 800, currency: "EUR" });
    expect(parseBudget("USD 300")).toMatchObject({ amount: 300, currency: "USD" });
    expect(parseBudget("tengo $5,000")).toEqual({ amount: 5000, currency: "MXN", assumed_currency: true });
    expect(parseBudget("15k")).toMatchObject({ amount: 15000 });
    expect(parseBudget("Somos 4 y tenemos 48 horas")).toBeNull();
  });
  it("personas, compañía y menores", () => {
    expect(parseParty("una noche inolvidable con mi pareja")).toMatchObject({ size: 2, companions: "pareja" });
    expect(parseParty("Organiza algo especial para mis padres")).toMatchObject({ size: 2, companions: "padres" });
    expect(parseParty("somos 6 amigos")).toMatchObject({ size: 6, companions: "amigos" });
    expect(parseParty("para cuatro personas")).toMatchObject({ size: 4 });
    expect(parseParty("con mi familia y los niños")).toMatchObject({ size: null, companions: "familia", minors: true });
    expect(parseParty("para el 15 de noviembre").size).toBeNull();
  });
  it("fechas relativas y explícitas en la zona del usuario", () => {
    expect(parseDate("esta noche", TODAY)).toBe(TODAY);
    expect(parseDate("mañana en la noche", TODAY)).toBe("2026-10-23");
    expect(parseDate("por la mañana", TODAY)).toBeNull();
    expect(parseDate("el sábado", TODAY)).toBe("2026-10-24");
    expect(parseDate("este fin de semana", TODAY)).toBe("2026-10-24");
    expect(parseDate("el 15 de noviembre", TODAY)).toBe("2026-11-15");
    expect(parseDate("el 3 de enero", TODAY)).toBe("2027-01-03");
    expect(parseDate("2026-12-31", TODAY)).toBe("2026-12-31");
  });
  it("modos: 48 horas, sorpresa y escala", () => {
    expect(parseMode("Quiero pasar 48 horas increíbles en París")).toMatchObject({ mode: "h48", nights: 2 });
    expect(parseMode("Sorpréndeme en Tokio").mode).toBe("surprise");
    expect(parseMode("Tengo una escala larga de 9 horas")).toMatchObject({ mode: "key", layoverHours: 9 });
  });
  it("lugares con alias, barrios y países; 'a nice dinner' no es Niza", () => {
    expect(detectPlace("aniversario en CDMX")?.slug).toBe("cdmx");
    expect(detectPlace("Estoy en Montecarlo")?.slug).toBe("monaco-monte-carlo");
    expect(detectPlace("algo en Polanco")?.kind).toBe("neighborhood");
    expect(detectPlace("I want a nice dinner")).toBeNull();
    expect(detectPlace("una cena en Niza")?.slug).toBe("niza");
    const jp = detectPlace("Sorpréndeme en Japón");
    expect(jp?.is_destination).toBe(false);
    expect(childDestinations("jp").map((p) => p.slug)).toEqual(expect.arrayContaining(["tokio", "kioto"]));
  });
  it("la nota de precio de la curaduría se lee como estimado por persona", () => {
    expect(notePriceHint("Menú degustación $6,090 MXN; maridaje $3,380 MXN (según el sitio oficial).")).toEqual({ amount: 6090, currency: "MXN", per_person: true });
    expect(notePriceHint("Tratamientos desde 195 € (p. ej. 'St Barth Escape')")).toMatchObject({ amount: 195, currency: "EUR" });
    expect(notePriceHint("Coctelería; sin rango publicado.")).toBeNull();
  });
});

describe("pregunta solo lo que falta", () => {
  it("'Quiero una noche inolvidable con mi pareja': lugar, día y presupuesto; NO cuántas personas", () => {
    const w = resolveWish("Quiero una noche inolvidable con mi pareja", {}, { todayISO: TODAY });
    expect(missingQuestions(w).map((q) => q.id)).toEqual(["destination", "date", "budget"]);
    const r = buildKey(city("cdmx"), w, { todayISO: TODAY });
    expect(r.status).toBe("questions");
    expect(r.proposals).toEqual([]);
  });
  it("el ejemplo del dueño con todo dicho no pregunta nada", () => {
    const { r } = run("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado", "cdmx");
    expect(r.questions).toEqual([]);
    expect(r.status).toBe("proposals");
  });
  it("las respuestas completan el deseo sin volver a preguntar", () => {
    const w = resolveWish("Quiero una noche inolvidable con mi pareja", { destination: "cdmx", date: "tomorrow", budget: "open" }, { todayISO: TODAY });
    expect(missingQuestions(w)).toEqual([]);
    expect(w).toMatchObject({ destinationQuery: "cdmx", date: "2026-10-23", party: 2, budgetOpen: true });
  });
  it("un país no es un destino: pregunta la ciudad con opciones reales", () => {
    const w = resolveWish("Sorpréndeme en Japón", {}, { todayISO: TODAY });
    const q = missingQuestions(w);
    expect(q.map((x) => x.id)).toEqual(["destination"]);
    expect(q[0].text).toMatch(/Japón/);
    expect(q[0].options.map((o) => o.value)).toEqual(expect.arrayContaining(["tokio", "kioto", "osaka"]));
  });
  it("Sorpréndeme solo necesita el lugar", () => {
    const w = resolveWish("Sorpréndeme en CDMX", {}, { todayISO: TODAY });
    expect(missingQuestions(w)).toEqual([]);
  });
  it("en inglés, las preguntas van en inglés", () => {
    const w = resolveWish("An unforgettable night with my partner", {}, { todayISO: TODAY, lang: "en" });
    expect(missingQuestions(w, "en")[0].text).toBe("Where would you like to live it?");
  });
});

describe("usa bien el viaje activo", () => {
  const trip = { id: "11111111-1111-4111-8111-111111111111", destino: "Ciudad de México", fecha_salida: "2026-11-20", fecha_regreso: "2026-11-24", num_viajeros: 3, reason: "single_upcoming" };
  it("sin lugar en el texto: destino, primer día y viajeros del viaje", () => {
    const w = resolveWish("Organiza una noche especial", { budget: "open" }, { todayISO: TODAY, trip });
    expect(w).toMatchObject({ destinationQuery: "cdmx", destinationSource: "trip", date: "2026-11-20", dateSource: "trip", party: 3, partySource: "trip" });
    expect(w.trip?.id).toBe(trip.id);
  });
  it("viaje en curso: hoy, no el primer día", () => {
    const w = resolveWish("Organiza una noche especial", {}, { todayISO: "2026-11-22", trip });
    expect(w.date).toBe("2026-11-22");
  });
  it("si el deseo es de OTRO lugar, no se mezcla con ese viaje y se dice", () => {
    const w = resolveWish("48 horas en París con mi pareja el 14 de noviembre", {}, { todayISO: TODAY, trip });
    expect(w.trip).toBeNull();
    expect(w.destinationQuery).toBe("paris");
    expect(w.party).toBe(2);
    expect(w.tripNote).toMatch(/Ciudad de México/);
  });
});

describe("tres propuestas diferenciadas (ejemplo del dueño: aniversario en CDMX, $10,000 MXN)", () => {
  const { wish, r } = run("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado", "cdmx");
  it("THE SIGNATURE, THE INSIDER y THE UNEXPECTED, en ese orden", () => {
    expect(r.proposals.map((p) => p.title)).toEqual(["THE SIGNATURE", "THE INSIDER", "THE UNEXPECTED"]);
    expect(r.proposals.map((p) => p.subtitle)).toEqual(["La firma", "Criterio local", "Lo inesperado"]);
  });
  it("ninguna experiencia se repite entre niveles", () => {
    const all = ids(r);
    expect(new Set(all).size).toBe(all.length);
  });
  it("cada una es una secuencia completa: horas, motivo, costo según fuente, traslado ESTIMADO y qué falta", () => {
    for (const p of r.proposals) {
      expect(p.steps.length).toBeGreaterThanOrEqual(1);
      p.steps.forEach((s, i) => {
        expect(s.start).toMatch(/^\d{2}:\d{2}$/);
        expect(s.time_text).toMatch(/sugerido · horario por confirmar|dentro del horario publicado/);
        expect(s.reason.length).toBeGreaterThan(10);
        expect(s.cost.text).toBeTruthy();
        if (i > 0) expect(s.transfer?.label).toBe("ESTIMADO");
        expect(s.pending).toContain("Disponibilidad no consultada");
        expect(s.confirmable.join(" ")).toMatch(/solicitud, no reserva/);
      });
      expect(p.status).toBe("propuesta");
      expect(p.disclaimers[0]).toMatch(/nada está reservado/);
    }
  });
  it("es una noche: nada empieza antes de las 15:00", () => {
    for (const p of r.proposals) for (const s of p.steps) expect(Number(s.start.slice(0, 2)) >= 15 || Number(s.start.slice(0, 2)) < 3).toBe(true);
  });
  it("THE UNEXPECTED sale de lo obvio: trae un universo que no está en la firma", () => {
    const sig = new Set(r.proposals[0].universes);
    expect(r.proposals[2].universes.some((u) => !sig.has(u))).toBe(true);
  });
  it("presupuesto respetado: Quintonil (menú $6,090 MXN por persona según la curaduría) no entra para 2 con $10,000", () => {
    expect(wish.budget).toMatchObject({ amount: 10000, currency: "MXN" });
    const names = r.proposals.flatMap((p) => p.steps.map((s) => s.experience.name));
    expect(names).not.toContain("Quintonil");
    // Sin precios con fuente nunca dice "cabe": dice que no puede asegurarlo.
    for (const p of r.proposals) {
      expect(["no_verificable", "probable"]).toContain(p.budget.status);
      expect(p.budget.text).not.toMatch(/^Cabe/);
    }
  });
  it("con más presupuesto, Quintonil sí puede ser la firma", () => {
    const { r: r2 } = run("Tengo $40,000 MXN para celebrar un aniversario en CDMX el sábado", "cdmx");
    expect(r2.proposals[0].steps.map((s) => s.experience.name)).toContain("Quintonil");
  });
  it("nunca un club solo para miembros (IATOS no da ese acceso)", () => {
    const { r: r2 } = run("Una noche extraordinaria en CDMX mañana para dos, sin tope", "cdmx");
    expect(r2.proposals.flatMap((p) => p.steps.map((s) => s.experience.name))).not.toContain("Soho House Mexico City");
  });
  it("es determinista: mismo deseo, mismo resultado", () => {
    expect(JSON.stringify(run("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado", "cdmx").r)).toBe(JSON.stringify(r));
  });
});

// Candidatos con precio publicado (sintéticos) para probar la suma exacta.
const priced = (id: string, universe: string, subcategory: string, price: number, basis = "por_persona", extra: Partial<KeyCandidate> = {}): KeyCandidate => ({
  id, slug: id, name: `P ${id}`, universe, subcategory, state: "VERIFICADO", age_policy: "todas", booking_method: "web", booking_url: `https://example.test/${id}`,
  price: { min: price, max: price, currency: "MXN", basis, source: `https://example.test/${id}/precio` }, price_level: 3, why: `Hecho con fuente de ${id}.`,
  lat: 19.43, lng: -99.19, destination: { slug: "cdmx", name: "Ciudad de México", timezone: "America/Mexico_City", currency: "MXN" }, ...extra,
});

describe("presupuesto con precios publicados", () => {
  const cands = [
    priced("cena-cara", "the_table", "alta_cocina", 6000), priced("cena-media", "the_table", "bistro", 1800), priced("cena-local", "the_table", "cantina tradicional", 700),
    priced("bar-1", "after_dark", "cocteleria", 600), priced("bar-2", "after_dark", "jazz", 400), priced("show", "after_dark", "cabaret show", 900),
    priced("barco", "yacht_sea", "paseo_privado", 4000, "por_grupo"),
  ];
  const wish = resolveWish("aniversario en CDMX mañana con mi pareja, $6,000 MXN", {}, { todayISO: TODAY });
  const r = buildKey(cands, wish, { todayISO: TODAY });
  it("lo que solo ya rebasa el presupuesto no entra; ninguna propuesta excede", () => {
    expect(ids(r)).not.toContain("cena-cara");
    for (const p of r.proposals) {
      const total = p.steps.reduce((s, x) => s + (x.cost.amount ?? 0), 0);
      expect(total).toBeLessThanOrEqual(6000);
      expect(p.budget.status).toBe("dentro");
      expect(p.budget.text).toMatch(/Cabe en tu presupuesto según precios publicados/);
    }
  });
  it("el costo de cada paso dice su fuente y el cálculo por persona", () => {
    const s = r.proposals[0].steps[0];
    expect(s.cost.basis).toBe("fuente");
    expect(s.cost.source_url).toMatch(/^https:\/\/example\.test\//);
    expect(s.cost.text).toMatch(/por persona según la fuente · desde/);
  });
  it("presupuesto imposible: no se presenta ningún plan que no quepa, y se dice", () => {
    const tight = resolveWish("cena en CDMX mañana para 2, $500 MXN", {}, { todayISO: TODAY });
    const r2 = buildKey(cands, tight, { todayISO: TODAY });
    expect(r2.proposals).toEqual([]);
    expect(r2.status).toBe("no_coverage");
    expect(r2.note).toMatch(/presupuesto|No te propongo/);
  });
});

describe("honestidad: sin reservas, sin VIP, sin inventar", () => {
  const WISHES: [string, "cdmx" | "mc" | "paris"][] = [
    ["Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado", "cdmx"],
    ["Estoy en Mónaco y quiero vivir una experiencia extraordinaria con mi pareja mañana, sin tope", "mc"],
    ["Quiero pasar 48 horas increíbles en París con mi pareja desde el 14 de noviembre, presupuesto 2000 euros", "paris"],
    ["Sorpréndeme en CDMX esta noche", "cdmx"],
    ["Organiza algo especial para mis padres en Montecarlo el sábado, sin tope", "mc"],
  ];
  it.each(WISHES)("'%s': ningún texto afirma reserva, confirmación, VIP o descuento", (text, slug) => {
    const { r } = run(text, slug);
    expect(r.status).toBe("proposals");
    const all = visibleText(r);
    expect(findKeyClaims(all)).toEqual([]);
    expect(findFalseClaims(all)).toEqual([]);
  });
  it("el detector sí atrapa afirmaciones falsas (y deja pasar las negadas)", () => {
    expect(findKeyClaims("Tu mesa está reservada a las 20:00")).toEqual(["reservada"]);
    expect(findKeyClaims("Acceso VIP incluido")).toEqual(["VIP"]);
    expect(findKeyClaims("Nada está reservado ni confirmado. No son accesos VIP.")).toEqual([]);
  });
  it("solo experiencias del catálogo recibido", () => {
    const { r } = run("Tengo $10,000 MXN para celebrar un aniversario en CDMX el sábado", "cdmx");
    const known = new Set(city("cdmx").map((c) => c.id));
    expect(ids(r).every((id) => known.has(id))).toBe(true);
  });
  it("sin catálogo verificado: lo dice y no propone nada", () => {
    const wish = resolveWish("Sorpréndeme en Tokio", {}, { todayISO: TODAY });
    const r = buildKey([], wish, { todayISO: TODAY });
    expect(r.status).toBe("no_coverage");
    expect(r.proposals).toEqual([]);
    expect(r.note).toMatch(/No te propongo lugares que no hayamos podido comprobar/);
  });
  it("con poco catálogo no rellena con repeticiones: lo dice", () => {
    const few = city("cdmx").filter((c) => c.universe === "the_table").slice(0, 1);
    const wish = resolveWish("cena en CDMX mañana para 2 sin tope", {}, { todayISO: TODAY });
    const r = buildKey(few, wish, { todayISO: TODAY });
    expect(r.proposals.length).toBe(1);
    expect(r.note).toMatch(/una propuesta/);
  });
  it("un evento fuera de las fechas no entra", () => {
    const ev = priced("gala", "iconic_events", "gala", 100, "entrada", { event_start: "2027-05-01T19:00:00Z", event_end: "2027-05-01T23:00:00Z" });
    const wish = resolveWish("una gala en CDMX mañana para 2 sin tope", {}, { todayISO: TODAY });
    expect(ids(buildKey([ev], wish, { todayISO: TODAY }))).toEqual([]);
  });
  it("sin alcohol: ni bares ni casinos; con niños: nada 18+", () => {
    const cands = [priced("cena", "the_table", "bistro", 500), priced("bar", "after_dark", "cocteleria", 300), priced("show", "after_dark", "cabaret show", 400, "entrada", { age_policy: "18+" })];
    const sober = buildKey(cands, resolveWish("cena en CDMX mañana para 2, sin alcohol, sin tope", {}, { todayISO: TODAY }), { todayISO: TODAY });
    expect(ids(sober)).not.toContain("bar");
    expect(sober.proposals[0].requirements.join(" ")).not.toMatch(/Sin alcohol: se omiten/);
    const kids = buildKey(cands, resolveWish("noche en CDMX mañana con mi familia y los niños, somos 4, sin tope", {}, { todayISO: TODAY }), { todayISO: TODAY });
    expect(ids(kids)).not.toContain("show");
  });
});

describe("modos de The Key", () => {
  it("THE PERFECT 48 HOURS: dos días, sin repetir lugares", () => {
    const { r } = run("Quiero pasar 48 horas increíbles en París con mi pareja desde el 14 de noviembre, presupuesto 2000 euros", "paris");
    expect(r.wish.nights).toBe(2);
    expect(r.proposals[0].days).toBe(2);
    expect(r.proposals[0].steps.map((s) => s.date)).toEqual(expect.arrayContaining(["2026-11-14", "2026-11-15"]));
    const all = ids(r);
    expect(new Set(all).size).toBe(all.length);
  });
  it("SURPRISE ME: una sola experiencia; 'Otra sorpresa' trae otra; de noche nada de museos", () => {
    const w = resolveWish("Sorpréndeme en CDMX esta noche", {}, { todayISO: TODAY });
    const a = buildKey(city("cdmx"), w, { todayISO: TODAY, seed: "u" });
    expect(a.proposals).toHaveLength(1);
    expect(a.proposals[0].title).toBe("SURPRISE ME");
    expect(a.proposals[0].steps).toHaveLength(1);
    expect(a.proposals[0].steps[0].experience.universe).not.toBe("culture_access");
    const first = a.proposals[0].steps[0].experience.id;
    const b = buildKey(city("cdmx"), w, { todayISO: TODAY, seed: "u", exclude: [first] });
    expect(b.proposals[0].steps[0].experience.id).not.toBe(first);
  });
  it("escala corta: menos pasos y nada inventado", () => {
    const { r } = run("Tengo una escala de 5 horas en CDMX hoy, solo yo, sin tope", "cdmx");
    for (const p of r.proposals) expect(p.steps.length).toBeLessThanOrEqual(1);
  });
  it("en inglés, todo el texto generado va en inglés (los nombres de marca se quedan)", () => {
    const wish = resolveWish("An anniversary in Mexico City tomorrow for two, no budget", {}, { todayISO: TODAY, lang: "en" });
    const r = buildKey(city("cdmx"), wish, { todayISO: TODAY, lang: "en" });
    expect(r.proposals[0].subtitle).toBe("The signature");
    expect(r.proposals[0].steps[0].time_text).toMatch(/suggested · hours to be confirmed/);
    expect(r.proposals[0].narrative).toMatch(/Nothing is booked/);
  });
});

// Tipos usados en otras pruebas.
export type { Wish };
