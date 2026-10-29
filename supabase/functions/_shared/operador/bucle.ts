// Operador IATOS · el bucle de agente. Toma un incidente asignado a 'iato_ops' con candado (operator_claim), le da
// al modelo el expediente y las herramientas, ejecuta lo que decide (con los límites de herramientas.ts y los topes
// de la base), anota CADA acción en la bitácora y suelta el caso con su marca de agua (idempotente).
//
// Red de seguridad determinista (no depende del modelo):
//   · sin IA disponible, error, negativa del modelo, demasiadas vueltas o un tope alcanzado → pasa a una persona;
//   · salud, seguridad o caso crítico → además de ayudar, siempre pasa a una persona;
//   · si el viajero escribió y el operador no le contestó → pasa a una persona;
//   · si no queda nada prometido → fija una hora de seguimiento (ningún caso se queda sin siguiente paso).
// Puro (sin Deno).
import { addIncidentEvent, assignIncident, categoryLabel, operatorHeartbeat, setIncidentNextStep } from "../incidents.ts";
import { ejecutarHerramienta, mensajesDelViajero, nuevoContexto, OPERADOR_TOOLS, type ContextoOperador } from "./herramientas.ts";
import { costoUsd, requiereHumanoYa, type Uso } from "./politica.ts";
import { expediente, OPERADOR_SYSTEM } from "./prompt.ts";
import type { CasoTomado, OperadorDeps, ResultadoCorrida } from "./tipos.ts";

export const MAX_VUELTAS = 8;
const SEGUIMIENTO_MIN: Record<string, number> = { critica: 15, alta: 30, media: 120, baja: 360 };

type Bloque = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string };

const corto = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? null);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Una línea legible del resultado para la bitácora (el detalle va en data.operador.resultado). */
function resumenResultado(r: Record<string, unknown>): string {
  const claim = r.claim as { ref_code?: string; status?: string } | undefined;
  if (r.ok === false) return corto(r.error ?? r.mensaje ?? r.code ?? "no se pudo", 300);
  if (claim?.ref_code) return `reclamo ${claim.ref_code} (${claim.status ?? "listo"})`;
  return corto(r.nota ?? r.estado ?? r.resumen ?? "hecho", 300);
}

/** Entrada de la herramienta para la bitácora: textos recortados (la bitácora tiene tope de tamaño). */
function recortar(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).slice(0, 20).map(([k, v]) => [k, typeof v === "string" ? corto(v, 300) : typeof v === "object" ? corto(v, 300) : v]));
}

function resumenParaHumano(ctx: ContextoOperador, acciones: string[], motivo: string): string {
  const inc = ctx.caso.incident;
  const p = (inc.payload ?? {}) as Record<string, unknown>;
  return [
    `${categoryLabel(inc.category)} · severidad ${inc.severity}. ${motivo}.`,
    `Qué contó: ${corto(p.descripcion ?? inc.title, 200)}`,
    acciones.length ? `El operador ya hizo: ${acciones.join(", ")}.` : "El operador no alcanzó a hacer nada.",
    ctx.pendiente ? `Pendiente: ${corto(ctx.pendiente, 120)}` : "",
  ].filter(Boolean).join(" ").slice(0, 480);
}

async function escalar(ctx: ContextoOperador, acciones: string[], motivo: string) {
  if (ctx.escalado) return;
  const r = await assignIncident(ctx.deps.db, ctx.incidentId, { to: "humano", reason: resumenParaHumano(ctx, acciones, motivo) }, "iato_ops");
  if (r.ok || (r as { code: string }).code === "TAKEN_BY_HUMAN") ctx.escalado = true;
  else ctx.deps.warn?.("operador: no se pudo escalar", (r as { code: string }).code);
}

async function soltar(deps: OperadorDeps, id: string, patch: Record<string, unknown>) {
  const r = await deps.db.rpc("operator_release", { _id: id, _owner: deps.owner, _patch: patch });
  if (r.error || !(r.data as { ok?: boolean } | null)?.ok) deps.warn?.("operador: release falló", r.error?.message ?? JSON.stringify(r.data));
}

/** Trabaja UN caso. `motivo`: nuevo | mensaje | despertado | seguimiento | vigilante. */
export async function trabajarCaso(deps: OperadorDeps, incidentId: string, motivo = "vigilante"): Promise<ResultadoCorrida> {
  const base = { incidentId, acciones: [] as string[], gastoUsd: 0, escalado: false, mensajesAlViajero: 0 };
  const claim = await deps.db.rpc("operator_claim", { _id: incidentId, _owner: deps.owner });
  const c = claim.data as (CasoTomado | { ok: false; code: string }) | null;
  if (claim.error || !c) return { ...base, ok: false, resultado: "error", error: claim.error?.message ?? "claim" };
  if (!c.ok) {
    const code = (c as { code: string }).code;
    const resultado = code === "DISABLED" ? "apagado" : code === "LOCKED" ? "ocupado" : code === "NOT_MINE" ? "no_es_mio" : code === "STOPPED" || code === "CAP_RUNS" ? "detenido" : "error";
    return { ...base, ok: resultado !== "error", resultado, error: resultado === "error" ? code : undefined };
  }
  const caso = c as CasoTomado;
  const ahora = deps.ahora();
  const marca = Math.max(caso.case.last_event_id, ...caso.events.map((e) => e.id));
  const nuevosDelViajero = mensajesDelViajero(caso.events).filter((e) => e.id > caso.case.last_event_id);
  const nuevosEntrantes = caso.events.filter((e) => e.id > caso.case.last_event_id && e.direction === "entrante" && (e.actor === "usuario" || e.actor === "proveedor"));
  const primera = !caso.case.last_run_at;
  const seguimientoVencido = !!caso.case.follow_up_at && Date.parse(caso.case.follow_up_at) <= ahora.getTime();
  if (!primera && !nuevosEntrantes.length && !seguimientoVencido) {
    await soltar(deps, incidentId, { last_event_id: marca });
    return { ...base, ok: true, resultado: "nada_nuevo" };
  }

  const ctx = nuevoContexto(deps, caso);
  const acciones: string[] = [];
  let gasto = 0;
  const humanoYa = requiereHumanoYa(caso.incident.category, caso.incident.severity);
  let motivoEscalar: string | null = null;

  try {
    if (!deps.modelo) {
      motivoEscalar = "Sin IA disponible: lo atiende una persona";
    } else {
      const messages: Array<{ role: string; content: unknown }> = [{
        role: "user",
        content: expediente(caso, motivo, ahora, {
          humanoYa: humanoYa.si ? humanoYa.motivo : null,
          contactos: [...ctx.contactos.values()].map((k) => `${k.id}: ${k.email} (fuente: ${k.fuente.kind})`),
        }),
      }];
      let terminado = false;
      for (let vuelta = 0; vuelta < MAX_VUELTAS && !terminado; vuelta++) {
        const res = await deps.modelo({ max_tokens: 4000, system: OPERADOR_SYSTEM, tools: OPERADOR_TOOLS, messages });
        if (!res.ok || !res.data) { motivoEscalar = `La IA no respondió (${res.status})`; break; }
        const data = res.data as { content?: Bloque[]; stop_reason?: string; usage?: Uso; model?: string };
        const costo = costoUsd(data.model ?? deps.modeloNombre, data.usage);
        gasto += costo;
        const g = (await deps.db.rpc("operator_spend", { _id: incidentId, _owner: deps.owner, _kind: "modelo", _amount: costo })).data as { ok?: boolean; code?: string } | null;
        if (!g?.ok) { motivoEscalar = `Tope de gasto en IA del caso (${g?.code ?? "?"})`; break; }
        if (data.stop_reason === "refusal") { motivoEscalar = "La IA no quiso continuar con este caso"; break; }
        const content = Array.isArray(data.content) ? data.content : [];
        messages.push({ role: "assistant", content });
        const usos = content.filter((b) => b.type === "tool_use" && b.id && b.name);
        if (!usos.length) {
          const nota = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join(" ").trim();
          if (nota) {
            await addIncidentEvent(deps.db, incidentId, { kind: "decision", actor: "iato_ops", direction: "interno", body: corto(nota, 1500),
              data: { operador: { nota: true, gasto_usd: Math.round(gasto * 100000) / 100000, acciones: acciones.length } } });
          }
          terminado = true;
          break;
        }
        const resultados: Array<Record<string, unknown>> = [];
        let parar = false;
        for (const u of usos) {
          let r: Record<string, unknown>;
          const tope = (await deps.db.rpc("operator_spend", { _id: incidentId, _owner: deps.owner, _kind: "accion", _amount: 1 })).data as { ok?: boolean; code?: string } | null;
          if (!tope?.ok) {
            r = { ok: false, code: tope?.code ?? "CAP_ACCIONES", error: "Tope de acciones del caso: pasa a una persona." };
            motivoEscalar = "Tope de acciones del caso";
            parar = true;
          } else if (ctx.escalado && !["escribir_viajero", "prometer_seguimiento"].includes(u.name!)) {
            r = { ok: false, error: "El caso ya pasó a una persona: solo puedes avisar al viajero." };
          } else {
            try {
              r = await ejecutarHerramienta(u.name!, (u.input ?? {}) as Record<string, unknown>, ctx);
            } catch (e) {
              r = { ok: false, error: `falló: ${corto((e as Error)?.message ?? e, 160)}` };
            }
          }
          acciones.push(u.name!);
          ctx.conocido.push(JSON.stringify(r));
          await addIncidentEvent(deps.db, incidentId, {
            kind: u.name === "pedir_humano" ? "decision" : "accion", actor: "iato_ops", direction: "interno",
            body: `${u.name}${r.ok === false ? " (no se pudo)" : ""}: ${resumenResultado(r)}`,
            data: { operador: { herramienta: u.name, entrada: recortar(u.input ?? {}), ok: r.ok !== false,
              resultado: corto(r, 1500), n: caso.case.actions + acciones.length, gasto_usd: Math.round(gasto * 100000) / 100000 } },
          }).catch(() => null);
          resultados.push({ type: "tool_result", tool_use_id: u.id, content: corto(r, 12000), ...(r.ok === false ? { is_error: true } : {}) });
        }
        messages.push({ role: "user", content: resultados });
        if (parar) break;
        if (vuelta === MAX_VUELTAS - 1) motivoEscalar = "El operador no terminó en las vueltas permitidas";
      }
    }
  } catch (e) {
    motivoEscalar = `Error del operador: ${corto((e as Error)?.message ?? e, 120)}`;
  }

  // ── Red de seguridad ──
  if (!motivoEscalar && humanoYa.si && !ctx.escalado) motivoEscalar = humanoYa.motivo!;
  const debiaContestar = nuevosDelViajero.length > 0 || primera;
  if (!motivoEscalar && debiaContestar && ctx.mensajesViajero === 0 && !ctx.escalado && !ctx.cierrePropuesto) {
    motivoEscalar = "El viajero escribió y el operador no le contestó";
  }
  if (motivoEscalar) {
    await escalar(ctx, acciones, motivoEscalar);
    await addIncidentEvent(deps.db, incidentId, { kind: "decision", actor: "iato_ops", direction: "interno", body: `Pasa a una persona: ${motivoEscalar}`,
      data: { operador: { escalado: true, motivo: motivoEscalar, acciones: acciones.length, gasto_usd: Math.round(gasto * 100000) / 100000 } } }).catch(() => null);
  }
  let followUp: string | null = ctx.seguimiento?.due ?? null;
  if (!ctx.escalado && !ctx.seguimiento && !ctx.cierrePropuesto) {
    const due = new Date(ahora.getTime() + (SEGUIMIENTO_MIN[caso.incident.severity] ?? 120) * 60_000);
    await setIncidentNextStep(deps.db, incidentId, ctx.esperando === "proveedor" ? "Esperamos la respuesta del proveedor; te escribimos con lo que diga" : "El operador de IATOS revisa tu caso y te escribe", due, "iato_ops");
    followUp = due.toISOString();
  }
  await soltar(deps, incidentId, {
    last_event_id: marca,
    state: ctx.escalado ? "con_humano" : ctx.esperando === "usuario" ? "esperando_usuario" : ctx.esperando === "proveedor" ? "esperando_proveedor" : "activo",
    follow_up_at: ctx.escalado ? null : followUp,
    summary: corto(`${acciones.join(", ") || "sin acciones"}${motivoEscalar ? ` · a persona: ${motivoEscalar}` : ""}`, 1800),
    pending: ctx.pendiente,
    ...(motivoEscalar && /Error|IA no/.test(motivoEscalar) ? { error: motivoEscalar } : {}),
  });
  return {
    ok: true, incidentId, resultado: ctx.escalado ? "a_humano" : "trabajado", acciones, gastoUsd: Math.round(gasto * 100000) / 100000,
    escalado: ctx.escalado, mensajesAlViajero: ctx.mensajesViajero,
  };
}

// ───────────────────────────── correos programados a proveedores ─────────────────────────────
export type CorreoSaliente = { to: string; subject: string; text: string; html: string; from?: string; replyTo?: string; headers?: Record<string, string> };
export type DespachoDeps = {
  db: OperadorDeps["db"];
  enviar: (m: CorreoSaliente) => Promise<{ ok: boolean; id?: string; error?: string }>;
  remitente: string;
  dominioRespuesta: string;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const direccionOperador = (token: string, dominio: string) => {
  if (!/^[0-9a-f]{24}$/.test(token)) throw new Error("token inválido");
  return `operador+${token}@${dominio}`;
};

/** Manda los correos a proveedores que ya están en su horario. Cada uno se anota en la bitácora (operator_outbox_finish). */
export async function despacharCorreos(d: DespachoDeps, limite = 10): Promise<{ enviados: number; fallidos: number }> {
  const r = await d.db.rpc("operator_outbox_due", { _limit: limite });
  const lista = Array.isArray(r.data) ? r.data as Array<Record<string, string>> : [];
  let enviados = 0, fallidos = 0;
  for (const o of lista) {
    const res = await d.enviar({
      to: o.to_email, subject: o.subject, text: o.body, html: `<div style="font-family:sans-serif;white-space:pre-line">${esc(o.body)}</div>`,
      from: d.remitente, replyTo: direccionOperador(o.reply_token, d.dominioRespuesta), headers: { "X-IATOS-Incident": o.request_id },
    }).catch((e): { ok: boolean; id?: string; error?: string } => ({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }));
    await d.db.rpc("operator_outbox_finish", { _out_id: o.id, _ok: res.ok, _provider_id: res.id ?? null, _error: res.ok ? null : res.error ?? "error" });
    if (res.ok) enviados++; else fallidos++;
  }
  return { enviados, fallidos };
}

// ───────────────────────────── tick (vigilante / cron) ─────────────────────────────
export async function tickOperador(deps: OperadorDeps, o: { max?: number; presupuestoMs?: number; despacho?: DespachoDeps | null } = {}) {
  const on = await deps.db.rpc("operator_enabled", {});
  if (on.error || on.data !== true) return { ok: true, apagado: true, casos: [] as ResultadoCorrida[], correos: { enviados: 0, fallidos: 0 } };
  await operatorHeartbeat(deps.db);
  const inicio = Date.now();
  const due = await deps.db.rpc("operator_due", { _limit: o.max ?? 5 });
  const lista = Array.isArray(due.data) ? due.data as Array<{ id: string; reason: string }> : [];
  const casos: ResultadoCorrida[] = [];
  for (const x of lista) {
    if (Date.now() - inicio > (o.presupuestoMs ?? 45_000)) break;
    casos.push(await trabajarCaso(deps, x.id, x.reason));
  }
  const correos = o.despacho ? await despacharCorreos(o.despacho) : { enviados: 0, fallidos: 0 };
  return { ok: true, apagado: false, casos, correos };
}
