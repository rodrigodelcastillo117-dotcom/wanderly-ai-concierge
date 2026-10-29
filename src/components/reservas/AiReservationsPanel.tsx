// Reservas que Iato pidió por correo (Reservas IA v1). Aquí el usuario confirma el envío, elige un
// horario alterno, cancela o descarga el .ics. Textos honestos: solo "confirmed" dice confirmada, y
// dice por quién. Si la función está apagada y no hay nada, no se muestra.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, Mail, MapPin, Phone, Quote, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FixerButton } from "@/components/FixerButton";
import {
  type AiReservation, cancelAiReservation, chooseAiAlternative, confirmAiReservation, formatLocalSlot, listAiReservations, reservationIcsBlob, recipientNote,
} from "@/lib/aiReservations";
import { IatoName } from "@/lib/iatoMark";

const ACTIVE = ["draft", "awaiting_user_ok", "sent", "venue_replied", "needs_user", "confirmed"];

/** Estados en los que el correo SÍ salió hacia el restaurante (igual que concierge-chat/honesty.ts). */
const SENT = ["sent", "venue_replied", "confirmed"];
export const wasSent = (r: Pick<AiReservation, "status" | "sent_at">) => SENT.includes(r.status) || (r.status === "needs_user" && !!r.sent_at);
/** Borrador listo que espera "Confirmar: escribiremos a…" (aún no se escribió al restaurante). */
const isDraft = (r: Pick<AiReservation, "status">) => r.status === "draft" || r.status === "awaiting_user_ok";

/**
 * Aviso de "Mis solicitudes" (auditoría 10, ronda 3, N-P1-5): decía "Tienes 3 mesas pedidas por correo"
 * con 1 enviada y 2 borradores. Solo cuenta como "pedida" la que se envió; los borradores van aparte.
 */
export function aiReservationsNoteText(items: Pick<AiReservation, "status" | "sent_at" | "venue_name" | "label">[]): string | null {
  const active = items.filter((x) => ACTIVE.includes(x.status));
  if (!active.length) return null;
  const sent = active.filter(wasSent);
  const drafts = active.filter(isDraft);
  const other = active.length - sent.length - drafts.length;
  if (active.length === 1) {
    const r = active[0];
    if (isDraft(r)) return `Tu mesa en ${r.venue_name} espera tu confirmación: aún no le escribimos al restaurante.`;
    return `Tu mesa pedida por correo en ${r.venue_name}: ${r.label}.`;
  }
  const parts = [
    sent.length ? `${sent.length} ${sent.length === 1 ? "enviada" : "enviadas"}` : null,
    drafts.length ? `${drafts.length} ${drafts.length === 1 ? "espera" : "esperan"} tu confirmación` : null,
    other > 0 ? `${other} sin enviar (falta un dato)` : null,
  ].filter(Boolean);
  return `Mesas por correo con Iato: ${parts.join(" · ")}.`;
}

/** Última cantidad de mesas vista (para mostrar el esqueleto mientras carga solo si había alguna). */
const COUNT_KEY = "iatos_ai_res_count";
const readCount = () => { try { return Number(sessionStorage.getItem(COUNT_KEY) ?? "0") || 0; } catch { return 0; } };
const writeCount = (n: number) => { try { sessionStorage.setItem(COUNT_KEY, String(n)); } catch { /* modo privado */ } };

function ReservationCard({ r, onChange }: { r: AiReservation; onChange: (msg?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(false);
  const [cc, setCc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; message?: string }>, okMsg?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) setError(res.message ?? "No se pudo completar.");
    else onChange(res.message ?? okMsg);
  };
  const opts = r.user_options ?? {};
  const downloadIcs = () => {
    const url = URL.createObjectURL(reservationIcsBlob(r));
    const a = document.createElement("a");
    a.href = url;
    a.download = `reserva-${r.ref_code}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <article className="glass-card rounded-2xl p-4 border border-white/10 space-y-3" aria-label={`Reserva IA en ${r.venue_name}`}>
      {/* En 390 px la etiqueta larga del estado baja a su renglón (antes aplastaba el nombre y la fecha). */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1 basis-44">
          <h3 className="font-display text-base truncate">{r.venue_name}</h3>
          <p className="text-xs text-muted-foreground flex flex-wrap gap-3 mt-1">
            <span>{formatLocalSlot(r.requested_local)}</span>
            <span className="flex items-center gap-1"><Users className="w-3 h-3" aria-hidden="true" />{r.party_size}</span>
            <span>Ref {r.ref_code}</span>
          </p>
        </div>
        <Badge variant={r.is_confirmed ? "default" : "outline"} className="text-xs max-w-full whitespace-normal">{r.label}</Badge>
      </div>

      {r.status === "awaiting_user_ok" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground flex items-start gap-2">
            <Mail className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> <span><IatoName /> escribirá a {r.venue_email}{r.venue_email_is_test ? " (correo de prueba del piloto: no es del restaurante)" : ""} en tu nombre ({r.customer_name}). Aún no le hemos escrito.</span>
          </p>
          {recipientNote(r) && <p className="text-xs text-amber-300" data-testid="ai-res-piloto">{recipientNote(r)}</p>}
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={share} onCheckedChange={(v) => setShare(v === true)} /> Compartir mi teléfono y correo con el restaurante
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={cc} onCheckedChange={(v) => setCc(v === true)} /> Mandarme una copia del correo
          </label>
          <div className="flex flex-wrap gap-2">
            {/* En 390 px el texto largo ("Confirmar: escribiremos a Contramar en tu nombre") se partía fuera
                de la tarjeta (N-P2-5): ahora baja de renglón dentro del botón. */}
            <Button size="sm" disabled={busy} className="h-auto min-h-9 max-w-full whitespace-normal text-left py-2" data-testid="ai-res-confirm"
              onClick={() => run(() => confirmAiReservation(r.id, r.confirm_prompt, { share_contact: share, cc_me: cc }), "Le escribimos al restaurante. Te avisamos cuando responda.")}>
              {r.confirm_prompt}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => cancelAiReservation(r.id))}>No enviar</Button>
          </div>
        </div>
      )}

      {r.status === "sent" && (
        <p className="text-sm text-muted-foreground">Esperando la respuesta por escrito del restaurante. Si no responde, le recordamos una sola vez.</p>
      )}

      {r.venue_reply_excerpt && r.status !== "confirmed" && (
        <blockquote className="text-sm border-l-2 border-primary/60 pl-3 text-muted-foreground flex gap-2">
          <Quote className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /><span>{r.venue_reply_excerpt}</span>
        </blockquote>
      )}

      {r.status === "needs_user" && r.reason === "alternative_offered" && (r.alternatives?.length ?? 0) > 0 && (
        <div className="space-y-2">
          <p className="text-sm">¿Te sirve alguno de estos horarios? Si eliges uno, se lo decimos al restaurante.</p>
          <div className="flex flex-wrap gap-2">
            {r.alternatives!.map((a, i) => (
              <Button key={a.local} size="sm" variant="outline" disabled={busy} onClick={() => run(() => chooseAiAlternative(r.id, i))}>
                Aceptar {formatLocalSlot(a.local)}{a.note ? ` (${a.note})` : ""}
              </Button>
            ))}
          </div>
        </div>
      )}

      {r.status === "needs_user" && (r.reason === "needs_info" || r.reason === "payment_required") && opts.info_requested && (
        <p className="text-sm">{opts.info_requested}{r.reason === "payment_required" ? " IATOS nunca comparte datos de tarjeta: si quieres seguir, hazlo directamente con el restaurante." : ""}</p>
      )}

      {((r.status === "needs_user" && r.reason !== "alternative_offered") || r.status === "venue_replied" || ["declined", "expired", "failed"].includes(r.status)) && (
        <div className="flex flex-wrap gap-2">
          {opts.phone_url && <Button asChild size="sm" variant="outline"><a href={opts.phone_url}><Phone className="w-3 h-3 mr-1" aria-hidden="true" />Llamar</a></Button>}
          {opts.whatsapp_url && <Button asChild size="sm" variant="outline"><a href={opts.whatsapp_url} target="_blank" rel="noopener noreferrer">WhatsApp (si lo usan)</a></Button>}
          {(opts.booking_url ?? opts.website) && <Button asChild size="sm" variant="outline"><a href={(opts.booking_url ?? opts.website)!} target="_blank" rel="noopener noreferrer">Sitio del restaurante</a></Button>}
          <FixerButton variant="inline" />
        </div>
      )}

      {r.status === "confirmed" && (
        <div className="space-y-2">
          {r.confirmation?.quote && (
            <blockquote className="text-sm border-l-2 border-primary pl-3">
              “{r.confirmation.quote}” <span className="text-xs text-muted-foreground">— {r.venue_name}</span>
            </blockquote>
          )}
          {r.confirmation_code && <p className="text-sm">Código: <strong>{r.confirmation_code}</strong></p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={downloadIcs}><CalendarPlus className="w-3 h-3 mr-1" aria-hidden="true" />Agregar al calendario</Button>
            <Button asChild size="sm" variant="outline">
              <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([r.venue_name, r.venue_address ?? r.venue_city].filter(Boolean).join(", "))}${r.venue_place_id ? `&query_place_id=${encodeURIComponent(r.venue_place_id)}` : ""}`} target="_blank" rel="noopener noreferrer">
                <MapPin className="w-3 h-3 mr-1" aria-hidden="true" />Cómo llegar
              </a>
            </Button>
          </div>
        </div>
      )}

      {["sent", "venue_replied", "needs_user", "confirmed"].includes(r.status) && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => cancelAiReservation(r.id), "Cancelada.")}>
          Cancelar{r.status === "confirmed" ? " reserva" : " solicitud"}
        </Button>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </article>
  );
}

export function AiReservationsPanel() {
  const [items, setItems] = useState<AiReservation[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Si la última vez había mesas, se ve un esqueleto mientras carga (antes la sección aparecía de golpe
  // a los 3 s, N-P2-5); si no había, nada (la función suele estar apagada).
  const [expected] = useState(readCount);
  const load = useCallback(async () => {
    const res = await listAiReservations();
    const list = res.ok ? res.reservations ?? [] : [];
    setItems(list);
    if (res.ok) writeCount(list.length);
  }, []);
  useEffect(() => { void load(); }, [load]);
  // Enlace desde Iato o desde "Pedir mesa con Iato" (/dashboard/reservas#reservas-ia): baja a la sección.
  const hasItems = !!items && items.length > 0;
  useEffect(() => {
    if (hasItems && typeof window !== "undefined" && window.location.hash === "#reservas-ia") {
      document.getElementById("reservas-ia")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  }, [hasItems]);

  if (!items && expected > 0) {
    return (
      <section aria-busy="true" aria-label="Cargando las reservas que Iato pidió por correo" className="space-y-3" data-testid="ai-res-skeleton">
        <div className="h-6 w-64 max-w-full rounded bg-white/[0.06] motion-safe:animate-pulse" />
        {Array.from({ length: Math.min(expected, 2) }, (_, i) => (
          <div key={i} className="glass-card rounded-2xl p-4 border border-white/10 h-24 motion-safe:animate-pulse" />
        ))}
      </section>
    );
  }
  if (!items || items.length === 0) return null;
  const active = items.filter((r) => ACTIVE.includes(r.status));
  const closed = items.filter((r) => !ACTIVE.includes(r.status));
  return (
    <section id="reservas-ia" aria-labelledby="reservas-ia-titulo" className="space-y-3">
      <h2 id="reservas-ia-titulo" className="font-display text-xl">Reservas que Iato pidió por correo</h2>
      <p className="text-xs text-muted-foreground">
        <IatoName /> escribe al restaurante en tu nombre solo cuando tú lo confirmas. Una reserva está confirmada únicamente cuando el restaurante lo confirma por escrito.
      </p>
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      {[...active, ...closed].map((r) => (
        <ReservationCard key={r.id} r={r} onChange={(msg) => { setNotice(msg ?? null); void load(); }} />
      ))}
    </section>
  );
}

/**
 * En "Mis solicitudes" (Concierge): las mesas que Iato pidió por correo viven en Mis reservas; este
 * aviso enlaza allá con su estado real. Si no hay ninguna, no se muestra.
 */
export function AiReservationsLinkNote() {
  const [items, setItems] = useState<AiReservation[]>([]);
  useEffect(() => {
    let alive = true;
    void listAiReservations().then((r) => { if (alive && r.ok) setItems((r.reservations ?? []).filter((x) => ACTIVE.includes(x.status))); });
    return () => { alive = false; };
  }, []);
  const text = aiReservationsNoteText(items);
  if (!text) return null;
  return (
    <div className="max-w-2xl mx-auto mb-3 rounded-2xl border border-primary/30 bg-primary/5 p-3 text-xs" data-testid="ai-res-link-note">
      <p>
        {text}{" "}
        <Link to="/dashboard/reservas#reservas-ia" className="text-primary underline underline-offset-2">Ver en Mis reservas</Link>
      </p>
    </div>
  );
}

export default AiReservationsPanel;
