# IATOS AI — Costo unitario por operación

**Para quién:** los dos fundadores, para aprobar los límites de los planes y la prueba de 30 días.
**Fecha:** 22 de octubre de 2026.
**Código revisado:** rama `claude/iatos-world-class`, en solo lectura, hacia las 02:26 UTC.

> **Aviso.** Otra persona estaba cambiando la rama mientras se hacía este análisis. `concierge-chat` se reorganizó en varios archivos a las 02:21 UTC. Las citas `archivo:línea` corresponden a lo que había a las 02:26 UTC. Si el código vuelve a cambiar, los números de línea pueden moverse, pero la lógica de costo debería seguir igual.

Documento hermano, con los límites recomendados, el diseño de la prueba y las pruebas de aceptación: [`IATOS_PROPUESTA_PLANES_Y_PRUEBA.md`](./IATOS_PROPUESTA_PLANES_Y_PRUEBA.md).

---

## 0. Cómo leer este documento

Cada número lleva una etiqueta:

| Etiqueta | Qué significa |
|---|---|
| **[MEDIDO]** | Sale del código (se cita `archivo:línea`) o de datos de producción que nos dieron. |
| **[PRECIO PÚBLICO]** | Precio publicado por el proveedor. Se citan la URL y la fecha de consulta. |
| **[SUPUESTO]** | Estimación nuestra. No está medida y puede estar mal. Se explica cómo se calculó. |

- **Tipo de cambio:** 1 USD = **18.4823 MXN**. Es el tipo de referencia del BCE publicado por Frankfurter para el 2026-10-21 (https://api.frankfurter.dev/v1/latest?from=USD&to=MXN, consultado el 2026-10-22). [PRECIO PÚBLICO] Es la misma fuente que usa el código (`analizar-viaje/index.ts:53`). Si esa consulta falla, el código usa 20.5 (`analizar-viaje/index.ts:45`).
- **Tokens.** Calculamos los tokens a partir de caracteres: **3.5 caracteres por token** para JSON y texto en español. Es un poco más conservador que 4. [SUPUESTO]
- **SerpApi.** Para pasar a pesos usamos **USD 0.015 por búsqueda** (plan Developer usado completo). La sección 1.3 muestra los demás planes.

---

## 1. Precios públicos usados

### 1.1 Modelos de IA

| Proveedor / modelo | Entrada (USD por millón de tokens) | Salida (USD por millón de tokens) | Notas | Fuente (consultada 2026-10-22) |
|---|---|---|---|---|
| Anthropic **Claude Sonnet 5.5** (`claude-sonnet-5-5`) | $2.00 | $10.00 | Lectura de caché: $0.10. Escritura de caché a 5 min: $2.50. El razonamiento ("thinking") se cobra como salida: el campo `usage.output_tokens_details.thinking_tokens` dice cuántos de los tokens de salida cobrados fueron razonamiento. Usar herramientas suma 286 tokens de entrada por llamada. | https://platform.claude.com/docs/en/about-claude/pricing · https://platform.claude.com/docs/en/build-with-claude/extended-thinking [PRECIO PÚBLICO] |
| Google **Gemini 3.8 Flash** (el Flash más nuevo que lista Google) | $0.75 hasta el 31-dic-2026; **$1.50 desde el 1-ene-2027** | $3.75; **$7.50 desde 2027** | Tiene nivel gratuito. Google **no publica** a qué modelo apunta `gemini-flash-latest`. | https://ai.google.dev/gemini-api/docs/pricing [PRECIO PÚBLICO] |
| Google **Gemini 2.5 Flash** | $0.30 | $2.50 | Google dice que se sigue sirviendo "hasta nuevo aviso", pero solo a cuentas que ya lo usaban. | https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/docs/models [PRECIO PÚBLICO] |
| Google **Gemini 2.5 Pro** | $1.25 (hasta 200 mil tokens) | $10.00 | Se usa en multiciudad, edición con IA, lista de equipaje y evolución del DNA. | ídem [PRECIO PÚBLICO] |
| Google **Gemini 3 Flash Preview** | $0.50 | $3.00 | Se usa para elegir fechas y en preferencias de ruta. | ídem [PRECIO PÚBLICO] |
| Google **Gemini 2.5 Flash Image** ("Nano Banana") | — | **USD 0.039 por imagen** | Sin nivel gratuito. **Google lo anunció como retirado el 2-oct-2026.** | ídem [PRECIO PÚBLICO] |
| Lovable AI Gateway (respaldo) | "basado en el costo del proveedor" | — | Cada espacio de trabajo recibe 4 créditos al mes para IA. No hay tarifa por token publicada. Cuando se acaban los créditos responde 402. | https://docs.lovable.dev/integrations/ai [PRECIO PÚBLICO, sin tarifa exacta] |
| Perplexity **sonar-pro** | $3 | $15 | Más una cuota de USD 6, 10 o 14 por cada mil solicitudes, según el contexto de búsqueda. **No lo pudimos confirmar en la página oficial**, que hoy no lista sonar. | https://amnic.com/blogs/perplexity-api-pricing (fuente de terceros) [PRECIO PÚBLICO NO CONFIRMADO: rango] |
| Perplexity **sonar** | ~$1 | ~$1 | Más una cuota de USD 5 a 12 por cada mil solicitudes. | ídem [NO CONFIRMADO: rango] |

### 1.2 Otros servicios

| Servicio | Precio | Fuente (consultada 2026-10-22) |
|---|---|---|
| **SerpApi** | Ver la tabla 1.3. Las búsquedas **en caché, con error o fallidas no cuentan** para el límite mensual. | https://serpapi.com/pricing [PRECIO PÚBLICO] |
| SerpApi, caché | Una búsqueda con exactamente los mismos parámetros se sirve desde caché durante **1 hora** y no se cobra, salvo que se mande `no_cache=true`. | https://deno.land/x/serpapi@1.1.1/src/types.ts?source (documentación del SDK) [PRECIO PÚBLICO: verificar en el panel] |
| **Travelpayouts / Aviasales** (`prices_for_dates`, autocompletado) | Gratis. Es un programa de afiliados: IATOS cobra comisión, no paga. | sin tarifa publicada [SUPUESTO: costo 0] |
| **TripAdvisor Content API** | La API anterior daba ~5,000 llamadas gratis al mes y después cobraba por uso. Fuentes de terceros dicen que **se retiró el 31-ago-2026** y que la reemplazó "Terra API", con 1,000 llamadas gratis. La tarifa por llamada no se publica. | https://supergood.ai/api-report-card/tripadvisor-api · https://vorplabs.com/agent-tools/tripadvisor-content-api [NO CONFIRMADO] |
| **Google Maps Platform** (vía el conector de Lovable) | Nearby Search Pro: $32 por cada mil (5,000 gratis al mes). Text Search Pro: $32 por cada mil (5,000 gratis). Place Details Pro: $17 por cada mil (5,000 gratis). Place Photos: $7 por cada mil (1,000 gratis). Geocoding: $5 por cada mil (10,000 gratis). Compute Routes: $5 por cada mil (10,000 gratis). Mapas dinámicos (JS): $7 por cada mil (10,000 gratis). | https://developers.google.com/maps/billing-and-pricing/pricing [PRECIO PÚBLICO] |
| Conector Google Maps de Lovable | Google le cobra a la cuenta de facturación, no Lovable. Además hay un **límite de 6,000 solicitudes de servidor cada 24 h por espacio de trabajo y por tipo de conexión**. | https://docs.lovable.dev/integrations/google-maps [PRECIO PÚBLICO] |
| **Pexels** (fotos y videos) | Gratis. **Límite: 200 solicitudes por hora y 20,000 al mes.** Se puede pedir más. | https://www.pexels.com/api/documentation/ [PRECIO PÚBLICO] |
| **Resend** (correo) | Gratis: 3,000 al mes y **100 al día**. Pro: USD 20 al mes por 50,000. | https://resend.com/pricing [PRECIO PÚBLICO] |
| **Stripe México** | Tarjeta nacional: **3.6% + MXN 3.00**. Internacional: +0.5%. Conversión de moneda: +2%. **Comisiones sin IVA.** Stripe Billing: 0.7%. Stripe Tax: 0.5% por transacción. | https://stripe.com/mx/pricing [PRECIO PÚBLICO] |
| **Supabase** (Lovable Cloud lo administra) | Plan Pro: USD 25, incluye 2 millones de invocaciones de funciones y después USD 2 por millón. | https://supabase.com/pricing [PRECIO PÚBLICO] |
| **Lovable** | Gratis: 20 créditos de Cloud y 4 de IA al mes. Pro: ~USD 25 al mes por 100 créditos (fuentes de terceros). | https://lovable.dev/pricing · https://eesel.ai/blog/lovable-pricing [PARCIAL] |
| **Cloudflare Turnstile** | Gratis: retos ilimitados, hasta 20 widgets. | https://developers.cloudflare.com/turnstile/plans/ [PRECIO PÚBLICO] |
| **Twilio Verify** (si algún día se verifica teléfono) | USD 0.05 por verificación exitosa, más el SMS (la tarifa de México no aparece en esa página). | https://www.twilio.com/en-us/verify/pricing [PRECIO PÚBLICO, falta la tarifa de México] |
| **IVA en México** | 16%. | Ley del IVA [PRECIO PÚBLICO] |

### 1.3 SerpApi: costo por búsqueda según el plan

[PRECIO PÚBLICO] https://serpapi.com/pricing, consultado el 2026-10-22.

| Plan | USD al mes | Búsquedas al mes | Máximo por hora | USD por búsqueda (plan usado completo) | MXN por búsqueda |
|---|---|---|---|---|---|
| Free | 0 | 250 | 50 | 0 | 0 |
| Starter | 25 | 1,000 | 200 | 0.0250 | 0.46 |
| **Developer** (el que usamos en los cálculos) | 75 | 5,000 | 1,000 | **0.0150** | **0.28** |
| Production | 150 | 15,000 | 3,000 | 0.0100 | 0.18 |
| Big Data | 275 | 30,000 | 6,000 | 0.0092 | 0.17 |
| Searcher | 725 | 100,000 | 20,000 | 0.0073 | 0.13 |

El costo real de SerpApi **es un plan fijo**. Cada búsqueda extra no cuesta nada hasta que se agota el plan, y ahí hay que subir al siguiente. Por eso el número que importa es **cuántas búsquedas al mes** consume cada tipo de usuario.

Según la auditoría (`IATOS_AUDITORIA_BASELINE.md:105`), hoy quedan **~216 búsquedas** [MEDIDO]. No sabemos qué plan está contratado.

---

## 2. Qué llama cada operación (medido en el código)

### 2.1 Análisis completo de viaje (`supabase/functions/analizar-viaje/index.ts`)

**Orden de ejecución:**

1. **Límite de ritmo:** 3 por minuto, 20 por hora y 10 por minuto desde la misma IP (`:642-645`).
2. **Cuota:** `consumeQuota(user, "trip_analysis")` (`:658`). **Se descuenta ANTES de llamar a cualquier proveedor.** Si algo falla después, la oportunidad gratuita ya se gastó: 502 en `:988` y `:996`, 503 por falta de precios en `:1053`, 500 en `:1097` y `:1151`. Para usuarios PRO hoy **no hay ningún límite**: `consume_free_quota` responde "pro" y deja pasar todo (`migrations/20261022130000_pay_stripe_sync_and_atomic_quota.sql`, sección 3).
3. **Fechas faltantes:** `resolver-fechas` con Gemini 3 Flash Preview, solo si el usuario no dio fechas (`:729`; `resolver-fechas/index.ts:80`).
4. **En paralelo** (`:744-817`):

| Llamada | Proveedor | Búsquedas o llamadas | Cita |
|---|---|---|---|
| Perplexity `sonar-pro` | Perplexity | 1 llamada, `max_tokens: 4000`, pregunta de ~3,483 caracteres. **Solo si existe `PERPLEXITY_API_KEY`**: el chequeo de salud no confirma que esa llave exista. | `:433-517`, `:494`, `:504`; `IATOS_AUDITORIA_BASELINE.md:102` |
| `travelpayouts-flights` | Travelpayouts | 1 o 2 llamadas (fechas exactas y, si no hay, el mes) más autocompletado. **Gratis.** | `:744-759`; `travelpayouts-flights/index.ts:95-102` |
| `hotels-search` | SerpApi `google_hotels` | **1 o 2 búsquedas**: una con la preferencia del usuario y otra si salen menos de 3 hoteles. | `:762-776`; `hotels-search/index.ts:113-114` |
| `flights-search` | SerpApi `google_flights` | **1 búsqueda**, más 0 a 2 llamadas mínimas a Gemini Flash-Lite para el código IATA. | `:780-795`; `flights-search/index.ts:112-147` |
| `tripadvisor-search` | TripAdvisor (1 búsqueda + 5 detalles + 5 fotos = 11 llamadas) **o**, si falla, SerpApi `google_maps` (**1 búsqueda**) | 0 o 1 búsqueda de SerpApi | `:797-809`; `tripadvisor-search/index.ts:82-139` |

5. **Claude Sonnet 5.5** (`:961-968`, `:519-560`):
   - `max_tokens: 16000`;
   - `thinking: {type: "between_tools"}`: sin razonamiento extendido; solo podría razonar entre herramientas, y aquí hay una sola llamada;
   - `output_config.effort: "medium"`;
   - `fallbacks: "default"`: si Claude se niega por política, el servidor reintenta en otro modelo y cobra a la tarifa de ese modelo;
   - una herramienta con esquema (`TOOL_SCHEMA`, `:287-431`);
   - `tool_choice: auto`.
6. **Respaldo:** si Claude no responde con la herramienta, se usa Gemini (`google/gemini-2.5-flash` → `gemini-flash-latest` → Lovable) con el mismo prompt (`:983-994`, `:562-607`; `_shared/ai.ts:44-75`). Si esto pasa, **se pagan los dos modelos**.
7. **Correo** con la cotización (`:1104-1123`), con Resend.

**Tamaño estimado de la llamada a Claude.** Los caracteres del código están [MEDIDOS] con `wc -c`; el resto es [SUPUESTO].

| Bloque | Caracteres | Etiqueta |
|---|---|---|
| Prompt del sistema (`buildSystemPrompt`, `:203-285`) | 9,192 | MEDIDO |
| Contexto del usuario más instrucción final | ~700 | SUPUESTO |
| `MASTER_PROMPT_IATOS` (variable de entorno, no visible) | 0 a 8,000 | SUPUESTO |
| Esquema de la herramienta (`:287-431`, sin espacios repetidos) | 5,794 | MEDIDO |
| Plantilla del prompt del usuario (`:893-957`) | 5,047 | MEDIDO |
| Perfil y bóveda insertados | ~1,300 | SUPUESTO |
| Vuelos Aviasales (12 líneas, `:850`) + Google Flights (10, `:859`) + hoteles (12, `:872`) + atracciones (10, `:884`) | ~10,300 | SUPUESTO (líneas medidas × ~240 caracteres) |
| Texto de Perplexity más citas (solo si hay llave) | 0 a ~14,000 | SUPUESTO (hasta 4,000 tokens de salida de sonar-pro) |
| **Entrada total** | **~32,000 a 54,000 caracteres → ~9,500 a 15,500 tokens** | SUPUESTO |

| Salida | Valor | Etiqueta |
|---|---|---|
| Un viaje completo guardado en producción | **22,090 caracteres** en promedio (25 viajes): itinerario 10,133, vuelos 2,073, hospedaje 2,209, análisis 756 | MEDIDO (dato de producción) |
| JSON que entrega la herramienta | ~20,500 caracteres → **~5,900 a 6,800 tokens**, más o menos 200 de preámbulo. Usamos **6,200 típico**, 4,500 bajo, 9,000 alto y 16,000 como tope de `max_tokens`. | SUPUESTO |
| Razonamiento | ~0, por `between_tools` con una sola herramienta | SUPUESTO |

### 2.2 Plan multiciudad (`supabase/functions/logistics-plan/index.ts`)

- **Cuota:** consume la misma cuota que el análisis (`:381`). El límite de ritmo es de 8 por minuto y 60 por hora (`:357`).
- **No hay tope de ciudades:** solo se exige al menos una (`:370`). [MEDIDO]
- **Por cada ciudad** (`:474-491`): un `hotels-search` (1 o 2 búsquedas en SerpApi) y un `tripadvisor-search` (0 o 1 en SerpApi). Más un `travelpayouts-flights` (gratis).
- **IA:** `google/gemini-2.5-pro` (`:42`), una llamada global más una por ciudad, con salida forzada a una función (`:44-62`, `:597-603`). Si 2.5 Pro falla, `aiFetch` cae a `gemini-flash-latest`.
- **Tokens:** ~3,500 de entrada y ~3,500 de salida (con razonamiento) por ciudad, y ~5,000 de entrada y 4,500 de salida en la llamada global. [SUPUESTO]

### 2.3 Mensaje de Iato (`supabase/functions/concierge-chat/`)

| Paso | Detalle | Cita |
|---|---|---|
| Límite de ritmo | 10 por minuto y 120 por hora | `index.ts:221` |
| Cuota | 3 al mes para gratis; **PRO ilimitado**. Se descuenta antes de llamar al modelo, así que un error 502 del modelo gasta el mensaje. | `index.ts:233`; `_shared/quota.ts:99-102` |
| Modelo | `google/gemini-2.5-flash` → Gemini directo; si responde 404, cae a `gemini-flash-latest` y luego a Lovable. El comentario del código dice que los nombres fijos "se retiran y devuelven 404", así que **en producción probablemente corre `gemini-flash-latest`**. | `index.ts:404-409`; `_shared/ai.ts:17-19, 51-74` |
| Vueltas | **Hasta 4 llamadas al modelo**; la última obliga a responder sin herramientas | `loop.ts:17, 28-36` |
| Herramientas por vuelta | **Sin tope**: todas las que pida el modelo, en paralelo, con 15 s de límite cada una | `loop.ts:36`; `tools.ts:95, 123-139` |
| Tamaño de cada resultado de herramienta | Máximo ~6,000 caracteres | `tools.ts:61`; `cards.ts:119` |
| Contexto que se reenvía en **cada** vuelta | Reglas del sistema (~8,500 caracteres, `prompt.ts:1-97`) + `MASTER_PROMPT_IATOS` + definición de 5 herramientas (~3,100) + perfil + lista de viajes vigentes (hasta 25, `index.ts:247`) + **el viaje en contexto completo** (~22,000 caracteres si fue analizado) + memoria (resumen de hasta 2,000 caracteres y 10 turnos de hasta 800, `prompt.ts:145-165`) + historial del cliente | MEDIDO (tamaños de código) / SUPUESTO (tamaño de datos) |
| Resumen de memoria | Solo cuando hay más de 30 turnos; usa Gemini 2.5 Flash-Lite y es mínimo | `index.ts:451-460` |
| Herramientas → proveedor | `search_flights` → SerpApi, 1 búsqueda. `search_hotels` → SerpApi, 1 o 2. `search_attractions` → TripAdvisor o SerpApi Maps. `search_nearby` → **Google Places Nearby, $0.032** pasando las 5,000 gratis, con SerpApi de respaldo. `check_flight_status` → SerpApi `google`, 1 búsqueda (o Perplexity `sonar` de respaldo) | `index.ts:125-129`; `flight-status/index.ts:36-89`; `places-nearby/index.ts:105-146` |

Datos de producción: 4 conversaciones con 2 mensajes en promedio y 654 caracteres guardados [MEDIDO]. **Son muy pocos para concluir algo**, así que modelamos tres casos típicos:

| Caso | Llamadas al modelo | Tokens de entrada (total) | Tokens de salida (con razonamiento) | Búsquedas SerpApi |
|---|---|---|---|---|
| Solo conversación (con viaje analizado en contexto) | 1 | ~11,000 | ~1,300 | 0 |
| Conversación sin viaje en contexto | 1 | ~4,900 | ~1,000 | 0 |
| Con 1 búsqueda de vuelos | 2 | ~23,700 | ~2,400 | 1 |
| Con vuelos y hotel (en paralelo) | 2 | ~25,400 | ~2,600 | 2 o 3 |
| Peor caso actual (3 vueltas × 3 herramientas, memoria llena) | 4 | ~97,000 | ~6,000 | ~9 |

Todo es [SUPUESTO] sobre tamaños medidos. Gemini 2.5 Flash y 3.x razonan por defecto, y ese razonamiento se cobra como salida: estimamos de 300 a 1,500 tokens por llamada.

### 2.4 Alerta de precio (`price-watch` y `price-watch-cron`)

- **Al crearla:** se resuelve el código IATA y se consulta `cheapestFare` una vez: 0 o 1 búsqueda (`price-watch/index.ts`, función `cheapestFare`).
- **Frecuencia:** 2 corridas al día, a las 03:17 y 15:17 UTC (`docs/ops/programar-tareas.sql:53`). **Cada corrida revisa como máximo 40 alertas** (`price-watch-cron/index.ts:16, 39`), así que **en todo el sistema hay como máximo 80 revisiones al día**. [MEDIDO]
- **Por revisión** (`_shared/travelpayouts.ts:131-145`): primero Travelpayouts (gratis). SerpApi `google_flights` (1 búsqueda) solo si Travelpayouts no tiene la fecha exacta o si el precio base vino de Google Flights. Dentro de una misma corrida se reutilizan rutas iguales (`price-watch-cron/index.ts:43-56`). Como las corridas van con 12 h de diferencia, **la caché de 1 h de SerpApi no ayuda**.
- **Límite por usuario:** hoy **no hay ninguno**, ni se exige PRO (`price-watch/index.ts:30-114`). Solo hay una alerta por viaje (`onConflict: "trip_id"`). [MEDIDO]

### 2.5 Seguimiento de vuelo (`track-flight` y `flight-watch-cron`)

- **Tope por usuario:** `MAX_ACTIVE_PER_USER = 10`, **igual para todos** (`track-flight/rules.ts:4`; `track-flight/index.ts:46-48`). [MEDIDO]
- **Frecuencia:** el cron corre cada 15 minutos (`programar-tareas.sql:82`). Revisa hasta 50 vuelos por corrida, 5 a la vez (`flight-watch-cron/runner.ts:35`). Una revisión es 1 búsqueda de SerpApi `engine=google` (`_shared/flight-serpapi.ts:95-101`).
- **Cuándo se vuelve a revisar** (`migrations/20261022132000_ops_flight_watch_reliability.sql:44-61`). Es el mismo diseño que en `/home/user/wt-ops`:

| Fecha del vuelo | Cada cuánto |
|---|---|
| A más de 3 días | Cada 6 h |
| A 2 o 3 días | Cada 3 h |
| Del día anterior al día siguiente | En cada corrida (cada 15 min). Si se sabe que sale en más de 6 h, cada hora. |
| Después de 3 fallas seguidas | Al menos cada 30 min |
| Después de 6 fallas seguidas | Al menos cada hora |
| 3 h después de aterrizar | Se apaga |

- **Hallazgo:** el código **no manda `no_cache`**. Por la caché de 1 h de SerpApi, las revisiones de cada 15 min probablemente **no se cobran**: SerpApi devuelve el resultado guardado. Eso también quiere decir que **los datos pueden tener hasta 1 hora de antigüedad**: el "cada 15 min" no da información más fresca. [SUPUESTO basado en la documentación de SerpApi; confirmar en el panel de SerpApi]

**Búsquedas cobradas por vuelo, con la frecuencia actual** [SUPUESTO; se asume máximo 1 cobrada por hora]:

| Si el vuelo se agrega… | Búsquedas cobradas | Costo (plan Developer) |
|---|---|---|
| 7 días antes | ~16 + 16 + ~48 ≈ **80** | USD 1.20 |
| 30 días antes | ~108 + 16 + ~48 ≈ **172** | USD 2.60 |
| Sin efecto de la caché (peor caso) | **300 a 400** | USD 4.50 a 6.00 |

**Un viaje redondo son 2 vuelos.** Con la frecuencia actual, eso cuesta lo mismo o más que el ingreso neto de un mes de PRO (sección 3).

### 2.6 Otras funciones que un usuario de prueba puede usar mucho

| Función | Qué llama | Costo marginal real | Etiqueta |
|---|---|---|---|
| `buscar-video` | Pexels videos; caché en memoria de 6 h | **USD 0**, pero **consume el límite de Pexels** (200 por hora, 20,000 al mes). Producción: **694 llamadas para 8 usuarios en 24 h** (~87 por usuario al día). A ese ritmo, 8 usuarios activos ya se acercan a 20,000 al mes. | MEDIDO (`buscar-video/index.ts:4-5, 28-31`) + PRECIO PÚBLICO |
| `pexels-image` | Pexels fotos | USD 0 (mismo límite). 116 llamadas en 24 h. | MEDIDO |
| `generate-avatar` | `google/gemini-2.5-flash-image` vía el gateway de Lovable (las imágenes siempre van a Lovable) | ~USD 0.039 por imagen, pagado en créditos de Lovable. Límite: 4 por minuto y 20 por hora. **El modelo se anunció como retirado el 2-oct-2026: puede estar fallando.** | MEDIDO (`generate-avatar/index.ts:161`; `_shared/ai.ts:49-51`) + PRECIO PÚBLICO |
| `recomendar-destinos` | Gemini 2.5 Flash, 1 llamada | ~USD 0.003 a 0.01 | SUPUESTO |
| `parsear-viaje` / `parse-trip-file` | Gemini 2.5 Flash, con texto o PDF | ~USD 0.005 a 0.02 | SUPUESTO |
| `editar-viaje-ai` | **Gemini 2.5 Pro**, reescribe el viaje (~22,000 caracteres de entrada y de salida) | **~USD 0.05 a 0.10 por edición**. No tiene cuota, solo 8 por minuto y 60 por hora. | SUPUESTO |
| `generar-packing-list` / `evolucionar-dna` | Gemini 2.5 Pro | ~USD 0.02 a 0.05 | SUPUESTO |
| `suggest-packing`, `suggest-restaurants`, `card-benefits-lookup`, `auditar-perfil` | Gemini 2.5 Flash | ~USD 0.002 a 0.01 | SUPUESTO |
| `buscar-promociones`, `nightlife-discover` | Perplexity `sonar-pro` (4,000 tokens) más **`claude-sonnet-4-20250514`** | Perplexity ~USD 0.04 a 0.08. El modelo Claude Sonnet 4 **ya está retirado** según `analizar-viaje/index.ts:69`, así que estas funciones **probablemente gastan Perplexity y luego fallan con 502** (`nightlife-discover/index.ts:152-165`). | MEDIDO + SUPUESTO |
| **`serpapi-quote`** (precio en vivo de viajes manuales) | **2 búsquedas de SerpApi** (vuelo y hotel), **sin caché, cada vez que se abre** un viaje sin vuelos ni hoteles | **USD 0.03 por vista**, y **también para usuarios GRATIS**: es una fuga de costo en "viajes guardados / edición manual". | MEDIDO (`serpapi-quote/index.ts:10, 351`; `TripDetail.tsx:451`; `useLiveQuote.ts:59`) |
| `places-nearby`, `nearby-places`, `places-search` | Google Places, Nearby o Text Search Pro | $0.032 por llamada pasando las 5,000 gratis al mes (compartidas entre todos). 18 llamadas en 24 h. | MEDIDO + PRECIO PÚBLICO |
| `place-details`, `place-photo` | Google Place Details y Photos | $0.017 y $0.007 pasando lo gratis. `place-photo` guarda caché 24 h en el navegador. | MEDIDO + PRECIO PÚBLICO |
| `geocode`, `get-routes` | Google Geocoding y Routes | $0.005 pasando 10,000 gratis | PRECIO PÚBLICO |
| `flight-status` | SerpApi, 1 búsqueda (o Perplexity `sonar`) | USD 0.015 | MEDIDO |
| `resolver-fechas`, `analizar-preferencias-ruta` | Gemini 3 Flash Preview | ~USD 0.001 a 0.003 | SUPUESTO |
| Correos (bienvenida, cotización, Fixer) | Resend | USD 0 hasta 3,000 al mes **y 100 al día** | PRECIO PÚBLICO |
| Cada llamada a una función | Supabase Edge (Lovable Cloud) | ~USD 0.000002, despreciable | PRECIO PÚBLICO |

---

## 3. Costo por operación

Supuestos de la tabla: SerpApi a USD 0.015 por búsqueda; Gemini Flash a precio de 3.8 Flash 2026 (la columna de 2027 se indica aparte). Todo es [SUPUESTO] construido sobre tamaños [MEDIDOS] y precios [PÚBLICOS].

| Operación | Bajo | **Típico** | Alto | Qué incluye |
|---|---|---|---|---|
| **Análisis completo** | USD 0.08 (MXN 1.5) | **USD 0.13 (MXN 2.4) sin Perplexity · USD 0.19 (MXN 3.5) con Perplexity** | USD 0.41 (MXN 7.5) | **Claude:** 0.064 / 0.084 / 0.191 (este último con el tope de 16,000 tokens). **SerpApi:** 2 / 3 / 4 búsquedas. **Perplexity:** 0 / 0.058 / 0.077. En el caso alto se suma el respaldo de Gemini (0.038) y SerpApi a precio Starter. |
| Análisis que falla después de pagar proveedores | USD 0.02 a 0.10 | — | — | Hoy además **gasta la oportunidad gratuita**. Con reservar, confirmar y liberar, el usuario no pierde la oportunidad, pero **IATOS sí paga el costo**. |
| **Multiciudad, 3 ciudades** | — | **USD 0.26 (MXN 4.8)** | — | Gemini 2.5 Pro 0.17 + ~6 búsquedas 0.09 |
| Multiciudad, 6 ciudades | — | USD 0.47 (MXN 8.6) | — | |
| Multiciudad, 20 ciudades (posible hoy) | — | — | **USD 1.44 (MXN 26.6)** con ~40 búsquedas | Un solo uso de la cuota |
| **Mensaje de Iato, solo conversación** | USD 0.004 (MXN 0.07) | **USD 0.013 (MXN 0.24)** | USD 0.026 (precio 2027) | 2.5 Flash: 0.0066. 3.8 Flash: 0.013. 3.8 Flash en 2027: 0.026. |
| **Mensaje con 1 búsqueda de vuelos** | USD 0.028 | **USD 0.042 (MXN 0.77)** | USD 0.069 | 2 llamadas al modelo + 1 búsqueda |
| **Mensaje con vuelos y hotel** | USD 0.052 | **USD 0.066 (MXN 1.2)** | USD 0.095 | 2 llamadas + 2 o 3 búsquedas |
| Mensaje en el peor caso de hoy | — | — | **USD 0.23 (MXN 4.3)** | 2027: 0.33. 4 llamadas + ~9 búsquedas |
| Mezcla típica de mensajes (60% conversación, 30% una búsqueda, 10% dos) | — | **USD 0.027 (MXN 0.50)** | — | |
| Mezcla pesada (30 / 40 / 30) | — | **USD 0.041 (MXN 0.75)** | — | |
| **Alerta de precio, por mes** | USD 0 (Travelpayouts siempre tiene la fecha) | **USD 0.27 (MXN 5.0)**: ~18 búsquedas | USD 0.90 (MXN 16.6): 60 búsquedas | 60 revisiones al mes por alerta, si el tope de 40 por corrida no la retrasa |
| Alerta con la política recomendada (SerpApi máximo cada 72 h) | USD 0 | USD 0.08 | USD 0.15 | 10 búsquedas al mes como máximo |
| **Seguimiento de vuelo, con la frecuencia actual** | USD 1.20 (agregado 7 días antes) | — | USD 2.60 (30 días antes) a USD 6.00 sin caché | 80 a 400 búsquedas |
| Seguimiento con la frecuencia recomendada (~17 búsquedas) | — | **USD 0.26 (MXN 4.8)** | — | Ver la propuesta, sección 5.3 |
| Seguimiento "básico" para GRATIS (~8 búsquedas) | — | USD 0.12 (MXN 2.2) | — | |
| **Vista de un viaje manual (`serpapi-quote`)** | — | **USD 0.03 (MXN 0.55) cada vez** | — | 2 búsquedas sin caché |
| Edición con IA (`editar-viaje-ai`) | USD 0.05 | USD 0.07 | USD 0.10 | Gemini 2.5 Pro |
| Avatar | — | ~USD 0.04 | — | Créditos de Lovable |
| Otros usos de IA en un mes (recomendar, equipaje, parsear) | — | USD 0.10 típico / 0.50 pesado | USD 1.50 abusivo | |

**Lectura rápida:**

1. **Un análisis cuesta alrededor de MXN 2.4 a 3.5.** El modelo Claude es el 45 a 65% de eso.
2. **Un mensaje de Iato cuesta en promedio unos 50 centavos.** Sube mucho cuando busca en vivo y **se duplica el 1-ene-2027** si sigue en `gemini-flash-latest` = 3.8 Flash.
3. **El seguimiento de vuelos, con la frecuencia actual, es lo más caro por usuario.** Un viaje redondo agregado con un mes de anticipación cuesta ~USD 5, que es más que el ingreso neto de PRO.
4. **SerpApi es la restricción que manda.** El análisis, el chat, las alertas, el seguimiento y `serpapi-quote` gastan de la misma bolsa.

---

## 4. Uso medido en producción (últimas ~24 h, sobre todo pruebas de los fundadores)

[MEDIDO] Conteos del limitador de ritmo que nos dieron:

| Función | Llamadas | Proveedor que paga | Búsquedas de SerpApi aproximadas |
|---|---|---|---|
| buscar-video | 694 (8 usuarios) | Pexels, gratis con límite | 0 |
| pexels-image | 116 | Pexels | 0 |
| tripadvisor-search | 41 | TripAdvisor o SerpApi Maps | 0 a 41 |
| hotels-search | 38 | SerpApi | 38 a 76 |
| recomendar-destinos | 35 | Gemini | 0 |
| flights-search | 27 | SerpApi | 27 |
| travelpayouts-flights | 24 | gratis | 0 |
| nearby-places | 18 | Google Places | 0 |
| analizar-viaje | 17 | Claude + subllamadas | (ya contadas arriba) |
| parsear-viaje | 11 | Gemini | 0 |
| concierge-chat | 9 | Gemini | — |
| logistics-plan | 5 | Gemini 2.5 Pro + subllamadas | (ya contadas arriba) |

**Lectura** [SUPUESTO]: en un día de pruebas se gastaron **entre ~65 y ~145 búsquedas de SerpApi**. Con unas 216 restantes, **la bolsa actual alcanza para uno a tres días de pruebas como este**.

17 análisis × ~USD 0.13–0.19 ≈ **USD 2.2 a 3.2 de Claude y otros proveedores en un día**.

---

## 5. Límites que no son de dinero, pero rompen el producto

| Límite | Valor | Qué pasa al llegar | Etiqueta |
|---|---|---|---|
| Búsquedas restantes de SerpApi | ~216 | Los precios "en vivo" pasan a ser estimaciones de IA y el seguimiento de vuelos se queda sin datos | MEDIDO (auditoría) |
| SerpApi por hora | 1,000 (Developer) | Error 429 | PRECIO PÚBLICO |
| Pexels | 200 por hora y 20,000 al mes | Videos y fotos de portada vacíos | PRECIO PÚBLICO |
| Resend gratis | **100 correos al día** | Con más de ~50 altas al día (bienvenida + cotización) ya no llegan los correos de confirmación. **Esto rompe "la prueba empieza al confirmar el correo".** | PRECIO PÚBLICO |
| Gateway Google Maps de Lovable | 6,000 solicitudes de servidor cada 24 h por tipo de conexión | Lugares cercanos, detalles y fotos fallan | PRECIO PÚBLICO |
| Alertas de precio | 80 revisiones al día en todo el sistema (40 por corrida) | Con más de 40 alertas activas, cada una se revisa menos de 2 veces al día | MEDIDO |
| Créditos de IA de Lovable | 4 al mes gratis; después hay que pagar | El respaldo responde 402 | PRECIO PÚBLICO |
| Precio de Gemini 3.8 Flash | Sube al doble el 1-ene-2027 | El costo del chat se duplica | PRECIO PÚBLICO |

---

## 6. Costos fijos mensuales

| Concepto | USD al mes | Etiqueta |
|---|---|---|
| Plan de SerpApi (según volumen) | 25 / 75 / 150 / 275 / 725 | PRECIO PÚBLICO |
| Lovable (plan del espacio de trabajo) | ~25 a 50 | SUPUESTO (no sabemos cuál está contratado) |
| Lovable Cloud (Supabase) | 0 a 25, dentro de los créditos | SUPUESTO |
| Resend | 0 hasta 3,000 correos al mes y 100 al día; después 20 | PRECIO PÚBLICO |
| Google Maps | 0 dentro de lo gratis | PRECIO PÚBLICO |
| Stripe, Anthropic, Gemini, Perplexity | 0 fijo: solo por uso | PRECIO PÚBLICO |
| Fixer humano | Tiempo de personas; no se modeló | SUPUESTO |

---

## 7. Lo que no se pudo confirmar

| # | Qué falta | Cómo resolverlo |
|---|---|---|
| 1 | Si existe `PERPLEXITY_API_KEY` en producción | El chequeo de salud solo confirma GEMINI, LOVABLE, ANTHROPIC, SERPAPI, TRAVELPAYOUTS y STRIPE (`IATOS_AUDITORIA_BASELINE.md:102`). Si existe, cada análisis cuesta **~USD 0.058 más**. |
| 2 | El precio oficial de Perplexity sonar y sonar-pro | La página oficial ya no lo lista. Usamos un rango de una fuente de terceros. |
| 3 | A qué modelo apunta `gemini-flash-latest`, y si `gemini-2.5-flash` responde 404 a esta cuenta | Revisar los registros: `gemini gemini-2.5-flash → 404`. **El costo del chat cambia de 2 a 4 veces según la respuesta.** |
| 4 | Si `TRIPADVISOR_API_KEY` existe y sigue funcionando | La API anterior se habría retirado en agosto de 2026. Si no funciona, cada análisis gasta 1 búsqueda más de SerpApi en Maps. |
| 5 | Qué plan de SerpApi está contratado, y si la caché de 1 h aplica al seguimiento de vuelos | Revisar el panel de SerpApi. |
| 6 | El contenido y tamaño de `MASTER_PROMPT_IATOS` | Suma de 0 a ~2,300 tokens a cada análisis y a cada llamada del chat. |
| 7 | Tokens reales | Ninguna función guarda `usage` en la base. **Se recomienda registrarlo**: ver la propuesta, sección 10. |
| 8 | Si Gemini 2.5 Flash Image sigue disponible en Lovable | Google lo anunció como retirado el 2-oct-2026. |
