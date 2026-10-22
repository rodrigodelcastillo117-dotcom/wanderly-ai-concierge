# IATOS Booking Bridge · GO / NO-GO (Fase 13)

**Fecha:** 22 de octubre de 2026 · **Rama:** `claude/wc-bridge` · **Producción:** nada desplegado ni migrado (lo decide el líder).
Detalle técnico: [`IATOS_BOOKING_BRIDGE.md`](./IATOS_BOOKING_BRIDGE.md) · Matriz comercial: [`IATOS_BOOKING_BRIDGE_PROVEEDORES.md`](./IATOS_BOOKING_BRIDGE_PROVEEDORES.md) · Evidencia: [`evidencia/bridge/`](./evidencia/bridge/).

## Veredicto

| Alcance | Estado | Por qué |
|---|---|---|
| **v1 "sin APIs comerciales"** (botones honestos, salida verificada, solicitud por canal oficial, seguimiento y comprobante declarado) | **GO condicionado** | Código, migración y pruebas listos y en verde; 47 enlaces reales abiertos. Condiciones: (1) desplegar migración `20261023180000` + funciones `booking-bridge`, `booking-go`, `booking-links-cron`; (2) programar `booking-links-cron`; (3) prueba manual en iPhone y Android de los dos flujos (salida y WhatsApp). |
| Compra **exacta** de un vuelo (Google Flights `booking_request`) | **NO-GO** (apagado por bandera) | El formato está documentado por SerpApi pero no se pudo probar en vivo (no hay llave de SerpApi en este entorno). |
| "Comprobar precio" (vuelos y hoteles) | **GO con verificación pendiente** | Probado con respuestas de la forma documentada; gasta una búsqueda en vivo por uso (límite 3/min, 20/h). Falta 1 prueba real por tipo tras desplegar (≤ 2 de las 8 búsquedas permitidas). |
| Compra integrada (Duffel, Booking Demand, OpenTable, Viator Full+Booking) | **NO-GO** | No hay contratos ni cuentas (ver matriz). |

## Proveedores conectados (sin contrato nuevo)

- **Aviasales** (Travelpayouts, marker 533299 ya configurado): búsqueda exacta de ruta + fechas + pasajeros. **7/7 rutas verificadas** (F1–F7) y cambio de fechas (F10).
- **Booking.com**: búsqueda por hotel + fechas + huéspedes. **10/10** muestran el hotel buscado, fechas y ocupación (H1–H10, X5 móvil).
- **Páginas públicas de reserva** del catálogo Privé: Resy, SevenRooms, Tock (Masala y Maíz), sitios oficiales — **6/10 restaurantes verificados** (R5–R10); OpenTable ×3 y Tock Quintonil devolvieron **403 a navegador automático** (no se evadió).
- **Experiencias** (sitios oficiales de operadores y boletos): **7/7 verificadas** (E1–E7). GetYourGuide y Viator: 403 (E8–E9).
- **WhatsApp** click-to-chat con mensaje prellenado: verificado (E10 abre el chat de "Mar Adentro Excursiones" con el texto).
- **Google Maps** ficha/búsqueda: verificado (X2).
- **Google Flights / Google Hotels vía SerpApi** (búsqueda exacta, comprobar precio, enlaces de precio): conectado en código, **no verificado en vivo**.

## Proveedores pendientes de contrato

Duffel (Links: país de la empresa NO VERIFICADO), Booking.com Demand API (managed partner + contrato), OpenTable (partner), Viator (Basic = alta propia; Full+Booking con certificación), GetYourGuide (partner API), Amadeus (Self-Service **cerrado el 17-jul-2026**; solo Enterprise), Distribusion/ADO. Ninguna solicitud fue enviada.

## Tipos de reserva disponibles en v1

| Tipo | Modo | Ejemplo de botón |
|---|---|---|
| Búsqueda equivalente | `PROVIDER_SEARCH` | Buscar este vuelo · Ver tarifas del hotel · Buscar mesa · Buscar en GetYourGuide |
| Página oficial de reservas | `PROVIDER_SEARCH` | Abrir reservas |
| Solicitud enviada por el usuario | `REQUEST` | Escribir por WhatsApp · Escribir al restaurante · Llamar al restaurante · Contactar al operador |
| Solicitud asistida / Privé | `REQUEST` | Solicitar asistencia |
| Informativo | `UNAVAILABLE` | Sitio oficial · Ver en Google Maps · Guardar en el viaje |
| Oferta exacta | `EXACT_DEEP_LINK` | Comprar esta oferta — **apagado** |
| Compra alojada / integrada | `HOSTED_CHECKOUT` / `IN_APP_BOOKING` | — (sin contratos) |

## Flujos E2E

**Aprobados (automatizados con proveedores simulados, `bookingBridgeE2E.test.ts`, 22/22):** 1 cotización de vuelo y botón · 2 vuelo con dos escalas · 3 cambio de fechas · 4 oferta caducada · 5 precio diferente · 6 hotel con disponibilidad · 7 hotel agotado · 8 habitación incorrecta · 9 restaurante con sistema · 10 restaurante sin sistema · 11 tour con compra externa · 12 Privé con solicitud · 13 abandono · 14 regreso a IATOS · 15 comprobante · 16 sin API · 17 proveedor caído · 18 link roto · 19 URL manipulada · 20 compras repetidas. Más 35 casos SQL (`supabase/tests/bridge`), 68 unitarios, 4 de UI y 6 de revisión de enlaces.

**Con enlaces reales (no destructivo):** 10 vuelos (9 válidos + 1 formato descartado), 11 hoteles (10 + el redirect de afiliado roto), 10 restaurantes, 10 experiencias, roto (soft 404 de Resy detectado), homónimos (Maps), móvil (iPhone ×3), bloqueado (403 ×7), 9 redirecciones peligrosas rechazadas por la lista blanca.

**Bloqueados / no probados en vivo:** precio diferente y comprobar precio reales (sin SerpApi); compra exacta de vuelo; salida firmada `booking-go` y "regreso a IATOS" en producción (función no desplegada; probado con mocks); OpenTable, Tock Quintonil, GetYourGuide y Viator (403 a automatización).

## Hallazgos que la verificación real destapó

1. **`tp.media/click` responde HTTP 400** (afiliado de Booking, GetYourGuide, Viator, Omio, Skyscanner, Kayak, etc.). En el bridge se abre el destino directo; el resto de la app sigue rota → **DECISIÓN DEL DUEÑO** (matriz §3).
2. **Google Flights `?q=` abre el formulario vacío**: se quitó del bridge (la app lo sigue usando en "Ver todo en Google Flights").
3. Agujero en la regla de "fuente confiable" (`google.com/url?q=`, `tp.media` con destino falso): corregido antes de cerrar.

## Costos

- Sin costo nuevo fijo. "Comprobar precio" = 1 búsqueda de SerpApi por uso (de la bolsa en vivo del plan del usuario). `booking-links-cron`: solo peticiones HTTP a sitios públicos (≤ 20 por corrida, 1 por host).
- Esta entrega no hizo ninguna llamada a SerpApi ni a APIs de pago (0 de las 8 permitidas).

## Riesgos

| Riesgo | Mitigación en v1 | Pendiente |
|---|---|---|
| Que el usuario crea que ya compró | Textos honestos en cada paso; `CONFIRMED` solo con evidencia; frases prohibidas para Iato (`findFalseClaims`) | Que concierge2 aplique `findFalseClaims` a sus respuestas |
| Términos de uso de sitios de terceros | Solo se abren páginas públicas; sin automatizar reservas ni pagos; robots.txt; 1 host por corrida; 403 no se evade | Revisión legal de términos de Booking/OpenTable para enlazar páginas públicas |
| Datos personales (LFPDPPP) | Consentimiento explícito para guardar la selección y el comprobante; sin datos de pago (CHECK + Luhn); el mensaje lo envía el usuario desde su app | Actualizar el aviso de privacidad para mencionar el seguimiento de reservas |
| Enlaces que cambian o se rompen | `booking_link_checks` con fecha, fuente, caducidad; detección de soft 404 y redirecciones a otro dominio | Programar el cron |
| Pérdida de atribución de afiliados | No se cambió la configuración; Drive sigue cargando con consentimiento | Decisión del dueño sobre `tp.media` |
| Responsabilidad si un proveedor falla | IATOS no cobra ni emite: el proveedor procesa y reembolsa | — |

## Siguientes integraciones prioritarias

1. Desplegar v1 y programar `booking-links-cron`; 2 búsquedas reales de SerpApi para validar "Comprobar precio" y la búsqueda exacta de Google Flights.
2. Arreglar la atribución de Travelpayouts (decisión del dueño).
3. googlemax: pasar `booking_token`, `google_flights_url` y `property_token` hasta la página del viaje; `place_id` y teléfono de Google Places para restaurantes que no están en el catálogo.
4. reservas: llamar `booking_intent_apply_external` y activar `BOOKING_RESERVAS_EMAIL`.
5. Viator Basic → Duffel Links (si México es elegible) → Booking.com afiliado.
