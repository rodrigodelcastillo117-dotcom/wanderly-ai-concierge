# IATOS · API Requirements Center

> Documento vivo. Lo mantiene Claude: cada integración nueva o cambio de estado se registra aquí **antes** de declararla operativa.
> Última actualización: **28-oct-2026** · main `84a0d6a` · Fuentes: auditoría de código + producción (solo lectura) y investigación de acceso real a cada proveedor (fuentes oficiales, consultadas el 28-oct-2026).
> Evidencia completa: `docs/iatos/api-center/INVENTARIO.md` (qué existe y qué funciona) y `docs/iatos/api-center/INVESTIGACION_APIS.md` (cómo se consigue cada API, con URLs).

## Reglas de este documento
- **Código ≠ producción.** "YA FUNCIONA" exige evidencia en producción (uso registrado, sonda OK o llamada real), no solo código.
- **Enlace de afiliado ≠ API de cotización. Clic ≠ compra. Comisión anunciada ≠ atribuida ≠ aprobada ≠ pagada.**
- Capacidades separadas: **DISCOVERY · QUOTE · AVAILABILITY · BOOKING · CONFIRMATION · FULFILLMENT**. Hoy **ninguna** integración de IATOS hace BOOKING ni CONFIRMATION por API de proveedor.
- Nunca se piden llaves en chat ni se copian a documentos o commits; solo se nombran.
- **Alerta de saldo:** marcamos ⚠️ las APIs donde reservar cobra a IATOS (saldo prepagado, reventa o factura de comerciante). No se activan sin autorización explícita del dueño.

Estados: **YA FUNCIONA · LISTO PARA INTEGRAR · NECESITA MI API KEY · NECESITA APROBACIÓN DE CUENTA · NECESITA CONTRATO · NECESITA CONFIGURACIÓN DE WEBHOOK · NECESITA PERMISO OAUTH · PENDIENTE DE PRUEBAS · NO RECOMENDADO**.

---

## 1. Próxima solicitud al dueño (una sola)

**API NECESARIA:** Travelpayouts Partner Links API (+ Statistics API, mismo token).
**PARA QUÉ:** que cada enlace de las marcas aprobadas (Airalo, WeGoTrip, Klook, Tiqets, GetTransfer, Radical Storage, autos…) sea un enlace de afiliado **oficial**, generado por Travelpayouts y con `sub_id` por viaje; y que "reservado" solo aparezca cuando Travelpayouts reporte la venta.
**BENEFICIO PARA IATOS:** hoy el marker se pega a mano en URLs que IATOS arma; algunas marcas no atribuyen así (y `tp.media/click` responde 400 desde oct-2026). Con esto cada clic queda atribuido y medible, sin costo.
**PRECIO:** gratis (100 solicitudes/min; 10 enlaces por solicitud).
**¿YA TENEMOS ALTERNATIVA?:** parcial: marker manual `533299` en algunos enlaces.
**DÓNDE ENTRAR:** https://app.travelpayouts.com → Tools/Projects.
**QUÉ HAGO YO:**
1. Entra a Travelpayouts y abre tu proyecto (el de traveliatos.life).
2. Copia el **ID del proyecto** (en la API se llama `trs`; es un número, no es secreto).
3. Revisa que los programas que quieres usar estén **conectados a ese mismo proyecto** (Airalo, WeGoTrip, GetTransfer, Radical Storage, Klook, Tiqets, Kiwitaxi, Localrent…).
4. Mándame ese número aquí en el chat (no es una llave).
**QUÉ CREDENCIAL NECESITAS:** ninguna nueva: se usa `TRAVELPAYOUTS_TOKEN` (ya guardado). El `trs` se guarda como configuración `TRAVELPAYOUTS_TRS`.
**DÓNDE GUARDARLA:** secretos de Supabase (vía Lovable), nunca en el código.
**QUÉ HARÁS DESPUÉS:** un generador común de enlaces en el servidor (caché por URL + sub_id), una sonda en health-check que crea 1 enlace de prueba y revisa `links[].code`, migrar los enlaces manuales y un cron que lee la Statistics API (≤30/min) para marcar conversiones solo con `action_id` del proveedor.
**¿BLOQUEA EL PROYECTO?:** sí para la Etapa 3 (todas las marcas de Travelpayouts dependen de esto); no para Etapas 1 y 2.

---

## 2. Tablero de estado

| # | Proveedor | Función en IATOS | Capacidad real | Estado técnico | Estado comercial | Prioridad |
|---|---|---|---|---|---|---|
| 1 | Anthropic Claude | Cerebro de Iato, análisis, intérprete | — | **YA FUNCIONA** (114 llamadas registradas desde el 22-oct) | Pago por uso | — |
| 2 | Google Places / Geocoding / Routes (casetas) | Lugares reales, rutas, casetas | DISCOVERY, QUOTE (casetas) | **YA FUNCIONA** (677 llamadas) | Pago por uso con cuota gratis mensual | — |
| 3 | SerpApi (Google Flights / Hotels / Events / web) | Vuelos y hoteles en vivo | QUOTE en vivo + enlace | **YA FUNCIONA** (97 llamadas; 226 búsquedas disponibles) | Plan gratis 250/mes: **insuficiente para crecer** | Alta (subir plan) |
| 4 | Travelpayouts Data API (Aviasales) | Precio de referencia de vuelos | QUOTE de caché (≤7 días) | **YA FUNCIONA** (sonda 10/10), pero trajo datos en 1 de 18 análisis | Gratis | Mantener |
| 5 | Travelpayouts Partner Links API | Enlaces de afiliado oficiales | Enlace atribuido | **LISTO PARA INTEGRAR** (falta `trs`) | Gratis | **1** |
| 6 | Travelpayouts Statistics / Finance API | Conversiones con evidencia | CONFIRMATION de venta (del proveedor) | **LISTO PARA INTEGRAR** | Gratis, 30/min | **2** |
| 7 | Viator Partner API (Basic, cuenta directa) | Tours reales con precio y fotos | DISCOVERY + precio "desde" + enlace | **YA FUNCIONA** (`VIATOR_API_KEY` en producción; 31 respuestas reales en caché) | Afiliado básico: no reserva en IATOS | Media (ampliar: horarios por producto) |
| 8 | Ticketmaster Discovery v2 | Conciertos, deportes, teatro | DISCOVERY + enlace oficial | **YA FUNCIONA** (12 llamadas; CDMX, Madrid, Florencia) | Afiliación (Impact) aparte; Partner Links no la soporta | — |
| 9 | Tripadvisor Terra | Calificaciones y reseñas en la pantalla de Actividades | DISCOVERY | **YA FUNCIONA con uso restringido** (sonda HTTP 200 hoy). Sus términos prohíben usar su contenido con IA, así que solo se consulta cuando una persona busca en pantalla; Iato y el análisis usan Google | 1,000 entidades gratis de por vida, luego ~USD 0.015 c/u | — |
| 10 | Ferryhopper (MCP público) | Ferris | DISCOVERY + precio indicativo + enlace | **YA FUNCIONA** (evidencia mínima: 1 llamada) | Confirmar uso comercial con Ferryhopper | Baja |
| 11 | MET Norway | Clima | — | **YA FUNCIONA** (desde el navegador) | Gratis con atribución | — |
| 12 | Frankfurter (BCE) | Tipo de cambio | — | **YA FUNCIONA** (23/23 cotizaciones) | Gratis | — |
| 13 | Resend (envío) | Correos (Privé, alertas, selección) | — | **YA FUNCIONA** (16 invitaciones entregadas) | Pago por uso | — |
| 14 | Resend Receiving + Reservas IA | Pedir mesa por correo y leer la respuesta | Solicitud + CONFIRMATION por respuesta verificada | **NECESITA CONFIGURACIÓN DE WEBHOOK** (faltan `RESEND_INBOUND_SECRET`, `RESEND_RECEIVING_API_KEY`, `AI_RESERVATIONS_*`; bandera apagada) | Requiere tu autorización para enviar correos reales a restaurantes | Media |
| 15 | Stripe | Suscripción PRO $99 | Cobro | **PENDIENTE**: está en **modo de prueba** (nadie puede pagar) | Decisión tuya: activar modo real | Alta (negocio) |
| 16 | Perplexity | Investigación web en el análisis | DISCOVERY | No configurado (no hay `PERPLEXITY_API_KEY`) | Pago por uso | **NO RECOMENDADO por ahora**: las fuentes en vivo ya cubren vuelos, hoteles, lugares y tours |
| 17 | Gemini directo | IA de respaldo | — | **FALLA intermitente** (0 de 10 chequeos limpios: 404/503/tiempo) | Pago por uso | Baja (el respaldo de Lovable sí funciona) |
| 18 | Booking Bridge (verificación de enlaces) | Lista blanca y revisión de enlaces | Enlace validado | **YA FUNCIONA** (1,127 revisiones) | — | — |
| 19 | Booking Bridge (intención de compra) | Reconsultar precio antes de salir | QUOTE + enlace | Banderas apagadas (`BOOKING_EXACT_FLIGHT_FORM`, `BOOKING_RESERVAS_EMAIL`) | — | Media |
| 20 | Privé Desk (bandeja del equipo) | Atender solicitudes Privé | — | Crear solicitud funciona; **no existe pantalla del equipo** | — | Media |
| 21 | Google Calendar | "Agrega mi viaje a mi calendario" | Crear eventos | Hoy: archivo `.ics`. API: **NECESITA PERMISO OAUTH** + verificación de Google | Gratis | Etapa 1 (ver §4.1) |
| 22 | GOV.UK + US State Dept (avisos) | "¿Qué debo saber antes de ir a…?" (Iato `get_travel_advisory` + tarjeta "Antes de viajar" en Destinos) | DISCOVERY oficial | **YA FUNCIONA** (28-oct 18:55 UTC: `avisos-viaje` en vivo con Tailandia: GOV.UK act. 12-oct y State Dept nivel 1/4; traducción al español OK; SRE primero) | Gratis (OGL v3); traducción con Haiku ~USD 0.002 por país cada 7 días | Hecho |
| 23 | SRE "Guía del Viajero" | Avisos para mexicanos | Enlace | Sin API ni dataset oficial encontrado; enlace a la portada (no se verificó un patrón de ficha por país: el sitio no resolvió desde el entorno de prueba) | — | Solo enlace (primero en la tarjeta) |
| 24 | OpenAgenda | Agenda cultural (Francia) | DISCOVERY | **NECESITA MI API KEY** (clave pública gratis) | Gratis | Etapa 1, baja (solo Francia) |
| 25 | Renfe GTFS + GTFS-RT | Horarios y retrasos oficiales en España | Horario publicado (sin tarifas) | **LISTO PARA INTEGRAR** (público, CC BY 4.0) | Gratis | Etapa 2, alta |
| 26 | OpenAQ v3 | Calidad del aire | DISCOVERY | **NECESITA MI API KEY** (gratis, 60/min) | Gratis | Etapa 2, media |
| 27 | Mobility Database | Catálogo GTFS mundial | DISCOVERY | **NECESITA MI API KEY** (token gratis) | Gratis | Etapa 2, baja |
| 28 | National Rail Darwin | Trenes de Reino Unido en vivo | Salidas, retrasos | **NECESITA MI API KEY** (Rail Data Marketplace, gratis) | Gratis | Etapa 2, baja (solo UK) |
| 29 | Wikivoyage (es) | Guías de destino en español | Contenido | **LISTO PARA INTEGRAR** (CC BY-SA: atribución obligatoria) | Gratis | Etapa 2, media |
| 30 | OurAirports | Validar aeropuertos y coordenadas | Datos | **LISTO PARA INTEGRAR** (dominio público) | Gratis | Etapa 2, media |
| 31 | REST Countries / countries.dev | Datos de país | Datos | REST Countries v5 exige pago para uso comercial | — | **NO RECOMENDADO** (usar tablas propias + OurAirports) |
| 32 | GetTransfer ⚠️ | Traslado aeropuerto → hotel | QUOTE real por coordenadas (sandbox); reservar **cobra nuestro saldo** | **NECESITA MI API KEY** (token por correo a Travelpayouts) | Comisión anunciada 4–25%; reservas = saldo prepagado | **3** (solo cotización) |
| 33 | WeGoTrip | Audioguías y tours autoguiados | DISCOVERY + precio (USD/EUR) | **LISTO PARA INTEGRAR** (API pública sin llave; probada con `lang=es`) | Comisión anunciada 6.6–41.5% | **4** |
| 34 | Airalo (feed XML) | "¿Qué eSIM me conviene?" | Precio real por país (USD) | **LISTO PARA INTEGRAR** (feed público: 3,349 planes; probado hoy) | Comisión anunciada 12%. Partner API = reventa ⚠️ | **5** (solo feed) |
| 35 | Radical Storage | Equipaje Invisible | Solo enlace | Sin API para afiliados encontrada | Programa Travelpayouts | 6 (enlace atribuido vía Partner Links) |
| 36 | Klook / KKday / Go City | Entradas y pases | Solo enlace (Go City API = revendedores) | Enlaces | Programas Travelpayouts | Después (vía Partner Links) |
| 37 | Tiqets | Museos y atracciones | API de contenido + disponibilidad (registro directo); reserva con volumen | **NECESITA APROBACIÓN DE CUENTA** | Atribución vía Travelpayouts: no verificado | Después |
| 38 | Kiwitaxi / Welcome Pickups / intui | Traslados | Enlace (Kiwitaxi: API B2B a solicitud) | Welcome Pickups ya enlazado | Programas Travelpayouts | Después (modelo común de traslados) |
| 39 | Localrent / Economybookings / QEEQ / AutoEurope / BikesBooking | Renta de autos/motos | Solo enlace (Economybookings: precargado por IATA) | No existen en código | Programas Travelpayouts | Después; **nunca precio final sin cargos obligatorios** |
| 40 | GetRentacar | — | Su API es para dueños de autos | — | — | **NO RECOMENDADO** como API |
| 41 | Kiwi.com Tequila | Vuelos | Cerrado (solo invitación) / 50k MAU | — | — | **NO RECOMENDADO** |
| 42 | AirHelp / Compensair | "Cancelaron mi vuelo, ¿puedo reclamar?" | Solo enlace (sin API de elegibilidad encontrada) | — | Programas Travelpayouts | Después: orientación + enlace, nunca prometer compensación |
| 43 | Omio (feed vía Travelpayouts) | Precio "desde" de trenes/buses | Precio de referencia antiguo (ago-2025) | — | — | Solo referencia, marcado como antiguo |
| 44 | Distribusion ⚠️ | Tarifas y reserva de tren/bus | QUOTE + BOOKING | **NECESITA CONTRATO** (acreditación; IATOS cobraría al cliente) | Comerciante | Después (decisión de negocio) |
| 45 | Trainline Partner / Busbud / 12Go | Tren/bus | B2B por contacto | No verificado | — | Después / no |

---

## 3. Fichas de las integraciones prioritarias

Formato: 1 proveedor · 2 función · 3 problema real · 4 ¿cuenta? · 5 ¿API key? · 6 ¿en secretos? · 7 permisos · 8 capacidades · 9 alta · 10 costo/llamada · 11 gratis · 12 restricciones · 13 límite · 14 atribución · 15 técnico · 16 comercial · 17 prueba · 18 falta · 19 qué hace el dueño · 20 prioridad · 21 bloqueos · 22 alternativa.

### 3.1 Travelpayouts Partner Links API — prioridad 1
1 Travelpayouts · 2 generador común de enlaces de afiliado para todas las marcas aprobadas · 3 los enlaces armados a mano pueden no atribuir · 4 sí · 5 sí (`TRAVELPAYOUTS_TOKEN`) · 6 sí · 7 crear enlaces de las marcas suscritas al proyecto (`trs`) · 8 enlace atribuido (no cotiza) · 9 gratis · 10 gratis · 11 todo · 12 excluye Kiwi.com, Expedia UK, HolidayTaxis, Ticketmaster, Priority Pass, Indrive · 13 100 solicitudes/min, 10 enlaces por solicitud · 14 marca visible del proveedor · 15 LISTO PARA INTEGRAR · 16 activo · 17 pendiente: crear 1 enlace de prueba y revisar `links[].code` (la respuesta global puede ser 200 aunque un enlace falle) · 18 `TRAVELPAYOUTS_TRS` · 19 ver §1 · 20 1 · 21 ninguno técnico · 22 seguir con marker manual donde funcione.

### 3.2 Travelpayouts Statistics / Finance API — prioridad 2
1 Travelpayouts · 2 registrar conversiones reales · 3 hoy solo guardamos clics (`bookings` con `status='pending'`, 17 filas) y no sabemos qué se vendió · 4–6 sí, mismo token · 7 lectura de acciones (`action_id`, `sub_id`, `state`, montos) · 8 CONFIRMATION de venta reportada por el proveedor · 9–11 gratis · 12 — · 13 30 consultas/min · 14 — · 15 LISTO PARA INTEGRAR · 16 activo · 17 pendiente · 18 convención de `sub_id` sin datos personales · 19 nada · 20 2 · 21 depende de 3.1 para tener `sub_id` · 22 conciliación manual desde el panel.

### 3.3 GetTransfer (solo cotización) — prioridad 3 ⚠️
1 GetTransfer vía Travelpayouts · 2 "Iato, consígueme transporte del aeropuerto a mi hotel" con precio real por clase de vehículo · 3 hoy Equipaje/traslados son solicitud a un humano sin precio · 4 programa en Travelpayouts (sí, según el dueño) · 5 **no** · 6 no · 7 `route_info` (cotizar), `transfers` (crear), `payments` (**paga con nuestro saldo**), webhook de estado · 8 QUOTE (y BOOKING solo con saldo prepagado) · 9 gratis · 10 cotizar gratis; reservar cobra al socio · 11 sandbox `gtrbox.org` · 12 fecha ≥ 6 h; precios se actualizan una vez al día · 13 no publicado (429 + Retry-After) · 14 marca GetTransfer visible · 15 NECESITA MI API KEY · 16 comisión anunciada 4–25%, sin confirmar condiciones · 17 pendiente (sandbox) · 18 token de prueba y producción · 19 escribir a support@travelpayouts.com pidiendo el token de GetTransfer API (prueba y producción); **no fondear saldo** · 20 3 · 21 ninguna reserva sin contrato y tu autorización · 22 enlace atribuido a Welcome Pickups / Kiwitaxi.

### 3.4 WeGoTrip — prioridad 4
1 WeGoTrip · 2 audioguías y recorridos autoguiados por ciudad e idioma · 3 no tenemos audioguías · 4 programa Travelpayouts · 5 no hace falta (API pública) · 6 — · 7 catálogo, búsqueda, productos, reseñas · 8 DISCOVERY + precio publicado · 9–11 gratis · 12 sin MXN (se muestra USD/EUR con conversión marcada "aprox.") · 13 no publicado (cachear) · 14 enlace por Partner Links para atribuir; dejar claro que el contenido es de WeGoTrip · 15 LISTO PARA INTEGRAR · 16 comisión anunciada 6.6–41.5% · 17 probado hoy con `lang=es` · 18 Partner Links (3.1) para atribución · 19 nada · 20 4 · 21 3.1 · 22 Viator.

### 3.5 Airalo feed — prioridad 5
1 Airalo · 2 "Viajo 14 días a Japón, ¿qué eSIM me conviene?" · 3 hoy solo hay enlace · 4 programa Travelpayouts · 5 no (feed público) · 6 — · 7 lectura del catálogo · 8 precio publicado por plan (USD) · 9–11 gratis · 12 la Partner API es de **reventa** (compramos inventario): **no** · 13 descarga diaria (16.6 MB) y caché · 14 enlace atribuido vía 3.1 · 15 LISTO PARA INTEGRAR · 16 comisión anunciada 12% · 17 probado hoy: 3,349 planes · 18 3.1 · 19 nada · 20 5 · 21 3.1 · 22 Yesim/Saily/GigSky (solo enlaces) para comparar cuando haya datos verificables; **nunca recomendar por comisión**.

### 3.6 Avisos oficiales (GOV.UK + US State Dept + enlace SRE) — Etapa 1
1 GOV.UK Content API, US State Dept · 2 "¿Qué debo saber antes de ir a Tailandia?" · 3 hoy solo enlaces · 4–6 no hace falta · 7 lectura pública · 8 DISCOVERY oficial · 9–11 gratis · 12 son avisos para británicos/estadounidenses: se muestran como tales; para mexicanos se enlaza la SRE · 13 sin cifra pública (caché compartida en `serp_cache`: fuentes 6 h por país, 30 min si una falló; traducción 7 días por versión de las fuentes) · 14 OGL v3 / fuente y fecha visibles · 15 PENDIENTE DE PRUEBAS · 16 — · 17 probados hoy (España actualizado 28-oct; prueba en vivo del módulo: Tailandia, Turquía, Birmania, Reino Unido y EE. UU. con fecha y enlace) · 18 desplegar `avisos-viaje` y `health-check`; conectar `get_travel_advisory` en concierge-chat · 19 nada · 20 Etapa 1 · 21 — · 22 enlaces actuales.

### 3.7 Google Calendar — Etapa 1
1 Google · 2 "Agrega todo mi viaje a mi calendario" · 3 hoy existe archivo `.ics` · 4 cuenta Google Cloud (la del proyecto de Maps) · 5 no (OAuth client) · 6 no · 7 scope mínimo recomendado `calendar.app.created` (solo calendarios que crea IATOS; no lee el tuyo) · 8 crear/actualizar eventos · 9–11 gratis · 12 producción con scopes sensibles exige **verificación de Google** (dominio, política de privacidad, video del flujo) · 13 cuotas amplias · 14 — · 15 NECESITA PERMISO OAUTH · 16 — · 17 pendiente · 18 OAuth client + pantalla de consentimiento · 19 lo pediré cuando toque (pasos en INVESTIGACION_APIS.md §I1) · 20 Etapa 1 · 21 verificación de Google (días/semanas) · 22 mejorar el `.ics` y el enlace "Agregar a Google Calendar" (sin permisos) — se hace primero.

### 3.8 Renfe GTFS + GTFS-RT — Etapa 2
1 Renfe · 2 horarios y retrasos oficiales (Madrid→Sevilla, Sevilla→Granada, Granada→Barcelona) · 3 hoy solo enlace precargado · 4–6 no hace falta · 7 datos públicos · 8 **HORARIO PUBLICADO** (sin tarifas) · 9–11 gratis · 12 solo trenes Renfe (no Iryo/Ouigo) · 13 — · 14 CC BY 4.0 · 15 LISTO PARA INTEGRAR · 16 — · 17 pendiente · 18 nada · 19 nada · 20 Etapa 2 alta · 21 — · 22 enlace actual a venta.renfe.com. **No existe API de tarifas reales sin contrato B2B (Distribusion).**

---

## 4. Plan por etapas (qué se construye y qué no)

**Etapa 1 — Iato Intelligence (sin costo extra):** avisos oficiales (3.6) · mejorar `.ics`/"Agregar a Google Calendar" (sin permisos) · herramienta de clima de Iato con la misma fuente que la página Clima (en curso) · OpenAgenda solo si pides Francia. API de Google Calendar con OAuth cuando esté lista la verificación.
**Etapa 2 — Global Intelligence:** Renfe GTFS (3.8) · OurAirports · Wikivoyage (con atribución) · OpenAQ cuando des la llave · Darwin/Mobility DB solo si hay demanda (UK / otras ciudades).
**Etapa 3 — Execution & Revenue:** Partner Links (3.1) → Statistics (3.2) → GetTransfer cotización (3.3) → WeGoTrip (3.4) → Airalo feed (3.5) → enlaces atribuidos de Radical Storage, Klook, Tiqets, autos y reclamaciones a través del **motor común de proveedores** (contrato normalizado por proveedor: nombre, categoría, cobertura, tipo de acceso, capacidades DISCOVERY/QUOTE/AVAILABILITY/BOOKING/CONFIRMATION/FULFILLMENT, monedas, timestamp, fuente, términos, costo de llamada, estado, errores).

## 5. Costos y control (resumen)
- **IA por viaje armado:** ~USD 0.14 (dos llamadas en paralelo, 28-oct). Iato: Haiku por defecto.
- **SerpApi:** 250 búsquedas/mes gratis; un viaje usa ~2 (multidestino ~4). Con el ritmo actual (~13/día) alcanza ~16 días. Subir de plan es la decisión de costo más urgente si crecen los usuarios.
- **Google Maps:** ~USD 9 en una semana (dentro del crédito mensual de Google).
- **Tripadvisor Terra:** 1,000 entidades gratis de por vida; tope diario configurado.
- **Nuevas integraciones de este plan:** todas gratis por llamada salvo las marcadas ⚠️ (que **no** se activan).
- **Ingresos:** hoy solo hay **clics** registrados (17). No hay comisiones atribuidas registradas; se medirán con 3.2.

## 6. Historial
- 28-oct-2026 · Avisos oficiales y clima de Iato en producción y probados en vivo (Tailandia; clima CDMX con MET Norway). Arreglo: la traducción pedía 900 tokens y llegaba cortada.
- 28-oct-2026 · Creación del documento con auditoría completa (45 integraciones) e investigación de acceso. Próxima solicitud: `trs` de Travelpayouts.
- 28-oct-2026 · Fila 22 (avisos oficiales) → **PENDIENTE DE PRUEBAS**: módulo `_shared/travelAdvisories.ts` (GOV.UK + State Dept, caché compartida, traducción fiel con Haiku y registro en `ai_usage_log`), función `avisos-viaje`, tarjeta "Antes de viajar" (SRE primero), sonda `health-check?action=avisos` y herramienta `get_travel_advisory` lista para Iato (rama `claude/avisos-oficiales`). Pasa a YA FUNCIONA cuando se despliegue y se pruebe en producción.
