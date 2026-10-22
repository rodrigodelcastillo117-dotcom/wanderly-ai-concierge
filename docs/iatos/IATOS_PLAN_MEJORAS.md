# IATOS: plan de mejoras

- **Fecha:** 2026-10-22.
- **Código revisado:** rama `claude/iatos-world-class`, commit `f4c4c72` (66 commits sobre `origin/main` = `ae6d5c8`), en solo lectura.
  - Mientras se escribía este plan, el grupo de pagos fusionó su trabajo (`d550aac` → `f4c4c72`). Todo lo de aquí corresponde a `f4c4c72`.
- **Para quién es:**
  - los dos fundadores, para decidir y dar el GO en cada paso;
  - Sebastián Mathus (NEXTIA), para revisar el orden, los riesgos y las pruebas.
- **Documentos hermanos:**
  - [IATOS_ARQUITECTURA_OBJETIVO.md](./IATOS_ARQUITECTURA_OBJETIVO.md): a dónde vamos;
  - [IATOS_TEST_MATRIX.md](./IATOS_TEST_MATRIX.md): qué está probado;
  - [IATOS_HALLAZGOS_PRIORIZADOS.md](./IATOS_HALLAZGOS_PRIORIZADOS.md): el detalle de cada ID.

---

## 0. Cómo leer este plan

**Estado de cada renglón:**

| Estado | Significado |
|---|---|
| **DONE_VERIFIED_PROD** | Aplicado en producción y verificado en vivo. |
| **FIXED_IN_BRANCH** | Construido en `claude/iatos-world-class` y cubierto por al menos una prueba automática que pasa hoy. **No está desplegado.** Si no hay prueba, se dice "sin prueba". |
| **IN_PROGRESS** | Una parte está hecha y otra no, o está construida pero apagada por un interruptor (`app_flags`). |
| **OPEN** | No hay corrección. |
| **BLOCKED** | Depende de una decisión del dueño o de un tercero (DNS, Stripe, SerpApi, Travelpayouts). |

**Esfuerzo:**

| Talla | Duración |
|---|---|
| **S** | ≤ 1 día de ingeniería |
| **M** | 2 a 5 días |
| **L** | Más de 1 semana |

**Decisión del dueño:** "sí" significa que no se puede avanzar sin su respuesta o su GO.

**Medición de hoy (2026-10-22, árbol limpio):**

| Hora (UTC) | Commit | Vitest | Suites SQL locales |
|---|---|---|---|
| 02:49 | `d550aac` | **392/392 en 59 archivos** (coincide con la cifra reportada antes) | `security`, `trip_quotes`, `ops` y `payments` pasan |
| 03:08 | **`f4c4c72` (vigente)** | **434/434 en 62 archivos** | Las mismas más `quota_reservations`, `plan_limits`, `trial_no_card` y `plan_limits_recommended`: todas pasan |

- `npx tsc --noEmit -p tsconfig.app.json`: 0 errores, en `d550aac` y en `dff3bcc`. `dff3bcc` es un commit de solo documentos posterior a `f4c4c72`, así que el código es el mismo.
- **Evidencia E2E de otra sesión:** [IATOS_E2E_EVIDENCE.md](./IATOS_E2E_EVIDENCE.md), con Playwright contra PROD y contra un build local de la rama de 02:20 a 03:10 UTC. **No la volví a ejecutar.** Este plan la cita como evidencia de terceros, con su ID (C5, D4b, N-09…).
- Detalle en `IATOS_TEST_MATRIX.md`, secciones 0 y 3.

> **Nota sobre la medición.** Una corrida anterior (02:4x UTC) coincidió con una fusión temporal en el mismo directorio y dio 383 pruebas con 4 archivos que no cargaron. No se cuenta.

---

## 1. Secuencia de liberación de la rama (primero esto)

**Objetivo:** llevar a producción lo que ya está construido y probado en la rama, sin romper nada y con vuelta atrás.

**Orden obligatorio:**

```
G-0 (respaldo) → G-1 (decisión de textos) → G-2 (revisar N-09) → a) migraciones → b) funciones → c) frontend → d) verificación → (si algo falla) e) rollback
```

**Por qué en ese orden:**

- Las funciones nuevas dependen de las migraciones.
- El frontend nuevo depende de las funciones nuevas.
- Las funciones **viejas** que corren hoy son compatibles con el esquema nuevo (lo revisé abajo), así que aplicar las migraciones primero no rompe producción.

### Compuertas previas

| # | Compuerta | Por qué | Quién | Estado |
|---|---|---|---|---|
| **G-0** | Respaldo de la base antes del paso a): *snapshot* o PITR de Lovable Cloud/Supabase, o como mínimo `pg_dump --schema-only` y un volcado de `subscriptions`, `usage_limits`, `trips`, `profiles` y `tracked_flights`. | Para poder volver si algo sale mal. | Dueño (requiere acceso) | OPEN. **NO VERIFICADO** si el plan contratado tiene PITR. |
| **G-1** | **Decidir qué textos comerciales se publican.** El commit `d550aac` hace que Landing, registro, Pro, Términos, avisos PRO y el correo de bienvenida lean `src/lib/planCopy.ts`, que promete "30 días de IATOS PRO gratis, sin tarjeta y sin cobro automático", "La prueba empieza al confirmar tu correo" y los límites de PRO (100 mensajes, 10 análisis, 5 alertas, 4 vuelos). **La prueba sin tarjeta ya está en la rama, pero apagada** (`app_flags.trial_no_card_enabled=false`), igual que los límites de PRO (`pro_limits_enforced=false`). Con el interruptor apagado, `stripe-checkout` sigue dando la prueba de Stripe, que pide tarjeta (`supabase/functions/stripe-checkout/index.ts:84`). Los topes de 5 alertas y 4 vuelos solo están sembrados y no se aplican. Publicar así reabre IATOS-012 al revés: se promete algo que el sistema no hace. | Riesgo con PROFECO y con la confianza del cliente. | **Dueño: sí** | OPEN |

**Opciones para G-1:**

- **(a)** Publicar el frontend junto con encender `trial_no_card_enabled`. Requiere antes: confirmación de correo exigida en Auth (G-3), dominio de Resend verificado (034), plan de SerpApi (015), controles contra abuso y el GO del dueño (DEC-02). Hoy no se cumple.
- **(b) Recomendada.** Publicar ya las correcciones del frontend, pero con `planCopy.ts` ajustado a lo que existe hoy: sin prueba sin tarjeta, y límites de PRO solo si `pro_limits_enforced` está encendido. Es un cambio S en la rama, que debe pasar `src/test/planCopy.test.ts`.
- **(c)** No hay una tercera opción segura.

| # | Compuerta | Por qué | Quién | Estado |
|---|---|---|---|---|
| **G-2** | **Revisar a mano la posible regresión N-09** antes de publicar el frontend. Según `IATOS_E2E_EVIDENCE.md` (H-4), en `f4c4c72` un usuario GRATIS sin análisis disponible abre `/dashboard/planear?q=…`, nunca se llama a `analizar-viaje`, no aparece ningún aviso y la frase se pierde. En `8393649` sí aparecía el aviso con "Ver IATOS PRO". | Puede ser la regresión de un flujo central de conversión | Ingeniería | OPEN (NO VERIFICADO por mí) |
| **G-3** | **Exigir la confirmación de correo en Supabase Auth antes de encender la prueba sin tarjeta.** Según `IATOS_E2E_EVIDENCE.md` (Cuentas, y 9.2 IATOS-055), el registro devuelve sesión y `email_confirmed_at` de inmediato. El trigger `on_auth_user_no_card_trial` se dispara con `email_confirmed_at`, así que con la configuración actual **cualquier correo inventado recibiría 30 días de PRO al registrarse**: el control 4 de la propuesta (empezar al confirmar el correo) no protege nada. | Abuso y costo de la prueba | **Dueño: sí** (configuración de Auth y Resend verificado, IATOS-034) | OPEN. No bloquea esta liberación mientras `trial_no_card_enabled=false` |

### a) Aplicar las migraciones en orden (con GO)

Estas son las 11 migraciones `2026102213*.sql`: las 7 de `130000` a `133000` y las 4 de pagos, de `135000` a `135300`. **Ninguna está aplicada en producción.** La `20261022120000_security_p0_fixes.sql` ya está aplicada y verificada; no se vuelve a correr.

**Cómo se aplican:** una por una en el SQL editor de Lovable Cloud, con su GO, y verificando cada una antes de pasar a la siguiente. Todas son idempotentes: lo probé hoy con una segunda pasada en local (`supabase/tests/ops/run.sh` → "ok" en las 11, en `f4c4c72`).

| # | Archivo | Qué hace | ¿Las funciones viejas siguen funcionando? | Verificación inmediata (solo lectura) |
|---|---|---|---|---|
| 1 | `20261022130000_pay_stripe_sync_and_atomic_quota.sql` | `subscriptions.stripe_event_created`. Reemplaza `consume_free_quota` por la versión atómica con la misma firma. Agrega `apply_stripe_subscription`, `stripe_sub_is_live` y `has_comp_grant`. La cortesía exige correo confirmado. Agrega `apply_comp_grants_now`. | Sí: misma firma y misma forma de respuesta. Las funciones viejas no llaman a las RPC nuevas (revisé `origin/main`). | `SELECT proname FROM pg_proc WHERE proname IN ('apply_stripe_subscription','stripe_sub_is_live','has_comp_grant','apply_comp_grants_now');` → 4 filas. `SELECT has_function_privilege('authenticated','public.consume_free_quota(uuid,text)','EXECUTE');` → `false`. |
| 2 | `20261022131000_active_trip_and_fixer_status.sql` | `profiles.active_trip_id` (FK `ON DELETE SET NULL`), trigger que impide fijar un viaje ajeno, trigger que lo limpia al quitar a un colaborador, y nuevos valores permitidos en `fixer_escalations.status`. | Sí: el frontend viejo no escribe esa columna. | `SELECT column_name FROM information_schema.columns WHERE table_name='profiles' AND column_name='active_trip_id';` → 1 fila. |
| 3 | `20261022132000_ops_flight_watch_reliability.sql` | Columnas de observabilidad en `tracked_flights`, `tracked_flight_gap` y `claim_tracked_flights` (`SKIP LOCKED`). | Sí: el `flight-watch-cron` viejo lee y escribe columnas que se conservan. Hay 0 filas en vivo. | `SELECT has_function_privilege('authenticated','public.claim_tracked_flights(integer,interval)','EXECUTE');` → `false`. |
| 4 | `20261022132100_ops_notifications_dedup.sql` | `notifications.dedup_key`, índice único parcial y `notify_once()`. | Sí. | `SELECT indexname FROM pg_indexes WHERE indexname='notifications_user_dedup_key_uniq';` → 1 fila. |
| 5 | `20261022132200_ops_price_watch_original_currency.sql` | Columnas `baseline_currency`, `baseline_amount_original`, `last_amount_original` y `last_alert_amount_original` en `price_watches`, y `amount_original`, `currency` y `fx_rate` en `price_watch_checks`. | Sí: solo agrega columnas. Hay 0 alertas en vivo. | `information_schema.columns` → 4 + 3 columnas. |
| 6 | `20261022132300_ops_health_check_jobs_and_email.sql` | `health_checks.email_status` y `email_error`, `cron_health()` y `verify_cron_secret` (misma definición que ya está aplicada a mano). | Sí: `verify_cron_secret` se reemplaza con el mismo cuerpo. **Riesgo:** si la versión de producción difiere de `docs/ops/programar-tareas.sql`, las tareas podrían empezar a recibir 401. | En el SQL editor: `SELECT public.cron_health();` → `available: true` y 3 tareas. Después de la siguiente corrida de vuelos (≤15 min): `SELECT status FROM cron.job_run_details ORDER BY start_time DESC LIMIT 1;` → `succeeded`, y en `net._http_response` el último `status_code` = 200. |
| 7 | `20261022133000_trip_quotes.sql` | Tabla `trip_quotes` (solo inserción, RLS de lectura para el dueño y los colaboradores), `trips.current_quote_id`, `quote_basis` y `quote_needs_update`, y el trigger `trips_quote_basis_guard` en **cada INSERT o UPDATE de `trips`**. | Sí: el trigger solo mantiene columnas nuevas y rechaza un `current_quote_id` ajeno. Probado en local (`trip_quotes.sql` Q1-Q11). | `SELECT count(*) FROM trip_quotes;` → 0. Editar un viaje de prueba y comprobar que `quote_basis` se llena. |
| 8 | `20261022135000_pay_quota_reservations.sql` | Tabla `quota_reservations`; `reserve_quota`, `commit_quota` y `release_quota` (solo `service_role`); caducidad de 10 min; `REVOKE` de escritura en `usage_limits`; vuelve a definir `consume_free_quota` con la misma firma. | Sí: `consume_free_quota(uuid,text)` conserva su firma, y hoy `usage_limits` tiene 0 filas en vivo. | `SELECT has_function_privilege('authenticated','public.reserve_quota(uuid,text,text)','EXECUTE');` → `false`. |
| 9 | `20261022135100_pay_plan_limits.sql` | Tablas `plan_limits` y `app_flags` (siembra con `pro_limits_enforced=false` y `trial_no_card_enabled=false`); `app_flag`, `quota_rule` y `quota_used`; vuelve a definir `reserve_quota`, `consume_free_quota` y `get_access_state` (`RETURNS jsonb`, igual que antes). | Sí, con los interruptores apagados: GRATIS 3/1 y PRO ilimitado, igual que hoy (SQL P1/P2 en local). Que el frontend viejo lea bien el `jsonb` de `get_access_state` es NO VERIFICADO campo por campo. | `SELECT key, value FROM app_flags;` → ambos `false`. |
| 10 | `20261022135200_pay_trial_no_card.sql` | Tabla `trial_grants` (hash del correo), `normalize_email`, `email_trial_hash` y el trigger `on_auth_user_no_card_trial` **en `auth.users`** (`AFTER INSERT OR UPDATE OF email_confirmed_at`). | Sí: con el interruptor apagado, el trigger sale sin hacer nada (`:57`). Riesgo bajo, pero es un trigger en `auth.users`: una falla bloquearía los registros. Probado en local (T1). | Registrar una cuenta de prueba y confirmar su correo: no se crea ninguna fila en `trial_grants` ni en `subscriptions`. |
| 11 | `20261022135300_pay_plan_limits_recommended.sql` | Vuelve a definir `is_pro`: un `trialing` sin `current_period_end` **deja de ser PRO**; `active` y `comped` no cambian. Agrega `effective_plan` y `plan_limit`; siembra los límites recomendados (solo aplican con los interruptores). | Sí: en vivo las 11 suscripciones son `comped` (no hay ningún `trialing`), así que nadie pierde PRO. | `SELECT count(*) FROM subscriptions WHERE status='trialing' AND current_period_end IS NULL;` **antes** de aplicar → debe ser 0. Después: `SELECT public.is_pro(<un usuario comped>);` → `true`. |

**Después de las 11:**

- **Decidir si se registran** en `supabase_migrations.schema_migrations` (IATOS-072). Hoy hay 35 registradas. **Decisión del dueño: sí.**
- **Que la migración quede aplicada no enciende nada.** `pro_limits_enforced` y `trial_no_card_enabled` quedan en `false` hasta el GO del dueño (D6 y D7).

### b) Un despliegue de funciones con Lovable

Supabase empaqueta cada función con sus importaciones. Por eso, una función cuyo código no cambió **también debe volver a desplegarse** si importa un módulo de `_shared/` que sí cambió.

Lo calculé recorriendo las importaciones desde cada `index.ts` contra `git diff --name-only origin/main..HEAD -- supabase/functions`. `_shared/rate-limit.ts` importa `entitlements.ts`, que cambió, así que casi todas quedan afectadas.

**Cambió su propio código: 27 funciones**

`ai-tool`, `analizar-viaje`, `auditar-perfil`, `buscar-promociones`, `card-benefits-lookup`, `concierge-action`, `concierge-chat`, `editar-viaje-ai`, `flight-watch-cron`, `flights-search`, `health-check`, `hotels-search`, `logistics-plan`, `nightlife-discover`, `parse-trip-file`, `parsear-viaje`, `price-watch`, `price-watch-cron`, `recomendar-destinos`, `serpapi-quote`, `stripe-checkout`, `stripe-portal`, `stripe-webhook`, `suggest-packing`, `suggest-restaurants`, `track-flight`, `travelpayouts-flights`.

**Solo cambió un `_shared/` que importa: 21 funciones**

`analizar-preferencias-ruta`, `buscar-video`, `delete-account`, `email-bienvenida`, `enviar-email-fixer`, `evolucionar-dna`, `flight-status`, `generar-packing-list`, `generate-avatar`, `geocode`, `geocode-address`, `get-routes`, `nearby-places`, `pexels-image`, `place-details`, `place-photo`, `places-nearby`, `places-search`, `resolver-fechas`, `send-email`, `tripadvisor-search`.

**Sin cambios: 5 funciones**

`evaluar-logros`, `mark-visited`, `push-subscribe`, `share-trip-notify`, `update-food-dna`.

**Total a desplegar: 48 de 53.**

**Notas:**

- **`send-email`** entra solo porque `_shared/email.ts` cambió un texto del correo de bienvenida. Su propio código es igual al de `origin/main`, que ya está en producción y verificado. **Hay que repetir las 4 verificaciones de F-04 después del despliegue** (ver d).
- **Dependencias de esquema:**

| Función | Necesita |
|---|---|
| `stripe-webhook` | `apply_stripe_subscription` (migración 1) |
| `flight-watch-cron` | `claim_tracked_flights` y `notify_once` (migraciones 3 y 4) |
| `price-watch` y `price-watch-cron` | columnas de la migración 5 y `notify_once` |
| `health-check` | `cron_health` (migración 6); si falta, solo avisa |
| `analizar-viaje` y `editar-viaje-ai` | `trip_quotes` (migración 7); si falta, no rompen la cotización (`src/test/quoteSnapshot.test.ts`) |
| `concierge-chat` (y el frontend del Concierge) | `profiles.active_trip_id` (migración 2). Según `IATOS_E2E_EVIDENCE.md` (N-03, B-12), el frontend de la rama contra el backend de PROD recibe **400** en `GET /rest/v1/profiles?select=active_trip_id`. |
| **`concierge-chat`, `analizar-viaje` y `logistics-plan`** | **`reserve_quota`, `commit_quota` y `release_quota` (migraciones 8, 9 y 11).** `reserveQuota` falla cerrado (`_shared/entitlements.ts:48-55`): **si se despliegan antes de las migraciones, todos los mensajes de Iato y todos los análisis se niegan, también para PRO.** |

- **Secretos opcionales** que la versión nueva lee. Que existan es **NO VERIFICADO**:
  - `HEALTH_ALERT_EMAIL`;
  - `FLIGHT_WATCH_MAX_CHECKS` (50 por omisión);
  - `TRAVELPAYOUTS_MARKER` (si falta, usa el público 533299);
  - `ANTHROPIC_MODEL`;
  - las llaves VAPID: si faltan, ya no truena; solo no manda push.
- `supabase/config.toml` no cambió en la rama (revisado en `f4c4c72`), así que `verify_jwt` sigue igual.

### c) Publicar el frontend

- Son 138 archivos cambiados en `src/`, `public/` e `index.html` (incluye el service worker).
- Se publica **después** de b), porque el frontend nuevo espera los códigos 402 legibles, `trip_id` en el re-análisis, las tarjetas validadas y `trip_quotes`.
- **Requiere resolver G-1 antes.**

### d) Lista de verificación en vivo

**Presupuesto de SerpApi para verificar:** quedan ~216 búsquedas. Esta lista usa como máximo unas 15. Las pruebas con cuentas usan **una cuenta de prueba nueva en plan GRATIS**, porque las 11 cuentas existentes son de cortesía.

| # | Qué | Cómo | Resultado esperado | Costo |
|---|---|---|---|---|
| V1 | Las 53 funciones responden | Sondeo OPTIONS, igual que en la auditoría | 51 responden 200; `health-check` y `price-watch-cron` responden 401 | 0 |
| V2 | `send-email` sigue cerrado | Las 4 llamadas de F-04 | `to`/`html` libres → 400; viaje ajeno → 403; sin sesión → 401; la invitación legítima llega | 0 |
| V3 | Tareas programadas | Esperar una corrida de cada una y leer `cron.job_run_details` y `net._http_response` | `succeeded` y HTTP 200 en las 3. La de precios corre a las 03:17 y 15:17 UTC; la de salud, a las 13:07 UTC | 0 (hay 0 vuelos y 0 alertas) |
| V4 | health-check nuevo | Revisar la fila nueva de `health_checks` después de la corrida diaria | Incluye la revisión de tareas y `email_status` lleno. Con el dominio sin verificar se espera `failed` o `no_recipient` si `HEALTH_ALERT_EMAIL` no es la dirección dueña de Resend | ~1 |
| V5 | Iato con herramientas | Cuenta de prueba: "vuelos CDMX a Madrid del 10 al 18 de diciembre" | Se dibuja una tarjeta de vuelo con precio, moneda e insignia de origen; no aparece un error de parseo | 1 a 2 |
| V6 | Iato elige el viaje | Cuenta con 2 viajes próximos: "¿a qué hora sale mi vuelo?" | Pregunta cuál viaje, con botones de destino | 0 |
| V7 | Cuota GRATIS en Iato | Mandar el 4.º mensaje del mes | Diálogo de límite con la fecha de renovación, "Conocer IATOS PRO" y "Continuar con la versión gratuita" (no "non-2xx"); respuesta 402 `FREE_LIMIT_REACHED` | 0 |
| V8 | Análisis para 6 viajeros | PlanTrip con 6 viajeros y 5 noches | El hospedaje usa 3 habitaciones; aparece una fila nueva en `trip_quotes`; TripDetail muestra "Cotizado el … · válido hasta …" | 3 a 4 |
| V9 | Re-analizar conserva los datos | En el viaje de V8: una entrada de diario y una de equipaje, luego Editar → cambiar fechas → Re-analizar | Mismo `trips.id`; el diario y el equipaje siguen ahí; aparece una segunda versión en `trip_quotes` | 3 a 4 |
| V10 | Total del viaje | Viaje con presupuesto menor que la cotización | Se muestra el total real y "Excede tu presupuesto por $X" | 0 |
| V11 | Gastos con varias monedas | 1,000 MXN + 1,000 USD | Subtotales por moneda y total en MXN con la fuente y la fecha de la tasa | 0 |
| V12 | Onboarding de una cuenta nueva | En un teléfono real | Termina en el dashboard, sin rebotar; "Saltar por ahora" funciona en cada paso | 0 |
| V13 | Avatar | iPhone Safari y Android Chrome | "Elegir de mi galería" abre la galería y "Tomar una foto" abre la cámara | 0 |
| V14 | Botones de afiliado en iOS | iPhone Safari, Vuelos → un resultado | Se abre la pestaña del socio | 0 |
| V15 | Contraseña | Pedir un enlace de recuperación y abrirlo; abrir uno vencido | El formulario se habilita; el vencido dice "El enlace expiró o ya se usó" | 0 |
| V16 | Stripe en modo prueba | Evento de prueba desde el panel o el CLI de Stripe hacia el webhook | 200, la fila se actualiza y queda `stripe_event_created` | 0 |
| V17 | Cookies | Ventana privada, rechazar | No se carga PostHog ni el script de Travelpayouts (pestaña de red) | 0 |
| V18 | Seguridad sigue igual | Repetir el listado anónimo de `travel-moments` y una URL pública de avatar | `[]` y 200 | 0 |
| V19 | Interruptores apagados | Registrar una cuenta nueva y confirmar el correo | Ninguna fila en `trial_grants` ni en `subscriptions`; la cuenta queda en GRATIS; `SELECT key, value FROM app_flags;` → ambos `false` | 0 |
| V21 | N-09 resuelto | Cuenta GRATIS sin análisis disponible: abrir `/dashboard/planear?q=Fin de semana en Puebla…` | Aparece el diálogo de límite (o un aviso), sin llamar a `analizar-viaje` y sin perder la frase | 0 |
| V20 | Iato no cobra una aclaración | Con la cuenta de V6, hacer la pregunta ambigua | Iato pregunta "¿cuál viaje?" y el contador de mensajes no sube (`get_access_state`) | 0 |

Todo lo que no esté en esta tabla sigue **NO VERIFICADO de punta a punta en producción** después de la liberación (ver `IATOS_TEST_MATRIX.md`, sección 7).

### e) Plan de *rollback*

| Capa | Cómo se vuelve atrás | Notas |
|---|---|---|
| **Migraciones** | **No se revierten.** Son aditivas: agregan columnas, tablas, índices y funciones, y las funciones viejas son compatibles con el esquema nuevo (sección a). | **Matiz honesto:** no son 100% aditivas. Reemplazan con `CREATE OR REPLACE` `consume_free_quota`, `apply_comp_grant` y `verify_cron_secret`, y, en las de pagos, también `reserve_quota`, `get_access_state` e `is_pro`. Agregan triggers a `trips`, `profiles`, `trip_collaborators` y **`auth.users`** (`on_auth_user_no_card_trial`). Si un trigger causara problemas, se quita sin perder datos: `DROP TRIGGER trips_quote_basis_guard ON public.trips;` · `DROP TRIGGER profiles_guard_active_trip ON public.profiles;` · `DROP TRIGGER clear_active_trip_on_collab_removed ON public.trip_collaborators;` · `DROP TRIGGER on_auth_user_no_card_trial ON auth.users;`. Los interruptores se apagan con `UPDATE app_flags SET value='false'::jsonb WHERE key IN ('pro_limits_enforced','trial_no_card_enabled');`. Para volver a `consume_free_quota` o `is_pro` anteriores hay que tomar su definición del respaldo G-0. **Si se regresan las funciones a `ae6d5c8`, las migraciones nuevas pueden quedarse:** las funciones viejas solo usan `consume_free_quota`, `is_pro` y `check_rate_limit`, que conservan su firma. |
| **Funciones** | Volver a desplegar con Lovable las funciones del commit anterior (`origin/main` = `ae6d5c8`). | `ae6d5c8` ya incluye el `send-email` corregido, así que el *rollback* no reabre F-04. **No regresar `send-email` a una versión anterior a `629c946`.** |
| **Frontend** | Volver a publicar `main` (`ae6d5c8`). | Incluye `InviteFriendDialog`, que manda solo `trip_id`/`friend_id`. |

**Cuándo hacer rollback:**

- falla V2 o V18 (seguridad);
- `stripe-webhook` responde 500 de forma sostenida a eventos válidos;
- las tareas pasan a `failed` o a HTTP 401 (V3);
- `analizar-viaje` falla en más de la mitad de los intentos en la primera hora (**NO VERIFICADO** cómo medirlo sin `ai_usage_log`: revisar los registros de la función).

---

## 2. Fases A → E

Cada renglón agrupa IDs de `IATOS_HALLAZGOS_PRIORIZADOS.md`. El estado sale de los commits de la rama y de las pruebas que pasan hoy. **En varios casos es más nuevo que la tabla de estados de ese documento**, que se escribió antes de varias fusiones.

### Fase A · Estabilidad (seguridad, operación, liberar lo hecho)

| ID(s) | Qué | Por qué (riesgo o valor) | Esf. | Depende de | Dueño | Estado |
|---|---|---|---|---|---|---|
| 001, 002, 003 (listado), 016, 017 (BD) | Colaborador falso, amistad falsa, listado de buckets, cambio de dueño, escritura directa de vuelos | P0 de privacidad | S | — | no | **DONE_VERIFIED_PROD** (2026-10-22) |
| 004 | `send-email` solo para invitaciones verificadas | P0: *phishing* con la marca | S | — | no | **DONE_VERIFIED_PROD** (sin prueba automática del *handler*) |
| REL | Secuencia de liberación (sección 1) | Nada de lo FIXED_IN_BRANCH le sirve al usuario hasta desplegarlo | M | G-0, G-1, G-2 | **sí** | OPEN |
| 003 (mejora) | Hacer privado `journal-photos` y servir *signed URLs* | Las URL públicas individuales siguen abiertas | M | — | no | OPEN (hoy hay 0 objetos) |
| 052 | Limitar las columnas de `profiles` que edita el usuario | Puede editar cualquier columna, incluido el correo al que se manda la cotización | M | — | no | OPEN |
| 053 | Que los amigos vean solo un perfil reducido | Exposición de datos personales | S | — | no | OPEN |
| 054 | Validar tipo y tamaño de los uploads en el servidor | Abuso de storage. El avatar solo se valida en el cliente | M | — | no | OPEN |
| 048 | Cuotas y límites que fallan cerrado; IP de confianza en lugar de `X-Forwarded-For` | Abuso y evasión de límites | S | — | no | IN_PROGRESS: `trip_analysis`, `concierge` (vía `reserveQuota`) e `isPro` fallan cerrado (`quota.test.ts`, `reservation.test.ts`); `check_rate_limit` (falla abierto) y `clientIp` siguen OPEN |
| 029 | Protección contra *prompt injection* y URLs inseguras | Un colaborador podía darle órdenes a Iato | M | — | no | IN_PROGRESS: concierge FIXED_IN_BRANCH (`iatoEvals` E-15/E-16, `conciergeCards`); otras funciones de IA NO VERIFICADO |
| 051 | Escapar HTML y limitar la frecuencia de los correos al staff | Inyección en correos internos | S | — | no | IN_PROGRESS: `concierge-action` FIXED_IN_BRANCH (sin prueba del *handler*); `enviar-email-fixer` sin cambios (OPEN) |
| 070 | Redactar secretos en errores guardados o enviados | Fuga de llaves | S | — | no | FIXED_IN_BRANCH (`healthAlerts.test.ts`, `flightWatchRules.test.ts`) |
| 096 | Autenticación de cron que falla cerrado y es probable; origen de regreso limitado | Endurecimiento | S | — | no | FIXED_IN_BRANCH (`cronAuth.test.ts`, `stripeCheckout.test.ts` "origin") |
| 033, 065, 066 (vuelos), 067, 068, 044 | Seguimiento de vuelos honesto, reclamo con `SKIP LOCKED`, reglas de alerta, límite de tiempo, push sin VAPID, vuelos sin fecha | Alertas falsas o perdidas; gasto doble | M | migraciones 3 y 4 | no | FIXED_IN_BRANCH (`flightWatchRules`, `flightWatchRunner`, `trackFlightRules`, `pushCore`; SQL `ops/*`) |
| 066 (alertas de precio) | Reclamo con `SKIP LOCKED` en `price-watch-cron` | Dos corridas encimadas gastan doble | S | — | no | IN_PROGRESS: dedup de avisos FIXED_IN_BRANCH; sin reclamo |
| 069, 034 (código) | health-check que vigila las tareas, manda correo solo si cambia algo y guarda `email_status` | Hoy una tarea puede fallar sin que nadie lo note | M | migración 6 | no | FIXED_IN_BRANCH (`healthAlerts.test.ts`, `serviceHealthCard.test.tsx`, SQL `cron_health.sql`) |
| 032 | Fechas locales y no en UTC: en la UI, en Iato y en la ventana de ±1 día del seguimiento de vuelos | Alertas nocturnas perdidas; "hoy" cambiaba a "mañana" después de las 18:00 en CDMX | S | REL, migración 3 | no | FIXED_IN_BRANCH (`trackFlightRules.test.ts` `localISODate`, `iatoEvals` E-20, SQL `flight_watch_claim.sql` T3/T6) |
| 071 | El correo de cotización enlaza a `/dashboard/viajes/…` | Enlace 404 | S | REL | no | FIXED_IN_BRANCH (ya está en `origin/main`, pero no llega a producción hasta volver a desplegar `analizar-viaje`; sin prueba automática) |
| 034 (entrega) | Verificar el dominio `traveliatos.life` en Resend (DNS) | Los correos a usuarios probablemente no llegan | S | DNS | **sí** | BLOCKED |
| 072 | Registrar las migraciones aplicadas a mano | Deriva entre el repo y producción (35 contra 56) | S | REL | **sí** | BLOCKED |
| 015 | Plan de SerpApi y alertas de consumo | Quedan ~216 búsquedas: de 1 a 3 días de pruebas | S | — | **sí** | BLOCKED |
| 031, 058 | Modelos retirados de Claude y Gemini | Promociones y vida nocturna fallan; un salto extra por llamada | S | — | no | FIXED_IN_BRANCH (`claudeCall.test.ts`, `retiredModels.test.ts`, `aiFetch.test.ts`) |
| 098 | `docs/ops/LEEME.md` al día | Operación manual correcta | S | — | no | IN_PROGRESS: actualizado (`7a0260d`), pero su lista de migraciones previas **no incluye** `20261022130000`, `131000` ni `133000` |
| CI | Correr las suites SQL y Vitest en CI | Hoy se corren a mano | M | — | no | OPEN |
| 108, 107, 109, 106 | PII en registros y terceros, funciones "oráculo", notificaciones con texto libre, `trip_id` sin validar | Endurecimiento P3 | M | — | no | OPEN |

### Fase B · Precisión (dinero y datos que se muestran)

| ID(s) | Qué | Por qué | Esf. | Depende de | Dueño | Estado |
|---|---|---|---|---|---|---|
| 007 | El total muestra la cotización, no el presupuesto | P0: dinero mostrado mal | S | REL | no | FIXED_IN_BRANCH (`realTripTotal.test.ts`) |
| 009, 037, 063 | Habitaciones = ⌈viajeros/2⌉; respetar "ya tengo vuelo" y "sin hotel"; total = suma del desglose; las pruebas ahora prueban el código real | P0: hospedaje de grupos | S | REL | no | FIXED_IN_BRANCH (`budget.test.ts`, 13) |
| 010, 073, 074, 082 | Nunca sumar monedas distintas; FX con fuente y fecha; fechas locales | P0: Gastos mezclaba monedas | M | REL | no | FIXED_IN_BRANCH (`fx.test.ts`, 10) |
| 026, 057 | El servidor decide la procedencia; Travelpayouts no dice "en vivo"; insignias honestas | Confianza en el precio | M | REL | no | FIXED_IN_BRANCH (`tripSources`, `logisticsProvenance`, `provenance`, `priceSourceBadge`) |
| N-07 | Las tarjetas de vuelo del análisis no muestran ninguna etiqueta de procedencia en PROD (`IATOS_E2E_EVIDENCE.md`, D5) | El usuario no sabe qué tan confiable es el precio del vuelo | S | REL | no | OPEN (si la rama ya lo corrige: NO VERIFICADO; no se vio en el build de la rama) |
| N-06 | Trayecto corto (CDMX→Puebla): solo cotiza vuelos con escalas de 4 a 5 h, sin opción terrestre (`IATOS_E2E_EVIDENCE.md`, D5) | Recomendación sin sentido que encarece el viaje (46% del total) | M | — | no | OPEN |
| 027 | `editar-viaje-ai` no puede conservar "en vivo" | Precio falso tras editar | S | REL | no | FIXED_IN_BRANCH (`editReconcile.test.ts`) |
| 024 | Las búsquedas fallidas dicen "no disponible" y no inventan resultados | Precios inventados con botón de compra | S | REL | no | FIXED_IN_BRANCH (`liveSearchFallback.test.ts`; `iatoEvals` E-07/E-08) |
| 080, 035, 075 | *Snapshot* inmutable de la cotización; aviso de "cotización desactualizada" al cambiar viajeros o fechas; desglose por selección | Trazabilidad | M | migración 7 | no | FIXED_IN_BRANCH (`quoteSnapshot`, `quote`; SQL `trip_quotes.sql`). Que las selecciones se guarden (parte de 035): NO VERIFICADO |
| 036, 078, 040 | Travelpayouts de viaje redondo; enlace de respaldo con fecha DDMM; *marker* que no usa parte del token | Precio y atribución | S | — | no (040: confirmar `TRAVELPAYOUTS_MARKER`: **sí**) | FIXED_IN_BRANCH (`tpParams.test.ts`) |
| 038 | Alertas de precio en la moneda del proveedor | Alertas falsas por tipo de cambio | S | migración 5 | no | FIXED_IN_BRANCH (`priceWatch.test.ts`) |
| 076 | Una cotización en vivo parcial no se presenta como "Inversión total" | Total engañoso | S | REL | no | FIXED_IN_BRANCH (sin prueba: `LiveTripQuote.tsx`, commit `e4a0400`) |
| 043 | SOS: no presentar 112 como dato en países fuera de la lista | Seguridad física | S | REL | no | FIXED_IN_BRANCH (`emergencyNumbers.test.ts`) |
| PROV | Unificar los tres vocabularios de estado del dato | Coherencia (arquitectura, sección 3.4) | S | — | no | OPEN |
| 062 | Los restaurantes sugeridos por IA no se guardan como del viaje | Datos sin fuente mezclados | S | — | no | OPEN |
| 064 | Validar el JSON de `parsear-viaje` y `parse-trip-file` | Errores silenciosos | S | — | no | OPEN |
| 091 | Visa y seguridad: aviso de "generado por IA" y fuente | Información sensible | S | — | no | OPEN |
| 079 | TripSplit con moneda, sin negativos y sin borrado en cascada | Dinero mal repartido | M | — | no | OPEN |
| 099 | Detalles menores de dinero, fechas y textos | Pulido | S | — | no | OPEN |

### Fase C · Integración (expediente vivo, costo)

| ID(s) | Qué | Por qué | Esf. | Depende de | Dueño | Estado |
|---|---|---|---|---|---|---|
| 008 | Re-analizar actualiza el mismo viaje | P0: borrado de diario, equipaje y gastos | M | REL | no | FIXED_IN_BRANCH (`tripReanalysis.test.tsx`, 9) |
| 028 | Un solo viaje activo | Cada módulo habla de otro viaje | M | migración 2 | no | IN_PROGRESS: concierge FIXED_IN_BRANCH (`iatoEvals` E-01 a E-04); Dashboard, Cercanos, Gastos y Fixer: OPEN |
| ATRIG | Prueba SQL de los triggers de `active_trip_id` | Hoy no hay un archivo de prueba | S | — | no | OPEN |
| 081 | Reservas reales contra clics; estados Pagado y Pendiente | "Mis reservas" contaba clics como reservas | M | migración 7 | no | IN_PROGRESS: separación FIXED_IN_BRANCH (`reservas.test.tsx`); flujo Pagado/Pendiente OPEN |
| 100 | Modo offline y bóveda de documentos | En el aeropuerto sin red | L | — | no | IN_PROGRESS: offline FIXED_IN_BRANCH (`serviceWorker.test.ts`); bóveda OPEN (diseño en la arquitectura, sección 3.5) |
| 102 | Herramientas conectadas al viaje activo | Coherencia | M | 028 | no | OPEN |
| CACHE | Caché compartida de SerpApi (`serp_cache`) | 20 a 40% menos búsquedas [SUPUESTO] | M | — | no | OPEN |
| USAGE | `ai_usage_log`: tokens, modelo y búsquedas por llamada | Sin esto no se puede medir el costo real | M | — | no | OPEN |
| 060, 094 | Herramientas en paralelo con límite de tiempo; contratos de herramientas | Latencia e higiene | S | REL | no | FIXED_IN_BRANCH (`iatoEvals` B-15, B-02) |
| 095 | Cobertura y robustez de `price-watch-cron` | Una alerta que falla ya no se queda al frente de la cola | S | — | no | IN_PROGRESS (`598c974`; sin prueba específica del orden de la cola) |
| 101 | Módulos duplicados y código muerto | Mantenimiento | M | — | no | OPEN |
| 110 | Robustez de `nightlife-discover` y `evaluar-logros` | Fallas | S | — | no | IN_PROGRESS: `nightlife-discover` revivido (`claudeCall.test.ts`); `evaluar-logros` OPEN |

### Fase D · Experiencia (flujos centrales, móvil, accesibilidad)

| ID(s) | Qué | Por qué | Esf. | Depende de | Dueño | Estado |
|---|---|---|---|---|---|---|
| 005 | Bucle del onboarding | P0: el usuario nuevo se queda atorado | S | REL | no | FIXED_IN_BRANCH (`onboardingRedirect.test.tsx`); en un teléfono real: NO VERIFICADO |
| 090 | "Saltar por ahora" en cada paso | El onboarding bloqueaba el valor | S | REL | no | FIXED_IN_BRANCH (`onboardingSkip.test.tsx`) |
| 006, 023, 025, 061 | Iato recibe datos válidos; dibuja tarjetas de vuelo, hotel y atracción; jet y equipaje sin precio inventado; transporte con su propio enlace | La estrella del producto estaba coja | M | REL | no | FIXED_IN_BRANCH (`conciergeTools`, `conciergeCards`, `iatoEvals`) |
| 059 | Memoria de Iato visible y borrable, con tope | Privacidad y costo | S | REL | no | FIXED_IN_BRANCH (parcial: `iatoEvals` E-19; que el historial se cargue: NO VERIFICADO) |
| 030 | Fixer: prometer solo lo que existe | "24/7 por WhatsApp" sin respaldo | S | DEC-01 | **sí** (horario y canal) | IN_PROGRESS: el prompt y `planCopy` dicen "sujeto a disponibilidad"; el estado del correo se guarda (`conciergeCards.test.tsx`); `src/components/FixerButton.tsx:222` aún dice "Te contactará … en minutos" |
| 041 | Recuperación de contraseña | Flujo bloqueado | S | REL | no | FIXED_IN_BRANCH (`resetPassword.test.tsx`) |
| 042 | Atrás no vuelve a analizar ni duplica | Viajes duplicados y gasto | S | REL | no | FIXED_IN_BRANCH (`planTripBack.test.tsx`) |
| 039 | Botones de afiliado en iOS | 32 botones bloqueados en Safari | S | REL | no | FIXED_IN_BRANCH (`trackBooking.test.ts`); en un iPhone real: NO VERIFICADO |
| 087 | Navegación móvil de 5 elementos y compositor visible | Elementos encimados | S | REL | no | FIXED_IN_BRANCH (`bottomNav.test.tsx`); en un dispositivo: NO VERIFICADO |
| 088 | Accesibilidad: etiquetas, nombres y zoom | WCAG | S | REL | no | FIXED_IN_BRANCH (parcial: `formLabels.test.tsx`, `cookieConsent.test.tsx` zoom) |
| 113 | Avatar: galería o cámara | Obligaba a usar la cámara | S | REL | no | FIXED_IN_BRANCH (`avatarCreator.test.tsx`, 3); en dispositivos: NO VERIFICADO |
| 085 | Mis viajes: estado de carga y no mostrar un falso "eliminado" | Confusión | S | REL | no | FIXED_IN_BRANCH (`tripsPage.test.tsx`) |
| 097 | Campana de notificaciones | Conteo falso | S | REL | no | FIXED_IN_BRANCH (`notificationBell.test.tsx`) |
| 089 | Textos que prometían funciones inexistentes | Confianza | S | REL | no | FIXED_IN_BRANCH (`ad78b5d`; `planCopy.test.ts`). **Ver G-1:** el texto nuevo de la prueba es a su vez una promesa sin respaldo en esta rama |
| 083, 084, 086, 103, 104, 105 | *Deep link* del login, cierre de sesión a los 4.5 s, controles falsos en Inicio, rendimiento, doble envío, "Volver" que sale de la app | Pulido de flujos | M | — | no | OPEN (104: parcial, porque PlanTrip y Onboarding ya bloquean el doble envío) |
| N-01 | Cercanos se cae a veces: `window.google.maps.Map is not a constructor` (`IATOS_E2E_EVIDENCE.md`, sección 9.1) | Pantalla de error intermitente en PROD y en la rama | S | — | no | OPEN |
| N-02, N-05 | `/dashboard/pro` se queda en spinner a veces (rama); las respuestas de Iato muestran Markdown sin interpretar | Pulido | S | — | no | OPEN |
| N-04, N-08 | Docenas de `buscar-video` por carga con 429; `parsear-viaje` se llama 2 veces por cada `?q=` | Costo y rendimiento (relacionado con 103) | S | — | no | OPEN |
| N-09 | Posible regresión en `f4c4c72`: PlanTrip con `?q=` y sin cuota no muestra nada | Flujo de conversión | S | — | no | OPEN (compuerta G-2) |

### Fase E · Comercial (cobrar bien)

| ID(s) | Qué | Por qué | Esf. | Depende de | Dueño | Estado |
|---|---|---|---|---|---|---|
| 018, 020 | No abrir una segunda suscripción; prueba de Stripe una sola vez | Doble cobro; prueba infinita | S | REL | no | FIXED_IN_BRANCH (`stripeCheckout.test.ts`, 12) |
| 019, 045 | El webhook reintenta ante errores de la base; eventos en orden; `invoice.paid` | Un pago sin PRO | M | migración 1 | no | FIXED_IN_BRANCH (`stripeWebhook.test.ts`; SQL `payments.sql` S1-S8) |
| 046, 055 (parte) | La cortesía no pisa un pago; la cortesía exige correo confirmado | Conflictos de estado | S | migración 1 | no (055, configuración de Auth: **sí**) | FIXED_IN_BRANCH (SQL `payments.sql` S6, C1-C3) |
| 092 | Cuota de análisis atómica | Dos análisis gratis en paralelo | S | migración 1 | no | FIXED_IN_BRANCH (SQL `payments/run.sh` concurrencia) |
| 021, 047 | El multidestino consume cuota; se valida antes de consumir; solo se cobra un resultado válido y guardado | Evadir la cuota; gastarla con una petición inválida | S | REL, migraciones 8-11 | no | FIXED_IN_BRANCH (`quota.test.ts`, `reservation.test.ts`; sin prueba del *handler* completo) |
| 022, 111 | Un 402 legible; diálogo "Conocer IATOS PRO / Continuar gratis"; código estable `FREE_LIMIT_REACHED`; las fallas técnicas no invitan a pagar | El usuario veía un error técnico | M | REL, migraciones 8-11 | no | FIXED_IN_BRANCH (`functionErrors.test.ts` 13, `freeLimitDialog.test.tsx` 3, `quota.test.ts` 10; SQL `quota_reservations.sql` F1-F10). En un dispositivo real: NO VERIFICADO |
| 112 | Reservar, confirmar y liberar: un análisis o un mensaje fallido no gasta la cuota gratuita | El usuario pierde su única oportunidad | L | migraciones 8-11 | no | FIXED_IN_BRANCH (`reservation.test.ts` 17, `requestKey.test.ts` 5; SQL `quota_reservations.sql` R1-R12, M1-M4 y concurrencia de `reserve_quota`). Los consumos ya registrados: diagnóstico de solo lectura en `docs/ops/diagnostico-cuotas.sql` (no se ha corrido en producción; según `IATOS_E2E_EVIDENCE.md`, sección 11, la única cuenta con consumos es la de prueba FREE A: 3 mensajes y 1 análisis exitoso) |
| 013, 014 (DEC-01) | Límites por plan en el servidor (`plan_limits`, `pro_limits_enforced`) | Beneficios PRO abiertos a cualquiera; costo sin control | L | 112 | **sí** (aprobar los valores y encender) | IN_PROGRESS: tabla, interruptor y límites de mensajes y análisis en la rama y apagados (SQL `plan_limits.sql` P1-P7, `plan_limits_recommended.sql` L1-L7); los topes de alertas, vuelos y búsquedas en vivo solo están sembrados; la protección de Members, bóveda y logística (013) sigue OPEN |
| 012 (DEC-02) | Prueba de 30 días sin tarjeta y sin cobro automático (`trial_grants`, `trial_no_card_enabled`) | Lo que decidió el dueño | L | 013, 034, 015, ABUSO | **sí** (GO para encenderla) | IN_PROGRESS: lógica en la rama y apagada (SQL `trial_no_card.sql` T1-T8; `stripeCheckout.test.ts` DEC-02); textos FIXED_IN_BRANCH (`planCopy.test.ts`) **por delante del comportamiento** (G-1); faltan los correos de los días 0, 23, 28 y 30 y el proceso nocturno de fin de prueba |
| ABUSO | Controles contra abuso: Turnstile, correos desechables, velocidad por IP o dispositivo, consultas de detección | Costo de la prueba sin tarjeta | M | 012 | **sí** | IN_PROGRESS: una prueba por correo normalizado con hash, que sobrevive al borrar la cuenta (T3/T4); Turnstile, correos desechables, velocidad y detección siguen OPEN |
| 011 | Stripe en modo real, `tax_behavior: inclusive` y una compra real reembolsada | Hoy no se puede cobrar | S | REL | **sí** | BLOCKED |
| 049 | Reembolsos y disputas | Acceso tras un reembolso | M | 011 | **sí** | BLOCKED |
| 050 | Borrar la cuenta sin que lo bloquee el estado de facturación | Derecho de borrado | S | — | no | OPEN |
| 056 | Rastreadores solo con consentimiento | LFPDPPP | S | REL | no (revisión legal: **sí**) | FIXED_IN_BRANCH (`cookieConsent.test.tsx`) |
| 077 | Atribución de afiliados `tp.media` | Comisiones | S | panel de Travelpayouts | **sí** | BLOCKED |
| 093 | README y textos de pago coherentes | Coherencia | S | — | no | FIXED_IN_BRANCH (`94d3733`, `d550aac`; `planCopy.test.ts`) |
| 015, CACHE, cadencia | Plan de SerpApi, caché compartida y nueva frecuencia de vuelos **antes** de encender la prueba | Si no, la bolsa se acaba en días | M | — | **sí** (plan de SerpApi) | OPEN / BLOCKED |

---

## 3. Hoja de ruta técnica a 30, 60 y 90 días

Las fechas son relativas al GO de la liberación. Las estimaciones son [SUPUESTO] para un ingeniero con el contexto de estos documentos.

### Días 0 a 30: liberar y estabilizar

1. G-0, G-1 y G-2; migraciones 1 a 11; despliegue de las 48 funciones; frontend; lista V1 a V21. **Meta:** todo lo FIXED_IN_BRANCH pasa a DONE_VERIFIED_PROD.
2. Desbloqueos del dueño: dominio de Resend (034), plan de SerpApi (015), registro de migraciones (072) y el secreto `HEALTH_ALERT_EMAIL`.
3. CI con Vitest y las 4 suites SQL.
4. Verificar en vivo las reservas de cuota (V7, V19, V20) con los interruptores **apagados**. Correr `docs/ops/diagnostico-cuotas.sql` (solo lectura) y decidir si hace falta la reparación propuesta.
5. Cerrar 052, 053 y 054, y `clientIp` (048).
6. `ai_usage_log` (USAGE), para medir antes de encender límites o la prueba.

### Días 31 a 60: precisión, expediente y costo

1. Encender `pro_limits_enforced` con los valores que apruebe el dueño (DEC-01), después de dos semanas de datos de `ai_usage_log`.
2. Caché compartida de SerpApi, caché de 24 h en `serpapi-quote` y la nueva frecuencia de seguimiento de vuelos.
3. Aplicar los topes de `price_watches`, `tracked_flights` y `live_searches` en las funciones.
4. Viaje activo en Dashboard, Cercanos, Gastos y Fixer (028); un solo vocabulario de procedencia.
5. Stripe en modo real con una compra de prueba reembolsada (011); política de reembolsos (049).
6. Verificar en dispositivos reales: iPhone Safari y Android Chrome (V12 a V14).

### Días 61 a 90: comercial y experiencia

1. Prueba sin tarjeta: controles contra abuso (Turnstile, correos desechables, velocidad), correos de los días 0, 23, 28 y 30, y las 30 pruebas de aceptación de la propuesta. Encender `trial_no_card_enabled` solo con el GO del dueño.
2. Bóveda de documentos del viaje (100) y estados Pagado/Pendiente (081).
3. Pulido P2 y P3 restante (083 a 086, 099, 101 a 110).
4. Si el dueño lo aprueba: diseño detallado del módulo México receptivo (arquitectura, sección 9), empezando por i18n.

---

## 4. Decisiones del dueño pendientes (resumen)

| # | Decisión | Bloquea |
|---|---|---|
| D1 | G-1: qué textos comerciales se publican con la liberación | Publicar el frontend |
| D2 | GO para cada migración (1 a 7) | Paso a) |
| D3 | Registrar las migraciones en `schema_migrations` | IATOS-072 |
| D4 | Plan de SerpApi | IATOS-015, la prueba sin tarjeta |
| D5 | DNS de Resend | IATOS-034, la prueba sin tarjeta (empieza al confirmar el correo) |
| D6 | Valores finales de `plan_limits` y cuándo encender `pro_limits_enforced` | IATOS-013, 014 |
| D7 | Cuándo encender `trial_no_card_enabled` | IATOS-012 |
| D8 | Stripe en modo real, IVA incluido y fecha | IATOS-011 |
| D9 | Horario y canal del Fixer | IATOS-030 |
| D11 | G-3: exigir la confirmación de correo en Supabase Auth antes de encender la prueba sin tarjeta | IATOS-012, 055 |
| D10 | Reembolsos, revisión legal de cookies, configuración de Auth (confirmar el correo), programas de Travelpayouts | 049, 056, 055, 077 |
