// Herramienta de Iato get_travel_advisory (módulo listo para conectar en concierge-chat). Sin red.
import { beforeEach, describe, expect, it, vi } from "vitest";
import govukIndex from "./fixtures/avisos/govuk_index.json";
import govukThailand from "./fixtures/avisos/govuk_thailand.json";
import stateList from "./fixtures/avisos/state_travel_advisories.json";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { GOVUK_API, SRE_URL, STATE_API, getTravelAdvisory, makeTranslator, resetAdvisoryMemo } from "../../supabase/functions/_shared/travelAdvisories";
import { ADVISORY_TOOL_DEF, runAdvisoryTool } from "../../supabase/functions/_shared/advisoryTool";
import { slimToolResult } from "../../supabase/functions/concierge-chat/tools";

const NOW = Date.parse("2026-10-28T18:00:00Z");
const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
const fetchImpl = vi.fn(async (u: string | URL) => {
  const url = String(u);
  if (url === GOVUK_API) return res(govukIndex);
  if (url === `${GOVUK_API}/thailand`) return res(govukThailand);
  if (url === STATE_API) return res(stateList);
  return res({}, 404);
}) as unknown as typeof fetch;

beforeEach(() => { resetAdvisoryMemo(); vi.mocked(fetchImpl).mockClear(); });

describe("definición de get_travel_advisory", () => {
  it("nombre, descripción y esquema en el formato neutral de toolDefs.ts", () => {
    expect(ADVISORY_TOOL_DEF.name).toBe("get_travel_advisory");
    expect(ADVISORY_TOOL_DEF.input_schema).toEqual({
      type: "object",
      properties: { pais: { type: "string", description: expect.any(String) } },
      required: ["pais"],
    });
    expect(ADVISORY_TOOL_DEF.description).toMatch(/SRE/);
    expect(ADVISORY_TOOL_DEF.description).toMatch(/británicos y estadounidenses/);
  });
});

describe("runAdvisoryTool", () => {
  it("'¿qué debo saber antes de viajar a Tailandia?': SRE, dos fuentes con nivel, fecha y enlace, e instrucciones", async () => {
    const r = await runAdvisoryTool({ pais: "Tailandia" }, { fetchImpl, store: memoryCacheStore(() => NOW), now: () => NOW });
    expect(r).toMatchObject({ ok: true, pais: "Tailandia", iso2: "TH", para_mexicanos: { url: SRE_URL } });
    if (!r.ok || !("fuentes" in r)) throw new Error("esperaba fuentes");
    expect(r.fuentes).toEqual([
      expect.objectContaining({ fuente: "GOV.UK (Foreign, Commonwealth & Development Office)", para_quien: "Aviso para ciudadanos británicos", actualizado: "2026-10-12", url: "https://www.gov.uk/foreign-travel-advice/thailand" }),
      expect.objectContaining({ fuente: "Departamento de Estado de EE. UU.", nivel: "Nivel 1 de 4: precauciones normales", actualizado: "2026-07-06" }),
    ]);
    expect(r.instrucciones).toMatch(/Empieza con la Guía del Viajero de la SRE/);
    expect(r.aviso_legal).toBe("No sustituye asesoría migratoria, legal o consular.");
    expect(r).not.toHaveProperty("puntos_es"); // sin traducción guardada: Iato resume el original
  });

  it("cabe en el contexto de Iato sin recortes (slimToolResult)", async () => {
    const r = await runAdvisoryTool({ pais: "TH" }, { fetchImpl, store: null, now: () => NOW });
    expect(JSON.stringify(r).length).toBeLessThan(6000);
    expect(slimToolResult(r)).not.toHaveProperty("truncated");
  });

  it("usa la traducción que ya guardó la tarjeta (misma caché), sin llamar a otra IA", async () => {
    const store = memoryCacheStore(() => NOW);
    const call = vi.fn(async () => ({ ok: true, model: "claude-haiku-5-5", text: JSON.stringify({ puntos: [{ texto: "Hay inundaciones graves en varias provincias, incluida Bangkok.", fuente: "govuk" }] }) }));
    await getTravelAdvisory("Tailandia", { fetchImpl, store, now: () => NOW, translate: makeTranslator(call) });
    const r = await runAdvisoryTool({ pais: "Tailandia" }, { fetchImpl, store, now: () => NOW });
    expect(call).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ puntos_es: [{ texto: "Hay inundaciones graves en varias provincias, incluida Bangkok.", fuente: "GOV.UK" }] });
  });

  it("sin país o país desconocido: no inventa, pide el país y da la SRE", async () => {
    expect(await runAdvisoryTool({}, { fetchImpl, now: () => NOW })).toMatchObject({ ok: false, error: "falta_pais" });
    const r = await runAdvisoryTool({ pais: "Narnia" }, { fetchImpl, now: () => NOW });
    expect(r).toMatchObject({ ok: false, code: "pais_no_reconocido", para_mexicanos: { url: SRE_URL } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("si las dos fuentes caen: lo dice tal cual (cero fuentes, dos fallas)", async () => {
    const down = vi.fn(async () => res({}, 500)) as unknown as typeof fetch;
    const r = await runAdvisoryTool({ pais: "Tailandia" }, { fetchImpl: down, store: null, now: () => NOW });
    expect(r).toMatchObject({ ok: true, fuentes: [] });
    if (!("fallas" in r)) throw new Error("esperaba fallas");
    expect(r.fallas).toEqual(["No pudimos consultar GOV.UK ahora.", "No pudimos consultar al Departamento de Estado ahora."]);
    expect(r.instrucciones).toMatch(/No inventes nada/);
  });
});
