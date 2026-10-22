# IATOS AI: plan comercial

**Comercializar, vender, expandir y liderar el mercado.**

- **Fecha:** 22 de octubre de 2026. Para la reunión del viernes 23 de octubre con el asesor experto en IA.
- **Para quién:** los fundadores de IATOS AI y el asesor.
- **Rama:** `claude/wc-plan-comercial`, sobre `claude/iatos-world-class`. Este documento no cambia código, precios ni políticas.
- **Documentos internos en los que se basa:** `IATOS_RESUMEN_DIRECCION.md`, `IATOS_RELEASE_GATE.md`, `IATOS_COSTOS_UNITARIOS.md`, `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md`, `IATOS_ARQUITECTURA_OBJETIVO.md`, `IATOS_MATRIZ_FUNCIONAL.md`, la serie `IATOS_PRIVE_*.md`, `IATOS_PRIVE_ALIANZAS_COMERCIALES.md` e `IATOS_PROVEEDORES_AUTOBUSES.md`.

**Etiquetas.** Cada número lleva una:

| Etiqueta | Qué significa |
|---|---|
| **[INTERNO]** | Sale de nuestros documentos, del código o de datos de producción. |
| **[F#]** | Fuente externa, listada en el apéndice (sección 13) con su URL y fecha. |
| **[INDICIO]** | Dato externo que solo vimos en un resumen o en una fuente secundaria, porque la página original no abrió. Sirve de orientación, no de prueba. |
| **[ESTIMADO]** | Cálculo o supuesto nuestro. Puede estar mal; se dice cómo se obtuvo. |

Tipo de cambio de todo el documento: 1 USD = 18.4823 MXN (BCE vía Frankfurter, 2026-10-21) [INTERNO, mismo que `IATOS_COSTOS_UNITARIOS.md`].

---

## 1. Resumen ejecutivo

**Qué es IATOS.** Un concierge de viajes con IA (Iato), en español y pensado primero para México. Busca vuelos, hoteles y lugares en tiempo real, arma cotizaciones con fuente y fecha, vigila precios y vuelos, organiza viajes en grupo y divide gastos. Cuando la IA no alcanza, escala a una persona (Fixer). Encima de eso, **IATOS Privé** premia la lealtad: tras 90 días de PRO pagado se abre un catálogo curado de 12 universos de experiencias en todo el mundo.

**Dónde estamos, sin adornos.**
- **No tenemos clientes que paguen.** Los 11 usuarios tienen PRO de cortesía. Stripe sigue en modo de prueba [INTERNO].
- La app corre en producción, pero varias piezas clave (Iato con herramientas, cotizaciones con historial, cuotas, cobros) **tienen correcciones terminadas y probadas que todavía no se despliegan**. Hay 94 hallazgos corregidos en la rama y 737 pruebas automáticas que pasan [INTERNO].
- Para cobrar PRO a $99 faltan cuatro cosas, todas en manos del dueño: desplegar la rama, dejar Stripe listo, verificar el dominio de correo y contratar el plan de SerpApi [INTERNO, `IATOS_RELEASE_GATE.md` §4].
- **No hay ninguna alianza firmada** ni comisiones confirmadas [INTERNO].

**El mercado es grande y está digitalizado.**
- Los residentes en México gastaron **MXN 3.74 billones en turismo dentro del país** y **MXN 289 mil millones en el extranjero** en 2024 [F2].
- En 2025 hubo **20.1 millones de salidas de turistas** al extranjero; gastaron **USD 9,677 millones**, 19.7% más que en 2024 [F1].
- El 83.1% de la población de 6 años o más usa internet, y de quienes usan celular, el 96.6% usa solo un teléfono inteligente [F3].
- **El hueco:** los asistentes de IA de viaje más conocidos (Mindtrip, Layla, Google, ChatGPT con Expedia y Booking) nacen en inglés y para Estados Unidos. Ninguno combina español mexicano, cotización con fuente y vigencia, un humano que resuelve y un programa de lealtad curado.

**Cómo ganamos dinero.**
1. **Suscripción PRO** (el motor). PRO Fundadores a $99 MXN al mes, IVA incluido: nos quedan **MXN 76.35** después de IVA y Stripe. PRO Regular a $149 queda como precio futuro, **pendiente de aprobación**: dejaría MXN 116.67 [ESTIMADO, mismo método de `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md` §1].
2. **Comisiones de afiliados** (complemento). Por ejemplo, 8% en experiencias de Viator [F14] y GetYourGuide vía Travelpayouts [F12]. **La atribución en la app no está verificada** (IATOS-077) [INTERNO].
3. **Más adelante:** Privé Signature, B2B para agencias y empresas, y socios.

**Los números que importan** [ESTIMADO sobre costos INTERNOS]:

| | PRO a $99 | PRO a $149 |
|---|---|---|
| Lo que nos queda por usuario al mes | MXN 76.35 | MXN 116.67 |
| Costo de un PRO típico al mes | MXN 33.3 | MXN 33.3 |
| Margen bruto de un PRO típico | **56%** | **71%** |
| Margen con la mezcla 70% típicos, 20% intermedios y 10% pesados | 37% | 59% |
| PRO que pagan los costos fijos de lanzamiento (USD 170 al mes) | **73 a 111** | **38 a 46** |
| PRO que pagan los costos fijos más ~MXN 17,000 al mes de personas (curaduría y Fixer de medio tiempo) | ~470 a 710 | ~240 a 290 |

**El plan.**
- **0 a 90 días:** pasar la compuerta de liberación, cobrar los primeros PRO Fundadores y probar cinco canales con poco dinero: creadores, comunidades, referidos, contenido y un piloto con un banco.
- **Meta a 90 días:** **100 PRO pagando** y medir conversión, cancelación y costo real por usuario [ESTIMADO].
- **6 a 12 meses:** **1,000 a 2,000 PRO pagando** [ESTIMADO], el primer acuerdo B2B2C (banco o tarjeta premium), 3 a 5 socios Privé firmados y los primeros miembros Privé.
- **Después:** LatAm hispana y la población hispana de Estados Unidos.

**Qué le pedimos al asesor** (sección 12): ayuda para diseñar agentes que reservan con confirmación sin inventar, para controlar el costo de los modelos, y presentaciones con bancos y aerolíneas y con inversionistas.

---

## 2. El problema y por qué ahora

**El problema del viajero mexicano.**
1. **Planear un viaje es disperso:** vuelos en un sitio, hotel en otro, actividades en redes y el grupo en WhatsApp.
2. **No se puede confiar en los precios.** Cambian, los buscadores muestran "desde" y las IA generalistas inventan cifras con seguridad. IATOS lo vivió en su propio código: el chat ofrecía "jets privados" con precios inventados y prometía un Fixer 24/7 que no existía. Ya está corregido en la rama [INTERNO, `IATOS_HALLAZGOS_PRIORIZADOS.md`].
3. **Cuando algo sale mal, la IA no responde por ti.** Nadie te ayuda con un vuelo cancelado, una reserva perdida o una cena especial.
4. **Las herramientas de IA de viaje no son para México:** nacen en inglés y en dólares, y entienden poco de la lógica local (MSI, autobuses de ADO, puentes, viajes en familia).

**Por qué ahora.**
- **La demanda crece.** El gasto de los turistas mexicanos en el extranjero subió **19.7% en 2025**, a USD 9,677 millones. El de los que viajan por avión creció **22.9%**, a USD 7,815 millones [F1].
- **Los pagos digitales ya están maduros.** El uso de la app del banco entre adultos con cuenta pasó de 54.3% a **69.1%** entre 2021 y 2024 [F4]. El 35.8% de los usuarios de internet ya compra en línea [F3].
- **La IA ya puede hacer cosas, no solo conversar.** ChatGPT abrió apps de Expedia y Booking.com dentro del chat en octubre de 2025 [F18]. Google empezó a seguir precios y a reservar hoteles dentro de AI Mode en 2026, primero en inglés y en Estados Unidos [F19]. Expedia compró Layla en julio de 2026 [F17].
- **Se abre una ventana.** Los grandes validan la categoría, pero llegan tarde a México y sin un humano. Desde ahora y hasta que lleguen en español con servicio local, hay una oportunidad para un jugador especializado. Esa ventana no es permanente [ESTIMADO].

---

## 3. Producto y diferenciación

### 3.1 Qué existe hoy (honesto)

Estados, como en `IATOS_ARQUITECTURA_OBJETIVO.md`:
- **EN PRODUCCIÓN:** corre hoy; puede tener defectos conocidos.
- **EN RAMA:** construido y probado, pero no desplegado. Requiere el GO del dueño.
- **EN DISEÑO:** no hay código.

| Capacidad | Estado | Nota honesta |
|---|---|---|
| Iato, el chat de viaje con herramientas en vivo (vuelos, hoteles, lugares, estado de vuelo) | EN PRODUCCIÓN con defecto grave; **corrección EN RAMA** | En producción las herramientas casi siempre devolvían error; la rama lo corrige y aún falta desplegar [INTERNO, IATOS-006] |
| Búsqueda de vuelos y hoteles en vivo (SerpApi) y enlaces de afiliado (Travelpayouts) | EN PRODUCCIÓN con defectos | Quedan unas 216 búsquedas de SerpApi. **La atribución de los afiliados no está verificada** (IATOS-077) |
| Análisis de viaje completo, con 3 opciones y correo | EN PRODUCCIÓN con defectos; corrección EN RAMA | En producción, un fallo del proveedor gasta el análisis gratis del usuario; la rama lo corrige |
| Cotizaciones con historial que no se edita (fuente, fecha, tipo de cambio, vigencia) | EN RAMA | Tabla `trip_quotes` y su trigger, con pruebas SQL |
| Etiquetas de procedencia ("en vivo", "de referencia", "estimado") | EN RAMA | `src/lib/provenance.ts`; regla: un estimado nunca se muestra como verificado |
| Alertas de precio y seguimiento de vuelos | EN PRODUCCIÓN (las tareas automáticas corren: 32 ejecuciones y 0 fallos) | 0 alertas activas en vivo. Faltan los topes por plan para que el costo no se dispare |
| Viajes compartidos con colaboradores | EN PRODUCCIÓN | La falla de seguridad que dejaba entrar a viajes ajenos ya se cerró **y se verificó en producción** |
| División de gastos | EN PRODUCCIÓN con defectos | IATOS-079 |
| Fixer humano | EN PRODUCCIÓN, parcial | Hoy es un correo a una persona. **Faltan el teléfono o WhatsApp y el horario** (IATOS-030). Se promete "sujeto a disponibilidad", nunca 24/7 |
| Members Only (vida nocturna) | EN PRODUCCIÓN, bloqueado (usa un modelo retirado); **EN RAMA** pasa a ser beneficio PRO con lugares curados | 166 lugares cargados directo en producción, probablemente generados por IA, quedan ocultos hasta que una persona los revise |
| Suscripción PRO con Stripe | **BLOQUEADO**: Stripe en modo de prueba | La rama trae cuotas, reservas de cuota y límites por plan, con los interruptores apagados |
| IATOS Privé (invitación a los 90 días, contraseña propia, catálogo, planificador) | **EN RAMA. Nada en producción** | Hay **1,272 fichas** curadas en octubre. En el ensayo de carga se aceptaron 1,260 y quedaron **1,097 publicables** (CURADO) y 163 ocultas, en **108 destinos con fichas propias** de una lista de 111 y en **12 universos**. **Ninguna ficha está VERIFICADA todavía**: falta el muestreo humano [INTERNO, archivo de carga `curaduria_2026-10.json`] |
| Privé Signature (experiencias privadas y reservas gestionadas con contrato) | EN DISEÑO | Interruptor apagado. No se vende |
| Autobuses en México | EN DISEÑO | Recomendación: enlaces a ADO internacional y Reservamos, afiliados de Busbud y Bookaway; nunca horarios inventados [INTERNO] |
| Pruebas en iPhone y Android físicos | **No se han hecho** | Solo emulación en navegador |

### 3.2 Contra quién competimos

| Competidor | Qué ofrece | Su fuerza | Dónde IATOS es distinto |
|---|---|---|---|
| **Google** (AI Mode, Flights, Hotels) | Seguimiento de precios en más de 180 países; reserva de hoteles en AI Mode, primero en inglés y en EUA [F19] | Distribución y datos | No da servicio humano ni cotización con vigencia, ni hace curaduría ni premia la lealtad |
| **ChatGPT** con apps de Expedia y Booking.com | Búsqueda dentro del chat; la compra se termina en el sitio de la marca [F18] | Base de usuarios enorme y hábito de uso diario (no encontramos una cifra pública para México) | Es genérico. No guarda tu expediente de viaje, no te sigue en el viaje ni tiene un Fixer |
| **Expedia** (Romie, ahora con Layla) y **Booking.com** (AI Trip Planner) | Asistentes dentro de su propia agencia [F17][F25] | Inventario y marca | Solo recomiendan su propio inventario. IATOS compara y dice de dónde viene cada precio |
| **Mindtrip** | Planeación con IA, reserva de vuelos con Sabre y PayPal, gana por comisión [F21, INDICIO] | Producto pulido y más de USD 20 millones de financiamiento [INDICIO] | En inglés y para EUA |
| **Layla** | Planeación conversacional. De paga: ~USD 49 al año [INDICIO, F28]. Ahora es de Expedia [F17] | Marca de consumidor | Queda atada a Expedia |
| **Wanderboat** | Chat y comunidad; ~USD 18 millones levantados en 2025 [F22, INDICIO] | Comunidad | Sin enfoque en México ni servicio humano |
| **Hopper** | Fintech de viaje (congelar precio, garantía de baja) | ~70% de sus ingresos vendría de productos complementarios [F24, INDICIO] | IATOS no vende seguros financieros. Su lealtad es la experiencia (Privé), no un producto de cobertura |
| **TripIt** | Organizador de itinerarios. Pro: USD 48.99 al año [F23] | Hábito en viajeros de negocio | No cotiza ni planea; solo en inglés |
| **Despegar** (de Prosus desde mayo de 2025, junto con Best Day) [F20] | La agencia en línea líder en LatAm | Inventario, financiamiento, marca local | Agencia transaccional. IATOS puede ser su canal, no su rival directo |
| **Agencias locales** | Servicio humano, paquetes | Confianza y trato | IATOS da el trato de un concierge a escala, a $99 al mes |

### 3.3 Por qué IATOS es distinto (cinco pilares)

1. **En español y primero para México:** Travel DNA, precios en MXN con IVA incluido, autobuses, puentes y el contexto local.
2. **Honestidad verificable:** cada precio dice si es en vivo, de referencia o estimado, con su fuente y su fecha. Cuando falla un proveedor, se muestra "no disponible" y no un dato inventado. La base de datos impide publicar una ficha Privé sin fuente.
3. **Cotización con vigencia y expediente del viaje:** todo lo del viaje queda en un solo lugar, con un historial de cotizaciones que no se puede editar.
4. **Humano en el circuito:** un Fixer, sujeto a disponibilidad y con horario publicado.
5. **Lealtad que se gana:** Privé premia la antigüedad pagada (90 días) con un catálogo curado de 12 universos. **No se compra con descuentos.**

---

## 4. Mercado: TAM, SAM y SOM

**Criterio.** Medimos dos cosas distintas y no las mezclamos: (a) **el gasto de viaje** que IATOS ayuda a planear, y (b) **el ingreso** que IATOS podría cobrar.

### 4.1 TAM: el gasto de viaje de los residentes en México

| Dato | Valor | Fuente |
|---|---|---|
| Consumo turístico interno (residentes viajando en México), 2024 | **MXN 3,739,481 millones** | [F2] Cuadro 3 |
| Consumo turístico emisor (residentes en el extranjero), 2024 | **MXN 289,380 millones** | [F2] Cuadro 3 |
| **Total que gastan los residentes en viajes, 2024** | **≈ MXN 4.03 billones** | [ESTIMADO] suma de las dos filas |
| Parte por vacaciones: 28.6% del interno y 42.5% del emisor | ≈ MXN 1.07 billones + MXN 123,016 millones ≈ **MXN 1.19 billones** | [F2] Cuadros 4 y 5; [ESTIMADO] la multiplicación |
| Salidas de turistas al extranjero, 2025 | 20,077,976 (+6.7%) | [F1] Cuadro 4 |
| Salidas de turistas de internación por avión, 2025 | 8,052,623 (+6.3%); gasto USD 7,814.9 millones (+22.9%); gasto medio USD 970 | [F1] Cuadro 4 |
| Mercado de viajes de LatAm, 2024 | USD 67.9 mil millones en reservas brutas; pronóstico +17% en 2025; más de la mitad en línea | [F6, INDICIO] |
| Comercio electrónico en México, 2024 | MXN 789,700 millones (+20%) | [F5, INDICIO: nota de prensa sobre AMVO] |

**No encontramos una cifra oficial y pública del gasto en viajes en línea en México.** AMVO y Phocuswright la publican en reportes de pago. No la inventamos.

### 4.2 SAM: los viajeros que podrían pagar PRO

**Definición:** adultos en México con teléfono inteligente que viajan por ocio al menos una vez al año, planean en línea y pueden pagar con tarjeta.

| Ancla | Valor | Fuente |
|---|---|---|
| Usuarios de internet | 100.2 millones (83.1% de la población de 6 años o más) | [F3] |
| Usuarios de internet que compran en línea | 35.8% | [F3] |
| Adultos de 18 a 70 años con tarjeta de crédito bancaria | 15.7% | [F4] |
| Viajes al extranjero por avión, 2025 | 8.05 millones | [F1] |
| Pasajeros en vuelos nacionales, primer semestre de 2025 | 30.7 millones | [F29, INDICIO] |

**Estimación del SAM** [ESTIMADO]:
- Suponemos de 1.5 a 2 viajes por avión al extranjero por viajero al año. Los 8.05 millones de viajes dan entonces **4 a 5.4 millones de personas**.
- Agregamos a quienes solo vuelan dentro del país y planean en línea. Muchos se traslapan con el grupo anterior.
- **SAM: entre 4 y 8 millones de personas.**
- A $99 al mes, ese SAM vale en teoría entre **MXN 4,750 y 9,500 millones al año** en suscripción.
- Debe validarse con una encuesta propia o con el reporte de pago de Phocuswright.

### 4.3 SOM: lo que podemos capturar en 36 meses

| Escenario | Penetración del SAM | PRO pagando | Ingreso neto al año a $99 | A $149 |
|---|---|---|---|---|
| Conservador | 0.05% de 4 millones | 2,000 | MXN 1.8 millones | MXN 2.8 millones |
| Base | 0.15% de 6 millones | 9,000 | MXN 8.2 millones | MXN 12.6 millones |
| Ambicioso | 0.3% de 8 millones | 24,000 | MXN 22.0 millones | MXN 33.6 millones |

Todo es [ESTIMADO]. El ingreso neto anual se calcula como PRO × neto mensual (76.35 o 116.67) × 12. No incluye afiliados ni B2B. **No es un pronóstico: es el tamaño del premio si los canales funcionan.**

---

## 5. Modelo de negocio

Cada línea dice qué tiene que ser cierto para que funcione. Lo que todavía no es cierto está marcado **⚠**.

### 5.1 Suscripción PRO (el motor)

- **Precios:**
  - **PRO Fundadores, $99 MXN al mes, IVA incluido**, para quienes entren primero.
  - **PRO Regular, $149 MXN al mes: precio futuro pendiente de aprobación.**
- **Qué incluye** (texto de `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md` §6.2, pendiente de aprobar en `plan_limits`, DEC-01):
  - 100 mensajes con Iato al mes;
  - 10 análisis al mes;
  - 5 alertas de precio;
  - seguimiento de 4 vuelos a la vez;
  - Fixer con acceso preferente, sujeto a disponibilidad;
  - Members Only;
  - Privé después de 90 días pagados.
- **Qué tiene que ser cierto:**
  1. La rama desplegada y la verificación V1 a V21 pasada. ⚠
  2. Stripe en modo real, con el precio con IVA incluido. ⚠
  3. El dominio de Resend verificado. ⚠
  4. SerpApi en el plan Production. ⚠
  5. Los límites de PRO aprobados y encendidos. ⚠
  6. Conversión de descarga a pago de 2% o más (la mediana global es 2.0%; en LatAm, 1.5%) [F9].
  7. Cancelación mensual menor a 10% [ESTIMADO, meta].
- **Prueba de 30 días sin tarjeta:** **NO-GO** hasta que se exija la confirmación de correo. Con 2% de conversión no se recupera su costo: MXN 1,354 por cliente que paga [INTERNO].

### 5.2 Afiliados (complemento, no el motor)

| Programa | Comisión publicada | Ventana de atribución | Fuente |
|---|---|---|---|
| Viator | **8%** por reserva completada | 30 días | [F14], página oficial |
| GetYourGuide vía Travelpayouts | **8%** del monto | 31 días | [F12]. La página propia de GetYourGuide dice que la tarifa "varía según el país" [F15] |
| Booking.com vía Travelpayouts | **máximo 4%** del valor de la estancia; la portada dice "5%" (contradicción en la misma página) | **una sola sesión**; se confirma de 60 a 90 días después de la salida | [F11]. ⚠ **La página dice que solo califican blogs de viaje**: hay que confirmar si una app es elegible |
| Aviasales vía Travelpayouts | 40% de lo que gana Aviasales ≈ **1.1% del boleto** en promedio | 30 días | [F13] |
| Autobuses: Omio, Busbud, Bookaway | 6%, 5% y 5% | 30, 7 y 30 días | [INTERNO, `IATOS_PROVEEDORES_AUTOBUSES.md`, que cita a Travelpayouts y Bookaway] |

**Ejemplo por reserva** [ESTIMADO, montos supuestos]:

| Reserva | Monto supuesto | Comisión | IATOS recibe |
|---|---|---|---|
| Hotel | MXN 6,000 | 4% | MXN 240 |
| Experiencia | MXN 1,500 | 8% | MXN 120 |
| Vuelo | MXN 8,000 | 1.1% | MXN 88 |

**Qué tiene que ser cierto:**
- Que la atribución funcione dentro de la app, incluido iPhone. ⚠ IATOS-077 y las pruebas T-87 y T-88.
- Que cada programa esté confirmado en el panel de Travelpayouts. ⚠
- Mientras no se cumpla, **no contamos ingreso de afiliados en el plan base.**

### 5.3 IATOS Privé y Privé Signature

- **Privé Digital va incluido en PRO.** Su papel es **retener**, no generar ingreso directo.
  - Costo de APIs: USD 0.02 a 0.05 por usuario al mes.
  - El costo real es una persona curando unas 8 horas a la semana [INTERNO].
- **Privé Signature (futuro):** experiencias privadas y reservas gestionadas, con precio propio.
  - **Qué tiene que ser cierto:** acuerdos firmados con cupos reales (hoy hay 0), operación humana con nivel de servicio, CFDI y una política de cancelación.
  - Hasta entonces se muestra, como mucho, "Próximamente · Solicitar información". **Sin precio ni promesa.**

### 5.4 Socios de Privé (ingreso del lado de la oferta)

- **Modelos** [INTERNO, `IATOS_PRIVE_ALIANZAS_COMERCIALES.md` §3]:
  - C: tarifa por persona confirmada;
  - D: comisión por experiencia pagada;
  - B: cuota fija por "Destacado · Socio IATOS", solo después de 3 meses de reportes.
- **Montos: a negociar.** No hay una referencia pública confiable para México.
- **Reglas que no se venden nunca:** el orden de "Para ti", el sello "Verificado" y las palabras "VIP" o "exclusivo" si no son verdad.
- **Qué tiene que ser cierto:** contar con demanda medida (`prive_events`) para enseñarla al socio, y firmar de 3 a 5 socios piloto en CDMX y Tulum.

### 5.5 B2B y B2B2C (6 a 12 meses)

| Línea | Propuesta | Qué tiene que ser cierto |
|---|---|---|
| **Bancos y tarjetas premium** (B2B2C) | "IATOS PRO incluido" o "3 meses gratis" como beneficio del tarjetahabiente. El banco paga por usuario activado o una licencia | Que el producto esté estable en producción; un aviso de privacidad y un contrato de encargado de datos (LFPDPPP 2025) [F26]; facturación CFDI; métricas de activación |
| **Agencias de viaje** | El cotizador con procedencia, como herramienta del agente: cotizar en minutos, con fuente y vigencia | Varios usuarios por cuenta, marca propia y un precio por asiento. **No existe todavía** (EN DISEÑO) |
| **Corporativo PyME** | Viajes de trabajo con alertas, seguimiento de vuelos y Fixer | Políticas de viaje, facturación y reportes. **No existe todavía** |
| **Aerolíneas y hoteles boutique** | Contenido curado, demanda calificada, solicitudes bien armadas | Volumen que enseñar. Empieza con socios Privé |

---

## 6. Unit economics

Fuente de los costos: `IATOS_COSTOS_UNITARIOS.md` y `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md` §2 [INTERNO]. Los costos suponen los **límites recomendados encendidos**. Sin ellos, un PRO pesado con el código de hoy cuesta MXN 424 al mes.

### 6.1 Lo que nos queda por usuario PRO al mes

| Concepto (MXN) | $99, IVA incluido | $149, IVA incluido (pendiente de aprobación) |
|---|---|---|
| Lo que paga el cliente | 99.00 | 149.00 |
| IVA (16%) | −13.66 | −20.55 |
| Stripe: 3.6% + $3, Billing 0.7% y Tax 0.5% | −7.75 | −10.15 |
| IVA sobre las comisiones de Stripe | −1.24 | −1.62 |
| **Neto** | **76.35** | **116.67** |

La columna de $149 es [ESTIMADO] con el mismo método de la propuesta. No modelamos ISR.

### 6.2 Margen por perfil de uso

| Perfil (costo al mes) | Margen a $99 | Margen a $149 |
|---|---|---|
| PRO típico, MXN 33.3 | MXN 43.0 (**56%**) | MXN 83.4 (**71%**) |
| PRO típico optimizado, MXN 26.1 | MXN 50.2 (66%) | MXN 90.6 (78%) |
| Mezcla 70/20/10, MXN 48.1 (USD 2.6) | MXN 28.3 (37%) | MXN 68.6 (59%) |
| Mezcla optimizada, MXN 35.1 (USD 1.9) | MXN 41.2 (54%) | MXN 81.6 (70%) |
| PRO pesado al tope, MXN 109 | **−MXN 32.7 (−43%)** | MXN 7.7 (7%) |
| Pesado optimizado, MXN 70.1 | MXN 6.2 (8%) | MXN 46.6 (40%) |

"Optimizado" = las mejoras de la propuesta §5.4: caché compartida de SerpApi, modelo del chat fijo, resumen del viaje y Perplexity apagado.

**Lectura:**
- A $99, el negocio depende de que la mayoría sean usuarios típicos y de que los topes estén encendidos.
- A $149, hasta el usuario pesado queda en positivo.

### 6.3 Punto de equilibrio contra los costos fijos

**Costos fijos al lanzar:**
- SerpApi Production: USD 150;
- Resend Pro: USD 20;
- **total: USD 170 al mes = MXN 3,142.**
- Lovable cuesta otros USD 25 a 50 [INTERNO]. No sabemos qué plan está contratado.

**Ojo con el doble conteo:** el costo por usuario ya cobra cada búsqueda de SerpApi a USD 0.015. Por eso damos tres lecturas:

| Lectura de costos fijos | PRO típico a $99 | Mezcla a $99 | PRO típico a $149 | Mezcla a $149 |
|---|---|---|---|---|
| A. Sin doble conteo: Resend + Lovable, USD 45 a 70 | 19 a 30 | 29 a 46 | 10 a 16 | 12 a 19 |
| **B. Base: USD 170** (cuenta SerpApi dos veces, así que es conservadora) | **73** | **111** | **38** | **46** |
| C. USD 170 + Lovable = USD 195 a 220 | 84 a 94 | 127 a 144 | 43 a 49 | 53 a 59 |
| D. B + ~MXN 17,000 al mes de personas (curaduría de 8 h a la semana y Fixer de medio tiempo) [ESTIMADO] | ~470 | ~710 | ~240 | ~290 |

La lectura D todavía **no incluye sueldos de los fundadores** ni marketing. Es la cifra honesta de "el producto se paga solo".

### 6.4 Sensibilidad a SerpApi y a la IA

Base: un PRO típico cuesta USD 1.80 al mes. De eso, ~USD 0.80 son unas 53 búsquedas de SerpApi a USD 0.015 y ~USD 1.00 son IA y otros [ESTIMADO, desglose a partir de la propuesta §4.1].

| Escenario | Costo de un PRO típico | Margen a $99 | Margen a $149 |
|---|---|---|---|
| Base | MXN 33.3 | 56% | 71% |
| SerpApi a precio Starter (USD 0.025 por búsqueda) | MXN 43.1 | 44% | 63% |
| SerpApi a precio Searcher (USD 0.0073), con volumen | MXN 25.7 | 66% | 78% |
| Caché compartida (−30% de búsquedas) | MXN 28.9 | 62% | 75% |
| Gemini Flash al doble desde el 1-ene-2027, si el chat sigue en `-latest` | MXN 46.2 | 39% | 60% |
| Toda la IA al doble | MXN 51.8 | 32% | 56% |
| Toda la IA al doble + SerpApi Starter (estrés) | MXN 61.5 | **19%** | 47% |

**Conclusiones:**
1. **Fijar el modelo del chat antes del 1-ene-2027.** Es la palanca más barata.
2. **La caché compartida de SerpApi** paga su desarrollo enseguida.
3. **Registrar el costo real** (`ai_usage_log`). Hoy ninguna función guarda los tokens que usa: todos estos números son estimaciones.

### 6.5 Valor de vida del cliente y cuánto podemos pagar por adquirirlo

**Retención de referencia (RevenueCat 2026, vía TechCrunch)** [F10]:
- Planes mensuales: **6.1%** de retención en apps de IA y 9.5% en las demás.
- Planes anuales: **21.1%** en apps de IA y 30.7% en las demás.
- Entendemos que es la retención **a 12 meses** (lectura nuestra). Equivale a una cancelación mensual promedio de ~18 a 21%.
- **Los viajes son ocasionales:** este es el riesgo número uno del modelo.

| Cancelación mensual | Vida promedio | Margen acumulado de un PRO típico a $99 | A $149 |
|---|---|---|---|
| 8% (meta con Privé) | 12.5 meses | MXN 538 | MXN 1,043 |
| 12% | 8.3 meses | MXN 358 | MXN 695 |
| 20% (como el benchmark) | 5 meses | **MXN 215** | MXN 417 |

**Regla:** el costo de adquirir un cliente (CAC) debe ser como máximo un tercio de ese margen acumulado. A $99, eso es **MXN 70 a 180 por cliente que paga** [ESTIMADO]. Por eso:
- la adquisición inicial tiene que ser casi orgánica (referidos, comunidades, creadores pagados por resultado);
- **conviene un plan anual**: en la categoría de viajes, 66% de las ventas son anuales [F9]. Es una decisión del dueño (ver la sección 12).

---

## 7. Go-to-market

### 7.0 Requisito de salida: semanas 0 a 2

No se vende hasta pasar la compuerta (`IATOS_RELEASE_GATE.md` §4):
- desplegar la rama y verificar V1 a V21;
- Stripe en modo real, con una compra real reembolsada;
- dominio de Resend verificado;
- SerpApi Production.

Además: encender los límites de PRO, fijar el modelo del chat, publicar el teléfono y el horario del Fixer, y probar en un iPhone y un Android físicos.

**Costo:** USD 170 al mes más 2 a 4 créditos de Lovable [INTERNO].

### 7.1 De 0 a 90 días: encontrar el canal que funciona

**Presupuesto total de marketing: MXN 60,000 a 180,000** [ESTIMADO].

| # | Experimento | Cómo | Presupuesto [ESTIMADO] | Métrica de éxito (para decidir) |
|---|---|---|---|---|
| E1 | **Lista de Fundadores** | Lista de espera con un precio de Fundador de $99 por un periodo definido (el periodo lo decide el dueño). Invitación por tandas de 50 | MXN 0 a 10,000 | ≥ 500 registros; ≥ 15% de registro a pago |
| E2 | **Creadores de viaje** (micro, de 10 mil a 150 mil seguidores, en México) | 6 a 10 creadores. Pago por resultado con código propio, más una cuota baja. Contenido: "planeé este viaje con Iato y así se ve la cotización con su fuente" | MXN 30,000 a 90,000 | CAC ≤ MXN 180; ≥ 2 creadores con 20 o más PRO cada uno |
| E3 | **Comunidades** (grupos de viajeros, despedidas y bodas de destino, corredores que viajan a maratones, grupos de puntos y millas) | Sesiones en vivo de "cotización honesta" y un Fixer para el grupo | MXN 5,000 a 20,000 | ≥ 3 comunidades con 10 o más PRO cada una |
| E4 | **Referidos** | Un mes PRO por cada referido **que pague**. Nos cuesta ~MXN 33 de uso, no MXN 99 | Costo variable | K-factor ≥ 0.2; ≥ 20% de las altas por referido |
| E5 | **Contenido de búsqueda y video corto** | "¿Cuánto cuesta de verdad ir a X en noviembre?", con fecha y fuente. Reutiliza las cotizaciones guardadas, sin datos personales | MXN 10,000 a 40,000 | ≥ 5% de visita a registro; costo por registro ≤ MXN 25 |
| E6 | **Piloto con banco o tarjeta premium** | 3 a 5 conversaciones con bancos, neobancos o emisores de tarjetas premium. Propuesta: "3 meses de IATOS PRO" para sus clientes de viaje | MXN 0 (tiempo de los fundadores) | 1 carta de intención firmada antes del día 90 |
| E7 | **Socios Privé piloto** | Plan de 10 semanas en CDMX y Tulum (`IATOS_PRIVE_ALIANZAS_COMERCIALES.md` §5) | MXN 0 a 15,000 (viáticos) | ≥ 8 reuniones; 3 a 5 acuerdos piloto |

**Metas a 90 días** [ESTIMADO]:
- 100 PRO pagando;
- costo p50 por PRO ≤ USD 1.8;
- conversión de descarga a pago ≥ 2%;
- cancelación del primer mes ≤ 12%;
- 0 incidentes de precio inventado.

### 7.2 De 6 a 12 meses: escalar lo que funcionó

| Canal | Acción | Presupuesto [ESTIMADO] | Métrica |
|---|---|---|---|
| Creadores | Escalar a 30 o 50 creadores con los términos del ganador de E2; programa de embajadores | MXN 50,000 a 150,000 al mes | CAC ≤ MXN 180 y recuperación en 4 meses o menos |
| Bancos y tarjetas | Primer acuerdo B2B2C en producción | Variable (integración) | ≥ 1,000 activaciones; ≥ 10% siguen activas a 90 días |
| Aerolíneas y hoteles boutique | Contenido conjunto y beneficios **por escrito** (nunca "VIP" sin contrato) | Bajo | 2 acuerdos |
| Privé | Primeros miembros: los que pagaron en el mes 1 cumplen 90 días alrededor del mes 4. Socios: de 10 a 20 | Persona curadora | Retención a 6 meses de quienes llegan a Privé contra quienes no |
| B2B agencias | Piloto del cotizador con procedencia con 5 agencias | Desarrollo | 3 agencias pagando |
| Plan anual (si se aprueba) | Ofrecerlo en el mes 2 de cada suscriptor | — | ≥ 25% de las altas en plan anual |

**Meta a 12 meses: 1,000 a 2,000 PRO pagando** [ESTIMADO].

---

## 8. Expansión

| Fase | Mercado | Por qué | Requisitos | Señal para entrar |
|---|---|---|---|---|
| 1 (ahora) | **México** | El mercado más grande de LatAm. Un resumen de Phocuswright le atribuye 45% de las reservas de la región en 2023 [F6, INDICIO] | Compuerta de liberación; canales probados | — |
| 2 (12 a 24 meses) | **Hispanos en Estados Unidos**, empezando por quienes viajan a México | 68 millones de hispanos en EUA en 2024 (20% de la población) [F7]. ~60% es de origen mexicano (dato de 2021) [F8]. Muchos viajan a México a ver a la familia | Precio en USD; impuestos de EUA; privacidad estatal (por ejemplo, California); Fixer bilingüe; soporte en inglés y "spanglish" | ≥ 10% de los PRO mexicanos con viajes desde EUA o hacia EUA |
| 3 (18 a 36 meses) | **LatAm hispana**: Colombia, Perú, Chile y después Argentina | Mismo idioma; la región crece más rápido que el mundo [F6, INDICIO] | Moneda local, IVA a servicios digitales de cada país, medio de pago local (verificar si conviene Stripe o un proveedor como dLocal o Mercado Pago), protección de datos local, curaduría Privé local, autobuses y proveedores locales | CAC y cancelación en México dentro de meta 2 trimestres seguidos |

**Por qué los hispanos en EUA van antes que LatAm:**
- es el mismo destino (México) que ya curamos;
- pagan en dólares;
- el producto casi no cambia.

**Requisito transversal:** Privé ya tiene 108 destinos con fichas en todo el mundo, así que el catálogo no es lo que frena la expansión. Lo que la frena es **verificar las fichas y los socios locales**.

---

## 9. Cómo liderar el mercado (las ventajas que no se copian)

| Ventaja | Por qué es difícil de copiar | Qué la hace real (y qué falta) |
|---|---|---|
| **Datos curados y verificados** | Cada ficha tiene una fuente de nivel 1 o 2, una fecha y se vuelve a revisar cada 90 días. La base de datos impide publicar sin fuente | 1,097 fichas CURADO. **Falta el muestreo humano** que las convierte en VERIFICADO |
| **Confianza y honestidad** | Una marca que dice "no disponible" en lugar de inventar. Las grandes IA se equivocan con seguridad | Las etiquetas de procedencia están EN RAMA; falta desplegarlas. Métrica pública: 0 precios inventados |
| **Privé como lealtad** | Se gana con antigüedad pagada, no con dinero. Cambia el incentivo a cancelar entre un viaje y otro | EN RAMA. Hay que medir si quienes llegan a Privé cancelan menos |
| **Red de Fixers** | Personas que resuelven en México. Un modelo de IA no lo replica | Hoy es un correo. **Faltan el teléfono, el horario y el nivel de servicio** |
| **Alianzas exclusivas** | Contratos con beneficios por escrito y cupos reales (Signature) | **0 firmadas.** Plan de 10 socios en CDMX y Tulum |
| **IA que hace cosas, con confirmación** | Iato prepara la solicitud y el humano o el proveedor la confirma con folio; nunca confirma solo | `concierge-action` existe. La reserva directa con confirmación es el siguiente salto (ver la sección 12) |
| **Expediente del viaje y datos propios** | Cotizaciones, preferencias (Travel DNA) e historial dan más personalización con el tiempo | EN RAMA. Respetar la LFPDPPP y el derecho de borrado |

**Postura frente a las grandes tecnológicas:** no competir en inventario ni en búsqueda genérica. Ser **la capa de confianza y servicio en español** que puede vivir dentro de ellas. Por ejemplo, una app de IATOS dentro de ChatGPT, que ya acepta apps de terceros [F18], como canal de adquisición.

---

## 10. Riesgos y cómo los mitigamos

| # | Riesgo | Probabilidad / impacto | Mitigación |
|---|---|---|---|
| 1 | **Dependemos de proveedores:** SerpApi, Lovable (el despliegue de funciones), Travelpayouts, Resend, Pexels | Alta / alto | Caché compartida; dos fuentes de precio (Travelpayouts gratis + SerpApi); evaluar un proveedor dedicado de estado de vuelos; alerta cuando quede menos de 20% del plan de SerpApi; documentar cómo desplegar sin Lovable |
| 2 | **Suben los costos de IA:** Gemini Flash se duplica el 1-ene-2027; hay modelos retirados en uso | Segura / medio | Fijar los modelos; registrar el costo en `ai_usage_log`; rutear: modelo barato para conversar y caro solo para el análisis; caché de prompt |
| 3 | **PROFECO:** precio total con impuestos (LFPC art. 7 Bis), comercio electrónico (art. 76 Bis), publicidad veraz | Media / alto | Precio "IVA incluido" en todos lados; texto único de la propuesta §6.2; nada de "ilimitado", "24/7" ni "VIP" sin respaldo. Hay una iniciativa de 2026 para endurecer la regla del precio final en plataformas digitales [INDICIO]. **Revisión con abogado antes de cobrar** |
| 4 | **Protección de datos:** la nueva LFPDPPP está vigente desde el 21-mar-2025 y la autoridad ahora es la Secretaría Anticorrupción y Buen Gobierno [F26] | Media / alto | Aviso de privacidad actualizado; contratos de encargado con socios y bancos; datos mínimos a socios Privé; el borrado de cuenta ya está EN RAMA |
| 5 | **Las grandes tecnológicas llegan en español:** Google AI Mode, ChatGPT con apps, Expedia + Layla | Alta / alto | Pelear en lo que no harán pronto: el Fixer humano, la curaduría verificada, la lealtad, lo local. Usarlas como canal |
| 6 | **Cancelación alta por lo ocasional que es viajar** (benchmark: ~18 a 21% al mes) [F10] | Alta / alto | Plan anual; Privé a los 90 días; valor entre viajes (alertas de precio, ideas de fin de semana); medir la retención por cohorte |
| 7 | **Atribución de afiliados sin verificar** e incertidumbre de si una app puede usar el programa de Booking.com | Alta / medio | No contar ese ingreso en el plan base; verificarlo en el panel y con pruebas en iPhone |
| 8 | **Reputación:** un precio inventado o un Fixer que no responde | Media / muy alto | Etiquetas de procedencia; horario publicado; 166 lugares de Members Only ocultos hasta revisarlos |
| 9 | **Despliegue grande** (35 migraciones y 50 funciones) | Media / alto | Orden, verificación V1 a V21 y plan de vuelta atrás (`IATOS_PLAN_MEJORAS.md` §1) |
| 10 | **Equipo chico:** los fundadores hacen producto, ventas y operación | Alta / alto | Las contrataciones de la sección 12; automatizar la operación (tareas vigiladas) |

---

## 11. Hitos y métricas

**North Star:** **viajes con una cotización vigente guardada por usuarios PRO activos, por semana.** Mide valor real (un viaje concreto con precio honesto) y se mueve antes que los ingresos.

**Indicadores semanales:**

| Grupo | Indicador | Meta inicial [ESTIMADO] |
|---|---|---|
| Adquisición | Registros; costo por registro; % de registros por canal | ≤ MXN 25 por registro (contenido) |
| Activación | % que hace 1 análisis o 3 mensajes en 48 h | ≥ 40% |
| Conversión | Descarga o registro a pago (D35) | ≥ 2% (benchmarks: 2.0% global, 1.5% LatAm [F9]) |
| Ingreso | PRO pagando, MRR neto, % en plan anual | 100 al día 90 |
| Retención | Cancelación mensual por cohorte; % que llega a 90 días (Privé) | ≤ 10% al mes |
| Costo | Costo por PRO p50 y p90; búsquedas de SerpApi por PRO; % de aciertos de caché | p50 ≤ USD 1.8; caché ≥ 25% |
| Confianza | Precios inventados detectados; % de respuestas con procedencia; reclamaciones | 0; 100% |
| Servicio | Solicitudes al Fixer; tiempo de respuesta dentro del horario | ≤ 2 h en horario [ESTIMADO] |
| Privé | Fichas VERIFICADO; socios firmados; solicitudes a socios → confirmadas | 3 a 5 socios; ≥ 50% confirmadas |

**Hitos:**

| Fecha (desde el GO) | Hito |
|---|---|
| Semana 2 | Compuerta pasada; primer cobro real |
| Día 30 | 30 PRO; primera lectura de costo real |
| Día 90 | 100 PRO; canal ganador elegido; carta de intención con un banco; 3 a 5 socios Privé |
| Mes 4 | Primeros miembros Privé (90 días pagados) |
| Mes 6 | 500 PRO; decisión sobre PRO Regular $149 con datos |
| Mes 12 | 1,000 a 2,000 PRO; primer B2B2C en producción; decidir si entramos al mercado hispano de EUA |

---

## 12. Lo que necesitamos

### 12.1 Equipo [ESTIMADO]

| Rol | Dedicación | Por qué |
|---|---|---|
| Growth y alianzas | Tiempo completo desde el mes 1 | Creadores, comunidades, bancos |
| Curador/a Privé | ~8 h a la semana, más ~6 h por cada tanda de fichas | Pasar de CURADO a VERIFICADO y sostener la revisión cada 90 días |
| Fixer y operación | Medio tiempo, con horario publicado | Promesa de servicio |
| Ingeniería de IA | Tiempo completo o asesoría fuerte | Costos, evaluación, agentes con confirmación |
| Legal y fiscal | Por proyecto | PROFECO, LFPDPPP, CFDI, contratos con socios |

### 12.2 Capital [ESTIMADO]

Para 12 meses, sin sueldos de los fundadores: **MXN 1.5 a 3.5 millones.**

| Concepto | Monto (MXN) |
|---|---|
| Proveedores | 40,000 a 60,000 |
| Personas (growth, curaduría, Fixer, ingeniería) | 0.9 a 2.4 millones |
| Marketing | 0.4 a 0.9 millones |
| Legal | 0.1 a 0.2 millones |

Hay que validarlo con el plan de contratación real.

### 12.3 Alianzas

- un banco o emisor de tarjeta premium;
- 10 socios Privé en CDMX y Tulum;
- confirmar los programas de afiliados (Travelpayouts, Viator, GetYourGuide, Booking);
- una aerolínea o cadena boutique para contenido conjunto.

### 12.4 Decisiones del dueño que este plan necesita

1. GO de despliegue y las 4 condiciones de la compuerta.
2. Valores de `plan_limits` (DEC-01).
3. **Cuánto dura el precio de Fundador** ($99) y **cuándo y cómo se aprueba PRO Regular a $149.**
4. **Plan anual**: si se ofrece y a qué precio. No existe hoy.
5. Teléfono y horario del Fixer.
6. Prueba sin tarjeta: se queda en NO-GO hasta que se exija la confirmación de correo (DEC-02).

### 12.5 Qué le pedimos al asesor (donde más ayuda su consejo o su red)

1. **Agentes que hacen cosas con confirmación.** ¿Cuál es la arquitectura correcta para que Iato reserve, pague o confirme con un humano o un proveedor en el circuito, sin inventar? ¿Qué proveedores de reserva directa (vuelos y hoteles) recomienda para México?
2. **Costo y calidad de la IA.** Ruteo de modelos, caché de prompt, evaluación automática de "no inventar" y observabilidad del costo por usuario. Meta: bajar de USD 1.8 a menos de USD 1.2 por PRO sin perder calidad.
3. **Distribución dentro de las plataformas de IA.** ¿Vale la pena una app de IATOS dentro de ChatGPT, o integrarse con Google, como canal de adquisición? ¿Qué riesgo de dependencia trae?
4. **Presentaciones con bancos, aerolíneas y agencias en línea** de México: un piloto B2B2C acorta 6 meses de ventas.
5. **Talento:** una persona de ingeniería de IA senior en México o en LatAm.
6. **Capital:** fondos o ángeles con tesis de IA aplicada y viajes en LatAm, y cuándo levantar (¿antes o después de 100 PRO?).
7. **Defensa frente a las grandes:** ¿estamos eligiendo bien las ventajas (sección 9) o alguna es ilusoria?

---

## 13. Apéndice de fuentes

### 13.1 Externas (consultadas el 22 de octubre de 2026)

| # | Fuente | Dato usado | URL |
|---|---|---|---|
| F1 | INEGI, Encuestas de Viajeros Internacionales, Boletín 82/26, 12-feb-2026 (Cuadro 4, cifras preliminares) | Salidas 2025: 20,077,976 turistas internacionales; 8,052,623 de internación por avión; gasto USD 9,677.4 millones (+19.7%); por avión, USD 7,814.9 millones (+22.9%); gasto medio por avión USD 970.48 | https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/ViajInternales/evi2026_02.pdf |
| F2 | INEGI, Cuenta Satélite del Turismo de México 2024, Reporte de Resultados 100/25, 18-dic-2025 (Cuadros 3, 4 y 5) | Consumo turístico interno MXN 3,739,481 millones; emisor MXN 289,380 millones; vacaciones: 28.6% del interno y 42.5% del emisor; PIB turístico 8.7% | https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/turismo/CSTM2024_RR.pdf |
| F3 | INEGI, ENDUTIH 2024, Reporte de Resultados 9/25, 6-may-2025 | 100.2 millones de usuarios de internet (83.1%); 96.6% de quienes usan celular usa solo un teléfono inteligente; 35.8% compra por internet | https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/endutih/ENDUTIH_24_RR.pdf |
| F4 | INEGI y CNBV, ENIF 2024, Reporte de Resultados 7/25, 13-mar-2025 | 15.7% de los adultos de 18 a 70 años tiene tarjeta de crédito bancaria; 69.1% de quienes tienen cuenta usa la app del banco (54.3% en 2021) | https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2025/enif/ENIF2024_RR.pdf |
| F5 | AMVO, Estudio de Venta Online 2025, vía México Industry [INDICIO: secundaria] | E-commerce en 2024: MXN 789,700 millones, +20% | https://mexicoindustry.com/noticia/e-commerce-en-mexico-deja-casi-790-ml-mdp-en-ventas-amvo |
| F6 | Phocuswright, Latin America Travel Market Report 2025 (resumen público) [INDICIO: la página respondió 403; cifras tomadas del resumen del buscador] | LatAm 2024: USD 67.9 mil millones; +17% a USD 79.2 mil millones en 2025; más de la mitad en línea; México con 45% de las reservas de la región en 2023 | https://www.phocuswright.com/Travel-Research/Research-Updates/2025/the-supplier-shift-powering-latin-americas-travel-growth |
| F7 | Pew Research Center, "Key facts about U.S. Latinos", 22-oct-2025 | 68 millones de hispanos en 2024 (20% de EUA) | https://www.pewresearch.org/short-reads/2025/10/22/key-facts-about-us-latinos/ |
| F8 | Pew Research Center, ficha de latinos de origen mexicano | 37.2 millones (~60%) en 2021 | https://www.pewresearch.org/race-and-ethnicity/fact-sheet/us-hispanics-facts-on-mexican-origin-latinos/ |
| F9 | RevenueCat, State of Subscription Apps 2026 | Descarga a pago a 35 días: mediana global 2.0%, LatAm 1.5%. Viajes: 66% de las ventas en planes anuales; precio anual mediano ~USD 20; prueba a pago 43.5% | https://www.revenuecat.com/state-of-subscription-apps |
| F10 | TechCrunch, "AI-powered apps struggle with long-term retention", 10-mar-2026 (datos de RevenueCat) | Retención mensual 6.1% (IA) y 9.5% (no IA); anual 21.1% y 30.7%; descarga a pago 2.4% y 2.0% | https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows |
| F11 | Travelpayouts, programa de Booking.com | Máximo 4% (la portada dice 5%); cookie de una sesión; confirmación de 60 a 90 días; solo blogs de viaje | https://www.travelpayouts.com/en/offers/bookingcom-affiliate-program |
| F12 | Travelpayouts, programa de GetYourGuide | 8%; 31 días | https://travelpayouts.com/en/offers/getyourguide-affiliate-program |
| F13 | Travelpayouts, programa de Aviasales | 40% de lo que gana Aviasales ≈ 1.1% del boleto; 30 días | https://www.travelpayouts.com/en/offers/aviasales-affiliate-program |
| F14 | Viator Partner Resources (oficial) | 8% por reserva completada; 30 días | https://partnerresources.viator.com/ |
| F15 | GetYourGuide Supply (oficial; verificado en `IATOS_PRIVE_ALIANZAS_COMERCIALES.md`) | Tarifa para proveedores "varía según el país" | https://www.getyourguide.supply/join/how-much-does-getyourguide-charge |
| F17 | Expedia Group, relación con inversionistas, 31-jul-2026 | Compra de Layla | https://ir.expediagroup.com/news-and-events/news/news-details/2026/Expedia-Group-acquires-Layla-accelerating-its-AI-powered-trip-planning-and-booking-strategy/default.aspx |
| F18 | Skift, 6-oct-2025 | Apps de Booking.com y Expedia dentro de ChatGPT | https://skift.com/2025/10/06/expedia-booking-chatgpt-apps-openai/ |
| F19 | TechCrunch, 27-ago-2026 | Google AI Mode: seguimiento de precios en más de 180 países; reserva de hoteles en inglés y en EUA | https://techcrunch.com/2026/08/27/googles-ai-mode-can-now-track-flight-prices-help-book-hotels-and-more/ |
| F20 | Business Wire, 15-may-2025 | Prosus completa la compra de Despegar | https://www.businesswire.com/news/home/20250515026178/en/Prosus-and-Despegar-Complete-Acquisition |
| F21 | PhocusWire y reseñas de terceros sobre Mindtrip [INDICIO] | Reserva de vuelos con Sabre y PayPal; más de USD 20 millones de financiamiento | https://www.phocuswire.com/ai-travel-planner-mindtrip-receipts-funding |
| F22 | VCBacked / Caplight sobre Wanderboat [INDICIO] | Ronda de ~USD 18 millones en marzo de 2025 | https://www.vcbacked.co/company/wanderboat-ai |
| F23 | Apple App Store, TripIt | Pro: USD 48.99 al año | https://apps.apple.com/us/app/-/id311035142 |
| F24 | Skift sobre Hopper [INDICIO: fecha no clara] | ~70% de los ingresos por productos complementarios | https://skift.com/?p=436209 |
| F25 | Business Traveller (2023) y Travel Market Report (mayo de 2024) | Booking.com AI Trip Planner; Expedia Romie | https://www.businesstraveller.com/news/bookingcom-launches-chatgpt-trip-planner/ · https://travelmarketreport.com/RetailStrategies/articles/Expedia-Unveils-Romie-an-AI-Powered-Travel-Planner |
| F26 | Cámara de Diputados, LFPDPPP (DOF 20-mar-2025); EY, nota técnica | Vigente desde el 21-mar-2025; las funciones del INAI pasan a la Secretaría Anticorrupción y Buen Gobierno | https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf · https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares |
| F27 | LFPC, arts. 7 Bis y 76 Bis; Expansión, 13-sep-2026, sobre la iniciativa de cargos sorpresa [INDICIO] | Monto total visible; comercio electrónico; iniciativa en trámite | https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf · https://politica.expansion.mx/mexico/2026/09/13/cargos-sorpresa-plataformas-digitales |
| F28 | Reseñas de terceros sobre los precios de Layla [INDICIO] | ~USD 49 al año | https://monkeytravel.app/blog/layla-vs-mindtrip-2026 |
| F29 | Sectur con datos de la AFAC, vía News in America [INDICIO] | 30.726 millones de pasajeros en vuelos nacionales, enero a junio de 2025 | https://newsinamerica.com/pdcc/boletin/2025/mas-de-61-millones-de-pasajeros-viajaron-en-vuelos-nacionales-e-internacionales-durante-el-primer-semestre-de-2025/ |

No hay F16: las comisiones de autobuses se citan desde `IATOS_PROVEEDORES_AUTOBUSES.md`, que trae sus propias fuentes.

### 13.2 Internas

| Documento | Qué tomamos |
|---|---|
| `IATOS_RESUMEN_DIRECCION.md` | Estado general, decisiones y riesgos |
| `IATOS_RELEASE_GATE.md` | Las 4 condiciones para vender a $99; 114 hallazgos; 737 pruebas |
| `IATOS_COSTOS_UNITARIOS.md` | Costo por operación; precios de los proveedores; costos fijos |
| `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md` | Neto de MXN 76.35; costo por perfil; límites; costo de la prueba |
| `IATOS_ARQUITECTURA_OBJETIVO.md` / `IATOS_MATRIZ_FUNCIONAL.md` | Qué existe en producción y qué en la rama; 11 usuarios con cortesía; Stripe en modo de prueba |
| `IATOS_PRIVE_*.md` y `data/prive/import/curaduria_2026-10.json` | Regla de 90 días; 12 universos; 1,272 / 1,260 / 1,097 / 163 fichas; 108 destinos con fichas; 0 VERIFICADO |
| `IATOS_PRIVE_ALIANZAS_COMERCIALES.md` | Modelos de cobro; plan de 10 socios; 0 acuerdos |
| `IATOS_PROVEEDORES_AUTOBUSES.md` | Comisiones de Omio, Busbud y Bookaway; estrategia de enlaces |

### 13.3 Lo que no pudimos sustentar con fuente

- **El gasto en viajes en línea en México** y su participación digital: solo está en reportes de pago (AMVO, Phocuswright).
- **La cifra de Phocuswright para LatAm y México**: no pudimos abrir la página (403); la tomamos del resumen del buscador.
- **La comisión oficial de Booking.com fuera de Travelpayouts**: la página oficial de afiliados no la publica.
- **El tamaño del SAM** (4 a 8 millones de personas): es una estimación nuestra; no hay un dato público de viajeros únicos.
- **Cuánto cuesta adquirir un cliente en México con creadores o anuncios**: no encontramos un benchmark público confiable. Los presupuestos de la sección 7 son estimaciones.
- **La retención específica de las apps de viaje** en el reporte de RevenueCat: no aparece en la página pública. Usamos las cifras de IA y no IA.
