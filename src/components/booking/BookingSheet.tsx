// Antes de salir de IATOS (Fase 7 y complemento, punto 8): quién procesa la compra, qué se conserva,
// "El precio puede cambiar…", consentimiento para guardar la selección en el viaje, un enlace REAL
// (<a target="_blank" rel="noopener">, sin window.open: no lo bloquea Safari en iOS) y, al volver,
// "¿Completaste tu reserva?". Nunca dice que la compra quedó hecha.
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, ShieldCheck, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { bridge, type BridgeSource, newIdempotencyKey } from "@/lib/bookingBridgeApi";
import { logBookingClick } from "@/lib/trackBooking";
import type { BookingAction, BookingOffer } from "@/lib/booking";
import { linkKindLine } from "@/lib/bookingExit";
import { ProofForm } from "./ProofForm";

const CATEGORY: Record<string, "flight" | "hotel" | "restaurant" | "activity" | "other"> = {
  flight: "flight", hotel: "hotel", restaurant: "restaurant", tour: "activity", experience: "activity", event: "activity", transport: "other",
};

function ago(iso: string | null): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 60) return `hace ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

const fmtPrice = (n: number, cur: string | null) => `$${Math.round(n).toLocaleString("es-MX")} ${cur ?? ""}`.trim();


export function BookingSheet({ open, onOpenChange, offer, action, source, tripId }: {
  open: boolean; onOpenChange: (v: boolean) => void; offer: BookingOffer; action: BookingAction; source: BridgeSource; tripId?: string | null;
}) {
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [goUrl, setGoUrl] = useState<string | null>(null);
  const [intent, setIntent] = useState<any>(null);
  const [needsAck, setNeedsAck] = useState(false);
  const [left, setLeft] = useState(false);
  const [askBack, setAskBack] = useState(false);
  const [proof, setProof] = useState(false);
  const keyRef = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) { setLeft(false); setAskBack(false); setProof(false); }
  }, [open]);

  // Paso 5: al volver a IATOS después de abrir el proveedor, preguntar (opcional) si completó.
  useEffect(() => {
    if (!left) return;
    const onVis = () => { if (document.visibilityState === "visible") setAskBack(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [left]);

  async function save(next: boolean) {
    setConsent(next);
    if (!next || intent) return;
    setPending(true);
    const r = await bridge("start_booking", { source, action_kind: action.kind, idempotency_key: keyRef.current, consent: true });
    setPending(false);
    if (r.ok) {
      setIntent(r.intent);
      setGoUrl(r.go_url ?? null);
      setNeedsAck(!!r.needs_price_ack);
      if (r.already_confirmed) toast.success("Ya tienes esta reserva confirmada en tu viaje.");
    } else if (!r.unavailable) {
      toast.error(r.message ?? "No se pudo guardar tu selección.");
    }
  }

  async function ack() {
    if (!intent) return;
    setPending(true);
    const r = await bridge("confirm_price_ack", { intent_id: intent.id });
    setPending(false);
    if (r.ok) { setIntent(r.intent); setGoUrl(r.go_url ?? null); setNeedsAck(false); }
    else toast.error(r.message ?? "No se pudo continuar.");
  }

  async function notCompleted() {
    if (intent) await bridge("mark_returned", { intent_id: intent.id, outcome: "not_completed" });
    toast("Listo: la opción sigue guardada para cuando quieras continuar.");
    onOpenChange(false);
  }

  // Sin consentimiento (o si booking-bridge no está disponible) se abre el enlace ya validado.
  const href = consent && goUrl ? goUrl : action.url ?? undefined;
  const blocked = consent && (pending || needsAck) && !goUrl && !!intent;
  const priceLine = offer.price ? `${fmtPrice(offer.price, offer.currency)}${offer.price_checked_at ? ` · consultado ${ago(offer.price_checked_at)}` : ""}` : null;
  const keep: Array<[boolean, string]> = [
    [action.preserves.product, offer.product_type === "flight" ? "El mismo vuelo" : "El mismo lugar"],
    [action.preserves.dates, "Tus fechas"],
    [action.preserves.travelers, "Número de viajeros"],
    [action.preserves.room_or_fare, offer.product_type === "hotel" ? "Habitación y tarifa exactas" : "La tarifa exacta"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl break-words">{action.label}</DialogTitle>
          <DialogDescription className="break-words">{offer.title}</DialogDescription>
        </DialogHeader>

        {proof && intent ? (
          <ProofForm intentId={intent.id} tripId={tripId ?? null} onDone={() => onOpenChange(false)} />
        ) : askBack ? (
          <div className="space-y-3">
            <p className="text-sm">¿Completaste tu reserva en {action.processor}?</p>
            <p className="text-xs text-muted-foreground">IATOS no ve lo que pasa en {action.processor}: si ya reservaste, guarda tu número de confirmación para tenerlo a mano.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={() => (intent ? setProof(true) : toast("Activa “Guardar en mi viaje” la próxima vez para registrar tu comprobante."))}>Sí, ya reservé</Button>
              <Button variant="outline" className="flex-1" onClick={notCompleted}>Todavía no</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/60 bg-surface/40 p-3 text-sm space-y-1">
              <p className="flex items-center gap-2 font-medium"><ShieldCheck className="w-4 h-4 text-primary" /> Continúas en {action.processor}</p>
              {linkKindLine(action) && <p className="text-xs font-medium" data-testid="link-kind">{linkKindLine(action)}</p>}
              {action.host && <p className="text-xs text-muted-foreground break-all">Destino: {action.host.replace(/^www\./, "")}</p>}
              {priceLine && <p className="text-xs text-muted-foreground">Precio visto en IATOS: {priceLine}{offer.price_is_estimate ? " (estimado)" : ""}</p>}
              <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                {action.disclosures.map((d) => <li key={d}>{d}</li>)}
              </ul>
            </div>
            {action.kind !== "official_website" && action.kind !== "maps_listing" && (
              <ul className="grid grid-cols-2 gap-1 text-xs">
                {keep.map(([okK, label]) => (
                  <li key={label} className={`flex items-center gap-1 ${okK ? "text-foreground" : "text-muted-foreground"}`}>
                    {okK ? <Check className="w-3 h-3 text-primary" /> : <X className="w-3 h-3" />} {label}
                  </li>
                ))}
              </ul>
            )}
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox checked={consent} onCheckedChange={(v) => void save(v === true)} disabled={pending || !!intent} aria-label="Guardar en mi viaje" />
              <span>Guardar esta selección en {tripId ? "mi viaje" : "IATOS"} y seguir su estado <span className="text-xs text-muted-foreground block">Solo guardamos qué elegiste y cuándo; nunca datos de pago.</span></span>
            </label>
            {needsAck && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs space-y-2">
                <p>Este precio se consultó {ago(offer.price_checked_at) ?? "hace tiempo"} y pudo cambiar. {action.processor} te mostrará el precio final.</p>
                <Button size="sm" variant="outline" onClick={ack} disabled={pending}>Entiendo, continuar</Button>
              </div>
            )}
            {action.form ? (
              <form method="post" action={action.form.action} target="_blank" onSubmit={() => setLeft(true)}>
                {action.form.fields.map(([k, v], i) => <input key={`${k}-${i}`} type="hidden" name={k} value={v} />)}
                <Button type="submit" className="w-full" disabled={blocked}>Continuar en {action.processor} <ExternalLink className="w-3 h-3 ml-1" /></Button>
              </form>
            ) : (
              <a
                href={blocked ? undefined : href}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={blocked || !href}
                onClick={(e) => {
                  if (blocked || !href) { e.preventDefault(); return; }
                  setLeft(true);
                  // Sin intención guardada: se registra el clic como antes (no es una reserva).
                  if (!(consent && goUrl)) {
                    void logBookingClick({ category: CATEGORY[offer.product_type] ?? "other", provider: action.processor, title: offer.title,
                      bookingUrl: href, city: offer.city ?? undefined, tripId: tripId ?? null, startAt: offer.travel_dates.start ?? undefined });
                  }
                }}
                className={`inline-flex w-full items-center justify-center gap-1 rounded-md px-4 py-2 text-sm font-medium transition ${
                  blocked || !href ? "bg-muted text-muted-foreground pointer-events-none" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
              >
                {pending ? "Preparando…" : `Continuar en ${action.processor}`} <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {left && (
              <button type="button" className="w-full text-xs text-primary underline-offset-2 hover:underline" onClick={() => setAskBack(true)}>
                Ya regresé · ¿completaste la reserva?
              </button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
