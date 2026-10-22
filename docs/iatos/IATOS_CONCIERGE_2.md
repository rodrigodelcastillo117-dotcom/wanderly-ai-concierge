# Concierge 2.0 (Iato) — qué cambió, cuánto tarda, cuánto cuesta y qué falta

Rama `claude/wc-concierge2`. Todo dentro de `concierge-chat` + `src/pages/Concierge.tsx` (no hay un segundo chat).
Se conservan cuota (reserva → confirmación → liberación), viaje activo, memoria, Privé (`search_prive`),
cards con procedencia, defensas contra prompt injection (`guard.ts`), encabezado de sesión Privé y diálogo de límite gratuito.

## 1. Cómo funciona un mensaje ahora

1. **Planeador determinista** (`planner.ts`): detecta la intención (vuelo hoy, cancelación, cenar cerca del hotel,
   dato práctico, emergencia, Privé…) o la recibe del botón rápido, y **consulta en paralelo, antes del modelo**,
   lo que ya se sabe que hace falta (estado del vuelo, Google Maps alrededor del hotel, búsqueda web, vuelos
   alternativos). Agrega notas proactivas (a qué hora llegar al aeropuerto, el hotel donde está) y acciones sugeridas.
2. **Modelo con streaming** (`anthropic.ts`, `agent.ts`): Messages API, texto en vivo a la app, herramientas en paralelo
   con tope de tiempo, pensamiento adaptativo con los bloques devueltos intactos, caché de prompt en el prefijo estable.
3. **Respuesta validada** (`finalize.ts`): cards contra la evidencia del turno (precios, dominios), botones de
   cómo llegar / Uber / llamar / reservar armados por IATOS, acciones validadas y revisiones de honestidad.

Protocolo con la app (SSE): `meta`, `status` (pasos en vivo), `delta` (texto), `reset`, `final`, `error`.
Sin `stream:true` responde el JSON de siempre (apps viejas).

## 2. Modelos y configuración (sin desplegar código)

| Nivel | Cuándo | Modelo (default) | Esfuerzo |
|---|---|---|---|
| Rápido | Turnos simples (estado de vuelo, cena cerca, emergencia, dato práctico) | `claude-haiku-5-5` | low |
| Capaz | Planeación de varios pasos (panorama del viaje, comparar vuelos, cancelación, conexión perdida, Privé) | `claude-sonnet-5-5` | low |
| Exigente | Modo exigente encendido por el usuario | `claude-sonnet-5-5` | medium, hasta 4 vueltas |
| Respaldo | Claude no disponible | Gemini vía gateway de Lovable (`google/gemini-flash-latest` → alias publicado de `_shared/ai.ts`) | — |

- Cambiar modelos/esfuerzo: `app_flags.concierge_models` (JSON) o variables `CONCIERGE_FAST_MODEL`, `CONCIERGE_SMART_MODEL`,
  `CONCIERGE_FALLBACK_MODEL`, `CONCIERGE_FAST_EFFORT`, `CONCIERGE_SMART_EFFORT`, `CONCIERGE_EXIGENTE_EFFORT`,
  `CONCIERGE_ANTHROPIC_ENABLED`, `CONCIERGE_BREAKER_COOLDOWN_S`, `CONCIERGE_FORCE_TIER`. Gana app_flags. Valores inválidos se ignoran.
- **Circuit breaker**: un proveedor/modelo que falló con 429/5xx/529/timeout/red se salta durante 120 s (10 min si son
  credenciales). Orden: Claude del nivel → el otro Claude → Gemini. Antes cada mensaje esperaba el 503 de Gemini directo.
- Tiempos: rápido 8 s a los encabezados / 12 s sin eventos / 35 s total; capaz 12 / 20 / 60 s. Herramientas: estado de vuelo 9 s,
  vuelos y hoteles 14 s, Google Maps 8 s, web 8 s, Members 5 s, Privé 8 s; el turno sigue con lo que llegó.
- Secretos: ninguno nuevo. Usa `ANTHROPIC_API_KEY` (ya existe), `LOVABLE_API_KEY`, `SERPAPI_PRIVATE_KEY`, `GOOGLE_MAPS_API_KEY`.

## 3. Latencia

Medida **localmente con modelo y herramientas simulados** (`src/test/concierge2Evals.test.ts`, escala 1:10; latencias
simuladas: modelo rápido 450 ms al primer token, capaz 800 ms; estado de vuelo 0.9 s, Maps 0.6 s, web 0.7 s, vuelos 2.5 s).
No es producción: es el diseño medido con esos supuestos.

| Turno | Primer paso visible | Primer texto | Total |
|---|---|---|---|
| "¿Mi vuelo de hoy va a tiempo?" (1 herramienta) | ~0 s | 1.4 s | 1.6 s |
| Cena cerca del hotel (Maps) | ~0 s | 1.1 s | 1.9 s |
| Emergencia (hospital cercano) | ~0 s | 1.1 s | 1.2 s |
| Centurion (web + Maps + 1 vuelta del modelo) | ~0 s | 2.4 s | 3.0 s |
| ¿Qué vuelo me conviene? (búsqueda de vuelos 2.5 s) | ~0 s | 3.4 s | 4.1 s |
| Cancelación (3 herramientas en paralelo) | ~0 s | 3.3 s | 4.7 s |

Antes: la app no mostraba nada hasta el final; 2 llamadas al modelo en serie (cada una esperando primero el 503 de Gemini
directo) + 1 de resumen cada >30 turnos. Ahora: 1 llamada cuando el planeador ya consultó lo necesario, pasos visibles al
instante y texto en vivo. Medición real: `scripts/concierge/eval_live.mjs` (P50 primer texto, P95 total) y el log
`concierge_latency` de la función.

## 4. Costo por mensaje (estimado)

Precios del API de Claude (skill claude-api, tabla consultada 2026-10-06): Haiku 5.5 $0.10 / $0.50 por millón (caché: lectura
$0.01, escritura $0.125); Sonnet 5.5 $2 / $10 (lectura $0.20, escritura $2.50). Gemini Flash vía Lovable: $0.75 / $3.75 (valor
de `_shared/usage.ts`). Tokens estimados con 3.6 caracteres por token (±30 %): prefijo estable (reglas + herramientas) ≈ 5.5k
en caché; por mensaje ≈ 3.7k sin caché (contexto compacto del viaje ≈ 1.7k en lugar de ≈ 8.5k, historial, datos consultados).

| | Hoy (producción) | Concierge 2.0 |
|---|---|---|
| Rápido (≈80 % de los mensajes) | — | ≈ $0.001 |
| Capaz | — | ≈ $0.017 |
| Exigente (2 vueltas, más salida) | — | ≈ $0.035 |
| Respaldo Gemini | — | ≈ $0.009 |
| Promedio por mensaje | ≈ $0.023–0.030 (2 llamadas × 8.5–12.7k entrada + ~1.4k salida) | ≈ $0.004 (80/20 rápido/capaz, exigente apagado) |
| 100 mensajes PRO al mes | ≈ $2.3–3.0 | ≈ $0.4 (≈ $3.5 si todo fuera exigente) |

Más búsquedas: `web_search` cuesta una búsqueda de SerpApi (~$0.015) solo cuando no está en la caché compartida de 24 h y
cuenta en la bolsa de búsquedas en vivo del plan; si el plan llegó a su límite usa Wikipedia (gratis) y lo dice.
`ai_usage_log` registra cada llamada con su modelo y tokens de caché (precio por modelo corregido en `_shared/usage.ts`).

## 5. Acciones ("que pueda hacer cosas por ti")

Iato propone, el usuario confirma con un toque (tarjeta Confirmar / Cancelar), el servidor **vuelve a validar** (viajes con la
sesión del usuario, límites del plan en la función dueña) y ejecuta. Nada se ejecuta por el texto del modelo.

| Acción | Dónde corre | Límite que aplica |
|---|---|---|
| Crear viaje (borrador) | concierge-chat (RLS del usuario) | — |
| Agregar al itinerario (día exacto, `agregados`, visible en el viaje) | concierge-chat | acceso al viaje (RLS) |
| Registrar gasto | concierge-chat → `expenses` | RLS |
| Agregar a la maleta | concierge-chat → `packing_lists` | RLS (lista del dueño) |
| Alerta de precio | `price-watch` | plan_limits.price_watches |
| Seguir vuelo | `track-flight` | plan_limits.tracked_flights |
| Guardar lugar en favoritos | `recomendaciones` (tipo "lugar") | RLS |
| Cambiar hotel del viaje (dato del usuario, sin verificar) | concierge-chat | acceso al viaje |
| Pedírselo al Fixer (mesa, traslado, cambio de vuelo, equipaje) | `concierge-action` → estado **solicitado** | ritmo de concierge-action |
| Solicitud Privé (solo experiencias mostradas por search_prive, con sesión Privé) | `concierge-action` → `prive_request_create` | reglas Privé |
| Calendario (.ics del día) | en la app | — |
| Cómo llegar (Google Maps), Uber, llamar, sitio | enlaces en la card | — |

## 6. Reservas: lo que hay hoy y lo que haría falta

Hoy Iato **no reserva** (no hay contratos ni APIs de socios). Da el mejor camino honesto y lo dice: "Aún no está reservado".
- Restaurantes: sitio del lugar (si viene en los datos), búsqueda prellenada en OpenTable (fecha y personas; puede no estar),
  ficha de Google Maps (muestra "Reservar" cuando el lugar lo ofrece) y "Pídeselo al Fixer".
- Hoteles y vuelos: los enlaces de los socios que ya devuelven `hotels-search` / `flights-search`.

Reserva real (hoja de ruta; sin contactar a nadie, costos a confirmar con cada proveedor):

| Categoría | Opción | Qué requiere |
|---|---|---|
| Vuelos | Duffel (API de reservas) u otro consolidador NDC | Contrato, cuenta con depósito o tarjeta, cobro al cliente (Stripe) y manejo de cambios/reembolsos; comisión por orden según su tarifa vigente |
| Restaurantes | OpenTable Connect, SevenRooms, Resy (programas de socios) | Alta como socio/afiliado, aprobación por mercado, cumplimiento de políticas de cancelación; algunos cobran por reserva |
| Restaurantes (Europa) | TheFork (afiliados / API de socios) | Igual que arriba |
| Hoteles | Booking.com Demand API, Expedia Rapid | Contrato de afiliado, PCI si se cobra, políticas de cancelación por tarifa |
| Traslados | Welcome Pickups / Blacklane (API de socios) | Contrato y cobro |
Mientras tanto, el Fixer humano cierra las reservas y la solicitud queda "solicitado" hasta que alguien confirme con evidencia.

## 7. Promesas de la pantalla del Concierge

| Promesa | Estado | Prueba |
|---|---|---|
| Encabezado "Concierge PRO te escucha" / "Iato te escucha" | Funciona: depende del plan real | conciergePlanCopy.test.tsx |
| "Auto-refresh 60s" | Funciona: refresca viajes, ubicación y clima cada 60 s | (sin cambio) |
| "Lo que Iato recuerda" | Funciona: memoria por viaje, borrable | (sin cambio) |
| Botón "Cena cerca" | Funciona: hotel reservado → Google Maps alrededor, botones Uber/Maps/reservar, agregar al itinerario | concierge2Evals caso 5, concierge2Client |
| Botón "Pedir transporte" | Funciona: card con Uber y Google Maps al hotel + traslado privado con el Fixer | planner (transport) |
| Botón "Emergencia local" | Funciona: números locales y hospital más cercano (pantalla existente); en el chat, alerta + hospital real + Fixer | concierge2Evals caso 8 |
| Botón "¿Mi vuelo va a tiempo?" | Funciona: usa el vuelo del viaje (hoy/mañana), estado real, a qué hora salir, seguir el vuelo | concierge2Evals "vuelo-hoy" |
| Botón "Equipaje Invisible" | **Reformulado**: no hay proveedor conectado; ahora es "cotización a un humano" (antes pedía precios y links de Luggage Forward/AirPortr/LugLess) | concierge2Client |
| "Modo exigente · opciones VIP" | **Reformulado** a "Modo exigente · lo mejor de lo mejor", con explicación; modelo capaz, más opciones, A/B/C con fuentes y contras, 2–3 acciones | concierge2Evals (exigente) |
| "Contactar Fixer" | Funciona (correo + teléfono); el tooltip decía "vía WhatsApp": **reformulado** | conciergeCards (FixerButton) |
| Members Only → "Solicitar" | Funciona (solicitud con estado "solicitado"); el aviso decía "Te confirmamos por chat": **reformulado** | membersMore.test.tsx, concierge2Client |
| Saludo "listo para anticiparme a cualquier capricho" | **Reformulado**: lo que Iato puede hacer con el viaje activo y "nada se reserva sin que lo confirmes" | concierge2Client |
| PRO: "100 mensajes con Iato al mes" | Texto vigente; el tope de PRO solo se aplica con `pro_limits_enforced` (decisión ya del dueño) | planCopy.test.ts |

## 8. Decisiones del dueño

1. **Modelos**: rápido Haiku 5.5 + capaz Sonnet 5.5 (propuesto, ≈ $0.004 por mensaje promedio). Alternativas: todo en Sonnet 5.5
   (≈ $0.017, más uniforme y algo más lento) o `force_tier` según el plan.
2. **Modo exigente**: ahora viene **apagado** por omisión (antes encendido): cuesta ≈ 30 veces un mensaje rápido (≈ 2 veces uno del nivel capaz) y tarda unos segundos más.
   Cuenta como 1 mensaje. Tope diario opcional en `app_flags.concierge_exigente_daily_limit` (propuesto: 20 al día para PRO;
   hoy `null` = sin tope). Al pasarlo no se bloquea: responde en modo normal y lo dice.
3. **Members Only en Iato**: Iato consulta `members_venues` (la misma RPC que exige PRO). El catálogo Privé sigue solo con sesión Privé.
4. **Prefetch proactivo del vuelo de hoy**: consulta el estado aunque la pregunta sea otra (1 búsqueda con caché de 10 min).

## 9. Evaluación en vivo (después del despliegue)

`SUPABASE_URL=… SUPABASE_ANON_KEY=… EVAL_EMAIL=<cuenta sintética PRO> EVAL_PASSWORD=… node scripts/concierge/eval_live.mjs`
Crea 2 viajes de prueba, corre los 8 escenarios + Centurion + 3 comparaciones normal/exigente (~15 mensajes, costo real),
califica con `scripts/concierge/rubric.mjs`, imprime P50/P95 y borra los viajes.
