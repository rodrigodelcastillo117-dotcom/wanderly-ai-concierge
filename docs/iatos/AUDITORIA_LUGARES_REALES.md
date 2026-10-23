# IATOS: auditoría de lugares reales y enlaces de reserva

Rama `claude/auditoria-lugares-reales`, 23 de octubre de 2026.

Encargo del dueño: *"revisar que restaurantes, tours, todo de la app, Concierge, recomendadas por la app, Privé, todas sean reales y manden a donde reservar real."*

En esta pasada solo se **audita y mide**. Hay tres arreglos triviales de una a tres líneas (sección 6). No se desplegó nada. En producción solo se hicieron lecturas `SELECT`. El costo en Google y SerpApi fue de USD 0 (ver la sección 4.3).

## Vocabulario

| Clase | Qué quiere decir |
|---|---|
| **A** | El nombre y el enlace salen de un proveedor real con identificador: Google Places (`place_id`), SerpApi Google Hotels o TripAdvisor (`location_id`). |
| **B** | La IA escribe el nombre y el servidor lo valida después contra la lista del proveedor. No se guarda el identificador. |
| **C** | La IA escribe el nombre y nadie lo valida. |
| **D** | Curado a mano, con fuente (`sources`, `source_url`) y fecha (`verified_at`). |

| Tipo de enlace | Qué quiere decir |
|---|---|
| **Sitio oficial** | El website del propio lugar. |
| **Reserva real** | OpenTable, Resy, TheFork, Tock, SevenRooms, Zenchef, GetYourGuide o Viator, en la página del lugar o del producto. |
| **Búsqueda genérica** | Google Maps "search", Booking `searchresults`, OpenTable `/s?term=` o la búsqueda de GetYourGuide o Viator. |
| **Construido por la IA** | Una URL que escribió el modelo, sin ningún proveedor que la respalde. |

---

## 1. Resumen en números

| # | Hallazgo | Número |
|---|---|---|
| 1 | Lugares de los últimos 30 viajes (restaurantes, tours y hoteles) que vienen de un proveedor con identificador (A) | **112 de 594 (18.9 %)**. B: 79 (13.3 %). C: **403 (67.8 %)**. |
| 2 | Restaurantes de esos viajes con `place_id` | **15 de 220 (6.8 %)**. Los 15 son de análisis de un destino hechos el 23 de octubre: desde el arreglo de googlemax, los viajes de un destino salen 15 de 15 en A. |
| 3 | Restaurantes del multidestino (`logistics-plan`) | **142 de 142 son C**: los escribe la IA, nadie los valida y no llevan enlace. A todos se les pone el precio "$$" por omisión (`multiDestTrip.ts:105`). |
| 4 | Enlaces de restaurante escritos por la IA (sin fuente) comprobados | **12 de 36 están rotos o llevan a otra cosa (33 %)**. Por ejemplo, 4 dominios que no existen y el Lorenzo's del Ritz-Carlton Cancún. |
| 5 | Tours de los viajes | A: 19 (8.6 %). B: 79 (35.9 %). C: 122 (55.5 %). **Ninguno lleva enlace a un producto de GetYourGuide o Viator**: la app arma una búsqueda por nombre. |
| 6 | Hoteles de los viajes | A (SerpApi): 78 (50.6 %). C: 76 (49.4 %). **Todos los enlaces de hotel en A son una búsqueda de Booking por nombre**. No se guarda `property_token`. Hay 22 enlaces de hoteles estimados construidos por la IA, entre ellos 6 *slugs* de `booking.com/hotel/...` y un dominio que no existe. |
| 7 | Catálogo Privé (1,392 experiencias) | Se publican 1,097 (CURADO, clase D). Tienen website el 95.8 %, `booking_url` el 71.3 %, fuentes el 90.3 % y `verified_at` el 78.8 %. **`google_place_id` está vacío en los 1,392.** En la muestra de 58 enlaces curados no hubo ninguno roto (9 no se pudieron verificar). |
| 8 | Members Only (RPC `members_venues`) | **133 de 382 lugares (35 %) salen de `nightlife_premium`**, la tabla que escribió la IA en `nightlife-discover`. No tienen fuente ni verificación. En 70 de esos 133 el campo website no es una URL (p. ej. "Referenciado en guías premium"). **11 de 29 enlaces comprobados están rotos o equivocados (38 %).** |

Otros datos:

- Las tarjetas de Iato **no se guardan**. `concierge_conversations.messages` solo guarda `role`, `content` y `timestamp`; ningún mensaje trae `cards`. La muestra (c) no se puede medir con datos (ver la sección 3.4).
- Favoritos (`recomendaciones`) solo guarda destinos: 97 de tipo `destination_ai` y 1 de tipo `destination`. No hay ningún restaurante ni tour.
- Drops (9), Insider (20) y la revista (14 artículos publicados) son clase D, con fuente y fecha. Sus enlaces no tienen ninguno roto (13 comprobados).

---

## 2. Mapa de orígenes (código)

### 2.1 Viaje de un destino (`analizar-viaje`)

| Elemento | Origen del nombre | Origen del enlace | Clase | Archivo |
|---|---|---|---|---|
| Restaurantes, con Google disponible | `restaurantsForCity` (Places Text Search) da la lista; la IA solo elige de ella. `enforceRestaurants` quita lo que no esté en la lista y completa hasta 5. | `restaurantFromPlace`: `cta_action = website ?? maps_url` (sitio oficial o ficha de Maps) | **A** | `_shared/google-restaurants.ts:112`, `_shared/google-places.ts:460` |
| Restaurantes, sin Google | Perplexity y la IA, marcados `verificado: false` | Se conserva el `cta_action` de la IA (regla 16 del prompt: "sitio oficial si lo conoces", la home de TheFork u OpenTable, o una búsqueda de Maps) | **C** | `analizar-viaje/index.ts:210`, `google-restaurants.ts:118` |
| Tours | La IA elige de la lista de `tripadvisor-search` (TripAdvisor, luego Places, luego SerpApi Maps). `enforceSources` valida el nombre; si coincide, pone la calificación, el `place_id` y el `maps_url` del servidor. | Solo `maps_url` (ficha). En "Comprar", `offerFromTripTour` arma una **búsqueda** de GetYourGuide o Viator. | A si trae `place_id`; B si vino de TripAdvisor o SerpApi sin id; C si es `estimado` o `perplexity` | `analizar-viaje/sources.ts:76`, `_shared/booking/offers.ts:699` |
| Hoteles | Lista de SerpApi Google Hotels; `enforceSources` valida el nombre y el precio (±5 %) | `booking_url` = **búsqueda de Booking** `searchresults?ss=<hotel ciudad>` | A (sin id guardado) | `hotels-search/search.ts:20` |
| Hoteles estimados | La IA o Perplexity | Hasta hoy se conservaba el `booking_link` de la IA. **Arreglado** (sección 6). | C | `analizar-viaje/sources.ts:110` |
| Itinerario por día | Texto libre de la IA (`mañana`, `tarde`, `noche`) | Ninguno | C | `analizar-viaje/index.ts:305` |
| Cruceros | La IA ("naviera real") | Ninguno | C | `analizar-viaje/index.ts:355` |

### 2.2 Multidestino (`logistics-plan` y luego `multiDestTrip.ts`)

| Elemento | Nombre | Enlace | Clase |
|---|---|---|---|
| Restaurantes por ciudad | **Solo la IA** ("4-5 reales"). No hay lista de Places ni validación. | Ninguno. Además se pone "$$" por omisión. | **C** |
| Experiencias | La IA, con la lista de `tripadvisor-search`. `labelExperiences` valida el nombre pero no guarda `place_id` ni `maps_url`. | Ninguno. En "Comprar" se arma una búsqueda de GetYourGuide o Viator. | B o C |
| Hoteles por ciudad | Lo arma el servidor con SerpApi (barato, medio y premium) | Búsqueda de Booking por nombre | A |
| Hoteles sin datos en vivo | La IA | Ninguno (`forceEstimated`) | C |

### 2.3 Otras superficies

| Superficie | Nombre | Enlace | Clase |
|---|---|---|---|
| `suggest-restaurants` (viajes importados) | Places Text Search | Sitio oficial o ficha de Maps | A |
| `tripadvisor-search` (TripActivities) | TripAdvisor (`location_id`), Places (`place_id`) o SerpApi Maps | `web_url` de TripAdvisor o ficha de Maps; los botones de la página son búsquedas de GetYourGuide, Viator y OpenTable por ciudad | A |
| Cercanos (`nearby-places`) | Places Nearby (`place_id`) | Ficha de Maps. **No filtraba los lugares cerrados para siempre; arreglado** (sección 6). | A |
| `places-nearby` (chat `search_nearby`, ConciergeActions) | Places Nearby; respaldo SerpApi Maps | Ficha de Maps | A |
| `nightlife-discover` → `nightlife_premium` | Claude o Gemini, guardado sin validar. El website es el campo libre "contacto". | Texto de la IA | **C** |
| Members Only (`members_venues` → `members_venue_pool`) | Une lo curado de Privé (`after_dark`, CURADO, D) **con** `nightlife_premium` (C) | Website de la fila; la pantalla arma una búsqueda de Maps | 65 % D y 35 % C |
| `recomendar-destinos` y Favoritos | La IA propone ciudades (destinos, no lugares) | Ninguno | C (riesgo bajo: son ciudades) |
| Correo de selección (`enviar-seleccion`) | Los mismos datos de "Comprar" | La URL pasa por `checkAllowlisted` (`selection-email.ts:247`) | Igual que el origen |
| PDF del viaje (`tripPdfModel.ts`) | Los mismos datos de "Comprar" (`purchasePlan`, que llama al motor de ofertas) | Lo que decida el motor | Igual que el origen |

### 2.4 Tarjetas del Concierge (`concierge-chat/cards.ts`)

- `validateCards` solo exige una herramienta para `flight` y `hotel` (`REQUIRES_TOOL`, línea 388). Una tarjeta `restaurant`, `attraction` o `place` con un nombre que no salió de `search_places` ni de `web_search` **pasa igual**. Se le quita el CTA si su dominio no vino de una herramienta, pero el nombre se muestra.
- `enrichCardLinks` (línea 611) pone los enlaces a partir de la evidencia. Si el título coincide con un lugar de la búsqueda, usa el sitio y la ficha de Maps de Google, más "Cómo llegar", Uber y teléfono (A). Si no coincide, el restaurante recibe "Buscar mesa en OpenTable" (`/s?term=`) y una búsqueda de Maps (`actions.ts:388`): búsqueda genérica sobre un nombre C. La tarjeta no dice "no verificado".
- Lo que sale de `web_search` (eventos y restaurantes mencionados en artículos) es C: el nombre lo extrae el modelo del texto, y solo la tarjeta `source` exige que el enlace sea uno de los resultados.

### 2.5 Privé

| Superficie | Origen | Clase | Enlace |
|---|---|---|---|
| Catálogo `prive_experiences` (destinos, lugares, experiencias) | Curaduría `curaduria_2026-10`, con `sources`, `verified_at` y `verified_by = curaduria_asistida:lote`. Solo se publica `effective_state IN (VERIFICADO, CURADO, ESTIMADO)`. | D | `booking_url` y `website` curados; `venueFromPriveRow` quita los rotos según `booking_link_checks` |
| For You y The Key (`_shared/priveKey.ts`) | Determinista sobre el catálogo (`ai_calls: 0`) | D | El del catálogo |
| Drops (`prive_drops`) | Curado, con `source_url` y `last_verified_at` | D | `link_url` oficial |
| Insider (`prive_insider_tips`) | Curado, con `source_url` y `source_checked_at` | D | Fuente oficial |
| Revista (`edition_articles`) | `fact_status`, con 49 vínculos a 34 fuentes | D | `edition-link-check` |
| Mapa y ruleta (`priveExplore.ts`) | Destinos con experiencias publicables del catálogo | D | Internos |
| Legado `nightlife_premium` dentro de Privé | 132 filas `legacy_nightlife_premium`, todas PENDIENTE (no se publican en Privé) | C | — |

---

## 3. Medición con datos reales (producción, solo lectura)

### 3.1 Muestra (a): los 30 viajes más recientes

Se contaron 594 lugares: 220 restaurantes, 220 tours y 154 hoteles. El itinerario es texto en todos los viajes (100 % C).

**Restaurantes (220)**

| Grupo | n | Con `place_id` | Clase | Enlace guardado |
|---|---|---|---|---|
| Un destino, `fuente: google_places` | 15 | 15 | A | 12 sitio oficial y 3 ficha de Maps |
| Un destino, sin fuente (viajes anteriores al 22 de octubre) | 63 | 0 | C | 37 "sitio oficial" construido por la IA, 23 búsqueda de Maps y 3 páginas de OpenTable escritas por la IA |
| Multidestino | 142 | 0 | C | Ninguno (la app arma una búsqueda de OpenTable y de Maps) |

Tipos de enlace en total: proveedor 6.8 %, construido por la IA 18.2 %, búsqueda genérica de Maps 10.5 % y sin enlace guardado 64.5 %.

**Tours y experiencias (220)**

| Grupo | n | Clase |
|---|---|---|
| `google_places` con `place_id` y `maps_url` (un destino) | 19 | A |
| `google_maps` o `tripadvisor` (un destino; nombre validado, sin id) | 26 | B |
| `google_places` o `tripadvisor` (multidestino; nombre validado, sin id) | 53 | B |
| Sin fuente o `estimado` | 122 | C |

En el multidestino, 9 experiencias `estimado` traían una calificación inventada por la IA. Ya está arreglado (sección 6). Ningún tour tiene enlace de producto. En "Comprar" se ofrece la búsqueda de GetYourGuide (con fechas) y la de Viator.

**Hoteles (154)**

| Grupo | n | Clase | Enlace |
|---|---|---|---|
| SerpApi, un destino | 33 | A | 14 búsqueda de Booking directa y 19 por `tp.media` (también una búsqueda de Booking) |
| SerpApi, multidestino | 45 | A | Búsqueda de Booking (24 directas y 21 por `tp.media`) |
| `estimado`, un destino | 25 | C | **22 enlaces de la IA**: 6 *slugs* de `booking.com/hotel/...`, 6 sitios de la cadena, 5 búsquedas de Maps, 2 `tp.media`, 1 búsqueda de Booking y 2 más (`nativooaxaca.com` y un dominio que no existe) |
| Sin fuente, multidestino | 51 | C | Ninguno |

### 3.2 Muestra (b): el catálogo Privé completo

`prive_experiences` tiene 1,392 filas; 1,386 están activas.

| Estado | n | `verified_at` | website | `booking_url` | `sources` |
|---|---|---|---|---|---|
| CURADO, abierto | 1,082 | 1,082 | 1,082 | 907 | 1,082 |
| CURADO, cerrado por temporada | 15 | 15 | 15 | 13 | 15 |
| PENDIENTE (no se publica) | 289 | 0 | 230 | 72 | 160 |
| NO_DISPONIBLE | 6 | 0 | 6 | 0 | 0 |
| **Total** | **1,392** | **1,097** | **1,333** | **992** | **1,257** |

- `google_place_id` vacío: **1,392 de 1,392**. No se puede comprobar contra Google si un lugar cerró.
- Los 1,097 `verified_at` tienen la misma fecha (2026-10-22) y `verified_by = curaduria_asistida:lote`. Es un sello por lote, no una verificación hecha fila por fila por una persona.
- `booking_method`: web 857, `concierge_request` 178, phone 106, walk_in 102, OpenTable 55, Tock 27, email 23, Resy 20, SevenRooms 15 y partner_ota 9.
- Tipo de enlace de reserva de los 1,097 publicados:

| Tipo | n | % |
|---|---|---|
| Sitio oficial (mismo dominio que el website) | 753 | 68.6 |
| Reserva real (OpenTable, Tock, Resy, SevenRooms, TableCheck, Zenchef, ResDiary, Click&Boat…) | 113 | 10.3 |
| WhatsApp | 13 | 1.2 |
| Otro dominio | 40 | 3.6 |
| Búsqueda genérica | 1 | 0.1 |
| Sin `booking_url` (el Fixer resuelve) | 177 | 16.1 |

- `booking_link_checks` (lo revisó `booking-links-cron`): 1,127 revisiones. Sitio oficial: 218 ok, 7 rotos, 11 redirigidos a otro dominio, 8 bloqueados y 175 sin revisar. Página de reservas: 294 ok, 1 rota, 2 redirigidas, 18 bloqueadas, 5 con robots y 388 sin revisar.
- Members Only (`members_venue_pool()`): 249 curados (D) y **133 de `nightlife_premium` (C)**. De esos 133, 70 tienen un website que no es URL y 6 no tienen website.
- Drops: 9 de 9 activos con fuente, enlace y verificación. Insider: 20 de 20 publicados con fuente. Revista: 14 publicados, 13 con fuentes; el que no tiene es de tipo `editorial`.

### 3.3 Muestra (c): las últimas 50 tarjetas de Iato

**No se guardan.** `concierge_conversations` (10 conversaciones, 52 mensajes) guarda solo `role`, `content` y `timestamp`. No hay tabla de tarjetas ni evidencia por turno. Por eso no se puede medir el porcentaje de tarjetas verificadas.

Al leer los 26 mensajes más recientes de Iato aparecieron estas afirmaciones sin respaldo:

- 22 de octubre: "mesa **reservada** en Almoraduz con el chef Quetzalcóatl Zurita". Afirma una reserva que no existe en `concierge_requests` ni en `ai_reservations`.
- 22 de octubre: dice que la búsqueda en vivo no está disponible y en el mismo mensaje afirma que la Centurion Lounge está "entre las puertas 8 y 11".
- 22 de octubre: "programar la búsqueda hacia marzo o abril de 2026", una fecha ya pasada.
- Los mensajes del 23 de octubre con restaurantes citan Google Maps con su calificación y sus reseñas, en línea con las herramientas.

### 3.4 Comprobación de enlaces

Se hizo desde este contenedor: GET con `-L`, 8 s de tiempo máximo y agente `IATOS-link-audit/1.0`, sin evadir protecciones. Fueron 162 URLs únicas. Los dominios que fallaron se resolvieron por DNS-over-HTTPS (dns.google).

| Módulo | n | ok | No verificable | Dominio inexistente | 404 | Contenido equivocado | Certificado inválido | 5xx |
|---|---|---|---|---|---|---|---|---|
| Restaurantes de viaje, IA | 36 | 20 | 4 | 4 | 4 | 2 | 1 | 1 |
| Restaurantes de viaje, Places | 11 | 9 | 1 | 0 | 1 | 0 | 0 | 0 |
| Hoteles estimados, IA | 13 | 2 | 10 | 1 | 0 | 0 | 0 | 0 |
| Hotel SerpApi (búsqueda de Booking) | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| Privé `booking_url` (curado) | 44 | 35 | 9 | 0 | 0 | 0 | 0 | 0 |
| Privé website (curado) | 14 | 14 | 0 | 0 | 0 | 0 | 0 | 0 |
| Members Only, IA (`nightlife_premium`) | 29 | 15 | 3 | 5 | 1 | 3 | 2 | 0 |
| Drops | 6 | 5 | 1 | 0 | 0 | 0 | 0 | 0 |
| Insider | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **162** | **108** | **29** | **10** | **6** | **5** | **3** | **1** |

"No verificable automáticamente": respuestas 403 (Four Seasons, Ritz Paris, Marriott, Bulgari, Tock, Cheval Blanc, Norton, Ronnie Scott's, Banyan Tree y el Louvre), 429, 202 de Booking (reto antibots), error HTTP/2 de OpenTable y MGM, y tiempos agotados (Gaggan, Attica, Air Bali, Amuz). Ninguno se forzó.

### 3.5 Existencia del lugar (Place Details Essentials)

**BLOQUEADO.** Para consultar `id`, `businessStatus` y `displayName` hay tres caminos, y ninguno sirve sin una llave nueva:

- `place-details` pide la sesión de un usuario;
- `health-check?action=google_apis` pide `x-cron-secret`;
- la llave `VITE_..._BROWSER_KEY` del `.env` es de navegador y está restringida por *referer*: usarla desde aquí sería saltarse esa restricción.

Se usaron **0 de las 40 consultas** permitidas y el gasto fue de USD 0. Lo que hay guardado:

- Los 34 lugares de los viajes con `place_id` (15 restaurantes y 19 tours) salieron de `searchText`, que descarta los que tienen `CLOSED_PERMANENTLY` o `CLOSED_TEMPORARILY` en el momento de la consulta (`google-places.ts:332`). Guardan `consultado_at`, pero no `business_status`.
- Privé no tiene `place_id`. Su `operating_status` es: 1,082 abierto, 15 cerrado por temporada (CURADO y etiquetados) y 295 desconocido (no se publican).
- Para medirlo en cuanto se pueda, sin llave nueva: con `CRON_SECRET`, agregar `health-check?action=place_status&ids=...` (Place Details Essentials, USD 0.005 cada una, dentro de las 10,000 gratis del mes).

---

## 4. Casos concretos sospechosos

### 4.1 Viajes (`analizar-viaje`, viajes anteriores al arreglo de googlemax)

| Nombre | Ciudad | Por qué | Módulo |
|---|---|---|---|
| Lorenzo's (The Ritz-Carlton Cancún) | Cancún | La página de Ritz-Carlton da 404. El Ritz-Carlton Cancún dejó de operar con esa marca (hoy es Kempinski), así que el restaurante no existe con ese nombre. | Restaurantes, IA |
| Hotel Escondido Oaxaca | Oaxaca | La liga `hotelelcondido.com` **no existe** (NXDOMAIN); el dominio real es `hotelescondido.com`. | Hoteles estimados, IA |
| La Pergola (Rome Cavalieri) | Roma | `rome-cavalieri.hilton.com` no existe. | Restaurantes, IA |
| Septime | París | `septime-charlesbarriere.fr` es un dominio inventado (no existe). | Restaurantes, IA |
| L'Astrance | París | `astrance.fr` no existe. Hay que confirmar que el restaurante siga abierto. | Restaurantes, IA |
| Le Pré Verre | París | `lepreverre.fr` no existe. | Restaurantes, IA |
| Frenchie Bar à Vins | París | La página da 404. | Restaurantes, IA |
| Los Danzantes | Oaxaca | `/oaxaca/` da 404. | Restaurantes, IA |
| Careyes (Live Aqua Cancún) | Cancún | Redirige a `fiestamericanatravelty.com`, que da 404. | Restaurantes, IA |
| Sukiyabashi Jiro Roppongi | Tokio | El enlace es la portada de `tabelog.com`, sin la ficha del lugar. Además, ese lugar no acepta reservas del público. | Restaurantes, IA |
| Platea Madrid | Madrid | El sitio hoy es de "Eventos corporativos": ya no funciona como restaurante. | Restaurantes, IA |
| L'Ami Jean | París | Responde 520 (error del servidor detrás de Cloudflare). | Restaurantes, IA |
| Coque | Madrid | Certificado TLS inválido: el navegador muestra una alerta. | Restaurantes, IA |
| Sana-di-ge | Nueva Delhi | El website que da **Google** da 404 (el dato de Places está desactualizado). | Restaurantes, Places |
| Only YOU Madrid, Le Sénat, Relais Saint Germain, Relais des Halles, NH Fori Imperiali, Electra Metropolis | Madrid, París, Roma, Atenas | *Slugs* de `booking.com/hotel/...` escritos por la IA en hoteles estimados. Booking responde con un reto antibots, así que no se pueden verificar. | Hoteles estimados, IA |
| Los 142 restaurantes del multidestino | Roma, Florencia, Venecia, España, Japón, Costa Rica y Quintana Roo | Todos C, con "$$" por omisión. Ejemplo: el viaje "Roma → Florencia → Venecia" del 23 de octubre tiene 12. | `logistics-plan` |

### 4.2 Members Only (`nightlife_premium`, generado por la IA y servido por `members_venues`)

| Nombre | Ciudad | Por qué |
|---|---|---|
| Zero Bond | Nueva York | `zerobond.com` está **en venta** (dominio estacionado). |
| Le Mura | Roma | `lemura.it` es una **mueblería de Verona**. |
| Bad Company 1920 | Madrid | El sitio es la plantilla de WordPress ("Sólo otro sitio de WordPress"). |
| Robot Restaurant (sucesor) | Tokio | Robot Restaurant cerró en 2020. El "sucesor" es invención y no tiene web. |
| Café de Paris Saint-Tropez | Saint-Tropez | Está como "speakeasy" y su website dice "Referenciado en guías premium". |
| 94 Tele | Roma | Su website es "Instagram @94tele". |
| Mama'Esh | Dubái | Está como "speakeasy" (categoría dudosa) y no tiene web. |
| Paradise Lost | Ibiza | No tiene web ni dirección precisa. |
| Club Metrópolis | Madrid | 404. `booking_link_checks` también lo marca roto. |
| Beam, Island Club Restaurant, The Basement, Le Chochotte, Queen of Mykonos | Bangkok, Atenas, Roma, París, Mykonos | El dominio **no existe** (NXDOMAIN o SERVFAIL). |
| Casa Tua y Smalls | Miami y Bangkok | Certificado TLS inválido. |

### 4.3 Catálogo Privé: rotos según `booking-links-cron` (sitio oficial)

ZZ's Club (Miami, 500), Quai Saint-Tropez (404), Armani Privé (Milán, 404), Teens of Thailand (Bangkok, 404), Terrazza Martini (Milán, 404), Club Metrópolis (Madrid, 404), Casa Cipriani Milano (404) y Manohra Cruises (Bangkok, 405 en reservas).

Redirigidos a otro dominio: White Dubai (a Instagram), Terraza Catedral CDMX (a `mundojovenhostels.com`), Ritz Club Londres, Café de Paris Londres (a `proud.co.uk`), XS Las Vegas y otros 6. Hay que revisar si siguen abiertos.

### 4.4 Iato

Ver la sección 3.3: la "mesa reservada" en Almoraduz, la ubicación de la Centurion sin búsqueda y la fecha de 2026 que ya pasó.

---

## 5. Plan de corrección priorizado (motor general)

La regla es una sola, para todo lo que se muestre: **un lugar recomendado lleva `place_id` (o el id del proveedor) o la etiqueta "Sin verificar"; el enlace sale solo de los datos del proveedor, y su etiqueta dice qué es.**

### Fase 1: el motor (1 a 2 días; sin llaves nuevas; costo de Google casi cero)

1. **`resolvePlace(nombre, ciudad)` en `_shared/google-places.ts`**, sobre `findPlaceId`: Text Search IDs Only, **gratis**, con caché de 30 días en `serp_cache`. Devuelve `place_id` o `null`.
   - Se aplica a los restaurantes de `logistics-plan`, hoy 100 % C. La opción mejor es usar `restaurantsForCity` por ciudad y `enforceRestaurants`, igual que en `analizar-viaje`.
   - Se aplica a las experiencias sin coincidencia de `analizar-viaje` y `logistics-plan`, y se guarda `place_id` y `maps_url` también en el multidestino. Hoy `labelExperiences` y `multiDestTrip.ts:107` los pierden.
   - Si no se encuentra, el lugar **no se muestra** (restaurantes) o se muestra con la etiqueta "Sin verificar" (tours; ya existe `verificado: false`).
2. **Tarjetas del Concierge**: en `validateCards` y `enrichCardLinks`, una tarjeta `restaurant`, `attraction` o `place` cuyo título no coincide con la evidencia (`matchPlace`) se descarta o lleva `estado_dato: "NO_VERIFICADO"` y no recibe enlaces de reserva. Hay que agregarla a `REQUIRES_TOOL` o hacer una regla equivalente.
3. **Ningún enlace escrito por el modelo.** `cta_action` y `booking_link` de la IA nunca se guardan:
   - `enforceRestaurants` sin lista: borrar `cta_action`.
   - `enforceSources`: ya se borra el `booking_link` de los hoteles estimados (sección 6).
   - Regla 16 del prompt: quitarla para no gastar tokens.
4. **Etiqueta según el tipo de enlace**, en un solo lugar (`_shared/booking/resolver.ts` y `bookingExit.ts`): "Reservar en OpenTable" solo con la página del lugar; "Sitio oficial" para el website; "Buscar en Booking", "Buscar en GetYourGuide" o "Buscar en OpenTable" para las búsquedas. Hoy el botón de hotel A dice "Booking" y es una búsqueda por nombre.
5. **Members Only**: en `members_venue_pool()`, dejar de unir `nightlife_premium` (o unirlo solo con la etiqueta "Sin verificar" y sin website). Es una migración idempotente. Apagar `nightlife-discover` o hacer que valide contra Places antes de insertar.
6. **Hoteles**: guardar `property_token` y el `link` de SerpApi (la ficha de Google Hotels) junto a la búsqueda de Booking.

### Fase 2: los datos ya guardados (2 a 3 días)

1. Pasar `findPlaceId` (gratis) por los 205 restaurantes C y los 122 tours C de los viajes vigentes. Lo que no se encuentre queda "Sin verificar" y pierde su `cta_action`. Borrar los enlaces rotos de la sección 4.1.
2. Privé: llenar `google_place_id` para los 1,097 CURADO con `findPlaceId` (gratis). Después, `businessStatus` mensual con Place Details Essentials: 1,097 × USD 0.005 = unos USD 5.5, dentro de las 10,000 gratis.
3. `booking-links-cron`: terminar las 563 revisiones pendientes (175 de sitio oficial y 388 de reservas). Revisar a mano los 8 rotos y los 13 redirigidos de la sección 4.3.
4. Cambiar el sello `verified_by = curaduria_asistida:lote` por una verificación por fila: fecha y comprobación automática de enlace y `businessStatus`.

### Fase 3: reserva real y medición continua (1 semana)

1. Tours con reserva real: ids de producto de GetYourGuide o Viator (API de partner o búsqueda con `product_id`), para que el botón abra el producto y no una búsqueda.
2. Restaurantes: OpenTable, Resy o Tock solo cuando el lugar tenga su página en el proveedor (Privé ya tiene 113). Para el resto: "Sitio oficial" o "Buscar en OpenTable".
3. Guardar las tarjetas de Iato con su evidencia (tipo, título, `place_id`, `estado_dato` y enlaces) para poder auditarlas. Hoy no se puede.
4. Indicadores semanales en `health-check`: % de lugares con `place_id` por módulo, % de enlaces rotos, % de tarjetas "no verificado" y lugares guardados que pasaron a `CLOSED_PERMANENTLY`.

---

## 6. Arreglos triviales hechos en esta rama (sin desplegar)

| Archivo | Cambio | Prueba |
|---|---|---|
| `supabase/functions/analizar-viaje/sources.ts` | El hotel `estimado` ya no conserva el `booking_link` que escribió el modelo. "Comprar" arma la búsqueda de Booking (`offerFromTripHotel`). | `src/test/tripSources.test.ts`: "hotel estimado pierde la liga que escribió el modelo" |
| `supabase/functions/logistics-plan/provenance.ts` | Una experiencia que no está en la lista del proveedor nunca muestra la calificación que puso el modelo (antes se conservaba si el modelo la marcaba `estimado`). | `src/test/logisticsProvenance.test.ts` |
| `supabase/functions/nearby-places/index.ts` | Cercanos no muestra lugares con `businessStatus = CLOSED_PERMANENTLY`. | deno check |

Funciones que hay que desplegar para que el arreglo llegue a producción: `analizar-viaje`, `logistics-plan` y `nearby-places`.

Verificación:

- `npx tsc --noEmit -p tsconfig.app.json`: ok.
- `unshare -n npx vitest run --testTimeout=60000`: **290 archivos y 3,181 pruebas aprobadas**.
- `deno check` de las 3 funciones: ok.

## 7. Método y límites

- Las consultas SQL fueron solo `SELECT`, por `mcp__Lovable__query_database` (proyecto `7c80960a-…`), el 23 de octubre de 2026. Las muestras son de esa fecha.
- La lista de URLs y los resultados están en el *scratchpad* de la sesión (`auditoria-lugares-reales/urls.tsv` y `results.tsv`). No se versionan porque traen URLs de viajes de usuarios.
- "Contenido equivocado" se decidió leyendo el `<title>` de la página: dominio en venta, plantilla, otro negocio. Los casos de "cerró" o "cambió de marca" son conocimiento del auditor y hay que confirmarlos con `businessStatus` (fase 2).
- Los viajes incluyen 5 de prueba E2E ("E2E PRUEBA …"); no cambian las conclusiones.

---

## 8. Fase 1 hecha en `claude/lugares-reales-f1` (motor general, sin desplegar)

- **Validación antes de mostrar** (`_shared/place-verify.ts`): `resolvePlace(nombre, ciudad)` busca con Text Search y el preset `verify` (id, displayName, googleMapsUri, businessStatus = **Text Search Pro**). IDs Only (gratis) no sirve para validar: no trae el nombre y siempre devuelve "el más parecido", aunque el nombre sea inventado. Caché en `serp_cache` (sin migración): solo `place_id`, 30 días; "no encontrado", 7 días. `makeResolver` pone concurrencia compartida (4), tiempo por búsqueda (3.5 s) y un plazo total; lo que no alcanza queda "Sin verificar".
- **analizar-viaje**: restaurantes fuera de la lista de Google y tours fuera de la lista de atracciones se buscan (plazo 8 s). Restaurante no encontrado: no se muestra. Tour no encontrado o sin tiempo: `verificado: false` ("Sin verificar"). Se quitó la regla 16 del prompt y el `cta_action` del esquema.
- **logistics-plan**: una búsqueda de restaurantes por ciudad (la misma `restaurantsForCity`, en paralelo con hoteles y atracciones) que la IA usa como lista; después, la misma validación (plazo 10 s, nunca después de `__deadline − 8 s`). `labelExperiences` ya conserva `place_id`, ficha y calificación del proveedor.
- **multiDestTrip.ts**: sin "$$" por omisión; pasan `place_id`, ficha, sitio y `verificado`.
- **Enlaces**: `offerFromTripRestaurant` ya no usa el `cta_action` guardado. Botones: "Buscar en OpenTable" (antes "Buscar mesa"), "Buscar en Google Maps" cuando no hay `place_id`, "Sitio oficial" solo con el website del proveedor; el carrusel de Comprar ya no dice "Reservar" en todo (usa la etiqueta del motor) y marca "Sin verificar".
- **Concierge**: una tarjeta `restaurant` cuyo título no salió de `search_places`, `search_nearby`, `search_attractions`, `search_members_venues` o `search_prive` se descarta (`lugar_sin_respaldo`).
- **Members Only**: sin migración. `fetchMembersVenues` y `search_members_venues` muestran solo lo curado o con fuente (`isSourcedVenue`). **Pendiente**: `members_cities()` y `members_teaser()` siguen contando las filas de `nightlife_premium`; para que los conteos cuadren hay que redefinir `members_venue_pool()` sin la parte `leg` (migración aditiva) y ajustar la suite `members_more`.
- **Hoteles**: se guardan `property_token` y el sitio del hotel (`link` de SerpApi → `website`) cuando la tarifa coincide con la lista. **Pendiente**: enlazar a la ficha de Google Hotels por `property_token` (la URL `google.com/travel/hotels/entity/<token>` no está documentada y `google.com/travel` no está en la lista blanca del motor); por ahora el botón sigue siendo la búsqueda de Booking.
