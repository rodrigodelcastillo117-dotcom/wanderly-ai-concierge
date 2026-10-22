# IATOS AI — Propuesta de planes y prueba PRO de 30 días sin tarjeta

**Fecha:** 22 de octubre de 2026.
**Código revisado:** rama `claude/iatos-world-class`, en solo lectura, hacia las 02:26 UTC.
**Costos unitarios y fuentes:** [`IATOS_COSTOS_UNITARIOS.md`](./IATOS_COSTOS_UNITARIOS.md).

**Etiquetas:** **[MEDIDO]** sale del código o de datos de producción · **[PRECIO PÚBLICO]** precio citado del proveedor · **[SUPUESTO]** estimación nuestra.

**Bases de todas las cuentas** (salvo que se diga otra cosa):

- 1 USD = 18.4823 MXN (BCE vía Frankfurter, 2026-10-21) [PRECIO PÚBLICO].
- SerpApi a USD 0.015 por búsqueda (plan Developer).
- Gemini Flash a precio de 3.8 Flash 2026.

---

## Resumen ejecutivo (1 página)

**Qué cuesta cada cosa** (detalle en `IATOS_COSTOS_UNITARIOS.md`, sección 3):

| Operación | Costo típico | Rango |
|---|---|---|
| Análisis completo de viaje | **MXN 2.4** sin Perplexity · **MXN 3.5** con Perplexity | MXN 1.5 a 7.5 |
| Mensaje de Iato | **MXN 0.24** solo conversación · **MXN 0.77** con una búsqueda · **MXN 0.50** en promedio | hasta MXN 4.3 en el peor caso de hoy |
| Alerta de precio, por mes | **MXN 5.0** con la regla actual · **MXN 1.5** con la recomendada | MXN 0 a 16.6 |
| Seguimiento de 1 vuelo | **MXN 22 a 48** con la frecuencia actual · **MXN 4.8** con la recomendada | |

**Cuánto deja un usuario PRO:**

- De los $99 MXN con IVA incluido quedan **MXN 76.35 (USD 4.13)** después de IVA y comisiones de Stripe.
- Un PRO típico con los límites recomendados cuesta **MXN 33 al mes**. **Margen bruto: ~56%**, y ~66% con las optimizaciones de la sección 5.4.
- Un PRO que agota **todos** los límites cuesta MXN 109 (pierde MXN 33). Con optimizaciones cuesta MXN 70 y queda en +8%.

**Cuánto cuesta la prueba sin tarjeta, por cada 1,000 altas** [SUPUESTO: 35% inactivos, 45% típicos, 15% pesados, 5% abusivos]:

| Variante | Costo total | Costo por cliente que paga, si convierten 2% / 5% / 10% |
|---|---|---|
| **Recomendada** (PRO con topes de prueba) | **MXN 27,081** | **MXN 1,354 / 542 / 271** |
| Prueba con los límites PRO completos, con controles | MXN 44,288 | MXN 2,214 / 886 / 443 |
| Prueba = PRO tal como está el código hoy | **MXN 150,963** | MXN 7,548 / 3,019 / 1,510 |

**Lo que manda es SerpApi** (búsquedas de vuelos, hoteles, lugares y estado de vuelo). Hoy quedan ~216 búsquedas, que alcanzan para **uno a tres días** de pruebas. El seguimiento de vuelos con la frecuencia actual es el gasto más grande por usuario.

**Decisiones que proponemos aprobar:**

1. **GRATIS: queda como lo propusieron**, con estos ajustes:
   - 1 vuelo seguido, solo el día del vuelo;
   - 0 alertas de precio;
   - "precio en vivo" de viajes manuales con caché de 24 h;
   - máximo 5 búsquedas en vivo al día.
2. **PRO $99 MXN, IVA incluido:**
   - 100 mensajes al mes (máximo 20 al día, con máximo 2 búsquedas por mensaje);
   - 10 análisis al mes (máximo 3 al día);
   - 5 alertas;
   - **4 vuelos activos** (hoy son 10 para cualquiera);
   - **bolsa interna de 80 búsquedas en vivo al mes** por uso justo. Al pasarla se muestran precios guardados, no se bloquea.
3. **Prueba de 30 días sin tarjeta = PRO con topes de prueba:**
   - 5 análisis, 50 mensajes, 2 alertas, 2 vuelos y 30 búsquedas en vivo;
   - empieza **solo al confirmar el correo**;
   - **una por correo normalizado, para siempre**.
4. **Antes de activar la prueba:**
   - subir de plan SerpApi (Production o Big Data);
   - bajar la frecuencia del seguimiento de vuelos;
   - pasar Resend a Pro (el plan gratis manda solo 100 correos al día);
   - corregir los textos que hoy prometen "ilimitado", "24/7" y "con tarjeta".

**Los 3 riesgos principales:**

1. **El costo de SerpApi y del seguimiento de vuelos se dispara y se agota la bolsa.** Los precios "en vivo" pasan a estimaciones sin aviso.
2. **El código hoy no tiene topes para PRO.** `consume_free_quota` responde "pro" y deja pasar todo, y `is_pro` trata un `trialing` sin fecha de fin como PRO para siempre. Una prueba mal creada daría acceso ilimitado y permanente. A eso se suma el abuso con cuentas múltiples: borrar la cuenta reinicia las cuotas, y el limitador confía en `X-Forwarded-For`.
3. **Promesas contradictorias en la página principal, `Pro.tsx`, Términos y correos:** "sin tarjeta" frente a "se requiere tarjeta", "renovación automática", "ilimitado", "24/7". Es riesgo con PROFECO y con la confianza del cliente.

---

## 1. Ingreso neto por usuario PRO

[PRECIO PÚBLICO] Stripe México (https://stripe.com/mx/pricing, consultado 2026-10-22):

- tarjeta nacional: 3.6% + MXN 3;
- Billing: 0.7%;
- Tax: 0.5%;
- **comisiones sin IVA**.

El checkout usa `automatic_tax` (`stripe-checkout/index.ts:87`), así que Stripe Tax aplica.

Supuesto conservador: tratamos el IVA de las comisiones de Stripe como costo. Si IATOS lo acredita, el neto sube ~MXN 1.2 [SUPUESTO].

| Concepto (MXN por mes) | **$99 con IVA incluido** | $99 + IVA (cliente paga $114.84) |
|---|---|---|
| Lo que paga el cliente | 99.00 | 114.84 |
| IVA trasladado (16%) que se entrega al SAT | −13.66 | −15.84 |
| Base sin IVA | 85.34 | 99.00 |
| Stripe procesamiento (3.6% + $3) | −6.56 | −7.13 |
| Stripe Billing (0.7%) | −0.69 | −0.80 |
| Stripe Tax (0.5%) | −0.49 | −0.57 |
| IVA sobre esas comisiones (16%) | −1.25 | −1.36 |
| **Ingreso neto** | **76.35 (USD 4.13)** | **89.13 (USD 4.82)** |
| Tarjeta internacional | −0.5% adicional (~MXN 0.5) | ídem |

**Recomendación: "$99 MXN al mes, IVA incluido".**

- Es lo que ya anuncian la página principal, `Pro.tsx` y Términos.
- En México el precio al consumidor debe mostrarse con impuestos incluidos [SUPUESTO legal: confirmar con su contador o abogado].
- Requiere crear el precio de Stripe con `tax_behavior: inclusive` (hallazgo IATOS-011).
- **No modelamos ISR.** Consultar al contador.

---

## 2. Costo por usuario al mes y margen

Unidades usadas, en USD (de `IATOS_COSTOS_UNITARIOS.md`, sección 3):

- análisis: 0.187 (con Perplexity, conservador);
- mensaje: 0.027 en mezcla típica y 0.041 en mezcla pesada;
- vuelo seguido: 1.20 con la frecuencia actual y 0.26 con la recomendada;
- alerta: 0.27 al mes con la regla actual y 0.08 con la recomendada;
- vista de un viaje manual: 0.03.

[SUPUESTO] Cómo usa la app cada tipo de usuario:

| Perfil | Uso en un mes |
|---|---|
| Gratis típico (mes 1) | 1 análisis de cortesía, 3 mensajes, 3 vistas de viajes manuales |
| Gratis pesado | Usa todo lo que el código permite hoy |
| Prueba o PRO típico | 2 análisis, 20 a 25 mensajes, 1 alerta, 1 a 2 vuelos seguidos |
| Pesado | Todos los límites al tope |
| Abusivo | Todos los límites al tope y cada operación en su peor caso |

| Escenario | USD al mes | MXN al mes | Margen contra MXN 76.35 neto |
|---|---|---|---|
| GRATIS típico, mes 1 (incluye la cortesía) | 0.41 | 7.5 | — (costo de adquisición) |
| GRATIS típico, meses siguientes | 0.19 | 3.5 | — |
| **GRATIS pesado, con el código de HOY** (10 vuelos seguidos, 3 alertas, 30 vistas `serpapi-quote`) | **16.98** | **313.8** | — |
| GRATIS pesado, con los controles recomendados | 0.68 | 12.6 | — |
| PRUEBA recomendada, típico | 1.35 | 25.0 | — |
| PRUEBA recomendada, pesado al tope | 3.05 | 56.4 | — |
| PRUEBA recomendada, abusivo al tope | 7.27 | 134.3 | — |
| Prueba = PRO propuesto con el código de hoy, típico | 3.87 | 71.5 | — |
| Prueba = PRO propuesto con el código de hoy, pesado | 22.92 | 423.7 | — |
| Prueba = PRO propuesto con el código de hoy, abusivo | 59.06 | 1,091.6 | — |
| **PRO recomendado, típico** | **1.80** | **33.3** | **+56%** |
| PRO recomendado, típico con optimizaciones (sección 5.4) | 1.41 | 26.1 | +66% |
| PRO recomendado, pesado al tope | 5.90 | 109.0 | −43% |
| PRO recomendado, pesado al tope con optimizaciones | 3.79 | 70.1 | +8% |
| PRO recomendado, abusivo al tope | 13.33 | 246.4 | −223% |

**Lectura:**

- El negocio funciona si la mayoría de los PRO son "típicos".
- Si 70% son típicos, 20% intermedios y 10% pesados, el costo promedio de un PRO queda en ~USD 2.6 (**margen ~37%**). Con optimizaciones, en ~USD 1.9 (**~54%**). [SUPUESTO]
- Los sublímites diarios y la bolsa de búsquedas existen para que un usuario abusivo no pase de unos MXN 250 al mes en el peor caso.

---

## 3. Costo de la prueba: cohorte de 1,000 altas

[SUPUESTO] Mezcla de la cohorte:

- **35% inactivos** (registro y casi nada más, ~USD 0.10 cada uno);
- **45% típicos**;
- **15% pesados**;
- **5% abusivos**.

El "costo por cliente que paga" es el costo de la cohorte dividido entre los que convierten. "Meses para recuperar" es ese costo dividido entre la contribución mensual de un PRO típico: USD 4.13 − 1.80 = **USD 2.33 al mes**, o 2.72 con optimizaciones.

| Variante de prueba | Costo de 1,000 altas | Conversión | Clientes que pagan | Costo por cliente que paga | Meses para recuperar (normal / optimizado) |
|---|---|---|---|---|---|
| **Recomendada** (topes de prueba) | **USD 1,465 · MXN 27,081** | 2% | 20 | MXN 1,354 | 31 / 27 |
| | | 5% | 50 | MXN 542 | 13 / 11 |
| | | 10% | 100 | **MXN 271** | **6 / 5** |
| Límites PRO completos, con controles | USD 2,396 · MXN 44,288 | 2% / 5% / 10% | 20 / 50 / 100 | MXN 2,214 / 886 / 443 | 51 / 21 / 10 |
| PRO tal cual está el código hoy | USD 8,168 · MXN 150,963 | 2% / 5% / 10% | 20 / 50 / 100 | MXN 7,548 / 3,019 / 1,510 | 175 / 70 / 35 |

**Qué significa:**

- Con 2% de conversión, la prueba sin tarjeta **no se paga en un tiempo razonable**, ni con los topes.
- Con 5% se recupera en ~1 año. Con 10%, en ~6 meses.
- **El 45% "típico" es el que más pesa en el costo**, no el abusivo. Por eso:
  - la prueba empieza al confirmar el correo, lo que filtra cuentas basura;
  - las funciones caras (seguimiento de vuelos) se activan bajo demanda, no solas;
  - **la conversión se mide desde el primer día** (sección 10).
- **Plan B** si en el primer mes la conversión es menor a 4% [SUPUESTO]: prueba de 14 días, o una "prueba ligera" (3 análisis, 30 mensajes, 1 alerta, 1 vuelo). Costaría ~USD 1,180 por cada 1,000 altas.

---

## 4. La restricción que manda y los costos fijos

### 4.1 SerpApi decide

Búsquedas al mes por usuario, con las reglas recomendadas [SUPUESTO]:

| Usuario | Búsquedas al mes |
|---|---|
| Prueba típica | ~34 (2 análisis × 3 + chat ~8 + alerta ~3 + 1 vuelo ~17) |
| PRO típico | ~53 |
| Promedio por alta de prueba (con la mezcla de la sección 3) | ~24.5 |

| Escala mensual | Búsquedas al mes | Plan de SerpApi necesario | USD al mes |
|---|---|---|---|
| Hoy (pruebas de los fundadores) | ~2,000 a 4,000 (65 a 145 al día) | Developer | 75 |
| Lanzamiento: 300 altas de prueba + 30 PRO | ~8,900 | **Production** (15,000) | 150 |
| 1,000 altas + 100 PRO | ~29,800 | Big Data (30,000) **al límite** → Searcher | 275 a 725 |
| 3,000 altas + 300 PRO | ~89,400 | Searcher (100,000) | 725 |

Si **todo** se hiciera con el código de hoy, el seguimiento de vuelos (80 a 172 búsquedas por vuelo) **multiplicaría estas cifras por 3 o 4**.

Una **caché compartida entre usuarios**, guardada en la base, debería ahorrar 20 a 40% más [SUPUESTO]. Por ejemplo: la misma ruta y fechas, el mismo hotel y fechas, o el estado del mismo vuelo.

### 4.2 Otros costos fijos

- **Lovable:** USD ~25 a 50 al mes [SUPUESTO].
- **Resend Pro:** USD 20. Es obligatorio con más de ~50 altas al día, porque el plan gratis manda solo 100 correos al día.
- **Google Maps:** USD 0 dentro de lo gratis.

Con una contribución de USD 2.33 por PRO, hacen falta **unos 30 PRO** para cubrir Lovable y Resend.

### 4.3 Riesgo de precio

Si el chat sigue en `gemini-flash-latest` (= 3.8 Flash), **su costo se duplica el 1-ene-2027** [PRECIO PÚBLICO]. Fijar el modelo explícitamente, por ejemplo `gemini-2.5-flash` si responde a esta cuenta, cuesta 2 a 4 veces menos (sección 5.4).

---

## 5. Límites recomendados

### 5.1 Tabla final

| Beneficio | **GRATIS** | **PRUEBA PRO 30 días** (sin tarjeta) | **PRO $99 MXN al mes, IVA incluido** |
|---|---|---|---|
| Travel DNA | Básico | Completo + personalización avanzada | Completo + personalización avanzada |
| Viajes guardados, edición manual, herramientas esenciales | Sí | Sí | Sí |
| **Mensajes de Iato** | **3 al mes** | **50 en total**, máximo 15 al día | **100 al mes**, máximo 20 al día |
| Búsquedas por mensaje (vuelos, hoteles, lugares, estado de vuelo) | 1 | 2, máximo 2 vueltas | 2, máximo 2 vueltas |
| **Análisis completos** | **1 de cortesía de por vida.** No se gasta si falla. | **5 en total**, máximo 2 al día | **10 al mes**, máximo 3 al día |
| Plan multiciudad | Cuenta como el análisis de cortesía; hasta 3 ciudades | Hasta 6 ciudades; más de 3 cuenta como 2 análisis | Igual |
| **Alertas de precio** activas | 0 | 2 | **5** |
| **Vuelos seguidos** activos | **1, "básico"**: solo el día del vuelo | 2, ampliado | **4, ampliado** (hoy son 10 para cualquiera) |
| Bolsa de **búsquedas en vivo** (chat + alertas + vuelos; los análisis van aparte) | 5 al día y 15 al mes | 30 en total | **80 al mes, por uso justo** |
| Precio en vivo de viajes manuales (`serpapi-quote`) | 1 vez por viaje cada 24 h; caché compartida | Igual | Igual |
| Edición del viaje con IA (`editar-viaje-ai`) | 3 al mes | 15 | 30 al mes |
| Avatar con IA | 1 | 3 | 5 al mes |
| **Fixer humano** | No | 1 solicitud | **Acceso preferente sujeto a disponibilidad**, en horario de servicio. Referencia interna: 2 solicitudes al mes; **no se promete 24/7 ni ilimitado**. |

**Qué pasa al llegar a un tope:**

- La **bolsa de búsquedas en vivo** no bloquea. Al pasarla, Iato y las alertas usan **precios guardados**: caché compartida, o Travelpayouts que es gratis. Se avisa con "precio de referencia, no en vivo" y se vuelve a llenar el día 1.
- Los **topes diarios** devuelven un mensaje claro con la hora en que se reinician.

### 5.2 Por qué estos números

| Cambio contra la propuesta original | Justificación con números |
|---|---|
| PRO: **100 mensajes**, sin cambio, pero **máximo 2 búsquedas por mensaje y 20 mensajes al día** | El peor mensaje de hoy (4 vueltas, ~9 búsquedas) cuesta USD 0.23. Con 2 vueltas y 2 búsquedas el máximo baja a ~USD 0.10. 100 mensajes pesados cuestan ~USD 2.3 de modelo. |
| PRO: **10 análisis**, sin cambio, pero **máximo 3 al día** | 10 × USD 0.187 = USD 1.87 (45% del neto). Sin Perplexity: USD 1.29. El tope diario frena que se vacíe todo en una tarde con scripts. |
| PRO: **vuelos activos de 10 a 4**, con nueva frecuencia | Hoy un vuelo cuesta USD 1.2 a 2.6. Con 10 vuelos son USD 12 a 26 al mes: **3 a 6 veces el ingreso neto**. 4 vuelos con la frecuencia nueva: ~USD 1.0. |
| PRO: **5 alertas**, sin cambio, pero **SerpApi como máximo cada 72 h por alerta** | Hoy, 5 alertas pueden gastar hasta 300 búsquedas al mes (USD 4.5). Con la regla nueva: ≤50 (USD 0.75). Travelpayouts sigue revisando 2 veces al día gratis. |
| PRO: **bolsa de 80 búsquedas en vivo** | 80 × 0.015 = USD 1.2. Un PRO típico usa ~47 de esa bolsa. Junto con los otros topes, deja el **peor caso razonable en USD 3.8 a 5.9**. |
| PRUEBA: **5 / 50 / 2 / 2 / 30** en lugar de los límites PRO completos | Baja el costo de la cohorte de USD 2,396 a USD 1,465 (−39%). Alcanza para planear 2 o 3 viajes reales. |
| GRATIS: **0 alertas y 1 vuelo básico** | Mantiene lo que propusieron: alertas y seguimiento ampliado son de PRO. El vuelo básico (~8 búsquedas, USD 0.12) sirve para que el usuario vea el valor. Opción sin costo: 1 alerta solo con Travelpayouts, USD 0. |
| GRATIS: **caché de 24 h en `serpapi-quote`** | Hoy cada vista de un viaje manual gasta 2 búsquedas (USD 0.03), incluso en GRATIS. 30 vistas son USD 0.90 por un usuario que no paga. |
| **Multiciudad: máximo 6 ciudades** | Hoy no hay tope: 20 ciudades son ~40 búsquedas y USD 1.44 con una sola cuota. |

### 5.3 Frecuencia recomendada para el seguimiento de vuelos

Diseño, no código. Reemplaza `tracked_flight_gap`.

| Momento | PRO / PRUEBA ("ampliado") | GRATIS ("básico") |
|---|---|---|
| Al agregarlo | 1 revisión | 1 revisión |
| De 72 h a 24 h antes | Cada 24 h (2) | — |
| De 24 h a 6 h antes | Cada 6 h (3) | — |
| De 6 h a 2 h antes | Cada hora (4) | Cada 2 h desde 3 h antes (1 o 2) |
| De 2 h antes a la salida | Cada 30 min **con `no_cache`** (4) | Cada hora (2) |
| En vuelo y hasta 1 h después de llegar | Cada hora (~4 o 5) | Cada hora (~3) |
| **Total por vuelo** | **~17 búsquedas (USD 0.26)** | **~8 (USD 0.12)** |

- Si el proveedor ya avisó una cancelación o el vuelo aterrizó, se deja de revisar.
- **Caché por número de vuelo y fecha, compartida entre usuarios:** dos personas en el mismo vuelo pagan una sola búsqueda.
- **Alternativa por evaluar:** un proveedor de estado de vuelos dedicado (FlightAware AeroAPI, AeroDataBox). **No confirmamos sus precios** [SUPUESTO: podría ser más barato que SerpApi].

### 5.4 Optimizaciones de costo que no afectan al usuario

| # | Optimización | Ahorro estimado [SUPUESTO] |
|---|---|---|
| 1 | Apagar Perplexity en el análisis, o dejarlo solo cuando falten datos en vivo | −USD 0.058 por análisis (−31%) |
| 2 | Fijar el modelo del chat (`gemini-2.5-flash` si responde) en lugar de `-latest`, y registrar cuál se usó | −50 a −75% del costo del modelo del chat; evita la subida de 2027 |
| 3 | Mandarle a Iato un **resumen del viaje** (~5,000 caracteres) en lugar del JSON completo (~22,000), y el detalle solo si la pregunta lo necesita | −30 a −40% de los tokens de entrada por llamada |
| 4 | Caché de prompt en Claude para la parte fija (sistema + esquema, ~15,000 caracteres; lectura a $0.10 por millón) | ~−USD 0.008 por análisis |
| 5 | **Caché compartida de SerpApi** en la base: vuelos 30 a 60 min, hoteles 6 h, Maps 7 días, estado de vuelo 15 min | −20 a −40% de búsquedas |
| 6 | Guardar los videos y fotos de Pexels por destino en la base | Evita el tope de 20,000 al mes de Pexels |
| 7 | Arreglar o apagar `buscar-promociones` y `nightlife-discover`, que usan Claude Sonnet 4 (retirado) | Deja de gastar Perplexity en llamadas que fallan |

---

## 6. Diseño de la prueba PRO de 30 días sin tarjeta

### 6.1 Ciclo de vida

1. **Registro.** Correo y contraseña, o Google, con **Cloudflare Turnstile** (es invisible para casi todos).
2. **Confirmación del correo.** Al confirmar, y solo si el correo normalizado **nunca** tuvo prueba, se crea la prueba. Mismo patrón que `apply_comp_grant`, que ya exige `email_confirmed_at` (`migrations/20261022130000_pay_stripe_sync_and_atomic_quota.sql`, sección 5).
   - En `subscriptions`: `status='trialing'`, `plan='pro'`, `trial_end = current_period_end = fecha de confirmación + 30 días`, **sin ids de Stripe**.
   - Se registra en `trial_grants` (nueva tabla).
   - Las cuentas con cortesía (`comped`) o con una suscripción de Stripe viva **no** reciben prueba.
3. **Durante la prueba.** `is_pro` ya trata `trialing` con `current_period_end > now()` como PRO. Los topes de la tabla 5.1 se aplican en el servidor con los límites del plan `trial`.
4. **Recordatorios.**

| Día | Correo |
|---|---|
| 0 | Bienvenida a la prueba |
| 23 | "Te quedan 7 días" |
| 28 | "Te quedan 2 días" |
| 30 | "Tu prueba terminó: sigues en Gratis con tus viajes" |

   Ninguno pide tarjeta: solo enlazan a `/dashboard/pro`.
5. **Fin.** `is_pro` deja de ser verdadero solo, porque pasa `current_period_end`. **No hay cobro: no hay tarjeta.** Los datos se conservan. Un proceso nocturno pausa lo que excede GRATIS **sin borrarlo**:
   - las alertas pasan a `active=false`;
   - de los vuelos queda activo solo el más próximo.
6. **Contratar durante o después de la prueba.** Stripe Checkout pide la tarjeta. `trialEligible` ya devuelve `false` si `stored.trial_end` existe (`stripe-checkout/logic.ts:78-81`): **no se regala una segunda prueba en Stripe.** Hay que decidir qué pasa con los días que le quedaban:
   - **Opción A (más simple):** se cobra al contratar y se avisa: "tu prueba termina hoy y empieza tu suscripción".
   - **Opción B (más justa):** se crea la suscripción con `subscription_data.trial_end` = fin de la prueba de la app, para que el primer cargo caiga el día 30. Es la misma prueba, no una nueva. [SUPUESTO: Stripe exige que `trial_end` esté al menos ~48 h en el futuro; verificar en su documentación. Si faltan menos, aplica la opción A.]
   - **Recomendación:** B, con A como respaldo.

### 6.2 Texto único

**Debe ser idéntico en Landing, Auth, Pro, Términos y correos.**

> **Prueba IATOS PRO 30 días gratis.** Sin tarjeta y sin cobros automáticos. Al terminar vuelves al plan Gratis y conservas tus viajes y tu Travel DNA. Solo te pediremos tarjeta si decides contratar PRO: $99 MXN al mes, IVA incluido. La prueba incluye hasta 5 análisis completos, 50 mensajes con Iato, 2 alertas de precio y el seguimiento de 2 vuelos. Una prueba por persona; empieza al confirmar tu correo.

> **IATOS PRO — $99 MXN al mes, IVA incluido.** 100 mensajes con Iato al mes, 10 análisis completos al mes, hasta 5 alertas de precio, seguimiento ampliado de hasta 4 vuelos a la vez, personalización avanzada y funciones premium del viaje. Fixer humano: acceso preferente sujeto a disponibilidad (no es un servicio 24/7). Las búsquedas de precios en vivo tienen un límite de uso justo; al pasarlo verás precios de referencia guardados.

---

## 7. Controles contra el abuso de la prueba sin tarjeta

### 7.1 Controles

| # | Control | Qué frena | Fricción para un usuario legítimo | Costo | Recomendación |
|---|---|---|---|---|---|
| 1 | **Una prueba por correo verificado, para siempre**: tabla `trial_grants` con un hash del correo normalizado, que **no se borra** al borrar la cuenta | Borrar la cuenta y volver a registrarse. Hoy `deleteUser` (`delete-account/index.ts:58`) borra `usage_limits` en cascada y reinicia todas las cuotas. | Ninguna | USD 0 | **Sí, obligatorio** |
| 2 | **Normalizar el correo** (solo para la llave de duplicados, no para el inicio de sesión): minúsculas, quitar `+alias` en todos los dominios, quitar puntos en `gmail.com`/`googlemail.com`, tratar `googlemail.com` como `gmail.com` | `juan+1@`, `j.u.a.n@gmail.com` | Ninguna | USD 0 | **Sí** |
| 3 | **Bloquear dominios de correo desechable** con una lista abierta (por ejemplo, el proyecto *disposable-email-domains*) actualizada cada mes | Correos temporales | Muy baja (falsos positivos raros; mensaje "usa un correo personal o de trabajo") | USD 0 | **Sí** |
| 4 | **La prueba empieza solo al confirmar el correo** | Correos inventados | Baja (1 clic) | Resend Pro, USD 20 al mes, por el límite de 100 al día | **Sí** |
| 5 | **Cloudflare Turnstile** en el registro y al iniciar la prueba | Bots que crean cuentas | Casi nula: suele ser invisible | USD 0 | **Sí** |
| 6 | **Velocidad por IP y por dispositivo:** más de 3 pruebas por IP (o /24) al día, o más de 2 por dispositivo en 30 días, **marca la cuenta como sospechosa; no la bloquea** | Fábricas de cuentas | Baja. En México los celulares comparten IP (CGNAT), por eso solo se marca. | USD 0 | **Sí, como señal.** Requiere corregir **F-07**: `clientIp` toma el primer valor de `X-Forwarded-For`, que el cliente puede falsificar (`_shared/rate-limit.ts:236-240`). Usar la IP que agrega la plataforma (`cf-connecting-ip` o el último salto de confianza; verificar en Supabase). |
| 7 | **Verificar el teléfono solo con señales sospechosas** (la cuenta ya está marcada por 6 o 9) | Abusador persistente | Alta, pero solo para ese ~1 a 5% | ~USD 0.05 más el SMS a México (sin confirmar) | **Fase 2**, si la medición muestra abuso |
| 8 | **Topes de prueba** en lo caro (tabla 5.1) y tope diario | Que se vacíe la prueba en un día | Baja | USD 0 | **Sí** |
| 9 | **Consultas semanales de detección** (7.2) | Patrones de cuentas múltiples | Ninguna | USD 0 | **Sí** |
| 10 | **Huella de la tarjeta en Stripe** (`card.fingerprint`) al contratar | Saber cuántas pruebas terminaron con la misma tarjeta (solo informa) | Ninguna | USD 0 | Sí, solo para medir |
| 11 | **Límite de análisis fallidos:** máximo 3 al día por usuario, aunque no gasten la oportunidad | Forzar errores a propósito (un análisis fallido igual nos cuesta USD 0.02 a 0.10) | Ninguna | USD 0 | **Sí** |

### 7.2 Consultas de detección

Esbozo para la persona técnica, no es código final:

```sql
-- a) Varias cuentas con el mismo correo normalizado (intentos de prueba repetida)
SELECT email_norm_hash, count(*) FROM trial_attempts GROUP BY 1 HAVING count(*) > 1;

-- b) Muchas pruebas desde la misma red o el mismo dispositivo en 24 h
SELECT ip_prefix_hash, count(*) FROM trial_grants
 WHERE granted_at > now() - interval '24 hours' GROUP BY 1 HAVING count(*) > 3;
SELECT device_hash, count(*) FROM trial_grants
 WHERE granted_at > now() - interval '30 days' GROUP BY 1 HAVING count(*) > 2;

-- c) El mismo viaje (origen, destino, fechas) analizado por cuentas distintas en 7 días
SELECT lower(ciudad_origen), lower(destino), fecha_salida, fecha_regreso, count(DISTINCT user_id)
  FROM trips WHERE created_at > now() - interval '7 days'
 GROUP BY 1,2,3,4 HAVING count(DISTINCT user_id) >= 3;

-- d) La misma suscripción push en varias cuentas (un solo navegador)
SELECT endpoint, count(DISTINCT user_id) FROM push_subscriptions GROUP BY 1 HAVING count(DISTINCT user_id) > 1;

-- e) Pruebas que llegan a 3 o más topes en las primeras 48 h
SELECT user_id FROM usage_counters
 WHERE plan = 'trial' AND used >= limit_value AND first_hit_at < trial_started_at + interval '48 hours'
 GROUP BY user_id HAVING count(*) >= 3;
```

---

## 8. Impacto técnico

### 8.1 Base de datos

| Objeto | Cambio |
|---|---|
| `subscriptions` | Fila de prueba **sin ids de Stripe**: `status='trialing'`, `plan='pro'`, `trial_end` y `current_period_end` con la misma fecha, más una columna `source` (`app_trial`, `stripe`, `comped`). **Agregar un CHECK:** si `status='trialing'` y no hay `stripe_subscription_id`, `current_period_end` no puede ser NULL. Hoy `is_pro` trata un `current_period_end` NULL como PRO para siempre (`migrations/20260824010104_…sql:30-35`). |
| `apply_stripe_subscription` | Hoy sobrescribe `trial_end` con el valor de Stripe (NULL si no hubo prueba en Stripe), y se pierde el registro de la prueba. **La historia de la prueba vive en `trial_grants`**, no en `subscriptions`. Revisar que una fila `trialing` de la app sin `stripe_subscription_id` no se considere "otra suscripción viva": hoy `stripe_sub_is_live` exige un `subscription_id`, así que está bien. |
| **`trial_grants`** (nueva) | `email_norm_hash` como llave primaria, `user_id` (sin borrado en cascada), `granted_at`, `ends_at`, `ip_prefix_hash`, `device_hash`, `signals jsonb`. Se crea con un trigger al confirmar el correo. |
| **`plan_limits`** (nueva) | `(plan: free/trial/pro, kind, period: lifetime/trial/month/day, limit)`, con los tipos `concierge`, `trip_analysis`, `live_search`, `ai_edit`, `avatar`, `price_watch_active`, `tracked_flight_active` y `fixer_request`. Así se cambian los límites sin desplegar. |
| `usage_limits` → **`usage_counters`** | `(user_id, kind, period_key, used, reserved)`. Reemplaza a `consume_free_quota`, que hoy **solo conoce gratis y deja pasar todo a PRO** (sección 3 de la migración `…130000`). |
| **`quota_reservations`** (nueva) | `(id, user_id, kind, units, status: reserved/committed/released, request_id, expires_at)`. Funciones `reserve_quota`, `commit_quota` y `release_quota`, más un proceso que libera las reservas vencidas (10 min). **Un análisis o mensaje que falla libera su reserva.** |
| `get_entitlement(user)` (nueva) | Devuelve `free`, `trial`, `pro` o `comped` y sus límites. Reemplaza las llamadas sueltas a `is_pro`. |
| **`serp_cache`** (nueva) | `(key_hash, engine, response jsonb, fetched_at, ttl)`, compartida entre usuarios. |
| **`ai_usage_log`** (nueva) | `(user_id, fn, provider, model, input_tokens, output_tokens, thinking_tokens, serp_searches, est_cost_usd, ok, created_at)`. Es lo que permite **medir** todo esto (sección 10). |
| `tracked_flight_gap` / `claim_tracked_flights` | Nueva frecuencia (5.3). Solo se reclaman vuelos dentro del tope del plan. |
| `price_watches` | Tope de alertas activas por plan (0 / 2 / 5) con trigger o validación en la función. SerpApi como máximo cada 72 h por alerta. |

### 8.2 Funciones del servidor

| Función | Cambio |
|---|---|
| `analizar-viaje` | Reservar (`:658`) → confirmar al guardar el viaje (`:1065-1094`) → liberar en cada salida con error (`:988`, `:996`, `:1053`, `:1097`, `:1151`). Tope diario. Perplexity opcional. Registrar `usage`. |
| `logistics-plan` | Igual que el análisis; máximo 6 ciudades; más de 3 cuenta como 2 análisis (`:370`, `:381`). |
| `concierge-chat` | Reservar y confirmar mensajes (`index.ts:233`). `MAX_ITERATIONS` de 4 a 3, es decir 2 vueltas con herramientas (`loop.ts:17`). Máximo 2 herramientas por vuelta (`loop.ts:36`). Descontar de la bolsa `live_search`. Fijar el modelo (`index.ts:407`). Resumir el viaje en contexto. **Cambiar "24/7… en minutos" del Fixer** (`prompt.ts:76`). |
| `flights-search`, `hotels-search`, `tripadvisor-search`, `places-nearby`, `flight-status` | Leer y escribir en `serp_cache`; descontar de `live_search` cuando las llama el usuario (no cuando las llama un análisis). |
| `serpapi-quote` | Caché de 24 h por ruta y fechas; nunca más de 1 consulta en vivo por viaje cada 24 h. |
| `price-watch` | Exigir el plan y el tope de alertas activas (`index.ts:30-114`). |
| `price-watch-cron` | Travelpayouts 2 veces al día; SerpApi como máximo cada 72 h por alerta (`_shared/travelpayouts.ts:131-145`). |
| `track-flight` | `MAX_ACTIVE_PER_USER` por plan en lugar de 10 fijo (`rules.ts:4`). |
| `flight-watch-cron` / `_shared/flight-serpapi.ts` | Nueva frecuencia; `no_cache=true` solo en la ventana final (`:95-101`). |
| `editar-viaje-ai`, `generate-avatar`, `generar-packing-list` | Cuotas por plan. |
| `buscar-promociones`, `nightlife-discover` | Cambiar `claude-sonnet-4-20250514` (retirado) o apagar. |
| `stripe-checkout` | Ya bloquea una segunda prueba en Stripe (`logic.ts:78-81`). Agregar la opción B (`trial_end` = fin de la prueba de la app). No bloquear la contratación de alguien en `trialing` sin Stripe: hoy `blockFromStored` solo bloquea si hay `stripe_subscription_id` (`logic.ts:56-66`), así que ya funciona. |
| `stripe-webhook` | Al activarse PRO pagado, `source='stripe'`. No borrar `trial_grants`. |
| `delete-account` | Conservar `trial_grants` (solo el hash). |
| `_shared/rate-limit.ts` | Corregir F-07 (`clientIp`, `:236-240`). |
| `_shared/quota.ts` | Mensajes del paywall: quitar "acceso ilimitado" (`:77`); mensaje distinto para "tope del plan", "tope diario" y "fin de prueba". |
| `_shared/email.ts` | Correos de la prueba (días 0, 23, 28 y 30). Quitar "24/7" (`:152`). |
| Nuevo trigger o función `start_app_trial` | Al confirmar el correo; Turnstile se valida en el servidor. |
| Nuevo cron `trial-lifecycle` (diario) | Correos de recordatorio y pausa de lo que excede GRATIS. |

### 8.3 Páginas y textos

**Todos deben decir exactamente lo de la sección 6.2.**

| Archivo | Línea y texto actual | Cambio |
|---|---|---|
| `src/pages/Landing.tsx` | `:80` "Sin tarjeta los primeros 30 días · Cancela cuando quieras" | "Sin tarjeta y sin cobros automáticos" ("cancelar" no aplica: no hay cobro) |
| | `:117` "Planes premium ilimitados" | Quitar "ilimitados" |
| | `:199` "Análisis de viaje ilimitados" | "10 análisis completos al mes" |
| `src/pages/Pro.tsx` | `:10-11` "ilimitado" / "ilimitados" | Límites de la tabla 5.1 |
| | `:33` "Disfruta el acceso ilimitado" | Quitar "ilimitado" |
| | `:50` "En periodo de prueba · N días restantes" | Se queda, pero debe salir también para la prueba de la app |
| | `:67`, `:148` "30 días de prueba" | Texto 6.2 |
| | `:154` **"Se requiere tarjeta para iniciar la prueba"** | **Eliminar.** Contradice la prueba sin tarjeta. |
| `src/pages/Auth.tsx` | Hoy no menciona la prueba | Agregar el texto 6.2 en el registro, Turnstile y "confirma tu correo para activar tu prueba" |
| `src/pages/Legal.tsx` | `:51` "con 30 días de prueba gratis al activar la suscripción con tarjeta" | Texto 6.2 |
| | `:54` "Si cancelas durante el periodo de prueba…" | Texto 6.2 |
| | `:152` "acceso ilimitado… Fixer humano" | Límites y "Fixer sujeto a disponibilidad" |
| | `:155-159` "Al terminar la prueba se realiza el primer cargo… se renueva automáticamente" | "Al terminar la prueba vuelves a Gratis; no hay cargo" + regla de una prueba por persona + uso justo de búsquedas en vivo |
| `src/components/ProGate.tsx` | `:39` "para acceso ilimitado" | Corregir |
| `src/components/FixerButton.tsx` | `:220` "Te contactará… en minutos" | "Te contactaremos lo antes posible, según disponibilidad" |
| `src/pages/DashboardHome.tsx` · `src/pages/LiveTrip.tsx` | `:671` "IA 24/7" · `:148` "24/7" | Aceptable si se refiere a la IA. Cuidar que no se lea como Fixer 24/7. |
| Contadores en la interfaz | No existen | Mostrar "te quedan X de Y" para mensajes, análisis y búsquedas en vivo |

---

## 9. Riesgos

| # | Riesgo | Probabilidad / impacto | Cómo se mitiga |
|---|---|---|---|
| 1 | **Se agota SerpApi** (quedan ~216) en cuanto entren las pruebas. Los precios "en vivo" pasan a estimaciones de IA y el seguimiento de vuelos se queda sin datos. | Alta / alto | Subir de plan **antes** de lanzar; caché compartida; nueva frecuencia de vuelos; alerta del chequeo de salud por debajo del 20% del plan, no de 200 (`health-check/checks.ts:27`) |
| 2 | **PRO y prueba sin topes en el servidor.** `consume_free_quota` deja pasar todo a PRO. Una fila `trialing` sin `current_period_end` da PRO para siempre. | Alta mientras no se implemente / alto | `plan_limits` + reservas + CHECK; prueba de aceptación 3 |
| 3 | **Cuentas múltiples:** borrar y volver a registrarse, alias de Gmail, correos desechables, IP falsificable (F-07) | Media / medio | Sección 7 |
| 4 | **Textos contradictorios** ("sin tarjeta" frente a "se requiere tarjeta", "renovación automática", "ilimitado", "24/7") | Seguro hoy / alto (PROFECO, confianza) | Texto único 6.2; prueba de aceptación 20 |
| 5 | **Resend gratis manda 100 correos al día.** Sin confirmación no hay prueba. | Alta si hay más de 50 altas al día / alto | Resend Pro antes de lanzar; el SMTP de Supabase Auth debe ir por un dominio verificado |
| 6 | **Gemini Flash sube al doble el 1-ene-2027** | Segura / medio | Fijar el modelo; registrar el costo real |
| 7 | **Conversión baja (<4%)**: la prueba no se recupera | Media / alto | Medir desde el día 1; plan B (14 días o prueba ligera) |
| 8 | **Un análisis fallido no gasta la oportunidad, pero sí cuesta**, y se puede forzar | Baja / bajo | Límite de 3 fallas al día |
| 9 | **Topes de terceros que no son dinero:** Pexels 20,000 al mes, gateway de Google Maps 6,000 al día, 80 revisiones de alertas al día | Media / medio | Guardar los medios en la base; llave propia de Google Maps; subir el `BATCH` de alertas cuando haya más de 40 activas |
| 10 | **Funciones rotas que igual cuestan:** promociones y vida nocturna con Claude Sonnet 4 retirado; avatar con un modelo retirado | Media / bajo | Corregir o apagar |
| 11 | **Datos de hasta 1 h de antigüedad** en el seguimiento "cada 15 min", por la caché de SerpApi | Media / medio (confianza) | `no_cache` solo en la ventana final; mostrar "actualizado hace X min" |
| 12 | **Fixer humano:** demanda que no se puede atender | Media / medio | "Sujeto a disponibilidad", tope de referencia y horario publicado |

---

## 10. Qué medir en los primeros 30 días

1. **Costo real por usuario al mes** (p50, p90, p99), por plan (gratis, prueba, PRO), sacado de `ai_usage_log`. Meta: un PRO p50 de **USD 1.8 o menos**.
2. **Búsquedas de SerpApi por función y por usuario**, y **porcentaje de aciertos de caché**. Meta: más de 25%.
3. **Tokens reales por llamada:** entrada, salida y razonamiento de Claude y Gemini, comparados con los supuestos de este documento. Y **qué modelo respondió de verdad** (2.5 Flash o `-latest`).
4. **Activación de la prueba:** porcentaje que confirma el correo y porcentaje que hace 1 análisis o 3 mensajes en las primeras 48 h.
5. **Conversión de prueba a pago**, el día 30 y a los 7 días después del fin, por semana de alta. Decisión: si es menor a 4% en la primera cohorte, aplicar el plan B.
6. **Porcentaje de usuarios que llega a cada tope.** Si más del 15% de los PRO llega a un tope, revisar si el tope es demasiado bajo o hay abuso.
7. **Análisis fallidos y reservas liberadas**, con su motivo.
8. **Búsquedas por vuelo seguido**, con la nueva frecuencia. Meta: ≤20.
9. **Señales de abuso** de las consultas 7.2, por semana.
10. **Topes de terceros:** correos al día en Resend, uso de Pexels, solicitudes al gateway de Google Maps.

---

## 11. Pruebas de aceptación para activar la prueba

Todas deben pasar en un ambiente de prueba y luego verificarse en producción con cuentas de prueba.

1. Al registrarse con un correo **sin confirmar**, `subscriptions` no tiene fila `trialing` y `get_entitlement` devuelve `free`.
2. Al confirmar ese correo, se crea **una** fila: `status='trialing'`, `source='app_trial'`, `stripe_subscription_id` NULL y `current_period_end` = confirmación + 30 días (±1 min). También se crea una fila en `trial_grants`.
3. Insertar a mano `trialing` sin `stripe_subscription_id` y con `current_period_end` NULL **falla** por el CHECK.
4. Con `current_period_end` en el pasado, `is_pro` devuelve `false`, el usuario ve el plan GRATIS y **sus viajes, Travel DNA y conversaciones siguen ahí**.
5. Borrar la cuenta y registrarse de nuevo con el mismo correo **no** crea una segunda prueba.
6. `Juan.Perez+test@gmail.com` y `juanperez@googlemail.com` cuentan como el mismo correo para la prueba.
7. Un correo de un dominio desechable de la lista puede usar GRATIS, pero **no** recibe prueba, y ve un mensaje claro.
8. Un registro sin token válido de Turnstile se rechaza en el servidor.
9. Una cuenta con cortesía (`comped`) o con una suscripción de Stripe viva no recibe prueba.
10. **En GRATIS:** el 4º mensaje del mes devuelve 402 con el texto de tope. El 2º análisis devuelve 402.
11. **Un análisis que termina en 502, 503 o 500 NO gasta la oportunidad:** `usage_counters.used` no cambia y la reserva queda `released`. Uno exitoso queda `committed`.
12. Dos análisis simultáneos de una cuenta GRATIS: **solo uno** reserva. El otro recibe 402, o 409 de "ya hay uno en curso".
13. Una reserva sin confirmar ni liberar se libera sola en ≤10 min.
14. **En PRUEBA:** el 6º análisis devuelve 402 ("tope de la prueba"). El 3º análisis del mismo día devuelve 429 o 402 con la hora en que se reinicia. El mensaje 51 devuelve 402.
15. **En PRO:** el 11º análisis del mes y el mensaje 101 se rechazan. El 4º análisis del día se rechaza. El día 1 del mes los contadores vuelven a cero.
16. Un mensaje de Iato hace como máximo 2 llamadas a herramientas por vuelta y 3 llamadas al modelo (comprobar en `ai_usage_log`).
17. Al pasar la bolsa de búsquedas en vivo, Iato responde con precios guardados o de Travelpayouts, marcados "precio de referencia". **No da error ni hace otra búsqueda en SerpApi.**
18. Topes de alertas: una 6ª alerta activa en PRO, una 3ª en PRUEBA y una 1ª en GRATIS se rechazan con un mensaje claro.
19. Topes de vuelos activos: el 5º en PRO, el 3º en PRUEBA y el 2º en GRATIS se rechazan. Al terminar la prueba, solo queda activo el vuelo más próximo y los demás quedan en pausa, no borrados.
20. Los textos de Landing, Auth, Pro y Términos, y los correos de los días 0, 23, 28 y 30, contienen **literalmente** el texto 6.2. En ningún lugar visible aparecen "ilimitado", "Se requiere tarjeta" ni "Fixer 24/7" (búsqueda en `src/` y `_shared/email.ts`).
21. Con la prueba activa, Stripe Checkout se abre **sin** `trial_period_days`, porque `trialEligible` es falso. Con la opción B, el primer cargo queda en la fecha de fin de la prueba de la app.
22. Al terminar la prueba **no se crea ningún cargo ni cliente en Stripe**. En el panel de Stripe no aparece ninguna suscripción de esa cuenta.
23. El precio de Stripe es `tax_behavior: inclusive` y el total del checkout es **$99.00 MXN**.
24. `clientIp` ignora un `X-Forwarded-For` falso que manda el cliente (corrección F-07).
25. Un vuelo agregado 30 días antes consume **≤20 búsquedas de SerpApi** en todo su seguimiento (revisar `ai_usage_log` o un contador de prueba).
26. `serpapi-quote` para el mismo viaje abierto 10 veces en 24 h hace ≤1 consulta en vivo.
27. Un plan multiciudad con 7 ciudades se rechaza; uno con 4 cuenta como 2 análisis.
28. Cada llamada a Claude, Gemini, Perplexity o SerpApi deja una fila en `ai_usage_log` con su modelo y sus tokens.
29. La consulta de detección (b) marca una prueba como sospechosa al crear 4 pruebas desde la misma IP en 24 h, **sin bloquear** el plan GRATIS.
30. Los correos de confirmación llegan con 200 altas en una hora (Resend Pro activo).
