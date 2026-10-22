# Cierre de auditoría: barrido de seguridad (grupo `seguridad`)

Rama `claude/aud-seguridad` (desde `claude/cierre-auditoria`, con merge de `32947ce`). Fecha: 2026-10-22/24.
Método: todas las migraciones aplicadas a una base nueva de Postgres 16 local, con los roles reales `anon`,
`authenticated` y `service_role` y los claims del JWT (`request.jwt.claim.sub/role`, `request.jwt.claims`).
También: lectura de las 64 funciones Edge y de `supabase/config.toml`, y pruebas unitarias con Vitest que leen el
código real. No se tocó producción. Todo lo que dependa del estado en vivo dice **VERIFICAR EN VIVO**.

**Requiere autorización para producción:**
- Migraciones nuevas: `20261024010000_aud_seg_journal_update_trip_access.sql` y `20261024200000_aud_seg_action_idempotency.sql`.
- Funciones que hay que desplegar: `mark-visited`, `generar-packing-list`, `track-flight`, `concierge-chat`, `concierge-action`.
- Va también el frontend (`ActionCard`, `ConciergeCards`), que manda la clave de idempotencia.
- Orden: primero la migración `20261024200000`. Si las funciones se despliegan antes, no fallan: sin la tabla, la acción se ejecuta como hoy.

## Resultado

| ID | Severidad | Reproducido (cómo, archivo de prueba) | Solución (archivo:línea, commit) | Tests (antes → después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-SEG-01 | P3 | Un `UPDATE` sin filtro como el colaborador expulsado (no pide permiso de SELECT): reescribía sus notas en el diario del viaje del que lo sacaron y movía todas sus notas (`trip_id`) a un viaje ajeno. `supabase/tests/security/aud_seguridad.sql` SG7, SJ5, SJ6 | `journal_update` exige `has_trip_access` en USING y WITH CHECK: `supabase/migrations/20261024010000_aud_seg_journal_update_trip_access.sql:7-11`, commit `dd2af54` | SG7/SJ5/SJ6/SJ3: FALLA → OK | `scratchpad/audseg_sec_prefix.txt` (antes), `suite_security4.txt` (después) | VERIFICADO |
| AUD-SEG-02 | P2 | `mark-visited` llama a Place Details (SKU con fotos) y recalcula el Food DNA sin ningún límite. `src/test/audSeguridadEdge.test.ts` "toda función de usuario que llama una API de pago aplica enforceRateLimit" | `enforceRateLimit(req, "mark-visited", …)` en `supabase/functions/mark-visited/index.ts:111-114` + cubeta de pago (falla cerrada) en `_shared/rate-limit-core.ts:32`, commit `b5dac61` | 2 pruebas: FALLA (`['mark-visited']`) → OK | `scratchpad/audseg_edge_before.txt` | VERIFICADO |
| AUD-SEG-03 | P2 | `generar-packing-list` llamado por un colaborador armaba el prompt con el perfil completo, la bóveda de tarjetas y el ADN del **dueño**, y hacía upsert con `user_id` = colaborador: se quedaba con la lista del dueño (RLS "solo la mía": el dueño dejaba de verla) | `generar-packing-list/access.ts` (`canWritePackingList`); contexto de quien llama en `generar-packing-list/index.ts:241-257`, commit `7d02361` | 2 pruebas: FALLA → OK | `audseg_edge_before.txt` | VERIFICADO |
| AUD-SEG-04 | P3 | `track-flight` guardaba el `trip_id` del cuerpo con la llave de servicio, saltándose `tf_insert_own` (`has_trip_access`): un vuelo quedaba ligado al viaje de otra persona | `tripIdForTracking` en `track-flight/rules.ts:42-55`, comprobado con la sesión del usuario en `track-flight/index.ts:72-76`, commit `43f76e1` | 1 prueba: FALLA → OK | `audseg_edge_before.txt` | VERIFICADO |
| AUD-SEG-05 | P2 | Reportado por aud-iato. Confirmar una acción de Iato (o el botón de solicitud) y tocar "Reintentar" tras un timeout la volvía a ejecutar: dos `concierge_requests` (y dos correos al equipo) o dos viajes. `src/test/audSegIdempotency.test.tsx` | Clave del cliente, una por tarjeta o solicitud: `ActionCard.tsx` y `ConciergeCards.tsx` (`useConciergeRequest`). El servidor la aparta antes de ejecutar: `_shared/idempotency.ts`, `concierge-chat/index.ts` (handleAction), `concierge-action/index.ts`; `actionExec.ts` la reenvía. Tabla y RPC: `20261024200000_aud_seg_action_idempotency.sql`. Commit `19279ae` | 3 pruebas: FALLA (`idempotency_key` undefined) → OK; +4 de `withIdempotency`; SQL IK1-IK12 | `scratchpad/audseg_idem_before.txt` | VERIFICADO |

Conteo: **5 VERIFICADO** (0 P0, 0 P1, 3 P2, 2 P3). P0/P1 abiertos de este grupo: **ninguno**.

### Escenarios de ataque

- **AUD-SEG-01.** Ana saca a Beto de su viaje. Beto manda `PATCH /rest/v1/trip_journal_entries` sin filtro, con `{"text": "…"}` o `{"trip_id": "<viaje de Ana>"}`. Con un filtro (lo que manda supabase-js) la política SELECT ya bloqueaba (SJ1, SJ2). Sin filtro funcionaba en la base local. En Supabase la extensión `pg-safeupdate` suele negar un UPDATE sin WHERE; **VERIFICAR EN VIVO**. Por eso queda en P3.
- **AUD-SEG-02.** Una cuenta gratuita repite `POST /functions/v1/mark-visited {placeId}` en bucle. Cada llamada es un Place Details de pago más un recálculo del Food DNA. Sin límite, la factura de Google crece sin tope.
- **AUD-SEG-03.** Un colaborador invitado toca "Generar lista" en el viaje del dueño. Recibe una lista armada con las tarjetas del dueño (p. ej. "Tarjeta Amex Platinum, salas VIP") y la fila del viaje pasa a ser suya, así que el dueño pierde su lista.
- **AUD-SEG-04.** Beto llama `track-flight {flight, trip_id: <viaje de Ana>}` y la fila queda ligada al viaje de Ana. El impacto es bajo: solo la lee el propio usuario y el borrado de cuenta de Ana la desliga.
- **AUD-SEG-05.** La red se corta después de que el servidor creó la solicitud. El usuario toca "Reintentar" y sale una segunda solicitud al Fixer con un segundo correo al equipo, o un segundo viaje "borrador".

## Barrido 1: tablas, RLS, permisos y vistas (89 tablas, 119 políticas)

Pruebas de regresión en `supabase/tests/security/aud_seguridad.sql`. Cualquier migración futura que rompa una de estas reglas hace fallar la suite.

- **SG1.** Las 89 tablas de `public` tienen RLS. Las 35 sin políticas (Privé, cuotas, `app_flags`, `deletion_*`, `stripe_payment_events`, `action_idempotency`…) son solo del servidor: niegan todo a los clientes.
- **SG6.** Vistas: `mis_amigos` y `user_autonomy` usan `security_invoker`. `prive_experiences_v` y `prive_nightlife_compat` no lo usan, pero no tienen GRANT a `anon` ni a `authenticated`, así que solo las leen las RPC del servidor.
- **SG7.** Toda política de escritura sobre una tabla con `trip_id` exige `has_trip_access`/`is_trip_owner`. Excepción revisada: `affiliate_clicks`, una métrica propia. Esta regla encontró AUD-SEG-01.
- **SX1-SX4.** Lectura cruzada en 15 tablas personales (gastos, reservas, conversaciones, avisos, perfil, bóveda, ADN, visitas…) y en viajes. El dueño las ve; un extraño y `anon` no ven nada.
- **SR4.** El perfil completo de otra cuenta (correo, fecha de nacimiento, pasaporte en `travel_documents`) no se lee. A los amigos solo les llegan columnas acotadas por RPC: `friend_profiles` da nombre, usuario y avatar; `amigo_perfil` da ciudad, ADN resumido y viajes compartidos.
- **SC1-SC2.** Una invitación pendiente no da acceso al viaje ni a su diario. Al aceptarla, sí.
- `profiles`: el trigger `profiles_guard_sensitive` bloquea `email`, `invite_code`, `tier` y `created_at`. `nightlife_access_guard_unlock` impide que el usuario se dé acceso Members. `trips_collab_columns_guard` y `trips_guard_owner` impiden que un colaborador cambie el dueño o la cotización.
- Los GRANT de tabla a `anon`/`authenticated` son los de siempre en Supabase (ALL), y las políticas son las que filtran. `TRUNCATE` no está expuesto por PostgREST.

## Barrido 2: funciones SECURITY DEFINER (180 en total)

- **SG2.** Las 180 fijan `search_path`.
- **SG3.** Ninguna se puede ejecutar por PUBLIC.
- **SG4.** `anon` solo ejecuta `public_plan_config()`, que devuelve un único booleano de configuración pública.
- **SG5.** `authenticated` ejecuta 44. Están en una lista blanca en la prueba: una nueva sin revisar hace fallar la suite. Así se detectaron las 3 funciones sociales que llegaron con el merge.
- Las otras 136 son solo `service_role` (cuotas, Stripe, Privé, reservas, borrado de cuenta, cron, avisos).

| Función (authenticated) | Comprueba | Veredicto |
|---|---|---|
| admin_metrics, admin_cost_metrics, admin_prive_metrics, admin_prive_requests | `auth.uid()` en `admins`; si no, 42501 | OK (SR1) |
| prive_request_transition, booking_intent_confirm | JWT `service_role` o `admins` (nunca `current_user`) | OK (SR1) |
| prive_require y las 15 RPC de contenido Privé (home, destination, experience, for_you, search, universe, saved, save, track, add_to_trip, confirm_adult, request_create) | `prive_require(_ps)`: derecho PRO/90 días, token del mismo usuario, versión de credencial, sesión de Auth viva | OK; PS1-PS2 nuevas aíslan el chequeo de cuenta |
| prive_status, prive_teaser, prive_my_requests, prive_request_cancel | `auth.uid()` y `user_id = auth.uid()` | OK |
| has_trip_access, is_trip_owner, is_trip_collaborator | `_trip_check_is_foreign`: un cliente no pregunta por otra cuenta | OK (SR2) |
| get_access_state(_user_id) | `COALESCE(auth.uid(), _user_id)`: con sesión ignora el parámetro | OK (SR3) |
| aceptar/rechazar_invitacion_viaje, invitar_amigo_viaje | `auth.uid()`, dueño del viaje, amistad aceptada | OK |
| agregar_amigo_por_codigo, claim_referral | `auth.uid()`; el código tiene 8 caracteres de 32 (1.1·10¹²); referido solo en las primeras 24 h | OK (ver N2) |
| friend_profiles, compatibilidad_viaje, amigo_perfil, amigos_resumen, saludar_amigo | `auth.uid()` + amistad aceptada; saludo 1 cada 24 h con candado | OK (ver N2) |
| members_access, members_access_state, members_cities, members_teaser, members_venues, unlock_members_access | `auth.uid()`; venues exige `members_access()`; desbloqueo con 10 intentos por hora | OK |
| public_plan_config | nada sensible | OK |

## Barrido 3: almacenamiento (4 buckets)

- `recibos` y `trip-documents` son **privados** (SG8).
- **SS1.** Un extraño no lista recibos ajenos.
- **SS2.** Un colaborador expulsado deja de ver los documentos del viaje.
- **SS3.** No se puede subir a la carpeta de otro usuario ni a un viaje ajeno. Tampoco con `../`: `trip_document_path_trip` exige exactamente `<trip_uuid>/<archivo>`, y el CHECK `trip_documents_path_in_trip` rechaza `..`.
- `journal-photos` y `travel-moments` son **públicos** a propósito, con nombres no adivinables (UUID). Ver nota N1.
- Avatares: los sube `generate-avatar` con la llave de servicio a `travel-moments/avatars/<uid>/`.
- Tamaño y tipo los limita el bucket: 10 MB y lista de MIME.

## Barrido 4: funciones Edge (64)

Pruebas en `src/test/audSeguridadEdge.test.ts`, que leen el código real:
- Las 64 funciones están en `config.toml`.
- Toda función con `verify_jwt = false` tiene su propia puerta que falla cerrada: `isAuthorizedCron`, firma de Stripe, firma Svix, token HMAC o JWT + `.ics` firmado.
- Toda función con `verify_jwt = true` valida además al usuario dentro del código.
- Toda función de usuario que llama una API de pago aplica `enforceRateLimit`.

Revisado a mano, sin hallazgos:
- **Cron.** `safeEqual` de tiempo constante en `cron-auth-core.ts:13` (probado en `cronAuth.test.ts`).
- **SSRF.** Ninguna función hace `fetch` de una URL que manda el usuario. Los `placeId`/`ref` van con `encodeURIComponent` o `isPhotoRef`. `tag-moment` solo lee rutas del propio usuario (`ownsPath`).
- **Correo.** `send-email` solo va a un colaborador del viaje del dueño. `email-bienvenida` solo va a tu propio correo. `concierge-action` y `enviar-email-fixer` solo van al equipo.
- **CORS.** Es `*`, con token Bearer y sin cookies (ver N8).

| Función | verify_jwt | Puerta en código | Límite de uso | Llave de servicio | API de pago | Veredicto |
|---|---|---|---|---|---|---|
| account-deletion-retry | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | no | OK |
| ai-reservations | false | JWT en POST + enlace .ics firmado | sí | no | no | OK |
| ai-reservations-cron | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | no | no | OK |
| ai-tool | true | getUser/getAuthUser | sí | no | sí | OK |
| analizar-preferencias-ruta | true | getUser/getAuthUser | sí | no | sí | OK |
| analizar-viaje | true | getUser/getAuthUser | sí | sí | sí | OK |
| auditar-perfil | true | getUser/getAuthUser | sí | no | sí | OK |
| booking-bridge | true | getUser/getAuthUser | sí | sí | sí | OK |
| booking-go | false | token HMAC (verifyRedirect) | n/a (cron/webhook) | sí | no | OK |
| booking-links-cron | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | no | OK |
| buscar-promociones | true | getUser/getAuthUser | sí | no | sí | OK |
| buscar-video | true | getUser/getAuthUser | sí | no | sí | OK |
| card-benefits-lookup | true | getUser/getAuthUser | sí | no | sí | OK |
| concierge-action | true | getUser/getAuthUser | sí | sí | sí | AUD-SEG-05 corregido |
| concierge-chat | true | getUser/getAuthUser | sí | sí | sí | AUD-SEG-05 corregido |
| delete-account | true | getUser/getAuthUser | sí | sí | sí | OK |
| editar-viaje-ai | true | getUser/getAuthUser | sí | sí | sí | OK |
| email-bienvenida | true | getUser/getAuthUser | sí | no | sí | OK |
| enviar-email-fixer | true | getUser/getAuthUser | sí | no | sí | OK |
| evaluar-logros | true | getUser/getAuthUser | no | no | no | OK |
| evolucionar-dna | true | getUser/getAuthUser | sí | sí | sí | OK |
| flight-status | true | getUser/getAuthUser | sí | no | sí | OK |
| flight-watch-cron | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | sí | OK |
| flights-search | true | getUser/getAuthUser | sí | no | sí | OK |
| generar-packing-list | true | getUser/getAuthUser | sí | sí | sí | AUD-SEG-03 corregido |
| generate-avatar | true | getUser/getAuthUser | sí | sí | sí | OK |
| geocode | true | getUser/getAuthUser | sí | no | sí | OK |
| geocode-address | true | getUser/getAuthUser | sí | no | sí | OK |
| get-routes | true | getUser/getAuthUser | sí | no | sí | OK |
| health-check | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | sí | OK |
| hotels-search | true | getUser/getAuthUser | sí | no | sí | OK |
| logistics-plan | true | getUser/getAuthUser | sí | sí | sí | OK |
| mark-visited | true | getUser/getAuthUser | sí | no | sí | AUD-SEG-02 corregido |
| nearby-places | true | getUser/getAuthUser | sí | no | sí | OK |
| nightlife-discover | true | getUser/getAuthUser | sí | no | sí | OK |
| parse-trip-file | true | getUser/getAuthUser | sí | no | sí | OK |
| parsear-viaje | true | getUser/getAuthUser | sí | no | sí | OK |
| pexels-image | true | getUser/getAuthUser | sí | no | sí | OK |
| place-details | true | getUser/getAuthUser | sí | no | sí | OK |
| place-photo | true | getUser/getAuthUser | sí | no | sí | OK |
| places-nearby | true | getUser/getAuthUser | sí | no | sí | OK |
| places-search | true | getUser/getAuthUser | sí | no | sí | OK |
| price-watch | true | getUser/getAuthUser | sí | sí | sí | OK |
| price-watch-cron | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | sí | OK |
| prive-access | true | getUser/getAuthUser | sí | sí | sí | OK |
| prive-cron | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | sí | OK |
| prive-tenure-backfill | false | isAuthorizedCron (falla cerrada) | n/a (cron/webhook) | sí | no | OK |
| push-subscribe | true | getUser/getAuthUser | no | sí | no | P3 nota (endpoint reasignable) |
| recomendar-destinos | true | getUser/getAuthUser | sí | sí | sí | OK |
| reservations-inbound | false | firma Svix | n/a (cron/webhook) | no | no | OK |
| resolver-fechas | true | getUser/getAuthUser | sí | no | sí | OK |
| send-email | true | getUser/getAuthUser | sí | sí | sí | OK |
| serpapi-quote | true | getUser/getAuthUser | sí | sí | sí | OK |
| share-trip-notify | true | getUser/getAuthUser | sí | sí | no | OK |
| stripe-checkout | true | getUser/getAuthUser | no | sí | no | OK |
| stripe-portal | true | getUser/getAuthUser | no | sí | no | OK |
| stripe-webhook | false | firma Stripe (constructEventAsync) | n/a (cron/webhook) | sí | sí | OK |
| suggest-packing | true | getUser/getAuthUser | sí | no | sí | OK |
| suggest-restaurants | true | getUser/getAuthUser | sí | sí | sí | OK |
| tag-moment | true | getUser/getAuthUser | sí | sí | sí | nueva (merge): ruta propia validada (ownsPath) |
| track-flight | true | getUser/getAuthUser | sí | sí | no | AUD-SEG-04 corregido |
| travelpayouts-flights | true | getUser/getAuthUser | sí | no | sí | OK |
| tripadvisor-search | true | getUser/getAuthUser | sí | no | sí | OK |
| update-food-dna | true | getUser/getAuthUser | no | no | no | OK |

## Barrido 5: invitaciones, administración, borrado de cuenta y avisos

- **Privé.** `prive_accept_invitation` es solo de servicio. Ata el token a la cuenta (`INVITATION_OTHER_ACCOUNT`) y exige PRO y elegibilidad.
- **Administración.** El panel (`AdminMetrics`) usa RPC que comprueban `admins` en el servidor (SR1). La tabla `admins` solo se lee a sí misma y no tiene escritura de clientes.
- **Borrado de cuenta.**
  - `purge_account_data` recorre todas las tablas base con `user_id`, así que una tabla nueva queda cubierta sola (IK12 lo prueba con `action_idempotency`).
  - Además borra amistades, colaboraciones, diario propio, referidos, `rate_limits` y los viajes propios (en cascada).
  - Archivos: `account_deletion_files` cubre los 4 buckets.
  - Terceros: Stripe (cancelar y redactar) y PostHog. Sentry no se borra, pero recibe datos sin PII (`stripPii`); ver N9.
  - Se conservan `stripe_payment_events` y `deletion_requests` por obligación contable (DB2).
- **Avisos.** Un cliente solo inserta avisos para sí mismo (`notifications` INSERT `auth.uid() = user_id`). Los avisos a otras personas salen de RPC con amistad o viaje compartido, o de `share-trip-notify` con plantilla fija.

## HALLAZGOS NUEVOS

AUD-SEG-01 a AUD-SEG-05 (tabla de arriba). Además, notas abiertas P3 que no se corrigieron porque son decisión de producto o necesitan rehacer pantallas:

- **N1 (P3).** Las fotos del diario y de "momentos" están en buckets públicos. Quien tenga la URL la ve para siempre, también un colaborador expulsado. Arreglo sugerido: buckets privados con URL firmada (cambia `TripJournal` y `BestMomentsPanel`).
- **N2 (P3).** La amistad no pide consentimiento: quien conozca tu código de invitación es tu amigo al instante. Ve tu ADN resumido, tus ciudades, si eres Privé (`amigo_perfil.is_prive`) y te puede invitar a viajes o saludar. Sugerido: solicitud con aceptación, o al menos un aviso.
- **N3 (P3).** `trip_documents` (incluye pasaportes) lo ven todos los editores aceptados del viaje. Es el diseño, pero conviene marcar los pasaportes como "solo yo".
- **N4 (P3).** `trip_journal_entries.photo_url` y `travel_moments.image_url` aceptan cualquier URL. A los compañeros de viaje les llega como `<img>`: sirve como píxel de rastreo de IP.
- **N5 (P3).** Algunas respuestas de error devuelven detalle interno: `generar-packing-list` (`detail`), `generate-avatar` (`upErr.message`), `place-photo` (`raw`). No incluyen llaves.
- **N6 (P3).** `checkCronAuth` consulta a Auth (`listUsers`) por cada Bearer que "parece" llave de servicio: amplifica tráfico.
- **N7 (P3).** `affiliate_clicks` acepta `user_id NULL` de cualquier usuario autenticado, lo que infla `admin_metrics`.
- **N8 (P3).** CORS `*`. Es aceptable con Bearer, pero se podría limitar a los dominios de `origin.ts`.
- **N9 (P3).** Sentry no está en el borrado de cuenta (recibe datos sin PII).
- **N10 (P3).** `push-subscribe` reasigna un `endpoint` a la cuenta que lo registra. Requiere poseer la URL de push del navegador, y es el flujo legítimo de un equipo compartido. Se acepta.
- **N11 (P3).** `stripe-checkout` y `stripe-portal` no tienen `enforceRateLimit`. Es nota para el grupo de Stripe.

## HALLAZGOS REFUTADOS CON EVIDENCIA

| Sospecha | Evidencia | Estado |
|---|---|---|
| Vistas que se saltan RLS | `prive_experiences_v` y `prive_nightlife_compat` sin `security_invoker`, pero sin GRANT a clientes (SG6 OK) | REFUTADO |
| SECURITY DEFINER ejecutable por PUBLIC o sin `search_path` | SG2 y SG3 OK sobre 180 funciones | REFUTADO |
| Oráculo de relación (`is_trip_owner(viaje, otra_cuenta)`) | SR2 OK | REFUTADO |
| `get_access_state(_user_id)` lee la cuota de otra cuenta | SR3 OK | REFUTADO |
| Editar el diario tras la expulsión con supabase-js (con filtro) | SJ1 y SJ2 OK: la política SELECT ya lo bloqueaba (solo sin filtro pasaba: AUD-SEG-01) | REFUTADO (parcial) |
| Recorrido de rutas `../` en el almacenamiento | SS3 OK | REFUTADO |
| SSRF en funciones que piden fotos o lugares | `isPhotoRef`, `encodeURIComponent`, `ownsPath`; ninguna `fetch` de URL del usuario | REFUTADO |
| Cron sin secreto o con comparación no constante | `audSeguridadEdge.test.ts` + `cronAuth.test.ts` | REFUTADO |
| Webhooks sin firma | puertas en `audSeguridadEdge.test.ts` (Stripe, Svix) | REFUTADO |
| RPC de administración abiertas a usuarios | SR1 OK | REFUTADO |
| Fuerza bruta del código de amigo | 32⁸ = 1.1·10¹² combinaciones | REFUTADO |

## Notas para otros grupos (no se corrigió aquí)

- **AUD-01 (sesiones Privé).**
  - Quité a mano `AND s.user_id = v_uid` en `prive_require` (mutación M2) y las 89 pruebas de `prive.sql` siguieron pasando. P31 también choca con la liga a la sesión de Auth.
  - Agregué `supabase/tests/prive/aud_seg_strength.sql` (PS1/PS2), que prueba ese chequeo solo.
  - `prive/run.sh` vuelve a aplicar `2026102309*` después de todas las migraciones. Si una migración posterior redefine esas funciones, la suite probaría la versión vieja.
- **Grupo ops.** `ops/run.sh` vuelve a aplicar `2026102213*` al final y deja en la base de prueba versiones viejas de `clear_active_trip_on_collab_removed` y `trips_quote_basis_guard`, que se redefinen en `20261022141800` y `20261022143000`.
- **AUD-05/08 (Stripe).** `stripe-checkout` y `stripe-portal` no tienen límite de uso (N11).
- **AUD-02/03/06 (Reservas IA)** y **AUD-04/07 (bridge).** Sin hallazgos nuevos. Las mutaciones M5 (estado de reserva), M9 (cita textual), X1 (remitente verificado) y M6 (idempotencia de Stripe) se detectan (ver CALIDAD_PRUEBAS.md).

## Mejoras adicionales

- **Equipaje.** `generar-packing-list` leía `b.benefit_name`/`b.name`, que no existen en `user_vault_benefits`, así que la bóveda nunca llegaba al modelo. Ahora `vaultSummary` resume tarjetas (con salas VIP), aerolíneas, hoteles y rentas **sin** números de socio ni de documento. Prueba en `audSeguridadEdge.test.ts`; commit `65df1f1`.
- **Prueba de concurrencia.** `concurrent_rate_limit.sh` usaba `sleep 0.5` y fallaba con la máquina cargada (R4: `s1=false s2=true`). Ahora espera a que la sesión 1 tenga su golpe (`pg_stat_activity`). Pasó 3 de 3 con carga de 44.
- **Guardas de regresión.** SG1-SG8 y el inventario de funciones Edge hacen fallar las suites si una migración o función nueva rompe una regla. Ya detectaron las 3 funciones sociales del merge, que se revisaron y se agregaron.

## Resultados de las suites (base local, nombres `audseg_*`)

Corrido al final sobre la rama con merge de `claude/cierre-auditoria` (`32947ce`). Las salidas están en
`/tmp/claude-0/-home-user-reto/8647f9df-5459-5399-a533-ae256c643445/scratchpad/audseg_evidence/`.
En todas las suites SQL, el único error es el esperado de `pg_cron`.

| Suite | Resultado |
|---|---|
| Vitest | 177 archivos, 1,791 pruebas: 1,787 pasan, 4 fallan, ninguna por el código. 3 son por el límite de 5 s con la máquina cargada (carga ≈45): `godtierHome` ×2 y `dashboardActiveTrip`, que pasan solas o con `--testTimeout=30000`. La 4ª era una carrera de tiempo en `serpQuota`, corregida en `db9dabc` y que pasó 3 de 3 |
| `tsc --noEmit -p tsconfig.app.json` | sin errores |
| `npm run build` | correcto (1 min 35 s) |
| `deno check` (Deno 2.1) | correcto en mark-visited, generar-packing-list, track-flight, concierge-chat y concierge-action |
| security | 149 OK, 0 FALLA (antes 116: +SG/SJ/SS/SR/SX/SC e IK1-IK12; incluye R4 de concurrencia) |
| payments | 63 OK |
| cost | 16 OK |
| prive | 91 OK (89 + PS1/PS2) |
| prive_catalog | 110 OK |
| members_more | 30 OK |
| ai_reservations | 57 OK |
| concierge2 | 7 OK |
| bridge | 42 OK |
| ops | T1-T9, C1 y concurrencia (A/B/C): los valores observados coinciden con los esperados entre corchetes (esta suite no imprime "OK") |
| social (extra) | 70 OK |

Bases usadas: `audseg_<suite>` y `audseg_mut_*`. Todas se borraron al terminar.

## Riesgo residual

- AUD-SEG-01 y AUD-SEG-05 solo protegen producción cuando se apliquen sus migraciones. Ambas requieren autorización.
- Hay que confirmar en vivo:
  - si `pg-safeupdate` está activo (cambia el alcance real de AUD-SEG-01);
  - que los buckets públicos sigan sin política de listado para `anon`;
  - que la configuración de `verify_jwt` desplegada coincida con `config.toml`.
- Las notas N1-N11 son P3 y quedan abiertas.
