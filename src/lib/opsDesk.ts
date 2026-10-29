// Mesa de operaciones (cliente). La lista y las acciones son RPC que exigen public.admins en la base
// (admin_ops_list / admin_ops_act); el correo al usuario lo manda la función ops-desk con el id de la
// respuesta (si no sale, queda pendiente y health-check lo reintenta). "Mis solicitudes" del usuario
// lee my_team_requests (solo lo suyo).
import { supabase } from "@/integrations/supabase/client";
import type { OpsStage } from "../../supabase/functions/_shared/ops-labels.ts";

export type { OpsStage };
export type OpsAction = "tomar" | "responder" | "resolver" | "no_se_pudo";

export type OpsPerson = { id?: string; name?: string | null; email?: string | null; customer_name?: string | null; customer_email?: string | null; customer_phone?: string | null };
export type OpsHistory = { at: string; from?: string | null; to?: string | null; actor?: string; kind?: string; action?: string | null; by?: OpsPerson | null; note?: string | null };
export type OpsReply = { id: string; kind: "respuesta" | "resuelta" | "no_se_pudo"; body: string; evidence?: string | null; at: string;
  admin?: OpsPerson | null; email_status?: string; email_error?: string | null };

export type OpsItem = {
  source: "concierge_request" | "ai_reservation";
  id: string;
  type: string;
  title: string;
  status: string;
  stage: OpsStage;
  reason?: string | null;
  ref_code?: string | null;
  created_at: string;
  updated_at?: string | null;
  requested_for?: string | null;
  party_size?: number | null;
  place?: string | null;
  experience?: { name?: string | null; city?: string | null; country?: string | null; timezone?: string | null; source_url?: string | null } | null;
  venue?: { email?: string | null; phone?: string | null; address?: string | null; reply_excerpt?: string | null } | null;
  preferences?: string | null;
  contact_method?: string | null;
  payload?: Record<string, unknown> | null;
  trip?: { id: string; destino?: string | null; fecha_salida?: string | null; fecha_regreso?: string | null } | null;
  user?: OpsPerson | null;
  owner?: OpsPerson | null;
  evidence?: Record<string, unknown> | null;
  alert?: { status?: string | null; attempts?: number; sent_at?: string | null; error?: string | null } | null;
  history?: OpsHistory[];
  replies?: OpsReply[];
};

export type OpsList = { generated_at: string; counts: Partial<Record<OpsStage, number>>; items: OpsItem[] };

/** Etapa elegida en los filtros: "abiertas" = nuevas + en proceso; null = todas. */
export type OpsFilter = "abiertas" | OpsStage | null;

const isForbidden = (e: { code?: string; message?: string } | null) => !!e && (e.code === "42501" || /solo administradores|permission denied/i.test(e.message ?? ""));

export async function listOps(filter: OpsFilter): Promise<{ ok: true; data: OpsList } | { ok: false; forbidden: boolean; message: string }> {
  let data: unknown, error: { code?: string; message: string } | null;
  try {
    ({ data, error } = await supabase.rpc("admin_ops_list" as any, { _stage: filter } as any));
  } catch (e) {
    return { ok: false, forbidden: false, message: e instanceof Error ? e.message : "error" };
  }
  if (error) return { ok: false, forbidden: isForbidden(error), message: error.message };
  const d = (data ?? {}) as Partial<OpsList>;
  return { ok: true, data: { generated_at: d.generated_at ?? new Date().toISOString(), counts: d.counts ?? {}, items: Array.isArray(d.items) ? d.items : [] } };
}

const ERROR_TEXT: Record<string, string> = {
  ILLEGAL_TRANSITION: "Ese cambio ya no aplica en el estado actual. Actualiza la lista.",
  EVIDENCE_REQUIRED: "Aquí la evidencia es obligatoria (crea la reserva confirmada): escribe el número de confirmación o el enlace.",
  MESSAGE_REQUIRED: "Escribe el mensaje para el usuario.",
  REASON_REQUIRED: "Escribe el motivo (el usuario lo verá).",
  NOT_FOUND: "Ya no existe. Actualiza la lista.",
  CONFIRMATION_REQUIRES_EVIDENCE: "La confirmación necesita evidencia.",
};

export type ActResult = { ok: true; item?: OpsItem; email?: string | null } | { ok: false; message: string; code?: string };

/** Una acción de la mesa. Si dejó un mensaje para el usuario, pide a ops-desk que le mande el correo. */
export async function actOps(item: Pick<OpsItem, "source" | "id">, action: OpsAction, message?: string | null, evidence?: string | null): Promise<ActResult> {
  const { data, error } = await supabase.rpc("admin_ops_act" as any, {
    _source: item.source, _id: item.id, _action: action, _message: message?.trim() || null, _evidence: evidence?.trim() || null,
  } as any);
  if (error) return { ok: false, code: isForbidden(error) ? "FORBIDDEN" : "ERROR", message: isForbidden(error) ? "Acceso solo para administradores." : "No se pudo guardar. Intenta de nuevo." };
  const r = (data ?? {}) as { ok?: boolean; code?: string; reply_id?: string | null; item?: OpsItem };
  if (!r.ok) return { ok: false, code: r.code, message: ERROR_TEXT[r.code ?? ""] ?? "No se pudo completar." };
  let email: string | null = null;
  if (r.reply_id) {
    // El mensaje ya quedó guardado y el usuario lo ve en la app; el correo puede reintentarse después.
    const { data: sent, error: sendErr } = await supabase.functions.invoke("ops-desk", { body: { reply_id: r.reply_id } });
    email = sendErr ? "pendiente" : ((sent as { email_status?: string } | null)?.email_status ?? "pendiente");
  }
  return { ok: true, item: r.item, email };
}

// ───────────────────────────── lo que ve el usuario ─────────────────────────────

export type MyTeamRequest = {
  source: "concierge_request" | "ai_reservation";
  id: string;
  type: string;
  title: string;
  status: string;
  stage: OpsStage;
  created_at: string;
  updated_at?: string | null;
  requested_for?: string | null;
  party_size?: number | null;
  place?: string | null;
  evidence?: string | null;
  replies: { id: string; kind: OpsReply["kind"]; body: string; evidence?: string | null; at: string }[];
  history: { at: string; from?: string | null; to?: string | null; actor?: string }[];
};

type MyTeamResult = { ok: true; data: MyTeamRequest[] } | { ok: false; message: string };

// "Mis solicitudes" tardaba 2.6 s en aparecer (auditoría 10, ronda 2, N8): la pestaña pedía la lista
// recién al abrirse. Ahora el Concierge la pide en segundo plano al cargar (prefetchMyTeamRequests) y la
// pestaña pinta al instante lo último que se leyó (cachedMyTeamRequests) mientras se actualiza.
const TEAM_CACHE_MS = 5 * 60_000;
let teamCache: { at: number; data: MyTeamRequest[] } | null = null;
let teamInflight: Promise<MyTeamResult> | null = null;

/** Lo último leído (si tiene menos de 5 min) para pintar sin esperar. */
export function cachedMyTeamRequests(now = Date.now()): MyTeamRequest[] | null {
  return teamCache && now - teamCache.at < TEAM_CACHE_MS ? teamCache.data : null;
}

/** Solo pruebas. */
export function __resetMyTeamRequestsCache() { teamCache = null; teamInflight = null; }

export function myTeamRequests(): Promise<MyTeamResult> {
  if (teamInflight) return teamInflight;
  teamInflight = (async (): Promise<MyTeamResult> => {
    try {
      const { data, error } = await supabase.rpc("my_team_requests" as any);
      if (error) return { ok: false, message: error.message };
      const rows = Array.isArray(data) ? (data as MyTeamRequest[]) : [];
      teamCache = { at: Date.now(), data: rows };
      return { ok: true, data: rows };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : "error" };
    } finally {
      teamInflight = null;
    }
  })();
  return teamInflight;
}

/** Lectura anticipada (sin esperar ni mostrar errores): la pestaña ya la tiene al abrirse. */
export function prefetchMyTeamRequests(): void {
  if (cachedMyTeamRequests()) return;
  void myTeamRequests().catch(() => {});
}

/** "2 de nov., 20:30 h" a partir de lo que pidió la persona (hora del lugar si no trae zona). */
export function formatRequested(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return s.slice(0, 40);
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  if (hasZone) {
    const t = new Date(s);
    if (Number.isFinite(t.getTime())) {
      return t.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Mexico_City" }) + " h (CDMX)";
    }
  }
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  return m[4] ? `${date}, ${m[4]}:${m[5]} h` : date;
}

/** "hace 3 h" / "28 oct., 14:05". */
export function whenText(iso: string | null | undefined, now = new Date()): string {
  const t = new Date(String(iso ?? ""));
  if (!Number.isFinite(t.getTime())) return "";
  const min = Math.round((now.getTime() - t.getTime()) / 60000);
  if (min < 1) return "justo ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  if (d < 7) return `hace ${d} ${d === 1 ? "día" : "días"}`;
  return t.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Mexico_City" }) + " h";
}
