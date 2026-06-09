// supabase/functions/concierge-chat/index.ts
// Concierge IA ultra-lujo con TOOL CALLING real: vuelos, hoteles, atracciones,
// lugares cercanos. Aprende del usuario en cada turno (behavioral_insights + dna_signal).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const FN_URL = `${SUPABASE_URL}/functions/v1`;
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM = `Eres "IATOS AI Concierge", asistente de viaje ULTRA-LUJO 24/7 para clientes PRO (todos los usuarios son PRO). Tono cálido, refinado, breve, en español de México.

REGLAS DE ORO:
1. Cuando el usuario pida vuelos, hoteles, restaurantes, atracciones o lugares cercanos, **SIEMPRE** llama a la tool correspondiente para obtener datos reales. Nunca inventes precios, ratings ni horarios.
2. Después de obtener resultados, conviértelos en "cards" estructuradas. El campo "text" es solo tu voz humana corta (1-3 frases), nunca repitas datos de las cards ahí.
3. Si el usuario menciona equipaje → ofrece logistics card (Luggage Forward, AirPortr, LugLess).
4. Si menciona vuelo o First Class → considera jet card con empty-leg.
5. Si detectas urgencia → alert card.
6. Usa el contexto del viaje activo y la bóveda del usuario para hiper-personalizar.
7. Si llamas a una tool, espera el resultado antes de responder al usuario.

FORMATO DE RESPUESTA FINAL (cuando ya no necesites más tools, responde JSON válido):
{
  "text": "voz humana breve",
  "cards": [
    { "type": "flight", "title": "Aerolínea VUELO123", "subtitle": "MEX→CDG · 12h", "price_usd": 1234, "cta_label": "Reservar", "cta_action": "URL_REAL", "meta": "Salida 14:00" },
    { "type": "hotel", "title": "Four Seasons George V", "subtitle": "París · 5★", "price_usd": 1800, "rating": 9.4, "image_url": "URL", "cta_label": "Ver y reservar", "cta_action": "URL_BOOKING" },
    { "type": "restaurant", "title": "Pujol", "subtitle": "CDMX · Mexicana de autor", "rating": 4.8, "cta_label": "Reservar", "cta_action": "URL", "meta": "$$$$ · Reservación esencial" },
    { "type": "attraction", "title": "Louvre", "subtitle": "París", "rating": 4.7, "image_url": "URL", "cta_label": "Comprar entradas", "cta_action": "URL" },
    { "type": "transport", "title": "...", "subtitle": "...", "cta_label": "...", "cta_action": "URL" },
    { "type": "alert", "title": "...", "body": "..." },
    { "type": "luggage", "title": "Equipaje Invisible", "from": "...", "to": "...", "cta_label": "Cotizar" },
    { "type": "jet", "title": "Empty Leg G650", "route": "MEX→TEB", "price_usd": 24000, "fbo": "Atlantic Aviation", "cta_label": "Reservar" }
  ]
}`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_flights",
      description: "Busca vuelos reales en Google Flights con precios y deep-link de compra.",
      parameters: {
        type: "object",
        properties: {
          origin: { type: "string", description: "Ciudad o IATA de origen, ej. CDMX o MEX" },
          destination: { type: "string", description: "Ciudad o IATA de destino" },
          departure_date: { type: "string", description: "YYYY-MM-DD" },
          return_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
          adults: { type: "integer", default: 1 },
        },
        required: ["origin", "destination", "departure_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_hotels",
      description: "Busca hoteles reales con precios, rating y link de Booking.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
          checkin: { type: "string", description: "YYYY-MM-DD" },
          checkout: { type: "string", description: "YYYY-MM-DD" },
          adults: { type: "integer", default: 2 },
          hotel_class: { type: "string", description: "Ej. '5' para 5★ (opcional)" },
        },
        required: ["city", "checkin", "checkout"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_attractions",
      description: "Busca atracciones, restaurantes u hoteles en TripAdvisor con rating, reviews y fotos.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Ej. 'best michelin in Paris' o 'Louvre'" },
          category: { type: "string", enum: ["hotels", "attractions", "restaurants", "geos"] },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_nearby",
      description: "Busca lugares cercanos por coordenadas (restaurantes, farmacias, hospitales, cajeros, gasolineras, hoteles).",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lng: { type: "number" },
          kind: { type: "string", enum: ["restaurant", "hospital", "police", "pharmacy", "atm", "embassy", "gas_station", "lodging"] },
          keyword: { type: "string", description: "Filtro adicional (ej. 'sushi omakase')" },
        },
        required: ["lat", "lng", "kind"],
      },
    },
  },
];

async function callTool(name: string, args: any, authHeader: string): Promise<any> {
  const map: Record<string, string> = {
    search_flights: "flights-search",
    search_hotels: "hotels-search",
    search_attractions: "tripadvisor-search",
    search_nearby: "places-nearby",
  };
  const fn = map[name];
  if (!fn) return { error: `tool ${name} desconocida` };
  try {
    const r = await fetch(`${FN_URL}/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify(args),
    });
    const j = await r.json().catch(() => ({ error: "json parse" }));
    // recortar para no saturar contexto
    const slim = JSON.stringify(j).slice(0, 6000);
    return JSON.parse(slim.endsWith("}") || slim.endsWith("]") ? slim : slim + '"...truncated"}');
  } catch (e: any) {
    return { error: e?.message ?? "tool fetch error" };
  }
}

async function logInsight(supabase: any, userId: string, userMsg: string, toolsUsed: string[]) {
  try {
    await supabase.from("behavioral_insights").insert({
      user_id: userId,
      action: "concierge_message",
      target_type: toolsUsed.length ? "tool_call" : "chat",
      target_label: toolsUsed.join(",") || userMsg.slice(0, 80),
      metadata: { msg: userMsg.slice(0, 500), tools: toolsUsed },
    });
    // refresh dna_signal: increment categories implied by tools
    if (toolsUsed.length) {
      const { data: prefs } = await supabase
        .from("ai_user_preferences").select("dna_signal").eq("user_id", userId).maybeSingle();
      const sig = (prefs?.dna_signal ?? {}) as any;
      const cats = sig.categories ?? {};
      for (const t of toolsUsed) {
        const cat = t.replace("search_", "");
        cats[cat] = (cats[cat] ?? 0) + 1;
      }
      sig.categories = cats;
      sig.last_concierge_at = new Date().toISOString();
      await supabase.from("ai_user_preferences").upsert(
        { user_id: userId, dna_signal: sig, dna_updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    }
  } catch (e) {
    console.warn("logInsight failed", e);
  }
}

interface Body {
  messages: { role: "user" | "assistant"; content: string }[];
  god_mode?: boolean;
  context?: { destino?: string; fechas?: string; coords?: { lat: number; lng: number }; place?: string };
}

const normText = (value: unknown) => String(value ?? "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .trim();

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

const compactItem = (item: any) => Object.fromEntries(
  Object.entries(item ?? {}).filter(([, value]) => value !== null && value !== undefined && value !== ""),
);

function extractTripCities(trip: any): string[] {
  const cities = new Set<string>();
  const push = (v: unknown) => { const s = String(v ?? "").trim(); if (s) cities.add(s); };
  String(trip?.destino ?? "").split(/→|,|;/).forEach(push);
  asArray(trip?.hospedaje_json).forEach((h) => push(h?.ciudad));
  asArray(trip?.vuelos_json).forEach((f) => { push(f?.to); push(f?.ciudad); push(f?.from); });
  asArray(trip?.itinerario_json?.destinations).forEach(push);
  return [...cities];
}

function chooseTripForRequest(trips: any[], todayISO: string, userMsg: string) {
  if (!trips.length) return null;
  const msg = normText(userMsg);
  const scored = trips.map((trip) => {
    const cities = extractTripCities(trip);
    const cityMatch = cities.some((city) => city.length > 2 && msg.includes(normText(city)));
    const activeNow = trip.fecha_salida <= todayISO && trip.fecha_regreso >= todayISO;
    const future = !trip.fecha_regreso || trip.fecha_regreso >= todayISO;
    const status = normText(trip.status);
    let score = 0;
    if (cityMatch) score += 120;
    if (activeNow) score += 70;
    if (future) score += 40;
    if (["listo", "active", "confirmed", "planned", "pendiente"].includes(status)) score += 15;
    return { trip, score };
  });
  scored.sort((a, b) => b.score - a.score || String(b.trip.created_at ?? "").localeCompare(String(a.trip.created_at ?? "")));
  return scored[0]?.trip ?? null;
}

function buildRequestIntelligence(trip: any, userMsg: string, bookings: any[]) {
  if (!trip) return null;
  const msg = normText(userMsg);
  const vuelos = asArray(trip.vuelos_json);
  const hospedajes = asArray(trip.hospedaje_json);
  const transfers = asArray(trip.itinerario_json?.transfers);
  const pendientes = asArray(trip.itinerario_json?.pendientes);
  const cities = extractTripCities(trip);
  const city = cities.find((c) => c.length > 2 && msg.includes(normText(c))) ?? cities[0] ?? trip.destino;
  const cityNorm = normText(city);
  const relevantFlights = vuelos
    .filter((f) => normText([f?.to, f?.ciudad, f?.from, f?.numero_vuelo, f?.aerolinea].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 4);
  const relevantHotels = hospedajes
    .filter((h) => normText([h?.ciudad, h?.nombre, h?.direccion, h?.barrio].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 4);
  const relevantTransfers = transfers
    .filter((t) => normText([t?.from, t?.to, t?.proveedor, t?.fecha, t?.hora].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 4);
  const relevantPending = pendientes
    .filter((p) => normText(p).includes(cityNorm) || /transfer|transporte|taxi|aeropuerto|airport|hotel|uber/.test(normText(p)))
    .slice(0, 8);
  const relevantBookings = bookings
    .filter((b) => normText([b?.city, b?.title, b?.subtitle, b?.category, b?.provider].join(" ")).includes(cityNorm))
    .map(compactItem)
    .slice(0, 6);
  const transferIntent = /transfer|transporte|traslado|taxi|chofer|driver|uber|blacklane|aeropuerto/.test(msg)
    && /hotel|aeropuerto|airport|barajas|terminal|llegad/.test(msg);
  return {
    tipo_peticion_detectada: transferIntent ? "transfer_aeropuerto_hotel" : "general_viaje",
    ciudad_detectada: city,
    vuelos_relevantes: relevantFlights,
    hospedaje_relevante: relevantHotels,
    transfers_confirmados_o_itinerario: relevantTransfers,
    pendientes_relacionados: relevantPending,
    bookings_relacionados: relevantBookings,
    instruccion_operativa: "Usa estos datos primero. No pidas hotel, fechas, vuelo ni destino si aparecen aquí; solo pregunta preferencias no guardadas.",
  };
}

function asksForKnownTripData(text: string) {
  return /necesito|dime|dame|proporciona|cu[aá]l es|nombre de tu hotel|fecha|hotel en|a qu[eé] hora|te gustar[ií]a que te busque|quieres que busque|puedo ayudarte a encontrar/.test(normText(text));
}

function shouldForceTransferAnswer(intel: any, parsed: any) {
  if (intel?.tipo_peticion_detectada !== "transfer_aeropuerto_hotel") return false;
  const cards = Array.isArray(parsed?.cards) ? parsed.cards : [];
  return cards.length === 0 || asksForKnownTripData(parsed?.text ?? "");
}

function buildTransferFallback(intel: any) {
  if (!intel || intel.tipo_peticion_detectada !== "transfer_aeropuerto_hotel") return null;
  const flight = intel.vuelos_relevantes?.[0];
  const hotel = intel.hospedaje_relevante?.[0];
  if (!flight && !hotel) return null;
  const pendingText = intel.pendientes_relacionados?.join(" | ") ?? "";
  const airport = /barajas/i.test(pendingText) ? "Madrid Barajas" : `aeropuerto de llegada en ${intel.ciudad_detectada}`;
  const flightLine = flight
    ? `${flight.aerolinea ?? "vuelo"} ${flight.numero_vuelo ?? ""}`.trim() + `${flight.fecha ? ` · ${flight.fecha}` : ""}${flight.hora_llegada ? ` · llegada ${flight.hora_llegada}` : ""}`
    : `llegada a ${intel.ciudad_detectada}`;
  const hotelLine = hotel
    ? `${hotel.nombre ?? "tu hotel"}${hotel.direccion ? `, ${hotel.direccion}` : ""}${hotel.check_in ? ` · check-in ${hotel.check_in}` : ""}`
    : `hotel en ${intel.ciudad_detectada}`;
  const query = encodeURIComponent(`${airport} ${hotel?.nombre ?? "hotel"} ${hotel?.direccion ?? ""} transfer privado`);
  return {
    text: `Ya tengo los datos del viaje: llegas a ${intel.ciudad_detectada} en ${flightLine} y tu hospedaje es ${hotelLine}. Además, en tu itinerario aparece pendiente el traslado aeropuerto → hotel; te dejo opciones premium para activarlo sin pedirte datos repetidos.`,
    cards: [
      { type: "transport", title: "Transfer privado premium", subtitle: `${airport} → ${hotel?.nombre ?? "hotel"}`, cta_label: "Buscar Welcome Pickups", cta_action: `https://www.google.com/search?q=${query}+Welcome+Pickups`, meta: pendingText || "Pendiente detectado en tu itinerario" },
      { type: "transport", title: "Chofer ejecutivo", subtitle: `${airport} → ${hotel?.direccion ?? hotel?.nombre ?? intel.ciudad_detectada}`, cta_label: "Buscar Blacklane", cta_action: `https://www.google.com/search?q=${query}+Blacklane`, meta: flightLine },
      { type: "transport", title: "Taxi oficial / VTC", subtitle: `${airport} → ${hotel?.nombre ?? "hotel"}`, cta_label: "Abrir Maps", cta_action: `https://www.google.com/maps/search/?api=1&query=${query}`, meta: "Ruta con origen y destino del viaje" },
    ],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY no configurada" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const lastUserMsg = [...(body.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "";

    // Carga contexto: perfil, viaje activo (FULL), bóveda, dna, travel_profiles
    const todayISO = new Date().toISOString().slice(0, 10);
    const [{ data: tripRows }, { data: vault }, { data: prefs }, { data: profile }, { data: tprof }] = await Promise.all([
      // Trae candidatos amplios y elige por ciudad/intención. No filtrar por status: en producción existen status como "listo".
      supabase.from("trips")
        .select("*")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(25),
      supabase.from("user_vault_benefits").select("*").eq("user_id", u.user.id).maybeSingle(),
      supabase.from("ai_user_preferences").select("*").eq("user_id", u.user.id).maybeSingle(),
      supabase.from("profiles").select("full_name, ciudad_origen").eq("id", u.user.id).maybeSingle(),
      supabase.from("travel_profiles").select("estilo_viaje, presupuesto_rango, ritmo_viaje, preferencias_comida, alergias_restricciones, intereses, perfil_ia").eq("user_id", u.user.id).maybeSingle(),
    ]);
    const trip = chooseTripForRequest(tripRows ?? [], todayISO, lastUserMsg);
    console.log("concierge_trip_context", JSON.stringify({
      user_id: u.user.id,
      candidates: tripRows?.length ?? 0,
      selected_trip_id: trip?.id ?? null,
      destino: trip?.destino ?? null,
      status: trip?.status ?? null,
      asked: lastUserMsg.slice(0, 120),
    }));

    // Reservas reales (transfers, restaurantes, tours ya pagados) para detectar lo FALTANTE
    let bookings: any[] = [];
    if (trip?.id) {
      const { data: bks } = await supabase.from("bookings")
        .select("category, provider, status, title, subtitle, city, start_at, end_at, price_amount, price_currency, confirmation_code, booking_url")
        .eq("trip_id", trip.id).order("start_at", { ascending: true });
      bookings = bks ?? [];
    }

    const vaultLines: string[] = [];
    if (vault?.credit_cards?.length) vaultLines.push("Tarjetas: " + vault.credit_cards.map((c: any) => `${c.bank} ${c.card_tier}`).join("; "));
    if (vault?.airline_alliances?.length) vaultLines.push("Aerolíneas: " + vault.airline_alliances.map((a: any) => `${a.airline} ${a.tier_status}`).join("; "));
    if (vault?.hotel_loyalty?.length) vaultLines.push("Hoteles: " + vault.hotel_loyalty.map((h: any) => `${h.chain_name} ${h.status_tier}`).join("; "));
    if (vault?.car_rentals?.length) vaultLines.push("Autos: " + vault.car_rentals.map((c: any) => `${c.company} ${c.tier_status ?? ""}`.trim()).join("; "));

    // Bloque de contexto del usuario en texto plano
    const ctxLines: string[] = ["CONTEXTO DEL USUARIO ACTUAL:"];
    const nombre = profile?.full_name ?? null;
    const ciudadOrigen = profile?.ciudad_origen ?? (trip as any)?.ciudad_origen ?? null;
    if (nombre) ctxLines.push(`Nombre: ${nombre}`);
    if (ciudadOrigen) ctxLines.push(`Ciudad origen: ${ciudadOrigen}`);
    const perfilIA = (tprof as any)?.perfil_ia ?? (prefs as any)?.perfil_ia ?? null;
    if (perfilIA?.resumen) ctxLines.push(`Travel DNA: ${perfilIA.resumen}`);
    if (perfilIA?.estilo_dominante) ctxLines.push(`Estilo dominante: ${perfilIA.estilo_dominante}`);
    const ritmo = (tprof as any)?.ritmo_viaje ?? (prefs as any)?.ritmo_viaje;
    if (ritmo) ctxLines.push(`Ritmo: ${ritmo}`);
    const presu = (tprof as any)?.presupuesto_rango ?? (prefs as any)?.nivel_presupuesto;
    if (presu) ctxLines.push(`Presupuesto: ${presu}`);
    const comida = (tprof as any)?.preferencias_comida ?? (prefs as any)?.estilo_comida;
    if (comida?.length) ctxLines.push(`Comida: ${comida.join(", ")}`);
    const restr = (tprof as any)?.alergias_restricciones ?? (prefs as any)?.restricciones_alimentarias;
    if (restr?.length) ctxLines.push(`Restricciones: ${restr.join(", ")}`);
    const intereses = (tprof as any)?.intereses ?? (prefs as any)?.actividades_tarde;
    if (intereses?.length) ctxLines.push(`Intereses: ${intereses.join(", ")}`);
    ctxLines.push(vaultLines.length ? `Bóveda: ${vaultLines.join(" | ")}` : "Bóveda: vacía (sugiere al usuario llenarla)");
    if (body.context?.coords) ctxLines.push(`Ubicación actual aprox: ${body.context.coords.lat.toFixed(4)}, ${body.context.coords.lng.toFixed(4)}`);
    if (body.god_mode) ctxLines.push("MODO: GOD MODE — caza reservas imposibles, upgrades premium, mesas Michelin sold-out, empty-legs.");

    const userContextBlock = ctxLines.join("\n");

    // === BLOQUE DEDICADO AL VIAJE ACTIVO ===
    // Se inyecta como SYSTEM separado para que el modelo lo trate como contexto fijo.
    let tripContextBlock = "";
    let requestIntel: any = null;
    if (trip) {
      requestIntel = buildRequestIntelligence(trip, lastUserMsg, bookings);
      const tripPayload = {
        destino: trip.destino,
        pais_destino: trip.pais_destino,
        ciudad_origen: trip.ciudad_origen,
        fecha_salida: trip.fecha_salida,
        fecha_regreso: trip.fecha_regreso,
        num_viajeros: trip.num_viajeros,
        status: trip.status,
        presupuesto_objetivo: trip.presupuesto_objetivo,
        total_estimado: trip.total_estimado,
        moneda: trip.moneda,
        itinerario: trip.itinerario_json ?? null,
        vuelos: trip.vuelos_json ?? null,
        hospedaje: trip.hospedaje_json ?? null,
        restaurantes: trip.restaurantes_json ?? null,
        tours: trip.tours_json ?? null,
        cruceros: trip.cruceros_json ?? null,
        tips_personalizados: trip.tips_personalizados ?? null,
        analisis_ai: trip.analisis_ai ?? null,
        reservas_confirmadas_bookings: bookings,
        datos_relevantes_para_la_peticion_actual: requestIntel,
      };
      tripContextBlock = [
        "VIAJE ACTIVO DEL USUARIO (datos REALES de su perfil — úsalos SIEMPRE):",
        "```json",
        JSON.stringify(tripPayload, null, 1),
        "```",
        "",
        "REGLA ARQUITECTÓNICA — CONTEXTO DEL VIAJE (NO NEGOCIABLE):",
        "JAMÁS pidas al usuario datos que YA ESTÁN arriba. NUNCA digas 'dame las fechas',",
        "'dime el nombre del hotel', 'qué aeropuerto', 'a qué hora llegas' — TÚ YA LO SABES.",
        "Léelo del JSON de arriba (vuelos, hospedaje, restaurantes, tours, cruceros, bookings).",
        "",
        "Cuando el usuario haga cualquier pregunta sobre SU viaje:",
        "1) Identifica los datos relevantes del JSON arriba.",
        "2) Úsalos LITERALMENTE en tu respuesta (nombres, horas, terminales, direcciones, PNR).",
        "3) Solo pregunta lo que NO esté en el contexto (ej. '¿prefieres sedán o SUV?').",
        "",
        "ANTI-PATRÓN PROHIBIDO:",
        "Usuario: 'consígueme transporte del aeropuerto al hotel en Madrid'",
        "MAL: 'necesito que me digas las fechas y el hotel'",
        "BIEN: 'Veo que llegas a Madrid Barajas T4S el 10 jul 14:50 (IB0572) y vas al Hotel",
        "Indigo Gran Vía (Calle Silva 6). Te propongo 3 opciones de transfer...'",
        "",
        "CONCIERGE PROACTIVO — DETECCIÓN DE FALTANTES:",
        "Cuando el usuario pregunte por una categoría (transfers, restaurantes, tours, etc.),",
        "COMPARA lo ya reservado (en reservas_confirmadas_bookings) vs lo que el itinerario",
        "implica que falta, y sugiere proactivamente lo faltante con fechas/horas exactas.",
        "",
        "REGLA ESPECÍFICA DE TRANSFERS AEROPUERTO → HOTEL:",
        "Si el usuario pide transporte/transfer al hotel, primero busca en datos_relevantes_para_la_peticion_actual,",
        "vuelos, hospedaje, itinerario.transfers y pendientes. Debes responder usando el vuelo, hotel, fecha,",
        "dirección y confirmaciones existentes. Si falta hora exacta, NO pidas todo otra vez: indícalo como único dato",
        "faltante o propón opciones flexibles con seguimiento de vuelo.",
        "",
        "PROHIBIDO ABSOLUTO:",
        "No respondas jamás: 'necesito saber el nombre de tu hotel', 'necesito la fecha',",
        "'dime tu vuelo' o equivalentes cuando el JSON contiene hospedaje/vuelos/fechas.",
      ].join("\n");
    }

    const masterPrompt = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();

    const systemContent = [masterPrompt, userContextBlock, tripContextBlock, SYSTEM]
      .filter((s) => s && s.length > 0)
      .join("\n\n---\n\n");

    // Conversación con tool-calling loop
    const messages: any[] = [
      { role: "system", content: systemContent },
      ...body.messages.slice(-10),
    ];


    const toolsUsed: string[] = [];
    let finalText = "";
    for (let i = 0; i < 4; i++) {
      const res = await fetch(AI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
          tools: TOOLS,
          tool_choice: "auto",
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        if (res.status === 429) return new Response(JSON.stringify({ error: "Demasiadas solicitudes, intenta en un momento." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (res.status === 402) return new Response(JSON.stringify({ error: "Sin créditos de IA. Recarga en Settings → Workspace." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: `AI gateway ${res.status}`, detail: t }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) break;

      if (msg.tool_calls?.length) {
        messages.push(msg);
        for (const tc of msg.tool_calls) {
          const args = (() => { try { return JSON.parse(tc.function.arguments ?? "{}"); } catch { return {}; } })();
          toolsUsed.push(tc.function.name);
          const out = await callTool(tc.function.name, args, authHeader);
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        }
        continue;
      }

      finalText = msg.content ?? "";
      // Forzar JSON: pedir reformat si no es JSON válido
      try { JSON.parse(finalText); } catch {
        const m = finalText.match(/\{[\s\S]*\}/);
        finalText = m ? m[0] : JSON.stringify({ text: finalText, cards: [] });
      }
      break;
    }

    // Log para aprendizaje
    logInsight(supabase, u.user.id, lastUserMsg, toolsUsed).catch(() => {});

    if (!finalText) finalText = JSON.stringify({ text: "Estoy procesando demasiada información, intenta de nuevo.", cards: [] });

    let parsed: any;
    try { parsed = JSON.parse(finalText); }
    catch { parsed = { text: finalText, cards: [] }; }
    const fallback = shouldForceTransferAnswer(requestIntel, parsed) ? buildTransferFallback(requestIntel) : null;
    if (fallback) {
      parsed = fallback;
      console.warn("concierge_guardrail_rewrote_known_data_request", JSON.stringify({ trip_id: trip?.id, city: requestIntel?.ciudad_detectada }));
    }
    parsed._tools_used = toolsUsed;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("concierge-chat error", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
