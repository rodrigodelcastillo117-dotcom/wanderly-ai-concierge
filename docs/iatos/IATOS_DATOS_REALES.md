# IATOS — Datos reales: de dónde sale cada vuelo, hotel, restaurante, atracción, traslado y total

Grupo **googlemax**, rama `claude/wc-googlemax`, 22–23 de octubre de 2026.

Orden del dueño: *"los datos de vuelos, hoteles, restaurantes, todas las cotizaciones deben de ser reales… exprime google para poder hacer todo"*.

Este documento tiene cuatro partes:

1. El inventario: cada lugar donde la app o Iato muestra un dato de viaje, su fuente y su estado.
2. Lo que se cambió.
3. Los módulos de Google para el grupo de Concierge 2.0.
4. Costos, cuotas, términos de Google y lo que tiene que decidir el dueño.

## Vocabulario de estados

| Estado | Qué significa | Cómo se ve |
|---|---|---|
| **CONSULTADO EN VIVO** | Se consultó al proveedor. La respuesta lleva su fecha real (`consultado_at` / `consulted_at`). Si salió de la caché compartida, la fecha es la de esa consulta, nunca la de "ahora". | "Consultado en vivo · Google Flights · hace 3 h" |
| **REAL EN CACHÉ** | Dato real, pero guardado. Hay dos casos: el TTL todavía vigente, y el "precio guardado" ya vencido (estado `OBSOLETO`, que en la cotización cuenta como `PENDIENTE`). | "Precio de hace 2 días; verifica antes de reservar" |
| **ESTIMADO** | Una aproximación con su justificación: precio de referencia de Travelpayouts, distancia en línea recta, rango de IA con investigación web, comida por día, etc. | "Precio de referencia (caché ≤48 h) · puede variar", "Estimado con investigación web", "~2 h (aprox.)" |
| **NO DISPONIBLE** | El proveedor no respondió o no hay cuota. Se muestra "no disponible" con el motivo y una liga de búsqueda. Nunca se rellena con datos inventados. | "No disponible ahora" |
| **IA SIN FUENTE** | Un nombre o precio generado por un modelo y presentado como real. **Hay que eliminarlo.** | — |

## 1. Inventario

✅ = cumple la regla. ⚠️ = cumple, pero con un límite que se documenta. ❌ = no cumple (pendiente, con dueño indicado).

### Vuelos

| Dónde | Fuente | Estado | Etiqueta / cambio |
|---|---|---|---|
| TripFlights (`flights-search`) | SerpApi Google Flights, con la caché compartida `serp_cache` | ✅ En vivo o real en caché, con fecha | Ahora cada resultado trae tramos, número de vuelo, horarios, avión, clase, escalas con duración, emisiones, `departure_token` y una nota del precio ("total para N viajeros, ida y vuelta"). Si es precio guardado: `estado_dato: OBSOLETO` y `precio_guardado: true` en cada resultado. |
| TripFlights, respaldo | Travelpayouts `v1/prices/cheap` (búsquedas de otros viajeros, ≤48 h) | ✅ **ESTIMADO** | **Cambiado:** antes la insignia lo daba por `CONSULTADO_EN_VIVO` (confiable). Ahora es `fuente: travelpayouts`, `estado_dato: ESTIMADO` y la etiqueta dice "Precio de referencia (Aviasales, búsquedas de las últimas 48 h); puede variar". También se agregó `vigencia_hasta`. |
| Análisis de viaje (`analizar-viaje`), 3 tiers | Listas de Google Flights y Travelpayouts; el modelo elige y el servidor verifica precio ±3 % (`enforceSources`) | ✅ | **Cambiado:** (1) cada vuelo lleva la fecha real de SU lista, no la hora del análisis; (2) un precio guardado de Google queda `OBSOLETO`; (3) Travelpayouts queda `ESTIMADO` con `nota_precio`. Un precio que no está en ninguna lista es `estimado`. |
| Análisis multi-destino (`logistics-plan`) | Travelpayouts | ✅ ESTIMADO | **Cambiado:** `markLive("travelpayouts")` ya no marca "en vivo". |
| Cotización en vivo de viajes manuales (`serpapi-quote`) | Google Flights + Google Hotels (SerpApi), con la cotización del viaje guardada 24 h | ✅ | **Cambiado:** el hotel usa el total de Google con impuestos cuando lo trae, y se informa si el tipo de cambio es el de respaldo (`fx_is_fallback` + nota). El modo IA (`ENABLED=false`) está apagado en el código. |
| Chat (Iato) `search_flights` | `flights-search` | ⚠️ | Los resultados de Travelpayouts ya traen `estado_dato: ESTIMADO`. **Pendiente para Concierge 2.0:** `concierge-chat/cards.ts:301` marca `CONSULTADO_EN_VIVO` toda tarjeta cuyo precio coincida con un resultado de herramienta, aunque ese resultado diga `ESTIMADO`. No toqué ese archivo (es de ese grupo). |
| Estado de vuelo (`flight-status`, FlightStatusDialog) | SerpApi (widget de Google, caché de 10 min). Respaldo: Perplexity con citas | ⚠️ | **Cambiado en la pantalla:** ahora dice de dónde salió el dato. Con Google: "Datos de Google · consultado HH:MM". Con Perplexity: "Resumen de una búsqueda web: no está confirmado con la aerolínea". |
| Alerta de precio (`price-watch`, `price-watch-cron`) | Travelpayouts y Google Flights; la línea base es el precio medido | ✅ | Sin cambios. Gana la TTL por fecha y el freno de cuenta. |

### Hoteles

| Dónde | Fuente | Estado | Etiqueta / cambio |
|---|---|---|---|
| TripHotels (`hotels-search`) | SerpApi Google Hotels con caché | ✅ | **Cambiado:** ahora trae `total_usd` con impuestos (cuando Google lo publica), `nightly/total_before_taxes_usd`, `total_incluye_impuestos` o `total_calculado`, la categoría como número (antes llegaba "5-star hotel" y la pantalla no podía pintar estrellas), lat/lng, horarios de entrada y salida, el proveedor de la tarifa y `property_token`. |
| Análisis (`analizar-viaje`) | Lista de Google Hotels; el servidor verifica nombre y precio ±5 % | ✅ | **Cambiado:** usa la fecha real de la lista; un precio guardado queda `OBSOLETO`. |
| Multi-destino (`logistics-plan`) | Google Hotels por ciudad | ✅ | Sin cambios (ya usaba el `consulted_at` de la lista). |

### Restaurantes

| Dónde | Fuente | Estado | Etiqueta / cambio |
|---|---|---|---|
| Viajes sin restaurantes, como los importados de PDF (`suggest-restaurants` → `restaurantes_json`) | **Antes: Gemini inventaba la lista** ("5 restaurantes reales"), con rangos de precio sin fuente | ❌ → ✅ | **Reescrito:** Google Places API (New), Text Search Enterprise + Atmosphere, `includedType: restaurant`, `minRating: 4`, ordenado por calificación ponderada por reseñas. Trae nombre, calificación, reseñas, nivel de precio en español, rango por persona, horario de hoy, abierto ahora, `reservable`, sitio, teléfono, `maps_url`, `place_id`, `fuente: google_places` y `consultado_at`. Si Google falla: `ok: false`, lista vacía y el motivo. Ya no hay IA. |
| Análisis (`analizar-viaje`) | **Antes: Perplexity + el modelo, sin verificación** | ❌ → ✅ | **Cambiado:** se consulta Google Places para el destino (con la preferencia de comida del perfil). El modelo solo puede elegir de esa lista y redactar el "por qué". `enforceRestaurants` quita los nombres que no estén en Google, completa hasta 5 con los mejores de la lista y pone los datos reales del servidor. Si Google no responde, se conservan los de Perplexity marcados `verificado: false`, sin calificaciones. |
| TripDetail (tarjetas de restaurantes) | `restaurantes_json` | ✅ | **Cambiado:** muestra la calificación, las reseñas, el nivel de precio, el horario de hoy, "Acepta reservaciones" y "Datos de Google Maps · consultado el …". El botón abre el sitio o la ficha exacta de Maps. Los no verificados dicen "Sugerencia sin verificar". |
| TripActivities, pestaña restaurantes (`tripadvisor-search`) | TripAdvisor → **Google Places (nuevo)** → SerpApi Maps | ✅ | Ver "Atracciones". |
| Chat `search_nearby` / ConciergeActions (`places-nearby`) | Places Nearby (New); respaldo SerpApi Maps | ✅ | Sin cambios (contrato del Concierge). |
| Cercanos (`nearby-places`) | Places Nearby (New) | ✅ | No lo toqué (es del grupo bug-fix). |
| Nightlife (`nightlife-discover`) | **IA (Claude/Gemini) guardada en `nightlife_premium`** | ❌ | **No corregido.** No la llama ninguna pantalla actual (Members usa `members_venues`). Recomendación: verificar cada lugar con `searchText(preset "basic")` y guardar solo el `place_id`. |

### Atracciones y experiencias

| Dónde | Fuente | Estado | Etiqueta / cambio |
|---|---|---|---|
| `tripadvisor-search` (TripActivities, análisis, multi-destino, chat `search_attractions`) | TripAdvisor Content API; **si falla, ahora Google Places (New)** Text Search Enterprise; SerpApi Maps solo como último recurso | ✅ | **Cambiado:** antes el respaldo gastaba la bolsa de SerpApi (1 búsqueda por análisis). Places devuelve la misma forma (`name`, `rating`, `num_reviews`, `web_url`…) más `photo_ref`, `open_now`, `hours_today`, `fuente: google_places` y `consultado_at`. `source: "google_places"`. |
| Análisis, tours | La lista anterior. El precio del tour siempre es ESTIMADO (Google/TripAdvisor no venden boletos). | ✅ ESTIMADO | **Cambiado:** la calificación, las reseñas, el `place_id` y la liga de Maps los pone el servidor con la lista, no el modelo. Se acepta `google_places` como fuente. |
| Multi-destino, experiencias | La lista anterior | ✅ | **Cambiado:** `labelExperiences` reconoce `google_places` / `google_maps` (antes solo "tripadvisor"; con Places todo habría caído en "estimado"). |
| TripActivities, fotos | Google Places entrega un nombre de foto, no una URL | ✅ | **Cambiado:** usa `PlacePhoto` (el contrato nuevo de `place-photo` del grupo bug-fix, con la sesión del usuario) y muestra "Foto: Google". |

### Traslados y tiempos

| Dónde | Fuente | Estado | Etiqueta / cambio |
|---|---|---|---|
| Trayecto corto del análisis (CDMX→Puebla, etc.) | **Antes: línea recta × 1.3 a 75 km/h** | ⚠️ → ✅ | **Cambiado:** se detecta un candidato hasta 500 km en línea recta y Routes API (`computeRoutes`, manejo sin tráfico, SKU Essentials) da los km y el tiempo reales. Decide con la distancia real (≤350 km). El prompt dice "según Google Maps, sin tráfico". Si Google no responde, queda la aproximación de antes, etiquetada "aprox.". En la cotización: `sources.traslado_carretera` guarda la fuente y la fecha. |
| Precio de autobús / auto | Rango del modelo | ✅ ESTIMADO | Sin cambios ("Precio estimado; confírmalo en el buscador"). No hay API pública de precios de autobús (ver `IATOS_PROVEEDORES_AUTOBUSES.md`). |
| Ruta en el mapa (`get-routes`) | Routes API, 4 modos | ✅ En vivo | Sin cambios. Nota de costo: el modo auto usa `TRAFFIC_AWARE` (SKU Pro, 5,000 gratis). |
| Multi-destino, transporte interno | Modelo | ✅ ESTIMADO (`forceEstimated`) | Sin cambios. Siguiente paso: tiempos con `computeRouteMatrix`. |
| Planificador Privé (traslados) | Línea recta × 1.4 a 20 km/h | ✅ ESTIMADO | No lo toqué (Privé ya está publicado). `travelTime()` puede reemplazarlo. |

### Totales

| Dónde | Regla | Cambio |
|---|---|---|
| Total del análisis (`trips.total_estimado`, `trip_quotes`) | Suma exacta de los renglones (`reconcileBudget`). Cada renglón tiene estado: COTIZADO, ESTIMADO, PENDIENTE o PAGADO. | **Cambiado:** `OBSOLETO` ahora es `PENDIENTE` (antes caía en ESTIMADO), y `trip_quotes.sources.total_por_estado` dice cuánto del total es cotizado, estimado o por verificar. Comida, transporte local y extras siempre son ESTIMADO. |
| Correo "tu cotización está lista" | Total y desglose del viaje | Sin cambios. |
| Cotización de viaje manual | Vuelo + hotel de Google; `components` dice qué falta | Sin cambios (y lo de impuestos y FX de arriba). |

### Otras superficies con IA (no son precios de proveedor)

- `recomendar-destinos`: ideas de destino por ADN. No muestra precios de proveedor.
- `buscar-promociones`: Perplexity con citas. El "ahorro estimado" ya está marcado como estimación.
- `editar-viaje-ai`: lo que se edita queda ESTIMADO o PENDIENTE (`reconcile.ts`).

Ninguna de estas superficies se cambió.

## 2. Qué se cambió (resumen técnico)

- **`_shared/google-maps.ts`**: el transporte (conector de Lovable por defecto, o directo con `GOOGLE_MAPS_DIRECT=true`), la clasificación de errores (deshabilitada, llave rechazada, cuota, inválida, no encontrada, red), `coalesce`, `timeZoneAt` y los precios por SKU.
- **`_shared/google-places.ts`**: `searchText`, `searchNearby`, `placeDetails` y `findPlaceId`. Las máscaras van por preset: `ids`, `basic`, `rich` y `atmosphere`, cada uno con su SKU. La normalización a `GooglePlace` está en español. "Abierto ahora" se calcula con los periodos y la zona IANA del lugar (cruza medianoche y fin de semana; 24 h). También hay `rankByQuality`, `restaurantFromPlace` y `placeCard`.
- **`_shared/google-routes.ts`**: `computeRoute` (Essentials por defecto; Pro solo con `trafficAware`), `computeRouteMatrix` (con los límites de 625 y 100 elementos), `estimatedLeg` (siempre ESTIMADO) y `travelTime` (real, o la estimación, o el error).
- **`_shared/google-restaurants.ts`**: `restaurantsForCity`, `suggestRestaurants` y `enforceRestaurants`.
- **`_shared/google-runtime.ts`**: conecta las llaves del entorno y registra cada llamada en `ai_usage_log` (`provider: google_maps`, `model` = SKU, costo de lista).
- **SerpApi** (`_shared/serpCache.ts`, `serpBrake.ts`, `serpRuntime.ts`, `liveSearch.ts`):
  - TTL según la fecha del viaje: vuelos 3 h / 6 h / 12 h / 24 h; hoteles 6 h / 12 h / 24 h / 48 h.
  - Búsquedas idénticas en curso se comparten: el turno se aparta antes de cualquier espera.
  - Freno de cuenta: un presupuesto opcional del mes o del día, y una pausa de 1 h cuando SerpApi responde "run out of searches" o 429.
  - Con el freno activo se sirve el último precio guardado, con su fecha, o "no disponible", y la respuesta trae `busquedas_en_pausa` y un aviso.
  - Aplica también a los análisis.
- **Migración** `20261023160000_serp_global_budget.sql`: `serp_global_used(_period)`, solo para service_role.
- **`health-check?action=google_apis`**: el diagnóstico de APIs (ver la sección 5).
- **Front**: `provenance.ts` (Travelpayouts ESTIMADO; `google_places` como fuente curada), TripDetail, TripActivities y FlightStatusDialog.

## 3. Módulos para Concierge 2.0 (contratos estables)

Todos viven en `supabase/functions/_shared/`, no dependen de Deno salvo `google-runtime.ts` y se pueden importar desde `concierge-chat`. Los contratos existentes de `flights-search`, `hotels-search`, `tripadvisor-search` y `places-nearby` no cambiaron de forma: solo se **agregaron** campos.

```ts
import { googleTransportFor } from "../_shared/google-runtime.ts";          // GoogleTransport | null
import { searchText, searchNearby, placeDetails, findPlaceId, placeCard, rankByQuality,
         type GooglePlace, type PlacesResult } from "../_shared/google-places.ts";
import { restaurantsForCity, enforceRestaurants } from "../_shared/google-restaurants.ts";
import { computeRoute, computeRouteMatrix, travelTime, type RouteLeg } from "../_shared/google-routes.ts";
import { timeZoneAt, callError, googleErrorMessage } from "../_shared/google-maps.ts";

const g = googleTransportFor("concierge-chat", userId);    // null → responder "no disponible"
const r = await searchText(g!, { query: "bares de coctelería en Roma Norte", includedType: "bar",
  preset: "atmosphere", near: { lat, lng, radius: 2000 }, maxResults: 8 });
if (!r.ok) return { disponible: false, motivo: googleErrorMessage(callError(r).kind) };
r.places[0] // GooglePlace: place_id, name, rating, user_rating_count, price_level_label ("Precio moderado"),
            // price_symbol ("$$"), price_range {min,max,currency,text}, open_now, open_now_source,
            // hours_today, time_zone, reservable, serves.{dinner,…}, editorial_summary, website, phone,
            // maps_url, photos[{ref,width,height,attributions}], photo_ref, fuente "google_places",
            // estado_dato "CONSULTADO_EN_VIVO", consultado_at, atribucion "Google Maps"
const leg = await travelTime(g, { origin: { lat, lng }, destination: { placeId: r.places[0].place_id }, mode: "WALK" });
// leg.ok && leg.fuente === "google_routes" → real; "estimado_linea_recta" → mostrar como ESTIMADO
```

| Función | SKU por llamada (precio de lista) | Notas |
|---|---|---|
| `searchText(preset "ids")` | Text Search Essentials (IDs Only), **gratis** | Solo `place_id`. |
| `searchText("basic")` | Text Search Pro, USD 0.032 | Nombre, dirección, ubicación, tipo, fotos, zona horaria. |
| `searchText("rich")` (default) | Text Search Enterprise, USD 0.035 | + calificación, reseñas, precio, horario, teléfono, sitio. |
| `searchText("atmosphere")` | Text Search Enterprise + Atmosphere, USD 0.040 | + reservable, sirve cena, resumen editorial… |
| `searchNearby` | Nearby Search Pro / Enterprise / + Atmosphere (0.032 / 0.035 / 0.040) | `includedTypes`, radio ≤50 km. |
| `placeDetails` (default `atmosphere`) | Place Details Enterprise + Atmosphere, USD 0.025 | Para la ficha de un solo lugar. |
| `findPlaceId` | Gratis (IDs Only) + caché de 30 días | Lo único que se puede guardar. |
| `computeRoute` | Compute Routes Essentials, USD 0.005 (Pro 0.010 con `trafficAware`) | |
| `computeRouteMatrix` | Route Matrix Essentials, USD 0.005 **por elemento** | Máximo 625 elementos (100 en transporte público). |
| `timeZoneAt` | Time Zone, USD 0.005 | Para lugares es mejor `GooglePlace.time_zone` (ya viene en la búsqueda). |

Reglas para el chat:

- Mostrar "Google Maps" junto a los resultados sin mapa.
- Mostrar el autor de la foto (`photos[].attributions`) en la foto grande.
- Pedir las fotos con `PlacePhoto` / `fetchPlacePhotoUrl` (el contrato del grupo bug-fix).
- No guardar en la base nada de `GooglePlace` salvo `place_id`.

## 4. Google Maps Platform: precios, franjas gratis y términos

Fuente oficial: https://developers.google.com/maps/billing-and-pricing/pricing. La página dice "Last updated 2026-10-21 UTC" y la consulté el 2026-10-22. La relación entre campos y SKU es de https://developers.google.com/maps/documentation/places/web-service/data-fields (misma fecha).

| SKU | Gratis al mes | USD por 1,000 (franja hasta 100k) |
|---|---|---|
| Text Search Essentials (IDs Only) | Ilimitado | — |
| Text Search Pro / Enterprise / Enterprise + Atmosphere | 5,000 / 1,000 / 1,000 | 32 / 35 / 40 |
| Nearby Search Pro / Enterprise / Enterprise + Atmosphere | 5,000 / 1,000 / 1,000 | 32 / 35 / 40 |
| Place Details Essentials / Pro / Enterprise / Enterprise + Atmosphere | 10,000 / 5,000 / 1,000 / 1,000 | 5 / 17 / 20 / 25 |
| Place Details Photos | 1,000 | 7 |
| Compute Routes Essentials / Pro / Enterprise | 10,000 / 5,000 / 1,000 | 5 / 10 / 15 |
| Compute Route Matrix Essentials / Pro / Enterprise (por elemento) | 10,000 / 5,000 / 1,000 | 5 / 10 / 15 |
| Geocoding | 10,000 | 5 |
| Time Zone | 10,000 | 5 |

En Places, `rating`, `userRatingCount`, `priceLevel`, `websiteUri`, el teléfono y el horario son campos **Enterprise**. `reservable`, `servesDinner`, `editorialSummary` y `reviews` son **Enterprise + Atmosphere**. En Routes, `TRAFFIC_AWARE` y `TRAFFIC_AWARE_OPTIMAL` cobran **Pro** (https://developers.google.com/maps/documentation/routes/usage-and-billing).

### Términos: por qué no hay caché de contenido de Google

- https://developers.google.com/maps/documentation/places/web-service/policies (actualizada 2026-10-21) dice: *"You must not pre-fetch, cache, or store Places API content beyond the allowed exceptions"*. El `place_id` se puede guardar indefinidamente.
- Las Service Specific Terms (versiones archivadas 2023–2025, sección de Places) permiten guardar lat/lng hasta 30 días.
- Routes: *"caching of most Routes API content is restricted"*.

Por eso los módulos solo juntan peticiones idénticas en curso. Lo único guardado es `place_id`, 30 días en `serp_cache`, que borra lo de más de 30 días.

**Riesgo existente (decisión del dueño):** `trips.restaurantes_json` y `tours_json` guardan un snapshot (nombre, calificación) dentro del viaje del usuario. Esto ya pasaba con SerpApi. La opción estricta es guardar solo `place_id` y refrescar con `place-details` al abrir el viaje (Place Details Enterprise, USD 0.02 por lugar después de las 1,000 gratis).

### Conector de Lovable

https://docs.lovable.dev/integrations/google-maps marca un tope de **6,000 solicitudes de servidor cada 24 h** por espacio de trabajo y tipo de conexión. Con ~10,000 usuarios PRO se pasa ese tope (ver abajo). En ese punto hay que poner `GOOGLE_MAPS_DIRECT=true` (los módulos nuevos van directo a Google con `X-Goog-Api-Key`). Las funciones anteriores (`places-search`, `place-details`, `get-routes`, etc.) siguen en el conector.

## 5. Diagnóstico de APIs habilitadas (para después de publicar)

No hay llave en este entorno, así que no se probó contra Google. Tras publicar `health-check`, corre esto:

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/health-check?action=google_apis" -H "x-cron-secret: $CRON_SECRET"
```

Responde `{ ok, mode: "gateway"|"direct", results: [{ api, status, http, detail, ms }] }`. `status` es `enabled`, `disabled`, `quota`, `denied` o `error`, para cada una de estas pruebas:

- Places Text Search (gratis, IDs Only)
- Place Details
- Place Photos
- computeRoutes
- computeRouteMatrix
- Geocoding
- Time Zone

No guarda nada, no manda correo y nunca devuelve la llave. Una corrida cuesta ≈ USD 0.03 a precio de lista y cae en las franjas gratis.

## 6. Costo estimado de Google por usuario PRO al mes

**Supuestos de uso por usuario PRO al mes:**

- 3 análisis. Cada uno hace 1 Text Search Atmosphere (restaurantes) y 1 Text Search Enterprise (atracciones, si TripAdvisor no responde). El 20 % de los análisis también pide 1 Compute Routes Essentials.
- 2 `suggest-restaurants`.
- 5 búsquedas en Actividades (Enterprise).
- 10 búsquedas de cercanos (Nearby Enterprise).
- 5 fichas de lugar (Details Atmosphere).
- 5 rutas en el mapa (1 Pro + 3 Essentials cada una).
- 5 geocodificaciones.
- 20 fotos.

| SKU | Eventos por usuario | 100 usuarios | 1,000 usuarios | 10,000 usuarios |
|---|---|---|---|---|
| Text Search Enterprise + Atmosphere | 5 | 500 (gratis) | 4,000 × 0.04 = 160 | 49,000 × 0.04 = 1,960 |
| Text Search Enterprise | 8 | 800 (gratis) | 7,000 × 0.035 = 245 | 79,000 × 0.035 = 2,765 |
| Nearby Search Enterprise | 10 | 1,000 (gratis) | 9,000 × 0.035 = 315 | 99,000 × 0.035 = 3,465 |
| Place Details Enterprise + Atmosphere | 5 | 500 (gratis) | 4,000 × 0.025 = 100 | 49,000 × 0.025 = 1,225 |
| Compute Routes Pro | 5 | gratis | gratis | 45,000 × 0.01 = 450 |
| Compute Routes Essentials | 15.6 | gratis | 5,600 × 0.005 = 28 | 146,000 × 0.005 = 730 |
| Geocoding | 5 | gratis | gratis | 40,000 × 0.005 = 200 |
| Place Photos | 20 | 1,000 × 0.007 = 7 | 19,000 × 0.007 = 133 | 199,000 × 0.007 = 1,393 |
| **Total al mes (USD)** | | **≈ 7** | **≈ 981** | **≈ 12,190** |
| **Por usuario al mes (USD)** | | **≈ 0.07** | **≈ 0.98** | **≈ 1.22** |

- El costo es conservador: no aplica los descuentos por volumen de más de 100k.
- Como Google no permite caché de contenido, el "ahorro por caché" en Google es solo el de las peticiones juntadas. El ahorro grande viene de pedir el preset correcto. Ejemplo: `basic` en lugar de `atmosphere` cuando no se muestra la calificación.
- Solicitudes diarias al conector: ~3,000 con 1,000 usuarios (cabe en el tope de 6,000) y ~30,000 con 10,000 usuarios (no cabe: se necesita modo directo).

### SerpApi (vuelos y hoteles)

- **Uso por usuario PRO al mes:** unas 10–15 búsquedas antes de caché (3 análisis × 2–3 búsquedas + chat + cotización manual). Con el cambio, `tripadvisor-search` ya no gasta SerpApi cuando hay Google Places.
- **Plan actual:** con las ~216 búsquedas que quedan alcanza para ~15–20 usuarios activos al mes.
- **Costo por plan** (https://serpapi.com/pricing, ver `IATOS_COSTOS_UNITARIOS.md` 1.3):
  - Developer, USD 75 por 5,000: ~USD 0.15–0.23 por usuario y ~350–500 usuarios.
  - Production, USD 150 por 15,000: ~1,000 usuarios a ~USD 0.15.
  - 10,000 usuarios: ~125k búsquedas, plan Searcher o mayor (~USD 0.07 por usuario y búsqueda).
- La caché compartida baja esto en rutas populares. No lo medí, así que no lo resto.

## 7. DECISIONES DEL DUEÑO

1. **Plan de SerpApi:** quedan ~216 búsquedas. Hay que subir a Developer (USD 75) o a Production (USD 150).

   Mientras tanto, conviene poner `SERPAPI_MONTHLY_BUDGET` en el número de búsquedas del plan (y opcionalmente `SERPAPI_DAILY_BUDGET`). Con eso, al llegar, la app muestra precios guardados con su fecha o "no disponible", en lugar de fallar.

   Ojo: el mes es calendario UTC, y el ciclo de cobro de SerpApi puede empezar otro día.
2. **Google Cloud Console**, en el proyecto de `GOOGLE_MAPS_API_KEY`: habilitar **Places API (New)**, **Routes API**, **Geocoding API** y **Time Zone API**. Confirmar con el diagnóstico de la sección 5.
3. **Límites de facturación en Google:**
   - Poner cuotas diarias por API en la consola (p. ej. Text Search 300 al día, Nearby 300 al día, Place Details 200 al día).
   - Poner una alerta de presupuesto (p. ej. USD 50 al mes al principio).
   - Restringir la llave a esas APIs. Es una llave de servidor: sin restricción de referer, con restricción de API.
4. **Conector de Lovable vs. directo:** el tope es de 6,000 solicitudes al día. Con más de ~2,000 usuarios PRO activos hay que poner `GOOGLE_MAPS_DIRECT=true` (los módulos nuevos ya lo soportan).
5. **Snapshot de Google en los viajes** (sección 4): mantenerlo como hoy, o guardar solo `place_id` y refrescar al abrir (más costo, cumplimiento estricto de los términos).
6. **Presentación de Travelpayouts:** ahora es "precio de referencia, puede variar" (ESTIMADO). Si el dueño prefiere ocultarlo del todo cuando falta Google Flights, es un cambio de una línea en `flights-search`.

## 8. Despliegue

- **Funciones** (publicar con Lovable): `analizar-viaje`, `suggest-restaurants`, `tripadvisor-search`, `health-check`, `flights-search`, `hotels-search`, `serpapi-quote`, `logistics-plan`.
- **Funciones que solo cambian por `_shared`** (serpCache, serpRuntime, liveSearch, quotes): conviene volver a publicarlas para que tomen la TTL por fecha, las búsquedas juntadas y el freno. Son `concierge-chat`, `flight-status`, `flight-watch-cron`, `price-watch`, `price-watch-cron`, `pexels-image`, `buscar-video`, `places-nearby` y `editar-viaje-ai`.
- **Migración** (requiere el GO del dueño): `supabase/migrations/20261023160000_serp_global_budget.sql`. Si las funciones se publican antes que la migración, el freno de presupuesto falla abierto: se permite la búsqueda y queda en el log.
- **Variables nuevas (opcionales):** `SERPAPI_MONTHLY_BUDGET`, `SERPAPI_DAILY_BUDGET` y `GOOGLE_MAPS_DIRECT`.

## 9. Pruebas

Ninguna prueba llama a proveedores reales: todas usan fetch simulado. Los fixtures están en `src/test/fixtures/googlemax/` y se construyeron con el formato documentado de cada API. **No son grabaciones en vivo**, porque no hay llave en el entorno.

- `src/test/googlePlaces.test.ts` (20): máscaras y SKU, español, abierto ahora en la zona del lugar, errores, peticiones juntadas, `place_id` en caché y restaurantes.
- `src/test/googleRoutes.test.ts` (8): SKU de Routes, ruta, matriz, respaldo ESTIMADO, trayecto corto con la ruta real y diagnóstico de health-check.
- `src/test/serpQuota.test.ts` (12): TTL por fecha, búsquedas juntadas, freno de cuota y de presupuesto, avisos, vuelos y hoteles enriquecidos, Travelpayouts ESTIMADO, fecha real por fuente y total por estado.
- Pruebas ajustadas a la nueva regla de Travelpayouts: `provenance.test.ts`, `priceSourceBadge.test.tsx`, `tripSources.test.ts` y `logisticsProvenance.test.ts`.
