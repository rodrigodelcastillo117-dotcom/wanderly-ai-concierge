# Cierre 2 · grupo `enlaces`

Rama `claude/r2-enlaces` (base `3db952a`). El informe completo, con el inventario, la tabla por proveedor, las capturas, la experiencia "Comprar mi viaje" y los resultados de las suites, está en [`ENLACES_COMPRA.md`](./ENLACES_COMPRA.md).

## Hallazgos

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


## Suites

- Pruebas nuevas: 26/26. Con el código de antes fallan las 26.
- Mutaciones: 10/10 hacen fallar una prueba.
- Suite completa de Vitest: 2 284 de 2 285. La única que falla, `priveUx`, también falla en la base.
- tsc, build y `deno check` (6 funciones): sin errores.

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

