# IATOS Privé · Invitaciones, contraseña, sesiones y seguridad

> Parte de la serie Privé. Quién cumple y por qué: [IATOS_PRIVE_MEMBERSHIP_POLICY.md](IATOS_PRIVE_MEMBERSHIP_POLICY.md).
> Correo: [IATOS_PRIVE_EMAIL_DESIGN.md](IATOS_PRIVE_EMAIL_DESIGN.md). Operación: [docs/ops/LEEME.md](../ops/LEEME.md#iatos-privé-invitaciones-y-antigüedad).
> **Nada de esto está en producción** (rama `claude/wc-prive-core`).

## Resumen para fundadores

- **La invitación es personal.** El enlace del correo solo es un atajo: siempre hay que entrar con **la misma
  cuenta de IATOS** a la que se invitó. Si alguien reenvía el correo, el enlace **no le sirve a otra persona** y queda registrado.
- **El correo nunca lleva contraseña.** Cada miembro crea **su propia** contraseña Privé (o pide una frase generada que se muestra una sola vez).
- **La contraseña se guarda como bcrypt** (irreversible). Ni nosotros podemos leerla.
- **Contra adivinanzas:** tras 5 errores seguidos se bloquea 1 minuto; luego 5, 15 y 60 minutos; a los 15 errores se bloquea
  hasta restablecerla por correo, y se avisa a la persona. Además, una misma conexión que falle más de 30 veces en una hora
  (en cualquier cuenta) queda fuera 60 minutos.
- **Cada desbloqueo vale 12 horas** (2 horas sin uso) y **solo en esa sesión de IATOS**: en otro dispositivo hay que escribir la contraseña de nuevo. Máximo 5 sesiones a la vez.
- **Botones de seguridad para el miembro:** cambiar contraseña, restablecerla por correo, "creo que alguien la conoce" y "cerrar todas las sesiones". Cada cambio sensible avisa en la app y por correo.

---

## 1. Ciclo de vida de una invitación

```
PRO + 90 días pagados (o concesión)
        │  prive-cron, cada hora: prive_evaluate_eligibility
        ▼
membresía 'invited' + invitación + aviso en la app (una sola vez por persona: notify_once 'prive_invite:<id>')
        │  prive-cron: correo con reintentos (15 min, 1 h, 6 h, 24 h; máximo 5)
        ▼
la persona abre el enlace /prive/invitacion#t=… (o el aviso de la app, sin enlace)
        │  prive-access › accept_invitation  →  prive_accept_invitation
        ▼
membresía 'active' (código de miembro IP-XXXX-XXXX)
        │  prive-access › set_password (o generate) → prive_set_password + primera sesión
        ▼
cada visita: prive-access › unlock → sesión Privé → prive_require en cada pantalla
```

- **Nunca se duplica:** la membresía usa la cuenta como llave (`ON CONFLICT DO NOTHING`); el aviso usa `notify_once`; el correo solo sale si la invitación está `pending`/`failed` con su reintento vencido y se reclama con `FOR UPDATE SKIP LOCKED`. Re-correr la tarea no repite nada (prueba `P03`).
- **Vence a los 30 días** (el enlace). La persona puede aceptar desde el aviso de la app sin enlace, o pedir otra (`resend_invitation`, máximo 3 por día; la anterior deja de servir; pruebas `P19`, `P22`, `P22b`, `P22c`).
- **Sin correo configurado** (faltan `LOVABLE_API_KEY`/`RESEND_API_KEY`), la tarea no gasta intentos: deja la invitación pendiente y el aviso de la app funciona.
- **"Entregado"** no se registra (D9): hoy solo `sent`/`failed`. No se rastrean aperturas.

## 2. Tokens (enlaces de invitación y de restablecimiento, sesiones Privé)

| Token | Tamaño | Dónde viaja | Qué se guarda | Vigencia | Usos |
|---|---|---|---|---|---|
| Invitación | 32 bytes aleatorios (base64url, 43 caracteres) | Solo en el **fragmento** `#t=` del enlace | SHA-256 | 30 días | Puntero; acepta solo la cuenta dueña |
| Restablecimiento | 32 bytes | Fragmento `#t=` de `/prive/restablecer` | SHA-256 | 30 minutos | **Uno** |
| Sesión Privé | 32 bytes | Respuesta de `unlock`; el navegador lo guarda en `sessionStorage` | SHA-256 | 12 h absolutas, 2 h sin uso | Hasta que vence, se bloquea o cambia la contraseña |

- El **fragmento** (`#…`) no lo manda el navegador a ningún servidor, ni queda en bitácoras ni en el encabezado Referer. La app lo lee y lo borra de la barra de direcciones.
- Todos se generan con `gen_random_bytes` (pgcrypto) dentro de la base. El de invitación se **regenera en cada envío** de correo: un enlace de un envío fallido anterior deja de servir.

## 3. Contraseña Privé

- **Reglas:** 12 a 72 bytes (bcrypt solo usa 72), al menos 5 caracteres distintos, y **no** puede estar en la lista de contraseñas filtradas de HaveIBeenPwned (prueba `P42`).
- **HaveIBeenPwned:** solo viajan los primeros 5 caracteres del SHA-1 (anonimato k); la contraseña nunca sale del servidor. Si no responde en 2 s, se acepta y queda registrado `breach_check = 'unavailable'`.
- **Frase generada:** 6 palabras en español + 2 dígitos (≈ 54 bits), se muestra **una sola vez**; queda `breach_check = 'generated'`.
- **Almacenamiento:** `crypt(pw, gen_salt('bf', 12))` (bcrypt costo 12, con sal). Verificado: todas las contraseñas de las pruebas están como `$2a$12$…` y **ninguna** aparece en claro en 297 columnas de `public` y `auth` (pruebas `P59`, `P60`).
- **Cambiar** pide la anterior (sus fallos cuentan para el bloqueo) y cierra todas las sesiones; se abre una nueva para este dispositivo (prueba `P44`).
- **Restablecer** (correo): token de un uso, 30 minutos, de **esa** cuenta y con la sesión de IATOS iniciada; quita el bloqueo total; cierra todas las sesiones (pruebas `P38c`, `P45`–`P48`). Máximo 3 pedidos por hora.
- **"Creo que alguien la conoce"** (`report_compromised`): la contraseña queda inservible (`must_reset`), se cierran todas las sesiones y se manda el enlace de restablecimiento (prueba `P40`).

## 4. Sesiones Privé

- Ligadas a: la cuenta, la **sesión de IATOS** donde se desbloqueó (claim `session_id` del JWT; además, si esa sesión se cerró en IATOS, deja de valer), y la **versión** de la contraseña.
- **Otro dispositivo** = otra sesión de IATOS → hay que escribir la contraseña otra vez, **sin** quedar bloqueado (prueba `P26`).
- **Dos sesiones a la vez** valen; **"cerrar todas"** las mata a ambas y avisa (prueba `P28`). La **sexta** cierra la más vieja (prueba `P29`).
- Vencida o inactiva → `PRIVE_SESSION_EXPIRED`; de otra cuenta, cerrada, de otra sesión de IATOS o de una contraseña anterior → `PRIVE_SESSION_INVALID` (pruebas `P25`–`P34`).
- `prive_require` funciona también dentro de funciones de solo lectura (RPC `STABLE` o transacción `READ ONLY`): si no puede actualizar "última vez visto", no niega el acceso (pruebas `P33`, `P33b`).

## 5. Límites y bloqueos (en SQL, antes de comparar el hash)

| Regla | Qué pasa | Prueba |
|---|---|---|
| 5 errores seguidos | 1 min | `P37` |
| 8 | 5 min | `P37` |
| 10 | 15 min | `P37` |
| 12 | 60 min | `P37` |
| 15 | **Bloqueo total**: se cierran las sesiones, aviso en la app y por correo; solo el restablecimiento lo quita | `P37`, `P38`, `P38b`, `P38c` |
| Bloqueado | Ni la contraseña correcta entra, y **no** se gasta bcrypt ni sube el contador | `P37b` |
| 24 h sin errores | El contador vuelve a 0 (salvo bloqueo total) | — |
| ip_hash con > 30 errores en 1 h (todas las cuentas) | Esa conexión queda fuera 60 min, también para otras cuentas | `P39` |
| Entrar tras ≥ 5 errores recientes | Aviso "Nuevo acceso a IATOS Privé" | `P38d` |
| Peticiones a `prive-access` | 30/min y 300/h por cuenta; 60/min por IP (`check_rate_limit` existente) | — |

- **ip_hash** = `sha256(ip + PRIVE_IP_SALT + día UTC)` recortado a 16 caracteres; rota cada día; se borra a los 30 días con los intentos. No es la IP y sin la sal no se puede revertir.
- Si `PRIVE_IP_SALT` **no está configurado**, no se inventa: se omite solo el límite por IP y se registra una advertencia una vez por arranque.
- **No hay huella del dispositivo** (D8).

## 6. Análisis de seguridad: compartir y reenviar

| Ataque | Qué pasa | Por qué |
|---|---|---|
| Reenviar el correo de invitación | El otro recibe `INVITATION_OTHER_ACCOUNT`, no se activa nada y queda registrado en las dos cuentas | Aceptar exige que la cuenta con sesión sea la invitada (`P20`) |
| Compartir la contraseña Privé | No le sirve a otra cuenta | Cada contraseña es de una cuenta; la de un miembro falla en otra (`P36`) |
| Compartir la cuenta de IATOS completa | Sí entraría (es la misma persona para el sistema) | Igual que cualquier servicio; mitigaciones: sesiones ligadas a la sesión de IATOS, máximo 5, avisos de nuevo acceso, "cerrar todas" |
| Copiar el token de sesión Privé a otra cuenta | `PRIVE_SESSION_INVALID` | El token se busca junto con la cuenta (`P31`) |
| Copiarlo a otro navegador con la misma cuenta | `PRIVE_SESSION_INVALID` | Otra sesión de IATOS (`P25`) |
| Robar la sesión de IATOS y adivinar la contraseña | Bloqueos 5/8/10/12/15 + límite por IP | (`P37`, `P39`) |
| Dejar de pagar y seguir usando la sesión abierta | `PRIVE_NOT_PRO` en la siguiente llamada; la tarea cierra la sesión | (`P10`, `P10b`) |
| Forzar banderas en el navegador | No hay banderas de autorización en el cliente; todo lo decide `prive_require` | Tablas sin acceso directo (`P56`, `P57`) |
| Llamar directo funciones internas | Denegado: `authenticated` solo puede `prive_require` y `prive_status`; `anon`, ninguna | (`P53`, `P54`, `P57`, `P58`) |
| Leer secretos con `prive_status` | No devuelve hashes, tokens ni correos | (`P49`) |
| Robar el enlace de restablecimiento | Necesita además la sesión de IATOS de esa cuenta; un solo uso; 30 min | (`P45`–`P47`) |

## 7. Contrato para la interfaz (grupo ui) y el catálogo

- `supabase.rpc('prive_status')` → `{is_pro, tenure_days, required_days, eligible, basis, membership_status, has_password, password_status, locked_until, activated_at, member_code, first_name, welcome_version_seen, onboarding, invitation_pending, members_requires_prive}`.
- `supabase.functions.invoke('prive-access', {body:{action, ...}})` — acciones y códigos del contrato §3. Códigos adicionales que puede recibir: `NO_PASSWORD` (aún no crea contraseña), `RATE_LIMITED`, `EMAIL_UNAVAILABLE`, `INVALID` (400), `INTERNAL` (500).
- `set_password`, `change_password` y `complete_reset` devuelven además `prive_session` y `expires_at` (se abre la sesión para no pedir la contraseña dos veces).
- Avisos en la app: `notifications.type = 'prive'`.
- Catálogo: toda RPC de contenido empieza con `v_uid := public.prive_require(_ps);` y debe ser `VOLATILE` (la opción por defecto) para que "última vez visto" se actualice; si es `STABLE` sigue funcionando, pero la inactividad se mide desde el último desbloqueo o acción de `prive-access`.
- Métricas: `prive_log_event(_user, _event, _props)` inserta en `prive_events` (columnas de §7 del modelo de datos) y devuelve `false` sin error si el evento no está en la lista permitida.

## 8. Operación de administrador (SQL)

Se corre en el SQL editor (rol `postgres`/servicio). Todo queda en `prive_membership_events`.

```sql
-- Dar Privé por concesión (con PRO; sin PRO queda pendiente hasta que lo tenga). Vigencia opcional.
SELECT public.admin_grant_prive('persona@ejemplo.com', 'Embajadora 2026', now() + interval '1 year', 'dueno@traveliatos.life');

-- Quitar una concesión.
SELECT public.admin_revoke_prive_grant(
  (SELECT id FROM public.prive_grants WHERE email = 'persona@ejemplo.com' AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1),
  'Fin del convenio', 'dueno@traveliatos.life');

-- Revocar una membresía (fraud | admin | other). Bloquea reactivaciones.
SELECT public.admin_revoke_prive((SELECT id FROM auth.users WHERE lower(email) = 'persona@ejemplo.com'),
  'fraud', 'Contracargos repetidos (caso 123)', 'dueno@traveliatos.life');

-- Restaurarla tras revisión.
SELECT public.admin_restore_prive((SELECT id FROM auth.users WHERE lower(email) = 'persona@ejemplo.com'),
  'Caso resuelto a favor', 'dueno@traveliatos.life');

-- Estado de una persona (sin secretos).
SELECT u.email, public.is_pro(u.id) AS pro, public.prive_tenure_days(u.id) AS dias_pagados, public.prive_has_grant(u.id) AS concesion,
       m.status, m.basis, m.member_code, m.activated_at, c.status AS clave, c.failed_count, c.locked_until, c.hard_locked
FROM auth.users u
LEFT JOIN public.prive_memberships m ON m.user_id = u.id
LEFT JOIN public.prive_credentials c ON c.user_id = u.id
WHERE lower(u.email) = 'persona@ejemplo.com';

-- Bitácora de una persona.
SELECT event, actor, details, at FROM public.prive_membership_events
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = 'persona@ejemplo.com') ORDER BY at DESC LIMIT 50;

-- Quitar un bloqueo total por soporte (preferible: que la persona use el restablecimiento por correo).
UPDATE public.prive_credentials SET status = 'must_reset', hard_locked = false, failed_count = 0, locked_until = NULL
WHERE user_id = (SELECT id FROM auth.users WHERE lower(email) = 'persona@ejemplo.com');
-- (queda en must_reset: tendrá que crear una nueva con el enlace del correo)

-- Correos de invitación fallidos (sin correo ni token).
SELECT id, user_id, email_status, email_attempts, email_last_error, email_next_attempt_at FROM public.prive_invitations
WHERE email_status = 'failed' ORDER BY email_next_attempt_at NULLS LAST;

-- Invitaciones usadas por otra cuenta (posible reenvío).
SELECT user_id, details->>'attempted_by' AS intento_de, at FROM public.prive_membership_events
WHERE event = 'invitation_used_by_other_account' ORDER BY at DESC;

-- Reembolsos/disputas que llegaron antes que su periodo (revisar).
SELECT e.event_id, e.type, e.invoice_id, e.action FROM public.stripe_payment_events e
LEFT JOIN public.pro_paid_periods p ON p.stripe_invoice_id = e.invoice_id
WHERE e.type LIKE 'charge.%' AND e.invoice_id IS NOT NULL AND p.id IS NULL ORDER BY e.created_at DESC;
```

## 9. Qué se reutilizó, construyó y corrigió

- **Reutilizado:** `is_pro`/`subscriptions`, `notify_once`, `check_rate_limit` y `enforceRateLimit`, `getAuthUser`, `isAuthorizedCron`, `sendEmail`/`escapeHtml`/`redactSecrets`, patrón de `comp_grants`, `purge_account_data` (borra lo Privé automáticamente por tener `user_id`).
- **Construido:** `prive_memberships`, `prive_membership_events`, `prive_grants`, `prive_invitations`, `prive_credentials`, `prive_sessions`, `prive_auth_attempts`, `prive_ip_blocks`, `prive_password_resets` (+ `prive_events` si el catálogo aún no la creó); funciones `prive_*` y `admin_*prive*`; trigger `on_auth_user_prive_grant`; funciones de Edge `prive-access` y `prive-cron`.
- **Corregido / reemplazado conceptualmente:** la contraseña compartida de Members (sec2 ya la apagó) no se reutiliza para Privé: aquí cada miembro tiene la suya y ninguna sirve sola.

## 10. Pruebas, lo no verificado, costos, riesgos y autorizaciones

**Pruebas (locales, 2026-10-22):** SQL `supabase/tests/prive/run.sh` **89 OK / 0 FALLA**; Vitest `src/test/priveAccess.test.ts` (27), `priveCron.test.ts` (7), `priveCore.test.ts` (12), `priveEmail.test.ts` (19), `priveTenure.test.ts` (26) — todas OK, dentro de 828 pruebas totales OK; `deno check` OK de las funciones nuevas y cambiadas.

**No verificado:**
- `auth.sessions` en Supabase real: la función la lee si existe y si el rol tiene permiso; si no, se queda con la coincidencia del `session_id` del JWT (también segura, pero no detecta un cierre de sesión hasta que el JWT expire, ≤ 1 h).
- HaveIBeenPwned real y Resend real (no se llamaron; probados con dobles).
- La interfaz (grupo ui) y las RPC del catálogo, que viven en otras ramas.

**Costos:** bcrypt costo 12 ≈ 0.25 s de CPU de la base por desbloqueo (aceptable; los bloqueos impiden abusarlo). HIBP gratis. Correos de seguridad solo en eventos sensibles.

**Riesgos:** compartir la cuenta de IATOS completa no se puede impedir (sí se limita y se avisa); un correo marcado como fallido que sí llegó deja un enlace que ya no sirve tras el reintento (la app sigue funcionando sin enlace).

**Requiere autorización productiva:** migraciones `2026102309*`, publicar `prive-access`/`prive-cron`/`prive-tenure-backfill`/`stripe-webhook`, crear el secreto `PRIVE_IP_SALT`, y programar `prive-cron` (ver LEEME).
