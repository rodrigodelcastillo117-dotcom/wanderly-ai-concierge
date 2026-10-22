// Road trips (grupo roadtrip): avisos prácticos por país curados con fuente oficial y fecha.
import { describe, expect, it } from "vitest";
import { CURATED_ROUTES, NOTICES } from "../../supabase/functions/_shared/roadtrip/data";
import { CONSULTED_AT, SOURCES } from "../../supabase/functions/_shared/roadtrip/sources";
import { buildRoadTripPlan } from "../../supabase/functions/_shared/roadtrip/plan";

const byId = (id: string) => NOTICES.find((n) => n.id === id)!;

describe("cada aviso tiene fuente oficial verificable", () => {
  it("todas las fuentes son https, con fecha de consulta 2026-10-22", () => {
    for (const s of Object.values(SOURCES)) {
      expect(s.url, s.label).toMatch(/^https:\/\/[a-z0-9.-]+\//i);
      expect(s.consulted_at).toBe(CONSULTED_AT);
    }
    for (const n of NOTICES) expect(n.sources.length, n.id).toBeGreaterThan(0);
  });

  it("las fuentes de reglas son de gobiernos, la UE o redes oficiales (no blogs ni rentadoras)", () => {
    const official = /(gov\.uk|gouv\.fr|normattiva\.it|dgt\.es|bmv\.de|imt-ip\.pt|ch\.ch|admin\.ch|oesterreich\.gv\.at|gov\.cz|island\.is|europa\.eu|evz\.de|romamobilita\.it|visiticeland\.com)$/;
    for (const n of NOTICES) for (const s of n.sources) expect(new URL(s.url).hostname.replace(/^www\./, ""), n.id).toMatch(official);
  });
});

describe("reglas por país", () => {
  it("ZTL en Italia: multa automática por cámara y consejo del hotel", () => {
    const z = byId("it-ztl");
    expect(z.iso).toBe("IT");
    expect(z.body).toMatch(/cámara/);
    expect(z.body).toMatch(/registre tu placa/);
    expect(z.sources.map((s) => s.url)).toContain("https://www.evz.de/en/topics/transport/car/fines-abroad/ztl-italy/");
  });

  it("viñetas: Austria, Suiza y Chequia con precio oficial; Eslovenia NO (no se pudo verificar)", () => {
    expect(byId("at-vineta").prices?.tiers.find((t) => t.days === 10)?.amount).toBe(12.8);
    expect(byId("ch-vineta").prices?.tiers[0]).toMatchObject({ amount: 40 });
    expect(byId("cz-vineta").prices?.tiers.find((t) => t.days === 10)?.amount).toBe(290);
    expect(NOTICES.some((n) => n.iso === "SI" && n.kind === "vineta")).toBe(false);
  });

  it("permiso internacional para licencia mexicana donde la fuente lo pide", () => {
    expect(byId("it-licencia").body).toMatch(/permiso internacional o una traducción oficial/);
    expect(byId("it-licencia").body).toMatch(/408 € a 1,634 €/);
    expect(byId("es-licencia").body).toMatch(/permiso internacional/);
    expect(byId("fr-licencia").body).toMatch(/permiso internacional/);
    expect(byId("de-licencia").body).toMatch(/traducción al alemán/);
    expect(byId("pt-licencia").body).toMatch(/México no aparece/);
  });

  it("lado de manejo: Reino Unido e Irlanda por la izquierda", () => {
    expect(byId("gb-lado").body).toMatch(/izquierda/);
    expect(byId("ie-lado").body).toMatch(/izquierda/);
  });

  it("cruce de frontera con auto rentado (aviso general con fuente)", () => {
    expect(byId("frontera").iso).toBe("*");
    expect(byId("frontera").sources[0].url).toMatch(/evropskyspotrebitel\.gov\.cz/);
  });
});

describe("el plan muestra solo los avisos de los países por donde se maneja", () => {
  it("Toscana: ZTL y licencia de Italia; sin avisos de Reino Unido", () => {
    const p = buildRoadTripPlan({ stops: ["Florencia", "Siena"], legModes: ["coche"] })!;
    const ids = p.notices.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["it-ztl", "it-licencia"]));
    expect(ids).not.toContain("gb-lado");
    expect(ids).not.toContain("frontera");
  });
  it("Escocia: lado izquierdo y licencia de GB", () => {
    const p = buildRoadTripPlan({ stops: ["Inverness", "Ullapool"], legModes: ["coche"] })!;
    expect(p.notices.map((n) => n.id)).toEqual(expect.arrayContaining(["gb-lado", "gb-licencia"]));
  });
});

describe("rutas curadas", () => {
  it("hay 10 rutas, cada una con fuente oficial, días y mejor época etiquetada", () => {
    expect(CURATED_ROUTES.map((r) => r.id)).toEqual(["toscana", "amalfi", "dolomitas", "sicilia", "provenza", "algarve", "andalucia", "baviera", "escocia", "islandia"]);
    for (const r of CURATED_ROUTES) {
      expect(r.source.url).toMatch(/^https:\/\//);
      expect(r.stops.length).toBeGreaterThanOrEqual(2);
      expect(["fuente", "sugerencia_iatos"]).toContain(r.best_season.from);
      expect(r.days_suggested).toBeGreaterThan(0);
    }
  });
});
