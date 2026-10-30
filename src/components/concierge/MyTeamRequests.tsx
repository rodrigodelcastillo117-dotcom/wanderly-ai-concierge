// "Mis solicitudes" (Concierge): lo que el usuario le pidió a una persona del equipo IATOS, con el
// estado REAL (my_team_requests: solo lo suyo), la respuesta del equipo y el comprobante si lo hay.
// Honesto: mientras está abierta dice que todavía no es una reserva; no promete tiempos.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, Loader2, MessageSquare, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cachedMyTeamRequests, formatRequested, invalidateMyTeamRequests, myTeamRequests, whenText, type MyTeamRequest } from "@/lib/opsDesk";
import { confirmIncident, messageIncident, promisedTime } from "@/lib/incident";
import { Textarea } from "@/components/ui/textarea";
import { folioOf, isBookingLike, opsTypeLabel, userStageText } from "../../../supabase/functions/_shared/ops-labels.ts";

const OPEN = new Set(["nueva", "en_proceso"]);

function StageLine({ r }: { r: MyTeamRequest }) {
  const open = OPEN.has(r.stage);
  const Icon = r.stage === "resuelta" ? Check : r.stage === "no_se_pudo" || r.stage === "cancelada" || r.stage === "vencida" ? X : Clock;
  const cls = r.stage === "resuelta" ? "border-primary bg-primary/15 text-primary" : open ? "border-primary/40 text-primary" : "border-border text-muted-foreground";
  return (
    <span data-stage={r.stage} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-tight ${cls}`}>
      <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
      {userStageText(r.stage, r.type)}{open && isBookingLike(r.type) ? " · aún no es una reserva" : ""}
    </span>
  );
}

/**
 * Incidente: siguiente paso con su hora, "¿quedó resuelto?" (sí cierra; no lo reabre con más prioridad),
 * los mensajes del caso y "Escribir al equipo" (si nadie contesta a tiempo, el equipo recibe una alerta).
 */
function IncidentPanel({ r, onChanged }: { r: MyTeamRequest; onChanged: () => void }) {
  const inc = r.incident ?? {};
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const [writing, setWriting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const hora = promisedTime(inc.next_step_due_at);
  const msgs = (inc.messages ?? []).filter((m) => m.actor !== "iato" || m.from === "usuario").slice(-4);

  const act = async (fn: () => Promise<{ ok: boolean; message?: string }>, done: string) => {
    setBusy(true); setNote(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setNote(res.message ?? "No se pudo enviar."); return; }
    setNote(done); setText(""); setWriting(false);
    invalidateMyTeamRequests(); onChanged();
  };

  return (
    <div className="space-y-2" data-testid="incident-panel">
      {inc.is_open && inc.next_step ? (
        <p className="text-xs rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2">
          <span className="text-primary">Siguiente paso:</span> {inc.next_step}{hora ? `, a más tardar a las ${hora}` : ""}.
        </p>
      ) : null}
      {msgs.length > 0 && (
        <ul className="space-y-1">
          {msgs.map((m, i) => (
            <li key={i} className="text-xs text-muted-foreground"><span className="text-foreground/80">{m.from === "usuario" ? "Tú" : "Equipo IATOS"}:</span> {m.body}</li>
          ))}
        </ul>
      )}
      {inc.can_confirm ? (
        <div className="rounded-xl border border-primary/40 p-3 space-y-2" data-testid="incident-confirm">
          <p className="text-sm">¿Quedó resuelto?</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} className="bg-gradient-gold text-primary-foreground hover:opacity-90"
              onClick={() => act(() => confirmIncident(r.id, true), "Gracias. Cerramos tu caso.")}>Sí, quedó resuelto</Button>
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => act(() => confirmIncident(r.id, false, text), "Lo reabrimos con prioridad; el equipo ya fue avisado.")}>No, sigue el problema</Button>
          </div>
        </div>
      ) : inc.can_reopen ? (
        <button type="button" disabled={busy} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          onClick={() => act(() => confirmIncident(r.id, false, null), "Lo reabrimos con prioridad; el equipo ya fue avisado.")}>
          ¿No quedó resuelto? Reabrir el caso
        </button>
      ) : null}
      {inc.is_open ? (
        writing ? (
          <div className="space-y-2">
            <Textarea rows={2} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe al equipo (dónde estás, qué cambió…)" aria-label="Mensaje para el equipo" />
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || text.trim().length < 2} onClick={() => act(() => messageIncident(r.id, text), "Enviado al equipo.")}>
                <Send className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />Enviar
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setWriting(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <button type="button" className="text-xs text-primary hover:underline underline-offset-4" onClick={() => setWriting(true)}>Escribir al equipo</button>
        )
      ) : null}
      {note ? <p role="status" className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function MyTeamRequests({ compact = false }: { compact?: boolean }) {
  // Lo último leído se pinta al instante y se actualiza en segundo plano (N8).
  const [rows, setRows] = useState<MyTeamRequest[] | null>(() => cachedMyTeamRequests());
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await myTeamRequests();
    setLoading(false);
    // Si la actualización falla pero ya hay solicitudes leídas, se quedan (sin pantalla de error); con
    // una lista vacía (nada que mostrar) se ofrece reintentar.
    if (!r.ok) { if (!cachedMyTeamRequests()?.length) setError(true); return; }
    setError(false);
    setRows(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Enlace a un caso (?tab=solicitudes&id=<caso>, lo mandan el Operador IA y la vigilancia): al cargar la lista se lleva
  // la vista a ese caso, una sola vez. Se lee de window.location para no exigir un Router a quien lo pinta.
  const [focusId] = useState<string | null>(() => {
    try { return new URLSearchParams(window.location.search).get("id"); } catch { return null; }
  });
  const focused = useRef(false);
  useEffect(() => {
    if (!focusId || focused.current || !rows?.some((r) => r.id === focusId)) return;
    focused.current = true;
    document.getElementById(`solicitud-${focusId}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [focusId, rows]);

  return (
    <section aria-labelledby="mis-solicitudes" className={`space-y-3 ${compact ? "" : "max-w-2xl mx-auto"}`}>
      <div className="flex items-end gap-2">
        <div className="flex-1 min-w-0">
          <h2 id="mis-solicitudes" className="font-display text-xl md:text-2xl">Mis solicitudes al equipo</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Lo que pediste a una persona del equipo IATOS. Aquí ves su avance y su respuesta; también te llega por correo.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => load()} aria-label="Actualizar mis solicitudes" disabled={loading}>
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        </Button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-white/10 p-4 text-sm text-muted-foreground">
          No pudimos cargar tus solicitudes. <button type="button" className="text-primary underline" onClick={() => load()}>Reintentar</button>
        </div>
      ) : rows === null ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border border-white/10 p-4 text-sm text-muted-foreground" role="status">
          Aún no le has pedido nada a una persona del equipo. Cuando le pidas a Iato una reserva o un traslado que atiende una persona, aparecerá aquí.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const when = formatRequested(r.requested_for);
            const place = r.place && r.place !== r.title ? r.place : null;
            return (
              <li key={`${r.source}-${r.id}`} id={`solicitud-${r.id}`} aria-current={focusId && r.id === focusId ? "true" : undefined} data-testid="team-request" className="rounded-2xl border border-white/10 bg-card p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-primary text-[10px] tracking-[0.25em] uppercase">{opsTypeLabel(r.type)}</p>
                    <h3 className="font-display text-base md:text-lg break-words">{r.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {[place, when, r.party_size ? `${r.party_size} ${r.party_size === 1 ? "persona" : "personas"}` : null].filter(Boolean).join(" · ")}
                      {(place || when || r.party_size) ? " · " : ""}Pedida {whenText(r.created_at)} · Folio {folioOf(r.id)}
                    </p>
                  </div>
                </div>
                <StageLine r={r} />
                {r.evidence && r.stage === "resuelta" ? <p className="text-xs text-muted-foreground">Comprobante: <span className="text-foreground">{r.evidence}</span></p> : null}
                {r.replies.length > 0 && (
                  <div className="space-y-2">
                    {r.replies.map((q) => (
                      <div key={q.id} className="rounded-xl border border-primary/25 bg-primary/[0.05] px-3 py-2">
                        <p className="text-[11px] text-primary flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" aria-hidden="true" />Equipo IATOS · {whenText(q.at)}
                        </p>
                        <p className="text-sm whitespace-pre-line mt-0.5">{q.body}</p>
                      </div>
                    ))}
                  </div>
                )}
                {r.type === "incidente" ? <IncidentPanel r={r} onChanged={() => void load()} /> : null}
                {OPEN.has(r.stage) && r.replies.length === 0 && r.type !== "incidente" ? (
                  <p className="text-[11px] text-muted-foreground">
                    {r.type === "opinion"
                      ? "La lee una persona del equipo IATOS; si te responde, lo verás aquí."
                      : "La atiende una persona del equipo IATOS; te avisamos aquí y por correo cuando haya respuesta."}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default MyTeamRequests;
