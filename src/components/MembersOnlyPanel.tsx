import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, Search, X, Sparkles, CalendarCheck, ChevronRight, ChevronLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CityVideoCard } from "@/components/CityVideoCard";
import { VenueDetailDialog } from "@/components/VenueDetailDialog";
import { VenueImage } from "@/components/media/VenueImage";
import { MembersTeaser } from "@/components/MembersTeaser";
import { fetchMembersAccess, type MembersAccess } from "@/lib/membersAccess";
import { useSubscription } from "@/hooks/useSubscription";
import { membersOnlySubtitle } from "@/lib/planCopy";
import { PriveEntryLink } from "@/components/PriveEntryLink";
import {
  MEMBERS_CATEGORIES, OTHER_CATEGORY, categoryLabel, cityNames, countByCategory, fetchMembersCities, fetchMembersVenues,
  matchesCategory, type MembersCity, type MembersVenue,
} from "@/lib/membersVenues";
import { matchCities, normText, orderCities, resolveCityName } from "@/lib/cityVisuals";
import { MembersVenueMeta } from "@/components/MembersVenueMeta";
import { MembersReserveDialog, type MembersReserveRequest } from "@/components/members/MembersReserveDialog";
import { reservationStateLabel, requestStatusToCanonical } from "../../supabase/functions/_shared/reservationState.ts";

// Lista de siempre + la categoría "Otros" para lo curado que no encaja (coctelería, mezcalería…).
const CATEGORIES = [...MEMBERS_CATEGORIES, OTHER_CATEGORY];

// Respaldo si members_cities falla; normalmente las ciudades salen del servidor (las que tienen lugares).
const FEATURED_CITIES = [
  "París", "Londres", "Nueva York", "Las Vegas", "Ciudad de México",
  "Dubái", "Tokio", "Berlín", "Ibiza", "Miami",
  "Madrid", "Roma", "Milán", "Atenas", "Bangkok",
  "Saint-Tropez", "Mykonos", "Tulum",
];
const DEFAULT_CITY = "París";

type Venue = MembersVenue;

/** Lugar que coincide con la búsqueda (nombre, tipo, barrio, etiquetas), sin importar acentos. */
export function venueMatches(v: Venue, query: string): boolean {
  const q = normText(query);
  if (!q) return true;
  const hay = normText([v.nombre, categoryLabel(v.categoria), v.categoria, v.neighborhood, v.por_que, v.dress_code, ...(v.tags ?? [])].filter(Boolean).join(" "));
  return q.split(" ").every((w) => hay.includes(w));
}

/** md+ (escritorio/tablet): rejilla de tarjetas; en móvil, filas deslizables con tarjetas compactas. */
function useWide(): boolean {
  const query = "(min-width: 768px)";
  const get = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [wide, setWide] = useState(get);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return wide;
}

interface Props {
  /** Callback al pedir reserva — el contenedor (Concierge) cambia a tab Chat con el mensaje pre-cargado */
  onReserve?: (venue: Venue) => void;
  /** Ciudades que van primero: la ciudad donde estás y la de tu viaje activo (si tienen curaduría). */
  preferredCities?: Array<string | null | undefined>;
  /**
   * Todavía se está obteniendo la ubicación: la primera carga espera (hasta 4 s) para pedir primero tu
   * ciudad y no París (N4-P2-11: la primera carga pedía "París" antes que CDMX).
   */
  locating?: boolean;
}

/** Espera máxima por la ubicación antes de la primera carga de lugares. */
export const MEMBERS_LOCATION_WAIT_MS = 4000;

export function MembersOnlyPanel({ onReserve, preferredCities = [], locating = false }: Props) {
  const { user } = useAuth();
  const { loading: subLoading, isPro } = useSubscription();
  // Members Only es exclusivo de IATOS PRO: el servidor decide el acceso (members_access_state) y
  // la RPC members_venues no devuelve lugares sin derecho.
  const [access, setAccess] = useState<MembersAccess | null>(null);
  const refreshAccess = () => { fetchMembersAccess(supabase).then(setAccess); };
  useEffect(() => { if (user) refreshAccess(); }, [user?.id]);

  const prefKey = preferredCities.filter(Boolean).join("|");
  const [city, setCity] = useState<string>(() => resolveCityName(preferredCities.find(Boolean), FEATURED_CITIES) ?? DEFAULT_CITY);
  const userPicked = useRef(false);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadingVenues, setLoadingVenues] = useState(false);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [detailVenue, setDetailVenue] = useState<Venue | null>(null);
  // Pedir mesa: primero fecha, hora y personas, y confirmar (P1-4); nunca con un solo toque.
  const [reserveVenue, setReserveVenue] = useState<Venue | null>(null);
  // Lugares que la lista mostró de verdad por ciudad: el carrusel dice el mismo número (P1-3 / #14).
  const [shownCounts, setShownCounts] = useState<Record<string, number>>({});
  const [cities, setCities] = useState<MembersCity[] | null>(null);
  const [showAllCities, setShowAllCities] = useState(false);
  const wide = useWide();
  const cityRail = useRef<HTMLDivElement>(null);
  // En escritorio (sin gesto de deslizar) el carrusel se mueve con flechas.
  const slideCities = (dir: 1 | -1) => {
    const el = cityRail.current;
    if (el && typeof el.scrollBy === "function") el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  const pickCity = (c: string) => {
    userPicked.current = true;
    setCity(c);
    setQuery("");
    setActiveCat(null);
    setShowAllCities(false);
  };

  // Mientras se obtiene la ubicación, la primera carga espera (con tope) para no pedir otra ciudad antes.
  const [locWait, setLocWait] = useState(locating);
  useEffect(() => {
    if (!locating) { setLocWait(false); return; }
    const t = window.setTimeout(() => setLocWait(false), MEMBERS_LOCATION_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [locating]);
  const lastLoaded = useRef<string | null>(null);
  const allCities = useMemo(() => cityNames(cities, FEATURED_CITIES), [cities]);

  useEffect(() => {
    if (!city || !access?.access || locWait) return;
    // La ciudad que de verdad toca: la que elegiste o, si no elegiste, tu ciudad o la de tu viaje (aunque
    // el estado `city` todavía no se haya actualizado en este render): así nunca se pide París primero.
    const preferred = userPicked.current ? null : preferredCities.map((p) => resolveCityName(p, allCities)).find(Boolean) ?? null;
    const target = preferred ?? city;
    if (target !== city) { setCity(target); return; }
    if (lastLoaded.current === target) return;
    lastLoaded.current = target;
    // Solo pinta la respuesta de la ciudad que se pidió al último (otra ciudad elegida después la descarta).
    const alive = () => lastLoaded.current === target;
    setLoadingVenues(true);
    (async () => {
      const { venues: list, error } = await fetchMembersVenues(supabase, target);
      if (!alive()) return;
      if (error) {
        toast({ title: "Error cargando lugares", description: "No pudimos cargar los lugares. Intenta de nuevo.", variant: "destructive" });
      }
      setVenues(list);
      if (!error) setShownCounts((m) => ({ ...m, [normText(city)]: list.length }));
      setLoadingVenues(false);
    })();
  }, [city, access?.access, locWait, allCities, prefKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ciudades con lugares (solo nombres y conteos). Si falla, se usa la lista fija.
  useEffect(() => {
    if (!access?.access) return;
    fetchMembersCities(supabase).then(setCities);
  }, [access?.access]);
  const counts = useMemo(() => new Map((cities ?? []).map((c) => [c.display, shownCounts[normText(c.display)] ?? c.venues])), [cities, shownCounts]);
  // Tu ciudad y tu viaje primero; después la ciudad con la que abre el panel (París), para que la
  // elegida de inicio se vea al principio del carrusel y no al final.
  const ordered = useMemo(() => orderCities(allCities, [...preferredCities, DEFAULT_CITY]), [allCities, prefKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si tu ciudad o tu viaje tienen curaduría, se abre ahí (mientras no hayas elegido otra).
  useEffect(() => {
    if (userPicked.current) return;
    const preferred = preferredCities.map((p) => resolveCityName(p, allCities)).find(Boolean);
    if (preferred && preferred !== city) setCity(preferred);
  }, [allCities, prefKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // La ciudad elegida siempre a la vista en el carrusel (alineada al inicio si estaba fuera).
  useEffect(() => {
    const rail = cityRail.current;
    if (!rail) return;
    const active = rail.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!active) return;
    const left = active.offsetLeft; // el carrusel es su offsetParent (relative)
    const visible = left >= rail.scrollLeft && left + active.offsetWidth <= rail.scrollLeft + rail.clientWidth;
    if (!visible) rail.scrollLeft = Math.max(0, left - (wide ? 0 : 16));
  }, [city, cities, wide]);

  const q = query.trim();
  const cityHits = useMemo(() => (q ? matchCities(ordered, q) : []), [ordered, q]);
  const featured = q ? cityHits.slice(0, 18) : ordered.slice(0, FEATURED_CITIES.length);
  const visibleVenues = useMemo(() => venues.filter((v) => matchesCategory(v, activeCat) && venueMatches(v, q)), [venues, activeCat, q]);
  const categoryCounts = useMemo(() => countByCategory(venues), [venues]);
  const presentCats = CATEGORIES.filter((c) => (categoryCounts[c.id] ?? 0) > 0);
  // Sin filtro ni búsqueda: una fila deslizable por categoría (se ve todo sin bajar y bajar).
  const grouped = !activeCat && !q;

  const submitSearch = () => {
    if (!q) return;
    const hit = resolveCityName(q, allCities);
    if (hit) { pickCity(hit); return; }
    // Ni ciudad conocida ni lugar de esta ciudad: se manda tal cual (el servidor entiende
    // sobrenombres y barrios: "Mexico City", "Polanco"…).
    if (!venues.some((v) => venueMatches(v, q))) pickCity(q);
  };

  const handleReserve = async (v: Venue, r: MembersReserveRequest) => {
    if (!user) return;
    setReservingId(v.id);
    try {
      const { data, error } = await supabase.functions.invoke("concierge-action", {
        body: {
          type: "members_nightlife_reservation",
          title: `Reserva: ${v.nombre} · ${v.ciudad_display}`,
          payload: {
            venue_id: v.id,
            venue_name: v.nombre,
            ciudad: v.ciudad_display,
            categoria: v.categoria,
            dress_code: v.dress_code,
            precio_estimado: v.precio_estimado,
            address: v.address,
            website: v.website,
            por_que: v.por_que,
            // Lo que el equipo necesita para pedir la mesa (la Mesa de operaciones lo lee así).
            fecha: r.fecha,
            hora: r.hora,
            personas: r.personas,
            party_size: r.personas,
            requested_for: `${r.fecha}T${r.hora}`,
            ...(r.notas ? { detalle: r.notas, preferences: r.notas } : {}),
          },
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({
        title: "Solicitud enviada al equipo IATOS",
        description: `${v.nombre}: ${reservationStateLabel({ canonical_state: requestStatusToCanonical(data?.request?.status ?? "solicitado") }).label}. La ves en Mis solicitudes; te avisamos cuando el lugar responda.`,
      });
      setReserveVenue(null);
      onReserve?.(v);
    } catch (e: any) {
      toast({ title: "No se pudo crear la solicitud", description: e?.message ?? "", variant: "destructive" });
    } finally {
      setReservingId(null);
    }
  };

  if (!access) {
    return <div className="px-4 md:px-10 py-8 text-sm text-muted-foreground">Cargando…</div>;
  }
  if (!access.access) {
    return <MembersTeaser passwordGate={access.passwordGate} onUnlocked={refreshAccess} />;
  }

  const card = (v: Venue, rail: boolean) => (
    <VenueCard key={v.id} venue={v} rail={rail} wide={wide} reserving={reservingId === v.id}
      onOpen={() => setDetailVenue(v)} onReserve={() => setReserveVenue(v)} />
  );
  // En escritorio, "Todas" es una sola rejilla ordenada por categoría (cada tarjeta dice la suya).
  const byCategory = presentCats.flatMap((c) => venues.filter((v) => matchesCategory(v, c.id)));

  // ============== CONTENIDO ==============
  return (
    <div className="px-4 md:px-8 pt-4 md:pt-6 pb-28 md:pb-10 max-w-6xl mx-auto">
      {/* Encabezado compacto: lo importante (buscar y elegir ciudad) queda arriba. */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-primary text-[10px] tracking-[0.25em] uppercase">
            <Sparkles className="w-3 h-3" aria-hidden="true" /> Vida nocturna premium
          </p>
          <h2 className="font-fraunces text-2xl md:text-4xl text-foreground leading-tight">Solo para miembros</h2>
        </div>
        <PriveEntryLink />
      </div>
      {/* Según el plan real; antes prometía a todas las cuentas que el Concierge PRO gestionaba sus reservas. */}
      {/* Completo también en el celular (antes se cortaba en "…depende de cada lugar.…"). */}
      <p className="text-primary/90 text-xs md:text-sm font-fraunces italic mb-3 md:mb-4" data-testid="members-subtitle">
        {membersOnlySubtitle({ loading: subLoading, isPro })}
      </p>

      <div className="sticky top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-2 bg-background/85 backdrop-blur-xl">
        <div className="relative max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <Input
            aria-label="Buscar ciudad o lugar"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitSearch()}
            placeholder="Ciudad, lugar o tipo (rooftop, jazz…)"
            // Sin la flecha ▼ que el navegador pone a un campo con sugerencias (datalist) junto a la ✕ (N-P2-7).
            className="members-search pl-11 pr-10 h-11 rounded-full border-primary/25 bg-black/40"
            list="cities-list-members"
            enterKeyHint="search"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
              aria-label="Limpiar búsqueda"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <datalist id="cities-list-members">
            {allCities.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>

      {/* Ciudades: carrusel compacto arriba (antes, al final de la página). */}
      <section aria-label="Ciudades destacadas" className="mt-2 mb-3">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            {q ? (cityHits.length ? "Ciudades que coinciden" : `Ninguna ciudad se llama «${q}» · buscando lugares en ${city}`) : "Ciudades destacadas"}
          </p>
          <div className="flex items-center gap-2">
            {wide && featured.length > 4 && (
              <>
                <button type="button" onClick={() => slideCities(-1)} aria-label="Ciudades anteriores"
                  className="w-7 h-7 grid place-items-center rounded-full border border-primary/25 text-muted-foreground hover:text-foreground hover:border-primary/50 transition">
                  <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => slideCities(1)} aria-label="Más ciudades"
                  className="w-7 h-7 grid place-items-center rounded-full border border-primary/25 text-muted-foreground hover:text-foreground hover:border-primary/50 transition">
                  <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </>
            )}
            {!q && allCities.length > featured.length && (
              <button type="button" onClick={() => setShowAllCities((s) => !s)} aria-expanded={showAllCities}
                className="text-[11px] text-primary hover:underline underline-offset-2 ml-1">
                {showAllCities ? "Ocultar" : `Ver las ${allCities.length}`}
              </button>
            )}
          </div>
        </div>
        {featured.length > 0 && (
          <div ref={cityRail} className="relative flex gap-2.5 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {featured.map((c) => (
              <CityVideoCard
                key={c}
                city={c}
                active={normText(c) === normText(city)}
                subtitle={counts.get(c) ? `${counts.get(c)} ${counts.get(c) === 1 ? "lugar" : "lugares"}` : undefined}
                className="snap-start shrink-0 w-[38%] sm:w-40 md:w-44 h-24 md:h-28"
                onClick={() => pickCity(c)}
              />
            ))}
          </div>
        )}
        {showAllCities && !q && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Todas las ciudades">
            {ordered.map((c) => (
              <li key={c}>
                <button type="button" onClick={() => pickCity(c)} aria-pressed={normText(c) === normText(city)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition ${normText(c) === normText(city) ? "bg-gradient-gold text-primary-foreground border-transparent" : "border-primary/20 text-foreground/85 hover:border-primary/45"}`}>
                  {c}{counts.get(c) ? <span className="opacity-60"> · {counts.get(c)}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Categorías en un solo renglón deslizable. */}
      {presentCats.length > 0 && (
        <div className="flex gap-2 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 pb-1 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filtrar por categoría">
          <button
            type="button"
            onClick={() => setActiveCat(null)}
            aria-pressed={activeCat === null}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs tracking-wide transition border ${
              activeCat === null ? "bg-gradient-gold text-primary-foreground border-transparent" : "border-primary/20 text-muted-foreground hover:border-primary/40"
            }`}
          >Todas <span className="opacity-60">({venues.length})</span></button>
          {presentCats.map((c) => (
            <button
              type="button"
              key={c.id}
              onClick={() => setActiveCat(c.id === activeCat ? null : c.id)}
              aria-pressed={activeCat === c.id}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs tracking-wide transition border whitespace-nowrap ${
                activeCat === c.id ? "bg-gradient-gold text-primary-foreground border-transparent" : "border-primary/20 text-muted-foreground hover:border-primary/40"
              }`}
            >
              <span className="mr-1" aria-hidden="true">{c.emoji}</span>{c.label}
              <span className="ml-1.5 opacity-60">({categoryCounts[c.id]})</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-baseline justify-between mb-3 gap-2">
        <h3 className="font-fraunces text-xl md:text-2xl">
          En <span className="text-primary">{city}</span>
        </h3>
        {!loadingVenues && (
          <span className="shrink-0 whitespace-nowrap text-[10px] tracking-[0.18em] uppercase text-muted-foreground">
            {visibleVenues.length} {visibleVenues.length === 1 ? "lugar" : "lugares"}
            {venues.length !== visibleVenues.length && <span className="ml-1 opacity-70">de {venues.length}</span>}
          </span>
        )}
      </div>
      {/* La búsqueda es dentro de la ciudad elegida: se dice claro (N9: "jazz" parecía buscar en todas). */}
      {q && !cityHits.length && (
        <p className="-mt-2 mb-3 text-xs text-muted-foreground" data-testid="members-search-scope">
          Resultados de «{q}» solo en {city}. Para buscar en otra ciudad, escribe su nombre o borra la búsqueda.
        </p>
      )}

      {loadingVenues ? (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shrink-0 w-[72%] sm:w-64 h-64 rounded-2xl bg-gradient-to-br from-primary/5 to-primary/[0.02] border border-primary/10 animate-pulse" />
          ))}
        </div>
      ) : visibleVenues.length === 0 ? (
        <div className="rounded-2xl border border-primary/15 bg-black/30 p-6 text-center">
          {venues.length === 0 ? (
            <>
              <p className="font-fraunces text-lg text-foreground mb-1">Aún no tenemos curaduría para esta ciudad.</p>
              <p className="text-muted-foreground text-sm">La estamos preparando. Mientras, elige otra ciudad arriba.</p>
            </>
          ) : (
            <>
              <p className="font-fraunces text-lg text-foreground mb-1">Nada con “{q}” en {city}.</p>
              <button type="button" onClick={() => { setQuery(""); setActiveCat(null); }} className="text-sm text-primary hover:underline underline-offset-2">Ver todos los lugares</button>
            </>
          )}
        </div>
      ) : grouped && wide ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {byCategory.map((v) => card(v, false))}
        </div>
      ) : grouped ? (
        <div className="space-y-4">
          {presentCats.map((c) => {
            const list = venues.filter((v) => matchesCategory(v, c.id));
            return (
              <section key={c.id} aria-label={c.label}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-foreground/90"><span aria-hidden="true" className="mr-1.5">{c.emoji}</span>{c.label}
                    <span className="text-muted-foreground text-xs"> · {list.length}</span></p>
                  {list.length > 2 && (
                    <button type="button" onClick={() => setActiveCat(c.id)} className="text-[11px] text-primary inline-flex items-center gap-0.5 hover:underline underline-offset-2">
                      Ver todo <ChevronRight className="w-3 h-3" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {/* Una sola tarjeta ocupa todo el ancho (N9: a 390 px quedaba al 86 % con el nombre cortado). */}
                {list.length === 1 ? card(list[0], false) : (
                  <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory -mx-4 px-4 md:mx-0 md:px-0 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {list.map((v) => card(v, true))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className={wide ? "grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3" : "grid gap-2.5"}>
          {visibleVenues.map((v) => card(v, false))}
        </div>
      )}

      <VenueDetailDialog
        venue={detailVenue}
        open={!!detailVenue}
        onClose={() => setDetailVenue(null)}
        onReserve={(v) => { setDetailVenue(null); setReserveVenue(v); }}
        reserving={!!detailVenue && reservingId === detailVenue.id}
      />
      <MembersReserveDialog
        venue={reserveVenue}
        open={!!reserveVenue}
        sending={!!reserveVenue && reservingId === reserveVenue.id}
        onClose={() => setReserveVenue(null)}
        onConfirm={(r) => { if (reserveVenue) void handleReserve(reserveVenue, r); }}
      />
    </div>
  );
}

/**
 * Tarjeta de lugar. En móvil, compacta y horizontal (foto chica a la izquierda: caben varias
 * categorías en una pantalla); en escritorio, vertical con foto arriba. El detalle completo, al tocarla.
 */
function VenueCard({ venue: v, rail, wide, reserving, onOpen, onReserve }: {
  venue: Venue; rail: boolean; wide: boolean; reserving: boolean; onOpen: () => void; onReserve: () => void;
}) {
  const chips = (
    <div className="flex flex-wrap gap-1 mb-2">
      {v.dress_code && <span className="px-2 py-0.5 rounded-full text-[10px] border border-primary/25 text-foreground/80">{v.dress_code}</span>}
      {v.precio_estimado && <span className="px-2 py-0.5 rounded-full text-[10px] border border-primary/25 text-primary">{v.precio_estimado}</span>}
      {v.reserva_requerida && <span className="px-2 py-0.5 rounded-full text-[10px] bg-primary/15 text-primary">Reserva requerida</span>}
    </div>
  );
  const actions = (
    <div className="mt-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onReserve(); }}
        disabled={reserving}
        className="inline-flex min-w-0 items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs whitespace-nowrap bg-gradient-gold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
      >
        <CalendarCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        {reserving ? "Enviando…" : "Reservar con Concierge"}
      </button>
      {v.address && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.nombre} ${v.address}`)}`}
          target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`Cómo llegar a ${v.nombre}`}
          className="inline-grid shrink-0 place-items-center w-8 h-8 rounded-lg border border-primary/25 text-foreground hover:bg-primary/10 transition"
        >
          <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
        </a>
      )}
    </div>
  );
  const base = "group cursor-pointer overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-b from-black/60 to-black/30 hover:border-primary/40 transition-all duration-300";

  if (!wide) {
    return (
      <article onClick={onOpen} className={`${base} flex gap-3 p-2.5 ${rail ? "snap-start shrink-0 w-[86%]" : ""}`}>
        {/* Foto real del venue (Google, solo si encuentra ESE lugar); si no, ilustrativa de su categoría, marcada. */}
        <VenueImage venue={v} size="thumb" className={`${rail ? "w-20" : "w-24"} shrink-0 self-stretch min-h-[124px] rounded-xl`} />
        <div className="min-w-0 flex-1 flex flex-col py-0.5">
          <h4 className="font-fraunces text-base text-foreground leading-tight line-clamp-2 break-words">{v.nombre}</h4>
          {v.por_que && <p className="text-primary text-[11px] mt-0.5 leading-snug line-clamp-2">{v.por_que}</p>}
          <div className="mt-1.5 text-[11px]"><MembersVenueMeta venue={v} /></div>
          {chips}
          {actions}
        </div>
      </article>
    );
  }
  return (
    <article onClick={onOpen} className={`${base} flex flex-col`}>
      <VenueImage venue={v} className="h-36 w-full" />
      <div className="p-4 pt-3 flex-1 flex flex-col">
        <p className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground mb-1">{categoryLabel(v.categoria)}</p>
        <h4 className="font-fraunces text-lg text-foreground leading-tight">{v.nombre}</h4>
        {v.por_que && <p className="text-primary text-xs mt-1 leading-snug line-clamp-2">{v.por_que}</p>}
        <div className="mt-2"><MembersVenueMeta venue={v} /></div>
        {chips}
        {actions}
      </div>
    </article>
  );
}
