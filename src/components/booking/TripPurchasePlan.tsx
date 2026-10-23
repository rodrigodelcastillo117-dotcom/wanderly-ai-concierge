// "Comprar mi viaje": elegir y comprar en un solo lugar (rediseño del caso Roma → Florencia → Venecia).
// Pasos numerados (1. Vuelo · 2. Hotel en Roma · … · Auto) con palomita en lo hecho y "Te falta" arriba.
// Cada paso muestra sus opciones reales (hasta 3, con fuente y estado del precio), se elige con un
// toque (cambia el total: reúsa selVuelo / selHospedaje / selHoteles / selTours de la página) y ahí
// mismo está el botón de compra precargado. El detalle ("Te lleva a…", "Va precargado…") va plegado en
// "Ver detalles". "Ya lo compré" lo marca a mano el usuario (IATOS no ve la compra); en un viaje
// compartido todos ven quién lo marcó (r2 grupo, useTripPurchaseMarks).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { Link } from "react-router-dom";
import { ArrowRight, Bus, Car, CarTaxiFront, Check, ChevronDown, ExternalLink, Hotel, ListChecks, Plane, Route as RouteIcon, Ship, ShieldCheck, Train, Undo2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { SmartImage } from "@/components/media/SmartImage";
import { logBookingClick } from "@/lib/trackBooking";
import { itemPurchaseState, primaryAction, type PurchaseItem, type PurchaseMarkRow, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { buildBuyFlow, hotelTotal, TIER_WORD, type BuyStep } from "@/lib/buyFlow";
import { flightAirlineLabel, flightDurationLabel, flightStopsLabel } from "@/lib/flightDisplay";
import { offerFromTripTour, tripDestinations, venueFromTripPlace } from "@/lib/booking";
import { hotelQuery } from "@/lib/categoryImagery";
import { canUnmark, markLabel } from "@/lib/purchaseMarks";
import { useTripPurchaseMarks } from "@/hooks/useTripPurchaseMarks";
import { useTasteProfile } from "@/hooks/useTasteProfile";
import { TripPicksCarousel, type PickAction } from "@/components/booking/TripPicksCarousel";
import { FlightBuyButtons } from "@/components/booking/FlightBuyButtons";
import { HotelOffersButton, MultiCityFareButton } from "@/components/booking/RealPriceButtons";
import { transportRubroLabel } from "@/lib/multiDestTrip";

const DESGLOSE_LABEL: Record<string, string> = { vuelos: "Vuelos", hospedaje: "Hospedaje", comida: "Comida", tours: "Experiencias", transporte_local: "Transporte local", extras: "Extras" };
const money = (n: number, cur: string | null = "MXN") => `$${Math.round(n).toLocaleString("es-MX")} ${cur ?? "MXN"}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type Props = {
  trip: any;
  selVuelo: number;
  selHospedaje: number;
  selTours: Set<number>;
  /** Multi-destino: hotel elegido por ciudad. */
  selHoteles?: Record<string, number> | null;
  serverOffers?: TripOfferActionsLike;
  bookings: PurchaseMarkRow[];
  userId: string | null;
  /** Dueño del viaje (puede quitar cualquier marca). Por defecto, trip.user_id. */
  ownerId?: string | null;
  quoteCreatedAt?: string | null;
  onChanged?: () => void;
  /** Elegir una opción (cambia el total). -2 = "Ya tengo vuelo / dónde quedarme"; -1 = volver a elegir. */
  onSelectVuelo?: (i: number) => void;
  onSelectHotel?: (city: string | null, i: number) => void;
  onToggleTour?: (i: number) => void;
  /** Marcas ya cargadas por la página (el total también las usa): así no se cargan dos veces. */
  marksState?: ReturnType<typeof useTripPurchaseMarks> | null;
  /** Último paso "Listo · Revisa y compra": total del viaje con la selección (el mismo de la página). */
  selectionTotal?: number | null;
  /** El desglose que suma ese total (computeTripDesglose de la página): las partidas del resumen salen de aquí. */
  selectionDesglose?: Record<string, number> | null;
  /** "Incluye estimados: vuelos." (tripTotalSummary), la misma nota del total de la página. */
  estimadosNote?: string | null;
  /** "Ver mi viaje" (p. ej. ir a Resumen). */
  onViewTrip?: () => void;
  /** Hueco para "Enviarme mi selección por correo" (lo hace la rama claude/correo-seleccion). */
  sendSelectionSlot?: ReactNode;
};

/** Verbo del botón principal: "Comprar en Google Flights", "Buscar en Kayak"… */
function buyLabel(it: PurchaseItem): string {
  if (it.buttonLabel) return it.buttonLabel;
  if (it.kind === "auto") return `Buscar en ${it.site}`;
  if (it.kind === "restaurante") return `Reservar en ${it.site}`;
  return `Comprar en ${it.site}`;
}

export function TripPurchasePlan({ trip, selVuelo, selHospedaje, selTours, selHoteles, serverOffers = {}, bookings, userId, ownerId, quoteCreatedAt, onChanged,
  onSelectVuelo, onSelectHotel, onToggleTour, marksState, selectionTotal, selectionDesglose, estimadosNote, onViewTrip, sendSelectionSlot }: Props) {
  const [selLegs, setSelLeg] = useLegChoices(trip?.id ?? null);
  const flow = useMemo(
    () => buildBuyFlow(trip, { selVuelo, selHospedaje, selTours, selHoteles, selLegs }, serverOffers, { quoteCreatedAt }),
    [trip, selVuelo, selHospedaje, selTours, selHoteles, selLegs, serverOffers, quoteCreatedAt],
  );
  const reduce = usePrefersReducedMotion();
  const [current, setCurrent] = useState<string | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (advanceTimer.current) clearTimeout(advanceTimer.current); }, []);
  // Con las marcas de la página, este hook queda inactivo (sin viaje no carga nada).
  const ownMarks = useTripPurchaseMarks({ trip: marksState ? (null as any) : trip, userId, bookings });
  const { rows, marks, mark: saveMark, unmark: removeMark } = marksState ?? ownMarks;
  const owner = ownerId ?? trip?.user_id ?? null;
  const [busy, setBusy] = useState<string | null>(null);
  const taste = useTasteProfile(userId);
  const [restPicks, setRestPicks] = useRestaurantPicks(trip?.id ?? null);

  const items = flow.items;
  if (!items.length && !flow.steps.length) return null;
  // Lo que hay que comprar: lo de la lista y, en multi-destino, cada traslado entre ciudades.
  const core = [...items.filter((i) => !i.optional), ...flow.steps.flatMap((s) => (s.kind === "traslado" ? [s.item] : []))];
  const state = (it: PurchaseItem | null) => (it ? itemPurchaseState(it, rows, marks) : "pendiente");
  const doneCore = core.filter((i) => state(i) !== "pendiente").length;
  const stepDone = (s: BuyStep) => ((s.kind === "vuelo" || s.kind === "hospedaje") && s.skipped) || (!!s.item && state(s.item) !== "pendiente");

  // ── Flujo guiado: "Siguiente →" en cada paso, los chips saltan y el último es "Listo · Revisa y compra". ──
  const nav: Array<{ id: string; title: string }> = [
    ...flow.steps.map((s) => ({ id: `paso-${s.n}`, title: s.title })),
    ...(flow.extras.length ? [{ id: "paso-extras", title: "Restaurantes y experiencias" }] : []),
    { id: "paso-listo", title: "Listo · Revisa y compra" },
  ];
  const goTo = (id: string) => {
    setCurrent(id);
    const el = document.getElementById(id);
    el?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // El foco va al título del paso (lectores de pantalla y teclado).
    (el?.querySelector("h3, h2") as HTMLElement | null)?.focus?.({ preventScroll: true });
  };
  const nextOf = (id: string) => nav[nav.findIndex((x) => x.id === id) + 1] ?? null;
  /** Qué falta en un paso (no bloquea: "Siguiente" lo dice). */
  const missingOf = (s: BuyStep): string | null => {
    if (s.kind === "vuelo") return !s.skipped && s.options.length > 0 && s.chosen < 0 ? "Te falta elegir el vuelo" : null;
    // El hotel de la cotización (por defecto) no cuenta como elegido: lo mismo que "Falta elegir" del correo y del total.
    if (s.kind === "hospedaje") return !s.skipped && !s.userChosen ? `Te falta elegir hotel${s.city ? ` en ${s.city}` : ""}` : null;
    if (s.kind === "traslado") return s.chosen ? null : `Te falta elegir cómo ir de ${s.from} a ${s.to}`;
    return null;
  };
  /** Al elegir una opción se avanza solo al siguiente paso, con un desplazamiento suave. */
  const chooseAndAdvance = (id: string, fn: () => void) => {
    fn();
    const next = nextOf(id);
    if (!next) return;
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => goTo(next.id), reduce ? 0 : 450);
  };
  const nextBar = (id: string, missing?: string | null) => {
    const next = nextOf(id);
    if (!next) return null;
    return (
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-3" data-testid="comprar-siguiente-barra">
        {missing && <p className="mr-auto text-xs text-amber-400/90" role="status" data-testid="comprar-falta-paso">{missing}</p>}
        <button type="button" onClick={() => goTo(next.id)} data-testid="comprar-siguiente" data-next={next.id}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-medium text-foreground transition hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {missing ? "Seguir de todos modos" : "Siguiente:"}<span className={`max-w-[12rem] truncate font-normal text-muted-foreground ${missing ? "hidden sm:inline" : ""}`}>{next.title}</span> <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  };
  const box = (done: boolean, id?: string) => `scroll-mt-28 rounded-xl border p-3 sm:p-4 transition-shadow duration-500 ${done ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-border/60 bg-surface/30"} ${id && current === id ? "ring-2 ring-primary/50" : ""}`;
  const falta = flow.steps.filter((s) => s.kind !== "auto" && !stepDone(s)).map((s) => s.title.replace(/^Hotel/, "hotel").replace(/^Vuelo/, "vuelo"));
  const travelers = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));

  async function mark(item: PurchaseItem) {
    if (!userId) return toast.error("Inicia sesión para guardar tu avance.");
    setBusy(item.key);
    const r = await saveMark(item);
    setBusy(null);
    if (!r.ok) return toast.error("No se pudo guardar", { description: "Intenta de nuevo en un momento." });
    toast.success("Marcado como comprado", { description: "Lo marcaste tú: IATOS no lo verificó con el sitio. Quienes viajan contigo lo verán marcado. Guarda tu confirmación en Documentos." });
    onChanged?.();
  }

  async function unmark(item: PurchaseItem) {
    setBusy(item.key);
    const r = await removeMark(item);
    setBusy(null);
    if (r.reason === "no_permitido") return toast.error("No se pudo deshacer", { description: "Solo quien lo marcó o quien creó el viaje puede quitarlo." });
    if (!r.ok) return toast.error("No se pudo deshacer", { description: "Intenta de nuevo en un momento." });
    onChanged?.();
  }

  const buyButton = (it: PurchaseItem, testid: string) => it.url ? (
    <a href={it.url} target="_blank" rel="noopener noreferrer" data-testid={testid}
      onClick={() => void logBookingClick({ category: it.category, provider: it.site ?? "Proveedor", title: it.title, bookingUrl: it.url!,
        city: it.city ?? trip.destino ?? undefined, tripId: trip.id, startAt: trip.fecha_salida ?? undefined })}
      className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
      {buyLabel(it)} <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
    </a>
  ) : it.fallbackHref ? (
    <Link to={it.fallbackHref} className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-primary/40 px-3 py-2 text-sm text-primary">Buscar en IATOS</Link>
  ) : <span className="text-xs text-muted-foreground">No encontramos un enlace fiable para comprarlo en línea.</span>;

  /** "Ya lo compré" / quién lo marcó / deshacer. */
  const markControl = (it: PurchaseItem, prefix: string) => {
    const st = state(it);
    const mk = marks.get(it.key) ?? null;
    const mine = !!mk && (mk.source === "propia" || mk.markedBy === userId);
    if (st === "confirmado") return <p className="inline-flex items-center gap-1 text-sm text-emerald-400"><Check className="w-4 h-4" /> Confirmado</p>;
    if (st === "marcado") {
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex min-w-0 items-start gap-1 text-emerald-400" data-testid={`${prefix}-marca`}>
            <Check className="mt-0.5 w-4 h-4 shrink-0" aria-hidden="true" /><span className="break-words">{mk ? markLabel(mk, userId) : "Ya lo compré"}</span>
          </span>
          {mk && canUnmark(mk, userId, owner) && (
            <button type="button" onClick={() => void unmark(it)} disabled={busy === it.key} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-label={`Marcar ${it.title} como pendiente`}>
              <Undo2 className="w-3 h-3" aria-hidden="true" /> Deshacer
            </button>
          )}
          <span className="text-[11px] text-muted-foreground">{mine ? "Marcado por ti · sin verificar" : "Marcado a mano · sin verificar"}</span>
        </div>
      );
    }
    return (
      <button type="button" onClick={() => void mark(it)} disabled={busy === it.key} data-testid={`${prefix}-marcar`}
        className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-border/70 px-3 py-2 text-sm hover:border-primary/50">
        {busy === it.key ? "Guardando…" : "Ya lo compré"}
      </button>
    );
  };

  /** "Ver detalles": a qué sitio lleva, qué va precargado, qué completar y el precio. */
  const details = (it: PurchaseItem, prefix: string) => (
    <details className="group mt-2 text-xs">
      <summary className="inline-flex min-h-[32px] cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
        Ver detalles <ChevronDown className="w-3 h-3 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-1 space-y-1 rounded-lg border border-border/50 bg-surface/30 p-3">
        {it.url ? (
          <>
            <p><span className="text-muted-foreground">Te lleva a:</span> <span className="font-medium">{it.site}</span></p>
            <p data-testid={`${prefix}-lleva`}><span className="text-muted-foreground">Va precargado:</span> {it.lleva.length ? it.lleva.join(" · ") : "nada (el sitio no lo recibe por enlace)"}</p>
            {it.completa && <p className="text-muted-foreground">{it.completa}</p>}
          </>
        ) : <p className="text-muted-foreground">No encontramos un enlace fiable para comprarlo en línea.</p>}
        {it.priceNote && <p className="text-muted-foreground">{it.priceNote}</p>}
        {(it.source.fuente || it.source.consultadoAt) && (
          <PriceSourceBadge source={it.source.fuente} estado={it.source.estado} consultadoAt={it.source.consultadoAt} approximateDates={it.source.approximateDates} />
        )}
      </div>
    </details>
  );


  return (
    <section id="trip-comprar" aria-labelledby="trip-comprar-title" className="scroll-mt-28 rounded-2xl border border-primary/25 bg-card/60 p-4 sm:p-6 focus:outline-none" data-testid="trip-comprar">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h2 id="trip-comprar-title" className="font-display text-2xl sm:text-3xl">Comprar mi viaje</h2>
        <p className="text-sm text-muted-foreground" data-testid="trip-comprar-progreso">
          {doneCore} de {core.length} reservado{core.length === 1 ? "" : "s"}
        </p>
      </div>
      <p className="mt-1 text-sm" data-testid="trip-comprar-falta">
        {falta.length ? <><span className="text-muted-foreground">Te falta:</span> {falta.join(" · ")}</> : <span className="text-emerald-400">Ya marcaste todo como comprado.</span>}
      </p>

      {/* Pasos numerados con palomita en lo hecho; tocar uno lleva a ese paso. */}
      <ol className="mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1" aria-label="Pasos para comprar" data-testid="comprar-pasos">
        {nav.map((x, k) => {
          const st = flow.steps.find((s) => `paso-${s.n}` === x.id);
          const done = st ? stepDone(st) : false;
          return (
            <li key={x.id} className="shrink-0">
              <a href={`#${x.id}`} onClick={(e) => { e.preventDefault(); goTo(x.id); }} aria-current={current === x.id ? "step" : undefined}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs transition ${current === x.id ? "border-primary bg-primary/10" : done ? "border-emerald-500/40 text-emerald-400" : "border-border/70 text-foreground/90"}`}
                data-done={done ? "1" : "0"}>
                {done ? <Check className="w-3.5 h-3.5" aria-label="hecho" /> : <span className="font-medium text-primary">{k + 1}.</span>} {x.title}
              </a>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 flex items-start gap-2 rounded-xl border border-border/60 bg-surface/40 px-3 py-2 text-xs text-muted-foreground" data-testid="trip-comprar-avisos">
        <ShieldCheck className="w-4 h-4 shrink-0 text-primary" aria-hidden="true" />
        <span>IATOS no cobra ni emite boletos: pagas directo en cada sitio. El precio puede cambiar en el sitio; confirma fechas, personas y precio antes de pagar.</span>
      </p>

      <ul className="mt-4 space-y-3">
        {flow.steps.map((s) => {
          const done = stepDone(s);
          if (s.kind === "vuelo") {
            const it = s.item;
            return (
              <li key="vuelo" id={`paso-${s.n}`} className={box(done, `paso-${s.n}`)} data-testid="comprar-vuelo" data-state={it ? state(it) : "pendiente"}>
                <StepHeader n={s.n} title={s.title} icon={Plane} done={done} />
                {it?.subtitle && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{it.subtitle}</p>}
                {s.skipped ? (
                  <SkipNote text="Ya tienes vuelo: no suma al total." onUndo={onSelectVuelo ? () => onSelectVuelo(-1) : undefined} />
                ) : (
                  <>
                    {s.options.length > 0 ? (
                      <>
                      {/* Si todas las opciones vienen de la misma fuente, su insignia va una vez (menos texto por tarjeta). */}
                      {oneSource(s.options.map((i) => trip.vuelos_json[i])) && (() => { const v0 = trip.vuelos_json[s.options[0]]; return (
                        <PriceSourceBadge className="mt-2" source={v0?.fuente_precio} estado={v0?.estado_dato} consultadoAt={v0?.consultado_at ?? quoteCreatedAt ?? trip.created_at} approximateDates={v0?.approximate_dates} />
                      ); })()}
                      <div role="radiogroup" aria-label="Opciones de vuelo" className="mt-3 grid grid-cols-1 gap-2">
                        {s.options.map((i) => {
                          const v = trip.vuelos_json[i];
                          const pp = Number(v?.precio_por_persona) || 0;
                          const chosen = s.chosen === i;
                          return (
                            <button key={i} type="button" role="radio" aria-checked={chosen} data-testid="vuelo-opcion" disabled={!onSelectVuelo}
                              onClick={() => onSelectVuelo && chooseAndAdvance(`paso-${s.n}`, () => onSelectVuelo(i))}
                              className={`w-full min-w-0 rounded-lg border px-3 py-2 text-left transition disabled:cursor-default ${chosen ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/40"}`}>
                              <span className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-sm font-medium">{chosen && <Check className="mr-1 inline w-3.5 h-3.5 text-primary" aria-hidden="true" />}{flightAirlineLabel(v)}{v?.tier && TIER_WORD[v.tier] ? <span className="font-normal text-muted-foreground"> · {TIER_WORD[v.tier]}</span> : null}</span>
                                <span className="shrink-0 text-sm font-medium tabular-nums">{pp ? money(pp * travelers) : "Sin precio"}</span>
                              </span>
                              <span className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span className="min-w-0 truncate">{[flightStopsLabel(v), flightDurationLabel(v)].filter(Boolean).join(" · ")}</span>
                                {pp > 0 && travelers > 1 && <span className="shrink-0 tabular-nums">{money(pp)} por persona</span>}
                              </span>
                              {!oneSource(s.options.map((x) => trip.vuelos_json[x])) && <PriceSourceBadge className="mt-1" source={v?.fuente_precio} estado={v?.estado_dato} consultadoAt={v?.consultado_at ?? quoteCreatedAt ?? trip.created_at} approximateDates={v?.approximate_dates} />}
                            </button>
                          );
                        })}
                      </div>
                      </>
                    ) : (
                      <p className="mt-2 text-sm" data-testid="vuelo-sin-precio">Aún no tenemos precio real para esta ruta: búscalo en Google Flights.</p>
                    )}
                    {/* Multidestino: precio real del recorrido (Google Flights, varias ciudades) solo al pulsar. */}
                    {tripDestinations(trip).length > 1 && (
                      <MultiCityFareButton trip={trip} interLegs={flow.steps.flatMap((x) => (x.kind === "traslado" ? [{ from: x.from, to: x.to, date: x.date, mode: x.chosen }] : []))} />
                    )}
                    {it && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {buyButton(it, "comprar-vuelo-abrir")}
                        {markControl(it, "comprar-vuelo")}
                        {onSelectVuelo && <button type="button" onClick={() => onSelectVuelo(-2)} className="min-h-[32px] text-xs text-muted-foreground underline-offset-2 hover:underline">Ya tengo vuelo</button>}
                      </div>
                    )}
                    {it && details(it, "comprar-vuelo")}
                  </>
                )}
                {nextBar(`paso-${s.n}`, missingOf(s))}
              </li>
            );
          }
          if (s.kind === "hospedaje") {
            const it = s.item;
            const cityId = s.stay ? s.stay.city : null;
            return (
              <li key={`hotel-${s.n}`} id={`paso-${s.n}`} className={box(done, `paso-${s.n}`)} data-testid="comprar-hospedaje" data-city={cityId ?? ""} data-state={it ? state(it) : "pendiente"}>
                <StepHeader n={s.n} title={s.title} icon={Hotel} done={done} />
                {it?.subtitle && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{it.subtitle}</p>}
                {s.skipped ? (
                  <SkipNote text="Ya tienes dónde quedarte: no suma al total." onUndo={onSelectHotel ? () => onSelectHotel(cityId, -1) : undefined} />
                ) : (
                  <>
                    {oneSource(s.options.map((i) => trip.hospedaje_json[i])) && s.options.length > 0 && (() => { const h0 = trip.hospedaje_json[s.options[0]]; return (
                      <PriceSourceBadge className="mt-2" source={h0?.fuente_precio} estado={h0?.estado_dato} consultadoAt={h0?.consultado_at ?? trip.created_at} />
                    ); })()}
                    <div role="radiogroup" aria-label={`Opciones de ${s.title.toLowerCase()}`} className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
                      {s.options.map((i) => {
                        const h = trip.hospedaje_json[i];
                        // Palomita solo en lo que eligió la persona; el de la cotización se marca aparte ("En la cotización").
                        const chosen = s.userChosen && s.chosen === i;
                        const quotedDefault = !s.userChosen && s.chosen === i;
                        const total = hotelTotal(h, s.nights, travelers);
                        return (
                          <button key={i} type="button" role="radio" aria-checked={chosen} data-testid="hotel-opcion" data-default={quotedDefault ? "true" : undefined} disabled={!onSelectHotel}
                            aria-label={chosen ? `${h?.nombre ?? "Hotel"}: elegido. Toca para quitar tu elección` : undefined}
                            // Tocar el elegido lo quita: el total vuelve al hotel de la cotización.
                            onClick={() => onSelectHotel && (chosen ? onSelectHotel(cityId, -1) : chooseAndAdvance(`paso-${s.n}`, () => onSelectHotel(cityId, i)))}
                            className={`flex w-full min-w-0 items-center gap-3 rounded-lg border p-2 text-left transition disabled:cursor-default ${chosen ? "border-primary bg-primary/10" : quotedDefault ? "border-dashed border-primary/50" : "border-border/60 hover:border-primary/40"}`}>
                            <SmartImage alt={h?.nombre ?? "Hotel"} size="thumb" className="h-14 w-14 shrink-0 overflow-hidden rounded-md" imageUrl={h?.thumbnail ?? h?.foto ?? null}
                              lookup={h?.place_id ? { placeId: h.place_id } : { name: h?.nombre, city: h?.ciudad ?? cityId ?? trip.destino }} stockQuery={hotelQuery(h?.tier || h?.tipo, i)} icon={Hotel} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="min-w-0 truncate text-sm font-medium">{chosen && <Check className="mr-1 inline w-3.5 h-3.5 text-primary" aria-hidden="true" />}{h?.nombre}</span>
                                <span className="shrink-0 text-sm font-medium tabular-nums">{total ? money(total) : "Sin precio"}</span>
                              </span>
                              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                                {[h?.tier && TIER_WORD[h.tier] ? TIER_WORD[h.tier] : null, s.nights ? plural(s.nights, "noche", "noches") : null, Number(h?.precio_por_noche) > 0 ? `${money(Number(h.precio_por_noche))} por noche` : null].filter(Boolean).join(" · ")}
                              </span>
                              {quotedDefault && <span className="mt-0.5 block text-[11px] text-primary" data-testid="hotel-en-cotizacion">En la cotización · aún sin elegir</span>}
                              {!oneSource(s.options.map((x) => trip.hospedaje_json[x])) && <PriceSourceBadge className="mt-1" source={h?.fuente_precio} estado={h?.estado_dato} consultadoAt={h?.consultado_at ?? trip.created_at} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {/* Ofertas reales por proveedor del hotel elegido (Google Hotels), solo al pulsar. */}
                    {(() => {
                      const h = s.chosen >= 0 ? trip.hospedaje_json?.[s.chosen] : null;
                      const token = typeof h?.property_token === "string" ? h.property_token : null;
                      return token ? (
                        <HotelOffersButton key={token} className="mt-3" query={{ property_token: token, checkin: s.stay?.checkin ?? trip.fecha_salida, checkout: s.stay?.checkout ?? trip.fecha_regreso, adults: travelers, name: h?.nombre ?? null }} />
                      ) : null;
                    })()}
                    {it && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {buyButton(it, cityId ? `comprar-hotel-${cityId}-abrir` : "comprar-hospedaje-abrir")}
                        {markControl(it, "comprar-hospedaje")}
                        {onSelectHotel && <button type="button" onClick={() => onSelectHotel(cityId, -2)} className="min-h-[32px] text-xs text-muted-foreground underline-offset-2 hover:underline">Ya tengo dónde quedarme</button>}
                        {onSelectHotel && s.userChosen && <button type="button" onClick={() => onSelectHotel(cityId, -1)} data-testid="hotel-quitar" className="min-h-[32px] text-xs text-muted-foreground underline-offset-2 hover:underline">Quitar mi elección</button>}
                      </div>
                    )}
                    {it && details(it, "comprar-hospedaje")}
                  </>
                )}
                {nextBar(`paso-${s.n}`, missingOf(s))}
              </li>
            );
          }
          if (s.kind === "traslado") {
            const it = s.item;
            const id = `paso-${s.n}`;
            const chosenChoice = s.choices.find((c) => c.mode === s.chosen) ?? null;
            const legKey = it.key;
            return (
              <li key={`leg-${s.n}`} id={id} className={box(done, id)} data-testid="comprar-traslado" data-from={s.from} data-to={s.to} data-state={state(it)} data-chosen={s.chosen ?? ""}>
                <StepHeader n={s.n} title={s.title} icon={MODE_ICON[s.chosen ?? ""] ?? RouteIcon} done={done} />
                {it.subtitle && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{it.subtitle}</p>}
                {s.choices.length > 0 ? (
                  <div role="radiogroup" aria-label={`Cómo ir de ${s.from} a ${s.to}`} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {s.choices.map((c) => {
                      const OIcon = MODE_ICON[c.mode] ?? RouteIcon;
                      const on = s.chosen === c.mode;
                      return (
                        <button key={c.mode} type="button" role="radio" aria-checked={on} data-testid="traslado-opcion" data-mode={c.mode}
                          onClick={() => chooseAndAdvance(id, () => setSelLeg(legKey, c.mode))}
                          className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition ${on ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/40"}`}>
                          <span className="flex min-w-0 items-center gap-2">
                            <OIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm">{on && <Check className="mr-1 inline h-3.5 w-3.5 text-primary" aria-hidden="true" />}{c.label}{c.provider ? ` · ${c.provider}` : ""}</span>
                              <span className="block truncate text-xs text-muted-foreground">{c.duration ?? (c.fromPlan ? "" : "Búsqueda con tu fecha")}</span>
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs tabular-nums">
                            {c.pricePp ? <>{money(c.pricePp)}<span className="block text-[10px] text-muted-foreground">por persona · estimado</span></> : <span className="text-muted-foreground">Por cotizar</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-sm" data-testid="traslado-sin-opciones">IATOS aún no cotizó este traslado: búscalo con tu fecha.</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {chosenChoice?.mode === "vuelo" && chosenChoice.url
                    ? <FlightBuyButtons option={chosenChoice.row ?? { from: s.from, to: s.to, fuente_precio: "estimado" }} trip={trip} />
                    : buyButton(it, `comprar-traslado-${s.n}-abrir`)}
                  {chosenChoice?.mode === "coche" && chosenChoice.fallbackHref && (
                    <Link to={chosenChoice.fallbackHref} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-lg border border-primary/40 px-3 text-sm text-primary">
                      <Car className="h-4 w-4" aria-hidden="true" /> Rentar auto
                    </Link>
                  )}
                  {markControl(it, "comprar-traslado")}
                </div>
                {it.completa && <p className="mt-1 text-[11px] text-muted-foreground">{it.completa}</p>}
                {nextBar(id, missingOf(s))}
              </li>
            );
          }
          const it = s.item!;
          return (
            <li key="auto" id={`paso-${s.n}`} className={box(done, `paso-${s.n}`)} data-testid="comprar-auto" data-state={state(it)}>
              <StepHeader n={s.n} title={s.title} icon={Car} done={done} />
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{it.subtitle}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {buyButton(it, "comprar-auto-abrir")}
                {markControl(it, "comprar-auto")}
              </div>
              {details(it, "comprar-auto")}
              {nextBar(`paso-${s.n}`)}
            </li>
          );
        })}
      </ul>

      {/* Restaurantes y experiencias por ciudad: carrusel de 4 (Económico, Medio, Caro y Recomendado por
          IATOS) con foto, precio y calificación. Elegir una experiencia la suma al total (selTours). */}
      {flow.extras.length > 0 && (
        <section id="paso-extras" className={`mt-5 scroll-mt-28 space-y-5 rounded-xl border-t border-border/40 pt-4 ${current === "paso-extras" ? "ring-2 ring-primary/40" : ""}`} data-testid="comprar-extras" aria-labelledby="comprar-extras-title">
          <div>
            <h3 id="comprar-extras-title" tabIndex={-1} className="inline-flex items-center gap-2 text-base font-medium focus:outline-none"><Utensils className="h-4 w-4 text-primary" aria-hidden="true" /> {extrasSummary(flow.extras)}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Por precio y uno elegido para tu perfil. Fotos y calificaciones de Google Maps cuando las hay; «Foto ilustrativa» no es el lugar.</p>
          </div>
          {flow.extras.map((e) => {
            const restaurantAction = (i: number): PickAction => {
              const it = items.find((p) => p.kind === "restaurante" && p.index === i);
              return it?.url ? { url: it.url, site: it.site, label: it.action?.label ?? null } : null;
            };
            const tourAction = (i: number): PickAction => {
              const t = trip.tours_json[i];
              const it = items.find((p) => p.kind === "actividad" && p.index === i) ?? null;
              const tCity = t?.ciudad ?? trip.destino;
              const a = it?.action ?? primaryAction(offerFromTripTour(t, { trip, city: tCity, index: i, venue: venueFromTripPlace(t, tCity, trip.pais_destino) }).actions);
              return a?.url ? { url: a.url, site: a.processor ?? null, label: a.label } : null;
            };
            return (
              <div key={e.city} className="space-y-4" data-testid="comprar-extras-ciudad" data-city={e.city}>
                {flow.extras.length > 1 && <p className="text-xs uppercase tracking-[0.18em] text-primary">{e.city}</p>}
                {e.restaurants.length > 0 && (
                  <TripPicksCarousel kind="restaurante" city={e.city} list={trip.restaurantes_json} indices={e.restaurants} taste={taste} trip={trip}
                    actionFor={restaurantAction} isChosen={(i) => restPicks.includes(restKey(trip.restaurantes_json[i], i))}
                    onChoose={(i) => setRestPicks(restKey(trip.restaurantes_json[i], i))} />
                )}
                {e.tours.length > 0 && (
                  <TripPicksCarousel kind="experiencia" city={e.city} list={trip.tours_json} indices={e.tours} taste={taste} trip={trip}
                    actionFor={tourAction} isChosen={(i) => selTours.has(i)} onChoose={onToggleTour}
                    extra={(i) => { const it = items.find((p) => p.kind === "actividad" && p.index === i); return it ? <div className="pt-1">{markControl(it, "comprar-actividad")}</div> : null; }} />
                )}
              </div>
            );
          })}
          {nextBar("paso-extras")}
        </section>
      )}

      {/* Último paso: todo lo elegido, el total y desde aquí se compra cada cosa. */}
      <section id="paso-listo" className={`mt-5 scroll-mt-28 rounded-2xl border border-primary/40 bg-primary/[0.05] p-4 sm:p-5 ${current === "paso-listo" ? "ring-2 ring-primary/50" : ""}`}
        data-testid="comprar-listo" aria-labelledby="comprar-listo-title">
        <h3 id="comprar-listo-title" tabIndex={-1} className="flex items-center gap-2 font-display text-xl focus:outline-none">
          <ListChecks className="h-5 w-5 text-primary" aria-hidden="true" /> Listo · Revisa y compra
        </h3>
        {(() => {
          const missing = flow.steps.map(missingOf).filter(Boolean) as string[];
          const rowsList: Array<{ key: string; label: string; sub: string | null; price: number | null; est: boolean; it: PurchaseItem | null }> = [];
          // Las partidas son las MISMAS que suma el total (selectionDesglose): el vuelo y el hotel de un
          // destino llevan el monto del desglose; si no es de una tarifa real, dice "estimado".
          const d = selectionDesglose ?? null;
          const fromTotal = (k: string, own: number | null) => (d ? (Number(d[k]) > 0 ? Math.round(Number(d[k])) : null) : own);
          for (const st of flow.steps) {
            if ((st.kind === "vuelo" || st.kind === "hospedaje") && st.skipped) continue;
            if (!st.item) continue;
            const core = st.kind === "vuelo" ? "vuelos" : st.kind === "hospedaje" && !st.stay ? "hospedaje" : null;
            rowsList.push({ key: st.item.key, label: st.kind === "traslado" ? `${st.title} · ${st.choices.find((c) => c.mode === st.chosen)?.label ?? "por elegir"}` : st.item.title,
              sub: st.item.subtitle, price: core ? fromTotal(core, st.item.price) : st.item.price,
              est: st.item.estimate || st.kind === "traslado" || (!!core && !(Number(st.item.price) > 0)), it: st.item });
          }
          for (const it of items.filter((x) => x.kind === "actividad")) rowsList.push({ key: it.key, label: it.title, sub: it.subtitle, price: it.price, est: it.estimate, it });
          // Lo que el total suma sin ser algo que se compra aquí (comida, transporte local, extras…).
          if (d) {
            const has = (pred: (r: typeof rowsList[number]) => boolean) => rowsList.some(pred);
            const covered: Record<string, boolean> = {
              vuelos: has((r) => r.key.startsWith("vuelo:")),
              hospedaje: has((r) => r.it?.kind === "hospedaje"), tours: has((r) => r.it?.kind === "actividad"),
              transporte_local: has((r) => r.key.startsWith("traslado:")),
            };
            for (const [k, v] of Object.entries(d)) {
              if (covered[k] || !(Math.round(Number(v) || 0) > 0)) continue;
              rowsList.push({ key: `desglose:${k}`, label: k === "transporte_local" ? transportRubroLabel(trip) : DESGLOSE_LABEL[k] ?? k, sub: "De la cotización", price: Math.round(Number(v)), est: true, it: null });
            }
          }
          for (const it of items.filter((x) => x.kind === "restaurante" && restPicks.includes(restKey(trip.restaurantes_json?.[x.index], x.index)))) rowsList.push({ key: it.key, label: it.title, sub: it.subtitle, price: null, est: false, it });
          return (
            <>
              {missing.length > 0 && <p className="mt-2 text-sm text-amber-400/90" data-testid="comprar-listo-falta">{missing.join(" · ")}</p>}
              <ul className="mt-3 divide-y divide-border/40" data-testid="comprar-listo-lista">
                {rowsList.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5" data-testid="comprar-listo-item">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.label}</span>
                      {r.sub && <span className="block truncate text-xs text-muted-foreground">{r.sub}</span>}
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">{r.price ? money(r.price) : <span className="text-xs text-muted-foreground">Precio en el sitio</span>}
                      {r.price && r.est ? <span className="block text-[10px] text-muted-foreground">estimado</span> : null}</span>
                    {r.it && <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">{state(r.it) !== "pendiente"
                      ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3.5 w-3.5" aria-hidden="true" /> {state(r.it) === "confirmado" ? "Confirmado" : "Ya lo compraste"}</span>
                      : buyButton(r.it, `listo-${r.key}`)}</span>}
                  </li>
                ))}
              </ul>
              {selectionTotal != null && selectionTotal > 0 && (
                <p className="mt-3 flex items-baseline justify-between gap-3 border-t border-border/50 pt-3" data-testid="comprar-listo-total">
                  <span className="text-sm text-muted-foreground">Total del viaje con tu selección<span className="block text-[11px]" data-testid="comprar-listo-total-nota">{estimadosNote ? `${estimadosNote} ` : ""}Comida, {transportRubroLabel(trip).toLowerCase()} y extras son estimados del análisis.</span></span>
                  <span className="font-display text-2xl tabular-nums">{money(selectionTotal)}</span>
                </p>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {sendSelectionSlot}
                {onViewTrip && (
                  <button type="button" onClick={onViewTrip} data-testid="comprar-ver-viaje"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-border/70 px-4 text-sm hover:border-primary/50">
                    Ver mi viaje <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </>
          );
        })()}
      </section>
    </section>
  );
}

const MODE_ICON: Record<string, typeof Plane> = { vuelo: Plane, tren: Train, coche: Car, bus: Bus, ferry: Ship, taxi: CarTaxiFront, traslado: Car, otro: RouteIcon };

/** Cómo ir entre ciudades elegido por la persona (no cambia el total: es una comodidad de este navegador). */
function useLegChoices(tripId: string | null): [Record<string, string>, (key: string, mode: string) => void] {
  const k = tripId ? `iatos:traslados:${tripId}` : null;
  const [sel, setSel] = useState<Record<string, string>>(() => {
    if (!k) return {};
    try { const v = JSON.parse(localStorage.getItem(k) ?? "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
  });
  const choose = (key: string, mode: string) => setSel((prev) => {
    const next = { ...prev, [key]: mode };
    if (k) { try { localStorage.setItem(k, JSON.stringify(next)); } catch { /* sin almacenamiento */ } }
    return next;
  });
  return [sel, choose];
}

/** ¿Todas las opciones tienen la misma fuente, estado y fecha de consulta? (una sola insignia). */
function oneSource(list: any[]): boolean {
  const k = (x: any) => `${x?.fuente_precio ?? ""}|${x?.estado_dato ?? ""}|${x?.consultado_at ?? ""}|${x?.approximate_dates ? 1 : 0}`;
  return list.length > 0 && list.every((x) => k(x) === k(list[0]));
}


const restKey = (r: any, i: number) => `${i}:${String(r?.nombre ?? "").toLowerCase()}`;

/**
 * Restaurantes elegidos (no tienen precio que sumar: "depende de lo que pidas"). Es una comodidad de
 * quien ve el viaje en este navegador; si el almacenamiento no está disponible, vive en la sesión.
 */
function useRestaurantPicks(tripId: string | null): [string[], (key: string) => void] {
  const k = tripId ? `iatos:restaurantes-elegidos:${tripId}` : null;
  const [picks, setPicks] = useState<string[]>(() => {
    if (!k) return [];
    try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
  });
  const toggle = (key: string) => setPicks((prev) => {
    const next = prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key];
    if (k) { try { localStorage.setItem(k, JSON.stringify(next)); } catch { /* sin almacenamiento */ } }
    return next;
  });
  return [picks, toggle];
}

function extrasSummary(extras: Array<{ restaurants: number[]; tours: number[] }>) {
  const r = extras.reduce((s, e) => s + e.restaurants.length, 0);
  const t = extras.reduce((s, e) => s + e.tours.length, 0);
  return `${[r ? "Restaurantes" : null, t ? "experiencias" : null].filter(Boolean).join(" y ").replace(/^e/, "E")} para reservar (opcional)`;
}

function StepHeader({ n, title, icon: Icon, done }: { n: number; title: string; icon: typeof Plane; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 tabIndex={-1} className="flex items-center gap-2 text-base font-medium focus:outline-none">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? "bg-emerald-500/20 text-emerald-400" : "bg-primary/15 text-primary"}`}>
          {done ? <Check className="w-3.5 h-3.5" aria-label="hecho" /> : n}
        </span>
        <Icon className="w-4 h-4 text-primary" aria-hidden="true" /> {title}
      </h3>
      <span className={`text-[11px] ${done ? "text-emerald-400" : "text-muted-foreground"}`}>{done ? "Listo" : "Pendiente"}</span>
    </div>
  );
}

function SkipNote({ text, onUndo }: { text: string; onUndo?: () => void }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {text}
      {onUndo && <button type="button" onClick={onUndo} className="text-xs text-primary underline-offset-2 hover:underline">Volver a elegir</button>}
    </p>
  );
}
