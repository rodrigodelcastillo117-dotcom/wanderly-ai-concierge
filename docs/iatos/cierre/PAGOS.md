# Cierre de auditoría · Grupo PAGOS (AUD-05, AUD-08, cuotas y prueba gratis)

Fecha: 2026-10-22 · Rama `claude/aud-pagos` (desde `claude/cierre-auditoria` = `f62466e`) · Worktree `/home/user/wt-aud-pagos`.
Sin producción: ninguna migración aplicada, ninguna función desplegada, ningún cambio en Stripe ni en secretos. Lecturas públicas únicamente (`traveliatos.life`, `auth/v1/settings`, RPC pública `public_plan_config`).
Evidencia: `docs/iatos/cierre/evidencia/pagos/` (salidas ANTES/DESPUÉS de cada prueba y lecturas públicas).
Procedimiento de salida a cobro real: [`STRIPE_CERTIFICACION.md`](STRIPE_CERTIFICACION.md).

## Resumen

| Estado | Cuántos |
|---|---|
| VERIFICADO (prueba que falla antes y pasa después + suites verdes) | 8 |
| REFUTADO con evidencia | 6 |
| CORREGIDO sin prueba automática | 1 |
| BLOQUEADO (solo el dueño: panel de Stripe/Supabase, autorizaciones) | 3 |
| PENDIENTE (decisión o de otro grupo) | 2 |

P0 abiertos: 0. P1 abiertos: **AUD-08 queda BLOQUEADO** (el código está corregido; la certificación la ejecuta y firma el dueño). P2 abierto: N-01 (confirmación de correo apagada, BLOQUEADO).

## Tabla de hallazgos

| ID | Severidad | Reproducido (cómo, archivo de prueba) | Solución (archivo:línea, commit) | Tests (nombre, antes → después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-05.1 · eventos repetidos / doble entrega / entregas simultáneas | P2 | Mundo en memoria con las reglas del SQL + SQL real: mismo evento 2×, `invoice.paid` + `invoice.payment_succeeded`, dos transacciones a la vez | — (el diseño ya era idempotente: estado vivo de Stripe + `apply_stripe_subscription` con candado; periodos con `UNIQUE(stripe_invoice_id)`; reembolsos con `event_id` como llave) | `stripeAtomicity.test.ts` A1–A4, B1–B3; `stripe_events.sql` AP01, AP02; `run.sh` CC1, CC2 · pasan antes y después | `AUD-05_vitest_ANTES.txt`, `AUD-05_sql_ANTES.txt` | REFUTADO |
| AUD-05.2 · fuera de orden de suscripción (updated antes que created; invoice.paid antes que checkout; sin metadata) | P2 | AP03–AP05; vitest C1–C3 | — (estado vivo + `stale_event` + fila de checkout con customer) | pasan antes y después | ídem | REFUTADO |
| AUD-05.3 · falla de base antes de registrar, falla entre suscripción y periodo, red caída | P2 | Falla inyectada en CADA dependencia (Stripe → excepción, base → `{error}`) y reintento como Stripe | — para la ruta de suscripción/factura (cada paso idempotente, 500 → reintento converge) | vitest D (`invoice.paid falla en …` ×4, `charge.refunded falla en …` ×8, "un 500 nunca deja el evento registrado"); AP15, AP17 | `AUD-05_vitest_DESPUES.txt` | REFUTADO (suscripción) / ver 05.4–05.7 |
| AUD-05.4 · reembolso o disputa procesado ANTES de que exista el periodo pagado → al registrarse nacía `paid`: un cargo **reembolsado contaba para la antigüedad de Privé** | P2 | `stripe_events.sql` AP08–AP11 (reembolso total, disputa abierta, perdida, reembolso parcial antes del periodo) | `prive_record_paid_period` reaplica las decisiones de `stripe_payment_events` de su factura al insertar, en orden de Stripe — `supabase/migrations/20261024051500_aud_pagos_payment_event_atomic.sql:95-162`, `3b66f27` | AP08–AP11: **FALLA → OK** | `AUD-05_sql_ANTES.txt` / `AUD-05_sql_DESPUES.txt` | VERIFICADO |
| AUD-05.5 · carrera: `invoice.paid` registra el periodo entre la marca y el registro del reembolso → ninguno ve al otro (`paid`) | P2 | `run.sh` CC3 (dos transacciones reales con `pg_sleep`); vitest "carrera: el invoice.paid termina mientras el reembolso…" | `stripe_commit_payment_event` (registro con llave `event_id` + antigüedad en **una** transacción) y candado por factura `pro_paid_period_lock` compartido con `prive_record_paid_period`/`prive_mark_paid_period` — migración `:20-25`, `:168-209`; `stripe-webhook/payments.ts:271-292`; `index.ts:86-102`, `3b66f27` | CC3: **FALLA (periodo=paid) → OK**; vitest: **× → ✓**; CC4 (mismo evento simultáneo) FALLA (no existía) → OK | ídem | VERIFICADO |
| AUD-05.6 · `charge.dispute.created` entregado después de su `charge.dispute.closed` (ganada) → periodo `disputed` para siempre | P3 | AP13; vitest "disputa cerrada (ganada) ANTES que su charge.dispute.created" | la apertura tardía de una disputa ya cerrada no marca — migración `:196-202` | AP13 ERROR (no existía) → OK; vitest **× → ✓** | ídem | VERIFICADO |
| AUD-05.7 · disputa con campana de administradores fallida se marcaba como hecha (200): Stripe no reintentaba y nadie se enteraba (hay plazo para responder) | P2 | vitest D "disputa perdida: si la campana… no se guarda" y "disputa abierta: la campana fallida…" | `payments.ts:238-244` (aviso = efecto obligatorio → 500; la llave por evento evita duplicados) | **[200] → [500, 200]**, un solo aviso | ídem | VERIFICADO |
| AUD-05.8 · segunda suscripción viva (dos checkouts pagados) ignorada en silencio: **cobro doble invisible** | P2 | vitest E "segunda suscripción pagada mientras la primera vive"; AP21 (la base ya la ignoraba con `other_live_subscription`) | aviso a administradores una vez por suscripción — `stripe-webhook/handler.ts:136-167`, `3b66f27`; prevención en el checkout (AUD-08.2) | vitest **× → ✓** | ídem | VERIFICADO |
| AUD-05.9 · ciclo de vida: cancelación programada, vencimiento, reactivación, periodos encimados, suscripción nueva tras cancelar | P3 | AP06, AP18–AP20; vitest E1–E4 | — | pasan antes y después | ídem | REFUTADO |
| AUD-05.10 · código HTTP a Stripe vs. resultado | P2 | vitest D: cada falla inyectada → 500 y sin fila en el registro; cada 200 deja la fila | contrato documentado en `handler.ts:15-17` | ✓ (con 05.5/05.7 corregidos) | ídem | VERIFICADO |
| AUD-08.1 · contradicción GO (`IATOS_ESTADO_FINAL.md`) vs. Stripe BLOQUEADO (`IATOS_PLAN_COMERCIAL.md`) | P1 | Lectura de ambos documentos + lecturas públicas: Stripe en modo prueba, `mailer_autoconfirm: true`, sin compra real reembolsada | Veredicto corregido a **CONDICIONADO** en `IATOS_ESTADO_FINAL.md` §1 y §5.3; procedimiento de certificación `STRIPE_CERTIFICACION.md` (inventario de lo que el código espera, qué es BLOQUEADO, Fases 0–3, rollback, firma) | — (documental) | `AUD-08_lecturas_publicas.txt` | CONFIRMADO → **BLOQUEADO** (lo ejecuta el dueño) |
| AUD-08.2 · el checkout cobraba el `STRIPE_PRICE_ID` que hubiera sin revisarlo (USD, IVA por fuera = $114.84, anual…) y con Adaptive Pricing del panel cobró en USD | P1 | `stripeCheckoutOffer.test.ts` (18 casos) | `_shared/stripe-offer.ts` (`EXPECTED_PRICE` = $99 MXN/mes `inclusive`, `priceProblems`); `stripe-checkout/index.ts:63-72` (503 sin crear nada si no coincide); `logic.ts:checkoutSessionParams` (`currency=mxn`, `adaptive_pricing.enabled=false`); expira sesiones abiertas antes de crear otra — `d793869`, `9838d49` | 18 **fallan (no existían) → pasan**; `stripeCheckout.test.ts` sigue verde | `AUD-08_checkout_vitest_ANTES.txt` / `_DESPUES.txt` | VERIFICADO en código; el efecto real en Stripe live es BLOQUEADO hasta la Fase 3 |
| AUD-08.3 · copia pública vs. comportamiento | P2 | bundle de producción descargado y comparado con `planCopy.ts`, `Legal.tsx`, `Pro.tsx` y el código | — | — | `AUD-08_lecturas_publicas.txt` | VERIFICADO (coincide; ver N-04) |

## HALLAZGOS NUEVOS

| ID | Severidad | Hallazgo | Evidencia | Acción | Estado |
|---|---|---|---|---|---|
| N-01 | P2 | **Supabase Auth confirma el correo solo** (`mailer_autoconfirm: true` en producción). La cortesía (`has_comp_grant`, `apply_comp_grant`) y la prueba sin tarjeta exigen `email_confirmed_at`, que así se llena al registrarse: quien se registre primero con un correo de `comp_grants` obtiene PRO gratis sin ser dueño del correo; con la prueba sin tarjeta encendida, pruebas infinitas con correos inventados. Ya listado como IATOS-055/DEC-02, ahora **verificado en vivo**. | `GET /auth/v1/settings` | Dueño: Authentication → Providers → Email → "Confirm email" ON (Fase 0 de la certificación). No encender `trial_no_card_enabled` antes. | BLOQUEADO |
| N-02 | P3 | `apply_prive_grant` liga una concesión Privé pendiente a quien se registre con ese correo **sin exigir confirmación**, y su trigger no corre al confirmar (`AFTER INSERT OR UPDATE OF email`). Requiere además PRO para entrar, pero la concesión queda ligada a una cuenta que quizá no es del dueño del correo. | `supabase/migrations/20261023090100_prive_core_access.sql:510-534` | Para el grupo **prive** (fuera de mi alcance; no lo toqué para no chocar con sus migraciones). | PENDIENTE |
| N-03 | P3 | `stripe-portal` devolvía al navegador el mensaje crudo de error de Stripe. | `stripe-portal/index.ts:56` (antes del cambio) | Mensaje fijo para la persona; el detalle queda en el log — `d793869` | CORREGIDO (sin prueba automática: el `index.ts` de Deno no se prueba con Vitest) |
| N-04 | P3 | /dashboard/pro muestra "Mensajes sin límite" a un PRO mientras la lista de PRO dice "100 mensajes con Iato al mes". Hoy es cierto (`pro_limits_enforced=false`) y es más generoso que lo anunciado, pero los dos textos no coinciden. | `Pro.tsx:91,95` en el bundle `Pro-D6hnic3T.js` | Decisión del dueño al aprobar DEC-01 (encender límites o cambiar el texto). | PENDIENTE (decisión) |
| N-05 | P2 | Suscripción que cobra sin cuenta de IATOS (`unknown_user`: sin metadata y customer desconocido) → 200 silencioso: la persona paga sin PRO. | vitest "mejora: una suscripción que cobra sin cuenta…" (× antes, ✓ después) | Aviso a administradores una vez por suscripción — `fa99cbf` | VERIFICADO |
| N-06 | P3 | `is_pro` no mira `price_id` ni `pause_collection`: cualquier suscripción activa del cliente da PRO, y "pausar cobros" desde el panel deja PRO gratis. | `20261022135300_pay_plan_limits_recommended.sql:11-27` | Se controla con la configuración: el portal no debe ofrecer otros precios (`stripe_config` lo revisa) y no pausar cobros (documentado en la certificación §2.6). | Riesgo residual documentado |

## HALLAZGOS REFUTADOS CON EVIDENCIA

- **"Un evento repetido o duplicado crea doble PRO o doble periodo pagado"**: no. `apply_stripe_subscription` escribe el estado vivo de Stripe con candado de fila (una fila por cuenta, CC1 con dos transacciones reales), los periodos son únicos por factura (AP02, CC2), y reembolsos/disputas usan `event_id` como llave (A3, A4, AP14, CC4).
- **"Eventos fuera de orden regresan una suscripción a un estado viejo"**: no. El handler relee la suscripción en Stripe y la base ignora eventos más viejos (`stale_event`, AP03; vitest C1 y "invoice.paid viejo que llega después del reembolso").
- **"invoice.paid antes de checkout.session.completed deja a la persona sin PRO"**: no. La suscripción lleva `metadata.supabase_user_id` y el checkout deja antes una fila con el customer (AP04, AP05, vitest C2–C3).
- **"Una falla a mitad deja la suscripción a medias"** (ruta de suscripción): no. Cada paso es idempotente y cualquier error responde 500: el reintento converge al mismo estado que una corrida limpia (vitest D, 12 pasos con falla inyectada; AP17).
- **Ciclo de vida** (cancelación programada, vencimiento, reactivación, periodos encimados): correcto (AP06, AP18–AP20; vitest E).
- **"No hace falta una RPC única para todo el webhook"**: el efecto crítico que sí estaba partido (registro del reembolso/disputa + antigüedad) ahora es una sola transacción con llave `event_id` (`stripe_commit_payment_event`). Las llamadas a Stripe (cancelar la suscripción) no pueden ir dentro de una transacción de base; son idempotentes ("ya cancelada" no es error) y se hacen antes del registro final.

## Cuotas y prueba gratis (auditoría)

| Punto | Revisión | Evidencia | Resultado |
|---|---|---|---|
| Límites FREE 3 mensajes/mes y 1 análisis de una vez; PRO 100/10 al mes solo con `pro_limits_enforced` (apagado); prueba 50/5 | `quota_rule`, `plan_limits`, `get_access_state` | `payments/run.sh`: F1–F8, P1–P7, L1–L7 | OK |
| Reserva → confirmación → liberación atómica | `reserve_quota` bloquea `usage_limits` y la reserva; `commit_quota` mismo orden de candados (sin deadlocks); `release_quota` nunca deshace una confirmada | R1–R12, M1–M4, "CONCURRENCIA reserve_quota" | OK |
| Una falla técnica no se cobra | `runWithReservation` libera ante excepción, error, contrato incompleto o timeout (240 s, salvo que ya esté guardando) y una reserva caída caduca a los 10 min; concierge-chat confirma solo cuando Iato respondió y libera en aclaraciones, respuestas directas y errores del modelo | R1, R7, R11, M1; `supabase/functions/concierge-chat/index.ts:271-518` | OK |
| Fail-closed | `reserveQuota` niega si la RPC falla; `isPro` responde false ante error | `entitlements.ts:48-55,124-136` | OK |
| Prueba sin tarjeta apagada | `public_plan_config` en vivo → `false`; el frontend cae a "card" si la RPC falla | `AUD-08_lecturas_publicas.txt`; `usePlanConfig.ts` | OK |
| Dependencia de la confirmación de correo | Correcta en código; **inútil en producción mientras `mailer_autoconfirm=true`** | N-01 | BLOQUEADO |

## Mejoras adicionales ("GOD TIER")

1. **`health-check?action=stripe_config`** (`9838d49`, `87bf85b`): con la llave del servidor y solo lectura revisa precio ($99 MXN/mes IVA incluido), texto del producto (sin "sin límites"), endpoint del webhook (eventos obligatorios, versión `2024-12-18.acacia`, habilitado), portal (cancelar al fin del periodo, cambiar tarjeta, sin otros precios, enlaces legales) y Stripe Tax/registro en MX. Convierte en un `curl` lo que antes solo se veía en el panel. 8 pruebas (`stripeConfigProbe.test.ts`).
2. **Checkout sin cobro doble**: expira las sesiones abiertas del cliente antes de crear otra (`d793869`).
3. **Avisos de dinero que no se ve**: segunda suscripción viva (AUD-05.8) y suscripción que cobra sin cuenta (N-05).
4. **Precio fail-closed** (AUD-08.2) y **Adaptive Pricing apagado**.

## Resultados exactos de las suites (2026-10-22, al final)

| Suite | Resultado |
|---|---|
| `supabase/tests/payments/run.sh audpay_final` | **88 OK, 0 FALLA, 0 ERROR** (antes del arreglo, con las pruebas nuevas: AP08–AP11, AP15, CC3, CC4 FALLA y AP13/AP14/AP16 ERROR por función inexistente) |
| `supabase/tests/cost/run.sh audpay_cost` | 16 OK + 3 "ok" de idempotencia, 0 FALLA |
| `supabase/tests/security/run.sh audpay_sec` | 95 OK; salida idéntica a la de la rama base salvo TP1–TP15 (pruebas que existen en la integración más nueva y no en `f62466e`); solo los errores esperados (pg_cron y los "permission denied" de los ataques) |
| `supabase/tests/prive/run.sh audpay_prive` (por tocar `prive_record_paid_period`/`prive_mark_paid_period`) | 89 OK, 0 FALLA |
| Re-aplicar la migración `20261024051500` sobre sí misma | sin errores (idempotente) |
| Vitest completo | 163 archivos, 1557 pruebas: **1552 pasan, 5 timeouts** en pruebas de UI ajenas a pagos (`dashboardActiveTrip`, `godtierHome` ×2, `godtierPlan`, `tripSplitLive`) con la máquina a carga 25–34; esos archivos (+ `priveEntry`) pasan 17/17 con `--testTimeout=60000`. Al empezar: 1497 pruebas, 2 timeouts del mismo tipo |
| Vitest de pagos (`stripe*.test.ts`, `priveTenure`, `healthChecks`, `quota`, `serpQuota`, `proGateError`, `proStatusCard`) | 12 archivos, **159/159** |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 errores |
| `deno check` `stripe-webhook`, `stripe-checkout`, `stripe-portal`, `health-check` | sin errores (`deno.lock` borrado) |

## Requiere autorización para producción

1. Migración `supabase/migrations/20261024051500_aud_pagos_payment_event_atomic.sql` (aditiva, idempotente).
2. Publicar funciones: `stripe-webhook`, `stripe-checkout`, `stripe-portal`, `health-check` (en ese orden, después de la migración).
3. Supabase Auth: "Confirm email" ON (N-01).
4. Stripe (panel): todo lo marcado "Panel" en `STRIPE_CERTIFICACION.md` §2 y las Fases 1–3.

## Riesgo residual

- **Nada de esto se probó contra Stripe real.** Las pruebas usan un Stripe simulado y Postgres local; el comportamiento con la API de Stripe (sobre todo `adaptive_pricing`, `checkout.sessions.expire`, Stripe Tax) se confirma en las Fases 1 y 3 de la certificación.
- Si la campana de administradores falla de forma persistente, los eventos de disputa responden 500 hasta 3 días (en live) y Stripe puede deshabilitar el endpoint: se ve en el panel de webhooks y en el health-check.
- Carrera teórica restante en la ruta de suscripción: dos entregas cuya lectura de Stripe ocurre en orden inverso a su escritura y con el mismo segundo de `event.created` pueden escribir el estado leído primero; el siguiente evento de Stripe lo corrige. No afecta dinero ni periodos pagados.
- `commit_quota` acepta una reserva ya caducada (el trabajo terminó tarde): si un análisis gratuito tardara más de 10 minutos guardando, podría contarse un segundo análisis. El timeout de 240 s lo hace muy improbable.
- `prive-tenure-backfill` y el borrado de cuentas llaman a la API REST de Stripe sin `Stripe-Version` (usan la versión por omisión de la cuenta); el parser acepta los dos formatos de factura, pero conviene anotar la versión de la cuenta (certificación §2.7).
- `is_pro` no distingue precios ni cobros pausados (N-06): depende de que el panel de Stripe esté configurado como dice la certificación.
