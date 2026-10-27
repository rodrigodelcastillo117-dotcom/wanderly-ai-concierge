import { useEffect, useMemo, useRef, useState } from "react";
import { expansionLine, type RegionExpansion } from "../../supabase/functions/_shared/regions.ts";
import { useBookingExitNotice } from "@/lib/bookingExit";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, MapPin, Calendar, Users, Plane, Hotel, Utensils, Compass, Lightbulb, Star, Check, X, Train, Car, Mountain, ArrowRight, Bus, Ship, CarTaxiFront, Route as RouteIcon, ChevronDown, Download, Radio, Map as MapIcon, Backpack, Cloud, Languages, BookHeart, Wallet, Sparkles, Pencil, Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";
import { DashboardLayout } from "@/components/DashboardLayout";
import { DestinationVideo } from "@/components/DestinationVideo";
import { ReadonlyBudget } from "@/components/ReadonlyBudget";
import { CityCollapsible } from "@/components/CityCollapsible";
import { IllustrativeCaption } from "@/components/media/SmartImage";
import { AirlineLogo } from "@/components/media/AirlineLogo";
import { airlineCode } from "@/lib/airlines";
import { EditWithAIDialog } from "@/components/EditWithAIDialog";
import { LiveTripQuote } from "@/components/LiveTripQuote";
import { RealTripTotal, tripTotals } from "@/components/RealTripTotal";
import { InviteFriendDialog } from "@/components/InviteFriendDialog";
import { PriceWatchCard } from "@/components/PriceWatchCard";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateOnly } from "@/lib/dateUtils";
import { formatInstant } from "@/lib/localDate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { TripDeleteButton } from "@/components/TripDeleteButton";
import santorini from "@/assets/hero-santorini.jpg";
import { computeTripDesglose, quoteStaleness, quoteValidity, staleQuoteMessage, tripNights, hotelPriceRooms, type QuoteSnapshot } from "@/lib/quote";
import {
  readLocalSelections, restoreSelections, sameSelections, serializeSelections, withCityHotel, writeLocalSelections, type PersistedSelections,
} from "@/lib/tripSelections";
import { deriveTripBookingState, type BookingLike } from "@/lib/bookingState";
import { BookingStateBadge, estimatedKindsOf } from "@/components/BookingStateBadge";
import { ImportedTripBanner } from "@/components/ImportedTripBanner";
import { TripDocuments } from "@/components/TripDocuments";
import { TripBookingIntents } from "@/components/booking/TripBookingIntents";
import { useTripOffers, type TripOfferActions } from "@/components/booking/useTripOffers";
import { isGroundTripOption, transportModeOf, tripCountryLabel, tripFlightProblems } from "@/lib/booking";
import { flightAirlineLabel, flightDurationLabel, flightIsEstimate, flightLiveLine, flightStopsLabel } from "@/lib/flightDisplay";
import { groundOptionsForCity, legOptionsFor, transportRubroLabel } from "@/lib/multiDestTrip";
import { FlightBuyButtons } from "@/components/booking/FlightBuyButtons";
import { cityStays } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { TripSectionNav, isTripSection, sectionFromHash, TRIP_SECTION_EVENT, type TripSection } from "@/components/TripSectionNav";
import { TripNextStep } from "@/components/TripNextStep";
import { TripPurchasePlan } from "@/components/booking/TripPurchasePlan";
import { SendSelectionEmail } from "@/components/booking/SendSelectionEmail";
import { ConvertToRouteBanner, convertToRouteHref } from "@/components/route/ConvertToRouteBanner";
import { RoadTripPanel } from "@/components/roadtrip/RoadTripPanel";
import { TripDetailSkeleton } from "@/components/PageSkeletons";
import { quoteTrust } from "@/lib/quoteTrust";
import { buildBuyFlow } from "@/lib/buyFlow";
import { itemPurchaseState } from "@/lib/purchasePlan";
import { tripTotalSummary } from "@/lib/tripTotal";
import { splitTripTotal } from "@/lib/totalSplit";
import { arrivalByLand, isBusOption, isCarOption, isHiredCarOption } from "@/lib/groundTrip";
import { GroundOptionInfo } from "@/components/booking/GroundOptionInfo";
import { useTripPurchaseMarks } from "@/hooks/useTripPurchaseMarks";


const fmtMXN = (n: number) =>
  `$${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 })} MXN`;

const TripDetail = () => {
  useBookingExitNotice(); // motivo con el que booking-go regresó a IATOS (AUD-04)
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Selecciones del usuario
  // -1 = sin selección (usa estimación base) · -2 = "ya lo tengo / no aplica" (cuenta 0) · >=0 = opción elegida
  const [selVuelo, setSelVuelo] = useState<number>(-1);
  const [selHospedaje, setSelHospedaje] = useState<number>(-1);
  const [nochesHospedaje, setNochesHospedaje] = useState<number | null>(null); // null = usar todas las noches
  const [selTours, setSelTours] = useState<Set<number>>(new Set());
  // Multi-destino: hotel elegido por ciudad (Roma, Florencia, Venecia).
  const [selHoteles, setSelHoteles] = useState<Record<string, number>>({});
  // Sección visible (pestañas): Resumen · Comprar · Ruta · Destinos · Documentos.
  const [section, setSection] = useState<TripSection>(() => sectionFromHash());
  const [activeCity, setActiveCity] = useState<string | null>(null);
  const toggleCity = (city: string) => {
    setActiveCity((prev) => (prev === city ? null : city));
  };

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfMenu, setPdfMenu] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [favRecoId, setFavRecoId] = useState<string | null>(null);
  const [editingDates, setEditingDates] = useState(false);
  const [editingTravelers, setEditingTravelers] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);
  // Cotización vigente (snapshot inmutable de trip_quotes), si existe.
  const [quote, setQuote] = useState<QuoteSnapshot | null>(null);
  // E-12: última selección guardada (en trips.selections o, si la columna aún no existe, local) y
  // para qué viaje ya se restauró (no guardar antes de restaurar).
  const [savedSel, setSavedSel] = useState<PersistedSelections | null>(null);
  const restoredFor = useRef<string | null>(null);
  // Reservas del viaje: reservado vs. cotizado se deriva de las confirmadas.
  const [bookings, setBookings] = useState<BookingLike[]>([]);
  // Booking Bridge: acciones de reserva con datos del servidor (catálogo, enlaces verificados).
  const serverOffers = useTripOffers(trip?.id, trip?.current_quote_id ?? trip?.updated_at ?? null);
  // "Ya lo compré" del grupo: lo usan "Comprar" y el total ("Ya compraste $X · Falta $Y"), una sola carga.
  const purchaseMarks = useTripPurchaseMarks({ trip: trip as any, userId: user?.id ?? null, bookings: bookings as any });

  async function saveTripMeta(patch: Record<string, any>) {
    if (!trip?.id) return;
    setSavingMeta(true);
    const { error } = await supabase.from("trips").update(patch as any).eq("id", trip.id);
    setSavingMeta(false);
    if (error) return toast.error("No se pudo guardar");
    // Cambiar viajeros o fechas no recotiza: el total guardado sigue siendo el de antes.
    if (trip.total_estimado && ("num_viajeros" in patch || "fecha_salida" in patch || "fecha_regreso" in patch)) {
      toast.success("Actualizado", { description: "La cotización es de antes del cambio: actualízala para ver precios correctos." });
    } else {
      toast.success("Actualizado");
    }
    setEditingDates(false);
    setEditingTravelers(false);
    loadTrip();
  }

  // Cargar estado de favorito
  useEffect(() => {
    if (!user || !trip?.destino) return;
    supabase.from("recomendaciones")
      .select("id, guardado")
      .eq("user_id", user.id)
      .eq("titulo", trip.destino)
      // Puede haber filas repetidas de antes (doble toque): con maybeSingle() la consulta
      // fallaba y el corazón nunca aparecía marcado. Tomamos la guardada si existe.
      .order("guardado", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFavRecoId(data.id);
          setIsFavorite(!!data.guardado);
        }
      });
  }, [user, trip?.destino]);

  // Doble toque = dos filas en recomendaciones; se ignora el segundo mientras se guarda.
  const [savingFav, setSavingFav] = useState(false);
  const toggleFavorite = async () => {
    if (!user || !trip || savingFav) return;
    setSavingFav(true);
    try {
      await toggleFavoriteNow();
    } finally {
      setSavingFav(false);
    }
  };
  const toggleFavoriteNow = async () => {
    if (!user || !trip) return;
    if (isFavorite && favRecoId) {
      await supabase.from("recomendaciones").update({ guardado: false }).eq("id", favRecoId);
      setIsFavorite(false);
      toast.success("Quitado de favoritos");
    } else if (favRecoId) {
      await supabase.from("recomendaciones").update({ guardado: true }).eq("id", favRecoId);
      setIsFavorite(true);
      toast.success(`${trip.destino} guardado en favoritos`);
    } else {
      const { data } = await supabase.from("recomendaciones").insert([{
        user_id: user.id,
        titulo: trip.destino,
        tipo: "destination_ai",
        descripcion: trip.pais_destino,
        imagen_url: trip.cover_image_url,
        match_score: trip.match_score,
        guardado: true,
        metadata: { from_trip_id: trip.id },
      }]).select("id").single();
      if (data) setFavRecoId(data.id);
      setIsFavorite(true);
      toast.success(`${trip.destino} guardado en favoritos`);
    }
  };

  const loadTrip = async () => {
    if (!id) return;
    const { data } = await supabase.from("trips").select("*").eq("id", id).maybeSingle();
    setTrip(data);
    if (data) {
      // Con la columna, manda la base; sin ella (migración pendiente), el respaldo local.
      const stored = ("selections" in (data as any)) ? (data as any).selections : readLocalSelections(id);
      const r = restoreSelections(data, stored);
      setSelVuelo(r.selVuelo);
      setSelHospedaje(r.selHospedaje);
      setNochesHospedaje(r.nochesHospedaje);
      setSelTours(r.selTours);
      setSelHoteles(r.selHoteles ?? {});
      setSavedSel(serializeSelections(data, r));
      restoredFor.current = id;
      void Promise.resolve(
        supabase.from("bookings")
          .select("id, trip_id, category, status, confirmation_code, partner_reference, title, subtitle, raw_payload")
          .eq("trip_id", id),
      ).then(({ data: bks }) => setBookings((bks as BookingLike[] | null) ?? [])).catch(() => setBookings([]));
    }
    const quoteId = (data as any)?.current_quote_id;
    if (quoteId) {
      const { data: q, error: qErr } = await supabase.from("trip_quotes").select("*").eq("id", quoteId).maybeSingle();
      setQuote(qErr ? null : ((q as unknown as QuoteSnapshot) ?? null));
    } else {
      setQuote(null);
    }
    // Experiencias arrancan sin seleccionar — el usuario elige cuál le interesa.
    setLoading(false);
  };

  useEffect(() => {
    loadTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Auto-sugiere restaurantes si el viaje no los trae (típico de imports de PDF).
  useEffect(() => {
    if (!trip || !id) return;
    const tieneRest = Array.isArray(trip.restaurantes_json) && trip.restaurantes_json.length > 0;
    if (tieneRest) return;
    const itinObj2 = trip.itinerario_json;
    const isMulti2 = !!(itinObj2 && !Array.isArray(itinObj2) && itinObj2.multi);
    const cities = isMulti2
      ? (itinObj2.destinations ?? []).filter(Boolean)
      : [trip.destino].filter(Boolean);
    if (cities.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.functions.invoke("suggest-restaurants", {
          body: { cities, travelers: trip.num_viajeros ?? 2 },
        });
        if (cancelled || !data?.ok || !Array.isArray(data.restaurantes) || data.restaurantes.length === 0) return;
        await supabase.from("trips").update({ restaurantes_json: data.restaurantes }).eq("id", id);
        setTrip((t: any) => (t ? { ...t, restaurantes_json: data.restaurantes } : t));
      } catch (e) {
        console.warn("suggest-restaurants failed", e);
      }
    })();
    return () => { cancelled = true; };
  }, [trip?.id]);

  // Abrir el primer destino por default al cargar el viaje
  useEffect(() => {
    if (!trip) return;
    const itinObj = trip.itinerario_json;
    const isMultiTrip = !!(itinObj && !Array.isArray(itinObj) && itinObj.multi);
    const cities = isMultiTrip ? (itinObj.destinations ?? []) : [trip.destino];
    if (cities.length > 0) {
      setActiveCity((prev) => prev ?? cities[0]);
    }
  }, [trip]);

  // Guarda la selección al cambiarla (E-12). El trigger trips_quote_basis_guard marca la
  // cotización como "por actualizar" si difiere de la selección con que se cotizó.
  useEffect(() => {
    if (!trip?.id || restoredFor.current !== trip.id) return;
    const next = serializeSelections(trip, { selVuelo, selHospedaje, nochesHospedaje, selTours, selHoteles });
    if (sameSelections(next, savedSel)) return;
    const tripId = trip.id;
    const timer = setTimeout(async () => {
      setSavedSel(next);
      const { data, error } = await supabase.from("trips").update({ selections: next as any }).eq("id", tripId)
        .select("selections, quote_basis, quote_needs_update");
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) {
        // Columna aún no aplicada o sin permiso de edición: se conserva en este dispositivo.
        writeLocalSelections(tripId, next);
        setTrip((t: any) => (t && t.id === tripId ? { ...t, selections: next } : t));
        return;
      }
      writeLocalSelections(tripId, null);
      setTrip((t: any) => (t && t.id === tripId ? { ...t, ...row } : t));
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selVuelo, selHospedaje, nochesHospedaje, selTours, selHoteles, trip?.id, savedSel]);

  // Otra parte de la página (p. ej. "Qué sigue" → "Elige y reserva") pide mostrar una sección.
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (isTripSection(id)) setSection(id);
    };
    window.addEventListener(TRIP_SECTION_EVENT, on);
    return () => window.removeEventListener(TRIP_SECTION_EVENT, on);
  }, []);

  const handleDownloadPdf = async (theme: "dark" | "light" = "dark") => {
    if (!trip) return;
    setPdfMenu(false);
    setGeneratingPdf(true);
    try {
      // jsPDF, el armado del PDF y sus fuentes solo se descargan al pedir el PDF, no al abrir el viaje.
      const { generateTripPDF } = await import("@/lib/tripPdf");
      // El total es EXACTAMENTE el de la página (RealTripTotal / barra inferior), con la misma selección.
      const shown = pageTotalsOf(trip);
      await generateTripPDF(trip, {
        theme,
        sel: { selVuelo, selHospedaje, selTours, selHoteles, nochesHospedaje: nochesEfectivas },
        totals: { total: shown.total, porPersona: shown.porPersona, travelers: quoteTravelers, nights: quoteNights, desglose: computedDesglose, fromSelection: shown.fromSelection, quotedTotal: shown.quotedTotal, estimadosNote: totalSummary.estimadosNote },
        bookings: bookings as any, userId: user?.id ?? null, serverOffers, quoteCreatedAt: quote?.created_at ?? null, trust: quoteTrust(quote),
      });
      toast.success("PDF descargado");
    } catch (e: any) {
      console.error(e);
      // Sin el texto técnico del error: solo qué pasó y qué hacer.
      toast.error("No pudimos generar el PDF", { description: "Intenta de nuevo en un momento." });
    } finally {
      setGeneratingPdf(false);
    }
  };

  // itinerario_json puede ser array (single) o objeto { multi, days, logistics, destinations } (multi)
  const itinObj = trip?.itinerario_json;
  const isMulti = !!(itinObj && !Array.isArray(itinObj) && itinObj.multi);
  const itinDays: any[] = Array.isArray(itinObj)
    ? itinObj
    : Array.isArray(itinObj?.days)
      ? itinObj.days
      : [];
  const logistics = isMulti ? itinObj.logistics : null;
  const destinationsMulti: string[] = isMulti ? itinObj.destinations ?? [] : [];

  // Resuelve la "ciudad" usada dentro de hospedaje/tours/restaurantes/itin para cada destino del viaje
  // (el destino puede ser país como "Grecia" y los items guardarse como "Atenas").
  const cityKeyFor = (label: string): string => {
    if (!isMulti) return label;
    const norm = (s: string) => (s || "").toLowerCase().trim();
    const collect = (arr: any) => Array.isArray(arr) ? arr.map((x: any) => x?.ciudad).filter(Boolean) : [];
    const allCiudades: string[] = Array.from(new Set([
      ...collect(trip?.hospedaje_json),
      ...collect(trip?.tours_json),
      ...collect(trip?.restaurantes_json),
      ...collect(itinDays),
    ]));
    // 1) match exacto / substring en cualquier dirección
    const direct = allCiudades.find(c => norm(c) === norm(label) || norm(c).includes(norm(label)) || norm(label).includes(norm(c)));
    if (direct) return direct;
    // 2) fallback por índice (orden) entre ciudades no usadas por otros destinos
    const used = new Set(
      destinationsMulti
        .filter(d => d !== label)
        .map(d => {
          const m = allCiudades.find(c => norm(c) === norm(d) || norm(c).includes(norm(d)) || norm(d).includes(norm(c)));
          return m ?? null;
        })
        .filter(Boolean) as string[]
    );
    const remaining = allCiudades.filter(c => !used.has(c));
    const idx = destinationsMulti.indexOf(label);
    return remaining[Math.min(idx, remaining.length - 1)] ?? label;
  };

  // Noches por fechas (como el servidor); el itinerario solo si no hay fechas.
  const noches = trip ? tripNights(trip, itinDays.length) : 1;
  const viajeros = trip?.num_viajeros ?? 1;

  // Si el usuario cambió viajeros o fechas después de cotizar, el total guardado es para la base
  // anterior: se muestra para esa base (sin repartirlo entre el nuevo número de viajeros) y se
  // pide actualizar la cotización.
  const currentSel = trip ? serializeSelections(trip, { selVuelo, selHospedaje, nochesHospedaje, selTours, selHoteles }) : null;
  const staleness = quoteStaleness(trip ? { ...trip, selections: currentSel } : trip, quote);
  const quoteTravelers = staleness.stale && staleness.basis ? staleness.basis.travelers : viajeros;
  const quoteNights = staleness.stale && staleness.basis?.dateFrom && staleness.basis?.dateTo
    ? tripNights({ fecha_salida: staleness.basis.dateFrom, fecha_regreso: staleness.basis.dateTo }, itinDays.length)
    : noches;
  const validity = quoteValidity(trip, quote);

  const nochesEfectivas = nochesHospedaje ?? quoteNights;

  // Recalcular desglose en base a selecciones (-2 = "ya lo tengo / no aplica")
  const computedDesglose = useMemo(
    () => computeTripDesglose(trip, { selVuelo, selHospedaje, nochesHospedaje: nochesEfectivas, selTours, selHoteles }, quoteTravelers),
    [trip, selVuelo, selHospedaje, selTours, selHoteles, quoteTravelers, nochesEfectivas],
  );

  const computedTotal = Object.values(computedDesglose).reduce((s: number, v) => s + Number(v ?? 0), 0);

  // Total que muestra la página (RealTripTotal recibe exactamente estos argumentos).
  // Sin selección, el desglose recalculado puede diferir del guardado (viaje corto: el coche suma casetas +
  // gasolina, no el precio de la IA): entonces la cifra grande usa el recalculado, igual que la barra y Comprar.
  const recalculated = !!trip && Object.keys(computedDesglose).some((k) => Math.round(Number(computedDesglose[k]) || 0) !== Math.round(Number(trip.desglose_presupuesto?.[k]) || 0));
  const pageSelDesglose = currentSel || recalculated ? computedDesglose : null;
  const pageTotalsOf = (t: any) => tripTotals(t, quoteTravelers, pageSelDesglose);

  // Lo mismo que muestra "Comprar" (buildBuyFlow): qué está elegido y qué ya se compró.
  const buyItems = useMemo(
    () => (trip ? buildBuyFlow(trip, { selVuelo, selHospedaje, selTours, selHoteles }, serverOffers, { quoteCreatedAt: quote?.created_at ?? null }).items : []),
    [trip, selVuelo, selHospedaje, selTours, selHoteles, serverOffers, quote?.created_at],
  );

  if (loading) {
    return (
      <DashboardLayout>
        <TripDetailSkeleton />
      </DashboardLayout>
    );
  }

  if (!trip) {
    return (
      <DashboardLayout>
        <div className="px-4 py-16 md:p-16 max-w-xl mx-auto text-center" role="alert">
          <h1 className="font-display text-3xl mb-3">No encontramos este viaje</h1>
          <p className="text-muted-foreground mb-8">Puede que se haya eliminado o que ya no esté compartido contigo.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={() => navigate("/dashboard/viajes")} className="bg-gradient-gold text-primary-foreground rounded-2xl min-h-[48px]">Ir a Mis viajes</Button>
            <Button variant="outline" onClick={() => navigate("/dashboard/planear")} className="rounded-2xl min-h-[48px]">Planear un viaje</Button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const trust = quoteTrust(quote, new Date(), { transporte_local: transportRubroLabel(trip) });
  const discardedFares = (trip.vuelos_json ?? []).filter((v: any) => tripFlightProblems(v, trip).length > 0).length;
  const hasQuotedTotal = !!(itinObj?.from_pdf || (trip.vuelos_json?.length ?? 0) > 0 || (trip.hospedaje_json?.length ?? 0) > 0);
  const isOwner = user?.id === trip.user_id;
  // Un solo total con su estado (estimado · de tu selección · ya comprado); la barra móvil dice lo mismo.
  const totalSummary = tripTotalSummary({
    trip, sel: { selVuelo, selHospedaje, selTours, selHoteles }, desglose: computedDesglose, items: buyItems,
    itemState: (it) => itemPurchaseState(it, purchaseMarks.rows, purchaseMarks.marks),
    porCotizar: Array.isArray(quote?.sources?.por_cotizar) ? quote!.sources!.por_cotizar : null,
  });
  // El mismo total separado en precios reales y estimados (claude/viaje-corto).
  const totalSplit = splitTripTotal({ trip, sel: { selVuelo, selTours }, desglose: computedDesglose, items: buyItems });
  const quotedTotalValue = tripTotals(trip, quoteTravelers, null).quotedTotal;
  // La cifra grande de la página (RealTripTotal): la misma en el resumen de Comprar, el correo y el PDF.
  const pageTotal = hasQuotedTotal ? pageTotalsOf(trip).total : 0;
  // Los renglones de la cotización solo se muestran si suman lo mismo que el total de arriba (si no,
  // serían una segunda cifra sin explicación).
  const trustForTotal = trust.known && Math.round(quotedTotalValue) === Math.round(computedTotal) ? trust : null;
  const stickyTotal = hasQuotedTotal && totalSummary.total > 0 ? totalSummary.barTotal : null;
  // "Actualizar cotización" (y la barra fija del celular) siguen al cálculo de la página: al volver a la
  // selección cotizada se quitan aunque trips.quote_needs_update (JSON tal cual) siga en true.
  const tripForNextStep = trip.quote_needs_update && !staleness.stale ? { ...trip, quote_needs_update: false } : trip;

  const toggleTour = (i: number) => {
    setSelTours((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const hasRoadTrip = !!(isMulti && logistics?.road_trip);
  const sections: Array<{ id: TripSection; label: string }> = [
    { id: "resumen", label: "Resumen" },
    { id: "comprar", label: "Comprar" },
    ...(hasRoadTrip ? [{ id: "ruta" as TripSection, label: "Ruta" }] : []),
    { id: "destinos", label: "Destinos" },
    { id: "documentos", label: "Documentos" },
  ];
  const showSection = (id: TripSection) => {
    setSection(id);
    try { window.history.replaceState(window.history.state, "", `#${id}`); } catch { /* sin historial */ }
    // La sección empieza arriba, debajo de las pestañas (sin saltos a media página).
    const nav = document.getElementById("trip-secciones");
    if (nav && typeof window.scrollTo === "function") {
      const top = nav.getBoundingClientRect().top + window.scrollY;
      if (window.scrollY > top) window.scrollTo({ top, behavior: "auto" });
    }
  };

  return (
    <DashboardLayout>
      {/* HERO */}
      {/* Portada más baja en móvil (antes ocupaba la pantalla completa y el total quedaba dos
          pantallas abajo). */}
      <div className="relative h-[36vh] min-h-[300px] max-h-[420px] md:h-[44vh] md:min-h-[360px] md:max-h-[520px] overflow-hidden">
        {trip.cover_image_url ? (
          <img src={trip.cover_image_url} alt={trip.destino} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <DestinationVideo query={`${trip.destino} ${trip.pais_destino ?? ""} travel`} fallbackImage={santorini} alt={trip.destino} className="absolute inset-0 w-full h-full object-cover" />
        )}
        <div className="absolute inset-0 bg-gradient-overlay" />
        {/* El video/foto de stock muestra el destino, no un lugar del viaje: se marca. */}
        {!trip.cover_image_url && <IllustrativeCaption className="bottom-3 right-3" />}
        {trip.cover_image_url && /googleusercontent\.com/.test(trip.cover_image_url) && (
          <span className="absolute bottom-3 right-3 z-[2] text-[9px] text-white/70 drop-shadow pointer-events-none">Foto: Google</span>
        )}


        <div className="absolute top-4 inset-x-4 z-20 flex flex-wrap items-start justify-end gap-2 md:top-6 md:right-6 md:left-auto md:flex-nowrap">
          <button
            onClick={toggleFavorite}
            disabled={savingFav}
            aria-label={isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full glass-card hover:gold-border transition shrink-0"
          >
            <Heart className={`w-4 h-4 ${isFavorite ? "fill-primary text-primary" : "text-foreground"}`} />
          </button>
          <Popover open={pdfMenu} onOpenChange={setPdfMenu}>
            <PopoverTrigger asChild>
              <button
                disabled={generatingPdf}
                className="inline-flex items-center gap-2 px-2.5 sm:px-3 py-2 rounded-full glass-card text-xs hover:gold-border transition disabled:opacity-50 shrink-0"
                aria-label={generatingPdf ? "Generando PDF" : "Compartir PDF"}
              >
                <Download className="w-3.5 h-3.5 text-primary" />
                <span className="hidden sm:inline">{generatingPdf ? "Generando…" : "Compartir PDF"}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 max-w-[calc(100vw-2rem)] p-1.5" data-testid="pdf-menu">
              <button type="button" onClick={() => void handleDownloadPdf("dark")} className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-muted transition">
                <span className="block text-sm font-medium">PDF para compartir</span>
                <span className="block text-xs text-muted-foreground">Negro y dorado, con fotos y enlaces para comprar</span>
              </button>
              <button type="button" onClick={() => void handleDownloadPdf("light")} className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-muted transition">
                <span className="block text-sm font-medium">Imprimir en blanco</span>
                <span className="block text-xs text-muted-foreground">Fondo claro, gasta menos tinta</span>
              </button>
            </PopoverContent>
          </Popover>
          <InviteFriendDialog tripId={trip.id} isOwner={user?.id === trip.user_id} />
          <EditWithAIDialog tripId={trip.id} onUpdated={loadTrip} />
          <TripDeleteButton tripId={trip.id} destino={trip.destino} isOwner={isOwner} userId={user?.id ?? null} />
        </div>
        <div className="absolute inset-x-0 bottom-0 max-w-5xl p-4 sm:p-6 md:p-12">
          {trip.match_score && (
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/90 text-primary-foreground text-xs font-medium mb-4">
              <Star className="w-3 h-3 fill-current" /> {trip.match_score}% match con tu perfil
            </div>
          )}
          <p className="text-primary text-xs tracking-[0.2em] uppercase mb-2">{tripCountryLabel(trip)}</p>
          <h1 className="font-display text-3xl min-[380px]:text-4xl sm:text-5xl md:text-7xl leading-tight mb-3 md:mb-4 break-words">{trip.destino}</h1>
          {isMulti && Array.isArray(itinObj.region_expansions) && itinObj.region_expansions.length > 0 && (
            <div className="mb-3 space-y-0.5" data-testid="region-expansions">
              {itinObj.region_expansions.map((e: RegionExpansion) => (
                <p key={e.region} className="text-xs text-primary">{expansionLine(e)}</p>
              ))}
            </div>
          )}
          <div className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <Popover open={editingDates} onOpenChange={setEditingDates}>
              <PopoverTrigger asChild>
                <button className="flex max-w-full min-w-0 items-center gap-1.5 text-left hover:text-primary transition group">
                  <Calendar className="w-3.5 h-3.5" /> {formatDateOnly(trip.fecha_salida)} – {formatDateOnly(trip.fecha_regreso)}
                  <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] space-y-3" align="start">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Editar fechas</p>
                <label className="block text-xs">
                  Salida
                  <Input type="date" defaultValue={trip.fecha_salida ?? ""} id="edit-fecha-salida" className="mt-1" />
                </label>
                <label className="block text-xs">
                  Regreso
                  <Input type="date" defaultValue={trip.fecha_regreso ?? ""} id="edit-fecha-regreso" className="mt-1" />
                </label>
                <Button size="sm" disabled={savingMeta} className="w-full" onClick={() => {
                  const fs = (document.getElementById("edit-fecha-salida") as HTMLInputElement)?.value;
                  const fr = (document.getElementById("edit-fecha-regreso") as HTMLInputElement)?.value;
                  if (!fs || !fr) return toast.error("Fechas requeridas");
                  if (fr < fs) return toast.error("Regreso debe ser después de salida");
                  saveTripMeta({ fecha_salida: fs, fecha_regreso: fr });
                }}>Guardar</Button>
              </PopoverContent>
            </Popover>
            <Popover open={editingTravelers} onOpenChange={setEditingTravelers}>
              <PopoverTrigger asChild>
                <button className="flex items-center gap-1.5 hover:text-primary transition group">
                  <Users className="w-3.5 h-3.5" /> {viajeros} {viajeros === 1 ? "viajero" : "viajeros"}
                  <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-56 max-w-[calc(100vw-2rem)] space-y-3" align="start">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Nº de viajeros</p>
                <Input type="number" min={1} max={20} defaultValue={viajeros} id="edit-viajeros" aria-label="Número de viajeros" />
                <Button size="sm" disabled={savingMeta} className="w-full" onClick={() => {
                  const n = Number((document.getElementById("edit-viajeros") as HTMLInputElement)?.value);
                  if (!n || n < 1) return toast.error("Mínimo 1");
                  saveTripMeta({ num_viajeros: n });
                }}>Guardar</Button>
              </PopoverContent>
            </Popover>
            <span className="flex max-w-full min-w-0 items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" /> <span className="break-words">Desde {trip.ciudad_origen}</span></span>
          </div>
        </div>
      </div>

      {/* Secciones del viaje (pestañas fijas arriba): la página muestra una sección a la vez, así se
          entiende sin bajar tanto. Antes eran ~3 pantallas completas con todo seguido (caso 22-oct-2026). */}
      {/* Destino con varias ciudades guardado como uno solo ("paris roma y atenas 10 dias"): armarlo como ruta. */}
      {isOwner && convertToRouteHref(trip) && (
        <div className="max-w-5xl px-4 pt-4 sm:px-6 md:px-12"><ConvertToRouteBanner trip={trip} /></div>
      )}
      <TripSectionNav sections={sections} active={section} onChange={showSection} />

      <div className="max-w-5xl p-4 pb-24 sm:p-6 md:px-12 md:pt-8">
        <div role="tabpanel" id="panel-resumen" aria-labelledby="tab-resumen" data-trip-panel="resumen" hidden={section !== "resumen"} className="space-y-6">
        {/* Reservado vs. cotizado ("listo" no lo distingue): derivado de las reservas confirmadas.
            Un viaje importado de documentos dice lo que se PAGÓ, no un estado de cotización. */}
        {(trip as any).fuente === "documento"
          ? <ImportedTripBanner trip={trip} />
          : <BookingStateBadge summary={deriveTripBookingState(trip, bookings)} estimated={estimatedKindsOf(totalSummary.estimatedKeys)} />}
        {/* Smart Date Resolution: fechas optimizadas por IATOS */}
        {trip.dates_optimized && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-background p-4 md:p-6"
          >
            <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_60%)]" />
            <div className="relative flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div className="space-y-1 min-w-0">
                  <p className="text-sm">
                    <span className="font-semibold text-primary">Fechas Optimizadas por IATOS:</span>{" "}
                    <span className="text-muted-foreground">
                      Como no nos diste fechas, IATOS propuso estas y cotizó con ellas{" "}
                      <span className="text-foreground font-medium">
                        ({formatDateOnly(trip.fecha_salida, { day: "numeric", month: "long" })} – {formatDateOnly(trip.fecha_regreso, { day: "numeric", month: "long", year: "numeric" })})
                      </span>
                      . Puedes cambiarlas y volver a cotizar cuando quieras.
                    </span>
                  </p>
                  {trip.dates_optimization_meta?.reason && (
                    <p className="text-xs text-muted-foreground/80 italic">
                      {trip.dates_optimization_meta.reason}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => navigate(`/dashboard/viajes/${id}/editar`)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-primary/50 px-4 py-2 text-xs font-medium text-primary transition hover:bg-primary/10 md:w-auto md:shrink-0"
              >
                <Pencil className="w-3.5 h-3.5" />
                Cambiar fechas y re-cotizar
              </button>
            </div>
          </motion.div>
        )}



        {/* Tarifas guardadas que eran de otra ruta: se descartan y se dice (nunca se muestran como vuelo del viaje). */}
        {discardedFares > 0 && (
          <div role="status" data-testid="trip-tarifas-descartadas" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-500">
            Descartamos {discardedFares === 1 ? "1 tarifa de vuelo" : `${discardedFares} tarifas de vuelo`} de esta cotización porque no eran de tu ruta. El vuelo queda por cotizar: búscalo en “Comprar mi viaje” o actualiza la cotización.
          </div>
        )}

        {/* Total + Análisis narrativo */}
        <motion.section id="trip-total" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="scroll-mt-20 focus:outline-none">
          {hasQuotedTotal ? (
            <RealTripTotal
              trip={trip}
              noches={quoteNights}
              viajeros={quoteTravelers}
              onUpdated={loadTrip}
              staleMessage={staleness.stale && staleness.basis ? staleQuoteMessage(staleness.basis, staleness.reasons) : null}
              selectionDesglose={pageSelDesglose}
              validityLabel={validity.label}
              validityExpired={validity.expired}
              fxNote={quote ? `Tipo de cambio de la cotización: 1 USD = ${Number(quote.fx_rate).toFixed(2)} MXN · ${quote.fx_is_fallback ? "de respaldo" : quote.fx_source} (${formatInstant(quote.fx_at)})` : null}
              onRequote={() => navigate(`/dashboard/viajes/${id}/editar`)}
              trust={trustForTotal}
              summary={totalSummary}
              split={totalSplit}
            >
              {/* Un solo desglose, plegado bajo el mismo total (sin repetir título ni cifra). */}
              {computedTotal > 0 ? (
                <ReadonlyBudget desglose={computedDesglose} total={computedTotal} travelers={quoteTravelers}
                  embedded estimatedKeys={totalSummary.estimatedKeys} labels={{ transporte_local: transportRubroLabel(trip) }} />
              ) : null}
            </RealTripTotal>
          ) : (
            <LiveTripQuote
              tripId={trip.id}
              origin={trip.ciudad_origen}
              destination={isMulti ? destinationsMulti[0] : trip.destino}
              depart={trip.fecha_salida}
              return_date={trip.fecha_regreso}
              nights={noches}
              travelers={viajeros}
              fallbackMxn={computedTotal}
            />
          )}
          {/* Sin cotización (LiveTripQuote): el desglose de la estimación, sin repetir el total. */}
          {!hasQuotedTotal && computedTotal > 0 && (
            <details className="group glass-card rounded-2xl -mt-4" data-testid="trip-desglose">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 p-4 sm:px-5">
                <span className="inline-flex items-center gap-2 text-sm"><Compass className="w-4 h-4 text-primary shrink-0" /> Ver desglose del total</span>
                <ChevronDown className="w-4 h-4 shrink-0 text-primary transition-transform group-open:rotate-180" />
              </summary>
              <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-border/40">
                <ReadonlyBudget desglose={computedDesglose} total={computedTotal} travelers={viajeros} embedded labels={{ transporte_local: transportRubroLabel(trip) }} />
              </div>
            </details>
          )}
        </motion.section>

        {/* Qué sigue: guardado, cuánto falta y UNA acción principal. */}
        <TripNextStep trip={tripForNextStep} quote={quote} isOwner={isOwner} />

        {isOwner && (
          <PriceWatchCard tripId={trip.id} departureDate={trip.fecha_salida} />
        )}

        {/* Herramientas del viaje: después del total y de "qué sigue" (antes iban primero y empujaban
            el precio fuera de la pantalla); en móvil, una fila deslizable. */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex gap-2.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 md:grid md:grid-cols-7 md:gap-3"
          role="group"
          aria-label="Herramientas del viaje"
        >
          {[
            { icon: Radio, label: "Live", to: `/dashboard/viajes/${id}/live` },
            { icon: MapIcon, label: "Mapa", to: `/dashboard/viajes/${id}/mapa` },
            { icon: Backpack, label: "Packing", to: `/dashboard/viajes/${id}/packing` },
            { icon: Cloud, label: "Clima", to: `/dashboard/viajes/${id}/clima` },
            { icon: Languages, label: "Traductor", to: `/dashboard/viajes/${id}/traductor` },
            { icon: BookHeart, label: "Diario", to: `/dashboard/viajes/${id}/diario` },
            { icon: Wallet, label: "Gastos", to: `/dashboard/viajes/${id}/split` },
          ].map(({ icon: Icon, label, to }) => (
            <button
              key={label}
              onClick={() => navigate(to)}
              className="glass-card shrink-0 min-w-[84px] rounded-2xl p-3 hover:border-primary/60 transition-all group flex flex-col items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Icon className="w-5 h-5 text-primary" />
              </div>
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </motion.div>


        </div>

        <div role="tabpanel" id="panel-comprar" aria-labelledby="tab-comprar" data-trip-panel="comprar" hidden={section !== "comprar"} className="space-y-6">
          {(trip as any).fuente !== "documento" && hasQuotedTotal ? (
            <TripPurchasePlan trip={trip} selVuelo={selVuelo} selHospedaje={selHospedaje} selTours={selTours} selHoteles={selHoteles}
              serverOffers={serverOffers} bookings={bookings as any} userId={user?.id ?? null} quoteCreatedAt={quote?.created_at ?? null}
              marksState={purchaseMarks}
              onSelectVuelo={(i) => setSelVuelo(i)}
              onSelectHotel={(c, i) => (c && isMulti ? setSelHoteles((prev) => withCityHotel(prev, c, i)) : setSelHospedaje(i))}
              onToggleTour={toggleTour}
              // Paso final "Listo · Revisa y compra": el mismo total de la página y volver al Resumen.
              selectionTotal={pageTotal > 0 ? pageTotal : null}
              selectionDesglose={pageTotal > 0 ? computedDesglose : null} estimadosNote={totalSummary.estimadosNote}
              onViewTrip={() => showSection("resumen")}
              // "Enviarme mi selección por correo" (enviar-seleccion): SOLO lo elegido y el total de esta página.
              sendSelectionSlot={
                <div className="w-full">
                  <SendSelectionEmail trip={trip} selVuelo={selVuelo} selHospedaje={selHospedaje} selTours={selTours} selHoteles={selHoteles}
                    travelers={quoteTravelers} nights={nochesEfectivas} desglose={computedDesglose} total={pageTotal}
                    serverOffers={serverOffers} bookings={bookings as any} userId={user?.id ?? null} quoteCreatedAt={quote?.created_at ?? null} />
                </div>
              } />
          ) : (
            <p className="rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground">
              {(trip as any).fuente === "documento" ? "Este viaje viene de tus documentos: ya está pagado." : "Aún no hay cotización para comprar. Revisa el total en Resumen."}
            </p>
          )}
        {/* Selector noches (solo single + hospedaje seleccionado) */}
        {!isMulti && selHospedaje >= 0 && noches > 1 && trip.hospedaje_json?.length > 0 && (
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-medium">¿Cuántas noches en este hospedaje?</p>
                <p className="text-xs text-muted-foreground">Tu viaje son {noches} noches.</p>
              </div>
              <span className="font-display text-2xl gold-text">{nochesEfectivas}<span className="text-sm text-muted-foreground"> / {noches}</span></span>
            </div>
            <input type="range" min={0} max={noches} value={nochesEfectivas} aria-label="Noches en este hospedaje"
              onChange={(e) => setNochesHospedaje(Number(e.target.value))} className="w-full accent-primary" />
          </div>
        )}

        </div>

        {hasRoadTrip && (
          <div role="tabpanel" id="panel-ruta" aria-labelledby="tab-ruta" data-trip-panel="ruta" hidden={section !== "ruta"} className="space-y-6">
        {/* roadtrip: tramos en coche, costos etiquetados, avisos por país y renta del auto. */}
        {isMulti && logistics?.road_trip && (
          <RoadTripPanel plan={logistics.road_trip} tripId={trip.id} returnCity={destinationsMulti[0] ?? null} />
        )}

          </div>
        )}

        <div role="tabpanel" id="panel-destinos" aria-labelledby="tab-destinos" data-trip-panel="destinos" hidden={section !== "destinos"} className="space-y-6">
        {/* Destinos: el itinerario de cada ciudad y cómo llegar por tierra. El vuelo, los hoteles, las
            experiencias y los restaurantes se eligen y compran en "Comprar" (no se repiten aquí). */}
        <div id="trip-destinos" className="space-y-4 scroll-mt-28 focus:outline-none">
          <div className="mb-1 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <RouteIcon className="w-5 h-5 text-primary shrink-0" />
              <h2 className="font-display text-2xl sm:text-3xl break-words">Tu viaje por destino</h2>
            </div>
            <button type="button" onClick={() => showSection("comprar")} className="text-xs text-primary underline-offset-2 hover:underline sm:ml-auto text-left">
              {arrivalByLand(trip) ? "Cómo llegar, hotel y reservas: elígelos en Comprar →" : "Vuelo, hoteles y reservas: elígelos en Comprar →"}
            </button>
          </div>

          {(isMulti ? destinationsMulti : [trip.destino]).map((city: string, cityIdx: number, allCities: string[]) => {
            const cityKey = isMulti ? cityKeyFor(city) : city;
            // Coche, tren, bus y ferry (no son vuelos), del plan guardado; en viajes viejos, los que
            // quedaron mezclados en vuelos_json.
            const cityGround = isMulti ? groundOptionsForCity(trip, cityKey) : (trip.vuelos_json ?? []).filter(isGroundOption);
            const cityDays = isMulti
              ? itinDays.filter((d: any) => d.ciudad === cityKey)
              : itinDays;
            const stay = isMulti ? cityStays(trip).find((st) => st.city === city) ?? null : null;
            return (
              <div key={`${city}-${cityIdx}`}>
              <CityCollapsible
                city={city}
                subtitle={[stay ? `${stay.nights} ${stay.nights === 1 ? "noche" : "noches"}` : null, `${cityDays.length || "·"} días de itinerario`, cityGround.length ? `${cityGround.length} por tierra` : null].filter(Boolean).join(" · ")}
                imageQuery={`${city} skyline landmark travel`}
                open={activeCity === city}
                onToggle={() => toggleCity(city)}
                count={cityDays.length + cityGround.length}
              >
                <div className="space-y-6">
                  {cityGround.length > 0 && (
                    <SubBlock icon={Car} title="Cómo llegar por tierra">
                      <div className="grid min-w-0 md:grid-cols-2 gap-3">
                        {cityGround.map((g: any, gi: number) => (
                          <ArrivalOptionCard key={`tierra-${gi}`} option={g} active={false} quotedAt={quote?.created_at ?? trip.created_at} trip={trip} />
                        ))}
                      </div>
                    </SubBlock>
                  )}

                  {/* Itinerario día por día */}
                  {cityDays.length > 0 && (
                    <SubBlock icon={Calendar} title="Itinerario día por día">
                      <div className="space-y-2">
                        {cityDays.map((d: any) => {
                          return (
                            <details key={d.dia} className="rounded-xl border border-border/60 bg-surface/40 group">
                              <summary
                                className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none hover:bg-surface/60 transition"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <span className="font-display text-xl gold-text w-8 shrink-0">{String(d.dia).padStart(2, "0")}</span>
                                  <span className="font-medium text-sm break-words">{d.titulo}</span>
                                </div>
                                <ChevronDown className="w-4 h-4 shrink-0 text-primary transition-transform group-open:rotate-180" />
                              </summary>
                              <div className="px-4 pb-4 pt-1 border-t border-border/40 space-y-2 text-xs">
                                <div><span className="text-primary tracking-wider uppercase">Mañana</span><p className="mt-0.5 text-muted-foreground">{d["mañana"] ?? d.manana}</p></div>
                                <div><span className="text-primary tracking-wider uppercase">Tarde</span><p className="mt-0.5 text-muted-foreground">{d.tarde}</p></div>
                                <div><span className="text-primary tracking-wider uppercase">Noche</span><p className="mt-0.5 text-muted-foreground">{d.noche}</p></div>
                                {/* Agregado con Iato (acción confirmada por el usuario en el chat). */}
                                {Array.isArray(d.agregados) && d.agregados.length > 0 && (
                                  <div>
                                    <span className="text-primary tracking-wider uppercase">Agregado por ti</span>
                                    <ul className="mt-0.5 space-y-0.5 text-muted-foreground">
                                      {d.agregados.map((a: any, k: number) => (
                                        <li key={k}>{a?.hora ? `${a.hora} · ` : ""}{String(a?.titulo ?? "")}{a?.lugar ? ` — ${a.lugar}` : ""}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                    </SubBlock>
                  )}

                  {cityDays.length === 0 && cityGround.length === 0 && (
                    <p className="text-sm text-muted-foreground">Sin itinerario día por día para esta ciudad.</p>
                  )}
                </div>
              </CityCollapsible>
              {isMulti && cityIdx < allCities.length - 1 && (
                // El ícono es el del tramo que suma el total (tren, coche…), no siempre un avión.
                <FlightConnector from={city} to={allCities[cityIdx + 1]} mode={legOptionsFor(trip, cityKey, cityKeyFor(allCities[cityIdx + 1]))[0]?.mode ?? null} />
              )}
              </div>
            );
          })}
        </div>

        {/* Cruceros alternativos */}
        {Array.isArray(trip.cruceros_json) && trip.cruceros_json.length > 0 && (
          <details className="glass-card rounded-2xl group" open>
            <summary className="flex items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer list-none">
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                <Ship className="w-5 h-5 text-primary shrink-0" />
                <h2 className="font-display text-lg sm:text-xl break-words">¿Y si lo haces en crucero?</h2>
                <span className="text-xs text-muted-foreground">({trip.cruceros_json.length} alternativas reales)</span>
              </div>
              <ChevronDown className="w-5 h-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-border/40 space-y-3">
              <p className="text-xs text-muted-foreground italic">
                Reemplazan parte del itinerario por isla/puerto con un crucero todo-incluido. Precios cotizados por persona.
              </p>
              {trip.cruceros_json.map((c: any, i: number) => {
                const ahorro = Number(c.ahorro_vs_islas_independiente) || 0;
                const dest = encodeURIComponent(c.puerto_salida?.includes("Atenas") || c.puerto_salida?.toLowerCase().includes("pir") ? "Greek Isles" : "Mediterranean");
                const cruceroUrl = `/dashboard/cruceros?dest=${dest}${c.fecha_salida_sugerida ? `&depart=${c.fecha_salida_sugerida}` : ""}&trip=${trip.id}`;
                return (
                  <div key={i} className="rounded-xl border border-border/60 bg-surface/40 p-4 md:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-primary">{c.naviera}{c.barco ? ` · ${c.barco}` : ""}</p>
                        <h3 className="font-display text-lg leading-tight mt-0.5 break-words">{c.nombre_itinerario}</h3>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary border border-primary/30">
                        {c.noches} noches · {c.categoria_cabina}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      <span className="font-medium text-foreground/80">Sale de:</span> {c.puerto_salida}
                      {c.fecha_salida_sugerida && <> · <span className="font-medium text-foreground/80">Fecha:</span> {c.fecha_salida_sugerida}</>}
                    </p>
                    {Array.isArray(c.puertos_visitados) && c.puertos_visitados.length > 0 && (
                      <p className="text-xs mb-2"><span className="text-muted-foreground">Ruta:</span> {c.puertos_visitados.join(" → ")}</p>
                    )}
                    {Array.isArray(c.incluye) && c.incluye.length > 0 && (
                      <p className="text-xs mb-2"><span className="text-muted-foreground">Incluye:</span> {c.incluye.join(", ")}</p>
                    )}
                    <p className="text-sm italic text-foreground/80 mb-3">{c.por_que}</p>
                    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                      <div className="min-w-0">
                        {(() => {
                          const pp = Number(c.precio_por_persona)
                            || (Number(c.precio_total) && viajeros ? Number(c.precio_total) / viajeros : 0);
                          const tot = Number(c.precio_total) || pp * viajeros;
                          return (
                            <>
                              {pp > 0 ? (
                                <>
                                  <p className="font-display text-2xl">{fmtMXN(pp)}</p>
                                  <p className="text-[11px] text-muted-foreground">por persona · total {fmtMXN(tot)}</p>
                                </>
                              ) : (
                                <>
                                  <p className="font-display text-xl text-muted-foreground">Cotización pendiente</p>
                                  <p className="text-[11px] text-muted-foreground">Pídela al concierge</p>
                                </>
                              )}
                            </>
                          );
                        })()}
                        {ahorro !== 0 && (
                          <p className={`text-xs mt-1 ${ahorro > 0 ? "text-emerald-400" : "text-amber-400"}`}>
                            {ahorro > 0 ? "Ahorras ≈ " : "Cuesta ≈ "}{fmtMXN(Math.abs(ahorro))} vs island-hop independiente
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => navigate(cruceroUrl)}
                        className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 sm:w-auto"
                      >
                        Ver y reservar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}

        {/* Tips */}
        {trip.tips_personalizados?.length > 0 && (
          <details className="glass-card rounded-2xl group">
            <summary className="flex items-center justify-between gap-3 p-4 sm:p-5 cursor-pointer list-none">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <Lightbulb className="w-5 h-5 text-primary shrink-0" />
                <h2 className="font-display text-lg sm:text-xl break-words">Tips de tu concierge</h2>
                <span className="text-xs text-muted-foreground">({trip.tips_personalizados.length})</span>
              </div>
              <ChevronDown className="w-5 h-5 shrink-0 text-primary transition-transform group-open:rotate-180" />
            </summary>
            <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-border/40 space-y-3">
              {trip.tips_personalizados.map((t: string, i: number) => (
                <div key={i} className="flex gap-3">
                  <span className="font-display gold-text text-lg flex-shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <p className="text-sm text-foreground/90 leading-relaxed">{t}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        </div>

        <div role="tabpanel" id="panel-documentos" aria-labelledby="tab-documentos" data-trip-panel="documentos" hidden={section !== "documentos"} className="space-y-6">
        {/* Documentos del viaje: boletos, pasaporte, pólizas (bucket privado trip-documents). */}
        <TripBookingIntents tripId={trip.id} />
        <TripDocuments tripId={trip.id} ownerId={trip.user_id} />

        </div>
      </div>
      {/* Acción principal al alcance del pulgar en móvil, encima de la barra de navegación. */}
      <TripNextStep trip={tripForNextStep} quote={quote} isOwner={isOwner} variant="bar" totalLabel={stickyTotal} totalNote={stickyTotal ? totalSummary.barNote : null} />
    </DashboardLayout>
  );
};

// Sub-bloque dentro de un destino: header pequeño + contenido
const SubBlock = ({ icon: Icon, title, children }: any) => (
  <div>
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-4 h-4 text-primary" />
      <h3 className="font-display text-lg">{title}</h3>
    </div>
    {children}
  </div>
);

// Elegante conector entre destinos (multi-ciudad), con el ícono del modo del tramo (sin dato: una ruta).
const FlightConnector = ({ from, to, mode }: { from: string; to: string; mode?: string | null }) => {
  const LegIcon = (mode && MODE_ICON[mode]) || RouteIcon;
  return (
  <div className="relative my-5 md:my-7 select-none" aria-hidden="true" data-testid="leg-connector" data-mode={mode ?? ""}>
    <div className="flex items-center gap-4 px-2">
      <span className="hidden sm:inline text-[10px] tracking-[0.3em] uppercase text-muted-foreground whitespace-nowrap">
        {from}
      </span>
      <div className="relative flex-1 h-px">
        {/* línea base sutil */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        {/* línea punteada dorada */}
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(var(--primary) / 0.5) 50%, transparent 0%)",
            backgroundSize: "8px 1px",
            backgroundRepeat: "repeat-x",
          }}
        />
        {/* avión deslizándose */}
        <motion.div
          className="absolute top-1/2 -translate-y-1/2"
          initial={{ left: "0%" }}
          animate={{ left: ["0%", "100%"] }}
          transition={{ duration: 6, ease: "easeInOut", repeat: Infinity, repeatDelay: 1.5 }}
        >
          <div className="-translate-x-1/2 relative">
            {/* glow */}
            <div className="absolute inset-0 blur-md bg-primary/40 rounded-full" />
            <LegIcon className={`relative w-4 h-4 text-primary ${LegIcon === Plane ? "rotate-90" : ""} drop-shadow-[0_0_6px_hsl(var(--primary)/0.7)]`} />
          </div>
        </motion.div>
      </div>
      <span className="hidden sm:inline text-[10px] tracking-[0.3em] uppercase text-primary whitespace-nowrap">
        {to}
      </span>
    </div>
  </div>
  );
};


const MODE_ICON: Record<string, any> = {
  vuelo: Plane,
  tren: Train,
  roadtrip: Car,
  coche: Car,
  auto: Car,
  autobus: Bus,
  bus: Bus,
  ferry: Ship,
  vuelo_interno: Plane,
  taxi: CarTaxiFront,
  traslado: Car,
  otro: RouteIcon,
};

const MODE_LABEL: Record<string, string> = {
  vuelo: "Vuelo",
  tren: "Tren",
  roadtrip: "Road trip",
  coche: "En coche",
  auto: "En coche",
  autobus: "Autobús",
  bus: "Bus",
  ferry: "Ferry",
  vuelo_interno: "Vuelo interno",
  taxi: "Taxi",
  traslado: "Traslado",
  otro: "Transporte",
};

// Trayectos cortos (N-06): opciones por carretera, siempre estimadas y con rango de precio.
const isGroundOption = (v: any) => v?.modo === "autobus" || v?.modo === "auto";
const ArrivalOptionCard = ({ option, active, onClick, quotedAt, trip, index = 0 }: { option: any; active: boolean; onClick?: () => void; quotedAt?: string | null; trip?: any; index?: number }) => {
  // Coche, tren, bus o ferry con su icono (antes un coche salía con avión: MODE_ICON no tenía "coche").
  // El modo llega en texto libre ("Tren de alta velocidad", "Taxi oficial / Traslado privado"): se
  // normaliza; un taxi o un tren nunca se pinta con avión (caso España multidestino, 23-oct-2026).
  const mode = transportModeOf(option.modo) ?? transportModeOf(option.mode) ?? "vuelo";
  const Icon = MODE_ICON[mode] || (isGroundTripOption(option) ? RouteIcon : Plane);
  const modeLabel = MODE_LABEL[mode] || "Transporte";
  const airline = flightAirlineLabel(option);
  return (
    <div
      onClick={onClick}
      data-testid="arrival-option"
      data-mode={mode}
      className={`relative rounded-xl p-5 transition border ${onClick ? "cursor-pointer" : ""} ${
        active ? "border-primary ring-1 ring-primary/40 bg-primary/5" : "border-border/60 bg-surface/40 hover:border-primary/50"
      }`}
    >
      {active && (
        <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
          <Check className="w-3.5 h-3.5" />
        </div>
      )}
      <div className="flex items-center gap-3 mb-3">
        {!isGroundTripOption(option) && !flightIsEstimate(option) && airlineCode(option.aerolinea) ? (
          // Vuelo con aerolínea conocida (tarifa real): su logo real (CDN de Travelpayouts) en ficha blanca.
          <AirlineLogo airline={option.aerolinea} size={32} />
        ) : (
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
            <Icon className="w-4 h-4 text-primary" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[10px] tracking-[0.2em] uppercase text-primary">{modeLabel}{option.tier ? ` · ${option.tier}` : ""}</p>
          <p className="font-medium text-sm">{airline}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs mb-2">
        {option.from && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            {option.from} <ArrowRight className="w-3 h-3" /> {option.to || option.ciudad}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        {flightDurationLabel(option) && <span className="px-2 py-0.5 rounded-full bg-background border border-border">{flightDurationLabel(option)}</span>}
        {flightStopsLabel(option) && <span className="px-2 py-0.5 rounded-full bg-background border border-border">{flightStopsLabel(option)}</span>}
      </div>
      {/* Coche y autobús de un trayecto corto: casetas reales, gasolina estimada o "precio en ADO"; nunca el precio de la IA. */}
      {trip && (isCarOption(option) || isBusOption(option) || isHiredCarOption(option)) ? <GroundOptionInfo trip={trip} option={option} /> : option.precio_por_persona > 0 && (
        <p className="font-medium text-base">
          {fmtMXN(option.precio_por_persona)}
          <span className="text-xs text-muted-foreground ml-1">/ persona</span>
        </p>
      )}
      {!(trip && (isCarOption(option) || isBusOption(option) || isHiredCarOption(option))) && <PriceSourceBadge source={option.fuente_precio} estado={option.estado_dato} consultadoAt={option.consultado_at ?? quotedAt} approximateDates={option.approximate_dates} className="mt-2" />}
      {flightLiveLine(option) && <p className="mt-1 text-[11px] text-muted-foreground" data-testid="arrival-en-vivo">{flightLiveLine(option)}</p>}
      {option.aeropuerto_nota && <p className="mt-1 text-[11px] text-muted-foreground" data-testid="arrival-aeropuerto-nota">{option.aeropuerto_nota}.</p>}
      {/* El tramo que suma el total (el mismo de Comprar) y las alternativas del plan, que no suman. */}
      {option.quoted && <p className="mt-2 text-[11px] text-primary" data-testid="arrival-quoted">Opción principal · suma al total (la misma de Comprar)</p>}
      {option.alternativa && <p className="mt-2 text-[11px] text-muted-foreground" data-testid="arrival-alternativa">Alternativa del plan · no suma al total</p>}
      {option.notas && !(trip && (isCarOption(option) || isBusOption(option) || isHiredCarOption(option))) && <p className="text-xs text-muted-foreground mt-2 italic">{option.notas}</p>}
      {/* Comprar aquí mismo (punto 8): vuelo → Google Flights/Kayak precargados; coche → road trip y renta. */}
      {trip && <FlightBuyButtons option={option} trip={trip} index={index} />}
    </div>
  );
};

export default TripDetail;
