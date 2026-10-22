# IATOS Booking Bridge: auditoría, diseño, API y evidencia

**Para quién:** el dueño y los equipos que integran (googlemax, reservas, concierge2, emails, godtier).
**Fecha:** 22 de octubre de 2026. **Rama:** `claude/wc-bridge`. **Nada está desplegado**: el despliegue lo decide el líder.
**Resumen de decisión:** [`IATOS_BOOKING_BRIDGE_GO_NO_GO.md`](./IATOS_BOOKING_BRIDGE_GO_NO_GO.md). **Matriz comercial:** [`IATOS_BOOKING_BRIDGE_PROVEEDORES.md`](./IATOS_BOOKING_BRIDGE_PROVEEDORES.md).

La idea en una frase: **IATOS no compra, no cobra y no confirma nada por su cuenta.** Lleva al usuario al proveedor correcto con la mayor precisión que el proveedor permite, le dice antes de salir qué se conserva y qué no, guarda (con su permiso) qué eligió, y separa siempre lo que el usuario **declara** de lo que el proveedor **confirma**.

---

## 1. Auditoría de las fuentes que ya existen (Fase 1 y complemento, punto 1)

Revisado en el código de esta rama. "Reservar" = qué se podía hacer realmente con el resultado.

| Fuente (función) | Proveedor real | Contrato / permiso | Id. del resultado | Precio y moneda | Fecha de consulta | Disponibilidad | URL que devuelve | ¿Permite reservar? |
|---|---|---|---|---|---|---|---|---|
| `flights-search` | Google Flights vía **SerpApi** | Suscripción de SerpApi (API de búsqueda, no de venta) | `booking_token` (se conservaba, sin uso) | `price` total USD de los pasajeros buscados | `consulted_at`; caché 6 h | No (precio de búsqueda) | `search_metadata.google_flights_url` (búsqueda exacta de la ruta) y `buy_url` = búsqueda de Aviasales | **No.** SerpApi expone "Booking Options" (`booking_request` = POST a google.com/travel/clk/f), no una compra. |
| `flights-search` (respaldo), `travelpayouts-flights`, `analizar-viaje` | **Travelpayouts / Aviasales** (caché de búsquedas de usuarios, hasta 48 h) | Programa de afiliados (marker 533299) | ninguno estable | `price` por persona USD | `consulted_at` | No | `link` = `/search/…?t=…` → **resultados de búsqueda** en Aviasales (lo dice la doc oficial) | No. Solo búsqueda. |
| `hotels-search`, `serpapi-quote` | Google Hotels vía **SerpApi** | Suscripción de SerpApi | `property_token` (no se guardaba) | `rate_per_night`/`total_rate` USD | `consulted_at`; caché 12 h | No | `link` (sitio del hotel cuando viene) y `booking_url` = búsqueda de Booking.com **envuelta en tp.media (responde 400, §6)** | No. "Property Details" da precios por OTA con enlace de Google (`google.com/aclk`). |
| `analizar-viaje` / `logistics-plan` / `editar-viaje-ai` | Modelo de IA que copia datos de las fuentes anteriores | — | ninguno | `precio_por_persona`/`precio_por_noche` MXN con `fuente_precio` y `estado_dato` | `consultado_at` o fecha del viaje | No | `booking_link`/`cta_action` **escritos por la IA** (no confiables) | No. |
| `tripadvisor-search` | TripAdvisor Content API **si hay llave**; si no, Google Maps vía SerpApi | El dueño dice que **no hay contrato** con TripAdvisor: la llave no se asume | `location_id` / `place_id` | rango `$$` (no tarifa) | — | No | `web_url` (ficha informativa) | No. |
| `places-search`, `nearby-places`, `place-details` | **Google Places API (New)** | Llave de Google Maps Platform | `place_id` | `price_level` | — | No | `websiteUri`, `googleMapsUri`, `internationalPhoneNumber` | No; sí da el sitio y teléfono oficiales. |
| Catálogo **Privé** (`prive_experiences`, 1,260 filas; 1,214 con sitio oficial, 992 con `booking_url`) | Curaduría del equipo con fuentes https | Ninguno con los lugares (salvo acuerdos firmados del registro, hoy sin filas) | `slug` | `price_min/max` solo con fuente | `verified_at` | `availability_state` (casi siempre `no_consultada`) | `booking_url` público: OpenTable 44, Tock 27, Resy 14, SevenRooms 14, TableCheck 5, wa.me/api.whatsapp 13, sitios oficiales | **Abrir su página pública de reservas** sí; reservar en la app no. Solicitud Privé: `prive_request_create`. |
| `analizar-viaje/groundTransport.ts` | Omio (Travelpayouts) / Google Maps | Afiliado | — | rango **estimado** | — | No | búsqueda de Omio envuelta en tp.media (**400**) | No. |
| `get-routes` | Google Routes API | Llave de Google | — | — | — | — | — | No (rutas). |
| `concierge-action` | Equipo IATOS (correo a Fixer) | — | `concierge_requests.id` | — | — | — | — | Solicitud asistida, nunca reserva. |
| Eventos | — | — | — | — | — | — | — | **No hay fuente de eventos.** |

**Lo que estaba mal antes de este cambio (y se corrigió en las pantallas del bridge):**
- "Reservar" / "Reservar vuelo" / "Reservar hotel" abrían **búsquedas**; "Reservar en GetYourGuide" abría una búsqueda por nombre; "Comprar en {aerolínea}" abría la portada de la aerolínea.
- Los enlaces de Booking.com, GetYourGuide, Viator, Omio, Skyscanner, Kayak, etc. construidos con `tp.media/click` **responden HTTP 400** (captura `evidencia/bridge/H0.jpg`): el usuario llegaba a una página de error.
- `google.com/travel/flights?q=…` abre el **formulario vacío** de Google Flights (captura `F8.jpg`): no es una búsqueda equivalente.
- Las URLs escritas por la IA (`booking_link`, `cta_action`) se abrían sin lista blanca y sin comprobar fechas.

---

## 2. Contrato de la oferta y mapeo al modelo actual (Fase 2)

No hay tabla nueva de ofertas: **las ofertas se calculan** a partir de lo que ya existe (adaptadores en `supabase/functions/_shared/booking/offers.ts`). Solo cuando el usuario continúa se guarda una **foto** en `booking_intents.offer`.

| Campo del dueño | Dónde vive | Origen |
|---|---|---|
| `offer_id` | `BookingOffer.offer_id`, `booking_intents.offer_id` | FNV-1a de tipo+fuente+producto+fechas+viajeros (`stableId`) |
| `provider` | `offer.provider`, `booking_intents.provider` | `google_flights`, `travelpayouts`, `google_hotels`, `prive_catalog`, `google_places`, `iatos_ai`… |
| `provider_offer_id` | `booking_token`, `property_token`, `slug`, `place_id` | de la fuente |
| `product_type` | `flight/hotel/restaurant/tour/experience/transport/event` | adaptador |
| `source_url` | `offer.source_url` | URL de la fuente (si existe) |
| `booking_url` | `offer.booking_url` y `booking_intents.target_url` (destino validado) | resolver |
| `booking_mode` | `offer.booking_mode`, `booking_intents.booking_mode` | resolver (§3) |
| `price`, `currency`, `taxes` | `offer.*`, `booking_intents.price/currency`; también `trip_quotes.line_items` | fuente; `taxes` solo con texto de la fuente |
| `price_checked_at`, `offer_expires_at` | `offer.*`, `booking_intents.*` | `consulted_at` + vigencia (6 h vuelos SerpApi, 12 h hoteles) |
| `availability_status` | `offer.availability_status` | `not_checked` salvo que "Comprobar precio" responda |
| `traveler_count`, `travel_dates` | `offer.*` | viaje o búsqueda |
| `booking_conditions` | `offer.booking_conditions` | `extensions` de la fuente; nunca inventadas |
| `trip_id` | `booking_intents.trip_id` | viaje (acceso verificado con `has_trip_access`) |
| `verification_status` | `source_verified` / `link_verified` / `unverified` / `estimated` | adaptador |

**Tablas que se reutilizan** (sin duplicar): `trips.*_json` y `trips.selections` (lo cotizado y lo elegido), `trip_quotes` (cotización), `bookings` (constancia de reserva **confirmada**; los clics siguen como `pending` igual que antes), `concierge_requests` + ciclo Privé (`20261023100300`) para solicitudes, `trip_documents` para comprobantes.

**Capa nueva mínima** (migración `20261023180000_booking_bridge.sql`): `booking_intents` (intención con estado), `booking_intent_events` (historial) y `booking_link_checks` (enlaces verificados con fecha, fuente y caducidad).

---

## 3. BookingActionResolver (complemento, punto 2)

`supabase/functions/_shared/booking/resolver.ts`. Mismas reglas en el cliente (pinta) y en el servidor (decide).

| Nivel | Acción | Modo | Botón (ejemplos) | Cuándo existe |
|---|---|---|---|---|
| 1 | Oferta exacta de la fuente, vigente | `EXACT_DEEP_LINK` | **Comprar esta oferta** / Reservar esta tarifa | Solo con enlace o `booking_request` de la fuente y dentro de su vigencia. Hoy **apagado** para vuelos (bandera `BOOKING_EXACT_FLIGHT_FORM`) porque no se pudo verificar en vivo. |
| 2 | Búsqueda equivalente documentada | `PROVIDER_SEARCH` | Buscar este vuelo · Ver tarifas del hotel · Buscar mesa · Buscar en GetYourGuide · Buscar boletos | Aviasales (IATA+fechas+adultos), Booking.com (nombre+fechas+huéspedes), búsqueda de Google Flights de SerpApi, OpenTable/GYG/Viator por nombre |
| 3 | Página oficial de reservas | `PROVIDER_SEARCH` | **Abrir reservas** | `booking_url` del catálogo (OpenTable/Tock/Resy/SevenRooms…) o hallado en el sitio oficial |
| 4 | Sitio oficial general | `UNAVAILABLE` (informativo) | Sitio oficial · Sitio de {aerolínea} | fuente confiable |
| 5 | WhatsApp / correo / SMS / llamada oficiales | `REQUEST` | Escribir por WhatsApp · Escribir al restaurante · **Llamar al restaurante** · Contactar al operador | solo con fuente verificada (catálogo o sitio oficial; un teléfono de Google habilita llamada, **no** WhatsApp) |
| 6 | Ficha de Google Maps | `UNAVAILABLE` | Ver en Google Maps | siempre que haya nombre; con `place_id` es la ficha exacta |
| 7 | Solicitud asistida / guardar | `REQUEST` | Solicitar asistencia · Guardar en el viaje | Privé: `prive_request_create`; otros: `concierge_requests` tipo `booking_assist` |
| aux | Comprobar precio | — | Comprobar precio | solo con `booking_token` (vuelo) o `property_token` (hotel) |

Reglas duras (todas con prueba): "Comprar esta oferta" solo en nivel 1; una búsqueda nunca se muestra como exacta; una oferta exacta vencida no se ofrece y pide comprobar precio; ningún canal sin fuente verificada; una URL de la IA fuera de la lista blanca se descarta con motivo; un enlace de búsqueda con **otras fechas o viajeros** que los del viaje se descarta y se arma el correcto; una página de OpenTable que **no nombra** al lugar (homónimo) se descarta.

---

## 4. Estados y seguimiento (Fase 8)

`SELECTED → PRICE_RECHECK_REQUIRED → READY_TO_BOOK → REDIRECTED_TO_PROVIDER → PENDING_CONFIRMATION → CONFIRMED`, más `REQUESTED`, `FAILED`, `CANCELLED`, `EXPIRED`. Tabla de transiciones idéntica en SQL (`booking_intent_transition_ok`) y TS (`states.ts`); una prueba compara ambas.

- `REDIRECTED_TO_PROVIDER` **nunca** pasa sola a `CONFIRMED`.
- `CONFIRMED` exige `confirmation_evidence` con fuente `provider_api` / `provider_webhook` / `team_verified` / `prive_request_confirmed` y folio (CHECK). Solo `booking_intent_confirm` (equipo o servidor) lo pone, y crea la constancia en `bookings`.
- Lo que el usuario declara ("Ya reservé", "Me confirmaron") queda en `PENDING_CONFIRMATION` con `verification = user_declared`: la app dice **"Reserva declarada por ti · sin verificar con {proveedor}"**.
- Sin datos de pago: CHECK en la base contra 16–19 dígitos y rechazo de números que pasan Luhn en el servidor.
- Una intención viva por usuario y oferta (índice único parcial) + llave de idempotencia por intento.
- Solicitudes ligadas: un trigger sobre `concierge_requests` mueve la intención (Privé `confirmado_externamente` → `CONFIRMED` con su evidencia; un "confirmed" genérico sin evidencia → `PENDING_CONFIRMATION`).

---

## 5. API (para concierge2 y el cliente)

Edge function **`booking-bridge`** (POST, JWT del usuario). Cuerpo `{ action, ...}`; respuesta `{ ok, code?, message? , ... }`.

| Acción | Entrada | Salida | Notas |
|---|---|---|---|
| `list_offers_for_trip` | `trip_id` | `offers[col][]` (resumen para Iato + `actions`), `intents` | Usa el catálogo Privé del servidor (máx. 40 búsquedas por llamada). |
| `resolve` | `source` (ver abajo), `draft?` | `offer` completa + `iato` (`say`) | Para que Iato hable de UNA opción concreta. |
| `start_booking` | `source`, `action_kind`, `idempotency_key`, `consent: true`, `draft?`, `ack_price_may_change?` | `intent`, `go_url` (salida firmada), `disclosures`, `preserves`, `channel`, `needs_price_ack` | Sin `consent` → `CONSENT_REQUIRED`. Canales y solicitudes → `REQUESTED`. |
| `confirm_price_ack` | `intent_id` | `intent`, `go_url` | "Entiendo, continuar" tras precio vencido. |
| `recheck_price` | `source` (`flight_result` con `booking_token` / `hotel_result` con `property_token`), `intent_id?`, `room?` | `recheck` {precio, cambio, disponibilidad, `room_match`} | Consulta EN VIVO (gasta de la bolsa del usuario; límite 3/min, 20/h). |
| `mark_returned` | `intent_id`, `outcome` (`completed`, `venue_confirmed`, `other_time`, `not_available`, `not_completed`, `still_waiting`) | `intent` | Nunca confirma. |
| `attach_user_proof` | `intent_id`, `confirmation_code?`, `note?`, `trip_document_id?`, `consent: true` | `intent` | Declarada por el usuario. |
| `status` | `intent_id?` o `trip_id?` | `intents` con `status_text` | |
| `cancel` | `intent_id` | `intent` | Una `CONFIRMED` responde `CANCEL_WITH_PROVIDER`. |

`source`: `{type:"trip_item", trip_id, col, index, name}` · `{type:"flight_result", result, meta}` · `{type:"hotel_result", result, meta}` · `{type:"venue", name, city?, country?, prive_slug?, product_type?}`. El servidor **reconstruye** la oferta; las URLs del cliente solo valen si pasan la lista blanca estricta.

Edge function **`booking-go`** (GET, `verify_jwt=false`): `?t=<token>`. Token HMAC-SHA256 (llave derivada de la service key, 30 min, atado a intención+usuario). Redirige (302, `Referrer-Policy: no-referrer`) **solo** al destino guardado si vuelve a pasar la lista blanca; si no, regresa a IATOS con `?salida=…`. HEAD no cuenta como salida.

Edge function **`booking-links-cron`** (`verify_jwt=false`, `CRON_SECRET`): vence intenciones viejas, registra los enlaces del catálogo en `booking_link_checks` y revisa los vencidos (robots.txt, 1 página, 1 MB, 1 host por corrida, 20 por corrida; 403/429 = bloqueado, no se insiste; detecta "soft 404" y redirecciones a otro dominio). **Falta programarla** (pg_cron, decisión del líder).

---

## 6. Seguridad (Fase 12)

- **Lista blanca de salida** (`allowlist.ts`): dominios de proveedores con rutas acotadas (google.com solo `/travel/flights`, `/travel/clk`, `/aclk`, `/travel/hotels`, `/maps`); https, sin credenciales, sin IP, puerto 443, sin caracteres de control. Las URLs de la IA o del cliente solo salen por la lista estricta; los sitios oficiales de fuentes del servidor (catálogo, Google Places) pasan si no imitan una marca (`booking.com.evil.io`, `opentable-mx.com`, punycode) y **un dominio de proveedor conocido nunca entra por la vía "confiable"** (cierra `google.com/url?q=` y `tp.media` con destino falso; hallado en la verificación real).
- **Sin open redirect:** booking-go no lee URLs de la petición; token firmado, caduca, atado al usuario; HEAD no cuenta.
- **Identidad y autorización:** JWT en booking-bridge; viaje leído con el JWT (RLS); `has_trip_access` en la base; RLS de lectura solo para el dueño; **ninguna** escritura desde el cliente; transiciones solo por funciones `SECURITY DEFINER` de `service_role` con guardia de trigger.
- **Idempotencia y duplicados:** llave por intento + una intención viva por oferta.
- **Webhooks:** no hay ningún webhook de proveedor (no hay contratos). El punto de entrada para uno futuro es `booking_intent_confirm` (service role) con evidencia; cada proveedor deberá verificar su firma antes de llamarla.
- **Sin llaves privadas en el cliente**; sin datos de tarjeta en ninguna tabla.

---

## 7. Integración con los otros grupos

| Grupo | Qué consume / entrega | Cómo |
|---|---|---|
| **googlemax** (Places, Routes, SerpApi Flights/Hotels) | Sus resultados entran a `offerFromFlightResult` / `flightResultFromSerp` (conserven `booking_token` y `search_metadata.google_flights_url`) y `offerFromHotelResult` (conserven `property_token` y `link`). Para lugares: `VenueInfo` con `source: "google_places"`, `place_id`, `websiteUri`, `internationalPhoneNumber`. | Ningún archivo de googlemax se tocó. Si su caché recorta `booking_options`/`featured_prices`, "Comprobar precio" ya usa `no_cache=true`. |
| **reservas** (Reservas IA v1, correo) | Mapeo de estados `reservasStatusToIntent` (TS) = `booking_reservas_status_to_intent` (SQL). Su servidor llama `booking_intent_apply_external(intent_id, 'reservas', status, evidence)`; "confirmed" sin `evidence.ref` queda `PENDING_CONFIRMATION`. Guardar su `ai_reservations.id` en `booking_intents.ai_reservation_id`. | Envío por el flujo de reservas detrás de la bandera `BOOKING_RESERVAS_EMAIL` (apagada). Estados supuestos documentados en `states.ts`; si usan otros, un estado desconocido queda pendiente (nunca confirmado). |
| **concierge2** (Iato) | `booking-bridge` `resolve` / `list_offers_for_trip` → `iato.say` con las frases del dueño; `findFalseClaims(texto)` para filtrar "ya compré tu vuelo", "tu mesa está confirmada", pedidos de tarjeta. `IATO_PHRASES` literales. | `_shared/booking/iato.ts`. No se tocó `Concierge.tsx` ni `concierge-chat`. |
| **emails** | Plantillas mínimas `assistedRequestTeamEmail`, `bookingFollowUpEmail` en `_shared/booking/emails.ts` (usan `layout`/`escapeHtml` de `_shared/email.ts`). | Pueden restilizarlas; el contenido honesto no cambia. |
| **godtier** (estilo de la página del viaje) | Componentes autocontenidos `src/components/booking/**`; en `TripDetail.tsx` solo se reemplazaron 4 botones y se agregó el panel "Seguimiento de reservas". | |

---

## 8. Evidencia de formatos de enlace (cada constructor cita su fuente)

| Id | Formato | Fuente (consultada el 2026-10-22) | Verificación abriendo el enlace |
|---|---|---|---|
| EV-AVIASALES-SEARCH | `https://www.aviasales.com/search/{ORIG}{DDMM}{DEST}{DDMM}{adultos}` | Travelpayouts, *Aviasales Data API* (actualizado 2026-09-06): ejemplo `"link": "/search/MAD2807BCN26081?..."` y "Add the code to the URL https://www.aviasales.com/ to open the search results" — https://support.travelpayouts.com/hc/en-us/articles/203956163 | F1–F7, F10, X3: la página muestra ruta, fechas y pasajeros |
| EV-AVIASALES-TP-LINK | `link` de la API (`/search/…?t=…`) | mismo artículo: abre **resultados de búsqueda** (no un boleto) | se trata como `PROVIDER_SEARCH` |
| EV-GFLIGHTS-SERP-URL | `search_metadata.google_flights_url` | campo que ya leía `flights-search`; nota de versión de SerpApi del 2024-02-29 sobre ese campo — https://serpapi.com/google-flights-api/release-notes | **No verificado en vivo** (sin llave de SerpApi en este entorno) |
| EV-GFLIGHTS-BOOKING-REQUEST | `booking_options[].together.booking_request {url: https://www.google.com/travel/clk/f, post_data}` | https://serpapi.com/google-flights-booking-options | **No verificado en vivo** → bandera apagada |
| EV-GHOTELS-PRICE-LINK | `featured_prices[].link`, `rooms[].link` (google.com/aclk), `official` | https://serpapi.com/google-hotels-property-details | **No verificado en vivo** |
| EV-BOOKING-SEARCH | `https://www.booking.com/searchresults.html?ss&checkin&checkout&group_adults&no_rooms` | observado (ya en uso en la app) | H1–H10, X5: la página muestra el hotel buscado, fechas y ocupación |
| EV-MAPS-URLS | `https://www.google.com/maps/search/?api=1&query=…&query_place_id=…` | Google Maps URLs (actualizado 2026-10-21) — https://developers.google.com/maps/documentation/urls/get-started | X2 |
| EV-WA-CLICK | `https://wa.me/<número internacional>?text=<url-encoded>` | WhatsApp Help Center "How to use click to chat" — https://faq.whatsapp.com/5913398998672934 | E10: abre el chat del operador con el mensaje prellenado |
| EV-RFC6068 / 3966 / 5724 | `mailto:`, `tel:`, `sms:` | RFC 6068, RFC 3966, RFC 5724 | pruebas de codificación |
| EV-PRIVE-CATALOG | `booking_url` curado | fila del catálogo con `sources` y `verified_at` | R1–R10, E1–E7 |
| EV-SITE-SCAN | enlaces públicos del sitio oficial | `siteScan.ts` + `booking-links-cron` | pruebas con HTML real de ejemplo |
| EV-TOURS-SEARCH | `getyourguide.com/s/?q=`, `viator.com/searchResults/all?text=` | ya en uso | E8–E9: **403** a navegador automático (no se evade) |
| ~~EV-GFLIGHTS-Q~~ | `google.com/travel/flights?q=…` | **descartado**: abre el formulario vacío | F8 |
| ~~tp.media/click~~ | redirect de afiliado | **responde 400** "source_type is empty" (también con `curl`) | H0 |

Investigación de mercado (no se usa en v1): ver la matriz comercial.

---

## 9. Qué se probó y cómo

- `src/test/bookingBridge.test.ts` (67): lista blanca, constructores, E.164 (16 casos en 9 países), WhatsApp/mailto/SMS/tel con acentos, emojis y saltos, mensajes en 6 idiomas, resolver, adaptadores, estados TS = SQL, token, recheck (con respuestas de la forma documentada por SerpApi), escaneo de sitio y robots.txt, Iato, correos.
- `src/test/bookingBridgeE2E.test.ts` (22): **los 20 recorridos de la Fase 11** con el handler real y proveedores simulados.
- `src/test/bookingActionsUi.test.tsx` (4) y `src/test/bookingLinkCheck.test.ts` (6).
- `supabase/tests/bridge/run.sh` (35 casos SQL sobre todas las migraciones).
- `scripts/booking/verify_links.mjs`: 47 páginas reales abiertas sin clics (resultado en `docs/iatos/evidencia/bridge/verify_links_2026-10-22.json` y capturas `*.jpg`).

## 10. Limitaciones conocidas

- Sin llave de SerpApi en este entorno: **no se probó en vivo** ni la búsqueda exacta de Google Flights, ni "Comprobar precio", ni los enlaces de precio de Google Hotels. Por eso la compra exacta de vuelos queda apagada.
- OpenTable, Tock (algunas páginas), GetYourGuide y Viator responden 403 a navegadores automáticos: el enlace se abre normal para una persona, pero **no** se pudo comprobar aquí que la página corresponda (no se evaden protecciones).
- Restaurantes: abrir su página pública de reservas **no** confirma disponibilidad; ningún parámetro de fecha/personas se agrega a OpenTable/Tock/Resy (no hay formato documentado).
- Booking.com por nombre puede mostrar varios hoteles (búsqueda); no lleva habitación ni tarifa.
- Vuelos del viaje sin enlace de la fuente: no se inventa una búsqueda (Aviasales exige IATA); se ofrece "Buscar vuelos reales en IATOS".
- No hay fuente de **eventos**.
