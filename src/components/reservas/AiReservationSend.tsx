// Paso "Enviar al restaurante" de Reservas IA (lo usan la tarjeta de Iato y "Pedir mesa con Iato").
// create_intent ya preparó el correo: aquí el usuario ve A QUIÉN y QUÉ le escribiremos y da su
// consentimiento explícito (confirm_send con share_contact / cc_me). Sin correo verificado
// (next = needs_user) se muestran las vías reales que trajo el servidor (teléfono, WhatsApp, sitio, Maps).
// Honesto: solo "confirmed" dice confirmada; antes de eso siempre "Aún no está reservado".
import { useState } from "react";
import { Link } from "react-router-dom";
import { Globe, Loader2, Mail, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  type AiReservation, type AiReservationDraft, cancelAiReservation, confirmAiReservation,
} from "@/lib/aiReservations";

export const AI_RESERVATIONS_LINK = "/dashboard/reservas#reservas-ia";

const gold = "inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-gradient-gold px-3.5 text-xs font-medium text-primary-foreground disabled:opacity-60";
const pill = "inline-flex min-h-[36px] items-center gap-1 rounded-full border border-primary/30 px-3 text-[11px] text-foreground transition hover:border-primary hover:bg-primary/10";
const safeUrl = (u: unknown, tel = false) => typeof u === "string" && (tel ? /^tel:\+?\d{7,15}$/.test(u) : /^https:\/\//.test(u)) ? u : null;

export function AiReservationStatusLine({ r }: { r: AiReservation }) {
  return (
    <p className="text-[11px] text-muted-foreground" data-testid="ai-res-status" data-status={r.status}>
      Estado: <span className={r.is_confirmed ? "text-primary" : "text-foreground"}>{r.label}</span>
      {!r.is_confirmed && " · Aún no está reservado."}
    </p>
  );
}

export function AiReservationSend({ draft }: { draft: AiReservationDraft }) {
  const [r, setR] = useState<AiReservation>(draft.reservation);
  const [share, setShare] = useState(false);
  const [cc, setCc] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = draft.preview;
  const prompt = draft.confirm_prompt || r.confirm_prompt;

  const run = async (fn: () => ReturnType<typeof confirmAiReservation>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok || !res.reservation) setError(res.message ?? "No se pudo completar. No se envió nada.");
    else setR(res.reservation);
  };

  const track = (
    <Link to={AI_RESERVATIONS_LINK} className="text-[11px] text-primary underline underline-offset-2" data-testid="ai-res-seguir">
      Seguir en Mis reservas
    </Link>
  );

  // Sin correo verificable: las vías reales que trajo el servidor.
  if (draft.next === "needs_user" || (r.status === "needs_user" && r.reason === "no_contact")) {
    const o = r.user_options ?? {};
    const links = [
      safeUrl(o.phone_url, true) && { href: o.phone_url!, label: "Llamar", Icon: Phone, tel: true },
      safeUrl(o.whatsapp_url) && { href: o.whatsapp_url!, label: "WhatsApp (si lo usan)", Icon: MessageCircle },
      safeUrl(o.booking_url) && { href: o.booking_url!, label: "Reservar en línea", Icon: Globe },
      safeUrl(o.website) && o.website !== o.booking_url && { href: o.website!, label: "Sitio del restaurante", Icon: Globe },
      safeUrl(o.maps_url) && { href: o.maps_url!, label: "Ver en Google Maps", Icon: MapPin },
    ].filter(Boolean) as Array<{ href: string; label: string; Icon: typeof Phone; tel?: boolean }>;
    return (
      <div className="mt-2 space-y-2" data-testid="ai-res-needs-user">
        <p className="text-xs">No encontramos un correo de reservas verificado de {r.venue_name}, así que no le escribimos.</p>
        {links.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) => (
              <a key={l.href} href={l.href} target={l.tel ? undefined : "_blank"} rel="noopener noreferrer" className={pill}>
                <l.Icon className="h-3.5 w-3.5" aria-hidden="true" /> {l.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">Google no publica otra vía de contacto de este lugar.</p>
        )}
        <p className="text-[11px] text-muted-foreground">Aún no está reservado.</p>
        {track}
      </div>
    );
  }

  if (r.status === "awaiting_user_ok" && preview) {
    return (
      <div className="mt-2 space-y-2" data-testid="ai-res-preview">
        <p className="text-xs flex items-start gap-1.5">
          <Mail className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
          <span>Iato escribirá a <strong className="break-all">{preview.to}</strong> en tu nombre ({r.customer_name}). Aún no le hemos escrito.</span>
        </p>
        <div className="max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2.5">
          <p className="text-[11px] font-medium">Asunto: {preview.subject}</p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[11px] leading-snug text-muted-foreground">{preview.text}</pre>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={share} onCheckedChange={(v) => setShare(v === true)} aria-label="Compartir mi teléfono y correo con el restaurante" />
          Compartir mi teléfono y correo con el restaurante
        </label>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={cc} onCheckedChange={(v) => setCc(v === true)} aria-label="Mandarme una copia del correo" />
          Mandarme una copia del correo
        </label>
        <p className="text-[10px] text-muted-foreground">Al enviar confirmas: «{prompt}». Nunca pedimos ni enviamos datos de pago.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={gold} disabled={busy}
            onClick={() => run(() => confirmAiReservation(r.id, prompt, { share_contact: share, cc_me: cc }))}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            Enviar al restaurante
          </button>
          <button type="button" disabled={busy} onClick={() => run(() => cancelAiReservation(r.id))}
            className="inline-flex min-h-[36px] items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground hover:text-foreground">
            No enviar
          </button>
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        {track}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-1" data-testid="ai-res-after">
      {r.status === "sent" && <p className="text-xs">Le escribimos a {r.venue_name}. Te avisamos en la app y por correo cuando responda por escrito.</p>}
      {r.status === "cancelled" && <p className="text-xs">No le escribimos al restaurante.</p>}
      {r.is_confirmed && r.confirmation?.quote && (
        <blockquote className="border-l-2 border-primary pl-2 text-xs">“{r.confirmation.quote}” <span className="text-muted-foreground">— {r.venue_name}</span></blockquote>
      )}
      <AiReservationStatusLine r={r} />
      {track}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default AiReservationSend;
