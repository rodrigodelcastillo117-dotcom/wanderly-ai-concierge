import { useEffect, useMemo, useState } from "react";
import { MapPin, ExternalLink, Search, X, Sparkles, CalendarCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CityVideoCard } from "@/components/CityVideoCard";
import { VenueDetailDialog } from "@/components/VenueDetailDialog";

const CATEGORIES: { id: string; emoji: string; label: string }[] = [
  { id: "cabaret", emoji: "🎭", label: "Cabaret" },
  { id: "burlesque", emoji: "💃", label: "Burlesque" },
  { id: "members_club", emoji: "🥃", label: "Members Club" },
  { id: "speakeasy", emoji: "🍸", label: "Speakeasy" },
  { id: "rooftop", emoji: "🌃", label: "Rooftop" },
  { id: "casino_vip", emoji: "🎰", label: "Casino VIP" },
  { id: "jazz_lounge", emoji: "🎷", label: "Jazz Lounge" },
  { id: "evento_vip", emoji: "🥂", label: "Evento VIP" },
];

const FEATURED_CITIES = [
  "París", "Londres", "Nueva York", "Las Vegas", "Ciudad de México",
  "Dubái", "Tokio", "Berlín", "Ibiza", "Miami",
  "Madrid", "Roma", "Milán", "Atenas", "Bangkok",
  "Saint-Tropez", "Mykonos", "Tulum",
];


interface Venue {
  id: string;
  ciudad: string;
  ciudad_display: string;
  categoria: string;
  emoji: string | null;
  nombre: string;
  por_que: string | null;
  descripcion: string | null;
  dress_code: string | null;
  precio_estimado: string | null;
  reserva_requerida: boolean;
  tags: string[] | null;
  address: string | null;
  website: string | null;
}

const norm = (s: string) => s.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

interface Props {
  /** Callback al pedir reserva — el contenedor (Concierge) cambia a tab Chat con el mensaje pre-cargado */
  onReserve?: (venue: Venue) => void;
}

export function MembersOnlyPanel({ onReserve }: Props) {
  const { user } = useAuth();
  const accessLoading = false;
  const confirmedAdult = true;
  const passwordUnlocked = true;

  const [city, setCity] = useState<string>("París");
  const [cityInput, setCityInput] = useState<string>("París");
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadingVenues, setLoadingVenues] = useState(false);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [detailVenue, setDetailVenue] = useState<Venue | null>(null);

  useEffect(() => {
    if (!city) return;
    setLoadingVenues(true);
    (async () => {
      const { data, error } = await supabase
        .from("nightlife_premium")
        .select("*")
        .eq("ciudad", norm(city))
        .order("nombre");
      if (error) {
        toast({ title: "Error cargando venues", description: error.message, variant: "destructive" });
        setVenues([]);
      } else {
        setVenues((data ?? []) as Venue[]);
      }
      setLoadingVenues(false);
    })();
  }, [city]);


  const filteredVenues = useMemo(() => {
    if (!activeCat) return venues;
    return venues.filter((v) => v.categoria === activeCat);
  }, [venues, activeCat]);

  const categoryCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const v of venues) m[v.categoria] = (m[v.categoria] ?? 0) + 1;
    return m;
  }, [venues]);

  const handleReserve = async (v: Venue) => {
    if (!user) return;
    setReservingId(v.id);
    try {
      const { error } = await supabase.from("concierge_requests").insert({
        user_id: user.id,
        type: "members_nightlife_reservation",
        title: `Reserva: ${v.nombre} · ${v.ciudad_display}`,
        status: "pending",
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
        },
      });
      if (error) throw error;
      toast({
        title: "Solicitud enviada al Concierge",
        description: `Tu solicitud para ${v.nombre} está en cola. Te confirmamos por chat.`,
      });
      onReserve?.(v);
    } catch (e: any) {
      toast({ title: "No se pudo crear la solicitud", description: e?.message ?? "", variant: "destructive" });
    } finally {
      setReservingId(null);
    }
  };



  // ============== CONTENIDO ==============
  return (
    <div className="px-4 md:px-10 py-8 md:py-10 max-w-6xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-primary text-xs tracking-[0.2em] uppercase mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          Nightlife Premium
        </div>
        <h2 className="font-fraunces text-3xl md:text-5xl text-foreground mb-2">Members Only</h2>
        <p className="text-primary text-base mb-6 font-fraunces italic">
          Vida nocturna seleccionada — reservas gestionadas por tu Concierge PRO
        </p>

        <div className="relative max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setCity(cityInput)}
            placeholder="Buscar por ciudad…"
            className="pl-11 pr-10 h-12 rounded-xl border-primary/20 bg-black/40"
            list="cities-list-members"
          />
          {cityInput && (
            <button
              type="button"
              onClick={() => setCityInput("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-white/5 transition"
              aria-label="Limpiar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <datalist id="cities-list-members">
            {FEATURED_CITIES.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>

      <div className="mb-8">
        <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground mb-3">Por categoría</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setActiveCat(null)}
            className={`px-4 py-2 rounded-full text-xs tracking-wide transition border ${
              activeCat === null
                ? "bg-gradient-gold text-primary-foreground border-transparent"
                : "border-primary/20 text-muted-foreground hover:border-primary/40"
            }`}
          >Todas <span className="opacity-60">({venues.length})</span></button>
          {CATEGORIES.filter((c) => (categoryCounts[c.id] ?? 0) > 0).map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCat(c.id === activeCat ? null : c.id)}
              className={`px-4 py-2 rounded-full text-xs tracking-wide transition border ${
                activeCat === c.id
                  ? "bg-gradient-gold text-primary-foreground border-transparent"
                  : "border-primary/20 text-muted-foreground hover:border-primary/40"
              }`}
            >
              <span className="mr-1">{c.emoji}</span>{c.label}
              <span className="ml-1.5 opacity-60">({categoryCounts[c.id]})</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-12">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <h3 className="font-fraunces text-2xl">
            Venues en <span className="text-primary">{city}</span>
          </h3>
          {!loadingVenues && (
            <span className="text-xs tracking-[0.18em] uppercase text-muted-foreground">
              {filteredVenues.length} {filteredVenues.length === 1 ? "venue" : "venues"}
              {activeCat && venues.length !== filteredVenues.length && (
                <span className="ml-1 opacity-60">de {venues.length}</span>
              )}
            </span>
          )}
        </div>

        {loadingVenues ? (
          <div className="grid md:grid-cols-2 gap-4">
            {[0,1,2,3].map((i) => (
              <div key={i} className="h-56 rounded-2xl bg-gradient-to-br from-primary/5 to-primary/[0.02] border border-primary/10 animate-pulse" />
            ))}
          </div>
        ) : filteredVenues.length === 0 ? (
          <div className="rounded-2xl border border-primary/15 bg-black/30 p-8 text-center">
            <p className="font-fraunces text-lg text-foreground mb-1">Aún no tenemos curaduría para esta ciudad.</p>
            <p className="text-muted-foreground text-sm">La estamos preparando.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {filteredVenues.map((v) => (
              <article
                key={v.id}
                onClick={() => setDetailVenue(v)}
                className="cursor-pointer rounded-2xl border border-primary/15 bg-gradient-to-b from-black/60 to-black/30 backdrop-blur-xl p-6 hover:border-primary/40 transition-all duration-300 hover:shadow-[0_20px_60px_-20px_rgba(201,169,97,0.3)]"
              >
                <div className="flex items-start gap-4 mb-3">
                  <div className="text-4xl">{v.emoji ?? "✨"}</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-fraunces text-xl text-foreground leading-tight">{v.nombre}</h4>
                    {v.por_que && <p className="text-primary text-xs mt-1 leading-snug">{v.por_que}</p>}
                  </div>
                </div>

                {v.descripcion && (
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">{v.descripcion}</p>
                )}

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {v.dress_code && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] tracking-wide border border-primary/25 text-foreground/80">{v.dress_code}</span>
                  )}
                  {v.precio_estimado && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] tracking-wide border border-primary/25 text-primary">{v.precio_estimado}</span>
                  )}
                  {v.reserva_requerida && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] tracking-wide bg-primary/15 text-primary">Reserva requerida</span>
                  )}
                  {(v.tags ?? []).map((t) => (
                    <span key={t} className="px-2.5 py-1 rounded-full text-[10px] tracking-wide border border-white/10 text-muted-foreground">{t}</span>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleReserve(v); }}
                    disabled={reservingId === v.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-gradient-gold text-primary-foreground hover:opacity-90 transition disabled:opacity-50"
                  >
                    <CalendarCheck className="w-3.5 h-3.5" />
                    {reservingId === v.id ? "Enviando…" : "Reservar con Concierge"}
                  </button>
                  {v.address && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${v.nombre} ${v.address}`)}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-primary/25 text-foreground hover:bg-primary/10 transition"
                    >
                      <MapPin className="w-3.5 h-3.5" /> Cómo llegar
                    </a>
                  )}
                  {v.website && (
                    <a
                      href={v.website}
                      target="_blank" rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-primary/25 text-foreground hover:bg-primary/10 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Sitio oficial
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground mb-4">Ciudades destacadas</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {FEATURED_CITIES.map((c) => (
            <CityVideoCard
              key={c}
              city={c}
              active={norm(c) === norm(city)}
              onClick={() => { setCity(c); setCityInput(c); }}
            />
          ))}
        </div>
      </div>

      <VenueDetailDialog
        venue={detailVenue}
        open={!!detailVenue}
        onClose={() => setDetailVenue(null)}
        onReserve={(v) => { handleReserve(v); setDetailVenue(null); }}
        reserving={!!detailVenue && reservingId === detailVenue.id}
      />
    </div>
  );
}
