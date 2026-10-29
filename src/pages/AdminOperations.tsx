// Mesa de operaciones (/admin/operaciones): todo lo que un usuario le pidió a una persona del equipo
// (solicitudes del concierge, Privé y reservas IA atoradas), más reciente primero, con quién, qué,
// cuándo y estado, y las cuatro acciones: Tomar, Responder al usuario, Marcar resuelta y No se pudo.
// Solo administradores: la base lo exige en cada RPC (public.admins); esta pantalla solo lo refleja.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Check, ChevronDown, Clock, Eye, Hand, LifeBuoy, Loader2, Mail, MailWarning, MessageSquare, RefreshCw, ShieldAlert, X,
} from "lucide-react";
// Incidentes: tarjeta propia (severidad, semáforo, tomar/responder/resolver con nota/escalar, bitácora).
import { IncidentOpsCard } from "@/components/incident/IncidentOpsCard";
import { severityRank } from "../../supabase/functions/_shared/incident-labels.ts";
import { DashboardLayout } from "@/components/DashboardLayout";
import { AdminDenied } from "@/components/AdminGate";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { actOps, formatRequested, listOps, markOpinion, whenText, type OpsAction, type OpsFilter, type OpsItem, type OpsList } from "@/lib/opsDesk";
import { opinionFields, stars } from "../../supabase/functions/_shared/opinion.ts";
import { folioOf, OPS_STAGE_LABEL, opsTypeLabel, type OpsStage } from "../../supabase/functions/_shared/ops-labels.ts";
import { detailRows } from "../../supabase/functions/_shared/email-ops.ts";

const FILTERS: { key: OpsFilter; label: string }[] = [
  { key: "abiertas", label: "Abiertas" },
  { key: "nueva", label: "Nuevas" },
  { key: "en_proceso", label: "En proceso" },
  { key: "resuelta", label: "Resueltas" },
  { key: "no_se_pudo", label: "No se pudo" },
  { key: null, label: "Todas" },
];

const STAGE_TONE: Record<OpsStage, string> = {
  nueva: "border-primary bg-primary/15 text-primary",
  en_proceso: "border-primary/50 text-primary",
  resuelta: "border-emerald-400/40 text-emerald-300",
  no_se_pudo: "border-red-400/40 text-red-300",
  cancelada: "border-border text-muted-foreground",
  vencida: "border-border text-muted-foreground",
};

const CONTACT: Record<string, string> = { app: "En la app", email: "Correo", telefono: "Teléfono", whatsapp: "WhatsApp" };
const AI_REASON: Record<string, string> = {
  no_contact: "No encontramos correo del lugar: hay que llamar o escribir por otro medio",
  alternative_offered: "El lugar propuso otro horario",
  needs_info: "El lugar pide más datos",
  payment_required: "El lugar pide garantía o pago",
  sender_unverified: "Respondió alguien que no pudimos verificar",
  ambiguous_reply: "La respuesta no es clara",
};
const STATUS_TEXT: Record<string, string> = {
  solicitado: "nueva", pendiente_confirmacion: "en proceso", resuelto: "resuelta", rechazado: "no se pudo", cancelado: "cancelada",
  caducado: "vencida", confirmado_externamente: "confirmada", needs_user: "falta algo", venue_replied: "respondió el lugar",
  confirmed: "confirmada", declined: "no se pudo", cancelled: "cancelada", expired: "vencida", sent: "enviada al lugar",
};
const st = (s?: string | null) => (s ? STATUS_TEXT[s] ?? s.replace(/_/g, " ") : "—");

const canAct = (it: OpsItem, a: OpsAction) => {
  const open = it.stage === "nueva" || it.stage === "en_proceso";
  if (a === "responder") return true;
  if (a === "tomar") return open;
  return open;
};
const evidenceRequired = (it: OpsItem) => it.type === "prive_request" || it.source === "ai_reservation";

function StageBadge({ stage }: { stage: OpsStage }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight ${STAGE_TONE[stage] ?? STAGE_TONE.cancelada}`}>
      {stage === "resuelta" ? <Check className="w-3 h-3" aria-hidden="true" /> : <Clock className="w-3 h-3" aria-hidden="true" />}
      {OPS_STAGE_LABEL[stage] ?? stage}
    </span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v === null || v === undefined || v === "") return null;
  return (
    <div className="flex gap-3 text-sm min-w-0">
      <dt className="w-24 shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground pt-0.5">{k}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{v}</dd>
    </div>
  );
}

type Form = { action: Exclude<OpsAction, "tomar">; message: string; evidence: string };

function OpsCard({ it, highlight, onDone }: { it: OpsItem; highlight: boolean; onDone: (msg: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView?.({ block: "start" }); }, [highlight]);

  const who = it.user?.name || it.user?.customer_name || "Sin nombre en el perfil";
  const email = it.user?.email || it.user?.customer_email || null;
  const place = it.place || it.experience?.name || null;
  const city = [it.experience?.city, it.experience?.country].filter(Boolean).join(", ") || null;
  const when = formatRequested(it.requested_for);
  const details = detailRows(it.payload ?? {}).filter((d) => !["Fecha", "Hora", "Personas", "Lugar"].includes(d.k))
    .map((d) => (d.k === "Pedido desde" && /^iato$/i.test(d.text) ? { ...d, text: "Iato (chat del concierge)" } : d));
  const trip = it.trip ? [it.trip.destino, [formatRequested(it.trip.fecha_salida), formatRequested(it.trip.fecha_regreso)].filter(Boolean).join(" – ")].filter(Boolean).join(" · ") : null;
  const evidence = it.evidence && typeof it.evidence === "object"
    ? String((it.evidence as Record<string, unknown>).evidence ?? (it.evidence as Record<string, unknown>).confirmation_code ?? (it.evidence as Record<string, unknown>).quote ?? "") || null
    : null;
  const folio = it.ref_code || folioOf(it.id);
  // Opiniones ("¿Algo no se entiende? Cuéntanos"): su texto y contexto, y acciones de opinión.
  const opinion = it.type === "opinion" ? opinionFields(it.payload) : null;

  const mark = async (m: "leida" | "resuelta") => {
    setBusy(true); setError(null);
    const r = await markOpinion(it.id, m);
    setBusy(false);
    if ("message" in r) { setError(r.message); return; }
    onDone(m === "leida" ? "Marcada como leída: queda en proceso a tu nombre." : "Opinión marcada como resuelta.");
  };

  const run = async (action: OpsAction, message?: string, ev?: string) => {
    setBusy(true); setError(null);
    const r = await actOps(it, action, message, ev);
    setBusy(false);
    if ("message" in r) { setError(r.message); return; }
    setForm(null);
    const mail = r.email === "enviado" ? " Le mandamos el correo." : r.email === "sin_correo" ? " El usuario no tiene correo: lo verá en la app."
      : r.email ? " El correo quedó pendiente; se reintenta solo." : "";
    onDone(({ tomar: "La tomaste: queda en proceso a tu nombre.", responder: "Respuesta enviada al usuario.", resolver: "Marcada como resuelta.",
      no_se_pudo: "Marcada como no se pudo; el usuario verá el motivo." } as Record<OpsAction, string>)[action] + mail);
  };

  const formTitle = form?.action === "responder" ? "Mensaje para el usuario" : form?.action === "resolver" ? "Mensaje para el usuario (opcional)" : "Motivo (el usuario lo verá)";
  return (
    <article ref={ref} id={`op-${it.id}`} data-testid="ops-item" data-stage={it.stage}
      className={`rounded-2xl border bg-surface/60 p-4 space-y-3 ${highlight ? "border-primary ring-1 ring-primary/40" : "border-white/[0.06]"}`}>
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-primary text-[10px] tracking-[0.25em] uppercase">{opsTypeLabel(it.type)}</span>
            <StageBadge stage={it.stage} />
          </div>
          <h3 className="font-display text-lg md:text-xl mt-1 break-words">{place ?? it.title}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {whenText(it.created_at)} · Folio {folio}{it.owner?.name || it.owner?.email ? ` · La atiende ${it.owner?.name ?? it.owner?.email}` : ""}
          </p>
        </div>
      </header>

      {opinion ? (
        <dl className="space-y-1.5" data-testid="opinion-detail">
          <Row k="Quién" v={<>{who}{email ? <> · <a className="text-primary hover:underline break-all" href={`mailto:${email}`}>{email}</a></> : null}</>} />
          <Row k="Tipo" v={opinion.tipoLabel} />
          <Row k="Opinión" v={<span className="whitespace-pre-line">{opinion.texto}</span>} />
          <Row k="Calificación" v={stars(opinion.calificacion)} />
          <Row k="Pantalla" v={[opinion.pantalla, opinion.ruta].filter(Boolean).join(" · ") || null} />
          <Row k="Dispositivo" v={[opinion.dispositivo, opinion.version ? `versión ${opinion.version}` : null].filter(Boolean).join(" · ") || null} />
          <Row k="Viaje" v={trip} />
          <Row k="Contacto" v={opinion.contactar ? "Acepta que le escriban por correo" : "No quiere correo: la respuesta la verá solo en la app"} />
          {it.alert?.status === "fallido" ? (
            <Row k="Aviso" v={<span className="inline-flex items-center gap-1 text-amber-300"><MailWarning className="w-3.5 h-3.5" aria-hidden="true" />El correo al equipo falló; se reintenta solo</span>} />
          ) : null}
        </dl>
      ) : (
      <dl className="space-y-1.5">
        <Row k="Quién" v={<>{who}{email ? <> · <a className="text-primary hover:underline break-all" href={`mailto:${email}`}>{email}</a></> : null}
          {it.user?.customer_phone ? <> · {it.user.customer_phone}</> : null}</>} />
        {place && it.title !== place ? <Row k="Pidió" v={it.title} /> : null}
        <Row k="Lugar" v={place ? `${place}${city ? ` · ${city}` : ""}` : null} />
        <Row k="Fecha" v={when} />
        <Row k="Personas" v={it.party_size ? String(it.party_size) : null} />
        <Row k="Viaje" v={trip} />
        <Row k="Prefiere" v={it.contact_method ? CONTACT[it.contact_method] ?? it.contact_method : null} />
        <Row k="Notas" v={it.preferences} />
        {details.map((d) => <Row key={d.k} k={d.k} v={d.text} />)}
        {it.source === "ai_reservation" ? (
          <>
            <Row k="Qué falta" v={it.reason ? AI_REASON[it.reason] ?? it.reason : null} />
            <Row k="Respondió" v={it.venue?.reply_excerpt ? `«${it.venue.reply_excerpt}»` : null} />
            <Row k="Contacto" v={[it.venue?.phone, it.venue?.email].filter(Boolean).join(" · ") || null} />
          </>
        ) : null}
        {it.experience?.source_url ? <Row k="Fuente" v={<a className="text-primary hover:underline break-all" href={it.experience.source_url} target="_blank" rel="noopener noreferrer">{it.experience.source_url.replace(/^https:\/\//, "")}</a>} /> : null}
        <Row k="Evidencia" v={evidence} />
        {it.alert?.status === "fallido" ? (
          <Row k="Aviso" v={<span className="inline-flex items-center gap-1 text-amber-300"><MailWarning className="w-3.5 h-3.5" aria-hidden="true" />El correo de aviso falló; se reintenta solo</span>} />
        ) : null}
      </dl>
      )}

      {it.replies && it.replies.length > 0 && (
        <div className="space-y-2">
          {it.replies.map((r) => (
            <div key={r.id} className="rounded-xl border border-primary/20 bg-primary/[0.04] px-3 py-2 text-sm">
              <p className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-x-2">
                <MessageSquare className="w-3 h-3" aria-hidden="true" />
                {r.kind === "respuesta" ? "Respuesta" : r.kind === "resuelta" ? "Al resolver" : "Motivo"} · {r.admin?.name ?? r.admin?.email ?? "Equipo"} · {whenText(r.at)}
                <span className={r.email_status === "enviado" ? "text-emerald-300" : r.email_status === "fallido" ? "text-amber-300" : ""}>
                  · correo {r.email_status === "enviado" ? "enviado" : r.email_status === "fallido" ? "falló (se reintenta)" : r.email_status === "sin_correo" ? "sin correo" : "pendiente"}
                </span>
              </p>
              <p className="whitespace-pre-line mt-1">{r.body}</p>
              {r.evidence ? <p className="text-xs text-muted-foreground mt-1">Comprobante: {r.evidence}</p> : null}
            </div>
          ))}
        </div>
      )}

      {form ? (
        <div className="space-y-2 rounded-xl border border-white/10 p-3">
          <label className="block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor={`m-${it.id}`}>{formTitle}</label>
          {opinion && form.action === "responder" && !opinion.contactar ? (
            <p className="text-xs text-amber-200">No quiere correo: tu respuesta la verá solo en la app (Concierge › Mis solicitudes).</p>
          ) : null}
          <Textarea id={`m-${it.id}`} value={form.message} rows={3} maxLength={2000} autoFocus
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder={form.action === "no_se_pudo" ? "Ej.: El restaurante no tiene mesa ese día; te propongo…" : "Escribe como se lo dirías a la persona"} />
          {form.action === "resolver" && (
            <>
              <label className="block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor={`e-${it.id}`}>
                Evidencia {evidenceRequired(it) ? "(obligatoria: crea la reserva confirmada)" : "(opcional)"} · el usuario la verá
              </label>
              <Input id={`e-${it.id}`} value={form.evidence} maxLength={500} onChange={(e) => setForm({ ...form, evidence: e.target.value })}
                placeholder="Número de confirmación del restaurante o enlace" />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90" disabled={busy}
              onClick={() => run(form.action, form.message, form.evidence)}>
              {busy ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              {form.action === "responder" ? "Enviar al usuario" : form.action === "resolver" ? "Marcar resuelta" : "Confirmar: no se pudo"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setForm(null); setError(null); }}>Cancelar</Button>
          </div>
        </div>
      ) : opinion ? (
        <div className="flex flex-wrap gap-2" data-testid="opinion-actions">
          {it.stage === "nueva" && (
            <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90" disabled={busy} onClick={() => mark("leida")}>
              <Eye className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Marcar leída
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "responder", message: "", evidence: "" })}>
            <Mail className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Responder
          </Button>
          {(it.stage === "nueva" || it.stage === "en_proceso") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => mark("resuelta")}>
              <Check className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Marcar resuelta
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {canAct(it, "tomar") && it.stage === "nueva" && (
            <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90" disabled={busy} onClick={() => run("tomar")}>
              <Hand className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Tomar
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "responder", message: "", evidence: "" })}>
            <Mail className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Responder al usuario
          </Button>
          {canAct(it, "resolver") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setForm({ action: "resolver", message: "", evidence: "" })}>
              <Check className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Marcar resuelta
            </Button>
          )}
          {canAct(it, "no_se_pudo") && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setForm({ action: "no_se_pudo", message: "", evidence: "" })}>
              <X className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />No se pudo
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}

      {it.history && it.history.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer inline-flex items-center gap-1"><ChevronDown className="w-3 h-3" aria-hidden="true" />Historial ({it.history.length})</summary>
          <ol className="mt-2 space-y-1 border-l border-white/10 pl-3">
            {it.history.map((h, i) => (
              <li key={i}>
                {whenText(h.at)} · {h.action ? ({ tomar: "Tomada", responder: "Respuesta", resolver: "Resuelta", no_se_pudo: "No se pudo" } as Record<string, string>)[h.action] ?? h.action
                  : `${h.from ? `${st(h.from)} → ` : ""}${st(h.to)}`}
                {" · "}{h.by?.name ?? h.by?.email ?? (h.actor === "usuario" ? "el usuario" : h.actor === "equipo" ? "equipo" : "sistema")}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}

const AdminOperations = () => {
  const [params, setParams] = useSearchParams();
  const focusId = params.get("id");
  const [filter, setFilter] = useState<OpsFilter>(focusId ? null : "abiertas");
  const [list, setList] = useState<OpsList | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "forbidden" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  // "Opiniones": las que mandaron los usuarios desde la app (se combina con el filtro de estado).
  const [onlyOpinions, setOnlyOpinions] = useState(() => params.get("tipo") === "opinion");
  // "Incidentes": solo problemas de viajeros, los más graves y los que más llevan sin atender primero.
  const [onlyIncidents, setOnlyIncidents] = useState(() => params.get("tipo") === "incidente");

  const load = useCallback(async (f: OpsFilter = filter) => {
    const r = await listOps(f);
    if ("forbidden" in r) { setState(r.forbidden ? "forbidden" : "error"); return; }
    setList(r.data);
    setState("ok");
  }, [filter]);

  useEffect(() => { setState((s) => (s === "ok" ? s : "loading")); void load(filter); }, [filter, load]);

  const counts = list?.counts ?? {};
  const countOf = (k: OpsFilter) => k === null ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0)
    : k === "abiertas" ? (counts.nueva ?? 0) + (counts.en_proceso ?? 0) : counts[k] ?? 0;
  const allItems = useMemo(() => list?.items ?? [], [list]);
  const items = useMemo(() => {
    if (onlyIncidents) {
      const open = (i: OpsItem) => (i.stage === "nueva" || i.stage === "en_proceso" ? 1 : 0);
      return allItems.filter((i) => i.type === "incidente").sort((a, b) => open(b) - open(a)
        || severityRank(b.incident?.severity) - severityRank(a.incident?.severity)
        || String(a.created_at).localeCompare(String(b.created_at)));
    }
    return onlyOpinions ? allItems.filter((i) => i.type === "opinion") : allItems;
  }, [allItems, onlyOpinions, onlyIncidents]);
  const opinionCount = allItems.filter((i) => i.type === "opinion").length;
  const incidentCount = allItems.filter((i) => i.type === "incidente" && (i.stage === "nueva" || i.stage === "en_proceso")).length;
  const incidentRed = allItems.some((i) => i.type === "incidente" && i.incident?.semaforo === "rojo");

  if (state === "loading" && !list) {
    return <DashboardLayout><div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div></DashboardLayout>;
  }
  // Denegación con explicación y salida (la misma que AdminGate).
  if (state === "forbidden") return <AdminDenied />;
  if (state === "error") {
    return (
      <DashboardLayout>
        <div className="max-w-md mx-auto px-4 py-24 text-center space-y-3">
          <ShieldAlert className="w-8 h-8 text-primary mx-auto" />
          <p className="font-display text-2xl">No pudimos cargar la mesa</p>
          <Button variant="outline" onClick={() => load()}>Reintentar</Button>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <Link to="/dashboard/admin" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />Métricas
            </Link>
            <h1 className="font-display text-3xl md:text-4xl mt-1">Mesa de operaciones</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Lo que los usuarios le pidieron a una persona del equipo · datos en vivo{list ? ` · ${new Date(list.generated_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => load()}><RefreshCw className="w-3.5 h-3.5 mr-1.5" />Actualizar</Button>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Filtrar por estado">
          {FILTERS.map((f) => (
            <button key={String(f.key)} role="tab" aria-selected={filter === f.key} type="button"
              onClick={() => { setFilter(f.key); if (focusId) { params.delete("id"); setParams(params, { replace: true }); } }}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition ${filter === f.key ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground"}`}>
              {f.label} <span className="opacity-70">{countOf(f.key)}</span>
            </button>
          ))}
          <span aria-hidden="true" className="shrink-0 w-px my-1 bg-white/10" />
          <button type="button" aria-pressed={onlyIncidents} data-testid="filter-incidents"
            onClick={() => { setOnlyIncidents((v) => !v); setOnlyOpinions(false); }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition inline-flex items-center gap-1 ${onlyIncidents ? "border-primary bg-primary/15 text-primary" : incidentRed ? "border-red-400/50 text-red-200" : "border-white/10 text-muted-foreground hover:text-foreground"}`}>
            <LifeBuoy className="w-3 h-3" aria-hidden="true" />Incidentes <span className="opacity-70">{incidentCount}</span>
          </button>
          <button type="button" aria-pressed={onlyOpinions} data-testid="filter-opinions"
            onClick={() => { setOnlyOpinions((v) => !v); setOnlyIncidents(false); }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition inline-flex items-center gap-1 ${onlyOpinions ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:text-foreground"}`}>
            <MessageSquare className="w-3 h-3" aria-hidden="true" />Opiniones <span className="opacity-70">{opinionCount}</span>
          </button>
        </div>

        {notice && <p role="status" className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>}

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-10 text-center" role="status">
            {onlyIncidents ? "No hay incidentes con este estado." : onlyOpinions ? "No hay opiniones con este estado." : filter === "abiertas" ? "No hay solicitudes abiertas. Todo atendido." : "No hay solicitudes con este estado."}
          </p>
        ) : (
          <div className="space-y-3">
            {items.map((it) => it.type === "incidente" ? (
              <IncidentOpsCard key={`${it.source}-${it.id}`} it={it} highlight={it.id === focusId}
                onDone={(msg) => { setNotice(msg); void load(); }} />
            ) : (
              <OpsCard key={`${it.source}-${it.id}`} it={it} highlight={it.id === focusId}
                onDone={(msg) => { setNotice(msg); void load(); }} />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
};

export default AdminOperations;
