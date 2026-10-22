// Reservas que Iato pidió por correo (Reservas IA v1). Aquí el usuario confirma el envío, elige un
// horario alterno, cancela o descarga el .ics. Textos honestos: solo "confirmed" dice confirmada, y
// dice por quién. Si la función está apagada y no hay nada, no se muestra.
import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Mail, MapPin, Phone, Quote, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FixerButton } from "@/components/FixerButton";
import {
  type AiReservation, cancelAiReservation, chooseAiAlternative, confirmAiReservation, formatLocalSlot, listAiReservations, reservationIcsBlob,
} from "@/lib/aiReservations";

const ACTIVE = ["draft", "awaiting_user_ok", "sent", "venue_replied", "needs_user", "confirmed"];

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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base truncate">{r.venue_name}</h3>
          <p className="text-xs text-muted-foreground flex flex-wrap gap-3 mt-1">
            <span>{formatLocalSlot(r.requested_local)}</span>
            <span className="flex items-center gap-1"><Users className="w-3 h-3" aria-hidden="true" />{r.party_size}</span>
            <span>Ref {r.ref_code}</span>
          </p>
        </div>
        <Badge variant={r.is_confirmed ? "default" : "outline"} className="text-xs shrink-0">{r.label}</Badge>
      </div>

      {r.status === "awaiting_user_ok" && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Mail className="w-4 h-4" aria-hidden="true" /> Iato escribirá a {r.venue_email} en tu nombre ({r.customer_name}). Aún no le hemos escrito.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={share} onCheckedChange={(v) => setShare(v === true)} /> Compartir mi teléfono y correo con el restaurante
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={cc} onCheckedChange={(v) => setCc(v === true)} /> Mandarme una copia del correo
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => confirmAiReservation(r.id, r.confirm_prompt, { share_contact: share, cc_me: cc }), "Le escribimos al restaurante. Te avisamos cuando responda.")}>
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
  const load = useCallback(async () => {
    const res = await listAiReservations();
    setItems(res.ok ? res.reservations ?? [] : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (!items || items.length === 0) return null;
  const active = items.filter((r) => ACTIVE.includes(r.status));
  const closed = items.filter((r) => !ACTIVE.includes(r.status));
  return (
    <section id="reservas-ia" aria-labelledby="reservas-ia-titulo" className="space-y-3">
      <h2 id="reservas-ia-titulo" className="font-display text-xl">Reservas que Iato pidió por correo</h2>
      <p className="text-xs text-muted-foreground">
        Iato escribe al restaurante en tu nombre solo cuando tú lo confirmas. Una reserva está confirmada únicamente cuando el restaurante lo confirma por escrito.
      </p>
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      {[...active, ...closed].map((r) => (
        <ReservationCard key={r.id} r={r} onChange={(msg) => { setNotice(msg ?? null); void load(); }} />
      ))}
    </section>
  );
}

export default AiReservationsPanel;
