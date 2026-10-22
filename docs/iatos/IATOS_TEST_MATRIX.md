# IATOS: matriz de pruebas

- **Fecha:** 2026-10-22.
- **Código medido:** rama `claude/iatos-world-class`, commit `d550aac`, árbol limpio.
- **Para quién es:**
  - los fundadores, para saber qué está demostrado y qué no;
  - Sebastián Mathus (NEXTIA), para auditar la cobertura.
- **Documentos hermanos:**
  - [IATOS_ARQUITECTURA_OBJETIVO.md](./IATOS_ARQUITECTURA_OBJETIVO.md);
  - [IATOS_PLAN_MEJORAS.md](./IATOS_PLAN_MEJORAS.md);
  - [IATOS_HALLAZGOS_PRIORIZADOS.md](./IATOS_HALLAZGOS_PRIORIZADOS.md).

---

## 0. Qué se midió, cómo y qué significa

| Medición | Comando | Resultado |
|---|---|---|
| Pruebas Vitest | `npx vitest run --reporter=json --outputFile=…/vitest.json` (2026-10-22, 02:49:30 a 02:49:52 UTC) | **392/392 pasan · 59 archivos · 0 fallas · 0 omitidas** |
| Tipos | `npx tsc --noEmit -p tsconfig.app.json` | 0 errores |
| Suites SQL | `supabase/tests/{security,ops,payments}/run.sh` y `security/trip_quotes.sql`, sobre un PostgreSQL 16.15 local desechable creado para esta medición. **Nunca contra producción.** | Todas dan el resultado esperado (sección 3) |

**Una corrida anterior no cuenta.** Una primera corrida de Vitest coincidió con una fusión temporal en el mismo directorio y dio 383 pruebas, con 4 archivos que no cargaron. Al volver el árbol a `d550aac` limpio dio 392/392. **Vale la segunda.** La cifra coincide con la reportada antes para `d550aac`.

**Qué prueba y qué no prueba una prueba de Vitest aquí:**

- **Sí prueba** el código real del repo, importado directamente. Por ejemplo, `src/test/budget.test.ts` importa `supabase/functions/analizar-viaje/budget.ts`. Las dependencias externas (Supabase, `fetch` y los modelos) están **simuladas**.
- **No prueba** que una Edge Function desplegada se comporte igual. **Ninguna prueba ejecuta un *handler* completo contra un Supabase real.**

**Qué prueba y qué no prueba una suite SQL:**

- **Sí prueba** las migraciones del repo reproducidas en un Postgres limpio, con un *shim* mínimo de Supabase (`supabase/tests/security/00_roles.sql`, `01_supabase_stubs.sql`).
- **No prueba** producción. La migración de `pg_cron` falla en local; es lo esperado y lo dicen los propios scripts.

**Columnas de la matriz de escenarios (sección 4):**

| Valor | Significado |
|---|---|
| **AUTO** | Cubierto por una prueba automática que pasa hoy en esta rama. |
| **AUTO-PARCIAL** | Cubierta solo una parte (por ejemplo, la lógica pero no la pantalla, o el SQL pero no el *handler*). |
| **EN DESARROLLO** | Hay una prueba escrita en la rama `claude/wc-pay` (commit `4481448`, worktree `/home/user/wt-pay`). **No la ejecuté y no está integrada**: NO VERIFICADO. |
| **MANUAL** | Verificado a mano o en vivo (se dice cuándo y cómo). |
| **NO CUBIERTO** | Ninguna prueba ni verificación. |

---

## 1. Resumen por área

| Área | Archivos | Pruebas |
|---|---|---|
| Seguridad y privacidad | 3 | 14 |
| Pagos, cuotas y textos comerciales | 7 | 53 |
| Dinero, cotizaciones, procedencia y afiliados | 17 | 110 |
| Iato (concierge e IA) | 7 | 69 |
| Alertas, tareas programadas y operación | 12 | 98 |
| Flujos de usuario | 10 | 38 |
| Móvil, accesibilidad y offline | 3 | 10 |
| **Total** | **59** | **392** |

Además hay 5 suites SQL (sección 3).

---

## 2. Inventario de pruebas Vitest (archivo → qué prueba → hallazgos)

Los conteos salen del JSON de Vitest. Todos los archivos están en `src/test/`.

### 2.1 Seguridad y privacidad (14)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `deleteAccount.test.ts` | 2 | Borrar la cuenta exige las dos confirmaciones y rechaza un `user_id` ajeno. Importa `supabase/functions/delete-account/validation.ts`. | base (A-16 relacionado: IATOS-050) |
| `cronAuth.test.ts` | 9 | La autenticación de cron falla cerrado: sin credenciales, con un secreto vacío, con un secreto equivocado o con un JWT de usuario se rechaza; compara en tiempo constante; consulta el secreto de Vault. | IATOS-096 (C-14) |
| `cookieConsent.test.tsx` | 3 | Sin elegir, no arranca PostHog ni Travelpayouts; "Solo esenciales" no carga nada; `index.html` permite el zoom. | IATOS-056, 088 |

### 2.2 Pagos, cuotas y textos comerciales (53)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `stripeCheckout.test.ts` | 12 | Con `comped`, `active`, `trialing` o `past_due` se responde 409 sin llamar a Stripe; `past_due` va al portal; una suscripción viva en Stripe también bloquea; la prueba de 30 días se da solo la primera vez (consulta el historial de Stripe); el origen de regreso solo acepta dominios propios. | IATOS-018, 020, 046, 096 |
| `stripeWebhook.test.ts` | 12 | Un error de la base responde 500 para que Stripe reintente; usa el estado actual de Stripe y no el del *payload*; `payment_failed` no pone `past_due` a ciegas; `invoice.paid` recupera; `deleted` usa el id de esa suscripción; los eventos no manejados se aceptan sin tocar nada. **No prueba la verificación de la firma.** | IATOS-019, 045 |
| `quota.test.ts` | 5 | `trip_analysis` falla cerrado si la verificación truena; una negación por error responde 503 y no el aviso de pago; una cuota agotada responde 402 con `upgrade_url`. | IATOS-048 (parcial), 047, 111 (parcial) |
| `functionErrors.test.ts` | 6 | Lee el cuerpo del 402 dentro de `error.context` y muestra el mensaje con el botón "Ver IATOS PRO"; 503, 409 y 400 muestran el mensaje del servidor; nunca pone un enlace externo. | IATOS-022, 111 (parcial) |
| `subscription.test.ts` | 3 | Hook `useSubscription`: sin suscripción no es PRO; en `trial` es PRO; `startCheckout` falla con un mensaje claro. | base |
| `planCopy.test.ts` | 9 | Landing, Auth, Pro, ProGate, Legal, `_shared/email.ts` y `concierge-chat/prompt.ts` no contienen las frases prohibidas y leen la misma fuente; el precio dice "IVA incluido" y la prueba dice "sin tarjeta". **No revisa `src/components/FixerButton.tsx`** (que aún dice "en minutos") **ni que la prueba exista de verdad.** | IATOS-012 (textos), 013, 089, 093 |
| `referral.test.ts` | 6 | Atribución de referidos con `?ref=`: valida, caduca a los 30 días, se reclama una vez y reintenta si falla. | base |

### 2.3 Dinero, cotizaciones, procedencia y afiliados (110)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `budget.test.ts` | 13 | Habitaciones = ⌈viajeros/2⌉ (1→1, 2→1, 3→2, 6→3); 6 viajeros × $5,000 × 5 noches = $75,000; total = suma exacta del desglose; respeta "ya tengo vuelos" y "sin hotel"; normaliza los *tiers*. Importa `analizar-viaje/budget.ts`, el código real. | IATOS-009, 037, 063 |
| `fx.test.ts` | 10 | Nunca convierte 1:1 a ciegas (una moneda sin tasa → `null`); subtotales por moneda; fechas locales (el 1 de octubre no se muestra como el 30 de septiembre); la tasa del servidor dice su fuente y su fecha y marca el respaldo. | IATOS-010, 073, 074, 082 |
| `quote.test.ts` | 11 | La cotización queda desactualizada si cambian los viajeros o las fechas, sin repartir el total viejo; "Cotizado el … · válido hasta …"; desglose por selección (noche × noches × habitaciones; tours × viajeros). | IATOS-035, 075, 080 |
| `quoteSnapshot.test.ts` | 6 | Suma de renglones = desglose = total; con tipo de cambio de respaldo ningún renglón queda COTIZADO; exclusiones y opcionales; si la tabla no existe, no rompe la cotización. | IATOS-080 |
| `realTripTotal.test.ts` | 3 | Muestra el total cotizado aunque rebase el presupuesto, y el excedente. | IATOS-007 |
| `tripSources.test.ts` | 10 | `enforceSources`: un vuelo o un hotel marcado "en vivo" que no está en las listas de esa petición pasa a estimado; sin listas en vivo, ninguna etiqueta del modelo sobrevive. | IATOS-026 |
| `logisticsProvenance.test.ts` | 4 | En `logistics-plan` el modelo no decide qué es "en vivo". | IATOS-026 |
| `editReconcile.test.ts` | 5 | En `editar-viaje-ai`, lo que no se volvió a consultar no puede decir "en vivo"; con fechas movidas queda pendiente; descarta fechas inválidas. | IATOS-027 |
| `provenance.test.ts` | 16 | Los 6 estados de procedencia; vivo menos de 24 h → CONSULTADO_EN_VIVO; más de 24 h o sin fecha → OBSOLETO; Travelpayouts → "Precio de referencia (caché ≤48 h)"; sin fuente → "Sin fuente". | IATOS-026, 057 |
| `priceSourceBadge.test.tsx` | 4 | La insignia dice "Sin fuente", no dice "verificado" para Travelpayouts y muestra OBSOLETO con la antigüedad. | IATOS-057 |
| `tripSavings.test.ts` | 5 | Calculadora de ahorro. | base |
| `tpParams.test.ts` | 5 | Travelpayouts: viaje redondo con `one_way=false`; *marker* de `TRAVELPAYOUTS_MARKER` o el público 533299, nunca parte del token; enlace de respaldo con fechas DDMM. | IATOS-036, 040, 078 |
| `affiliateLinks.test.ts` | 4 | Los enlaces de afiliado llevan el *marker*. | base (IATOS-040) |
| `trackBooking.test.ts` | 3 | Abre la ventana del socio de forma síncrona, antes de cualquier `await` (lo que pide Safari en iOS); sin sesión abre igual; si el navegador la bloquea, navega en la misma pestaña. | IATOS-039 |
| `liveSearchFallback.test.ts` | 4 | Si SerpApi y Travelpayouts fallan, `flights-search` y `hotels-search` devuelven `results: []` con `disponible: false` y un enlace de búsqueda, nunca resultados inventados. | IATOS-024, 057 |
| `detectRouteIntent.test.ts` | 3 | Detecta multidestino solo con separadores explícitos. | base |
| `parseTripFallback.test.ts` | 4 | Interpreta texto libre en el cliente. | base |

### 2.4 Iato (concierge e IA) (69)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `iatoEvals.test.ts` | 30 | Suite de evaluación determinista E-01 a E-20, con modelo y proveedores simulados (detalle en la sección 5). | IATOS-006, 023, 024, 025, 026, 028, 029, 032, 059, 060, 094 |
| `conciergeCards.test.tsx` | 17 | Se dibujan las 8 tarjetas; nunca hay un precio sin etiqueta de fuente; un precio no verificado no muestra la cifra; no hay `javascript:`; el transporte abre su propio enlace; jet y equipaje dicen "recibida" solo con un folio del servidor; FixerButton guarda el estado real del correo. | IATOS-023, 025, 030 (parcial), 061 |
| `conciergeTools.test.ts` | 7 | Mapeo de argumentos de `search_flights`; un vuelo sin regreso es sencillo; `slimToolResult` deja JSON válido aunque el resultado pase el límite. | IATOS-006 |
| `aiFetch.test.ts` | 7 | Cadena Gemini → `flash-latest` → Lovable; no reintenta ante errores de autenticación; las imágenes van a Lovable; el alias `gemini-flash-latest` se traduce al caer a Lovable. | IATOS-058 |
| `claudeCall.test.ts` | 4 | La llamada a Claude compartida usa el modelo vigente, sin `temperature` ni `tool_choice` forzado; si `ANTHROPIC_MODEL` no existe prueba el vigente; un rechazo cuenta como "sin resultado". | IATOS-031 |
| `retiredModels.test.ts` | 1 | Ningún archivo de `supabase/functions` usa un modelo retirado. | IATOS-031, 058 |
| `aiRecommendations.test.tsx` | 3 | El hook de recomendaciones comparte la petición y maneja el límite de frecuencia. | base |

### 2.5 Alertas, tareas programadas y operación (98)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `flightWatchRules.test.ts` | 19 | Reglas de alerta de vuelo: cancelación o retraso desde la primera revisión; puertas; "desconocido" = sin datos; retrasos menores a 15 min se ignoran; anti-rebote; medianoche; huella anti-duplicado; deja de vigilar al aterrizar. Los errores de proveedor, de cuota, sin datos o de otra fecha nunca cuentan como revisión exitosa; no guarda llaves. | IATOS-033, 065, 070 |
| `flightWatchRunner.test.ts` | 8 | Corrida: un vuelo y fecha se consulta una vez aunque lo sigan varios usuarios; manda push solo si el aviso se insertó; 5 a la vez; se detiene antes de ~100 s y cuando SerpApi agota la cuota; máximo de revisiones configurable (50 por omisión, tope de 200). | IATOS-033, 066, 067, 017 |
| `flightStatus.test.ts` | 10 | Normaliza el estado de vuelo de Google para la fecha pedida; nunca devuelve el estado de otro día. | IATOS-032 (parcial) |
| `trackFlightRules.test.ts` | 6 | `track-flight` exige fecha, rechaza vuelos pasados (salvo el nocturno de ayer) y fechas a más de ~11 meses; `localISODate` usa la zona del dispositivo. | IATOS-017, 044, 032 |
| `priceWatch.test.ts` | 13 | Alerta solo con una baja real de ≥5% y ≥$500 MXN; nunca por el tipo de cambio ni por un hueco entre proveedores; 20 h entre alertas; solo un nuevo mínimo vuelve a alertar; nunca compara monedas distintas. | IATOS-038 |
| `priceWatchCard.test.tsx` | 3 | La tarjeta de alerta de precio. | base |
| `pushCore.test.ts` | 5 | Sin VAPID no truena; con llaves inválidas se desactiva el push; TTL; borra las suscripciones 404/410. | IATOS-068 |
| `healthAlerts.test.ts` | 22 | Periodo de cron; salud de las tareas (falla si no corrió en 2 veces su periodo); cuándo mandar correo (solo si cambia algo, recordatorio semanal, reintento); destinatario `HEALTH_ALERT_EMAIL`; HTML escapado; redacción de secretos. | IATOS-069, 070, 034 (código) |
| `healthChecks.test.ts` | 4 | Proveedor caído o llave faltante = falla; Stripe en modo prueba o SerpApi bajo = aviso. | IATOS-015 (aviso) |
| `serviceHealthCard.test.tsx` | 2 | El panel avisa si el último chequeo tiene más de 26 h y muestra si falló el correo. | IATOS-069 |
| `notificationBell.test.tsx` | 4 | Conteo real de no leídos (9+); una alerta de vuelo abre su viaje. | IATOS-097 |
| `adminMetrics.test.tsx` | 2 | Métricas de administración y acceso negado a quien no es administrador. | base |

### 2.6 Flujos de usuario (38)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `onboardingRedirect.test.tsx` | 1 | Terminar el onboarding lleva al dashboard sin rebotar. Usa el `ProtectedRoute` y el `Onboarding` reales con Supabase simulado. | IATOS-005 |
| `onboardingSkip.test.tsx` | 6 | "Saltar por ahora" en los pasos 1 a 5; si guardar falla, avisa y no navega. | IATOS-090 |
| `planTripBack.test.tsx` | 3 | Atrás no vuelve a analizar ni duplica; montar otra vez la misma intención lleva al viaje ya creado; `?q` se borra al consumirse. | IATOS-042 |
| `resetPassword.test.tsx` | 6 | Recuperación con un *chunk* lento, tras recargar o por el *claim* `amr`; un enlace vencido muestra un mensaje claro. | IATOS-041 |
| `tripReanalysis.test.tsx` | 9 | Re-analizar actualiza el mismo viaje y nunca borra el id original; si RLS no deja actualizar, no borra nada; borrar o salir de un viaje reporta la verdad. | IATOS-008, 085 |
| `tripsPage.test.tsx` | 3 | Mis viajes: estado de carga; "Salir del viaje" para colaboradores; no muestra un falso "Viaje eliminado". | IATOS-085 |
| `reservas.test.tsx` | 2 | Separa las reservas confirmadas de los clics a socios. | IATOS-081 (parcial) |
| `analysisProgress.test.tsx` | 1 | El progreso del análisis nunca llega a 100% antes de tiempo. | IATOS-089 |
| `avatarCreator.test.tsx` | 3 | La galería y la cámara son botones separados y solo la cámara fuerza `capture`; formatos y 8 MB; cancelar no hace nada. | IATOS-113 |
| `emergencyNumbers.test.ts` | 4 | SOS: los países fuera de la lista no reciben 112 como dato; alias. | IATOS-043 |

### 2.7 Móvil, accesibilidad y offline (10)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `bottomNav.test.tsx` | 3 | Máximo 5 elementos, etiquetas de ≥12 px y áreas táctiles de ≥44 px; "Más" da acceso a todo; el compositor de Iato no queda oculto. Corre en jsdom, **no en un dispositivo**. | IATOS-087 |
| `formLabels.test.tsx` | 2 | No quedan `<label>` sin asociar; el Slider tiene un nombre accesible. | IATOS-088 |
| `serviceWorker.test.ts` | 5 | Sin red abre el *app shell* y los últimos 8 viajes; se borra al cerrar sesión; no intercepta escrituras. | IATOS-100 (parcial) |

---

## 3. Suites SQL (`supabase/tests/`)

**Requisitos:** `psql` y un PostgreSQL local vacío. `PGUSER` = `postgres` por omisión.

**Uso:**

```bash
PGHOST=/ruta/al/socket PGPORT=5432 supabase/tests/<suite>/run.sh [nombre_db]
```

Cada `run.sh` vuelve a crear la base y reproduce **todas** las migraciones del repo.

| Suite | Archivos | Qué prueba | Resultado hoy (local) | Hallazgos |
|---|---|---|---|---|
| **security** | `security/run.sh`, `00_roles.sql`, `01_supabase_stubs.sql`, `rls_attacks.sql` | **Ataques (deben fallar):** A1 un anónimo lista objetos; A2 el atacante ve objetos ajenos; A3 se vuelve colaborador de un viaje ajeno; A4 ve un perfil ajeno con una amistad falsa; A5 inserta vuelos directo. **Flujos legítimos (deben pasar):** L1 agregar amigo por código; L2 invitar; L3 aceptar; L4 el colaborador ve el viaje y la foto del diario; L5 el colaborador edita; L6 el colaborador no puede cambiar al dueño; L7 el dueño quita al colaborador. | **A1-A5 = 0 o "permission denied"; L1-L7 ok.** La migración de `pg_cron` falla (esperado). | IATOS-001, 002, 003, 016, 017 |
| **trip_quotes** | `security/trip_quotes.sql` (se corre después de `security/run.sh` sobre la misma base) | Q1 `quote_basis` al crear; Q2 versiones 1 y 2 con el dueño forzado; Q3 un estado de renglón inválido se rechaza y nadie puede hacer `UPDATE`; Q4 y Q5 el dueño y el colaborador leen; Q6 el atacante no; Q7 los usuarios no insertan ni borran; Q8 cambiar viajeros marca "recotizar"; Q9 una cotización nueva lo limpia; Q10 no se puede apuntar a la cotización de otro viaje; Q11 cascada al borrar el viaje. | **Q1-Q11 con el valor esperado.** | IATOS-080, 035 |
| **ops** | `ops/run.sh`, `flight_watch_claim.sql`, `cron_health.sql`, `concurrent_claim.sh` | Idempotencia (segunda pasada de las 7 `2026102213*`); T1-T2 `authenticated` no puede ejecutar `claim_tracked_flights`, `notify_once`, `cron_health` ni `verify_cron_secret`; T3-T6 reclamo por prioridad y límite; T4 retira vuelos sin fecha, pasados o aterrizados; T7 `notify_once` deduplica; T8 `cron_health` sin pg_cron; T9 `tracked_flight_gap`; C1 `cron_health` con tablas que imitan pg_cron y pg_net; **dos sesiones simultáneas** (`SKIP LOCKED`). | **Las 7 migraciones "ok" en la segunda pasada; T1-T9 y C1 como se esperaba; concurrencia: A reclamó AM1-AM3, B (con A abierta) AM4-AM6, C nada.** | IATOS-033, 044, 066, 067, 069, 032 |
| **payments** | `payments/run.sh`, `payments.sql` | Q1 un análisis gratis de por vida; Q2 3 mensajes al mes, el 4.º negado y el mes nuevo reinicia; Q3 PRO no descuenta; Q4 tipo desconocido; Q5 solo `service_role` ejecuta; S1-S8 sincronía de Stripe (orden, eventos viejos, otra suscripción, cancelación y vuelta, `comped` intacta, usuario desconocido, cortesía al terminar el pago); C1-C3 la cortesía exige correo confirmado y no pisa un pago; **concurrencia**: dos sesiones piden el análisis gratis y solo una lo obtiene. | **Todos "OK", incluido "OK CONCURRENCIA".** | IATOS-092, 045, 046, 055 (parcial), 047 |

**Suites EN DESARROLLO en `claude/wc-pay`** (no integradas y no ejecutadas por mí; NO VERIFICADO):

- `payments/quota_reservations.sql`: F1-F10, R1-R12, M1-M4;
- `payments/plan_limits.sql`: P1-P7;
- `payments/trial_no_card.sql`: T1-T8;
- `payments/plan_limits_recommended.sql`: L1-L6.

**No hay una prueba SQL** de los triggers de `profiles.active_trip_id` (migración `20261022131000`).

**Ninguna suite SQL corre en CI.**

---

## 4. Escenarios obligatorios contra cobertura

### 4.1 IATOS-111 · FREE-01: límite gratuito comprensible (10 escenarios del addendum)

Estado de la rama: el lector de 402 y el botón existen en PlanTrip y en multidestino. El código estable `FREE_LIMIT_REACHED`, el diálogo y la integración en Iato están EN DESARROLLO.

| # | Escenario | Cobertura en la rama | EN DESARROLLO (`wc-pay`) | Resultado |
|---|---|---|---|---|
| 1 | Cuota disponible | `payments.sql` Q2 (SQL); `quota.test.ts` (lógica) | F1 | AUTO-PARCIAL (sin pantalla) |
| 2 | Último mensaje permitido | `payments.sql` Q2 (`remaining`) | F2 | AUTO-PARCIAL |
| 3 | Primero después del límite | `payments.sql` Q2 (4.º negado); `quota.test.ts` (402 + `upgrade_url`); `functionErrors.test.ts` (mensaje + botón PRO) | F3; `freeLimitDialog.test.tsx` "concierge: copia con fecha y los dos botones" | AUTO-PARCIAL (Iato no tiene el diálogo en la rama) |
| 4 | Análisis agotado | `payments.sql` Q1; `functionErrors.test.ts` | F4; `freeLimitDialog.test.tsx` "sin promesa de renovación" | AUTO-PARCIAL |
| 5 | Usuario PRO | `payments.sql` Q3 | F5 | AUTO (SQL) |
| 6 | Usuario en prueba | `subscription.test.ts` (solo el cliente) | F6 | AUTO-PARCIAL |
| 7 | Usuario con cortesía | — | F7 | EN DESARROLLO |
| 8 | Renovación mensual | `payments.sql` Q2 (mes nuevo) | F8 | AUTO (SQL) |
| 9 | Error real de proveedor (no debe invitar a pagar) | `quota.test.ts` (error de verificación → 503, no el aviso de pago); `functionErrors.test.ts` (503) | M1 | AUTO-PARCIAL. **En la rama, un error del proveedor después de consumir sigue gastando la cuota** (ver 4.2). |
| 10 | Llamada directa a la función | `payments.sql` Q5 (las RPC solo para `service_role`) | F10 | AUTO-PARCIAL. **NO CUBIERTO** contra la Edge Function desplegada. |

### 4.2 IATOS-112 · FREE-02: un análisis fallido no gasta la oportunidad (12 escenarios)

**En esta rama la cuota se consume después de validar, pero antes de llamar a los proveedores.** Por eso las fallas posteriores siguen gastando la oportunidad gratuita: el defecto está vigente. La corrección (reservar, confirmar, liberar) está EN DESARROLLO.

| # | Escenario | Cobertura en la rama | EN DESARROLLO (`wc-pay`) | Resultado |
|---|---|---|---|---|
| 1 | *Timeout* | — | `reservation.test.ts` "timeout → libera…" | EN DESARROLLO |
| 2 | Error 500 | — | `quota_reservations.sql` R1 | EN DESARROLLO |
| 3 | Error de la IA | — | R1; M1 (chat) | EN DESARROLLO |
| 4 | Datos insuficientes | — | `requestKey.test.ts` "un análisis sin itinerario… es parcial (no se cobra)" | EN DESARROLLO |
| 5 | Resultado parcial | — | `requestKey.test.ts` "multi-ciudad con una ciudad vacía es parcial" | EN DESARROLLO |
| 6 | Falla al guardar | — | `reservation.test.ts` "si el timeout llega mientras guarda…" | EN DESARROLLO |
| 7 | Dos solicitudes simultáneas | `payments/run.sh` concurrencia (solo una obtiene el análisis) | R3/R4; `reservation.test.ts` | AUTO (SQL, consumo atómico) |
| 8 | Doble clic | `planTripBack.test.tsx` (parcial: misma intención, sin nuevo análisis) | R3; `reservation.test.ts` "doble clic (misma llave)" | AUTO-PARCIAL |
| 9 | Reintento por conexión perdida | — | R6; `reservation.test.ts` | EN DESARROLLO |
| 10 | Recarga del navegador | `planTripBack.test.tsx` (registro por intención en `sessionStorage`) | `requestKey.test.ts` "recarga del navegador" | AUTO-PARCIAL |
| 11 | Error después de completar | — | R7; `reservation.test.ts` | EN DESARROLLO |
| 12 | Abuso de reintentos | — | R9; `reservation.test.ts` "abuso con llaves nuevas" | EN DESARROLLO |

### 4.3 IATOS-113 · AVATAR-01: elegir foto (9 escenarios)

> La lista original de 9 escenarios del *addendum* de Lovable **no está en el repo**. La reconstruí a partir del texto de IATOS-113 (`IATOS_HALLAZGOS_PRIORIZADOS.md`, sección 5). Que coincida con la de Lovable es NO VERIFICADO.

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| 1 | "Elegir de mi galería" abre el selector sin `capture` | `avatarCreator.test.tsx` | AUTO (jsdom) |
| 2 | "Tomar una foto" usa `capture="user"` | `avatarCreator.test.tsx` | AUTO (jsdom) |
| 3 | Cancelar el selector no hace nada y no muestra error | `avatarCreator.test.tsx` | AUTO |
| 4 | Un formato no permitido o un archivo de más de 8 MB se rechaza con un mensaje | `avatarCreator.test.tsx` | AUTO (solo en el cliente; en el servidor: IATOS-054, ABIERTO) |
| 5 | "Saltar por ahora" sigue disponible | — | NO CUBIERTO |
| 6 | iPhone Safari | — | NO CUBIERTO |
| 7 | Android Chrome | — | NO CUBIERTO |
| 8 | Escritorio | — | NO CUBIERTO |
| 9 | Permiso de cámara rechazado | — | NO CUBIERTO |

### 4.4 Pruebas de aceptación del plan y la prueba (30, `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md`, sección 11)

| # | Prueba (resumen) | Cobertura | Resultado |
|---|---|---|---|
| 1 | Con el correo sin confirmar no hay prueba | `wc-pay` `trial_no_card.sql` T1/T2 | EN DESARROLLO |
| 2 | Al confirmar se crea una fila `trialing` de 30 días y un registro en `trial_grants` | `wc-pay` T2 | EN DESARROLLO |
| 3 | Un `trialing` sin `current_period_end` no puede ser PRO | `wc-pay` `plan_limits_recommended.sql` L1 (corrige `is_pro`, no agrega el CHECK que pide la propuesta) | EN DESARROLLO (enfoque distinto) |
| 4 | Una prueba vencida es GRATIS y conserva los datos | `wc-pay` T6 | EN DESARROLLO |
| 5 | Borrar y recrear la cuenta no da otra prueba | `wc-pay` T4 | EN DESARROLLO |
| 6 | Normalización de correo (`+alias`, puntos de Gmail, googlemail) | `wc-pay` T3 (googlemail: NO VERIFICADO) | EN DESARROLLO |
| 7 | Un dominio desechable no recibe prueba | — | NO CUBIERTO |
| 8 | Turnstile en el servidor | — | NO CUBIERTO |
| 9 | Con cortesía o Stripe vivo no hay prueba | `wc-pay` T5 (cortesía) | EN DESARROLLO (parcial) |
| 10 | GRATIS: el 4.º mensaje y el 2.º análisis responden 402 | `payments.sql` Q1/Q2; `quota.test.ts` | AUTO-PARCIAL (sin *handler*) |
| 11 | Un análisis con 502, 503 o 500 no gasta la oportunidad | `wc-pay` R1 | EN DESARROLLO (defecto vigente en la rama) |
| 12 | Dos análisis simultáneos: solo uno | `payments/run.sh` concurrencia | AUTO (SQL) |
| 13 | Una reserva vence en ≤10 min | `wc-pay` R11 | EN DESARROLLO |
| 14 | Topes de la prueba (6.º análisis, 3.º del día, mensaje 51) | `wc-pay` L3 (5 análisis); el resto NO VERIFICADO | EN DESARROLLO (parcial) |
| 15 | Topes de PRO (11.º análisis, mensaje 101, 4.º del día, reinicio mensual) | `wc-pay` P3, P4, L5 | EN DESARROLLO |
| 16 | Máximo 2 herramientas por vuelta y 3 llamadas al modelo | — (la rama permite 4 vueltas: `concierge-chat/loop.ts:17`) | NO CUBIERTO (el código no lo cumple) |
| 17 | Al pasar la bolsa de búsquedas en vivo, precios guardados | — | NO CUBIERTO (no implementado) |
| 18 | Topes de alertas por plan | `wc-pay` L6 (solo se siembran) | NO CUBIERTO |
| 19 | Topes de vuelos por plan; al terminar la prueba solo queda el más próximo | — (`track-flight` tiene 10 fijos) | NO CUBIERTO |
| 20 | Textos idénticos; sin "ilimitado", "Se requiere tarjeta" ni "Fixer 24/7" | `planCopy.test.ts` (9) | AUTO-PARCIAL (no revisa `FixerButton.tsx`, y los correos de los días 0, 23, 28 y 30 no existen) |
| 21 | Checkout sin `trial_period_days` con la prueba activa; opción B | `stripeCheckout.test.ts` (prueba de Stripe una sola vez) | AUTO-PARCIAL |
| 22 | Al terminar la prueba no hay cargo ni cliente en Stripe | `wc-pay` T6 | EN DESARROLLO (el panel de Stripe: MANUAL pendiente) |
| 23 | Precio `tax_behavior: inclusive`, total $99.00 | — | NO CUBIERTO (configuración de Stripe) |
| 24 | `clientIp` ignora un `X-Forwarded-For` falso | — | NO CUBIERTO |
| 25 | Un vuelo agregado 30 días antes gasta ≤20 búsquedas | — | NO CUBIERTO |
| 26 | `serpapi-quote` hace ≤1 consulta en vivo en 24 h | — | NO CUBIERTO |
| 27 | Multidestino: 7 ciudades se rechazan y 4 cuentan como 2 | — | NO CUBIERTO |
| 28 | Cada llamada deja una fila en `ai_usage_log` | — | NO CUBIERTO (no existe) |
| 29 | La consulta de detección (b) marca y no bloquea | — | NO CUBIERTO |
| 30 | 200 correos de confirmación en una hora | — | NO CUBIERTO (Resend) |

**Resumen de la 4.4:**

| Cobertura | Pruebas |
|---|---|
| AUTO | 1 (12) |
| AUTO-PARCIAL | 3 (10, 20, 21) |
| EN DESARROLLO | 12 (1, 2, 3, 4, 5, 6, 9, 11, 13, 14, 15, 22) |
| NO CUBIERTO | 14 (7, 8, 16, 17, 18, 19, 23 a 30) |
| **Total** | **30** |

### 4.5 Privacidad entre cuentas

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| P1 | Un anónimo no lista storage | `rls_attacks.sql` A1; en vivo el 2026-10-22: listado anónimo de `travel-moments` = `[]` | AUTO (local) + MANUAL (en vivo) |
| P2 | Un usuario no ve objetos ajenos | A2 | AUTO (local) |
| P3 | No se puede volver colaborador de un viaje ajeno | A3; en vivo: las políticas se eliminaron y se revocaron INSERT/UPDATE | AUTO (local) + MANUAL (en vivo) |
| P4 | No se ve un perfil ajeno con una amistad falsa | A4; en vivo: se revocaron los privilegios | AUTO (local) + MANUAL (en vivo) |
| P5 | No se insertan vuelos directo | A5; en vivo: se revocaron los privilegios | AUTO (local) + MANUAL (en vivo) |
| P6 | El colaborador no cambia al dueño | L6; en vivo: el trigger `trips_guard_owner` está presente | AUTO (local) + MANUAL (en vivo) |
| P7 | Las cotizaciones de un viaje ajeno no se leen | `trip_quotes.sql` Q6 | AUTO (local) |
| P8 | No se apunta a la cotización de otro viaje | Q10 | AUTO (local) |
| P9 | No se fija un viaje ajeno como activo | — (trigger `profiles_guard_active_trip` sin prueba en el repo) | NO CUBIERTO |
| P10 | No se borra la cuenta de otra persona | `deleteAccount.test.ts` | AUTO (lógica) |
| P11 | `send-email` no envía a terceros ni de un viaje ajeno | En vivo el 2026-10-22: 400, 403 y 401 | MANUAL (en vivo); sin prueba automática |
| P12 | Una nota "SISTEMA: …" de un colaborador no le da órdenes a Iato | `iatoEvals` E-15 (datos delimitados) | AUTO-PARCIAL (que un modelo real obedezca: NO CUBIERTO) |
| P13 | La caché offline se borra al cerrar sesión | `serviceWorker.test.ts` | AUTO |
| P14 | La memoria de Iato solo muestra y borra filas propias | — (depende de RLS; sin prueba) | NO CUBIERTO |
| P15 | Los amigos no ven el perfil completo (IATOS-053) | — | NO CUBIERTO (defecto abierto) |
| P16 | El usuario no edita columnas protegidas de `profiles` (IATOS-052) | — | NO CUBIERTO (defecto abierto) |

### 4.6 Estados de pago

| # | Estado o transición | Cobertura | Resultado |
|---|---|---|---|
| S1 | Sin suscripción → GRATIS | `subscription.test.ts` | AUTO |
| S2 | `trialing` de Stripe → PRO | `subscription.test.ts`; `payments.sql` S1 | AUTO |
| S3 | `active` | S2 | AUTO (SQL) |
| S4 | Un `past_due` tardío se ignora | S3; `stripeWebhook.test.ts` | AUTO |
| S5 | `past_due` → portal, sin checkout nuevo | `stripeCheckout.test.ts` | AUTO |
| S6 | `invoice.paid` saca de `past_due` | `stripeWebhook.test.ts` | AUTO |
| S7 | Cancelación propia y nueva suscripción | S5 | AUTO (SQL) |
| S8 | El `deleted` de otra suscripción no quita PRO | S4 | AUTO (SQL) |
| S9 | `comped` intacto ante Stripe; cortesía solo con correo confirmado; no pisa un pago; cortesía al terminar el pago | S6, S8, C1-C3 | AUTO (SQL) |
| S10 | Usuario desconocido o cuenta borrada | S7 | AUTO (SQL) |
| S11 | Una segunda suscripción se bloquea (409) | `stripeCheckout.test.ts` | AUTO |
| S12 | La prueba de Stripe solo una vez | `stripeCheckout.test.ts` | AUTO |
| S13 | Error de la base → 500 → Stripe reintenta | `stripeWebhook.test.ts` | AUTO |
| S14 | Verificación de la firma del webhook | — | NO CUBIERTO (el código existe; no tiene prueba) |
| S15 | Cobro real en modo *live* | — (Stripe en modo prueba) | NO CUBIERTO |
| S16 | IVA incluido: total $99.00 | — | NO CUBIERTO |
| S17 | Reembolso o disputa → acceso | — (no implementado, IATOS-049) | NO CUBIERTO |
| S18 | Prueba sin tarjeta (DEC-02) | `wc-pay` T1-T8 | EN DESARROLLO |
| S19 | Límites de PRO con el interruptor | `wc-pay` P2/P3, L5 | EN DESARROLLO |

### 4.7 Alertas

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| AL1 | Cancelación o retraso desde la primera revisión; cambios de puerta | `flightWatchRules.test.ts` | AUTO |
| AL2 | Un error de proveedor, de cuota, sin datos o de otra fecha nunca cuenta como revisión exitosa | `flightWatchRules.test.ts`, `flightWatchRunner.test.ts` | AUTO |
| AL3 | La corrida se detiene al agotar SerpApi | `flightWatchRunner.test.ts` | AUTO |
| AL4 | Un aviso se manda una sola vez (dedup) | `flightWatchRunner.test.ts`; SQL T7 | AUTO |
| AL5 | Dos corridas simultáneas no se pisan | `concurrent_claim.sh` | AUTO (local) |
| AL6 | Intervalo según la cercanía del vuelo; retirar vuelos aterrizados, pasados o sin fecha | SQL T3, T4, T9 | AUTO (local) |
| AL7 | Límite de tiempo de la corrida | `flightWatchRunner.test.ts` | AUTO |
| AL8 | Alerta de precio por una baja real; nunca por el tipo de cambio; 20 h entre alertas | `priceWatch.test.ts` | AUTO |
| AL9 | Push sin VAPID; suscripciones vencidas | `pushCore.test.ts` | AUTO |
| AL10 | Campana: conteo y clic | `notificationBell.test.tsx` | AUTO |
| AL11 | health-check detecta una tarea que no corre | `healthAlerts.test.ts`; SQL C1 | AUTO |
| AL12 | `price-watch-cron` con dos corridas encimadas | — (sin reclamo) | NO CUBIERTO |
| AL13 | El correo de alerta llega | — (dominio de Resend sin verificar) | NO CUBIERTO / BLOQUEADO |
| AL14 | El push llega a un dispositivo real | — | NO CUBIERTO |
| AL15 | Widget real de SerpApi en producción con un vuelo seguido | — (hay 0 vuelos en vivo) | NO CUBIERTO |
| AL16 | La tarea de vuelos corre en producción | En vivo: 32 corridas, 0 fallos (inventario de la auditoría); hoy existen 3 tareas | MANUAL (en vivo, versión vieja de la función) |

### 4.8 Móvil

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| M1 | Barra de 5 elementos y áreas táctiles de ≥44 px | `bottomNav.test.tsx` (jsdom) | AUTO-PARCIAL |
| M2 | El compositor de Iato es visible sobre la barra | `bottomNav.test.tsx` | AUTO-PARCIAL |
| M3 | Zoom permitido | `cookieConsent.test.tsx` (`index.html`) | AUTO |
| M4 | Los botones de afiliado abren en iOS | `trackBooking.test.ts` (simulado) | AUTO-PARCIAL |
| M5 | Avatar: galería o cámara | `avatarCreator.test.tsx` | AUTO-PARCIAL |
| M6 | Offline: *app shell* y viajes recientes | `serviceWorker.test.ts` | AUTO-PARCIAL |
| M7 | iPhone Safari real (onboarding, afiliados, avatar, compositor) | — | NO CUBIERTO |
| M8 | Android Chrome real | — | NO CUBIERTO |
| M9 | Push y PWA instalada en iOS | — | NO CUBIERTO |
| M10 | Rendimiento en móvil (IATOS-103) | — | NO CUBIERTO |

---

## 5. Suite de evaluación de Iato (`src/test/iatoEvals.test.ts`, 30 pruebas)

**Cómo funciona:** todas corren con el modelo y los proveedores **simulados**, e importan el código real de `supabase/functions/concierge-chat/*` y de `_shared/activeTrip.ts`.

**Qué casos necesitan un modelo real:** el propio archivo (líneas 1 a 5) dice que la parte que depende de cómo redacta un modelo real no está automatizada: E-12 (texto), E-15 (obediencia), E-17, E-18 y E-19 (recuerdo). **La definición de E-17 y E-18 no está en el repo**: viene del informe B, sección C-3, que no está versionado. NO VERIFICADO qué miden.

| Bloque | Prueba | ¿Necesita un modelo real para la parte que falta? |
|---|---|---|
| E-01 a E-04 · viaje en contexto | E-01 pregunta cuál viaje si "mi vuelo" es ambiguo · E-02 elige París cuando lo menciona y marca los datos del PDF como no verificados · E-03 usa el viaje en curso · E-04 "Japón" identifica Tokio · orden de prioridad · "restaurantes cerca" con viajes empatados no obliga a preguntar | No (es determinista) |
| E-05 a E-11 · herramientas y tarjetas | E-05 argumentos de `search_flights` · E-06 un resultado de 8 KB llega como datos · E-07 una búsqueda vacía da `{disponible:false}` y ninguna tarjeta con precio · E-08 `ai-fallback`: el modelo no ve opciones inventadas · `ai-fallback` por elemento · E-09 `search_hotels` y validación por noche o total · E-10 `flight-status` 503 · E-11 jet y equipaje sin precio · un vuelo u hotel sin búsqueda se descarta · tarjetas mal formadas se descartan | Que el modelo **pida** la herramienta correcta en una conversación real: sí |
| E-12 a E-14 · contexto y ubicación | E-12 *transfer* con el vuelo y el hotel del viaje · E-13 `search_nearby` con coordenadas numéricas · E-14 sin coordenadas no inventa | E-12: **sí** (el texto de la respuesta) |
| E-15/E-16 · *prompt injection* y roles | E-15 instrucciones incrustadas van como dato delimitado · se neutralizan los marcadores de rol · E-16 el cliente no puede mandar `system` o `tool`; historial acotado | E-15: **sí** (que el modelo no obedezca) |
| URLs | Solo `https` | No |
| E-19 · memoria | Incluye lo que el usuario dijo en otra sesión, sin duplicar y con tope | **Sí** (que el modelo lo recuerde y lo use) |
| E-20 · fecha local | Zona IANA del cliente; una entrada inválida se ignora | No |
| B-15 · paralelo y límite de tiempo | Herramientas en paralelo, una lenta devuelve `{error:'timeout'}` · la última vuelta fuerza `tool_choice: none` | No |
| B-02 · contrato de tarjetas | Los tipos del prompt están en el contrato del cliente · `parseModelJson` tolera bloques de código | No |
| E-17, E-18 | No automatizadas | **Sí** (definición fuera del repo) |

**Propuesta (no existe):** correr E-12, E-15, E-17, E-18 y E-19 contra el modelo real en un ambiente de prueba, con un presupuesto fijo de búsquedas y tokens, y guardar las respuestas para revisarlas.

---

## 6. Qué no tiene ninguna prueba automática

- **El *handler* completo de las 53 Edge Functions**: solo hay módulos puros y lógica extraída.
- La verificación de la firma de `stripe-webhook`.
- `send-email` (verificado solo en vivo).
- `concierge-action`, `enviar-email-fixer`, `logistics-plan` (el consumo de cuota dentro del *handler*), `serpapi-quote`, `parse-trip-file`, `generate-avatar` y las funciones de Google Maps.
- Los triggers de `profiles.active_trip_id`.
- `LiveTripQuote.tsx` (IATOS-076).
- Las pantallas de Gastos, TripDetail y Concierge completas (se prueban sus piezas).
- Que `planCopy.ts` coincida con lo que el sistema hace de verdad.

---

## 7. Qué NO se ha probado de punta a punta en producción

**Verificado en vivo el 2026-10-22** (la lista completa de lo verificado):

- F-01, F-02, F-03, F-05 y F-06 (parte de la base);
- F-04 (`send-email`);
- 53/53 funciones desplegadas (OPTIONS);
- RLS en 44/44 tablas;
- 3 tareas programadas.

**No verificado de punta a punta en producción:**

1. **Todo lo FIXED_IN_BRANCH.** Nada de la rama, salvo `send-email`, está desplegado. Producción corre las funciones viejas y las 7 migraciones `2026102213*` no están aplicadas.
2. **Un análisis de viaje real** con Claude, SerpApi, Travelpayouts y Perplexity: tokens, costo, tiempo y la exactitud de los precios contra el sitio del proveedor.
3. **Iato con un modelo real**: que llame a las herramientas correctas, que no obedezca una inyección, que recuerde y qué modelo responde de verdad detrás de `gemini-flash-latest`.
4. **Cobro real con Stripe**: modo *live*, IVA, webhook con firma real, portal, cancelación, reembolso. Stripe está en modo prueba y hay 0 pagos.
5. **Correo**: bienvenida, cotización, invitación, alertas, Fixer. El dominio de Resend no está verificado; la entrega a usuarios es NO VERIFICADO.
6. **Seguimiento de vuelos y alertas de precio con datos reales**: hay 0 vuelos y 0 alertas en vivo. La función de vuelos corre, pero sin filas que revisar.
7. **Push web** a un dispositivo real.
8. **Cuotas GRATIS en producción**: las 11 cuentas son de cortesía y `usage_limits` tiene 0 filas, así que la cuota gratuita nunca se ha ejercido en producción.
9. **Flujos en dispositivos reales**: onboarding, avatar, afiliados en iOS, navegación móvil, modo offline.
10. **Recuperación de contraseña** con el correo real de Supabase Auth.
11. **Concurrencia en producción**: dos corridas de cron encimadas, o dos análisis simultáneos.
12. **Carga**: fuera de alcance desde la auditoría.

---

## 8. Cómo reproducir esta medición

```bash
# Vitest (sin red ni producción)
cd /home/user/wanderly-ai-concierge
npx vitest run                                   # esperado hoy: 392 passed (59 files)
npx vitest run --reporter=json --outputFile=/tmp/vitest.json

# Tipos
npx tsc --noEmit -p tsconfig.app.json            # esperado: sin salida, código 0

# SQL (Postgres local vacío; nunca producción)
export PGHOST=/ruta/socket PGPORT=5432
supabase/tests/security/run.sh iatos_rls_test
psql -U postgres -d iatos_rls_test -f supabase/tests/security/trip_quotes.sql
supabase/tests/ops/run.sh iatos_ops_test
supabase/tests/payments/run.sh iatos_pay_test
```
