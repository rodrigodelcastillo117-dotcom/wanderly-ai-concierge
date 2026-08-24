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
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { getUsdMxnRate } from "../_shared/fx.ts";

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
  };
}

type Tier = "ahorro" | "equilibrio" | "premium";

const MODEL = "google/gemini-2.5-pro";
const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

async function callAI(apiKey: string, system: string, user: string, toolName: string, schema: any) {
  const res = await fetch(AI_URL, {
    method: "POST",
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
- mandatory_costs DEBE incluir en notes la gasolina + peajes calculados por km totales.`;

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

function invokeFn(name: string, authHeader: string, payload: unknown) {
  return fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  })
    .then((r) => r.json())
    .catch((e) => ({ error: String(e?.message ?? e) }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const __user = await getAuthUser(req);
  if (!__user) return unauthorizedResponse(corsHeaders);

  const __rl = await enforceRateLimit(req, "logistics-plan", __user.id, { perMinute: 8, perHour: 60, ipPerMinute: 25 });
  if (!__rl.allowed) return rateLimitResponse(__rl, corsHeaders);

  try {
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    if (!body?.origin || !Array.isArray(body?.destinations) || body.destinations.length < 1) {
      return new Response(JSON.stringify({ error: "origin y destinations son requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";

    // ───── Perfil + tier del presupuesto ─────
    let perfilLine = "Usuario sin perfil — nivel equilibrio.";
    let presupuestoRango: string | null = null;
    try {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      if (token) {
        const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: { user } } = await supa.auth.getUser(token);
        if (user) {
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
        }
      }
    } catch (e) {
      console.warn("perfil:", e);
    }

    const selectedTier: Tier = tierFromPresupuesto(presupuestoRango);
    const fxUsd = await getUsdMxnRate();

    const nights = body.fecha_salida && body.fecha_regreso
      ? Math.max(1, Math.round((new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) / 86400000))
      : Math.max(body.destinations.length * 3, 6);

    const viajeros = Math.max(1, Number(body.num_viajeros) || 2);
    const fechas = `${body.fecha_salida ?? "flexible"} a ${body.fecha_regreso ?? "flexible"}`;
    const cityList = body.destinations.join(" → ");
    const roadtripMode = isRoadtrip(body.destinations, body.origin);
    const roadtripBlock = roadtripMode ? `\n\n${ROADTRIP_RULES}` : "";

    // Ventanas de fechas por ciudad para consultar hoteles reales.
    const nightsPerCity = splitNights(nights, body.destinations.length);
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
    const tpFlightsPromise = invokeFn("travelpayouts-flights", authHeader, {
      origin_city: body.origin,
      destination_city: body.destinations[0],
      departure_date: body.fecha_salida ?? fallbackStart,
      return_date: body.fecha_regreso ?? addDays(fallbackStart, nights),
      adults: viajeros,
      currency: "usd",
    });

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
        }),

        invokeFn("tripadvisor-search", authHeader, {
          query: w.city,
          category: "attractions",
          language: "es_MX",
        }),
      ]).then(([hotels, attractions]) => ({ hotels, attractions })),
    );

    const [tpFlights, ...cityLive] = await Promise.all([tpFlightsPromise, ...cityLivePromises]);

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
    const globalPrompt = `${perfilLine}${roadtripBlock}

Origen: ${body.origin}
Destinos en orden: ${cityList}
Viajeros: ${viajeros} | Fechas: ${fechas} (~${nights} noches)
Preferencia conexión: ${body.prefs?.connection ?? "smart"}
NIVEL DE PRESUPUESTO DEL USUARIO: ${selectedTier} (${presupuestoRango ?? "sin perfil, default equilibrio"}). Todas tus recomendaciones deben girar alrededor de este nivel.
${roadtripMode ? "MODO: ROADTRIP (transporte interno = coche/campervan obligatorio, NO vuelos internos)." : ""}

==========================================
VUELOS — ${tpFlightsBlock}
==========================================

Entrega JSON con:
1. flights: EXACTAMENTE 3 opciones (tier ahorro/equilibrio/premium) para el vuelo internacional ${body.origin} ⇄ ${body.destinations[0]} (round-trip). NO repitas la misma ruta más de una vez por tier. Si arriba hay datos en vivo, copia precio y booking_link exactos y pon fuente_precio="travelpayouts".
2. internal_transport: ${roadtripMode
  ? `tramos en COCHE/CAMPERVAN entre ciudades consecutivas (mode="coche", provider real, duración en horas, scenic=true, luggage_note con km y paradas). Añade pickup aeropuerto → primera ciudad y dropoff última → aeropuerto.`
  : `UN tramo por cada par consecutivo (${body.destinations.length - 1} tramos), sin duplicados. Europa <800km usa TREN. Inter-islas griegas usa FERRY.`} Marca fuente_precio="estimado" (no tenemos inventario en vivo de tierra).
3. days: ${nights} días distribuidos lógicamente entre las ciudades, cada uno con ciudad/título/mañana/tarde/noche específicos${roadtripMode ? " (mencionando carretera, km y paradas escénicas)" : ""}.
4. mandatory_costs con currency_buffer_pct=3${roadtripMode ? ' e incluye en "notes" gasolina + peajes' : ""}.
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
      const attrBlock = attrLive
        ? `DATOS EN VIVO — TRIPADVISOR (fuente="tripadvisor"; nombre y rating REALES, el precio sigue siendo estimación):\n` +
          live.attractions.results.slice(0, 8).map((a: any, j: number) =>
            `${j + 1}. ${a.name}${a.rating ? ` — rating ${a.rating}/5 (${a.num_reviews ?? "?"} reseñas)` : ""}${a.ranking ? ` — ${a.ranking}` : ""}`
          ).join("\n")
        : `(Sin datos en vivo de atracciones — usa experiencias reales conocidas y pon fuente="estimado")`;

      const cityPrompt = `${perfilLine}${roadtripBlock}

Ciudad: ${city}
Punto anterior: ${prevPoint}
Viajeros: ${viajeros} | Noches: ${cityNights} (${w.checkin} → ${w.checkout})
Ruta completa del viaje (contexto): ${body.origin} → ${cityList}
NIVEL DE PRESUPUESTO DEL USUARIO: ${selectedTier}. El hospedaje del tier "${selectedTier}" es el que se usará para el total.
${roadtripMode ? "MODO: ROADTRIP — arrival_options principal SIEMPRE en coche con km, horas y paradas." : ""}

==========================================
HOSPEDAJE — ${hotelsBlock}
==========================================
EXPERIENCIAS — ${attrBlock}
==========================================

Entrega JSON con:
- city: "${city}"
- nights: ${cityNights}
- arrival_options: 2-3 maneras de LLEGAR desde ${prevPoint}, sin duplicar la misma opción. ${roadtripMode
  ? `La PRINCIPAL es coche por carretera real con km, horas y 2-3 paradas escénicas en "notes".`
  : `Si es Europa <800km incluye tren real. Si son islas griegas incluye ferry real y vuelo Aegean/Sky Express.`} fuente_precio="estimado" salvo que se indique lo contrario.
- hospedaje: EXACTAMENTE 3 (ahorro/equilibrio/premium). Si hay datos en vivo arriba, los 3 DEBEN salir de esa lista (el más barato = ahorro, uno intermedio = equilibrio, el más caro/mejor = premium), copiando nombre, precio y booking_url exactos con fuente_precio="serpapi".
- restaurantes: 4-5 reales en ${city} acordes al estilo del usuario.
- experiencias: 4-5 en ${city}; prioriza las de TripAdvisor arriba con fuente="tripadvisor" y su rating real.`;

      return callAI(apiKey, CITY_SYSTEM, cityPrompt, "emit_city", citySchema)
        .then((r) => ({ ...r, city, nights: cityNights, checkin: w.checkin, checkout: w.checkout }))
        .catch((e) => {
          console.error(`city ${city} failed:`, e.message);
          return {
            city, nights: cityNights, checkin: w.checkin, checkout: w.checkout,
            arrival_options: [], hospedaje: [], restaurantes: [], experiencias: [],
          };
        });
    });

    const globalPromise = callAI(apiKey, GLOBAL_SYSTEM, globalPrompt, "emit_global", globalSchema)
      .catch((e) => {
        console.error("global failed:", e.message);
        return { flights: [], internal_transport: [], days: [], mandatory_costs: {}, resumen: "" };
      });

    const [globalData, ...cityData] = await Promise.all([globalPromise, ...cityPromises]);

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
        duration: f.duration_minutes ? `${Math.round(f.duration_minutes / 60)}h` : "",
        stops: Number(f.stops) > 0 ? `${f.stops} escala(s)` : "Directo",
        price_per_person_usd: Math.round(Number(f.price)),
        booking_link: f.booking_link ?? null,
        fuente_precio: "travelpayouts",
        notes: tpFlights.approximate_dates
          ? "Tarifa real de inventario; la fecha exacta puede variar unos días."
          : "Tarifa real de inventario consultada hoy.",
      });
      const ahorro = sorted[0];
      const equilibrio = sorted[Math.floor(sorted.length / 2)] ?? ahorro;
      const premium = sorted[sorted.length - 1] ?? equilibrio;
      flights = [pick(ahorro, "ahorro"), pick(equilibrio, "equilibrio"), pick(premium, "premium")];
    } else {
      flights = flights.map((f) => ({ ...f, fuente_precio: f.fuente_precio ?? "estimado" }));
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
      return (Array.isArray(globalData.internal_transport) ? globalData.internal_transport : [])
        .map((l: any) => ({ ...l, fuente_precio: l.fuente_precio ?? "estimado" }))
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
        if (built.length) hospedaje = built;

      } else {
        hospedaje = hospedaje.map((h: any) => ({ ...h, fuente_precio: h.fuente_precio ?? "estimado" }));
      }

      const experiencias = (Array.isArray(pd.experiencias) ? pd.experiencias : []).map((e: any) => ({
        ...e,
        fuente: e.fuente ?? "estimado",
      }));

      const arrival_options = (() => {
        const seen = new Set<string>();
        return (Array.isArray(pd.arrival_options) ? pd.arrival_options : [])
          .map((o: any) => ({ ...o, fuente_precio: o.fuente_precio ?? "estimado" }))
          .filter((o: any) => {
            const key = `${(o.from ?? "").toLowerCase()}|${o.mode ?? ""}|${o.provider ?? ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
      })();

      return { ...pd, hospedaje, experiencias, arrival_options };
    });

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
        // Una habitación por cada 2 viajeros.
        const rooms = Math.max(1, Math.ceil(viajeros / 2));
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
      return new Response(JSON.stringify({
        error: "no_pricing_available",
        message: "No pudimos armar una cotización confiable ahora mismo. Intenta de nuevo en unos minutos.",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const logistics = {
      ...globalData,
      flights,
      internal_transport: internalTransport,
      per_destination: perDestination,
      selected_tier: selectedTier,
      presupuesto_rango: presupuestoRango,
      fx_usd_mxn: fxUsd,
      nights,
      desglose_presupuesto: desglose,
      total_estimado_mxn: totalMxn,
      total_estimado_usd: Math.round(totalMxn / fxUsd),
      pricing_sources: {
        vuelos: tpLive ? "travelpayouts" : "estimado",
        hospedaje: perDestination.some((pd: any) => (pd.hospedaje ?? []).some((h: any) => h.fuente_precio === "serpapi"))
          ? "serpapi"
          : "estimado",
        experiencias: perDestination.some((pd: any) => (pd.experiencias ?? []).some((e: any) => e.fuente === "tripadvisor"))
          ? "tripadvisor"
          : "estimado",
      },
    };

    return new Response(JSON.stringify({ logistics }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    console.error("logistics-plan error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
