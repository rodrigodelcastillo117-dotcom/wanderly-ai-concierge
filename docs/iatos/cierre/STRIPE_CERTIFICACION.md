# Certificación de Stripe para vender IATOS PRO (AUD-08)

Fecha: 2026-10-22 · Grupo `pagos` · Rama `claude/aud-pagos` · **Nada de esto se activó.** Este documento es el procedimiento que el dueño autoriza y ejecuta, paso por paso, para pasar de "Stripe en modo prueba" a "cobro real", con resultados esperados, una compra real reembolsada y cómo volver atrás.

> **Regla de oro.** Que algo funcione en modo prueba **no prueba** que funcione en modo live. Las llaves, el precio, el endpoint del webhook, el portal de clientes y Stripe Tax son objetos **distintos** en cada modo y se configuran dos veces. La certificación termina solo con la Fase 3 (una compra real de $99 MXN reembolsada) en verde.

## 1. Veredicto sobre la contradicción

`IATOS_ESTADO_FINAL.md` decía **GO** para vender PRO por invitación mientras su propia sección 5 y `IATOS_PLAN_COMERCIAL.md` (fila "Suscripción PRO con Stripe: **BLOQUEADO**") listaban pendientes de Stripe. Lo verificable hoy desde el código y endpoints públicos:

| Hecho | Evidencia | Estado |
|---|---|---|
| Stripe sigue en **modo prueba** | `FASE0_ESTADO.md` (health-check: "Stripe está en modo de prueba"); no tengo acceso al panel | BLOQUEADO (dueño) |
| La confirmación de correo **no** se exige en Supabase Auth | `GET /auth/v1/settings` → `"mailer_autoconfirm": true` (`evidencia/pagos/AUD-08_lecturas_publicas.txt`) | CONFIRMADO, BLOQUEADO (dueño) |
| La prueba sin tarjeta está apagada | `public_plan_config` → `{"trial_no_card_enabled": false}` | VERIFICADO |
| El texto público dice $99 MXN al mes IVA incluido, prueba de 30 días con tarjeta solo la primera vez, cancelación al fin del periodo, reembolso total = fin del acceso | bundle de https://traveliatos.life (mismos textos que `src/lib/planCopy.ts` y `src/pages/Legal.tsx`) | VERIFICADO |
| El precio adaptativo cobró en USD en la prueba del dueño | `IATOS_ESTADO_FINAL.md` §5 | CORREGIDO en código (Adaptive Pricing apagado por sesión) |
| El código no revisaba que el precio de Stripe fuera el anunciado | `stripe-checkout/index.ts` antes de `d793869` | CORREGIDO (el checkout no abre si no coincide) |

**Conclusión:** el GO comercial **no está certificado**. Queda **CONDICIONADO** a completar las Fases 0–3 de este documento. Se corrigió la fila del veredicto en `IATOS_ESTADO_FINAL.md` para que diga eso.

## 2. Lo que el código espera de Stripe

Columna "Cómo se verifica": **Código** = lo garantiza el código y tiene prueba automática; **`stripe_config`** = lo revisa solo `health-check?action=stripe_config` (nuevo, solo lectura) una vez desplegado; **Panel** = solo se ve en el panel de Stripe o de Supabase (BLOQUEADO para mí: no tengo acceso).

### 2.1 Secretos (Supabase → Edge Functions → Secrets)

| Secreto | Lo usan | Valor esperado | Cómo se verifica |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | stripe-checkout, stripe-portal, stripe-webhook, delete-account y account-deletion-retry (vía `_shared/account-deletion-runtime.ts`), prive-tenure-backfill, health-check | `sk_test_…` en prueba; `sk_live_…` (o llave restringida `rk_live_…`) en live | `stripe_config` → `mode` |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | `whsec_…` del endpoint **del mismo modo** que la llave | Panel (no se puede leer de vuelta); Fase 1 T2 / Fase 3 L4: un evento real responde 200, no 401 `invalid_signature` |
| `STRIPE_PRICE_ID` | stripe-checkout, health-check | id del precio de PRO **del mismo modo** | `stripe_config` → "Precio de PRO" |

Sin `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` el webhook rechaza todo (401, falla cerrado). Sin `STRIPE_SECRET_KEY`/`STRIPE_PRICE_ID` el checkout responde 503 `stripe_not_configured` (sirve de **interruptor de ventas**, ver §6).

### 2.2 Producto y precio

| Campo | Esperado | Cómo se verifica |
|---|---|---|
| Moneda | `mxn` | Código (`priceProblems`, el checkout no abre si no) + `stripe_config` |
| Monto | `9900` (= $99.00) | Código + `stripe_config` |
| Impuestos en el precio | `tax_behavior = inclusive` (IVA **dentro** de los $99: base $85.34 + IVA $13.66) | Código + `stripe_config` |
| Periodicidad | recurrente, `month`, `interval_count = 1`, `usage_type = licensed` | Código + `stripe_config` |
| Precio activo | `active = true` | Código + `stripe_config` |
| Texto del producto | sin "sin límites", "ilimitado", "24/7", "VIP" (salen en checkout, portal y recibos) | `stripe_config` (`productProblems`) |
| Que el producto sea solo PRO | ningún otro precio debe poder contratarse: **cualquier suscripción activa da PRO** (`is_pro` no mira `price_id`) | `stripe_config` (portal) + Panel (no crear Payment Links ni otros precios para este cliente) |

### 2.3 Sesión de Checkout (la arma `checkoutSessionParams`, probada en `stripeCheckoutOffer.test.ts`)

`mode=subscription`, `currency=mxn`, `adaptive_pricing.enabled=false`, `automatic_tax.enabled=true`, `customer_update.address=auto`, `allow_promotion_codes=true`, `client_reference_id` y `metadata.supabase_user_id` (en la sesión y en la suscripción), éxito/cancelación a `/dashboard/pro?checkout=…` del dominio propio (`safeOrigin`). Antes de crearla se **expiran** las sesiones abiertas del mismo cliente (dos pestañas ya no pueden crear dos suscripciones). Versión de API fija en el SDK: `2024-12-18.acacia`.

### 2.4 Prueba gratis

| Regla | Comportamiento | Cómo se verifica |
|---|---|---|
| Prueba con tarjeta (la vigente) | 30 días (`trial_period_days`) solo si la persona nunca tuvo suscripción ni prueba (`trialEligible`) | Código (`stripeCheckout.test.ts`) |
| Prueba sin tarjeta (DEC-02) | **apagada** (`trial_no_card_enabled=false`); si se enciende: 30 días al confirmar el correo, una por correo normalizado | Código (`trial_no_card.sql` T1–T8) + endpoint público |
| Dependencia de la confirmación de correo | la prueba sin tarjeta y la cortesía (`comp_grants`) exigen `email_confirmed_at`; **con `mailer_autoconfirm=true` eso se llena al registrarse sin verificar nada** | CONFIRMADO en vivo → **Panel: Supabase → Authentication → Providers → Email → "Confirm email" = ON** |
| Promociones | `allow_promotion_codes=true`: un cupón del 100 % da PRO sin cobro; sus facturas de $0 no cuentan para Privé | Panel (revisar cupones activos) |

### 2.5 Webhook

Endpoint `https://<proyecto>.supabase.co/functions/v1/stripe-webhook`, **estado enabled**, **versión de API `2024-12-18.acacia`** y estos eventos (`REQUIRED_WEBHOOK_EVENTS`):

`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed` — opcionales: `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.payment_succeeded`.

Cómo se verifica: `stripe_config` → "Webhook". Respuestas del webhook: **2xx solo cuando todos los efectos obligatorios quedaron aplicados**; 500 en cualquier otro caso para que Stripe reintente (en live Stripe reintenta hasta 3 días; en prueba, pocas veces en unas horas). Ver AUD-05 en `PAGOS.md`.

### 2.6 Portal de clientes (Billing → Customer portal, **una configuración por modo**)

| Opción | Esperado (lo que prometen los términos) | Cómo se verifica |
|---|---|---|
| Cancelar | habilitado, **"al final del periodo de facturación"** (`at_period_end`): "Al cancelar conservas el acceso hasta el fin del periodo pagado" | `stripe_config` |
| Cambiar tarjeta | habilitado (el aviso de pago pendiente manda ahí) | `stripe_config` |
| Cambiar de plan | **apagado** (no hay otros planes; otro precio daría PRO igual) | `stripe_config` |
| Historial de facturas | habilitado | `stripe_config` (aviso) |
| Enlaces legales | `https://traveliatos.life/privacidad` y `https://traveliatos.life/terminos` | `stripe_config` (aviso) |
| Pausar cobros | no ofrecerlo; **no usar "Pause payment collection" desde el panel**: la suscripción sigue `active` y el código la trata como PRO pagado | Panel |

### 2.7 Impuestos y facturación

| Punto | Esperado | Cómo se verifica |
|---|---|---|
| Stripe Tax | `status = active` (el checkout usa `automatic_tax`; si no está activo, la sesión falla) | `stripe_config` |
| Registro en México | registro de IVA activo en MX para que el recibo desglose el IVA | `stripe_config` (aviso) + Panel |
| Dirección de origen / datos fiscales | los del negocio | Panel |
| CFDI | Stripe **no** emite CFDI; si se ofrece factura fiscal hace falta otro proceso | Panel / decisión del dueño |
| Cuenta | `charges_enabled` y `payouts_enabled` en live; cuenta bancaria en MXN | Panel |
| Versión de API por omisión de la cuenta | indiferente para el SDK (fijo), pero `prive-tenure-backfill` y el borrado de cuentas (`_shared/stripe-billing.ts`) usan REST sin `Stripe-Version`: anotar cuál es | Panel (Developers → API version) |

## 3. Autorizaciones previas (Fase 0)

Nada de esto lo hice: requiere autorización del dueño.

1. **Aplicar la migración** `supabase/migrations/20261024051500_aud_pagos_payment_event_atomic.sql` (aditiva e idempotente; reemplaza `prive_record_paid_period` y `prive_mark_paid_period` con la misma firma y agrega `stripe_commit_payment_event`).
2. **Publicar** `stripe-webhook`, `stripe-checkout`, `stripe-portal` y `health-check` desde la rama integrada. El webhook funciona aunque la migración no esté (usa la ruta anterior y lo registra en el log), pero el orden correcto es: migración → funciones.
3. **Supabase Auth:** activar "Confirm email" (hoy `mailer_autoconfirm=true`). Sin esto, quien se registre con un correo de `comp_grants` (o de una concesión Privé pendiente) obtiene el beneficio sin ser dueño del correo.
4. **Revisión legal** de términos, aviso de privacidad y política de reembolsos antes de cobrar (`IATOS_PLAN_COMERCIAL.md`, riesgo 3).

## 4. Fase 1 — Modo PRUEBA (resultado esperado de cada paso)

Usar el runbook `docs/ops/stripe-modo-prueba.md` para las consultas SQL de apoyo y una cuenta nueva por escenario (`tucorreo+pN@…`). Tarjetas: `4242 4242 4242 4242` (normal), `4000 0000 0000 0259` (disputa). Para renovaciones: **Test clocks**.

| # | Paso | Resultado esperado |
|---|---|---|
| T0 | `curl -X POST "$SUPABASE_URL/functions/v1/health-check?action=stripe_config" -H "x-cron-secret: $CRON_SECRET"` | `mode: "test"`; todos los `checks` con `problems: []`; el único aviso aceptable es "Stripe en modo de PRUEBA… no certifica el modo live" (y, si aplica, "sin registro de impuestos en México") |
| T1 | Cuenta nueva → /dashboard/pro → Activar PRO → pagar con 4242 | El checkout muestra **$99.00 MXN al mes**, "IVA incluido" y 30 días de prueba; al volver: `subscriptions.status = trialing`, `es_pro = true` |
| T2 | Stripe → Developers → Webhooks → el endpoint → últimos eventos | Todos 200; ninguno 401 (firma) ni 500 |
| T3 | Abrir el checkout en dos pestañas, pagar en la segunda | La primera sesión aparece **expirada** en Stripe; una sola suscripción |
| T4 | Con test clock, avanzar 31 días | `invoice.paid` de $99; `pro_paid_periods` con una fila `paid` de esa factura; `status = active` |
| T5 | Reenviar ese `invoice.paid` (Resend) | 200; sigue **una** fila en `pro_paid_periods` |
| T6 | Portal → Cancelar | `cancel_at_period_end = true`, sigue `es_pro = true` hasta `current_period_end`; la página PRO lo dice |
| T7 | Portal → Reanudar (antes de que termine) | `cancel_at_period_end = false`, `es_pro = true` |
| T8 | Reembolso **total** del último cargo (Payments → Refund) | `stripe_payment_events.action = reembolso_total_revocado`; suscripción `canceled` en Stripe; `es_pro = false`; periodo `refunded` |
| T9 | Reembolso **parcial** ($30) en otra cuenta | `reembolso_parcial_conserva_revision`; `es_pro = true`; periodo `partially_refunded` |
| T10 | Cuenta con 0259 → disputa | `disputa_abierta_aviso`; campana a administradores; `es_pro` sin cambio; periodo `disputed` |
| T11 | Enviar evidencia `losing_evidence` | `disputa_perdida_revocado`, aviso; `es_pro = false`; periodo `dispute_lost` |
| T12 | Otra disputa con `winning_evidence` | `disputa_ganada_estado_stripe`; periodo vuelve a `paid` |
| T13 | Reenviar cualquier evento de T8–T12 | `duplicate: true`; nada cambia; ningún aviso repetido |
| T14 | Poner temporalmente en `STRIPE_PRICE_ID` un precio de prueba en **USD** (o con IVA "exclusive") y abrir el checkout | 503 "No pudimos abrir el pago…"; en el log: `el precio configurado no coincide con la oferta publicada`; **ningún** cliente ni sesión nuevos en Stripe. Regresar el precio correcto |
| T15 | Eliminar una cuenta PRO desde Perfil y reenviar un evento suyo | Escenario 9 del runbook: `ignored: cuenta_eliminada`, sin filas nuevas |

Si cualquier paso no da lo esperado: **alto**. Copiar `event_id`, `action`, `before_state`, `after_state` y reportar; no corregir a mano.

## 5. Fase 2 — Cambio a modo LIVE (configuración, aún sin vender)

1. En Stripe **live**: crear el producto "IATOS PRO" (descripción sin promesas absolutas) y su precio: **MXN 99.00, mensual, impuestos incluidos (inclusive)**. Anotar el `price_…`.
2. Stripe Tax live: activar, dirección de origen, registro de IVA en México.
3. Customer portal live: lo de §2.6 (cancelar al fin del periodo, cambiar tarjeta, sin cambio de plan, enlaces legales).
4. Webhook live: nuevo endpoint a `…/functions/v1/stripe-webhook`, versión `2024-12-18.acacia`, eventos de §2.5. Copiar su `whsec_…`.
5. En Supabase, en un solo momento: `STRIPE_SECRET_KEY = sk_live_…` (o restringida), `STRIPE_WEBHOOK_SECRET = whsec_…` (live), `STRIPE_PRICE_ID = price_…` (live). **Los tres del mismo modo.**
6. Correr `stripe_config` (T0): debe dar **`ok: true` y `mode: "live"`**. Con cualquier `problem`, regresar al paso correspondiente.
7. El health-check diario ya no debe decir "modo de prueba".
8. Mientras no se haga la Fase 3, no anunciar ventas (opcional: dejar `STRIPE_PRICE_ID` vacío salvo durante la prueba, ver §6).

## 6. Fase 3 — Compra REAL de bajo valor y reembolso

Con la tarjeta personal del dueño, una cuenta propia nueva y el precio real ($99 MXN; no usar cupón del 100 %: una factura de $0 no prueba el cobro).

| # | Paso | Resultado esperado |
|---|---|---|
| L1 | Contratar PRO desde https://traveliatos.life/dashboard/pro | Checkout en **MXN $99.00**, IVA incluido; si la cuenta es nueva, 30 días de prueba (para probar el **cobro** usar una cuenta que ya tuvo prueba, o terminar la prueba de esa suscripción desde el panel de Stripe) |
| L2 | Ver el cargo en Stripe live → Payments | $99.00 MXN, impuestos desglosados ($13.66 de IVA si hay registro en MX) |
| L3 | En la app | `es_pro = true`; `pro_paid_periods` con la factura live |
| L4 | Webhooks live → el endpoint | todos los eventos 200 |
| L5 | Recibo por correo de Stripe | Monto, moneda y nombre del producto correctos; sin "sin límites" |
| L6 | Reembolso total desde el panel | `reembolso_total_revocado`; suscripción cancelada; `es_pro = false`; periodo `refunded` |
| L7 | Estado de cuenta del banco (5–10 días hábiles) | Cargo y devolución de $99.00 MXN |
| L8 | Firmar la tabla de §8 | — |

## 7. Volver atrás (rollback)

| Situación | Qué hacer | Efecto |
|---|---|---|
| Detener ventas ya (algo sale mal en L1–L6) | Borrar el valor de `STRIPE_PRICE_ID` en Supabase | El checkout responde 503 `stripe_not_configured` (no se crea nada en Stripe); quien ya paga sigue sincronizado porque la llave y el webhook live siguen |
| Precio equivocado | Corregir el precio en Stripe o el `STRIPE_PRICE_ID`; el checkout ya se niega solo si no coincide con $99 MXN/mes IVA incluido | Ningún cobro con otro precio |
| Volver a modo prueba **sin** suscriptores live | Restaurar los tres secretos `sk_test`/`whsec` de prueba/`price` de prueba; deshabilitar el endpoint live | Igual que hoy |
| Volver a modo prueba **con** suscriptores live | No hacerlo: el webhook live dejaría de validar firmas (401) y Stripe reintentaría 3 días. Primero cancelar/reembolsar a esos suscriptores desde el panel live, o mantener las llaves live y solo detener ventas (fila 1) | — |
| La migración 20261024051500 da problemas | Es aditiva: las funciones `prive_record_paid_period`/`prive_mark_paid_period` anteriores están en `20261023090300_prive_core_paid_periods.sql` (volver a correr ese archivo restaura su cuerpo); `stripe_commit_payment_event` puede quedarse (el webhook anterior no la usa) | Sin pérdida de datos |
| Funciones | Publicar de nuevo desde el commit anterior (`f62466e`) | Vuelve el comportamiento previo |

## 8. Firma del dueño

| Fase | Fecha | Resultado | Firma |
|---|---|---|---|
| 0 · Autorizaciones (migración, funciones, Confirm email, revisión legal) | | | |
| 1 · Modo prueba T0–T15 | | | |
| 2 · Configuración live, `stripe_config` ok/live | | | |
| 3 · Compra real L1–L7 | | | |

Solo con las cuatro filas firmadas el veredicto comercial pasa de **CONDICIONADO** a **GO**.
