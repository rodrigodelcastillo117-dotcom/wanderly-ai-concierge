# Enlaces de compra y "Comprar mi viaje" — cierre 2, grupo `enlaces`

**Pedido del dueño:** que los botones a sitios externos (Aeroméxico, hoteles, vuelos, restaurantes, promociones y todos los demás) lleven de verdad a esas páginas con los días, los vuelos y todo lo que se cotizó, y una experiencia de compra sencilla.

**Rama:** `claude/r2-enlaces`. Base: `3db952a`. Sin push, sin despliegue y sin tocar producción.
**Fecha de las pruebas:** 22 de octubre de 2026.
**Cotización de ejemplo:** CDMX → Madrid del 12 al 19 de diciembre de 2026, 2 adultos y 1 habitación; MEX → CUN en Aeroméxico, mismas fechas y 2 adultos. Para trenes se usó Madrid → Barcelona el 15 de diciembre; para ferries, Pireo → Santorini; para el restaurante, Sobrino de Botín (Madrid) y Eleven Madison Park (Resy, catálogo Privé).

---

## 1. Resumen

- **Se probaron 79 aperturas reales**, una por URL, con Chromium: 35 con los generadores de antes (`A-*`) y 44 con los de ahora (`D-*`). Las capturas y el JSON están en `docs/iatos/evidencia/enlaces/`.
- **Antes** (35 aperturas):
  - 5 abrían la búsqueda o la ficha exacta: Aviasales, Booking.com por ciudad, Airbnb, Kayak autos y la ficha de Google Maps;
  - 2 la abrían a medias: Kayak con 1 pasajero en lugar de 2, y Resy con la fecha de hoy;
  - 11 abrían el sitio sin datos. Ahí entran Google Flights (`?q=` abría el formulario vacío) y AXA, que redirigía a la portada corporativa;
  - **7 llevaban a una página de error**:
    - hotels-search mandaba a `tp.media/click`, que responde 400;
    - Omio respondía 410, tanto en trenes como en el autobús CDMX–Puebla;
    - Airalo y Holafly daban 404 con "España";
    - Rentalcars mostraba "Algo no ha salido según lo previsto";
    - Vacations To Go mostraba "Page Not Found!";
  - 10 estaban **BLOQUEADOS** para el navegador automático.
- **Ahora** (44 aperturas):
  - **0 páginas de error**;
  - 19 abren la búsqueda o la ficha exacta. 4 de ellas son las variantes con niños (Google Flights, Aviasales, Kayak y Booking.com). Según la revisión manual, una no cumple del todo: Booking.com por nombre de hotel trajo un homónimo (ver §4);
  - 13 abren el sitio sin datos, porque el sitio no los acepta por enlace, y la app ahora lo dice junto al botón. Ahí entra Google Hotels, que se probó solo como referencia;
  - 12 están BLOQUEADOS. Ahí entran Expedia y Hotels.com, que la app no usa, y Rentalcars, que a veces bloquea.
- **Aeroméxico:**
  - Su sitio no recibe ruta ni fechas por enlace y bloquea la verificación (Access Denied).
  - Ahora el vuelo cotizado con Aeroméxico abre **Google Flights con la ruta, las fechas, los pasajeros y solo vuelos de Aeroméxico** (captura `D-GF-AM.jpg`). Desde ahí se toca "Reservar con Aeroméxico".
  - La portada de Aeroméxico sigue como opción "Sitio de Aeroméxico", con el aviso de que ahí hay que escribir todo.
- **Nuevo en el detalle del viaje: "Comprar mi viaje".** Es una reserva en 3 pasos:
  - lista lo cotizado;
  - por cada cosa dice a qué sitio lleva el botón y qué va precargado (leído de la propia URL);
  - deja marcar "Ya lo reservé", y la marca se guarda en el viaje;
  - muestra los avisos honestos.
- **Pruebas:**
  - 26 pruebas nuevas: 20 de formatos de URL y 6 de la experiencia de compra. Con el código de antes fallan las 26; con el de ahora pasan.
  - Mutaciones: 10 de 10 hacen fallar una prueba.
  - Suite completa: 2 284 de 2 285. La que falla, `priveUx`, también falla en la base `3db952a`.
- **Seguridad del bridge:** no se tocaron `allowlist.ts`, `resolver.ts`, `redirectToken.ts`, `linkcheck.ts` ni `handler.ts`, que son del grupo `reservas`. Toda salida que firmaba `booking-go` sigue firmada y pasa por la misma lista blanca, PSL y huella.

## 2. Qué es real y qué es simulado

| Prueba | Real | Simulado |
|---|---|---|
| `scripts/enlaces/verify_enlaces.mjs` | Abre cada URL pública en Chromium (`/opt/pw-browsers/chromium`), sin clics: no se reserva, no se paga, no se inicia sesión. Guarda la captura y decide con lo que **muestra la página**: título, texto y campos del buscador. | Nada. Las URLs se arman con los generadores de la app: los de antes desde una copia del commit `3db952a` y los de ahora desde esta rama. |
| `scripts/enlaces/e2e_comprar.mjs` | La app real, servida por Vite, en Chromium a 390 y 1440 px. | Supabase completo con `route()`: sesión, viaje, `bookings` y funciones. Las pestañas externas se interceptan: solo se lee la URL de salida. |
| Vitest | Código real de generadores, ofertas, booking-bridge y booking-go (handler y firma reales, sin red). | Proveedores y base, simulados en memoria. |

Google limita el tráfico automático: si se abren varias seguidas responde "tráfico inusual" (429). Por eso sus casos van en serie, con pausas de 35 a 60 s. Cinco casos se volvieron a abrir con `--ids`: `D-AVIA`, `D-KAYAK`, `D-GF-AM`, `D-GF-NINOS` y `A-GYG`. `D-AVIA` y `D-KAYAK` se reabrieron porque la cabecera aún cargaba al leerla; los dos de Google, por el límite; `A-GYG` siguió en 403. Las notas `revision_manual` del JSON vienen de revisar cada captura a mano.

## 3. Inventario de botones externos

**Leyenda de "Salida":**
- **Bridge:** pasa por la hoja de aviso (`BookingSheet`). Si el usuario marca "Guardar en mi viaje", sale por `booking-bridge`, que devuelve un `go_url` de **`booking-go` firmado** (302 al destino guardado). Si no lo marca, sale directo a la URL ya validada por la lista blanca.
- **Directo:** `window.open` o `<a target=_blank rel=noopener>` más un registro del clic en `bookings` con `status` pending.

| Dónde | Tipo / proveedor | Generador (archivo) | Parámetros y de dónde salen | Salida |
|---|---|---|---|---|
| Detalle del viaje, tarjetas de vuelo | Google Flights (tfs), Aviasales y sitio de la aerolínea | `offers.ts` `offerFromTripFlight` → `links.ts` `googleFlightsSearchUrl` / `aviasalesSearchUrl` | IATA del enlace de Aviasales que guardó la cotización (`trips.vuelos_json[].booking_link`); fechas y viajeros de `trips`; aerolínea → código IATA (`_shared/airlines.ts`) | Bridge |
| Detalle, tarjetas de hotel | Booking.com, Google Maps y sitio oficial (catálogo) | `offerFromTripHotel` → `bookingSearchUrl` | "nombre + ciudad", fechas y viajeros del viaje; habitaciones = ⌈adultos / 2⌉ | Bridge |
| Detalle, experiencias | GetYourGuide (con fechas del viaje), Viator y catálogo Privé | `offerFromTripTour` / `offerFromVenue` | nombre + ciudad; `date_from` y `date_to` del viaje | Bridge |
| Detalle, restaurantes | Página de reservas (catálogo / Google Places), OpenTable, Maps, WhatsApp y solicitud | `offerFromTripRestaurant` / `offerFromVenue` (+ `resyWithDate`) | nombre + ciudad; Resy recibe fecha y personas del borrador | Bridge |
| **Detalle, "Comprar mi viaje"** (nuevo) | La acción principal de cada oferta anterior; renta de auto con Kayak | `src/lib/purchasePlan.ts` (reusa `offers.ts`); `kayakCarsLink` + `checkAllowlisted` | los mismos de cada oferta | Directo, con la misma URL validada que la hoja sin consentimiento |
| Detalle, cruceros | `/dashboard/cruceros` (interno) | — | — | interno |
| `/dashboard/vuelos`, resultados | Google Flights (URL de SerpApi o tfs con la aerolínea del resultado), Aviasales y aerolínea | `offerFromFlightResult` | resultado de `flights-search` (SerpApi o Travelpayouts) | Bridge |
| `/dashboard/vuelos`, botones de abajo | Google Flights, Skyscanner y Kayak | `affiliateLinks.ts` `googleFlightsLink`, `skyscannerLink`, `kayakFlightsLink` | IATA de `meta` de la búsqueda; fechas y viajeros del formulario, que ahora se llenan del viaje si llega `?trip=` | Directo |
| `/dashboard/vuelos`, "sin búsqueda en vivo" | Aviasales | `flights-search/search.ts` `aviasalesBuyUrl` | IATA, fechas y adultos | Directo |
| `/dashboard/hoteles`, resultados / abajo / "sin búsqueda en vivo" | Booking.com, sitio del hotel y Airbnb | `offerFromHotelResult`; `bookingLink`, `airbnbLink`; `hotels-search/search.ts` `bookingUrl` | ciudad, fechas, adultos y habitaciones | Bridge / Directo |
| `/dashboard/autos` | Kayak, Discover Cars y Rentalcars | `kayakCarsLink`, `discoverCarsLink`, `rentalcarsLink` | ciudad y fechas (del viaje si llega `?trip=`) | Directo |
| `/dashboard/trenes` | Trainline, Omio y Rail Europe | `trainlineLink`, `omioLink`, `raileuropeLink` | — (ningún sitio los recibe) | Directo |
| `/dashboard/ferries` | Ferryhopper, Direct Ferries y AFerry | `ferryhopperLink`, `directFerriesLink`, `aferryLink` | — | Directo |
| `/dashboard/cruceros` | Vacations To Go, CruiseDirect y Cruise Critic | `vacationsToGoLink`, `cruiseDirectLink`, `cruiseCriticLink` | — / destino | Directo |
| `/dashboard/esim` | Airalo, Holafly y Nomad | `airaloLink`, `holaflyLink` (`esimSlugs`) | país del viaje, convertido a su página en inglés | Directo |
| `/dashboard/actividades` | GetYourGuide, Viator, Tripadvisor, OpenTable y fichas de Tripadvisor/Places | `getYourGuideLink`, `viatorLink`, `tripadvisorLink`, `openTableLink` | ciudad (y fechas del viaje para GetYourGuide) | Directo |
| `/dashboard/restaurantes` | OpenTable, TheFork, Yelp y Tripadvisor | `openTableLink`, `theforkLink`, `yelpLink`, `tripadvisorLink` | ciudad | Directo |
| `/dashboard/seguros` | Heymondo, Chapka, AXA y World Nomads | URLs fijas en `src/pages/Insurance.tsx` | — | Directo |
| Concierge, tarjetas | sitio del lugar, OpenTable (`covers`/`dateTime`), Maps, Welcome Pickups, Blacklane (búsqueda de Google) y Uber | `concierge-chat/actions.ts` `restaurantBookingLinks`, `context.ts`, `planner.ts`; `ActionButton.tsx` `welcomePickupsLink` | datos del viaje y del lugar | Directo |
| Privé, ficha | `booking_url` o `website` curados del catálogo | `src/components/prive/catalog/ExperienceDetail.tsx` | fila del catálogo | Directo |
| Privé, planeador y tarjetas The Key | ofertas del bridge | `offerFromVenue` (`venueFromPriveRow`) | catálogo | Bridge |
| `analizar-viaje`, trayecto corto | autobús (ahora Google Maps en transporte público) y auto (Google Maps) | `groundTransport.ts` `groundSearchLinks` | ciudades de origen y destino | Bridge (como opción de "Cómo llegar") |

Nota: `tp.media/click` responde 400, así que `tpDeepLink` devuelve la URL directa. **No se agregó ningún afiliado nuevo.** El `marker` de Travelpayouts se conserva donde ya estaba.

## 4. Tabla por proveedor (verificación real)

**Estados:**
- **Exacta:** la página muestra la ruta o el lugar, las fechas y las personas.
- **Sin datos:** abre el sitio, pero sin los datos.
- **Error:** 4xx o página de error.
- **BLOQUEADO:** el sitio respondió 403/429/405, captcha o "Access Denied" al navegador automático. No se da por bueno: para una persona puede abrir bien, pero no se comprobó.

Las capturas (`*.jpg`) están en `docs/iatos/evidencia/enlaces/`.

| Proveedor | URL de ejemplo (ahora) | Datos que lleva | Antes | Ahora | Lo que el proveedor no permite por enlace |
|---|---|---|---|---|---|
| **Google Flights** (vuelo del viaje y `/dashboard/vuelos`) | `https://www.google.com/travel/flights?tfs=GhoSCjIwMjYtMTItMTJqBRIDTUVYcgUSA01BRBoaEgoyMDI2LTEyLTE5agUSA01BRHIFEgNNRVhAAUABSAGYAQE%3D&hl=es-419` | MEX→MAD, 12–19 dic, ida y vuelta, 2 adultos (y niños; aerolínea si se cotizó) | Sin datos `A-GF.jpg` (el `?q=` abre el formulario vacío) | **Exacta** `D-GF.jpg`; con un niño, `D-GF-NINOS.jpg` (3 pasajeros) | número de vuelo y tarifa exacta: se elige ahí |
| **Aeroméxico** vía Google Flights | `…/travel/flights?tfs=Gh4SCjIwMjYtMTItMTIyAkFNagUSA01FWHIFEgNDVU4aHhIKMjAyNi0xMi0xOTICQU1qBRIDQ1VOcgUSA01FWEABQAFIAZgBAQ%3D%3D&hl=es-419` | MEX→CUN, 12–19 dic, 2 adultos, **solo Aeroméxico** | (no existía) | **Exacta** `D-GF-AM.jpg` | — |
| **Aeroméxico** (sitio oficial) | `https://aeromexico.com` | nada | **BLOQUEADO** `A-AM.jpg` (Access Denied, Akamai) | **BLOQUEADO** `D-AM.jpg` | no hay formato público de búsqueda por URL. La app dice: "Aeroméxico no recibe ruta ni fechas por enlace: escribe origen, destino, fechas y pasajeros en su sitio" |
| **Aviasales** | `https://www.aviasales.com/search/MEX1212MAD19122?marker=533299` | ruta, fechas, 2 adultos (`…191221` = 2 adultos + 1 niño) | Exacta `A-AVIA.jpg` | **Exacta** `D-AVIA.jpg`, `D-AVIA-NINOS.jpg` | infantes: no se usan |
| **Kayak** (vuelos) | `https://www.kayak.com/flights/MEX-MAD/2026-12-12/2026-12-19/2adults` | ruta, fechas, 2 adultos (`/children-8`) | A medias `A-KAYAK.jpg` (**1 pasajero**: ignoraba `?adults=2`) | **Exacta** `D-KAYAK.jpg`, `D-KAYAK-NINOS.jpg` | — |
| **Skyscanner** | `https://www.skyscanner.com.mx/transport/flights/MEX/MAD/261212/261219/?adults=2` | ruta, fechas y adultos (sin verificar) | BLOQUEADO `A-SKY.jpg` (captcha) | **BLOQUEADO** `D-SKY.jpg` | no se pudo comprobar; la app lo dice |
| **Kiwi** | — | — | — | — | la app no arma enlaces a Kiwi; Aviasales puede mandar ahí desde su resultado |
| **Booking.com** (ciudad) | `https://www.booking.com/searchresults.html?ss=Madrid&checkin=2026-12-12&checkout=2026-12-19&group_adults=2&no_rooms=1&marker=533299` | ciudad, fechas, adultos, habitaciones (y niños con edad) | Exacta `A-BK.jpg` (pero con 4 adultos mandaba 1 habitación) | **Exacta** `D-BK.jpg`; niños `D-BK-NINOS.jpg` ("2 adultos · 1 niño · 1 habitación") | habitación y tarifa exactas |
| **Booking.com** (hotel por nombre) | `…?ss=Hotel+Urban+Madrid&checkin=2026-12-12&checkout=2026-12-19&group_adults=2&no_rooms=1` | nombre del hotel, fechas, ocupación | — | **Fechas y ocupación: sí. Hotel: NO.** `D-BK-HOTEL.jpg`: Booking eligió "Urban A+++ Hotel" (Tres Cantos), un homónimo | sin el id de Booking no se puede abrir la ficha exacta. La app avisa: "revisa que sea el cotizado (puede mostrar uno con nombre parecido)" |
| **Booking.com** desde hotels-search sin búsqueda en vivo | `…searchresults.html?ss=Madrid&checkin=…&group_adults=2&no_rooms=1` | ciudad, fechas, adultos, habitaciones | **Error** `A-HS.jpg` (`tp.media/click` → **400**) | **Exacta** `D-HS.jpg` | — |
| **Airbnb** | `https://www.airbnb.com/s/Madrid/homes?query=Madrid&checkin=2026-12-12&checkout=2026-12-19&adults=2` | ciudad, fechas, huéspedes | Exacta `A-AIRBNB.jpg` | **Exacta** `D-AIRBNB.jpg` | niños: no se probó, así que no se manda |
| **Google Hotels** | (la app no lo arma: solo usa los enlaces de precio de SerpApi) | — | — | `D-GHOTELS.jpg`: por texto abre el hotel, **pero con otras fechas** (6–7 ene) | `checkin`/`checkout` por URL no se aplican; por eso no se usa |
| **Expedia / Hotels.com** | (la app no los usa) | — | — | **BLOQUEADO** `D-EXPEDIA.jpg`, `D-HOTELSCOM.jpg` (429 "Bot or Not?") | — |
| **OpenTable** | `https://www.opentable.com/s?term=Sobrino%20de%20Bot%C3%ADn%20Madrid` | nombre del restaurante | BLOQUEADO `A-OT.jpg` (403 Access Denied) | **BLOQUEADO** `D-OT.jpg` | fecha, hora y personas: no se pudo comprobar que los reciba. La app dice "Elige fecha, hora y personas en OpenTable" |
| **Resy** (catálogo) | `https://resy.com/cities/new-york-ny/venues/eleven-madison-park?date=2026-12-13&seats=2` | restaurante, fecha, personas | A medias `A-RESY.jpg` (fecha de hoy) | **Exacta** `D-RESY.jpg` ("2 Clientes · dom., 13 dic.") | **la hora** ("Todo el día") |
| **Google Maps** (restaurante) | `https://www.google.com/maps/search/?api=1&query=Sobrino+de+Bot%C3%ADn%2C+Madrid` | el lugar | Exacta (lugar) `A-MAPS.jpg` | **Exacta (lugar)** `D-MAPS.jpg`: ficha "Restaurante Botín" | fecha, hora y personas: si el lugar acepta reservas, se eligen en su ficha |
| **TheFork / Yelp / Tripadvisor** | `…thefork.com/search?cityName=Madrid…`, `…yelp.com/search?…`, `…tripadvisor.com/Search?q=Madrid` | ciudad | BLOQUEADO | **BLOQUEADO** `D-FORK.jpg`, `D-YELP.jpg` (403), `D-TRIPADV.jpg` | no comprobable; la app lo dice |
| **GetYourGuide** | `https://www.getyourguide.com/s/?q=Madrid&date_from=2026-12-12&date_to=2026-12-19&marker=533299` | destino o experiencia y fechas del viaje | Sin datos (sin fechas) en una corrida y **BLOQUEADO** (403) `A-GYG.jpg` en otra | **Exacta** `D-GYG.jpg` (filtro "12–19 Dic") | día, hora y personas: se eligen en la actividad. Bloquea a veces |
| **Viator** | `https://www.viator.com/searchResults/all?text=Madrid&marker=533299` | destino | BLOQUEADO | **BLOQUEADO** `D-VIATOR.jpg` (403) | — |
| **Omio** (trenes) | `https://www.omio.com/?marker=533299` | nada | **Error** `A-OMIO.jpg` (**410** "This page doesn't exist") | Sin datos `D-OMIO.jpg` | la búsqueda necesita ids internos. Las páginas de ruta (`/trains/madrid/barcelona`) abren, pero un par inexistente da 410, así que no se usan |
| **Trainline** | `https://www.thetrainline.com/?marker=533299` | nada | Sin datos `A-TRAINLINE.jpg` (ignoraba el `#from=…`) | Sin datos `D-TRAINLINE.jpg` | requiere códigos de estación; la app lo dice |
| **Rail Europe** | `https://www.raileurope.com/?marker=533299` | nada | BLOQUEADO `A-RAILEU.jpg` | **BLOQUEADO** `D-RAILEU.jpg` | — |
| **Autobús CDMX→Puebla** (trayecto corto) | `https://www.google.com/maps/dir/?api=1&origin=Ciudad+de+M%C3%A9xico&destination=Puebla&travelmode=transit` | origen y destino | **Error** `A-BUS.jpg` (Omio **410**) | **Exacta (ruta)** `D-BUS.jpg`: autobuses ADO y AU, con precio | la fecha (Maps no la recibe); el boleto se compra con la línea |
| **Kayak autos** | `https://www.kayak.com/cars/Madrid/2026-12-12/2026-12-19` | ciudad (o IATA) y fechas | Exacta `A-KAYAK-CARS.jpg` | **Exacta** `D-KAYAK-CARS.jpg` | hora: queda en "mediodía" |
| **Discover Cars** | `https://www.discovercars.com/?marker=533299` | nada | Sin datos `A-DISCOVER.jpg` (ignoraba los parámetros) | Sin datos `D-DISCOVER.jpg` | ciudad y fechas por URL |
| **Rentalcars** | `https://www.rentalcars.com/?marker=533299` | nada | **Error** `A-RENTALCARS.jpg` ("¡Vaya! Algo no ha salido según lo previsto") | BLOQUEADO `D-RENTALCARS.jpg` ("Human Verification"); en la exploración abrió su buscador vacío | ciudad y fechas (piden ids de ubicación) |
| **Airalo** | `https://www.airalo.com/spain-esim?marker=533299` | el país | **Error** `A-AIRALO.jpg` (**404**: `/españa-esim`) | **Exacta (país)** `D-AIRALO.jpg` | días y datos: se eligen ahí. Slugs verificados en 24 países |
| **Holafly** | `https://esim.holafly.com/esim-spain/?marker=533299` | el país | **Error** `A-HOLAFLY.jpg` (**404**) | **Exacta (país)** `D-HOLAFLY.jpg` | días |
| **Nomad** | `https://www.getnomad.app/` (redirige a nomadesim.com) | nada | — | sin datos (exploración) | país |
| **Seguros**: Heymondo, Chapka y World Nomads | portadas | nada | Sin datos | Sin datos `D-HEYMONDO.jpg`, `D-CHAPKA.jpg`, `D-WN.jpg` | destino, fechas y viajeros: se escriben en su cotizador; la app lo dice |
| **AXA** | `https://www.axatravelinsurance.com/` | nada | Sin datos, **redirección a otra cosa** `A-AXA.jpg` (portada corporativa de AXA Partners) | Sin datos `D-AXA.jpg` (cotizador de seguro de viaje) | — |
| **Ferryhopper / Direct Ferries / AFerry** | portadas | nada | Sin datos (ignoraban `trips`, `from`, `to` y `date`) | Sin datos `D-FERRYHOPPER.jpg`, `D-DIRECTFERRIES.jpg` | ruta y fecha por URL |
| **Vacations To Go** | `https://www.vacationstogo.com/?marker=533299` | nada | **Error** `A-VTG.jpg` ("Page Not Found!") | Sin datos `D-VTG.jpg` (buscador "Find a Bargain") | — |
| **CruiseDirect / Cruise Critic** | portada / `find-a-cruise` | nada / destino | Sin datos / BLOQUEADO | Sin datos `D-CRUISEDIRECT.jpg` / **BLOQUEADO** `D-CRUISECRITIC.jpg` | — |
| **Welcome Pickups** (traslado) | `https://www.welcomepickups.com/?aff_track_id=…&utm_campaign=transfer_madrid` | nada | Sin datos `A-WELCOME.jpg` (ignoraba `pickup_*`) | Sin datos `D-WELCOME.jpg` | aeropuerto, hotel, fecha, hora y pasajeros: la tarjeta del concierge dice que se escriben ahí |
| **Uber** | `https://m.uber.com/ul/?action=setPickup&…` (formato documentado por Uber) | destino | — | en escritorio redirige a uber.com/ride (exploración); en el teléfono abre la app | — |

Las "promociones" (Drops y Oportunidades de Privé) salen por el catálogo curado, con la misma regla de Privé. No tienen fechas ni personas que precargar.

## 5. Hallazgos y correcciones

| ID | Sev | Prueba (falla antes / pasa después) | Corrección (archivo:línea, commit) | Mutación | Estado |
|---|---|---|---|---|---|
| ENL-01 | Alta | `enlacesCompra.test.ts` "vuelo del viaje (Aeroméxico)…" y "resultado de Travelpayouts…"; `bookingBridgeE2E #1`: el `Location` del 302 de booking-go lleva ruta, fechas, pasajeros e `IB` | `_shared/booking/links.ts:112` `googleFlightsSearchUrl`; `offers.ts:143,250`; `_shared/airlines.ts` · `793e383` | M7: sin Google Flights en el vuelo del viaje → fallan 6 | Corregido |
| ENL-02 | Alta | "Google Flights (tfs)…", "ya no usa el texto ?q=…", "Kayak: los pasajeros van en la ruta…" | `src/lib/affiliateLinks.ts:107` `googleFlightsLink`; `:129` `kayakFlightsLink` · `206aa10` | M3 (vuelve `?q=`) → fallan 3; M4 (vuelve `?adults=`) → falla 1 | Corregido |
| ENL-03 | Alta | "autobús en trayectos cortos…" y `groundTransport.test.ts` "Google Maps en transporte público…" | `analizar-viaje/groundTransport.ts:232` · `f50a5f7`; trayecto por carretera en `offers.ts` · `793e383` | M2 → fallan 2 | Corregido |
| ENL-04 | Alta | "hotels-search: el enlace de Booking ya no pasa por tp.media…"; `liveSearchFallback.test.ts` | `hotels-search/search.ts:20` · `1477cd4`; respaldo en el cliente: `TripHotels.tsx` · `9929b3f` | M1 → fallan 2 | Corregido (requiere desplegar `hotels-search`) |
| ENL-05 | Alta | "eSIM: el país en español se convierte al slug verificado…" | `affiliateLinks.ts:267–297` (`ESIM_SLUGS`, `esimSlugs`) · `206aa10` | M5 → falla 1 | Corregido |
| ENL-06 | Media | "autos: Kayak con ciudad y fechas; Discover Cars y Rentalcars…" | `affiliateLinks.ts:249–259` · `206aa10`; Kayak primero en `TripCars.tsx` · `9929b3f` | M8 → falla 1 | Corregido |
| ENL-07 | Media | "ferries y cruceros: … Vacations To Go ya no abre 'Page Not Found!'" | `affiliateLinks.ts:325–331` · `206aa10` | M9 → falla 1 | Corregido |
| ENL-08 | Media | "Omio ya no manda a /search…", "Welcome Pickups: solo el seguimiento…" | `affiliateLinks.ts:214–224, 54, 309–318`; `concierge-chat/context.ts` · `206aa10` | cubierto por las pruebas exactas de URL | Corregido |
| ENL-09 | Media | "Aviasales: DDMM + adultos + niños…", "Booking.com: … niños con edad"; `bookingBridge.test.ts` (parse con niños) | `links.ts:67,78,197` · `793e383` | M10 (sin edades) → falla 1 | Corregido |
| ENL-10 | Media | "GetYourGuide aplica las fechas del viaje", "experiencia del viaje…", "Resy: fecha y personas…" | `links.ts:248,268`; `offers.ts:498,521` · `793e383` | cubierto por las pruebas exactas de URL | Corregido |
| ENL-11 | Media | `tripPurchasePlan.test.tsx`; revisión en navegador (E2E) | `PrefillNote.tsx`; prellenado desde `?trip=` en `TripFlights`, `TripHotels`, `TripCars`, `TripESIM` y `TripActivities` · `9929b3f` | — (UI) | Corregido |
| ENL-12 | Alta | `tripPurchasePlan.test.tsx` (6) + `e2e_comprar.mjs` (390/1440) | `src/lib/purchasePlan.ts`, `TripPurchasePlan.tsx`, `TripDetail.tsx:569`, `TripNextStep.tsx`, `Reservas.tsx` · `093e97d` | M6 ("Ya lo reservé" como confirmed) → fallan 2 | Hecho |
| ENL-13 | Media | "bookingLink de las herramientas: habitaciones como la cotización (4 adultos = 2 hab.)" | `affiliateLinks.ts:142` · `206aa10` | cubierto por la prueba | Corregido |
| ENL-14 | Media | captura `A-AXA.jpg` → `D-AXA.jpg` | `src/pages/Insurance.tsx` · `9929b3f` | — (URL fija) | Corregido |

Detalle de las mutaciones: `docs/iatos/evidencia/enlaces/mutaciones.txt`. Las pruebas nuevas contra el código de antes están en `pruebas_antes.txt`: fallan 20 de 20, y la suite de la UI ni siquiera carga.

## 6. Experiencia de compra: "Comprar mi viaje"

Va en el detalle del viaje, debajo de "¿Qué sigue?". El botón "Elige y reserva" de esa tarjeta ahora lleva a esta sección.

- **3 pasos, a la vista:**
  1. abre cada sitio, con tus datos precargados;
  2. revisa el precio y paga ahí;
  3. vuelve y toca "Ya lo reservé".
- **Lista de lo cotizado:**
  - el vuelo elegido; si no se eligió ninguno, el primero; "Ya tengo vuelo" lo quita de la lista;
  - el hospedaje;
  - la **renta de auto**, opcional y no cotizada, con Kayak: ciudad y fechas;
  - las actividades elegidas;
  - hasta 3 restaurantes, como opcionales.
- **Por elemento:**
  - el precio y su etiqueta de procedencia, en vivo o estimado (`PriceSourceBadge`), con la fecha de consulta;
  - **"Te lleva a"**: el nombre del sitio;
  - **"Va precargado"**: se lee de la URL real, por ejemplo "MEX → MAD · 12–19 dic 2026 · 2 adultos · solo Iberia";
  - **qué completar ahí**;
  - un enlace real (`target=_blank rel=noopener`).
- **Estado:** "Ya lo reservé", con Deshacer, o "Pendiente". Cuenta "N de M reservados" (sin los opcionales).
  - Se guarda en **`public.bookings`**, tabla que ya existe y tiene RLS por usuario y acceso al viaje: `status` pending y `raw_payload.compra_item` con la clave del elemento.
  - **No** usa `trips.selections`: marcaría la cotización como "por actualizar".
  - **No** usa `confirmed`: en IATOS exige evidencia del proveedor.
  - "Mis reservas" lo muestra como "Marcado por ti como reservado (sin verificar)".
- **Avisos:** "IATOS no cobra ni emite boletos: pagas directo en cada sitio. El precio puede cambiar en el sitio; confirma fechas, personas y precio antes de pagar."
- **E2E con datos simulados** (`e2e_comprar_despues.json`), igual a 390 y a 1440 px:
  - se ve la sección;
  - el vuelo sale a `https://www.google.com/travel/flights?tfs=Gh4SCjIwMjYtMTItMTIyAklCagUSA01FWHIFEgNNQUQaHhIKMjAyNi0xMi0xOTICSUJqBRIDTUFEcgUSA01FWEABQAFIAZgBAQ%3D%3D&hl=es-419` (MEX→MAD, 12–19 dic, 2 adultos, Iberia);
  - "Ya lo reservé" guarda `{status: "pending", category: "flight", raw_payload.compra_item: "vuelo:0:iberia"}`;
  - el contador pasa a "1 de 2";
  - sin desborde horizontal y sin errores de página.

**Capturas:**

| | 390 px | 1440 px |
|---|---|---|
| Antes: los botones estaban dentro de cada tarjeta, detrás de "Ver detalle" | `E2E-antes-390-viaje.jpg`, `E2E-antes-390-viaje-abajo.jpg` | `E2E-antes-1440-viaje.jpg`, `E2E-antes-1440-viaje-abajo.jpg` |
| Después: "Comprar mi viaje" | `E2E-despues-390-comprar.jpg` | `E2E-despues-1440-comprar.jpg` |
| Después: vuelo marcado "Ya lo reservé" | `E2E-despues-390-comprar-marcado.jpg` | `E2E-despues-1440-comprar-marcado.jpg` |

## 7. Resultados de las suites

- `npx vitest run src/test/enlacesCompra.test.ts src/test/tripPurchasePlan.test.tsx`: **26/26**. Contra la base `3db952a` fallan las 26: 20 por aserción y la suite de la UI no carga.
- Pruebas del bridge ajustadas al nuevo primer destino (Google Flights en lugar de Aviasales, con aserciones igual de estrictas: ruta, fechas, viajeros y aerolínea): `bookingBridge`, `bookingBridgeE2E`, `bookingBridgeAudit` y `bookingActionsUi` dan **116/116 + 6/6**. También se ajustaron `groundTransport` (14/14) y `liveSearchFallback` (4/4), que fijaban los enlaces rotos.
- **Suite completa:** `npx vitest run --testTimeout=60000` da 206 archivos y **2 284 de 2 285**. Falla `priveUx.test.tsx › sin texto en inglés…` ("YOUR WORLD IS READY"), y **también falla en `3db952a`** sin estos cambios: es del grupo Privé.
- `npx tsc --noEmit -p tsconfig.app.json`: sin errores. `npm run build`: OK.
- `deno check --no-lock` en `booking-bridge`, `booking-go`, `analizar-viaje`, `hotels-search`, `concierge-chat` y `flights-search`: 0 errores. El `deno.lock` versión 5 no lo lee Deno 2.1; por eso se usa `--no-lock`.
- ESLint en los archivos tocados: sin reglas nuevas violadas, salvo `no-explicit-any`, que ya domina el repo.

## 8. Seguridad

- **No se modificó:**
  - `allowlist.ts`, `resolver.ts`, `redirectToken.ts`, `linkcheck.ts` ni `handler.ts` (grupo `reservas`);
  - `booking-go`.
- **Los generadores nuevos usan dominios y rutas que la lista blanca ya permitía:** `google.com/travel/flights`, `google.com/maps`, `booking.com`, `kayak.com`, `getyourguide.com` y `resy.com`.
- **"Comprar mi viaje"** usa la misma URL que el resolver ya validó, la misma que la hoja abre sin consentimiento. El auto pasa por `checkAllowlisted` antes de mostrarse.
- La firma, la PSL y la huella del destino siguen iguales. La prueba E2E del bridge #1 sigue recorriendo `start_booking` → `booking-go` firmado → 302, y comprueba el destino.

## 9. Qué requiere autorización para producción

1. **Frontend** (despliegue de Lovable/Vercel): páginas de herramientas, detalle del viaje ("Comprar mi viaje"), "Mis reservas" y `affiliateLinks.ts`.
2. **Funciones de Supabase**, que se despliegan con el código compartido nuevo de `_shared/booking` y `_shared/airlines.ts`:
   - `hotels-search` (ENL-04: hoy en producción sigue mandando a `tp.media` con error 400; el cliente nuevo ya lo esquiva);
   - `analizar-viaje` (ENL-03);
   - `booking-bridge` y `booking-go` (ENL-01, 09 y 10);
   - `concierge-chat` (tarjeta de traslado).
3. **Sin migraciones.** "Ya lo reservé" usa `bookings`, que ya existe, con sus políticas actuales.
4. **Decisión del dueño:**
   - si se quiere que "Ya lo reservé" lo vea también el dueño del viaje cuando lo marca un colaborador (hoy `bookings` es por usuario);
   - la monetización de Google Flights y Kayak (hoy sin afiliado; Aviasales conserva su marker).

## 10. Límites y pendientes (dichos en la app)

- **BLOQUEADO, no comprobado aquí:**
  - Aeroméxico, Skyscanner, OpenTable, TheFork, Yelp, Tripadvisor, Viator, Rail Europe, Cruise Critic y, a veces, GetYourGuide y Rentalcars;
  - Expedia y Hotels.com, como referencia: la app no los usa.
  - Para una persona pueden abrir bien. La app no les promete datos que no se comprobaron.
- **Google Flights (tfs):** es el formato que Google usa en sus propias URLs; no es una API documentada. Si Google lo cambia, la prueba exacta de URL no lo detecta. Hay que volver a correr `scripts/enlaces/verify_enlaces.mjs`.
- **Booking.com por nombre puede traer un homónimo** (`D-BK-HOTEL.jpg`). Sin el id del hotel no hay ficha exacta, y la app lo advierte junto al botón.
- **Número de vuelo y tarifa exacta:** ningún sitio verificado los acepta por URL. La compra exacta de un vuelo sigue apagada (`exact_flight_form`) hasta probar SerpApi en vivo.
- **Restaurantes:** solo Resy recibió fecha y personas. La hora no se fija en ningún sitio.
- **Trenes, ferries, seguros, Discover Cars y Welcome Pickups** no reciben datos por enlace. Se abre su buscador y la app dice qué escribir.
- **`origin/main` avanzó** (`8f83f38`, commits de Privé) después de la base `3db952a` de esta rama. Ninguno de esos commits toca los archivos de este cambio, pero conviene rebasar antes de integrar.
