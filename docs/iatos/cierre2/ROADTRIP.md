# ROADTRIP — el coche como opción de primera clase (cierre 2, 22-oct-2026)

Pedido del dueño: *"hay que meter el tema de ROADTRIPS tipo por italia, y países de europa. que sea una opción el coche!"*

Rama `claude/r2-roadtrip` (worktree `/home/user/wt-r2-roadtrip`), base `3db952a`. Nada desplegado, nada empujado, sin migraciones, sin consultas a producción. Las únicas peticiones externas fueron GET públicos de solo lectura a sitios oficiales para verificar fuentes, y GET a Kayak para verificar el formato del enlace.

## 1. Qué se construyó

| ID | Qué | Prueba (falla antes / pasa después) | Dónde (archivo:línea, commit) | Mutación | Estado |
|---|---|---|---|---|---|
| RT-01 | Datos curados con fuente (avisos por país, precios oficiales de combustible y viñetas, 10 rutas) y cálculos: distancia/tiempo por tramo, combustible, costos etiquetados, rentas y devolución en otro lugar, paradas sugeridas | `src/test/roadtripPlan.test.ts` (25) y `src/test/roadtripNotices.test.ts` (10). Antes no existía el módulo: las pruebas no pueden importar nada | `supabase/functions/_shared/roadtrip/{sources,data,plan}.ts`, `eed63a3` | M3: un tramo estimado marcado CONSULTADO → 6 fallan. M4: renta con monto inventado → 4 fallan. M6: sin aviso one-way → 2 fallan | HECHO |
| RT-02 | Reservar el auto por el camino seguro: fuente `car_rental` en booking-bridge; el servidor arma la búsqueda de Kayak Cars con recogida, devolución y fechas; booking-go firma la salida | `src/test/roadtripCarRental.test.ts` (10). Antes `resolve`/`start_booking` con `car_rental` daban `BAD_INPUT` | `_shared/booking/carRental.ts` (nuevo); `booking-bridge/handler.ts:19,97-98,113-116,185-187`; `src/lib/bookingBridgeApi.ts:12-13`; `88b123a` | M1: quitar el `parseSource` de `car_rental` → 3 fallan | HECHO |
| RT-03 | logistics-plan: `prefs.transport_mode` (`avion`/`tren`/`coche`/`mixto`) y `prefs.leg_modes`; Google Routes por tramo en coche; `logistics.road_trip` y `logistics.leg_modes`; el modelo recibe los km reales y ya NO se le pide calcular gasolina ni casetas (antes las inventaba en `mandatory_costs.notes`) | `src/test/roadtripLogistics.test.ts` (6) | `logistics-plan/roadtrip.ts` (nuevo); `logistics-plan/index.ts:32-35,57-58,342,519-523,571-583,606,624,659,869`; `c464967` | (cubierta por M3: la etiqueta viene de `plan.ts`) | HECHO |
| RT-04 | Iato entiende "quiero hacer un road trip por la Toscana en 7 días" en el modo normal del concierge (intención `road_trip` del planeador existente): notas con la ruta curada, reparto de días, tramos ESTIMADOS, costos honestos y avisos con fuente, más una card con "Planear en IATOS", "Ruta en Google Maps" y "Fuente oficial". Sin región, pregunta por ella | `src/test/roadtripIato.test.ts` (6) | `concierge-chat/roadtrip.ts` (nuevo); `concierge-chat/planner.ts:16-17,24,59-60,324-330`; `0a96909` | M2: no agregar la intención → 4 fallan | HECHO |
| RT-05 | UI: selector "Cómo te mueves entre paradas" (Avión, Tren, **En coche (road trip)**, Mezclar por tramo) en `/dashboard/ruta`, vista previa ESTIMADA sin costo de API, panel del road trip en el viaje (`/dashboard/viajes/:id`) con tramos, costos, renta y avisos; ideas de road trips en Planear (plegadas) y Descubre; "road trip por la Toscana" en Planear abre la ruta en coche; Renta de auto acepta "Devolver en otra ciudad" | `src/test/roadtripUi.test.tsx` (9) | `src/components/roadtrip/*` (nuevos), `src/lib/roadtrip.ts`; `MultiDestRoute.tsx:33-36,100-106,228-237,282,561-565,597-598,776-777`; `TripDetail.tsx:45,566-569`; `PlanTrip.tsx` (import, `interpretarFrase`, `analizar`, paso 1); `Discover.tsx`; `TripCars.tsx`; `9840f12` | M5: no mandar `transport_mode` → 1 falla | HECHO |
| RT-06 | Evidencia visual con datos simulados, 390 y 1440 px (12 pantallas × 2) | `scripts/roadtrip/ui_evidence.mjs` + `make_fixtures.ts` | `docs/iatos/evidencia/roadtrip/`, `52c2484` | — | HECHO |

Las mutaciones se hicieron quitando cada parte, corriendo las pruebas y restaurando (salida en esta sesión: M1 3 fallan, M2 4, M3 6, M4 4, M5 1, M6 2).

## 2. De dónde sale cada dato y qué es en vivo o estimado

| Dato | Estado que ve el usuario | Fuente |
|---|---|---|
| Distancia y tiempo de manejo por tramo (viaje generado) | **CONSULTADO** (Google Maps, sin tráfico, con fecha y hora) | Google Routes `computeRoutes`, SKU Compute Routes Essentials, desde `logistics-plan` con `_shared/google-routes.ts` (la misma API que ya usa la app; queda en `ai_usage_log`) |
| Lo mismo si Google no responde, o en la vista previa antes de generar, o en Iato | **ESTIMADO** ("aprox. (línea recta)") | Línea recta entre coordenadas aproximadas del centro × 1.3, a 70 km/h. Sin coordenadas: **SIN DATOS** (no se inventa) |
| Combustible | **ESTIMADO** con la fórmula a la vista | km × 7 L/100 km (supuesto, gasolina) × precio promedio con impuestos del país. UE: Comisión Europea, Weekly Oil Bulletin, semana del 19-oct-2026 (publicado el 22-oct-2026). Reino Unido: GOV.UK Weekly road fuel prices, 19-oct-2026. Islandia y Suiza: **POR CONFIRMAR** (sin precio oficial verificado) |
| Viñetas | **CONSULTADO** (precio oficial publicado) según los días con auto | Austria (oesterreich.gv.at: 1 día 9.60 €, 10 días 12.80 €, 2 meses 32 €, anual 106.80 €), Suiza (BAZG: 40 CHF), Chequia (eDalnice.gov.cz: 210/290/460/2,440 CZK) |
| Renta del auto | **POR COTIZAR**, sin monto | Botón "Buscar auto de renta" (Kayak Cars por el Booking Bridge). IATOS no tiene tarifas de renta en vivo |
| Cargo por devolver en otro lugar | **POR COTIZAR**, sin monto, con aviso | Lo da la arrendadora al cotizar |
| Casetas / peajes | **POR CONFIRMAR** | Sin tarifa por tramo verificable |
| Estacionamiento | **POR CONFIRMAR** | Depende del hotel y de la ciudad |
| Paradas sugeridas | Etiquetadas con la ruta oficial de la que salen | Paradas de las rutas curadas que quedan de camino (rodeo ≤ 20 % del tramo o ≤ 15 km) |
| Rutas curadas | Paradas y días **según la fuente**; lo que la fuente no dice dice "sugerencia IATOS" | Ver §4 |
| Fotos de las ideas | "Foto ilustrativa" (Pexels, `SmartImage`) | Función `pexels-image` existente |

Los costos del coche se muestran aparte y **no se suman** al total del viaje (lo dice el panel). La suma parcial por moneda solo incluye lo que tiene monto (combustible estimado y viñetas oficiales).

## 3. Avisos por país (todas las URL abiertas con GET público el 22-oct-2026)

| Aviso | Regla (resumen) | Fuente |
|---|---|---|
| Italia · ZTL | Centros históricos con acceso restringido; cámara en cada acceso; multa por pasada (≈100 € según la ciudad) que llega aunque el auto sea rentado (la arrendadora puede cobrar comisión); pedir al hotel que registre la placa | https://www.evz.de/en/topics/transport/car/fines-abroad/ztl-italy/ (Centro Europeo del Consumidor, ECC-Net; actualizado 19-ene-2026) y https://romamobilita.it/servizi-al-pubblico/ztl/ |
| Italia · licencia | Licencia de fuera de la UE: con permiso internacional o traducción oficial; multa 408–1,634 € | https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:1992-04-30;285~art135 |
| España · licencia | La DGT aconseja el permiso internacional para licencias de fuera de la UE/EEE | https://www.dgt.es/nuestros-servicios/permisos-de-conducir/permisos-extranjeros-y-de-fuerzas-y-cuerpos-de-seguridad/conducir-con-un-permiso-extranjero/ |
| Francia · licencia | Estancia corta: licencia en francés o con permiso internacional o traducción oficial | https://www.service-public.gouv.fr/particuliers/vosdroits/F1459 |
| Alemania · licencia | Traducción al alemán salvo que tengas permiso internacional | https://www.bmv.de/SharedDocs/EN/Articles/StV/Roadtraffic/validity-foreign-driving-licences-in-germany.html |
| Portugal · licencia | 185 días solo si el país tiene acuerdo o es parte de Ginebra 1949/Viena 1968; México no aparece en las listas del IMT → confirmar | https://www.imt-ip.pt/condutores/reconhecimento/troca-de-titulo-de-conducao-estrangeiro/paises-aderentes-as-convencoes-e-outras-situacoes/ y su PDF de países |
| Suiza · licencia | Licencia internacional en algunos casos (p. ej. categorías no en caracteres latinos) | https://www.ch.ch/en/vehicles-and-traffic/driving-licence/international-driving-licence/ |
| Gran Bretaña · licencia | Visitante: 12 meses desde la última entrada | https://www.gov.uk/driving-nongb-licence/y/a-visitor-to-great-britain/any-other-country |
| Islandia · licencia | Fuera del EEE: válida 6 meses | https://island.is/en/help/transport-authority/studies-and-rights/do-foreign-driving-licences-apply-in-iceland |
| Austria · viñeta | Obligatoria en autopistas y vías rápidas; precios 2026 | https://www.oesterreich.gv.at/en/themen/mobilitaet/kfz/10/Vignette-und-Maut/Vignette-fuer-Fahrzeuge-bis-3,5-t |
| Suiza · viñeta | 40 CHF, del 1-dic al 31-ene del año siguiente | https://www.bazg.admin.ch/en/e-vignette-and-adhesive-vignette-two-types |
| Chequia · viñeta | Electrónica; multa hasta 20,000 CZK | https://edalnice.gov.cz/en |
| Reino Unido · lado | Por la izquierda (Highway Code, regla 160) | https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203 |
| Irlanda · lado | Todo el tránsito por la izquierda (Your Europe, revisado 18-sep-2024) | https://europa.eu/youreurope/citizens/travel/driving-abroad/road-rules-and-safety/ireland/index_en.htm |
| Islandia · carreteras | Ruta 1 sin 4x4; fuera del verano revisar cierres (SafeTravel) | https://www.visiticeland.com/article/the-ring-road/ |
| Frontera con auto rentado | Preguntar por escrito países permitidos, seguro y cargos (letra chica) | https://evropskyspotrebitel.gov.cz/cars-and-traffic/how-to-avoid-problems-when-renting-a-car-abroad/ |

## 4. Rutas curadas (fuente oficial de cada una)

Toscana (Visit Tuscany, 4 días), Costa Amalfitana (Italia.it), Dolomitas (Dolomiti.it, Strada delle Dolomiti Bolzano–Cortina), Sicilia oriental (Visit Sicily), Provenza y Costa Azul (Provence-Alpes-Côte d'Azur Tourisme, 5 días), Algarve · Rota de Sagres (Visit Algarve, PDF, ~122 km), Andalucía (Spain.info/Turespaña, 7 días, 740–800 km, primavera), Baviera · Ruta Romántica (romantischestrasse.de, 460 km), Escocia · North Coast 500 (VisitScotland, 516 millas, 5–7 días, abr–jun o sep–oct), Islandia · Ring Road (Visit Iceland, 1,322 km, 7+ días, todo el año). URLs exactas en `supabase/functions/_shared/roadtrip/sources.ts`. La mejor época de Amalfi, Dolomitas, Sicilia, Provenza, Algarve y Baviera NO viene de la fuente: la pantalla dice "sugerencia IATOS".

## 5. Reserva del auto (Booking Bridge)

- Enlace: `https://www.kayak.com/cars/<recogida>/<devolución>/<AAAA-MM-DD>/<AAAA-MM-DD>` (o una sola ciudad). Verificado con GET el 22-oct-2026: `/cars/Florence/Rome/2026-11-10/2026-11-17` → 200, título "Florence to Rome, 11/10 – 11/17" (evidencia `EV-KAYAK-CARS-ONEWAY`). `kayak.com` ya estaba en `allowlist.ts` ("kayakCarsLink"): **no se tocó la lista blanca**.
- Flujo: `BookingActions` → `BookingSheet` → `booking-bridge start_booking` (`source: {type:"car_rental", …}`) → el servidor arma la URL con `carRental.ts` (ignora cualquier URL del cliente) → `booking-go` firma y redirige. Es una búsqueda (`PROVIDER_SEARCH`), nunca "Comprar esta oferta".
- Limitación conocida: Kayak resuelve homónimos a su manera ("Lagos" puede ser Nigeria); el aviso del bridge dice "Es una búsqueda: confirma en el proveedor que sea el mismo lugar".

### Para la fusión (otros grupos)
- **reservas** (`booking-bridge/handler.ts`): +15 líneas — import de `offerFromCarRental`, variante `car_rental` en `Source`, su `parseSource` (fechas ISO, ciudades acotadas a 80 caracteres, sin URL) y una rama en `buildOffer`. No toca `allowlist.ts`, `resolver.ts`, `redirectToken.ts`, `linkcheck.ts` ni `booking-go`.
- **reservas/enlaces** (`src/lib/bookingBridgeApi.ts`): +2 líneas en el tipo `BridgeSource`.
- **enlaces**: no se tocó `src/lib/affiliateLinks.ts` ni `_shared/booking/offers.ts`; el generador one-way vive en `_shared/booking/carRental.ts` (reusa `stableId` y `resolveBookingActions`). Si "Comprar mi viaje" quiere incluir el auto, puede llamar `offerFromCarRental` con `logistics.road_trip.rentals[]`.
- `TripDetail.tsx`: +4 líneas (panel debajo de "Qué sigue"); `TripCars.tsx`: campo "Devolver en otra ciudad".

## 6. Costo de API por viaje

- Una llamada Compute Routes **Essentials** por tramo en coche al generar el plan (sin tráfico), tope 12 por plan. Precio de lista: 5 USD por 1,000 (≈ 0.005 USD por tramo) con 10,000 gratis al mes (https://developers.google.com/maps/billing-and-pricing/pricing, consultado 22-oct-2026). Ejemplo: Toscana de 5 tramos ≈ 0.025 USD de lista; 0 dentro de la franja gratis. Se registra en `ai_usage_log` por `googleTransportFor`.
- Vista previa en `/dashboard/ruta` e Iato: **0 llamadas** (estimación local).
- Si el proyecto usa el conector de Lovable, cuenta para su tope de 6,000 solicitudes de servidor cada 24 h (ver `_shared/google-runtime.ts`).
- Fotos de las ideas: Pexels por la función existente, solo cuando el usuario las ve (en Planear están plegadas).
- Sin costo de modelo adicional: Iato usa el mismo turno; logistics-plan el mismo prompt (un bloque de texto más).

## 7. Calidad (resultados exactos)

- Pruebas nuevas: 6 archivos, 66 pruebas, todas pasan (`roadtripPlan` 25, `roadtripNotices` 10, `roadtripCarRental` 10, `roadtripLogistics` 6, `roadtripIato` 6, `roadtripUi` 9).
- Vitest completo: **210 archivos, 2,325 pruebas: 2,324 pasan, 1 falla, 7 errores no manejados**. La falla (`priveUx.test.tsx` "sin texto en inglés…") y los 7 errores (`tripSelectionsPersist`, `godtierTripDetail`) **también ocurren en la base `3db952a` sin mis cambios** (verificado en un checkout limpio). Una prueba que mis cambios rompieron al principio (`godtierPlan`: las ideas pedían fotos en el paso 1) se resolvió plegando las ideas en Planear, sin tocar la prueba.
- `npx tsc --noEmit -p tsconfig.app.json`: sin errores. `npm run build`: OK.
- `deno check` (2.1.4) de `logistics-plan`, `booking-bridge`, `booking-go` y `concierge-chat`: OK. Nota: con el `deno.lock` actual (versión 5) Deno 2.1 se niega a arrancar; se corrió con `--no-lock` (el lock no se modificó).
- Playwright con datos simulados: 24 capturas en `docs/iatos/evidencia/roadtrip/` (12 pantallas × 390 y 1440), `manifest.json` sin errores de página y **sin desplazamiento horizontal** en ninguna. Cada captura lleva la franja "DATOS SIMULADOS". Las distancias "Consultado" de las capturas son una respuesta de Google **simulada**; el texto de Iato es **simulado** (la card y sus enlaces son los del planeador real). Las fotos de Pexels se bloquearon en la evidencia (se ve el respaldo sin foto).
- Sin SQL: no hizo falta tabla nueva (`booking_intents.product_type` ya admite `transport`; el plan viaja en `trips.itinerario_json.logistics.road_trip`).

## 8. Qué requiere autorización para producción

- **Funciones** (desplegar): `logistics-plan` (modo por tramo, Google Routes por tramo, `road_trip`), `booking-bridge` (fuente `car_rental`), `concierge-chat` (intención `road_trip`). `booking-go` no cambia.
- **Frontend** (publicar): ruta de varios destinos, detalle del viaje, Planear, Descubre y Renta de auto.
- **Secretos**: ninguno nuevo (usa `GOOGLE_MAPS_API_KEY`/`LOVABLE_API_KEY` existentes). Confirmar que la API Routes esté habilitada en el proyecto de Google.
- **Migraciones**: ninguna.
- **Mantenimiento**: precios de combustible (semanal) y de viñetas (anual) son datos curados con fecha; hay que actualizarlos (o automatizar la lectura del Weekly Oil Bulletin y del CSV de GOV.UK — no se hizo).

## 9. BLOQUEADO / PENDIENTE

- **Eslovenia (viñeta)**: dars.si y evinjeta.dars.si cortan la conexión desde este entorno; no se pudo verificar → no se incluye.
- **Viñetas de Eslovaquia y Hungría, peajes por tramo (Italia, Francia, España, Portugal)**: sin fuente oficial verificada con tarifa → "por confirmar".
- **Irlanda (licencia)**: rsa.ie responde 403 y la página de Citizens Information no existe en la URL esperada → solo se incluye el lado de manejo (Your Europe).
- **Combustible en Suiza e Islandia**: sin precio oficial verificado → "por confirmar".
- **Fuente oficial de Andalucía (andalucia.org)**: la página se arma con JavaScript y el PDF de la Ruta de al-Ándalus tiene el certificado vencido; se usó Spain.info (Turespaña).
- **Tarifas de renta en vivo**: no hay proveedor de autos conectado; la renta queda "por cotizar" con el botón de búsqueda.
- **Foto real en la evidencia**: Pexels bloqueado en la prueba; en la app se ve la foto ilustrativa si `pexels-image` responde.
- **Prueba en vivo de Google Routes** desde `logistics-plan`: no se ejecutó (prohibido consultar producción); cubierta con Routes simulado.
