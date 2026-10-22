// Experience Planner de IATOS Privé (supabase/functions/_shared/privePlanner.ts): propuesta determinista
// con horarios con fuente, traslados ESTIMADOS, presupuesto solo con precios con fuente, requisitos,
// temporada, choques y alternativas. Caso del dueño: "Estoy en Mónaco tres noches…".
import { describe, expect, it } from "vitest";
import fixture from "./fixtures/priveMonaco.json";
import {
  estimateTransfer, matchTemplate, parseIntents, planExperiences, planSummary, seasonOpenOn, TEMPLATES, zonedIso, type Candidate,
} from "../../supabase/functions/_shared/privePlanner";

const cands = fixture.candidates as unknown as Candidate[];
const OWNER_TEXT = "Estoy en Mónaco tres noches. Quiero una cena espectacular, conocer un casino elegante, pasar una tarde en un beach club y disfrutar un paseo privado en barco.";
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

describe("ejemplo del dueño: Mónaco, tres noches", () => {
  const plan = planExperiences(cands, { dateFrom: "2027-06-17", nights: 3, partySize: 2, hotel: fixture.hotel, text: OWNER_TEXT, timeZone: "Europe/Monaco" });
  const items = plan.days.flatMap((d) => d.items);
  const byIntent = Object.fromEntries(items.map((i) => [i.intent, i]));

  it("entiende las cuatro peticiones y elige la plantilla beach club + navegación + cena", () => {
    expect(parseIntents(OWNER_TEXT)).toEqual(["cena", "casino", "beach_club", "navegacion"]);
    expect(plan.template).toBe("beach_navegacion_cena");
    expect(plan.status).toBe("propuesta");
    expect(plan.unplaced).toEqual([]);
    expect(Object.keys(byIntent).sort()).toEqual(["beach_club", "casino", "cena", "navegacion"]);
  });
  it("beach club y paseo en barco van el mismo día, en ese orden y sin encimarse", () => {
    expect(byIntent.beach_club.day).toBe(byIntent.navegacion.day);
    expect(byIntent.navegacion.start_min).toBeGreaterThanOrEqual(byIntent.beach_club.end_min + (byIntent.navegacion.transfer_before?.minutes ?? 0));
    expect(byIntent.navegacion.experience?.name).toBe("Fixture Paseo Privado en Barco"); // nunca el salón náutico
  });
  it("la cena respeta el horario publicado (cierra 22:30); si no cabe tras el barco, pasa a otro día", () => {
    const c = byIntent.cena;
    expect(c.experience?.name).toBe("Fixture Mesa Alta Cocina");
    expect(c.time_status).toBe("segun_horario_publicado");
    expect(toMin(c.start)).toBeGreaterThanOrEqual(toMin("19:30"));
    expect(c.end_min).toBeLessThanOrEqual(toMin("22:30"));
  });
  it("casino: información práctica, 18+, sin horario inventado, en otra noche", () => {
    const k = byIntent.casino;
    expect(k.time_status).toBe("horario_por_confirmar");
    expect(k.time_text).toMatch(/horario por confirmar/);
    expect(k.requirements.join(" ")).toMatch(/Edad mínima 18/);
    expect(k.requirements.join(" ")).toMatch(/no promueve ni intermedia apuestas/);
    expect(k.day).not.toBe(byIntent.beach_club.day);
  });
  it("todos los traslados son ESTIMADOS y con minutos; hay regreso al hotel", () => {
    for (const it of items) {
      expect(it.transfer_before?.label).toBe("ESTIMADO");
      expect(it.transfer_before?.minutes).toBeGreaterThan(0);
      expect(it.transfer_before?.text).toMatch(/aprox\./);
    }
    expect(plan.days.find((d) => d.items.length)?.return_to_hotel?.label).toBe("ESTIMADO");
  });
  it("presupuesto: solo precios con fuente (2 × 380 € + 1,200 € del barco); lo demás por confirmar", () => {
    expect(plan.budget.currency).toBe("EUR");
    expect(plan.budget.known_total).toBe(380 * 2 + 1200);
    expect(plan.budget.items_without_price).toBe(2);
    expect(byIntent.casino.price_text).toMatch(/Precio por confirmar/);
  });
  it("nunca usa lo DESACTUALIZADO; ofrece alternativas; dice que no reservó nada", () => {
    expect(items.some((i) => i.experience?.state === "DESACTUALIZADO")).toBe(false);
    expect(byIntent.cena.alternatives.map((a) => a.name)).toContain("Fixture Bistró del Puerto");
    expect(plan.disclaimers[0]).toMatch(/nada está reservado/);
    expect(planSummary(plan)).toMatch(/nada está reservado/);
    expect(planSummary(plan)).not.toMatch(/\breservad[oa]\b(?! ni)/i);
  });
  it("las horas se guardan con el desfase real de Mónaco (verano +02:00)", () => {
    expect(byIntent.cena.start_iso).toMatch(/^2027-06-\d{2}T\d{2}:\d{2}:00\+02:00$/);
  });
  it("es determinista", () => {
    const again = planExperiences(cands, { dateFrom: "2027-06-17", nights: 3, partySize: 2, hotel: fixture.hotel, text: OWNER_TEXT, timeZone: "Europe/Monaco" });
    expect(again).toEqual(plan);
  });
});

describe("validaciones", () => {
  it("en noviembre los beach clubs están cerrados por temporada: no se proponen y se dice por qué", () => {
    const p = planExperiences(cands, { dateFrom: "2026-11-12", nights: 3, partySize: 2, hotel: fixture.hotel, text: OWNER_TEXT, timeZone: "Europe/Monaco" });
    const u = p.unplaced.find((x) => x.intent === "beach_club");
    expect(u?.reason).toMatch(/cerrado por temporada/);
    expect(p.days.flatMap((d) => d.items).some((i) => i.intent === "beach_club")).toBe(false);
  });
  it("si alguien del grupo es menor, el casino no se propone", () => {
    const p = planExperiences(cands, { dateFrom: "2027-06-17", nights: 3, youngestAge: 16, text: "casino elegante" });
    expect(p.days.flatMap((d) => d.items)).toHaveLength(0);
    expect(p.unplaced[0].reason).toMatch(/Requiere 18\+/);
  });
  it("sin opción verificada, no inventa: lo dice", () => {
    const p = planExperiences(cands, { dateFrom: "2027-06-17", nights: 1, text: "una mañana de golf" });
    expect(p.unplaced[0]).toMatchObject({ intent: "golf" });
    expect(p.unplaced[0].reason).toMatch(/Iato no inventa/);
  });
  it("lugar cerrado ese día según su horario publicado → alternativa con horario por confirmar", () => {
    // 2027-06-16 es miércoles: la mesa de la prueba solo abre de jueves a domingo.
    const p = planExperiences(cands, { dateFrom: "2027-06-16", nights: 1, text: "una cena" });
    const c = p.days[0].items[0];
    expect(c.experience?.name).toBe("Fixture Bistró del Puerto");
    expect(c.time_status).toBe("horario_por_confirmar");
  });
  it("sin coordenadas el traslado no se calcula y lo dice", () => {
    const t = estimateTransfer({ lat: 43.7, lng: 7.4 }, { lat: null, lng: null });
    expect(t.minutes).toBeNull();
    expect(t.text).toMatch(/no calculado/);
    expect(t.label).toBe("ESTIMADO");
  });
  it("temporada: meses, reapertura y cierre", () => {
    expect(seasonOpenOn(cands[3], "2026-11-12")).toBe(false);
    expect(seasonOpenOn(cands[3], "2027-06-17")).toBe(true);
    expect(seasonOpenOn(cands[4], "2026-11-12")).toBe(false);
    expect(seasonOpenOn(cands[0], "2026-11-12")).toBeNull();
  });
});

describe("plantillas compuestas", () => {
  it("existen las ocho del dueño", () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([
      "arte_gastronomia_evento", "beach_navegacion_cena", "casino_espectaculo_regreso", "cena_espectaculo_lounge",
      "cultural_traslado_hotel", "golf_spa_restaurante", "propuesta_fotografia_cena", "restaurante_traslado_concierto",
    ].sort());
  });
  it("cena + espectáculo + lounge en una misma noche, en orden", () => {
    const p = planExperiences(cands, { dateFrom: "2027-06-18", nights: 2, template: "cena_espectaculo_lounge", hotel: fixture.hotel, timeZone: "Europe/Monaco" });
    const d1 = p.days[0].items.map((i) => i.intent);
    expect(d1).toEqual(["cena", "espectaculo", "lounge"]);
    expect(p.days[0].items[1].start_min).toBeGreaterThanOrEqual(p.days[0].items[0].end_min);
  });
  it("casino legal + espectáculo + regreso: regreso al hotel estimado", () => {
    const p = planExperiences(cands, { dateFrom: "2027-06-18", nights: 1, template: "casino_espectaculo_regreso", hotel: fixture.hotel });
    expect(p.days[0].items.map((i) => i.intent)).toEqual(["espectaculo", "casino"]);
    expect(p.days[0].return_to_hotel?.label).toBe("ESTIMADO");
  });
  it("reconoce la plantilla por lo que pide el usuario", () => {
    expect(matchTemplate(parseIntents("golf, spa y luego un restaurante"))).toBe("golf_spa_restaurante");
  });
});

describe("zonas horarias", () => {
  it("Mónaco invierno +01:00, verano +02:00 y madrugada al día siguiente", () => {
    expect(zonedIso("2026-11-12", "20:00", "Europe/Monaco")).toBe("2026-11-12T20:00:00+01:00");
    expect(zonedIso("2027-06-17", "20:00", "Europe/Monaco")).toBe("2027-06-17T20:00:00+02:00");
    expect(zonedIso("2027-06-17", "25:30", "Europe/Monaco")).toBe("2027-06-18T01:30:00+02:00");
    expect(zonedIso("2026-11-12", "20:00", "America/Mexico_City")).toBe("2026-11-12T20:00:00-06:00");
  });
});
