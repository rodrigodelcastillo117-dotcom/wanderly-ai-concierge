// Pestaña "Experiencias" del viaje (pedido del dueño, 27-oct-2026): para cada ciudad, lo TOP real —
// restaurantes (con filtro desayuno/brunch/comida/cena y búsqueda "cena romántica"), museos con su
// taquilla OFICIAL, tours TOP de Viator y experiencias wow (Viator + eventos de Ticketmaster) — con su
// botón real de reserva y el estado que marca la persona: "Por reservar" o "Ya reservé" (con número de
// confirmación opcional). "Armar mi itinerario" ordena por día lo elegido (o lo TOP) por cercanía al
// hotel y con los horarios reales de Google, y lo guarda en el itinerario del viaje.
//
// Costo: al abrir la pestaña NO se llama a nada (los museos salen de la tabla local). Solo "Buscar lo
// TOP de {ciudad}" y "Cena romántica" llaman a experiencias-top (1 unidad de la bolsa de búsquedas).
// Nada aquí reserva: cada botón abre el sitio del proveedor.
import { useMemo, useState } from "react";
import { CalendarDays, Check, Clock, ExternalLink, Heart, Landmark, Loader2, MapPin, Sparkles, Star, Ticket, Utensils } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SmartImage } from "@/components/media/SmartImage";
import { OfficialTicketButtons, RestaurantBookingButtons } from "@/components/booking/RestaurantBookingButtons";
import { SlowLoading } from "@/components/brand/SlowLoading";
import { summarizeViator, type ViatorTourView } from "@/lib/viatorTours";
import { logBookingClick } from "@/lib/trackBooking";
import type { PurchaseItem } from "@/lib/purchasePlan";
import type { GroupMark } from "@/lib/purchaseMarks";
import {
  applyPlanToItinerary, buildItinerary, type CityHotel, type ExpItem, expKey, fmtFecha, hotelForCity, type Invoke, itemsFromResponse,
  itineraryContext, loadExpTop, type Plan, requestExperiencias, saveExpTop, stayDays, suggestedItems, type TripCity,
} from "@/lib/experiencias";
import { filterByMeal, type Meal, MEAL_LABEL, MEALS } from "../../../supabase/functions/_shared/restaurantBooking.ts";
import { officialTicketsForCity, ticketSummary } from "../../../supabase/functions/_shared/officialTickets.ts";

type Marks = {
  marks: Map<string, GroupMark>;
  rows: Array<{ raw_payload?: any; status?: string | null }>;
  mark: (item: PurchaseItem, extra?: { confirmacion?: string | null; ciudad?: string | null }) => Promise<{ ok: boolean }>;
  unmark: (item: PurchaseItem) => Promise<{ ok: boolean; reason?: string }>;
};

type Props = {
  trip: any;
  cities: TripCity[];
  multi: boolean;
  marks: Marks;
  userId: string | null;
  /** Se llama tras guardar el itinerario (la página recarga el viaje). */
  onSaved?: () => void;
  invoke?: Invoke;
};

const defaultInvoke: Invoke = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>;

const cardCls = "rounded-2xl border border-border/60 bg-card/70 p-3";
const btnGold = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const btnLine = "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-primary/40 px-3 text-xs text-foreground transition hover:bg-primary/10 disabled:opacity-60";
const chip = (on: boolean) => `inline-flex min-h-[36px] items-center rounded-full border px-3 text-xs transition ${on ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/50"}`;

const fmtN = (n: number) => n.toLocaleString("es-MX");
/** 0.04 km → "a menos de 100 m"; 1.2 → "1.2 km". */
const fmtKm = (n: number) => (n < 0.1 ? "a menos de 100 m" : `${fmtN(n)} km`);
const hhmm = (at: string | null | undefined) => {
  const t = at ? new Date(at) : null;
  return t && Number.isFinite(t.getTime()) ? t.toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
};

function purchaseItemOf(it: ExpItem, url: string | null, site: string | null): PurchaseItem {
  const restaurant = it.kind === "restaurante";
  return {
    key: it.key, kind: restaurant ? "restaurante" : "actividad", category: restaurant ? "restaurant" : "activity", title: it.title, subtitle: it.city,
    price: null, currency: null, priceNote: null, source: { fuente: null, estado: null, consultadoAt: null }, estimate: false,
    site, url, action: null, lleva: [], completa: null, optional: true, fallbackHref: null, city: it.city, col: null, index: -1, offer: null,
  };
}

/** "Por reservar" / "Ya reservé" (lo marca la persona; nunca IATOS). */
function ReservaEstado({ item, url, site, marks, userId }: { item: ExpItem; url: string | null; site: string | null; marks: Marks; userId: string | null }) {
  const mk = marks.marks.get(item.key);
  const [open, setOpen] = useState(false);
  const [conf, setConf] = useState("");
  const [busy, setBusy] = useState(false);
  const own = marks.rows.find((r) => r?.raw_payload?.compra_item === item.key && r.status !== "cancelled");
  const code = typeof own?.raw_payload?.confirmacion_usuario === "string" ? own.raw_payload.confirmacion_usuario : null;
  if (mk) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" data-testid="estado-reservado">
        <span className="inline-flex items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2.5 py-1 text-foreground"><Check className="h-3 w-3 text-primary" aria-hidden="true" />Ya reservé{code ? ` · conf. ${code}` : ""}</span>
        <span className="text-muted-foreground">Lo marcaste tú; IATOS no lo verifica.</span>
        <button type="button" className="text-muted-foreground underline-offset-2 hover:underline" disabled={busy}
          onClick={async () => { setBusy(true); const r = await marks.unmark(purchaseItemOf(item, url, site)); setBusy(false); if (!r.ok) toast.error("No pudimos quitar la marca"); }}>
          Quitar
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 text-[11px]" data-testid="estado-por-reservar">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border/70 px-2.5 py-1 text-muted-foreground">Por reservar</span>
          <button type="button" className="rounded-full border border-primary/40 px-2.5 py-1 text-foreground hover:bg-primary/10" disabled={!userId}
            onClick={() => setOpen(true)} data-testid="ya-reserve">Ya reservé</button>
        </div>
      ) : (
        <form className="flex flex-wrap items-center gap-2" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const r = await marks.mark(purchaseItemOf(item, url, site), { confirmacion: conf, ciudad: item.city });
          setBusy(false);
          if (r.ok) { setOpen(false); toast.success("Marcado como reservado por ti"); } else toast.error("No pudimos guardar la marca");
        }}>
          <label className="sr-only" htmlFor={`conf-${item.key}`}>Número de confirmación (opcional)</label>
          <input id={`conf-${item.key}`} value={conf} onChange={(e) => setConf(e.target.value)} maxLength={60} placeholder="Número de confirmación (opcional)"
            className="min-h-[36px] w-48 rounded-lg border border-border/70 bg-background px-2 text-xs" />
          <button type="submit" disabled={busy} className="min-h-[36px] rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">{busy ? "Guardando…" : "Guardar"}</button>
          <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground">Cancelar</button>
        </form>
      )}
    </div>
  );
}

function Elegir({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} data-testid="exp-elegir"
      className={`inline-flex min-h-[32px] items-center gap-1 rounded-full border px-2.5 text-[11px] transition ${on ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/50"}`}>
      {on ? <><Check className="h-3 w-3 text-primary" aria-hidden="true" />En mi itinerario</> : "Agregar a mi itinerario"}
    </button>
  );
}

const Stars = ({ rating, reviews, source }: { rating: number | null; reviews: number | null; source: string }) => rating ? (
  <span className="inline-flex items-center gap-0.5 text-foreground/90" aria-label={`Calificación ${rating} en ${source}`}>
    <Star className="h-3 w-3 fill-primary text-primary" aria-hidden="true" />{rating.toLocaleString("es-MX", { maximumFractionDigits: 1 })}
    {reviews ? <span className="text-muted-foreground">({fmtN(reviews)} reseñas)</span> : null}
  </span>
) : null;

function BlockHeader({ icon: Icon, title, aviso }: { icon: typeof Utensils; title: string; aviso?: string | null }) {
  return (
    <div className="mb-2">
      <h4 className="inline-flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-primary" aria-hidden="true" />{title}</h4>
      {aviso && <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="exp-criterio">{aviso}</p>}
    </div>
  );
}

type CityState = { busy: boolean; data: any | null; error: string | null; romBusy: boolean; meal: Meal | null; chosen: Set<string>; plan: Plan | null; saving: boolean };
const EMPTY: CityState = { busy: false, data: null, error: null, romBusy: false, meal: null, chosen: new Set(), plan: null, saving: false };

export function TripExperiencias({ trip, cities, multi, marks, userId, onSaved, invoke = defaultInvoke }: Props) {
  const [active, setActive] = useState(0);
  // Lo TOP que ya se buscó en este navegador (12 h) vuelve al recargar; no se llama a nada al abrir.
  const [state, setState] = useState<Record<string, CityState>>(() => {
    const init: Record<string, CityState> = {};
    for (const c of cities) {
      const data = loadExpTop(trip?.id, c.label);
      if (data) init[c.label] = { ...EMPTY, chosen: new Set(), data };
    }
    return init;
  });
  const city = cities[Math.min(active, cities.length - 1)];
  if (!city) return <p className="text-sm text-muted-foreground">Este viaje no tiene ciudades todavía.</p>;
  const st = state[city.label] ?? EMPTY;
  const patch = (p: Partial<CityState>) => setState((prev) => ({ ...prev, [city.label]: { ...(prev[city.label] ?? EMPTY), ...p } }));
  const hotel: CityHotel | null = hotelForCity(trip, city.label, multi);

  const search = async () => {
    patch({ busy: true, error: null });
    const r = await requestExperiencias(invoke, { city: city.label, dateFrom: city.checkin, dateTo: city.checkout, hotel });
    if (r.ok) { patch({ busy: false, data: r.data, plan: null }); saveExpTop(trip?.id, city.label, r.data); }
    else patch({ busy: false, error: r.message ?? "No pudimos buscar ahora." });
  };
  const searchRomantic = async () => {
    patch({ romBusy: true });
    const r = await requestExperiencias(invoke, { city: city.label, hotel, query: "cena romántica", blocks: ["restaurantes"] });
    if (r.ok) setState((prev) => {
      const cur = prev[city.label] ?? EMPTY;
      return { ...prev, [city.label]: { ...cur, romBusy: false, meal: null, data: { ...(cur.data ?? {}), restaurantes: r.data.restaurantes, ancla: cur.data?.ancla ?? r.data.ancla } } };
    });
    else { patch({ romBusy: false }); toast.error(r.message ?? "No pudimos buscar ahora."); }
  };

  return (
    <section className="space-y-4" data-testid="experiencias">
      <div>
        <h2 className="font-display text-2xl">Experiencias</h2>
        <p className="mt-1 text-sm text-muted-foreground">Lo TOP de cada ciudad, con datos reales y su botón de reserva. Las reservas se hacen en el sitio de cada lugar; aquí marcas lo que ya reservaste.</p>
      </div>
      {cities.length > 1 && (
        <div className="flex gap-2 overflow-x-auto no-scrollbar" role="tablist" aria-label="Ciudades del viaje">
          {cities.map((c, i) => (
            <button key={c.label} type="button" role="tab" aria-selected={i === active} className={chip(i === active)} onClick={() => setActive(i)} data-testid="exp-ciudad">
              {c.label}
            </button>
          ))}
        </div>
      )}
      <CityPanel key={city.label} trip={trip} city={city} cities={cities} st={st} hotel={hotel} marks={marks} userId={userId}
        onSearch={search} onRomantic={searchRomantic} patch={patch} multi={multi} onSaved={onSaved} />
    </section>
  );
}

function CityPanel({ trip, city, cities, st, hotel, marks, userId, onSearch, onRomantic, patch, multi, onSaved }: {
  trip: any; city: TripCity; cities: TripCity[]; st: CityState; hotel: CityHotel | null; marks: Marks; userId: string | null; multi: boolean;
  onSearch: () => void; onRomantic: () => void; patch: (p: Partial<CityState>) => void; onSaved?: () => void;
}) {
  const data = st.data;
  const items = useMemo(() => (data ? itemsFromResponse(data, city.label) : null), [data, city.label]);
  // Sin búsqueda: los museos de la tabla oficial (local, sin costo).
  const localMuseos = useMemo(() => officialTicketsForCity(city.label).map(ticketSummary), [city.label]);
  const toggle = (k: string) => { const next = new Set(st.chosen); next.has(k) ? next.delete(k) : next.add(k); patch({ chosen: next }); };
  const days = stayDays(city.checkin, city.checkout);
  const tripId = trip?.id ?? null;

  const buildPlan = () => {
    if (!items) return;
    const all = [...items.restaurante, ...items.museo, ...items.tour, ...items.wow, ...items.evento];
    const chosen = all.filter((x) => st.chosen.has(x.key));
    const base = chosen.length ? chosen : suggestedItems(items, days.length);
    // Llegada (vuelo largo → descanso), salida al aeropuerto y comidas que el itinerario ya tiene.
    const ctx = itineraryContext(trip, city, cities, multi);
    patch({ plan: buildItinerary(base, days, data?.ancla?.tipo === "hotel" ? "del hotel" : "del centro aprox.", ctx) });
  };
  const savePlan = async () => {
    if (!st.plan || !trip?.id) return;
    patch({ saving: true });
    const next = applyPlanToItinerary(trip.itinerario_json, trip, city.key, st.plan, multi);
    const { error } = await supabase.from("trips").update({ itinerario_json: next as any }).eq("id", trip.id);
    patch({ saving: false });
    if (error) return void toast.error("No pudimos guardar el itinerario", { description: "Si el viaje es compartido, solo quien lo creó puede cambiar el itinerario." });
    toast.success("Itinerario guardado", { description: "Lo ves en Destinos → Itinerario día por día. Nada está reservado." });
    onSaved?.();
  };

  const ancla = data?.ancla as { tipo: string; nota: string } | null | undefined;
  const rest = data?.restaurantes;
  const restItems: ExpItem[] = items ? items.restaurante : [];
  const restRaw: any[] = Array.isArray(rest?.items) ? rest.items : [];
  const shownRest = st.meal ? filterByMeal(restRaw, st.meal) : restRaw;
  const tours = data?.tours ? summarizeViator(data.tours) : null;
  const wow = data?.wow ? summarizeViator(data.wow) : null;
  const wowRaw: any[] = Array.isArray(data?.wow?.results) ? data.wow.results : [];

  return (
    <div className="space-y-5" data-testid="exp-ciudad-panel" data-city={city.label}>
      <div className={`${cardCls} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}>
        <div className="min-w-0 text-sm">
          <p className="font-medium">{city.label}{city.checkin ? <span className="text-muted-foreground"> · {fmtFecha(city.checkin)}{city.checkout ? ` → ${fmtFecha(city.checkout)}` : ""}</span> : null}</p>
          <p className="text-xs text-muted-foreground" data-testid="exp-hotel">
            {hotel ? <>Hotel: {hotel.nombre}{hotel.origen === "cotizado" ? " (de tu cotización)" : ""}</> : "Sin hotel guardado: las distancias serán al centro aproximado."}
          </p>
        </div>
        <button type="button" className={btnGold} onClick={onSearch} disabled={st.busy} data-testid="exp-buscar">
          {st.busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {data ? `Actualizar lo TOP de ${city.label}` : `Buscar lo TOP de ${city.label}`}
        </button>
      </div>
      {!data && !st.busy && <p className="text-[11px] text-muted-foreground" data-testid="exp-sin-gasto">No consultamos nada hasta que pulses el botón: Google Maps, Viator y Ticketmaster, en vivo.</p>}
      <SlowLoading active={st.busy} label={`Buscando lo TOP de ${city.label}…`}>
        <p className="text-xs text-muted-foreground" role="status">Buscando en Google Maps, Viator y Ticketmaster…</p>
      </SlowLoading>
      {st.error && <p role="status" className="text-sm text-primary" data-testid="exp-error">{st.error}</p>}
      {ancla?.nota && <p className="text-[11px] text-muted-foreground" data-testid="exp-ancla"><MapPin className="mr-1 inline h-3 w-3 text-primary" aria-hidden="true" />{ancla.nota}</p>}
      {Array.isArray(data?.avisos) && data.avisos.map((a: string) => <p key={a} className="text-[11px] text-primary">{a}</p>)}

      {/* TOP restaurantes */}
      {data && (
        <div data-testid="exp-restaurantes">
          <BlockHeader icon={Utensils} title="TOP restaurantes" aviso={rest?.ok ? rest.aviso : null} />
          {rest?.ok && rest.consulta && <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">Resultados de Google Maps para «{rest.consulta}»{hhmm(rest.consultado_at) ? ` · consultado ${hhmm(rest.consultado_at)}` : ""}.</p>}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button type="button" className={chip(!st.meal)} onClick={() => patch({ meal: null })}>Todos</button>
            {MEALS.map((m) => <button key={m} type="button" className={chip(st.meal === m)} onClick={() => patch({ meal: m })} data-testid={`exp-comida-${m}`}>{MEAL_LABEL[m]}</button>)}
            <button type="button" className={chip(false)} onClick={onRomantic} disabled={st.romBusy} data-testid="exp-romantica">
              {st.romBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" /> : <Heart className="mr-1 h-3 w-3 text-primary" aria-hidden="true" />}Cena romántica
            </button>
          </div>
          {!rest?.ok && <p className="text-sm text-muted-foreground">{rest?.motivo ?? "Google Maps no respondió."}</p>}
          {rest?.ok && !shownRest.length && <p className="text-sm text-muted-foreground" data-testid="exp-sin-comida">{st.meal ? `Ninguno de estos lugares tiene marcado en Google que sirva ${MEAL_LABEL[st.meal].toLowerCase()}.` : "Ningún restaurante cumple el criterio en esta búsqueda."}</p>}
          <ul className="grid gap-2 md:grid-cols-2">
            {shownRest.map((r) => {
              const it = restItems.find((x) => x.placeId === r.place_id) ?? null;
              if (!it) return null;
              const tags = [r.sirve?.desayuno && "Desayuno", r.sirve?.brunch && "Brunch", r.sirve?.comida && "Comida", r.sirve?.cena && "Cena"].filter(Boolean).join(" · ");
              const first = r.reserva?.actions?.[0] ?? null;
              return (
                <li key={it.key} className={cardCls} data-testid="exp-restaurante">
                  <div className="flex gap-3">
                    <SmartImage alt={r.nombre} size="thumb" photoRef={r.photo_ref ?? null} lookup={{ placeId: r.place_id }} stockQuery={`${r.tipo ?? "restaurant"} food`} icon={Utensils}
                      className="h-16 w-16 shrink-0 rounded-xl ring-1 ring-white/[0.06]" captionPosition="bottom-left" />
                    <div className="min-w-0 flex-1">
                      <h5 className="text-sm font-medium leading-tight">{r.nombre}</h5>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <Stars rating={r.rating} reviews={r.resenas} source="Google" />
                        {(r.rango_precio || r.nivel_precio) && <span>· {r.rango_precio ?? r.nivel_precio}</span>}
                        {r.distancia_km != null && <span>· {fmtKm(r.distancia_km)}</span>}
                      </p>
                      {tags && <p className="text-[11px] text-muted-foreground">Sirve: {tags} (según Google)</p>}
                    </div>
                  </div>
                  <div className="mt-2">
                    <RestaurantBookingButtons booking={r.reserva} name={r.nombre} city={city.label} tripId={tripId}
                      target={{ name: r.nombre, address: r.direccion, placeId: r.place_id, lat: r.lat, lng: r.lng }} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><Elegir on={st.chosen.has(it.key)} onToggle={() => toggle(it.key)} /></div>
                  <ReservaEstado item={it} url={first?.url ?? null} site={first?.provider ?? null} marks={marks} userId={userId} />
                </li>
              );
            })}
          </ul>
          {rest?.ok && <p className="mt-1 text-[10px] text-muted-foreground">Fuente: Google Maps. «Reservar en TheFork» abre una búsqueda por nombre en TheFork: confirma que sea el lugar.</p>}
        </div>
      )}

      {/* TOP museos */}
      <div data-testid="exp-museos">
        <BlockHeader icon={Landmark} title="TOP museos" aviso={data?.museos?.aviso ?? (localMuseos.length ? "Museos de nuestra tabla de taquillas oficiales (verificada el 27-oct-2026)." : null)} />
        {!localMuseos.length && <p className="text-sm text-muted-foreground">No tenemos museos de {city.label} en la tabla de taquillas oficiales.</p>}
        <ul className="grid gap-2 md:grid-cols-2">
          {(data?.museos?.items ?? localMuseos).map((m: any) => {
            const it: ExpItem = items?.museo.find((x) => x.title === m.nombre) ?? { key: expKey("museo", city.label, m.id, m.nombre), kind: "museo", city: city.label, title: m.nombre, lat: null, lng: null, distanceKm: null, rating: null, reviews: null };
            return (
              <li key={m.id} className={cardCls} data-testid="exp-museo">
                <h5 className="text-sm font-medium leading-tight">{m.nombre}</h5>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                  {[m.lugar?.rating ? <Stars key="s" rating={m.lugar.rating} reviews={m.lugar.resenas} source="Google" /> : null,
                    m.distancia_km != null ? <span key="d">{fmtKm(m.distancia_km)}</span> : null,
                    <span key="t">Taquilla: {m.operador}</span>].filter(Boolean).flatMap((el, i) => (i ? [<span key={`sep${i}`} aria-hidden="true">·</span>, el] : [el]))}
                </p>
                {m.lugar?.horario?.length ? (
                  <details className="mt-1 text-[11px] text-muted-foreground"><summary className="cursor-pointer"><Clock className="mr-1 inline h-3 w-3" aria-hidden="true" />Horario según Google</summary>
                    <ul className="mt-1 space-y-0.5">{m.lugar.horario.map((h: string) => <li key={h}>{h}</li>)}</ul>
                  </details>
                ) : data ? <p className="mt-1 text-[11px] text-muted-foreground">Horario no consultado en Google: revisa su sitio oficial.</p> : null}
                <div className="mt-2"><OfficialTicketButtons ticket={m} tripId={tripId} /></div>
                {items && <div className="mt-2"><Elegir on={st.chosen.has(it.key)} onToggle={() => toggle(it.key)} /></div>}
                <ReservaEstado item={it} url={m.taquilla_oficial} site="Taquilla oficial" marks={marks} userId={userId} />
              </li>
            );
          })}
        </ul>
      </div>

      {/* TOP tours y experiencias wow */}
      {data && <ToursBlock title="TOP tours" icon={Ticket} res={tours} block={data.tours} items={items?.tour ?? []} raw={Array.isArray(data?.tours?.results) ? data.tours.results : []} {...{ st, toggle, marks, userId, tripId, city: city.label }} />}
      {data && <ToursBlock title="Experiencias wow" icon={Sparkles} res={wow} block={data.wow} items={items?.wow ?? []} raw={wowRaw}
        note={Array.isArray(data?.wow?.consultas) ? `Búsquedas en Viator: ${data.wow.consultas.map((q: string) => `«${q}»`).join(", ")}.` : null} {...{ st, toggle, marks, userId, tripId, city: city.label }} />}

      {data && (
        <div data-testid="exp-eventos">
          <BlockHeader icon={CalendarDays} title="Eventos en tus fechas" aviso={data.eventos?.ok ? "Fuente: Ticketmaster. Los boletos se compran en Ticketmaster." : null} />
          {!data.eventos?.ok ? <p className="text-sm text-muted-foreground">{data.eventos?.motivo ?? "Sin eventos."}</p>
            : !data.eventos.results.length ? <p className="text-sm text-muted-foreground">Ticketmaster no publica eventos en esas fechas.</p> : (
            <ul className="grid gap-2 md:grid-cols-2">
              {(items?.evento ?? []).map((e) => (
                <li key={e.key} className={cardCls} data-testid="exp-evento">
                  <h5 className="text-sm font-medium leading-tight">{e.title}</h5>
                  <p className="text-xs text-primary">{e.fecha ? fmtFecha(e.fecha) : ""}{e.hora ? ` · ${e.hora.slice(0, 5)}` : ""}</p>
                  {e.address && <p className="text-xs text-muted-foreground">{e.address}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {e.url && <a href={e.url} target="_blank" rel="noopener noreferrer" className={btnLine} onClick={() => void logBookingClick({ category: "activity", provider: "Ticketmaster", title: e.title, bookingUrl: e.url!, city: city.label, tripId })}>Boletos en Ticketmaster <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
                    <Elegir on={st.chosen.has(e.key)} onToggle={() => toggle(e.key)} />
                  </div>
                  <ReservaEstado item={e} url={e.url ?? null} site="Ticketmaster" marks={marks} userId={userId} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Itinerario día por día */}
      {data && (
        <div className={`${cardCls} space-y-3`} data-testid="exp-itinerario">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h4 className="text-sm font-medium">Mi itinerario en {city.label}</h4>
              <p className="text-[11px] text-muted-foreground">{st.chosen.size ? `${st.chosen.size} elegidos` : "Sin elegidos: usamos los TOP de arriba"}. Por cercanía {hotel ? "a tu hotel" : "al centro aproximado"} y con los horarios de Google.</p>
            </div>
            <button type="button" className={btnGold} onClick={buildPlan} data-testid="exp-armar">Armar mi itinerario</button>
          </div>
          {st.plan && (
            <>
              {st.plan.avisos.map((a) => <p key={a} className="text-[11px] text-primary" data-testid="exp-aviso-plan">{a}</p>)}
              <ol className="grid gap-2 md:grid-cols-2">
                {st.plan.days.map((d) => (
                  <li key={`${d.dia}-${d.fecha}`} className="rounded-xl border border-border/60 bg-surface/40 p-3" data-testid="exp-dia">
                    <p className="text-xs"><span className="font-display gold-text">{String(d.dia).padStart(2, "0")}</span> <span className="text-muted-foreground">{d.fecha ? fmtFecha(d.fecha) : `Día ${d.dia}`}</span></p>
                    <ul className="mt-1.5 space-y-1 text-xs">
                      {d.slots.map((s) => (
                        <li key={`${s.slot}-${s.hora}`} className="flex gap-2">
                          <span className="w-20 shrink-0 text-primary">{s.hora && s.hora !== "—" ? `${s.hora} · ` : ""}{s.label}</span>
                          <span className="min-w-0" data-testid="exp-slot" data-slot={s.slot}>{s.item ? s.item.title : s.texto ? <span>{s.texto}</span> : <span className="text-muted-foreground">Libre</span>}{s.nota ? <span className="block text-[10px] text-muted-foreground">{s.nota}</span> : null}</span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnLine} onClick={savePlan} disabled={st.saving || !city.checkin} data-testid="exp-guardar">
                  {st.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Check className="h-3.5 w-3.5 text-primary" aria-hidden="true" />} Guardar en mi itinerario
                </button>
                <p className="text-[11px] text-muted-foreground">{city.checkin ? "Ordenado por IATOS con distancia y horario; ningún lugar está reservado." : "El viaje no tiene fechas: agrégalas para guardar el itinerario por día."}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ToursBlock({ title, icon, res, block, items, raw, note, st, toggle, marks, userId, tripId, city }: {
  title: string; icon: typeof Ticket; res: ReturnType<typeof summarizeViator> | null; block: any; items: ExpItem[]; raw: any[]; note?: string | null;
  st: CityState; toggle: (k: string) => void; marks: Marks; userId: string | null; tripId: string | null; city: string;
}) {
  const views: ViatorTourView[] = res?.ok ? res.tours : [];
  return (
    <div data-testid={`exp-${title === "TOP tours" ? "tours" : "wow"}`}>
      <BlockHeader icon={icon} title={title} aviso={block?.ok ? block.aviso : null} />
      {note && <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">{note}</p>}
      {!res?.ok ? <p className="text-sm text-muted-foreground">{block?.ok ? `${block.aviso} Ninguno cumple el criterio en esta búsqueda.` : block?.motivo ?? res?.message ?? "Viator no publicó tours para esta búsqueda."}</p> : (
        <ul className="grid gap-2 md:grid-cols-2">
          {views.map((t) => {
            const it = items.find((x) => x.url === t.url || x.title === t.title);
            const src = raw.find((x) => x?.url === t.url);
            if (!it) return null;
            return (
              <li key={t.code} className={cardCls} data-testid="exp-tour">
                <div className="flex gap-3">
                  {t.photo ? <img src={t.photo} alt={t.title} loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-xl object-cover ring-1 ring-white/[0.06]" />
                    : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-muted/40"><Ticket className="h-5 w-5 text-muted-foreground" aria-hidden="true" /></span>}
                  <div className="min-w-0 flex-1">
                    <h5 className="line-clamp-2 text-sm font-medium leading-tight">{t.title}</h5>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <Stars rating={t.rating} reviews={t.reviews} source="Viator" />{t.duration && <span>· {t.duration}</span>}
                    </p>
                    <p className="text-xs tabular-nums">{t.priceText ?? "Precio en Viator"}</p>
                    {t.mxnNote && <p className="text-[10px] text-muted-foreground">{t.mxnNote}</p>}
                    {src?.consulta && <p className="text-[10px] text-muted-foreground">De la búsqueda «{src.consulta}»</p>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a href={t.url} target="_blank" rel="noopener noreferrer sponsored" data-testid="exp-viator"
                    onClick={() => void logBookingClick({ category: "activity", provider: "Viator", title: t.title, bookingUrl: t.url, city, tripId })}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-primary px-3 text-[11px] font-medium text-primary-foreground">Reservar en Viator <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                  <Elegir on={st.chosen.has(it.key)} onToggle={() => toggle(it.key)} />
                </div>
                <ReservaEstado item={it} url={t.url} site="Viator" marks={marks} userId={userId} />
              </li>
            );
          })}
        </ul>
      )}
      {res?.ok && <p className="mt-1 text-[10px] text-muted-foreground">Fuente: Viator · precio «desde» en su moneda; la disponibilidad y el precio final se ven en Viator.</p>}
    </div>
  );
}
