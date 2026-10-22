# IATOS: matriz de pruebas

- **Fecha:** 2026-10-22.
- **Código medido:** rama `claude/iatos-world-class`, commit `f4c4c72`, con el árbol limpio.
  - `dff3bcc` (solo documentos) quedó encima; el código no cambia.
  - Mientras se redactaba este documento, el grupo de pagos fusionó su trabajo: `d550aac` pasó a `f4c4c72`. Se midieron los dos commits.
- **Para quién es:**
  - los fundadores, para saber qué está demostrado y qué no;
  - Sebastián Mathus (NEXTIA), para auditar la cobertura.
- **Documentos hermanos:**
  - [IATOS_ARQUITECTURA_OBJETIVO.md](./IATOS_ARQUITECTURA_OBJETIVO.md)
  - [IATOS_PLAN_MEJORAS.md](./IATOS_PLAN_MEJORAS.md)
  - [IATOS_HALLAZGOS_PRIORIZADOS.md](./IATOS_HALLAZGOS_PRIORIZADOS.md)
  - [IATOS_E2E_EVIDENCE.md](./IATOS_E2E_EVIDENCE.md): evidencia E2E de **otra sesión**, que yo no volví a ejecutar.

---

## 0. Qué se midió, cómo y qué significa

| Medición | Comando | `d550aac` (02:49 UTC) | **`f4c4c72` (03:08 UTC, vigente)** |
|---|---|---|---|
| Vitest | `npx vitest run --reporter=json --outputFile=/tmp/claude-0/-home-user-reto/8647f9df-5459-5399-a533-ae256c643445/scratchpad/vitest.json` | 392/392 · 59 archivos | **434/434 · 62 archivos · 0 fallas · 0 omitidas** |
| Tipos | `npx tsc --noEmit -p tsconfig.app.json` | 0 errores | 0 errores (corrido sobre `dff3bcc`, con el mismo código) |
| Suites SQL | `supabase/tests/{security,ops,payments}/run.sh` y `security/trip_quotes.sql` sobre un PostgreSQL 16.15 local desechable (**nunca producción**) | Todas como se esperaba | **Todas como se esperaba** (sección 3) |

**Una corrida que no cuenta.** Hubo una corrida anterior (02:4x UTC) que coincidió con una fusión temporal en el mismo directorio. Dio 383 pruebas y 4 archivos no cargaron. No se cuenta.

**Qué prueba una prueba de Vitest en este repo:**

- **Sí prueba:** el código real del repo, importado directamente. Por ejemplo, `src/test/budget.test.ts` importa `supabase/functions/analizar-viaje/budget.ts`.
- **Está simulado:** Supabase, `fetch` y los modelos de IA.
- **No prueba:** que una Edge Function desplegada se comporte igual. **Ninguna prueba ejecuta un *handler* completo contra un Supabase real.**

**Qué prueba una suite SQL:**

- **Sí prueba:** las migraciones del repo, reproducidas en un Postgres limpio con un *shim* mínimo de Supabase (`supabase/tests/security/00_roles.sql`, `01_supabase_stubs.sql`).
- **No prueba:** producción.
- **Falla esperada:** la migración de `pg_cron` falla en local. Los propios scripts lo advierten.

**Valores en la matriz de escenarios (sección 4):**

| Valor | Significado |
|---|---|
| **AUTO** | Cubierto por una prueba automática que pasa hoy en `f4c4c72`. |
| **AUTO-PARCIAL** | Cubierta solo una parte: la lógica pero no la pantalla, o el SQL pero no el *handler*. |
| **E2E-PROD** | Observado de punta a punta en producción por la sesión de `IATOS_E2E_EVIDENCE.md`, con el ID de esa evidencia. **No lo volví a ejecutar.** Recordatorio: producción corre las funciones **viejas**. |
| **E2E-RAMA** | Observado por esa misma sesión en un build local del frontend de la rama (`8393649` o `f4c4c72`) conectado al backend de producción. Solo prueba el frontend nuevo. |
| **MANUAL** | Verificado en vivo el 2026-10-22, según los hechos que me dieron. |
| **NO CUBIERTO** | Ni prueba ni verificación. |

**Las piezas del grupo de pagos** (reservas, `plan_limits`, prueba sin tarjeta) ya están en la rama y sus pruebas pasan, pero están **apagadas** (`app_flags` en `false`) y **sin desplegar**. AUTO aquí significa que pasan en local con el interruptor encendido dentro de la prueba, no que estén activas en producción.

---

## 1. Resumen por área (`f4c4c72`)

| Área | Archivos | Pruebas |
|---|---|---|
| Seguridad y privacidad | 3 | 14 |
| Pagos, cuotas y textos comerciales | 10 | 95 |
| Dinero, cotizaciones, procedencia y afiliados | 17 | 110 |
| Iato (concierge e IA) | 7 | 69 |
| Alertas, tareas programadas y operación | 12 | 98 |
| Flujos de usuario | 10 | 38 |
| Móvil, accesibilidad y offline | 3 | 10 |
| **Total** | **62** | **434** |

Además hay 9 archivos de pruebas SQL en 4 suites (sección 3).

---

## 2. Inventario de pruebas Vitest (archivo → qué prueba → hallazgos)

Los conteos salen del JSON de Vitest. Todos los archivos están en `src/test/`.

### 2.1 Seguridad y privacidad (14)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `deleteAccount.test.ts` | 2 | Borrar la cuenta exige las dos confirmaciones y rechaza un `user_id` ajeno. Importa `supabase/functions/delete-account/validation.ts`. | base (relacionado: IATOS-050) |
| `cronAuth.test.ts` | 9 | La autenticación de cron falla cerrado: rechaza que no haya credenciales, un secreto vacío, un secreto equivocado y un JWT de usuario. Compara en tiempo constante y consulta el secreto en Vault. | IATOS-096 |
| `cookieConsent.test.tsx` | 3 | Si el usuario no elige, no arrancan PostHog ni Travelpayouts. "Solo esenciales" no carga nada. `index.html` permite el zoom. | IATOS-056, 088 |

### 2.2 Pagos, cuotas y textos comerciales (95)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `reservation.test.ts` | 17 | **IATOS-112 (FREE-02):** el análisis libera la cuota si hay error 500, caída de la IA, datos insuficientes, resultado parcial, falla al guardar o *timeout*. Si el *timeout* llega mientras guarda, espera y confirma. Si sale bien, confirma una sola vez. Con dos peticiones simultáneas, una recibe `in_progress`. El doble clic no genera otro análisis. Un reintento devuelve el viaje ya guardado sin cobrar. Si falla el commit, reintenta. Si el usuario abusa con llaves nuevas, solo se confirma uno. Si la reserva no se puede verificar, se niega (falla cerrado). También revisa el contrato mínimo del análisis y del multidestino. | IATOS-112, 047, 092 |
| `requestKey.test.ts` | 5 | La llave por intento vive en `sessionStorage`: se repite en el doble clic, sobrevive a la recarga, se limpia al terminar y funciona en modo privado. | IATOS-112 |
| `freeLimitDialog.test.tsx` | 3 | El diálogo de límite muestra la fecha y los dos botones. En el análisis de una sola vez no promete renovación. Si el plan ya es de pago, no ofrece PRO. | IATOS-111 |
| `functionErrors.test.ts` | 13 | El frontend reconoce el **código** `FREE_LIMIT_REACHED`, no el texto, y abre el diálogo (no un *toast*). Un error real del proveedor (`SERVICE_UNAVAILABLE`) muestra reintento, sin vender PRO. Los mensajes internos nunca llegan al usuario. Sesión, análisis en curso, ritmo y red tienen mensajes propios. Un 402 de un servidor viejo también abre el diálogo. Los textos son los mismos en cliente y servidor. | IATOS-111, 022 |
| `quota.test.ts` | 10 | Contrato de `FREE_LIMIT_REACHED`: solo campos seguros y fecha de renovación. Una sola vez → `renews_at: null`. Plan de pago → sin oferta. PRO con el interruptor conserva la renovación. Falla técnica → 503 `SERVICE_UNAVAILABLE`. Petición repetida → 409 `ANALYSIS_IN_PROGRESS`. Sin sesión → 401. `trip_analysis` falla cerrado. | IATOS-111, 048 (parcial) |
| `stripeCheckout.test.ts` | 17 | Responde 409 sin llamar a Stripe cuando la suscripción está `comped`, `active`, `trialing` o `past_due`. `past_due` lleva al portal. La prueba de Stripe se da una sola vez. El regreso solo va a dominios propios. **DEC-02:** con la prueba sin tarjeta vigente, Stripe no da otra prueba y el primer cobro espera a que termine (mínimo 48 h). Si la prueba ya venció, se cobra desde el día 1. Con el interruptor apagado, todo sigue como antes. | IATOS-018, 020, 046, 096, 012 |
| `stripeWebhook.test.ts` | 12 | Un error de la base responde 500 para que Stripe reintente. Usa el estado vivo de Stripe. `invoice.paid` sí se procesa. `deleted` actúa sobre su propia suscripción. Los eventos no manejados se aceptan. **No prueba la verificación de la firma.** | IATOS-019, 045 |
| `subscription.test.ts` | 3 | `useSubscription`: sin suscripción no es PRO; en prueba sí es PRO. | base |
| `planCopy.test.ts` | 9 | Landing, Auth, Pro, ProGate, Legal, `_shared/email.ts` y `concierge-chat/prompt.ts` leen la misma fuente y no usan frases prohibidas. **No revisa `src/components/FixerButton.tsx`**, que todavía dice "en minutos". **Tampoco revisa que la prueba anunciada esté encendida.** | IATOS-012 (textos), 013, 089, 093 |
| `referral.test.ts` | 6 | Atribución de referidos. | base |

### 2.3 Dinero, cotizaciones, procedencia y afiliados (110)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `budget.test.ts` | 13 | Habitaciones = ⌈viajeros/2⌉. Ejemplo: 6 viajeros, $5,000 por noche y 5 noches dan $75,000. El total es la suma exacta del desglose. Respeta "ya tengo vuelos" y "sin hotel". Prueba el código real de `analizar-viaje/budget.ts`. | IATOS-009, 037, 063 |
| `fx.test.ts` | 10 | Nunca convierte 1:1 a ciegas. Da subtotales por moneda. Usa fechas locales. La tasa trae su fuente y su fecha, y se marca cuando es de respaldo. | IATOS-010, 073, 074, 082 |
| `quote.test.ts` | 11 | La cotización queda desactualizada si cambian los viajeros o las fechas. Muestra vigencia. El desglose usa las selecciones: noche × noches × habitaciones. | IATOS-035, 075, 080 |
| `quoteSnapshot.test.ts` | 6 | El *snapshot* cuadra: renglones = desglose = total. Si el tipo de cambio es de respaldo, nada queda COTIZADO. Maneja exclusiones y opcionales. Si la tabla no existe, no rompe. | IATOS-080 |
| `realTripTotal.test.ts` | 3 | Muestra el total real y cuánto excede el presupuesto. | IATOS-007 |
| `tripSources.test.ts` | 10 | `enforceSources`: un vuelo u hotel "en vivo" que no salió de la consulta de esa petición pasa a estimado. | IATOS-026 |
| `logisticsProvenance.test.ts` | 4 | En `logistics-plan`, el modelo no decide qué es "en vivo". | IATOS-026 |
| `editReconcile.test.ts` | 5 | En `editar-viaje-ai`, lo que no se volvió a consultar no puede decir "en vivo". | IATOS-027 |
| `provenance.test.ts` | 16 | Los 6 estados de procedencia. Vigencia de 24 h. Travelpayouts aparece como "caché ≤48 h". Sin fuente, dice "Sin fuente". | IATOS-026, 057 |
| `priceSourceBadge.test.tsx` | 4 | La insignia es honesta: "Sin fuente", OBSOLETO con su antigüedad, y no dice "verificado" para Travelpayouts. | IATOS-057 |
| `tripSavings.test.ts` | 5 | Calculadora de ahorro. | base |
| `tpParams.test.ts` | 5 | Viaje redondo con `one_way=false`. *Marker* sin partes del token. Enlace de respaldo con fechas DDMM. | IATOS-036, 040, 078 |
| `affiliateLinks.test.ts` | 4 | Los enlaces de afiliado llevan el *marker*. | base |
| `trackBooking.test.ts` | 3 | Abre la ventana del socio antes de cualquier `await`, que es lo que exige Safari en iOS. | IATOS-039 |
| `liveSearchFallback.test.ts` | 4 | Si fallan los proveedores, `flights-search` y `hotels-search` devuelven `results: []` y `disponible: false`; nunca inventan. | IATOS-024, 057 |
| `detectRouteIntent.test.ts` | 3 | Detección de multidestino. | base |
| `parseTripFallback.test.ts` | 4 | Interpretación de texto libre en el cliente. | base |

### 2.4 Iato (concierge e IA) (69)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `iatoEvals.test.ts` | 30 | Suite de evaluación determinista E-01 a E-20 (detalle en la sección 5). | IATOS-006, 023, 024, 025, 026, 028, 029, 032, 059, 060, 094 |
| `conciergeCards.test.tsx` | 17 | Dibuja las 8 tarjetas. Ningún precio aparece sin fuente. Bloquea `javascript:`. El transporte usa su propio enlace. Jet y equipaje dicen "recibida" solo cuando hay folio. FixerButton guarda el estado real. | IATOS-023, 025, 030 (parcial), 061 |
| `conciergeTools.test.ts` | 7 | Mapea bien los argumentos. `slimToolResult` siempre deja JSON válido. | IATOS-006 |
| `aiFetch.test.ts` | 7 | Cadena de modelos: Gemini → `flash-latest` → Lovable, con traducción del alias. | IATOS-058 |
| `claudeCall.test.ts` | 4 | La llamada a Claude compartida: modelo vigente y respaldo cuando hay rechazo. | IATOS-031 |
| `retiredModels.test.ts` | 1 | Ninguna función usa un modelo retirado. | IATOS-031, 058 |
| `aiRecommendations.test.tsx` | 3 | Hook de recomendaciones. | base |

### 2.5 Alertas, tareas programadas y operación (98)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `flightWatchRules.test.ts` | 19 | Reglas de alerta de vuelo. Ni un error del proveedor ni una cuota agotada cuentan como éxito. No guarda llaves. | IATOS-033, 065, 070 |
| `flightWatchRunner.test.ts` | 8 | Consulta una vez por vuelo y fecha. Manda push solo si el aviso se insertó. Procesa 5 a la vez. Respeta un límite de tiempo. Se detiene al agotar la cuota. Lee de la configuración el máximo de revisiones. | IATOS-033, 066, 067, 017 |
| `flightStatus.test.ts` | 10 | Estado de vuelo normalizado, solo para la fecha pedida. | IATOS-032 (parcial) |
| `trackFlightRules.test.ts` | 6 | `track-flight` exige fecha y un rango válido. `localISODate` usa la zona horaria del usuario. | IATOS-017, 044, 032 |
| `priceWatch.test.ts` | 13 | Alerta de precio solo con una baja real de al menos 5% y $500. Nunca por tipo de cambio. Deja 20 h entre alertas. Nunca compara monedas distintas. | IATOS-038 |
| `priceWatchCard.test.tsx` | 3 | La tarjeta de alerta de precio. | base |
| `pushCore.test.ts` | 5 | Funciona sin VAPID y con VAPID inválido, con TTL, y limpia suscripciones 404 y 410. | IATOS-068 |
| `healthAlerts.test.ts` | 22 | Salud de las tareas programadas. Cuándo mandar correo y a quién. Escapa HTML y redacta secretos. | IATOS-069, 070, 034 (código) |
| `healthChecks.test.ts` | 4 | Fallas y avisos del chequeo de proveedores. | IATOS-015 (aviso) |
| `serviceHealthCard.test.tsx` | 2 | Avisa si el chequeo tiene más de 26 h y si falló el correo. | IATOS-069 |
| `notificationBell.test.tsx` | 4 | Conteo real de avisos y destino de cada uno. | IATOS-097 |
| `adminMetrics.test.tsx` | 2 | Panel de administración. | base |

### 2.6 Flujos de usuario (38)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `onboardingRedirect.test.tsx` | 1 | Terminar el onboarding no rebota entre pantallas. | IATOS-005 |
| `onboardingSkip.test.tsx` | 6 | "Saltar por ahora" en los pasos 1 a 5. Si guardar falla, no navega. | IATOS-090 |
| `planTripBack.test.tsx` | 3 | Atrás no vuelve a analizar ni duplica el viaje. `?q` se consume una sola vez. **No cubre el caso N-09** (`?q` sin cuota). | IATOS-042 |
| `resetPassword.test.tsx` | 6 | Recuperación con *chunk* lento, después de recargar, con el *claim* `amr` y con un enlace vencido. | IATOS-041 |
| `tripReanalysis.test.tsx` | 9 | Re-analizar actualiza el mismo viaje. Borrar y salir de un viaje dicen la verdad. | IATOS-008, 085 |
| `tripsPage.test.tsx` | 3 | Mis viajes: estado de carga y "Salir del viaje". | IATOS-085 |
| `reservas.test.tsx` | 2 | Separa las reservas confirmadas de los clics. | IATOS-081 (parcial) |
| `analysisProgress.test.tsx` | 1 | El progreso nunca llega a 100% antes de tiempo. | IATOS-089 |
| `avatarCreator.test.tsx` | 3 | Galería y cámara están separadas. Valida formato y 8 MB. Cancelar no hace nada. | IATOS-113 |
| `emergencyNumbers.test.ts` | 4 | SOS: el 112 no se presenta como dato si no está confirmado. | IATOS-043 |

### 2.7 Móvil, accesibilidad y offline (10)

| Archivo | Pruebas | Qué demuestra | Hallazgos |
|---|---|---|---|
| `bottomNav.test.tsx` | 3 | La barra tiene 5 elementos, con objetivos de al menos 44 px y el compositor visible. Corre en jsdom, **no en un dispositivo**. | IATOS-087 |
| `formLabels.test.tsx` | 2 | Etiquetas asociadas y Slider con nombre accesible. | IATOS-088 |
| `serviceWorker.test.ts` | 5 | Abre sin red y guarda los últimos 8 viajes. Se borra al cerrar sesión. | IATOS-100 (parcial) |

---

## 3. Suites SQL (`supabase/tests/`)

**Requisitos:** `psql` y un PostgreSQL local vacío. Por omisión, `PGUSER` = `postgres`.

**Uso:**

```bash
PGHOST=/ruta/al/socket PGPORT=5432 supabase/tests/<suite>/run.sh [nombre_db]
```

Cada `run.sh` vuelve a crear la base y reproduce **todas** las migraciones del repo (60 en `f4c4c72`).

| Suite | Archivos | Qué prueba | Resultado hoy en `f4c4c72` (local) | Hallazgos |
|---|---|---|---|---|
| **security** | `security/run.sh`, `00_roles.sql`, `01_supabase_stubs.sql`, `rls_attacks.sql` | **Ataques A1-A5:** un anónimo lista objetos; un atacante ve objetos ajenos, se vuelve colaborador de un viaje ajeno, ve un perfil ajeno con una amistad falsa o inserta vuelos. **Flujos legítimos L1-L7:** agregar amigo, invitar, aceptar, que el colaborador vea y edite, que el colaborador **no** pueda cambiar al dueño y que el dueño lo quite. | **A1-A5 = 0 o "permission denied"; L1-L7 bien.** | IATOS-001, 002, 003, 016, 017 |
| **trip_quotes** | `security/trip_quotes.sql`, que se corre después de `security/run.sh` sobre la misma base | Q1-Q11: base de la cotización, versiones, solo inserción, quién lee, recotización al cambiar viajeros, no apuntar a la cotización de otro viaje y borrado en cascada. | **Q1-Q11 con el valor esperado.** | IATOS-080, 035 |
| **ops** | `ops/run.sh`, `flight_watch_claim.sql`, `cron_health.sql`, `concurrent_claim.sh` | Idempotencia: segunda pasada de las 11 migraciones `2026102213*`. T1-T2: permisos. T3-T6: reclamo de vuelos. T4: retiro de vuelos. T7: `notify_once`. T8-T9: `cron_health` y los intervalos. C1: `cron_health` con tablas que imitan pg_cron y pg_net. Además, **dos sesiones simultáneas** con `SKIP LOCKED`. | **Las 11 migraciones "ok" en la segunda pasada. T1-T9 y C1 bien. Concurrencia: A reclamó AM1-AM3, B (con A abierta) AM4-AM6 y C nada.** | IATOS-033, 044, 066, 067, 069, 032 |
| **payments** | `payments/run.sh`, `payments.sql`, `quota_reservations.sql`, `plan_limits.sql`, `trial_no_card.sql`, `plan_limits_recommended.sql` | **Q1-Q5:** cuota gratuita y permisos. **S1-S8:** sincronía con Stripe. **C1-C3:** cortesía. **F1-F10:** límite gratuito (IATOS-111). **R1-R12:** reservas (IATOS-112). **M1-M4:** mensajes de Iato. **P1-P7:** `plan_limits` y los interruptores. **T1-T8:** prueba sin tarjeta. **L1-L7:** límites recomendados e `is_pro`. **Dos casos de concurrencia:** `consume_free_quota` y `reserve_quota`. | **Todo "OK"**, incluidos "OK CONCURRENCIA trip_analysis" y "OK CONCURRENCIA reserve_quota". | IATOS-092, 045, 046, 055 (parcial), 047, 111, 112, 012, 013, 014 |

**Pendientes de cobertura SQL:**

- No hay una prueba SQL de los triggers de `profiles.active_trip_id` (migración `20261022131000`).
- **Ninguna suite SQL corre en CI.**

---

## 4. Escenarios obligatorios contra cobertura

### 4.1 IATOS-111 · FREE-01: límite gratuito comprensible (los 10 escenarios del *addendum*)

| # | Escenario | Automatizado (`f4c4c72`) | E2E | Resultado |
|---|---|---|---|---|
| 1 | Cuota disponible | SQL F1; `quota.test.ts` | E2E-PROD D1 y D2 (200) | AUTO |
| 2 | Último mensaje permitido | SQL F2 | E2E-PROD D3 (3.er mensaje, 200) | AUTO |
| 3 | Primer mensaje después del límite | SQL F3; `quota.test.ts` (3); `functionErrors.test.ts`; `freeLimitDialog.test.tsx` | E2E-PROD D4a/D4b: el servidor responde 402, pero el usuario ve "non-2xx" (defecto de PROD). E2E-RAMA H-2 (`f4c4c72`): aparece el diálogo correcto. | AUTO; en PROD sigue el defecto |
| 4 | Análisis agotado | SQL F4; `quota.test.ts` (4); `freeLimitDialog.test.tsx` | E2E-PROD D6a/D6b: 402, y el usuario ve "non-2xx". E2E-RAMA B-09 (`8393649`): aviso con PRO. **E2E-RAMA H-4 (`f4c4c72`), con `?q=`: no aparece nada (N-09).** | AUTO; **posible regresión N-09** |
| 5 | Usuario PRO | SQL F5, Q3 | E2E-PROD D7 (200) | AUTO |
| 6 | Usuario en prueba | SQL F6; `subscription.test.ts` | — | AUTO |
| 7 | Usuario con cortesía | SQL F7 | — | AUTO |
| 8 | Renovación mensual | SQL F8, Q2 | — | AUTO (SQL) |
| 9 | Error real del proveedor | `quota.test.ts` (9); `functionErrors.test.ts` (9); SQL M1 | — | AUTO |
| 10 | Llamada directa a la función | SQL F10 (`permission denied` para `authenticated`) | E2E-PROD D4a/D6a: la función, llamada desde la app, responde 402 | AUTO-PARCIAL (sin llamada directa a la función desplegada con la versión nueva) |

### 4.2 IATOS-112 · FREE-02: un análisis fallido no gasta la oportunidad (12 escenarios)

En `f4c4c72` la cuota se **reserva**, se **confirma** solo cuando el resultado es válido y quedó guardado, y se **libera** ante cualquier falla. **En producción no**: corren las funciones viejas, que consumen la cuota antes de llamar a los proveedores.

| # | Escenario | Automatizado (`f4c4c72`) | Resultado |
|---|---|---|---|
| 1 | *Timeout* | `reservation.test.ts` "timeout → libera…" | AUTO |
| 2 | Error 500 | `reservation.test.ts` "error 500 / excepción"; SQL R1 | AUTO |
| 3 | Error de la IA | `reservation.test.ts` "caída del proveedor de IA"; SQL M1 (chat) | AUTO |
| 4 | Datos insuficientes | `reservation.test.ts` "datos insuficientes"; "un análisis sin itinerario… es parcial" | AUTO |
| 5 | Resultado parcial | `reservation.test.ts` "resultado parcial inaceptable"; "multi-ciudad con una ciudad vacía" | AUTO |
| 6 | Falla al guardar | `reservation.test.ts` "fallo al guardar" y "si el timeout llega mientras guarda…" | AUTO |
| 7 | Dos solicitudes simultáneas | `reservation.test.ts`; SQL R3/R4; "OK CONCURRENCIA reserve_quota" | AUTO |
| 8 | Doble clic | `reservation.test.ts` "doble clic (misma llave)"; `requestKey.test.ts` | AUTO |
| 9 | Reintento después de perder la conexión | `reservation.test.ts`; SQL R6 | AUTO |
| 10 | Recarga del navegador | `requestKey.test.ts` "recarga del navegador"; `planTripBack.test.tsx` | AUTO |
| 11 | Error después de completar | `reservation.test.ts`; SQL R7 | AUTO |
| 12 | Abuso de reintentos | `reservation.test.ts` "abuso con llaves nuevas"; SQL R9 | AUTO |

**Límite común a los 12:** prueban la orquestación (`_shared/reservation.ts`) con dependencias simuladas, más el SQL local. **Ninguno corre contra la función desplegada.** El E2E no forzó fallas en producción.

### 4.3 IATOS-113 · AVATAR-01: elegir la foto (9 escenarios)

> La lista original de 9 escenarios del *addendum* de Lovable **no está en el repo**. La reconstruí a partir del texto de IATOS-113 (`IATOS_HALLAZGOS_PRIORIZADOS.md`, sección 5). Que coincida con la lista de Lovable: NO VERIFICADO.

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| 1 | "Elegir de mi galería" abre el selector sin `capture` | `avatarCreator.test.tsx`; E2E-RAMA B-04 (`capture=null`) | AUTO + E2E-RAMA (emulación) |
| 2 | "Tomar una foto" usa `capture="user"` | `avatarCreator.test.tsx`; E2E-RAMA B-04 | AUTO + E2E-RAMA (emulación) |
| 3 | Cancelar no hace nada | `avatarCreator.test.tsx` | AUTO |
| 4 | Un formato inválido o más de 8 MB se rechaza | `avatarCreator.test.tsx` | AUTO (solo en el cliente; el servidor sigue sin validar, IATOS-054) |
| 5 | "Saltar por ahora" sigue disponible | — | NO CUBIERTO |
| 6 | iPhone Safari | — (el E2E fue con emulación de Chromium) | NO CUBIERTO |
| 7 | Android Chrome | — | NO CUBIERTO |
| 8 | Escritorio | — | NO CUBIERTO |
| 9 | Permiso de cámara rechazado | — | NO CUBIERTO |

En PROD sigue el defecto: hay un solo input con `capture="user"` (E2E-PROD B-04).

### 4.4 Pruebas de aceptación del plan y la prueba sin tarjeta (las 30 de `IATOS_PROPUESTA_PLANES_Y_PRUEBA.md`, sección 11)

| # | Prueba (resumen) | Cobertura | Resultado |
|---|---|---|---|
| 1 | Sin confirmar el correo no hay prueba | SQL T1/T2. **Advertencia:** según el E2E, Auth hoy no exige confirmar el correo | AUTO (SQL), con la condición de Auth en contra |
| 2 | Al confirmar se crea una fila `trialing` de 30 días y un registro en `trial_grants` | SQL T2 (que `source='app_trial'` exista: NO VERIFICADO) | AUTO-PARCIAL |
| 3 | Un `trialing` sin `current_period_end` no puede ser PRO | SQL L1 (corrige `is_pro`; no agrega el CHECK que pide la propuesta) | AUTO-PARCIAL |
| 4 | Una prueba vencida pasa a GRATIS y conserva los datos | SQL T6 | AUTO |
| 5 | Borrar la cuenta y volver a registrarse no da otra prueba | SQL T4 | AUTO |
| 6 | Normalización de correos | SQL T3 (googlemail: NO VERIFICADO) | AUTO-PARCIAL |
| 7 | Un dominio desechable no recibe prueba | — | NO CUBIERTO |
| 8 | Turnstile se valida en el servidor | — | NO CUBIERTO |
| 9 | Con cortesía o con Stripe vivo no hay prueba | SQL T5 (cortesía) | AUTO-PARCIAL |
| 10 | GRATIS: el 4.º mensaje y el 2.º análisis responden 402 | SQL Q1/Q2, F3/F4; `quota.test.ts`; E2E-PROD D4a/D6a | AUTO + E2E-PROD |
| 11 | Un análisis con 502, 503 o 500 no gasta la oportunidad | `reservation.test.ts`; SQL R1 | AUTO |
| 12 | Dos análisis simultáneos: solo uno pasa | SQL de concurrencia (los 2 casos); `reservation.test.ts` | AUTO |
| 13 | Una reserva vence en 10 min o menos | SQL R11 | AUTO |
| 14 | Topes de la prueba (6.º análisis, 3.º del día, mensaje 51) | SQL L3 (5 análisis); el tope diario de la prueba y el mensaje 51: NO VERIFICADO | AUTO-PARCIAL |
| 15 | Topes de PRO (11.º análisis, mensaje 101, 4.º del día, reinicio del mes) | SQL P3, P4, L5 | AUTO |
| 16 | Como máximo 2 herramientas por vuelta y 3 llamadas al modelo | — (la rama permite 4 vueltas: `concierge-chat/loop.ts:17`) | NO CUBIERTO (el código no lo cumple) |
| 17 | Al agotar la bolsa de búsquedas en vivo, se usan precios guardados | — | NO CUBIERTO (no está implementado) |
| 18 | Topes de alertas por plan | SQL L6 (solo siembra) | NO CUBIERTO |
| 19 | Topes de vuelos por plan | — (`track-flight` tiene 10 fijos) | NO CUBIERTO |
| 20 | Textos idénticos, sin frases prohibidas | `planCopy.test.ts` | AUTO-PARCIAL (no revisa `FixerButton.tsx`; los correos de los días 0, 23, 28 y 30 no existen) |
| 21 | Checkout durante la prueba; opción B | `stripeCheckout.test.ts` (5 casos DEC-02) | AUTO |
| 22 | Al terminar la prueba no hay cargo ni cliente en Stripe | SQL T6 | AUTO-PARCIAL (revisar el panel de Stripe: pendiente, a mano) |
| 23 | `tax_behavior: inclusive` y total de $99.00 | — | NO CUBIERTO |
| 24 | `clientIp` ignora un `X-Forwarded-For` falso | — | NO CUBIERTO |
| 25 | Un vuelo agregado 30 días antes gasta 20 búsquedas o menos | — | NO CUBIERTO |
| 26 | `serpapi-quote` hace como máximo 1 consulta en vivo cada 24 h | — | NO CUBIERTO |
| 27 | Multidestino: 7 ciudades se rechazan y 4 cuentan como 2 | — | NO CUBIERTO |
| 28 | Se escribe una fila en `ai_usage_log` | — | NO CUBIERTO (la tabla no existe) |
| 29 | La consulta de detección marca la cuenta sin bloquearla | — | NO CUBIERTO |
| 30 | 200 correos de confirmación en una hora | — | NO CUBIERTO (Resend) |

**Resumen de la 4.4:**

| Cobertura | Número | Pruebas |
|---|---|---|
| AUTO | 9 | 1, 4, 5, 10, 11, 12, 13, 15, 21 |
| AUTO-PARCIAL | 7 | 2, 3, 6, 9, 14, 20, 22 |
| NO CUBIERTO | 14 | 7, 8, 16, 17, 18, 19, 23 a 30 |
| **Total** | **30** | |

Ninguna de las 30 está verificada en producción, salvo la 10 (por E2E-PROD, con las funciones viejas).

### 4.5 Privacidad entre cuentas

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| P1 | Un anónimo no puede listar el storage | SQL A1; MANUAL (en vivo, `travel-moments` → `[]`); E2E-PROD C8a/C8b (`journal-photos` y `travel-moments` → `[]`) | AUTO + E2E-PROD |
| P2 | Nadie ve objetos ajenos | SQL A2 | AUTO (local) |
| P3 | Nadie se vuelve colaborador de un viaje ajeno | SQL A3; E2E-PROD C5 (403 `42501`) | AUTO + E2E-PROD |
| P4 | Nadie ve un perfil ajeno con una amistad falsa | SQL A4; E2E-PROD C6 (403) y C3 (`200 []`) | AUTO + E2E-PROD |
| P5 | Nadie inserta vuelos directo en la tabla | SQL A5; MANUAL (privilegios revocados) | AUTO + MANUAL |
| P6 | El colaborador no puede cambiar al dueño | SQL L6; E2E-PROD C7 (403 "No se puede cambiar el dueño") | AUTO + E2E-PROD |
| P7 | Viajes, gastos, notificaciones, *split* y onboarding ajenos | E2E-PROD C1, C2, C4, C4b, C11, C12 (`200 []` o solo los propios) | E2E-PROD |
| P8 | Nadie inserta una notificación a nombre de otro | E2E-PROD C10 (403 RLS) | E2E-PROD (no se probaron las RPC ni las funciones) |
| P9 | Las cotizaciones de un viaje ajeno no se leen | SQL Q6 | AUTO (local; la tabla no existe en PROD) |
| P10 | Nadie apunta a la cotización de otro viaje | SQL Q10 | AUTO (local) |
| P11 | Nadie fija un viaje ajeno como activo | — | NO CUBIERTO |
| P12 | Nadie borra la cuenta de otro | `deleteAccount.test.ts` | AUTO (lógica) |
| P13 | `send-email` no envía a cualquiera | MANUAL (400, 403 y 401 en vivo); E2E-PROD C9/C9b | MANUAL + E2E-PROD; sin prueba automática |
| P14 | Una nota "SISTEMA:" no le da órdenes a Iato | `iatoEvals` E-15 | AUTO-PARCIAL (que un modelo real no la obedezca: NO CUBIERTO) |
| P15 | La caché offline se borra al cerrar sesión | `serviceWorker.test.ts` | AUTO |
| P16 | La memoria de Iato solo es propia | — | NO CUBIERTO |
| P17 | Los amigos ven el perfil completo (IATOS-053) y se pueden editar columnas protegidas (IATOS-052) | — | NO CUBIERTO (defectos abiertos) |
| P18 | Dirección B → A y ataques por RPC o funciones (IATOS-107) | — (el E2E solo probó REST de A hacia B) | NO CUBIERTO |

### 4.6 Estados de pago

| # | Estado o transición | Cobertura | Resultado |
|---|---|---|---|
| S1-S3 | Sin suscripción → GRATIS; `trialing` de Stripe → PRO; `active` | `subscription.test.ts`; SQL S1, S2 | AUTO |
| S4-S6 | `past_due` tardío ignorado; `past_due` → portal; `invoice.paid` recupera | SQL S3; `stripeCheckout.test.ts`; `stripeWebhook.test.ts` | AUTO |
| S7-S8 | Cancelación y nueva suscripción; el `deleted` de otra suscripción se ignora | SQL S4, S5 | AUTO (SQL) |
| S9 | Cortesía (`comped`) intacta; solo con correo confirmado; nunca pisa un pago | SQL S6, S8, C1-C3; F7 | AUTO (SQL) |
| S10 | Usuario desconocido | SQL S7 | AUTO (SQL) |
| S11-S12 | Segunda suscripción → 409; la prueba de Stripe solo una vez | `stripeCheckout.test.ts` | AUTO |
| S13 | Error de la base → 500 → Stripe reintenta | `stripeWebhook.test.ts` | AUTO |
| S14 | Verificación de la firma del webhook | — | NO CUBIERTO |
| S15 | Cobro real en modo *live* | — | NO CUBIERTO (Stripe en modo prueba; el E2E no hizo pagos) |
| S16 | IVA incluido: total de $99.00 | — | NO CUBIERTO |
| S17 | Reembolso o disputa | — | NO CUBIERTO (no está implementado) |
| S18 | Prueba sin tarjeta (DEC-02) | SQL T1-T8; `stripeCheckout.test.ts` DEC-02 | AUTO (apagado en la rama; no desplegado) |
| S19 | Límites de PRO con el interruptor encendido | SQL P2, P3, L5 | AUTO (apagado; no desplegado) |

### 4.7 Alertas

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| AL1-AL7 | Reglas de vuelo, estado honesto, alto por cuota, dedup, concurrencia, intervalos, límite de tiempo | `flightWatchRules`, `flightWatchRunner`; SQL T3-T9; `concurrent_claim.sh` | AUTO |
| AL8 | Alerta de precio: baja real, no por tipo de cambio, 20 h entre alertas | `priceWatch.test.ts` | AUTO |
| AL9-AL11 | Push sin VAPID, campana de avisos, health-check de las tareas | `pushCore`, `notificationBell`, `healthAlerts`; SQL C1 | AUTO |
| AL12 | `price-watch-cron` con dos corridas encimadas | — | NO CUBIERTO |
| AL13 | El correo de alerta llega | — | NO CUBIERTO (bloqueado por Resend) |
| AL14 | El push llega a un dispositivo real | — | NO CUBIERTO |
| AL15 | Un vuelo seguido real con SerpApi | — (0 vuelos en vivo; el E2E lo excluyó para cuidar SerpApi) | NO CUBIERTO |
| AL16 | La tarea de vuelos corre en producción | MANUAL (3 tareas existen; 32 corridas sin fallas en la auditoría, con la versión vieja) | MANUAL |

### 4.8 Móvil

| # | Escenario | Cobertura | Resultado |
|---|---|---|---|
| M1 | Barra de 5 elementos y objetivos de 44 px o más | `bottomNav.test.tsx`; E2E-RAMA H-3 (`f4c4c72`: 5 elementos) | AUTO + E2E-RAMA |
| M2 | El compositor de Iato es visible | `bottomNav.test.tsx` (jsdom). E2E-PROD y E2E-RAMA `8393649`: **tapado**. En `f4c4c72` no se volvió a revisar. | AUTO-PARCIAL; NO VERIFICADO en `f4c4c72` |
| M3 | Zoom permitido | `cookieConsent.test.tsx`; E2E-RAMA H-3 | AUTO + E2E-RAMA |
| M4 | Los botones de afiliado abren en iOS | `trackBooking.test.ts` (simulado) | AUTO-PARCIAL |
| M5 | Avatar: galería o cámara | `avatarCreator.test.tsx`; E2E-RAMA B-04 | AUTO-PARCIAL |
| M6 | Funciona sin red | `serviceWorker.test.ts` | AUTO-PARCIAL |
| M7 | Sin desborde horizontal en las 48 rutas | E2E-PROD A-M-resto (46/46 sin desborde en 390×844) | E2E-PROD (emulación) |
| M8 | Cercanos en móvil | E2E-PROD y E2E-RAMA: falla intermitente (N-01) | **FALLA** (NO CUBIERTO por pruebas automáticas) |
| M9 | iPhone Safari y Android Chrome reales | — | NO CUBIERTO |
| M10 | Rendimiento en móvil | E2E-PROD F1-F3: FCP de 2.84 s, 3.05 s y 3.39 s en el perfil lento | E2E-PROD: **2 FAIL** (IATOS-103) |

---

## 5. Suite de evaluación de Iato (`src/test/iatoEvals.test.ts`, 30 pruebas)

Todas usan el modelo y los proveedores **simulados**. Lo que el propio archivo deja fuera (líneas 1-5) necesita un modelo real:

- E-12 (texto);
- E-15 (obediencia);
- E-17, E-18;
- E-19 (recuerdo).

**La definición de E-17 y E-18 no está en el repo** (viene del informe B, sección C-3): NO VERIFICADO.

| Bloque | Pruebas | ¿Necesita un modelo real para lo que falta? |
|---|---|---|
| E-01 a E-04 · viaje en contexto | E-01: pregunta cuál viaje si es ambiguo. E-02: elige París y marca el PDF como no verificado. E-03: toma el viaje en curso. E-04: Japón → Tokio. Además: orden de prioridad y "restaurantes cerca" con empate. | No |
| E-05 a E-11 · herramientas y tarjetas | E-05: argumentos de vuelos. E-06: un resultado de 8 KB. E-07: búsqueda vacía. E-08: `ai-fallback`. Además: `ai-fallback` por elemento. E-09: hoteles. E-10: `flight-status` 503. E-11: jet y equipaje sin precio. Además: se descarta un vuelo u hotel sin búsqueda y las tarjetas mal formadas. | Que el modelo **pida** la herramienta correcta: sí |
| E-12 a E-14 · contexto y ubicación | E-12: *transfer*. E-13: coordenadas numéricas. E-14: no inventa coordenadas. | E-12: **sí** |
| E-15/E-16 · *prompt injection* y roles | E-15: datos delimitados. Además: se neutralizan los marcadores de rol. E-16: sin roles `system`/`tool` del cliente. | E-15: **sí** |
| URLs | Solo `https` | No |
| E-19 · memoria | Otra sesión, sin duplicar y con tope | **Sí** |
| E-20 · fecha local | Zona IANA y validación | No |
| B-15 · paralelo y límite de tiempo | 2 pruebas | No |
| B-02 · contrato de tarjetas | 2 pruebas | No |
| E-17, E-18 | No automatizadas | **Sí** (definición fuera del repo) |

**Lo único con un modelo real:** según `IATOS_E2E_EVIDENCE.md` (D1-D3 y D7), en PROD Iato respondió a 4 mensajes de conversación, sin herramientas y con la versión vieja. **No se probó con modelo real ninguna búsqueda con herramientas (IATOS-006), ni la inyección, ni la memoria.**

---

## 6. Lo que no tiene ninguna prueba automática

- **El *handler* completo de las 53 Edge Functions.** Lo que se prueba son módulos puros y la orquestación extraída.
- La verificación de la firma de `stripe-webhook`.
- `send-email`, que solo se verificó en vivo y en el E2E.
- `concierge-action`, `enviar-email-fixer`, `serpapi-quote`, `parse-trip-file`, `generate-avatar` y las funciones de Google Maps.
- Los triggers de `profiles.active_trip_id`.
- `LiveTripQuote.tsx` (IATOS-076).
- Cercanos (N-01) y PlanTrip con `?q=` y sin cuota (N-09).
- Que `planCopy.ts` coincida con lo que el sistema hace de verdad. Sobre todo, que la prueba anunciada esté encendida.

---

## 7. Lo que NO se ha probado de punta a punta en producción

**Sí verificado en producción:**

- **En vivo, el 2026-10-22, según los hechos que me dieron:**
  - F-01, F-02, F-03, F-05 y F-06 (parte de base de datos);
  - F-04 (`send-email`);
  - las 53 funciones desplegadas;
  - RLS en 44/44 tablas;
  - las 3 tareas programadas.
- **Por la sesión E2E (`IATOS_E2E_EVIDENCE.md`, no repetida por mí):**
  - barrido de las 48 rutas en escritorio y móvil;
  - privacidad C1 a C12;
  - cuota gratuita de Iato y del análisis, donde el servidor responde 402 y la interfaz muestra un error técnico;
  - **un análisis real** CDMX→Puebla (200 en 36 s), con observaciones N-06, N-07 y IATOS-075;
  - 4 respuestas reales de Iato;
  - autenticación E1 a E7;
  - rendimiento F1 a F3.

**No verificado de punta a punta en producción:**

1. **Todo lo que solo está en la rama.** Producción corre las funciones viejas (salvo `send-email`) y ninguna de las 11 migraciones `2026102213*`. El E2E de la rama solo probó el **frontend** contra el backend de producción.
2. **Reservas de cuota, `plan_limits`, prueba sin tarjeta y límites de PRO.** Solo están probados en local y apagados.
3. **Iato con herramientas y datos reales** (IATOS-006), la resistencia a la inyección con un modelo real y la memoria. Tampoco se sabe qué modelo responde detrás de `gemini-flash-latest`.
4. **"Re-analizar" (IATOS-008) y el multidestino (`logistics-plan`)**, con datos reales.
5. **Cobro real con Stripe**: modo *live*, IVA, firma real del webhook, portal, cancelación y reembolso.
6. **Correo**: si llega a la bandeja la bienvenida, la cotización, la invitación, las alertas, el Fixer y la recuperación de contraseña (IATOS-041: el enlace real no se abrió).
7. **Seguimiento de vuelos y alertas de precio con datos reales.** Hay 0 en vivo.
8. **Push** a un dispositivo real.
9. **Dispositivos reales**: el E2E usó solo emulación de Chromium.
10. **Concurrencia en producción**: corridas encimadas o análisis simultáneos.
11. **Carga y abuso**: excluidos.
12. **La rama `f4c4c72` completa**: el E2E solo revisó 4 puntos (B-HEAD).

---

## 8. Cómo reproducir esta medición

```bash
cd /home/user/wanderly-ai-concierge
npx vitest run                                   # esperado en f4c4c72: 434 passed (62 files)
npx tsc --noEmit -p tsconfig.app.json            # esperado: código 0

# SQL: Postgres local vacío; nunca producción
export PGHOST=/ruta/socket PGPORT=5432
supabase/tests/security/run.sh iatos_rls_test
psql -U postgres -d iatos_rls_test -f supabase/tests/security/trip_quotes.sql
supabase/tests/ops/run.sh iatos_ops_test
supabase/tests/payments/run.sh iatos_pay_test     # incluye reservas, plan_limits y prueba sin tarjeta
```
