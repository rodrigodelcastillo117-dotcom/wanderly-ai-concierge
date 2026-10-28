// Botones de reserva de un restaurante en orden de confianza (_shared/restaurantBooking.ts): "Reservar en
// su sitio", "Reservar en TheFork" (búsqueda), "Llamar", "WhatsApp" (solo con número de Google) y
// "Llévame". Ninguno reserva: abren el sitio o la app del proveedor. Si Google dice que no toma
// reservaciones, se dice "No toma reservaciones (llega directo)".
import { useState } from "react";
import { CalendarCheck, ExternalLink, Globe, MessageCircle, Phone, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TakeMeThereButton } from "@/components/concierge/TakeMeThereButton";
import { logBookingClick } from "@/lib/trackBooking";
import { AskIatoTable } from "@/components/reservas/AskIatoTable";
import type { TakeMeThereTarget } from "@/lib/takeMeThere";
import { type RestaurantAction, type RestaurantBooking, restaurantBooking } from "../../../supabase/functions/_shared/restaurantBooking.ts";

const ICON = { website: Globe, thefork: CalendarCheck, opentable: CalendarCheck, call: Phone, whatsapp: MessageCircle } as const;
const pill = "inline-flex min-h-[36px] items-center gap-1 rounded-full border border-primary/30 px-3 text-[11px] text-foreground transition hover:border-primary hover:bg-primary/10";
const main = "inline-flex min-h-[36px] items-center gap-1 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground transition hover:bg-primary/90";

/** Solo enlaces https: o tel: (lo demás no se pinta). */
const safe = (a: RestaurantAction) => (a.kind === "call" ? /^tel:\+?\d{7,15}$/.test(a.url) : /^https:\/\//.test(a.url));

export function RestaurantBookingButtons({ booking, target, name, city, tripId, placeId }: {
  booking: RestaurantBooking | null | undefined; target?: TakeMeThereTarget | null; name: string; city?: string | null; tripId?: string | null;
  /** place_id de Google: con él (y Reservas IA disponible) aparece "Pedir mesa con Iato". */
  placeId?: string | null;
}) {
  const actions = (booking?.actions ?? []).filter(safe);
  return (
    <div data-testid="restaurant-booking">
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((a, i) => {
          const Icon = ICON[a.kind] ?? ExternalLink;
          const first = i === 0 && (a.kind === "website" || a.kind === "thefork") && booking?.reservable !== false;
          return (
            <a key={`${a.kind}-${a.url}`} href={a.url} target={a.kind === "call" ? undefined : "_blank"} rel="noopener noreferrer"
              data-testid={`reserva-${a.kind}`} className={first ? main : pill}
              title={a.kind === "thefork" || a.kind === "opentable" ? `Búsqueda en ${a.provider}: el lugar puede no estar ahí` : a.kind === "whatsapp" ? "Solo si el lugar usa WhatsApp en ese número" : undefined}
              onClick={() => { if (a.kind !== "call") void logBookingClick({ category: "restaurant", provider: a.provider, title: name, bookingUrl: a.url, city: city ?? undefined, tripId: tripId ?? undefined }); }}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {a.label}
            </a>
          );
        })}
        {booking?.reservable !== false && <AskIatoTable placeId={placeId ?? target?.placeId} name={name} city={city} tripId={tripId} />}
        {target && <TakeMeThereButton target={target} />}
      </div>
      {booking?.note && <p className={`mt-1 text-[11px] ${booking.reservable === false ? "text-primary" : "text-muted-foreground"}`} data-testid="reserva-nota">{booking.note}</p>}
    </div>
  );
}

/** "Boletos oficiales" (taquilla oficial) + "Con guía o sin fila en Viator" (búsqueda de Viator). */
export function OfficialTicketButtons({ ticket, tripId, compact = false }: {
  ticket: { nombre: string; ciudad?: string; taquilla_oficial: string; sin_fila_viator: string; nota?: string | null; reserva_obligatoria?: boolean | null } | null | undefined;
  tripId?: string | null; compact?: boolean;
}) {
  if (!ticket || !/^https:\/\//.test(ticket.taquilla_oficial)) return null;
  return (
    <div data-testid="boletos-oficiales">
      <div className="flex flex-wrap items-center gap-1.5">
        <a href={ticket.taquilla_oficial} target="_blank" rel="noopener noreferrer" className={main} data-testid="boletos-oficiales-taquilla"
          onClick={() => void logBookingClick({ category: "activity", provider: "Taquilla oficial", title: ticket.nombre, bookingUrl: ticket.taquilla_oficial, city: ticket.ciudad, tripId: tripId ?? undefined })}>
          <Ticket className="h-3.5 w-3.5" aria-hidden="true" /> Boletos oficiales
        </a>
        <a href={ticket.sin_fila_viator} target="_blank" rel="noopener noreferrer sponsored" className={pill} data-testid="boletos-viator"
          onClick={() => void logBookingClick({ category: "activity", provider: "Viator", title: ticket.nombre, bookingUrl: ticket.sin_fila_viator, city: ticket.ciudad, tripId: tripId ?? undefined })}>
          Con guía o sin fila en Viator <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
      {!compact && ticket.nota && <p className="mt-1 text-[11px] text-primary/90" data-testid="boletos-nota">{ticket.nota}</p>}
    </div>
  );
}

/**
 * "Ver cómo reservar" (Cercanos): la ficha de Google (place-details: sitio, teléfonos, reservable) se
 * pide SOLO al pulsar, nunca al abrir el lugar. Luego, los mismos botones en orden de confianza.
 */
export function LazyRestaurantBooking({ placeId, name, invoke }: {
  placeId: string; name: string;
  invoke?: (fn: string, opts: { body: Record<string, unknown> }) => Promise<{ data: any; error: any }>;
}) {
  const [state, setState] = useState<{ busy: boolean; booking: RestaurantBooking | null; error: string | null }>({ busy: false, booking: null, error: null });
  const run = async () => {
    setState({ busy: true, booking: null, error: null });
    try {
      const call = invoke ?? ((fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>);
      const { data, error } = await call("place-details", { body: { placeId, language: "es" } });
      const r = data?.result;
      if (error || !r) throw new Error("sin_ficha");
      setState({ busy: false, error: null, booking: restaurantBooking({ name: r.name ?? name, address: r.address, website: r.website, phone: r.phone, phoneInternational: r.phone_international, reservable: r.reservable }) });
    } catch {
      setState({ busy: false, booking: null, error: "Google Maps no respondió; intenta de nuevo." });
    }
  };
  if (state.booking) {
    return state.booking.actions.length || state.booking.note
      ? <RestaurantBookingButtons booking={state.booking} name={name} placeId={placeId} />
      : <p className="text-[11px] text-muted-foreground">Google no publica sitio ni teléfono de este lugar.</p>;
  }
  return (
    <div>
      <button type="button" onClick={run} disabled={state.busy} data-testid="ver-como-reservar"
        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-primary/40 px-3 text-xs text-foreground transition hover:bg-primary/10 disabled:opacity-60">
        <CalendarCheck className="h-3.5 w-3.5 text-primary" aria-hidden="true" />{state.busy ? "Consultando…" : "Ver cómo reservar"}
      </button>
      {state.error && <p className="mt-1 text-[11px] text-primary">{state.error}</p>}
    </div>
  );
}
