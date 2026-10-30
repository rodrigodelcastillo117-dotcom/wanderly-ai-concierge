// Vigilancia proactiva · una corrida (vigilancia-cron). Todas las dependencias llegan por parámetro (base, SerpApi,
// push/app/canal del viajero, aviso al equipo, operador, correo, clima, alertas oficiales y el reloj), así se prueba
// de punta a punta con dobles y SIN gastar SerpApi (src/test/vigilanciaE2E.test.ts).
//
// Fases (cada una se puede pedir sola):
//   vuelos          identifica vuelos (seguimiento + itinerarios), reclama los que toca revisar dentro del cupo
//                   diario, detecta eventos y, si toca, abre el incidente (origen monitor_vuelos, clave idempotente),
//                   evalúa derechos, encola el aviso urgente y despierta al Operador IA.
//   confirmaciones  reconfirmación previa con el proveedor (con consentimiento) y el incidente preventivo.
//   avisos_viaje    check-in, documentos, clima extremo y alertas oficiales nuevas (encolados una sola vez).
//   entregar        manda lo encolado, una sola vez y con tope diario de avisos no urgentes por viajero, por la MISMA
//                   entrega de canales que el Operador (_shared/channels/entrega.ts: push, Telegram, WhatsApp con su
//                   ventana de 24 h y plantillas, correo; canal preferido y no molestar de channel_prefs; urgente → ya
//                   por todos los canales).
import {
  addIncidentEvent, createIncident, type IncidentCategory, type IncidentDb, type IncidentEventInput,
} from "../incidents.ts";
import type { FlightOutcome } from "../flight-serpapi.ts";
import type { MetForecast } from "../weatherCore.ts";
import type { AdvisoryResult, AvisoFuente } from "../travelAdvisories.ts";
import { countryFromText } from "../entryRulesMx.ts";
import { safeErrorMessage } from "../redact.ts";
import {
  type CandidatoVuelo, categoriaDe, claveEvento, claveIncidente, type ConfigVigilancia, configDe, detectarEventos, type EstadoVuelo,
  evaluarDerechos, type EventoVuelo, proximaRevision, textoEvento, textoNoConcluyente, vueloDeCandidato,
} from "./vuelos.ts";
import {
  avisoCheckin, avisoClima, avisosDocumentos, type AvisoNuevo, climaPorRevisar, decidirEnvio, decidirSeguridad, noMolestarPorOmision,
  plantillaVuelo, type ViajeVentana, zonaViajero,
} from "./avisos.ts";
import { type Aviso, avisarUsuario, type EntregaDeps, folioCorto, NOMBRE_VIAJERO } from "../channels/entrega.ts";
import {
  type Confirmacion, correoConfirmacion, direccionConfirmacion, planEnvio, textoPreventivo, venceSinRespuesta,
} from "./confirmaciones.ts";

export type Fase = "vuelos" | "confirmaciones" | "avisos_viaje" | "entregar";
export const FASES: Fase[] = ["vuelos", "confirmaciones", "avisos_viaje", "entregar"];

export type CanalResultado = { canal: string; ok: boolean; detalle?: string | null };

export type VigilanciaDeps = {
  db: IncidentDb;
  /** Estado del vuelo (SerpApi con la caché compartida de 10 min y el freno de la cuenta). */
  consultarVuelo: (vuelo: string, fecha: string, ruta: string | null) => Promise<FlightOutcome>;
  /**
   * Freno global de la cuenta de SerpApi (serpBrake.ts, prioridad "normal": se detiene antes de la reserva de vuelos de
   * SERPAPI_DAILY_BUDGET / SERPAPI_MONTHLY_BUDGET, o 1 h si SerpApi dijo que no quedan búsquedas). Con freno no se
   * consulta: los vuelos se sueltan sin contarse como falla y se anota en la bitácora. Sin la dependencia, no hay freno.
   */
  frenoSerp?: () => Promise<"budget" | "quota" | null>;
  /** Aviso dentro de la app (notify_once). true si se insertó. */
  notificarApp: (n: { user_id: string; title: string; body: string; related_id: string | null; dedup_key: string }) => Promise<boolean>;
  /**
   * Entrega al viajero por sus canales: la MISMA del Operador (channels/entrega.ts → avisarUsuario). En producción,
   * entregaDeps(admin) de channels/entregaRuntime.ts.
   */
  entrega: EntregaDeps;
  /** Reparte los avisos al equipo humano de un incidente nuevo (deliverIncidentAlerts). */
  alertarEquipo: (incidentId: string) => Promise<void>;
  despertarOperador: (incidentId: string) => Promise<void>;
  operadorActivo: () => Promise<boolean>;
  enviarCorreo: (m: { to: string; subject: string; text: string; html: string; from?: string; replyTo?: string; headers?: Record<string, string> }) =>
    Promise<{ ok: boolean; id?: string; error?: string }>;
  clima?: (lat: number, lng: number) => Promise<MetForecast | null>;
  avisosOficiales?: (pais: string) => Promise<AdvisoryResult | null>;
  ahora: () => Date;
  config: { dominioRespuesta: string; remitente: string };
  log?: (...a: unknown[]) => void;
};

export type Resumen = {
  apagado?: boolean;
  vuelos: { sincronizados: number; revisados: number; consultas: number; con_dato: number; no_concluyentes: number; eventos: number;
    incidentes: number; sin_cupo: boolean; cupo?: { usados: number; tope: number; restantes: number };
    /** Freno global de SerpApi que detuvo las consultas en esta corrida. */
    freno?: "budget" | "quota" };
  confirmaciones: { nuevas: number; enviadas: number; programadas: number; sin_consentimiento: number; preventivos: number; vencidas: number };
  avisos: { encolados: number; enviados: number; esperando: number; vencidos: number };
  errores: string[];
};

const nuevoResumen = (): Resumen => ({
  vuelos: { sincronizados: 0, revisados: 0, consultas: 0, con_dato: 0, no_concluyentes: 0, eventos: 0, incidentes: 0, sin_cupo: false },
  confirmaciones: { nuevas: 0, enviadas: 0, programadas: 0, sin_consentimiento: 0, preventivos: 0, vencidas: 0 },
  avisos: { encolados: 0, enviados: 0, esperando: 0, vencidos: 0 },
  errores: [],
});

const rpc = async <T = unknown>(d: VigilanciaDeps, fn: string, args: Record<string, unknown>): Promise<T | null> => {
  const r = await d.db.rpc(fn, args);
  if (r.error) throw new Error(`${fn}: ${r.error.message}`);
  return (r.data ?? null) as T | null;
};

const diaUTC = (at: Date, dias = 0) => new Date(at.getTime() + dias * 86_400_000).toISOString().slice(0, 10);

async function evento(d: VigilanciaDeps, e: { user_id: string | null; trip_id?: string | null; ambito: string; tipo: string; clave: string; resumen: string;
  datos?: Record<string, unknown>; ref_id?: string | null; incidente_id?: string | null; visible_viajero?: boolean }): Promise<boolean> {
  const r = await rpc<{ ok?: boolean; created?: boolean }>(d, "vigilancia_evento", { _e: e });
  return r?.created === true;
}

async function encolar(d: VigilanciaDeps, a: AvisoNuevo, s: Resumen): Promise<boolean> {
  const r = await rpc<{ ok?: boolean; created?: boolean }>(d, "vigilancia_aviso_encolar", { _a: a });
  if (r?.created) s.avisos.encolados++;
  return r?.created === true;
}

// ───────────────────────────── Fase: vuelos ─────────────────────────────

type FilaVigilada = {
  id: string; user_id: string; trip_id: string | null; vuelo: string; fecha: string; origen: string | null; destino: string | null;
  zona_origen: string | null; salida_at: string | null; salida_exacta: boolean; llegada_at: string | null; estado: EstadoVuelo;
  fallas_seguidas: number; incidente_id: string | null; en_seguimiento?: boolean;
};

async function faseVuelos(d: VigilanciaDeps, cfg: ConfigVigilancia, s: Resumen) {
  const ahora = d.ahora();
  // 1) Identificar: seguimiento + itinerarios con número y fecha (de ayer a pasado mañana).
  const cands = await rpc<CandidatoVuelo[]>(d, "vigilancia_candidatos_vuelo", { _desde: diaUTC(ahora, -1), _hasta: diaUTC(ahora, 2) }) ?? [];
  const filas = cands.map((c) => vueloDeCandidato(c, ahora)).filter((x): x is NonNullable<typeof x> => !!x);
  if (filas.length) s.vuelos.sincronizados = await rpc<number>(d, "vigilancia_vuelo_upsert", { _rows: filas }) ?? 0;

  // 2) Reclamar lo que toca, dentro del cupo diario de SerpApi.
  const claim = await rpc<{ items?: FilaVigilada[]; usados?: number; tope?: number; restantes?: number; sin_cupo?: boolean }>(
    d, "vigilancia_vuelos_reclamar", { _limit: 20, _now: ahora.toISOString() });
  const items = claim?.items ?? [];
  s.vuelos.cupo = { usados: claim?.usados ?? 0, tope: claim?.tope ?? 0, restantes: claim?.restantes ?? 0 };
  if (claim?.sin_cupo) {
    s.vuelos.sin_cupo = true;
    await evento(d, { user_id: null, ambito: "sistema", tipo: "sin_cupo", clave: `sin_cupo:${diaUTC(ahora)}`,
      resumen: `Se agotó el cupo diario de SerpApi de la vigilancia (${claim.tope} búsquedas). Los vuelos pendientes se revisan mañana o al subir vigilancia_config.serp_tope_diario (sugerido según el plan: docs/ops/programar-vigilancia.sql).`,
      datos: { tope: claim.tope, usados: claim.usados } });
  }

  // 3) Revisar (un mismo vuelo y fecha, una sola consulta por corrida aunque lo sigan varias personas). Antes de cada
  //    consulta nueva se respeta el freno global de la cuenta: si está puesto no se consulta, se sueltan los vuelos que
  //    faltan (sin contarlos como falla; se revisan cuando vuelva el cupo) y se anota.
  const cache = new Map<string, Promise<FlightOutcome>>();
  for (const [i, f] of items.entries()) {
    try {
      const k = `${f.vuelo}|${f.fecha}`;
      let p = cache.get(k);
      if (!p) {
        const freno = await frenoGlobal(d);
        if (freno) {
          await sinCupoGlobal(d, s, freno, items.slice(i));
          return;
        }
      }
      s.vuelos.revisados++;
      if (!p) {
        s.vuelos.consultas++;
        p = d.consultarVuelo(f.vuelo, f.fecha, f.origen && f.destino ? `${f.origen}-${f.destino}` : null)
          .catch((e): FlightOutcome => ({ kind: "provider_error", message: safeErrorMessage(e) }));
        cache.set(k, p);
      }
      await revisarVuelo(d, cfg, f, await p, s);
    } catch (e) {
      s.errores.push(`vuelo ${f.id}: ${safeErrorMessage(e)}`);
      await d.db.rpc("vigilancia_vuelo_guardar", { _id: f.id, _p: {} });
    }
  }
}

/** Freno global de SerpApi (null = se puede consultar). Si el freno no responde, se permite (igual que serpBrake). */
async function frenoGlobal(d: VigilanciaDeps): Promise<"budget" | "quota" | null> {
  if (!d.frenoSerp) return null;
  try { return await d.frenoSerp(); } catch (e) { d.log?.("vigilancia: el freno de SerpApi no respondió", safeErrorMessage(e)); return null; }
}

const MOTIVO_FRENO: Record<"budget" | "quota", string> = {
  budget: "se llegó al tope de búsquedas de IATOS (SERPAPI_DAILY_BUDGET / SERPAPI_MONTHLY_BUDGET, menos la reserva para búsquedas de vuelos)",
  quota: "SerpApi respondió que la cuenta ya no tiene búsquedas (pausa de 1 h)",
};

/** Sin cupo global: suelta los vuelos sin contarlos como revisión ni falla y lo anota una vez al día por motivo. */
async function sinCupoGlobal(d: VigilanciaDeps, s: Resumen, freno: "budget" | "quota", pendientes: FilaVigilada[]) {
  s.vuelos.sin_cupo = true;
  s.vuelos.freno = freno;
  for (const f of pendientes) {
    const r = await d.db.rpc("vigilancia_vuelo_guardar", { _id: f.id, _p: {} });
    if (r.error) s.errores.push(`vuelo ${f.id}: ${r.error.message}`);
  }
  await evento(d, { user_id: null, ambito: "sistema", tipo: "sin_cupo_global", clave: `sin_cupo_global:${diaUTC(d.ahora())}:${freno}`,
    resumen: `Sin cupo de SerpApi: ${MOTIVO_FRENO[freno]}. No se consultó; ${pendientes.length} vuelo(s) se revisan cuando haya cupo.`,
    datos: { freno, pendientes: pendientes.length } });
}

async function revisarVuelo(d: VigilanciaDeps, cfg: ConfigVigilancia, f: FilaVigilada, o: FlightOutcome, s: Resumen) {
  const ahora = d.ahora();
  const prev = (f.estado ?? {}) as EstadoVuelo;
  if (o.kind === "quota") {
    // SerpApi sin búsquedas (o el freno la detuvo): no es una falla del vuelo ni de la fuente; se suelta y se anota.
    s.vuelos.revisados--;
    await sinCupoGlobal(d, s, "quota", [f]);
    return;
  }
  if (o.kind !== "ok") {
    // Fuente no concluyente: no se inventa nada ni se alarma. Cerca de la salida, se dice UNA vez con calma.
    s.vuelos.no_concluyentes++;
    const fallas = (f.fallas_seguidas ?? 0) + 1;
    const next = proximaRevision(f, ahora, fallas, false);
    await rpc(d, "vigilancia_vuelo_guardar", { _id: f.id, _p: {
      ultimo_resultado: o.kind, ultima_revision_at: ahora.toISOString(), fallas_seguidas: fallas, contar: true,
      proxima_revision_at: next ? next.toISOString() : null, ...(next ? {} : { activo: false, fin_motivo: "sin datos de la fuente al terminar la ventana" }),
    } });
    const salida = f.salida_at ? Date.parse(f.salida_at) : NaN;
    const cerca = Number.isFinite(salida) && salida - ahora.getTime() <= 6 * 3_600_000 && salida > ahora.getTime() - 3_600_000;
    if (fallas >= 2 && cerca) {
      const nuevo = await evento(d, { user_id: f.user_id, trip_id: f.trip_id, ambito: "vuelo", tipo: "fuente_no_concluyente", clave: `fuente:${f.id}`,
        resumen: `${f.vuelo} del ${f.fecha}: la fuente no dio un dato confiable (${o.kind}) cerca de la salida; se avisó al viajero sin alarmar.`,
        datos: { resultado: o.kind, fallas }, ref_id: f.id, visible_viajero: true });
      if (nuevo) {
        const t = textoNoConcluyente({ vuelo: f.vuelo, fecha: f.fecha });
        await encolar(d, { user_id: f.user_id, trip_id: f.trip_id, clave: `aviso:fuente:${f.id}`, tipo: "fuente", titulo: t.titulo, cuerpo: t.cuerpo,
          url: f.trip_id ? `/dashboard/viajes/${f.trip_id}` : "/dashboard/concierge", urgente: true, zona_horaria: f.zona_origen,
          expira_at: Number.isFinite(salida) ? new Date(salida).toISOString() : null, plantilla: plantillaVuelo(f.vuelo, f.fecha, t.titulo) }, s);
      }
    }
    return;
  }

  s.vuelos.con_dato++;
  const data = o.data;
  const consultado = o.fetchedAt ? new Date(o.fetchedAt) : ahora;
  const det = detectarEventos(prev, data, cfg, consultado.toISOString());
  const fila = {
    ...f,
    salida_at: data.departure_at ?? f.salida_at, salida_exacta: f.salida_exacta || !!data.departure_at, llegada_at: data.arrival_at ?? f.llegada_at,
    origen: f.origen ?? (data.origin && /^[A-Z]{3}$/.test(data.origin) ? data.origin : null),
    destino: f.destino ?? (data.destination && /^[A-Z]{3}$/.test(data.destination) ? data.destination : null),
  };
  let incidenteId = f.incidente_id;
  for (const ev of det.eventos) {
    s.vuelos.eventos++;
    const id = await procesarEvento(d, fila, ev, consultado, s);
    if (id) incidenteId = incidenteId ?? id;
  }
  const next = proximaRevision(fila, ahora, 0, det.terminado);
  await rpc(d, "vigilancia_vuelo_guardar", { _id: f.id, _p: {
    estado: det.estado, ultimo_resultado: "ok", ultima_revision_at: ahora.toISOString(), ultimo_ok_at: ahora.toISOString(), fallas_seguidas: 0, contar: true,
    salida_at: data.departure_at ?? null, salida_exacta: !!data.departure_at, llegada_at: data.arrival_at ?? null, origen: fila.origen, destino: fila.destino,
    proxima_revision_at: next ? next.toISOString() : null, incidente_id: incidenteId,
    ...(next ? {} : { activo: false, fin_motivo: det.terminado ? `vuelo ${det.estado.status}` : "terminó la ventana de vigilancia" }),
  } });
}

const ETIQUETA: Record<EventoVuelo["tipo"], string> = {
  cancelado: "cancelación", retraso: "retraso", puerta: "cambio de puerta", terminal: "cambio de terminal", desvio: "desvío",
};

/** Un evento: bitácora (una vez), incidente + derechos (si toca), aviso urgente al viajero y operador. */
async function procesarEvento(d: VigilanciaDeps, f: FilaVigilada, ev: EventoVuelo, consultado: Date, s: Resumen): Promise<string | null> {
  const ahora = d.ahora();
  const clave = claveEvento(f.id, ev);
  const nuevo = await evento(d, { user_id: f.user_id, trip_id: f.trip_id, ambito: "vuelo", tipo: ev.tipo === "cancelado" ? "vuelo_cancelado" : ev.tipo === "retraso" ? "vuelo_retrasado" : ev.tipo === "desvio" ? "vuelo_desviado" : `cambio_${ev.tipo}`,
    clave, resumen: `${f.vuelo} del ${f.fecha}: ${ETIQUETA[ev.tipo]}${ev.retrasoMin ? ` de ${ev.retrasoMin} min` : ""}${ev.antes || ev.ahora ? ` (${ev.antes ?? "—"} → ${ev.ahora ?? "—"})` : ""}. Fuente: widget de Google vía SerpApi, ${consultado.toISOString()}.`,
    datos: { evento: ev, consultado_at: consultado.toISOString() }, ref_id: f.id, visible_viajero: true });
  if (!nuevo) return null; // otra corrida ya lo procesó

  const der = evaluarDerechos(ev, f, ahora);
  let incidente: { id: string; folio: string; created: boolean; assignee: string } | null = null;
  const operador = ev.incidente ? await d.operadorActivo().catch(() => false) : false;
  const textoBase = textoEvento(ev, { vuelo: f.vuelo, fecha: f.fecha, origen: f.origen, destino: f.destino, consultado, zona: f.zona_origen, derechos: der?.resumen ?? null });

  if (ev.incidente) {
    const salida = f.salida_at ? Date.parse(f.salida_at) : NaN;
    const categoria: IncidentCategory = categoriaDe(ev.tipo);
    const r = await createIncident(d.db, {
      userId: f.user_id, categoria, origen: "monitor_vuelos", tripId: f.trip_id,
      descripcion: `Detectado por la vigilancia de IATOS: ${f.vuelo} ${f.origen ?? "?"}→${f.destino ?? "?"} del ${f.fecha}, ${ETIQUETA[ev.tipo]}${ev.retrasoMin ? ` de ${ev.retrasoMin} min` : ""}${ev.ahora && ev.tipo !== "retraso" ? ` (ahora: ${ev.ahora})` : ""}. Fuente: estado del vuelo en Google (SerpApi), consultado ${consultado.toISOString()}.`,
      idempotencyKey: claveIncidente(f.vuelo, f.fecha, ev.tipo, f.user_id),
      contexto: { horasParaVuelo: Number.isFinite(salida) ? Math.max(0, (salida - ahora.getTime()) / 3_600_000) : null, retrasoMin: ev.retrasoMin ?? null, zonaHoraria: f.zona_origen },
      refs: { vuelo: f.vuelo, fecha_vuelo: f.fecha }, ubicacion: f.zona_origen ? { zona_horaria: f.zona_origen } : null,
      playbook: ev.tipo === "cancelado" ? "vuelo_cancelado_v1" : ev.tipo === "retraso" ? "vuelo_retrasado_v1" : "vuelo_monitor_v1",
      accionesTomadas: [
        `Monitor: ${ETIQUETA[ev.tipo]} detectado en la fuente (${consultado.toISOString()})`,
        der ? `Derechos evaluados (${der.resumen.version}): ${der.resumen.regimenes.join(", ") || "sin régimen claro"}` : "Derechos: falta la ruta para evaluarlos",
        "Aviso al viajero por push, app y su canal",
      ],
      siguientePaso: ev.tipo === "cancelado" || ev.tipo === "desvio" ? "Buscamos vuelos alternativos y te escribimos con opciones" : "Seguimos vigilando tu vuelo y te avisamos de cualquier cambio",
      respuestaInmediata: textoBase.cuerpo, canal: "app",
    });
    if (r.ok) {
      incidente = { id: r.id, folio: r.folio, created: r.created, assignee: r.assignee };
      s.vuelos.incidentes += r.created ? 1 : 0;
      await addIncidentEvent(d.db, r.id, {
        kind: "nota", actor: "monitor", direction: "interno", dedupeKey: `vig:derechos:${clave}`,
        body: der ? `Derechos del pasajero (motor ${der.resumen.version}):\n${der.resumen.texto}\nQué hacer ya: ${der.resumen.ahora.join(" · ")}` : "No se evaluaron derechos: falta origen/destino del vuelo.",
        data: der ? { derechos: { caso: der.caso, resumen: der.resumen, principal: der.evaluacion.principal, reclamar: der.evaluacion.reclamar.slice(0, 3) } } : {},
      });
      if (ev.tipo === "cancelado" || ev.tipo === "desvio" || (ev.retrasoMin ?? 0) >= 240) {
        await addIncidentEvent(d.db, r.id, {
          kind: "siguiente_paso", actor: "monitor", direction: "interno", dedupeKey: `vig:alternativas:${clave}`,
          body: `Para el operador: busca vuelos alternativos ${f.origen ?? "(origen)"}→${f.destino ?? "(destino)"} para el ${f.fecha} o el día siguiente (buscar_vuelos_alternativos, una sola búsqueda) y escríbele al viajero las opciones con su fuente. No reserves ni prometas.`,
          data: { vuelo: f.vuelo, origen: f.origen, destino: f.destino, fecha: f.fecha },
        });
      }
      if (!r.created) {
        // El mismo caso (p. ej. el retraso creció): queda en su bitácora y se le escribe al viajero ahí.
        await addIncidentEvent(d.db, r.id, { kind: "mensaje", actor: "monitor", channel: "app", direction: "saliente", visibleToUser: true,
          delivery: "enviado", counterpart: "viajero", body: textoBase.cuerpo, dedupeKey: `vig:msg:${clave}` } as IncidentEventInput);
      }
      if (r.created) await d.alertarEquipo(r.id).catch((e) => s.errores.push(`alerta equipo: ${safeErrorMessage(e)}`));
      if (r.assignee === "iato_ops") await d.despertarOperador(r.id).catch(() => undefined);
    } else {
      s.errores.push(`incidente ${f.vuelo}: ${(r as { code?: string }).code}`);
    }
  } else if (f.incidente_id) {
    // Cambio de puerta/terminal con un caso abierto del mismo vuelo: a su bitácora.
    await addIncidentEvent(d.db, f.incidente_id, { kind: "nota", actor: "monitor", direction: "interno", dedupeKey: `vig:${clave}`,
      body: textoBase.corto, data: { evento: ev } });
  }

  // Vuelo que la persona sigue en tracked_flights: flight-watch-cron ya le avisó del cambio de puerta/terminal o del
  // retraso menor. Sin caso nuevo, no se repite el aviso (queda en la bitácora).
  if (!incidente && f.en_seguimiento) return null;
  const t = incidente
    ? textoEvento(ev, { vuelo: f.vuelo, fecha: f.fecha, origen: f.origen, destino: f.destino, consultado, zona: f.zona_origen,
      derechos: der?.resumen ?? null, folio: incidente.folio, operadorActivo: incidente.assignee === "iato_ops" && operador })
    : textoBase;
  await encolar(d, {
    user_id: f.user_id, trip_id: f.trip_id, clave: `aviso:${clave}`, tipo: "vuelo", titulo: t.titulo, cuerpo: t.cuerpo,
    url: incidente ? `/dashboard/concierge?tab=solicitudes&id=${incidente.id}` : f.trip_id ? `/dashboard/viajes/${f.trip_id}` : "/dashboard/concierge",
    urgente: true, zona_horaria: f.zona_origen, incidente_id: incidente?.id ?? null, plantilla: plantillaVuelo(f.vuelo, f.fecha, t.titulo),
  }, s);
  return incidente?.id ?? null;
}

// ───────────────────────────── Fase: confirmaciones ─────────────────────────────

async function faseConfirmaciones(d: VigilanciaDeps, cfg: ConfigVigilancia, s: Resumen) {
  const ahora = d.ahora();
  s.confirmaciones.nuevas = await rpc<number>(d, "vigilancia_confirmaciones_sync", { _now: ahora.toISOString() }) ?? 0;
  const lista = await rpc<Confirmacion[]>(d, "vigilancia_confirmaciones_pendientes", { _now: ahora.toISOString(), _limit: 50 }) ?? [];
  for (const c of lista) {
    try {
      if (c.estado === "enviada") {
        if (venceSinRespuesta(c, cfg, ahora)) await abrirPreventivo(d, c, "sin_respuesta", null, s);
        continue;
      }
      if (c.estado === "enviando") continue;
      const plan = planEnvio(c, cfg, ahora);
      if (plan.accion === "sin_consentimiento") {
        if (c.estado !== "sin_consentimiento") await rpc(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "sin_consentimiento" } });
        const nuevo = await evento(d, { user_id: c.user_id, trip_id: c.trip_id, ambito: "confirmacion", tipo: "sin_consentimiento", clave: `confirmacion:${c.id}:sin_consentimiento`,
          resumen: `No se contactó a ${c.proveedor}: el viajero no ha autorizado que IATOS contacte proveedores en su nombre.`, ref_id: c.id });
        if (nuevo) s.confirmaciones.sin_consentimiento++;
        continue;
      }
      if (plan.accion === "vencida") {
        await rpc(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "vencida", error: plan.motivo } });
        s.confirmaciones.vencidas++;
        await evento(d, { user_id: c.user_id, trip_id: c.trip_id, ambito: "confirmacion", tipo: "confirmacion_vencida", clave: `confirmacion:${c.id}:vencida`,
          resumen: `No se pidió reconfirmación a ${c.proveedor}: ${plan.motivo}.`, ref_id: c.id });
        continue;
      }
      if (plan.accion === "esperar") {
        if (c.estado !== "programada" || c.enviar_desde !== plan.desde.toISOString()) {
          await rpc(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "programada", enviar_desde: plan.desde.toISOString() } });
          s.confirmaciones.programadas++;
        }
        continue;
      }
      // Enviar: la base vuelve a comprobar el consentimiento en este instante.
      const lock = await rpc<{ ok?: boolean; code?: string }>(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "enviando" } });
      if (!lock?.ok) {
        if (lock?.code === "SIN_CONSENTIMIENTO") s.confirmaciones.sin_consentimiento++;
        continue;
      }
      const m = correoConfirmacion(c);
      const res = await d.enviarCorreo({ to: c.correo, subject: m.asunto, text: m.texto, html: m.html, from: d.config.remitente,
        replyTo: direccionConfirmacion(c.reply_token, d.config.dominioRespuesta), headers: { "X-IATOS-Confirmacion": c.id } })
        .catch((e): { ok: boolean; id?: string; error?: string } => ({ ok: false, error: safeErrorMessage(e) }));
      if (!res.ok) {
        await rpc(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "programada", enviar_desde: new Date(ahora.getTime() + 30 * 60_000).toISOString(), error: String(res.error ?? "error").slice(0, 300) } });
        continue;
      }
      await rpc(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: "enviada", provider_message_id: res.id ?? null, error: null } });
      s.confirmaciones.enviadas++;
      await evento(d, { user_id: c.user_id, trip_id: c.trip_id, ambito: "confirmacion", tipo: "confirmacion_enviada", clave: `confirmacion:${c.id}:enviada`,
        resumen: `Pedimos a ${c.proveedor} que reconfirme ${c.tipo === "restaurante" ? "tu mesa" : c.tipo === "traslado" ? "tu traslado" : "tu reserva"} (${plan.horaLocal ? `eran las ${plan.horaLocal} en su hora local` : "hora local del proveedor desconocida"}).`,
        datos: { correo: c.correo, fuente: c.fuente, idioma: m.idioma, asunto: m.asunto }, ref_id: c.id, visible_viajero: true });
    } catch (e) {
      s.errores.push(`confirmación ${c.id}: ${safeErrorMessage(e)}`);
    }
  }
}

/** Incidente preventivo antes de que el viajero llegue (sin respuesta, problema o respuesta poco clara). */
export async function abrirPreventivo(d: VigilanciaDeps, c: Pick<Confirmacion, "id" | "user_id" | "trip_id" | "tipo" | "proveedor" | "servicio_at" | "servicio_local" | "zona_horaria" | "referencia" | "correo">,
  motivo: "sin_respuesta" | "problema" | "ambigua", extracto: string | null, s?: Resumen): Promise<string | null> {
  const ahora = d.ahora();
  const t = textoPreventivo(c, motivo, extracto);
  const horas = (Date.parse(c.servicio_at) - ahora.getTime()) / 3_600_000;
  const r = await createIncident(d.db, {
    userId: c.user_id, categoria: "reserva_problema", origen: "proveedor", tripId: c.trip_id, descripcion: t.descripcion,
    severidad: horas <= 6 || motivo === "problema" ? "alta" : "media", idempotencyKey: `confirmacion:${c.id}`,
    refs: { proveedor: c.proveedor, reserva: c.referencia ?? null }, ubicacion: c.zona_horaria ? { zona_horaria: c.zona_horaria } : null,
    playbook: "confirmacion_previa_v1",
    accionesTomadas: [`Vigilancia: se pidió reconfirmación a ${c.proveedor} <${c.correo}>`, `Resultado: ${motivo}`],
    siguientePaso: `Asegurar ${c.tipo === "restaurante" ? "la mesa" : c.tipo === "traslado" ? "el traslado" : "la reserva"} con ${c.proveedor} antes del servicio`,
    respuestaInmediata: t.cuerpo, canal: "app",
  });
  if (!r.ok) {
    s?.errores.push(`preventivo ${c.id}: ${(r as { code?: string }).code}`);
    return null;
  }
  await rpc(d, "vigilancia_confirmacion_actualizar", { _id: c.id, _p: { estado: motivo === "sin_respuesta" ? "sin_respuesta" : "problema", incidente_id: r.id } });
  if (r.created) {
    if (s) s.confirmaciones.preventivos++;
    await evento(d, { user_id: c.user_id, trip_id: c.trip_id, ambito: "confirmacion", tipo: "incidente_preventivo", clave: `confirmacion:${c.id}:preventivo`,
      resumen: `Incidente preventivo ${r.folio}: ${t.descripcion.slice(0, 300)}`, ref_id: c.id, incidente_id: r.id, visible_viajero: true });
    await d.alertarEquipo(r.id).catch(() => undefined);
    if (r.assignee === "iato_ops") await d.despertarOperador(r.id).catch(() => undefined);
    const tz = c.zona_horaria;
    const sres: Resumen = s ?? nuevoResumen();
    await encolar(d, { user_id: c.user_id, trip_id: c.trip_id, clave: `aviso:confirmacion:${c.id}`, tipo: "confirmacion", titulo: t.titulo, cuerpo: t.cuerpo,
      url: `/dashboard/concierge?tab=solicitudes&id=${r.id}`, urgente: horas <= 12, zona_horaria: tz, incidente_id: r.id,
      expira_at: c.servicio_at }, sres);
  }
  return r.id;
}

// ───────────────────────────── Fase: avisos de viaje ─────────────────────────────

async function faseAvisosViaje(d: VigilanciaDeps, s: Resumen) {
  const ahora = d.ahora();
  const viajes = await rpc<ViajeVentana[]>(d, "vigilancia_viajes_ventana", { _now: ahora.toISOString(), _limit: 200 }) ?? [];
  const metMemo = new Map<string, Promise<MetForecast | null>>();
  const advMemo = new Map<string, Promise<AdvisoryResult | null>>();
  for (const t of viajes) {
    try {
      const tz = zonaViajero(t, ahora);
      for (const v of t.vuelos ?? []) {
        const a = avisoCheckin(t, v, v.zona_origen ?? tz, ahora);
        if (a) await encolar(d, a, s);
      }
      for (const a of avisosDocumentos(t, tz, ahora)) await encolar(d, a, s);
      if (d.clima) {
        for (const lugar of climaPorRevisar(t, ahora)) {
          const k = `${lugar.lat.toFixed(2)},${lugar.lng.toFixed(2)}`;
          if (!metMemo.has(k)) metMemo.set(k, d.clima(lugar.lat, lugar.lng).catch(() => null));
          const a = avisoClima(t, lugar, await metMemo.get(k)!, tz, ahora);
          if (a) await encolar(d, a, s);
        }
      }
      if (d.avisosOficiales) {
        const pais = countryFromText(t.pais_destino) ?? countryFromText(t.destino);
        if (pais && pais !== "MX") {
          if (!advMemo.has(pais)) advMemo.set(pais, d.avisosOficiales(pais).catch(() => null));
          const adv = await advMemo.get(pais)!;
          if (adv && adv.ok) await revisarSeguridad(d, t, (adv as Extract<AdvisoryResult, { ok: true }>).fuentes, tz, s);
        }
      }
    } catch (e) {
      s.errores.push(`viaje ${t.id}: ${safeErrorMessage(e)}`);
    }
  }
}

async function revisarSeguridad(d: VigilanciaDeps, t: ViajeVentana, fuentes: AvisoFuente[], tz: string, s: Resumen) {
  if (!fuentes.length) return;
  const hist = await rpc<Array<{ tipo: string; datos: Record<string, unknown> }>>(d, "vigilancia_eventos_trip", { _trip: t.id, _ambito: "aviso", _limit: 50 }) ?? [];
  for (const f of fuentes) {
    const ult = hist.find((h) => (h.tipo === "seguridad_linea_base" || h.tipo === "seguridad_cambio") && h.datos?.fuente === f.fuente);
    const previo = ult ? { firma: String(ult.datos.firma ?? ""), nivel: typeof ult.datos.nivel === "number" ? ult.datos.nivel : null } : null;
    const dec = decidirSeguridad(t, f, previo, tz);
    if (!dec.registrar) continue;
    const nuevo = await evento(d, { user_id: t.user_id, trip_id: t.id, ambito: "aviso", tipo: dec.registrar.tipo, clave: dec.registrar.clave,
      resumen: `${f.fuente_nombre}: ${f.nivel.etiqueta}${dec.aviso ? " (se avisa al viajero)" : " (línea base, sin aviso)"}.`, datos: dec.registrar.datos });
    if (nuevo && dec.aviso) await encolar(d, dec.aviso, s);
  }
}

// ───────────────────────────── Fase: entregar ─────────────────────────────

type AvisoReclamado = AvisoNuevo & { id: string; enviados_24h: number; expira_at: string | null; zona_horaria: string | null };

/**
 * El aviso de la cola de la vigilancia en el formato de la entrega de canales. Plantilla de WhatsApp para fuera de la
 * ventana de 24 h: la del caso si hay incidente (iatos_aviso_caso), si no la del vuelo si el aviso la trae.
 */
export function avisoDeCanales(a: AvisoReclamado): Aviso {
  const resumen = a.titulo.replace(/\s+/g, " ").trim().slice(0, 250);
  const plantilla = a.incidente_id
    ? { nombre: "iatos_aviso_caso", params: [NOMBRE_VIAJERO, folioCorto(a.incidente_id), resumen] }
    : a.plantilla ?? null;
  return {
    titulo: a.titulo, texto: a.cuerpo, url: a.url, urgente: a.urgente,
    tipo: a.incidente_id ? "caso" : ["vuelo", "fuente", "checkin"].includes(a.tipo) ? "vuelo" : "general",
    plantilla, dedupe: `vig:${a.clave}`.slice(0, 200), incidentId: a.incidente_id ?? null, expiraAt: a.expira_at ?? null,
  };
}

async function faseEntregar(d: VigilanciaDeps, cfg: ConfigVigilancia, s: Resumen) {
  const ahora = d.ahora();
  const lista = await rpc<AvisoReclamado[]>(d, "vigilancia_avisos_reclamar", { _limit: 50, _now: ahora.toISOString() }) ?? [];
  const enviadosPorUsuario = new Map<string, number>();
  const porOmision = noMolestarPorOmision(cfg);
  for (const a of lista) {
    try {
      const ya = enviadosPorUsuario.get(a.user_id) ?? 0;
      const dec = decidirEnvio(a, (a.enviados_24h ?? 0) + ya, cfg, ahora);
      if (dec.accion === "vencer") {
        await rpc(d, "vigilancia_aviso_cerrar", { _id: a.id, _estado: "vencido" });
        s.avisos.vencidos++;
        continue;
      }
      if (dec.accion === "esperar") {
        await rpc(d, "vigilancia_aviso_cerrar", { _id: a.id, _estado: "pendiente", _reprogramar: dec.hasta.toISOString() });
        s.avisos.esperando++;
        continue;
      }
      // Canal preferido, no molestar (si cae en su horario, la entrega de canales lo guarda en channel_deferred y el
      // vigilante lo manda al terminar), WhatsApp con ventana/plantilla y urgente → todos: lo decide channels/entrega.ts.
      const r = await avisarUsuario(d.entrega, a.user_id, avisoDeCanales(a), { tzPorOmision: a.zona_horaria, noMolestarPorOmision: porOmision })
        .catch((e) => ({ modo: "ya" as const, entregados: 0, resultados: [{ ok: false, channel: "email" as const, to: "error", code: "SEND_FAILED" as const, error: safeErrorMessage(e) }] }));
      if (r.modo === "vencido") {
        // Caería en su horario de no molestar y para cuando termine ya no sirve: no se manda (ni a la app).
        await rpc(d, "vigilancia_aviso_cerrar", { _id: a.id, _estado: "vencido", _canales: [{ canal: "no_molestar", ok: false, detalle: "venció antes de que terminara" }] });
        s.avisos.vencidos++;
        continue;
      }
      const app = await d.notificarApp({ user_id: a.user_id, title: a.titulo, body: a.cuerpo.slice(0, 900), related_id: a.trip_id ?? null, dedup_key: a.clave })
        .catch(() => false);
      const canales: CanalResultado[] = r.modo === "diferido"
        ? [{ canal: "diferido", ok: true, detalle: `horario de no molestar: sale ${r.hasta}` }]
        : r.resultados.map((x) => ({ canal: x.to === "push" ? "push" : x.channel === "email" ? "correo" : x.channel, ok: x.ok, detalle: x.ok ? null : x.code ?? x.error ?? null }));
      const todos = [{ canal: "app", ok: app }, ...canales];
      const llego = todos.some((c) => c.ok);
      await rpc(d, "vigilancia_aviso_cerrar", { _id: a.id, _estado: llego ? "enviado" : "sin_canal", _canales: todos });
      if (llego) {
        s.avisos.enviados++;
        if (!a.urgente) enviadosPorUsuario.set(a.user_id, ya + 1);
      }
      const resumen = r.modo === "diferido" ? `en la app; por sus canales al terminar su horario de no molestar (${r.hasta})`
        : llego ? `enviado por ${todos.filter((c) => c.ok).map((c) => c.canal).join(", ")}` : "no llegó por ningún canal";
      await evento(d, { user_id: a.user_id, trip_id: a.trip_id, ambito: "aviso", tipo: `aviso_${a.tipo}`, clave: `entregado:${a.id}`,
        resumen: `${a.titulo} · ${resumen}`, datos: { canales: todos }, incidente_id: a.incidente_id ?? null, visible_viajero: llego });
      if (a.incidente_id) {
        await addIncidentEvent(d.db, a.incidente_id, { kind: "alerta", actor: "monitor", direction: "saliente", channel: "push",
          counterpart: "viajero", body: `Aviso al viajero: ${a.titulo}`, delivery: llego ? "enviado" : "fallido", dedupeKey: `vig:entrega:${a.id}`,
          data: { canales: todos } });
      }
    } catch (e) {
      s.errores.push(`aviso ${a.id}: ${safeErrorMessage(e)}`);
    }
  }
}

// ───────────────────────────── Corrida ─────────────────────────────

export async function correrVigilancia(d: VigilanciaDeps, fases: Fase[] = FASES): Promise<Resumen> {
  const s = nuevoResumen();
  const cfg = configDe(await rpc(d, "vigilancia_cfg", {}));
  if (!cfg.enabled) return { ...s, apagado: true };
  const run = async (f: Fase, fn: () => Promise<void>) => {
    if (!fases.includes(f)) return;
    try {
      await fn();
    } catch (e) {
      s.errores.push(`${f}: ${safeErrorMessage(e)}`);
      d.log?.("vigilancia: fase", f, safeErrorMessage(e));
    }
  };
  await run("vuelos", () => faseVuelos(d, cfg, s));
  await run("confirmaciones", () => faseConfirmaciones(d, cfg, s));
  await run("avisos_viaje", () => faseAvisosViaje(d, s));
  await run("entregar", () => faseEntregar(d, cfg, s));
  return s;
}
