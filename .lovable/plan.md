# Cobro real de IATOS PRO ($99 MXN/mes, trial 30 días)

## Estado verificado hoy (antes de planear)

- La tabla `subscriptions` **sí existe** en la base (1 fila), con columnas `user_id`, `stripe_customer_id`, `stripe_subscription_id`, `status`, `trial_end`, `current_period_end`, timestamps.
- Tiene RLS activa con **dos políticas duplicadas** de lectura propia (`Users view own subscription` y `subscriptions_select_own`), y **cero GRANTs**: hoy el cliente no puede leerla aunque exista (error de permisos).
- `profiles.tier = 'pro'` para los **10 usuarios** existentes. Ese campo es hoy el único "PRO" y no lo consume ninguna pantalla.
- No hay ni una línea de código de Stripe en `src/` ni en `supabase/functions/`.
- `/dashboard/pro` es un `window.location.replace("/dashboard/concierge")` en `src/pages/SoonPages.tsx`.

## 1. Qué necesito de tu lado (bloqueante)

En esta sesión **no tengo disponibles las herramientas de pagos nativos de Lovable** (Stripe/Paddle gestionados). Eso normalmente significa que la función de Payments no está habilitada en el workspace — requiere **plan Pro o superior** y activarla desde el proyecto.

Dos caminos, decides tú:

- **A. Stripe nativo de Lovable (recomendado).** No necesitas cuenta de Stripe ni API keys: Lovable crea el entorno de prueba, y los productos/precios los creo yo desde la integración (no tienes que crear Price IDs a mano). Para cobrar en vivo hay que reclamar la cuenta y verificarla. **Acción tuya: habilitar Payments en el proyecto (plan Pro) y avisarme.**
- **B. Stripe con tu propia cuenta (BYOK).** Tú creas la cuenta Stripe, el producto "IATOS PRO $99 MXN/mes" con trial de 30 días, y me das `STRIPE_SECRET_KEY` (y luego el `STRIPE_WEBHOOK_SECRET`) en Configuración → Secrets. Yo escribo todo el código. Más trabajo manual tuyo, pero funciona hoy mismo.

El resto del plan es idéntico en ambos casos salvo el helper de creación del checkout.

## 2. Modelo de datos y RLS

Reutilizo `subscriptions`, sin recrearla. Migración:

- Añadir `plan text` (`pro`), `price_id text`, `cancel_at_period_end boolean default false`, `currency text default 'MXN'`.
- `unique (user_id)` e índice en `stripe_customer_id` y `stripe_subscription_id`.
- Borrar la política duplicada, dejar una sola: `SELECT` para `authenticated` con `auth.uid() = user_id`.
- **Sin políticas de INSERT/UPDATE/DELETE para el usuario**: solo el webhook (service_role, dentro de la edge function) escribe. Así nadie se auto-asigna PRO.
- `GRANT SELECT ON public.subscriptions TO authenticated;` y `GRANT ALL ... TO service_role;` (hoy faltan y por eso la tabla es inalcanzable).
- Función `public.is_pro(uuid)` `security definer stable`: devuelve true si hay fila con `status in ('active','trialing')` y `current_period_end > now()`. Sirve para futuras políticas RLS de features PRO.
- Trigger de `updated_at` (ya existe `set_updated_at`).
- Backfill: a los 10 usuarios actuales les inserto una fila `status='trialing'` con `trial_end = now() + 30 días` para no cortarles el acceso de golpe (decisión tuya, ver punto 5).

`profiles.tier` deja de ser fuente de verdad; queda como campo informativo.

## 3. Edge functions nuevas

Las tres se declaran en `supabase/config.toml`.

| Función | verify_jwt | Qué hace |
|---|---|---|
| `stripe-checkout` | `true` | Valida JWT con `getAuthUser`, crea/reutiliza el customer de Stripe, crea la Checkout Session en modo `subscription` con `trial_period_days: 30`, `success_url`/`cancel_url` a `/dashboard/pro`. Devuelve la URL. |
| `stripe-portal` | `true` | Valida JWT, abre el Billing Portal del customer del usuario para cancelar/cambiar tarjeta. |
| `stripe-webhook` | `false` | Único endpoint público. Verifica la **firma de Stripe** (`STRIPE_WEBHOOK_SECRET`) antes de tocar nada; sin firma válida → 401. Escribe en `subscriptions` con service_role. |

Reglas del project knowledge que se respetan: gate de auth siempre **después** del manejo de `OPTIONS`; nunca se acepta service role key enviada desde el cliente; el webhook es fail-closed si falta el secreto.

Eventos que maneja el webhook: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`. Cada uno hace upsert por `user_id` (guardado en `client_reference_id` y en metadata de la suscripción).

Sobre el trial: **con tarjeta pero sin cobro hasta el día 30** (`trial_period_days: 30` en Checkout). Es lo más simple y confiable con Stripe; el trial sin tarjeta exige crear suscripciones vía API y da mucho más fraude/abandono silencioso. Si prefieres sin tarjeta, lo digo en riesgos.

## 4. Gate real en la app

- Hook `useSubscription()` (React Query): lee `subscriptions` del usuario y devuelve `{ isPro, isTrialing, daysLeft, status }`.
- `src/pages/SoonPages.tsx`: elimino el redirect. `/dashboard/pro` pasa a ser una **página real de suscripción**: precio $99 MXN, estado actual, botón "Empezar prueba de 30 días" (→ `stripe-checkout`) o "Gestionar suscripción" (→ `stripe-portal`).
- Componente `<ProGate>`: si no hay PRO ni trial, muestra un paywall elegante con CTA a `/dashboard/pro` en vez de la feature.
- Rutas que quedan detrás del gate (propuesta, confirma tú):
  `/dashboard/concierge`, `/dashboard/planear` (más allá de N viajes), `/dashboard/ruta`, `/dashboard/members`, `/dashboard/reservas`, `/dashboard/beneficios`, `/dashboard/comparar`.
  Libres: inicio, mis viajes (lectura), perfil, cercanos, favoritos, convertidor.
- **Gate también en el servidor**, no solo en la UI: las funciones caras (`concierge-chat`, `analizar-viaje`, `serpapi-quote`, `logistics-plan`, `recomendar-destinos`) consultan `is_pro(user.id)` y devuelven 402 si no aplica. Sin esto, el paywall se salta con un `fetch` a mano.
- El badge "Concierge Pro" del sidebar muestra "Prueba: N días" cuando está en trial.

## 5. Riesgos y decisiones tuyas

1. **Payments nativos requieren plan Pro.** Si no lo habilitas, vamos por BYOK y necesito tu `STRIPE_SECRET_KEY`.
2. **Los 10 usuarios actuales.** ¿Trial de 30 días automático (mi propuesta), PRO vitalicio de cortesía, o cortarles ya?
3. **Trial con o sin tarjeta.** Recomiendo con tarjeta (mejor conversión al día 30, cero fricción técnica).
4. **¿Concierge limitado o bloqueado?** Alternativa a bloquear todo: dejar 3 mensajes/mes al concierge y 1 viaje analizado gratis como anzuelo. Cuesta unas horas más de trabajo (contadores de uso).
5. **IVA / facturación en México.** Stripe puede calcular impuestos, pero el CFDI no lo emite. Si vendes a mexicanos vas a necesitar un proceso de facturación aparte.
6. **El landing dice "Primer mes gratis"** — con trial de 30 días es consistente, pero conviene añadir letra chica de "requiere tarjeta".
7. Mientras Stripe esté en modo prueba, nadie paga de verdad: hay que reclamar y verificar la cuenta antes de anunciarlo.

## Orden de ejecución

1. Decides camino A o B y respondes los puntos 2, 3 y 4 de arriba.
2. Migración de `subscriptions` (grants, política única, `is_pro`, backfill).
3. Producto y precio en Stripe.
4. Las 3 edge functions + config.toml.
5. Hook, `<ProGate>`, página `/dashboard/pro`, gates de servidor.
6. Prueba de punta a punta en modo test: alta → trial → portal → cancelación.
