# Cierre de auditoría — grupo Privé (`claude/aud-prive`)

Fecha: 2026-10-22. Base: `claude/cierre-auditoria` (`f62466e`), con `claude/cierre-auditoria` mezclada dos veces durante el trabajo (incluye `42f05e8`, contraseña canónica del líder, y `18faf97`, social).
Todo se probó en Postgres local desechable (socket `/tmp/pgsec`, bases `audprive_*`, borradas al terminar) con roles reales (`SET ROLE authenticated` + `request.jwt.claims` como PostgREST; funciones de servidor como `service_role`). **Nada se tocó en producción.**

Pruebas nuevas:
- `supabase/tests/prive/aud_session.sql` (48 casos; la corre `supabase/tests/prive/run.sh` después de `prive.sql`).
- `src/test/priveAccess.test.ts` (bloques "AUD-01", "mantener mi sesión…", "restablecer…"), `src/test/priveLib.test.ts` (sesión del navegador), `src/test/priveHub.test.tsx` (casilla "mantener mi sesión").

Evidencia (salidas reales): `docs/iatos/cierre/evidencia_prive/` (`aud_session_ANTES.txt` = código de `f62466e`, `aud_session_DESPUES.txt`, `priveAccess_AUD01_ANTES.txt`, `suite_*.txt`). Los tokens que aparecían en las salidas (de la base local) están redactados.

## Tabla de hallazgos

| ID | Severidad | Reproducido (cómo, archivo de prueba) | Solución (archivo:línea, commit) | Tests (nombre, resultado antes/después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-01 | P1 | `aud_session.sql` S01–S13 con JWT reales. En `f62466e` **fallan 11**: cuenta suspendida (`banned_until`) sigue entrando y desbloquea (S04); cuenta borrada en modo suave (`deleted_at`) entra (S05); sin SELECT en `auth.sessions` → **acepta** (S07); sin USAGE en `auth` → error 500 en vez del código (S07b); tabla `auth.sessions` inexistente → acepta (S08); columna faltante → acepta (S08b); `prive_unlock` sin `session_id` emite sesión (S09); una sesión Privé **sin ligar** (`auth_session_id NULL`) autoriza con cualquier JWT, incluso sin `session_id`, y sobrevive al cierre de sesión (S09b); `prive_unlock` con un `session_id` inexistente o de otra cuenta emite sesión (S09c); con esa sesión sin ligar **las 12 RPC de contenido devuelven datos** (S11b) y también con la cuenta suspendida (S11c). Edge: `priveAccess.test.ts` "AUD-01" 3 de 5 fallan (unlock sin `session_id` llama a la base y entrega token; `AUTH_SESSION_INVALID` no se trata). | `supabase/migrations/20261024010000_aud_prive_session_fail_closed.sql`: `prive_auth_session_alive` (l. 19–46) falla cerrado (`EXCEPTION WHEN OTHERS → false`, sin `session_id` válido → false, revisa `not_after`, `deleted_at`, `banned_until`); `prive_require` (l. 49–110) niega sesiones sin ligar; `prive_unlock` (l. 112–162) no emite sin sesión de Auth viva (antes de bcrypt, no cuenta fallo); cierra las sesiones vivas sin ligar al aplicarse (l. 166); aviso si el dueño de las funciones no puede leer `auth.sessions` (l. 168–182). `supabase/functions/prive-access/actions.ts` `openSession`: sin `session_id` → 401 `UNAUTHENTICATED`; `AUTH_SESSION_INVALID` → 401. Barrido: cierra sesiones con la de Auth muerta (`20261024020000`, protegido contra cierre masivo si `auth.sessions` es ilegible). Commit `6e5d15f` (+ `0457a2e`). | `aud_session.sql` S01–S13: **22 OK / 14 FALLA antes** (incluye N01, N01d, N03 de NEW-01) → **48/48 OK después**. `priveAccess.test.ts`: 3 FALLA → 38/38 OK. | `evidencia_prive/aud_session_ANTES.txt`, `aud_session_DESPUES.txt`, `priveAccess_AUD01_ANTES.txt` | **VERIFICADO** |
| AUD-01 (cierre de PRO) | P1 | S12–S12d: con PRO terminado (periodo vencido o `status=canceled`), contraseña correcta y sesión Privé + sesión de Auth vivas: `prive_require` → `PRIVE_NOT_PRO`, `prive_unlock` → `PRIVE_NOT_PRO` y **las 12 RPC de contenido** → `PRIVE_NOT_PRO` (llamadas reales como `authenticated`, descubiertas del catálogo, no lista fija). La prueba existente P10 sí ejercita el camino real (`pt.req_as` = claims + `SET ROLE authenticated` + `prive_require`). | — (ya correcto) | S12–S12d OK antes y después | `aud_session_DESPUES.txt` | **REFUTADO** (no había defecto en esta parte) |
| NEW-01 | P2 | N01–N04. En `f62466e`: tras `admin_revoke_prive_grant` la invitación sigue viva y la membresía en `invited` (N01 FALLA); el enlace **no** se puede aceptar ni fijar contraseña mientras no cumple (N01c OK: no explotable de inmediato), **pero** cuando la persona cumple 90 días el enlace viejo de la concesión revocada se acepta y queda activa con base `grant` (N01d FALLA); concesión vencida sola: igual (N03 FALLA). | `supabase/migrations/20261024020000_aud_prive_grant_revoke_invitation.sql`: `prive_withdraw_invitation` (revoca invitaciones, quita el aviso "tu invitación está lista", borra la membresía no activada, bitácora `invitation_withdrawn`); `admin_revoke_prive_grant` la llama y, si sigue cumpliendo por antigüedad, cambia la base a `tenure`; `prive_sweep` la aplica a concesiones vencidas; **limpieza única** al aplicar (caso real `2097e1e0` de FASE0, porque `prive-cron` no corre en producción). Commits `0457a2e`, `8dc4c32`. | N01, N01d, N03: FALLA → OK. N01b (idempotente), N02 (sigue cumpliendo → conserva invitación), N04, N05 (limpieza solo de la revocada) OK. | `aud_session_ANTES.txt` / `DESPUES.txt` | **VERIFICADO** |
| SES-LS (sesión en `localStorage`, `f62466e`) | P2 | Evaluación abajo. Riesgo real: la sesión normal (12 h / 2 h) sobrevivía al **cierre del navegador** (antes `sessionStorage` no). | `src/lib/priveSession.ts`: la sesión normal exige además una cookie de sesión del navegador (`iatos_prive_bs=1`, sin token, `SameSite=Strict`, `Secure` en https): compartida entre pestañas, se borra al cerrar el navegador. Solo la sesión **recordada** (aceptada por el servidor) persiste. Commit `1a96d3b`. | `priveLib.test.ts`: 3 nuevos (otra pestaña sí; tras cerrar navegador no; recordada sí; `clearPriveSession` borra la cookie) OK. | `vitest` | **CORREGIDO** (pruebas nuevas; el comportamiento anterior no tenía prueba que fallara, la regla es nueva) |
| REMEMBER (pedido del dueño #39) | — | "Mantener mi sesión en este dispositivo (30 días)". | `supabase/migrations/20261024030000_aud_prive_remember_device.sql` (`prive_sessions.remember`, `prive_remember_session`, `prive_session_idle_limit`, `prive_require` y `prive_sweep` con inactividad por sesión); `actions.ts` (`unlock {remember}`); `usePriveAccess.tsx`, `LockScreen.tsx` (casilla apagada por omisión). Commit `1a96d3b`. | SQL R01–R07; unit "mantener mi sesión…" 3; UI 1 — todos OK. | `aud_session_DESPUES.txt` | **VERIFICADO** (función nueva) |
| PW-CANON (líder, `42f05e8`) | — | ¿Hace falta compatibilidad para hashes creados con la forma cruda? | Ver evaluación abajo: **no**. | — | — | **REFUTADO** (no se necesita ruta de compatibilidad) |
| RESET | — | ¿Siempre hay salida para quien quedó bloqueado? | Recorrido en código confirmado (abajo). Mejora: `request_reset` sin correo en la cuenta ya no gasta token ni intento (`actions.ts`, commit `229596f`). | SQL L01 (bloqueo total → restablecer → entra con la nueva en su sesión de Auth; el enlace no sirve dos veces) OK; unit "restablecer…" 1 FALLA antes → OK. | — | **VERIFICADO** |
| TRIP-PRIVE (reportado por aud-iato) | P2 (sospecha) | `concierge-chat/actionExec.ts` reenvía `trip_id` (de `ctx.activeTripId`) a `concierge-action`, que llama `prive_request_create` **con el JWT del usuario**. Prueba T01/T02 en `aud_session.sql`: con el viaje de otra cuenta → `TRIP_NOT_FOUND` y no se crea nada; con su viaje, con uno compartido con ella (colaboradora aceptada) o sin viaje → se crea a su nombre. La validación existe en SQL: `20261023100300_prive_requests_lifecycle.sql:154` (`has_trip_access(_trip_id, v_uid)`, con `v_uid` de `prive_require`). | — (no hace falta) | T01, T02 OK | `aud_session_DESPUES.txt` | **REFUTADO** |
| ADM | — | RPC de administración ejecutables por `authenticated`/`anon`. | — | S13: 10 RPC admin/servidor negadas a `authenticated` no admin; S13b: sin EXECUTE para `anon`/`authenticated` en `admin_*_prive*`, `prive_sweep`, `prive_auth_session_alive`, `prive_withdraw_invitation`, `prive_remember_session`; P53/P54/P57/P58 siguen OK. | — | **REFUTADO** (sin defecto) |

Fase 2, ya cubierta por la suite existente y re-verificada (OK antes y después, `suite_prive.txt`): 90 días pagados sin días de prueba, sin días futuros, sin duplicar encimados, febrero real (P01–P05c); reembolsos/disputas en `pro_paid_periods` cortan el acceso y cierran sesiones (P06–P08b); bcrypt costo 12, 12–72 bytes, ≥5 caracteres distintos, HIBP `breached` rechazada (P42–P43b); escalera de bloqueos 5/8/10/12/15 y bloqueo por ip_hash (P35–P39); restablecimiento de un solo uso, 30 min, de la misma cuenta (P45–P47); invitaciones solo como SHA-256, 30 días, de un solo uso, de otra cuenta rechazada (P19–P23d, P60); barrido (P10b, P17, P22b, P52); revocación por fraude y restauración (P12–P12c); ningún secreto en claro en `public`/`auth` (P59).

## Evaluación: sesión Privé en `localStorage` (commit `f62466e`)

- **XSS:** igual que `sessionStorage`. Un script en el mismo origen lee los dos (y además el token de Supabase, que ya vive en `localStorage`, y puede llamar las RPC desde la página). No cambia nada.
- **Lo que sí cambió:** `localStorage` sobrevive al cierre del navegador. En una computadora compartida o prestada, quien la abriera después (dentro de 2 h sin uso y con la cuenta de IATOS aún abierta) entraba a Privé **sin la contraseña Privé**, que es justo para lo que existe.
- **Defensas del servidor (sin cambio):** 12 h absolutas, 2 h sin uso, ligada al usuario y a la sesión de Auth (ahora fallando cerrado), revocable, se cierra al perder el derecho. Cerrar sesión en IATOS borra el token local (`clearAllPriveState`) y la fila de `auth.sessions` (el token muere en el servidor). Cambio de usuario: `userId` distinto → se borra.
- **Decisión:** no es inseguro para XSS, pero sí rompía "cerrar el navegador vuelve a cerrar Privé". Alternativa mínima implementada: cookie de sesión del navegador como marca (no contiene el token). Mantiene lo que quería el líder (una pestaña nueva no pide la contraseña) y recupera el cierre al cerrar el navegador. Quien quiera que dure más elige "mantener mi sesión" (30 días). Con "Continuar donde lo dejaste" de Chrome las cookies de sesión se restauran: igual que pasaba con `sessionStorage`.
- **Efecto al desplegar:** las sesiones guardadas antes (sin la marca) se descartan una vez: hay que escribir la contraseña Privé de nuevo una vez.

## Evaluación: "Mantener mi sesión en este dispositivo (30 días)"

- **Política (servidor):** opcional, se elige en el candado (apagada por omisión). Solo se puede pedir para una sesión **recién abierta (≤ 5 min)** y **propia**, por `service_role` (la función de Edge). Vence a los **30 días** de abrirse y a los **7 días sin uso** (la normal: 12 h y 2 h). Deja aviso en la app ("Privé quedará abierto en este dispositivo…") y la bitácora `session_remembered`.
- **Sigue sujeta a todo `prive_require` en cada llamada:** PRO vigente, 90 días o concesión, membresía activa, versión de la contraseña y la sesión de Auth donde se abrió (R04: cerrar sesión en IATOS la invalida al instante; R05: sin PRO → `PRIVE_NOT_PRO`).
- **Revocable:** "Cerrar todas mis sesiones" en Membresía (`revoke_sessions`, R05), cambiar/restablecer la contraseña, "mi contraseña está comprometida", bloqueo total, revocación, barrido al perder el derecho. Máximo 5 sesiones vivas por cuenta (sin cambio).
- **Si falla:** si la base no la acepta, queda la sesión normal de 12 h (nunca al revés; unit "si la base no la recuerda…").
- **Trade-off:** quien tenga el dispositivo desbloqueado y la sesión de IATOS abierta entra a Privé sin la contraseña durante hasta 30 días. Es lo que pidió el dueño y es opcional; el texto de la casilla dice "solo en un dispositivo que sea tuyo". La contraseña Privé sigue siendo necesaria en cualquier otro dispositivo o inicio de sesión.

## Evaluación: contraseña canónica (NFC + trim, `42f05e8`)

Un hash creado con la forma cruda solo deja de coincidir si la contraseña original tenía espacios al inicio/final o acentos en NFD. Hoy solo el dueño tiene una contraseña real y la va a restablecer. Una ruta de compatibilidad tendría que comparar dos formas (dos bcrypt por intento) y decidir cómo contar fallos; además seguiría aceptando la forma no canónica. **Recomendación: no agregarla.** Si alguien más quedara fuera, el restablecimiento por correo funciona (L01). Nota: el recorte se aplica antes de medir 12–72 bytes, así que una contraseña con espacios sobrantes se mide sin ellos (correcto).

## Restablecimiento: recorrido confirmado en código

`LockScreen` (enlace siempre visible; tras 2 fallos es botón principal) → `/prive/restablecer` (`PriveReset.tsx`) → `request_reset` (solo pide sesión de IATOS, **no** sesión Privé; 3 por hora) → `prive_request_reset` invalida los anteriores y devuelve el token una vez → `priveResetEmail` con `fragmentLink(…/prive/restablecer#t=…)` → al abrir, `capturePriveTokenFromUrl` saca el token de la URL a `sessionStorage` → `complete_reset` → `prive_complete_reset` (un uso, 30 min, misma cuenta, valida la nueva antes de gastar el token, quita el bloqueo total y el "debe restablecer", cierra todas las sesiones) → abre una sesión nueva ligada a la sesión de Auth. L01 lo prueba de punta a punta en SQL con el bloqueo total. Única salida que no es autoservicio: si el correo no está configurado (`LOVABLE_API_KEY`/`RESEND_API_KEY`) o la cuenta no tiene correo → `EMAIL_UNAVAILABLE` (soporte).

## HALLAZGOS NUEVOS

| ID | Severidad | Descripción | Estado |
|---|---|---|---|
| NEW-01 | P2 | Revocar una concesión dejaba la invitación viva y la membresía `invited`; el enlace viejo servía al cumplir 90 días. | VERIFICADO (arriba) |
| NEW-P1 | P2 | Sesión Privé normal sobrevivía al cierre del navegador desde `f62466e`. | CORREGIDO (arriba) |
| NEW-P2 | P3 | `prive-cron` no está programado en producción (FASE0): el barrido (`prive_sweep`) nunca corre, así que no se cierran sesiones por barrido, no caducan invitaciones por barrido ni se evalúa elegibilidad/envían invitaciones automáticamente. La seguridad no depende de él (`prive_require` revisa todo en cada llamada), pero NEW-01 en producción solo se limpió con la limpieza única de la migración. | PENDIENTE (decisión del dueño: programarlo) |
| NEW-P3 | P3 | `members_requires_prive` es solo informativa: `members_access` no la consulta (X01). Si el dueño la enciende esperando que Members Only quede detrás de Privé, no cambia nada en el servidor. | CONFIRMADO, documentado (no se cambia: decisión D1 del dueño) |
| NEW-P4 | P3 | `request_reset` sin correo en la cuenta emitía un token inútil y gastaba uno de los 3 intentos por hora. | VERIFICADO (mejora, `229596f`) |

## HALLAZGOS REFUTADOS CON EVIDENCIA

- **PRO terminado con sesión Privé vieja:** ya se negaba en el camino real (S12–S12d, P10).
- **Sesión de Auth cerrada / cierre global / vencida (`not_after`):** ya se negaba cuando `auth.sessions` se podía leer y la sesión estaba ligada (S02, S03, S06 OK antes). El defecto era solo en los caminos permisivos (arriba).
- **Token de invitación tras revocar la concesión, de inmediato:** no se aceptaba ni fijaba contraseña mientras no cumplía (N01c OK antes). El defecto era posterior (N01d).
- **Solicitud Privé con el viaje de otra cuenta (reportado por aud-iato):** la RPC lo niega con `TRIP_NOT_FOUND` (T01); la Edge no necesita revisar.
- **RPC de administración:** no ejecutables por `anon`/`authenticated` no admin (S13, S13b).
- **Compatibilidad de hashes (contraseña canónica):** no necesaria (arriba).

## Mejoras adicionales

- Limpieza única en la migración de NEW-01 para el estado ya existente en producción (cuenta `2097e1e0`).
- El barrido cierra también las sesiones Privé cuya sesión de Auth ya no existe (`sessions_auth_gone`) y reporta `invitations_withdrawn`.
- `prive_unlock` revisa la sesión de Auth **antes** de bcrypt: una sesión muerta no gasta CPU ni cuenta como fallo.
- Stubs locales (`supabase/tests/security/01_supabase_stubs.sql`) con `auth.sessions` (FK con borrado en cascada) y `auth.users.banned_until/deleted_at`, como en Supabase; `prive_catalog/catalog.sql` liga su sesión a una sesión de Auth real (antes probaba con una sesión sin ligar).
- `supabase/tests/prive/run.sh` re-aplica también las migraciones `20261024*_aud_prive_*` después de las `2026102309*` (antes la re-aplicación de idempotencia dejaba las funciones viejas encima).

## Resultados exactos de las suites (después, rama `claude/aud-prive` con `18faf97` mezclado)

| Suite | Resultado |
|---|---|
| `supabase/tests/prive/run.sh` | **137 OK, 0 FALLA** (89 de `prive.sql` + 48 de `aud_session.sql`) — antes del cierre: 89 OK |
| `supabase/tests/prive_catalog/run.sh` | **110 OK, 0 FALLA** (solo el error esperado de pg_cron) |
| `supabase/tests/security/run.sh` | **95 OK, 0 FALLA**; A1–A5 en 0 / permission denied, L1–L7 y D1–D2 como siempre |
| payments / members_more / social / ai_reservations / bridge / concierge2 / cost / ops | 63 / 30 / 70 / 43 / 35 / 7 / 16 OK, 0 FALLA; ops sin FALLÓ (comparten los stubs modificados) |
| `npx vitest run` | **1520 pasan, 15 fallan** (163 archivos; 812 s con carga de la máquina ≈ 42 por los otros grupos). Los 15 son límites de tiempo de UI (5 s). Re-corridos en serie los 9 archivos: **73/74 pasan**; queda 1 de `godtierHome.test.tsx` por tiempo (7,6 s; fuera de Privé). `priveHub` "Grand Welcome > con movimiento completo" también falla en la base sin cambios cuando hay carga: inestable, no regresión. Evidencia: `vitest_completo_resumen.txt`, `vitest_rerun_fallidos_por_carga.txt` |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 errores |
| `deno check supabase/functions/prive-access/index.ts` | OK |

## Requiere autorización para producción

1. **Migraciones, en este orden:** `20261024010000_aud_prive_session_fail_closed.sql`, `20261024020000_aud_prive_grant_revoke_invitation.sql`, `20261024030000_aud_prive_remember_device.sql`. Idempotentes.
   - Antes de aplicar, una lectura en el editor SQL (como `postgres`): `select has_table_privilege('auth.sessions','select'), has_column_privilege('auth.users','banned_until','select'), has_column_privilege('auth.users','deleted_at','select');` → las tres deben ser `true`. Si no, Privé queda cerrado para todos (fail closed) — la migración también lo avisa con un WARNING.
   - Efecto al aplicar: se cierran las sesiones Privé vivas **sin ligar** (si hubiera); se retira la invitación de `2097e1e0`.
2. **Función Edge `prive-access`**: desplegar **después** de las migraciones (llama `prive_remember_session`; traduce `AUTH_SESSION_INVALID` a 401).
3. **Frontend** (`priveSession.ts`, `usePriveAccess.tsx`, `LockScreen.tsx`): publicar después de la función. Efecto: una vez, quien tenga una sesión Privé guardada vuelve a escribir su contraseña (puede marcar "mantener mi sesión").

## Riesgo residual

- La verificación de la sesión de Auth depende de que `postgres` pueda leer `auth.sessions`/`auth.users` en Supabase (verificable con la consulta de arriba; no se pudo comprobar desde aquí: BLOQUEADO sin consola de producción).
- `prive-cron` sin programar en producción (NEW-P2).
- `PRIVE_IP_SALT`: si falta en producción, el límite por ip_hash se omite (solo queda el de la cuenta). No se pudo verificar (secretos de producción): BLOQUEADO.
- HIBP caído → la contraseña se acepta con `breach_check='unavailable'` (decisión de diseño documentada; queda registrado).
- Concesiones sin vencimiento (`valid_until NULL`) son válidas indefinidamente (siguen exigiendo PRO y son revocables); conviene revisarlas periódicamente.
- `prive_my_requests` y `prive_request_cancel` solo exigen sesión de IATOS (datos propios; cancelar debe poder hacerse aunque PRO haya terminado). Diseño, no defecto.
- La sesión recordada (30 días) es un trade-off aceptado por el dueño: en un dispositivo desbloqueado con IATOS abierto, Privé no pide la contraseña.
