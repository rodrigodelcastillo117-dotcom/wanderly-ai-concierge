// Evaluación del Operador con IA real DESDE EL SERVIDOR (función operador-eval): la llave no sale del servidor, solo
// administradores, tandas cortas, tope de gasto y memoria simulada. Aquí se prueba el núcleo con modelos simulados
// (sin red, sin gastar): acotar el pedido, calificar igual que la evaluación local, cortar al llegar al tope y el reloj
// fijo que se suelta siempre.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  correrTandaEval, EVAL_CANTIDAD_MAX, EVAL_TOPE_USD_MAX, leerPedidoEval,
} from "../../supabase/functions/_shared/operador/eval/servidor";
import { relojFijo } from "../../supabase/functions/_shared/operador/eval/reloj";
import { ESCENARIOS_OPERADOR } from "../../supabase/functions/_shared/operador/eval/escenarios";
import { isPaidBucket } from "../../supabase/functions/_shared/rate-limit-core";
import { modeloPolitica } from "./helpers/operadorPolitica";
import type { ModeloOperador } from "../../supabase/functions/_shared/operador/tipos";

const DateReal = globalThis.Date;
afterEach(() => { globalThis.Date = DateReal; });

describe("operador-eval · pedido", () => {
  it("acota tanda y tope; rechaza escenarios desconocidos y tandas grandes", () => {
    expect(leerPedidoEval({})).toEqual({ ok: true, pedido: { solo: [], desde: 0, cantidad: 2, tope_usd: 1 } });
    expect(leerPedidoEval({ cantidad: 50, tope_usd: 999, desde: 3 })).toEqual({ ok: true, pedido: { solo: [], desde: 3, cantidad: EVAL_CANTIDAD_MAX, tope_usd: EVAL_TOPE_USD_MAX } });
    expect(leerPedidoEval({ solo: ["v01"] })).toMatchObject({ ok: true, pedido: { solo: ["V01"] } });
    expect(leerPedidoEval({ solo: ["NO_EXISTE"] })).toMatchObject({ ok: false });
    expect(leerPedidoEval({ solo: ESCENARIOS_OPERADOR.slice(0, EVAL_CANTIDAD_MAX + 1).map((s) => s.id) })).toMatchObject({ ok: false });
    expect(leerPedidoEval({ desde: ESCENARIOS_OPERADOR.length })).toMatchObject({ ok: false });
  });
});

describe("operador-eval · tanda", () => {
  it("califica igual que la evaluación local (modelo simulado) y suma el gasto de cada llamada", async () => {
    const s = ESCENARIOS_OPERADOR[0];
    const reloj = relojFijo();
    const r = await correrTandaEval({ solo: [s.id], desde: 0, cantidad: 1, tope_usd: 1 }, { modelo: modeloPolitica(s.hechos, s.adversario), reloj });
    expect(r.escenarios).toHaveLength(1);
    expect(r.escenarios[0]).toMatchObject({ id: s.id, fallas: [], incompleto: false });
    expect(r.escenarios[0].llamadas).toBeGreaterThan(0);
    expect(r.gasto_usd).toBeGreaterThan(0);
    expect(r.resumen).toMatchObject({ sin_fallas: 1, total: 1 });
    expect(r.siguiente).toBeNull();
    // El reloj fijo se soltó.
    expect(globalThis.Date).toBe(DateReal);
  });

  it("por tandas: devuelve el índice de la siguiente", async () => {
    const lista = ESCENARIOS_OPERADOR.slice(0, 3);
    const modelo: ModeloOperador = async () => ({ ok: true, status: 200, data: { model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: "text", text: "Listo." }] } });
    const r = await correrTandaEval({ solo: [], desde: 0, cantidad: 2, tope_usd: 1 }, { modelo, reloj: relojFijo(), escenarios: lista });
    expect(r.escenarios.map((x) => x.id)).toEqual([lista[0].id, lista[1].id]);
    expect(r.siguiente).toBe(2);
    expect(r.total_escenarios).toBe(3);
  });

  it("tope de gasto: al llegar ya no llama al modelo ni empieza otro escenario", async () => {
    let llamadas = 0;
    const caro: ModeloOperador = async () => {
      llamadas++;
      return { ok: true, status: 200, data: { model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: { input_tokens: 40_000, output_tokens: 2_000 }, content: [{ type: "text", text: "Listo." }] } };
    };
    // Cada llamada cuesta 0.08 + 0.02 = 0.10 USD; tope 0.15 → la segunda llamada ya lo pasa.
    const r = await correrTandaEval({ solo: [], desde: 0, cantidad: 3, tope_usd: 0.15 }, { modelo: caro, reloj: relojFijo() });
    expect(llamadas).toBe(2);
    expect(r.gasto_usd).toBeCloseTo(0.2, 5);
    expect(r.cortado_por_tope).toBe(true);
    expect(r.escenarios.length).toBeLessThan(3);
  });
});

describe("operador-eval · reloj fijo", () => {
  it("durante el escenario new Date() y Date.now() dan la hora del escenario; al soltar vuelve el real", () => {
    const reloj = relojFijo();
    reloj.fijar(new Date("2026-10-29T14:00:00Z"));
    expect(Date.now()).toBe(Date.parse("2026-10-29T14:00:00Z"));
    expect(new Date().toISOString()).toBe("2026-10-29T14:00:00.000Z");
    expect(new Date("2026-01-01T00:00:00Z").toISOString()).toBe("2026-01-01T00:00:00.000Z");
    reloj.soltar();
    expect(globalThis.Date).toBe(DateReal);
    expect(Math.abs(Date.now() - DateReal.now())).toBeLessThan(1000);
  });
});

describe("operador-eval · la función", () => {
  const src = readFileSync(join(__dirname, "../../supabase/functions/operador-eval/index.ts"), "utf8");
  const config = readFileSync(join(__dirname, "../../supabase/config.toml"), "utf8");
  it("solo administradores (verify_jwt + public.admins), con límite de uso que falla cerrado, sin llave → 503, una a la vez", () => {
    expect(config).toMatch(/\[functions\.operador-eval\]\s*\nverify_jwt = true/);
    expect(src).toMatch(/getAuthUser\(req\)[\s\S]*from\("admins"\)[\s\S]*FORBIDDEN[\s\S]*enforceRateLimit\(req, "operador-eval"/);
    expect(isPaidBucket("operador-eval")).toBe(true);
    expect(src).toMatch(/SIN_LLAVE/);
    expect(src).toMatch(/OCUPADO/);
    // Memoria simulada: no usa la base real para la evaluación ni manda nada (solo el modelo real).
    expect(src).not.toMatch(/buildOperadorDeps|sendEmail|entregaDeps|pushToUser/);
  });
});
