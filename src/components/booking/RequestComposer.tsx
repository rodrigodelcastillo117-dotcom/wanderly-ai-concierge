// Iato prepara la solicitud y el usuario la envía desde SU app con un toque (preferencia del dueño):
// WhatsApp (wa.me, solo con número verificado), correo (mailto:), SMS (sms:) o llamada (tel:, con
// guion en pantalla). El mensaje es editable y va en el idioma del lugar. Al tocar un canal se guarda
// la solicitud como REQUESTED (si el usuario aceptó guardarla) y después se pregunta "¿Te respondieron?".
// Nada de esto es una reserva hasta que el lugar confirme.
import { useEffect, useMemo, useRef, useState } from "react";
import { Mail, MessageCircle, MessageSquare, Phone, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { bridge, type BridgeSource, newIdempotencyKey } from "@/lib/bookingBridgeApi";
import { type BookingAction, type BookingOffer, draftRequest, mailtoLink, REQUEST_LANGS, type RequestLang, smsLink, telLink, whatsappLink } from "@/lib/booking";

const LANG_LABEL: Record<RequestLang, string> = { es: "Español", en: "English", fr: "Français", it: "Italiano", pt: "Português", ja: "日本語" };
const ICON: Record<string, any> = { whatsapp: MessageCircle, email: Mail, sms: MessageSquare, phone: Phone };

export function RequestComposer({ open, onOpenChange, offer, source, initialKind, defaultLang, tripId }: {
  open: boolean; onOpenChange: (v: boolean) => void; offer: BookingOffer; source: BridgeSource; initialKind?: string;
  defaultLang?: RequestLang; tripId?: string | null;
}) {
  const channels = offer.actions.filter((a) => ["whatsapp", "email", "sms", "phone"].includes(a.kind) && a.channel?.verified_by);
  const assisted = offer.actions.find((a) => a.kind === "assisted_request" || a.kind === "prive_request") ?? null;
  const [lang, setLang] = useState<RequestLang>(defaultLang ?? ((offer.details as any)?.lang as RequestLang) ?? "es");
  const [date, setDate] = useState(offer.travel_dates.start ?? "");
  const [time, setTime] = useState("20:00");
  const [party, setParty] = useState<number>(offer.traveler_count ?? 2);
  const [names, setNames] = useState("");
  const [occasion, setOccasion] = useState("");
  const [dietary, setDietary] = useState("");
  const [notes] = useState("");
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);
  const [save, setSave] = useState(false);
  const [sent, setSent] = useState<{ intentId: string | null; kind: string } | null>(null);
  const keyRef = useRef(newIdempotencyKey());

  const product = offer.product_type === "restaurant" ? "restaurant" : offer.product_type === "hotel" ? "hotel" : "experience";
  const draftIn = { venue: offer.title, product_type: product as any, date: date || null, time: time || null, party_size: party || null, names, occasion, dietary, notes };
  const draft = useMemo(() => draftRequest(draftIn, lang), [lang, date, time, party, names, occasion, dietary, notes, offer.title]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!edited) setText(draft.body); }, [draft.body, edited]);

  function hrefFor(a: BookingAction): string | null {
    const v = a.channel?.value ?? "";
    if (a.kind === "whatsapp") return whatsappLink(v, text);
    if (a.kind === "email") return mailtoLink(v, draft.subject, text);
    if (a.kind === "sms") return smsLink(v, text);
    if (a.kind === "phone") return telLink(v);
    return null;
  }

  async function record(kind: string, force = false) {
    if (!save && !force) { setSent({ intentId: null, kind }); return; }
    const r = await bridge("start_booking", { source, action_kind: kind, idempotency_key: keyRef.current, consent: true,
      draft: { date: date || null, time: time || null, party_size: party, lang, names, occasion, dietary, notes } });
    setSent({ intentId: r.ok ? r.intent?.id ?? null : null, kind });
    if (r.ok && (kind === "assisted_request" || kind === "prive_request")) toast.success("Solicitud enviada · aún no es una reserva");
    else if (!r.ok && !r.unavailable) toast.error(r.message ?? "No se pudo guardar la solicitud.");
  }

  async function reply(outcome: "venue_confirmed" | "other_time" | "not_available") {
    if (sent?.intentId) await bridge("mark_returned", { intent_id: sent.intentId, outcome });
    toast(outcome === "venue_confirmed" ? "Guardado como confirmada por el lugar (declarada por ti)." : "Guardado.");
    onOpenChange(false);
  }

  const phone = channels.find((c) => c.kind === "phone");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl break-words">Solicitar en {offer.title}</DialogTitle>
          <DialogDescription>Revisa el mensaje y envíalo tú desde tu teléfono. No es una reserva hasta que el lugar te confirme.</DialogDescription>
        </DialogHeader>
        {sent ? (
          <div className="space-y-3">
            <p className="text-sm">¿Te respondieron?</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button variant="outline" onClick={() => reply("venue_confirmed")}>Confirmado</Button>
              <Button variant="outline" onClick={() => reply("other_time")}>Otra hora</Button>
              <Button variant="outline" onClick={() => reply("not_available")}>No disponible</Button>
            </div>
            <button type="button" className="text-xs text-muted-foreground underline" onClick={() => onOpenChange(false)}>Aún no · te aviso después</button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <label className="text-xs">Fecha<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" /></label>
              <label className="text-xs">Hora (local)<Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1" /></label>
              <label className="text-xs">Personas<Input type="number" min={1} max={30} value={party} onChange={(e) => setParty(Number(e.target.value) || 1)} className="mt-1" /></label>
              <label className="text-xs">A nombre de<Input value={names} maxLength={120} onChange={(e) => setNames(e.target.value)} className="mt-1" /></label>
              <label className="text-xs">Ocasión<Input value={occasion} maxLength={120} onChange={(e) => setOccasion(e.target.value)} className="mt-1" /></label>
              <label className="text-xs">Idioma del mensaje
                <select value={lang} onChange={(e) => { setLang(e.target.value as RequestLang); setEdited(false); }} className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                  {REQUEST_LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
                </select>
              </label>
            </div>
            <label className="block text-xs">Alergias, accesibilidad u otras notas
              <Input value={dietary} maxLength={300} onChange={(e) => setDietary(e.target.value)} className="mt-1" placeholder="Sin gluten, silla de ruedas…" />
            </label>
            <label className="block text-xs">Mensaje (puedes editarlo)
              <Textarea value={text} rows={8} maxLength={1500} onChange={(e) => { setText(e.target.value); setEdited(true); }} className="mt-1 text-sm" />
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={save} onCheckedChange={(v) => setSave(v === true)} aria-label="Guardar la solicitud" />
              <span>Guardar esta solicitud en {tripId ? "mi viaje" : "IATOS"} para darle seguimiento</span>
            </label>
            <div className="grid gap-2">
              {channels.map((a) => {
                const href = hrefFor(a);
                const Icon = ICON[a.kind];
                if (!href) return null;
                return (
                  <a key={a.kind} href={href} target={a.kind === "whatsapp" ? "_blank" : undefined} rel="noopener noreferrer"
                    onClick={() => void record(a.kind)}
                    className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium ${a.kind === initialKind ? "bg-primary text-primary-foreground" : "border border-primary/40 text-primary"}`}>
                    <Icon className="w-4 h-4" /> {a.label}
                    <span className="text-[10px] opacity-80 inline-flex items-center gap-0.5"><ShieldCheck className="w-3 h-3" />{a.kind === "whatsapp" ? "WhatsApp verificado" : "verificado"}</span>
                  </a>
                );
              })}
              {channels.length > 0 && (
                <p className="text-[11px] text-muted-foreground">Fuente del contacto: {channels[0].channel?.verified_by}.</p>
              )}
              {phone && (
                <div className="rounded-md border border-border/60 p-3 text-xs space-y-1">
                  <p className="font-medium">Guion para la llamada</p>
                  {draft.call_script.map((l) => <p key={l}>• {l}</p>)}
                </div>
              )}
              {assisted && (
                <Button variant={channels.length ? "outline" : "default"} onClick={() => { setSave(true); void record(assisted.kind, true); }}>
                  {channels.length ? "Prefiero que IATOS lo gestione" : "Enviar solicitud a IATOS"}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
