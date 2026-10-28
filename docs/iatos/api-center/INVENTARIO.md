# IATOS · Inventario de integraciones externas (qué existe y qué funciona en producción)

Auditoría de solo lectura, 28-oct-2026. Código: `/home/user/wt-rapido` @ `84a0d6a`. Base de producción (proyecto Lovable `7c80960a…`, Supabase `uhkdewinscffhdonhhmt`): solo `SELECT`. No se leyeron logs de Edge Functions ni valores de secretos.

**Fuentes de evidencia en producción**
- `ai_usage_log`: empieza el **22-oct-2026** (primera fila 2026-10-22 06:54), así que "últimos 30 días" = todo el historial. Por proveedor: `pexels` 712 · `google_maps` 677 · `anthropic` 114 · `serpapi` 97 · `lovable` 30 · `ticketmaster` 12 · `gemini` 10 · `ferryhopper` 1. **No hay filas** de `tripadvisor`, `perplexity`, `travelpayouts`, `viator`, `resend` ni `stripe` (Viator, Travelpayouts, Perplexity y Resend no escriben en esta tabla).
- `health_checks`: 10 corridas (22–28 oct). La última (2026-10-28 13:07) revisa Gemini, Lovable AI, Claude, SerpApi, Travelpayouts, Stripe, base de datos y pg_cron. **No revisa** Google Maps, Viator, Ticketmaster, Tripadvisor, Perplexity, Resend, Pexels ni Ferryhopper (para Google, Stripe, Ticketmaster y Tripadvisor hay sondas bajo demanda `?action=`, `supabase/functions/health-check/index.ts:26,33,40,49`; sus resultados no se guardan).
- `serp_cache` (caché compartida): `pexels_photo` 427 · `pexels_video` 285 · `gplaces_id` 105 · `google_hotels` 56 · `viator_products` 31 · `google_flights` 24 · `ticketmaster` 12 · `gmaps_geocode` 10 · `google_maps` 9 · `gplaces_verify` 7 · `wikidata_bases` 4 · `google_web` 3 · `google` 1 · `ferryhopper_trips` 1 · `google_travel_explore` 1. **No hay** `google_events`.
- `trip_quotes.sources` (instantánea de cada análisis): `fx_source`, `perplexity_citations`, `travelpayouts.count`, `google_flights.live`, `tours`, `traslado_carretera.casetas`.
- `cron.job`: 6 tareas activas (account-deletion-retry, booking-links-cron, flight-watch-cron, health-check, price-watch-cron, prive-cron). **No** está programada `ai-reservations-cron`. `net._http_response` últimas 48 h: 45 respuestas, todas HTTP 200.

**Clasificaciones**: EXISTE Y FUNCIONA (F) · EXISTE PERO NO ESTÁ CONFIGURADA (NC) · EXISTE PERO FALLA (FALLA) · NO EXISTE Y DEBE DESARROLLARSE (NE) · SOLO ENLACE (SE).
**†** = código existe y la ruta es plausible, pero **sin evidencia directa en producción** (la función no registra uso o la llamada ocurre en el navegador); se dice qué evidencia indirecta hay.

**Capacidades**: DISCOVERY (encontrar opciones) · QUOTE (precio) · AVAILABILITY (disponibilidad confirmada) · BOOKING (reservar/comprar en IATOS) · CONFIRMATION (confirmación del proveedor) · DEEP LINK. **Ninguna integración de IATOS implementa BOOKING ni CONFIRMATION por API de proveedor.**

---

## 1. Inteligencia artificial

| Proveedor | Código | Secreto(s) | Capacidad | Evidencia producción | Clasificación |
|---|---|---|---|---|---|
| **Anthropic Claude** (Haiku 5.5 / Sonnet 5.5) | `_shared/claude.ts:18,38`; `concierge-chat/anthropic.ts`; `analizar-viaje`, `interpretar-viaje`, `buscar-promociones`, `nightlife-discover` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | LLM (cerebro de Iato y análisis) | 114 filas: concierge-chat 81 (haiku 60, sonnet 21), analizar-viaje 25, interpretar-viaje 8+; USD ≈3.17. Health 6/6 OK "claude-sonnet-5-5" | **F** |
| **Gemini directo** (Google AI) | `_shared/ai.ts:66-90` (`aiFetchDetailed`: Gemini primero si el modelo es `google/*`) | `GEMINI_API_KEY` | LLM de respaldo / visión | 10 filas (concierge-chat 9, generate-avatar 1), última 2026-10-23. Health: **0 de 10** corridas limpias (HTTP 404 ×2, 503 ×4, timeout, ">20 s" ×2) | **FALLA** (intermitente: saturado/timeout) |
| **Lovable AI Gateway** | `_shared/ai.ts` (respaldo), `ai-tool`, `generate-avatar`, `avatar-evolve`; correo y Google pasan por `connector-gateway.lovable.dev` | `LOVABLE_API_KEY` | LLM respaldo, imágenes, gateway de conectores | 30 filas (concierge-chat 15, generate-avatar 11, avatar-evolve 4), última 2026-10-23. Health 10/10 OK; 26-oct aviso "Sin saldo de IA en Lovable" | **F** |
| **Perplexity** (sonar-pro) | `analizar-viaje/index.ts:74,369-373,418`; `buscar-promociones/index.ts:74`; `nightlife-discover/index.ts:136`; `flight-status/index.ts:54` (respaldo) | `PERPLEXITY_API_KEY` | Investigación web | Nunca se registra en `ai_usage_log`. `trip_quotes.sources.perplexity_citations = 0` en **todos** los análisis con fuentes (18). Sin chequeo de salud. Sin llave el código devuelve "(Perplexity no configurado…)" (`:369-373`). **`PERPLEXITY_API_KEY` no está en la lista de secretos de producción** (`SECRETOS_NOMBRES.md`) | **NC** |

## 2. Google Maps Platform (vía `connector-gateway.lovable.dev` o llave directa)

Transporte común: `_shared/google-runtime.ts:15-22` (`GOOGLE_MAPS_DIRECT`, `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY`); registra cada SKU en `ai_usage_log` (`provider=google_maps`). Las funciones viejas `places-nearby`, `nearby-places`, `place-details`, `geocode`, `geocode-address`, `mark-visited` llaman al gateway por su cuenta y **no registran uso**.

| Proveedor | Código | Secreto(s) | Capacidad | Evidencia producción | Clasificación |
|---|---|---|---|---|---|
| **Google Places (New)**: Text Search, Details, Photos | `_shared/google-places.ts`, `google-maps.ts`, `place-photo`, `places-search`, `place-details`, `suggest-restaurants`, `experiencias-top`, `analizar-viaje`, `logistics-plan` | `GOOGLE_MAPS_API_KEY` (+`LOVABLE_API_KEY`) | DISCOVERY (lugares reales, rating, horario) | Place Details Photos 258, Details Pro 197, Text Search IDs 107, Enterprise 70, Enterprise+Atmosphere 35, Pro 11 (última 2026-10-28 16:55). USD ≈9.2 en el periodo | **F** |
| **Google Places Nearby** (Iato `search_nearby`) | `places-nearby/index.ts:85-100`, `nearby-places/index.ts:74` | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` (+`SERPAPI_PRIVATE_KEY` en places-nearby) | DISCOVERY | No registra uso; ningún SKU "Nearby" en `ai_usage_log`. Misma llave/gateway que sí funciona | **F†** |
| **Google Geocoding** | `_shared/placeResolve.ts`, `place-resolve`, `logistics-plan`, `geocode`, `geocode-address` | `GOOGLE_MAPS_API_KEY` | Dirección → coordenadas | SKU "Geocoding" 11 filas (place-resolve, logistics-plan, health-check); `serp_cache.gmaps_geocode` 10 | **F** |
| **Google Routes** (computeRoutes) **+ casetas** | `_shared/google-routes.ts`, `google-tolls.ts`, `tollQuote.ts`, `get-routes`, `analizar-viaje` | `GOOGLE_MAPS_API_KEY` | QUOTE (tiempo, km y casetas) | Compute Routes Enterprise 5 (analizar-viaje, get-routes; última 2026-10-28), Essentials 4; `trip_quotes...casetas = "CON_MONTO"` en 2 análisis del 28-oct | **F** |
| Route Matrix / Time Zone | `_shared/google-routes.ts`; `health-check/googleProbe.ts` | idem | — | Solo la sonda de health-check (1 fila c/u, 23-oct). El orden del día con Matrix no lo usa ningún flujo | **F†** (solo sonda; no incluida en conteo) |

## 3. Vuelos, hoteles, tours, eventos, ferris

| Proveedor | Código | Secreto(s) | Capacidad | Evidencia producción | Clasificación |
|---|---|---|---|---|---|
| **SerpApi · Google Flights** | `flights-search/search.ts`, `_shared/flight-serpapi.ts`, `serpapi-quote`, `price-watch(-cron)`, `booking-bridge` (`recheck_price`) | `SERPAPI_PRIVATE_KEY`, `SERPAPI_DAILY_BUDGET`, `SERPAPI_MONTHLY_BUDGET` | QUOTE en vivo + DEEP LINK (`google_flights_url`, `booking_options`) | 26 filas flights-search (última 2026-10-28 16:45); caché 24; `google_flights.live=true` en 9 análisis. Health 10/10 OK: "226 búsquedas disponibles · ~16 días" | **F** |
| **SerpApi · Google Hotels** | `hotels-search/offers.ts:100-103` | `SERPAPI_PRIVATE_KEY` | QUOTE + DEEP LINK (Booking.com) | 56 filas (última 2026-10-28 16:45); caché 56 | **F** |
| **SerpApi · Google Events** (Iato `search_events`, después de Ticketmaster) | `concierge-chat/events.ts:2`, `index.ts:694-700`; TTL en `_shared/serpCache.ts:27` | `SERPAPI_PRIVATE_KEY` | DISCOVERY | **0** filas `google_events` en `ai_usage_log` y **0** en `serp_cache` | **F†** (sin evidencia; Ticketmaster responde antes) |
| **SerpApi · otros** (google web, flight status, maps, travel explore) | `concierge-chat/webSearch.ts`, `_shared/flight-serpapi.ts:96`, `tripadvisor-search` (respaldo), `flights-search/explore.ts` | `SERPAPI_PRIVATE_KEY` | DISCOVERY / estado de vuelo | google_web 3, google (flight-status) 3, google_maps 9, travel_explore 1 caché (27-oct) | **F** |
| **Travelpayouts · Data API** (Aviasales `prices_for_dates` v3, `v1/prices/cheap`, autocomplete `places2`) | `_shared/travelpayouts.ts:11,49-93`; `_shared/tp-params.ts:48`; `flights-search/search.ts:267`; `travelpayouts-flights`; `price-watch(-cron)` | `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER` | QUOTE de referencia (caché Aviasales ≤48 h; no es precio vivo) | No registra uso. Health 10/10 OK (sonda `v1/prices/cheap`, `health-check/checks.ts:141-144`). `trip_quotes...travelpayouts.count`: 6 en 1 análisis (23-oct), **0** en los otros 17 | **F** (con datos pocas veces) |
| **Travelpayouts · afiliado** (marker `533299`, script Drive) | `src/lib/affiliateLinks.ts:15,26-35,73-86`; `_shared/tp-params.ts:4,11-14`; `_shared/booking/links.ts:79-86,284-289`; Drive `src/lib/consent.ts:16,41-54` | marker público (`TRAVELPAYOUTS_MARKER` opcional) | DEEP LINK con marker | Enlaces armados a mano (ver §8). Sin datos de conversión en IATOS | **SE** |
| **Travelpayouts · Partner Links API** | No existe (sin coincidencias de `links/v1` / partner links). `tpDeepLink` ya no envuelve (`affiliateLinks.ts:17-28`: `tp.media/click` responde 400 "source_type is empty" desde 2026-10) | — | — | — | **NE** |
| **Ticketmaster Discovery v2** | `_shared/ticketmaster.ts:7,29`; `_shared/ticketmasterRuntime.ts:9`; `concierge-chat/index.ts:281,698`; `experiencias-top`; sonda `health-check/index.ts:40` | `TICKETMASTER_API_KEY` | DISCOVERY + DEEP LINK (ticketmaster.com.mx/.es/.it) | 12 filas `discovery_v2` (concierge-chat 9, experiencias-top 3; última 2026-10-28 16:18); 12 entradas de caché con eventos reales (CDMX, Madrid, Florencia) | **F** |
| **Viator Partner API v2** (afiliado básico) | `_shared/viator.ts:29-30,89-95,290-301`; `viator-search`; Iato `search_tours` (`concierge-chat/index.ts:702-708`); `experiencias-top`; `src/lib/viatorTours.ts`, `src/components/booking/ViatorTours.tsx` | `VIATOR_API_KEY` (o `VIATOR_API_KEY_SANDBOX` → base sandbox) | DISCOVERY + precio "desde" (indicativo) + DEEP LINK (`productUrl` con pid P00327354 / mcid 42383, `medium=api`). **Sin** AVAILABILITY/BOOKING | No registra en `ai_usage_log`. `serp_cache.viator_products` 31 respuestas reales (Madrid, Lisboa, Florencia; 27–28 oct). `VIATOR_API_KEY` y `VIATOR_API_KEY_SANDBOX` están configuradas; `viatorConfig` usa la de producción si existe (`viator.ts:89-92`) | **F** |
| **Ferryhopper** (servidor MCP público) | `_shared/ferryhopper.ts:1-25`; `ferry-search`; `src/lib/ferryLive.ts`; enlace `_shared/booking/groundLinks.ts:275-280` | ninguno (MCP sin llave) | DISCOVERY + QUOTE indicativo (EUR, 1 pasajero) + DEEP LINK | 1 fila `mcp_search_ferry_trips` (2026-10-24 08:39) + caché con opciones BRC→PAL | **F** (evidencia mínima: 1 llamada) |
| **Tripadvisor Terra** (Discover) | `_shared/tripadvisor-terra.ts:22,50-53,273-283`; `tripadvisor-search/index.ts:29-31,128-170` (respaldo Google Places → SerpApi Maps); sonda `health-check/index.ts:49` | `TRIPADVISOR_API_KEY`, `TRIPADVISOR_SEARCH_SIZE`, `TRIPADVISOR_PHOTOS_SIZE`, `TRIPADVISOR_DAILY_ENTITIES`, `TRIPADVISOR_USER_DAILY_CALLS` | DISCOVERY (rating/reseñas) | **0** filas `provider=tripadvisor` en todo el historial (Terra registraría `terra:*`). Las 24 llamadas a tripadvisor-search desde la migración a Terra (commit `0ed0886`, 27-oct 05:47) fueron al respaldo Google Places; `trip_quotes...tours` nunca vale "tripadvisor". `TRIPADVISOR_API_KEY` **sí está configurada** (`SECRETOS_NOMBRES.md`), así que no es falta de llave: la llave es rechazada (401/403/402/429 → respaldo) o la versión Terra no está desplegada; confirmar con `health-check?action=tripadvisor` | **F (uso restringido)** — Verificado 28-oct 17:08 UTC: sonda `health-check?action=tripadvisor` HTTP 200 (llave válida) y búsqueda real devuelve `tripadvisor_motivo: "solo_pantallas"`. Es a propósito (`tripadvisor-search/core.ts:12-16,42,50`): los términos de Tripadvisor prohíben usar su contenido con IA, así que Terra solo se consulta cuando una persona busca en la pantalla de Actividades (`uso: "pantalla"`); análisis, Iato y logística usan Google |

## 4. Datos públicos, clima, fotos, divisas

| Proveedor | Código | Secreto(s) | Capacidad | Evidencia producción | Clasificación |
|---|---|---|---|---|---|
| **MET Norway** (Locationforecast 2.0) | `src/lib/metNorway.ts:1-16`, `weatherRadar.ts`, `tripWeather.ts`, `weatherNow.ts`, `pages/TripWeather.tsx`, `pages/Concierge.tsx` (llamada desde el navegador) | ninguno | Pronóstico | Sin registro en BD (es del navegador). Sonda propia hoy: `api.met.no/.../compact?lat=19.4326&lon=-99.1332` → HTTP 200 | **F†** |
| **Frankfurter** (BCE) | `_shared/fx.ts:35,77`; `analizar-viaje`, `serpapi-quote`, `viator.ts`, `price-watch-cron/rules.ts` | ninguno | Tipo de cambio | `trip_quotes.fx_source = 'frankfurter'` 23/23, `fx_is_fallback=false` (última 2026-10-28 16:49) | **F** |
| **Wikidata** | `_shared/placeResolve.ts` (SPARQL/wbsearch), `place-resolve`; `src/components/route/RegionBases.tsx` | ninguno | Resolver país/región → ciudades | `serp_cache.wikidata_bases` 4 (2026-10-27) | **F** |
| **Pexels** (fotos y video) | `pexels-image`, `buscar-video`, `_shared/hero-photo.ts` | `PEXELS_API_KEY` | Imágenes | 712 filas (pexels-image 424, buscar-video 285); caché 712 con 2,901 aciertos | **F** |
| **Unsplash** | URLs fijas `src/pages/DashboardHome.tsx:81,724-726`; `src/lib/imageSizing.ts` | ninguno | Imágenes estáticas (sin API) | — | **SE** |
| **Profeco** (gasolina) | `_shared/carCost.ts:9,19-28` (promedio nacional con PDF fechado `QQPGASOLINA_102626.pdf`); `GroundOptionInfo.tsx:58` | ninguno | Dato estático citado | — | **SE** |
| **Avisos de viaje GOV.UK / SRE / travel.state.gov** | Solo enlaces: `src/lib/boveda/alerts.ts:30,37,47`; `src/components/AiDataNotice.tsx:9`; `_shared/roadtrip/sources.ts:25,37,44` | ninguno | DEEP LINK a la fuente | No hay API (la Content API de GOV.UK no se usa) | **SE** |
| OpenAgenda | — (0 coincidencias) | — | — | — | **NE** |
| OpenAQ (calidad del aire) | — | — | — | — | **NE** |
| GTFS / Mobility Database | — | — | — | — | **NE** |
| National Rail Darwin | Solo enlace `nationalrail.co.uk` en `_shared/booking/railOperators.ts:48` | — | — | — | **NE** |
| Wikivoyage | — | — | — | — | **NE** |
| OurAirports | — (tabla propia `_shared/airports.ts`) | — | — | — | **NE** |
| Datos de país (REST Countries o similar) | Solo tablas estáticas: `_shared/booking/channels.ts:136` (`countryIso`), `src/lib/boveda/alerts.ts:63` (`COUNTRY_NAME`), `src/lib/countryRoutes.ts:17` | — | — | — | **NE** (como API) |

## 5. Correo y pagos

| Proveedor | Código | Secreto(s) | Capacidad | Evidencia producción | Clasificación |
|---|---|---|---|---|---|
| **Resend (envío)** | `_shared/email.ts:29-30` (gateway Lovable o llave directa), `email-kit.ts`, `email-ops.ts`; prive-cron, prive-access, concierge-action, enviar-seleccion, email-bienvenida, health-check, stripe-webhook… | `RESEND_API_KEY`, `LOVABLE_API_KEY`, `FIXER_FROM_ADDRESS`, `PRIVE_REPLY_TO`, `SUPPORT_EMAIL`, `HEALTH_ALERT_EMAIL`, `ALERT_EMAILS_ENABLED` | Envío | `prive_invitations.email_status='sent'` 16 con `provider_message_id` (última 2026-10-28 16:10); `health_checks.email_status='sent'` 6 | **F** |
| **Resend Receiving** (respuestas de restaurantes) | `reservations-inbound`, `_shared/ai-reservations/` | `RESEND_INBOUND_SECRET`, `RESEND_RECEIVING_API_KEY`, `AI_RESERVATIONS_REPLY_DOMAIN` | Webhook entrante | `ai_reservation_inbound` 0 filas; `RESEND_INBOUND_SECRET` y `RESEND_RECEIVING_API_KEY` **no configurados** (sin el primero el webhook responde 503) | **NC** |
| **Stripe** | `stripe-checkout`, `stripe-portal`, `stripe-webhook`, `_shared/stripe-billing.ts`, `stripe-offer.ts`; sonda `health-check/index.ts:33` | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` | Suscripción PRO | Health 10/10 "Stripe está en **modo de prueba**: nadie puede pagar de verdad". `stripe_payment_events` 0; `subscriptions`: 16 `comped`, 1 `trialing` con id de Stripe, 1 `canceled` | **NC** (modo prueba) |

## 6. Funciones propias de IATOS que dependen de proveedores

| Función | Código | Secreto(s) / bandera | Capacidad | Evidencia producción | Clasificación |
|---|---|---|---|---|---|
| **Booking Bridge · resolver y verificación de enlaces** | `booking-bridge/handler.ts:246-472` (`list_offers_for_trip`, `resolve`), `booking-links-cron`, `_shared/booking/allowlist.ts`, `siteScan.ts` | `BOOKING_LINKS_PER_RUN`, `SERPAPI_PRIVATE_KEY` | DEEP LINK validado (lista blanca) | `booking_link_checks` 1,127 filas (ok 964, blocked 46, unknown 83…; última 2026-10-24 16:41); cron `booking-links-cron-hourly` activo | **F** |
| **Booking Bridge · intención de compra / salida firmada** (`start_booking`, `recheck_price`, `confirm_price_ack`, `booking-go`) | `booking-bridge/handler.ts:275-470`, `booking-go/index.ts`, `src/components/booking/BookingSheet.tsx:133-137` | `BOOKING_EXACT_FLIGHT_FORM`, `BOOKING_RESERVAS_EMAIL` (ambas solo valen si `=== "true"`, `booking-bridge/index.ts:30-31`) | QUOTE (reconsulta) + DEEP LINK; CONFIRMATION solo con evidencia manual | `booking_intents` **0** filas, `booking_intent_events` 0. Sin consentimiento la UI abre el enlace directo (`BookingSheet.tsx:133`). `BOOKING_EXACT_FLIGHT_FORM` y `BOOKING_RESERVAS_EMAIL` **no están configurados** → BB-08 y Reservas por correo desde el bridge apagados | **NC** |
| **Reservas IA** (restaurantes por correo) | `ai-reservations`, `reservations-inbound`, `ai-reservations-cron`, `_shared/ai-reservations/service.ts:175` | `app_flags.ai_reservations_enabled`; `AI_RESERVATIONS_FROM_ADDRESS`, `AI_RESERVATIONS_LINK_SECRET`, `AI_RESERVATIONS_REPLY_DOMAIN`, `RESEND_INBOUND_SECRET`, `RESEND_RECEIVING_API_KEY` | Solicitud por correo; CONFIRMATION por respuesta verificada | `app_flags.ai_reservations_enabled = false`; `ai_reservations` 0; `ai-reservations-cron` **no** está en `cron.job`; **no están configurados** `RESEND_INBOUND_SECRET`, `RESEND_RECEIVING_API_KEY`, `AI_RESERVATIONS_FROM_ADDRESS`, `AI_RESERVATIONS_LINK_SECRET`, `AI_RESERVATIONS_REPLY_DOMAIN` | **NC** |
| **Privé Desk · solicitud** | `concierge-action/index.ts:17,177` (correo a `FIXER_EMAIL`, por omisión hola@traveliatos.life), RPC `prive_request_create`; `PriveRequestsPage.tsx` | `FIXER_EMAIL`, `FIXER_FROM_ADDRESS` | Solicitud humana | `concierge_requests` tipo `prive_request`: 1 (2026-10-22, cancelado); tipo `reservation` `solicitado` 23-oct. No hay registro del correo a operaciones (`fixer_escalations` solo `whatsapp_abierto` 6, junio) | **F** (creación de solicitud) |
| **Privé Desk · bandeja del equipo** | `admin_prive_requests()` / `prive_request_transition` solo aparecen en `src/integrations/supabase/types.ts`; ninguna pantalla | — | — | — | **NE** |
| **The Privé Key** | `concierge-chat/priveKeyMode.ts` (planner determinista, sin modelo), `_shared/priveKey.ts`, `priveKeyPlaces.ts`, `privePlanner.ts`; `PriveKeyPage.tsx` | — (sin proveedor externo) | DISCOVERY sobre catálogo propio | `prive_key_events` 86 (world_ready_shown 47, key_open 17, wish_submitted 9, proposals_shown 3; última 2026-10-28 16:20). `prive_key_plans` 0 | **F** |
| **Travel DNA** (`evolucionar-dna`) | `evolucionar-dna/index.ts:14,182-226` (modelo `google/gemini-flash-latest` vía `_shared/ai.ts`) | `LOVABLE_API_KEY`, `GEMINI_API_KEY`, `MASTER_PROMPT_IATOS` | Perfil | No registra en `ai_usage_log`. `ai_user_preferences.dna_version` hasta 11; 12 usuarios con `dna_updated_at` en 30 d; `travel_profiles.perfil_ia` actualizado 2026-10-28 04:42 (solo lo escribe esta función) | **F** |
| **Personalización** (tasteProfile, señales) | `_shared/tasteProfile.ts`, `tasteProfileStore.ts`, `concierge-chat/index.ts:137`, `aprender-diario`, `tag-moment`, `update-food-dna` | — | Memoria | `user_taste_profiles` 10 (última 2026-10-28 16:50); `behavioral_insights` 212; `journal_learnings` 0; `travel_moments` 0 | **F** |
| **Equipaje Invisible** (atajo de Iato) | `src/lib/conciergeChips.ts:62-63`; `concierge-chat/planner.ts:60,484-485`; `prompt.ts:103` → `fixer_request` tipo `luggage` (cotización humana) | — | Ninguna con proveedor ("no hay proveedor conectado (sin precios ni disponibilidad)", `planner.ts:484`) | — | **NE** (proveedor) |
| **Radical Storage** (guarda-equipaje) | — (0 coincidencias) | — | — | — | **NE** |
| **Google Calendar** | Sin API/OAuth. Exportación `.ics`: `concierge-chat/actions.ts:15-22,354` + `src/components/concierge/ActionCard.tsx:23`; `.ics` y enlace `calendar.google.com/calendar/render` en Reservas IA (`_shared/ai-reservations/templates.ts:163,179`; `src/lib/aiReservations.ts:71`) | — | Archivo / enlace | — | **SE** |

## 7. Afiliados, traslados, autos, trenes y autobuses

| Proveedor | Código | Capacidad | Evidencia | Clasificación |
|---|---|---|---|---|
| GetTransfer | — | — | — | **NE** |
| WeGoTrip | — | — | — | **NE** |
| Airalo | `src/lib/affiliateLinks.ts:302-312` (`withMarker`), `src/pages/TripESIM.tsx`, `boveda/PartnerOffers.tsx` | DEEP LINK + marker | — | **SE** |
| Klook | — | — | — | **NE** |
| Tiqets | — | — | — | **NE** |
| Go City | — | — | — | **NE** |
| KKday | — | — | — | **NE** |
| Kiwitaxi | — | — | — | **NE** |
| Welcome Pickups | `src/lib/affiliateLinks.ts:38,55-70` (`aff_track_id` de Travelpayouts; la página no recibe datos del traslado); `ActionButton.tsx`, `ConciergeCards.tsx` | DEEP LINK | `affiliate_clicks`: 1 clic (2026-06-10) | **SE** |
| intui.travel | Solo aparece dentro de la Public Suffix List (`_shared/booking/psl_data.ts:16`), no como proveedor | — | — | **NE** |
| Localrent | — | — | — | **NE** |
| GetRentacar | — | — | — | **NE** |
| Economybookings | — | — | — | **NE** |
| QEEQ | — | — | — | **NE** |
| AutoEurope | — | — | — | **NE** |
| BikesBooking | — | — | — | **NE** |
| Kiwi.com | Solo un comentario (`src/lib/externalLinks.ts:6`: se niega a cargar) | — | — | **NE** |
| AirHelp | — | — | — | **NE** |
| Compensair | — | — | — | **NE** |
| 12Go | `_shared/booking/groundLinks.ts:245-249,327-330` (ruta+fecha+pasajeros, sin afiliado); `src/lib/groundCardLinks.ts`, `pages/Trenes.tsx` | DEEP LINK | — | **SE** |
| Omio | `src/lib/affiliateLinks.ts:239-240` (portada `omio.com/?marker=533299`, sin ruta) | DEEP LINK | — | **SE** |
| Trainline | `src/lib/affiliateLinks.ts:235-236` (portada `thetrainline.com/?marker=533299`, sin ruta) | DEEP LINK | — | **SE** |
| Busbud | — | — | — | **NE** |
| Distribusion | — | — | — | **NE** |
| Renfe | `_shared/booking/groundLinks.ts:112-124,314-318` (`venta.renfe.com/vol/buscarTren.do`); `railOperators.ts:41` | DEEP LINK precargado | — | **SE** |
| Deutsche Bahn | `groundLinks.ts:147-155,319-322` (`int.bahn.de`); `railOperators.ts:47` | DEEP LINK precargado | — | **SE** |
| FlixBus | `groundLinks.ts:228-233,333-341` (`shop.flixbus.com/search`); `railOperators.ts:58` | DEEP LINK | — | **SE** |
| ADO | `groundLinks.ts:266-270,336` (página de ruta, sin fecha); `railOperators.ts:59` | DEEP LINK | — | **SE** |

Todos los terrestres llevan la nota "El precio y la compra son en {sitio}; IATOS no lo cotiza" (`groundLinks.ts:345-347`). Lista blanca de dominios: `_shared/booking/allowlist.ts`.

## 8. Enlaces de afiliado y medición de clics

- **Cómo se añade el marker de Travelpayouts**: a mano, en URLs construidas por IATOS. No se usa ninguna API oficial de generación de enlaces (Partner Links): **no existe**.
  - Cliente: `TP_MARKER = "533299"` (`src/lib/affiliateLinks.ts:15`); `withMarker()` agrega `?marker=` (`:31-35`); `ensureAviasalesMarker()` (`:73-77`); `aviasalesLink` (`:81-86`), `hotellookLink` (`:89-97`), `getYourGuideLink` (`:178-181`), Trainline/Omio/Rail Europe/DiscoverCars/Rentalcars/Ferryhopper/DirectFerries/aFerry/Vacations To Go/CruiseDirect/Airalo/Holafly/Heymondo (`:235-350`).
  - `tpDeepLink()` ya **no envuelve** en `tp.media/click` y devuelve la URL tal cual (`:26-28`) porque ese redirect responde HTTP 400 "source_type is empty" desde 2026-10 (comentario `:17-24`; mismo motivo en `_shared/booking/links.ts:8-13` y `resolver.ts:136`).
  - Servidor: `TP_PUBLIC_MARKER = "533299"` y `resolveTpMarker(TRAVELPAYOUTS_MARKER)` (`_shared/tp-params.ts:4,11-14`); `aviasalesSearchUrl` (`_shared/booking/links.ts:79-86`), `getYourGuideSearchUrl` (`:284-289`), `aviasalesSearchLink` y el `link` de la Data API con marker (`_shared/travelpayouts.ts:43-44,90-93`).
  - Script **Travelpayouts Drive** (`https://tp-em.com/NTMzMjk5.js?t=533299`) se carga **solo tras aceptar cookies** (`src/lib/consent.ts:15-16,41-54`; `index.html:41`); es el que etiqueta enlaces salientes que reconoce.
  - Otros identificadores a mano: Viator `pid=P00327354, mcid=42383` (`affiliateLinks.ts:185-190`; la API ya trae `productUrl` con afiliado); Welcome Pickups `aff_track_id` (`:38`).
- **Dónde se registran los clics** (son clics, **no conversiones**; IATOS no recibe ninguna confirmación de comisión ni de compra):
  - `trackBookingClick()` (`src/lib/trackBooking.ts:71-74`) abre el enlace y llama a `logBookingClick()` (`:38-63`), que inserta en **`public.bookings`** con `status='pending'` (`:45`). Producción: Booking.com 6, Google Flights 5, GetYourGuide 2, serpapi 1, iatos_prive 1, Concierge 2 — **todas `pending`**, ninguna `confirmed`.
  - **`public.affiliate_clicks`** (`proveedor, accion, url_final, clicked_at`): insertan `src/components/concierge/ConciergeCards.tsx:175` y `src/components/ActionButton.tsx:94`. Producción: 2 filas (serpapi `concierge_flight` 2026-10-23; welcome_pickups 2026-06-10).
  - Panel: `src/pages/AdminMetrics.tsx:18,208` ("Clics de afiliado").
  - `booking_intents.redirect_count`/`redirected_at` (Booking Bridge) existirían para salidas firmadas: 0 filas.

## 9. Herramientas de Iato (`supabase/functions/concierge-chat/`)

Definición única: `toolDefs.ts:31-205` (11 herramientas). Ejecutor: `index.ts:73-79` (`TOOL_FUNCTIONS`) y `makeExecTool` `index.ts:681-735`; tiempos `index.ts:82-86`.

| # | Herramienta | Definición | Ejecuta | Proveedor real | Evidencia producción |
|---|---|---|---|---|---|
| 1 | `check_flight_status` | `toolDefs.ts:33` | Edge `flight-status` (`index.ts:78`) | SerpApi engine `google` (`_shared/flight-serpapi.ts:96`); respaldo Perplexity (`flight-status/index.ts:54`) | serpapi/flight-status 3 (22-oct) |
| 2 | `search_flights` | `toolDefs.ts:49` | Edge `flights-search` (`index.ts:74`) | SerpApi Google Flights; respaldo caché Travelpayouts `v1/prices/cheap` | serpapi/flights-search 26 |
| 3 | `search_hotels` | `toolDefs.ts:67` | Edge `hotels-search` (`index.ts:75`) | SerpApi Google Hotels + enlace Booking.com | serpapi/hotels-search 56 |
| 4 | `search_places` | `toolDefs.ts:82` | `searchPlaces()` → `places-search` (+`place-details` si `details`), respaldo `search_attractions` (`index.ts:710,742-773`) | Google Places (New) Text Search / Details | google_maps/places-search 1 |
| 5 | `search_nearby` | `toolDefs.ts:105` | Edge `places-nearby` (`index.ts:77`) | Google Places Nearby (gateway Lovable); SerpApi Maps | sin registro (†) |
| 6 | `web_search` | `toolDefs.ts:121` | `runWebSearch` (`index.ts:687-692`, `webSearch.ts`) | SerpApi Google web | serpapi google_web 3 (22-oct) |
| 7 | `search_events` | `toolDefs.ts:137` | `runEventSearch` (`index.ts:694-700`, `events.ts`) | Ticketmaster Discovery v2, luego SerpApi Google Events | ticketmaster/concierge-chat 9; google_events 0 |
| 8 | `search_tours` | `toolDefs.ts:154` | `runViatorSearch` (`index.ts:702-708`) | Viator Partner API v2 | `serp_cache.viator_products` 31 (compartida con viator-search/experiencias-top) |
| 9 | `search_attractions` | `toolDefs.ts:171` | Edge `tripadvisor-search` (`index.ts:76`) | Tripadvisor Terra → Google Places → SerpApi Maps | solo respaldos (google_maps 68, serpapi 9); Terra 0 |
| 10 | `search_members_venues` | `toolDefs.ts:185` | RPC `members_venues` (`index.ts:711-731`) | Base propia (curaduría Privé) | `nightlife_premium` 194 filas |
| 11 | `search_prive` | `toolDefs.ts:198-202` / `prive.ts:19-22` | `runSearchPrive` → RPC `prive_search` (`index.ts:684-686`, `prive.ts:163,221`) | Catálogo Privé propio | — |

Contexto automático (no es herramienta del modelo): eventos Ticketmaster para el contexto (`index.ts:281`). El clima de Iato viene del navegador (MET Norway, `src/pages/Concierge.tsx`).

**Acciones propuestas por Iato** (el usuario confirma; no reservan ni compran): `actions.ts:15-17` → `create_trip`, `add_itinerary_item`, `add_expense`, `add_packing_items`, `create_price_alert`, `track_flight`, `save_place`, `update_trip_hotel`, `fixer_request` (tipos `reservation|transport|rebooking|luggage|other`, `:25`), `prive_request`, `export_calendar` (.ics, cliente), `open_emergency` (cliente). Ejecutor: `actionExec.ts:54-136`.

## 10. Secretos que espera el código (solo nombres)

Proveedores: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `LOVABLE_API_KEY`, `PERPLEXITY_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_DIRECT`, `SERPAPI_PRIVATE_KEY`, `SERPAPI_DAILY_BUDGET`, `SERPAPI_MONTHLY_BUDGET`, `TRAVELPAYOUTS_TOKEN`, `TRAVELPAYOUTS_MARKER`, `TICKETMASTER_API_KEY`, `VIATOR_API_KEY`, `VIATOR_API_KEY_SANDBOX`, `TRIPADVISOR_API_KEY`, `TRIPADVISOR_SEARCH_SIZE`, `TRIPADVISOR_PHOTOS_SIZE`, `TRIPADVISOR_DAILY_ENTITIES`, `TRIPADVISOR_USER_DAILY_CALLS`, `PEXELS_API_KEY`, `RESEND_API_KEY`, `RESEND_INBOUND_SECRET`, `RESEND_RECEIVING_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SENTRY_DSN`, `POSTHOG_API_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`.
Operación / correo / banderas: `CRON_SECRET`, `SITE_URL`, `SUPPORT_EMAIL`, `HEALTH_ALERT_EMAIL`, `ALERT_EMAILS_ENABLED`, `FIXER_EMAIL`, `FIXER_FROM_ADDRESS`, `PRIVE_REPLY_TO`, `PRIVE_IP_SALT`, `AI_RESERVATIONS_FROM_ADDRESS`, `AI_RESERVATIONS_LINK_SECRET`, `AI_RESERVATIONS_REPLY_DOMAIN`, `BOOKING_EXACT_FLIGHT_FORM`, `BOOKING_RESERVAS_EMAIL`, `BOOKING_LINKS_PER_RUN`, `FLIGHT_WATCH_MAX_CHECKS`, `MASTER_PROMPT_IATOS`, `WELCOME_HERO_QUERY`, `AVATAR_IMAGE_MODELS`, `AVATAR_DAILY_IMAGES`, `AVATAR_DAILY_EVOLUTION_IMAGES`, `MOMENT_TAG_USER_DAILY_CAP`, `MOMENT_TAG_GLOBAL_DAILY_CAP`.
Plataforma: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEYS`.

**Configurados en producción** (lista oficial de nombres, `SECRETOS_NOMBRES.md`, 28-oct 16:51 UTC; 23): `ANTHROPIC_API_KEY`, `CRON_SECRET`, `FIXER_EMAIL`, `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_BROWSER_KEY`, `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS`, `PEXELS_API_KEY`, `RESEND_API_KEY`, `SERPAPI_PRIVATE_KEY`, `STRIPE_PRICE_ID`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TICKETMASTER_API_KEY`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TOKEN`, `TRIPADVISOR_API_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`, `VIATOR_API_KEY`, `VIATOR_API_KEY_SANDBOX`. Conectores Lovable: Google Maps Platform, Resend.

**Leídos por el código y NO configurados** (con efecto):
- Bloquean una integración: `PERPLEXITY_API_KEY` (Perplexity apagado en analizar-viaje, buscar-promociones, nightlife-discover y respaldo de flight-status); `RESEND_INBOUND_SECRET`, `RESEND_RECEIVING_API_KEY`, `AI_RESERVATIONS_FROM_ADDRESS`, `AI_RESERVATIONS_LINK_SECRET`, `AI_RESERVATIONS_REPLY_DOMAIN` (Reservas IA); `BOOKING_EXACT_FLIGHT_FORM`, `BOOKING_RESERVAS_EMAIL` (banderas del bridge, apagadas); `POSTHOG_API_HOST`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` (paso PostHog del borrado de cuenta queda `pending_key`); `SENTRY_DSN` (sin reporte de errores).
- Usan valor por omisión: `ANTHROPIC_MODEL`, `GOOGLE_MAPS_DIRECT` (→ gateway Lovable), `SERPAPI_DAILY_BUDGET`, `SERPAPI_MONTHLY_BUDGET`, `TRIPADVISOR_SEARCH_SIZE`, `TRIPADVISOR_PHOTOS_SIZE`, `TRIPADVISOR_DAILY_ENTITIES`, `TRIPADVISOR_USER_DAILY_CALLS`, `SITE_URL` (→ https://traveliatos.life en prive-cron/prive-access; `undefined` en otros), `SUPPORT_EMAIL`, `HEALTH_ALERT_EMAIL` (→ correos de admins), `ALERT_EMAILS_ENABLED`, `FIXER_FROM_ADDRESS`, `PRIVE_REPLY_TO`, `PRIVE_IP_SALT` (→ se omite el límite por ip_hash, `prive-access/index.ts:31,56`), `BOOKING_LINKS_PER_RUN`, `FLIGHT_WATCH_MAX_CHECKS`, `WELCOME_HERO_QUERY`, `AVATAR_*`, `MOMENT_TAG_*`, `SUPABASE_SECRET_KEYS`.
- Configurados y sin evidencia de uso: `VAPID_*` (`push_subscriptions` 0).

## 11. Conteo

| Clasificación | Filas |
|---|---|
| EXISTE Y FUNCIONA | 24 (3 con †: Places Nearby, SerpApi Google Events, MET Norway) |
| EXISTE PERO NO ESTÁ CONFIGURADA | 5 (Perplexity, Resend Receiving, Stripe, Booking Bridge intenciones/salida, Reservas IA) |
| EXISTE PERO FALLA | 2 (Gemini directo, Tripadvisor Terra) |
| NO EXISTE Y DEBE DESARROLLARSE | 30 |
| SOLO ENLACE | 14 |
| **Total** | **75** (Route Matrix/Time Zone no se cuentan) |

---

## Apéndice · Edge Functions (`supabase/functions/`, 76 + `_shared`)

"Uso" = filas en `ai_usage_log` por `function` (22–28 oct) u otra evidencia en BD. Los secretos son los que la función lee directamente; las que importan `_shared/ai.ts` leen además `GEMINI_API_KEY`/`LOVABLE_API_KEY`, y las de correo `RESEND_API_KEY`/`LOVABLE_API_KEY` (`_shared/email.ts`).

| Función | Propósito | Proveedor(es) | Secretos directos | Evidencia en BD |
|---|---|---|---|---|
| account-deletion-retry | Reintenta borrados de cuenta pendientes (cron) | PostHog/Stripe vía `_shared/account-deletion*` | `CRON_SECRET` (cron-auth) | cron horario activo; `deletion_requests` 0 |
| ai-reservations | API de Reservas IA (crear, confirmar envío, alternativas, cancelar, estado) | Resend, Claude | (vía `_shared/ai-reservations`) | `ai_reservations` 0; bandera apagada |
| ai-reservations-cron | Recordatorio único y vencimientos de Reservas IA | Resend | `CRON_SECRET` | no programada en `cron.job` |
| ai-tool | Puente genérico de IA (texto/JSON) | Lovable AI / Gemini | `LOVABLE_API_KEY` | sin evidencia |
| analizar-preferencias-ruta | Texto libre → preferencias de ruta multidestino | Lovable AI / Gemini | `LOVABLE_API_KEY` | sin evidencia |
| analizar-viaje | Análisis premium del viaje (vuelos, hotel, presupuesto, itinerario) | Claude, Perplexity, Travelpayouts, SerpApi, Google Places/Routes, Frankfurter, Pexels | `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS`, `PERPLEXITY_API_KEY`, `TRAVELPAYOUTS_MARKER` | anthropic 25, google_maps 31, pexels 2; `trip_quotes` 23 |
| aprender-diario | Extrae gustos/disgustos de entradas del diario | Gemini / Lovable AI | `GEMINI_API_KEY`, `LOVABLE_API_KEY` | `journal_learnings` 0 |
| auditar-perfil | Audita la descripción libre del perfil | Lovable AI / Gemini | `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS` | sin evidencia |
| avatar-evolve | Agrega detalles del destino al avatar por viaje | Lovable AI (imagen) | `LOVABLE_API_KEY` | lovable 4 (23-oct) |
| booking-bridge | API del Booking Bridge (ofertas, resolve, start_booking, recheck_price, etc.) | SerpApi, Resend | `BOOKING_EXACT_FLIGHT_FORM`, `BOOKING_RESERVAS_EMAIL`, `FIXER_EMAIL`, `FIXER_FROM_ADDRESS`, `SERPAPI_PRIVATE_KEY` | `booking_intents` 0 |
| booking-go | Salida al proveedor con token firmado | — | — | sin evidencia (0 intents) |
| booking-links-cron | Vence intenciones y revisa enlaces del bridge | HTTP a sitios | `BOOKING_LINKS_PER_RUN`, `CRON_SECRET` | `booking_link_checks` 1,127 (última 24-oct) |
| buscar-promociones | Promociones reales según la Bóveda de beneficios | Perplexity, Claude, Gemini | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `LOVABLE_API_KEY`, `PERPLEXITY_API_KEY` | sin evidencia |
| buscar-video | Video de destino con caché | Pexels | `PEXELS_API_KEY` | pexels 285 |
| card-benefits-lookup | Beneficios de una tarjeta bancaria a partir de su nombre | Lovable AI / Gemini | `LOVABLE_API_KEY` | sin evidencia |
| concierge-action | Ejecuta acciones confirmadas de Iato y solicitudes al Fixer/Privé | Resend | `FIXER_EMAIL`, `FIXER_FROM_ADDRESS`, `SITE_URL` | `concierge_requests` 7 |
| concierge-chat | Iato (Concierge 2.0): streaming, herramientas, memoria | Claude, Lovable AI/Gemini, SerpApi, Ticketmaster, Viator, Google (vía funciones) | `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS`, `SERPAPI_PRIVATE_KEY` | anthropic 81, lovable 15, gemini 9, ticketmaster 9, serpapi 3 |
| delete-account | Solicitud de borrado de la propia cuenta | Resend | `SITE_URL` | `deletion_requests` 0 |
| editar-viaje-ai | Reescribe el viaje según instrucciones en lenguaje natural | Lovable AI / Gemini, Frankfurter | `LOVABLE_API_KEY` | sin evidencia |
| edition-link-check | Admin: comprueba enlaces de fuentes de la revista Privé | HTTP | — | sin evidencia |
| email-bienvenida | Correo de bienvenida al usuario | Resend, Pexels | `SITE_URL`, `WELCOME_HERO_QUERY` | pexels 1 (22-oct) |
| enviar-email-fixer | Correo al Fixer humano | Resend | `FIXER_EMAIL`, `FIXER_FROM_ADDRESS`, `RESEND_API_KEY` | sin evidencia (`fixer_escalations` sin `email_enviado`) |
| enviar-seleccion | Envía por correo la selección del viaje | Resend | `SITE_URL` | sin evidencia |
| evaluar-logros | Medallas y misiones (conteo SQL) | — | — | sin evidencia |
| evolucionar-dna | Travel DNA evolutivo | Gemini / Lovable AI | `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS` | `dna_version` hasta 11; `travel_profiles.perfil_ia` 28-oct |
| experiencias-top | "Lo TOP de {ciudad}" en Experiencias | Viator, Ticketmaster, Google Places | — | google_maps 8, ticketmaster 3; caché viator |
| ferry-search | Ferris en vivo | Ferryhopper MCP | — | ferryhopper 1 (24-oct) |
| flight-status | Estado de vuelo | SerpApi (google), Perplexity (respaldo) | `PERPLEXITY_API_KEY`, `SERPAPI_PRIVATE_KEY` | serpapi 3 |
| flight-watch-cron | Rastrea vuelos y avisa cambios | SerpApi, push, Resend | `FLIGHT_WATCH_MAX_CHECKS`, `SERPAPI_PRIVATE_KEY`, `SITE_URL` | cron cada 15 min; `tracked_flights` 0 |
| flights-search | Vuelos reales | SerpApi Google Flights, Travelpayouts | `LOVABLE_API_KEY`, `SERPAPI_PRIVATE_KEY`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TOKEN` | serpapi 26 |
| generar-packing-list | Lista de equipaje premium | Lovable AI / Gemini | `LOVABLE_API_KEY` | `packing_lists` 1 (22-oct) |
| generate-avatar | Travel Avatar | Lovable AI (imagen), Gemini, Resend | `HEALTH_ALERT_EMAIL`, `LOVABLE_API_KEY`, `RESEND_API_KEY` | lovable 11, gemini 1 |
| geocode | Geocoding dirección ↔ coordenadas | Google Geocoding (gateway) | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` | no registra uso |
| geocode-address | Dirección/lugar → coordenadas con Text Search | Google Places (gateway) | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` | no registra uso |
| get-routes | Routes API: 4 modos y casetas | Google Routes/Tolls | — | google_maps 2 |
| health-check | Chequeo diario + sondas bajo demanda | Claude, Gemini, Lovable, SerpApi, Travelpayouts, Stripe, Google, Ticketmaster, Tripadvisor, Resend | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `GEMINI_API_KEY`, `HEALTH_ALERT_EMAIL`, `LOVABLE_API_KEY`, `SERPAPI_PRIVATE_KEY`, `STRIPE_PRICE_ID`, `STRIPE_SECRET_KEY`, `TICKETMASTER_API_KEY`, `TRAVELPAYOUTS_TOKEN`, `TRIPADVISOR_API_KEY` | `health_checks` 10 |
| hotels-search | Hoteles reales + enlace Booking | SerpApi Google Hotels | `SERPAPI_PRIVATE_KEY`, `TRAVELPAYOUTS_MARKER` | serpapi 56 |
| interpretar-viaje | Texto libre → estructura completa del viaje | Claude (Haiku → Sonnet), Gemini | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `LOVABLE_API_KEY` | anthropic 9 |
| logistics-plan | Logística multidestino con precios | Lovable AI/Gemini, Google Places/Geocoding/Routes | `LOVABLE_API_KEY` | google_maps 12 |
| mark-visited | Marca lugar visitado y recalcula food DNA | Google Places (gateway) | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` | `visited_places` (no consultado) |
| nearby-places | Places Nearby Search (versión vieja) | Google Places (gateway) | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` | no registra uso |
| nightlife-discover | Vida nocturna | Perplexity, Claude, Gemini | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS`, `PERPLEXITY_API_KEY` | sin evidencia |
| parse-trip-file | Lee PDFs/imágenes del viaje | Gemini multimodal / Lovable AI | `LOVABLE_API_KEY` | `trip_documents` 0 |
| parsear-viaje | Prompt natural → viaje estructurado | Lovable AI / Gemini | `LOVABLE_API_KEY`, `MASTER_PROMPT_IATOS` | sin evidencia |
| pexels-image | Foto de destino con caché | Pexels | `PEXELS_API_KEY` | pexels 424 |
| place-details | Places Details | Google Places (gateway) | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` | no registra uso |
| place-photo | Proxy de fotos de Places | Google Places Photos | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY` | google_maps 538 |
| place-resolve | "Francia → París · Lyon": qué es cada destino | Google Geocoding, Wikidata | — | google_maps 9; caché wikidata 4 |
| places-nearby | Nearby Search (Iato `search_nearby`) | Google Places, SerpApi Maps | `GOOGLE_MAPS_API_KEY`, `LOVABLE_API_KEY`, `SERPAPI_PRIVATE_KEY` | no registra uso |
| places-search | Text Search (Iato `search_places`) | Google Places | — | google_maps 1 |
| price-watch | Iniciar/detener alerta de precio | Travelpayouts, SerpApi | `SERPAPI_PRIVATE_KEY`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TOKEN` | `price_watches` 0 |
| price-watch-cron | Re-cotiza alertas y avisa bajadas | Travelpayouts, SerpApi, push, Resend | `SERPAPI_PRIVATE_KEY`, `SITE_URL`, `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TOKEN` | cron 2×día; `price_watch_checks` 0 |
| prive-access | Acceso a Privé (estado, invitación, contraseña, sesiones) | Resend | `LOVABLE_API_KEY`, `PRIVE_IP_SALT`, `PRIVE_REPLY_TO`, `RESEND_API_KEY`, `SITE_URL`, `SUPPORT_EMAIL` | sin consulta específica |
| prive-cron | Elegibilidad Privé, invitaciones, barrido de sesiones | Resend, Stripe | `LOVABLE_API_KEY`, `PRIVE_REPLY_TO`, `RESEND_API_KEY`, `SITE_URL`, `STRIPE_SECRET_KEY`, `SUPPORT_EMAIL` | `prive_invitations` 16 `sent` |
| prive-tenure-backfill | Respaldo único de antigüedad pagada | Stripe | `STRIPE_SECRET_KEY` | sin evidencia |
| push-subscribe | Guarda suscripción Web Push / devuelve VAPID pública | Web Push | `VAPID_PUBLIC_KEY` | `push_subscriptions` 0 |
| recomendar-destinos | Destinos según el ADN de viaje | Lovable AI / Gemini | `LOVABLE_API_KEY` | `recomendaciones` destination_ai 122 (28-oct) |
| reservations-inbound | Webhook Resend Receiving de respuestas de restaurantes | Resend Receiving, Claude | (vía `_shared/ai-reservations`) | `ai_reservation_inbound` 0 |
| resolver-fechas | Resolución inteligente de fechas | Lovable AI / Gemini | `LOVABLE_API_KEY` | sin evidencia |
| scan-receipt | Lee foto de ticket | Gemini visión / Lovable AI | `GEMINI_API_KEY`, `LOVABLE_API_KEY` | `expenses` 1 |
| send-email | Correo de invitación a un viaje (plantilla fija) | Resend | `SITE_URL` | sin evidencia |
| serpapi-quote | Motor de cotización | SerpApi, Lovable AI, Frankfurter | `LOVABLE_API_KEY`, `SERPAPI_PRIVATE_KEY` | sin filas propias |
| share-trip-notify | Aviso en campana al compartir viaje | — | — | sin evidencia |
| stripe-checkout | Checkout Session de PRO | Stripe | `STRIPE_PRICE_ID`, `STRIPE_SECRET_KEY` | 1 suscripción `trialing` con id Stripe |
| stripe-portal | Billing Portal | Stripe | `STRIPE_SECRET_KEY` | sin evidencia |
| stripe-webhook | Webhook firmado de Stripe | Stripe, Resend | `HEALTH_ALERT_EMAIL`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `stripe_payment_events` 0 |
| suggest-packing | Sugerencias de equipaje | Lovable AI / Gemini | `LOVABLE_API_KEY` | sin evidencia |
| suggest-restaurants | Restaurantes reales por ciudad | Google Places | — | google_maps 1 |
| tag-moment | Etiquetas de visión de fotos y perfil de gustos | Gemini / Lovable AI | `GEMINI_API_KEY`, `LOVABLE_API_KEY`, `MOMENT_TAG_*_DAILY_CAP` | `travel_moments` 0 |
| track-flight | Activa/desactiva rastreo de vuelo | — | — | `tracked_flights` 0 |
| transcribir-nota | Nota de voz → texto | Gemini / Lovable AI | `GEMINI_API_KEY`, `LOVABLE_API_KEY` | sin evidencia |
| travelpayouts-flights | Precios Aviasales `prices_for_dates` + autocomplete | Travelpayouts | `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TOKEN` | no registra uso |
| trip-files-purge | Borra archivos de viajes borrados | Supabase Storage | `CRON_SECRET` | no programada en `cron.job` |
| tripadvisor-search | Lugares con rating: Terra → Google Places → SerpApi Maps | Tripadvisor Terra, Google Places, SerpApi | `SERPAPI_PRIVATE_KEY`, `TRIPADVISOR_API_KEY` | google_maps 68, serpapi 9, tripadvisor 0 |
| update-food-dna | Recalcula `profiles.food_dna` | — | — | sin evidencia |
| viator-search | Tours reales de Viator | Viator Partner API v2, Frankfurter | (vía `viatorConfig`: `VIATOR_API_KEY`/`_SANDBOX`) | caché viator 31 |
