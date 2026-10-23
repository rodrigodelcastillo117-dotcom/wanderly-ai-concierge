// Restaurantes y experiencias de "Comprar" en carrusel por ciudad (pedido del dueño, 23-oct-2026):
// 4 tarjetas con foto — Económico, Medio, Caro y Recomendado por IATOS — que se deslizan con imán en el
// celular y con flechas en la computadora. Las reglas de precio y recomendación viven en tripPicks.ts.
//
// Fotos: SmartImage (foto real de Google Places si la hay; si no, ilustrativa de Pexels marcada
// "Foto ilustrativa"). Solo se piden al entrar la tarjeta en pantalla: en un carrusel horizontal las
// tarjetas fuera de la vista no cuentan hasta que se deslizan (presupuesto de place-photo y Pexels).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, ExternalLink, Sparkles, Star, Ticket, Utensils } from "lucide-react";
import { SmartImage } from "@/components/media/SmartImage";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { activityQuery, cuisineQuery } from "@/lib/categoryImagery";
import { buildPickCards, parsePriceRange, restaurantPriceLabel, SLOT_LABEL, TIER_LABEL, tierOf, tripUsdMxnRate, type PickCard, type PickKind, type TasteProfile } from "@/lib/tripPicks";
import { logBookingClick } from "@/lib/trackBooking";

export type PickAction = { url: string; site: string | null } | null;

type Props = {
  kind: PickKind;
  city: string;
  /** trips.restaurantes_json o trips.tours_json */
  list: any[];
  /** Índices de esa ciudad. */
  indices: number[];
  taste: TasteProfile | null;
  trip: any;
  /** Enlace de reserva precargado de un elemento (el mismo de "Comprar mi viaje"). */
  actionFor: (i: number) => PickAction;
  /** Elegido: experiencias = en el total (selTours); restaurantes = elegido por la persona. */
  isChosen: (i: number) => boolean;
  onChoose?: (i: number) => void;
  /** "Ya lo compré" de una experiencia elegida (controles de TripPurchasePlan). */
  extra?: (i: number) => ReactNode;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

function priceText(kind: PickKind, x: any, trip?: any): { text: string; note: string | null } {
  if (kind === "experiencia") {
    const p = Number(x?.precio_por_persona);
    if (p > 0) return { text: `${money(p)} por persona`, note: ["google_places", "tripadvisor", "getyourguide", "viator"].includes(String(x?.fuente_precio ?? "")) ? null : "estimado" };
    return { text: "Precio en el sitio", note: null };
  }
  const raw = String(x?.rango_precio ?? "").trim();
  // Nunca "€€€ (40-60 USD)" en una página en pesos: se convierte con la tasa con fuente o se dice en su moneda.
  const label = restaurantPriceLabel(raw, tripUsdMxnRate(trip));
  if (label && parsePriceRange(raw)) return label;
  if (x?.nivel_precio) return { text: String(x.nivel_precio), note: raw && raw !== x.nivel_precio && /^[$€]+$/.test(raw) ? raw : null };
  if (/^[$€]{1,4}$/.test(raw)) {
    const t = tierOf("restaurante", x);
    // "€€" no es un precio en pesos: solo el nivel en palabras.
    const sym = raw.startsWith("€") ? "" : raw;
    return { text: sym ? `${sym}${t ? ` · ${TIER_LABEL[t]}` : ""}` : t ? TIER_LABEL[t] : "Precio no publicado", note: String(x?.fuente ?? "").startsWith("google") ? null : "sin verificar" };
  }
  return { text: raw && raw !== "Precio no publicado" ? raw : "Precio no publicado", note: null };
}

function ratingText(x: any): string | null {
  const r = Number(x?.rating);
  if (!Number.isFinite(r) || r <= 0) return null;
  const n = Number(x?.num_reviews);
  return `${r.toLocaleString("es-MX", { maximumFractionDigits: 1 })}${Number.isFinite(n) && n > 0 ? ` (${n.toLocaleString("es-MX")})` : ""}`;
}

export function TripPicksCarousel({ kind, city, list, indices, taste, trip, actionFor, isChosen, onChoose, extra }: Props) {
  const cards = useMemo(() => buildPickCards(list, indices, kind, taste), [list, indices, kind, taste]);
  const track = useRef<HTMLDivElement>(null);
  const reduce = usePrefersReducedMotion();
  const [can, setCan] = useState({ prev: false, next: false });

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => setCan({ prev: el.scrollLeft > 4, next: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, [cards.length]);

  const go = (dir: -1 | 1) => {
    const el = track.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>("[data-card]");
    const step = card ? card.getBoundingClientRect().width + 12 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * step, behavior: reduce ? "auto" : "smooth" });
  };

  if (!cards.length) return null;
  const title = kind === "restaurante" ? "Restaurantes" : "Experiencias";
  const Icon = kind === "restaurante" ? Utensils : Ticket;
  const label = `${title} en ${city}`;

  return (
    <div className="space-y-2" data-testid={`picks-${kind}`} data-city={city}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="inline-flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-primary" aria-hidden="true" /> {title}</h4>
        <div className="hidden items-center gap-1.5 md:flex">
          <button type="button" onClick={() => go(-1)} disabled={!can.prev} aria-label={`${title}: anteriores`} data-testid={`picks-${kind}-prev`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 transition hover:border-primary/60 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={() => go(1)} disabled={!can.next} aria-label={`${title}: siguientes`} data-testid={`picks-${kind}-next`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/70 transition hover:border-primary/60 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div ref={track} role="list" aria-label={label}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-4 pb-1 no-scrollbar sm:mx-0 sm:px-0 motion-reduce:scroll-auto"
        style={{ scrollPaddingInline: "16px" }}>
        {cards.map((c, k) => <Card key={`${c.slot}-${c.index ?? k}`} card={c} {...{ kind, city, list, trip, actionFor, isChosen, onChoose, extra }} />)}
      </div>
    </div>
  );
}

const CARD = "snap-start shrink-0 w-[80%] sm:w-[46%] lg:w-[31.5%] rounded-2xl border overflow-hidden flex flex-col";

function Card({ card, kind, city, list, trip, actionFor, isChosen, onChoose, extra }: { card: PickCard } & Pick<Props, "kind" | "city" | "list" | "trip" | "actionFor" | "isChosen" | "onChoose" | "extra">) {
  const rec = card.slot === "recomendado";
  if (card.index == null) {
    return (
      <div role="listitem" data-card data-testid="pick-card-vacia" data-slot={card.slot}
        className={`${CARD} items-center justify-center border-dashed border-border/70 bg-surface/20 p-5 text-center`}>
        <span className="rounded-full border border-border/70 px-2.5 py-0.5 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{SLOT_LABEL[card.slot]}</span>
        <p className="mt-3 text-sm font-medium">{"missing" in card ? card.missing : ""}</p>
        <p className="mt-1 text-xs text-muted-foreground">No la inventamos: aparece cuando haya un precio real de ese nivel.</p>
      </div>
    );
  }
  const i = card.index;
  const x = list[i];
  const name = String(x?.nombre ?? (kind === "restaurante" ? "Restaurante" : "Experiencia")).replace(` · ${city}`, "").trim();
  const tipo = kind === "restaurante" ? (x?.cocina || "Restaurante") : (x?.duracion || "Experiencia");
  const price = priceText(kind, x, trip);
  const rating = ratingText(x);
  const action = actionFor(i);
  const chosen = isChosen(i);
  const reason = "reason" in card ? card.reason : null;
  return (
    <article role="listitem" data-card data-testid="pick-card" data-slot={card.slot} data-index={i}
      className={`${CARD} ${rec ? "border-primary/50 bg-primary/[0.05] shadow-[0_0_0_1px_hsl(var(--primary)/0.15)]" : chosen ? "border-primary/60 bg-card/80" : "border-border/60 bg-card/70"}`}>
      <SmartImage alt={name} size="card" className="aspect-[4/3] w-full shrink-0" captionPosition="bottom-right"
        imageUrl={x?.foto ?? x?.thumbnail ?? null} photoRef={x?.photo_ref ?? null}
        lookup={x?.place_id ? { placeId: x.place_id } : { name, city: x?.ciudad ?? city }}
        stockQuery={kind === "restaurante" ? cuisineQuery(x?.cocina, x?.nombre, i) : activityQuery(x?.nombre, x?.ciudad ?? city, i)}
        icon={kind === "restaurante" ? Utensils : Ticket}>
        <span className={`absolute left-2 top-2 z-[2] inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium backdrop-blur-md ${rec ? "bg-primary text-primary-foreground" : "bg-black/55 text-white"}`}
          data-testid="pick-slot">
          {rec && <Sparkles className="h-3 w-3" aria-hidden="true" />}{SLOT_LABEL[card.slot]}
        </span>
      </SmartImage>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h5 className="line-clamp-1 text-sm font-medium" title={name}>{name}</h5>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{tipo}</span>
          {rating && <span className="inline-flex shrink-0 items-center gap-0.5 text-foreground/90" aria-label={`Calificación ${rating}`}><Star className="h-3 w-3 fill-primary text-primary" aria-hidden="true" />{rating}</span>}
        </p>
        <p className="text-sm tabular-nums" data-testid="pick-price">{price.text}{price.note && <span className="ml-1 text-[11px] text-muted-foreground">· {price.note}</span>}</p>
        {reason && <p className="line-clamp-2 text-xs italic text-primary/90" data-testid="pick-reason">{reason}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {action?.url ? (
            <a href={action.url} target="_blank" rel="noopener noreferrer" data-testid="pick-reservar"
              onClick={() => void logBookingClick({ category: kind === "restaurante" ? "restaurant" : "activity", provider: action.site ?? "Proveedor", title: name,
                bookingUrl: action.url, city: x?.ciudad ?? city, tripId: trip?.id, startAt: trip?.fecha_salida ?? undefined })}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90">
              Reservar <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : <span className="flex-1 text-[11px] text-muted-foreground">Sin enlace fiable para reservar</span>}
          {onChoose && (
            <button type="button" onClick={() => onChoose(i)} aria-pressed={chosen} data-testid="pick-elegir"
              className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-xs transition ${chosen ? "border-primary bg-primary/15 text-foreground" : "border-border/70 hover:border-primary/50"}`}>
              {chosen ? <><Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> {kind === "experiencia" ? "En tu total" : "Elegido"}</> : kind === "experiencia" ? "Agregar al total" : "Elegir"}
            </button>
          )}
        </div>
        {chosen && extra?.(i)}
      </div>
    </article>
  );
}
