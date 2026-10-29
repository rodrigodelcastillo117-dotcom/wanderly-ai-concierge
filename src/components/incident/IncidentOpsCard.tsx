// Mesa de operaciones · tarjeta de INCIDENTE: severidad, semáforo (cuánto lleva sin atender contra el tiempo de su
// severidad), quién/dónde/hora local del viajero/qué pasó/qué ya hizo Iato, siguiente paso, y las acciones:
// Tomar, Responder (app + correo), Marcar resuelto (con nota obligatoria), Escalar y No se pudo. Bitácora completa.
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Check, ChevronDown, Hand, Loader2, Mail, MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { actOps, whenText, type OpsItem } from "@/lib/opsDesk";
import { escalateIncident, incidentLog, type IncidentLogEvent, resolveIncident, takeIncident } from "@/lib/incident";
import {
  categoryLabel, COMPLAINT_SUBTYPE_LABEL, EXPECTATION_LABEL, INCIDENT_SEVERITY_LABEL, isComplaintSubtype, isExpectation, isSentiment, localClock,
  SENTIMENT_LABEL,
} from "../../../supabase/functions/_shared/incident-labels.ts";
import { folioOf } from "../../../supabase/functions/_shared/ops-labels.ts";

const SEV_TONE: Record<string, string> = {
  critica: "border-red-400/60 bg-red-500/15 text-red-200",
  alta: "border-amber-400/60 bg-amber-500/10 text-amber-200",
  media: "border-primary/50 text-primary",
  baja: "border-border text-muted-foreground",
};
const LIGHT: Record<string, { dot: string; text: string }> = {
  rojo: { dot: "bg-red-400", text: "Sin atender: ya pasó su tiempo" },
  ambar: { dot: "bg-amber-400", text: "Sin atender: a la mitad de su tiempo" },
  verde: { dot: "bg-emerald-400", text: "Sin atender: a tiempo" },
  atendido: { dot: "bg-sky-400", text: "Lo atiende una persona" },
  cerrado: { dot: "bg-muted-foreground", text: "Cerrado" },
};
const ACTOR: Record<string, string> = { usuario: "Viajero", iato: "Iato", iato_ops: "Operador IA", equipo: "Equipo", sistema: "Sistema", proveedor: "Proveedor", monitor: "Monitor" };

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="flex gap-3 text-sm min-w-0">
      <dt className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground pt-0.5">{k}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{v}</dd>
    </div>
  );
}

type Form = { action: "responder" | "resolver" | "escalar" | "no_se_pudo"; message: string };

export function IncidentOpsCard({ it, highlight, onDone }: { it: OpsItem; highlight: boolean; onDone: (msg: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<IncidentLogEvent[] | null>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView?.({ block: "start" }); }, [highlight]);

  const inc = it.incident ?? {};
  const p = (it.payload ?? {}) as Record<string, unknown>;
  const u = (p.ubicacion ?? {}) as Record<string, unknown>;
  const refs = (p.refs ?? {}) as Record<string, unknown>;
  const q = (p.queja ?? null) as Record<string, unknown> | null;
  const sev = inc.severity ?? (str(p.severidad) as string) ?? "media";
  const tz = str(u.zona_horaria);
  const clock = localClock(tz);
  const open = it.stage === "nueva" || it.stage === "en_proceso";
  const light = LIGHT[inc.semaforo ?? (open ? "verde" : "cerrado")];
  const mins = inc.minutes_unattended;
  const lat = typeof u.lat === "number" ? u.lat : null;
  const lng = typeof u.lng === "number" ? u.lng : null;
  const where = [str(u.ciudad), str(u.pais)].filter(Boolean).join(", ") || null;
  const acciones = Array.isArray(p.acciones_tomadas) ? (p.acciones_tomadas as unknown[]).map(str).filter(Boolean) as string[] : [];
  const due = inc.next_step_due_at ? new Date(inc.next_step_due_at) : null;
  const dueText = due && Number.isFinite(due.getTime()) ? `${localClock("America/Mexico_City", due)} CDMX${tz && localClock(tz, due) ? ` · ${localClock(tz, due)} del viajero` : ""}` : null;
  const complaint = q || p.sentimiento || p.expectativa ? [
    q && isComplaintSubtype(q.subtipo) ? COMPLAINT_SUBTYPE_LABEL[q.subtipo] : null,
    isSentiment(p.sentimiento) ? `ánimo: ${SENTIMENT_LABEL[p.sentimiento].toLowerCase()}` : null,
    isExpectation(p.expectativa) ? `espera: ${EXPECTATION_LABEL[p.expectativa].toLowerCase()}` : null,
  ].filter(Boolean).join(" · ") : null;

  const done = async (fn: () => Promise<{ ok: boolean; message?: string }>, msg: string) => {
    setBusy(true); setError(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) { setError(r.message ?? "No se pudo completar."); return; }
    setForm(null);
    onDone(msg);
  };
  const submit = () => {
    if (!form) return;
    if (form.action === "responder") return done(() => actOps(it, "responder", form.message), "Respuesta enviada al viajero (app y correo).");
    if (form.action === "no_se_pudo") return done(() => actOps(it, "no_se_pudo", form.message), "Marcado como no se pudo; el viajero verá el motivo.");
    if (form.action === "escalar") return done(() => escalateIncident(it.id, form.message), "Escalado: se avisó también al respaldo.");
    return done(() => resolveIncident(it.id, form.message), "Resuelto con nota; el viajero la recibe en la app y por correo.");
  };
  const loadLog = async () => {
    if (log) { setLog(null); return; }
    const r = await incidentLog(it.id);
    if (r.ok) setLog((r as { events: IncidentLogEvent[] }).events); else setError((r as { message: string }).message);
  };

  const formTitle = { responder: "Mensaje para el viajero", resolver: "Nota de resolución (obligatoria; el viajero la verá)", escalar: "Por qué lo escalas (opcional)", no_se_pudo: "Motivo (el viajero lo verá)" };
  const minLen = form?.action === "resolver" ? 10 : form?.action === "escalar" ? 0 : form?.action === "no_se_pudo" ? 3 : 2;

  return (
    <article ref={ref} id={`op-${it.id}`} data-testid="ops-item" data-stage={it.stage} data-type="incidente"
      className={`rounded-2xl border bg-surface/60 p-4 space-y-3 ${highlight ? "border-primary ring-1 ring-primary/40" : sev === "critica" && open ? "border-red-400/40" : "border-white/[0.06]"}`}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-primary text-[10px] tracking-[0.25em] uppercase">Incidente</span>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight ${SEV_TONE[sev] ?? SEV_TONE.media}`} data-testid="incident-severity">
            {sev === "critica" ? <AlertTriangle className="w-3 h-3" aria-hidden="true" /> : null}{INCIDENT_SEVERITY_LABEL[sev as keyof typeof INCIDENT_SEVERITY_LABEL] ?? sev}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="incident-light" data-light={inc.semaforo}>
            <span className={`h-2 w-2 rounded-full ${light.dot}`} aria-hidden="true" />
            {open && mins !== null && mins !== undefined ? `${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} sin atender (meta ${inc.take_minutes ?? "?"} min)` : light.text}
          </span>
        </div>
        <h3 className="font-display text-lg md:text-xl break-words">{categoryLabel(inc.category ?? str(p.categoria))}{it.user?.name ? ` · ${it.user.name}` : ""}</h3>
        <p className="text-xs text-muted-foreground">
          {whenText(it.created_at)} · Folio {folioOf(it.id)} · {it.owner?.name || it.owner?.email ? `Lo tiene ${it.owner?.name ?? it.owner?.email}`
            : inc.assignee === "iato_ops" ? "Lo tiene el operador IA" : "Nadie del equipo lo ha tomado"}
          {inc.escalation_level ? ` · nivel ${inc.escalation_level}` : ""}{inc.reopen_count ? ` · reabierto ${inc.reopen_count}×` : ""}
        </p>
      </header>

      <dl className="space-y-1.5">
        <Row k="Qué pasó" v={<span className="whitespace-pre-line">{str(p.descripcion) ?? it.title}</span>} />
        <Row k="Quién" v={<>{it.user?.name ?? "Sin nombre"}{it.user?.email ? <> · <a className="text-primary hover:underline break-all" href={`mailto:${it.user.email}`}>{it.user.email}</a></> : null}</>} />
        <Row k="Dónde" v={where || lat !== null ? <>{where ?? "Ubicación compartida"}{lat !== null && lng !== null ? <> · <a className="text-primary hover:underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`}>mapa</a></> : null}</> : null} />
        <Row k="Su hora" v={clock ? `${clock} (${tz})` : "Sin zona horaria"} />
        <Row k="Referencias" v={[str(refs.vuelo) ? `Vuelo ${refs.vuelo}` : null, str(refs.pnr) ? `PNR ${refs.pnr}` : null, str(refs.proveedor), str(refs.reserva)].filter(Boolean).join(" · ") || null} />
        <Row k="Viaje" v={it.trip?.destino ?? null} />
        <Row k={q ? "Queja" : "Ánimo"} v={complaint} />
        <Row k="Ya hizo Iato" v={acciones.length ? acciones.join(" · ") : null} />
        <Row k="Siguiente" v={inc.next_step ? `${inc.next_step}${dueText ? ` · prometido ${dueText}` : ""}` : null} />
        {inc.unanswered_user_message ? <Row k="Atención" v={<span className="text-amber-300">El viajero escribió y no tiene respuesta</span>} /> : null}
        {inc.resolution_state === "esperando_confirmacion" ? <Row k="Cierre" v="Esperando que el viajero confirme si quedó resuelto" /> : null}
        {inc.resolution_note ? <Row k="Resolución" v={inc.resolution_note} /> : null}
        <Row k="Tiempos" v={[inc.minutes_to_first_human != null ? `1.ª respuesta humana: ${inc.minutes_to_first_human} min` : null,
          inc.minutes_to_resolve != null ? `resuelto en ${inc.minutes_to_resolve} min` : null].filter(Boolean).join(" · ") || null} />
      </dl>

      {it.replies && it.replies.length > 0 && (
        <div className="space-y-2">
          {it.replies.map((r) => (
            <div key={r.id} className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2 text-sm">
              <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2">
                <MessageSquare className="w-3 h-3" aria-hidden="true" />{r.kind === "resuelta" ? "Al resolver" : r.kind === "no_se_pudo" ? "Motivo" : "Respuesta"} · {r.admin?.name ?? r.admin?.email ?? "Equipo"} · {whenText(r.at)}
                <span>· correo {r.email_status === "enviado" ? "enviado" : r.email_status === "fallido" ? "falló (se reintenta)" : r.email_status === "sin_correo" ? "sin correo" : "pendiente"}</span>
              </p>
              <p className="whitespace-pre-line mt-1">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div className="space-y-2 rounded-xl border border-white/10 p-3">
          <label className="block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor={`im-${it.id}`}>{formTitle[form.action]}</label>
          <Textarea id={`im-${it.id}`} value={form.message} rows={3} maxLength={2000} autoFocus onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder={form.action === "resolver" ? "Qué se hizo y cómo quedó. Ej.: reacomodada en el IB3170 de mañana 9:40; hotel cubierto por Iberia." : "Escribe como se lo dirías a la persona"} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90" disabled={busy || form.message.trim().length < minLen} onClick={() => void submit()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              {{ responder: "Enviar al viajero", resolver: "Marcar resuelto", escalar: "Escalar ahora", no_se_pudo: "Confirmar: no se pudo" }[form.action]}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setForm(null); setError(null); }}>Cancelar</Button>
          </div>
        </div>
      ) : open ? (
        <div className="flex flex-wrap gap-2" data-testid="incident-actions">
          {!it.owner?.id && (
            <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90" disabled={busy}
              onClick={() => void done(() => takeIncident(it.id), "Lo tomaste: queda a tu nombre y se detienen los re-avisos.")}>
              <Hand className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Tomar
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "responder", message: "" })}>
            <Mail className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Responder
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "resolver", message: "" })}>
            <Check className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Marcar resuelto
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "escalar", message: "" })}>
            <ArrowUpCircle className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Escalar
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setForm({ action: "no_se_pudo", message: "" })}>
            <X className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />No se pudo
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "responder", message: "" })}>
          <Mail className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Responder
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      <button type="button" onClick={() => void loadLog()} className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground" data-testid="incident-log-toggle">
        <ChevronDown className="w-3 h-3" aria-hidden="true" />{log ? "Ocultar bitácora" : `Bitácora${inc.events_count ? ` (${inc.events_count})` : ""}`}
      </button>
      {log && (
        <ol className="mt-1 space-y-1 border-l border-white/10 pl-3 text-xs text-muted-foreground" data-testid="incident-log">
          {log.map((e) => (
            <li key={e.id}>
              <span className="text-foreground/80">{new Date(e.at).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Mexico_City" })}</span>
              {" · "}{ACTOR[e.actor] ?? e.actor}{e.by?.name ? ` (${e.by.name})` : ""}{e.channel ? ` · ${e.channel}` : ""}{e.direction === "entrante" ? " ←" : e.direction === "saliente" ? " →" : ""}
              {e.counterpart ? ` ${e.counterpart}` : ""}{e.delivery === "fallido" ? " · FALLÓ" : ""} · {(e.body ?? e.kind).slice(0, 280)}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

export default IncidentOpsCard;
