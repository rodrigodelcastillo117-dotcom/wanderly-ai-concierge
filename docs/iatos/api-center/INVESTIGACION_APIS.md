# Investigación de acceso REAL a APIs: proveedores Travelpayouts y fuentes públicas

**Proyecto:** IATOS AI (super-app de viajes para México, UI en español, precios en MXN, Supabase Edge Functions)
**Fecha de investigación / acceso a fuentes:** 2026-10-28 (todas las URLs consultadas en esa fecha salvo que se indique otra)
**Método:** documentación oficial, Help Center de Travelpayouts (leído vía la API pública de Zendesk de support.travelpayouts.com), portales de desarrolladores, páginas de programa de travelpayouts.com/en/offers/*, y pruebas reales sin credenciales (curl) cuando el endpoint es público.

**Convenciones**
- "Comisión anunciada" = lo que publica la página del programa; **no está garantizada**, el dashboard de Travelpayouts manda.
- "no verificado" = no se encontró fuente oficial o no se pudo comprobar. No se adivina.
- Credenciales: solo se indica el **nombre** de la variable a guardar en Supabase secrets; nunca se piden valores.
- **ALERTA SALDO** = API cuyas reservas/compras se cobran del saldo/depósito del socio (el socio pasa a ser comerciante o revendedor).

---

## A. Travelpayouts (plataforma)

### A1. Partner Links API (generación oficial de enlaces de afiliado)
- **Doc:** https://support.travelpayouts.com/hc/en-us/articles/25289759198226-API-for-Travelpayouts-partner-links (actualizado 2026-09-28)
- **Endpoint:** `POST https://api.travelpayouts.com/links/v1/create`
- **Auth:** header `X-Access-Token` con el token existente de Travelpayouts (Profile → API token).
- **Body:** `trs` (ID del proyecto suscrito al programa), `marker` (ID de socio), `shorten` (true/false), `links[]` con `url` (URL larga de la marca, no acortada) y `sub_id` opcional.
- **Límites:** 100 solicitudes/min por marker; máx. 10 links por solicitud.
- **Programas soportados:** cualquier marca a la que el proyecto esté conectado/aprobado, **excepto** Kiwi.com, Expedia UK, HolidayTaxis, Ticketmaster, Priority Pass e Indrive. Errores por link: `trs is not subscribed for brand`, `can't create partner link` (marca no soportada o URL inválida). La respuesta global puede ser `200 success` aunque links individuales fallen: hay que revisar `links[].code`.
- **Costo:** gratis.
- **Pasos del dueño:** (1) confirmar que cada programa está aprobado para el proyecto (trs) correcto; (2) anotar `marker` y `trs` (no son secretos, pero se guardan como config); (3) nada más: se reutiliza el token.
- **Credenciales:** `TRAVELPAYOUTS_API_TOKEN` (ya existe), config `TRAVELPAYOUTS_MARKER`, `TRAVELPAYOUTS_TRS`.
- **Veredicto: RECOMENDADO AHORA** — convierte cualquier deep link de las ~25 marcas en link rastreable con `sub_id` por usuario/sesión, sin costo y con el token que ya tenemos. Cachear el `partner_url` por URL+sub_id.

### A2. Aviasales Data API (ya en uso)
- **Doc:** https://support.travelpayouts.com/hc/en-us/articles/203956163-Aviasales-Data-API (2026-09-06); requisitos: https://support.travelpayouts.com/hc/en-us/articles/203956083 (2026-08-28); límites: https://support.travelpayouts.com/hc/en-us/articles/4402565416594-API-rate-limits (2026-10-22)
- **Qué es:** precios **de caché** basados en búsquedas de usuarios de Aviasales; se guardan 7 días ("recomendado para páginas estáticas"). Cada búsqueda pertenece a un `market`; usar el market adecuado. Parámetro `currency` (default RUB). Soporte de MXN: **no verificado** en esta investigación (el dueño ya lo usa; confirmar en código).
- **Acceso:** libre con token, sin aprobación.
- **Límites por minuto (desde 2024-06-14):** `/aviasales/v3/prices_for_dates` 600, `/v3/get_latest_prices` 300, `/v3/grouped_prices` 600, `/v3/get_special_offers` 600, `/v3/search_by_price_range` 600, `/v1/prices/calendar` 300, `/v2/prices/month-matrix` 300, `/graphql/v1/` 60, etc. 429 al exceder; headers `X-Rate-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Reset`. Travelpayouts pide cachear.
- **Search API en tiempo real:** solo con **≥50,000 MAU confirmados** (https://support.travelpayouts.com/hc/en-us/articles/210995808, 2026-10-13); proyectos pre-lanzamiento no califican, sin excepciones.
- **Nota relacionada:** Hotellook cerró el 2025-10-20; su API y widgets dejaron de funcionar (https://support.travelpayouts.com/hc/en-us/articles/29534131568530).
- **Veredicto: RECOMENDADO AHORA (mantener)** — útil para "precio visto recientemente", pero la UI debe decir que es precio de caché (hasta 7 días) y no tarifa reservable.

### A3. Statistics API (conversiones) y Finance API
- **Statistics:** https://support.travelpayouts.com/hc/en-us/articles/360019864079-API-of-affiliate-programs-booking-statistics (2026-09-20)
  - `GET https://api.travelpayouts.com/statistics/v1/get_fields_list` (`?data_type=aggregated`, `?campaign_id=<id>` para campos por programa).
  - `POST https://api.travelpayouts.com/statistics/v1/execute_query` con `fields`, `filters` (filtro de `date` **obligatorio**), `sort`, `group`, `offset`, `limit` (100 default, máx. 10,000).
  - Campos útiles como evidencia de conversión del proveedor: `action_id`, `external_click_id`, `sub_id`, `state` (paid/processing/canceled), `price_*`, `paid_profit_*`, `created_at`, `updated_at`; `action_type` ∈ booking/paid_click/advertise_profit.
  - Límite: `/statistics/v1/execute_query` **30 req/min**.
- **Finance:** https://support.travelpayouts.com/hc/en-us/articles/5169505760402 (2026-10-22): `GET /finance/v2/get_user_balance`, `get_user_actions_affecting_balance` (filtros `campaign_id`, `action_state`, `from/until`, `limit` ≤300), `get_user_payments`, `get_action_details?action_id=` (incluye `sub_id` y metadata por programa).
- **Auth:** `X-Access-Token` (mismo token). **Costo:** gratis.
- **Pasos del dueño:** ninguno adicional (mismo token). Definir convención de `sub_id` (p.ej. id de sesión/itinerario hasheado, sin PII).
- **Credencial:** `TRAVELPAYOUTS_API_TOKEN`.
- **Veredicto: RECOMENDADO AHORA** — única forma honesta de registrar conversiones: solo marcar "reservado" cuando exista `action_id` con `state` del proveedor, cruzando por `sub_id`. Sincronizar por cron (≤30 rpm). La latencia de aparición de acciones: **no verificado**.

---

## B. Traslados

### B1. GetTransfer — **ALERTA SALDO**
- **Doc (Travelpayouts):** https://support.travelpayouts.com/hc/en-us/articles/360016375920-GetTransfer-API (2026-07-02); listado de marcas con API: https://support.travelpayouts.com/hc/en-us/articles/20384016664594 (2026-09-29, "Requires brand approval: Yes").
- **Programa:** https://www.travelpayouts.com/en/offers/gettransfer-affiliate-program/
- **Acceso:** token por correo a support@travelpayouts.com indicando el email de registro en la interfaz web (para test y producción). Header `X-ACCESS-TOKEN`.
- **Entornos:** test `https://gtrbox.org/api` (UI gtrbox.org) — **sí hay sandbox**; producción `https://gettransfer.com/api`.
- **Endpoints:**
  - Cotización: `GET /api/route_info?points[]=lat,lng&points[]=lat,lng&with_prices=true&pax=&date_to=&currency=&distance_unit=` → precios `min` y `book_now` por clase (economy, comfort, business, van, minibus…). Fecha ≥6 h después de la solicitud; si no hay `book_now` la ruta no es reservable; **precios se actualizan una vez al día (noche UTC)**.
  - Crear solicitud: `POST /api/transfers` (from/to con nombre+coords o Google Place ID, fecha local, pax, sillas infantiles, `partner_passenger`).
  - **Pago: `POST /api/payments` con `gateway_type: "ground"` = "payment from your partner balance". "All transfers are paid from your account balance, ask your account manager about payment terms."** Error `price: is_too_big` si no hay saldo.
  - Webhook: callback de estado (`transfer_status_changed`: performed, canceled, completed, …) — se envía la URL a soporte; luego `GET /api/transfers/:id/offers` para datos de conductor/vehículo.
  - Rate limit: 429 + `Retry-After` (cifra no publicada).
- **Comisión anunciada:** 4–25% (12.5% / 25% / 4.15% según tipo; B2B 365 días); cookie 30 días; 150+ países (página de programa).
- **Pasos del dueño:** (1) escribir a support@travelpayouts.com pidiendo token de **test** y producción para GetTransfer API; (2) **no** solicitar ni fondear saldo hasta tener contrato/términos de pago; (3) si se quiere callback, mandar la URL de la Edge Function; (4) probar `route_info` en gtrbox.org.
- **Credenciales:** `GETTRANSFER_API_TOKEN`, config `GETTRANSFER_API_BASE` (gtrbox vs producción).
- **Veredicto: RECOMENDADO AHORA solo para cotización (route_info) en sandbox; NO activar `/api/payments`** — da precio real por coordenadas (aeropuerto→hotel), pero reservar convierte a IATOS en pagador/comerciante con saldo prepagado.

### B2. Kiwitaxi
- **Doc TP:** https://support.travelpayouts.com/hc/en-us/articles/360022819172 (2026-10-20) — solo deep links `https://kiwitaxi.com/{lang}/{country}` (incluye `es`) convertidos en el generador.
- **API:** Kiwitaxi ofrece "Web-API" / "Deep API" a agencias vía b2b@kiwitaxi.com (https://kiwitaxi.agency/page35642034.html, https://kiwitaxi.com/en/contacts). Documentación pública: **no verificado**; existe un cliente Go no oficial (https://github.com/liderman/go-kiwitaxi-api) cuyo estado actual es **no verificado**. Si un acceso B2B atribuye vía Travelpayouts: **no verificado**.
- **Comisión anunciada (TP):** 9–11% (50% del ingreso de Kiwitaxi); cookie 30 días. Prohibido publicar en sitios de terceros sin permiso.
- **Pasos:** usar Partner Links API para links por país; opcional: escribir a b2b@kiwitaxi.com preguntando por API de búsqueda/precios y si es compatible con tracking Travelpayouts.
- **Credencial (si se obtiene):** `KIWITAXI_API_TOKEN`.
- **Veredicto: DESPUÉS** — hoy solo deep links verificados; la API B2B es por contacto y sin documentación pública.

### B3. Welcome Pickups
- **Programa TP:** https://www.travelpayouts.com/en/offers/welcome-pickups-partner-program — comisión anunciada 8% traslados aeropuerto, 9% sightseeing; cookie 45 días. Programa directo en Tapfiliate (https://welcome.tapfiliate.com/).
- **API pública:** **no verificado** (no se encontró documentación; solo integraciones no-code con Touch Stay/Tourmie).
- **Veredicto: DESPUÉS** — solo deep links; cobertura en México **no verificado**.

### B4. intui.travel
- **Doc TP:** https://support.travelpayouts.com/hc/en-us/articles/211000208 (2026-04-27); landings: https://support.travelpayouts.com/hc/en-us/articles/219344867.
- **Comisión anunciada:** 10%; cookie 35 días (https://www.travelpayouts.com/en/offers/intui-travel-affiliate-program/).
- **API:** se menciona en presentaciones de 2018 (SlideShare) — formato, acceso y vigencia **no verificado**.
- **Veredicto: DESPUÉS** — deep links/widgets; API sin documentación vigente.

---

## C. Actividades / tickets

### C1. WeGoTrip (audioguías) — API pública
- **Doc TP:** https://support.travelpayouts.com/hc/en-us/articles/360016170039 (2024-11-18) → gist https://gist.github.com/4eRTuk/6b6a4b06b5f6d4ce90973e1931052991 (contenido "Updated 25 Apr 2023").
- **Base:** `https://app.wegotrip.com/api/v2` (attractions en v3). **Sin API key** (probado 2026-10-28).
- **Endpoints:** `/currencies/`, `/countries/`, `/cities/`, `/attractions/` (v3), `/search/?query=`, `/products/popular/` (filtros city/country/attraction, `lang`, `currency`), `/products/{id}/`, `/products/{id}/reviews/`.
- **Prueba real:** `lang=es` devuelve títulos en español; monedas disponibles: EUR, USD, GBP, CHF, THB, KZT, BYN, RUB — **MXN no existe** ("No currency found for MXN"). Respuesta con `price`, `currencyCode`, `rating`, `reviewsCount`, duración.
- **Atribución:** todos los links deben pasar por el generador del programa 150 (o Partner Links API) para llevar el marker.
- **Comisión anunciada (TP):** 6.64–41.5% (20% con ticket, 30% sin ticket, 41.5% audioguía IA); se confirma cuando el usuario inicia el tour; cookie 30 días.
- **Rate limits / ToS de API:** no publicados (**no verificado**).
- **Credencial:** ninguna.
- **Veredicto: RECOMENDADO AHORA (bajo esfuerzo)** — datos reales con precio y reseñas, en español, sin costo; nicho (audioguías), convertir USD→MXN marcando "aprox.".

### C2. Klook
- **Programa TP:** https://www.travelpayouts.com/en/offers/klook-affiliate-program/ — comisión anunciada 2–5%; cookie 30 días; **prohibido bidding de marca, cualquier tráfico PPC, páginas de Facebook con marca**.
- **API para afiliados:** no hay API vía Travelpayouts. API de distribución propia de Klook: **no verificado** (solo fuentes de terceros; integración de proveedores sigue OCTO).
- **Veredicto: DESPUÉS** — solo deep links vía Partner Links API; fuerte en Asia.

### C3. Tiqets — Distributor API
- **Doc:** https://www.tiqets.com/en/partner-program/api-program/ ; docs https://portals.tiqets.com/distributorapi/docs ; feed TP (IDs de ciudades/productos): https://support.travelpayouts.com/hc/en-us/articles/360010455179 (2023-12-20).
- **Acceso:** al registrarse como partner directo de Tiqets se obtiene **Content API y Availability API** (disponibilidad y precio en tiempo real) "at no cost". **Booking API** solo tras revisión por desempeño (~200 pedidos/mes mínimo).
- **Atribución:** el registro es en el programa **directo** de Tiqets; si esas claves pueden rastrearse por Travelpayouts (programa 89): **no verificado**.
- **Comisión anunciada (TP):** 3.5–8%; cookie 30 días.
- **Pasos:** (1) preguntar a Travelpayouts/Tiqets si la API key de distribuidor es compatible con el programa TP; (2) si no, decidir cuenta directa; (3) solicitar en el formulario de partner.
- **Credencial:** `TIQETS_API_KEY`.
- **Veredicto: DESPUÉS** — datos de alta calidad (precio y horarios reales para museos), pero la atribución vía TP no está confirmada.

### C4. Go City
- **Programa TP:** https://www.travelpayouts.com/en/offers/go-city-card-affiliate-program — comisión anunciada 3.4–6%; cookie 90 días; sin comisión en ventas de la app; menciona México entre destinos.
- **API:** la "Trade API" es para revendedores con cuenta y credenciales del account manager (https://support.ventrata.com/en/articles/9527480-go-city-reseller-connection, https://gocity.com/en/go-city-connectivity-hub). No hay API para afiliados (**no verificado** que exista).
- **Veredicto: DESPUÉS** — solo deep links.

### C5. KKday
- **Programa TP:** https://www.travelpayouts.com/en/offers/kkday-affiliate-program/ — 1–5%; cookie 30 días; foco Asia.
- **API:** solo integraciones de proveedores/revendedores (OCTO vía Ventrata, rezio). API para afiliados: **no verificado**.
- **Veredicto: DESPUÉS** — deep links; poca relevancia para Europa/México.

### C6. Viator Partner API (niveles)
- **Docs:** https://partnerresources.viator.com/travel-commerce/technical-guide/ , https://partnerresources.viator.com/travel-commerce/affiliate/ , https://docs.viator.com/partner-api/
- **Niveles:**
  - **Basic-access affiliate:** se otorga **automáticamente** al crear cuenta de afiliado en partners.viator.com; gratis. Endpoints: `/destinations`, `/attractions/search`, `/attractions/{id}`, `/products/{product-code}`, `/products/search`, `/search/freetext`, `/locations/bulk`, `/products/tags`, **`/availability/schedules/{product-code}`** (horarios y tarifas por producto), `/exchange-rates`. **Sí puede mostrar precios** (resúmenes de búsqueda incluyen pricing; schedules en moneda del proveedor, convertir con `/exchange-rates`).
  - **Full-access affiliate (requiere aprobación + certificación, sin costo):** agrega `/products/modified-since`, `/products/bulk`, `/availability/schedules/modified-since|bulk`, **`/availability/check`** (tiempo real), `/reviews/product` (30 req/min pedido), `/products/recommendations`.
  - **Full + Booking affiliate:** agrega hold/book/cancel, booking-questions, checkout sessions/iframe de pago de Viator.
  - **Merchant:** todo lo anterior como comerciante registrado; Viator factura periódicamente las ventas — **ALERTA SALDO/factura**.
  - Afiliados Basic/Full **no reservan**: redirigen a viator.com.
- **Caché:** destinos/atracciones/tags semanal; `/products/{code}` y `/availability/schedules/{code}` hasta 1 h y **no para ingesta**; ingesta solo vía `modified-since` (Full).
- **Auth:** header `exp-api-key` según fuentes de terceros (https://jentic.com/apis/viator.com/viator.md) — **no verificado** en doc oficial. Sandbox `api.sandbox.viator.com` mencionado por terceros — **no verificado**. Rate limits generales: **no verificado** (solo reseñas 30/min).
- **Atribución:** la API key es de una cuenta **directa** de Viator (productUrl con su pid/mcid). Combinarla con el programa Viator de Travelpayouts (feed de ofertas JSON por soporte: https://support.travelpayouts.com/hc/en-us/articles/23940843009426, 2026-09-21) — compatibilidad **no verificado**.
- **Comisión anunciada:** 8% (TP y directo); cookie 30 días; solo viajes completados; sin comisión en app de Viator.
- **Pasos:** (1) crear cuenta de afiliado en partners.viator.com; (2) copiar API key (Basic) del dashboard; (3) decidir canal de atribución (directo vs TP) antes de publicar links; (4) más tarde, pedir Full Access y pasar certificación.
- **Credencial:** `VIATOR_API_KEY`.
- **Veredicto: RECOMENDADO AHORA (Basic Access)** — mejor fuente de actividades con precio y horarios reales por producto, gratis y self-serve; resolver atribución antes de producción.

---

## D. eSIM

### D1. Airalo
- **Feed para afiliados:** https://support.travelpayouts.com/hc/en-us/articles/17131439719826-Data-from-Airalo (2025-09-05). Feed viejo `https://www.airalo.com/products.xml` (**probado 2026-10-28: 200 OK, ~16.6 MB, 3,349 items, precios en USD**, campos g:id, g:title, g:product_type con país/datos/días, g:price) y feed nuevo (Google Drive). Requiere estar conectado al programa 541; links del feed no son de afiliado → convertir con Partner Links API o plantilla `tp.media/r?...&campaign_id=541`.
- **Partner API (https://developers.partners.airalo.com/):** OAuth client_id/secret (token 24 h), sandbox sin cargos, endpoints de paquetes, órdenes, balance, reembolsos. **Es programa de revendedor**: el socio **compra** las eSIM a precio neto según Order Form, exclusividad de compra durante el término, no vender bajo el precio recomendado, prohibido usar la marca en paid search (https://www.airalo.com/m/resources/api-partner-terms-and-conditions/, act. 2026-04-28). **ALERTA SALDO**.
- **Comisión anunciada (TP):** 12%; cookie 30 días (https://www.travelpayouts.com/en/offers/airalo-partner-program/).
- **Pasos (feed):** (1) confirmar conexión al programa Airalo; (2) nada más (feed público). **Credencial:** ninguna.
- **Veredicto: Feed RECOMENDADO AHORA** (precios reales por país, descarga diaria y caché); **Partner API NO RECOMENDADO** (revendedor con compra de inventario).

### D2. Yesim
- **Programa TP:** https://www.travelpayouts.com/en/offers/yesim-affiliate-program/ — 18% anunciado; cookie 90 días. Es el ejemplo oficial de la Partner Links API.
- **Partner API:** https://yesim.tech/yesim-partner-api/ + Postman (https://documenter.gw.postman.com/view/metadata/2sA3kbgy28): onboarding con b2b@yesim.app, base `partners-api.yesim.biz`, panel core.yesim.biz; modelo de reventa (fijas tus precios) — cobro/depósito **no verificado**.
- **Veredicto: DESPUÉS** — deep links ya; la API es de reventa.

### D3. Saily
- **Programa TP:** https://www.travelpayouts.com/en/offers/saily-partner-program/ — 15% anunciado; cookie 30 días. API: **no verificado** (no encontrada).
- **Veredicto: DESPUÉS** — solo deep links.

### D4. GigSky
- **Programa TP:** https://www.travelpayouts.com/en/offers/gigsky-affiliate-program/ — 20% anunciado; cookie 30 días; paid search permitido sin nombre/logo de marca.
- **API:** empresarial/IoT con cuenta (descripción de terceros https://apis.io/providers/gigsky/) — **no verificado**.
- **Veredicto: DESPUÉS** — solo deep links.

---

## E. Guarda-equipaje

### E1. Radical Storage
- **Programa TP:** https://www.travelpayouts.com/en/offers/radical-storage-affiliate-program/ — 15% anunciado; cookie 30 días; ticket promedio ~$16.
- **API / búsqueda de ubicaciones para afiliados:** **no verificado** (no se encontró documentación pública).
- **Veredicto: DESPUÉS** — deep links por ciudad vía Partner Links API; preguntar a soporte TP si hay feed de ubicaciones.

---

## F. Renta de autos / motos

| Proveedor | Comisión anunciada (TP) / cookie | API real para afiliados | Veredicto |
|---|---|---|---|
| **Localrent** (https://www.travelpayouts.com/en/offers/localrent-affiliate-program/) | 5–12% (50% rev share) / 30 d | Q&A ~2019: "contact us... keys to the API" (https://www.travelpayouts.com/blog/qa-localrent-webinar/amp/); entonces sin España/Francia; vigencia **no verificado** | DESPUÉS |
| **GetRentacar** (https://www.travelpayouts.com/en/offers/getrentacar-affiliate-program/) | 10% / 90 d; solo rentas completadas | API v302 (https://getrentacar.com/api/v302/docs) es para **dueños de vehículos** (inventario), no búsqueda para afiliados | NO RECOMENDADO (como API); deep links sí |
| **Economybookings** (https://support.travelpayouts.com/hc/en-us/articles/360007365071) | 3–8% (60% del ingreso) / 30 d | Solo deep links prellenados `?idpick=Ciudad` o `?idpickval=IATA`; API **no verificado** | DESPUÉS (deep links ya) |
| **QEEQ** (https://www.travelpayouts.com/en/offers/qeeq-affiliate-program/) | 5% renta, 10% membresía / 30 d; pago 30–180 d tras devolución | "API integration" mencionado en marketing TP; docs **no verificado** | DESPUÉS |
| **AutoEurope** (https://travelpayouts.com/en/offers/autoeurope-affiliate-program-eu) | 2.4–5.6% (según residencia del usuario) / **7 d**; sin PPC de marca | **no verificado** | DESPUÉS |
| **BikesBooking** (https://www.travelpayouts.com/en/offers/bikesbooking-affiliate-program/) | 4% / 30 d | API anunciada en 2017; existencia actual **no verificado** | DESPUÉS |

Credenciales: ninguna (solo Partner Links API).

---

## G. Vuelos / reclamaciones

### G1. Kiwi.com (Tequila)
- **Estado 2026:** Kiwi.com anunció el 2024-05-30 que Tequila pasa a asociaciones estratégicas; "Any new partnerships on the Tequila platform will be on an invitation only basis" (https://media.kiwi.com/articles-and-interviews/better-for-business-kiwi-com-takes-a-new-approach-to-partnerships/). Vía Travelpayouts: requiere **≥50,000 MAU** (https://support.travelpayouts.com/hc/en-us/articles/360019237899, 2025-03-18). Kiwi.com **excluido** de la Partner Links API.
- **Comisión anunciada (TP):** 3%; cookie 30 días.
- **Veredicto: NO RECOMENDADO** — acceso cerrado (invitación) y umbral de MAU que no cumplimos.

### G2. AirHelp
- **Programa TP:** https://www.travelpayouts.com/en/offers/airhelp-affiliate-program/ — 15–16.6% anunciado; cookie 45 días.
- **API:** página B2B (https://www.airhelp.com/en-int/become-a-partner/) habla de soluciones B2B por contacto; API de elegibilidad para afiliados: **no verificado**.
- **Veredicto: DESPUÉS** — deep link a formulario de reclamo; nuestra propia regla EC261 orientativa es posible sin API.

### G3. Compensair
- **Programa TP:** https://www.travelpayouts.com/en/offers/compensair-affiliate-program/ — €5 por reclamo procesado (otras fuentes TP mencionan hasta €25; conflicto); cookie 30 días.
- **API de elegibilidad:** **no verificado** (no se encontró).
- **Veredicto: DESPUÉS** — deep links/widget únicamente.

---

## H. Transporte terrestre (objetivo: tarifas reales Madrid→Sevilla, Sevilla→Granada, Granada→Barcelona)

**Conclusión principal:** **ninguna fuente de tarifas reales en tiempo real es obtenible sin contrato B2B.** Lo obtenible hoy: horarios reales (Renfe GTFS, CC BY 4.0) + precios "desde" estáticos (feed Omio vía TP, 2025) + deep link para precio real.

### H1. Renfe (datos oficiales)
- **Portal:** https://data.renfe.com (CKAN). Datasets: "Horarios de alta velocidad, larga distancia y media distancia" GTFS `https://ssl.renfe.com/gtransit/Fichero_AV_LD/google_transit.zip` (modificado 2026-10-28), GTFS-RT LD `https://gtfsrt.renfe.com/trip_updates_LD.json|.pb`, Cercanías GTFS/GTFS-RT. **Licencia CC BY 4.0**. Sin key.
- **Tarifas:** búsqueda CKAN "tarifas"/"precio" = 0 resultados; el GTFS no incluye fare_attributes (archivos: agency, calendar, calendar_dates, routes, stops, stop_times, trips). **No hay API pública de tarifas.**
- **Prueba:** viajes en el feed (todo el calendario): Madrid→Sevilla-Santa Justa 145, Sevilla→Granada 8, Granada→Barcelona 3. Solo **RENFE OPERADORA** (no Iryo ni Ouigo).
- **Venta B2B:** vía GDS/agencias (Sabre, Amadeus) y compromisos ante la Comisión Europea (2023) para plataformas terceras — no aplicable a nosotros sin contrato.
- **Veredicto: RECOMENDADO AHORA para horarios** (dato oficial, gratis) — mostrar "horario oficial Renfe; precio en el sitio del vendedor".

### H2. Omio (feed vía Travelpayouts)
- **Doc:** https://support.travelpayouts.com/hc/en-us/articles/360024389872-Data-from-Omio (2026-06-04). Feed nuevo (Google Drive) **descargado 2026-10-28: archivos fechados 2025-08-29**, 18,459 rutas por idioma, incluye **MX-(Spanish-Mexico) con precios en MXN**. Campos `train_min_price`, `bus_min_price`, `flight_min_price`, duraciones, coordenadas, `link_URL` (link de Impact `omio.sjv.io`, hay que convertirlo con el generador TP).
- **Valores (archivo MX):** Madrid-Puerta de Atocha→Sevilla tren desde 110.40 MXN; Sevilla-Santa Justa→Granada tren 513.90 / bus 413.73 MXN; Granada→Barcelona tren 1,380.56–1,657.10, bus 1,053.93–1,188.93 MXN. **Son mínimos históricos estáticos de hace ~14 meses, no tarifas reservables.**
- **Omio B2B API:** por contacto (https://www.omio.com/corporate/omio-b2b/); requisitos **no verificado**.
- **Comisión anunciada (TP):** 6%; cookie 30 días; no se permite cashback/descuentos en tickets DB.
- **Veredicto: RECOMENDADO AHORA solo como referencia "desde" + deep link** — etiquetar fecha del dato; nunca presentarlo como precio actual.

### H3. Distribusion — **ALERTA (comerciante)**
- **Docs:** https://docs.distribusion.com/dt/api/getting-started (auth `Api-Key` header + RPN de 6 dígitos; entorno demo con precios ficticios fijos €25.00; rate limit por minuto en ventana deslizante, cifras no publicadas).
- **Acceso:** contrato comercial general con Distribusion; algunos operadores nacionales (SNCF, DB, ÖBB, Trenitalia) pueden exigir contrato directo; acreditación con criterios (cancelaciones, enmiendas requeridas por Ouigo España, etc.). El retailer cobra al cliente y recibe comisión vía factura de autofacturación mensual (https://docs.distribusion.com/dt/invoicing-and-payments). Cobertura de Renfe/Iryo: **no verificado** (Ouigo España aparece en criterios).
- **Credenciales (futuro):** `DISTRIBUSION_API_KEY`, `DISTRIBUSION_RPN`.
- **Veredicto: DESPUÉS** — la única vía real a tarifas+reserva multi-operador, pero requiere empresa, contrato, acreditación y ser comerciante.

### H4. Trainline Partner Solutions
- B2B (integró Renfe e Iryo en SAP Concur, 2026-06: https://trainlinegroup.com/media/news/trainline-partner-solutions-has-integrated-renfe-and-iryo-into-concur-travel-enabling-corporate-travel-bookings-across-multiple-train-operators-on-a-single-platform). Onboarding/API pública: **no verificado**.
- **Veredicto: NO RECOMENDADO (por ahora)** — orientado a corporativos/TMCs con contrato.

### H5. Busbud
- API e integración white label por contacto (https://www.busbud.com/partner/busbud-api/); afiliados vía CJ (https://www.busbud.com/en-ca/affiliate), no vía TP. Requisitos **no verificado**.
- **Veredicto: DESPUÉS.**

### H6. 12Go Asia
- **Programa TP:** https://www.travelpayouts.com/en/offers/12go-affiliate-program/ — 4–5.5% (50% del revenue); cookie 30 días. Dashboard agent.12go.asia con links, timetable, white label, data feeds; API "para sitios establecidos" por contacto (affiliate@12go.asia) (https://blog.12go.asia/?p=92).
- **Veredicto: NO RECOMENDADO para España/México** (cobertura Asia); DESPUÉS si hay rutas asiáticas.

---

## I. APIs públicas / gratuitas

### I1. Google Calendar API (solo crear eventos)
- **Scopes:** https://developers.google.com/workspace/calendar/api/auth ; `events.insert` acepta `calendar`, `calendar.events`, **`calendar.app.created`**, `calendar.events.owned` (https://developers.google.com/workspace/calendar/api/v3/reference/events/insert).
- **Recomendación de scope:** `https://www.googleapis.com/auth/calendar.app.created` (crea calendarios secundarios propios de la app y gestiona eventos **solo** en ellos; no lee el calendario del usuario). Alternativa si se requiere el calendario principal: `calendar.events.owned`. Clasificación oficial "non-sensitive" de `calendar.app.created`: **no verificado** (Google no lo publica en la página de scopes; un hilo de foro reporta que la consola solo lista `calendar.events` como sensible).
- **Verificación:** apps con scopes sensibles/restringidos en producción deben verificarse: homepage en dominio propio (no solo login), política de privacidad en ese dominio enlazada en la pantalla de consentimiento, verificación de dominios en Search Console, video demo del flujo OAuth en inglés (https://support.google.com/cloud/answer/13464321). Exentos: uso personal/pruebas con **tope de 100 usuarios**, internas de Workspace, etc. (https://support.google.com/cloud/answer/13464323). Con solo scopes no sensibles basta verificación de marca opcional.
- **Opción sin OAuth (preferible para MVP):** archivo `.ics` descargable o enlace "Agregar a Google Calendar" (URL de plantilla) — no requiere scopes ni verificación.
- **Credenciales:** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`.
- **Veredicto: RECOMENDADO AHORA vía .ics/plantilla; API con `calendar.app.created` DESPUÉS** (cuando haya dominio, política de privacidad y tiempo para verificación).

### I2. OpenAgenda
- **Docs:** https://developers.openagenda.com/en/ — gratis; lectura con **clave pública** (header) de la cuenta; escritura con clave secreta por solicitud a support@openagenda.com; base `https://api.openagenda.com/v2`; datos mayormente bajo Licence Ouverte; cambios de permisos de keys planeados sep-2026 (https://developers.openagenda.com/en/evolutions). Cobertura: plataforma francesa — cobertura por país **no verificado**; rate limits **no verificado**.
- **Credencial:** `OPENAGENDA_PUBLIC_KEY`.
- **Veredicto: DESPUÉS** — útil solo para viajes a Francia.

### I3. Avisos de viaje oficiales
- **GOV.UK Content API:** `https://www.gov.uk/api/content/foreign-travel-advice` (índice, 226 países) y `/foreign-travel-advice/{pais}` (probado: Spain actualizado 2026-10-28, partes "Warnings and insurance", "Entry requirements", "Safety and security", "Health"; campo `alert_status`). Sin auth; licencia **OGL v3.0**; cachear (~1 h sugerido en docs); rate limit sin cifra pública (https://content-api.publishing.service.gov.uk/getting-started.html). Contenido en inglés y desde perspectiva británica.
- **US State Dept:** `https://cadataapi.state.gov/api/TravelAdvisories` (probado: 200 JSON, título con nivel 1–4, resumen HTML, link). Sin key; documentación oficial y límites **no verificado** (solo fuentes de terceros, p.ej. https://pypi.org/project/sdta/).
- **México SRE "Guía del Viajero":** no se encontró API ni dataset oficial (**no verificado**; datos.gob.mx y guiadelviajero.sre.gob.mx no accesibles desde el entorno de prueba). Recomendación: enlazar, no scrapear.
- **Credenciales:** ninguna.
- **Veredicto: GOV.UK y US State Dept RECOMENDADO AHORA** (gratis, oficiales; mostrar fuente y fecha, aclarar que no son avisos de México); **SRE: solo enlace**.

### I4. OpenAQ v3
- **Key obligatoria** (probado: 401 "A valid API key must be provided in the X-API-Key header"); gratis "General use": **60 req/min, 2,000 req/h** (https://docs.openaq.org/using-the-api/rate-limits); atribución de fuente obligatoria según Terms.
- **Credencial:** `OPENAQ_API_KEY`.
- **Veredicto: DESPUÉS** — valor moderado (calidad del aire), fácil y gratis cuando se necesite.

### I5. Mobility Database (catálogo GTFS)
- Registro gratis en mobilitydatabase.org → **refresh token** en Account Details → `POST https://api.mobilitydatabase.org/v1/tokens` da access token (Bearer) (https://github.com/MobilityData/mobility-feed-api). Metadatos del catálogo **CC0**; cada feed con licencia de su proveedor (https://github.com/MobilityData/mobility-database-catalogs).
- **Credencial:** `MOBILITYDB_REFRESH_TOKEN`.
- **Veredicto: DESPUÉS** — útil para descubrir GTFS de otras ciudades; para España ya tenemos Renfe directo.

### I6. National Rail Darwin (Reino Unido)
- Registro gratis en Rail Data Marketplace (raildata.org.uk), producto "Live Departure Board", consumer key; licencia NRE OGL (https://www.nationalrail.co.uk/100296.aspx, https://wiki.openraildata.com/index.php/Rail_Data_Marketplace/Feeds). Estado de OpenLDBWS legacy y cuotas: fuentes en conflicto — **no verificado**.
- **Credencial:** `RDM_LDB_CONSUMER_KEY`.
- **Veredicto: DESPUÉS** — solo relevante para viajes a UK.

### I7. Wikivoyage / Wikimedia REST
- `https://es.wikivoyage.org/api/rest_v1/page/summary/{Titulo}` y Action API. Licencia **CC BY-SA 4.0** (confirmado vía `meta=siteinfo&siprop=rightsinfo`): exige atribución (título, autores/enlace a historial, licencia) y compartir-igual para contenido derivado.
- **Límites 2026:** sin identificar (solo IP) **10 req/min**; bot no autenticado con User-Agent conforme **200 req/min** (https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits). User-Agent descriptivo con contacto obligatorio (https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy). En la prueba desde IP compartida el REST devolvió **429**: cachear agresivamente.
- **Credencial:** ninguna (config `WIKIMEDIA_USER_AGENT`).
- **Veredicto: RECOMENDADO AHORA** — contenido de destino en español, gratis; requiere bloque de atribución y caché.

### I8. OurAirports
- https://ourairports.com/data/ — **dominio público**, CSV (airports, runways, countries, regions, frequencies, navaids) actualizado cada noche; espejo GitHub davidmegginson/ourairports-data.
- **Veredicto: RECOMENDADO AHORA** — importar a tabla propia; sin costo ni límites.

### I9. REST Countries / countries.dev
- **REST Countries:** `/v1`–`/v4` (incl. v3.1) **dados de baja** (https://restcountries.com/docs/countries/legacy-api-deprecation; probado: v3.1 responde 301). v5 en `api.restcountries.com` **requiere API key** (probado: 401 authKeyMissing); plan Free **1,000 req/mes**, solo evaluación/personal; uso comercial requiere plan pago; 20 req/10 s (https://restcountries.com/docs).
- **countries.dev:** dice "No API key, no rate limits, no sign-up" (https://countries.dev/); estado de mantenimiento/SLA **no verificado**.
- **Veredicto: REST Countries NO RECOMENDADO** (comercial pago); **countries.dev DESPUÉS**; mejor: tabla estática propia (OurAirports countries.csv + ISO) refrescada mensualmente.

---

## Tabla resumen

| Proveedor | Acceso obtenible | Cómo | Costo | Veredicto |
|---|---|---|---|---|
| TP Partner Links API | Generación de links afiliados (10/req, 100 rpm) | Token existente | Gratis | RECOMENDADO AHORA |
| TP Aviasales Data API | Precios caché (≤7 días) | Token existente | Gratis | RECOMENDADO AHORA (mantener) |
| TP Search API (vuelos) | Búsqueda real | ≥50k MAU | Gratis | NO (no calificamos) |
| TP Statistics + Finance API | Conversiones con evidencia (sub_id, state) | Token existente | Gratis (30 rpm) | RECOMENDADO AHORA |
| GetTransfer | Cotización, reserva, webhook | Token vía support@travelpayouts.com; sandbox gtrbox.org | Cotizar gratis; **reservas del saldo del socio** | AHORA solo cotización |
| Kiwitaxi | Deep links; API B2B por contacto | b2b@kiwitaxi.com | no verificado | DESPUÉS |
| Welcome Pickups | Deep links | Programa TP | Gratis | DESPUÉS |
| intui.travel | Deep links/widgets | Programa TP | Gratis | DESPUÉS |
| WeGoTrip | API de catálogo con precios (sin key) | Pública | Gratis | RECOMENDADO AHORA |
| Klook | Deep links | Programa TP | Gratis | DESPUÉS |
| Tiqets | Content + Availability API (directo) | Registro partner Tiqets | Gratis | DESPUÉS (atribución TP no verificada) |
| Go City | Deep links (Trade API solo revendedores) | Programa TP | Gratis | DESPUÉS |
| KKday | Deep links | Programa TP | Gratis | DESPUÉS |
| Viator | Partner API Basic (catálogo, precios, schedules) | Cuenta afiliado directa, automático | Gratis | RECOMENDADO AHORA |
| Airalo | Feed XML (USD) / Partner API reventa | Programa TP / contrato | Feed gratis; API = compra inventario | Feed AHORA; API NO |
| Yesim | Deep links; API reventa | Programa TP / b2b@yesim.app | no verificado | DESPUÉS |
| Saily | Deep links | Programa TP | Gratis | DESPUÉS |
| GigSky | Deep links | Programa TP | Gratis | DESPUÉS |
| Radical Storage | Deep links | Programa TP | Gratis | DESPUÉS |
| Localrent | Deep links; API por contacto (2019) | affiliates@localrent.com | no verificado | DESPUÉS |
| GetRentacar | Deep links (API es para dueños) | Programa TP | Gratis | NO (API) |
| Economybookings | Deep links prellenados (IATA) | Programa TP | Gratis | DESPUÉS |
| QEEQ | Deep links | Programa TP | Gratis | DESPUÉS |
| AutoEurope | Deep links (cookie 7 d) | Programa TP | Gratis | DESPUÉS |
| BikesBooking | Deep links | Programa TP | Gratis | DESPUÉS |
| Kiwi.com Tequila | Cerrado (invitación) / ≥50k MAU | — | — | NO RECOMENDADO |
| AirHelp | Deep links; B2B por contacto | Programa TP | Gratis | DESPUÉS |
| Compensair | Deep links | Programa TP | Gratis | DESPUÉS |
| Renfe data | GTFS horarios + GTFS-RT; sin tarifas | Pública, CC BY 4.0 | Gratis | AHORA (horarios) |
| Omio | Feed estático (2025-08, incluye MXN) | Programa TP | Gratis | AHORA solo referencia |
| Distribusion | Búsqueda+tarifa+reserva | Contrato + acreditación | Comerciante (cobra y recibe comisión) | DESPUÉS |
| Trainline PS | B2B | Contrato | no verificado | NO (por ahora) |
| Busbud | API/white label | Contacto; afiliado vía CJ | no verificado | DESPUÉS |
| 12Go | Links, feeds; API por contacto | Programa TP | Gratis | NO (cobertura Asia) |
| Google Calendar | Crear eventos | OAuth `calendar.app.created` + verificación; o .ics sin OAuth | Gratis | .ics AHORA; API DESPUÉS |
| OpenAgenda | Eventos (Francia) | Clave pública de cuenta | Gratis | DESPUÉS |
| GOV.UK travel advice | Avisos oficiales JSON | Público, OGL | Gratis | RECOMENDADO AHORA |
| US State Dept | Niveles de aviso JSON | Público (docs no oficiales) | Gratis | RECOMENDADO AHORA |
| SRE Guía del Viajero | Sin API encontrada | Enlace | — | Solo enlace |
| OpenAQ v3 | Calidad del aire | Key gratis (60/min, 2,000/h) | Gratis | DESPUÉS |
| Mobility Database | Catálogo GTFS | Refresh token gratis | Gratis | DESPUÉS |
| Darwin / RDM | Salidas UK en vivo | Registro gratis RDM | Gratis (cuotas no verificadas) | DESPUÉS |
| Wikivoyage | Contenido de destino (es) | Público, UA obligatorio, CC BY-SA 4.0 | Gratis | RECOMENDADO AHORA |
| OurAirports | Aeropuertos CSV | Público, dominio público | Gratis | RECOMENDADO AHORA |
| REST Countries / countries.dev | Datos de país | v5 con key (1k/mes no comercial) / sin key | Pago comercial / gratis | NO / DESPUÉS |

## Top 8 próximas integraciones (valor usuario × calidad de dato × bajo costo × acceso real)

1. **TP Partner Links API** — habilita monetización rastreable (con `sub_id`) de todas las marcas aprobadas con el token actual; prerequisito de todo lo demás.
2. **TP Statistics API** — conversiones solo con evidencia del proveedor (`action_id`, `state`, `sub_id`); evita afirmar reservas que no existen.
3. **Viator Partner API (Basic)** — actividades con precio y horarios reales por producto, gratis y self-serve; resolver primero canal de atribución.
4. **Renfe GTFS (+GTFS-RT LD)** — horarios oficiales para Madrid→Sevilla, Sevilla→Granada, Granada→Barcelona; complementar con deep link (Omio/TP) para el precio real, porque **no existe API de tarifas obtenible sin contrato**.
5. **Feed Airalo** — precios reales de eSIM por país (3,349 planes, USD→MXN aprox.), feed público y diario.
6. **Avisos oficiales GOV.UK + US State Dept** (+ enlace a SRE) — seguridad del viaje, gratis, sin key; mostrar fuente y fecha.
7. **GetTransfer `route_info` (solo cotización, sandbox primero)** — precio real de traslado puerta a puerta; nunca activar pagos con saldo sin contrato.
8. **Wikivoyage (es) + OurAirports** — contenido de destino en español y datos de aeropuertos, gratis; requiere atribución CC BY-SA y caché. (Menciones: WeGoTrip API sin key con títulos en español; Omio feed solo como "desde" fechado.)
