# IATOS Privé · Alianzas comerciales y costos unitarios

> Parte de la serie Privé. Etiquetas y reglas de lenguaje: [Calidad §4](IATOS_PRIVE_CALIDAD_FUENTES.md#4-lenguaje-permitido-y-prohibido). Tabla de acuerdos: [Modelo §3.2](IATOS_PRIVE_MODELO_DE_DATOS.md#32-acuerdos-comerciales-habilitan-las-etiquetas-partner--beneficio--acceso). Precios de proveedores: [IATOS_COSTOS_UNITARIOS.md](IATOS_COSTOS_UNITARIOS.md) (no se repiten aquí).

## Resumen para fundadores

- **Primero México.** Los primeros 10 socios saldrán de CDMX y Tulum, entre restaurantes, hoteles y operadores de experiencias **que ya estén verificados** en el catálogo. Nadie se vuelve socio sin antes pasar la curaduría.
- **Lo que IATOS ofrece:**
  - viajeros de alto poder adquisitivo que llegan con fecha, número de personas y preferencias;
  - un lugar destacado **marcado** "Socio IATOS";
  - solicitudes bien armadas;
  - un reporte mensual.
- **Lo que el socio ofrece:** respuesta rápida y confirmación con folio. Un beneficio real (copa de bienvenida, prioridad en su lista de espera) **solo si queda por escrito**.
- **Lo que nunca se vende:**
  - el orden de "Para ti", que siempre es personal;
  - el sello "Verificado";
  - la palabra "VIP" o "exclusivo".
- **Cobro:** los modelos están descritos, pero los montos quedan **a negociar**. Solo citamos rangos públicos de la industria, y casi ninguno se pudo confirmar en la página oficial.
- **Sin juego:** cero afiliados de apuestas.
- **Costo de Privé Digital por usuario PRO al mes:**
  - uso típico: **USD 0.02 a 0.04 (MXN 0.4 a 0.8)**;
  - uso pesado, con todo encendido: hasta **USD 0.29 (MXN 5.4)**;
  - frente a un neto de **MXN 76.35** por PRO.

  El costo fijo grande no es de APIs: es **la persona que verifica**, unas 8 horas a la semana.

---

## 1. Propuesta de valor para socios

1. **Viajeros calificados:**
   - los usuarios PRO pagan suscripción;
   - llegan con su Travel DNA (gustos, presupuesto, ritmo) y con un viaje activo de fechas conocidas;
   - la solicitud llega con fecha, hora, número de personas, preferencias y restricciones.
2. **Visitantes internacionales a México:** el catálogo es bilingüe (es/en) y la ficha explica dress code, edad, cómo llegar y el traslado desde el hotel.
3. **Sin ruido:** IATOS no publica reseñas ni calificaciones de usuarios. Solo datos verificables y premios con fuente. Eso protege la marca del socio.
4. **Datos de demanda:** el reporte muestra cuántas veces se vio la ficha, cuántas se guardó y cuántas solicitudes llegaron y se confirmaron (las métricas de `prive_events`).

## 2. Niveles de socio y etiquetas

| Nivel | Requisito | Etiqueta en la app | `commercial_status` | Qué cambia |
|---|---|---|---|---|
| **Curaduría** | Ninguno: IATOS lo eligió por su cuenta | Sin etiqueta, o "Reserva externa" si se reserva en su sitio o en una plataforma | `none` / `external_booking` | Nada. Es la mayoría del catálogo. |
| **Socio IATOS** | Acuerdo firmado y vigente | "Socio IATOS" | `partner` | Puede ocupar el espacio "Destacado · Socio IATOS" (máximo 1 por carril y por ciudad, siempre marcado). Solicitudes con un canal directo. Reporte mensual. |
| **Socio con beneficio** | Acuerdo con el beneficio definido por escrito | "Beneficio IATOS: <texto literal del contrato>" | `exclusive_benefit` | El texto del beneficio se copia del acuerdo, con sus condiciones |
| **Acceso confirmado** (futuro, Signature) | Acuerdo con un cupo real o un acceso garantizado por escrito | "Acceso confirmado" | `access_confirmed` | Solo con Privé Signature encendido |

**Reglas de integridad (comprobadas con CHECK y pruebas):**
- Sin acuerdo no hay etiqueta. Cuando el acuerdo vence, la etiqueta cae sola.
- **Ser socio no sube la puntuación de "Para ti"** ni cambia el estado de los datos.
- El espacio "Destacado" es distinto y siempre está marcado.

## 3. Modelos de cobro

| Modelo | Cómo funciona | Monto | Referencia pública |
|---|---|---|---|
| A. Sin cobro (curaduría) | IATOS gana por la suscripción PRO | — | — |
| B. Cuota fija mensual por "Destacado · Socio IATOS" y el reporte | Mensual, sin permanencia mínima en el piloto | **A negociar** | No encontramos una referencia pública confiable para México |
| C. Tarifa por comensal o persona **confirmada** | Se cobra solo por solicitudes con estado `confirmado_externamente` | **A negociar** | OpenTable cobra por comensal de su red. Terceros reportan USD 1.00 a 1.50 por comensal según el plan, en EE. UU. y en 2026 ([eatapp.co](https://restaurant.eatapp.co/blog/opentable-pricing)). **NO CONFIRMADO:** la página oficial (opentable.com/restaurant-solutions/pricing) respondió 503 el 2026-10-22. |
| D. Comisión sobre experiencias vendidas (operadores) | Porcentaje del precio de una experiencia **reservada y pagada** | **A negociar** | GetYourGuide: su página oficial dice que la tarifa "varía según el país" y se comunica al registrarse ([getyourguide.supply](https://www.getyourguide.supply/join/how-much-does-getyourguide-charge), VERIFICADO 2026-10-22, sin porcentaje). Terceros reportan 20–30% para GetYourGuide y 20–35% para Viator ([magpie.travel](https://about.magpie.travel/how-to-work-with/get-your-guide), [magpie.travel](https://about.magpie.travel/how-to-work-with/tripadvisor)). **NO CONFIRMADO** en las páginas oficiales. |
| E. Hoteles | Comisión por noche confirmada o cuota fija | **A negociar** | No pudimos abrir la página oficial de comisiones de Booking.com (403). Sin cifra citada. |

**Recomendación para el piloto:**
- **C** con restaurantes y bares, y **D** con operadores, ambos a tarifa de lanzamiento por negociar.
- **B** solo después de tener 3 meses de reportes.
- En todos los casos hay que facturar con **CFDI** y con IVA, y definir quién emite y quién recibe.

## 4. Checklist de acuerdo (una página)

| # | Punto | Qué debe decir |
|---|---|---|
| 1 | Partes | Razón social, RFC, representante legal, domicilio fiscal |
| 2 | Vigencia | Fecha de inicio y de fin (sugerido: 6 meses en el piloto), renovación expresa, terminación anticipada con 30 días de aviso |
| 3 | Nivel | Socio IATOS / con beneficio / (futuro) acceso confirmado |
| 4 | Beneficio | Texto **literal** que se publicará; para cuántas personas; días y horas; exclusiones; qué pasa si el lugar no puede darlo esa noche |
| 5 | Disponibilidad | El socio no garantiza un cupo salvo que se diga. Tiempo máximo de respuesta a una solicitud (sugerido: 24 h). Confirmación con folio. |
| 6 | Cancelación y no presentación | La política del socio, publicada tal cual en la ficha. Quién absorbe un cargo por no presentarse. |
| 7 | Precios | Si el socio publica precios: con fecha y moneda. IATOS no los cambia. |
| 8 | Datos personales (LFPDPPP 2025) | El socio recibe solo nombre, fecha, personas, preferencias y contacto para atender la solicitud. Prohibido usarlos para mercadotecnia sin el consentimiento del usuario. Plazo de conservación, aviso de privacidad, medidas de seguridad, aviso de incidentes en 72 h [SUPUESTO: plazo a definir con un abogado]. |
| 9 | Pago y facturación | Modelo (B, C, D o E), monto, periodicidad, CFDI 4.0, IVA, cuenta, conciliación mensual contra `confirmado_externamente` |
| 10 | Uso de marca | Licencia limitada de nombre y logo para la ficha y el reporte. IATOS no usa fotos del socio sin una licencia escrita. Sin "VIP" ni "exclusivo" salvo que sea verdad y esté documentado. |
| 11 | Publicidad veraz (PROFECO, art. 32 LFPC) | El socio garantiza que su información es cierta. IATOS puede retirar la etiqueta si no lo es. |
| 12 | Alcohol, edad y juego | El socio cumple la edad legal. Nada de promociones de consumo. Ningún contenido de apuestas. |
| 13 | Reporte | Contenido y fecha del reporte mensual |
| 14 | Confidencialidad y legislación | Leyes y tribunales de CDMX [SUPUESTO] |

## 5. Plan de acercamiento: primeros 10 socios (CDMX y Tulum)

**Criterios de selección** (deben cumplirse todos):
1. Estado **VERIFICADO** en el catálogo.
2. Canal oficial de reservas que funcione.
3. Atención en inglés.
4. Encaja con la demanda (de `prive_events`: fichas abiertas y guardadas en el piloto).
5. Sin quejas públicas graves recientes.

**Mezcla objetivo:**
- CDMX: 4 restaurantes o barras (The Table), 2 bares o coctelerías (After Dark) y 1 operador de experiencias (Signature Mexico: mercados, mezcal, arte).
- Tulum: 2 restaurantes y 1 operador (cenotes o naturaleza con permisos).

**Ejemplos de perfil** [SUPUESTO: lista para validar en la curaduría; sin contacto previo y sin afirmar premios aquí]:
- CDMX: restaurantes de autor de Roma Norte, Polanco y Juárez que aparezcan en guías con premio; coctelerías de la Juárez en listas 50 Best; operadores de recorridos gastronómicos con permisos.
- Tulum: restaurantes de cocina con leña de la zona hotelera; operadores de cenotes con registro ante la autoridad ambiental o turística correspondiente.

Los nombres concretos saldrán de `content_g1…g4.json` cuando estén cargados y verificados.

| Semana | Actividad | Entregable |
|---|---|---|
| 1 | Elegir 20 candidatos con los criterios y el reporte de demanda | Lista priorizada |
| 2 | Primer correo (plantilla abajo) y seguimiento por teléfono o redes oficiales | 20 contactos |
| 3–4 | Reuniones de 30 min: demo de la ficha y del flujo de solicitud | ≥ 8 reuniones |
| 5–6 | Acuerdos piloto (checklist §4); carga del acuerdo y de las etiquetas | 3–5 firmados |
| 7–10 | Operación, primer reporte mensual, ajustes | Reporte y decisión de escalar |

**Indicadores del piloto:**
- tasa de respuesta del socio ≤ 24 h: ≥ 90%;
- solicitudes → confirmadas: ≥ 50% [SUPUESTO, meta inicial];
- 0 quejas por beneficios no entregados.

### 5.1 Plantilla de correo

> **Asunto:** IATOS Privé · Invitación a formar parte de nuestra selección en {Ciudad}
>
> Hola, {Nombre}:
>
> Soy {Remitente}, de IATOS, una app de viajes con un concierge de inteligencia artificial para viajeros que planean con cuidado. En **IATOS Privé** seleccionamos experiencias en {Ciudad} con información verificable, y **{Lugar}** ya forma parte de esa selección por {hecho verificable, p. ej. "su menú de temporada con producto de la milpa"}.
>
> Nos gustaría platicar sobre una colaboración sencilla:
> - nuestros usuarios llegan con fecha, número de personas y preferencias, y les enviamos la solicitud lista para confirmar;
> - su ficha aparece con la etiqueta "Socio IATOS" y recibe un reporte mensual de visitas y solicitudes;
> - si ustedes lo desean, pueden ofrecer un detalle de bienvenida. Solo lo publicaríamos con el texto exacto que acordemos por escrito.
>
> No pedimos exclusividad ni descuentos. Nunca publicamos beneficios, precios ni disponibilidad que ustedes no hayan confirmado.
>
> ¿Tendría 30 minutos la próxima semana para mostrarle cómo se ve? Puedo adaptarme a su horario.
>
> Saludos cordiales,
> {Remitente} · IATOS · {correo} · {teléfono}
>
> *Tratamos los datos de contacto conforme a nuestro aviso de privacidad: {URL}. Si prefiere no recibir más mensajes, responda "baja".*

## 6. Afiliados legales (sin juego)

**Programas que ya existen en `src/lib/affiliateLinks.ts`:**
- experiencias: GetYourGuide (`getYourGuideLink`), Viator (`viatorLink`);
- traslados: Welcome Pickups (`welcomePickupsLink`, Travelpayouts);
- estancias: Booking (`bookingLink`), Hotellook (`hotellookLink`);
- mesas: OpenTable (`openTableLink`), TheFork (`theforkLink`).

**Uso en Privé:**
- Solo como **"Reserva externa"** en `yacht_sea`, `adventure_elite`, `culture_access` y `private_stays`, cuando ese canal es el oficial o el principal del operador.
- Se registra el clic en `affiliate_clicks` (`proveedor`, `accion='prive_external'`).
- Antes de mostrar un enlace de afiliado deben pasar las pruebas T-87 (iPhone) y T-88 (atribución). Mientras IATOS-077 no se cierre, **no se afirma** que haya comisión.
- `openTableLink` y `theforkLink` son búsquedas. Para una ficha se prefiere `booking_url`, el enlace oficial del lugar.

**Prohibido:**
- afiliados de casinos, apuestas o *sportsbooks*;
- bonos de depósito;
- "códigos" de juego.

La prueba T-58 lo revisa.

## 7. Costos unitarios por ciudad y por usuario

Los precios de cada proveedor están en [IATOS_COSTOS_UNITARIOS.md](IATOS_COSTOS_UNITARIOS.md) (§1.2 y §1.3), consultados el 2026-10-22. Aquí solo se aplican.

### 7.1 Imágenes: comparación y decisión

| Opción | Costo | Condiciones | Decisión |
|---|---|---|---|
| **Pexels** (vía `pexels-image`) | **USD 0** | 200 solicitudes por hora y 20,000 al mes, **compartidas** con `buscar-video`. Foto genérica: se marca "ilustrativa" con crédito. | **Elegida por el dueño (2026-10-22)** |
| Google Places Photo (`place-photo`) | USD 7 por mil pasando las 1,000 gratis, más una Place Details por foto para obtener su nombre (USD 17 por mil pasando las 5,000) | Google pide mostrar `authorAttributions` (`place-photo` no las devuelve hoy). Los nombres de foto vencen: hay que pedirlos cada vez. | Fuera del plan |
| Wikimedia Commons | USD 0 | Licencias CC con atribución (y, en CC BY-SA, compartir igual). Hay pocas fotos de restaurantes y bares. | Fuera del plan |

**Volumen de Pexels:**
- unas 586 imágenes (550 experiencias + 36 portadas), guardadas en la fila y refrescadas cada 90 días;
- eso son **~200 solicitudes al mes**, el 1% de la cuota mensual.

**Riesgo:** `buscar-video` ya usa ~87 llamadas por usuario al día. Privé no usa video y precalienta a ≤ 100 por hora.

### 7.2 Por ciudad y por mes (operación del catálogo)

| Concepto | Cálculo | USD por ciudad al mes |
|---|---|---|
| Fotos (Pexels) | ~16 cada 90 días | 0 |
| Coordenadas | Nominatim (gratis) al curar; `google_place_id` con 1 Text Search por lugar, una sola vez (~15) | 0 (dentro de 5,000 gratis al mes); peor caso USD 0.48 **una vez** |
| Estado abierto / cerrado | 1 `place-details` mensual por lugar (~15), con una máscara mínima (`id,businessStatus`) en lugar de la máscara actual, que pide reseñas y horarios | 0 dentro de las gratis; peor caso 15 × 0.017 = **USD 0.26** [SUPUESTO: la categoría exacta depende de los campos; verificar en la tabla de Google] |
| Revisión de enlaces | HEAD/GET semanales | 0 |
| Intro del editor (IA, una vez) y traducciones | ~36 textos de 2 líneas, con revisión humana | < USD 0.01 una vez |
| **Total APIs** | | **USD 0 a 0.26 por ciudad al mes**. Con 36 ciudades: USD 0 a 9.4 al mes. |
| Persona curadora (costo fijo) | ~8 h a la semana para 550 fichas + 6 h por oleada | Lo define el dueño [SUPUESTO] |

### 7.3 Por usuario PRO al mes (Privé Digital)

Precios de Gemini 3.8 Flash (USD 0.75 / 3.75 por millón de tokens; **doble desde el 1-ene-2027**), del archivo de costos.

| Concepto | Típico | Pesado | Cálculo |
|---|---|---|---|
| "Por qué para ti" (`prive-why`, con caché de 30 días) | 10 generaciones | 40 | ~1,200 tokens de entrada + 120 de salida ≈ USD 0.00135 cada una (0.0027 en 2027) |
| `search_prive` dentro del chat (el mensaje ya cuenta en la cuota de Iato) | 5 preguntas | 15 | +2,500 tokens de entrada por resultado ≈ USD 0.0019 (0.0038 en 2027) |
| Traslado exacto (`get-routes`) | 3 | 10 | Gratis hasta 10,000 al mes en todo el sistema; si no, USD 0.005 |
| Fotos | 0 llamadas nuevas (URL guardada) | 0 | USD 0 |
| Descubrimiento bajo demanda (**apagado** por omisión) | 0 | 5 | USD 0.015 por búsqueda de SerpApi sin caché |
| **Total 2026** | **≈ USD 0.023 (MXN 0.43)** | **≈ USD 0.21 (MXN 3.9)** | Típico: 10×0.00135 + 5×0.0019. Pesado: 40×0.00135 + 15×0.0019 + 10×0.005 + 5×0.015. |
| **Total 2027** (precio de Gemini doble) | **≈ USD 0.046 (MXN 0.85)** | **≈ USD 0.29 (MXN 5.4)** | |

**Contra el neto de MXN 76.35** por PRO ([IATOS_PROPUESTA_PLANES_Y_PRUEBA.md §1](IATOS_PROPUESTA_PLANES_Y_PRUEBA.md)):
- típico: **0.6% a 1.1%**;
- pesado: **5.1% a 7.1%**.

Cabe dentro de los $99 MXN. Para mantener el tope, `plan_limits` agrega `prive_why` (sugerido: PRO 60 al mes y prueba 20, suave) y `prive_discovery` (PRO 5 al mes y prueba 2, duro) [SUPUESTO: valores que debe aprobar el dueño].

### 7.4 Privé Signature (futuro)

- Tiene precio y condiciones propios. **No existe como producto en Stripe** ni como derecho activo (`prive_signature_enabled = false`, `prive_signature_access()` = false).
- Su costo principal será humano (gestión de reservas, relación con socios), no de APIs. Se modelará cuando haya acuerdos reales.
- Hasta entonces, no hay ningún texto que lo prometa, y como mucho aparece "Próximamente · Solicitar información" ([UX §2](IATOS_PRIVE_UX.md#2-home)).
