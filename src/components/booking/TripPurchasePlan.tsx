// "Comprar mi viaje": elegir y comprar en un solo lugar (rediseño del caso Roma → Florencia → Venecia).
// Pasos numerados (1. Vuelo · 2. Hotel en Roma · … · Auto) con palomita en lo hecho y "Te falta" arriba.
// Cada paso muestra sus opciones reales (hasta 3, con fuente y estado del precio), se elige con un
// toque (cambia el total: reúsa selVuelo / selHospedaje / selHoteles / selTours de la página) y ahí
// mismo está el botón de compra precargado. El detalle ("Te lleva a…", "Va precargado…") va plegado en
// "Ver detalles". "Ya lo compré" lo marca a mano el usuario (IATOS no ve la compra); en un viaje
// compartido todos ven quién lo marcó (r2 grupo, useTripPurchaseMarks).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bus, Car, Check, ChevronDown, ExternalLink, Hotel, Plane, Ship, ShieldCheck, Train, Undo2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { SmartImage } from "@/components/media/SmartImage";
import { logBookingClick } from "@/lib/trackBooking";
import { itemPurchaseState, primaryAction, type PurchaseItem, type PurchaseMarkRow, type TripOfferActionsLike } from "@/lib/purchasePlan";
import { buildBuyFlow, hotelTotal, TIER_WORD, type BuyStep } from "@/lib/buyFlow";
import { flightAirlineLabel, flightDurationLabel, flightStopsLabel } from "@/lib/flightDisplay";
import { offerFromTripTour } from "@/lib/booking";
import { hotelQuery } from "@/lib/categoryImagery";
import { canUnmark, markLabel } from "@/lib/purchaseMarks";
import { useTripPurchaseMarks } from "@/hooks/useTripPurchaseMarks";
import { useTasteProfile } from "@/hooks/useTasteProfile";
import { TripPicksCarousel, type PickAction } from "@/components/booking/TripPicksCarousel";
import { FlightBuyButtons } from "@/components/booking/FlightBuyButtons";

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
};

/** Verbo del botón principal: "Comprar en Google Flights", "Buscar en Kayak"… */
function buyLabel(it: PurchaseItem): string {
  if (it.buttonLabel) return it.buttonLabel;
  if (it.kind === "auto") return `Buscar en ${it.site}`;
  if (it.kind === "restaurante") return `Reservar en ${it.site}`;
  return `Comprar en ${it.site}`;
}

export function TripPurchasePlan({ trip, selVuelo, selHospedaje, selTours, selHoteles, serverOffers = {}, bookings, userId, ownerId, quoteCreatedAt, onChanged,
  onSelectVuelo, onSelectHotel, onToggleTour }: Props) {
  const flow = useMemo(
    () => buildBuyFlow(trip, { selVuelo, selHospedaje, selTours, selHoteles }, serverOffers, { quoteCreatedAt }),
    [trip, selVuelo, selHospedaje, selTours, selHoteles, serverOffers, quoteCreatedAt],
  );
  const { rows, marks, mark: saveMark, unmark: removeMark } = useTripPurchaseMarks({ trip, userId, bookings });
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

  const box = (done: boolean) => `scroll-mt-28 rounded-xl border p-3 sm:p-4 ${done ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-border/60 bg-surface/30"}`;

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
        {flow.steps.map((s) => {
          const done = stepDone(s);
          return (
            <li key={`${s.kind}-${s.n}`} className="shrink-0">
              <a href={`#paso-${s.n}`} onClick={(e) => { e.preventDefault(); document.getElementById(`paso-${s.n}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }}
                className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-xs ${done ? "border-emerald-500/40 text-emerald-400" : "border-border/70 text-foreground/90"}`}
                data-done={done ? "1" : "0"}>
                {done ? <Check className="w-3.5 h-3.5" aria-label="hecho" /> : <span className="font-medium text-primary">{s.n}.</span>} {s.title}
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
              <li key="vuelo" id={`paso-${s.n}`} className={box(done)} data-testid="comprar-vuelo" data-state={it ? state(it) : "pendiente"}>
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
                              onClick={() => onSelectVuelo?.(i)}
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
              </li>
            );
          }
          if (s.kind === "hospedaje") {
            const it = s.item;
            const cityId = s.stay ? s.stay.city : null;
            return (
              <li key={`hotel-${s.n}`} id={`paso-${s.n}`} className={box(done)} data-testid="comprar-hospedaje" data-city={cityId ?? ""} data-state={it ? state(it) : "pendiente"}>
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
                        const chosen = s.chosen === i;
                        const total = hotelTotal(h, s.nights, travelers);
                        return (
                          <button key={i} type="button" role="radio" aria-checked={chosen} data-testid="hotel-opcion" disabled={!onSelectHotel}
                            onClick={() => onSelectHotel?.(cityId, i)}
                            className={`flex w-full min-w-0 items-center gap-3 rounded-lg border p-2 text-left transition disabled:cursor-default ${chosen ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/40"}`}>
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
                              {!oneSource(s.options.map((x) => trip.hospedaje_json[x])) && <PriceSourceBadge className="mt-1" source={h?.fuente_precio} estado={h?.estado_dato} consultadoAt={h?.consultado_at ?? trip.created_at} />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {it && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {buyButton(it, cityId ? `comprar-hotel-${cityId}-abrir` : "comprar-hospedaje-abrir")}
                        {markControl(it, "comprar-hospedaje")}
                        {onSelectHotel && <button type="button" onClick={() => onSelectHotel(cityId, -2)} className="min-h-[32px] text-xs text-muted-foreground underline-offset-2 hover:underline">Ya tengo dónde quedarme</button>}
                      </div>
                    )}
                    {it && details(it, "comprar-hospedaje")}
                  </>
                )}
              </li>
            );
          }
          if (s.kind === "traslado") {
            const it = s.item;
            const flightOpt = s.options.find((o) => o.mode === "vuelo") ?? null;
            const trainOpt = s.options.find((o) => o.mode === "tren") ?? null;
            const LegIcon = s.options[0]?.mode === "tren" ? Train : s.options[0]?.mode === "ferry" ? Ship : s.options[0]?.mode === "bus" ? Bus : s.options[0]?.mode === "coche" ? Car : Plane;
            return (
              <li key={`leg-${s.n}`} id={`paso-${s.n}`} className={box(done)} data-testid="comprar-traslado" data-from={s.from} data-to={s.to} data-state={state(it)}>
                <StepHeader n={s.n} title={s.title} icon={LegIcon} done={done} />
                {it.subtitle && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{it.subtitle}</p>}
                {s.options.length > 0 ? (
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label={`Cómo ir de ${s.from} a ${s.to}`}>
                    {s.options.slice(0, 4).map((o, k) => {
                      const OIcon = o.mode === "tren" ? Train : o.mode === "ferry" ? Ship : o.mode === "bus" ? Bus : o.mode === "coche" ? Car : Plane;
                      return (
                        <li key={k} className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2" data-testid="traslado-opcion" data-mode={o.mode}>
                          <span className="flex min-w-0 items-center gap-2">
                            <OIcon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm">{LEG_MODE[o.mode] ?? o.mode}{o.provider ? ` · ${o.provider}` : o.mode === "vuelo" ? " · aerolínea por confirmar" : ""}</span>
                              {o.duration && <span className="block truncate text-xs text-muted-foreground">{o.duration}</span>}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs tabular-nums">
                            {o.pricePp ? <>{money(o.pricePp)}<span className="block text-[10px] text-muted-foreground">por persona · estimado</span></> : <span className="text-muted-foreground">Precio en el sitio</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm" data-testid="traslado-sin-opciones">IATOS aún no cotizó este traslado: búscalo con tu fecha.</p>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {/* Vuelo solo ida con la fecha y los pasajeros (los mismos enlaces que "Cómo llegar"). */}
                  {(flightOpt || !trainOpt) && <FlightBuyButtons option={flightOpt?.row ?? { from: s.from, to: s.to, fuente_precio: "estimado" }} trip={trip} />}
                  {trainOpt && <FlightBuyButtons option={{ ...trainOpt.row, mode: "tren" }} trip={trip} />}
                </div>
                <div className="mt-2">{markControl(it, "comprar-traslado")}</div>
              </li>
            );
          }
          const it = s.item!;
          return (
            <li key="auto" id={`paso-${s.n}`} className={box(done)} data-testid="comprar-auto" data-state={state(it)}>
              <StepHeader n={s.n} title={s.title} icon={Car} done={done} />
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{it.subtitle}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {buyButton(it, "comprar-auto-abrir")}
                {markControl(it, "comprar-auto")}
              </div>
              {details(it, "comprar-auto")}
            </li>
          );
        })}
      </ul>

      {/* Restaurantes y experiencias por ciudad: carrusel de 4 (Económico, Medio, Caro y Recomendado por
          IATOS) con foto, precio y calificación. Elegir una experiencia la suma al total (selTours). */}
      {flow.extras.length > 0 && (
        <section className="mt-5 space-y-5 border-t border-border/40 pt-4" data-testid="comprar-extras" aria-labelledby="comprar-extras-title">
          <div>
            <h3 id="comprar-extras-title" className="inline-flex items-center gap-2 text-base font-medium"><Utensils className="h-4 w-4 text-primary" aria-hidden="true" /> {extrasSummary(flow.extras)}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Por precio y uno elegido para tu perfil. Fotos y calificaciones de Google Maps cuando las hay; «Foto ilustrativa» no es el lugar.</p>
          </div>
          {flow.extras.map((e) => {
            const restaurantAction = (i: number): PickAction => {
              const it = items.find((p) => p.kind === "restaurante" && p.index === i);
              return it?.url ? { url: it.url, site: it.site } : null;
            };
            const tourAction = (i: number): PickAction => {
              const t = trip.tours_json[i];
              const it = items.find((p) => p.kind === "actividad" && p.index === i) ?? null;
              const a = it?.action ?? primaryAction(offerFromTripTour(t, { trip, city: t?.ciudad ?? trip.destino, index: i }).actions);
              return a?.url ? { url: a.url, site: a.processor ?? null } : null;
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
        </section>
      )}
    </section>
  );
}

/** ¿Todas las opciones tienen la misma fuente, estado y fecha de consulta? (una sola insignia). */
function oneSource(list: any[]): boolean {
  const k = (x: any) => `${x?.fuente_precio ?? ""}|${x?.estado_dato ?? ""}|${x?.consultado_at ?? ""}|${x?.approximate_dates ? 1 : 0}`;
  return list.length > 0 && list.every((x) => k(x) === k(list[0]));
}

const LEG_MODE: Record<string, string> = { vuelo: "Vuelo", tren: "Tren", coche: "En coche", bus: "Autobús", ferry: "Ferry" };

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
      <h3 className="flex items-center gap-2 text-base font-medium">
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
