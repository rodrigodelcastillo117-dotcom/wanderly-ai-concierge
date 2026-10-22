import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, BadgeCheck, BedDouble, Car, ExternalLink, Globe, Landmark, Luggage, MapPin, Navigation, Phone, Plane, Sparkles, Star,
  Utensils, UserRound, CalendarCheck, Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionButton as AffiliateActionButton } from "@/components/ActionButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { logBookingClick, type TrackBookingInput } from "@/lib/trackBooking";
import {
  CARD_TYPES, safeCardLink, safeHttpsUrl, type CardLink, type ConciergeCard,
} from "../../../supabase/functions/concierge-chat/cards.ts";

// Cards del chat de Iato. El servidor (concierge-chat/cards.ts → validateCards) ya validó tipo,
// enlaces y precios; aquí se vuelve a revisar lo mínimo por si llega algo viejo o malformado.
// Antes RichCard solo sabía dibujar restaurant/transport/alert/luggage/jet y las cards de vuelo,
// hotel y atracción que pedía el prompt desaparecían (B-02).

export type { ConciergeCard };
export { CARD_TYPES };

const GOLD_CTA = "bg-gradient-gold text-primary-foreground hover:opacity-90";

/** Precio con moneda, solo si el servidor lo marcó como consultado y trae su fuente. */
export function verifiedPrice(card: ConciergeCard): { amount: number; currency: string } | null {
  const amount = typeof card.price === "number" ? card.price : card.price_usd;
  if (card.estado_dato !== "CONSULTADO_EN_VIVO" || !card.fuente || typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const currency = /^[A-Z]{3}$/.test(card.currency ?? "") ? card.currency! : "USD";
  return { amount, currency };
}

/** Precio guardado (no en vivo): coincide con una búsqueda, pero su consulta ya venció. */
export function savedPrice(card: ConciergeCard): { amount: number; currency: string } | null {
  const amount = typeof card.price === "number" ? card.price : card.price_usd;
  if (card.estado_dato !== "OBSOLETO" || !card.fuente || typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const currency = /^[A-Z]{3}$/.test(card.currency ?? "") ? card.currency! : "USD";
  return { amount, currency };
}

const formatMoney = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("es-MX")}`;
  }
};

const SOURCE_LABEL: Record<string, string> = {
  serpapi: "Google · consultado en vivo",
  google_flights: "Google Flights · consultado en vivo",
  google_hotels: "Google Hotels · consultado en vivo",
  travelpayouts: "Aviasales · tarifa de referencia (últimas 48 h)",
  aviasales: "Aviasales · tarifa de referencia (últimas 48 h)",
  tripadvisor: "TripAdvisor",
  google_maps: "Google Maps",
};

const sourceLabel = (card: ConciergeCard) => {
  const f = String(card.fuente ?? "").toLowerCase();
  if (card.type === "flight" && f === "serpapi") return "Google Flights · consultado en vivo";
  if (card.type === "hotel" && f === "serpapi") return "Google Hotels · consultado en vivo";
  return SOURCE_LABEL[f] ?? `Consultado en vivo · ${card.fuente}`;
};

/** Insignia de origen: nunca se muestra un precio sin ella. */
export function ProvenanceBadge({ card }: { card: ConciergeCard }) {
  if (card.estado_dato === "SOLICITUD_HUMANA") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground">
        <UserRound className="w-3 h-3" /> Cotiza un humano · sin precio todavía
      </span>
    );
  }
  if (card.estado_dato === "NO_VERIFICADO") {
    return (
      <span title="Iato mencionó un precio que no salió de una búsqueda real; no lo mostramos."
        className="inline-flex items-center gap-1 rounded-full border border-border bg-surface/60 px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground">
        <Sparkles className="w-3 h-3" /> Precio no verificado
      </span>
    );
  }
  if (savedPrice(card)) {
    const at = card.consultado_at ? new Date(card.consultado_at) : null;
    const fecha = at && Number.isFinite(at.getTime())
      ? ` · ${at.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      : "";
    return (
      <span title="Precio guardado de una búsqueda anterior, no consultado en este momento. Verifícalo antes de reservar."
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] tracking-wide text-amber-500">
        <AlertTriangle className="w-3 h-3" /> Precio guardado{fecha} · verifícalo
      </span>
    );
  }
  if (verifiedPrice(card)) {
    const at = card.consultado_at ? new Date(card.consultado_at) : null;
    const hora = at && Number.isFinite(at.getTime()) ? ` · ${at.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : "";
    return (
      <span title="Precio tomado de la búsqueda real de este momento; puede cambiar al reservar."
        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary">
        <BadgeCheck className="w-3 h-3" /> {sourceLabel(card)}{hora}
      </span>
    );
  }
  return null;
}

function PriceBlock({ card, suffix }: { card: ConciergeCard; suffix?: string }) {
  const p = verifiedPrice(card);
  if (p) {
    return (
      <div className="text-right">
        <p className="font-display text-xl text-primary leading-none">{formatMoney(p.amount, p.currency)} <span className="text-xs text-muted-foreground">{p.currency}</span></p>
        {suffix && <p className="text-[10px] text-muted-foreground mt-1">{suffix}</p>}
      </div>
    );
  }
  const saved = savedPrice(card);
  if (saved) {
    return (
      <div className="text-right">
        <p className="font-display text-xl text-amber-500 leading-none">{formatMoney(saved.amount, saved.currency)} <span className="text-xs text-muted-foreground">{saved.currency}</span></p>
        <p className="text-[10px] text-muted-foreground mt-1">precio guardado{suffix ? ` · ${suffix}` : ""}</p>
      </div>
    );
  }
  if (card.estado_dato === "NO_VERIFICADO") return <p className="text-xs text-muted-foreground">Precio no verificado</p>;
  return null;
}

/**
 * Categoría de "Mis reservas" según el tipo de card. Antes todo clic del concierge se guardaba como
 * "restaurant" (un vuelo o un hotel aparecían como mesa reservada).
 */
export function bookingCategoryForCard(type: string | undefined): TrackBookingInput["category"] {
  switch (type) {
    case "flight": return "flight";
    case "hotel": return "hotel";
    case "attraction": return "activity";
    case "restaurant": return "restaurant";
    case "transport": return "car";
    default: return "other";
  }
}

function logClick(userId: string | undefined, card: ConciergeCard, url: string, tripId?: string | null) {
  // En segundo plano: el enlace ya se abrió en el mismo gesto del usuario.
  void supabase.from("affiliate_clicks").insert({
    user_id: userId ?? null,
    trip_id: tripId ?? null,
    proveedor: card.provider ?? card.fuente ?? card.type,
    accion: `concierge_${card.type}`,
    payload: { title: card.title, subtitle: card.subtitle ?? null } as any,
    url_final: url,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  }).then(({ error }) => { if (error) console.warn("affiliate click log", error.message); });
  track("affiliate_click", { provider: card.fuente ?? card.type, accion: `concierge_${card.type}` });
  // "Mis reservas" (como visita al socio, status pending) con su categoría real y el viaje.
  if (userId) {
    void logBookingClick({
      category: bookingCategoryForCard(card.type), provider: card.provider ?? card.fuente ?? "Concierge",
      title: card.title, subtitle: card.subtitle ?? undefined, bookingUrl: url,
      imageUrl: safeHttpsUrl(card.image_url) ?? undefined, tripId: tripId ?? null,
    });
  }
}

/**
 * Enlace de compra/reserva: un <a target="_blank" rel="noopener noreferrer"> real, así se abre en
 * el mismo gesto (Safari no lo bloquea) y la página destino no puede tocar a IATOS.
 */
export function ExternalCta({ card, label, onOpen, className = "" }: {
  card: ConciergeCard; label: string; onOpen?: (url: string) => void; className?: string;
}) {
  const url = safeHttpsUrl(card.cta_action);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => onOpen?.(url)}
      className={`inline-flex items-center justify-center gap-2 rounded-md h-10 px-4 text-sm font-medium ${GOLD_CTA} ${className}`}
    >
      {label} <ExternalLink className="w-3.5 h-3.5" />
    </a>
  );
}

type RequestState = "idle" | "loading" | "confirmed" | "error";

/**
 * Solicitud a un humano vía concierge-action (crea una fila en concierge_requests y avisa por
 * correo). Solo dice "Solicitud recibida" cuando el servidor devolvió el folio (B-04).
 */
export function useConciergeRequest(tripId?: string | null) {
  const [state, setState] = useState<RequestState>("idle");
  const [folio, setFolio] = useState<string | null>(null);
  const [humanNotified, setHumanNotified] = useState<boolean | null>(null);
  const run = async (payload: { type: string; title: string; payload?: Record<string, unknown> }) => {
    setState("loading");
    try {
      const { data, error } = await supabase.functions.invoke("concierge-action", {
        body: { ...payload, trip_id: tripId ?? null },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.ok || !data?.request?.id) throw new Error("El servidor no confirmó la solicitud");
      setFolio(String(data.request.id).slice(0, 8).toUpperCase());
      setHumanNotified(data.human_notified !== false);
      setState("confirmed");
      toast.success("Solicitud recibida", { description: "Un humano te responderá con disponibilidad y precio." });
    } catch (e: any) {
      setState("error");
      toast.error(e?.message ?? "No pudimos registrar la solicitud");
    }
  };
  return { state, folio, humanNotified, run };
}

export function RequestButton({ state, label, onClick, className = "" }: {
  state: RequestState; label: string; onClick: () => void; className?: string;
}) {
  return (
    <Button onClick={onClick} disabled={state === "loading" || state === "confirmed"} className={`${GOLD_CTA} ${className}`}>
      {state === "loading" && "Enviando…"}
      {state === "confirmed" && "✓ Solicitud recibida"}
      {state === "idle" && label}
      {state === "error" && "Reintentar"}
    </Button>
  );
}

function RequestNote({ state, folio, humanNotified }: { state: RequestState; folio: string | null; humanNotified: boolean | null }) {
  if (state === "confirmed") {
    return (
      <p className="text-[11px] text-muted-foreground mt-2" role="status">
        Folio {folio}. {humanNotified
          ? "Un humano del equipo IATOS te responderá con disponibilidad y precio. Todavía no es una reserva."
          : "Quedó registrada, pero no pudimos avisar al equipo al instante. Si no te respondemos pronto, usa \"Contactar Fixer\"."}
      </p>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground mt-2">
      Solicitud de cotización: un humano te responde con disponibilidad y precio reales. No es una reserva.
    </p>
  );
}

const Rating = ({ value }: { value?: number }) =>
  typeof value === "number" && Number.isFinite(value) ? (
    <span className="flex items-center gap-1 px-2 py-1 rounded-full bg-background/80 backdrop-blur text-xs">
      <Star className="w-3 h-3 fill-primary text-primary" /> {value.toFixed(1)}
    </span>
  ) : null;

function MediaHeader({ card, Icon }: { card: ConciergeCard; Icon: typeof Utensils }) {
  const img = safeHttpsUrl(card.image_url);
  return (
    <div className="h-32 bg-muted flex items-center justify-center relative overflow-hidden">
      {img ? <img src={img} alt={card.title} className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
        : <Icon className="w-10 h-10 text-primary/40" />}
      <span className="absolute top-3 right-3"><Rating value={card.rating} /></span>
    </div>
  );
}

const LINK_ICON: Record<CardLink["kind"], typeof Navigation> = {
  directions: Navigation, ride: Car, call: Phone, website: Globe, maps: MapPin, booking: CalendarCheck,
};

/**
 * Botones de la card (cómo llegar, Uber, llamar, sitio, reservar). Los arma el servidor con los
 * resultados reales; aquí se vuelven a validar (https o tel:). "Reservar" abre una búsqueda prellenada:
 * no es una reserva hecha.
 */
export function CardLinks({ card, onOpen }: { card: ConciergeCard; onOpen?: (url: string) => void }) {
  const links = (card.links ?? []).map(safeCardLink).filter(Boolean) as CardLink[];
  if (!links.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" data-testid="card-links">
      {links.map((l) => {
        const Icon = LINK_ICON[l.kind] ?? Link2;
        return (
          <a key={`${l.kind}-${l.url}`} href={l.url} target={l.kind === "call" ? undefined : "_blank"} rel="noopener noreferrer"
            onClick={() => l.kind !== "call" && onOpen?.(l.url)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 px-3 py-1.5 text-xs text-foreground hover:bg-primary/10 hover:border-primary transition min-h-[36px]">
            <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {l.label}
          </a>
        );
      })}
    </div>
  );
}

export function RichCard({ card, tripId }: { card: ConciergeCard; tripId?: string | null }) {
  const { user } = useAuth();
  const req = useConciergeRequest(tripId);
  const onOpen = (url: string) => logClick(user?.id, card, url, tripId);

  if (!card || typeof card !== "object" || typeof card.title !== "string") return null;

  if (card.type === "flight") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4" data-card-type="flight">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
              <Plane className="w-5 h-5 text-primary" />
            </div>
            <div className="min-w-0">
              <h4 className="font-display text-base leading-tight truncate">{card.title}</h4>
              {card.subtitle && <p className="text-xs text-muted-foreground">{card.subtitle}</p>}
            </div>
          </div>
          <PriceBlock card={card} suffix="total" />
        </div>
        {card.meta && <p className="text-xs text-muted-foreground mb-2">{card.meta}</p>}
        <div className="mb-3"><ProvenanceBadge card={card} /></div>
        <ExternalCta card={card} label={card.cta_label ?? "Ver y comprar"} onOpen={onOpen} className="w-full" />
      </div>
    );
  }

  if (card.type === "hotel" || card.type === "attraction") {
    const Icon = card.type === "hotel" ? BedDouble : Landmark;
    return (
      <div className="rounded-2xl border border-border bg-card overflow-hidden" data-card-type={card.type}>
        <MediaHeader card={card} Icon={Icon} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h4 className="font-display text-lg leading-tight">{card.title}</h4>
              {card.subtitle && <p className="text-sm text-muted-foreground mb-1">{card.subtitle}</p>}
            </div>
            <PriceBlock card={card} suffix={card.type === "hotel" ? card.meta ?? undefined : undefined} />
          </div>
          {card.meta && card.type !== "hotel" && <p className="text-xs text-primary mb-2">{card.meta}</p>}
          <div className="my-3"><ProvenanceBadge card={card} /></div>
          <ExternalCta card={card} label={card.cta_label ?? (card.type === "hotel" ? "Ver y reservar" : "Ver detalles")} onOpen={onOpen} className="w-full gold-glow" />
          <CardLinks card={card} onOpen={onOpen} />
        </div>
      </div>
    );
  }

  if (card.type === "place") {
    return (
      <div className="rounded-2xl border border-border bg-card p-4" data-card-type="place">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <MapPin className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-display text-base leading-tight">{card.title}</h4>
              <Rating value={card.rating} />
            </div>
            {card.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{card.subtitle}</p>}
            {card.meta && <p className="text-xs text-primary mt-1">{card.meta}</p>}
            {card.body && <p className="text-sm text-muted-foreground mt-2">{card.body}</p>}
            {card.fuente && <p className="text-[10px] text-muted-foreground mt-2">Fuente: {SOURCE_LABEL[String(card.fuente).toLowerCase()] ?? card.fuente}</p>}
          </div>
        </div>
        <CardLinks card={card} onOpen={onOpen} />
        {!card.links?.length && <div className="mt-3"><ExternalCta card={card} label={card.cta_label ?? "Ver en Google Maps"} onOpen={onOpen} className="h-9 px-3" /></div>}
      </div>
    );
  }

  if (card.type === "source") {
    const url = safeHttpsUrl(card.cta_action);
    return (
      <div className="rounded-2xl border border-border bg-surface/40 p-4" data-card-type="source">
        <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">Fuente{card.subtitle ? ` · ${card.subtitle}` : ""}</p>
        <h4 className="text-sm font-medium leading-snug">{card.title}</h4>
        {card.body && <p className="text-xs text-muted-foreground mt-1">{card.body}</p>}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(url)} className="inline-flex items-center gap-1 text-xs text-primary mt-2 hover:underline">
            Abrir fuente <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }

  if (card.type === "alert") {
    return (
      <motion.div
        animate={{ boxShadow: ["0 0 0 hsl(var(--primary)/0)", "0 0 24px hsl(var(--primary)/0.35)", "0 0 0 hsl(var(--primary)/0)"] }}
        transition={{ duration: 3, repeat: Infinity }}
        className="rounded-2xl border border-primary/60 bg-primary/5 p-4"
        data-card-type="alert"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="font-display text-base mb-1">{card.title}</p>
            <p className="text-sm text-muted-foreground mb-3">{card.body}</p>
            {safeHttpsUrl(card.cta_action) ? (
              <ExternalCta card={card} label={card.cta_label ?? "Abrir"} onOpen={onOpen} className="h-9 px-3" />
            ) : card.cta_label ? (
              <RequestButton state={req.state} label={card.cta_label}
                onClick={() => req.run({ type: "alert", title: card.title, payload: { body: card.body } })} className="h-9 px-3 text-sm" />
            ) : null}
          </div>
        </div>
      </motion.div>
    );
  }

  if (card.type === "restaurant") {
    const url = safeHttpsUrl(card.cta_action);
    return (
      <div className="rounded-2xl border border-border bg-card overflow-hidden" data-card-type="restaurant">
        <MediaHeader card={card} Icon={Utensils} />
        <div className="p-4">
          <h4 className="font-display text-lg leading-tight">{card.title}</h4>
          {card.subtitle && <p className="text-sm text-muted-foreground mb-1">{card.subtitle}</p>}
          {card.meta && <p className="text-xs text-primary mb-3">{card.meta}</p>}
          {url ? (
            <ExternalCta card={card} label={card.cta_label ?? "Reservar"} className="w-full gold-glow" onOpen={onOpen} />
          ) : (
            <>
              <RequestButton state={req.state} label="Pídeselo al Fixer" className="w-full gold-glow"
                onClick={() => req.run({ type: "reservation", title: card.title, payload: { subtitle: card.subtitle, meta: card.meta } })} />
              <RequestNote {...req} />
            </>
          )}
          <CardLinks card={card} onOpen={onOpen} />
          <p className="text-[10px] text-muted-foreground mt-2">Aún no está reservado: los enlaces abren la reserva o una búsqueda prellenada.</p>
        </div>
      </div>
    );
  }

  if (card.type === "transport") {
    const url = safeHttpsUrl(card.cta_action);
    return (
      <div className="rounded-2xl border border-border bg-card p-4" data-card-type="transport">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
            <Car className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h4 className="font-display text-base leading-tight">{card.title}</h4>
            {card.subtitle && <p className="text-xs text-muted-foreground">{card.subtitle}</p>}
          </div>
        </div>
        {card.meta && <p className="text-xs text-muted-foreground mb-3">{card.meta}</p>}
        {/* B-17: cada card abre SU enlace (Welcome Pickups, Blacklane, Maps…). Solo sin enlace se
            arma uno de Welcome Pickups con origen y destino de la card. */}
        {card.links?.length ? (
          <CardLinks card={card} onOpen={onOpen} />
        ) : url ? (
          <AffiliateActionButton type="custom_link" userId={user?.id} tripId={tripId ?? null} label={card.cta_label ?? "Abrir"}
            payload={{ url, provider: card.provider ?? new URL(url).hostname, accion: "concierge_transport" }} className="h-10 text-sm" />
        ) : (
          <AffiliateActionButton type="welcome_pickups_transfer" userId={user?.id} tripId={tripId ?? null} label={card.cta_label ?? "Reservar transfer"}
            payload={{ origen: card.subtitle?.split("→")[0]?.trim(), destino: card.subtitle?.split("→")[1]?.trim() ?? card.title }} className="h-10 text-sm" />
        )}
      </div>
    );
  }

  if (card.type === "luggage") {
    return (
      <div className="rounded-2xl border border-primary/30 bg-card overflow-hidden" data-card-type="luggage">
        <div className="relative h-28 bg-gradient-to-r from-stone-900 via-stone-800 to-stone-900 flex items-center px-5">
          <div className="absolute inset-0 opacity-30" style={{
            backgroundImage: "radial-gradient(circle at 10% 50%, hsl(var(--primary)/0.4), transparent 30%), radial-gradient(circle at 90% 50%, hsl(var(--primary)/0.4), transparent 30%)",
          }} />
          <div className="relative flex items-center justify-between w-full">
            <div className="text-xs text-muted-foreground">
              <p className="uppercase tracking-widest text-[10px] text-primary">Origen</p>
              <p>{card.from ?? "Por definir"}</p>
            </div>
            <div className="flex-1 mx-3 relative h-px bg-primary/30" />
            <div className="text-xs text-muted-foreground text-right">
              <p className="uppercase tracking-widest text-[10px] text-primary">Destino</p>
              <p>{card.to ?? "Por definir"}</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Luggage className="w-4 h-4 text-primary" />
            <h4 className="font-display text-base">{card.title}</h4>
          </div>
          <div className="mb-3"><ProvenanceBadge card={{ ...card, estado_dato: "SOLICITUD_HUMANA" }} /></div>
          <RequestButton state={req.state} label="Solicitar cotización" className="w-full"
            onClick={() => req.run({ type: "pickup", title: card.title, payload: { from: card.from, to: card.to } })} />
          <RequestNote {...req} />
        </div>
      </div>
    );
  }

  if (card.type === "jet") {
    return (
      <div className="rounded-2xl border border-primary/50 bg-gradient-to-br from-stone-950 via-stone-900 to-black overflow-hidden gold-glow" data-card-type="jet">
        <div className="relative h-32 flex items-center justify-center overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent" />
          <Plane className="w-16 h-16 text-primary relative" />
          <span className="absolute top-3 left-3 px-2 py-1 rounded-full bg-primary text-primary-foreground text-[10px] tracking-widest uppercase font-medium">
            Aviación privada
          </span>
        </div>
        <div className="p-4">
          <p className="text-[10px] tracking-[0.3em] text-primary uppercase mb-1">Solicitud de cotización</p>
          <h4 className="font-display text-lg mb-1">{card.title}</h4>
          {card.route && <p className="text-sm text-muted-foreground">{card.route}</p>}
          {card.fbo && <p className="text-xs text-muted-foreground">FBO sugerido: {card.fbo}</p>}
          {/* Sin proveedor de jets conectado no hay precio ni disponibilidad que mostrar. */}
          <div className="my-3"><ProvenanceBadge card={{ ...card, estado_dato: "SOLICITUD_HUMANA" }} /></div>
          <RequestButton state={req.state} label="Solicitar cotización" className="w-full gold-glow"
            onClick={() => req.run({ type: "jet", title: card.title, payload: { route: card.route, fbo: card.fbo } })} />
          <RequestNote {...req} />
        </div>
      </div>
    );
  }

  // Tipo desconocido (versión vieja del servidor): título y enlace, en vez de desaparecer.
  return (
    <div className="rounded-2xl border border-border bg-card p-4" data-card-type="generic">
      <h4 className="font-display text-base leading-tight">{card.title}</h4>
      {card.subtitle && <p className="text-xs text-muted-foreground mb-2">{card.subtitle}</p>}
      <ExternalCta card={card} label={card.cta_label ?? "Abrir"} onOpen={onOpen} />
    </div>
  );
}
