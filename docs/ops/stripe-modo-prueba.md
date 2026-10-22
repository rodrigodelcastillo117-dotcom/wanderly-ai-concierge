# Probar reembolsos, disputas y borrado de cuenta en Stripe (modo PRUEBA)

Runbook para el dueño **después de publicar** `stripe-webhook`, `delete-account` y las migraciones
`20261022146*`. Todo en **modo prueba** de Stripe (interruptor "Test mode" del Dashboard): ninguna
tarjeta real, ningún cobro ni reembolso real. No lo corras en modo live.

> Auditoría de cierre (2026-10-22): el procedimiento completo para pasar a cobro real (modo prueba →
> live → compra real reembolsada → rollback) está en `docs/iatos/cierre/STRIPE_CERTIFICACION.md`.
> Antes de los escenarios corre `health-check?action=stripe_config` (revisa precio, webhook, portal e
> impuestos con la llave del servidor, solo lectura) y aplica la migración `20261024051500`.

## Antes de empezar

1. En Stripe (modo prueba) → Developers → Webhooks → endpoint de prueba que apunta a
   `https://<proyecto>.supabase.co/functions/v1/stripe-webhook`:
   - eventos: `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
     `invoice.payment_succeeded`, `invoice.payment_failed`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`;
   - versión de API del endpoint: `2024-12-18.acacia` (la del código y de las pruebas).
2. En Supabase, los secretos `STRIPE_SECRET_KEY` (sk_test_…) y `STRIPE_WEBHOOK_SECRET` (whsec_… del
   endpoint de prueba) apuntan al modo prueba.
3. Ten a la mano esta consulta (editor SQL) para ver cada decisión:
   ```sql
   SELECT event_created, type, action, subscription_id, account_id, before_state, after_state, alert_status
   FROM public.stripe_payment_events ORDER BY event_created DESC LIMIT 20;
   ```
   y esta para ver el acceso de la cuenta de prueba:
   ```sql
   SELECT s.status, s.current_period_end, public.is_pro(s.user_id) AS es_pro
   FROM public.subscriptions s JOIN auth.users u ON u.id = s.user_id WHERE u.email = '<correo-de-prueba>';
   ```

Usa una cuenta de prueba nueva por escenario (un correo tuyo con `+prueba1`, `+prueba2`, …).

## Tarjetas de prueba

| Tarjeta | Para qué |
|---|---|
| `4242 4242 4242 4242` | Pago normal |
| `4000 0000 0000 0259` | El cargo se paga y luego entra en **disputa** (fraude) |

Cualquier fecha futura y CVC de 3 dígitos. El resultado de una disputa de prueba lo decide la
evidencia que envíes: el texto `winning_evidence` la gana y `losing_evidence` la pierde (ver la
guía de pruebas de disputas de Stripe para la lista completa de tarjetas).

## Escenarios

| # | Pasos | Resultado esperado |
|---|---|---|
| 1 | Contrata PRO con 4242. Dashboard → Payments → el cargo → **Refund** total. | `action = reembolso_total_revocado`; la suscripción queda `canceled` en Stripe; `es_pro = false`. |
| 2 | Igual que 1, pero antes agrega el correo a `comp_grants` y confirma la cuenta. | `reembolso_total_conserva_cortesia`; `es_pro = true` (comped); Stripe ya no cobra. |
| 3 | Contrata con 4242 y haz un **reembolso parcial** (p. ej. $30). | `reembolso_parcial_conserva_revision`; `es_pro = true`. |
| 4 | Contrata con `4000 0000 0000 0259`. | Llega `charge.dispute.created`: `disputa_abierta_aviso`, aviso en la campana de admins (y correo si hay Resend); `es_pro` sin cambio. |
| 5 | En la disputa del 4, envía evidencia con el texto `losing_evidence` (Dashboard → la disputa → Submit evidence). | `charge.dispute.closed` con `lost`: `disputa_perdida_revocado` y aviso; `es_pro = false`. |
| 6 | Repite 4 y envía evidencia `winning_evidence`. | `charge.dispute.closed` con `won`: `disputa_ganada_estado_stripe`; el estado es el que diga Stripe. |
| 7 | Reenvía un evento ya procesado (Webhooks → el evento → **Resend**). | Respuesta `duplicate: true`; nada cambia y no se duplica el aviso. |
| 8 | Fuera de orden: en un escenario 1, reenvía después el `invoice.paid` viejo de ese cargo. | Sigue `es_pro = false` (evento viejo ignorado; la suscripción ya está cancelada en Stripe). |
| 9 | Con una cuenta PRO de prueba, elimínala desde Perfil. Luego reenvía cualquier evento viejo de su cliente. | `deletion_requests` en `completed` (o `identity_deleted` si falta la llave de PostHog); en Stripe la suscripción cancelada, sin métodos de pago y el cliente sin nombre/correo. Los eventos reenviados responden `ignored: cuenta_eliminada` / `cuenta_eliminada_sin_cambios` y no aparece ninguna fila nueva en `subscriptions`. |

Para escenarios de renovación (por ejemplo, reembolsar la factura del **segundo** mes y ver que
un reembolso de la del primero queda `…_factura_anterior_revision`), usa **Test clocks**
(Billing → Test clocks): crea el cliente dentro de un reloj, contrata y avanza el reloj 1 mes.

## Si algo no sale como se espera

- `stripe_payment_events` sin fila y Stripe muestra reintentos: revisa los logs de la función
  `stripe-webhook` (solo muestran ids de Stripe y la decisión).
- Una decisión inesperada: copia `event_id`, `action`, `before_state` y `after_state` y repórtala;
  no reviertas a mano sin revisar.
