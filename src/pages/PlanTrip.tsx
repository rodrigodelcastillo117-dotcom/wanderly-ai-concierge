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
import { SlowLoading } from "@/components/brand/SlowLoading";
import { OriginPicker } from "@/components/OriginPicker";
import { TripBuildPreview } from "@/components/TripBuildPreview";
import { VoiceInput } from "@/components/VoiceInput";
import { claimIntent, completeIntent, intentFingerprint, releaseIntent } from "@/lib/autoIntent";
import { analysisSummaryOf, datePresets, EXAMPLE_PROMPTS, looksLikeSentence, monthOfText, suggestTripDates, suggestedDatesNotice, understandPlanText } from "@/lib/planDefaults";
import { diffLocalDays, formatLocalDate } from "@/lib/localDate";
// Varias ciudades escritas en el planeador ("paris roma y atenas 10 dias") → ruta multi-destino.
import { addIsoDays, describeMultiCity, fitNights, isMultiCity, moveCity, parseMultiCityText, routePlannerQuery } from "@/lib/multiCityText";
import { generateMultiDestTrip } from "@/lib/multiDestGenerate";
import { CityNightsEditor } from "@/components/route/CityNightsEditor";
import { countryOnly, regionOnly } from "@/lib/multiCityText";
import { cityReasons, countryRouteFor, describeProposal, proposeCountryRoute, proposeRegionRoute, weightedNights } from "@/lib/countryRoutes";
import { useTasteProfile } from "@/hooks/useTasteProfile";
import { fetchFriendProfiles } from "@/lib/friendProfiles";
// roadtrip: "road trip por la Toscana" va a la ruta de varios destinos con el coche elegido.
import { detectRoadTrip, routePlannerPath } from "@/lib/roadtrip";
import { RoadTripIdeas } from "@/components/roadtrip/RoadTripIdeas";
// Intérprete de viaje completo: "Entendí…" editable antes de generar, y cobertura de lo escrito.
import { TripSpecReview } from "@/components/plan/TripSpecReview";
import { buildLocalSpec, finalizeSpec } from "@/lib/tripSpecLocal";
import { generateFromSpec, interpretTripAi, INTERPRET_TIMEOUT_MS } from "@/lib/tripSpecFlow";
// Borrador rápido: el resumen del lector local se ve al instante y la IA lo completa al responder.
import { DRAFT_FAIL_AVISO, draftSpec, mergeDraftWithAi } from "@/lib/tripSpecDraft";
import { routeFromItems, type RefAnswer } from "@/lib/tripCoverage";
import { usePlaceResolve } from "@/lib/placeResolveClient";
import { makeStop, newId, savedConsulta, setTripBasics, withConsulta, type TripSpec } from "../../supabase/functions/_shared/tripSpec";

const RADIO = "min-h-[44px] rounded-xl border px-3 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

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

// "revisar": la frase completa (paradas, crucero, regreso por otra ciudad…) ya interpretada; la persona
// ve "Entendí…", corrige y confirma ANTES de gastar (caso Diego, 27-oct-2026: Arabia, crucero, Cape Town
// y regreso por Londres terminaron en un solo destino generado sin preguntar).
type Interpretacion = { kind: "ruta"; qs: string } | { kind: "revisar"; spec: TripSpec; aviso: string | null };

type HintCtx = { origen: string | null; fecha_salida: string | null; fecha_regreso: string | null; viajeros: number | null };

/** Resultado de Iato sobre un borrador (`ok: false`: falló o tardó más de 45 s; el borrador queda como base). */
type IaResult = { ok: true; spec: TripSpec; aviso: string | null; ctx: HintCtx } | { ok: false; ctx: HintCtx };
type DraftRun = { ctx: Promise<HintCtx>; result: Promise<IaResult> };
/** Borrador en pantalla: lo que se mostró (`base`, para saber qué editó la persona) y su revisión con Iato. */
type DraftInfo = { token: string; base: TripSpec; hints: HintCtx };
type ReviewState = { spec: TripSpec; aviso: string | null; fp?: string; draft?: DraftInfo | null; nota?: string | null };

/** Arranque de la interpretación: un borrador inmediato (va con Iato) o el flujo de siempre (ruta / solo ciudades). */
type Arranque = { kind: "borrador"; draft: DraftInfo; run: DraftRun } | { kind: "completo"; result: Promise<Interpretacion> };

// Una sola interpretación por frase aunque la página se monte dos veces.
const pendingInterpretations = new Map<string, Arranque>();
// Revisión con Iato de cada borrador (por token): un remontaje la retoma, nunca la repite.
const draftRuns = new Map<string, DraftRun>();
const REVIEW_KEY = "iatos.plan.revision";

async function ctxFor(userId: string, hints: HintCtx): Promise<HintCtx> {
  // Trae ciudad_origen del perfil para fallback
  const { data: prof } = await supabase
    .from("profiles")
    .select("ciudad_origen")
    .eq("id", userId)
    .maybeSingle();
  return { ...hints, origen: hints.origen || prof?.ciudad_origen || "Ciudad de México" };
}

/** Solo ciudades conocidas, sin crucero, tramos ni regreso por otra ciudad: el lector local basta (sin IA). */
const isSimpleSpec = (s: TripSpec) => s.menciones.length > 0 && s.menciones.every((m) => m.tipo === "ciudad" || m.tipo === "origen")
  && !s.preguntas.some((x) => !x.resuelta && x.tipo !== "fechas" && x.tipo !== "origen");

async function interpretarFrase(q: string, userId: string, hints: HintCtx): Promise<Interpretacion> {
  const ctx = await ctxFor(userId, hints);

  // roadtrip: road trip por una región curada → ruta en coche con sus paradas (sin IA ni costo).
  const rt = detectRoadTrip(q);
  if (rt.isRoadTrip && rt.route) {
    const qs = new URLSearchParams(routePlannerPath(rt.route, rt.days).split("?")[1]);
    qs.set("origin", ctx.origen as string);
    qs.set("viajeros", String(ctx.viajeros || 2));
    return { kind: "ruta", qs: qs.toString() };
  }
  // Solo ciudades conocidas: el lector local (sin IA), con el origen del perfil.
  return { kind: "revisar", spec: finalizeSpec(buildLocalSpec(q, ctx), q, ctx), aviso: null };
}

/** Iato (interpretar-viaje) sobre un borrador: nunca lanza; más de 45 s en total cuenta como falla. */
function revisarConIa(q: string, userId: string, hints: HintCtx): DraftRun {
  const ctx = ctxFor(userId, hints).catch(() => ({ ...hints, origen: hints.origen || null }));
  const work = (async (): Promise<IaResult> => {
    const c = await ctx;
    const r = await interpretTripAi(supabase as any, q, c);
    if (!r.ok) return { ok: false, ctx: c };
    return { ok: true, spec: r.spec, ctx: c,
      aviso: r.recortadoParaIa ? "Tu texto es muy largo: Iato leyó los primeros 8,000 caracteres. Se guarda completo; revisa que esté todo." : null };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<IaResult>((res) => { timer = setTimeout(() => res({ ok: false, ctx: hints }), INTERPRET_TIMEOUT_MS); });
  const result = Promise.race([work.catch((): IaResult => ({ ok: false, ctx: hints })), timeout]).finally(() => clearTimeout(timer));
  return { ctx, result };
}

/**
 * En cuanto la persona envía su texto: road trip y frases de solo ciudades conocidas siguen el flujo de
 * siempre (rápido, sin IA); lo demás muestra AL INSTANTE el borrador del lector local mientras Iato lo revisa.
 */
function arrancarInterpretacion(q: string, userId: string, hints: HintCtx): Arranque {
  const rt = detectRoadTrip(q);
  if (!(rt.isRoadTrip && rt.route)) {
    const base = draftSpec(q, hints);
    if (!isSimpleSpec(base)) {
      const draft: DraftInfo = { token: newId("b"), base, hints };
      const run = revisarConIa(q, userId, hints);
      draftRuns.set(draft.token, run);
      return { kind: "borrador", draft, run };
    }
  }
  return { kind: "completo", result: interpretarFrase(q, userId, hints) };
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
  // Resumen "Entendí…" de la frase completa (se conserva al recargar: preferencia local del navegador).
  const [review, setReview] = useState<ReviewState | null>(() => {
    try {
      const raw = localStorage.getItem(REVIEW_KEY);
      const v = raw ? JSON.parse(raw) : null;
      // Un resumen de hace más de un día ya no se retoma solo.
      return v?.spec?.consulta_original && (!v.at || Date.now() - v.at < 86400000) ? v : null;
    } catch { return null; }
  });
  // El borrador en pantalla, para que la respuesta de Iato se aplique sobre lo último que editó la persona.
  const reviewRef = useRef<ReviewState | null>(review);
  reviewRef.current = review;
  const openReview = (v: ReviewState | null) => {
    reviewRef.current = v;
    setReview(v);
    try { if (v) localStorage.setItem(REVIEW_KEY, JSON.stringify({ ...v, at: Date.now() })); else localStorage.removeItem(REVIEW_KEY); } catch { /* sin almacenamiento */ }
  };
  // Lugares escritos en el campo que no son ciudades conocidas: cada uno se resuelve (nunca se descarta).
  const [refAnswers, setRefAnswers] = useState<Record<string, RefAnswer>>({});
  const [refText, setRefText] = useState<Record<string, string>>({});
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
  // Ruta de varias ciudades entendida de la frase: orden, noches y si se arma como ruta. `text` es el
  // texto del campo al que corresponde (si la persona lo cambia, se vuelve a leer la frase).
  const [routeEdit, setRouteEdit] = useState<{ text: string; cities: string[]; nights: number[] | null; asRoute: boolean; days: number | null; textNights: number | null;
    /** Ruta propuesta para un país ("india"): se vuelve a proponer con las fechas mientras no se toquen las ciudades. */
    country?: string | null; edited?: boolean } | null>(null);
  // Destino tipo país: "Ajustar ruta" (agregar/quitar ciudades, noches) y "Solo una ciudad".
  const [routeAdjust, setRouteAdjust] = useState(false);
  const [pickOneCity, setPickOneCity] = useState(false);
  const [addCityText, setAddCityText] = useState("");
  const [addCityError, setAddCityError] = useState<string | null>(null);
  const taste = useTasteProfile(user?.id ?? null);
  // Noches que decía la frase ("10 dias" → 9): al elegir la salida se propone el regreso.
  const [textNights, setTextNights] = useState<number | null>(null);
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
        // Un origen ya elegido (p. ej. en la ventana "Planear viaje") no se pisa con el del perfil.
        if (data?.ciudad_origen) setCiudadOrigen((prev) => prev || data.ciudad_origen);
      })
      .catch(() => {})
      .finally(() => setProfileLoaded(true));
  }, [user?.id]);

  // Llegada desde la ventana "Planear viaje" (?desde=ventana): destino, origen, fechas y viajeros ya
  // elegidos en campos separados (nunca la frase completa como destino). Se abre el paso de fechas
  // para revisar; nada se cotiza hasta que la persona confirma.
  const fromDialogRef = useRef(false);
  const claseParam = params.get("clase");
  const CLASE_TXT: Record<string, string> = { premium: "Premium", business: "Business", primera: "Primera" };
  useEffect(() => {
    if (fromDialogRef.current || params.get("desde") !== "ventana" || !params.get("destino")) return;
    fromDialogRef.current = true;
    const o = params.get("origen");
    const fs = params.get("fecha_salida");
    const fr = params.get("fecha_regreso");
    const v = Number(params.get("viajeros"));
    if (o) setCiudadOrigen(o);
    if (fs && /^\d{4}-\d{2}-\d{2}$/.test(fs)) setFechaSalida(fs);
    if (fr && /^\d{4}-\d{2}-\d{2}$/.test(fr)) setFechaRegreso(fr);
    if (Number.isInteger(v) && v >= 1 && v <= 10) setNumViajeros(v);
    setStep(1);
    setStepNotice(`Llenamos tu viaje a ${params.get("destino")}${o ? ` desde ${o}` : ""}. Revisa las fechas y continúa.${fr ? "" : " Falta la fecha de regreso."}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "10 dias": con la salida elegida y sin regreso, el regreso se propone solo (se puede cambiar).
  useEffect(() => {
    if (!textNights || !fechaSalida || fechaRegreso) return;
    setFechaRegreso(addIsoDays(fechaSalida, textNights));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaSalida, textNights]);

  // Quita de la URL las intenciones de un solo uso (?q, ?autoCheapest) en cuanto se
  // consumen. Así "Atrás" desde el viaje generado no vuelve a disparar el análisis.
  const consumeUrlIntent = () => {
    const next = new URLSearchParams(params);
    next.delete("q");
    next.delete("autoCheapest");
    next.delete("sugerencia");
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

  // Idea de destino (tarjetas de Inicio: ?destino=X&sugerencia=1; enlaces viejos con ?autoCheapest=1):
  // NUNCA genera un viaje sola. Lleva al paso de fechas con el destino puesto y fechas SUGERIDAS
  // (martes a martes, ~60 días, fuera de Navidad/Año Nuevo y Semana Santa) visibles y editables; el
  // análisis solo corre cuando la persona pulsa «Armar mi viaje». Antes un toque creaba un viaje
  // completo sin preguntar (y con fechas sobre Año Nuevo).
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (autoFiredRef.current) return;
    if (params.get("autoCheapest") !== "1" && params.get("sugerencia") !== "1") return;
    if (!destino) return;
    if (!ciudadOrigen && !profileLoaded) return;
    autoFiredRef.current = true;
    consumeUrlIntent();
    const sug = suggestTripDates();
    setFechaSalida((prev) => prev || sug.salida);
    setFechaRegreso((prev) => prev || sug.regreso);
    setStep(1);
    setStepNotice(suggestedDatesNotice(destino, sug, !!ciudadOrigen));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destino, ciudadOrigen, params, profileLoaded]);




  // Evita dobles envíos (doble clic, efecto que se repite) mientras hay un análisis en curso.
  const inFlightRef = useRef(false);

  /** Texto escrito y lo entendido, para itinerario_json.consulta (depurar y corregir después). */
  const consultaFor = (text: string, cities: string[]) => {
    const sp = finalizeSpec(buildLocalSpec(text, { origen: ciudadOrigen || null, fecha_salida: fechaSalida || null, fecha_regreso: fechaRegreso || null, viajeros: numViajeros }), text);
    return savedConsulta({ ...sp, paradas: cities.map((c) => sp.paradas.find((x) => x.ciudad === c) ?? makeStop(c, { texto: c })), preguntas: sp.preguntas.map((q) => ({ ...q, resuelta: true })) });
  };

  const runAnalisis = async (args: AnalisisArgs, intentFp?: string, consultaText?: string): Promise<boolean> => {
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
      // El texto escrito y la invitación al acompañante van en paralelo (antes uno tras otro antes de
      // abrir el viaje).
      const saveConsulta = consultaText && consultaText.trim()
        ? (async () => {
          try {
            await supabase.from("trips").update({ itinerario_json: withConsulta(data.trip.itinerario_json ?? [], consultaFor(consultaText, [args.destino])) as any }).eq("id", data.trip.id);
          } catch { /* el viaje queda igual; solo no se guardó el texto */ }
        })()
        : Promise.resolve();
      track("trip_quoted", {
        destino: args.destino,
        viajeros: args.num_viajeros,
        total_estimado: data.trip.total_estimado ?? null,
      });
      // El análisis terminó y quedó guardado: el siguiente es otro intento (llave nueva).
      clearRequestKey("analizar-viaje");
      if (intentFp) completeIntent(intentFp, data.trip.id);
      await Promise.all([saveConsulta, inviteCompanion(data.trip.id)]);
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

  // ── Ruta de varias ciudades desde la frase ──
  const parsedRoute = parseMultiCityText(destino, { origin: ciudadOrigen || null });
  const routeBase = routeEdit && routeEdit.text === destino ? routeEdit : null;
  // Cada lugar escrito, en su orden (Hungría → Budapest propuesta, pendiente de confirmar): nada se pierde.
  const refTexts = parsedRoute.items.length > 1 ? parsedRoute.items.filter((i) => i.kind === "country" || i.kind === "unknown").map((i) => i.name) : [];
  const { lookup: refLookup, places: refPlaces } = usePlaceResolve(refTexts);
  const coverage = routeFromItems(parsedRoute.items, refAnswers, { nights: (fechaSalida && fechaRegreso && fechaRegreso > fechaSalida ? diffLocalDays(fechaSalida, fechaRegreso) : null) ?? parsedRoute.nights, lookup: refLookup });
  const refPending = parsedRoute.items.length > 1 ? coverage.pending : [];
  const writtenRoute = parsedRoute.items.length > 1 && parsedRoute.items.some((i) => i.kind !== "city") ? coverage.cities : null;
  const answerRef = (key: string, a: RefAnswer) => { setRefAnswers((prev) => ({ ...prev, [key]: a })); setRouteEdit(null); };
  // Frase con crucero, tramos o regreso por otra ciudad: el intérprete completo, con "Entendí…" para confirmar.
  const complexText = /\b(crucero|regres|vuelta|desembarc|ferry|en tren|tren a|escala|v[ií]a )/i.test(destino);
  const interpretNow = async () => {
    const q = destino.trim();
    if (!q || !user) return;
    const start = arrancarInterpretacion(q, user.id, { origen: ciudadOrigen || null, fecha_salida: fechaSalida || null, fecha_regreso: fechaRegreso || null, viajeros: numViajeros });
    // Borrador al instante; Iato lo completa al responder (efecto de abajo).
    if (start.kind === "borrador") { openReview({ spec: start.draft.base, aviso: null, draft: start.draft }); return; }
    setInterpretando(true);
    try {
      const r = await start.result;
      if (r.kind === "ruta") navigate(`/dashboard/ruta?${r.qs}`);
      else openReview({ spec: r.spec, aviso: r.aviso });
    } catch {
      openReview({ spec: finalizeSpec(buildLocalSpec(q, { origen: ciudadOrigen || null }), q), aviso: "No pudimos interpretar todo tu mensaje. Revisa lo que entendimos y corrígelo." });
    } finally {
      setInterpretando(false);
    }
  };
  const datesNights = fechaSalida && fechaRegreso && fechaRegreso > fechaSalida ? diffLocalDays(fechaSalida, fechaRegreso) : null;
  const routeTotalNights = datesNights ?? routeBase?.textNights ?? parsedRoute.nights;
  // País o región ("india"): IATOS propone un viaje completo con las ciudades que valen la pena para las
  // noches disponibles (no una "ciudad" llamada India). Se rehace con las fechas si no se tocaron las ciudades.
  // Una región ("Toscana 5 días") se propone por sus bases (Florencia, Siena), igual que en la caja de Iato.
  const routeCountry = routeBase ? routeBase.country ?? null : countryOnly(parsedRoute) ?? regionOnly(parsedRoute);
  const proposal = routeCountry && (!routeBase || !routeBase.edited)
    ? proposeCountryRoute(routeCountry, routeTotalNights ?? null) ?? proposeRegionRoute(routeCountry, routeTotalNights ?? null) : null;
  // "en abril 2027" sin días exactos: se dice y se pide la salida en ese mes (no se inventa el día).
  const textMonth = monthOfText(destino);
  const routeCities = (proposal && routeBase && !routeBase.edited ? proposal.cities : null) ?? routeBase?.cities
    ?? (writtenRoute && writtenRoute.length >= 2 ? writtenRoute : isMultiCity(parsedRoute) ? parsedRoute.cities : proposal?.cities ?? []);
  const routeOn = routeCities.length >= 2 && (routeBase ? routeBase.asRoute : true);
  const routeDays = routeBase?.days ?? parsedRoute.days;
  const proposalNights = proposal && proposal.cities.join("|") === routeCities.join("|") && routeTotalNights ? weightedNights(proposal.weights, routeTotalNights) : null;
  const routeNights = routeOn ? fitNights(routeBase?.nights ?? proposalNights, routeCities.length, routeTotalNights) : null;
  const routeWhy = routeCountry && proposal ? cityReasons({ country: routeCountry, cities: routeCities, why: routeCities.map((c) => proposal.why[proposal.cities.indexOf(c)] ?? "") }, {}, taste) : null;
  const distinctCities = Array.from(new Set(routeCities));
  const routeTooShort = routeOn && datesNights != null && datesNights < routeCities.length;
  const editRoute = (patch: Partial<NonNullable<typeof routeEdit>>) => setRouteEdit({
    text: destino, cities: routeCities, nights: routeNights, asRoute: routeOn, days: routeDays,
    textNights: routeBase?.textNights ?? parsedRoute.nights, country: routeCountry, edited: routeBase?.edited ?? false, ...patch,
  });
  const moveRouteCity = (i: number, dir: -1 | 1) => editRoute({ cities: moveCity(routeCities, i, dir), nights: routeNights ? moveCity(routeNights, i, dir) : null, edited: true });
  const removeRouteCity = (i: number) => editRoute({ cities: routeCities.filter((_, j) => j !== i), nights: null, edited: true });
  const addRouteCity = () => {
    const found = parseMultiCityText(addCityText).cities;
    if (found.length !== 1) { setAddCityError(addCityText.trim() ? `No reconocimos «${addCityText.trim()}» como ciudad.` : null); return; }
    setAddCityError(null);
    setAddCityText("");
    // Antes del regreso a la ciudad de entrada (… → Ranthambore → Delhi), si lo hay.
    const back = routeCities.length > 2 && routeCities[routeCities.length - 1] === routeCities[0];
    const at = back ? routeCities.length - 1 : routeCities.length;
    editRoute({ cities: [...routeCities.slice(0, at), found[0], ...routeCities.slice(at)], nights: null, edited: true });
  };
  const chooseOneCity = (city: string) => {
    setPickOneCity(false);
    setRouteEdit(null);
    setDestino(city);
  };

  const inviteCompanion = async (tripId: string) => {
    const amigo = companionRef.current;
    if (!amigo) return;
    try {
      const { data: inv } = await supabase.rpc("invitar_amigo_viaje", { p_trip_id: tripId, p_friend_id: amigo.id });
      if ((inv as { ok?: boolean } | null)?.ok) {
        toast.success(`Invitamos a ${amigo.name} a este viaje`);
        supabase.functions.invoke("send-email", { body: { trip_id: tripId, friend_id: amigo.id } }).catch(() => {});
      }
    } catch { /* la invitación se puede mandar después desde "Compartir" */ }
  };

  // Ruta de varias ciudades: el mismo plan que "Ruta multi-destino" (logistics-plan y las mismas filas
  // del viaje), con el orden y las noches que eligió la persona aquí.
  const runRoute = async () => {
    if (inFlightRef.current || routeCities.length < 2) return;
    inFlightRef.current = true;
    const label = routeCities.join(" → ");
    const written = destino;
    setDestino(label);
    setRouteEdit({ text: label, cities: routeCities, nights: routeNights, asRoute: true, days: routeDays, textNights: routeBase?.textNights ?? parsedRoute.nights, country: routeCountry, edited: true });
    setAnalysisSummary(analysisSummaryOf({ ciudad_origen: ciudadOrigen, fecha_salida: fechaSalida, fecha_regreso: fechaRegreso, num_viajeros: numViajeros }));
    setAnalizando(true);
    try {
      const { tripId } = await generateMultiDestTrip(supabase, {
        userId: user?.id ?? null, origin: ciudadOrigen, stops: routeCities, fechaSalida, fechaRegreso, viajeros: numViajeros,
        presupuesto, prefs: { connection: "smart", roadtripStops: true, luggageLogistics: true }, nightsPerCity: routeNights,
        travelClass: claseParam, telemetry: { autonomous: true }, consulta: consultaFor(written, routeCities),
      });
      if (!tripId) throw new Error("Sin viaje guardado");
      track("trip_quoted", { destino: label, viajeros: numViajeros, total_estimado: null, multi: true });
      await inviteCompanion(tripId);
      navigate(`/dashboard/viajes/${tripId}`, { replace: true });
    } catch (e: any) {
      console.error(e);
      await toastFunctionError(e, "No pudimos generar la ruta. Intenta de nuevo.");
      setAnalizando(false);
    } finally {
      inFlightRef.current = false;
    }
  };

  // Confirmó "Entendí…": se genera por el flujo que toca (multidestino o destino único) con la consulta guardada.
  const runSpec = async (spec: TripSpec, fp?: string) => {
    // Con un borrador (Iato aún no responde) no se gasta: el botón está deshabilitado y aquí tampoco pasa.
    if (inFlightRef.current || reviewRef.current?.draft) return;
    inFlightRef.current = true;
    setDestino(spec.paradas.filter((x) => x.rol === "estancia").map((x) => x.ciudad).join(" → "));
    setAnalysisSummary(analysisSummaryOf({ ciudad_origen: spec.origen ?? "", fecha_salida: spec.fecha_salida ?? "", fecha_regreso: spec.fecha_regreso ?? "", num_viajeros: spec.viajeros ?? 2 }));
    setAnalizando(true);
    try {
      const { tripId, flujo } = await generateFromSpec(supabase as any, spec, { userId: user?.id ?? null, travelClass: claseParam, presupuesto });
      if (!tripId) throw new Error("Sin viaje guardado");
      if (fp) completeIntent(fp, tripId);
      track("trip_quoted", { destino: spec.paradas.map((x) => x.ciudad).join(" → "), viajeros: spec.viajeros ?? 2, total_estimado: null, multi: flujo === "multi" });
      openReview(null);
      await inviteCompanion(tripId);
      navigate(`/dashboard/viajes/${tripId}`, { replace: true });
    } catch (e: any) {
      console.error(e);
      await toastFunctionError(e, "No pudimos generar tu viaje. Tu resumen sigue aquí: intenta de nuevo.");
      setAnalizando(false);
    } finally {
      inFlightRef.current = false;
    }
  };

  const analizar = () => {
    if (!destino || !fechaSalida || !fechaRegreso || !ciudadOrigen) return;
    // Un país, región o lugar sin resolver no se descarta ni se genera solo.
    if (refPending.length) return;

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

    if (routeOn) return runRoute();

    // Detección single vs multi al confirmar (travesías con ciudades que no están en el catálogo).
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
      // Clase elegida en la ventana "Planear viaje" (Turista no se anota: es lo de siempre).
      ...(claseParam && CLASE_TXT[claseParam] ? { notas_usuario: `Clase de vuelo preferida: ${CLASE_TXT[claseParam]}.` } : {}),
    }, undefined, destino);
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
      const vNum = Number(params.get("viajeros"));
      pending = arrancarInterpretacion(q, user.id, {
        origen: params.get("origen"),
        fecha_salida: /^\d{4}-\d{2}-\d{2}$/.test(params.get("fecha_salida") ?? "") ? params.get("fecha_salida") : null,
        fecha_regreso: /^\d{4}-\d{2}-\d{2}$/.test(params.get("fecha_regreso") ?? "") ? params.get("fecha_regreso") : null,
        viajeros: Number.isInteger(vNum) && vNum >= 1 && vNum <= 20 ? vNum : null,
      });
      pendingInterpretations.set(fp, pending);
    }
    let cancelled = false;
    const start = pending;
    if (start.kind === "borrador") {
      // Al instante: el borrador (un remontaje conserva lo que la persona ya editó en él).
      if (reviewRef.current?.draft?.token !== start.draft.token) openReview({ spec: start.draft.base, aviso: null, fp, draft: start.draft });
      void start.run.result.then(() => {
        // Iato respondió (o falló): la URL ya no lleva ?q. Lo aplica el efecto del borrador.
        if (cancelled) return;
        pendingInterpretations.delete(fp);
        consumeUrlIntent();
      });
      return () => { cancelled = true; };
    }
    setInterpretando(true);
    (async () => {
      try {
        const r = await start.result;
        // Otro montaje (el que sigue vivo) retoma la misma promesa: aquí no se suelta nada.
        if (cancelled) return;
        pendingInterpretations.delete(fp);
        consumeUrlIntent();

        if (r.kind === "ruta") {
          releaseIntent(fp);
          navigate(`/dashboard/ruta?${r.qs}`, { replace: true });
          return;
        }

        // Nada se genera solo: la persona revisa "Entendí…" y confirma (ahí se avisa el costo). La
        // intención queda reservada hasta que confirme (un remontaje no la vuelve a interpretar).
        openReview({ spec: r.spec, aviso: r.aviso, fp });
        setInterpretando(false);
      } catch (e: any) {
        if (cancelled) return;
        pendingInterpretations.delete(fp);
        releaseIntent(fp);
        consumeUrlIntent();
        console.error(e);
        // Sin IA: el lector local y la frase completa se conservan para corregir a mano.
        openReview({ spec: finalizeSpec(buildLocalSpec(q, { origen: ciudadOrigen || null }), q), aviso: "No pudimos interpretar todo tu mensaje. Guardamos tu texto completo: revisa lo que entendimos y corrígelo.", fp });
        setInterpretando(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Depende del id (no del objeto user, que cambia en cada refresh de token).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);


  // Borrador en pantalla: cuando Iato responde, su interpretación lo reemplaza conservando lo que la
  // persona editó; si falla o tarda más de 45 s, el borrador se queda como base (con su aviso). Tras una
  // recarga con el borrador guardado, la revisión se vuelve a pedir una vez (no usa búsquedas del plan).
  const draftToken = review?.draft?.token ?? null;
  useEffect(() => {
    const cur0 = reviewRef.current;
    if (!draftToken || !user || !cur0?.draft) return;
    let run = draftRuns.get(draftToken);
    if (!run) { run = revisarConIa(cur0.spec.consulta_original, user.id, cur0.draft.hints); draftRuns.set(draftToken, run); }
    let alive = true;
    const current = () => { const c = reviewRef.current; return alive && c?.draft?.token === draftToken ? c : null; };
    // El origen del perfil llega en un instante: completa el borrador si la persona no lo escribió.
    void run.ctx.then((c) => {
      const cur = current();
      if (!cur?.draft || cur.spec.origen || !c.origen) return;
      openReview({ ...cur, spec: setTripBasics(cur.spec, { origen: c.origen }), draft: { ...cur.draft, base: setTripBasics(cur.draft.base, { origen: c.origen }) } });
    });
    void run.result.then((r) => {
      const cur = current();
      if (!cur?.draft) return;
      draftRuns.delete(draftToken);
      if (r.ok) {
        const m = mergeDraftWithAi(cur.draft.base, cur.spec, r.spec, r.ctx);
        openReview({ spec: m.spec, aviso: r.aviso, fp: cur.fp, draft: null, nota: m.nota });
      } else {
        // Nunca se pierde lo escrito: el borrador (con sus ediciones y el texto original) queda como base.
        const spec = !cur.spec.origen && r.ctx.origen ? setTripBasics(cur.spec, { origen: r.ctx.origen }) : cur.spec;
        openReview({ spec, aviso: DRAFT_FAIL_AVISO, fp: cur.fp, draft: null, nota: null });
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftToken, user?.id]);

  if (interpretando) {
    return (
      <DashboardLayout>
        <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center">
          <SlowLoading active size="lg" className="mb-4" srLabel="Interpretando tu viaje">
            <motion.div
              role="status"
              aria-label="Interpretando tu viaje"
              animate={reduceMotion ? undefined : { rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
              className="w-14 h-14 rounded-full border-2 border-primary/30 border-t-primary mb-8"
            />
          </SlowLoading>
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
          <SlowLoading active size="lg" className="mb-4" srLabel="Eligiendo tu próximo destino">
            <motion.div
              animate={reduceMotion ? undefined : { scale: [1, 1.15, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2.2, repeat: Infinity }}
              className="w-16 h-16 rounded-full bg-gradient-gold flex items-center justify-center mb-8 gold-glow"
            >
              <Heart className="w-7 h-7 text-primary-foreground" />
            </motion.div>
          </SlowLoading>
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

  if (review) {
    // "Editar lo que escribí" y "Cancelar" vuelven al campo con el texto intacto (antes Cancelar lo borraba).
    const backToText = () => { const t = review.spec.consulta_original; if (review.fp) releaseIntent(review.fp); openReview(null); setDestino(t); };
    return (
      <DashboardLayout>
        <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12" data-testid="plan-revision">
          <button type="button" onClick={backToText}
            className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Editar lo que escribí
          </button>
          <h1 className="font-display text-2xl sm:text-3xl">Tu viaje, como lo entendimos</h1>
          <p className="mb-5 mt-1 text-sm text-muted-foreground">Revisa paradas, tramos y fechas. Nada se cotiza hasta que confirmes.</p>
          <TripSpecReview spec={review.spec} aviso={review.aviso} draft={!!review.draft} nota={review.nota ?? null}
            onChange={(sp) => openReview({ ...(reviewRef.current ?? review), spec: sp })}
            onConfirm={() => runSpec(review.spec, review.fp)} onCancel={backToText} />
        </div>
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
        canNext: () => destino.trim().length > 1 && refPending.length === 0,
        render: () => {
          const intent = detectRouteIntent(destino);
          const knownRoute = routeCities.length >= 2;
          const isMulti = !knownRoute && intent.mode === "multi" && intent.destinations.length >= 2;
          const sentence = !isMulti && !knownRoute && looksLikeSentence(destino);
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
              {knownRoute && (
                <div className="space-y-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-3.5 sm:p-4" data-testid="plan-multicity" data-country={routeCountry ?? ""}>
                  <p className="flex items-start gap-2 text-sm" role="status" data-testid="plan-multicity-entendimos">
                    <RouteIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    {routeCountry ? (
                      <span>Entendimos: <span className="font-medium">{routeCountry}{routeTotalNights ? ` · ${routeTotalNights} noches` : routeDays ? ` · ${routeDays} días` : ""}{textMonth ? ` · ${textMonth.label}` : ""}</span>.
                        {" "}Te proponemos: <span className="font-medium">{describeProposal(routeCities, routeNights && routeTotalNights ? routeNights : null)}</span>
                        <span className="text-muted-foreground">. ¿La armamos así?</span></span>
                    ) : (
                      <span>Entendimos: <span className="font-medium">{describeMultiCity({ cities: writtenRoute && !routeBase ? coverage.labels : routeCities, days: routeDays, nights: null })}</span>
                        <span className="text-muted-foreground"> · ¿lo armamos como ruta de {routeCities.length} ciudades?</span></span>
                    )}
                  </p>
                  {refPending.length > 0 && (
                    <ul className="space-y-2" data-testid="plan-multicity-pendientes">
                      {refPending.map((it) => {
                        const cands = (refPlaces.find((p) => p.input.toLowerCase() === it.text.toLowerCase())?.candidates ?? []).slice(0, 3);
                        const typed = refText[it.key] ?? "";
                        const useTyped = () => {
                          const list = typed.split(/\s*(?:,|;| y )\s*/).map((c) => c.trim()).filter(Boolean);
                          if (list.length) answerRef(it.key, { cities: list });
                        };
                        return (
                          <li key={it.key} className="rounded-xl border border-amber-400/30 bg-amber-400/[0.04] p-3" data-testid="plan-multicity-pendiente">
                            <p className="text-sm">
                              {it.suggested.length
                                ? <>«{it.text}»: te proponemos <span className="font-medium">{it.suggested.join(", ")}</span>. ¿Así, o qué ciudades quieres?</>
                                : <>No reconocimos «{it.text}»: ¿qué ciudad es?</>}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {it.suggested.length > 0 && (
                                <button type="button" data-testid="plan-pendiente-si" onClick={() => answerRef(it.key, { cities: it.suggested })}
                                  className="min-h-[36px] rounded-full border border-primary/60 bg-primary/10 px-3 text-xs text-primary hover:bg-primary/15">Sí, {it.suggested.join(", ")}</button>
                              )}
                              {cands.map((c) => (
                                <button key={c.label} type="button" onClick={() => answerRef(it.key, { cities: [c.name || c.label] })}
                                  className="min-h-[36px] rounded-full border border-border/70 px-3 text-xs hover:border-primary/50">{c.label}</button>
                              ))}
                              <button type="button" data-testid="plan-pendiente-quitar" onClick={() => answerRef(it.key, { excluir: true })}
                                className="min-h-[36px] rounded-full border border-border/70 px-3 text-xs text-muted-foreground hover:text-foreground">Quitar «{it.text}»</button>
                            </div>
                            <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); useTyped(); }}>
                              <Input aria-label={`Ciudades para ${it.text}`} placeholder={it.suggested.length ? "Otras ciudades (separadas por coma)" : "Escribe la ciudad"} value={typed}
                                onChange={(e) => setRefText((prev) => ({ ...prev, [it.key]: e.target.value }))} className="h-10 bg-input border-border" />
                              <Button type="submit" variant="outline" className="h-10 shrink-0" disabled={!typed.trim()}>Usar</Button>
                            </form>
                          </li>
                        );
                      })}
                      <li className="text-xs text-amber-400/90" role="status">Resuelve {refPending.length === 1 ? "este lugar" : "estos lugares"} para seguir: nada de lo que escribiste se quita sin que lo digas.</li>
                    </ul>
                  )}
                  {coverage.items.some((i) => i.excluded) && (
                    <p className="text-xs text-muted-foreground" data-testid="plan-multicity-excluidos">
                      Quitaste {coverage.items.filter((i) => i.excluded).map((i) => `«${i.text}»`).join(", ")}.{" "}
                      <button type="button" className="text-primary hover:underline" onClick={() => { setRefAnswers({}); setRouteEdit(null); }}>Deshacer</button>
                    </p>
                  )}
                  {routeCountry ? (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Ruta propuesta">
                      <button type="button" aria-pressed={routeOn && !routeAdjust && !pickOneCity} data-testid="plan-multicity-si"
                        onClick={() => { editRoute({ asRoute: true }); setRouteAdjust(false); setPickOneCity(false); }}
                        className={`${RADIO} ${routeOn && !routeAdjust && !pickOneCity ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                        Sí, armar esta ruta
                      </button>
                      <button type="button" aria-pressed={routeAdjust} data-testid="plan-multicity-ajustar"
                        onClick={() => { setRouteAdjust((v) => !v); setPickOneCity(false); }}
                        className={`${RADIO} ${routeAdjust ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                        Ajustar ruta
                      </button>
                      <button type="button" aria-pressed={pickOneCity} data-testid="plan-multicity-una"
                        onClick={() => { setPickOneCity((v) => !v); setRouteAdjust(false); }}
                        className={`${RADIO} ${pickOneCity ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                        Solo una ciudad
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="¿Ruta de varias ciudades?">
                      <button type="button" role="radio" aria-checked={routeOn} data-testid="plan-multicity-si"
                        onClick={() => editRoute({ asRoute: true })}
                        className={`${RADIO} ${routeOn ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                        Sí, ruta de {routeCities.length} ciudades
                      </button>
                      <button type="button" role="radio" aria-checked={!routeOn} data-testid="plan-multicity-no"
                        onClick={() => editRoute({ asRoute: false })}
                        className={`${RADIO} ${!routeOn ? "border-primary bg-primary/15 text-foreground" : "border-border/70 text-muted-foreground hover:border-primary/40"}`}>
                        No, solo {routeCities[0]}
                      </button>
                    </div>
                  )}
                  {pickOneCity && (
                    <div className="flex flex-wrap gap-2" data-testid="plan-multicity-elegir-una">
                      <p className="w-full text-xs text-muted-foreground">¿Cuál? El viaje se arma solo en esa ciudad.</p>
                      {distinctCities.map((c) => (
                        <button key={c} type="button" onClick={() => chooseOneCity(c)}
                          className="min-h-[40px] rounded-full border border-border/70 px-3.5 text-sm hover:border-primary/50">{c}</button>
                      ))}
                    </div>
                  )}
                  {routeOn && !pickOneCity && (routeCountry && !routeAdjust ? (
                    // Propuesta: cada ciudad con sus noches y por qué vale la pena.
                    <ol className="space-y-1.5" data-testid="plan-multicity-propuesta">
                      {routeCities.map((c, i) => (
                        <li key={`${c}-${i}`} className="rounded-xl border border-border/50 bg-surface/30 px-3 py-2">
                          <p className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{i + 1}. {c}</span>
                            {routeNights && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{routeNights[i]} {routeNights[i] === 1 ? "noche" : "noches"}</span>}</p>
                          {routeWhy?.[i] && <p className="mt-0.5 text-xs text-muted-foreground" data-testid="city-why">{routeWhy[i]}</p>}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <>
                      <CityNightsEditor cities={routeCities} nights={routeNights} onChange={(n) => editRoute({ nights: n })}
                        onMove={moveRouteCity} onRemove={removeRouteCity} notes={routeAdjust ? routeWhy : null}
                        pendingNote="Las noches por ciudad se reparten cuando elijas las fechas (siguiente paso)." />
                      {(routeAdjust || !routeCountry) && (
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addRouteCity(); }} data-testid="plan-multicity-agregar">
                          <Input aria-label="Agregar ciudad a la ruta" placeholder="Agregar ciudad (p. ej. Udaipur)" value={addCityText}
                            onChange={(e) => { setAddCityText(e.target.value); setAddCityError(null); }} className="h-11 bg-input border-border" />
                          <Button type="submit" variant="outline" className="h-11 shrink-0" disabled={!addCityText.trim()}>Agregar</Button>
                        </form>
                      )}
                      {addCityError && <p className="text-xs text-amber-400/90" role="alert">{addCityError}</p>}
                    </>
                  ))}
                  {parsedRoute.unknown.length > 0 && !writtenRoute && (
                    <p className="text-xs text-amber-400/90" data-testid="plan-multicity-desconocidas">
                      No reconocimos {parsedRoute.unknown.map((u) => `«${u}»`).join(", ")} como ciudad y no la agregamos. Escríbela de otra forma si va en tu ruta.
                    </p>
                  )}
                </div>
              )}
              {!knownRoute && parsedRoute.countries.length > 0 && (parsedRoute.countries.length > 1 || parsedRoute.cities.length > 0 || !countryRouteFor(parsedRoute.countries[0])) && (
                <p className="text-xs text-amber-400/90" role="status" data-testid="plan-multicity-paises">
                  {parsedRoute.countries.map((c) => `«${c}»`).join(", ")} {parsedRoute.countries.length === 1 ? "es un país" : "son países"}: escribe las ciudades (p. ej. «París, Roma y Atenas») para armar la ruta.
                </p>
              )}
              {destino.trim().length > 1 && !knownRoute && (
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
              {complexText && destino.trim().length > 3 && (
                <button type="button" onClick={interpretNow} data-testid="plan-interpretar-completo"
                  className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3.5 text-xs text-primary hover:bg-primary/15">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Tu viaje trae crucero, tramos o regreso por otra ciudad: deja que Iato lo lea completo
                </button>
              )}
              {roadTrip.route && (
                <Link to={routePlannerPath(roadTrip.route, roadTrip.days)} data-testid="plan-roadtrip-chip"
                  className="ml-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border bg-primary/10 border-primary/40 text-primary">
                  <Car className="w-3.5 h-3.5" aria-hidden="true" /> Road trip en coche: {roadTrip.route.name} →
                </Link>
              )}
              {sentence && !understood && !roadTrip.route && !parsedRoute.countries.length && (
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
      canNext: () => !!fechaSalida && !!fechaRegreso && fechaRegreso > fechaSalida && !!ciudadOrigen && !routeTooShort,
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
          {routeOn && (
            <div className="rounded-2xl border border-border/60 bg-surface/30 p-3.5" data-testid="plan-multicity-noches">
              <CityNightsEditor cities={routeCities} nights={routeNights} onChange={(n) => editRoute({ nights: n })}
                onMove={moveRouteCity} pendingNote="Elige salida y regreso para repartir las noches." />
              {routeTooShort && (
                <p className="mt-2 text-xs text-amber-400/90" role="alert" data-testid="plan-multicity-corto">
                  Tus fechas dan {datesNights} {datesNights === 1 ? "noche" : "noches"}: no alcanzan para {routeCities.length} ciudades (mínimo 1 noche en cada una). Cambia el regreso o quita una ciudad.
                </p>
              )}
            </div>
          )}
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
    if (step === 0 && !isEmocionMode && routeOn) {
      // Ruta de varias ciudades: el campo queda como "París → Roma → Atenas"; fechas y viajeros de la frase.
      const label = routeCities.join(" → ");
      const fb = parseTripFallback(destino);
      setRouteEdit({ text: label, cities: routeCities, nights: routeBase?.nights ?? null, asRoute: true, days: routeDays,
        textNights: routeBase?.textNights ?? parsedRoute.nights, country: routeCountry, edited: routeBase?.edited ?? false });
      setTextNights(fb.fechaSalida && fb.fechaRegreso ? null : routeBase?.textNights ?? parsedRoute.nights);
      if (parsedRoute.origin) setCiudadOrigen(parsedRoute.origin);
      if (fb.fechaSalida && fb.fechaRegreso) { setFechaSalida(fb.fechaSalida); setFechaRegreso(fb.fechaRegreso); }
      if (fb.viajeros && fb.viajeros >= 1 && fb.viajeros <= 20) setNumViajeros(fb.viajeros);
      setDestino(label);
      const mes = textMonth && !(fb.fechaSalida && fb.fechaRegreso) ? textMonth : null;
      const cuando = mes ? ` Elige tu salida en ${mes.label}${routeDays ? `; el regreso se pone solo (${routeDays} días)` : ""}.` : "";
      setStepNotice(routeCountry
        ? `Entendimos: ${routeCountry}${routeDays ? ` · ${routeDays} días` : ""}${mes ? ` · ${mes.label}` : ""}. Te proponemos ${describeProposal(routeCities, null)}. Elige las fechas y repartimos las noches.${cuando}`
        : `Entendimos: ${describeMultiCity({ cities: routeCities, days: routeDays, nights: null })}${mes ? ` · ${mes.label}` : ""}. Elige las fechas y repartimos las noches entre las ${routeCities.length} ciudades.${cuando}`);
      setStep(step + 1);
      return;
    }
    if (step === 0 && !isEmocionMode && routeCities.length >= 2 && !routeOn) {
      // "No, solo París": un destino, con lo demás de la frase (duración, viajeros).
      setDestino(routeCities[0]);
      setRouteEdit(null);
      setTextNights(parsedRoute.nights);
      setStepNotice(`Entendimos: ${routeCities[0]}${routeDays ? ` · ${routeDays} días` : ""}. Revisa y ajusta lo que necesites.`);
      setStep(step + 1);
      return;
    }
    if (step === 0 && !isEmocionMode) {
      const u = understandPlanText(destino);
      setTextNights(u?.nights ?? null);
      if (u?.destino) {
        setDestino(u.destino);
        if (u.fechaSalida && u.fechaRegreso) { setFechaSalida(u.fechaSalida); setFechaRegreso(u.fechaRegreso); }
        if (u.viajeros) setNumViajeros(u.viajeros);
        const mes = !(u.fechaSalida && u.fechaRegreso) ? monthOfText(destino) : null;
        const dias = u.nights && !(u.fechaSalida && u.fechaRegreso) ? ` · ${u.nights + 1} días` : "";
        setStepNotice(`Entendimos: ${describeUnderstood(u)}${dias}${mes ? ` · ${mes.label}` : ""}. ${mes ? `Elige tu salida en ${mes.label}${dias ? "; el regreso se pone solo" : ""}. ` : ""}Revisa y ajusta lo que necesites.`);
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
                      {isEmocionMode ? "Empezar análisis" : routeOn ? `Generar ruta de ${distinctCities.length} ciudades` : "Armar mi viaje"}
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
                destinations={routeOn ? routeCities : undefined}
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
