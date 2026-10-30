// Iato en nombre del viajero vinculado (IatoCanal de conversacion.ts). Puro: fetch, sesión y firma por parámetro.
//
// Cada operación abre una sesión REAL del viajero (sesionUsuario.ts), llama a las mismas funciones que usa la app con su
// JWT (RLS, plan, cuotas, honestidad) y la cierra al terminar:
//   · conversar → concierge-chat (stream:false) con las últimas líneas de SU conversación (concierge_conversations, por
//     RLS solo las suyas), su ubicación compartida y la firma canal_<canal> atada a su user_id.
//   · ejecutar  → concierge-chat mode=action (vuelve a validar la acción con sus viajes de hoy; idempotente por botón).
//   · ticket    → sube la foto a trip-receipts/<viaje>/<él>/… con SU sesión (políticas de Storage), la lee scan-receipt,
//                 borra la foto (el gasto de Iato no la guarda) y propone "Registrar gasto" para confirmar con un botón.
import type { AccionIato, CanalConversacion, RespuestaIato } from "./formato.ts";
import type { IatoCanal, ResultadoIato } from "./conversacion.ts";
import { MENSAJE_SIN_SESION, type SesionCanal } from "./sesionUsuario.ts";
import { INTERNAL_HEADER } from "../internalCall.ts";

export type IatoCanalDeps = {
  supabaseUrl: string;
  anonKey: string;
  canal: CanalConversacion;
  sesion: (userId: string) => Promise<SesionCanal>;
  /** x-iatos-internal para ESTE usuario (signInternal con la llave de servicio). */
  firmar: (userId: string) => Promise<string | null>;
  /** Zona del viajero (sus preferencias) para "hoy". */
  zona?: (userId: string) => Promise<string | null>;
  fetch?: typeof fetch;
  ahora?: () => Date;
  log?: (...a: unknown[]) => void;
};

const TZ_DEF = "America/Mexico_City";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hoyEn(tz: string, ahora: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
  } catch {
    return ahora.toISOString().slice(0, 10);
  }
}

type Viaje = { id: string; destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null };

/** Viaje para un ticket: el que está en curso → el fijado → el próximo → el último (≤ 30 días). null si no hay. */
export function elegirViajeParaGasto(viajes: Viaje[], fijado: string | null, hoy: string): Viaje | null {
  const v = viajes.filter((t) => UUID.test(String(t.id)));
  const enCurso = v.filter((t) => t.fecha_salida && t.fecha_salida <= hoy && (t.fecha_regreso ?? t.fecha_salida) >= hoy);
  if (enCurso.length) return enCurso.find((t) => t.id === fijado) ?? enCurso[0];
  const pin = v.find((t) => t.id === fijado);
  if (pin) return pin;
  const prox = v.filter((t) => t.fecha_salida && t.fecha_salida > hoy).sort((a, b) => String(a.fecha_salida).localeCompare(String(b.fecha_salida)));
  if (prox.length) return prox[0];
  const hace30 = new Date(Date.parse(`${hoy}T12:00:00Z`) - 30 * 86400_000).toISOString().slice(0, 10);
  const pasados = v.filter((t) => (t.fecha_regreso ?? t.fecha_salida ?? "") >= hace30).sort((a, b) => String(b.fecha_regreso ?? b.fecha_salida).localeCompare(String(a.fecha_regreso ?? a.fecha_salida)));
  return pasados[0] ?? null;
}

const MSG_ERROR = "No pude responderte ahora. Inténtalo de nuevo en un momento o sigue en la app.";

export function crearIatoCanal(d: IatoCanalDeps): IatoCanal {
  const f = d.fetch ?? fetch;
  const base = d.supabaseUrl.replace(/\/$/, "");
  const ahora = () => d.ahora?.() ?? new Date();

  async function conSesion<T>(userId: string, fn: (h: Record<string, string>, tz: string) => Promise<T>, sinSesion: (m: string) => T): Promise<T> {
    const s = await d.sesion(userId);
    if (!s.ok) return sinSesion(MENSAJE_SIN_SESION[s.code]);
    try {
      const firma = await d.firmar(userId);
      const tz = (await d.zona?.(userId).catch(() => null)) ?? TZ_DEF;
      return await fn({ Authorization: `Bearer ${s.token}`, apikey: d.anonKey, ...(firma ? { [INTERNAL_HEADER]: firma } : {}) }, tz);
    } finally {
      await s.cerrar();
    }
  }

  const rest = async (h: Record<string, string>, path: string) => {
    const r = await f(`${base}/rest/v1/${path}`, { headers: { Authorization: h.Authorization, apikey: h.apikey, Accept: "application/json" }, signal: AbortSignal.timeout(6_000) });
    return r.ok ? await r.json().catch(() => null) : null;
  };

  return {
    async conversar(userId, p): Promise<ResultadoIato> {
      return conSesion<ResultadoIato>(userId, async (h, tz) => {
        // Memoria: la última conversación del viajero (app o chat), solo lo suyo por RLS.
        const conv = await rest(h, "concierge_conversations?select=trip_id,messages,updated_at&order=updated_at.desc&limit=1").catch(() => null) as Array<{ trip_id?: string | null; messages?: unknown; updated_at?: string }> | null;
        const ult = Array.isArray(conv) ? conv[0] : null;
        const historial = (Array.isArray(ult?.messages) ? ult!.messages as Array<{ role?: string; content?: unknown }> : [])
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
          .slice(-8).map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
        const reciente = ult?.updated_at && ahora().getTime() - Date.parse(ult.updated_at) < 12 * 3600_000;
        const body = {
          messages: [...historial, { role: "user", content: p.texto.slice(0, 4000) }],
          ...(reciente && ult?.trip_id && UUID.test(ult.trip_id) ? { trip_id: ult.trip_id } : {}),
          client_date: hoyEn(tz, ahora()), tz, stream: false,
          ...(p.coords ? { context: { coords: p.coords } } : {}),
        };
        const r = await f(`${base}/functions/v1/concierge-chat`, {
          method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(75_000),
        });
        const j = await r.json().catch(() => null) as (RespuestaIato & { message?: string; code?: string; error?: string }) | null;
        if (r.ok && j && typeof j.text === "string") return { ok: true, reply: { text: j.text, cards: Array.isArray(j.cards) ? j.cards : [], actions: Array.isArray(j.actions) ? j.actions : [] } };
        // Cuota del plan gratis, límite de ritmo o IA no disponible: el mensaje de concierge-chat ya está en español.
        const msg = typeof j?.message === "string" && j.message.trim() ? j.message.trim() : MSG_ERROR;
        d.log?.("iato canal", r.status, j?.code ?? null);
        return { ok: false, mensaje: r.status === 402 || j?.code === "FREE_LIMIT_REACHED" ? `${msg} Puedes pasarte a PRO en la app (Perfil → Plan).` : msg, code: j?.code ?? `HTTP_${r.status}` };
      }, (m) => ({ ok: false, mensaje: m, code: "SIN_SESION" }));
    },

    async ejecutar(userId, accion, ref) {
      return conSesion(userId, async (h, tz) => {
        const r = await f(`${base}/functions/v1/concierge-chat`, {
          method: "POST", headers: { ...h, "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "action", action: { type: accion.type, params: accion.params ?? {} }, ...(accion.id ? { action_id: accion.id } : {}),
            idempotency_key: `canal-${ref}`.slice(0, 80), client_date: hoyEn(tz, ahora()), tz }),
          signal: AbortSignal.timeout(50_000),
        });
        const j = await r.json().catch(() => null) as { ok?: boolean; message?: string; link?: string } | null;
        return { ok: r.ok && j?.ok === true, mensaje: String(j?.message ?? (r.ok ? "Listo." : "No pude hacerlo ahora.")).slice(0, 500), link: j?.link ?? null };
      }, (m) => ({ ok: false, mensaje: m, link: null }));
    },

    async ticket(userId, archivo, nota) {
      return conSesion(userId, async (h, tz) => {
        const hoy = hoyEn(tz, ahora());
        const [viajes, perfil] = await Promise.all([
          rest(h, "trips?select=id,destino,fecha_salida,fecha_regreso&order=fecha_salida.desc&limit=50"),
          rest(h, `profiles?select=active_trip_id&id=eq.${encodeURIComponent(userId)}`),
        ]);
        const viaje = elegirViajeParaGasto(Array.isArray(viajes) ? viajes : [], Array.isArray(perfil) ? perfil[0]?.active_trip_id ?? null : null, hoy);
        if (!viaje) return { ok: false as const, mensaje: "Para leer un ticket necesito un viaje: crea uno en la app y vuelve a mandarme la foto." };
        const ext = ({ "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "image/heic": "heic" } as Record<string, string>)[archivo.mime] ?? "jpg";
        const path = `${viaje.id}/${userId}/canal-${ahora().getTime()}.${ext}`;
        const up = await f(`${base}/storage/v1/object/trip-receipts/${path}`, {
          method: "POST", headers: { Authorization: h.Authorization, apikey: h.apikey, "Content-Type": archivo.mime, "x-upsert": "false" }, body: new Blob([archivo.bytes as BlobPart], { type: archivo.mime }), signal: AbortSignal.timeout(20_000),
        });
        if (!up.ok) return { ok: false as const, mensaje: "No pude guardar la foto para leerla. Súbela en la app (Gastos → Escanear ticket)." };
        try {
          const r = await f(`${base}/functions/v1/scan-receipt`, {
            method: "POST", headers: { ...h, "Content-Type": "application/json" }, body: JSON.stringify({ trip_id: viaje.id, path }), signal: AbortSignal.timeout(55_000),
          });
          const j = await r.json().catch(() => null) as { ok?: boolean; message?: string; receipt?: { merchant?: string | null; date?: string | null; total?: number; currency?: string | null; tip?: number | null; confidence?: string; warnings?: string[] } } | null;
          if (!r.ok || !j?.ok || !j.receipt || !(Number(j.receipt.total) > 0)) return { ok: false as const, mensaje: String(j?.message ?? "No pude leer el ticket. Mándalo con buena luz o captúralo en la app.").slice(0, 300) };
          const t = j.receipt;
          const moneda = t.currency && /^[A-Z]{3}$/.test(t.currency) ? t.currency : null;
          const fecha = t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : hoy;
          const comercio = (t.merchant ?? "").trim().slice(0, 120);
          const descripcion = [comercio, nota?.trim()].filter(Boolean).join(" · ").slice(0, 200) || "Ticket";
          const accion: AccionIato = {
            type: "add_expense", runs: "server",
            params: { trip_id: viaje.id, monto: t.total, ...(moneda ? { moneda } : {}), categoria: (t.tip ?? 0) > 0 ? "Restaurantes" : "Otros", fecha, descripcion },
            summary: `Registrar gasto: ${t.total} ${moneda ?? "(moneda sin confirmar: MXN)"} · ${descripcion} · ${fecha} · viaje ${viaje.destino ?? ""}`.trim(),
            confirm_label: "Registrar gasto",
            note: [t.confidence && t.confidence !== "alta" ? `Lectura con confianza ${t.confidence}: revisa el monto.` : null, ...(t.warnings ?? []).slice(0, 2)].filter(Boolean).join(" ") || undefined,
          };
          return { ok: true as const, accion, texto: `Leí tu ticket${comercio ? ` de ${comercio}` : ""}: ${t.total} ${moneda ?? ""}`.trim() + "." };
        } finally {
          // La foto solo sirvió para leerla: se borra (el gasto que registra Iato no la guarda).
          await f(`${base}/storage/v1/object/trip-receipts/${path}`, { method: "DELETE", headers: { Authorization: h.Authorization, apikey: h.apikey }, signal: AbortSignal.timeout(8_000) })
            .then((x) => x.body?.cancel()).catch(() => undefined);
        }
      }, (m) => ({ ok: false as const, mensaje: m }));
    },
  };
}
