// Evaluación del Operador con IA REAL en el servidor (función operador-eval): corre una TANDA corta de escenarios de
// escenarios.ts con el modelo real (la llave de Anthropic nunca sale del servidor) sobre memoria simulada (base,
// canales, proveedores y búsquedas en memoria: no se escribe en la base real ni sale ningún correo o mensaje), con
// TOPE DE GASTO por llamada y devuelve la calificación. Las tandas son cortas porque una función Edge tiene un límite
// de tiempo; se pide la siguiente con `desde = siguiente`. Puro (sin Deno): el modelo y el reloj llegan por parámetro.
import { ESCENARIOS_OPERADOR, type EscenarioOperador } from "./escenarios.ts";
import { evaluarEscenario, resumenEvaluacion } from "./evaluar.ts";
import type { Reloj } from "./reloj.ts";
import { costoUsd, type Uso } from "../politica.ts";
import type { ModeloOperador } from "../tipos.ts";

export const EVAL_TOPE_USD_POR_OMISION = 1;
export const EVAL_TOPE_USD_MAX = 5;
export const EVAL_CANTIDAD_POR_OMISION = 1;
export const EVAL_CANTIDAD_MAX = 4;

export type PedidoEval = { solo: string[]; desde: number; cantidad: number; tope_usd: number };

/** Lee y acota lo que pide el administrador. Nunca más de EVAL_CANTIDAD_MAX escenarios ni de EVAL_TOPE_USD_MAX. */
export function leerPedidoEval(body: unknown): { ok: true; pedido: PedidoEval } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const ids = new Set(ESCENARIOS_OPERADOR.map((s) => s.id));
  const solo = Array.isArray(b.solo) ? b.solo.map((x) => String(x).trim().toUpperCase()).filter(Boolean) : [];
  const raros = solo.filter((x) => !ids.has(x));
  if (raros.length) return { ok: false, error: `escenarios desconocidos: ${raros.slice(0, 5).join(", ")}` };
  if (solo.length > EVAL_CANTIDAD_MAX) return { ok: false, error: `máximo ${EVAL_CANTIDAD_MAX} escenarios por llamada` };
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const desde = Math.max(0, Math.floor(num(b.desde, 0)));
  if (desde >= ESCENARIOS_OPERADOR.length) return { ok: false, error: `desde debe ser menor que ${ESCENARIOS_OPERADOR.length}` };
  const cantidad = Math.min(EVAL_CANTIDAD_MAX, Math.max(1, Math.floor(num(b.cantidad, EVAL_CANTIDAD_POR_OMISION))));
  const tope_usd = Math.min(EVAL_TOPE_USD_MAX, Math.max(0.05, num(b.tope_usd, EVAL_TOPE_USD_POR_OMISION)));
  return { ok: true, pedido: { solo, desde, cantidad, tope_usd } };
}

export type ResultadoTanda = {
  ok: true;
  escenarios: Array<{ id: string; fallas: string[]; gasto_usd: number; llamadas: number; incompleto: boolean; detalle: Record<string, unknown>; bitacora?: string[] }>;
  resumen: { sin_fallas: number; total: number; por_criterio: Record<string, number> };
  gasto_usd: number; tope_usd: number; cortado_por_tope: boolean;
  /** Índice para pedir la siguiente tanda (null = ya no hay más). */
  siguiente: number | null; total_escenarios: number;
};

/**
 * Corre la tanda. El modelo real va envuelto con el tope: al llegar a tope_usd ya no se llama (el operador lo trata
 * como IA caída y escala a una persona, igual que en producción) y no se empieza otro escenario.
 */
export async function correrTandaEval(p: PedidoEval, d: { modelo: ModeloOperador; reloj: Reloj; escenarios?: EscenarioOperador[] }): Promise<ResultadoTanda> {
  const todos = d.escenarios ?? ESCENARIOS_OPERADOR;
  const lista = p.solo.length ? todos.filter((s) => p.solo.includes(s.id)) : todos.slice(p.desde, p.desde + p.cantidad);
  let gasto = 0;
  let llamadas = 0;
  let cortado = false;
  const modelo: ModeloOperador = async (payload) => {
    if (gasto >= p.tope_usd) { cortado = true; return { ok: false, status: 402, data: null }; }
    llamadas++;
    const r = await d.modelo(payload);
    if (r.ok && r.data) gasto += costoUsd(String(r.data.model ?? ""), r.data.usage as Uso);
    return r;
  };
  const escenarios: ResultadoTanda["escenarios"] = [];
  for (const s of lista) {
    if (gasto >= p.tope_usd) { cortado = true; break; }
    const g0 = gasto, l0 = llamadas, c0 = cortado;
    try {
      const r = await evaluarEscenario(s, modelo, { fijarReloj: d.reloj.fijar });
      escenarios.push({ id: s.id, fallas: r.fallas, gasto_usd: redondo(gasto - g0), llamadas: llamadas - l0, incompleto: cortado && !c0, detalle: r.detalle,
        ...(r.fallas.length ? { bitacora: r.bitacora.slice(-40) } : {}) });
    } catch (e) {
      escenarios.push({ id: s.id, fallas: ["error"], gasto_usd: redondo(gasto - g0), llamadas: llamadas - l0, incompleto: true,
        detalle: { error: String((e as Error)?.message ?? e).slice(0, 300) } });
    } finally {
      d.reloj.soltar();
    }
  }
  const fin = p.solo.length ? null : p.desde + escenarios.length;
  return {
    ok: true, escenarios, resumen: resumenEvaluacion(escenarios), gasto_usd: redondo(gasto), tope_usd: p.tope_usd, cortado_por_tope: cortado,
    siguiente: fin !== null && fin < todos.length ? fin : null, total_escenarios: todos.length,
  };
}

const redondo = (x: number) => Math.round(x * 100_000) / 100_000;
