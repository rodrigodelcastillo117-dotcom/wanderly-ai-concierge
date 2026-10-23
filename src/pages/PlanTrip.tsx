import { useState, useEffect, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { ArrowLeft, ArrowRight, MapPin, Calendar, Users, Wallet, Sparkles, Route as RouteIcon, Heart, Mountain, Palmtree, Star, Utensils, PartyPopper, MoreHorizontal, Flower2, Lock, Car } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { BudgetField, nightsBetween } from "@/components/BudgetField";
import { useAuth } from "@/contexts/AuthContext";
import { track } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastFunctionError } from "@/lib/functionErrors";
import { clearRequestKey, getRequestKey } from "@/lib/requestKey";
import { DashboardLayout } from "@/components/DashboardLayout";
import { detectRouteIntent } from "@/lib/detectRouteIntent";
import { parseTripFallback } from "@/lib/parseTripFallback";
import { AnalysisProgress } from "@/components/AnalysisProgress";
import { OriginPicker } from "@/components/OriginPicker";
import { TripBuildPreview } from "@/components/TripBuildPreview";
import { VoiceInput } from "@/components/VoiceInput";
import { claimIntent, completeIntent, intentFingerprint, releaseIntent } from "@/lib/autoIntent";
import { analysisSummaryOf, datePresets, EXAMPLE_PROMPTS, looksLikeSentence, understandPlanText } from "@/lib/planDefaults";
import { formatLocalDate } from "@/lib/localDate";
import { fetchFriendProfiles } from "@/lib/friendProfiles";
// roadtrip: "road trip por la Toscana" va a la ruta de varios destinos con el coche elegido.
import { detectRoadTrip, routePlannerPath } from "@/lib/roadtrip";
import { RoadTripIdeas } from "@/components/roadtrip/RoadTripIdeas";

const EMOCIONES: Array<{ key: string; label: string; sub: string; Icon: any }> = [
  { key: "Inspiración",  label: "Inspiración",  sub: "Quiero descubrir\nalgo nuevo",        Icon: Heart },
  { key: "Conexión",     label: "Conexión",     sub: "Quiero reconectar\nconmigo",          Icon: Flower2 },
  { key: "Aventura",     label: "Aventura",     sub: "Quiero adrenalina\ny explorar",       Icon: Mountain },
  { key: "Descanso",     label: "Descanso",     sub: "Quiero relajarme\ny desconectar",     Icon: Palmtree },
  { key: "Cultura",      label: "Cultura",      sub: "Quiero conocer\ny aprender",          Icon: Star },
  { key: "Gastronomía",  label: "Gastronomía",  sub: "Quiero vivir nuevos\nsabores",        Icon: Utensils },
  { key: "Celebración",  label: "Celebración",  sub: "Quiero celebrar algo\nespecial",      Icon: PartyPopper },
  { key: "Otro",         label: "Otro",         sub: "Tengo otra emoción\nen mente",        Icon: MoreHorizontal },
];



type AnalisisArgs = {
  destino: string;
  ciudad_origen: string;
  fecha_salida: string;
  fecha_regreso: string;
  num_viajeros: number;
  presupuesto_objetivo?: number | null;
  notas_usuario?: string | null;
};

type Interpretacion = { kind: "ruta"; qs: string } | { kind: "analisis"; args: AnalisisArgs };

// Una sola interpretación (parsear-viaje, de pago) por frase aunque la página se monte dos veces.
const pendingInterpretations = new Map<string, Promise<Interpretacion>>();

async function interpretarFrase(q: string, userId: string): Promise<Interpretacion> {
  // Trae ciudad_origen del perfil para fallback
  const { data: prof } = await supabase
    .from("profiles")
    .select("ciudad_origen")
    .eq("id", userId)
    .maybeSingle();

  const hoy = new Date();
  const defaultSalida = new Date(hoy.getTime() + 30 * 86400000).toISOString().slice(0, 10);
  const defaultRegreso = new Date(hoy.getTime() + 37 * 86400000).toISOString().slice(0, 10);

  // roadtrip: road trip por una región curada → ruta en coche con sus paradas (sin IA ni costo).
  const rt = detectRoadTrip(q);
  if (rt.isRoadTrip && rt.route) {
    const qs = new URLSearchParams(routePlannerPath(rt.route, rt.days).split("?")[1]);
    qs.set("origin", prof?.ciudad_origen || "Ciudad de México");
    qs.set("viajeros", "2");
    return { kind: "ruta", qs: qs.toString() };
  }

  // Detección rápida cliente — si parece multi, vamos directo al builder de ruta.
  const fastIntent = detectRouteIntent(q);
  if (fastIntent.mode === "multi" && fastIntent.destinations.length >= 2) {
    const qs = new URLSearchParams({
      origin: prof?.ciudad_origen || "Ciudad de México",
      destinos: fastIntent.destinations.join("|"),
      fecha_salida: defaultSalida,
      fecha_regreso: defaultRegreso,
      viajeros: "2",
      auto: "1",
    });
    return { kind: "ruta", qs: qs.toString() };
  }

  const { data, error } = await supabase.functions.invoke("parsear-viaje", {
    body: { prompt: q },
  });
  if (error) throw error;

  const origen = data?.ciudad_origen || prof?.ciudad_origen || "Ciudad de México";

  // Si la IA detectó multi-destino (>=2 ciudades reales), redirigir al builder de ruta.
  const aiDestinations: string[] = Array.isArray(data?.destinations) ? data.destinations.filter(Boolean) : [];
  if (data?.is_multi && aiDestinations.length >= 2) {
    const qs = new URLSearchParams({
      origin: origen,
      destinos: aiDestinations.join("|"),
      fecha_salida: data?.fecha_salida || defaultSalida,
      fecha_regreso: data?.fecha_regreso || defaultRegreso,
      viajeros: String(Number(data?.num_viajeros) || 2),
      auto: "1",
    });
    if (data?.presupuesto_objetivo) qs.set("presupuesto", String(data.presupuesto_objetivo));
    return { kind: "ruta", qs: qs.toString() };
  }

  return {
    kind: "analisis",
    args: {
      destino: data?.destino || q.slice(0, 60),
      ciudad_origen: origen,
      fecha_salida: data?.fecha_salida || defaultSalida,
      fecha_regreso: data?.fecha_regreso || defaultRegreso,
      num_viajeros: Number(data?.num_viajeros) || 2,
      presupuesto_objetivo: data?.presupuesto_objetivo ?? null,
      notas_usuario: q,
    },
  };
}

/** "Oaxaca · 12 dic – 16 dic · 2 personas" (solo lo que se entendió). */
function describeUnderstood(u: { destino: string | null; fechaSalida: string | null; fechaRegreso: string | null; viajeros: number | null }): string {
  const parts = [u.destino ?? ""];
  if (u.fechaSalida && u.fechaRegreso) {
    parts.push(`${formatLocalDate(u.fechaSalida, { day: "numeric", month: "short" })} – ${formatLocalDate(u.fechaRegreso, { day: "numeric", month: "short" })}`);
  }
  if (u.viajeros) parts.push(`${u.viajeros} ${u.viajeros === 1 ? "persona" : "personas"}`);
  return parts.filter(Boolean).join(" · ");
}

const PlanTrip = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [step, setStep] = useState(0);
  const mode = params.get("mode"); // "emocion" => IATOS elige destino
  const isEmocionMode = mode === "emocion";
  const [destino, setDestino] = useState(params.get("destino") ?? "");
  const [ciudadOrigen, setCiudadOrigen] = useState("");
  const [fechaSalida, setFechaSalida] = useState("");
  const [fechaRegreso, setFechaRegreso] = useState("");
  const [numViajeros, setNumViajeros] = useState(2);
  const [grupoPreset, setGrupoPreset] = useState<"solo" | "pareja" | "amigos" | "familia" | "custom">("pareja");
  const [presupuesto, setPresupuesto] = useState<number | null>(null);
  const [budgetMode, setBudgetMode] = useState<"flexible" | "balanceado" | "premium" | "luxury">("balanceado");
  const [surpriseDates, setSurpriseDates] = useState(false);
  const [surpriseDestino, setSurpriseDestino] = useState(true);
  const [destinoEmocion, setDestinoEmocion] = useState("");
  const [emociones, setEmociones] = useState<string[]>([]);
  const [emocionLibre, setEmocionLibre] = useState("");
  const [analizando, setAnalizando] = useState(false);
  const [interpretando, setInterpretando] = useState(false);
  const [eligiendoDestino, setEligiendoDestino] = useState(false);
  const reduceMotion = usePrefersReducedMotion();
  // Ya se leyó el perfil (con o sin ciudad de origen): sin esto, una tarjeta de destino con
  // ?autoCheapest=1 se quedaba esperando una ciudad que nunca llegaba y no decía nada.
  const [profileLoaded, setProfileLoaded] = useState(false);
  // Aviso en el paso de fechas: qué entendimos de la frase o por qué falta un dato.
  const [stepNotice, setStepNotice] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  // "Planear juntos" desde el perfil de un amigo (?con=<id>): al guardarse el viaje se le invita
  // con invitar_amigo_viaje (el servidor vuelve a comprobar la amistad).
  const conParam = params.get("con");
  const [showRoadTrips, setShowRoadTrips] = useState(false);
  const [companion, setCompanion] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!user || !conParam || !/^[0-9a-f-]{36}$/i.test(conParam)) { setCompanion(null); return; }
    let alive = true;
    void fetchFriendProfiles(supabase, [conParam]).then((p) => {
      if (!alive || !p[0]) return;
      setCompanion({ id: p[0].id, name: (p[0].full_name || p[0].username || "tu amigo").split(/\s+/)[0] });
    });
    return () => { alive = false; };
  }, [user?.id, conParam]);
  const companionRef = useRef<{ id: string; name: string } | null>(null);
  companionRef.current = companion;

  useEffect(() => {
    if (!user) return;
    Promise.resolve(
      supabase
        .from("profiles")
        .select("ciudad_origen")
        .eq("id", user.id)
        .maybeSingle(),
    )
      .then(({ data }) => {
        if (data?.ciudad_origen) setCiudadOrigen(data.ciudad_origen);
      })
      .catch(() => {})
      .finally(() => setProfileLoaded(true));
  }, [user?.id]);

  // Quita de la URL las intenciones de un solo uso (?q, ?autoCheapest) en cuanto se
  // consumen. Así "Atrás" desde el viaje generado no vuelve a disparar el análisis.
  const consumeUrlIntent = () => {
    const next = new URLSearchParams(params);
    next.delete("q");
    next.delete("autoCheapest");
    setParams(next, { replace: true });
  };

  // Si la intención ya se procesó en esta pestaña, no repetimos el análisis.
  const handlePriorIntent = (claim: ReturnType<typeof claimIntent>): boolean => {
    if (claim.status === "done") {
      navigate(`/dashboard/viajes/${claim.tripId}`, { replace: true });
      return true;
    }
    if (claim.status === "in_flight") {
      toast.info("Tu análisis anterior sigue en proceso. Lo verás en Mis viajes en cuanto termine.");
      return true;
    }
    return false;
  };

  // Auto-cheapest: si llega ?destino=X&autoCheapest=1, prellena fechas heurísticas
  // (martes a martes, ~60 días fuera — ventana históricamente más barata) y dispara análisis.
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (params.get("autoCheapest") !== "1") return;
    if (!destino) return;
    if (!ciudadOrigen) {
      if (!profileLoaded) return;
      // Sin ciudad de salida no se puede cotizar: en vez de no hacer nada, se lleva al paso de
      // fechas con el destino puesto y se dice qué falta.
      autoFiredRef.current = true;
      consumeUrlIntent();
      setStep(1);
      setStepNotice(`Para cotizar ${destino} necesitamos tu ciudad de salida. Elígela y revisa las fechas.`);
      return;
    }
    autoFiredRef.current = true;
    const fp = intentFingerprint("cheap", destino);
    consumeUrlIntent();
    if (handlePriorIntent(claimIntent(fp))) return;

    // Próximo martes ~60 días a futuro (martes/miércoles suelen ser los más baratos)
    const out = new Date();
    out.setDate(out.getDate() + 60);
    while (out.getDay() !== 2) out.setDate(out.getDate() + 1);
    const ret = new Date(out);
    ret.setDate(ret.getDate() + 7);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const fs = fmt(out);
    const fr = fmt(ret);
    setFechaSalida(fs);
    setFechaRegreso(fr);
    runAnalisis({
      destino,
      ciudad_origen: ciudadOrigen,
      fecha_salida: fs,
      fecha_regreso: fr,
      num_viajeros: 2,
      presupuesto_objetivo: null,
    }, fp);
  }, [destino, ciudadOrigen, params, profileLoaded]);




  // Evita dobles envíos (doble clic, efecto que se repite) mientras hay un análisis en curso.
  const inFlightRef = useRef(false);

  const runAnalisis = async (args: AnalisisArgs, intentFp?: string): Promise<boolean> => {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    let ok = false;
    setDestino(args.destino);
    setAnalysisSummary(analysisSummaryOf(args));
    setAnalizando(true);
    try {
      // Misma llave al reintentar o recargar: si el viaje ya se guardó, no se cobra otro análisis.
      const request_key = getRequestKey("analizar-viaje", args);
      const { data, error } = await supabase.functions.invoke("analizar-viaje", { body: { ...args, request_key } });
      if (error) throw error;
      if (!data?.trip?.id) throw new Error("Sin resultado");
      track("trip_quoted", {
        destino: args.destino,
        viajeros: args.num_viajeros,
        total_estimado: data.trip.total_estimado ?? null,
      });
      // El análisis terminó y quedó guardado: el siguiente es otro intento (llave nueva).
      clearRequestKey("analizar-viaje");
      if (intentFp) completeIntent(intentFp, data.trip.id);
      const amigo = companionRef.current;
      if (amigo) {
        try {
          const { data: inv } = await supabase.rpc("invitar_amigo_viaje", { p_trip_id: data.trip.id, p_friend_id: amigo.id });
          if ((inv as { ok?: boolean } | null)?.ok) {
            toast.success(`Invitamos a ${amigo.name} a este viaje`);
            supabase.functions.invoke("send-email", { body: { trip_id: data.trip.id, friend_id: amigo.id } }).catch(() => {});
          }
        } catch { /* la invitación se puede mandar después desde "Compartir" */ }
      }
      // replace: el viaje sustituye a la pantalla del asistente en el historial,
      // así "Atrás" regresa a donde estabas antes de planear (no re-analiza).
      navigate(`/dashboard/viajes/${data.trip.id}`, { replace: true });
      ok = true;
    } catch (e: any) {
      console.error(e);
      // Límite del plan → diálogo con "Conocer IATOS PRO"; fallo técnico → "intenta de nuevo".
      await toastFunctionError(e, "No pudimos generar el análisis. Intenta de nuevo.");
      setAnalizando(false);
    } finally {
      inFlightRef.current = false;
      // Si falló, liberamos la intención para que el usuario pueda reintentar.
      if (!ok && intentFp) releaseIntent(intentFp);
    }
    return ok;
  };

  const analizar = () => {
    if (!destino || !fechaSalida || !fechaRegreso || !ciudadOrigen) return;

    // roadtrip: road trip por una región curada → ruta en coche con sus paradas y estas fechas.
    const rt = detectRoadTrip(destino);
    if (rt.isRoadTrip && rt.route) {
      const qs = new URLSearchParams(routePlannerPath(rt.route, rt.days).split("?")[1]);
      qs.set("origin", ciudadOrigen);
      qs.set("fecha_salida", fechaSalida);
      qs.set("fecha_regreso", fechaRegreso);
      qs.set("viajeros", String(numViajeros));
      if (presupuesto != null) qs.set("presupuesto", String(presupuesto));
      navigate(`/dashboard/ruta?${qs.toString()}`);
      return;
    }

    // Detección single vs multi al confirmar.
    const intent = detectRouteIntent(destino);
    if (intent.mode === "multi" && intent.destinations.length >= 2) {
      const qs = new URLSearchParams({
        origin: ciudadOrigen,
        destinos: intent.destinations.join("|"),
        fecha_salida: fechaSalida,
        fecha_regreso: fechaRegreso,
        viajeros: String(numViajeros),
        auto: "1",
      });
      if (presupuesto != null) qs.set("presupuesto", String(presupuesto));
      navigate(`/dashboard/ruta?${qs.toString()}`);
      return;
    }

    return runAnalisis({
      destino,
      ciudad_origen: ciudadOrigen,
      fecha_salida: fechaSalida,
      fecha_regreso: fechaRegreso,
      num_viajeros: numViajeros,
      presupuesto_objetivo: presupuesto,
    });
  };

  // Modo emoción: IATOS elige el destino según la emoción + parámetros
  const elegirDestinoYAnalizar = async () => {
    if (!ciudadOrigen) {
      toast.error("Necesitamos tu ciudad de origen.");
      return;
    }
    const emocionList = [...emociones, emocionLibre.trim()].filter(Boolean);
    if (emocionList.length === 0) {
      toast.error("Elige al menos una emoción para tu viaje.");
      return;
    }
    const usarFechas = !surpriseDates && fechaSalida && fechaRegreso;
    const dias = usarFechas
      ? Math.max(1, Math.round((new Date(fechaRegreso).getTime() - new Date(fechaSalida).getTime()) / 86400000))
      : null;

    // Si el usuario ya eligió un destino concreto, saltar la elección de IATOS.
    if (!surpriseDestino && destinoEmocion.trim().length > 1) {
      await runAnalisis({
        destino: destinoEmocion.trim(),
        ciudad_origen: ciudadOrigen,
        fecha_salida: usarFechas ? fechaSalida : (null as any),
        fecha_regreso: usarFechas ? fechaRegreso : (null as any),
        num_viajeros: numViajeros,
        presupuesto_objetivo: presupuesto,
        notas_usuario: `Emociones: ${emocionList.join(", ")}. Estilo presupuesto: ${budgetMode}.`,
      });
      return;
    }

    setEligiendoDestino(true);
    try {
      const budgetGuide: Record<typeof budgetMode, string> = {
        flexible: `PRESUPUESTO ECONÓMICO (~15,000 MXN total para ${numViajeros} persona(s)). OBLIGATORIO: elige un destino NACIONAL en México o un país vecino muy cercano (máx 4h de vuelo o destino terrestre/autobús/road-trip). PROHIBIDO destinos en Europa, Asia, Oceanía, África o Sudamérica lejana. Ejemplos válidos: Oaxaca, Mérida, San Cristóbal, Puerto Escondido, Bacalar, Guanajuato, La Paz, Holbox, Antigua Guatemala, La Habana.`,
        balanceado: `PRESUPUESTO BALANCEADO (~35,000 MXN total para ${numViajeros} persona(s)). Destinos nacionales premium o internacionales cercanos (Caribe, Centroamérica, sur de EEUU, Colombia, Perú). NO Europa ni Asia.`,
        premium: `PRESUPUESTO PREMIUM (~80,000 MXN total para ${numViajeros} persona(s)). Internacional medio alcance OK (EEUU, Canadá, Sudamérica, Caribe lujo, Europa básico si alcanza).`,
        luxury: `PRESUPUESTO LUXURY (~180,000 MXN total para ${numViajeros} persona(s)). Cualquier destino mundial.`,
      };
      const presupuestoTxt =
        presupuesto != null && budgetMode !== "flexible"
          ? `Presupuesto total objetivo: ${presupuesto} MXN. ${budgetGuide[budgetMode]}`
          : budgetGuide[budgetMode];
      const prompt = `Quiero que elijas el MEJOR destino para mí (UNA sola ciudad o región concreta, no varias opciones).
Emociones / estilo que busco: ${emocionList.join(", ")}.
Viajamos ${numViajeros} persona(s) desde ${ciudadOrigen}.
${usarFechas ? `Fechas: del ${fechaSalida} al ${fechaRegreso} (${dias} días).` : `Fechas flexibles — elige tú la mejor temporada para esa emoción y destino.`}
${presupuestoTxt}
REGLA CRÍTICA: el destino DEBE ser realista para el presupuesto y la distancia desde ${ciudadOrigen}. NO sugieras destinos exóticos lejanos si el presupuesto no alcanza el vuelo round-trip + hospedaje.
Devuelve el destino ideal en el campo "destino" y "destinations" con esa única ciudad.`;

      const { data, error } = await supabase.functions.invoke("parsear-viaje", { body: { prompt } });
      if (error) throw error;
      const destinoElegido: string = data?.destino || (Array.isArray(data?.destinations) ? data.destinations[0] : "") || "";
      if (!destinoElegido) throw new Error("IATOS no pudo elegir un destino.");
      setEligiendoDestino(false);
      await runAnalisis({
        destino: destinoElegido,
        ciudad_origen: ciudadOrigen,
        fecha_salida: usarFechas ? fechaSalida : (null as any),
        fecha_regreso: usarFechas ? fechaRegreso : (null as any),
        num_viajeros: numViajeros,
        presupuesto_objetivo: presupuesto,
        notas_usuario: `Emociones: ${emocionList.join(", ")}. Estilo presupuesto: ${budgetMode}.`,
      });
    } catch (e: any) {
      console.error(e);
      // Mensaje humano: el texto técnico del error (red, servidor) no se muestra.
      await toastFunctionError(e, "No pudimos elegir un destino. Intenta de nuevo o escribe uno tú.");
      setEligiendoDestino(false);
    }
  };



  // Flujo de búsqueda en lenguaje natural: ?q=... viene del Inicio.
  //
  // Por qué así (N-08/N-09): el efecto puede correr dos veces (StrictMode) o la página puede
  // desmontarse y volver a montarse mientras se interpreta (la guardia de rutas parpadea al
  // cargar el onboarding). Antes, el primer montaje reclamaba la intención y limpiaba la URL, y al
  // cancelarse soltaba el resultado: el segundo montaje ya no veía ?q (o la veía "en curso") y el
  // usuario se quedaba con el formulario vacío, sin aviso y sin su frase. Ahora la interpretación
  // es una sola promesa por frase (módulo) que cualquier montaje retoma, y la URL se limpia hasta
  // que un montaje vivo toma el resultado.
  useEffect(() => {
    const q = params.get("q");
    if (!q || !user) return;
    const fp = intentFingerprint("q", q);
    let pending = pendingInterpretations.get(fp);
    if (!pending) {
      const claim = claimIntent(fp);
      if (claim.status !== "claimed") {
        consumeUrlIntent();
        handlePriorIntent(claim);
        return;
      }
      pending = interpretarFrase(q, user.id);
      pendingInterpretations.set(fp, pending);
    }
    let cancelled = false;
    setInterpretando(true);
    (async () => {
      try {
        const r = await pending;
        // Otro montaje (el que sigue vivo) retoma la misma promesa: aquí no se suelta nada.
        if (cancelled) return;
        pendingInterpretations.delete(fp);
        consumeUrlIntent();

        if (r.kind === "ruta") {
          releaseIntent(fp);
          navigate(`/dashboard/ruta?${r.qs}`, { replace: true });
          return;
        }

        setInterpretando(false);
        const args = r.args;
        const ok = await runAnalisis(args, fp);
        if (!ok) {
          // Sin análisis (límite del plan o falla): la frase se queda en el campo y lo ya
          // interpretado queda prellenado para editarlo o planear a mano.
          setDestino(q);
          setCiudadOrigen((prev) => prev || args.ciudad_origen);
          setFechaSalida(args.fecha_salida);
          setFechaRegreso(args.fecha_regreso);
          setNumViajeros(args.num_viajeros);
          if (args.presupuesto_objetivo != null) setPresupuesto(args.presupuesto_objetivo);
        }
      } catch (e: any) {
        if (cancelled) return;
        pendingInterpretations.delete(fp);
        releaseIntent(fp);
        consumeUrlIntent();
        console.error(e);
        // Sin IA: rescatar lo que se pueda de la frase para no perderla.
        const fb = parseTripFallback(q);
        setDestino(fb.destino || q);
        if (fb.fechaSalida) setFechaSalida(fb.fechaSalida);
        if (fb.fechaRegreso) setFechaRegreso(fb.fechaRegreso);
        if (fb.viajeros) setNumViajeros(fb.viajeros);
        toast.error(
          fb.destino
            ? "No pudimos interpretar todo tu mensaje. Revisa los datos que llenamos y continúa."
            : "No pudimos interpretar tu solicitud. Llena el formulario.",
        );
        setInterpretando(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Depende del id (no del objeto user, que cambia en cada refresh de token).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);


  if (interpretando) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <motion.div
            role="status"
            aria-label="Interpretando tu viaje"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            className="w-14 h-14 rounded-full border-2 border-primary/30 border-t-primary mb-8"
          />
          <h2 className="font-display text-3xl md:text-4xl mb-3">Interpretando tu viaje</h2>
          <p className="text-muted-foreground max-w-md">
            Leyendo tu descripción, identificando destino, fechas y viajeros…
          </p>
        </div>
      </DashboardLayout>
    );
  }

  if (eligiendoDestino) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <motion.div
            animate={reduceMotion ? undefined : { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 2.2, repeat: Infinity }}
            className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow"
          >
            <Heart className="w-7 h-7 text-primary-foreground" />
          </motion.div>
          <h2 className="font-display text-3xl md:text-5xl mb-3">
            IATOS AI está eligiendo tu <span className="gold-text italic">próximo destino</span>
          </h2>
          <p className="text-muted-foreground max-w-md">
            Cruzando tus emociones, fechas, viajeros y presupuesto con tu ADN de viaje…
          </p>
        </div>
      </DashboardLayout>
    );
  }





  if (analizando) {
    return (
      <DashboardLayout>
        <AnalysisProgress destino={destino} summary={analysisSummary} />
      </DashboardLayout>
    );
  }

  const toggleEmocion = (e: string) =>
    setEmociones((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));

  const GRUPOS: Array<{ id: typeof grupoPreset; label: string; n: number }> = [
    { id: "solo", label: "Solo", n: 1 },
    { id: "pareja", label: "Pareja", n: 2 },
    { id: "amigos", label: "Amigos", n: 4 },
    { id: "familia", label: "Familia", n: 4 },
    { id: "custom", label: "Otro", n: numViajeros },
  ];

  const BUDGETS: Array<{ id: typeof budgetMode; label: string; hint: string; value: number | null }> = [
    { id: "flexible", label: "Económico", hint: "Destinos cercanos, gran valor", value: 15000 },
    { id: "balanceado", label: "Balanceado", hint: "Confort sin excesos", value: 35000 },
    { id: "premium", label: "Premium", hint: "Experiencias selectas", value: 80000 },
    { id: "luxury", label: "Luxury", hint: "Sin compromiso", value: 180000 },
  ];

  const pickGrupo = (g: typeof grupoPreset) => {
    setGrupoPreset(g);
    const found = GRUPOS.find((x) => x.id === g);
    if (g !== "custom" && found) setNumViajeros(found.n);
  };

  const pickBudget = (b: typeof budgetMode) => {
    setBudgetMode(b);
    const found = BUDGETS.find((x) => x.id === b);
    setPresupuesto(found ? found.value : null);
  };

  const firstStep = isEmocionMode
    ? {
        icon: Heart,
        title: "¿Cuál es tu emoción del viaje?",
        sub: "Elige una o varias. IATOS AI las mezcla con tu ADN y diseña el viaje perfecto.",
        canNext: () =>
          (emociones.length > 0 || emocionLibre.trim().length > 2) &&
          !!ciudadOrigen &&
          (surpriseDestino || destinoEmocion.trim().length > 1) &&
          (surpriseDates || (!!fechaSalida && !!fechaRegreso && fechaRegreso > fechaSalida)),
        render: () => (
          <div className="space-y-10">
            {/* EMOCIÓN — grilla de tarjetas con íconos */}
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {EMOCIONES.map((e) => {
                  const active = emociones.includes(e.key);
                  const Icon = e.Icon;
                  return (
                    <button
                      key={e.key}
                      type="button"
                      onClick={() => toggleEmocion(e.key)}
                      className={`group relative flex flex-col items-center justify-center text-center px-3 py-6 rounded-2xl border transition aspect-square ${
                        active
                          ? "bg-primary/10 border-primary text-foreground gold-glow"
                          : "bg-surface/60 border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                      }`}
                    >
                      <Icon className={`w-7 h-7 mb-3 transition ${active ? "text-primary" : "text-muted-foreground group-hover:text-primary/80"}`} strokeWidth={1.4} />
                      <span className={`font-display text-base leading-tight mb-1 ${active ? "text-foreground" : ""}`}>{e.label}</span>
                      <span className="text-[11px] leading-snug opacity-70 whitespace-pre-line">{e.sub}</span>
                    </button>
                  );
                })}
              </div>
              <Input
                aria-label="Otra emoción"
                placeholder="¿Otra emoción? Cuéntanos con tus palabras…"
                value={emocionLibre}
                onChange={(e) => setEmocionLibre(e.target.value)}
                className="h-12 bg-input border-border"
              />
            </div>


            {/* DESTINO */}
            <div className="space-y-4">
              <h3 className="font-display text-xl tracking-tight">¿Tienes un destino en mente?</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSurpriseDestino(true)}
                  className={`p-4 rounded-2xl border text-left transition backdrop-blur-sm ${
                    surpriseDestino
                      ? "bg-primary/10 border-primary text-foreground gold-glow"
                      : "bg-surface/60 border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Sorpréndeme
                  </div>
                  <div className="text-xs opacity-70">IATOS elige según tu ADN</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSurpriseDestino(false)}
                  className={`p-4 rounded-2xl border text-left transition backdrop-blur-sm ${
                    !surpriseDestino
                      ? "bg-primary/10 border-primary text-foreground gold-glow"
                      : "bg-surface/60 border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium mb-1">Tengo destino</div>
                  <div className="text-xs opacity-70">Yo elijo a dónde ir</div>
                </button>
              </div>
              {!surpriseDestino && (
                <Input
                  aria-label="Destino que tienes en mente"
                  placeholder="ej. Tokio, Barcelona, Oaxaca, Patagonia…"
                  value={destinoEmocion}
                  onChange={(e) => setDestinoEmocion(e.target.value)}
                  className="h-12 bg-input border-border"
                />
              )}
              {surpriseDestino && (
                <p className="text-xs text-primary/90 italic flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 mt-0.5 shrink-0" /> IATOS cruzará tus emociones, presupuesto, perfil y viajes previos para elegir el destino perfecto.
                </p>
              )}
            </div>

            {/* VIAJEROS */}
            <div className="space-y-4">
              <h3 className="font-display text-xl tracking-tight">¿Cuántas personas viajan?</h3>
              <div className="flex flex-wrap gap-2">
                {GRUPOS.map((g) => {
                  const active = grupoPreset === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => pickGrupo(g.id)}
                      className={`px-5 py-2.5 rounded-full border text-sm transition ${
                        active
                          ? "bg-primary/15 border-primary text-primary gold-glow"
                          : "bg-surface border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                      }`}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
              {grupoPreset === "custom" && (
                <div className="pt-2">
                  <label id="plantrip-viajeros-emocion" className="text-xs text-muted-foreground mb-2 block">
                    Número de viajeros: <span className="text-foreground font-medium">{numViajeros}</span>
                  </label>
                  <Slider aria-labelledby="plantrip-viajeros-emocion" value={[numViajeros]} onValueChange={(v) => setNumViajeros(v[0])} min={1} max={12} step={1} />
                </div>
              )}
              {grupoPreset === "pareja" && (
                <p className="text-xs text-primary/90 italic flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" /> IATOS combinará gustos y estilos de viaje.
                </p>
              )}
            </div>

            {/* FECHAS */}
            <div className="space-y-4">
              <h3 className="font-display text-xl tracking-tight">¿Cuándo quieres viajar?</h3>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setSurpriseDates(false)}
                  className={`p-4 rounded-2xl border text-left transition backdrop-blur-sm ${
                    !surpriseDates
                      ? "bg-primary/10 border-primary text-foreground gold-glow"
                      : "bg-surface/60 border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium mb-1">Seleccionar fechas</div>
                  <div className="text-xs opacity-70">Elijo yo</div>
                </button>
                <button
                  type="button"
                  onClick={() => setSurpriseDates(true)}
                  className={`p-4 rounded-2xl border text-left transition backdrop-blur-sm ${
                    surpriseDates
                      ? "bg-primary/10 border-primary text-foreground gold-glow"
                      : "bg-surface/60 border-border text-muted-foreground hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-medium mb-1 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" /> Sorpréndeme
                  </div>
                  <div className="text-xs opacity-70">La mejor temporada</div>
                </button>
              </div>
              {!surpriseDates && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label htmlFor="plantrip-salida" className="text-xs text-muted-foreground mb-1.5 block">Salida</label>
                    <Input id="plantrip-salida" type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} className="bg-input border-border h-12" />
                  </div>
                  <div>
                    <label htmlFor="plantrip-regreso" className="text-xs text-muted-foreground mb-1.5 block">Regreso</label>
                    <Input id="plantrip-regreso" type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} className="bg-input border-border h-12" />
                  </div>
                </div>
              )}
              {surpriseDates && (
                <p className="text-xs text-primary/90 italic flex items-start gap-1.5">
                  <Sparkles className="w-3 h-3 mt-0.5 shrink-0" /> IATOS propondrá fechas según la temporada y cotizará con ellas; podrás cambiarlas después.
                </p>
              )}
              <div>
                <label id="plantrip-origen-emocion" className="text-xs text-muted-foreground mb-1.5 block">Ciudad de salida</label>
                <OriginPicker labelId="plantrip-origen-emocion" value={ciudadOrigen} onChange={setCiudadOrigen} />
              </div>
            </div>

            {/* PRESUPUESTO */}
            <div className="space-y-4">
              <h3 className="font-display text-xl tracking-tight">¿Cuál es tu presupuesto aproximado?</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {BUDGETS.map((b) => {
                  const active = budgetMode === b.id;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => pickBudget(b.id)}
                      className={`p-3 rounded-2xl border text-left transition ${
                        active
                          ? "bg-primary/10 border-primary text-foreground gold-glow"
                          : "bg-surface/60 border-border text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      <div className="text-sm font-medium">{b.label}</div>
                      <div className="text-[11px] opacity-70 mt-0.5">{b.hint}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground italic">
                ✨ No buscamos el viaje más caro — buscamos el viaje perfecto para ti.
              </p>
            </div>
          </div>
        ),
      }
    : {
        icon: MapPin,
        title: "¿A dónde quieres ir?",
        sub: "Un destino ('Tokio'), una travesía ('Roma → Florencia') o tu idea completa ('Oaxaca del 12 al 16 de diciembre, 2 personas').",
        canNext: () => destino.trim().length > 1,
        render: () => {
          const intent = detectRouteIntent(destino);
          const isMulti = intent.mode === "multi" && intent.destinations.length >= 2;
          const sentence = !isMulti && looksLikeSentence(destino);
          const understood = sentence ? understandPlanText(destino) : null;
          const roadTrip = detectRoadTrip(destino);
          return (
            <div className="space-y-3">
              <div className="relative">
                <Input
                  autoFocus
                  aria-label="¿A dónde quieres ir?"
                  placeholder="París · o · Roma → Florencia → Venecia"
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  className="h-16 text-lg bg-input border-border pr-14"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <VoiceInput
                    onTranscript={(t) => setDestino((prev) => (prev ? prev + " " : "") + t)}
                  />
                </div>
              </div>
              {destino.trim().length > 1 && (
                <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border ${
                  isMulti
                    ? "bg-primary/10 border-primary/40 text-primary"
                    : "bg-surface border-border text-muted-foreground"
                }`}>
                  {isMulti ? <RouteIcon className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                  {isMulti
                    ? `Travesía multi-destino · ${intent.destinations.length} ciudades`
                    : understood
                      ? `Entendimos: ${describeUnderstood(understood)}`
                      : "Viaje a un solo destino"}
                </div>
              )}
              {roadTrip.route && (
                <Link to={routePlannerPath(roadTrip.route, roadTrip.days)} data-testid="plan-roadtrip-chip"
                  className="ml-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border bg-primary/10 border-primary/40 text-primary">
                  <Car className="w-3.5 h-3.5" aria-hidden="true" /> Road trip en coche: {roadTrip.route.name} →
                </Link>
              )}
              {sentence && !understood && !roadTrip.route && (
                <p className="text-xs text-amber-400/90" role="status">
                  No reconocimos el destino en tu frase. Escribe solo la ciudad o el país (p. ej. «Oaxaca»); las fechas y los viajeros van en el siguiente paso.
                </p>
              )}
              {destino.trim().length === 0 && (
                <div className="pt-2">
                  <p className="text-xs text-muted-foreground mb-2">O empieza con un ejemplo:</p>
                  <div className="flex flex-wrap gap-2">
                    {EXAMPLE_PROMPTS.map((ex) => (
                      <button key={ex} type="button" onClick={() => setDestino(ex)}
                        className="min-h-[40px] rounded-full border border-border bg-surface/60 px-3.5 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                        {ex}
                      </button>
                    ))}
                  </div>
                  {/* roadtrip: inspiración con rutas curadas de sitios oficiales. Plegada: las fotos de
                      Pexels se piden solo si el usuario la abre (presupuesto de imágenes). */}
                  <div className="pt-6">
                    <button type="button" onClick={() => setShowRoadTrips((v) => !v)} aria-expanded={showRoadTrips} data-testid="plan-roadtrip-ideas-toggle"
                      className="min-h-[44px] inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-4 text-sm text-primary hover:bg-primary/15 transition">
                      <Car className="w-4 h-4" aria-hidden="true" /> {showRoadTrips ? "Ocultar ideas de road trips" : "Ideas de road trips en coche por Europa"}
                    </button>
                    {showRoadTrips && <RoadTripIdeas limit={4} className="pt-4" />}
                  </div>
                </div>
              )}
            </div>
          );
        },
      };

  const stepsConfig = isEmocionMode
    ? [firstStep]
    : [
    firstStep,

    {
      icon: Calendar,
      title: "¿Cuándo y con quién?",
      sub: "Las fechas exactas y cuántos viajan.",
      canNext: () => !!fechaSalida && !!fechaRegreso && fechaRegreso > fechaSalida && !!ciudadOrigen,
      render: () => (
        <div className="space-y-5">
          {stepNotice && (
            <p role="status" className="rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2.5 text-sm text-foreground/90">{stepNotice}</p>
          )}
          <div>
            <label id="plantrip-origen" className="text-sm text-muted-foreground mb-2 block">Ciudad de salida</label>
            <OriginPicker labelId="plantrip-origen" value={ciudadOrigen} onChange={setCiudadOrigen} />
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2" id="plantrip-atajos">Atajos de fechas</p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="plantrip-atajos">
              {datePresets().map((p) => {
                const on = fechaSalida === p.salida && fechaRegreso === p.regreso;
                return (
                  <button key={p.key} type="button" aria-pressed={on}
                    onClick={() => { setFechaSalida(p.salida); setFechaRegreso(p.regreso); }}
                    className={`min-h-[44px] rounded-2xl border px-3.5 py-1.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${on ? "bg-primary/10 border-primary text-foreground" : "bg-surface/60 border-border text-muted-foreground hover:border-primary/40"}`}>
                    <span className="block leading-tight">{p.label}</span>
                    <span className="block text-[11px] opacity-70">{p.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="plantrip-salida-2" className="text-sm text-muted-foreground mb-2 block">Salida</label>
              <Input id="plantrip-salida-2" type="date" value={fechaSalida} onChange={(e) => setFechaSalida(e.target.value)} className="bg-input border-border h-12" />
            </div>
            <div>
              <label htmlFor="plantrip-regreso-2" className="text-sm text-muted-foreground mb-2 block">Regreso</label>
              <Input id="plantrip-regreso-2" type="date" value={fechaRegreso} onChange={(e) => setFechaRegreso(e.target.value)} className="bg-input border-border h-12" />
            </div>
          </div>
          <div>
            <label id="plantrip-viajeros" className="text-sm text-muted-foreground mb-3 block">Número de viajeros: <span className="text-foreground font-medium">{numViajeros}</span></label>
            <Slider aria-labelledby="plantrip-viajeros" value={[numViajeros]} onValueChange={(v) => setNumViajeros(v[0])} min={1} max={10} step={1} />
          </div>
        </div>
      ),
    },
    {
      icon: Wallet,
      title: "Presupuesto del viaje",
      sub: "Opcional. Es el total para todos, no por día. Si lo dejas, ajustamos las recomendaciones.",
      canNext: () => true,
      render: () => (
        <BudgetField value={presupuesto} onChange={setPresupuesto} travelers={numViajeros} nights={nightsBetween(fechaSalida, fechaRegreso)} />
      ),
    },
  ];

  const current = stepsConfig[step];
  const Icon = current.icon;

  // Paso 1 → 2: si escribió una frase ("Oaxaca del 12 al 16 de diciembre, 2 personas") se
  // interpreta aquí, sin IA ni costo, y se prellenan fechas y viajeros (antes la frase entera
  // viajaba como destino al análisis).
  const goNext = () => {
    if (step === 0 && !isEmocionMode) {
      const u = understandPlanText(destino);
      if (u?.destino) {
        setDestino(u.destino);
        if (u.fechaSalida && u.fechaRegreso) { setFechaSalida(u.fechaSalida); setFechaRegreso(u.fechaRegreso); }
        if (u.viajeros) setNumViajeros(u.viajeros);
        setStepNotice(`Entendimos: ${describeUnderstood(u)}. Revisa y ajusta lo que necesites.`);
      }
    }
    setStep(step + 1);
  };

  return (
    <DashboardLayout>
      <div className="min-h-screen flex flex-col">
        {step > 0 && (
          <header className="px-6 md:px-10 py-6">
            <button
              onClick={() => setStep(step - 1)}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Atrás
            </button>
          </header>
        )}

        <main className="flex-1 px-4 md:px-6 py-6 md:py-10">
          <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 md:gap-10 items-start">
            <div className="w-full max-w-xl mx-auto lg:mx-0">
              {companion && (
                <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs text-foreground" data-testid="plan-companion">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  Viaje con {companion.name} · lo invitamos en cuanto se guarde
                  <button type="button" aria-label={`Planear sin ${companion.name}`} onClick={() => setCompanion(null)} className="ml-1 text-muted-foreground hover:text-foreground">×</button>
                </div>
              )}
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
                  {isEmocionMode && step === 0 ? (
                    <div className="mb-8">
                      <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight">
                        ¿Cuál es
                        <br />
                        <span className="gold-text italic">tu emoción del viaje?</span>
                      </h2>
                      <p className="text-muted-foreground mt-4 max-w-md">
                        Cuéntanos cómo te sientes y deja que IATOS AI cree tu próximo viaje ideal.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-6">
                        <Icon className="w-5 h-5 text-primary" />
                      </div>
                      <h2 className="font-display text-3xl md:text-5xl mb-3">{current.title}</h2>
                      <p className="text-muted-foreground mb-6 md:mb-10">{current.sub}</p>
                    </>
                  )}
                  <div className="mb-12">{current.render()}</div>
                </motion.div>
              </AnimatePresence>

              <Button
                onClick={() =>
                  step === stepsConfig.length - 1
                    ? isEmocionMode
                      ? elegirDestinoYAnalizar()
                      : analizar()
                    : goNext()
                }
                disabled={!current.canNext()}
                className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow rounded-2xl h-auto py-4 flex flex-col gap-0.5"
              >
                {step === stepsConfig.length - 1 ? (
                  <>
                    <span className="inline-flex items-center font-display text-lg">
                      <Sparkles className="w-4 h-4 mr-2" />
                      {isEmocionMode ? "Empezar análisis" : "Generar análisis"}
                    </span>
                    {isEmocionMode && (
                      <span className="text-xs font-normal opacity-80">IATOS AI creará tu próximo viaje ideal</span>
                    )}
                  </>
                ) : (
                  <span className="inline-flex items-center font-medium">
                    Continuar
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </span>
                )}
              </Button>

              {isEmocionMode && step === 0 && (
                <p className="text-center text-[11px] text-muted-foreground mt-5 inline-flex items-center justify-center gap-2 w-full tracking-wide">
                  <Lock className="w-3 h-3" />
                  Revisas todo antes de reservar; nada se compra sin ti
                </p>
              )}

              {stepsConfig.length > 1 && (
                <div className="flex items-center justify-center gap-2 mt-8" aria-label={`Paso ${step + 1} de ${stepsConfig.length}`}>
                  <span className="text-[11px] text-muted-foreground mr-1">Paso {step + 1} de {stepsConfig.length}</span>
                  {stepsConfig.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 rounded-full transition-all duration-500 ${
                        i === step ? "w-8 bg-primary" : "w-2 bg-border"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>


            <div className="lg:sticky lg:top-10">
              <TripBuildPreview
                origin={ciudadOrigen}
                destinoRaw={destino}
                fechaSalida={fechaSalida}
                fechaRegreso={fechaRegreso}
                viajeros={numViajeros}
                presupuesto={presupuesto}
              />
            </div>
          </div>
        </main>
      </div>
    </DashboardLayout>
  );
};

export default PlanTrip;
