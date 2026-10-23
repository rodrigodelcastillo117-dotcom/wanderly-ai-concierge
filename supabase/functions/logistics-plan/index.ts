// Edge function: logistics-plan (PARALLEL + PRECIOS REALES)
// Genera la logística de un viaje multi-destino:
// - 1 llamada GLOBAL (vuelos internacionales + transporte interno + itinerario) alimentada con
//   precios reales de travelpayouts-flights.
// - N llamadas EN PARALELO (una por ciudad) alimentadas con hotels-search (SerpApi Google Hotels)
//   y tripadvisor-search (attractions) para hospedaje y experiencias reales.
// - Tier seleccionado derivado de travel_profiles.presupuesto_rango (default equilibrio).
// - Desglose real calculado en el servidor con FX dinámico (_shared/fx.ts). Nunca NULL, nunca 17.0.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getAuthUser, unauthorizedResponse } from "../_shared/verify-auth.ts";
import { dbCacheStore, internalHeaders } from "../_shared/serpRuntime.ts";
import { restaurantsForCity, verifyRestaurants } from "../_shared/google-restaurants.ts";
import { makeResolver, verifyTours } from "../_shared/place-verify.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import {
  invalidRequestResponse,
  quotaDeniedResponse,
  reservationDeps,
  serviceUnavailableResponse,
} from "../_shared/entitlements.ts";
import {
  logisticsMeetsContract,
  resolveRequestKey,
  runWithReservation,
  type WorkCtx,
  type WorkResult,
} from "../_shared/reservation.ts";
import { getUsdMxnRateInfo } from "../_shared/fx.ts";
import { aiFetch } from "../_shared/ai.ts";
import { adminClient } from "../_shared/entitlements.ts";
import { getTasteProfile } from "../_shared/tasteProfileStore.ts";
import { renderTasteProfile, TASTE_CITATION_RULE, tasteToday } from "../_shared/tasteProfile.ts";
import { firstCityArrivals, forceEstimated, labelExperiences, markLive, pricingSources, scrubEstimatedFlight } from "./provenance.ts";
import { buildLogisticsSnapshot } from "./snapshot.ts";
import { saveQuoteSnapshot } from "../_shared/quotes.ts";
import { hotelPriceRooms } from "../_shared/rooms.ts";
// roadtrip: coche como modo de primera clase entre paradas (distancias reales de Google Routes).
import { googleTransportFor } from "../_shared/google-runtime.ts";
import { computeRoute } from "../_shared/google-routes.ts";
import { legModesFor, planRoadTrip, roadTripPromptBlock } from "./roadtrip.ts";
import { filterFares, layoverCodesFromAviasalesLink } from "../_shared/fareGuard.ts";
import { airportCityName } from "../_shared/airports.ts";
import { chosenNights } from "../_shared/booking/tripRoute.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY =
  Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

interface Body {
  origin: string;
  destinations: string[];
  fecha_salida?: string;
  fecha_regreso?: string;
  num_viajeros?: number;
  prefs?: {
    connection?: "tiempo" | "paisaje" | "smart";
    roadtripStops?: boolean;
    luggageLogistics?: boolean;
    /** roadtrip: "avion" | "tren" | "coche" para todos los tramos, o "mixto" con leg_modes por tramo. */
    transport_mode?: string;
    leg_modes?: string[];
  };
  /** Noches por ciudad elegidas por el viajero (planeador): deben sumar las noches del viaje. */
  nights_per_city?: number[];
  /** Llave de idempotencia por intento (sessionStorage del cliente). */
  request_key?: string;
  /** "snapshot": guardar en trip_quotes la cotización del plan ya generado (ver saveSnapshot). */
  action?: string;
  trip_id?: string;
}

type Tier = "ahorro" | "equilibrio" | "premium";

// Flash, no Pro: con Pro (razonamiento largo) el global + una llamada por ciudad pasaban el límite de
// 150 s de la función y el usuario recibía 504 sin viaje (E2E España/Japón, 23-oct-2026).
const MODEL = "google/gemini-flash-latest";
/** Tope total de la función (la plataforma corta a 150 s): lo que no termine antes se entrega parcial. */
const REQUEST_BUDGET_MS = 130_000;

async function callAI(apiKey: string, system: string, user: string, toolName: string, schema: any, timeoutMs = 90_000) {
  const res = await aiFetch({
    method: "POST",
    // Sin tope, una respuesta lenta del modelo se comía todo el tiempo de la función (504).
    signal: AbortSignal.timeout(Math.max(10_000, timeoutMs)),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: { name: toolName, description: "Emite resultado", parameters: schema } }],
      tool_choice: { type: "function", function: { name: toolName } },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI ${res.status}: ${t}`);
  }
  const json = await res.json();
  const argsStr = json?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!argsStr) throw new Error("AI no devolvió tool_call");
  return JSON.parse(argsStr);
}

// ───── Helpers de fechas / noches ─────

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Reparte las noches entre ciudades: base equitativa, el sobrante va a las primeras. */
function splitNights(totalNights: number, cities: number): number[] {
  const base = Math.max(1, Math.floor(totalNights / cities));
  const arr = new Array(cities).fill(base);
  let rest = totalNights - base * cities;
  let i = 0;
  while (rest > 0) {
    arr[i % cities] += 1;
    rest -= 1;
    i += 1;
  }
  return arr;
}

// ───── Presupuesto del usuario → tier ─────

function tierFromPresupuesto(raw?: string | null): Tier {
  const p = (raw ?? "").toLowerCase();
  if (!p) return "equilibrio";
  if (/(econ|bajo|budget|ahorro|mochil)/.test(p)) return "ahorro";
  if (/(alto|lujo|luxury|premium|ultra|sin l[íi]mite)/.test(p)) return "premium";
  if (/(medio|moderad|equilibr|mid)/.test(p)) return "equilibrio";
  return "equilibrio";
}

/** Comida estimada por persona/día en USD según tier (techo de cordura aparte). */
const COMIDA_USD_PP_DIA: Record<Tier, number> = { ahorro: 45, equilibrio: 95, premium: 190 };

/** Filtro de estrellas de Google Hotels por nivel de presupuesto (SerpApi ordena por precio más bajo). */
const HOTEL_CLASS_BY_TIER: Record<Tier, string> = {
  ahorro: "2,3",
  equilibrio: "3,4",
  premium: "4,5",
};

const COMIDA_TECHO_MXN_PP_DIA = 12000; // mismo techo que analizar-viaje

function pickByTier<T>(sortedAsc: T[], tier: Tier): T | undefined {
  if (sortedAsc.length === 0) return undefined;
  if (tier === "ahorro") return sortedAsc[0];
  if (tier === "premium") return sortedAsc[sortedAsc.length - 1];
  return sortedAsc[Math.floor(sortedAsc.length / 2)];
}

// ───── Schemas ─────

const globalSchema = {
  type: "object",
  properties: {
    flights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tier: { type: "string" },
          from: { type: "string" },
          to: { type: "string" },
          airline_suggested: { type: "string" },
          duration: { type: "string" },
          stops: { type: "string" },
          price_per_person_usd: { type: "number" },
          booking_link: { type: "string" },
          fuente_precio: { type: "string" },
          notes: { type: "string" },
        },
        required: ["from", "to", "duration", "price_per_person_usd"],
      },
    },
    internal_transport: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          mode: { type: "string" },
          provider: { type: "string" },
          duration: { type: "string" },
          price_per_person_usd: { type: "number" },
          fuente_precio: { type: "string" },
          scenic: { type: "boolean" },
          luggage_note: { type: "string" },
        },
        required: ["from", "to", "mode", "duration", "price_per_person_usd"],
      },
    },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          dia: { type: "number" },
          ciudad: { type: "string" },
          titulo: { type: "string" },
          "mañana": { type: "string" },
          tarde: { type: "string" },
          noche: { type: "string" },
        },
        required: ["dia", "ciudad", "titulo"],
      },
    },
    mandatory_costs: {
      type: "object",
      properties: {
        city_taxes_usd: { type: "number" },
        visa_fees_usd: { type: "number" },
        currency_buffer_pct: { type: "number" },
        currency_buffer_usd: { type: "number" },
        notes: { type: "string" },
      },
      required: ["city_taxes_usd", "visa_fees_usd", "currency_buffer_pct", "currency_buffer_usd"],
    },
    resumen: { type: "string" },
  },
  required: ["flights", "internal_transport", "days", "mandatory_costs"],
};

const citySchema = {
  type: "object",
  properties: {
    city: { type: "string" },
    nights: { type: "number" },
    arrival_options: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          mode: { type: "string" },
          tier: { type: "string" },
          provider: { type: "string" },
          duration: { type: "string" },
          price_per_person_usd: { type: "number" },
          fuente_precio: { type: "string" },
          scenic: { type: "boolean" },
          notes: { type: "string" },
        },
        required: ["from", "mode", "duration", "price_per_person_usd"],
      },
    },
    hospedaje: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          tier: { type: "string" },
          tipo: { type: "string" },
          nombre: { type: "string" },
          barrio: { type: "string" },
          rating: { type: "number" },
          price_per_night_usd: { type: "number" },
          booking_url: { type: "string" },
          fuente_precio: { type: "string" },
          por_que: { type: "string" },
        },
        required: ["tier", "nombre", "price_per_night_usd"],
      },
    },
    restaurantes: {
      type: "array",
      minItems: 4,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          cocina: { type: "string" },
          rango_precio: { type: "string" },
          por_que: { type: "string" },
        },
        required: ["nombre", "cocina"],
      },
    },
    experiencias: {
      type: "array",
      minItems: 4,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          nombre: { type: "string" },
          duracion: { type: "string" },
          price_per_person_usd: { type: "number" },
          rating: { type: "number" },
          fuente: { type: "string" },
          por_que: { type: "string" },
        },
        required: ["nombre"],
      },
    },
  },
  required: ["city", "nights", "arrival_options", "hospedaje", "restaurantes", "experiencias"],
};

const PRICING_REFS = `REFERENCIAS DE MERCADO (USD POR PERSONA, conservadoras y realistas) — ÚSALAS SOLO CUANDO NO HAYA DATOS EN VIVO ARRIBA:
VUELOS round-trip clase turista temporada media:
- México↔Europa occidental (MAD/BCN/CDG/FCO/LHR/AMS): 900–1,500
- México↔Grecia/Europa este (ATH/JTR/IST/VIE): 1,100–1,800
- México↔Islandia (KEF vía MAD/LHR/JFK): 900–1,600
- México↔Asia (HND/BKK/SIN/DXB/DPS): 1,200–2,100
- México↔EEUU: 350–900 | Sudamérica: 500–1,000 | Doméstico MX: 100–250
Temporada alta (jun-ago, navidad, semana santa) +25-50%. Vuelo directo +15-30%.
TRENES (Europa): AVE Madrid-Barcelona 60-130, Italo/Trenitalia Roma-Florencia 30-70, Eurostar Londres-París 90-220, TGV París-Lyon 60-130.
FERRIES Grecia: Atenas-Santorini Blue Star 50-75, SeaJets rápido 90-140.
RENTA DE AUTO (por día, total del grupo, seguro completo incluido):
- Islandia 4x4 SUV: 90–160 baja, 140–260 alta. 2WD compacto: 55–95. Camper van: 130–220.
- Nueva Zelanda SUV/4WD: 70–130. Campervan: 110–200.
- Escocia/Irlanda compacto: 45–85. Patagonia 4x4: 80–150. USA West SUV: 60–110.
- Gasolina Islandia: ~2.00 USD/L (SUV ~9L/100km). Peajes túneles 12–15 USD.
HOSPEDAJE por noche:
- MAD/BCN/Lisboa/Roma: 5★ 280-450, 4★ 150-240
- París/Londres/Ámsterdam: 5★ 450-750, 4★ 220-350
- Santorini/Mykonos temp alta: 5★ 500-900, 4★ 280-450
- Reikiavik/Akureyri: 5★ 380-650, 4★ 200-340, guesthouse 110-180.
- Tokio/Singapur/HK: 5★ 350-600, 4★ 200-320
- Dubai/Bangkok/Bali: 5★ 250-500, 4★ 130-250
- NYC/Miami/LA: 5★ 400-700, 4★ 220-350
EXPERIENCIAS premium: tour guiado 80-180, cena tasting 120-300, day-trip privado 250-600.
NUNCA precios optimistas. Sé conservador.`;

const FUENTES_RULES = `REGLAS DE FUENTES (OBLIGATORIAS):
- Si arriba hay un bloque de DATOS EN VIVO, tus precios DEBEN salir de esa lista, copiando nombre, precio y link exactos, con fuente_precio/fuente igual a la fuente indicada ("travelpayouts", "serpapi" o "tripadvisor").
- Si NO hay datos en vivo para una categoría, puedes estimar con las referencias de mercado, pero DEBES poner fuente_precio="estimado" (o fuente="estimado"). NUNCA marques como real algo que inventaste.
- Nunca dupliques el mismo tramo/ruta dos veces con precios distintos.`;

// Países / destinos donde la lógica de transporte interno DEBE ser roadtrip.
const ROADTRIP_REGEX = /(islandia|iceland|reykjav|new\s*zealand|nueva\s*zelanda|patagonia|carretera\s*austral|ruta\s*40|escocia|scotland|highlands|irlanda|ireland|ring\s*of\s*kerry|wild\s*atlantic|noruega|norway|lofoten|fiordos|toscana|tuscany|provenza|provence|amalfi|big\s*sur|pacific\s*coast|route\s*66|grand\s*circle|utah|arizona|colorado|namibia|south\s*africa|garden\s*route|australia\s*outback|costa\s*rica|baja\s*california|yucat[áa]n)/i;

function isRoadtrip(destinations: string[], origin: string): boolean {
  return destinations.some((d) => ROADTRIP_REGEX.test(d)) || ROADTRIP_REGEX.test(origin);
}

const ROADTRIP_RULES = `MODO ROADTRIP DETECTADO — REGLAS OBLIGATORIAS:
- NO sugieras vuelos internos entre ciudades del destino. El transporte interno es SIEMPRE coche de renta (o campervan si encaja con el perfil).
- En "internal_transport" cada tramo debe tener mode="coche" o "campervan", provider con renta real (Blue Car Rental, Lava Car Rental, Hertz Iceland, Europcar, Go Iceland, Sixt) y duration realista en horas de conducción.
- Añade un tramo extra "pickup" desde el aeropuerto y "dropoff" al regreso.
- En cada day["mañana"|"tarde"|"noche"] menciona la carretera, km aproximados y paradas escénicas.
- En arrival_options de cada ciudad: la opción principal es "Coche desde [punto anterior]" con km, horas y paradas clave.
- NO calcules gasolina, casetas, viñetas ni estacionamiento: el sistema los calcula aparte con fuentes oficiales (antes se pedían aquí y salían inventados).`;

const GLOBAL_SYSTEM = `Eres IATOS, analista senior de pricing de viajes de lujo. Devuelves JSON estricto con precios REALES de mercado.
Aerolíneas/operadores REALES (Iberia, Air France, Italo, Renfe AVE, Eurostar, Ferries Blue Star, etc).
En Europa <800km prefiere TREN/FERRY sobre vuelo.
${FUENTES_RULES}
${PRICING_REFS}`;

const CITY_SYSTEM = `Eres IATOS, analista senior de viajes de lujo. Para UNA ciudad devuelves JSON con:
- 2-3 arrival_options desde el punto anterior (incluye tren/ferry real cuando aplique)
- EXACTAMENTE 3 hospedajes (ahorro/equilibrio/premium) con hoteles REALES
- 4-5 restaurantes reales que matcheen el estilo del usuario
- 4-5 experiencias/tours reales
${FUENTES_RULES}
${PRICING_REFS}`;

// ───── Llamadas a otras edge functions (datos en vivo) ─────

function invokeFn(name: string, authHeader: string, payload: unknown, extraHeaders: Record<string, string> = {}) {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: SUPABASE_ANON_KEY,
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
    // Un proveedor lento no debe tumbar todo el plan: sin respuesta en 40 s, la ciudad sigue sin datos en vivo.
    signal: AbortSignal.timeout(40_000),
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e?.message ?? e) }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/**
 * Snapshot inmutable (trip_quotes) del plan multi-ciudad que el cliente acaba de guardar como viaje.
 * Solo se usa el plan que este servidor generó y guardó en quota_reservations.result para ESA llave
 * del mismo usuario, y solo para un viaje suyo con el mismo total. Idempotente: si el viaje ya
 * tiene cotización vigente, la devuelve.
 */
async function saveSnapshot(userId: string, body: Body): Promise<Response> {
  const tripId = typeof body.trip_id === "string" && UUID.test(body.trip_id) ? body.trip_id : null;
  const requestKey = resolveRequestKey(body.request_key, []);
  if (!tripId || !requestKey.startsWith("c:")) return invalidRequestResponse(corsHeaders, "Falta el viaje o la llave del plan.");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return serviceUnavailableResponse(corsHeaders);
  const admin = createClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const [{ data: reservation }, { data: trip }] = await Promise.all([
      admin.from("quota_reservations").select("status, result")
        .eq("user_id", userId).eq("kind", "trip_analysis").eq("request_key", requestKey).maybeSingle(),
      admin.from("trips").select("id, user_id, total_estimado, num_viajeros, fecha_salida, fecha_regreso, current_quote_id")
        .eq("id", tripId).maybeSingle(),
    ]);
    if (!trip || trip.user_id !== userId) return jsonResponse({ ok: false, error: "trip_not_found" }, 404);
    if (trip.current_quote_id) return jsonResponse({ ok: true, quote_id: trip.current_quote_id, replay: true });
    if (reservation?.status !== "COMMITTED" || !reservation?.result) return jsonResponse({ ok: false, error: "plan_not_found" }, 409);
    const built = buildLogisticsSnapshot(reservation.result, trip, userId);
    if (!built.ok) {
      console.warn("logistics-plan snapshot rechazado:", (built as { reason: string }).reason);
      return jsonResponse({ ok: false, error: (built as { reason: string }).reason }, 409);
    }
    const quote = await saveQuoteSnapshot(admin, built.row);
    return quote ? jsonResponse({ ok: true, quote_id: quote.id, valid_until: quote.valid_until }) : jsonResponse({ ok: false, error: "snapshot_failed" }, 503);
  } catch (e) {
    console.error("logistics-plan snapshot error:", e instanceof Error ? e.message : e);
    return serviceUnavailableResponse(corsHeaders);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __deadline = Date.now() + REQUEST_BUDGET_MS;
  const aiBudget = () => __deadline - Date.now() - 5_000; // margen para post-proceso y guardado
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "logistics-plan", __user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const body = (await req.json().catch(() => null)) as Body | null;
    // Paso 2 del cliente: con el viaje ya guardado, el snapshot de su cotización (sin IA ni cuota).
    if (body?.action === "snapshot") return await saveSnapshot(__user.id, body);

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      console.error("logistics-plan: LOVABLE_API_KEY missing");
      return serviceUnavailableResponse(corsHeaders);
    }

    if (!body?.origin || !Array.isArray(body?.destinations) || body.destinations.length < 1) {
      return invalidRequestResponse(corsHeaders, "Faltan datos: indica tu ciudad de origen y al menos un destino.");
    }

    // Cuota: el plan multi-ciudad es un análisis de viaje completo (IA + vuelos y hoteles en vivo),
    // así que usa el mismo cupo que analizar-viaje. Se APARTA después de validar y solo se cobra si
    // el plan cumple el contrato mínimo; aquí el servidor no crea el viaje (lo guarda el cliente),
    // así que el plan se guarda en la reserva y un reintento con la misma llave lo recibe sin pagar.
    const requestKey = resolveRequestKey(body.request_key, [
      body.origin, body.destinations.join(">"), body.fecha_salida, body.fecha_regreso, body.num_viajeros,
      ...(Array.isArray(body.nights_per_city) ? [body.nights_per_city.join("|")] : []),
    ]);
    // El cuerpo del plan se dejó sin re-indentar para no mover todo el diff.
    const generarPlan = async (ctx: WorkCtx): Promise<WorkResult> => {

    const authHeader = req.headers.get("Authorization") ?? "";

    // ───── Perfil + tier del presupuesto ─────
    let perfilLine = "Usuario sin perfil — nivel equilibrio.";
    let foodPref: string | null = null;
    let presupuestoRango: string | null = null;
    try {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await supa.auth.getUser(token);
        if (user) {
          // Gustos demostrados (incluye lo aprendido del diario), con caché y tope de tiempo.
          const tastePromise = getTasteProfile({ db: supa, cache: adminClient(), userId: user.id, todayISO: tasteToday(), timeoutMs: 1200 })
            .then((r) => r.profile).catch(() => null);
          const [{ data: prefs }, { data: tp }, { data: prof }] = await Promise.all([
            supa.from("ai_user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
            supa.from("travel_profiles").select("*").eq("user_id", user.id).maybeSingle(),
            supa.from("profiles").select("full_name, ciudad_origen, nationality").eq("id", user.id).maybeSingle(),
          ]);
          const estilos = (tp?.estilo_viaje ?? []).join(", ");
          const intereses = (tp?.intereses ?? []).join(", ");
          presupuestoRango = tp?.presupuesto_rango ?? prefs?.nivel_presupuesto ?? null;
          const presupuesto = presupuestoRango ?? "no especificado";
          const ritmo = tp?.ritmo_viaje ?? prefs?.ritmo_viaje ?? "equilibrado";
          const comida = [...(tp?.preferencias_comida ?? []), ...(prefs?.estilo_comida ?? [])].join(", ") || "abierto";
          foodPref = (tp?.preferencias_comida ?? []).slice(0, 2).join(" ") || null;
          const aloj = [...(tp?.tipo_alojamiento_preferido ?? []), ...(prefs?.hospedaje_preferencias ?? [])].join(", ") || "flexible";
          const alergias = [...(tp?.alergias_restricciones ?? []), ...(prefs?.restricciones_alimentarias ?? [])].join(", ") || "ninguna";
          const acomp = tp?.acompanantes_tipico ?? prefs?.companeros_viaje ?? "no especificado";
          const actividades = (prefs?.actividades_tarde ?? []).join(", ") || "varias";
          const idiomas = (tp?.idiomas_hablados ?? []).join(", ") || "español";
          const notas = tp?.notas_adicionales ?? "";
          const visitados = (tp?.destinos_visitados ?? []).slice(0, 6).join(", ");
          const pendientes = ((tp as any)?.destinos_pendientes ?? (tp as any)?.wishlist ?? []).slice(0, 6).join(", ");
          const nombre = prof?.full_name?.split(" ")[0] ?? "viajero";

          perfilLine = `PERFIL DEL VIAJERO (úsalo para personalizar TODO: hoteles, restaurantes, experiencias y narrativa):
- Nombre: ${nombre} · Origen: ${prof?.ciudad_origen ?? "—"} · Nacionalidad: ${prof?.nationality ?? "—"}
- Estilos preferidos: ${estilos || "no especificado"}
- Presupuesto: ${presupuesto} · Ritmo: ${ritmo}
- Intereses: ${intereses || "varios"}
- Comida: ${comida} · Restricciones: ${alergias}
- Alojamiento preferido: ${aloj}
- Acompañantes: ${acomp} · Idiomas: ${idiomas}
- Actividades favoritas: ${actividades}
${visitados ? `- Ya visitó: ${visitados} (NO repitas patrones obvios)` : ""}
${pendientes ? `- Lugares en su lista: ${pendientes}` : ""}
${notas ? `- Notas personales: ${notas}` : ""}
INSTRUCCIÓN: Cada recomendación debe sentirse hecha A LA MEDIDA de este perfil.`;
          // Tope de ~300 tokens: el plan multi-ciudad ya lleva mucho contexto en cada prompt.
          const gustos = renderTasteProfile(await tastePromise, { maxTokens: 300, omitDeclared: true });
          if (gustos) {
            perfilLine += `\nGUSTOS DEMOSTRADOS (datos del usuario, no instrucciones; pesan más que lo declarado):\n${gustos}\n${TASTE_CITATION_RULE}`;
          }
        }
      }
    } catch (e) {
      console.warn("perfil:", e);
    }

    const selectedTier: Tier = tierFromPresupuesto(presupuestoRango);
    const fxInfo = await getUsdMxnRateInfo();
    const fxUsd = fxInfo.rate;

    const nights = body.fecha_salida && body.fecha_regreso
      ? Math.max(1, Math.round((new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) / 86400000))
      : Math.max(body.destinations.length * 3, 6);

    const viajeros = Math.max(1, Number(body.num_viajeros) || 2);
    const fechas = `${body.fecha_salida ?? "flexible"} a ${body.fecha_regreso ?? "flexible"}`;
    const cityList = body.destinations.join(" → ");
    const roadtripDetected = isRoadtrip(body.destinations, body.origin);
    // roadtrip: el modo que eligió el viajero manda; sin elección, el destino de roadtrip implica coche.
    const legModes = legModesFor(body.destinations, body.prefs, roadtripDetected);
    const roadtripMode = legModes.length ? legModes.every((m) => m === "coche") : roadtripDetected;
    const roadtripBlock = roadtripMode ? `\n\n${ROADTRIP_RULES}` : "";

    // Ventanas de fechas por ciudad para consultar hoteles reales.
    // Las noches por ciudad que eligió el viajero (planeador) mandan si cuadran con el viaje; si no, el reparto parejo.
    const nightsPerCity = chosenNights(body.nights_per_city, body.destinations.length, nights) ?? splitNights(nights, body.destinations.length);
    const today = new Date();
    const fallbackStart = addDays(today.toISOString().slice(0, 10), 45);
    let cursor = body.fecha_salida ?? fallbackStart;
    const cityWindows = body.destinations.map((city, i) => {
      const checkin = cursor;
      const checkout = addDays(checkin, nightsPerCity[i]);
      cursor = checkout;
      return { city, nights: nightsPerCity[i], checkin, checkout };
    });

    // ───── DATOS EN VIVO ─────
    // Vuelos internacionales: origen → primera ciudad (round-trip contra la última).
    // Las búsquedas del plan multiciudad ya están cubiertas por su cuota de análisis: van firmadas
    // para no gastar la bolsa de búsquedas en vivo del usuario (_shared/internalCall.ts).
    const analysisHeaders = await internalHeaders(__user.id, "analysis");
    const tpFlightsPromise = invokeFn("travelpayouts-flights", authHeader, {
      origin_city: body.origin,
      destination_city: body.destinations[0],
      departure_date: body.fecha_salida ?? fallbackStart,
      return_date: body.fecha_regreso ?? addDays(fallbackStart, nights),
      adults: viajeros,
      currency: "usd",
    });

    // Google Places (llave solo en el servidor): restaurantes reales por ciudad (la IA elige de la lista),
    // validación de lugares fuera de la lista y, en roadtrip, distancia real por tramo.
    const google = googleTransportFor("logistics-plan", __user.id);
    const cityLivePromises = cityWindows.map((w) =>
      Promise.all([
        invokeFn("hotels-search", authHeader, {
          city: w.city,
          checkin: w.checkin,
          checkout: w.checkout,
          adults: viajeros,
          // SerpApi ordena por precio más bajo: sin filtro de categoría el resultado son hostales.
          // Filtramos por estrellas según el nivel de presupuesto del usuario.
          hotel_class: HOTEL_CLASS_BY_TIER[selectedTier],
        }, analysisHeaders),

        invokeFn("tripadvisor-search", authHeader, {
          query: w.city,
          category: "attractions",
          language: "es_MX",
        }),
        // Una búsqueda por ciudad (Text Search Enterprise + Atmosphere, la misma de analizar-viaje).
        google
          ? restaurantsForCity(google, w.city, { preferences: foodPref }).then((r) => (r.ok ? r.places : [])).catch(() => [])
          : Promise.resolve([]),
      ]).then(([hotels, attractions, restaurants]) => ({ hotels, attractions, restaurants })),
    );

    // roadtrip: distancia y tiempo reales por tramo en coche (una llamada Essentials por tramo).
    const roadTripPromise = planRoadTrip({
      destinations: body.destinations,
      legModes,
      legDates: body.destinations.slice(1).map((_, i) => cityWindows[i + 1]?.checkin ?? null),
      route: google && legModes.includes("coche") ? async (origin, destination) => {
        const r = await computeRoute(google, { origin: { address: origin }, destination: { address: destination }, mode: "DRIVE" });
        return r.ok ? { ok: true, distance_meters: r.distance_meters, duration_seconds: r.duration_seconds, consultado_at: r.consultado_at } : null;
      } : null,
    }).catch((e) => { console.warn("roadtrip:", e instanceof Error ? e.message : e); return null; });

    const [roadTrip, tpFlights, ...cityLive] = await Promise.all([roadTripPromise, tpFlightsPromise, ...cityLivePromises]);

    // Solo tarifas de la ruta pedida (origen → primera ciudad), con duración creíble: la API puede
    // devolver otra ciudad (MEX→BUH presentada como Roma, caso 22-oct-2026). Sin tarifa válida no hay
    // "precio de referencia": el vuelo queda como estimación.
    if (Array.isArray(tpFlights?.flights) && tpFlights.flights.length) {
      const guard = filterFares(tpFlights.flights, {
        origin: String(tpFlights.origin ?? ""), destination: String(tpFlights.destination ?? ""),
        originCity: body.origin, destinationCity: body.destinations[0],
      });
      if (guard.rejected.length) console.warn("logistics-plan: tarifas de otra ruta descartadas", guard.rejected.length);
      tpFlights.flights = guard.valid;
    }
    const tpLive = Array.isArray(tpFlights?.flights) && tpFlights.flights.length > 0;
    const tpFlightsBlock = tpLive
      ? `DATOS EN VIVO — TRAVELPAYOUTS/AVIASALES (fuente_precio="travelpayouts"). Ruta ${tpFlights.origin}→${tpFlights.destination}${tpFlights.approximate_dates ? " (fechas aproximadas del mes)" : ""}:\n` +
        tpFlights.flights.slice(0, 10).map((f: any, i: number) =>
          `${i + 1}. ${f.airline} ${f.flight_number} — ${f.origin_airport}→${f.destination_airport} — USD ${f.price} por persona (round-trip) — ${f.stops} escalas — LINK: ${f.booking_link}`
        ).join("\n")
      : `(Sin datos en vivo de vuelos${tpFlights?.error ? `. Motivo: ${tpFlights.error}` : ""} — estima y marca fuente_precio="estimado")`;

    console.log("logistics-plan live:", {
      tpFlights: tpFlights?.flights?.length ?? 0,
      cities: cityLive.map((c: any, i: number) => ({
        city: cityWindows[i].city,
        hotels: c.hotels?.results?.length ?? 0,
        hotelsSource: c.hotels?.source ?? "none",
        attractions: c.attractions?.results?.length ?? 0,
      })),
      selectedTier,
      fxUsd,
    });

    // ───── Llamada GLOBAL ─────
    const globalPrompt = `${perfilLine}${roadtripBlock}${roadTripPromptBlock(body.destinations, legModes, roadTrip)}

Origen: ${body.origin}
Destinos en orden: ${cityList}
Viajeros: ${viajeros} | Fechas: ${fechas} (~${nights} noches)
Noches por ciudad: ${cityWindows.map((w) => `${w.city} ${w.nights} (${w.checkin} → ${w.checkout})`).join(" · ")}
Preferencia conexión: ${body.prefs?.connection ?? "smart"}
NIVEL DE PRESUPUESTO DEL USUARIO: ${selectedTier} (${presupuestoRango ?? "sin perfil, default equilibrio"}). Todas tus recomendaciones deben girar alrededor de este nivel.
${roadtripMode ? "MODO: ROADTRIP (transporte interno = coche/campervan obligatorio, NO vuelos internos)." : ""}

==========================================
VUELOS — ${tpFlightsBlock}
==========================================

Entrega JSON con:
1. flights: EXACTAMENTE 3 opciones (tier ahorro/equilibrio/premium) para el vuelo internacional ${body.origin} → ${body.destinations[0]} (regreso desde ${body.destinations[body.destinations.length - 1]}). NO repitas la misma ruta más de una vez por tier. Si arriba hay datos en vivo, copia precio y booking_link exactos y pon fuente_precio="travelpayouts". Sin datos en vivo NO inventes aerolínea ni digas "Directo": airline_suggested="Aerolínea por confirmar", stops="Escalas por confirmar".
2. internal_transport: ${roadtripMode
  ? `tramos en COCHE/CAMPERVAN entre ciudades consecutivas (mode="coche", provider real, duración en horas, scenic=true, luggage_note con km y paradas). Añade pickup aeropuerto → primera ciudad y dropoff última → aeropuerto.`
  : `UN tramo por cada par consecutivo (${body.destinations.length - 1} tramos), sin duplicados. Europa <800km usa TREN. Inter-islas griegas usa FERRY.`} Marca fuente_precio="estimado" (no tenemos inventario en vivo de tierra).
3. days: ${nights} días repartidos según las noches por ciudad de arriba, cada uno con ciudad/título/mañana/tarde/noche específicos${roadtripMode ? " (mencionando carretera, km y paradas escénicas)" : ""}.
4. mandatory_costs con currency_buffer_pct=3.
5. resumen breve (2-3 frases). NO calcules totales: el total lo calcula el sistema.`;

    // ───── Llamadas POR CIUDAD en paralelo ─────
    const cityPromises = cityWindows.map((w, i) => {
      const city = w.city;
      const prevPoint = i === 0 ? body.origin : body.destinations[i - 1];
      const cityNights = w.nights;
      const live = cityLive[i] as any;

      const hotelsLive = live?.hotels?.source === "serpapi" && Array.isArray(live?.hotels?.results) && live.hotels.results.length > 0;
      const hotelsBlock = hotelsLive
        ? `DATOS EN VIVO — SERPAPI / GOOGLE HOTELS (fuente_precio="serpapi") para ${w.checkin} → ${w.checkout}, ${viajeros} adultos:\n` +
          live.hotels.results.slice(0, 12).map((h: any, j: number) =>
            `${j + 1}. ${h.name}${h.hotel_class ? ` (${h.hotel_class}★)` : ""}${h.rating ? ` — rating ${h.rating}` : ""} — USD ${h.nightly_usd}/noche — LINK: ${h.booking_url}`
          ).join("\n")
        : `(Sin datos en vivo de hoteles${live?.hotels?.error ? `. Motivo: ${live.hotels.error}` : ""} — estima con hoteles REALES y pon fuente_precio="estimado")`;

      const attrLive = live?.attractions?.ok === true && Array.isArray(live?.attractions?.results) && live.attractions.results.length > 0;
      const attrSource = typeof live?.attractions?.source === "string" ? live.attractions.source : "tripadvisor";
      const attrBlock = attrLive
        ? `DATOS EN VIVO — ${attrSource === "tripadvisor" ? "TRIPADVISOR" : "GOOGLE MAPS"} (fuente="${attrSource}"; nombre y rating REALES, el precio sigue siendo estimación):\n` +
          live.attractions.results.slice(0, 8).map((a: any, j: number) =>
            `${j + 1}. ${a.name}${a.rating ? ` — rating ${a.rating}/5 (${a.num_reviews ?? "?"} reseñas)` : ""}${a.ranking ? ` — ${a.ranking}` : ""}`
          ).join("\n")
        : `(Sin datos en vivo de atracciones — usa experiencias reales conocidas y pon fuente="estimado")`;

      const restLive: any[] = Array.isArray(live?.restaurants) ? live.restaurants : [];
      const restBlock = restLive.length
        ? `GOOGLE MAPS (Places API; copia el nombre EXACTO; el servidor pone precio, calificación y enlace reales):\n` +
          restLive.slice(0, 12).map((r: any, j: number) =>
            `${j + 1}. ${r.name}${r.primary_type_label ? ` — ${r.primary_type_label}` : ""}${r.rating ? ` — ${r.rating}★ (${r.user_rating_count ?? "?"} reseñas)` : ""}${r.price_symbol ? ` — ${r.price_symbol}` : ""}`
          ).join("\n")
        : `(Sin lista de Google Maps — nombra restaurantes reales y conocidos; el servidor los busca en Google y quita los que no encuentre)`;

      const cityPrompt = `${perfilLine}${roadtripBlock}

Ciudad: ${city}
Punto anterior: ${prevPoint}
Viajeros: ${viajeros} | Noches: ${cityNights} (${w.checkin} → ${w.checkout})
Ruta completa del viaje (contexto): ${body.origin} → ${cityList}
NIVEL DE PRESUPUESTO DEL USUARIO: ${selectedTier}. El hospedaje del tier "${selectedTier}" es el que se usará para el total.
${roadtripMode ? "MODO: ROADTRIP — arrival_options principal SIEMPRE en coche con km, horas y paradas." : ""}${i > 0 && legModes[i - 1] ? `\nEl viajero eligió llegar desde ${prevPoint} en ${legModes[i - 1] === "avion" ? "avión" : legModes[i - 1]}: esa es la opción PRINCIPAL de arrival_options.${legModes[i - 1] === "coche" && roadTrip?.legs.find((l) => l.index === i - 1)?.distance_km ? ` Distancia ${roadTrip.legs.find((l) => l.index === i - 1)!.distance_km} km (no inventes otra).` : ""}` : ""}

==========================================
HOSPEDAJE — ${hotelsBlock}
==========================================
EXPERIENCIAS — ${attrBlock}
==========================================
RESTAURANTES — ${restBlock}
==========================================

Entrega JSON con:
- city: "${city}"
- nights: ${cityNights}
- arrival_options: ${i === 0 ? `cómo ir del aeropuerto de llegada al centro de ${city} (tren, taxi o traslado). NO incluyas el vuelo desde ${prevPoint} (ya está en flights) ni renta de coche desde ${prevPoint}.` : `2-3 maneras de LLEGAR desde ${prevPoint}, sin duplicar la misma opción.`} Un vuelo sin datos en vivo lleva provider="Aerolínea por confirmar" (no inventes aerolínea ni "Directo"). ${roadtripMode
  ? `La PRINCIPAL es coche por carretera real con km, horas y 2-3 paradas escénicas en "notes".`
  : `Si es Europa <800km incluye tren real. Si son islas griegas incluye ferry real y vuelo Aegean/Sky Express.`} fuente_precio="estimado" salvo que se indique lo contrario.
- hospedaje: EXACTAMENTE 3 (ahorro/equilibrio/premium). Si hay datos en vivo arriba, los 3 DEBEN salir de esa lista (el más barato = ahorro, uno intermedio = equilibrio, el más caro/mejor = premium), copiando nombre, precio y booking_url exactos con fuente_precio="serpapi".
- restaurantes: 4-5 en ${city} acordes al estilo del usuario; si arriba hay lista de GOOGLE MAPS, elige SOLO de esa lista (nombre exacto). Sin enlaces.
- experiencias: 4-5 en ${city}; prioriza las de la lista de arriba con fuente="${attrSource}" y su rating real.`;

      return callAI(apiKey, CITY_SYSTEM, cityPrompt, "emit_city", citySchema, aiBudget())
        .then((r) => ({ ...r, city, nights: cityNights, checkin: w.checkin, checkout: w.checkout }))
        .catch((e) => {
          console.error(`city ${city} failed:`, e.message);
          return {
            city, nights: cityNights, checkin: w.checkin, checkout: w.checkout,
            arrival_options: [], hospedaje: [], restaurantes: [], experiencias: [],
          };
        });
    });

    const globalPromise = callAI(apiKey, GLOBAL_SYSTEM, globalPrompt, "emit_global", globalSchema, aiBudget())
      .catch((e) => {
        console.error("global failed:", e.message);
        return { flights: [], internal_transport: [], days: [], mandatory_costs: {}, resumen: "" };
      });

    const [globalData, ...cityData] = await Promise.all([globalPromise, ...cityPromises]);
    const liveConsultedAt = tpFlights?.consulted_at ?? new Date().toISOString();

    // ───── Post-proceso: vuelos reales + dedupe ─────
    let flights: any[] = Array.isArray(globalData.flights) ? globalData.flights : [];

    if (tpLive) {
      // Construimos los 3 tiers directamente del inventario real; nada de precios inventados.
      const sorted = [...tpFlights.flights]
        .filter((f: any) => Number(f.price) > 0)
        .sort((a: any, b: any) => Number(a.price) - Number(b.price));
      const pick = (f: any, tier: Tier) => ({
        tier,
        from: body.origin,
        to: body.destinations[0],
        airline_suggested: f.airline ? `${f.airline}${f.flight_number ? ` ${f.flight_number}` : ""}` : "Aerolínea por confirmar",
        // Duración de la ida (duration_minutes de Travelpayouts es ida + vuelta).
        duration: f.duration_to_minutes ? `${Math.floor(f.duration_to_minutes / 60)}h${f.duration_to_minutes % 60 ? ` ${f.duration_to_minutes % 60}m` : ""}` : "",
        dep_iata: f.origin_airport ?? tpFlights.origin ?? null,
        arr_iata: f.destination_airport ?? tpFlights.destination ?? null,
        // Escalas con sus ciudades (de la ruta del enlace); sin ellas, "Escalas por confirmar".
        ...(() => {
          const codes = layoverCodesFromAviasalesLink(f.booking_link);
          const cities = codes ? codes.map(airportCityName) : null;
          return {
            stops: cities ? (cities.length ? `Escalas: ${cities.join(" · ")}` : "Directo") : "Escalas por confirmar",
            ...(cities ? { layovers: cities } : {}),
          };
        })(),
        price_per_person_usd: Math.round(Number(f.price)),
        booking_link: f.booking_link ?? null,
        fuente_precio: "travelpayouts",
        notes: tpFlights.approximate_dates
          ? "Tarifa de referencia de Aviasales para fechas cercanas del mismo mes (no tu fecha exacta)."
          : "Tarifa de referencia de Aviasales (búsquedas de las últimas 48 h); se confirma al reservar.",
      });
      const ahorro = sorted[0];
      const equilibrio = sorted[Math.floor(sorted.length / 2)] ?? ahorro;
      const premium = sorted[sorted.length - 1] ?? equilibrio;
      flights = markLive(
        [pick(ahorro, "ahorro"), pick(equilibrio, "equilibrio"), pick(premium, "premium")],
        "fuente_precio", "travelpayouts", liveConsultedAt, !!tpFlights.approximate_dates,
      );
    } else {
      // Sin datos en vivo: lo que escribió el modelo es una estimación, diga lo que diga su etiqueta, y
      // no se afirma aerolínea ni "Directo".
      flights = forceEstimated(flights).map(scrubEstimatedFlight);
    }

    // Dedupe: mismo tramo + mismo tier nunca dos veces.
    const seenFlights = new Set<string>();
    flights = flights.filter((f) => {
      const key = `${(f.from ?? "").toLowerCase()}|${(f.to ?? "").toLowerCase()}|${f.tier ?? ""}`;
      if (seenFlights.has(key)) return false;
      seenFlights.add(key);
      return true;
    });

    const internalTransport = (() => {
      const seen = new Set<string>();
      // Nunca se consulta a un proveedor de trenes/ferris/buses aquí: siempre es estimado.
      return forceEstimated(globalData.internal_transport)
        .filter((l: any) => {
          const key = `${(l.from ?? "").toLowerCase()}|${(l.to ?? "").toLowerCase()}|${l.mode ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
    })();

    // ───── Post-proceso: hospedaje real por ciudad ─────
    const perDestination = cityData.map((pd: any, i: number) => {
      const live = cityLive[i] as any;
      const hotelsLive = live?.hotels?.source === "serpapi" && Array.isArray(live?.hotels?.results) && live.hotels.results.length > 0;

      let hospedaje = Array.isArray(pd.hospedaje) ? pd.hospedaje : [];

      if (hotelsLive) {
        const sorted = [...live.hotels.results]
          .filter((h: any) => Number(h.nightly_usd) > 0)
          .sort((a: any, b: any) => Number(a.nightly_usd) - Number(b.nightly_usd));
        const build = (h: any, tier: Tier) => h && {
          tier,
          tipo: h.hotel_class ? `${h.hotel_class}★` : "Hotel",
          nombre: h.name,
          barrio: pd.city,
          rating: h.rating ?? null,
          price_per_night_usd: Math.round(Number(h.nightly_usd)),
          booking_url: h.booking_url ?? null,
          // Identificador de Google Hotels (SerpApi) y sitio del hotel que da el proveedor: para enlazar a
          // la ficha y no a una búsqueda por nombre (auditoría de lugares reales, punto 4).
          ...(h.property_token ? { property_token: h.property_token } : {}),
          ...(typeof h.link === "string" && /^https:\/\//.test(h.link) ? { website: h.link } : {}),
          fuente_precio: "serpapi",
          por_que: (hospedaje.find((x: any) => x?.tier === tier)?.por_que) ?? "Tarifa real consultada hoy en Google Hotels.",
        };
        const cheap = sorted[0];
        const mid = sorted[Math.floor(sorted.length / 2)] ?? cheap;
        // Para "premium" preferimos la categoría de estrellas más alta disponible, no solo el precio.
        const maxClass = Math.max(...sorted.map((h: any) => Number(h.hotel_class) || 0));
        const topPool = maxClass > 0 ? sorted.filter((h: any) => (Number(h.hotel_class) || 0) === maxClass) : sorted;
        const top = topPool[topPool.length - 1] ?? sorted[sorted.length - 1] ?? mid;
        const built = [build(cheap, "ahorro"), build(mid, "equilibrio"), build(top, "premium")].filter(Boolean);
        hospedaje = built.length
          ? markLive(built, "fuente_precio", "serpapi", live?.hotels?.consulted_at ?? liveConsultedAt)
          : forceEstimated(hospedaje);
      } else {
        hospedaje = forceEstimated(hospedaje);
      }

      const attrLive = live?.attractions?.ok === true && Array.isArray(live?.attractions?.results) ? live.attractions.results : null;
      const experiencias = labelExperiences(pd.experiencias, attrLive, typeof live?.attractions?.source === "string" ? live.attractions.source : "tripadvisor");

      const arrival_options = (() => {
        const seen = new Set<string>();
        // Primera ciudad: sin el vuelo internacional (va en flights) ni coche/tren "desde" el origen.
        const raw = i === 0 ? firstCityArrivals(pd.arrival_options, body.origin) : pd.arrival_options;
        return forceEstimated(raw)
          .map((o: any) => (o?.mode === "vuelo" ? scrubEstimatedFlight(o) : o))
          .filter((o: any) => {
            const key = `${(o.from ?? "").toLowerCase()}|${o.mode ?? ""}|${o.provider ?? ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      })();

      return { ...pd, hospedaje, experiencias, arrival_options };
    });

    // ───── Lugares reales (auditoría de lugares reales, fase 1) ─────
    // Restaurantes: solo los de la lista de Google o los que Google encuentra por nombre (los demás no se
    // muestran). Experiencias fuera de la lista del proveedor: se buscan; si no aparecen, "Sin verificar".
    // Presupuesto: hasta 10 s en total (sin pasar del tope de 130 s), 4 búsquedas a la vez y 3.5 s cada una;
    // lo que no alcanza queda "Sin verificar", nunca como verificado.
    const verifyDeadline = Math.min(Date.now() + 10_000, __deadline - 8_000);
    const resolvePlaces = makeResolver(google, dbCacheStore(), { deadline: verifyDeadline, concurrency: 4, timeoutMs: 3_500 });
    const verified = await Promise.all(perDestination.map(async (pd: any, i: number) => {
      const places = Array.isArray((cityLive[i] as any)?.restaurants) ? (cityLive[i] as any).restaurants : [];
      const [rest, exps] = await Promise.all([
        verifyRestaurants(pd.restaurantes, places, pd.city, resolvePlaces, 5),
        verifyTours(pd.experiencias, pd.city, resolvePlaces),
      ]);
      return { ...pd, restaurantes: rest.restaurantes, experiencias: exps.tours, _v: { rq: rest.quitados, rs: rest.sin_verificar, es: exps.sin_verificar } };
    }));
    console.log("logistics-plan lugares:", verified.map((pd: any) => ({ city: pd.city, ...pd._v })));
    verified.forEach((pd: any, i: number) => { delete pd._v; perDestination[i] = pd; });

    // ───── DESGLOSE REAL (MXN) según el tier del usuario ─────
    const usdToMxn = (usd: number) => Math.round((Number(usd) || 0) * fxUsd);

    const vueloTier = flights.find((f: any) => f.tier === selectedTier) ?? flights[0];
    const vuelosMxn = usdToMxn((Number(vueloTier?.price_per_person_usd) || 0) * viajeros);

    let hospedajeMxn = 0;
    let experienciasMxn = 0;
    perDestination.forEach((pd: any) => {
      const opts = (pd.hospedaje ?? []).filter((h: any) => Number(h.price_per_night_usd) > 0);
      const byTier = opts.find((h: any) => h.tier === selectedTier)
        ?? pickByTier([...opts].sort((a: any, b: any) => a.price_per_night_usd - b.price_per_night_usd), selectedTier);
      if (byTier) {
        // Precio en vivo (hotels-search con adults = viajeros): ya es del grupo. Estimado: una
        // habitación por cada 2 viajeros (hotelPriceRooms, mismo criterio que analizar-viaje).
        const rooms = hotelPriceRooms(byTier, viajeros);
        hospedajeMxn += usdToMxn(Number(byTier.price_per_night_usd) * (Number(pd.nights) || 1) * rooms);
      }
      (pd.experiencias ?? []).forEach((e: any) => {
        experienciasMxn += usdToMxn((Number(e.price_per_person_usd) || 0) * viajeros);
      });
    });

    let transporteMxn = 0;
    internalTransport.forEach((l: any) => {
      transporteMxn += usdToMxn((Number(l.price_per_person_usd) || 0) * viajeros);
    });

    const comidaBruta = usdToMxn(COMIDA_USD_PP_DIA[selectedTier] * nights * viajeros);
    const comidaTecho = COMIDA_TECHO_MXN_PP_DIA * nights * viajeros;
    const comidaMxn = Math.min(comidaBruta, comidaTecho);

    const mc = globalData.mandatory_costs ?? {};
    const extrasMxn = usdToMxn(
      (Number(mc.city_taxes_usd) || 0) + (Number(mc.visa_fees_usd) || 0) + (Number(mc.currency_buffer_usd) || 0),
    );

    const desglose = {
      vuelos: vuelosMxn,
      hospedaje: hospedajeMxn,
      comida: comidaMxn,
      tours: experienciasMxn,
      transporte_local: transporteMxn,
      extras: extrasMxn,
    };
    const totalMxn = Object.values(desglose).reduce((s, v) => s + (Number(v) || 0), 0);

    if (!(totalMxn > 0)) {
      console.error("logistics-plan: desglose vacío", { destinos: cityList });
      return {
        ok: false,
        reason: "insufficient_data",
        response: serviceUnavailableResponse(corsHeaders,
          "No pudimos armar una cotización confiable ahora mismo y no se descontó de tu plan. Intenta de nuevo en unos minutos."),
      };
    }

    const logistics = {
      ...globalData,
      flights,
      internal_transport: internalTransport,
      per_destination: perDestination,
      // roadtrip: tramos en coche, costos etiquetados, avisos por país y renta (null sin coche).
      leg_modes: legModes,
      road_trip: roadTrip,
      selected_tier: selectedTier,
      presupuesto_rango: presupuestoRango,
      fx_usd_mxn: fxUsd,
      nights,
      desglose_presupuesto: desglose,
      total_estimado_mxn: totalMxn,
      total_estimado_usd: Math.round(totalMxn / fxUsd),
      pricing_sources: pricingSources(flights, perDestination),
      fx_source: fxInfo.source,
      fx_at: fxInfo.fetched_at,
      fx_is_fallback: fxInfo.is_fallback,
      quoted_at: new Date().toISOString(),
      rooms: Math.max(1, Math.ceil(viajeros / 2)),
      // Base de la cotización para trip_quotes (viajeros y fechas con que se calculó).
      travelers: viajeros,
      date_from: body.fecha_salida ?? null,
      date_to: body.fecha_regreso ?? null,
    };

    // Contrato mínimo para cobrar: itinerario, total y logística en todas las ciudades.
    const contrato = logisticsMeetsContract(logistics);
    if (!contrato.ok) {
      console.error("logistics-plan: plan parcial, no se cobra", contrato.missing);
      return { ok: false, reason: `partial_result:${contrato.missing.join(",")}` };
    }
    if (!ctx.beginPersist()) return { ok: false, reason: "timeout_before_persist" };

    return {
      ok: true,
      tripId: null,
      result: logistics,
      response: new Response(JSON.stringify({ logistics }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
    };

    const outcome = await runWithReservation(reservationDeps(__user.id, "trip_analysis"), requestKey, generarPlan);
    if (outcome.type === "ok") return outcome.response;
    if (outcome.type === "denied") return quotaDeniedResponse(outcome.quota, "trip_analysis", corsHeaders);
    if (outcome.type === "replay") {
      // Respuesta anterior perdida (red, recarga): se entrega el plan guardado sin cobrar de nuevo.
      if (outcome.result) {
        return new Response(JSON.stringify({ logistics: outcome.result, replay: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return serviceUnavailableResponse(corsHeaders, "Este plan ya se generó; búscalo en Mis viajes.");
    }
    console.warn("logistics-plan: plan no completado, cupo liberado", outcome.reason);
    return outcome.response ?? serviceUnavailableResponse(corsHeaders);
  } catch (e) {
    // Detalle técnico solo en logs.
    console.error("logistics-plan error:", e instanceof Error ? e.message : e);
    return serviceUnavailableResponse(corsHeaders);
  }
});
