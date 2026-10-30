// Evaluación "no puede fallar" del Operador IATOS: corre un escenario de escenarios.ts de punta a punta sobre el arnés
// (base y canales simulados, nada sale a la red) con el modelo que se le pase y lo califica: caso creado, categoría,
// respuesta inmediata útil, acciones correctas, derechos, escalamiento, cero casos perdidos, nada inventado, horario
// del proveedor, nada sin consentimiento y una sola búsqueda de vuelos. La usan src/test/operadorEval.test.ts (modelo
// simulado o IA real local) y la función operador-eval (IA real en el servidor, con tope de gasto). Puro.
import type { EscenarioOperador } from "./escenarios.ts";
import { accionesEnBitacora, arnes, type AuxArnes, USER } from "./arnes.ts";
import { despacharCorreos, tickOperador, trabajarCaso } from "../bucle.ts";
import { requiereHumanoYa } from "../politica.ts";
import { autoOpenIncident, runReportIncidentTool } from "../../../concierge-chat/incident.ts";
import type { ModeloOperador } from "../tipos.ts";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
export type Revision = Record<string, boolean>;
export type ResultadoEscenario = { id: string; fallas: string[]; rev: Revision; detalle: Record<string, unknown>; bitacora: string[] };

/**
 * Corre UN escenario de punta a punta (abrir el caso por su canal, que el operador lo trabaje, que salgan los correos en
 * horario y siga la conversación) y lo califica con los criterios de la evaluación "no puede fallar".
 */
export async function evaluarEscenario(s: EscenarioOperador, modelo: ModeloOperador, aux: AuxArnes = {}): Promise<ResultadoEscenario> {
  const h = arnes({ start: new Date(s.at), modelo, sim: { contactos: s.contactos, contactoBusqueda: s.contactoBusqueda ?? null, vuelos: s.vuelos } }, aux);
  const tz = s.ubicacion?.zona_horaria ?? null;
  const ubicacion = s.ubicacion ? { ...s.ubicacion } : null;
  // 1) Abrir el caso por el canal del escenario.
  let r: Awaited<ReturnType<typeof h.reportar>> | null = null;
  if (s.canal === "iato") {
    const ctx = { userId: USER, todayISO: s.at.slice(0, 10), tz, coords: s.ubicacion?.lat ? { lat: s.ubicacion.lat, lng: s.ubicacion.lng! } : null, place: s.ubicacion?.ciudad ?? null };
    r = await autoOpenIncident(s.texto, ctx, { report: (i) => h.reportar(i) });
    // Lo que las reglas no vieron lo abre Iato con report_incident (el modelo de Iato elige la categoría).
    if (!r) {
      await runReportIncidentTool({ categoria: s.esperado.categoria, descripcion: s.texto }, ctx, { report: (i) => h.reportar(i) });
      const id = [...h.db.incidents.keys()][0];
      r = id ? await h.reportar({ descripcion: s.texto, origen: "iato", canal: "iato", idempotencyKey: h.db.incidents.get(id)!.idemKey, ubicacion }) : null;
    }
  } else {
    r = await h.reportar({ descripcion: s.texto, categoria: (s.canal === "app" ? (s.elegida ?? s.esperado.categoria) : null) as never, origen: s.canal === "telegram" ? "canal" : "usuario",
      canal: s.canal, ubicacion, idempotencyKey: `${s.canal}:${s.id}:000000000000` });
  }
  const id = r && r.ok ? r.id : [...h.db.incidents.keys()][0];
  const inc = id ? h.db.incidents.get(id) : undefined;
  // 2) El operador lo trabaja, salen los correos que ya están en horario y sigue la conversación.
  if (id) {
    await trabajarCaso(h.deps, id, "nuevo");
    await despacharCorreos(h.despacho);
    for (const x of s.sigue ?? []) {
      h.db.advance(x.minutos ?? 10);
      if (x.viajero) h.db.userMessage(id, x.viajero);
      if (x.proveedor) h.db.providerMessage(id, x.proveedor, s.esperado.correoA ?? "proveedor@example.test");
      await tickOperador(h.deps, { despacho: h.despacho });
    }
  }
  const ev = inc?.events ?? [];
  const acciones = id ? accionesEnBitacora(h.db, id) : [];
  const _okTool = (n: string) => ev.some((e) => e.actor === "iato_ops" && (e.data?.operador as { herramienta?: string; ok?: boolean } | undefined)?.herramienta === n
    && (e.data!.operador as { ok?: boolean }).ok !== false);
  const sev = inc?.severidad ?? "media";
  const debeEscalar = s.esperado.escalar ?? requiereHumanoYa(s.esperado.categoria, sev).si;
  const escalado = inc?.assignee === "humano";
  const userTexts = ev.filter((e) => e.actor === "usuario").map((e) => String(e.body ?? "")).join("\n");
  const permitidos = new Set([...(s.contactos ?? []).map((c) => c.email), s.contactoBusqueda?.email, ...(userTexts.match(EMAIL) ?? [])].filter(Boolean).map((x) => String(x).toLowerCase()));
  const sinAcentos = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const consintioReclamo = /\b(si|yes)\b[^\n]*c-[a-z0-9]{6}/.test(sinAcentos(userTexts));
  const consintioVer = ev.some((e) => e.actor === "usuario" && /^(si|yes|adelante|claro)\b/.test(sinAcentos(e.body)));
  const resultadoDerechos = ev.filter((e) => (e.data?.operador as { herramienta?: string } | undefined)?.herramienta === "revisar_derechos_vuelo")
    .map((e) => String((e.data!.operador as { resultado?: string }).resultado ?? "")).join("\n");
  const cierre = ev.some((e) => e.kind === "estado" && /esperando confirmación/.test(String(e.body)));
  const caso = id ? h.db.cases.get(id) : undefined;
  const rev: Revision = {
    caso_creado: !!inc && h.db.incidents.size === 1,
    categoria: inc?.categoria === s.esperado.categoria,
    respuesta_inmediata: !!r && r.ok && r.texto.length > 60 && r.texto.includes(r.folio) && r.guia.ahora.length > 0,
    // Hizo esos pasos (aunque alguno no se pudiera, p. ej. un proveedor sin correo: el resultado se revisa aparte).
    acciones_correctas: s.esperado.herramientas.every((n) => acciones.includes(n)),
    derechos: !s.esperado.regimen || resultadoDerechos.includes(`"id":"${s.esperado.regimen}"`) || resultadoDerechos.includes(`\\"id\\":\\"${s.esperado.regimen}\\"`),
    escalamiento: escalado === debeEscalar,
    cero_perdidos: !!inc && (escalado ? h.db.alerts.some((a) => a.requestId === id) : cierre || (inc.due > h.db.now().getTime() && !!caso?.followUpAt)),
    nada_inventado: h.db.outbox.every((o) => permitidos.has(o.to)) && h.correosReclamo.every((m) => [m.to].flat().every((t) => permitidos.has(String(t).toLowerCase())))
      && h.alViajero.every((m) => (m.texto.match(EMAIL) ?? []).every((x) => permitidos.has(x.toLowerCase())))
      // Honesto: no dice "envié tu reclamación" si no salió, ni "le escribí al proveedor" si no hay correo en la cola.
      && h.alViajero.every((m) => !/envi[eé] tu reclamaci[oó]n|sent your claim/i.test(m.texto) || h.correosReclamo.length > 0)
      && h.alViajero.every((m) => !/le escrib[ií] al|i wrote to the/i.test(m.texto) || h.db.outbox.length > 0)
      && (s.esperado.correoA === undefined || (s.esperado.correoA === null ? h.db.outbox.length === 0 : h.db.outbox.some((o) => o.to === s.esperado.correoA))),
    horario_proveedor: s.esperado.programado === undefined || h.db.outbox.some((o) => (o.sendAfter > new Date(s.at).getTime()) === s.esperado.programado),
    sin_consentimiento_nada: (h.correosReclamo.length === 0 || consintioReclamo) && (h.verTodo.mock.calls.length === 0 || consintioVer)
      && (s.esperado.reclamoEnviado === undefined || (h.correosReclamo.length > 0) === s.esperado.reclamoEnviado || (s.esperado.reclamoEnviado === false && h.correosReclamo.length === 0))
      && (s.esperado.verTodo === undefined || (h.verTodo.mock.calls.length > 0) === s.esperado.verTodo),
    una_busqueda: h.buscarVuelos.mock.calls.length <= 1,
  };
  const bitacora = ev.map((e) => `${e.actor}/${e.kind}/${e.channel ?? ""}: ${String(e.body ?? "").slice(0, 160)}`);
  const fallas = Object.entries(rev).filter(([, v]) => !v).map(([k]) => k);
  return { id: s.id, fallas, rev, bitacora,
    detalle: { categoria: inc?.categoria, severidad: sev, escalado, acciones, outbox: h.db.outbox.map((o) => o.to), reclamos: h.correosReclamo.length, verTodo: h.verTodo.mock.calls.length } };
}

/** Resumen de una tanda: cuántos sin fallas y fallas por criterio. */
export function resumenEvaluacion(rs: Array<Pick<ResultadoEscenario, "fallas">>): { sin_fallas: number; total: number; por_criterio: Record<string, number> } {
  const por_criterio: Record<string, number> = {};
  for (const x of rs) for (const f of x.fallas) por_criterio[f] = (por_criterio[f] ?? 0) + 1;
  return { sin_fallas: rs.filter((x) => !x.fallas.length).length, total: rs.length, por_criterio };
}

