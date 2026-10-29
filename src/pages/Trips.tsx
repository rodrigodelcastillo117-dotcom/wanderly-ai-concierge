import { tripCountryLabel } from "@/lib/booking";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Pencil, Users, Sparkles, Plus, Trash2, LogOut, RefreshCw, MapPin, FileUp, Hotel } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { SmartImage } from "@/components/media/SmartImage";
import { destinationQuery } from "@/lib/categoryImagery";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import santorini from "@/assets/hero-santorini.jpg";
import { deleteOwnedTrip, leaveSharedTrip, MEMBERSHIP_MESSAGES } from "@/lib/tripMembership";
import { bookingsByTrip, deriveTripBookingState, type BookingLike } from "@/lib/bookingState";
import { BookingStateBadge } from "@/components/BookingStateBadge";
import { TripCardsSkeleton } from "@/components/PageSkeletons";
import { groupTripsForList } from "@/lib/tripList";
import { tripTiming } from "@/lib/tripCommand";
import { formatTripDateRange, localISODate } from "@/lib/localDate";
import { formatPaid, PAID_LABEL } from "@/lib/tripImport";
import { isBroughtTrip } from "@/lib/broughtTrip";
import { displayedTripTotal } from "@/lib/tripPageTotal";
import { invalidQuoteReason, REQUOTE_LABEL } from "@/lib/budgetSanity";

// "Ya tengo vuelos y hotel": la misma ventana de Planear, abierta en ese modo (solo se descarga al pulsar).
const PlanTripDialog = lazy(() => import("@/components/plan/PlanTripDialog"));

const TripCard = ({ t, userId, onDeleted, bookings = [] }: { t: any; userId: string; onDeleted: (id: string) => void; bookings?: BookingLike[] }) => {
  const [deleting, setDeleting] = useState(false);
  // Un viaje compartido conmigo no es mío: no puedo borrarlo, solo salir de él.
  const isShared = !!t.shared;
  const shownTotal = displayedTripTotal(t, t._quote ?? null);

  const handleDelete = async () => {
    setDeleting(true);
    const res = isShared ? await leaveSharedTrip(supabase, t.id, userId) : await deleteOwnedTrip(supabase, t.id);
    if (!res.ok) {
      toast.error(
        res.reason === "not_allowed"
          ? isShared ? MEMBERSHIP_MESSAGES.leaveNotAllowed : MEMBERSHIP_MESSAGES.deleteNotAllowed
          : MEMBERSHIP_MESSAGES.error,
      );
      setDeleting(false);
      return;
    }
    toast.success(isShared ? MEMBERSHIP_MESSAGES.left : MEMBERSHIP_MESSAGES.deleted);
    onDeleted(t.id);
  };


  return (
    <div className="relative glass-card rounded-2xl overflow-hidden hover:gold-border transition group">
      {t.shared && (
        <div className="absolute top-3 left-3 z-10 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/90 text-primary-foreground text-[10px] font-medium">
          <Users className="w-3 h-3" /> Compartido
        </div>
      )}
      <div className="absolute top-3 right-3 z-10 flex gap-1.5">
        <Link
          to={`/dashboard/viajes/${t.id}/editar`}
          aria-label="Editar viaje"
          className="p-2 rounded-full bg-background/60 backdrop-blur hover:bg-primary/20 text-muted-foreground hover:text-primary transition"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              aria-label={isShared ? `Salir del viaje a ${t.destino}` : `Eliminar viaje a ${t.destino}`}
              disabled={deleting}
              className="p-2 rounded-full bg-background/60 backdrop-blur hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition"
            >
              {isShared ? <LogOut className="w-3.5 h-3.5" aria-hidden="true" /> : <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isShared ? "¿Salir de este viaje?" : "¿Eliminar este viaje?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {isShared
                  ? `Dejarás de ver "${t.destino}". El viaje no se borra: el dueño y los demás colaboradores lo conservan.`
                  : `Esta acción no se puede deshacer. Se borrará "${t.destino}" con su diario, packing y gastos divididos.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {isShared ? "Salir del viaje" : "Eliminar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Link to={`/dashboard/viajes/${t.id}`} className="block">
        {/* Portada real del viaje (foto de Google guardada al cotizar); si no hay, una foto
            ilustrativa del destino marcada como tal. Se pide solo cuando la tarjeta se ve. */}
        <SmartImage
          alt={t.destino}
          imageUrl={t.cover_image_url ?? null}
          stockQuery={destinationQuery(t.destino, t.pais_destino)}
          icon={MapPin}
          className="h-44 w-full"
          imgClassName="group-hover:scale-105"
          captionPosition="bottom-right"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/30 to-transparent" />
        </SmartImage>
        <div className="p-5">
          <p className="text-xs text-primary tracking-[0.15em] uppercase mb-1 pr-8">{tripCountryLabel(t)}</p>
          <h3 className="font-display text-2xl mb-2 group-hover:text-primary transition">{t.destino}</h3>
          {/* "listo" no distingue cotizado de reservado: se deriva de las reservas confirmadas. */}
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            {t.fuente === "documento"
              ? <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] rounded-full border border-primary/40 text-primary px-2 py-0.5"><FileUp className="w-3 h-3" aria-hidden="true" /> De tus documentos</span>
              : isBroughtTrip(t)
                ? <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] rounded-full border border-primary/40 text-primary px-2 py-0.5"><Hotel className="w-3 h-3" aria-hidden="true" /> Lo trajiste tú</span>
                : <BookingStateBadge summary={deriveTripBookingState(t, bookings)} compact />}
          </div>
          <div className="flex items-end justify-between gap-3 text-sm text-muted-foreground">
            <span className="min-w-0">
              {/* Cuándo empieza y cuándo termina (con las noches); si falta una fecha, solo la que hay. */}
              <span className="block" data-testid="trip-card-dates">{formatTripDateRange(t.fecha_salida, t.fecha_regreso) ?? "Sin fechas"}</span>
              {/* Cuánto falta (o si está en curso): lo primero que se busca en la lista. */}
              {t.fecha_salida && (() => {
                const tm = tripTiming(t, localISODate());
                return tm.phase === "terminado" ? null : (
                  <span className={`block text-xs ${tm.phase === "en_curso" ? "text-primary" : "text-muted-foreground/80"}`}>{tm.label}</span>
                );
              })()}
            </span>
            {/* Importado de sus documentos: lo que PAGÓ, en la moneda del documento. */}
            {t.fuente === "documento" ? (
              Number(t.pagado_total) > 0 && t.pagado_moneda ? (
                <span className="text-right shrink-0">
                  <span className="block text-foreground font-medium">{formatPaid(Number(t.pagado_total), t.pagado_moneda)}</span>
                  <span className="block text-[11px] text-muted-foreground/80">{PAID_LABEL}</span>
                </span>
              ) : (
                <span className="text-xs text-muted-foreground shrink-0 text-right">Sin precio en tus documentos</span>
              )
            ) : isBroughtTrip(t) ? (
              <span className="text-xs text-muted-foreground shrink-0 text-right">Vuelos y hotel: ya los tienes</span>
            ) : invalidQuoteReason(t) ? (
              // Cotización guardada con error (antes "$7 MXN"): se dice que hay que volver a cotizar.
              <span className="text-right shrink-0" data-testid="trip-card-recotizar">
                <span className="block text-amber-400 font-medium">{REQUOTE_LABEL}</span>
                <span className="block text-[11px] text-muted-foreground/80">la cotización tuvo un error</span>
              </span>
            ) : /* Un borrador no cuesta "$0": se dice que aún no tiene cotización. El total es el MISMO de la
                 página del viaje (con lo que eligió en Comprar), no el total_estimado guardado. */ shownTotal > 0 ? (
              <span className="text-right shrink-0">
                <span className="block text-foreground font-medium">${shownTotal.toLocaleString("es-MX")} MXN</span>
                <span className="block text-[11px] text-muted-foreground/80">total cotizado</span>
              </span>
            ) : (
              <span className="text-xs text-muted-foreground shrink-0">Sin cotización</span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
};

const Trips = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<any[]>([]);
  // Sin estos estados, "Aún no has guardado ningún viaje" aparecía mientras cargaba o si fallaba la red.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tripBookings, setTripBookings] = useState<Map<string, BookingLike[]>>(new Map());
  const [broughtOpen, setBroughtOpen] = useState(false);
  const [broughtMounted, setBroughtMounted] = useState(false);
  const openBrought = () => { setBroughtMounted(true); setBroughtOpen(true); };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        // Una sola vuelta antes de pintar (antes: viajes propios → colaboraciones → viajes compartidos →
        // cotizaciones, en cascada; 5.4 s hasta ver el primer viaje). La RLS ya da propios y compartidos;
        // la lista de colaboraciones, en paralelo, marca cuáles son compartidos y deja fuera cualquier otro.
        const [all0, collab] = await Promise.all([
          supabase.from("trips").select("*"),
          supabase.from("trip_collaborators").select("trip_id").eq("user_id", user.id),
        ]);
        if (all0.error) throw all0.error;
        const sharedIds = new Set((collab.data ?? []).map((c: any) => c.trip_id));
        const all = ((all0.data ?? []) as any[])
          .filter((t) => !t.user_id || t.user_id === user.id || sharedIds.has(t.id))
          .map((t) => (!t.user_id || t.user_id === user.id ? t : { ...t, shared: true }))
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        if (cancelled) return;
        // La lista se muestra ya; la cotización vigente (para que el total sea el mismo de la página del viaje)
        // y las reservas llegan en paralelo y la actualizan.
        setTrips(all);
        setLoading(false);
        const quoteIds = all.map((t: any) => t.current_quote_id).filter(Boolean);
        const [qs, bks] = await Promise.all([
          quoteIds.length
            ? Promise.resolve(supabase.from("trip_quotes").select("id, created_at, valid_until, travelers, date_from, date_to").in("id", quoteIds)).catch(() => ({ data: null }))
            : Promise.resolve({ data: null }),
          all.length
            ? Promise.resolve(supabase.from("bookings")
              .select("trip_id, category, status, confirmation_code, partner_reference, title, subtitle")
              .in("trip_id", all.map((t: any) => t.id))).catch(() => ({ data: null }))
            : Promise.resolve({ data: null }),
        ]);
        if (cancelled) return;
        const byId = new Map((((qs as any)?.data as any[] | null) ?? []).map((q) => [q.id, q]));
        if (byId.size) setTrips(all.map((t: any) => (t.current_quote_id && byId.has(t.current_quote_id) ? { ...t, _quote: byId.get(t.current_quote_id) } : t)));
        // Reservas de esos viajes para el estado reservado/cotizado (si falla, todos quedan "cotizado").
        setTripBookings(bookingsByTrip((((bks as any)?.data as BookingLike[] | null) ?? [])));
      } catch (e) {
        console.error("Trips: no se pudieron cargar", e);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);

  return (
    <DashboardLayout>
      <div className="px-4 py-6 md:p-10 max-w-[1400px] mx-auto space-y-7 md:space-y-10">
        {/* Cinematic header */}
        <section className="relative rounded-[24px] md:rounded-[28px] overflow-hidden ring-1 ring-white/[0.05] premium-shadow">
          <div className="h-[180px] md:h-[260px]">
            <DestinationVideo
              query={trips[0]?.destino ? `${trips[0].destino} cinematic aerial luxury travel` : "luxury travel destinations cinematic aerial"}
              fallbackImage={santorini}
              alt="Mis viajes"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
          <div className="absolute inset-0 flex flex-col justify-end p-5 md:p-9">
            <p className="text-primary text-[10px] md:text-[11px] tracking-[0.35em] uppercase mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3" /> Tu colección
            </p>
            <h1 className="font-display text-3xl md:text-5xl leading-[1.05] text-white">Mis viajes</h1>
            <p className="text-xs md:text-sm text-white/70 mt-1.5">Cada travesía guardada — vuelos, hospedaje, experiencias.</p>
            <Link
              to="/dashboard/viajes/importar"
              className="mt-3 self-start inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-black/40 backdrop-blur px-3.5 min-h-10 text-xs text-primary hover:bg-primary/10"
            >
              <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> Sube un viaje que ya hiciste
            </Link>
            <button type="button" onClick={openBrought} data-testid="trips-ya-tengo"
              className="mt-2 self-start inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-black/40 backdrop-blur px-3.5 min-h-10 text-xs text-primary hover:bg-primary/10">
              <Hotel className="w-3.5 h-3.5" aria-hidden="true" /> Ya tengo vuelos y hotel
            </button>
          </div>
        </section>

        {loading ? (
          <TripCardsSkeleton />
        ) : loadError ? (
          <div className="glass-card rounded-3xl p-8 md:p-12 text-center" role="alert">
            <p className="text-muted-foreground mb-5">No pudimos cargar tus viajes. Revisa tu conexión.</p>
            <Button onClick={() => setReloadKey((k) => k + 1)} variant="outline" className="rounded-2xl">
              <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" /> Reintentar
            </Button>
          </div>
        ) : trips.length === 0 ? (
          <div className="glass-card rounded-3xl p-8 md:p-12 text-center">
            <h2 className="font-display text-2xl md:text-3xl mb-2">Aún no has guardado ningún viaje.</h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
              Cuando planeas un viaje, IATOS guarda aquí su cotización, itinerario y documentos para que los tengas a la mano.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={() => navigate("/dashboard/planear")} className="bg-gradient-gold text-primary-foreground gold-glow rounded-2xl min-h-[48px] px-6">
                <Plus className="w-4 h-4 mr-2" /> Crear mi primer viaje
              </Button>
              <Button variant="outline" onClick={openBrought} className="rounded-2xl min-h-[48px] px-6 border-primary/40">
                <Hotel className="w-4 h-4 mr-2" aria-hidden="true" /> Ya tengo vuelos y hotel
              </Button>
              <Button variant="outline" onClick={() => navigate("/dashboard/viajes/importar")} className="rounded-2xl min-h-[48px] px-6 border-primary/40">
                <FileUp className="w-4 h-4 mr-2" aria-hidden="true" /> Sube un viaje que ya hiciste
              </Button>
            </div>
          </div>
        ) : (
          // Próximos primero (por fecha de salida) y los pasados aparte: antes todo iba revuelto
          // por fecha de creación.
          groupTripsForList(trips, localISODate()).map((g) => (
            <section key={g.key} aria-labelledby={`trips-${g.key}`} className="space-y-4">
              <h2 id={`trips-${g.key}`} className="text-[11px] tracking-[0.3em] uppercase text-primary">
                {g.title} <span className="text-muted-foreground">· {g.trips.length}</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
                {g.trips.map((t) => (
                  <TripCard key={t.id} t={t} userId={user!.id} bookings={tripBookings.get(t.id)} onDeleted={(id) => setTrips((prev) => prev.filter((x) => x.id !== id))} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
      {broughtMounted && (
        <Suspense fallback={null}>
          <PlanTripDialog open={broughtOpen} onOpenChange={setBroughtOpen} startMode="traido" />
        </Suspense>
      )}
    </DashboardLayout>
  );
};

export default Trips;
