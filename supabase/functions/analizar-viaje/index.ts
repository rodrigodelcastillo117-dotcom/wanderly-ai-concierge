// supabase/functions/analizar-viaje/index.ts
// Flujo: Perplexity (sonar-pro) investiga precios reales -> Claude estructura el análisis premium.
// FIX v2: status "completo" -> "listo" (alinea con el realtime del frontend y el spec).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const MASTER_PROMPT_IATOS = (Deno.env.get("MASTER_PROMPT_IATOS") ?? "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;


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
}

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

const TIER_ORDER = ["ahorro", "equilibrio", "premium"];

function normalizarVuelos(vuelos: any[]): any[] {
  if (!Array.isArray(vuelos)) return [];

  const agrupados = new Map<string, any>();
  for (const vuelo of vuelos) {
    const tier = TIER_ORDER.includes(vuelo?.tier) ? vuelo.tier : "equilibrio";
    const precio = Number(vuelo?.precio_por_persona) || 0;
    const existente = agrupados.get(tier);

    if (!existente) {
      agrupados.set(tier, {
        ...vuelo,
        tier,
        precio_por_persona: precio,
        _segmentos: [vuelo],
      });
      continue;
    }

    existente.precio_por_persona += precio;
    existente._segmentos.push(vuelo);
  }

  return TIER_ORDER.map((tier) => agrupados.get(tier))
    .filter(Boolean)
    .map((vuelo) => {
      const segmentos = vuelo._segmentos ?? [];
      const aerolineas = [...new Set(segmentos.map((s: any) => s?.aerolinea).filter(Boolean))];
      const notasSegmentos = segmentos
        .map(
          (s: any) =>
            `${s?.aerolinea ?? "Vuelo"}: $${Math.round(Number(s?.precio_por_persona) || 0).toLocaleString("es-MX")} MXN`,
        )
        .join(" + ");

      const normalizado = {
        ...vuelo,
        aerolinea: segmentos.length > 1 ? aerolineas.join(" + ") : vuelo.aerolinea,
        duracion: segmentos.length > 1 ? "Ruta completa, varios segmentos" : vuelo.duracion,
        escalas: segmentos.length > 1 ? `${segmentos.length} segmentos sumados` : vuelo.escalas,
        precio_por_persona: Math.round(vuelo.precio_por_persona),
        notas: segmentos.length > 1 ? `Total por persona sumando todos los tramos: ${notasSegmentos}` : vuelo.notas,
      };
      delete normalizado._segmentos;
      return normalizado;
    });
}

const SYSTEM_PROMPT = `Eres un consultor de viajes premium con 20 años de experiencia, tono sofisticado, cálido y específico, como un concierge personal. Siempre respondes en español de México y todos los precios en pesos mexicanos (MXN).

REGLAS ESTRICTAS DE PRECIOS:
1. PROHIBIDO inventar, redondear hacia abajo o "ajustar" precios. Cada cifra que pongas DEBE aparecer textualmente (o ser conversión directa USD→MXN / EUR→MXN) en la sección "INVESTIGACIÓN DE PRECIOS REALES".
2. Si Perplexity te da un rango (ej: "$25,000-$32,000"), usa el PUNTO MEDIO, nunca el extremo bajo.
3. Tipo de cambio fijo: 1 USD = 18.5 MXN, 1 EUR = 21 MXN. Convierte siempre.
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
14. ORDENA cada array de menor a mayor precio: "hospedaje" ascendente por precio_por_noche, "tours" ascendente por precio_por_persona, "restaurantes" ascendente por el extremo inferior del rango_precio. El usuario ve siempre primero la opción más accesible.`;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!PERPLEXITY_API_KEY) {
      return new Response(JSON.stringify({ error: "PERPLEXITY_API_KEY no configurada" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Sesión inválida" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = userData.user;

    const body = (await req.json()) as AnalisisRequest;
    if (!body.destino || !body.ciudad_origen) {
      return new Response(JSON.stringify({ error: "Faltan datos requeridos" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // PASO 1: Perplexity investiga precios reales
    console.log("Investigando precios con Perplexity...");
    const investigacion = await investigarConPerplexity(body, dias, vaultDesc);
    console.log("Perplexity OK, citations:", investigacion.citations.length);

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
INVESTIGACIÓN DE PRECIOS REALES (Perplexity, datos en vivo)
==========================================
${investigacion.texto}

FUENTES CITADAS:
${investigacion.citations.map((c, i) => `[${i + 1}] ${c}`).join("\n")}
==========================================

Llama a "entregar_analisis_viaje" usando estos precios reales. RESPETA AL 100% las instrucciones literales del usuario (si pidió excluir hospedaje en alguna ciudad, no lo cotices ahí y pon 0 o solo las ciudades incluidas). En vuelos, devuelve EXACTAMENTE 3 opciones comparables (ahorro/equilibrio/premium), y cada precio_por_persona debe ser el TOTAL de la ruta aérea completa por persona, no un tramo suelto. Todo en MXN.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        temperature: 0,
        system: SYSTEM_PROMPT,
        tools: [TOOL_SCHEMA],
        tool_choice: { type: "tool", name: "entregar_analisis_viaje" },
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!claudeRes.ok) {
      const text = await claudeRes.text();
      console.error("Claude error:", claudeRes.status, text);
      return new Response(JSON.stringify({ error: `Claude API error ${claudeRes.status}`, detail: text }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeRes.json();
    const toolUse = (claudeData.content ?? []).find(
      (b: any) => b.type === "tool_use" && b.name === "entregar_analisis_viaje",
    );
    if (!toolUse?.input) {
      console.error("No tool_use:", JSON.stringify(claudeData).slice(0, 2000));
      return new Response(JSON.stringify({ error: "Respuesta inválida de IA" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const a = toolUse.input;
    a.vuelos = normalizarVuelos(a.vuelos);
    const vueloEquilibrio = a.vuelos.find((v: any) => v.tier === "equilibrio") ?? a.vuelos[0];
    const vuelosGrupo = Math.round(
      (Number(vueloEquilibrio?.precio_por_persona) || Number(a.desglose_presupuesto?.vuelos) || 0) * body.num_viajeros,
    );
    if (vuelosGrupo > 0) {
      a.desglose_presupuesto = { ...a.desglose_presupuesto, vuelos: vuelosGrupo };
      a.total_estimado = Object.values(a.desglose_presupuesto).reduce(
        (sum: number, value: any) => sum + (Number(value) || 0),
        0,
      );
    }

    const { data: trip, error: insertErr } = await supabase
      .from("trips")
      .insert({
        user_id: user.id,
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
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Insert error:", insertErr);
      return new Response(JSON.stringify({ error: insertErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ trip, fuentes: investigacion.citations }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("analizar-viaje error:", e);
    return new Response(JSON.stringify({ error: e?.message ?? "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
