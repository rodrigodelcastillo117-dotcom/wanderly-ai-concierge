// Análisis en dos llamadas simultáneas (28-oct-2026): mismas propiedades repartidas, unión correcta y,
// si una parte falla, null para que analizar-viaje use la llamada única de siempre.
import { describe, expect, it } from "vitest";
import {
  CORE_TOOL_NAME, EXPERIENCE_TOOL_NAME, mergeParts, runParallelAnalysis, splitPayloads, splitTool,
} from "../../supabase/functions/analizar-viaje/parallel";

const TOOL = {
  name: "entregar_analisis_viaje",
  description: "x",
  input_schema: {
    type: "object",
    properties: { analisis_narrativo: {}, total_estimado: {}, desglose_presupuesto: {}, vuelos: {}, hospedaje: {}, itinerario: {}, restaurantes: {}, tours: {}, tips_personalizados: {}, pais_destino: {}, cruceros_alternativas: {} },
    required: ["analisis_narrativo", "total_estimado", "desglose_presupuesto", "vuelos", "hospedaje", "itinerario", "restaurantes", "tours", "tips_personalizados", "pais_destino"],
  },
};

const reply = (name: string, input: unknown) => new Response(JSON.stringify({ model: "claude-sonnet-5-5", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "tool_use", name, input }] }), { status: 200 });
const CORE = { analisis_narrativo: "ok", total_estimado: 1, desglose_presupuesto: {}, vuelos: [{ tier: "ahorro" }], hospedaje: [], tips_personalizados: [], pais_destino: "España" };
const EXP = { itinerario: [{ dia: 1 }], restaurantes: [{ nombre: "Botín" }], tours: [] };

describe("análisis en paralelo", () => {
  it("reparte todas las propiedades sin huecos ni repetidos", () => {
    const { core, experience } = splitTool(TOOL);
    const all = [...Object.keys(core.input_schema.properties), ...Object.keys(experience.input_schema.properties)].sort();
    expect(all).toEqual(Object.keys(TOOL.input_schema.properties).sort());
    expect(Object.keys(experience.input_schema.properties)).toEqual(["itinerario", "restaurantes", "tours"]);
    expect([...core.input_schema.required, ...experience.input_schema.required].sort()).toEqual([...TOOL.input_schema.required].sort());
  });

  it("cada llamada lleva el mismo prompt y una sola herramienta", () => {
    const p = splitPayloads(TOOL, "SISTEMA", "VIAJE");
    expect(p.core.messages).toEqual(p.experience.messages);
    expect(p.core.tools.map((t) => t.name)).toEqual([CORE_TOOL_NAME]);
    expect(p.experience.tools.map((t) => t.name)).toEqual([EXPERIENCE_TOOL_NAME]);
    expect(p.core.system.startsWith("SISTEMA")).toBe(true);
  });

  it("une las dos partes y corre ambas a la vez", async () => {
    let enVuelo = 0, maxEnVuelo = 0;
    const call = async (payload: Record<string, unknown>) => {
      enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
      await new Promise((r) => setTimeout(r, 20));
      enVuelo--;
      const name = (payload.tools as Array<{ name: string }>)[0].name;
      return name === CORE_TOOL_NAME ? reply(name, CORE) : reply(name, EXP);
    };
    const r = await runParallelAnalysis(call, TOOL, "S", "U");
    expect(maxEnVuelo).toBe(2);
    expect(r.analysis).toMatchObject({ vuelos: [{ tier: "ahorro" }], itinerario: [{ dia: 1 }], restaurantes: [{ nombre: "Botín" }], pais_destino: "España" });
    expect(r.responses).toHaveLength(2);
  });

  it("si una parte falla o no trae la herramienta, devuelve null y dice por qué", async () => {
    const falla = await runParallelAnalysis(async (p) => {
      const name = (p.tools as Array<{ name: string }>)[0].name;
      return name === CORE_TOOL_NAME ? reply(name, CORE) : new Response("sobrecarga", { status: 529 });
    }, TOOL, "S", "U");
    expect(falla.analysis).toBeNull();
    expect(falla.failure).toContain("experiencias: HTTP 529");
    expect(falla.responses).toHaveLength(1); // el costo de la que sí respondió se registra

    const sinTool = await runParallelAnalysis(async () => new Response(JSON.stringify({ content: [{ type: "text", text: "hola" }] })), TOOL, "S", "U");
    expect(sinTool.analysis).toBeNull();
    expect(sinTool.failure).toContain("núcleo: sin herramienta");

    const lanza = await runParallelAnalysis(async () => { throw new Error("red caída"); }, TOOL, "S", "U");
    expect(lanza.analysis).toBeNull();
    expect(lanza.failure).toContain("red caída");
  });

  it("no acepta un itinerario vacío ni partes sin vuelos", () => {
    expect(mergeParts(CORE, { ...EXP, itinerario: [] })).toBeNull();
    expect(mergeParts({ ...CORE, vuelos: undefined }, EXP)).toBeNull();
    expect(mergeParts(CORE, { itinerario: [{ dia: 1 }] })).toMatchObject({ restaurantes: [], tours: [] });
  });
});
