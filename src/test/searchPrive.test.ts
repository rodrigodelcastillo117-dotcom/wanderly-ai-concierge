// Herramienta search_prive de Iato (supabase/functions/concierge-chat/prive.ts): con y sin sesión Privé,
// errores PRIVE_* sin filtrar nombres, intenciones → universos y plan compuesto determinista.
import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/priveMonaco.json";
import { intentsToFilters, priveCodeOf, runSearchPrive, SEARCH_PRIVE_TOOL, unavailable } from "../../supabase/functions/concierge-chat/prive";
import { prepareToolResultForModel } from "../../supabase/functions/concierge-chat/cards";

const okResult = {
  available: true, adult_confirmed: true,
  cities: [{
    query: "Mónaco", resolved: true, coverage: "COBERTURA_PARCIAL",
    city: { slug: "mc", name: "Mónaco", timezone: "Europe/Monaco", currency: "EUR", lat: 43.73, lng: 7.42 },
    items: fixture.candidates.filter((c) => c.state !== "DESACTUALIZADO"),
  }],
};

describe("search_prive sin sesión Privé", () => {
  it("no llama a la base y responde available:false sin nombres", async () => {
    const rpc = vi.fn();
    const r = await runSearchPrive({ cities: ["Mónaco"] }, { rpc, priveSession: null });
    expect(rpc).not.toHaveBeenCalled();
    expect(r).toMatchObject({ available: false, reason: "PRIVE_NO_SESSION" });
    expect(JSON.stringify(r)).not.toMatch(/Fixture/);
    expect((r as { motivo: string }).motivo).toMatch(/desbloquear/);
  });
  it("sesión inválida o vencida (error PRIVE_* de la base) → available:false con el motivo", async () => {
    for (const code of ["PRIVE_SESSION_INVALID", "PRIVE_SESSION_EXPIRED", "PRIVE_NOT_ELIGIBLE", "PRIVE_NOT_PRO"]) {
      const rpc = vi.fn(async () => ({ data: null, error: { message: code } }));
      const r = await runSearchPrive({ cities: ["Mónaco"] }, { rpc, priveSession: "tok" });
      expect(r).toMatchObject({ available: false, reason: code });
    }
  });
  it("cualquier otro error: no disponible, sin inventar", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "connection reset" } }));
    expect(await runSearchPrive({ cities: ["Mónaco"] }, { rpc, priveSession: "tok" })).toMatchObject({ available: false, reason: "PRIVE_ERROR" });
  });
  it("para el modelo, el resultado bloqueado queda como disponible:false", () => {
    const prepared = prepareToolResultForModel("search_prive", unavailable("PRIVE_NO_SESSION"));
    expect(prepared.disponible).toBe(false);
  });
});

describe("search_prive con sesión", () => {
  it("manda la sesión y los filtros a prive_search y agrupa por ciudad", async () => {
    const rpc = vi.fn(async () => ({ data: okResult, error: null }));
    const r: any = await runSearchPrive({ cities: ["Montecarlo"], intents: ["casino elegante", "paseo en barco"], date_from: "2027-06-17" },
      { rpc, priveSession: "tok-123" });
    const [fn, params] = rpc.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(fn).toBe("prive_search");
    expect(params._ps).toBe("tok-123");
    expect(params._cities).toEqual(["Montecarlo"]);
    expect(params._universes).toEqual(expect.arrayContaining(["casino_grand_nights"]));
    expect(params._keywords).toEqual(expect.arrayContaining(["barco"]));
    expect(params._date_from).toBe("2027-06-17");
    expect(r.available).toBe(true);
    expect(r.cities[0].items.length).toBeGreaterThan(0);
    const casino = r.cities[0].items.find((x: any) => x.universe === "casino_grand_nights");
    expect(casino.price).toBe("por confirmar");
    expect(casino.hours).toBe("horario por confirmar");
  });
  it("ciudad sin cobertura: lo dice y no inventa", async () => {
    const rpc = vi.fn(async () => ({ data: { available: true, cities: [{ query: "Atlantis", resolved: false, coverage: "SIN_COBERTURA_VERIFICADA", items: [] }] }, error: null }));
    const r: any = await runSearchPrive({ cities: ["Atlantis"] }, { rpc, priveSession: "tok" });
    expect(r.cities[0].nota).toMatch(/no inventes/);
  });
  it("con plan: arma la propuesta determinista del ejemplo de Mónaco", async () => {
    const rpc = vi.fn(async () => ({ data: okResult, error: null }));
    const r: any = await runSearchPrive({
      cities: ["Mónaco"], party_size: 2,
      plan: { date_from: "2027-06-17", nights: 3, request: "Quiero una cena espectacular, conocer un casino elegante, pasar una tarde en un beach club y disfrutar un paseo privado en barco.", hotel: fixture.hotel },
    }, { rpc, priveSession: "tok" });
    expect(r.plan.status).toBe("propuesta");
    expect(r.plan.template).toBe("beach_navegacion_cena");
    expect(r.plan.sin_colocar).toEqual([]);
    expect(r.plan.resumen.join("\n")).toMatch(/Fixture Paseo Privado en Barco/);
    expect(r.plan.resumen.join("\n")).toMatch(/nada está reservado/);
    expect(r.plan.resumen.every((l: string) => l.length < 400)).toBe(true); // no se corta al pasar por slimToolResult
  });
});

describe("definición y utilidades", () => {
  it("la herramienta exige ciudades y prohíbe decir reservado/VIP en su descripción", () => {
    expect(SEARCH_PRIVE_TOOL.function.parameters.required).toEqual(["cities"]);
    expect(SEARCH_PRIVE_TOOL.function.description).toMatch(/no digas reservado, confirmado, VIP/);
  });
  it("intenciones → universos y palabras clave", () => {
    const f = intentsToFilters(["una cena espectacular", "beach club", "yate"], []);
    expect(f.universes).toEqual(expect.arrayContaining(["the_table", "yacht_sea"]));
    expect(f.keywords).toEqual(expect.arrayContaining(["beach", "playa"]));
  });
  it("lee el código PRIVE_* de un mensaje de error", () => {
    expect(priveCodeOf('P0001: PRIVE_SESSION_EXPIRED')).toBe("PRIVE_SESSION_EXPIRED");
    expect(priveCodeOf("otra cosa")).toBeNull();
  });
});
