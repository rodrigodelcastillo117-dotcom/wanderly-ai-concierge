// supabase/functions/analizar-viaje/index.ts
// Flujo: Perplexity (sonar-pro) investiga precios reales -> Claude estructura el análisis premium.
// FIX v3: Perplexity opcional — si falta la key, continúa sin contexto cualitativo (no 500).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  invalidRequestResponse,
  quotaDeniedResponse,
  reservationDeps,
  serviceUnavailableResponse,
  unauthenticatedResponse,
} from "../_shared/entitlements.ts";
import {
  analysisMeetsContract,
  resolveRequestKey,
  runWithReservation,
  type WorkCtx,
  type WorkResult,
} from "../_shared/reservation.ts";
import { enforceRateLimit, rateLimitResponse } from "../_shared/rate-limit.ts";
import { sendEmail, tripQuoteEmail } from "../_shared/email.ts";
import { aiFetch } from "../_shared/ai.ts";
import { callClaudeWithFallback } from "../_shared/claude.ts";
import { internalHeaders, logUsage } from "../_shared/serpRuntime.ts";
import { usageFromClaude } from "../_shared/usage.ts";
import { getEurMxnRateInfo, getUsdMxnRateInfo } from "../_shared/fx.ts";
import { buildQuoteSnapshot, saveQuoteSnapshot } from "../_shared/quotes.ts";
import { resolveTpMarker } from "../_shared/tp-params.ts";
import { enforceSources, hotelPreference } from "./sources.ts";
import { normalizarVuelos, reconcileBudget } from "./budget.ts";

// Las miniaturas de Google (googleusercontent) aceptan el tamaño en el sufijo "=w..-h..".
function largeGooglePhoto(url: unknown): string | null {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return null;
  if (/googleusercontent\.com/.test(url) && url.includes("=")) return url.replace(/=[^=/]*$/, "=w1600-h900-k-no");
  return url;
}

// Portada real del viaje: foto del lugar más reseñado del destino; si no hay, la del primer hotel.
function pickCover(places: any[], hotels: any[]): string | null {
  for (const p of places ?? []) {
    const u = largeGooglePhoto(p?.photos?.[0]);
    if (u) return u;
  }
  for (const h of hotels ?? []) {
    const u = largeGooglePhoto(h?.thumbnail);
    if (u) return u;
  }
  return null;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const MASTER_PROMPT_IATOS = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";


interface AnalisisRequest {
  destino: string;
  pais_destino?: string;
  ciudad_origen: string;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  num_viajeros: number;
  presupuesto_objetivo?: number | null;
  notas_usuario?: string | null;
  trip_length_days?: number | null;
  /** Llave de idempotencia por intento (sessionStorage del cliente). */
  request_key?: string;
  /** Re-análisis de un viaje existente: se actualiza esa fila (mismo id) en lugar de crear otra. */
  trip_id?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolverFechasSiFaltan(
  authHeader: string,
  body: AnalisisRequest,
): Promise<{ fecha_salida: string; fecha_regreso: string; optimization: any | null }> {
  const has = !!body.fecha_salida && !!body.fecha_regreso && body.fecha_regreso > body.fecha_salida;
  if (has) {
    return {
      fecha_salida: body.fecha_salida as string,
      fecha_regreso: body.fecha_regreso as string,
      optimization: null,
    };
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/resolver-fechas`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      destino: body.destino,
      pais_destino: body.pais_destino,
      fecha_salida: body.fecha_salida,
      fecha_regreso: body.fecha_regreso,
      notas_usuario: body.notas_usuario,
      trip_length_days: body.trip_length_days,
    }),
  });
  if (!res.ok) {
    throw new Error(`resolver-fechas ${res.status}: ${await res.text()}`);
  }
  const j = await res.json();
  return {
    fecha_salida: j.fecha_salida,
    fecha_regreso: j.fecha_regreso,
    optimization: j.optimization ?? null,
  };
}

const DEFAULT_TP_MARKER = resolveTpMarker(Deno.env.get("TRAVELPAYOUTS_MARKER"));

/**
 * CAPA DE SEGURIDAD (sub-regla 15.1): garantiza que TODO link de Aviasales
 * en los vuelos lleve `?marker=...`. Si Claude truncó el marker al copiar el
 * booking_link, lo re-inyectamos antes de guardar/responder. Esto protege la
 * comisión de afiliado aunque el modelo se equivoque.
 */
function ensureMarkerInFlightLinks(vuelos: any[]): any[] {
  if (!Array.isArray(vuelos)) return vuelos;
  const marker = DEFAULT_TP_MARKER;
  const fix = (url: unknown): unknown => {
    if (typeof url !== "string" || !url) return url;
    if (!url.startsWith("https://www.aviasales.com/") && !url.startsWith("https://aviasales.com/")) return url;
    if (/[?&]marker=/.test(url)) return url;
    return url + (url.includes("?") ? "&" : "?") + `marker=${marker}`;
  };
  for (const v of vuelos) {
    if (!v || typeof v !== "object") continue;
    if (v.booking_link) v.booking_link = fix(v.booking_link);
    if (v.cta_action) v.cta_action = fix(v.cta_action);
  }
  return vuelos;
}

const buildSystemPrompt = (fxUsd: number, fxEur: number) => `Eres un consultor de viajes premium con 20 años de experiencia, tono sofisticado, cálido y específico, como un concierge personal. Siempre respondes en español de México y todos los precios en pesos mexicanos (MXN).

REGLAS ESTRICTAS DE PRECIOS:
1. PROHIBIDO inventar, redondear hacia abajo o "ajustar" precios. Cada cifra que pongas DEBE aparecer textualmente (o ser conversión directa USD→MXN / EUR→MXN) en la sección "INVESTIGACIÓN DE PRECIOS REALES".
2. Si Perplexity te da un rango (ej: "$25,000-$32,000"), usa el PUNTO MEDIO, nunca el extremo bajo.
3. Tipo de cambio de referencia del día (no fijo, actualizado al momento de esta consulta): 1 USD = ${fxUsd} MXN, 1 EUR ≈ ${fxEur} MXN. Convierte siempre usando estos valores.
4. Para vuelos con varios segmentos (ej: CDMX→París→Madrid→Atenas), entrega SOLO 3 filas de vuelos: ahorro, equilibrio y premium. Cada fila debe representar el COSTO TOTAL DE TODOS LOS SEGMENTOS por persona, no un solo tramo. Si Perplexity desglosa por tramo, SUMA los tramos antes de poner el precio.
5. Si una opción "equilibrio" o "premium" sale más barata que "ahorro", está mal: revisa y corrige.
6. Nombres reales de hoteles, aerolíneas, restaurantes y barrios — los que aparezcan en la investigación.
7. total_estimado = suma coherente del desglose para el GRUPO COMPLETO (multiplica por num_viajeros en vuelos/comida/tours; hospedaje es por habitación × noches).
8. En analisis_narrativo cita explícitamente 2-3 fuentes reales de la lista de FUENTES CITADAS.
9. Responde SIEMPRE llamando a la herramienta "entregar_analisis_viaje". Nunca texto libre.
10. CRUCEROS: Si el viaje incluye múltiples islas/puertos/destinos costeros conectados (islas griegas, Caribe, Mediterráneo, fiordos, Alaska), DEBES llenar "cruceros_alternativas" con 2-3 opciones reales tomadas de la investigación de Perplexity. Si no aplica claramente, devuelve [] (array vacío) en ese campo.
11. INSTRUCCIONES DEL USUARIO (prioridad MÁXIMA): Si el bloque "INSTRUCCIONES LITERALES DEL USUARIO" contiene cualquier exclusión, restricción o preferencia (ej: "sin hospedaje en París", "no quiero hoteles", "ya tengo dónde quedarme en X", "sin tours", "solo vuelos", "no comida", "vegano", "evitar Y"), DEBES respetarla AL 100%. En ese caso:
    - Pon 0 (cero) en el desglose_presupuesto correspondiente (ej. hospedaje: 0 si dijo sin hospedaje en TODAS las ciudades; si solo excluye una ciudad, descuenta esas noches).
    - En "hospedaje" devuelve [] si excluyó todo, o solo las ciudades donde SÍ quiere hotel.
    - Menciona explícitamente en analisis_narrativo: "Respetando tu indicación de [X], no incluyo [Y]".
    - NO ofrezcas alternativas no pedidas para lo excluido.
    Lee la instrucción palabra por palabra. Si dice "París sin hospedaje" pero el viaje también va a Roma, sigue cotizando hotel en Roma.
12. PRECIOS VERIFICADOS Y REALISTAS (CRÍTICO): Cada precio (hospedaje precio_por_noche, tours precio_por_persona, restaurantes rango_precio) debe provenir de la "INVESTIGACIÓN DE PRECIOS REALES" (Booking, Expedia, sitio oficial del hotel, GetYourGuide, Viator, TripAdvisor, OpenTable, etc.). PROHIBIDO inventar nombres de hoteles/restaurantes/tours que no aparezcan en la investigación. Si no encuentras un precio real para un ítem, NO LO INCLUYAS. Mejor 2 opciones reales que 3 inventadas.
13. RANGOS REALISTAS DE REFERENCIA (si tu cifra cae fuera, revísala antes de entregar):
    - Hotel boutique/4★ en México (Riviera Maya, CDMX, Oaxaca, San Cristóbal): $2,500-$8,000 MXN/noche.
    - Hotel 5★ / resort todo incluido en México: $6,000-$18,000 MXN/noche.
    - Hotel ultra-lujo (Rosewood, Banyan Tree, One&Only, Belmond) en México: $15,000-$45,000 MXN/noche.
    - Restaurante casual local México: $200-$500 MXN p/p. Medio: $500-$1,200. Fine dining: $1,500-$4,000.
    - Tour grupal medio día México: $600-$1,800 MXN p/p. Tour día completo: $1,500-$4,000. VIP/privado: $4,000-$12,000.
14. ORDENA cada array de menor a mayor precio: "hospedaje" ascendente por precio_por_noche, "tours" ascendente por precio_por_persona, "restaurantes" ascendente por el extremo inferior del rango_precio. El usuario ve siempre primero la opción más accesible.
15. FUENTE PRIMARIA DE PRECIOS DE VUELO — TRAVELPAYOUTS/AVIASALES (REGLA NO NEGOCIABLE):
    - Cuando en el userPrompt veas el bloque "PRECIOS PRIMARIOS — TRAVELPAYOUTS" con vuelos listados (Aviasales y/o Google Flights, líneas con "LINK: https://www.aviasales.com/..."), ESOS VUELOS SON LA FUENTE PRIMARIA. Usa SUS precios (convertidos USD×${fxUsd} = MXN, tipo de cambio de referencia del día) para los 3 tiers ahorro/equilibrio/premium. No uses "rangos históricos", no uses precios estimados ni los que Perplexity sugiera para vuelos.
    - Perplexity es SOLO contexto cualitativo (restaurantes, tours, tips, mejor temporada). NUNCA fuente de precios de vuelo si Travelpayouts trajo datos.
    - PROHIBIDO generar booking_link a google.com/travel, google.com/flights o búsquedas genéricas de Google. Está bloqueado por CORS y rompe la experiencia.
    - Para booking_link de cada vuelo: copia EXACTAMENTE el LINK del bloque TRAVELPAYOUTS (formato https://www.aviasales.com/...?marker=...). Si por algún motivo no tienes un link de Aviasales para un tier, usa el sitio oficial de la aerolínea: Aeroméxico → https://aeromexico.com, Iberia → https://iberia.com, American → https://aa.com, United → https://united.com, Delta → https://delta.com, Air France → https://airfrance.com, LATAM → https://latam.com, Avianca → https://avianca.com, KLM → https://klm.com, Lufthansa → https://lufthansa.com, British Airways → https://britishairways.com, Volaris → https://volaris.com, Viva → https://vivaaerobus.com. NUNCA google.com.
     - Si Travelpayouts NO trajo datos (el bloque dice "Sin datos de Travelpayouts"), entonces sí cae a Perplexity para el precio, pero el booking_link sigue siendo el sitio oficial de la aerolínea — JAMÁS google.com/travel.

     SUB-REGLA 15.1 — PRESERVACIÓN DEL MARKER (CRÍTICA):
     Cuando copies un booking_link del bloque TRAVELPAYOUTS al campo booking_link (o cta_action)
     del JSON de salida, COPIA LA URL COMPLETA INCLUYENDO los parámetros después del "?". NUNCA
     trunques "?marker=...", "&marker=...", ni cualquier parámetro de query string. El marker
     es nuestro identificador de afiliado y SIN ÉL perdemos toda comisión.

     Si el booking_link en el prompt termina con "?marker=533299", tu booking_link TAMBIÉN debe
     terminar con "?marker=533299". No simplifiques, no abrevies, no limpies la URL.

     EJEMPLO CORRECTO:
     - Prompt dice: LINK: https://www.aviasales.com/search/MEX0511SCL12111?marker=533299
     - booking_link: "https://www.aviasales.com/search/MEX0511SCL12111?marker=533299"

     EJEMPLO INCORRECTO (NO HAGAS ESTO):
     - Prompt dice: LINK: https://www.aviasales.com/search/MEX0511SCL12111?marker=533299
     - booking_link: "https://www.aviasales.com/search/MEX0511SCL12111"   ← FALTA MARKER
16. LINKS DE RESTAURANTES — REGLA NO NEGOCIABLE:
    Para el campo cta_action de cada restaurante en el array "restaurantes", usa SIEMPRE
    un link real útil. Orden de prioridad:
    A) Sitio web oficial del restaurante si lo conoces con certeza (ej. lhardy.com,
       botin.es, restaurantecoque.com, pujol.com.mx, quintonil.com). Verifica que sea el
       dominio real (.com / .es / .mx según país); NO inventes dominios.
     B) Si NO sabes el sitio oficial con certeza, usa el sistema de reserva conocido del
        país EXACTO. SOLO usa thefork.com / thefork.fr / thefork.es / thefork.it si estás
        SEGURO que el restaurante está listado ahí. NUNCA inventes una URL específica de
        thefork si no la viste antes.
        - España: https://www.thefork.es (genérica, sin /r/inventado)
        - Francia: https://www.thefork.fr
        - Italia: https://www.thefork.it
        - UK: https://www.opentable.co.uk
        - USA: https://www.opentable.com o https://resy.com
        - México: https://www.opentable.com.mx
        - Japón: https://tabelog.com

        PAÍSES SIN PLATAFORMA RESERVA DOMINANTE (Argentina, Chile, Perú, Colombia, Brasil,
        Grecia, Turquía, Egipto, Marruecos, Sudáfrica, India, Tailandia, Vietnam,
        Indonesia, etc.): NO uses thefork.com ni inventes plataforma. SALTA directo a
        opción C (Google Maps).
    C) ÚLTIMO recurso si nada anterior aplica: link de búsqueda en Google Maps
       https://www.google.com/maps/search/[NOMBRE+RESTAURANTE]+[CIUDAD]
       (NO uses google.com/search ni búsquedas web genéricas — solo Google Maps porque
       SÍ funciona en navegador y muestra el restaurante con info de reserva).
    PROHIBIDO:
    - Links de búsqueda genérica de Google (google.com/search?q=...)
    - Links a Yelp, Tripadvisor sin URL específica
    - Inventar dominios que no existen
    - Dejar el campo cta_action vacío
    Para restaurantes Michelin/World's 50 Best/icónicos: prefiere SIEMPRE el sitio
    oficial del restaurante (regla A), no plataforma de reserva.`;

const TOOL_SCHEMA = {
  name: "entregar_analisis_viaje",
  description: "Entrega el análisis completo y estructurado de un viaje premium personalizado.",
  input_schema: {
    type: "object",
    properties: {
      analisis_narrativo: { type: "string" },
      total_estimado: { type: "number" },
      match_score: { type: "integer" },
      desglose_presupuesto: {
        type: "object",
        properties: {
          vuelos: { type: "number" },
          hospedaje: { type: "number" },
          comida: { type: "number" },
          tours: { type: "number" },
          transporte_local: { type: "number" },
          extras: { type: "number" },
        },
        required: ["vuelos", "hospedaje", "comida", "tours", "transporte_local", "extras"],
      },
      vuelos: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        description:
          "Exactamente 3 opciones: ahorro, equilibrio y premium. Cada precio_por_persona es la ruta aérea completa por persona, sumando todos los segmentos del viaje.",
        items: {
          type: "object",
          properties: {
            tier: { type: "string", enum: ["ahorro", "equilibrio", "premium"] },
            aerolinea: { type: "string" },
            duracion: { type: "string" },
            escalas: { type: "string" },
            precio_por_persona: { type: "number" },
            notas: { type: "string" },
            booking_link: { type: "string", description: "Link de afiliado (Aviasales) del vuelo elegido en las listas de VUELOS. Cópialo tal cual." },
            fuente_precio: { type: "string", enum: ["travelpayouts", "serpapi", "perplexity", "estimado"], description: "Origen del precio: 'travelpayouts' si salió de VUELOS (Aviasales), 'serpapi' si salió de VUELOS (Google Flights)." },
          },
          required: ["tier", "aerolinea", "duracion", "escalas", "precio_por_persona"],
        },
      },
      hospedaje: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            tipo: { type: "string" },
            barrio: { type: "string" },
            rating: { type: "number" },
            precio_por_noche: { type: "number" },
            por_que: { type: "string" },
            booking_link: { type: "string", description: "Link de reserva si el hotel vino del bloque SERPAPI / GOOGLE HOTELS. Cópialo tal cual." },
            fuente_precio: { type: "string", enum: ["serpapi", "travelpayouts", "perplexity", "estimado"], description: "Usa 'serpapi' si el precio vino del bloque GOOGLE HOTELS." },
          },
          required: ["nombre", "tipo", "barrio", "rating", "precio_por_noche", "por_que"],
        },
      },
      itinerario: {
        type: "array",
        items: {
          type: "object",
          properties: {
            dia: { type: "integer" },
            titulo: { type: "string" },
            mañana: { type: "string" },
            tarde: { type: "string" },
            noche: { type: "string" },
            costo_aprox_dia: { type: "number" },
          },
          required: ["dia", "titulo", "mañana", "tarde", "noche"],
        },
      },
      restaurantes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            cocina: { type: "string" },
            rango_precio: { type: "string" },
            por_que: { type: "string" },
            cta_action: { type: "string", description: "Link de reserva oficial o plataforma de reserva real (TheFork, OpenTable, Resy, Tabelog, Google Maps). NUNCA google.com/search genérico." },
          },
          required: ["nombre", "cocina", "rango_precio", "por_que"],
        },
      },
      tours: {
        type: "array",
        items: {
          type: "object",
          properties: {
            nombre: { type: "string" },
            duracion: { type: "string" },
            precio_por_persona: { type: "number" },
            por_que: { type: "string" },
            fuente: { type: "string", enum: ["tripadvisor", "google_maps", "perplexity", "estimado"], description: "Usa la fuente que indica el bloque ATRACCIONES ('tripadvisor' o 'google_maps') si el nombre/rating salió de ahí." },
            rating: { type: "number", description: "Rating real (0-5) si salió del bloque ATRACCIONES." },
            num_reviews: { type: "integer", description: "Número real de reseñas si salió del bloque ATRACCIONES." },
          },
          required: ["nombre", "duracion", "precio_por_persona", "por_que"],
        },
      },
      tips_personalizados: { type: "array", items: { type: "string" } },
      pais_destino: { type: "string" },
      cruceros_alternativas: {
        type: "array",
        description:
          "Si el viaje incluye múltiples islas, puertos o destinos costeros conectados (ej: islas griegas desde Atenas, Caribe, Mediterráneo, fiordos), incluye 2-3 opciones REALES de crucero que cubran toda o parte de la ruta. Si no aplica, devuelve [].",
        items: {
          type: "object",
          properties: {
            naviera: { type: "string", description: "Naviera real (Celestyal, MSC, Royal Caribbean, Norwegian, etc)" },
            barco: { type: "string", description: "Nombre real del barco si está disponible" },
            nombre_itinerario: { type: "string", description: "Ej: 'Iconic Aegean 4 noches' o 'Greek Isles & Turkey 7 noches'" },
            puerto_salida: { type: "string", description: "Puerto exacto, ej: 'Pireo (Atenas)'" },
            puertos_visitados: { type: "array", items: { type: "string" } },
            noches: { type: "integer" },
            fecha_salida_sugerida: { type: "string", description: "YYYY-MM-DD dentro de las fechas del viaje" },
            categoria_cabina: { type: "string", enum: ["interior", "exterior", "balcon", "suite"] },
            precio_por_persona: { type: "number", description: "MXN, incluye impuestos y propinas estimadas" },
            incluye: { type: "array", items: { type: "string" }, description: "Ej: ['todas las comidas','3 excursiones','traslados puerto']" },
            por_que: { type: "string", description: "Por qué le conviene VS hacer el island-hop por ferry/avión." },
            ahorro_vs_islas_independiente: { type: "number", description: "MXN aprox que ahorra vs hospedaje+ferry+comida independiente. Puede ser negativo si es más caro." },
          },
          required: ["naviera", "nombre_itinerario", "puerto_salida", "puertos_visitados", "noches", "categoria_cabina", "precio_por_persona", "por_que"],
        },
      },
    },
    required: [
      "analisis_narrativo",
      "total_estimado",
      "match_score",
      "desglose_presupuesto",
      "vuelos",
      "hospedaje",
      "itinerario",
      "restaurantes",
      "tours",
      "tips_personalizados",
      "pais_destino",
    ],
  },
};

async function investigarConPerplexity(
  body: AnalisisRequest,
  dias: number,
  vaultDesc: string,
): Promise<{ texto: string; citations: string[] }> {
  if (!PERPLEXITY_API_KEY) {
    return {
      texto: "(Perplexity no configurado: continuar con Travelpayouts/Aviasales y estimaciones estructuradas sin contexto web adicional.)",
      citations: [],
    };
  }

  const query = `Investiga precios REALES y actuales para este viaje, y BUSCA ACTIVAMENTE promociones vigentes asociadas a los programas de lealtad del usuario. Devuelve CIFRAS PUNTUALES en MXN (no rangos vagos).

BÓVEDA DE BENEFICIOS DEL USUARIO (úsala para encontrar descuentos):
${vaultDesc}

Origen: ${body.ciudad_origen}
Destino: ${body.destino}
Fechas: ${body.fecha_salida} al ${body.fecha_regreso} (${dias} días)
Viajeros: ${body.num_viajeros}

FORMATO OBLIGATORIO: Para cada ítem reporta "Aerolínea/Hotel X: $XX,XXX MXN" con cifra única (si el sitio da rango, usa el punto medio). Incluye link de fuente entre paréntesis.

1. VUELOS — Identifica TODOS los segmentos necesarios entre ${body.ciudad_origen} y ${body.destino} (incluyendo si hay que volar entre ciudades intermedias o llegar a puerto de crucero). Para CADA segmento, da 3 opciones:
   - AHORRO: aerolínea real, escalas, duración, precio MXN por persona (tarifa más económica disponible esas fechas)
   - EQUILIBRIO: directo o 1 escala buena, precio MXN
   - PREMIUM: premium economy o business, precio MXN
   Luego entrega una tabla final "TOTALES AÉREOS POR PERSONA" con EXACTAMENTE 3 totales comparables: AHORRO = suma de todos los segmentos ahorro, EQUILIBRIO = suma de todos los segmentos equilibrio, PREMIUM = suma de todos los segmentos premium. No mezcles segmentos individuales con totales.
   Fuentes: Google Flights, Skyscanner, Kayak, Aeroméxico, sitios de aerolíneas.

2. HOSPEDAJE — ${dias} noches totales (desglosa por ciudad si aplica). 3 opciones con NOMBRE REAL del hotel (3★, 4★ boutique, 5★), barrio, rating, precio MXN por noche habitación doble en esas fechas exactas. Fuentes: Booking.com, Hotels.com.

3. CRUCERO COMO ALTERNATIVA (OBLIGATORIO si el destino incluye 2+ islas, puertos o ciudades costeras conectadas — ej: islas griegas, Caribe, Mediterráneo, fiordos noruegos, Alaska, Bahamas):
   Busca 2-3 cruceros REALES con salida desde el puerto natural más cercano al origen del viaje (ej: Pireo/Atenas para islas griegas, Civitavecchia/Roma para Mediterráneo Oeste, Barcelona, Miami para Caribe). Para cada uno reporta:
   - Naviera + nombre del barco (Celestyal Journey, MSC Musica, Royal Caribbean Odyssey, etc)
   - Nombre del itinerario oficial (ej: "Iconic Aegean 4 noches" de Celestyal)
   - Puertos visitados en orden + número de noches
   - Fecha de salida real dentro del rango ${body.fecha_salida} → ${body.fecha_regreso}
   - Precio MXN por persona en cabina interior, exterior y balcón (con impuestos/propinas)
   - Qué incluye (comidas, excursiones, traslados)
   - Si reemplaza parte del itinerario por islas, calcula ahorro aproximado vs hacer cada isla independiente con ferry+hotel+comida.
   Fuentes: vacationstogo.com, celestyal.com, cruisedirect.com, cruisecritic.com, msccruises.com, royalcaribbean.com.

4. TOURS: 4-6 experiencias reales con nombre, duración y precio MXN por persona. Fuentes: GetYourGuide, Viator, Civitatis.

5. COMIDA: 5-6 restaurantes reales bien valorados con rango ($/$$/$$$) y cocina.

6. TRANSPORTE LOCAL: metro/tren/transfers, total MXN estimado para ${body.num_viajeros} personas.

7. PROMOCIONES APLICABLES: Lista 3-5 promos REALES vigentes que el usuario pueda activar con su bóveda (ej: "Amex Platinum: 15% off Hilton via Fine Hotels & Resorts", "Star Alliance Gold: maleta extra gratis"). Incluye URL fuente.

Tipo de cambio actual USD→MXN y EUR→MXN. Sé exhaustivo con cifras puntuales.`;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [
        {
          role: "system",
          content:
            "Eres un investigador de precios de viajes. Responde con datos reales, cifras concretas y nombres específicos. En español.",
        },
        { role: "user", content: query },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Perplexity error ${res.status}: ${t}`);
  }
  const data = await res.json();
  return {
    texto: data.choices?.[0]?.message?.content ?? "",
    citations: data.citations ?? [],
  };
}

async function callLovableGatewayAnalysis(systemFinal: string, userPrompt: string) {
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: "LOVABLE_API_KEY no configurada" }), { status: 500 });
  }

  const responseSchema = {
    type: "object",
    properties: TOOL_SCHEMA.input_schema.properties,
    required: TOOL_SCHEMA.input_schema.required,
  };

  const res = await aiFetch({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
    },
    body: JSON.stringify({
      model: "google/gemini-flash-latest",
      messages: [
        {
          role: "system",
          content: `${systemFinal}\n\nDevuelve SOLO un JSON válido con la estructura solicitada. No markdown. No texto adicional.`,
        },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "analisis_viaje",
          schema: responseSchema,
        },
      },
    }),
  });

  if (!res.ok) return res;
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      // Detalle técnico solo en logs; al usuario, SERVICE_UNAVAILABLE.
      console.error("analizar-viaje: ANTHROPIC_API_KEY no configurada");
      return serviceUnavailableResponse(corsHeaders);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return unauthenticatedResponse(corsHeaders);

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) return unauthenticatedResponse(corsHeaders);
    const user = userData.user;

    // Anti-abuso: análisis es caro (Claude + SerpApi + Perplexity)
    const rl = await enforceRateLimit(req, "analizar-viaje", user.id, {
      perMinute: 3, perHour: 20, ipPerMinute: 10,
    });
    if (!rl.allowed) return rateLimitResponse(rl, corsHeaders);

    const body = (await req.json().catch(() => null)) as AnalisisRequest | null;
    if (!body?.destino || !body?.ciudad_origen) {
      return invalidRequestResponse(corsHeaders, "Faltan datos: indica el destino y tu ciudad de origen.");
    }

    // Re-análisis en sitio: solo si el usuario es dueño o colaborador aceptado del viaje. Se revisa
    // antes de la cuota y de las llamadas caras para que un trip_id ajeno no gaste nada.
    const targetTripId = typeof body.trip_id === "string" && body.trip_id ? body.trip_id : null;
    if (targetTripId) {
      const { data: allowed, error: accessErr } = UUID_RE.test(targetTripId)
        ? await supabase.rpc("has_trip_access", { p_trip: targetTripId, p_user: user.id })
        : { data: false, error: null };
      if (accessErr || allowed !== true) {
        return new Response(JSON.stringify({ code: "TRIP_NOT_FOUND", error: "trip_not_found", message: "No encontramos ese viaje o no tienes acceso." }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Cuota (IATOS-P1-FREE-02): después de validar se APARTA el análisis y solo se cobra si el viaje
    // quedó guardado con un resultado completo; timeout, caída de la IA o de un proveedor, datos
    // insuficientes, resultado parcial o error al guardar lo devuelven (_shared/reservation.ts).
    // Un re-análisis en sitio (trip_id) también gasta un análisis: corre todo el flujo de pago (IA +
    // proveedores), igual que antes cuando EditTrip lo pedía sin trip_id. Su llave incluye el viaje.
    const requestKey = resolveRequestKey(body.request_key, [
      body.destino, body.ciudad_origen, body.fecha_salida, body.fecha_regreso, body.num_viajeros, targetTripId,
    ]);
    // El cuerpo del análisis se dejó sin re-indentar para no mover todo el diff.
    const ejecutarAnalisis = async (ctx: WorkCtx): Promise<WorkResult> => {

    const { data: travelProfile } = await supabase
      .from("travel_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, ciudad_origen")
      .eq("id", user.id)
      .maybeSingle();
    const { data: vault } = await supabase.from("user_vault_benefits").select("*").eq("user_id", user.id).maybeSingle();
    const { data: aiPrefs } = await supabase
      .from("ai_user_preferences")
      .select("perfil_ia")
      .eq("user_id", user.id)
      .maybeSingle();


    const vaultLines: string[] = [];
    if (vault?.credit_cards?.length)
      vaultLines.push(
        "- Tarjetas: " +
          vault.credit_cards
            .map(
              (c: any) =>
                `${c.bank} ${c.card_tier}${c.perks_enabled?.length ? ` [${c.perks_enabled.join(", ")}]` : ""}`,
            )
            .join("; "),
      );
    if (vault?.airline_alliances?.length)
      vaultLines.push(
        "- Aerolíneas: " +
          vault.airline_alliances.map((a: any) => `${a.airline} ${a.alliance_name} (${a.tier_status})`).join("; "),
      );
    if (vault?.hotel_loyalty?.length)
      vaultLines.push(
        "- Hoteles: " + vault.hotel_loyalty.map((h: any) => `${h.chain_name} (${h.status_tier})`).join("; "),
      );
    if (vault?.car_rentals?.length)
      vaultLines.push(
        "- Renta autos: " + vault.car_rentals.map((r: any) => `${r.company_name} (${r.preferred_car_type})`).join("; "),
      );
    const vaultDesc = vaultLines.join("\n") || "Sin programas de lealtad registrados.";

    // ---- Bloque de contexto del usuario para Iato (igual patrón que concierge-chat) ----
    const perfilIa: any = aiPrefs?.perfil_ia ?? travelProfile?.perfil_ia ?? {};
    const ctxLines: string[] = ["CONTEXTO DEL USUARIO ACTUAL:"];
    if (profile?.full_name) ctxLines.push(`Nombre: ${profile.full_name}`);
    if (profile?.ciudad_origen) ctxLines.push(`Ciudad origen: ${profile.ciudad_origen}`);
    if (perfilIa?.resumen) ctxLines.push(`Travel DNA: ${perfilIa.resumen}`);
    if (perfilIa?.estilo_dominante) ctxLines.push(`Estilo dominante: ${perfilIa.estilo_dominante}`);
    if (travelProfile?.ritmo_viaje) ctxLines.push(`Ritmo: ${travelProfile.ritmo_viaje}`);
    if (travelProfile?.presupuesto_rango) ctxLines.push(`Presupuesto: ${travelProfile.presupuesto_rango}`);
    if (travelProfile?.preferencias_comida?.length) ctxLines.push(`Comida: ${travelProfile.preferencias_comida.join(", ")}`);
    if (travelProfile?.alergias_restricciones?.length) ctxLines.push(`Restricciones: ${travelProfile.alergias_restricciones.join(", ")}`);
    if (travelProfile?.intereses?.length) ctxLines.push(`Intereses: ${travelProfile.intereses.join(", ")}`);
    const boveda: string[] = [];
    if (vault?.credit_cards?.length) boveda.push(`Tarjetas ${vault.credit_cards.map((c: any) => `${c.bank} ${c.card_tier}`).join(", ")}`);
    if (vault?.airline_alliances?.length) boveda.push(`Aerolíneas ${vault.airline_alliances.map((a: any) => `${a.airline} ${a.tier_status}`).join(", ")}`);
    if (vault?.hotel_loyalty?.length) boveda.push(`Hoteles ${vault.hotel_loyalty.map((h: any) => `${h.chain_name} ${h.status_tier}`).join(", ")}`);
    ctxLines.push(boveda.length ? `Bóveda: ${boveda.join("; ")}` : "Bóveda: vacía");
    const userContext = ctxLines.join("\n");
    // Tipo de cambio en vivo con su fuente y fecha (se guardan con la cotización). El EUR sale de su
    // propia tasa, no de USD × 1.08 fijo.
    const [fxUsdInfo, fxEurInfo] = await Promise.all([getUsdMxnRateInfo(), getEurMxnRateInfo()]);
    const fxUsd = fxUsdInfo.rate;
    const fxEur = Math.round(fxEurInfo.rate * 100) / 100;
    const systemFinal = [MASTER_PROMPT_IATOS, userContext, buildSystemPrompt(fxUsd, fxEur)].filter(Boolean).join("\n\n---\n\n");


    // PASO 0: Smart Date Resolution (Gemini). Si faltan fechas, elegimos la ventana óptima.
    const resolved = await resolverFechasSiFaltan(authHeader, body);
    body.fecha_salida = resolved.fecha_salida;
    body.fecha_regreso = resolved.fecha_regreso;
    const datesOptimized = resolved.optimization !== null;

    const dias = Math.max(
      1,
      Math.round(
        (new Date(body.fecha_regreso).getTime() - new Date(body.fecha_salida).getTime()) / (1000 * 60 * 60 * 24),
      ),
    );

    // Firma de llamada interna: las búsquedas del análisis ya están cubiertas por su cuota y no
    // gastan la bolsa de búsquedas en vivo del usuario (_shared/internalCall.ts).
    const analysisHeaders = await internalHeaders(user.id, "analysis");

    // PASO 1: Lanzar EN PARALELO Perplexity + Travelpayouts vuelos + Travelpayouts hoteles
    console.log("Lanzando Perplexity + Travelpayouts (vuelos+hoteles) en paralelo...");

    const tpFlightsPromise = fetch(`${SUPABASE_URL}/functions/v1/travelpayouts-flights`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        origin_city: body.ciudad_origen,
        destination_city: body.destino,
        departure_date: body.fecha_salida,
        return_date: body.fecha_regreso,
        adults: body.num_viajeros,
        currency: "usd",
      }),
    }).then((r) => r.json()).catch((e) => ({ source: "travelpayouts", error: String(e?.message ?? e), flights: [] }));

    // Hotellook murió oct 2025. Fuente primaria de hospedaje ahora: SerpApi Google Hotels (hotels-search).
    const serpHotelsPromise = fetch(`${SUPABASE_URL}/functions/v1/hotels-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
        ...analysisHeaders,
      },
      body: JSON.stringify({
        city: body.destino,
        checkin: body.fecha_salida,
        checkout: body.fecha_regreso,
        adults: body.num_viajeros,
        query: hotelPreference(body.notas_usuario),
      }),
    }).then((r) => r.json()).catch((e) => ({ source: "error", error: String(e?.message ?? e), results: [] }));

    // Google Flights (SerpApi): precios reales de todas las aerolíneas, incluidas las de servicio
    // completo que Travelpayouts a veces no trae; sirve sobre todo para el tier premium.
    const googleFlightsPromise = fetch(`${SUPABASE_URL}/functions/v1/flights-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
        ...analysisHeaders,
      },
      body: JSON.stringify({
        origin: body.ciudad_origen,
        destination: body.destino,
        depart: body.fecha_salida,
        return_date: body.fecha_regreso,
        travelers: body.num_viajeros,
        type: "round",
      }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e?.message ?? e), results: [] }));

    const tripadvisorPromise = fetch(`${SUPABASE_URL}/functions/v1/tripadvisor-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        query: body.destino,
        category: "attractions",
        language: "es_MX",
      }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e?.message ?? e), results: [] }));

    const [perplexityResult, tpFlightsRes, serpHotelsRes, tripadvisorRes, googleFlightsRes] = await Promise.allSettled([
      investigarConPerplexity(body, dias, vaultDesc),
      tpFlightsPromise,
      serpHotelsPromise,
      tripadvisorPromise,
      googleFlightsPromise,
    ]);

    const liveConsultedAt = new Date().toISOString();
    const investigacion = perplexityResult.status === "fulfilled"
      ? perplexityResult.value
      : { texto: `(Perplexity falló: ${(perplexityResult as any).reason?.message ?? "error"})`, citations: [] };

    const tpFlights = tpFlightsRes.status === "fulfilled" ? tpFlightsRes.value : { error: "promise_rejected", flights: [] };
    const googleFlights = googleFlightsRes.status === "fulfilled" ? googleFlightsRes.value : { ok: false, results: [] };
    const googleFlightsLive = googleFlights?.ok === true && googleFlights?.source === "serpapi" &&
      Array.isArray(googleFlights?.results) && googleFlights.results.length > 0;
    const serpHotels = serpHotelsRes.status === "fulfilled" ? serpHotelsRes.value : { error: "promise_rejected", results: [] };
    // Solo consideramos "en vivo" lo que realmente vino de SerpApi (hotels-search puede caer a IA).
    const serpHotelsLive = serpHotels?.source === "serpapi" && Array.isArray(serpHotels?.results) && serpHotels.results.length > 0;

    const tripadvisor = tripadvisorRes.status === "fulfilled" ? tripadvisorRes.value : { ok: false, error: "promise_rejected", results: [] };
    const tripadvisorLive = tripadvisor?.ok === true && Array.isArray(tripadvisor?.results) && tripadvisor.results.length > 0;
    // tripadvisor-search cae a Google Maps (SerpApi) cuando TripAdvisor no responde.
    const placesSource: "tripadvisor" | "google_maps" = tripadvisor?.source === "google_maps" ? "google_maps" : "tripadvisor";
    const placesLabel = placesSource === "google_maps" ? "Google Maps" : "TripAdvisor";

    console.log(
      "Perplexity citations:", investigacion.citations.length,
      "| TP flights:", tpFlights?.flights?.length ?? 0,
      "| Google flights:", googleFlightsLive ? googleFlights.results.length : 0,
      "| SerpApi hotels:", serpHotels?.results?.length ?? 0, "source:", serpHotels?.source ?? "none",
      "| TripAdvisor attractions:", tripadvisor?.results?.length ?? 0,
    );

    // Bloques de texto que Claude verá para los precios reales de Travelpayouts
    const tpFlightsBlock = (() => {
      if (!Array.isArray(tpFlights?.flights) || tpFlights.flights.length === 0) {
        return `(Sin datos de Travelpayouts/Aviasales — usar precios de Perplexity${tpFlights?.error ? `. Motivo: ${tpFlights.error}` : ""})`;
      }
      const lines = tpFlights.flights.slice(0, 12).map((f: any, i: number) => {
        const priceMxn = Math.round((Number(f.price) || 0) * fxUsd);
        return `${i + 1}. ${f.airline} ${f.flight_number} — ${f.origin_airport}→${f.destination_airport} — USD ${f.price} (~$${priceMxn.toLocaleString("es-MX")} MXN) — ${f.stops} escalas — sale ${f.departure_at ?? "?"} — LINK: ${f.booking_link}`;
      }).join("\n");
      return `Fuente: Travelpayouts/Aviasales (tarifas reales de la caché de búsquedas de las últimas 48 h${tpFlights.approximate_dates ? "; NO hay tarifa para la fecha exacta, son fechas cercanas del mismo mes" : ""}; consultado ${tpFlights.consulted_at}).\nRuta: ${tpFlights.origin}→${tpFlights.destination}\n${lines}`;
    })();

    const googleFlightsBlock = (() => {
      if (!googleFlightsLive) return "(Sin datos de Google Flights)";
      const lines = googleFlights.results.slice(0, 10).map((f: any, i: number) => {
        const ppMxn = Math.round((Number(f.price_per_person_usd) || 0) * fxUsd);
        const escalas = f.stops === 0 ? "directo" : `${f.stops} escala(s)`;
        return `${i + 1}. ${f.airline} — ${f.departure?.id ?? "?"}→${f.arrival?.id ?? "?"} — ${escalas} — ${f.duration} — USD ${f.price_per_person_usd}/persona redondo (~$${ppMxn.toLocaleString("es-MX")} MXN) — sale ${f.departure?.time ?? "?"} — LINK: ${f.buy_url}`;
      }).join("\n");
      return `Fuente: Google Flights vía SerpApi (tarifas reales consultadas hoy, viaje redondo, precio por persona).\n${lines}`;
    })();

    // Bloque de hoteles con precios reales de SerpApi / Google Hotels
    const serpHotelsBlock = (() => {
      if (!serpHotelsLive) {
        return `(Sin datos en vivo de Google Hotels${serpHotels?.error ? `. Motivo: ${serpHotels.error}` : ""} — usar hoteles de Perplexity con fuente_precio="perplexity" o "estimado")`;
      }
      const lines = serpHotels.results.slice(0, 12).map((h: any, i: number) => {
        const nightlyMxn = Math.round((Number(h.nightly_usd) || 0) * fxUsd);
        return `${i + 1}. ${h.name}${h.hotel_class ? ` (${h.hotel_class}★)` : ""}${h.rating ? ` — rating ${h.rating}` : ""} — USD ${h.nightly_usd}/noche (~$${nightlyMxn.toLocaleString("es-MX")} MXN/noche) — total estancia USD ${h.total_usd ?? "?"} — LINK: ${h.booking_url}`;
      }).join("\n");
      return `Fuente: SerpApi / Google Hotels (tarifas reales consultadas hoy para ${body.fecha_salida} → ${body.fecha_regreso}, ${body.num_viajeros} adultos).\n${lines}`;
    })();

    // Bloque de atracciones/experiencias reales de TripAdvisor Content API
    const tripadvisorBlock = (() => {
      if (!tripadvisorLive) {
        return `(Sin datos en vivo de atracciones${tripadvisor?.error ? `. Motivo: ${tripadvisor.error}` : ""} — usa tours de Perplexity con fuente="perplexity" o "estimado")`;
      }
      const lines = tripadvisor.results.slice(0, 10).map((a: any, i: number) => {
        const reviews = a.num_reviews != null ? `${a.num_reviews} reseñas` : "sin conteo de reseñas";
        return `${i + 1}. ${a.name}${a.rating ? ` — rating ${a.rating}/5 (${reviews})` : ""}${a.ranking ? ` — ${a.ranking}` : ""}${a.address ? ` — ${a.address}` : ""}`;
      }).join("\n");
      return `Fuente: ${placesLabel} (atracciones reales con rating y reseñas verificadas, consultadas hoy). Usa fuente="${placesSource}".\n${lines}`;
    })();


    // PASO 2: Claude estructura el análisis usando los datos reales
    const userPrompt = `Genera un análisis premium de viaje usando EXCLUSIVAMENTE los precios reales investigados abajo.

CLIENTE
- Nombre: ${profile?.full_name ?? "Cliente"}
- Ciudad origen: ${body.ciudad_origen}
- Estilos: ${(travelProfile?.estilo_viaje ?? []).join(", ") || "no especificado"}
- Presupuesto: ${travelProfile?.presupuesto_rango ?? "no especificado"}
- Ritmo: ${travelProfile?.ritmo_viaje ?? "equilibrado"}
- Comida: ${(travelProfile?.preferencias_comida ?? []).join(", ") || "abierto"}
- Alergias: ${(travelProfile?.alergias_restricciones ?? []).join(", ") || "ninguna"}
- Intereses: ${(travelProfile?.intereses ?? []).join(", ") || "varios"}
- Alojamiento: ${(travelProfile?.tipo_alojamiento_preferido ?? []).join(", ") || "flexible"}
- Acompañantes: ${travelProfile?.acompanantes_tipico ?? "no especificado"}
- Idiomas: ${(travelProfile?.idiomas_hablados ?? []).join(", ") || "español"}
- Notas: ${travelProfile?.notas_adicionales ?? "ninguna"}

BÓVEDA DE BENEFICIOS (aplica descuentos y perks reales en la cotización; menciona explícitamente en tips_personalizados cómo activar cada beneficio):
${vaultDesc}

VIAJE
- Destino: ${body.destino}
- Fechas: ${body.fecha_salida} al ${body.fecha_regreso} (${dias} días)
- Viajeros: ${body.num_viajeros}
- Presupuesto objetivo (MXN): ${body.presupuesto_objetivo ?? "sin presupuesto fijo"}

==========================================
INSTRUCCIONES LITERALES DEL USUARIO (prioridad MÁXIMA — léelas palabra por palabra y obedece SIN excepciones)
==========================================
${body.notas_usuario?.trim() ? body.notas_usuario.trim() : "(sin instrucciones adicionales)"}
==========================================

==========================================
PRECIOS PRIMARIOS — TRAVELPAYOUTS (fuente oficial de inventario; USA ESTOS PRECIOS Y LOS BOOKING_LINK COMO PRIMARIOS)
==========================================
VUELOS (Aviasales):
${tpFlightsBlock}

VUELOS (Google Flights):
${googleFlightsBlock}

HOTELES (SerpApi / Google Hotels):
${serpHotelsBlock}

ATRACCIONES — ${placesLabel.toUpperCase()} (fuente curada para tours/experiencias; nombres y ratings reales):
${tripadvisorBlock}
==========================================

==========================================
CONTEXTO CUALITATIVO — PERPLEXITY (úsalo SOLO para restaurantes, tours, tips locales, cruceros, mejor temporada, promos de lealtad; NO para precios de vuelos/hoteles si TRAVELPAYOUTS arriba trajo datos)
==========================================
${investigacion.texto}

FUENTES CITADAS:
${investigacion.citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}
==========================================

REGLAS DE FUENTES:
- Los 3 tiers de vuelo (ahorro/equilibrio/premium) DEBEN salir de las listas de VUELOS de arriba (Aviasales o Google Flights). Convierte USD→MXN (×${fxUsd}, tipo de cambio de referencia del día). Copia el LINK exacto en booking_link. fuente_precio="travelpayouts" si salió de Aviasales, "serpapi" si salió de Google Flights.
- Tier "premium": la mejor experiencia REAL de esas listas (directo, mejor horario, aerolínea de servicio completo como Aeroméxico, United, Iberia…) aunque cueste más. NUNCA pongas un vuelo premium "estimado" si alguna de las listas trae vuelos. Las tarifas de las listas son en clase turista: no afirmes clase ejecutiva/Premier ni otra cabina, y no digas "tarifa estimada" si el precio salió de una lista.
- Si arriba hay datos de SERPAPI / GOOGLE HOTELS, las opciones de hospedaje DEBEN salir de esa lista (toma 3 representativas: ahorro/equilibrio/premium por precio_por_noche). Si el cliente pidió un tipo de hospedaje (boutique, vista al mar, lujo, todo incluido, etc.), elige SOLO hoteles de la lista que encajen con esa petición y prefiere rating ≥ 4.3; menciona en "por_que" cómo cumple lo que pidió. Convierte USD→MXN (×${fxUsd}), copia el booking_link exacto y pon fuente_precio="serpapi". NUNCA inventes un hotel ni un precio si esa lista trae datos.
- Si una categoría no trajo datos en vivo, cae a Perplexity y pon fuente_precio="perplexity" sin booking_link. Si tampoco hay contexto de Perplexity, pon fuente_precio="estimado".
- Si arriba hay datos de ATRACCIONES, prioriza esos nombres para "tours" (son lugares reales con reseñas verificadas): copia el nombre exacto, pon fuente="${placesSource}", y copia rating/num_reviews tal cual. El precio_por_persona sigue siendo una estimación (${placesLabel} no da precio de boleto) — está bien, solo el nombre/rating son reales. Completa hasta 4-6 tours mezclando esa lista con ideas de Perplexity si trae menos de 4; en esos extras pon fuente="perplexity" o "estimado".
- Restaurantes, itinerario, tips y cruceros se sacan SIEMPRE de Perplexity.

Llama a "entregar_analisis_viaje" usando estos precios reales. RESPETA AL 100% las instrucciones literales del usuario. En vuelos, devuelve EXACTAMENTE 3 opciones comparables (ahorro/equilibrio/premium), y cada precio_por_persona es el TOTAL de la ruta aérea completa por persona. Todo en MXN.`;

    // Los modelos actuales no aceptan forzar la herramienta ni temperature: se pide en el prompt y,
    // si no llega la llamada a la herramienta, se usa el análisis de respaldo (Gemini) de abajo.
    const claudePayload = {
      max_tokens: 16000,
      system: `${systemFinal}\n\nEntrega SIEMPRE el resultado llamando a la herramienta "entregar_analisis_viaje", sin texto adicional.`,
      tools: [TOOL_SCHEMA],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userPrompt }],
    };
    const claudeRes = await callClaudeWithFallback(claudePayload);

    let a: any = null;
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json();
      // Costo real de la llamada (tokens que reporta Claude) para ai_usage_log.
      const claudeUsage = usageFromClaude(claudeData);
      if (claudeUsage) await logUsage({ user_id: user.id, function: "analizar-viaje", provider: "anthropic", ...claudeUsage });
      const toolUse = (claudeData.content ?? []).find(
        (b: any) => b.type === "tool_use" && b.name === "entregar_analisis_viaje",
      );
      if (toolUse?.input) a = toolUse.input;
      else console.error("No tool_use, usando fallback Gateway:", JSON.stringify(claudeData).slice(0, 2000));
    } else {
      const text = await claudeRes.text();
      console.error("Claude no disponible; usando fallback Gateway:", claudeRes.status, text.slice(0, 1000));
    }

    if (!a) {
      const gatewayResult = await callLovableGatewayAnalysis(systemFinal, userPrompt);
      if (gatewayResult instanceof Response) {
        const text = await gatewayResult.text();
        console.error("Gateway fallback error:", gatewayResult.status, text);
        return { ok: false, reason: "ai_provider_error" };
      }
      a = gatewayResult;
    }

    if (!a || typeof a !== "object") {
      console.error("analizar-viaje: respuesta inválida de IA");
      return { ok: false, reason: "ai_invalid_response" };
    }
    a.vuelos = normalizarVuelos(a.vuelos);
    // Sub-regla 15.1: re-inyecta ?marker=... si Claude lo truncó al copiar el booking_link.
    a.vuelos = ensureMarkerInFlightLinks(a.vuelos);

    // El servidor decide el origen de cada precio: un vuelo u hotel solo conserva la etiqueta de
    // una fuente en vivo si su precio (y nombre, en hoteles) está en la lista que trajo esa fuente.
    enforceSources(a, tripadvisorLive ? tripadvisor.results : [], serpHotelsLive ? serpHotels.results : [], placesSource, {
      tpFlights: Array.isArray(tpFlights?.flights) ? tpFlights.flights : [],
      tpApproximateDates: !!tpFlights?.approximate_dates,
      googleFlights: googleFlightsLive ? googleFlights.results : [],
      fxUsd,
      consultedAt: liveConsultedAt,
    });

    // COHERENCIA DE PRESUPUESTO (no negociable): renglones recalculados con las opciones que el
    // usuario verá (vuelo equilibrio × viajeros; hotel medio × noches × habitaciones), respetando
    // lo que el usuario excluyó, y total_estimado = suma exacta del desglose.
    const budget = reconcileBudget(a, { dias, viajeros: body.num_viajeros, notas: body.notas_usuario });
    if (budget.desglose.comida < (Number(a.desglose_presupuesto?.comida) || 0) && !budget.exclusions.comida) {
      console.warn("analizar-viaje: comida fuera de rango, acotada", { destino: body.destino, declarada: a.desglose_presupuesto?.comida, techo: budget.desglose.comida });
    }
    if (!budget.exclusions.vuelos && !(Number(a.desglose_presupuesto?.vuelos) > 0)) {
      console.warn("analizar-viaje: el modelo dejó vuelos en 0 sin exclusión detectada; se respeta", body.destino);
    }
    a.desglose_presupuesto = budget.desglose;
    if (!budget.valido) {
      // Nunca guardar un viaje con total 0 ni un total que no sea la suma del desglose.
      console.error("analizar-viaje: desglose vacío", { destino: body.destino });
      return {
        ok: false,
        reason: "insufficient_data",
        response: serviceUnavailableResponse(corsHeaders,
          "No pudimos armar una cotización confiable ahora mismo y no se descontó de tu plan. Intenta de nuevo en unos minutos."),
      };
    }
    a.total_estimado = budget.total;
    // Trazabilidad de campos vacíos para monitoreo (no bloquea, pero queda en logs).
    const camposVacios = ["vuelos", "hospedaje", "restaurantes", "tours", "itinerario"]
      .filter((k) => !Array.isArray(a[k]) ? !a[k] : a[k].length === 0);
    if (camposVacios.length) console.warn("analizar-viaje: campos vacíos", camposVacios, body.destino);

    // Contrato mínimo para cobrar: sin itinerario, total o vuelos/hospedaje es un resultado parcial.
    const contrato = analysisMeetsContract(a);
    if (!contrato.ok) {
      console.error("analizar-viaje: resultado parcial, no se guarda ni se cobra", contrato.missing, body.destino);
      return { ok: false, reason: `partial_result:${contrato.missing.join(",")}` };
    }
    // Si ya se agotó el tiempo, no guardamos (la reserva ya se liberó).
    if (!ctx.beginPersist()) return { ok: false, reason: "timeout_before_persist" };

    const cover = pickCover(tripadvisorLive ? tripadvisor.results : [], serpHotelsLive ? serpHotels.results : []);
    const tripFields = {
      destino: body.destino,
      pais_destino: a.pais_destino ?? body.pais_destino,
      ciudad_origen: body.ciudad_origen,
      fecha_salida: body.fecha_salida,
      fecha_regreso: body.fecha_regreso,
      num_viajeros: body.num_viajeros,
      presupuesto_objetivo: body.presupuesto_objetivo,
      status: "listo",
      total_estimado: a.total_estimado,
      moneda: "MXN",
      match_score: a.match_score,
      analisis_ai: a.analisis_narrativo,
      desglose_presupuesto: a.desglose_presupuesto,
      vuelos_json: a.vuelos,
      hospedaje_json: a.hospedaje,
      itinerario_json: a.itinerario,
      restaurantes_json: a.restaurantes,
      tours_json: a.tours,
      tips_personalizados: a.tips_personalizados,
      cruceros_json: a.cruceros_alternativas ?? [],
      dates_optimized: datesOptimized,
      dates_optimization_meta: datesOptimized ? resolved.optimization : null,
    };

    // Con trip_id se actualiza ese viaje (mismo id: diario, packing, split, gastos y colaboradores
    // se conservan; user_id nunca se toca). Sin trip_id se crea como siempre. RLS vuelve a exigir
    // que el usuario tenga acceso al UPDATE.
    const { data: trip, error: insertErr } = targetTripId
      ? await supabase
        .from("trips")
        .update({ ...tripFields, ...(cover ? { cover_image_url: cover } : {}) })
        .eq("id", targetTripId)
        .select()
        .single()
      : await supabase
        .from("trips")
        .insert({ user_id: user.id, ...tripFields, cover_image_url: cover })
        .select()
        .single();

    if (insertErr || !trip) {
      console.error("Insert error:", insertErr);
      return { ok: false, reason: "persist_failed" };
    }

    // Snapshot inmutable de esta cotización (moneda, tipo de cambio, fuentes, viajeros, noches,
    // habitaciones, estado por renglón y vigencia). Solo el service role escribe en trip_quotes.
    const admin = SUPABASE_SERVICE_ROLE_KEY ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) : null;
    const quote = await saveQuoteSnapshot(admin, buildQuoteSnapshot({
      tripId: trip.id,
      userId: user.id,
      origin: "analizar-viaje",
      breakdown: a.desglose_presupuesto,
      travelers: body.num_viajeros,
      nights: dias,
      rooms: budget.rooms,
      dateFrom: body.fecha_salida,
      dateTo: body.fecha_regreso,
      fx: fxUsdInfo,
      reference: { vuelos: budget.vueloReferencia, hospedaje: budget.hotelReferencia },
      excluded: budget.exclusions,
      optional: (Array.isArray(a.cruceros_alternativas) ? a.cruceros_alternativas : []).map((c: any) => ({
        category: "crucero",
        label: `Crucero alternativo: ${c?.naviera ?? ""} ${c?.nombre_itinerario ?? ""}`.trim(),
        amount: (Number(c?.precio_por_persona) || 0) * body.num_viajeros,
      })),
      sources: {
        vuelos: budget.vueloReferencia?.fuente_precio ?? "estimado",
        hospedaje: budget.hotelReferencia?.fuente_precio ?? "estimado",
        tours: tripadvisorLive ? placesSource : "estimado",
        travelpayouts: { count: tpFlights?.flights?.length ?? 0, consulted_at: tpFlights?.consulted_at ?? null, approximate_dates: !!tpFlights?.approximate_dates, cache_max_age_h: 48 },
        google_flights: { live: googleFlightsLive, consulted_at: googleFlights?.consulted_at ?? null },
        google_hotels: { live: serpHotelsLive, consulted_at: serpHotels?.consulted_at ?? null },
        fx_eur: fxEurInfo,
        perplexity_citations: investigacion.citations.length,
      },
    }));

    // Email de cotización lista (fire-and-forget: nunca bloquea la respuesta).
    try {
      const { data: perfilEmail } = await supabase
        .from("profiles").select("email, full_name").eq("id", user.id).maybeSingle();
      const destinatario = perfilEmail?.email ?? user.email;
      if (destinatario) {
        const { subject, html } = tripQuoteEmail({
          nombre: perfilEmail?.full_name?.split(" ")[0] ?? null,
          destino: trip.destino,
          fechaSalida: trip.fecha_salida,
          fechaRegreso: trip.fecha_regreso,
          total: Number(trip.total_estimado) || 0,
          desglose: (trip.desglose_presupuesto ?? {}) as Record<string, unknown>,
          tripId: trip.id,
        });
        void sendEmail({ to: destinatario, subject, html });
      }
    } catch (e) {
      console.warn("analizar-viaje: email no enviado", (e as Error).message);
    }


    return { ok: true, tripId: trip.id, response: new Response(JSON.stringify({
      trip: quote ? { ...trip, current_quote_id: quote.id } : trip,
      quote,
      fuentes: investigacion.citations,
      travelpayouts: {
        flights: {
          count: tpFlights?.flights?.length ?? 0,
          error: tpFlights?.error ?? null,
          sample: (tpFlights?.flights ?? []).slice(0, 3),
        },
        hotels: {
          source: serpHotelsLive ? "serpapi" : (serpHotels?.source ?? "none"),
          count: serpHotels?.results?.length ?? 0,
          error: serpHotels?.error ?? null,
          sample: (serpHotels?.results ?? []).slice(0, 3),
        },
        attractions: {
          source: tripadvisorLive ? placesSource : "none",
          count: tripadvisor?.results?.length ?? 0,
          error: tripadvisor?.error ?? null,
        },
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }) };
    };

    const outcome = await runWithReservation(reservationDeps(user.id, "trip_analysis"), requestKey, ejecutarAnalisis);
    if (outcome.type === "ok") return outcome.response;
    if (outcome.type === "denied") return quotaDeniedResponse(outcome.quota, "trip_analysis", corsHeaders);
    if (outcome.type === "replay") {
      // La respuesta anterior se perdió (red, recarga): devolvemos el viaje ya guardado, sin cobrar.
      const { data: saved } = outcome.tripId
        ? await supabase.from("trips").select("*").eq("id", outcome.tripId).maybeSingle()
        : { data: null };
      if (saved) {
        return new Response(JSON.stringify({ trip: saved, replay: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return serviceUnavailableResponse(corsHeaders, "Este análisis ya se hizo; búscalo en Mis viajes.");
    }
    console.warn("analizar-viaje: análisis no completado, cupo liberado", outcome.reason);
    return outcome.response ?? serviceUnavailableResponse(corsHeaders);
  } catch (e: any) {
    // Detalle técnico solo en logs.
    console.error("analizar-viaje error:", e);
    return serviceUnavailableResponse(corsHeaders);
  }
});
