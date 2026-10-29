import { useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Link, useInRouterContext } from "react-router-dom";
import {
  AlertTriangle, BadgeCheck, BedDouble, Car, ExternalLink, Globe, Landmark, Luggage, MapPin, Navigation, Phone, Plane, Sparkles, Star,
  Utensils, UserRound, CalendarCheck, Link2, Ticket, Navigation2, MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SmartImage } from "@/components/media/SmartImage";
import { AirlineLogo } from "@/components/media/AirlineLogo";
import { airlineCode } from "@/lib/airlines";
import { activityQuery, cuisineQuery, hotelQuery } from "@/lib/categoryImagery";
import { ActionButton as AffiliateActionButton } from "@/components/ActionButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { track } from "@/lib/analytics";
import { logBookingClick, type TrackBookingInput } from "@/lib/trackBooking";
import { AskIatoTable } from "@/components/reservas/AskIatoTable";
import { TakeMeThereButton } from "./TakeMeThereButton";
import { ReservationStateBadge } from "./ReservationStateBadge";
import { canTakeMeThere, isMobileDevice, mapsDirectionsUrl, takeMeThereUrl } from "@/lib/takeMeThere";
import { ViatorTourCard } from "@/components/booking/ViatorTours";
import { tourViewFromCard } from "@/lib/viatorTours";
import { groundCardLink } from "@/lib/groundCardLinks";
import { newIdemKey } from "../../../supabase/functions/_shared/idempotency.ts";
import { frescuraPrecio } from "../../../supabase/functions/_shared/priceFreshness.ts";
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
/** Burbuja compacta del hilo (lado de Iato): ancho completo de la columna, esquina como globo de chat. */
const CARD_SHELL = "w-full rounded-2xl rounded-tl-md border border-border bg-card px-3 py-2.5";

/**
 * Transporte sin enlace propio (N-P1-4): el botón genérico de Welcome Pickups solo tiene sentido en un
 * traslado de aeropuerto. Un chofer por el día o una excursión "por cotizar" no lleva botón de compra:
 * la acción principal es pedírselo a una persona del equipo.
 */
export function transportFallback(card: Pick<ConciergeCard, "title" | "subtitle" | "meta">): "airport_transfer" | "team" {
  const t = `${card.title ?? ""} ${card.subtitle ?? ""} ${card.meta ?? ""}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/\b(por cotizar|cotizacion|excursion|tour|por el dia|todo el dia|ida y vuelta|por hora)\b/.test(t)) return "team";
  return /\b(aeropuerto|airport|terminal \d|aicm|aifa)\b/.test(t) ? "airport_transfer" : "team";
}

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
    // Solo el símbolo ($3,110): el código de moneda va aparte (antes salía "USD 3,110 USD").
    return new Intl.NumberFormat("es-MX", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `$${Math.round(amount).toLocaleString("es-MX")}`;
  }
};

const SOURCE_NAME: Record<string, string> = {
  serpapi: "Google",
  google_flights: "Google Flights",
  google_hotels: "Google Hotels",
  tripadvisor: "TripAdvisor",
  google_maps: "Google Maps",
  google_events: "Google Events",
  ticketmaster: "Ticketmaster",
  travelpayouts: "Aviasales · tarifa de referencia (últimas 48 h)",
  aviasales: "Aviasales · tarifa de referencia (últimas 48 h)",
};

/**
 * "Google Flights · consultado en vivo" solo si la consulta es de hace ≤ 15 min; si salió de la caché
 * se dice su antigüedad ("consultado hace 3 h"). Antes decía "consultado en vivo · 09:12" con una
 * consulta de hace horas (E2E 23-oct).
 */
export function sourceLabel(card: ConciergeCard, now: Date | number = Date.now()): string {
  const f = String(card.fuente ?? "").toLowerCase();
  if (f === "travelpayouts" || f === "aviasales") return SOURCE_NAME[f];
  const name = card.type === "flight" && f === "serpapi" ? "Google Flights" : card.type === "hotel" && f === "serpapi" ? "Google Hotels" : SOURCE_NAME[f] ?? card.fuente ?? "Fuente";
  const fr = frescuraPrecio({ estado: card.estado_dato, consultadoAt: card.consultado_at ?? null }, now);
  if (fr.frescura === "en_vivo") return `${name} · consultado en vivo`;
  if (!fr.edad) return `${name} · sin fecha de consulta`;
  return fr.frescura === "obsoleto" ? `${name} · consultado ${fr.edad} · actualízalo` : `${name} · consultado ${fr.edad}`;
}

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
    const enVivo = frescuraPrecio({ estado: card.estado_dato, consultadoAt: card.consultado_at ?? null }).frescura === "en_vivo";
    return (
      <span title={enVivo ? "Precio tomado de la búsqueda real de este momento; puede cambiar al reservar." : "Precio de una búsqueda real reciente (guardada); actualízalo antes de reservar."}
        className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary">
        <BadgeCheck className="w-3 h-3" /> {sourceLabel(card)}
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
        <p className="font-display text-base text-primary leading-none whitespace-nowrap">{formatMoney(p.amount, p.currency)} <span className="text-xs text-muted-foreground">{p.currency}</span></p>
        {suffix && <p className="text-[10px] text-muted-foreground mt-1">{suffix}</p>}
      </div>
    );
  }
  const saved = savedPrice(card);
  if (saved) {
    return (
      <div className="text-right">
        <p className="font-display text-base text-amber-500 leading-none whitespace-nowrap">{formatMoney(saved.amount, saved.currency)} <span className="text-xs text-muted-foreground">{saved.currency}</span></p>
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-full min-h-[36px] px-3.5 text-xs font-medium ${GOLD_CTA} ${className}`}
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
  // God Mode F1: estado real que devolvió el servidor ("solicitado"), para la etiqueta honesta.
  const [status, setStatus] = useState<string | null>(null);
  const [requestType, setRequestType] = useState<string | null>(null);
  // AUD-SEG-05: la misma solicitud reintentada (tras un timeout) lleva la misma clave y el servidor
  // devuelve el mismo folio en vez de crear otra. Tras el éxito, o si cambia la solicitud, clave nueva.
  const idem = useRef<{ sig: string; key: string } | null>(null);
  const run = async (payload: { type: string; title: string; payload?: Record<string, unknown> }) => {
    setState("loading");
    const sig = JSON.stringify([payload, tripId ?? null]);
    if (!idem.current || idem.current.sig !== sig) idem.current = { sig, key: newIdemKey() };
    const idempotency_key = idem.current.key;
    try {
      const { data, error } = await supabase.functions.invoke("concierge-action", {
        body: { ...payload, trip_id: tripId ?? null, idempotency_key },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.ok || !data?.request?.id) throw new Error("El servidor no confirmó la solicitud");
      idem.current = null;
      setFolio(String(data.request.id).slice(0, 8).toUpperCase());
      setHumanNotified(data.human_notified !== false);
      setStatus(typeof data.request.status === "string" ? data.request.status : "solicitado");
      setRequestType(payload.type);
      setState("confirmed");
      toast.success("Solicitud recibida", { description: "La atiende una persona del equipo IATOS. Verás su respuesta en Mis solicitudes y por correo." });
    } catch (e: any) {
      setState("error");
      toast.error(e?.message ?? "No pudimos registrar la solicitud");
    }
  };
  return { state, folio, humanNotified, status, requestType, run };
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

function RequestNote({ state, folio, humanNotified, status, requestType }: {
  state: RequestState; folio: string | null; humanNotified: boolean | null; status?: string | null; requestType?: string | null;
}) {
  if (state === "confirmed") {
    return (
      <>
      <div className="mt-2"><ReservationStateBadge status={status ?? "solicitado"} type={requestType} /></div>
      <p className="text-[11px] text-muted-foreground mt-1" role="status">
        Folio {folio}. {humanNotified
          ? "La atiende una persona del equipo IATOS: verás su respuesta en Concierge › Mis solicitudes y por correo. Todavía no es una reserva."
          : "Quedó registrada para una persona del equipo IATOS, pero el aviso al equipo no salió al instante; se reintenta solo. Verás la respuesta en Mis solicitudes y por correo."}
      </p>
      </>
    );
  }
  return (
    <p className="text-[11px] text-muted-foreground mt-2">
      Solicitud de cotización: una persona del equipo IATOS te responde con disponibilidad y precio reales (en la app y por correo). No es una reserva.
    </p>
  );
}

const Rating = ({ value }: { value?: number }) =>
  typeof value === "number" && Number.isFinite(value) ? (
    <span className="flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded-full bg-background/80 text-[11px]">
      <Star className="w-3 h-3 fill-primary text-primary" /> {value.toFixed(1)}
    </span>
  ) : null;

/** Destino de "Llévame": place_id y coordenadas vienen de la herramienta (enrichCardLinks), no del modelo. */
const takeMeTarget = (card: ConciergeCard) => ({
  name: card.title, address: card.type === "place" || card.type === "restaurant" ? card.subtitle ?? null : null,
  placeId: typeof card.place_id === "string" ? card.place_id : null,
  lat: typeof card.lat === "number" ? card.lat : null, lng: typeof card.lng === "number" ? card.lng : null,
});

/** Ciudad de la card si el subtítulo la trae ("París · 5★" → "París"). */
const cardCity = (card: ConciergeCard) => String(card.subtitle ?? "").split(/[·•|,]/)[0]?.trim().slice(0, 60) || null;

/** De qué buscar una foto ilustrativa si el lugar no tiene foto real. */
function stockFor(card: ConciergeCard): string {
  if (card.type === "restaurant") return cuisineQuery(`${card.meta ?? ""} ${card.subtitle ?? ""}`, card.title);
  if (card.type === "hotel") return hotelQuery(card.subtitle, card.title);
  return activityQuery(card.title, cardCity(card));
}

/**
 * Miniatura de una card de lugar (chat estilo WhatsApp: la card es una burbuja compacta, no un bloque
 * con foto de 160 px). Usa la foto que trajo la herramienta (Google Hotels / TripAdvisor), la de
 * Google Places del lugar (photo_ref o place_id de la evidencia) o, si Google no encuentra ESE lugar,
 * una foto ilustrativa de su tipo marcada como tal.
 */
function MediaThumb({ card, Icon }: { card: ConciergeCard; Icon: typeof Utensils }) {
  const img = safeHttpsUrl(card.image_url);
  const photoRef = typeof card.photo_ref === "string" ? card.photo_ref : null;
  const placeId = typeof card.place_id === "string" ? card.place_id : null;
  return (
    <SmartImage
      alt={card.title}
      imageUrl={img ?? null}
      photoRef={photoRef}
      lookup={placeId ? { placeId } : { name: card.title, city: cardCity(card) }}
      stockQuery={stockFor(card)}
      size="thumb"
      icon={Icon}
      className="w-16 h-16 rounded-xl shrink-0 ring-1 ring-white/[0.06]"
      captionPosition="bottom-left"
    />
  );
}

/** Aerolínea de una card de vuelo (proveedor o título: "Aeroméxico · MEX → MAD", "AM 401"). */
function airlineOf(card: ConciergeCard): string | null {
  for (const v of [card.provider, card.title, card.subtitle]) if (airlineCode(v)) return String(v);
  return null;
}

const LINK_ICON: Record<CardLink["kind"], typeof Navigation> = {
  directions: Navigation, ride: Car, call: Phone, website: Globe, maps: MapPin, booking: CalendarCheck, tickets: Ticket, whatsapp: MessageCircle,
};

/**
 * Botones de la card (cómo llegar, Uber, llamar, sitio, reservar). Los arma el servidor con los
 * resultados reales; aquí se vuelven a validar (https o tel:). "Reservar" abre una búsqueda prellenada:
 * no es una reserva hecha.
 */
/** Etiqueta corta para las burbujas compactas (la completa queda como nombre accesible y título). */
const SHORT_LABEL: Record<CardLink["kind"], string> = {
  directions: "Cómo llegar", ride: "Uber", call: "Llamar", website: "Sitio", maps: "Maps", booking: "Reservar", tickets: "Boletos", whatsapp: "WhatsApp",
};

/** Nota del servidor ("No toma reservaciones (llega directo)" o la nota oficial del museo). */
const BookingNote = ({ card }: { card: ConciergeCard }) =>
  typeof card.booking_note === "string" && card.booking_note.trim()
    ? <p className="text-[11px] text-primary/90 mt-1" data-testid="card-booking-note">{card.booking_note.slice(0, 200)}</p>
    : null;

/** Etiquetas que dicen a dónde lleva el botón: se muestran completas también en las burbujas compactas. */
const KEEP_FULL_LABEL = /^(Reservar en |Boletos oficiales|Con guía o sin fila)/;

export function CardLinks({ card, onOpen, compact = false, children }: { card: ConciergeCard; onOpen?: (url: string) => void; compact?: boolean; children?: ReactNode }) {
  const links = (card.links ?? []).map(safeCardLink).filter(Boolean) as CardLink[];
  if (!links.length && !children) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5" data-testid="card-links">
      {children}
      {links.map((l) => {
        const Icon = LINK_ICON[l.kind] ?? Link2;
        return (
          <a key={`${l.kind}-${l.url}`} href={l.url} target={l.kind === "call" ? undefined : "_blank"} rel="noopener noreferrer"
            {...(compact ? { "aria-label": l.label, title: l.label } : {})}
            onClick={() => l.kind !== "call" && onOpen?.(l.url)}
            className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-2.5 py-1 text-[11px] text-foreground hover:bg-primary/10 hover:border-primary transition min-h-[32px]">
            <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> {compact && !KEEP_FULL_LABEL.test(l.label) ? SHORT_LABEL[l.kind] ?? l.label : l.label}
          </a>
        );
      })}
    </div>
  );
}


/**
 * Avisos con una sección de IATOS que lo resuelve (auditoría 10, ronda 4, N4-P2-6): "Sin seguro de viaje"
 * decía "en la sección Seguros de IATOS" sin enlace. Ahora lleva el botón a la sección (rutas que existen
 * en App.tsx: /dashboard/seguros y /dashboard/esim).
 */
export function alertInternalLink(card: { title?: string; body?: string }): { to: string; label: string } | null {
  const t = `${card.title ?? ""} ${card.body ?? ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (/\bseguros?\b/.test(t)) return { to: "/dashboard/seguros", label: "Ver seguros de viaje" };
  if (/\besim\b|plan de datos/.test(t)) return { to: "/dashboard/esim", label: "Ver eSIM" };
  return null;
}

function InternalCta({ to, label }: { to: string; label: string }) {
  const inRouter = useInRouterContext();
  const cls = "inline-flex items-center gap-1 h-9 px-3 rounded-full border border-primary/50 text-sm text-primary hover:bg-primary/10";
  return inRouter
    ? <Link to={to} className={cls} data-testid="alert-internal-cta">{label}</Link>
    : <a href={to} className={cls} data-testid="alert-internal-cta">{label}</a>;
}

export function RichCard({ card, tripId }: { card: ConciergeCard; tripId?: string | null }) {
  const { user } = useAuth();
  const req = useConciergeRequest(tripId);
  const onOpen = (url: string) => logClick(user?.id, card, url, tripId);

  if (!card || typeof card !== "object" || typeof card.title !== "string") return null;

  if (card.type === "flight") {
    return (
      <div className={CARD_SHELL} data-card-type="flight">
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-3 min-w-0">
            {airlineOf(card) ? (
              <AirlineLogo airline={airlineOf(card)} size={36} />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <Plane className="w-5 h-5 text-primary" />
              </div>
            )}
            <div className="min-w-0">
              <h4 className="text-sm font-medium leading-tight truncate">{card.title}</h4>
              {card.subtitle && <p className="text-xs text-muted-foreground">{card.subtitle}</p>}
            </div>
          </div>
          <PriceBlock card={card} suffix={card.price_basis ?? "total"} />
        </div>
        {card.meta && <p className="text-xs text-muted-foreground mb-1.5">{card.meta}</p>}
        <div className="mb-2"><ProvenanceBadge card={card} /></div>
        <ExternalCta card={card} label={card.cta_label ?? "Ver y comprar"} onOpen={onOpen} className="w-full" />
      </div>
    );
  }

  if (card.type === "hotel" || card.type === "attraction") {
    const Icon = card.type === "hotel" ? BedDouble : Landmark;
    return (
      <div className={CARD_SHELL} data-card-type={card.type}>
        <div className="flex items-start gap-3">
          <MediaThumb card={card} Icon={Icon} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-medium leading-tight break-words">{card.title}</h4>
              {verifiedPrice(card) || savedPrice(card) ? null : <Rating value={card.rating} />}
            </div>
            {card.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{card.subtitle}</p>}
            {card.meta && card.type !== "hotel" && <p className="text-xs text-primary mt-0.5">{card.meta}</p>}
            <div className="mt-1.5 flex flex-wrap items-end justify-between gap-2">
              <ProvenanceBadge card={card} />
              <PriceBlock card={card} suffix={card.type === "hotel" ? card.price_basis ?? card.meta ?? undefined : undefined} />
            </div>
          </div>
        </div>
        <CardLinks card={card} onOpen={onOpen} compact>
          <ExternalCta card={card} label={card.cta_label ?? (card.type === "hotel" ? "Ver y reservar" : "Ver detalles")} onOpen={onOpen} className="min-h-[32px] px-3" />
          <TakeMeThereButton target={takeMeTarget(card)} onOpen={onOpen} />
        </CardLinks>
        <BookingNote card={card} />
      </div>
    );
  }

  if (card.type === "place") {
    return (
      <div className={CARD_SHELL} data-card-type="place">
        <div className="flex items-start gap-3">
          <SmartImage
            alt={card.title}
            imageUrl={safeHttpsUrl(card.image_url) ?? null}
            photoRef={typeof card.photo_ref === "string" ? card.photo_ref : null}
            lookup={typeof card.place_id === "string" ? { placeId: card.place_id } : { name: card.title, city: cardCity(card) }}
            stockQuery={activityQuery(card.title, cardCity(card))}
            size="thumb"
            icon={MapPin}
            className="w-16 h-16 rounded-xl shrink-0 ring-1 ring-white/[0.06]"
            captionPosition="bottom-left"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-medium leading-tight break-words">{card.title}</h4>
              <Rating value={card.rating} />
            </div>
            {card.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{card.subtitle}</p>}
            {card.meta && <p className="text-xs text-primary mt-1">{card.meta}</p>}
            {card.body && <p className="text-xs text-muted-foreground mt-1">{card.body}</p>}
            {card.fuente && <p className="text-[10px] text-muted-foreground mt-1">Fuente: {SOURCE_NAME[String(card.fuente).toLowerCase()] ?? card.fuente}</p>}
          </div>
        </div>
        <CardLinks card={card} onOpen={onOpen}>
          {canTakeMeThere(takeMeTarget(card)) && <TakeMeThereButton target={takeMeTarget(card)} onOpen={onOpen} />}
        </CardLinks>
        {!card.links?.length && <div className="mt-2"><ExternalCta card={card} label={card.cta_label ?? "Ver en Google Maps"} onOpen={onOpen} /></div>}
        <BookingNote card={card} />
      </div>
    );
  }

  if (card.type === "event") {
    // Event Radar: todo sale de Ticketmaster o Google Events de este turno (eventCards en el servidor).
    // Precio solo si Ticketmaster lo publica (priceRanges), con su aviso; Google Events nunca trae precio.
    const tm = card.fuente === "ticketmaster";
    const at = card.consultado_at ? new Date(card.consultado_at) : null;
    const hhmm = at && Number.isFinite(at.getTime()) ? at.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
    const place = [card.meta, card.address].filter(Boolean).join(", ");
    const target = { name: card.meta ?? card.title, lat: typeof card.lat === "number" ? card.lat : null, lng: typeof card.lng === "number" ? card.lng : null };
    const go = (canTakeMeThere(target) ? takeMeThereUrl(target, { mobile: isMobileDevice() }) : null)
      ?? (place ? mapsDirectionsUrl({ destination: place, mobile: isMobileDevice() }) : null);
    const price = tm && typeof card.price === "number" && card.price > 0 && card.currency ? `Desde ${formatMoney(card.price, card.currency)} ${card.currency}` : null;
    return (
      <div className={CARD_SHELL} data-card-type="event">
        <div className="flex items-start gap-3">
          <SmartImage alt={card.title} imageUrl={safeHttpsUrl(card.image_url) ?? null} stockQuery={activityQuery(card.title, null)} size="thumb" icon={Ticket}
            className="w-16 h-16 rounded-xl shrink-0 ring-1 ring-white/[0.06]" captionPosition="bottom-left" />
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium leading-tight break-words">{card.title}</h4>
            {card.subtitle && <p className="text-xs text-primary mt-0.5" data-testid="event-when">{card.subtitle}</p>}
            {card.meta && <p className="text-xs text-muted-foreground mt-0.5">{card.meta}</p>}
            {card.address && <p className="text-xs text-muted-foreground">{card.address}</p>}
            {(card.body || card.status) && (
              <p className="text-[11px] text-muted-foreground mt-0.5" data-testid="event-status">
                {[card.body, card.status].filter(Boolean).join(" · ")}
              </p>
            )}
            {price && <p className="text-xs text-primary mt-0.5" data-testid="event-price">{price} <span className="text-[10px] text-muted-foreground">· {card.price_note ?? "precio publicado por Ticketmaster · puede cambiar"}</span></p>}
            <p className="text-[10px] text-muted-foreground mt-1" data-testid="event-source">Fuente: {tm ? "Ticketmaster" : "Google Events"}{hhmm ? ` · consultado ${hhmm}` : ""}</p>
          </div>
        </div>
        <CardLinks card={card} onOpen={onOpen}>
          {go && (
            <a href={go} target="_blank" rel="noopener noreferrer" data-testid="take-me-there" onClick={() => onOpen(go)}
              aria-label={`Llévame a ${card.meta ?? card.title} con Google Maps`}
              className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/20 transition min-h-[32px]">
              <Navigation2 className="w-3.5 h-3.5" aria-hidden="true" /> Llévame
            </a>
          )}
        </CardLinks>
        {card.links?.some((l) => l.kind === "tickets") && (
          <p className="text-[10px] text-muted-foreground mt-1">{tm ? "Los boletos se compran en Ticketmaster; abrir el enlace no es una compra." : "Los boletos se compran en el sitio de boletos; el precio lo ves ahí."}</p>
        )}
      </div>
    );
  }

  if (card.type === "tour") {
    // Tours de Viator: todo sale de search_tours de este turno (tourCards en el servidor). Precio "desde".
    const view = tourViewFromCard(card);
    if (!view) return null;
    const at = card.consultado_at ? new Date(card.consultado_at) : null;
    const hhmm = at && Number.isFinite(at.getTime()) ? at.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false }) : null;
    return (
      <ul className="w-full list-none" data-card-type="tour">
        <ViatorTourCard tour={view} time={hhmm} tripId={tripId ?? undefined} showSource />
      </ul>
    );
  }

  if (card.type === "source") {
    const url = safeHttpsUrl(card.cta_action);
    return (
      <div className={`${CARD_SHELL} bg-surface/40`} data-card-type="source">
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
    const internal = alertInternalLink(card);
    return (
      <motion.div
        animate={{ boxShadow: ["0 0 0 hsl(var(--primary)/0)", "0 0 24px hsl(var(--primary)/0.35)", "0 0 0 hsl(var(--primary)/0)"] }}
        transition={{ duration: 3, repeat: Infinity }}
        className="w-full rounded-2xl rounded-tl-md border border-primary/60 bg-primary/5 px-3 py-2.5"
        data-card-type="alert"
      >
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium mb-0.5">{card.title}</p>
            <p className="text-xs text-muted-foreground mb-2">{card.body}</p>
            {safeHttpsUrl(card.cta_action) ? (
              <ExternalCta card={card} label={card.cta_label ?? "Abrir"} onOpen={onOpen} />
            ) : internal ? (
              <InternalCta to={internal.to} label={internal.label} />
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
      <div className={CARD_SHELL} data-card-type="restaurant">
        <div className="flex items-start gap-3">
          <MediaThumb card={card} Icon={Utensils} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-medium leading-tight break-words">{card.title}</h4>
              <Rating value={card.rating} />
            </div>
            {card.subtitle && <p className="text-xs text-muted-foreground mt-0.5">{card.subtitle}</p>}
            {card.meta && <p className="text-xs text-primary mt-0.5">{card.meta}</p>}
          </div>
        </div>
        {/* Con botones de reserva reales (su sitio, TheFork…): van primero, en orden de confianza, y luego
            Llévame y el Fixer. Sin ellos: un solo renglón (reservar o Fixer + cómo llegar, Uber, Maps). */}
        {(card.links ?? []).some((l) => l.kind === "website" || l.kind === "booking") && !url ? (
          <>
            <CardLinks card={card} onOpen={onOpen} compact />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <TakeMeThereButton target={takeMeTarget(card)} onOpen={onOpen} />
              <AskIatoTable placeId={card.place_id} name={card.title} tripId={tripId ?? null} />
              <RequestButton state={req.state} label="Pídeselo al equipo" className="h-8 px-3 text-[11px] rounded-full"
                onClick={() => req.run({ type: "reservation", title: card.title, payload: { subtitle: card.subtitle, meta: card.meta } })} />
            </div>
          </>
        ) : (
        <CardLinks card={card} onOpen={onOpen} compact>
          {url ? (
            <ExternalCta card={card} label={card.cta_label ?? "Reservar"} onOpen={onOpen} className="min-h-[32px] px-3" />
          ) : (
            <RequestButton state={req.state} label="Pídeselo al equipo" className="h-8 px-3 text-[11px] rounded-full"
              onClick={() => req.run({ type: "reservation", title: card.title, payload: { subtitle: card.subtitle, meta: card.meta } })} />
          )}
          <AskIatoTable placeId={card.place_id} name={card.title} tripId={tripId ?? null} />
          <TakeMeThereButton target={takeMeTarget(card)} onOpen={onOpen} />
        </CardLinks>
        )}
        {!url && req.state !== "idle" && <RequestNote {...req} />}
        <BookingNote card={card} />
        <p className="text-[10px] text-muted-foreground mt-1" title="Los enlaces abren la reserva o una búsqueda prellenada; pedírselo al equipo es una solicitud a una persona.">Aún no está reservado.</p>
      </div>
    );
  }

  if (card.type === "transport") {
    const url = safeHttpsUrl(card.cta_action);
    return (
      <div className={CARD_SHELL} data-card-type="transport">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Car className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-medium leading-tight">{card.title}</h4>
            {card.subtitle && <p className="text-xs text-muted-foreground">{card.subtitle}</p>}
          </div>
        </div>
        {card.meta && <p className="text-xs text-muted-foreground mb-2">{card.meta}</p>}
        {/* Grupo terrestre: tren, ferry o yate → la pantalla de IATOS con la ruta escrita (ahí, con la fecha,
            salen los enlaces precargados del operador o las salidas en vivo). Sin precio. */}
        {(() => { const g = groundCardLink(card); return g ? (
          <a href={g.href} data-testid="card-ground-link" className="mb-2 inline-flex min-h-[32px] items-center rounded-full border border-primary/40 px-3 text-[11px] text-primary">{g.label}</a>
        ) : null; })()}
        {/* B-17: cada card abre SU enlace (Welcome Pickups, Blacklane, Maps…). Ronda 3 (N-P1-4): sin enlace
            ya no se arma el "Reservar transfer" genérico de Welcome Pickups (portada de traslados de
            aeropuerto, sin origen ni destino): solo para un traslado de aeropuerto. Lo demás (chofer por el
            día, excursión, "precio por cotizar") lo pide una persona del equipo con la acción de abajo. */}
        {card.links?.length ? (
          <CardLinks card={card} onOpen={onOpen} />
        ) : url ? (
          <AffiliateActionButton type="custom_link" userId={user?.id} tripId={tripId ?? null} label={card.cta_label ?? "Abrir"}
            payload={{ url, provider: card.provider ?? new URL(url).hostname, accion: "concierge_transport" }} className="h-9 text-xs" />
        ) : transportFallback(card) === "airport_transfer" ? (
          <AffiliateActionButton type="welcome_pickups_transfer" userId={user?.id} tripId={tripId ?? null} label={card.cta_label ?? "Reservar transfer al aeropuerto"}
            payload={{ origen: card.subtitle?.split("→")[0]?.trim(), destino: card.subtitle?.split("→")[1]?.trim() ?? card.title }} className="h-9 text-xs" />
        ) : (
          <p className="text-[11px] text-muted-foreground" data-testid="transport-team-note">Precio por cotizar: lo gestiona una persona del equipo IATOS. Aún no está reservado.</p>
        )}
      </div>
    );
  }

  if (card.type === "luggage") {
    return (
      <div className="w-full rounded-2xl rounded-tl-md border border-primary/30 bg-card overflow-hidden" data-card-type="luggage">
        <div className="relative h-16 bg-gradient-to-r from-stone-900 via-stone-800 to-stone-900 flex items-center px-5">
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
        <div className="px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1">
            <Luggage className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-medium">{card.title}</h4>
          </div>
          <div className="mb-2"><ProvenanceBadge card={{ ...card, estado_dato: "SOLICITUD_HUMANA" }} /></div>
          <RequestButton state={req.state} label="Solicitar cotización" className="h-9 px-3.5 text-xs rounded-full"
            onClick={() => req.run({ type: "pickup", title: card.title, payload: { from: card.from, to: card.to } })} />
          <RequestNote {...req} />
        </div>
      </div>
    );
  }

  if (card.type === "jet") {
    return (
      <div className="w-full rounded-2xl rounded-tl-md border border-primary/50 bg-gradient-to-br from-stone-950 via-stone-900 to-black overflow-hidden" data-card-type="jet">
        <div className="relative h-20 flex items-center justify-center overflow-hidden">
          {/* Foto ilustrativa (marcada): no hay proveedor de jets conectado ni avión asignado. */}
          <SmartImage alt="" stockQuery="private jet luxury" icon={Plane} className="!absolute inset-0" captionPosition="bottom-right">
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/20" />
          </SmartImage>
          <span className="absolute top-3 left-3 px-2 py-1 rounded-full bg-primary text-primary-foreground text-[10px] tracking-widest uppercase font-medium">
            Aviación privada
          </span>
        </div>
        <div className="px-3 py-2.5">
          <p className="text-[10px] tracking-[0.2em] text-primary uppercase mb-0.5">Solicitud de cotización</p>
          <h4 className="text-sm font-medium mb-0.5">{card.title}</h4>
          {card.route && <p className="text-sm text-muted-foreground">{card.route}</p>}
          {card.fbo && <p className="text-xs text-muted-foreground">FBO sugerido: {card.fbo}</p>}
          {/* Sin proveedor de jets conectado no hay precio ni disponibilidad que mostrar. */}
          <div className="my-2"><ProvenanceBadge card={{ ...card, estado_dato: "SOLICITUD_HUMANA" }} /></div>
          <RequestButton state={req.state} label="Solicitar cotización" className="h-9 px-3.5 text-xs rounded-full"
            onClick={() => req.run({ type: "jet", title: card.title, payload: { route: card.route, fbo: card.fbo } })} />
          <RequestNote {...req} />
        </div>
      </div>
    );
  }

  // Tipo desconocido (versión vieja del servidor): título y enlace, en vez de desaparecer.
  return (
    <div className={CARD_SHELL} data-card-type="generic">
      <h4 className="text-sm font-medium leading-tight">{card.title}</h4>
      {card.subtitle && <p className="text-xs text-muted-foreground mb-2">{card.subtitle}</p>}
      <ExternalCta card={card} label={card.cta_label ?? "Abrir"} onOpen={onOpen} />
    </div>
  );
}
