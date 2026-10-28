# Tareas de operación que hace una persona

El agente de Lovable tiene prohibido por política tocar secretos y programar
tareas, así que estos pasos los hace el dueño del proyecto.

## Orden de publicación: primero migraciones, luego el frontend

Al publicar una versión nueva, aplica **primero** todas las migraciones pendientes de
`supabase/migrations/`, después las funciones y **al final** el frontend (Publish).

- Si el frontend sale antes, consulta columnas que todavía no existen. Ejemplo real (N-03 en
  `docs/iatos/IATOS_E2E_EVIDENCE.md`): el Concierge lee `profiles.active_trip_id`, que llega con
  `20261022131000_active_trip_and_fixer_status.sql`; sin ella, PostgREST responde **400**.
- El frontend ya tolera ese caso (deja de preguntar tras el primer error y usa la elección local del
  dispositivo), pero el "viaje en contexto" no se guarda en tu perfil hasta que apliques la migración.
- Para comprobarlo en el SQL editor (si no devuelve ninguna fila, la migración falta):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'active_trip_id';
```

## Programar tareas automáticas y activar el panel de métricas

Activa **tres** revisiones automáticas y te da acceso a `/dashboard/admin`:

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `flight-watch-every-15-min` | cada 15 min | Revisa los vuelos rastreados y avisa cambios (cancelación, retraso, puerta, hora). |
| `price-watch-twice-daily` | 03:17 y 15:17 UTC (21:17 y 09:17 CDMX) | Revisa las alertas de baja de precio. |
| `health-check-daily` | 13:07 UTC (07:07 CDMX) | Revisa los servicios externos y que las otras tareas sí corran; avisa por correo. |

### Antes: migraciones que deben estar aplicadas

Lovable normalmente las aplica sola. Si alguna falta, pégala completa en el SQL editor y presiona
**Run** (todas se pueden repetir sin riesgo):

- `20261017170000_price_watches.sql` y `20261018090000_price_watch_baseline_source.sql` (alertas de precio)
- `20261018120000_admin_metrics_and_referrals.sql` (panel de métricas y administradores)
- `20261022090000_health_checks.sql` (resultados del chequeo diario)
- `20261022120000_security_p0_fixes.sql` (seguridad de vuelos rastreados)
- `20261022132000_ops_flight_watch_reliability.sql` (reparto de vuelos entre corridas, errores del proveedor)
- `20261022132100_ops_notifications_dedup.sql` (avisos sin duplicados)
- `20261022132200_ops_price_watch_original_currency.sql` (precios comparados en dólares)
- `20261022132300_ops_health_check_jobs_and_email.sql` (revisión de tareas y resultado del correo)

Sin las cuatro últimas, la versión nueva de `flight-watch-cron`, `price-watch-cron` y
`price-watch` falla (no encuentra `claim_tracked_flights`, `notify_once` o las columnas nuevas).
Aplícalas **antes** de publicar las funciones.

### Pasos

1. Abre el proyecto en Lovable → pestaña **Cloud** → **SQL editor**.
2. Copia todo el contenido de [`programar-tareas.sql`](./programar-tareas.sql).
3. En la sección 4, cambia `TU-CORREO@ejemplo.com` por el correo con el que
   inicias sesión en IATOS.
4. Pega en el editor y presiona **Run**.
5. Al final verás dos tablas: los **3** trabajos programados
   (`flight-watch-every-15-min`, `health-check-daily`, `price-watch-twice-daily`) y tu correo
   como administrador. Si ves eso, quedó listo.

Es seguro correrlo más de una vez. No contiene ninguna llave: el secreto se
genera dentro de la base de datos (Supabase Vault) y nadie lo ve.

Para comprobar después que las tareas corren (lo mismo que revisa el chequeo diario):

```sql
SELECT j.jobname, j.schedule, d.status, d.start_time
FROM cron.job j
LEFT JOIN LATERAL (SELECT status, start_time FROM cron.job_run_details r
                   WHERE r.jobid = j.jobid ORDER BY start_time DESC LIMIT 1) d ON true
ORDER BY j.jobname;
```

### Correo de alertas del chequeo diario

- Necesita los secretos `LOVABLE_API_KEY` y `RESEND_API_KEY` en las funciones.
- Mientras el dominio `traveliatos.life` **no esté verificado en Resend**, Resend solo entrega
  correo a la dirección dueña de la cuenta de Resend. Pon esa dirección en el secreto
  `HEALTH_ALERT_EMAIL` (puedes poner varias separadas por coma cuando el dominio ya esté
  verificado). Si no existe, se manda a cada administrador por separado.
- Solo se manda correo cuando cambia lo que falla o necesita atención; si sigue igual, se repite
  como recordatorio una vez por semana. El panel muestra si el último correo se mandó o falló,
  y avisa si el último chequeo tiene más de 26 horas (la tarea dejó de correr).

### Costo de la vigilancia de vuelos (SerpApi)

Cada revisión de un vuelo es una búsqueda de SerpApi. Un vuelo se revisa cada 15 min solo del día
anterior al siguiente de su fecha; a 2–3 días, cada 3 h; a más de 3 días, cada 6 h. Deja de
revisarse cuando aterriza, se cancela o pasa su fecha. Máximo por corrida: secreto
`FLIGHT_WATCH_MAX_CHECKS` (por defecto 50). Si se acaban las búsquedas, la corrida se detiene y
el chequeo diario lo reporta.

### Administradores

Para dar acceso de administrador a otra persona, corre solo la sección 4 con su correo. Ojo: los
administradores también reciben el correo de alertas si no configuraste `HEALTH_ALERT_EMAIL`, y
mientras el dominio no esté verificado su envío falla (el tuyo no se bloquea: va por separado).
Para quitárselo:

```sql
DELETE FROM public.admins
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = lower('correo@ejemplo.com'));
```

## Regalar IATOS PRO a alguien

La migración `20261021090000_comp_grants.sql` crea la lista `comp_grants`: quien
esté en ella queda PRO de cortesía (sin cobro ni vencimiento) al confirmar su
correo, o al instante si ya tiene cuenta. Para agregar a alguien:

```sql
INSERT INTO public.comp_grants (email) VALUES (lower('correo@ejemplo.com'))
ON CONFLICT (email) DO NOTHING;

-- Aplica la lista a cuentas que ya existen y dice a quién NO se le aplicó.
SELECT * FROM public.apply_comp_grants_now();
```

Reglas (migración `20261022130000_pay_stripe_sync_and_atomic_quota.sql`):
- Solo cuentan correos **confirmados** (registrarse con un correo ajeno no da PRO).
- Si la persona **ya paga** una suscripción viva en Stripe, la cortesía no la pisa
  (`apply_comp_grants_now` responde "NO aplicado"). Para dejar de cobrarle, cancela su
  suscripción en el dashboard de Stripe; cuando termine, el webhook la deja como cortesía.
- Stripe nunca le quita la cortesía a una fila `comped`.

### Quitar la cortesía a alguien

Quitar el correo de `comp_grants` a mano **no** le quita el PRO: la fila `comped` no vence. Usa
`revoke_comp` (migración `20261022141950_sec2_stripe_refunds_and_revoke_comp.sql`). Nada la llama
sola: solo se revoca cuando tú la ejecutas.

```sql
SELECT public.revoke_comp('correo@ejemplo.com');
-- {"email": "correo@ejemplo.com", "grant_removed": true, "accounts_revoked": 1}
```

- Borra el correo de la lista (ya no se vuelve a aplicar si se registra de nuevo).
- Las cuentas con ese correo en `comped` pasan a `canceled` desde ese momento (plan gratis).
- No toca suscripciones pagadas: si esa persona además paga en Stripe, el siguiente evento de
  Stripe vuelve a escribir su estado real.
- `accounts_revoked: 0` con `grant_removed: true` = estaba en la lista pero no tenía cuenta con
  cortesía (por ejemplo, nunca confirmó su correo).

## Members Only: exclusivo de IATOS PRO

Desde la migración `20261022146000_sec2_members_pro_access.sql` el acceso a Members Only lo da el
**plan**: PRO pagado, prueba vigente o cortesía (`is_pro`). Quien no lo tiene ve un adelanto
(ciudades, categorías y cuántos lugares hay) sin nombres, direcciones, sitios ni reservas; la base
(RLS de `nightlife_premium`) no le entrega esos datos aunque los pida directo, y `nightlife-discover`
y las reservas de `concierge-action` también lo revisan en el servidor.

### Antes de aplicar: ¿quién perdería el acceso?

Los desbloqueos con la contraseña vieja (comprometida) **dejan de contar**. Corre esta consulta de
solo lectura en el editor SQL antes de aplicar la migración; lista a quien hoy tiene
`password_unlocked` pero no tiene PRO (esas personas pasarían a ver el adelanto):

```sql
SELECT u.email, na.password_unlocked_at, s.status AS estado_suscripcion
FROM public.nightlife_access na
JOIN auth.users u ON u.id = na.user_id
LEFT JOIN public.subscriptions s ON s.user_id = na.user_id
WHERE na.password_unlocked AND NOT public.is_pro(na.user_id)
ORDER BY na.password_unlocked_at DESC;
```

Si sale vacía, nadie pierde acceso. Si sale alguien que debe conservarlo, dale cortesía
(`comp_grants`, sección "Regalar IATOS PRO") o PRO antes de aplicar.

### Contraseña temporal (apagada por defecto)

Solo para una transición; caduca sola (máximo 30 días) y nunca va en el código ni en el repo. Para
que la contraseña en claro no quede en el historial del editor SQL de producción, genera el hash
en un Postgres local (o cualquier herramienta bcrypt `$2a$`) y pega solo el hash:

```sql
-- En un Postgres LOCAL (no producción): normaliza en minúsculas y sin espacios al inicio/fin.
SELECT crypt(lower(btrim('<contraseña-nueva-de-12+-caracteres>')), gen_salt('bf', 10));

-- En producción, con el hash resultante y una caducidad (máx. 30 días):
SELECT public.set_members_password_hash('$2a$10$...', now() + interval '14 days');
```

Quien la use tiene acceso solo hasta esa caducidad. 10 intentos por hora por persona.

**Rotar o apagar** (por ejemplo, si la contraseña se filtró):

```sql
-- Apaga la contraseña y corta de inmediato los accesos que dio (los PRO no se ven afectados):
SELECT public.disable_members_password(true);
-- Si hace falta una nueva, vuelve a correr set_members_password_hash con otro hash y caducidad.
```

La contraseña anterior que estaba en el código ya no sirve: la migración retiró la función sin
caducidad y apagó cualquier hash previo.

## Reembolsos y disputas de Stripe

`stripe-webhook` aplica esta política con el estado **vivo** de Stripe (migración
`20261022146100_sec2_stripe_payment_integrity.sql`):

| Evento | Qué pasa |
|---|---|
| Reembolso **total** del cargo de la factura vigente | La suscripción se cancela ya en Stripe y se quita el acceso que pagaba, salvo otro derecho válido (cortesía, otra suscripción viva, prueba vigente). |
| Reembolso total de una factura anterior | Se registra para revisión; el periodo vigente lo pagó otra factura. |
| Reembolso **parcial** | Se conserva el acceso y se registra para revisión. |
| `charge.dispute.created` | Se registra y se avisa a los administradores (campana y, si hay Resend, correo a `HEALTH_ALERT_EMAIL` o a los admins). No se cancela. |
| `charge.dispute.closed` perdida | Igual que un reembolso total, con aviso. |
| `charge.dispute.closed` ganada | Se vuelve a leer la suscripción en Stripe y se escribe su estado real. |

Nunca da PRO, no repite un evento ya registrado (idempotente por `event_id`), ignora un evento viejo
que llegue después (por ejemplo, un `invoice.paid` anterior al reembolso) y no escribe nada para una
cuenta eliminada.

**Paso del dueño:** en Stripe → Developers → Webhooks → el endpoint de `stripe-webhook`, agrega
`charge.refunded`, `charge.dispute.created` y `charge.dispute.closed`. Revisa también la **versión
de API del endpoint**: las pruebas usan la forma de `2024-12-18.acacia` (la del código); si el endpoint
está en otra versión, el webhook busca la factura por `payment_intent`, pero conviene alinearla.

Revisión (sin datos personales):

```sql
SELECT event_created, type, action, charge_id, subscription_id, account_id,
       amount, amount_refunded, dispute_reason, alert_status, before_state, after_state
FROM public.stripe_payment_events ORDER BY event_created DESC LIMIT 50;
-- Pendientes de revisión humana:
SELECT * FROM public.stripe_payment_events
WHERE action LIKE '%revision%' OR action LIKE 'disputa_abierta%' ORDER BY event_created DESC;
```

Cómo probarlo en modo prueba de Stripe: `docs/ops/stripe-modo-prueba.md`.

## Eliminación de cuenta: pasos, reintentos y llaves

Cada eliminación es una solicitud en `deletion_requests` con 5 pasos en `deletion_request_steps`
(migración `20261022146200_sec2_deletion_requests.sql`):

| Paso | ¿Bloquea borrar la identidad? | Qué hace |
|---|---|---|
| `stripe_cancel` | Sí | Cancela todas las suscripciones vivas y quita los métodos de pago guardados. |
| `storage` | Sí | Borra los archivos del usuario en todos los buckets. |
| `db_purge` | Sí | `purge_account_data`. |
| `stripe_customer_redact` | No | Quita nombre, correo, teléfono y dirección del cliente en Stripe (no lo borra: Stripe conserva facturas y cargos por ley y para disputas; borrar el Customer no los elimina). |
| `posthog_delete` | No | Pide a PostHog borrar la persona y sus eventos (`distinct_id` = id de la cuenta). |

La cuenta (auth) se borra solo cuando los tres bloqueantes terminaron. Si uno falla, la persona ve
que su solicitud quedó registrada y puede reintentar; nada se borra a medias.

**Llaves nuevas (paso del dueño, no se inventan):** `POSTHOG_PERSONAL_API_KEY` (llave personal con
alcance `person:write`) y `POSTHOG_PROJECT_ID` (y opcional `POSTHOG_API_HOST`, por defecto
`https://us.posthog.com`). Sin ellas, `posthog_delete` queda en `pending_key` y se completa en el
siguiente reintento después de configurarlas.

**Reintentos:** la función `account-deletion-retry` (autenticación de cron, falla cerrada) reanuda
solicitudes pendientes; un paso que falló 8 veces queda para revisión. Programarla (después de
publicarla), igual que las otras tareas:

```sql
SELECT cron.schedule('account-deletion-retry-hourly', '23 * * * *', $$
  SELECT net.http_post(
    url := 'https://<proyecto>.supabase.co/functions/v1/account-deletion-retry',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)),
    body := '{}'::jsonb)
$$);
```

(mismo secreto de cron que `docs/ops/programar-tareas.sql` usa para las otras tareas; cambia `<proyecto>`).

Revisar:

```sql
SELECT r.id, r.status, r.created_at, s.step, s.status, s.attempts, s.last_error
FROM public.deletion_requests r JOIN public.deletion_request_steps s ON s.request_id = r.id
WHERE r.status <> 'completed' ORDER BY r.created_at, s.step;
```

## Revisiones de seguridad después de aplicar las migraciones `2026102214*`

1. **Códigos de invitación duplicados.** La migración `20261022141200_sec2_profiles_sensitive_columns.sql`
   crea un índice único en `invite_code` solo si no hay duplicados (si los hay, deja un NOTICE).
   Revisa:
   ```sql
   SELECT upper(invite_code), count(*) FROM public.profiles
   WHERE invite_code IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
   ```
   Si sale algo, regenera el código de los repetidos (`UPDATE public.profiles SET invite_code =
   public.gen_invite_code() WHERE id = '<id>'`) y vuelve a correr la migración.
2. **IP real en el límite por IP.** El límite por IP ya no usa el primer `X-Forwarded-For` (lo escribe
   el cliente) sino `cf-connecting-ip`, luego `x-real-ip` y luego el **último** `X-Forwarded-For`
   (`supabase/functions/_shared/rate-limit-core.ts`). Para confirmarlo en vivo, manda a cualquier
   función una petición con el encabezado `X-Forwarded-For: 1.2.3.4` y revisa en
   `SELECT subject FROM public.rate_limits ORDER BY created_at DESC LIMIT 5;` que la IP guardada
   **no** sea `1.2.3.4`.
3. **Límites de uploads.** Revisa en Storage → cada bucket (`recibos`, `journal-photos`,
   `travel-moments`) que diga 10 MB y la lista de tipos (imágenes; PDF solo en `recibos`).

## IATOS Privé: invitaciones y antigüedad

Privé ("The 90-Day Invitation") invita a quien tiene PRO vigente y **90 días pagados** (o una concesión), y
cada miembro entra con **su propia** contraseña Privé. Política completa:
`docs/iatos/IATOS_PRIVE_MEMBERSHIP_POLICY.md`; seguridad y SQL de administración:
`docs/iatos/IATOS_PRIVE_INVITATIONS.md`; correo: `docs/iatos/IATOS_PRIVE_EMAIL_DESIGN.md`.
**Nada de esto está activo** hasta que hagas estos pasos (requieren tu GO).

### Secretos de las funciones

| Secreto | ¿Nuevo? | Para qué | Si falta |
|---|---|---|---|
| `PRIVE_IP_SALT` | **Sí** | Sal del `ip_hash` del límite por conexión (30 fallos/hora → 60 min fuera). Pon un texto aleatorio largo (por ejemplo, 64 caracteres de un generador de contraseñas) y no lo compartas. | Se omite **solo** el límite por conexión (el de cada cuenta sigue) y la función lo advierte en sus registros. Nunca se inventa una sal. |
| `SITE_URL` | Opcional | Dominio de los enlaces del correo (`https://traveliatos.life` por defecto). Solo acepta `https`. | Usa el valor por defecto. |
| `SUPPORT_EMAIL` | Opcional | Contacto de soporte en el pie de los correos (`hola@traveliatos.life` por defecto). | Usa el valor por defecto. |
| `PRIVE_REPLY_TO` | **Sí**, opcional | Buzón que **sí recibe** para el Reply-To de la invitación Privé (p. ej. `hola@traveliatos.life` cuando tenga MX). Con él, el pie dice "basta con responder a este correo". Ver `docs/iatos/IATOS_ENTREGABILIDAD_CORREO.md`. | La invitación sale sin Reply-To y el pie muestra `SUPPORT_EMAIL`. |
| `LOVABLE_API_KEY`, `RESEND_API_KEY` | Ya existen | Enviar la invitación y los avisos de seguridad. | No se manda correo; la invitación queda pendiente y el aviso en la app sí aparece. |
| `STRIPE_SECRET_KEY` | Ya existe | Solo lectura de facturas para el respaldo. | El respaldo responde `stripe_not_configured`. |

### Orden de publicación

1. Migraciones (SQL editor, en este orden; se pueden repetir sin riesgo):
   `20261023090000_prive_core_tables.sql`, `20261023090100_prive_core_access.sql`,
   `20261023090200_prive_core_password_sessions.sql`, `20261023090300_prive_core_paid_periods.sql`.
   Si el grupo catálogo ya creó `prive_events`, la primera no la toca (`CREATE TABLE IF NOT EXISTS`).
2. Funciones: `stripe-webhook` (versión nueva), `prive-access`, `prive-cron`, `prive-tenure-backfill`.
   `supabase/config.toml` ya trae `prive-cron` y `prive-tenure-backfill` con `verify_jwt = false`
   (se protegen con el secreto de cron, igual que las demás tareas) y `prive-access` con `verify_jwt = true`.
3. Secreto `PRIVE_IP_SALT` (y opcionales).
4. **Respaldo de antigüedad** (abajo): primero simulación, revisas números, después real.
5. Programar `prive-cron` (abajo). Desde ese momento empiezan las invitaciones.
6. Frontend (grupo ui).

Si publicas `stripe-webhook` antes que las migraciones, no pasa nada grave: registra en sus
bitácoras "migración de Privé pendiente" y no hace reintentar a Stripe; el respaldo recupera después
esas facturas.

### Respaldo de antigüedad (una vez)

Lee de Stripe (solo lectura) las facturas pagadas de los clientes que ya están en `subscriptions` y
guarda sus periodos. Es idempotente (la factura es la llave): repetirlo no duplica días. Va por lotes
de clientes (`limit`, máximo 100) con `offset`; la respuesta trae `next_offset` (null = terminó).

```sql
-- 1) SIMULACIÓN (no escribe nada). Cambia offset para el siguiente lote.
SELECT net.http_post(
  url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/prive-tenure-backfill',
  headers := jsonb_build_object('Content-Type', 'application/json',
    'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)),
  body := '{"dry_run": true, "limit": 50, "offset": 0}'::jsonb,
  timeout_milliseconds := 120000) AS request_id;
-- Unos segundos después, el resultado (customers, invoices_seen, paid_periods, skipped, next_offset):
SELECT id, status_code, content::jsonb FROM net._http_response ORDER BY id DESC LIMIT 3;

-- 2) REAL: el mismo llamado con "dry_run": false, lote por lote hasta next_offset = null.
```

Después del respaldo, quién quedaría invitado en la primera corrida (solo lectura):

```sql
SELECT count(*) FILTER (WHERE public.prive_tenure_days(s.user_id) >= 90) AS con_90_dias,
       count(*) AS pro_vigentes
FROM public.subscriptions s WHERE public.is_pro(s.user_id);
```

### Programar `prive-cron` (cada hora)

Evalúa quién cumple, crea su invitación y su aviso (una sola vez por persona), manda los correos
pendientes con reintentos (15 min, 1 h, 6 h, 24 h; máximo 5) y cierra las sesiones Privé de quien ya no
tiene derecho. **No lo programes en producción sin tu GO.**

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prive-cron-hourly') THEN
    PERFORM cron.unschedule('prive-cron-hourly');
  END IF;
END $$;
SELECT cron.schedule(
  'prive-cron-hourly',
  '23 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/prive-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cmd$
);
```

Revisión (solo conteos, sin datos personales):

```sql
SELECT status, basis, count(*) FROM public.prive_memberships GROUP BY 1, 2;
SELECT email_status, count(*) FROM public.prive_invitations WHERE revoked_at IS NULL GROUP BY 1;
SELECT event, count(*) FROM public.prive_membership_events WHERE at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC;
```

Para apagarlo: `SELECT cron.unschedule('prive-cron-hourly');` (las membresías y contraseñas se
quedan; solo dejan de crearse invitaciones y de barrerse sesiones; `prive_require` sigue revisando
todo en vivo).

### Dar o quitar Privé a mano

Concesiones, revocaciones por fraude, restauraciones y desbloqueos: SQL listo en
`docs/iatos/IATOS_PRIVE_INVITATIONS.md` §8. Todo queda en `prive_membership_events` con tu nombre.

## Mesa de operaciones (solicitudes que atiende una persona)

Pantalla: `/admin/operaciones` (también `/dashboard/admin/operaciones`, botón en Métricas y en Perfil). Solo
cuentas en `public.admins` (paso 4 de `programar-tareas.sql`); la base lo exige en cada función.

- Migración: `supabase/migrations/20261028180000_mesa_operaciones.sql` (idempotente). Pruebas: `supabase/tests/mesa/`.
- Funciones a publicar: `concierge-action` (aviso al dueño con marca de enviado y enlace a la mesa),
  `ops-desk` (nueva; correo al usuario con la respuesta del equipo), `health-check` (reintento de correos),
  `concierge-chat` (textos de Iato: lo atiende una persona, respuesta en la app y por correo, sin tiempos).
- Orden: primero la migración, después las funciones. Si `concierge-action` se publica antes, el aviso al
  dueño sale igual (sin marca).
- Secretos opcionales: `FIXER_EMAIL` (uno o varios correos separados por coma, `teamEmails()`; por omisión hola@traveliatos.life), `OPS_REPLY_FROM` (remitente del
  correo al usuario, por omisión `IATOS <hola@traveliatos.life>`), `SITE_URL`.

Reintento: la revisión diaria de `health-check` reenvía los avisos al dueño y las respuestas a usuarios que
fallaron (máximo 6 y 5 intentos, últimos 3 y 7 días). Para reintentar cada 15 minutos se puede programar SOLO
esa acción. **No está programada**; si el dueño lo decide:

```sql
SELECT cron.schedule(
  'ops-correos-every-15-min',
  '*/15 * * * *',
  $cmd$
  SELECT net.http_post(
    url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/health-check?action=ops_correos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cmd$
);
```

## Cuenta y Privé: arreglos de la auditoría del 28-oct-2026 (rama `claude/fix-cuenta-prive`)

**Orden:** 1) migración `supabase/migrations/20261029020000_fix_cuenta_prive.sql` (idempotente; pruebas en
`supabase/tests/fix_cuenta_prive/`), 2) funciones, 3) frontend (Publish).

- La migración agrega `pro_basis` a `prive_status()` (`paid` / `trial` / `comped`) para que Privé le diga a una
  cuenta con PRO de cortesía que la cortesía **no suma días** (antes veía "0 de 90" para siempre). Sin la
  migración el frontend funciona igual que antes (sin el aviso de cortesía).
- La misma migración hace que el panel editorial responda **403** (no 400) a quien no es administrador.
- Funciones a publicar: `email-bienvenida` (saluda por nombre, enlace a Documentos y tarjetas) y las que envían
  correos con `_shared/email.ts`, `_shared/email-kit.ts`, `_shared/email-templates.ts` o
  `_shared/ai-reservations/templates.ts` (lista exacta en el reporte de la rama).

### "Continuar con Google" (apagado hasta que lo actives)

El botón ya existe en `/auth`, pero solo aparece con la variable `VITE_GOOGLE_LOGIN_ENABLED=true`. Antes de
encenderla:

1. En Google Cloud Console → APIs y servicios → Credenciales, crea un "ID de cliente de OAuth" tipo
   **Aplicación web**. En "URI de redireccionamiento autorizados" pon la URL de callback que te muestra Supabase
   (`https://uhkdewinscffhdonhhmt.supabase.co/auth/v1/callback`).
2. En Supabase (Lovable → Cloud → Authentication → Providers → **Google**): actívalo y pega el Client ID y el
   Client Secret.
3. En Supabase → Authentication → URL Configuration, agrega a "Redirect URLs":
   `https://traveliatos.life/auth` (y la URL de vista previa de Lovable si la usas).
4. En Lovable, agrega la variable `VITE_GOOGLE_LOGIN_ENABLED` con valor `true` y publica.
5. Prueba con una cuenta de Google nueva: debe volver a `/auth` con sesión y seguir al onboarding.

Si el proveedor no está activo y enciendes la variable, quien toque el botón verá "No pudimos abrir el inicio
de sesión con Google"; por eso va apagado por omisión.

### Travelpayouts Drive (medición de afiliados): apagado hasta verificar el dominio

Al aceptar cookies, el script `tp-em.com/NTMzMjk5.js` pedía su configuración a `tp-em.com/entrypoint_config` y
recibía **403** sin CORS: errores rojos en la consola y ninguna medición. Ese error de red no se puede atrapar
desde la página, así que el script ahora se carga **solo** con `VITE_TRAVELPAYOUTS_DRIVE_ENABLED=true`. Los
enlaces de afiliado (con su `marker`) no dependen de este script y siguen funcionando.

1. En Travelpayouts → proyecto **533299** → Drive / Tools, confirma que `traveliatos.life` está registrado y
   verificado como dominio del proyecto.
2. Desde tu navegador, con el sitio abierto, comprueba en la consola que ya no aparece "blocked by CORS policy"
   ni "config is not valid" (puedes activarlo primero en la vista previa de Lovable).
3. Entonces agrega en Lovable `VITE_TRAVELPAYOUTS_DRIVE_ENABLED=true` y publica.

### Correos: dominio sin verificar en Resend

Antes, si Resend decía que `traveliatos.life` no estaba verificado, se reenviaba en silencio desde
`onboarding@resend.dev`, que **solo** entrega al dueño de la cuenta de Resend (a los usuarios nunca les
llegaba). Ahora ese envío falla con `domain_not_verified` y queda en el registro de la función. Si quieres que
mientras verificas el dominio te sigan llegando los avisos internos, agrega el secreto
`RESEND_ALLOW_SHARED_SENDER=true` (los usuarios seguirán sin recibir correos hasta verificar el dominio).

Convención de marca: remitente y pie de los correos dicen **IATOS AI** (la empresa, como "© 2026 IATOS AI" del
sitio); el cuerpo habla de **IATOS** (el producto).

### Registro: revela si un correo ya tiene cuenta (decisión pendiente, no se cambió)

Al registrarse con un correo existente, Supabase responde `user_already_exists` y la app dice "Ya existe una
cuenta con este correo". Eso permite averiguar si alguien está registrado. Cerrarlo implica activar la
confirmación de correo obligatoria en Supabase (Authentication → Providers → Email → "Confirm email") y
cambiar el mensaje por uno neutro ("Si el correo es nuevo, te enviamos un enlace…"). Es una decisión de
producto: hoy se prefirió la claridad para el usuario.

### 404, cabeceras de seguridad y sitemap en el hosting de Lovable

- **404 real:** Lovable sirve la app como SPA y responde **HTTP 200** en cualquier ruta (la pantalla 404 la
  dibuja la app). No hay forma de devolver un 404 de servidor desde el código; la pantalla ya es negra, explica
  y no escribe errores en la consola. Si algún día el sitio se sirve desde un hosting con reglas (Cloudflare,
  Netlify, Vercel), se puede configurar ahí.
- **CSP y frame-ancestors / X-Frame-Options:** no se agregaron. Lovable no documenta un archivo `_headers` ni
  otra forma de poner cabeceras de respuesta, y:
  - `Content-Security-Policy-Report-Only` **no funciona** como `<meta>` (los navegadores la ignoran), así que
    no se puede probar en "solo reporte" desde `index.html`;
  - `frame-ancestors` tampoco funciona en `<meta>`;
  - una CSP que bloquea en `<meta>`, sin periodo de prueba, puede romper Google Maps, Stripe, PostHog, Sentry,
    Pexels o Travelpayouts en producción.
  Cuando el dominio pase por un proxy que permita cabeceras (p. ej. Cloudflare delante de traveliatos.life),
  empieza con esta cabecera en modo reporte y revisa los avisos una semana antes de activarla:
  `Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https://js.stripe.com https://*.posthog.com https://maps.googleapis.com https://tp-em.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.posthog.com https://*.sentry.io https://*.ingest.sentry.io https://maps.googleapis.com https://api.stripe.com; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-src https://js.stripe.com https://hooks.stripe.com https://www.google.com; frame-ancestors 'none'`
  y además `X-Frame-Options: DENY`.
- **sitemap.xml:** ya existe en `public/sitemap.xml` (páginas públicas) y `robots.txt` lo anuncia.
