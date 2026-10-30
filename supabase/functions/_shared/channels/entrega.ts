// Avisos al VIAJERO (Operador y vigilancia de vuelos) por sus canales, respetando sus preferencias. Puro (sin Deno).
//
//   · Lee a dónde se le puede avisar (channel_targets): preferencias, chats vinculados con su ventana de 24 h y correo.
//   · Decide con planDeEntrega (preferencias.ts): urgente → todos los canales ya; normal en no molestar → cola
//     channel_deferred hasta que termine; normal → el preferido y, si falla, el siguiente.
//   · WhatsApp: dentro de la ventana, texto; fuera, la plantilla aprobada del aviso (iatos_aviso_caso / iatos_aviso_vuelo).
//     Sin plantilla, fuera de la ventana no se manda nada por WhatsApp (se intenta el siguiente canal).
//   · Normal y nada salió: correo de respaldo (nunca se queda sin aviso).
//   · Un aviso con fecha de caducidad (expiraAt) no se guarda para después si al terminar el no molestar ya no sirve.
//   · Quien llama puede dar una zona y un horario de no molestar POR OMISIÓN (la vigilancia: la zona donde está el
//     viajero y su horario 21–08 h); solo aplican si el viajero nunca guardó sus preferencias.
import type { ChannelSendResult } from "./types.ts";
import type { IncidentDb } from "../incidents.ts";
import { type CanalDisponible, horaValida, normalizarPreferencias, planDeEntrega, type PreferenciasCanal, zonaValida } from "./preferencias.ts";
import type { WhatsAppProveedor } from "./whatsapp.ts";

export type Aviso = {
  titulo: string;
  texto: string;
  /** Ruta de la app ("/dashboard/…") para abrir el detalle. */
  url: string;
  urgente: boolean;
  tipo: "caso" | "vuelo" | "general";
  /** Plantilla de WhatsApp para fuera de la ventana de 24 h. */
  plantilla?: { nombre: string; params: string[]; idioma?: string } | null;
  /** Llave única del aviso (no se encola dos veces). */
  dedupe: string;
  incidentId?: string | null;
  /** Después de este instante el aviso ya no sirve: no se guarda para después ni se entrega tarde. */
  expiraAt?: string | null;
};

/** En los parámetros de una plantilla, se cambia por el primer nombre del viajero (channel_targets.name). */
export const NOMBRE_VIAJERO = "{nombre}";
/** Margen: un aviso diferido debe poder entregarse al menos 15 min antes de que caduque. */
const MARGEN_CADUCIDAD_MS = 15 * 60_000;

export type OpcionesAviso = {
  ignorarNoMolestar?: boolean;
  /** Zona si el viajero no guardó una (p. ej. la del destino mientras viaja). */
  tzPorOmision?: string | null;
  /** Horario de no molestar si el viajero NUNCA guardó preferencias (sin fila en channel_prefs). */
  noMolestarPorOmision?: { inicio: string; fin: string } | null;
};

export type EntregaDeps = {
  db: IncidentDb;
  siteUrl: string;
  push: (userId: string, p: { title: string; body: string; url: string }, urgente: boolean) => Promise<number>;
  telegram?: ((chatId: string, texto: string) => Promise<ChannelSendResult>) | null;
  whatsapp?: WhatsAppProveedor | null;
  email?: ((to: string, asunto: string, texto: string) => Promise<ChannelSendResult>) | null;
  ahora?: () => Date;
};

export type ResultadoEntrega = { modo: "ya" | "diferido" | "vencido"; entregados: number; resultados: ChannelSendResult[]; hasta?: string };

type Targets = { prefs?: unknown; links?: Array<{ channel?: string; external_id?: string; window_open?: boolean }>; email?: string | null; name?: string | null };

/** Preferencias guardadas del viajero, completadas con las de quien llama SOLO donde él no eligió nada. */
export function preferenciasConOmision(raw: unknown, o: OpcionesAviso = {}): PreferenciasCanal {
  const prefs = normalizarPreferencias(raw);
  if (!prefs.tz && zonaValida(o.tzPorOmision)) prefs.tz = o.tzPorOmision;
  // channel_prefs_get trae updated_at solo si hay fila: sin fila = nunca eligió (una fila sin horario = eligió "sin horario").
  const guardo = !!(raw && typeof raw === "object" && (raw as Record<string, unknown>).updated_at);
  const pm = o.noMolestarPorOmision;
  if (!guardo && !prefs.noMolestarInicio && pm && horaValida(pm.inicio) && horaValida(pm.fin) && pm.inicio !== pm.fin) {
    prefs.noMolestarInicio = pm.inicio;
    prefs.noMolestarFin = pm.fin;
  }
  return prefs;
}

const primerNombre = (n: unknown) => String(n ?? "").trim().split(/\s+/)[0] || "viajero";

export async function avisarUsuario(d: EntregaDeps, userId: string, a: Aviso, o: OpcionesAviso = {}): Promise<ResultadoEntrega> {
  const ahora = d.ahora?.() ?? new Date();
  const t = await d.db.rpc("channel_targets", { _user: userId });
  const tg = (t.data ?? {}) as Targets;
  const prefs = preferenciasConOmision(tg.prefs, o);
  const links = Array.isArray(tg.links) ? tg.links : [];
  const disponibles: CanalDisponible[] = [{ canal: "push", destino: "push" }];
  const tgLink = links.find((l) => l.channel === "telegram" && l.external_id);
  const waLink = links.find((l) => l.channel === "whatsapp" && l.external_id);
  if (tgLink && d.telegram) disponibles.push({ canal: "telegram", destino: String(tgLink.external_id) });
  if (waLink && d.whatsapp && (waLink.window_open || a.plantilla)) disponibles.push({ canal: "whatsapp", destino: String(waLink.external_id), ventanaAbierta: !!waLink.window_open });
  if (tg.email && d.email) disponibles.push({ canal: "email", destino: tg.email });

  const plan = planDeEntrega({ prefs: o.ignorarNoMolestar ? { ...prefs, noMolestarInicio: null, noMolestarFin: null } : prefs, urgente: a.urgente, ahora, disponibles });
  if (plan.modo === "diferir") {
    const expira = a.expiraAt ? Date.parse(a.expiraAt) : NaN;
    if (Number.isFinite(expira) && plan.hasta.getTime() + MARGEN_CADUCIDAD_MS >= expira) return { modo: "vencido", entregados: 0, resultados: [] };
    const r = await d.db.rpc("channel_deferred_add", { _user: userId, _payload: a, _send_after: plan.hasta.toISOString(), _dedupe: a.dedupe });
    if (!r.error) return { modo: "diferido", entregados: 0, resultados: [], hasta: plan.hasta.toISOString() };
    // Si no se pudo encolar, mejor avisar ya que perder el aviso.
  }
  const intentos = plan.modo === "ya" ? plan.intentos : disponibles;
  const todos = plan.modo === "ya" ? plan.todos : false;
  const url = `${d.siteUrl.replace(/\/$/, "")}${a.url}`;
  const texto = `${a.texto}\n\n${url}`;
  const resultados: ChannelSendResult[] = [];
  let entregados = 0;

  const enviar = async (c: CanalDisponible): Promise<ChannelSendResult> => {
    switch (c.canal) {
      case "push": {
        const n = await d.push(userId, { title: a.titulo.slice(0, 80), body: a.texto.slice(0, 180), url: a.url }, a.urgente).catch(() => 0);
        return n > 0 ? { ok: true, channel: "email", to: "push", providerMessageId: null } : { ok: false, channel: "email", to: "push", code: "SEND_FAILED", error: "sin suscripción push" };
      }
      case "telegram":
        return d.telegram!(c.destino, `${a.titulo}\n\n${texto}`);
      case "whatsapp":
        if (c.ventanaAbierta) return d.whatsapp!.texto(c.destino, `*${a.titulo}*\n\n${texto}`);
        return a.plantilla ? d.whatsapp!.plantilla(c.destino, a.plantilla.nombre, a.plantilla.params.map((p) => p === NOMBRE_VIAJERO ? primerNombre(tg.name) : p), a.plantilla.idioma ?? "es_MX")
          : { ok: false, channel: "whatsapp", to: c.destino, code: "CHANNEL_OFF", error: "ventana cerrada y sin plantilla" };
      case "email":
        return d.email!(c.destino, a.titulo, texto);
    }
  };

  for (const c of intentos) {
    const r = await enviar(c).catch((e) => ({ ok: false, channel: c.canal === "push" ? "email" : c.canal, to: c.destino, code: "SEND_FAILED", error: String((e as Error)?.message ?? e).slice(0, 120) }) as ChannelSendResult);
    resultados.push(r);
    if (r.ok) entregados++;
    if (r.ok && !todos) break;
  }
  // Respaldo: un aviso normal que no salió por ningún lado va por correo.
  if (!entregados && tg.email && d.email && !intentos.some((c) => c.canal === "email")) {
    const r = await d.email(tg.email, a.titulo, texto).catch(() => null);
    if (r) { resultados.push(r); if (r.ok) entregados++; }
  }
  return { modo: "ya", entregados, resultados };
}

/** Entrega los avisos diferidos que ya vencieron (el horario de no molestar terminó). Lo llama el vigilante. */
export async function entregarDiferidos(d: EntregaDeps, limite = 50): Promise<{ procesados: number; enviados: number }> {
  const r = await d.db.rpc("channel_deferred_due", { _limit: limite });
  const filas = Array.isArray(r.data) ? r.data as Array<{ id: number; user_id: string; payload: Aviso }> : [];
  let enviados = 0;
  const ahora = d.ahora?.() ?? new Date();
  for (const f of filas) {
    let ok = false;
    let error: string | null = null;
    const expira = f.payload?.expiraAt ? Date.parse(f.payload.expiraAt) : NaN;
    if (Number.isFinite(expira) && ahora.getTime() >= expira) {
      // Ya no sirve (p. ej. el recordatorio de check-in de un vuelo que ya salió): se cierra sin mandarlo ni reintentar.
      await d.db.rpc("channel_deferred_finish", { _id: f.id, _ok: true, _error: "vencido: no se entregó" });
      continue;
    }
    try {
      const x = await avisarUsuario(d, f.user_id, { ...f.payload, dedupe: `${f.payload?.dedupe ?? "diferido"}:entrega` }, { ignorarNoMolestar: true });
      ok = x.entregados > 0;
      if (!ok) error = x.resultados.map((y) => `${y.channel}:${y.code ?? "?"}`).join(",").slice(0, 300) || "sin canales";
    } catch (e) {
      error = String((e as Error)?.message ?? e).slice(0, 300);
    }
    await d.db.rpc("channel_deferred_finish", { _id: f.id, _ok: ok, _error: error });
    if (ok) enviados++;
  }
  return { procesados: filas.length, enviados };
}

/** Folio corto de un caso para las plantillas. */
export const folioCorto = (id: string) => String(id ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase();
