# IATOS AI — Proveedores de autobuses en México

**Para quién:** los fundadores de IATOS, para decidir cómo mostrar autobuses en México sin inventar datos.
**Fecha de consulta de todas las fuentes:** 22 de octubre de 2026.
**Código revisado:** `/home/user/wanderly-ai-concierge`, solo lectura, hacia las 04:10 UTC. Otra persona estaba editando `groundTransport.ts` durante la revisión, así que los números de línea pueden moverse. Por eso se citan también los nombres de las funciones.
**Pendiente relacionado:** DEC-04 en [`IATOS_HALLAZGOS_PRIORIZADOS.md`](./IATOS_HALLAZGOS_PRIORIZADOS.md) (hallazgo N-06).

---

## Recomendación en un párrafo

Para autobuses en México no hay hoy un solo proveedor con buena cobertura, precios en vivo y comisión al mismo tiempo. Recomendamos **combinar ligas de búsqueda**. Omio se queda tal como está, con su afiliado de Travelpayouts (6 %, cookie de 30 días, según Travelpayouts). Además, desde esta semana se agregan dos ligas que no requieren ningún convenio: el **sitio internacional de ADO** (en inglés, con tarjetas internacionales; cubre ADO, ADO GL, ADO Platino, OCC y AU, y es la opción más directa para Cancún–Tulum, Oaxaca y Puebla) y **Reservamos** (en español; vende Estrella Roja, ETN, Primera Plus, Futura, Costa Line y otras líneas que no son de ADO, útil para CDMX–Querétaro y CDMX–Puebla). En paralelo, el dueño debe darse de alta en los afiliados de **Busbud** (desde la misma cuenta de Travelpayouts: 5 %, cookie de 7 días) y de **Bookaway** (programa propio: 5 %, cookie de 30 días; vende ADO en inglés, pensado para turistas). Antes de eso hay que confirmar que la liga de Omio que arma el código realmente registra la comisión. Una API con precios en vivo solo vale la pena después, y el camino más realista es **Distribusion**, la empresa cuya tecnología usa hoy el sitio internacional de ADO. Mientras no haya API, IATOS debe mostrar **rangos “estimado” con fuente y fecha** y la liga de búsqueda. Nunca debe mostrar horarios ni precios exactos.

> **Dos correcciones a lo que se suponía:**
> 1. **Estrella Roja no aparece como marca de Mobility ADO** en ninguna fuente que abrimos. Su sitio la identifica como “Autobuses México Puebla Estrella Roja S.A de C.V.” [S18], y Reservamos la vende como “Grupo Estrella Roja”, aparte [S20]. Ni la página de ADO en Wikipedia [S12] ni la nota de Time Out sobre la historia de Mobility ADO [S13] la mencionan. **Conclusión: hay que tratarla como un proveedor independiente.**
> 2. **Estrella de Oro sí es de Mobility ADO desde 2007**: “en 2007, adquiere Estrella de Oro … hacia Cuernavaca y el puerto de Acapulco” [S13]. Rome2rio también da para Estrella de Oro un correo `@ado.com.mx` y manda a comprar en ado.com.mx [S25].

---

## Cómo leer este documento

| Etiqueta | Qué significa |
|---|---|
| **[VERIFICADO]** | Lo leímos en la página citada, abierta el 2026-10-22. |
| **[INDICIO]** | Solo lo vimos en el resumen de un buscador. La página no abrió (bloqueo 403, error 503 o contenido vacío). Sirve como pista, no como dato. |
| **NO VERIFICADO** | No es público o no pudimos abrir la fuente. Se indica cómo obtenerlo. |
| **[SUPUESTO]** | Estimación nuestra, por ejemplo de esfuerzo de desarrollo. |

Las fuentes se citan como **[S#]**. La lista completa está al final, en la sección 7.

**Páginas que no se pudieron abrir** (por eso varios datos quedan NO VERIFICADO):
- busbud.com: páginas de rutas, blog y `es-mx` devolvieron 403.
- ado.com.mx: 403.
- estrelladeoro.com.mx: 503 y error de certificado SSL.
- omio.com, omio.com.br y omio.co.uk: 403.
- Las páginas HTML del centro de ayuda de Travelpayouts devolvieron 403. Los artículos se leyeron con su API pública de ayuda (formato JSON).
- 12go: la página carga vacía.
- Nota de prensa de Distribusion: 404.
- Documentación de Rome2rio: 404.

---

## 1. Qué usa IATOS hoy (código, solo lectura)

| Dónde | Qué hace |
|---|---|
| `src/lib/affiliateLinks.ts:5` | `TP_MARKER = "533299"`, el ID de afiliado de Travelpayouts. |
| `src/lib/affiliateLinks.ts:11` `tpDeepLink()` | Envuelve cualquier URL así: `https://tp.media/click?marker=533299.<subId>&u=<url>`. |
| `src/lib/affiliateLinks.ts:197` `omioLink()` | Arma `https://www.omio.com/search?fromCity=…&toCity=…&outboundDate=…&adults=1&marker=533299` y lo envuelve con el subId **`trains`**. El comentario del código reconoce que la búsqueda “de verdad” de Omio requiere IDs internos. |
| `src/pages/Trenes.tsx:21` | Único lugar del frontend donde se usa `omioLink`: la página **Trenes**, con ejemplos europeos (“París”, “Ámsterdam”). |
| `supabase/functions/analizar-viaje/groundTransport.ts`, función `groundSearchLinks()` (línea ~209) | Para trayectos cortos en México (menos de ~350 km), arma la misma liga de Omio pero con el subId **`bus`**, más una liga de Google Maps para ir en auto. Esta liga se usa en `analizar-viaje/index.ts:959`. |
| `groundTransport.ts`, funciones `shortTripPromptBlock()` y `applyShortTripRules()` | Le piden **al modelo de IA** un rango `precio_min`–`precio_max` en MXN marcado como `fuente_precio="estimado"`. El servidor pone `estado_dato="ESTIMADO"`, reemplaza la liga que propone el modelo por la suya y, si el modelo no da rango, muestra la opción sin precio. |
| `src/lib/consent.ts:16` | El script Travelpayouts Drive (`tp-em.com/…?t=533299`) se carga **solo si el usuario acepta cookies**. |
| Búsqueda de “busbud” | **Cero coincidencias** en el repo. Busbud no está integrado. |
| `src/test/groundTransport.test.ts:103` | Prueba que la liga de autobús empiece con `tp.media/click` y contenga `omio.com/search?fromCity=Ciudad+de+M…`. |

**Riesgos en lo que hay hoy:**
1. **Puede que la liga de Omio no esté pagando comisión.** Travelpayouts pide crear las ligas en su panel, dentro de un “Proyecto” que ya esté **conectado** a la marca. Si el proyecto no está conectado, el estado es “Link not generated yet” [S10]. IATOS arma la liga a mano (`tp.media/click?marker=…&u=…`), sin el identificador de programa. **NO VERIFICADO** que así se atribuya la venta. Cómo comprobarlo: en Travelpayouts → *Links*, generar una liga de Omio para la misma búsqueda, abrir la versión “full link” y compararla con la que arma el código. También conviene revisar en *Statistics* si hay clics con el subId `533299.bus`.
2. **El formato `omio.com/search?fromCity=…` está NO VERIFICADO** porque omio.com nos bloqueó (403). Hay que probarlo a mano desde un navegador en México.
3. **El rango de precio lo inventa el modelo.** Va marcado como “estimado”, pero el número no sale de ninguna fuente. En la sección 4 proponemos una tabla de rangos con fuente y fecha para reemplazarlo.
4. **Omio podría cubrir poco México** (ver la sección 2.4). Si no encuentra la ruta, el viajero llega a una página sin resultados.

---

## 2. Proveedor por proveedor

### 2.1 Busbud

- **Cobertura en México:**
  - [INDICIO] Según resúmenes de búsqueda de páginas de busbud.com (que nos dieron 403): ADO en CDMX–Puebla, con unas 2 h 20 min de viaje; ADO, AU, OCC y ADO Conecta en Cancún–Tulum, con “48 buses available per day”; y Estrella de Oro Pluss en CDMX–Acapulco, con unas 5 h 24 min. **NO VERIFICADO** por apertura directa.
  - [VERIFICADO] Travelpayouts dice que Busbud cubre “84 countries and 21,000 cities”, en un artículo actualizado el 13/12/2021 [S5]. Ese artículo no menciona México.
  - Querétaro y Oaxaca: NO VERIFICADO.
- **Precios en vivo:** su buscador sí muestra disponibilidad para que el usuario compre, pero para IATOS no hay datos en vivo sin la API. NO VERIFICADO desde México.
- **Deep link:** las URLs públicas de rutas tienen la forma `https://www.busbud.com/{idioma}/bus-{origen}-{destino}/r/{geohash}-{geohash}`. Ejemplo visto: `…/bus-mexico-city-puebla/r/9g3w81-9g6hm6` [INDICIO]. No encontramos documentado un formato con fecha. **NO VERIFICADO.** Se obtiene dentro de CJ o de Travelpayouts al darse de alta.
- **API:** existe un “Busbud Distribution Partnership Program”, con API o marca blanca. Las condiciones se negocian (“exact terms and percentages will be discussed during the partnership setup”). No hay documentación pública. El contacto es **partner@busbud.com** [S2] [VERIFICADO]. Costo: NO VERIFICADO.
- **Afiliado:**
  - Directo, por **CJ (Commission Junction)**. Busbud no publica la tasa: “The exact rates can vary, so please check the CJ platform” [S1]. Por lo tanto, la tasa en CJ es **no publicada**. Alta en CJ: `https://signup.cj.com/member/signup/publisher/?cid=5247616#/branded` [S1].
  - Por **Travelpayouts**: **5 % del precio de venta, cookie de 7 días**, ticket promedio de USD 45. No acepta tráfico PPC ni páginas de Facebook con la marca. **Algunos operadores no pagan comisión** porque el usuario termina la compra fuera de Busbud (Flixbus, Terravision, IC Bus y otros) [S4] [VERIFICADO].
  - Pagos por Travelpayouts: la comisión de cada mes se paga el mes siguiente, y las transacciones se cierran “one month and 10 days after the end of the month” [S4].
  - ¿Acepta publishers de México? Busbud dice que el programa “is open to anyone with a website, blog, or social media presence” [S1]. No menciona países. Para México: NO VERIFICADO.
- **Idiomas y moneda:** “11 languages and 17 linguistic variants” y 30 monedas; acepta tarjetas, Google Pay y Apple Pay [S5] (artículo de 2021). Que maneje MXN: NO VERIFICADO.
- **Riesgos:** la cookie de 7 días es corta; hay operadores sin comisión; el sitio bloquea consultas automáticas (no se puede verificar la cobertura desde un servidor); y la comisión de CJ no se conoce hasta darse de alta.

### 2.2 ADO / Mobility ADO (ADO, ADO GL, ADO Platino, OCC, AU, Estrella de Oro)

- **Marcas:**
  - Wikipedia: ADO (primera), ADO GL (lujo), ADO Platino (ejecutivo), y SUR, Volcanes, OCC y AU como segunda y tercera clase [S12] [VERIFICADO].
  - Time Out: OCC y AU fueron adquiridas en los años 80 y 90, y Estrella de Oro en 2007 [S13] [VERIFICADO].
  - **Estrella Roja no es de ADO** (ver la corrección al inicio).
- **Sitio internacional: international.ado.com.mx** [S14] [VERIFICADO]
  - Está en inglés y tiene selector de idiomas (es-MX, en, fr, pt-BR, de y otros).
  - Su descripción dice: “Book ADO, ADO Platino, ADO GL and more brands! ✔ International cards accepted”, y menciona Cancún, Tulum, Playa del Carmen, Oaxaca, Puebla, Acapulco y CDMX.
  - Funciona con tecnología de **Distribusion**: carga `book.distribusion.com/sdk.1.0.0.js`.
  - En una ruta de ejemplo dice que se puede pagar “in more than 15 currencies” [S15].
- **Cobertura por ruta:**
  - **AICM → Puebla:** “usually around MXN $462 … Up to 30 departures daily … around 2 hours 50 minutes” [S15] [VERIFICADO].
  - **Cancún → Tulum, CDMX → Oaxaca y CDMX → Mérida:** el sitio internacional tiene ligas directas a estas búsquedas [S14] [VERIFICADO].
  - Rome2rio también registra para Tulum–Cancún a ADO (cada hora), AU y OCC, con compra en ado.com.mx [S26]. Para CDMX–Oaxaca registra a ADO (cada hora) y AU [S28].
  - **CDMX–Acapulco:** está en la descripción del sitio, pero la liga exacta está NO VERIFICADA.
  - **CDMX–Querétaro:** NO VERIFICADO. Rome2rio no muestra a ADO en esa ruta [S27].
- **Precios en vivo:** sí, en su propio sitio. Para IATOS no, porque no hay API pública.
- **Deep link (sin convenio)** [VERIFICADO en el HTML y en el código del SDK, S14 y S35]:
  ```
  https://international.ado.com.mx/result?departureCity=MXCUN&arrivalCity=MXTUL&retailerPartnerNumber=343401&locale=en-US&currency=USD
  ```
  - Códigos vistos: `MXMCI` (Ciudad de México), `MXCUN` (Cancún), `MXTUL` (Tulum), `MXOAX` (Oaxaca), `MXMID` (Mérida), `MXSZT` (San Cristóbal).
  - El SDK también lee `departureDate`, `returnDate` y `pax` de la URL [S35]. **El formato de la fecha (probablemente `AAAA-MM-DD`) y los códigos de Puebla, Acapulco y Querétaro están NO VERIFICADOS.** Hay que probarlos a mano.
  - `retailerPartnerNumber=343401` es el número del propio sitio de ADO. **No genera comisión para IATOS**, y no hay que cambiarlo por otro inventado.
- **API pública:** no encontramos ninguna. En mobilityado.com solo hay un formulario de contacto genérico (nombre, teléfono, correo y mensaje) [S16]. **NO VERIFICADO**. Cómo obtenerla: (a) escribir a Distribusion (sección 2.6); (b) usar ese formulario de Mobility ADO y pedir “alianza comercial / distribución digital”.
- **Afiliado:** no encontramos programa de afiliados de ADO en ninguna red. **NO VERIFICADO.** Para preguntar, se usa el mismo formulario.
- **Turistas:** el sitio internacional acepta tarjetas internacionales según su propia descripción [S14]. Una guía actualizada el 20/10/2026 dice que ado.com.mx “rejects my U.S. credit card about 75% of the time” y que hay pago en efectivo con referencia Paynet [S17] (experiencia personal, no política oficial). **Para turistas, conviene mandarlos al sitio internacional y no a ado.com.mx.**
- **Riesgos:** no hay comisión; el sitio principal bloquea bots (no se puede monitorear); y los códigos de ciudad son internos y pueden cambiar.

### 2.3 Estrella de Oro (CDMX–Cuernavaca–Taxco–Acapulco–Guerrero)

- **Propiedad:** Mobility ADO desde 2007 [S13] [VERIFICADO].
- **Sitio propio:** estrelladeoro.com.mx **no abrió** (503 y luego error de certificado SSL). Venta en línea, idiomas y pagos: **NO VERIFICADO**.
- **Cobertura CDMX–Acapulco:**
  - Rome2rio: Taxqueña → Acapulco Costera, “hourly”, unas 5 h, precio estimado $22–55, con compra en **ado.com.mx** [S25] [VERIFICADO].
  - Wanderu: Estrella de Oro Diamante, 15 salidas diarias, desde USD 56 (promedio USD 58.25, 5 h 17 min); EDO Pluss, 13 salidas diarias, desde USD 48 (5 h) [S30] [VERIFICADO].
- **Deep link:** no tiene uno propio verificado. Mientras tanto se puede usar la liga de ADO (si el sitio internacional vende Estrella de Oro, cosa **NO VERIFICADA**) o la de Wanderu como ficha informativa.
- **API y afiliado:** NO VERIFICADO. Se piden por el mismo canal que ADO (formulario de Mobility ADO [S16] o Distribusion).
- **Riesgos:** su sitio está caído o mal configurado (lo vimos así el 2026-10-22), y no sabemos qué canal la vende en inglés.

### 2.4 Omio (lo que IATOS usa hoy; se queda)

- **Cobertura en México:**
  - Travelpayouts la describe para viajes europeos [S6] [S7] y no menciona México.
  - Rome2rio, que es del mismo grupo Omio [S29], **sugiere Omio para comprar CDMX–Querétaro** [S27] [VERIFICADO]. Es una señal de que Omio tiene algo de México.
  - [INDICIO] Un resumen de omio.com.br muestra “Flix Mexico” en CDMX–Puebla; esa página dio 403. FlixBus sí opera CDMX–Puebla, con unas 9 salidas al día [S38] [VERIFICADO].
  - Que Omio venda ADO, Estrella de Oro o Estrella Roja: **NO VERIFICADO.**
- **Precios en vivo:** en su sitio sí. Para IATOS no hay API pública conocida.
- **Deep link:** el que usa IATOS (`/search?fromCity=…`) está NO VERIFICADO (ver la sección 1). Travelpayouts ofrece un generador de ligas a cualquier página de Omio [S6] [S10].
- **API:** no encontramos una pública. NO VERIFICADO. Se puede preguntar al gerente de Travelpayouts o en omio.com/corporate [S29].
- **Afiliado (Travelpayouts)** [S6] [VERIFICADO]:
  - **6 % del precio de reserva**, cookie de **30 días**, ticket promedio de USD 81.
  - Única restricción: nada de cashback ni descuentos en boletos de Deutsche Bahn.
  - Herramientas: ligas, widgets, formulario de búsqueda y Drive.
  - Un artículo antiguo (actualizado en 2018) dice “Cookie period of 30 days last-click” y pagos mensuales [S7].
- **Pagos de Travelpayouts** (válidos para Omio, Busbud y 12Go) [S11] [VERIFICADO, artículo actualizado el 21/10/2026]:
  - Transferencia en USD o EUR: mínimo 400.
  - PayPal: mínimo USD 50.
  - WebMoney: mínimo USD 10.
  - Los pagos son automáticos, y **“The available payout methods depend on your country of residence”**. Qué métodos hay para México: NO VERIFICADO. Se ve en *Finance → Payout methods* con la cuenta del dueño.
- **Idiomas:** 18 idiomas, incluido el español [S7] (2018). Que maneje MXN: NO VERIFICADO.
- **Riesgos:** cobertura de México incierta; liga posiblemente sin atribución; y en IATOS la misma función se usa para trenes europeos y para autobuses mexicanos.

### 2.5 Otros agregadores

| Proveedor | Lo que encontramos |
|---|---|
| **Reservamos (reservamos.mx)** | **[VERIFICADO]** Vende **37 grupos y 76 líneas**, entre ellos Grupo Estrella Roja, Grupo Etn-Turistar, Grupo Estrella Blanca (Futura, Costa Line), Grupo Flecha Amarilla, Coordinados y Grupo Omnibus de México. **No aparecen ADO, OCC, AU ni Estrella de Oro** [S20]. Actúa “únicamente … como comisionista del usuario” [S21]. Acepta Visa, Mastercard, Amex, Mercado Pago, PayPal, OXXO y Aplazo [S22]. Tiene versión en inglés (`en.reservamos.mx`, respondió 200) [S19]. **Deep link** [VERIFICADO en su home y en su widget, S19 y S24]: `https://viaje.reservamos.mx/search/ciudad-de-mexico/santiago-de-queretaro`. Con fecha y pasajeros, el widget arma `/search/{origen}/{destino}/{fecha}/p/A1/providers`; el formato exacto de la fecha está NO VERIFICADO (el código usa `AAAA-MM-DD` y `DD-MMM-YY` en distintos flujos). **Afiliado y API: NO VERIFICADO.** Su sitio corporativo (reservamos.tech) solo ofrece “Reserhub” para empresas de autobuses y un formulario en `reservamos.tech/contacto` [S23]. |
| **Rome2rio** | **[VERIFICADO]** Muestra las 5 rutas con operadores, frecuencia y **precios marcados como “Estimated price”** [S25–S28]. Es del grupo Omio [S29]. No vende boletos: manda al operador, a Omio o a 12go. API y afiliado: **NO VERIFICADO.** Su página “About” no menciona API ni afiliados, solo publicidad (`rome2rio.com/advertise`) y alta de operadores [S29]. |
| **ClickBus México** | Su home es una aplicación que no muestra contenido sin JavaScript; solo leímos el título “Boletos de autobús en línea fácil y rápido” [S33]. **Líneas que vende: NO VERIFICADO.** Un directorio de terceros (affi.io) lista programas en TradeTracker (“Opened”, “5% de la compra”, cookie de 30 días, ticket promedio de $550 MXN), Sale Gains y BlueAff (abiertos) y Admitad (cerrado) [S32]. Es un directorio no oficial, así que la comisión queda como **no publicada por ClickBus**. Se confirma dándose de alta en TradeTracker México. |
| **Wanderu** | **[VERIFICADO]** Tiene México. En CDMX–Acapulco lista Estrella de Oro Diamante, EDO Pluss y ETN con precios en USD [S30]. **Afiliado y API: NO VERIFICADO.** No encontramos programa. Habría que preguntar por el contacto de su sitio. |
| **GotoBus** | Tiene una página de afiliados (“Join Now”, “Real-time reporting”), pero sin tasa ni cookie publicadas [S31]. Cobertura en México: NO VERIFICADO. |
| **Bookaway** | **[VERIFICADO]** Vende ADO en ~1,958 rutas y 138 ciudades (ejemplos: TAPO → Oaxaca, Tulum, Cancún; CAPU → Acapulco), con precios en US$ [S37]. **Afiliado directo:** “5% of the revenue share”, cookie de 30 días, pago mensual desde USD 50 por transferencia, factura o PayPal; deep links a rutas; alta en `bookaway2.hasoffers.com/signup`; sin países excluidos [S36]. Riesgo: sus precios en USD pueden traer cargo extra frente a ADO directo (NO VERIFICADO). |
| **12Go** | En Travelpayouts paga 50 % del ingreso de 12Go por orden, con cookie de 30 días, pero **su página no menciona México** [S9]. Rome2rio sugiere 12go.asia para CDMX–Oaxaca y Tulum–Cancún [S26] [S28]. Las páginas de 12Go cargaron vacías: **NO VERIFICADO.** |
| **Travelpayouts (como red)** | No tiene inventario propio. En autobús, hoy solo nos sirven Omio, Busbud y quizá 12Go. Su artículo de transporte terrestre (2022) no menciona a ningún programa con México [S8]. |

### 2.6 Distribusion (la API detrás de ADO International)

- **[VERIFICADO]** El sitio internacional de ADO carga el SDK de `book.distribusion.com` [S14]. Distribusion ofrece una **API B2B** con búsqueda de conexiones, disponibilidad de asientos, reservas, cancelaciones y estaciones. Para pedir una llave demo hay que escribir a **partner@distribusion.com** [S34]. Precio: no publicado; la documentación tiene una sección “Fees” sin cifras [S34].
- [INDICIO] Un comunicado de Distribusion (noviembre de 2023, la página dio 404) decía que ADO, Transpaís e IAMSA fueron de las primeras líneas mexicanas en Google gracias a su tecnología. **NO VERIFICADO.**
- **Riesgo:** es un producto para agencias y OTAs. Puede pedir volumen mínimo, contrato o depósito (NO VERIFICADO).

---

## 3. Tabla comparativa

| Proveedor | Cobertura MX (rutas pedidas) | Precio en vivo para IATOS | Deep link con origen/destino/fecha | API | Afiliado | Evidencia |
|---|---|---|---|---|---|---|
| **ADO International** | Puebla (AICM) ✔, Cancún–Tulum ✔, Oaxaca ✔, Acapulco (anunciado), Querétaro ✖/? | No (solo en su sitio) | **Sí**, `/result?departureCity=…&arrivalCity=…`; fecha `departureDate` (formato NO VERIFICADO) | No pública (vía Distribusion) | No encontrado | S14, S15, S35 |
| **Estrella de Oro** | Acapulco ✔ (Rome2rio, Wanderu) | No | NO VERIFICADO (sitio caído) | NO VERIFICADO | NO VERIFICADO | S13, S25, S30 |
| **Reservamos** | Querétaro ✔, Puebla (Estrella Roja) ✔, Acapulco (Estrella Blanca) probable; sin ADO, así que Cancún–Tulum y Oaxaca son dudosos | No | **Sí**, `/search/{origen}/{destino}` (fecha NO VERIFICADA) | NO VERIFICADO | NO VERIFICADO | S19–S24 |
| **Omio** (actual) | Querétaro (sugerido por Rome2rio); Puebla [INDICIO]; resto NO VERIFICADO | No | IATOS usa `/search?fromCity=…` (NO VERIFICADO) | No pública | **Travelpayouts 6 %, 30 días** | S6, S7, S27 |
| **Busbud** | Puebla, Cancún–Tulum, Acapulco [INDICIO, páginas con 403] | No | Ruta sin fecha `/r/{geohash}-{geohash}` [INDICIO] | Sí, por convenio (partner@busbud.com) | **Travelpayouts 5 %, 7 días**; CJ (no publicada) | S1–S5 |
| **Bookaway** | ADO: CDMX (TAPO) → Oaxaca, Tulum y Cancún ✔; Puebla (CAPU) → Acapulco ✔; Cancún–Tulum, CDMX–Acapulco y Querétaro NO VERIFICADO | No | Deep links a rutas (dentro del programa) | No mencionada | **Directo 5 %, 30 días, mínimo USD 50** | S36, S37 |
| **Wanderu** | Acapulco ✔ | No | Ficha de ruta `/bus/mx-cmx/…/mx-gro/acapulco/` | NO VERIFICADO | NO VERIFICADO | S30 |
| **Rome2rio** | Las 5 ✔ (información) | No: “Estimated price” | `/s/{origen}/{destino}` (informativo, sin fecha) | NO VERIFICADO | NO VERIFICADO | S25–S29 |
| **ClickBus MX** | NO VERIFICADO | No | NO VERIFICADO | NO VERIFICADO | TradeTracker 5 %/30 días según directorio de terceros (no oficial) | S32, S33 |
| **12Go** | Oaxaca, Tulum–Cancún (sugerido por Rome2rio) | No | Generador de Travelpayouts | No | Travelpayouts 50 % del ingreso de 12Go, 30 días (sin mención de MX) | S9, S26, S28 |
| **Distribusion** | Inventario de ADO (por el SDK del sitio de ADO) | **Sí, si hay contrato** | n/a | **Sí**, B2B, partner@distribusion.com | No (es B2B) | S34, S35 |

✔ = verificado en una página abierta · ? = sin confirmar · ✖ = no aparece en la fuente.

---

## 4. Qué mostrar HOY sin ningún convenio

**Regla:** nada de horarios exactos ni de “precio desde” como si fuera en vivo. Cada opción de autobús lleva **etiqueta “estimado”**, **rango**, **fuente con fecha** y **liga de búsqueda**. Además, recomendamos que el rango salga de una **tabla curada** como esta, no del modelo de IA (riesgo 3 de la sección 1).

Tipo de cambio para convertir: 1 USD = 18.4823 MXN (BCE vía Frankfurter, 2026-10-21) [S39]. Los precios de Rome2rio aparecen con “$” sin código de moneda; por su magnitud parecen USD (**[SUPUESTO]**). Las cifras se redondean.

| Ruta | Rango de referencia por persona, un sentido | Fuente (2026-10-22) | Ligas que se pueden mostrar hoy |
|---|---|---|---|
| CDMX (AICM) → Puebla | **~MXN 462** con ADO | S15 | ADO International · Reservamos (Estrella Roja) · Omio |
| CDMX → Acapulco | Estrella de Oro **$22–55 (~MXN 407–1,017)** estimado; EDO Pluss desde USD 48 (~MXN 887); Diamante desde USD 56 (~MXN 1,035) | S25, S30 | ADO International (Acapulco anunciado) · Reservamos (Costa Line/Futura) · Omio |
| CDMX → Querétaro | Coordinados **$17–30 (~MXN 314–554)**; Futura **$27–45 (~MXN 499–832)**; Apolo Platinum **$19–35 (~MXN 351–647)**, todos estimados | S27 | Reservamos · Omio |
| Cancún → Tulum | ADO **$14–25 (~MXN 259–462)**; AU **$11–21 (~MXN 203–388)**; Tren Maya **$12–60** según categoría, todos estimados (dato de Tulum → Cancún) | S26 | ADO International (`MXCUN`→`MXTUL`) · Omio |
| CDMX → Oaxaca | ADO **$45–75 (~MXN 832–1,386)**; AU **$30–50 (~MXN 554–924)**, estimados | S28 | ADO International (`MXMCI`→`MXOAX`) · Omio |

Texto sugerido en la tarjeta: *“Precio estimado: $X–$Y MXN por persona (referencia pública consultada el 22/10/2026). El precio y los horarios reales se confirman en el sitio de la línea.”*

**Para turistas internacionales:** la primera liga debe ser ADO International (inglés y tarjetas internacionales [S14]); la de Reservamos va en español o en su versión en inglés.

---

## 5. Ruta de integración por fases

### Fase A — Inmediata, sin convenio (esfuerzo [SUPUESTO]: 1 a 2 días de desarrollo y prueba)
1. **Mantener Omio** tal como está.
2. **Agregar la liga de ADO International** con códigos de ciudad (empezar con `MXMCI`, `MXCUN`, `MXTUL`, `MXOAX` y `MXMID`, que ya vimos). Probar a mano `departureDate` y `currency=MXN` antes de publicar.
3. **Agregar la liga de Reservamos** (`viaje.reservamos.mx/search/{origen}/{destino}`) para las rutas que no son de ADO: Querétaro y Puebla con Estrella Roja.
4. **Cambiar el rango del modelo por la tabla curada** de la sección 4, con fuente y fecha, y revisarla cada mes.
5. No pasa por el afiliado: estas dos ligas nuevas **no pagan comisión**. Su valor es que el viajero encuentre la ruta.

### Fase B — Altas de afiliado que debe hacer el dueño (1 a 3 semanas de aprobación, NO VERIFICADO)
1. **Travelpayouts (ya tiene la cuenta 533299):**
   - Revisar que el Proyecto esté **conectado a Omio** y generar una liga de prueba para comparar (riesgo 1).
   - Conectar también **Busbud** (5 %, 7 días) [S4].
   - En *Finance → Payout methods*, elegir país “México” y ver qué métodos aparecen [S11].
2. **Bookaway:** alta en `https://bookaway2.hasoffers.com/signup` (5 %, 30 días, mínimo USD 50) [S36]. Es la opción en inglés para ADO con comisión.
3. **CJ (opcional, Busbud directo):** alta en `https://signup.cj.com/member/signup/publisher/?cid=5247616#/branded` [S1]. Comparar la tasa de CJ con el 5 % de Travelpayouts; quedarse con uno de los dos para no duplicar.
4. **TradeTracker México (opcional, ClickBus):** solo después de confirmar qué líneas vende ClickBus.
5. **Reservamos y Mobility ADO:** preguntar si tienen programa de afiliados (ver la sección 6).

### Fase C — API (solo si hay volumen; esfuerzo [SUPUESTO])
- **Opción recomendada: Distribusion** (partner@distribusion.com) [S34]. Ya alimenta el sitio de ADO, así que es la vía más probable a precios en vivo de ADO, OCC, AU y quizá Estrella de Oro.
- **Alternativa:** Busbud API (partner@busbud.com) [S2], que agrega más líneas pero con condiciones no publicadas.
- **Esfuerzo estimado [SUPUESTO]:**
  - Gestión comercial: 4 a 12 semanas.
  - **Solo búsqueda y mostrar precios en vivo, con redirección para comprar:** 3 a 5 semanas de un desarrollador. Incluye mapear estaciones, caché, manejo de errores y la UI con la marca de “en vivo”.
  - **Venta dentro de IATOS** (cobro, boletos, cancelaciones, atención al cliente): 2 a 3 meses adicionales, más obligaciones de pago y soporte. **No lo recomendamos al inicio.**
- **Cuándo vale la pena [SUPUESTO]:** cuando las ligas de autobús generen suficientes clics al mes para justificar el contrato. Medirlo primero con los subIds de la Fase B.

---

## 6. Próximos pasos del dueño

| # | Acción | Dónde |
|---|---|---|
| 1 | Validar que la liga de Omio genera comisión (generar una liga en el panel y comparar; revisar estadísticas del subId `533299.bus`). | Travelpayouts → *Links* y *Statistics* (guía: S10) |
| 2 | Conectar Busbud en el mismo Proyecto de Travelpayouts. | `https://www.travelpayouts.com/en/offers/busbud-affiliate-program` |
| 3 | Revisar los métodos de pago disponibles para México. | Travelpayouts → *Finance → Payout methods* (S11) |
| 4 | Alta en Bookaway. | `https://bookaway2.hasoffers.com/signup` |
| 5 | Pedir llave demo e inventario de México (ADO, OCC, AU, Estrella de Oro, Estrella Roja, ETN, Primera Plus), costo y requisitos. | **partner@distribusion.com** |
| 6 | Preguntar por API o marca blanca para México y su reparto de ingresos. | **partner@busbud.com** |
| 7 | Preguntar por un programa de afiliados o de distribución digital, y si el sitio internacional vende Estrella de Oro. | Formulario: `https://www.mobilityado.com/contacto.html` |
| 8 | Preguntar por afiliados o API. | Reservamos: `https://reservamos.tech/contacto` |
| 9 | Preguntar por afiliados y venta en línea. | Estrella Roja: Tel. 222 273 8300 / WhatsApp 221 108 3739 (S18) |
| 10 | Volver a intentar estrelladeoro.com.mx desde un navegador en México y anotar si vende en línea. | `https://www.estrelladeoro.com.mx/` |
| 11 | Probar a mano, desde México, las ligas de Omio, ADO International (con fecha) y Reservamos (con fecha) para CDMX–Puebla, CDMX–Acapulco, CDMX–Querétaro, Cancún–Tulum y CDMX–Oaxaca, y guardar capturas. | Navegador |

---

## 7. Fuentes (todas consultadas el 2026-10-22)

| # | URL | Nota |
|---|---|---|
| S1 | https://www.busbud.com/en/affiliate | Afiliado vía CJ; tasa no publicada |
| S2 | https://www.busbud.com/partner/busbud-api/ | API y marca blanca; partner@busbud.com |
| S3 | https://www.busbud.com/partner/busbud-widget | Menciona widgets sin detalle |
| S4 | https://www.travelpayouts.com/en/offers/busbud-affiliate-program | 5 %, 7 días, exclusiones |
| S5 | https://travelpayouts.com/blog/busbud-affiliate-program/ | Idiomas y monedas (actualizado 13/12/2021) |
| S6 | https://travelpayouts.com/en/offers/omio-affiliate-program | 6 %, 30 días |
| S7 | https://travelpayouts.com/blog/goeuro-affiliate-program/ | Omio (actualizado 13/07/2018) |
| S8 | https://travelpayouts.com/blog/?p=4065 | Programas de transporte terrestre (actualizado 03/08/2022) |
| S9 | https://www.travelpayouts.com/en/offers/12go-affiliate-program | 12Go |
| S10 | https://support.travelpayouts.com/hc/en-us/articles/360027634052-How-to-create-and-use-affiliate-links | Leído vía `…/api/v2/help_center/en-us/articles/360027634052.json` (el HTML dio 403) |
| S11 | https://support.travelpayouts.com/hc/en-us/articles/206635007-How-to-add-or-change-your-payout-method | Leído vía `…/api/v2/help_center/en-us/articles/206635007.json` |
| S12 | https://en.wikipedia.org/wiki/Autobuses_de_Oriente | Marcas de ADO |
| S13 | https://www.timeoutmexico.mx/ciudad-de-mexico/que-hacer/desde-el-metrobus-en-cdmx-hasta-zaragoza-espana-asi-mobility-ado-cumple-85-anos | Compra de Estrella de Oro en 2007 |
| S14 | https://international.ado.com.mx/ | Sitio en inglés, deep links, SDK de Distribusion |
| S15 | https://international.ado.com.mx/ado-bus/mexico-city-airport-aicm-to-puebla | ~MXN 462, hasta 30 salidas |
| S16 | https://www.mobilityado.com/ y https://www.mobilityado.com/contacto.html | Formulario de contacto |
| S17 | https://travelmexicosolo.com/ado-buses-mexico | Experiencia con tarjetas (actualizado 20/10/2026) |
| S18 | https://www.estrellaroja.com.mx/ | Razón social propia y contacto |
| S19 | https://www.reservamos.mx/ | Ligas `viaje.reservamos.mx/search/…` |
| S20 | https://www.reservamos.mx/autobuses/lineas | 37 grupos y 76 líneas |
| S21 | https://contenido.reservamos.mx/politicas-con-lineas-de-autobus/ | Reservamos como comisionista |
| S22 | https://contenido.reservamos.mx/metodos-de-pago/ | Métodos de pago |
| S23 | https://reservamos.tech/ | Reserhub y contacto |
| S24 | https://widgets.reservamos.mx/search/6.11.0/search.js | Formato de URL con fecha |
| S25 | https://www.rome2rio.com/s/Terminal-Poniente-Observatorio/Acapulco | Estrella de Oro, precio estimado |
| S26 | https://www.rome2rio.com/s/Tulum/Canc%C3%BAn | ADO, AU, OCC, Tren Maya |
| S27 | https://www.rome2rio.com/s/Ciudad-de-M%C3%A9xico/Quer%C3%A9taro | Coordinados, Futura, Apolo; sugiere Omio |
| S28 | https://www.rome2rio.com/s/Ciudad-de-M%C3%A9xico/Oaxaca | ADO, AU; sugiere 12go |
| S29 | https://www.rome2rio.com/about | Parte del grupo Omio |
| S30 | https://www.wanderu.com/en-us/bus/mx-cmx/mexico-city/mx-gro/acapulco/?cur=USD | Estrella de Oro y ETN |
| S31 | https://www.gotobus.com/affiliate/ | Afiliado sin tasa publicada |
| S32 | https://affi.io/m/clickbus-mx | Directorio de terceros (no oficial) |
| S33 | https://www.clickbus.com.mx/ | Solo se leyó el título |
| S34 | https://docs.distribusion.com/dt/api/getting-started/intro | API B2B; partner@distribusion.com |
| S35 | https://book.distribusion.com/sdk.1.0.0.js | Parámetros `departureCity`, `departureDate`, `pax` |
| S36 | https://www.bookaway.com/affiliates | 5 %, 30 días, mínimo USD 50 |
| S37 | https://www.bookaway.com/suppliers/ado | Rutas ADO en Bookaway |
| S38 | https://www.flixbus.co.uk/bus-routes/mexico-city-puebla-puebla | FlixBus CDMX–Puebla |
| S39 | https://api.frankfurter.dev/v1/latest?from=USD&to=MXN | 18.4823 MXN por USD (2026-10-21) |

**Datos que solo vimos como [INDICIO]** (resumen de buscador, sin abrir la página): las rutas de Busbud en México; la nota de Distribusion sobre ADO, Transpaís e IAMSA en Google; “Flix Mexico” en omio.com.br; las páginas de 12Go con ADO en CDMX–Oaxaca; y una tasa de 1.6 % y cookie de 7 días para Busbud en FlexOffers. No se usaron como dato.
