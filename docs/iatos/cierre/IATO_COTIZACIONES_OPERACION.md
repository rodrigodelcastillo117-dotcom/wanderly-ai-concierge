# Cierre de auditoría · grupo iato-cotiz (Iato, cotizaciones y operación)

Rama `claude/aud-iato` (desde `claude/cierre-auditoria` = `f62466e`). Worktree `/home/user/wt-aud-iato`.
Alcance: `concierge-chat/**`, `_shared/ai.ts`, `_shared/activeTrip.ts`, `_shared/usage.ts`; cotizaciones
(`analizar-viaje`, `flights-search`, `hotels-search`, `serpapi-quote`, `logistics-plan`, `_shared/rooms.ts`,
`_shared/quotes.ts`, `_shared/fx.ts`, `_shared/serpCache.ts`/`serpBrake.ts`/`liveSearch.ts`); operación
(`flight-watch-cron`, `price-watch-cron`, `health-check`, `concierge-action`, `enviar-email-fixer`).
Sin llamadas a APIs pagadas: todo con fixtures y `fetch` simulado. Nada desplegado.

Pruebas nuevas:
- `src/test/audIatoCierre.test.ts` — reproducciones AUD-IATO-01…06 (12 de 13 fallaban antes; salida guardada abajo).
- `src/test/audQuotesOpsCierre.test.ts` — AUD-Q-07 y AUD-OPS-08 (antes: el archivo no cargaba porque el validador y el texto no existían; ver "Reproducción").
- `src/test/audIatoRefutados.test.ts` — hipótesis refutadas (pasan antes y después).

## Tabla

| ID | Severidad | Reproducido (cómo, archivo de prueba) | Solución (archivo:línea, commit) | Tests (nombre, resultado antes/después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-IATO-01 | P2 | Cadena de proveedores lentos simulada con reloj falso: 3 × 60 s = 180 s; con una vuelta de herramientas, 260 s. La función Edge muere a los 150 s y la app recibe el stream cortado (sin `final` ni `error`). `audIatoCierre.test.ts` › "AUD-IATO-01" | `concierge-chat/agent.ts` (`hardBudgetMs`, `budgetMs` por llamada, `MIN_MODEL_CALL_MS`; `makeModelCaller` acota los 3 tiempos), `turn.ts:50` `TURN_BUDGET_MS = 120_000` y `hardBudgetMs` en `runAgentTurn`. Commit `8aa1be7` | 2 pruebas: antes ×("expected 180000 to be ≤ 110000", "expected 260000 …"), después ✓ | Agente se corta con `AllProvidersFailed` → `index.ts` manda `event: error` y libera la cuota | VERIFICADO |
| AUD-IATO-02 | P3 | Primera vuelta responde (9,000 tokens) y pide herramienta; la segunda falla en todos los proveedores → el uso cobrado se perdía (no había forma de registrarlo). `audIatoCierre.test.ts` › "AUD-IATO-02" | `agent.ts` `AllProvidersFailed(last, usage)`; `index.ts` `onTurnError` registra `e.usage` en `ai_usage_log`. Commit `8aa1be7` | antes × ("expected undefined to deeply equal […]"), después ✓ | `ai_usage_log` subestimaba el costo de los turnos fallidos | VERIFICADO |
| AUD-IATO-03 | P2 | `concierge-action` devuelve `human_notified:false` cuando el correo al equipo falla; la tarjeta de Iato decía "Solicitud enviada al Fixer… te avisamos cuando haya respuesta". `audIatoCierre.test.ts` › "AUD-IATO-03" | `concierge-chat/actionExec.ts` (`fixer_request`): mensaje honesto + `data.human_notified`. Commit `10b9e5c` | 2 pruebas: antes ×, después ✓ | Mismo criterio que `RequestNote` de `ConciergeCards.tsx:241` | VERIFICADO |
| AUD-IATO-04 | P2 | Evidencia con Air France 2,360/1,180 e Iberia 1,720/860: card "Air France" con 1,720 → `CONSULTADO_EN_VIVO`; "Grand Hotel Fantasía" con el precio de Lutetia → `CONSULTADO_EN_VIVO`. `audIatoCierre.test.ts` › "AUD-IATO-04" | `concierge-chat/cards.ts`: cada precio de `collectEvidence` guarda `item` (name/airline…); `validateCards` exige `sameItemName(title, item)`. Commit `8e76ce4` | 2 de 3 pruebas: antes × ("expected 'CONSULTADO_EN_VIVO' to be 'NO_VERIFICADO'"), después ✓; control ✓/✓ | Card con precio de otra opción ahora sale "Precio no verificado" | VERIFICADO |
| AUD-IATO-05 | P2 | Card de vuelo con `price_per_person_usd` se pintaba con sufijo fijo "total" (`ConciergeCards.tsx:359`); hotel usaba el `meta` del modelo ("por noche") aunque el precio fuera el total o antes de impuestos. `audIatoCierre.test.ts` › "AUD-IATO-05" | `cards.ts` `priceBasis()` + `ConciergeCard.price_basis`; `ConciergeCards.tsx:359,379` usan `price_basis`. Commit `8e76ce4` | 3 pruebas: antes × (`price_basis` undefined), después ✓ | "por persona", "total", "por noche · con impuestos", "total de la estancia · con impuestos", "por noche · sin impuestos" | VERIFICADO |
| AUD-IATO-06 | P2 | `web_search` de Iato llamaba a SerpApi directo, sin `accountBrake`: con presupuesto agotado hacía 1 llamada; con "run out of searches" no pausaba la cuenta. `audIatoCierre.test.ts` › "AUD-IATO-06" | `concierge-chat/webSearch.ts` (`brake`: pausa → guardado o Wikipedia; error de cuota → `tripQuota`), `index.ts` pasa `accountBrake(store)`, `cards.ts` motivo `busquedas_en_pausa`. Commit `678671d` | 2 pruebas: antes × ("expected 1 to be +0", "spy … 0 times"), después ✓ | SerpApi casi agotado (IATOS-015): Iato era la única fuga del freno | VERIFICADO |
| AUD-Q-07 | P2 | `analizar-viaje/index.ts:103` solo comparaba regreso > salida; una salida pasada o "2026-13-40" apartaba el análisis, consultaba proveedores y se cobraba. `PlanTrip.tsx:715,866` no pone `min` al calendario y el texto libre (`:433`) puede dar fechas pasadas. `audQuotesOpsCierre.test.ts` › "AUD-Q-07" | `analizar-viaje/dates.ts` `tripDatesProblem`; `index.ts:564` (antes de la cuota) y `:668` (fechas de resolver-fechas, libera el cupo). Commit `7474ef8` | 3 pruebas: antes × (módulo inexistente: el servidor no validaba), después ✓ | 400 `INVALID_REQUEST` con mensaje en español; "hoy" medido en UTC−12 | VERIFICADO |
| AUD-OPS-08 | P3 | `price-watch-cron` usaba `getUsdMxnRate()` (sin fuente): con la tabla de respaldo de `fx.ts` la alerta decía "al tipo de cambio de hoy". `audQuotesOpsCierre.test.ts` › "AUD-OPS-08" | `price-watch-cron/rules.ts` `priceDropBody`; `index.ts` usa `getUsdMxnRateInfo` y devuelve `fx_source`. Commit `ee19828` | 2 pruebas: antes × (función inexistente: el texto estaba fijo en index.ts), después ✓ | Texto: "al tipo de cambio de referencia, aproximado" | VERIFICADO |

### Salida antes de las correcciones (extracto, `audIatoCierre.test.ts`)

```
× AUD-IATO-01 … el turno se corta antes de 120 s, no a los 180 s      AssertionError: expected 180000 to be less than or equal to 110000
× AUD-IATO-01 … la última llamada recibe solo el tiempo que queda      AssertionError: expected 260000 to be less than or equal to 110000
× AUD-IATO-02 … AllProvidersFailed trae el uso …                        AssertionError: expected undefined to deeply equal [ { provider: 'anthropic', …(5) } ]
× AUD-IATO-03 … no promete respuesta …                                  AssertionError: expected undefined to be false
× AUD-IATO-04 … Air France con el precio de Iberia → NO_VERIFICADO      AssertionError: expected 'CONSULTADO_EN_VIVO' to be 'NO_VERIFICADO'
× AUD-IATO-04 … hotel inventado con el precio de un hotel real          AssertionError: expected 'CONSULTADO_EN_VIVO' to be 'NO_VERIFICADO'
✓ AUD-IATO-04 … control
× AUD-IATO-05 (3)                                                       AssertionError: expected undefined to be 'por persona' …
× AUD-IATO-06 … no llama a SerpApi                                      AssertionError: expected 1 to be +0
× AUD-IATO-06 … pausa la cuenta                                         AssertionError: expected "spy" to be called 1 times, but got 0 times
Tests 12 failed | 1 passed (13)
FAIL src/test/audQuotesOpsCierre.test.ts — Failed to resolve import "../../supabase/functions/analizar-viaje/dates"
```

## HALLAZGOS NUEVOS

1. **AUD-IATO-01 (P2) · Turno sin tope total.** Escenario: Anthropic degradado (streams lentos). Iteración 0: Sonnet agota sus 60 s, Haiku responde a los 59 s pidiendo herramientas (14 s); la vuelta final vuelve a tardar 59 s y cae a Gemini otros 60 s → 250 s. Supabase corta a los 150 s: la app ve "La conexión se cortó", el uso no se registra y la reserva de cuota queda viva 10 min. `deadlineMs` solo impedía más herramientas, no acotaba llamadas.
2. **AUD-IATO-02 (P3) · Costo perdido en turnos fallidos.** Las vueltas que sí cobraron Anthropic/Gemini no llegaban a `ai_usage_log` si el turno terminaba en `AllProvidersFailed`; el panel de costos subestimaba exactamente los días de incidente.
3. **AUD-IATO-03 (P2) · Fixer "enviado" sin humano avisado.** Resend falla (dominio sin verificar, IATOS-034) → `concierge_requests` guarda la fila, `human_notified:false`, y Iato le dice al usuario "te avisamos cuando haya respuesta". Nadie la ve: no hay cron ni bandeja que recoja solicitudes sin aviso (ver riesgo residual).
4. **AUD-IATO-04 (P2) · Precio de otra opción marcado "en vivo".** El guardia de cards solo comprobaba que el número existiera en algún resultado de la herramienta. El modelo mezclando precios entre opciones (o inventando un hotel con un precio real) obtenía la insignia "Google Hotels · consultado en vivo".
5. **AUD-IATO-05 (P2) · Base del precio sin etiqueta.** Vuelo: `price_usd` (total del grupo) y `price_per_person_usd` validaban igual y la pantalla siempre decía "total" → para 2 viajeros, un precio por persona se leía como total (la mitad del costo real). Hotel: la base era el texto del modelo; la tarifa antes de impuestos podía mostrarse como "por noche" sin aviso.
6. **AUD-IATO-06 (P2) · `web_search` fuera del freno de SerpApi.** Con `SERPAPI_MONTHLY_BUDGET` alcanzado o la cuenta sin búsquedas, cada mensaje de Iato con `web_search` seguía llamando a SerpApi; además no activaba la pausa compartida de 1 h.
7. **AUD-Q-07 (P2) · Cotización de fechas pasadas.** "Viaje a Cancún del 1 al 8 de marzo" (texto libre interpretado en octubre) o un calendario sin `min` → análisis cobrado con vuelos/hoteles que los proveedores no pueden cotizar; el modelo rellena con estimados.
8. **AUD-OPS-08 (P3) · "Tipo de cambio de hoy" falso.** Si frankfurter.app no responde, la alerta de baja de precio usaba la tabla fija (20.5) y lo presentaba como tasa del día.

## HALLAZGOS REFUTADOS CON EVIDENCIA

| ID | Hipótesis | Evidencia | Prueba |
|---|---|---|---|
| REF-01 | Un nombre de hotel/nota del viaje con órdenes ("SISTEMA: ignora las reglas…") secuestra a Iato | Datos del usuario y de proveedores van en el mensaje de CONTEXTO (`prompt.ts:195`) neutralizados (`guard.ts` `neutralizeUntrusted`); el sistema estable/dinámico no lleva datos del viaje | `audIatoRefutados.test.ts` › REF-01 ✓ |
| REF-02 | Iato puede decir "te reservé" | `guard.ts` `enforceNoFakeBooking` lo quita y antepone `NOT_BOOKED_LINE` | REF-02 ✓ (además `concierge2Honesty.test.ts`) |
| REF-03 | Una acción confirmada con una tarjeta vieja actúa sobre un viaje sin acceso | `handleAction` relee los viajes con la sesión del usuario (RLS) y `executeAction` revalida (`viaje_sin_acceso`) | REF-03 ✓ |
| REF-04 | Costos por modelo mal calculados | `_shared/usage.ts`: haiku-5-5 0.10/0.50, sonnet-5-5 2/10 (caché 0.20), opus-5-5 4/20 — coincide con la tabla del skill claude-api (2026-10-06). Nota: Haiku 5.5 sube a 0.50/2.50 con prompts >100 K; Iato usa ~9–13 K | REF-04 ✓ |
| REF-05 | La app se queda "escribiendo" si el servidor falla | `conciergeStream.ts` lanza error si el stream termina sin `final`; `event:error` se convierte en error HTTP con su código | REF-05 ✓ (2) |
| REF-06 | Con Claude caído cada mensaje espera la falla | Breaker abierto → la cadena salta directo al respaldo | REF-06 ✓ |
| REF-07 | Cuota consumida cuando ambos proveedores fallan | `index.ts` `onTurnError` → `releaseQuota(…, "model_error")`; `commitQuota` solo tras respuesta | Lectura de código (index.ts:474-486); la reserva caduca sola a los 10 min si la función muere |
| REF-08 | Datos de otro usuario en el contexto | Viajes/bóveda/memoria con la sesión del usuario (RLS) y `eq("user_id")`; viajes compartidos solo por id con RLS; memoria por `(user_id, trip_id)` con índices únicos | Lectura de código (index.ts:285-302, 419-422) |
| REF-09 | flight-watch-cron / price-watch-cron se enciman y repiten avisos | `claim_tracked_flights`/`claim_price_watches` con `FOR UPDATE SKIP LOCKED`, `notify_once` con llave única | SQL `ops` T3–T7 y concurrencia ✓; `cost` K12 y CONCURRENCIA ✓ |
| REF-10 | Impuestos y procedencia de cotizaciones sin etiqueta | `hotels-search` marca `total_incluye_impuestos`/`*_before_taxes_*`; `finalizeSearchResponse` usa la fecha real de la caché y `OBSOLETO` para guardados; `quotes.ts` pasa a `ESTIMADO` con tipo de cambio de respaldo y a `PENDIENTE` con precio vencido; `serpapi-quote` etiqueta `fx_is_fallback` | Suites existentes `quoteSnapshot`, `serpQuota`, `serpCache`, `provenance` ✓ |
| REF-11 | Análisis cuenta vuelos dos veces (total × viajeros) | `analizar-viaje` usa `price_per_person_usd` (index.ts:831, sources.ts:125) y `budget.ts` multiplica por viajeros una vez | `budget.test.ts` ✓ |

## Resultados de verificación

- **Pruebas nuevas:** `audIatoCierre` 13/13, `audQuotesOpsCierre` 5/5, `audIatoRefutados` 8/8, `audIatoMejoras` 4/4 ✓.
- **Suites del área** (concierge2Core/Evals/Honesty/Actions/Client, conciergeCards, conciergeTools, iatoEvals, budget, serpQuota, priceWatch): todas ✓.
- **Vitest completo:** base `f62466e` a las 13:50 (carga baja): 160 archivos, 1497 ✓. En la rama, con la máquina a carga 40–46 (los demás grupos corriendo): 1508 ✓ / 19 × en 15 archivos de pantallas que no tocan este alcance (Inicio, Gastos, TripDetail, Privé, Members…), todos por `Test timed out in 5000ms` / tiempos de animación. Re-corridos uno por uno: 12 de 14 pasan; `godtierHome` y `dashboardActiveTrip` fallan **igual en un worktree limpio de `f62466e`** en la misma máquina y momento (timeouts), y `priveHub` › Grand Welcome también falla en la base. Conclusión: inestabilidad por carga, no regresión de esta rama. **PENDIENTE** repetir la suite completa con la máquina libre.
- `tsc --noEmit -p tsconfig.app.json`: exit 0. `npm run build`: exit 0.
- `deno check` (Deno 2.1): `concierge-chat`, `analizar-viaje`, `price-watch-cron`: exit 0 (`deno.lock` borrado).
- **SQL local** (bases `audiato_*`, borradas al terminar): `concierge2` 7 OK (K1–K6); `cost` 16 OK (incluye K9–K12 y 2 de concurrencia); `ops` T1–T9 + idempotencia de `2026102213*` + reclamo concurrente sin repetir; `security` 95 OK. Único error de migración: `pg_cron` no disponible (esperado); los "permission denied" son las aserciones de ataque.

## Mejoras adicionales (instrucción del dueño: GOD TIER)

| ID | Mejora | Archivo, commit | Prueba (antes → después) |
|---|---|---|---|
| MEJ-01 | Una respuesta de Claude que SÍ estaba llegando y solo rebasó el tope total (`timeout_total` con texto) ya no abre el circuit breaker de ese modelo 2 min para todos los usuarios de la instancia; se pasa al respaldo igual. Primer byte / inactividad siguen abriéndolo. | `concierge-chat/agent.ts` (catch de la cadena), `962059f` | `audIatoMejoras.test.ts` › MEJ-01: × → ✓ (control ✓ → ✓) |
| MEJ-02 | Si la conexión se corta a media respuesta, el texto parcial (que no pasó por las revisiones de honestidad del servidor) queda marcado "Respuesta incompleta… sin verificar sus datos" en lugar de verse como respuesta final. | `src/lib/conciergeStream.ts` `incompleteReplyText`, `src/pages/Concierge.tsx`, `962059f` | `audIatoMejoras.test.ts` › MEJ-02: × (función inexistente) → ✓ |

## Para otros grupos (no corregido aquí)

- **Privé:** `src/test/priveHub.test.tsx` › "Grand Welcome › con movimiento completo empieza en negro…" falla también en el commit base `f62466e` (worktree limpio, misma máquina: "Unable to find an element with the text: WELCOME TO PRIVÉ"); pasó en la corrida base de las 13:50. Es dependiente de tiempos/carga; no lo toca este grupo.

- **Privé:** `actionExec.ts` `prive_request` manda `ctx.activeTripId` (el `trip_id` del cuerpo, sin validar contra los viajes) a `concierge-action`; `prive_request_create` lo valida según su comentario: confirmar en su suite.
- **Barrido de seguridad / calidad de pruebas:** la neutralización de inyección es por expresiones regulares (inevitablemente incompleta); la defensa real es la separación sistema/contexto (REF-01). `ActionCard` permite "Reintentar" tras un timeout de 20 s sin llave de idempotencia: un `fixer_request`/`create_trip` puede duplicarse.
- **Booking links / Stripe / Reservas IA:** nada nuevo en este alcance.

## Riesgo residual

| Riesgo | Sev. | Estado | Nota |
|---|---|---|---|
| Solicitudes al Fixer con `human_notified=false` no tienen reintento ni alerta (no hay columna ni cron) | P2 | PENDIENTE | Requiere migración (columna `notified_at` + reintento en un cron o en health-check) → autorización |
| Circuit breaker en memoria por instancia | P3 | PENDIENTE (aceptado) | Cada isolate frío paga la primera falla (hasta 8–12 s de primer byte); no comparte estado. Mitigado por AUD-IATO-01 |
| Un stream legítimo largo que agota `totalMs` (60 s) se cuenta como `timeout` y abre el breaker 2 min para todos en esa instancia | P3 | PENDIENTE | Distinguir "timeout con tokens fluyendo" de "proveedor caído" |
| Tope de Modo exigente: día UTC (se reinicia a las 18:00 en México) y hasta 3 en paralelo pasan el tope; tope `null` por omisión (decisión del dueño) | P3 | PENDIENTE | `concierge_runtime_config` |
| Texto parcial en vivo (sin guardias de honestidad) queda en pantalla si la conexión se corta | P3 | PENDIENTE | `Concierge.tsx` conserva `m.text` en el catch; marcarlo "respuesta incompleta" |
| Dos mensajes simultáneos del mismo usuario: la memoria (`concierge_conversations`) pierde un turno (lectura-modificación-escritura / 23505) | P3 | PENDIENTE | |
| Card de Travelpayouts lleva `estado_dato: CONSULTADO_EN_VIVO` aunque la etiqueta visible dice "tarifa de referencia (últimas 48 h)" | P3 | PENDIENTE | Estado semántico, la pantalla es honesta |
| health-check prueba solo Sonnet (`ANTHROPIC_MODEL`), no el modelo rápido configurado en `app_flags.concierge_models` | P3 | PENDIENTE | El ruteo cae al otro modelo si uno da 404 |
| price-watch-cron con la cuenta SerpApi en pausa recibe la respuesta guardada (synthetic 200) de Google Flights y podría compararla como actual | P3 | PENDIENTE (no reproducido) | Revisar `trace.stale` antes de decidir alerta |
| `serpapi-quote` usa `nights` del cliente para noche × noches cuando Google no trae total | P3 | PENDIENTE | |
| Precio en vivo de hotel para >2 adultos se toma como del grupo (`rooms.ts`) | — | Decisión previa (R10) | Google Hotels no tiene parámetro de habitaciones |

## Autorización para producción

- **Migraciones:** ninguna.
- **Funciones a desplegar:** `concierge-chat`, `analizar-viaje`, `price-watch-cron`. Frontend: `ConciergeCards.tsx` (base del precio).
