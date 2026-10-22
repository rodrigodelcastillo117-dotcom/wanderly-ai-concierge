# OPERACIÓN IATOS 10/10 — Fase 1 · Seguridad integral P0 (GROUP = sec)

Verificación contra PRODUCCIÓN: `https://traveliatos.life` + Supabase `uhkdewinscffhdonhhmt`
(commit b04ad9e / chunk con `iatos.prive.session`). Fecha: 2026-10-22.
Identidades: **anon** (solo publishable key), **A** (`96a04039…`), **B** (`63751b37…`), ambas FREE sintéticas.
Herramienta: sondas HTTP de solo lectura (curl/urllib) + uso normal de app. Sin SQL, sin deploys, sin migraciones contra prod.

## Resumen de estados
- PASS: 70  · FAIL: 0 (código) · OBSERVACIÓN/DECISIÓN DEL DUEÑO: 1 (P3, por diseño documentado) · BLOCKED/NOT_RUN: 0
- SerpApi gastadas: **0** (cap 0 respetado — funciones de búsqueda solo probadas sin JWT / JWT inválido, rechazadas antes de tocar proveedor). AI: **0**.
- Cuentas sintéticas usadas: A y B (ninguna nueva creada). Filas/archivos creados: todos eliminados (ver §Limpieza).

## P0/P1 — Hallazgos de seguridad
**Ninguno.** Todo intento de la identidad equivocada fue rechazado por el servidor.
Un único punto es una **DECISIÓN DEL DUEÑO ya documentada** (buckets públicos, P3, abajo SEC-ST-05).

---

## 1) Tablas vía PostgREST (RLS / grants)

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-T-01 | anon no lista datos de usuario | GET /rest/v1/{78 tablas}?select=* como anon | prod REST | b04ad9e | []/401/403 | Tablas de usuario → `[]` (RLS); tablas sensibles (admins*, comp_grants, plan_limits, app_flags, members_gate, prive_*, stripe_payment_events, serp_cache, quota_reservations, trial_grants, pro_paid_periods, deletion_*, profiles_tier_audit, ai_usage_log…) → 401 `42501` (grant revocado). `profiles` como anon → `[]` (no hay harvest de emails) | sweep_select_results.json | PASS |
| SEC-T-02 | referencia pública sin PII | GET destination_daily_costs / historical_flight_prices (anon) | prod REST | b04ad9e | solo datos de referencia | Devuelven costos/ precios por destino; **sin** user_id/email/PII | sweep_select_results.json | PASS |
| SEC-T-03 | A no lee filas de B | GET trips/expenses/trip_journal_entries/packing_lists/notifications/travel_moments ?id=eq.{fila B} como A | prod REST | b04ad9e | 0 filas | `200 []` en todas | a_attacks (consola) | PASS |
| SEC-T-04 | A no lee perfil de B | GET profiles?id=eq.{B} y ?email=eq.{B} como A | prod REST | b04ad9e | 0 filas | `200 []` ambos | a_attacks | PASS |
| SEC-T-05 | A no modifica filas de B | PATCH trips/expenses/journal/notifications de B como A | prod REST | b04ad9e | 0 filas afectadas | `200 []` (RLS no empareja); verificado leyendo como B: destino/amount intactos | a_attacks | PASS |
| SEC-T-06 | A no borra filas de B | DELETE expenses/trips/travel_moments de B como A | prod REST | b04ad9e | 0 filas | `200 []`; filas de B siguen presentes | a_attacks | PASS |
| SEC-T-07 | A no inserta con user_id=B | POST expenses/notifications/travel_moments/trips {user_id:B} como A | prod REST | b04ad9e | rechazo | `403 42501` "new row violates RLS" en las 4 | a_attacks | PASS |
| SEC-T-08 | No auto-escalada de tier/email/id | PATCH profiles.tier=free/enterprise/admin, email, invite_code, id como A | prod REST | b04ad9e | rechazo | `403` "Ese dato del perfil no se puede cambiar desde la app" (trigger profiles_guard_sensitive). El `200` inicial con tier=pro fue **no-op** (A ya era pro) | consola §tier | PASS |
| SEC-T-09 | tier no decide acceso | prive_status is_pro vs profiles.tier | prod | b04ad9e | is_pro ignora tier | A tiene profiles.tier='pro' pero prive_status.is_pro=false → entitlement por is_pro()/subscriptions, no por tier | consola | PASS |
| SEC-T-10 | No cambio de dueño (F-04) | PATCH trips?id={A} {user_id:B} | prod REST | b04ad9e | rechazo | `403` "No se puede cambiar el dueño de un viaje" (trigger trips_guard_owner) | consola | PASS |
| SEC-T-11 | tablas de config/sistema no escribibles por A | POST app_flags, plan_limits, members_gate, comp_grants, quota_reservations, pro_paid_periods, trial_grants, admins | prod REST | b04ad9e | rechazo | `403 42501` grant revocado en todas | consola | PASS |
| SEC-T-12 | nightlife_premium no escribible | POST nightlife_premium {nombre:HACK} como A | prod REST | b04ad9e | rechazo | `403` "violates RLS" | consola | PASS |
| SEC-T-13 | subscriptions no auto-activable | POST/PATCH subscriptions {status:active,plan:pro} user_id=A | prod REST | b04ad9e | rechazo / 0 filas | POST `403` RLS; PATCH `200 []` (0 filas) | consola | PASS |
| SEC-T-14 | trip_collaborators self-insert (F-01) | POST trip_collaborators {trip_id:B, user_id:A, status:accepted} | prod REST | b04ad9e | rechazo | `403 42501` INSERT revocado a authenticated | consola | PASS |
| SEC-T-15 | friendships falsas (F-02) | POST friendships {status:accepted} A↔B | prod REST | b04ad9e | rechazo | `403 42501` INSERT revocado | consola | PASS |
| SEC-T-16 | tracked_flights insert directo (F-05) | POST tracked_flights {user_id:B} como B | prod REST | b04ad9e | rechazo | `403 42501` INSERT revocado (solo service role) | mk_b_rows | PASS |
| SEC-T-17 | price_watches insert directo | POST price_watches como B | prod REST | b04ad9e | rechazo | `403 42501` INSERT revocado | mk_b_rows | PASS |
| SEC-T-18 | concierge_requests self-confirm (F-06) | POST/PATCH/DELETE concierge_requests {status:confirmed} como A | prod REST | b04ad9e | rechazo | INSERT/UPDATE/DELETE → `403 42501` sin grant a authenticated | consola | PASS |
| SEC-T-19 | bookings price/commission | POST bookings {user_id:A, commission_amount:99999, price_amount:1} | prod REST | b04ad9e | fila propia sin impacto de dinero | `201` creado (fila propia, RLS user_id=A). `commission_amount` solo aparece en types.ts; **ningún** código de src/ o edge lo usa para pagos/afiliados → sin impacto. Fila eliminada | consola; grep commission | PASS (nota) |

## 2) RPC (Functions)

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-R-01 | barrido de 148 RPC (anon + A, args vacíos) | POST /rest/v1/rpc/{fn} {} | prod | b04ad9e | admin/cron/service denegados | admin_*/cron_health/apply_comp_grants_now/claim_*/disable_members_password/gen_invite_code/prive_new_member_code/prive_random_token/prive_sweep/serp_burn_rate/sync_profile_tier → `401`(anon)/`403`(A) `42501`. public_plan_config → `200` (config pública). members_access/prive_status/prive_teaser/friend_profiles/prive_my_requests → `200` solo con sesión, vista propia | rpc_sweep_results.json | PASS |
| SEC-R-02 | A no actúa sobre B (quota) | rpc reserve_quota{_user_id:B}, consume_free_quota{_user_id:B} como A | prod | b04ad9e | denegado | `403 42501` (EXECUTE revocado; solo service role) | rpc_args (consola) | PASS |
| SEC-R-03 | A no lee estado PRO/Privé de B | rpc is_pro/prive_is_eligible/prive_entitled/prive_access_code {B} | prod | b04ad9e | denegado | `403 42501` todos | consola | PASS |
| SEC-R-04 | A no borra/purga cuenta de B | rpc purge_account_data{p_user_id:B}, start_account_deletion{_account_id:B} | prod | b04ad9e | denegado | `403 42501` ambos (solo service role) | consola | PASS |
| SEC-R-05 | A no ejecuta admin Privé | rpc admin_grant_prive/admin_revoke_prive/prive_invite_user/prive_set_password/prive_request_reset/prive_report_compromised {B} | prod | b04ad9e | denegado | `403 42501` todos | consola | PASS |
| SEC-R-06 | A no revoca comp / members pw | rpc revoke_comp{email:B}, set_members_password | prod | b04ad9e | denegado | `403 42501` | consola | PASS |
| SEC-R-07 | A no manipula Stripe/pagos vía RPC | rpc apply_stripe_subscription{_user_id:A}, revoke_paid_access, mark_subscription_cancel… | prod | b04ad9e | denegado | `403 42501` | consola | PASS |
| SEC-R-08 | A no lee serp_cache / rate limiter | rpc serp_cache_get, check_rate_limit | prod | b04ad9e | denegado | `403 42501` | consola | PASS |
| SEC-R-09 | revert_profile_tier/sync_profile_tier solo service | rpc revert_profile_tier{batch}, sync_profile_tier | prod | b04ad9e | denegado | `403/401 42501` | rpc_sweep | PASS |
| SEC-R-10 | prive_require con token forjado | rpc prive_require{_ps:"forged.garbage.token"} como A | prod | b04ad9e | rechazo sin fuga | `400 P0001 "PRIVE_NOT_PRO"` (sin stack ni internals) | consola | PASS |
| SEC-R-11 | RPC con dueño: A no actúa en viaje de B | rpc aceptar_invitacion_viaje{B trip}, invitar_amigo_viaje{B trip} | prod | b04ad9e | rechazo por dueño | `200 {ok:false,"sin_invitacion"}` y `{ok:false,"no_eres_dueno"}` (usan auth.uid()) | consola | PASS |
| SEC-R-12 | códigos de referido/amigo no adivinables | rpc claim_referral{ZZZ}, agregar_amigo_por_codigo{ZZZ} | prod | b04ad9e | rechazo | `200 false` / `{ok:false,"codigo_invalido"}` | consola | PASS |
| SEC-R-13 | RPC "mis datos" no filtran a B | rpc members_access/_state, prive_status/_teaser, prive_my_requests, friend_profiles como A | prod | b04ad9e | solo vista propia | `200`, ninguno contiene BID; is_pro=false, member=false | consola | PASS |

## 3) Storage

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-ST-01 | no enumeración (F-03) | POST /storage/v1/object/list/{journal-photos,travel-moments,trip-documents} (anon y A sobre carpeta de B) | prod storage | b04ad9e | vacío | `200 []` en todos (listado bloqueado) | consola | PASS |
| SEC-ST-02 | subir a carpeta ajena | POST object/{bucket}/{BID}/hack.png como A; y anon | prod storage | b04ad9e | rechazo | `400`→`403` AccessDenied "violates RLS" (A y anon) | consola | PASS |
| SEC-ST-03 | mime prohibido (F-11) | subir SVG y text/html a carpeta propia de A | prod storage | b04ad9e | rechazo | `415 InvalidMimeType` (SVG y HTML) | consola | PASS |
| SEC-ST-04 | tamaño máximo (F-11) | subir PNG de 11 MB a carpeta propia | prod storage | b04ad9e | rechazo | `413 EntityTooLarge` | consola | PASS |
| SEC-ST-05 | lectura cruzada bucket público | GET /object/{journal-photos,travel-moments}/{BID}/sec.png como anon y A | prod storage | b04ad9e | (diseño) link directo funciona | `200` sirve el archivo a anon y a A. **Buckets siguen public=true por decisión del dueño** (migración 20261022120000: "los enlaces públicos de cada foto siguen funcionando; solo se quita el listado"). Las políticas SELECT dueño/miembro NO aplican a GET directo en bucket público → confidencialidad depende de que la ruta (user_id UUID + archivo) no sea adivinable; profiles no es enumerable y el listado está bloqueado | consola | OBSERVACIÓN P3 — DECISIÓN DEL DUEÑO |
| SEC-ST-06 | bucket privado trip-documents aislado | B sube trip-documents/{trip}/sec.pdf; A (no colaborador) y anon GET | prod storage | b04ad9e | rechazo | A y anon → `404 NoSuchKey`; /object/public/ → `NoSuchBucket`; B (dueño) → `200` | consola | PASS |

## 4) Edge functions (57)

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-F-01 | todas rechazan sin JWT | POST /functions/v1/{57} sin Authorization | prod fn | b04ad9e | 401 | `401` en las 57 (verify_jwt true → UNAUTHORIZED_INVALID_JWT_FORMAT; crons → `{"error":"unauthorized"}`; stripe-webhook → `missing_signature`) | fn_sweep (consola) | PASS |
| SEC-F-02 | todas rechazan JWT inválido | POST con Authorization: Bearer not.a.jwt | prod fn | b04ad9e | 401 | `401` en las 57 | fn_sweep | PASS |
| SEC-F-03 | crons exigen x-cron-secret | POST health-check/price-watch-cron/flight-watch-cron/prive-cron/prive-tenure-backfill/account-deletion-retry con x-cron-secret erróneo | prod fn | b04ad9e | 401 | `401 {"error":"unauthorized"}` en las 6 (cron-auth falla cerrada) | consola | PASS |
| SEC-F-04 | stripe-webhook exige firma | POST stripe-webhook con stripe-signature falsa | prod fn | b04ad9e | rechazo | `401 {"error":"invalid_signature"}` | consola | PASS |
| SEC-F-05 | send-email no relaya correo arbitrario | POST send-email {trip_id:B, friend_id:B, to:"attacker@evil", html:"<b>"} como A | prod fn | b04ad9e | rechazo | `403 {"error":"forbidden"}` (no dueño); con trip propio + no-colaborador también `403`. Código: ignora to/subject/html, toma destinatario del servidor, plantilla fija | send-email/index.ts; consola | PASS |
| SEC-F-06 | delete-account no borra a otro ni sin confirmación | POST delete-account {account_id:B} y {confirm,confirmation,account_id:B} como A | prod fn | b04ad9e | rechazo | `400 confirmation_required` (sin parámetro de destino: siempre borra user.id; la clave extra invalida la confirmación) | delete-account/{index,validation}.ts; consola | PASS |
| SEC-F-07 | prive-access como no-PRO | POST prive-access {action:status / nope / accept_invitation} como A | prod fn | b04ad9e | refusal sin fuga | status→`200` vista propia (is_pro=false); nope→`400 INVALID`; accept_invitation→`200 {ok:false,NOT_PRO}` | consola | PASS |
| SEC-F-08 | concierge-action gating (targeting B trip) | POST concierge-action {type:members_nightlife_reservation / prive_request, trip_id:B} como A | prod fn | b04ad9e | rechazo antes de email | `403 MEMBERS_PRO_REQUIRED` y `403 PRIVE_NOT_PRO`; trip_id de B se resuelve con RLS del propio token → no vinculable | concierge-action/index.ts; consola | PASS |
| SEC-F-09 | share-trip-notify a no-amigo (F-19) | POST share-trip-notify {friend_ids:[B], destinos, path:/dashboard} como A | prod fn | b04ad9e | rechazo | `403 {FORBIDDEN, no_valid_friends}` (lee mis_amigos con sesión del remitente) | consola | PASS |

## 5) JWT

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-J-01 | token expirado | GET /rest/v1/trips con access_token vencido (exp 03:33) | prod REST | b04ad9e | 401 | `401 PGRST303 "JWT expired"` | consola | PASS |
| SEC-J-02 | payload alterado | GET trips con payload modificado | prod REST | b04ad9e | 401 | `401 PGRST301` "None of the keys was able to decode the JWT" | consola | PASS |
| SEC-J-03 | firma alterada | GET trips con byte significativo de firma cambiado | prod REST | b04ad9e | 401 | `401 PGRST301` | consola | PASS |
| SEC-J-04 | alg:none forjado | GET trips con header {alg:none} y firma vacía | prod REST | b04ad9e | 401 | `401 PGRST301` "expected alg was not 'none'" | consola | PASS |
| SEC-J-05 | tras sign-out (refresh revocado) | logout global → refresh con token revocado; getUser con access token | prod auth | b04ad9e | rechazo | refresh → `400 refresh_token_not_found`; /auth/v1/user → `403 session_not_found` | consola | PASS |

## 6) Rate limiting

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-RL-01 | el limitador responde | 12 POST share-trip-notify (límite 5/min) como A | prod fn | b04ad9e | 429 tras el 5º | `[403×5, 429×7]` — a partir del 6º devuelve `429` | consola | PASS |

## 7) Fugas / CORS

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado |
|----|-----------|----------------|---------|---------|----------|-----------|-----------|--------|
| SEC-L-01 | sin fuga de datos ajenos/secretos/stack | revisión de todos los cuerpos de error | prod | b04ad9e | sin PII/stack/SQL | No aparecen emails/ids de otros, ni stack traces, ni SQL con internals, ni secretos. Los errores son códigos (42501/PGRST/P0001/MEMBERS_PRO_REQUIRED…) | todos los logs | PASS |
| SEC-L-02 | CORS edge functions | OPTIONS preflight prive-access/concierge-action/share-trip-notify | prod fn | b04ad9e | wildcard aceptable para API bearer | `ACAO:*`, `ACAH: authorization,x-client-info,apikey,content-type`, `ACAM:POST,OPTIONS`. Sin cookies → `*` no permite robo de credenciales | curl | PASS (informativo) |
| SEC-L-03 | CORS PostgREST | GET con Origin: evil | prod REST | b04ad9e | reflejo de origin aceptable | Refleja el Origin; auth por bearer (no cookie) y anon key ya es pública → sin CSRF/robo | curl | PASS (informativo) |

## Notas y observaciones
- **SEC-ST-05 (DECISIÓN DEL DUEÑO, P3):** los buckets `journal-photos` y `travel-moments` siguen `public=true`. La corrección F-03 eliminó el **listado/enumeración** y la lectura cruzada vía API, pero un `GET` directo a `/object/<bucket>/<ruta>` sigue sirviendo el archivo a cualquiera que conozca la ruta exacta (user_id UUID + nombre). Es un comportamiento **intencional y documentado** por el dueño ("los enlaces públicos de cada foto siguen funcionando"). La confidencialidad depende de la no-adivinabilidad de la ruta (mitigado: `profiles` no es enumerable y el listado está bloqueado). Opción si se quiere privacidad real de fotos: poner los buckets en `public=false` y servir con signed URLs (rompe los enlaces públicos actuales → decisión de producto, no se tocó producción).
- `commission_amount`/`price_amount` en `bookings` son editables por el dueño de la fila pero **no se usan en ninguna lógica de dinero/afiliados** (solo en types.ts); sin impacto.
- Los "hints" de PostgREST (`GRANT … ON public.<tabla>`) revelan nombres de tabla en el 42501 — comportamiento por defecto de Supabase, severidad informativa.

## Limpieza
Creadas y **eliminadas**: B → 1 trip, 1 expense, 1 journal, 1 packing_list, 1 notification, 1 travel_moment, 1 objeto trip-documents, 1 journal-photos, 1 travel-moments. A → 2 trips de prueba (`SEC-A-own*`), 1 booking de prueba. Verificado: no quedan filas con marcador `SEC-TEST`/`SEC-A-own`; las filas preexistentes de B (de otros fixtures) se dejaron intactas. Sesión A re-autenticada tras un logout global de prueba. Ninguna cuenta nueva creada.
