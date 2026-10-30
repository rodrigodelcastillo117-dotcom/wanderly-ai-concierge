// EVALUACIÓN "NO PUEDE FALLAR" del Operador IATOS: 95 escenarios de punta a punta con mocks (sin red, sin correos
// reales). Por cada uno se comprueba: caso creado (categoría), respuesta inmediata útil (guía + folio), acciones
// correctas del operador (en la bitácora), derechos correctos (régimen), escalamiento cuando corresponde, cero casos
// perdidos (siempre una persona o una hora de seguimiento), nada inventado (correos y teléfonos solo con fuente) y
// nada enviado sin consentimiento (reclamos y "ver todo").
//
// En el servidor (la llave no sale): función operador-eval, solo administradores y con tope de gasto
// (docs/ops/DIA_DE_LOVABLE.md, paso g). La corrida y la calificación viven en _shared/operador/eval/evaluar.ts.
// Modo con IA REAL local (cuesta dinero; NO correr sin permiso del dueño):
//   npm i --no-save @anthropic-ai/sdk
//   OPERADOR_EVAL_REAL=1 ANTHROPIC_API_KEY=… npx vitest run src/test/operadorEval.test.ts
//   (opcional: OPERADOR_EVAL_MODEL=claude-sonnet-5-5, OPERADOR_EVAL_SOLO=V01,T01)
// Costo estimado: ~95 escenarios × 4–8 llamadas × ~6k tokens ≈ 3–4 M tokens de entrada (≈ US$8–12 con Sonnet 5.5).
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { ESCENARIOS_OPERADOR } from "./fixtures/operadorEscenarios";
import { modeloPolitica } from "./helpers/operadorPolitica";
import { evaluarEscenario, resumenEvaluacion } from "../../supabase/functions/_shared/operador/eval/evaluar";
import type { ModeloOperador } from "../../supabase/functions/_shared/operador/tipos";

const REAL = process.env.OPERADOR_EVAL_REAL === "1";
const SOLO = (process.env.OPERADOR_EVAL_SOLO ?? "").split(",").map((x) => x.trim()).filter(Boolean);

async function modeloReal(): Promise<ModeloOperador> {
  // deno-lint-ignore no-explicit-any -- el SDK se instala solo para este modo
  const pkg = ["@anthropic-ai", "sdk"].join("/");
  const { default: Anthropic } = await import(/* @vite-ignore */ pkg) as any;
  const client = new Anthropic();
  const model = process.env.OPERADOR_EVAL_MODEL ?? "claude-sonnet-5-5";
  return async (payload) => {
    try {
      // Igual que producción (_shared/claude.ts): sin razonamiento extendido entre herramientas y respaldo del servidor.
      const msg = await client.beta.messages.create({ ...payload, model, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        thinking: { type: "between_tools" }, output_config: { effort: "medium" } });
      return { ok: true, status: 200, data: msg as Record<string, unknown> };
    } catch (e) {
      return { ok: false, status: Number((e as { status?: number }).status ?? 0), data: null };
    }
  };
}

const resultados: Array<{ id: string; fallas: string[] }> = [];
afterEach(() => { vi.useRealTimers(); });
afterAll(() => {
  const r = resumenEvaluacion(resultados);
  console.info(`EVAL operador${REAL ? " (IA REAL)" : ""}: ${r.sin_fallas}/${r.total} escenarios sin fallas${Object.keys(r.por_criterio).length ? ` · fallas por criterio: ${JSON.stringify(r.por_criterio)}` : ""}`);
});

describe(`Operador IATOS · evaluación de punta a punta (${ESCENARIOS_OPERADOR.length} escenarios${REAL ? ", IA REAL" : ", modelo simulado"})`, () => {
  it("hay 80 o más escenarios, con ids únicos, en español e inglés, con faltas y con adversarios", () => {
    expect(ESCENARIOS_OPERADOR.length).toBeGreaterThanOrEqual(80);
    expect(new Set(ESCENARIOS_OPERADOR.map((s) => s.id)).size).toBe(ESCENARIOS_OPERADOR.length);
    expect(ESCENARIOS_OPERADOR.filter((s) => s.hechos.idioma === "en").length).toBeGreaterThanOrEqual(10);
    expect(ESCENARIOS_OPERADOR.filter((s) => s.adversario).length).toBeGreaterThanOrEqual(10);
  });

  const lista = SOLO.length ? ESCENARIOS_OPERADOR.filter((s) => SOLO.includes(s.id)) : ESCENARIOS_OPERADOR;
  for (const s of lista) {
    it(`${s.id} · ${s.texto.slice(0, 70)}`, { timeout: REAL ? 300_000 : 20_000 }, async () => {
      const modelo = REAL ? await modeloReal() : modeloPolitica(s.hechos, s.adversario);
      const { fallas, detalle, bitacora, rev } = await evaluarEscenario(s, modelo, {
        espia: (f) => vi.fn(f) as never,
        fijarReloj: (inicio) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(inicio); },
      });
      vi.useRealTimers();
      if (process.env.OPERADOR_EVAL_DEBUG) console.log(JSON.stringify({ id: s.id, rev, bitacora }, null, 1));
      resultados.push({ id: s.id, fallas });
      expect({ id: s.id, fallas, ...(fallas.length ? detalle : {}) }).toEqual({ id: s.id, fallas: [] });
    });
  }
});
