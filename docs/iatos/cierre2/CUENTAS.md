# Cierre de la segunda auditoría · grupo `cuentas` (22-oct-2026)

- **Rama:** `claude/r2-cuentas` (worktree `/home/user/wt-r2-cuentas`). Base `origin/main` = `3db952a`.
- **Fuentes:** `segunda_auditoria/INFORME_pagos.md` e `INFORME_prive.md`. Pruebas del auditor copiadas y convertidas en regresión:
  - `supabase/tests/payments/aud2_pagos_adversarial.sql`
  - `supabase/tests/prive/aud2_prive.sql`
  - `supabase/tests/prive/aud2_sweep.sql`
- **Pruebas nuevas propias:**
  - SQL: `supabase/tests/payments/r2_cuentas.sql` (RC*) y `supabase/tests/prive/r2_cuentas_prive.sql` (RP*).
  - Vitest: `stripeTrialFingerprint`, `stripeCheckoutFlow`, `stripeAdminAlert`, `stripeInvoiceLookup`, `stripeMissingRpc` y `stripePauseCollection` (`src/test/*.test.ts`).
- **No se tocó:** producción, Stripe, Supabase Auth, secretos ni correos. Todo se probó en Postgres 16 local (`/tmp/pgsec:55440`, bases `r2cuentas_*`, ya borradas) y con Vitest.

## 1. Tabla de hallazgos

| ID | Sev | Prueba (falla antes / pasa después) | Corrección (archivo:línea, commit) | Mutación | Estado |
|---|---|---|---|---|---|
| N-01 / D-P2-1 | P2 | `aud2_pagos_adversarial.sql` **X10, X11**; `r2_cuentas.sql` **RC3a, RC3b, RC4**: FALLA en `3db952a` (`status=comped plan=pro`) / OK. RC1, RC2, RC5 y RC6 (confirmar con el enlace, OAuth, cortesía existente, cambio de correo y luego confirmación) pasan antes y después. | `20261026130000_r2_cuentas_comp_grant_email_proof.sql`: regla `auth_email_proven_parts` :36, `auth_email_changes` :27 y su trigger :77, `has_comp_grant` :82, `apply_comp_grant` :99 (trigger :129, también AFTER UPDATE OF `email_confirmed_at`), `apply_comp_grants_now` :135. Commit `cea9a6b`. | Sin la regla de 10 s → X10, RC3a, RC3b FALLA. Sin revisar el cambio de correo → RC4 FALLA. | CORREGIDO en la base. Requiere autorización. Además, **"Confirm email" ON** en Auth (dueño). |
| N-02 / P2-1 | P2 | `aud2_prive.sql` **N02-A, N02-C**; `r2_cuentas_prive.sql` **RP1a, RP1b, RP5, RP6, RP7** (RP7 = el ataque "le basta pagar PRO"): FALLA antes / OK. N02-B también pasa ya con N-01 solo. Vitest `priveInvitation.test.tsx` "N-02…": × antes / ✓. | `20261026140000_r2_cuentas_prive_grant_email_link.sql`: `apply_prive_grant` :30 (trigger :58), `prive_accept_invitation` :63, bloque `INVITATION_LINK_REQUIRED` :100-103. Cliente: `src/pages/prive/PriveInvitation.tsx:123,143,359`, `src/lib/priveI18n.ts`, `src/lib/priveApi.ts`. Commit `074eda9`. | Sin el token → RP1a, RP1b, RP6, RP7. Ligar sin confirmar → N02-A, RP5. Ligar en el cambio de correo (sin las dos defensas) → N02-C, RP6. | CORREGIDO. Requiere autorización (migración y frontend). |
| D-P2-2 | P2 | `stripeTrialFingerprint.test.ts`: 10 de 11 × con el código anterior / 11 ✓. Incluye "(caso del auditor) una cuenta NUEVA con la misma tarjeta…". `r2_cuentas.sql` RC10–RC14: ERROR antes (no existe `claim_trial_fingerprint`) / OK. | `20261026150000_r2_cuentas_trial_card_fingerprint.sql` (tabla :23, `claim_trial_fingerprint` :35). `stripe-checkout/logic.ts:146-165`. `stripe-webhook/handler.ts:106` (`enforceCardTrialOnce`) y `:135` (`cardFingerprintFrom`). `stripe-webhook/index.ts` (dependencias). Commit `e1b2bc9`. | "Siempre primera prueba" → 2 × (caso del auditor y `subscription.created`). | CORREGIDO en código. **PENDIENTE** contra Stripe real (§3). |
| AUD-08 M3b | — | `stripeCheckoutFlow.test.ts` (11): antes no había `flow.ts` y quitar el `if` no rompía nada (M3b sobrevivía) / 11 ✓. | `stripe-checkout/flow.ts:57` (el 503 vive en `runCheckout`). `index.ts` solo conecta dependencias. Commit `a0f3f70`. | `if (false && problems.length)` → **7 ×**. | CORREGIDO. |
| N-04 / D-P3-6 | P3 | `planCopy.test.ts`: 4 × antes / 15 ✓. Prohíbe `sin límite(s)`, `ilimitad` y `unlimited` en los archivos comerciales y en **todo** texto que exporta `planCopy`. | `src/lib/planCopy.ts:52` (`freeUsageLines`, `FREE_CONCIERGE_LINE`, `FREE_TRIP_LINE`). `src/pages/Pro.tsx:91,95`. `src/pages/Legal.tsx`: "sin límite de tiempo" → "sin importar cuándo lo detectes". Commit `fd2b36e`. | Volver a poner "Mensajes sin límite" en `Pro.tsx` → 1 ×. | CORREGIDO. La descripción del producto en Stripe ("sin límites") la cambia el dueño. |
| D-P3-3 | P3 | `aud2_pagos_adversarial.sql` **X09** (ahora con el contrato −1): FALLA antes (`notify_admins=0`) / OK. `stripeAdminAlert.test.ts` (9) / ✓. | `20261026160000_r2_cuentas_notify_admins_no_recipients.sql:13` (−1 sin administradores). `stripe-webhook/alerts.ts:28` (`deliverAdminAlert`). `payments.ts:243` y `handler.ts:242` (`alertDelivered`). Commit `6efdf05`. | Volver a `alertStatus === "fallido"` → 1 × (disputa con `sin_destinatarios` → 200). | CORREGIDO. Requiere autorización (migración y función). |
| D-P3-4 | P3 | `stripeInvoiceLookup.test.ts` (9): reembolso total con la factura no localizable → 500, sin revocar ni registrar. | `stripe-webhook/lookups.ts:26` (lanza ante HTTP no-OK; `null` solo con 200 y sin factura). `index.ts` la usa. Commits `65d0c49` y `0cb9e3e`. | Volver a `return null` → 6 ×. | CORREGIDO. |
| D-P3-5 | P3 | `stripeMissingRpc.test.ts` (11): 8 × antes / ✓. Incluye los 3 casos del auditor más tabla 42P01, 42883 de otra función, PGRST202 de otra función y mensaje sin código. | `_shared/prive-tenure.ts:128` (`isMissingFunctionError`: solo PGRST202 o 42883 de la función llamada). La usan `missingRpcAsSkip`, la ruta anterior de `stripe_commit_payment_event` e `is_deleted_stripe_customer` (`stripe-webhook/index.ts`). Commit `08f2a74`. | La prueba "antes" es la mutación (regex amplia) → 8 ×. | CORREGIDO. **Fuera de alcance:** `price-watch-cron/index.ts:39` tiene la misma regex amplia. |
| D-P3-1 / N-06 | P3 | **X01, X02, X13**; `r2_cuentas.sql` **RC21, RC22, RC25, RC27**: FALLA antes / OK. RC20, RC23, RC24 y RC26 (MXN vigente, lista vacía, cortesía, prueba sin tarjeta, PRO dado a mano) OK. `stripePauseCollection.test.ts` (6) ✓. `plan_limits_recommended.sql` L1 actualizada (afirmaba que `active` sin fecha seguía siendo PRO). | `20261026170000_r2_cuentas_is_pro_price_period.sql`: `stripe_pro_prices` :32, `pro_price_ok` :41, conversión del PRO dado a mano a `comped` :50-58, `is_pro` :61, `prive_tenure_days` :83. `handler.ts:162` (`effectiveStatus`: `pause_collection` → `paused`) y `payments.ts:307`. Commit `78f657b`. | Sin exigir fecha de fin → X02, RC25. Sin revisar precio/moneda → X01, RC21, RC22. Antigüedad de cualquier monto → X13, RC27. | CORREGIDO. Requiere autorización. Impacto en §4. |
| P3-1 (Privé, R06) | P3 | `aud_session.sql` **R06** reescrita: con la mutación M8 (sin `AND user_id = _user` en `prive_remember_session`) la R06 vieja pasaba (140/0 del auditor); la nueva FALLA. Sin M8: OK. | `supabase/tests/prive/aud_session.sql:448-464`: la cuenta 1 (con derecho vigente, `prive_access_code` NULL) intenta recordar sesiones recién abiertas de la 12. Una de ellas está ligada a una sesión de Auth viva de la propia cuenta 1, así que solo la protege el filtro por `user_id`. Commit `d4387a2`. | M8 → R06 FALLA. | CORREGIDO (prueba). |
| P3-4 (Privé, barrido) | P3 | `aud2_sweep.sql` (del auditor, ahora con OK/FALLA): **SW1** FALLA antes ("cerró 3/3") / OK (0 cerradas, `auth_check=skipped_auth_unreadable`). SW1b: `prive_require` niega mientras tanto. SW2: con el esquema sano sigue cerrando la sesión cuya sesión de Auth terminó. | `20261026180000_r2_cuentas_prive_sweep_schema_probe.sql`: `prive_auth_session_lookup` :20, `prive_auth_session_alive` :37, `prive_auth_sessions_checkable` :55, `prive_sweep` :67 (prueba previa :96). Commits `4e3550b` y `b652f98` (la suite vuelve a aplicar las migraciones r2 después de que `aud_session.sql` hace `\ir` de las 20261024). | `checkable()` → `true` → SW1 FALLA. | CORREGIDO. Requiere autorización. |
| P3-5 (Privé, fuerza bruta) | P3 | `r2_cuentas_prive.sql` **RP10** (C6d: 14 fallos por día durante 3 días): FALLA antes (`hard_locked=false failed_count=14`) / OK. RP11 (con una entrada correcta en medio no acumula) y RP12 (solo el restablecimiento quita el bloqueo total) OK. | `20261026190000_r2_cuentas_prive_failure_counter.sql:29` (`v_n := c.failed_count + 1`, sin reinicio a las 24 h). Commit `c2fe374`. | La prueba "antes" es la mutación → RP10 FALLA. | CORREGIDO (se eligió corregir, no documentar). Sin `PRIVE_IP_SALT` sigue sin haber límite por IP: es un secreto (BLOQUEADO, dueño). |

**Conteos:** 12 hallazgos atendidos: 3 P2, 8 P3 y AUD-08 M3b. Los 12 están CORREGIDOS en código. Uno queda **PENDIENTE de verificación contra Stripe real** (D-P2-2) y ninguno quedó **BLOQUEADO** dentro del alcance. 15 commits (14 de código y pruebas, más este documento).

## 2. Resultados de las suites (rama, después de todos los commits)

| Suite | Base `3db952a` | Rama `claude/r2-cuentas` |
|---|---|---|
| `payments/run.sh` | 88 OK, 0 FALLA | **121 OK, 0 FALLA**, 2 PENDIENTE (X04 y X05 = D-P3-2, doble suscripción: no es de esta ronda) |
| `cost/run.sh` | 16 OK + 3 "ok" | 16 OK + 3 "ok", 0 FALLA |
| `prive/run.sh` | 140 OK | **182 OK, 0 FALLA** (incluye aud2_prive.sql, r2_cuentas_prive.sql y aud2_sweep.sql) |
| `security/run.sh` | 156 OK (+ "permission denied" esperados) | Salida idéntica a la base (`diff` vacío salvo el nombre de la base) |
| `prive_catalog`, `prive_key`, `privevalor`, `edition` | — | 110, 47, 144 y 47 OK, 0 FALLA |
| `members_more`, `ai_reservations`, `boveda`, `bridge`, `concierge2`, `ops`, `social`, `avatar` | 30/57/50/42/7/0/70/41 OK | Iguales a la base (solo cambian fechas y rutas) |
| Vitest stripe, pagos, cuotas y Privé (50 archivos) | — | 793 ✓, **1 ×** (ya fallaba en la base: `priveUx.test.tsx` "sin texto en inglés", texto "YOUR WORLD IS READY"; no es de este grupo) |
| Vitest completo (`--testTimeout=60000`) | — | 210 archivos: **2318 ✓, 1 ×** (la misma `priveUx`) |
| `tsc --noEmit -p tsconfig.app.json` | — | 0 errores |
| `npm run build` | — | OK |
| `deno check` de stripe-webhook, stripe-checkout, stripe-portal, health-check y prive-access | — | **5/5 rc=0** |

Notas:
- **deno:** se usó `--no-lock`. El `deno.lock` de `origin/main` es versión 5 y Deno 2.1 no lo lee: "Unsupported lockfile version '5'". `deno.lock` quedó sin tocar.
- **Tipos de Stripe:** en este entorno los tipos del SDK (esm.sh `stripe@17.7.0`) resuelven como `any`. Una sonda con `proration_behavior: "valor_invalido"` también pasa, así que `deno check` no verifica las llamadas a Stripe; eso queda PENDIENTE contra Stripe real.

## 3. D-P2-2 con Stripe Checkout: cómo funciona y qué queda PENDIENTE

Checkout no expone la tarjeta al crear la sesión, así que la revisión no puede hacerse en `planCheckout`. La prueba del auditor `planCheckout(null, …)` no puede pasar por diseño; se reescribió como un escenario de dos cuentas por el webhook. El flujo queda así:

1. **Checkout con prueba.** `stripe-checkout` crea la sesión con:
   - `payment_method_collection: "always"`;
   - `payment_method_types: ["card"]`, para que siempre exista `card.fingerprint` (Link no la tiene);
   - `subscription_data.metadata.iatos_trial = "card"`.
   Sin prueba, la sesión no cambia.
2. **Revisión en el webhook.** `checkout.session.completed` y `customer.subscription.created|updated` de una suscripción `trialing` marcada pasan por estos pasos:
   - Se lee la huella: primero `subscription.default_payment_method`; si falta, `customer.invoice_settings.default_payment_method`. Luego `paymentMethods.retrieve(pm).card.fingerprint`.
   - La huella se reclama en `stripe_trial_fingerprints` con `claim_trial_fingerprint`.
   - Si es la primera vez de esa tarjeta, o es la misma suscripción porque el evento se reintentó, la prueba sigue.
   - Si la tarjeta ya tuvo prueba en otra suscripción, el webhook llama `subscriptions.update(id, {trial_end: "now", proration_behavior: "none"})`: Stripe cobra el primer mes en ese momento. Luego relee la suscripción y escribe el estado real (`active`, o `past_due`/`incomplete` sin PRO si el cobro falla).
3. **Casos límite.**
   - Sin huella todavía (el evento llegó antes de que Stripe guardara la tarjeta): la prueba no se toca y el siguiente evento de la misma suscripción vuelve a revisar.
   - Error al reclamar: 500, y Stripe reintenta.
   - Prueba marcada sin las dependencias configuradas: 500 (falla cerrado).
4. **Privacidad.** La huella es un identificador opaco de Stripe, por cuenta de Stripe. No se guarda la cuenta de IATOS: solo la suscripción y el cliente de Stripe.
5. **Textos.** `planCopy.trialCopy("card")` ahora dice: "una por persona y por tarjeta; si la tarjeta ya tuvo una prueba… el primer cargo se hace al contratar".

**PENDIENTE (requiere Stripe real en modo prueba; no se pudo probar aquí):**
- que Checkout deje `default_payment_method` en la suscripción, o en el cliente, al completar una sesión con prueba;
- que `trial_end: "now"` cobre de inmediato y emita `invoice.paid`;
- el orden real de los eventos;
- que una tarjeta de Apple Pay o Google Pay tenga una huella estable (puede ser distinta a la de la tarjeta física: es una limitación conocida).

**Ensayo propuesto:** dos cuentas de prueba, la misma tarjeta 4242 y dos checkouts. La segunda cuenta debe quedar `active` con un cargo de $99 y `trial=tarjeta_ya_tuvo_prueba_cobro_inmediato` en la respuesta del webhook.

**Otros pendientes de D-P2-2:**
- Las pruebas anteriores a este cambio no están en la tabla. Un respaldo que lea en Stripe las suscripciones con `trial_start` y guarde sus huellas también requiere Stripe real.
- La recomendación del auditor de dar a la prueba con tarjeta los topes de `trial` (o encender `pro_limits_enforced`) es decisión del dueño.

## 4. Impacto revisado en cuentas existentes (producción)

- **El dueño (cuenta vonhaucke) y su hermana: siguen igual.**
  - Su `comped` no cambia: `is_pro` sigue dando PRO a `comped` y ninguna migración toca esas filas.
  - Sus membresías Privé activas siguen activas: `prive_accept_invitation` responde `already` antes de mirar el token, y `prive_require` y `prive_access_code` no cambian.
  - Las invitaciones ya aceptadas siguen valiendo (RP2 lo prueba con una cuenta `comped` + concesión + membresía activa).
- **Invitaciones por concesión pendientes** (por ejemplo, Carlo `f98a7188` y, si aún no aceptó, Sofía `999f1e1a` según `FASE0_ESTADO.md`):
  - desde la app ya no se aceptan sin el enlace del correo; ven "Ábrela desde tu correo";
  - el enlace que ya recibieron sirve mientras no venza;
  - si venció o lo perdieron, "Enviarme una nueva" manda otro.
- **Cortesía nueva por correo:**
  - mientras Auth tenga `mailer_autoconfirm=true`, un registro con correo y contraseña NO recibe la cortesía automática (no hay forma de saber si es el dueño del buzón);
  - sí la reciben quien confirma con el enlace (≥ 10 s después del registro) y quien entra con Google o Apple;
  - un cambio de correo nunca la da;
  - `apply_comp_grants_now()` reporta "NO aplicado: el correo no está comprobado…" para que el dueño verifique y la dé a mano.
- **Concesión Privé nueva por correo:**
  - se liga con el correo confirmado;
  - con un cambio de correo no se liga; el dueño la liga con `admin_grant_prive` (RP6).
- **`is_pro`:**
  - **Cuenta sintética de prueba de Stripe (B, `iatos-e2e-…`):** Adaptive Pricing la cobró en USD (`R10-STRIPE-05`), así que su fila es `currency='USD'` y **deja de ser PRO**. Es lo correcto (no pagó la oferta de $99 MXN). Para ensayos que requieran PRO hay que hacer un checkout nuevo: el checkout ya fuerza MXN y apaga Adaptive Pricing.
  - Filas `active` de Stripe sin `current_period_end`: dejan de ser PRO hasta el siguiente evento de Stripe (que trae el periodo).
  - Filas `active` **sin** Stripe y sin fecha (PRO dado a mano): la migración las pasa a `comped` y conservan el PRO (RC26). El `NOTICE` de la migración dice cuántas fueron.
  - `stripe_pro_prices` nace vacía: con la tabla vacía solo se exige MXN. Cuando el dueño registre `price_…` live (y el de prueba, si sigue ensayando), solo esos cuentan. Las filas con `price_id` NULL dejarían de ser PRO hasta su siguiente evento.
  - El webhook escribe `paused` cuando Stripe tiene `pause_collection`: pausar el cobro desde el panel quita PRO. Para regalar PRO se usa `comp_grants`.
- **Antigüedad Privé:**
  - solo suman periodos en MXN de al menos $99.00;
  - un mes pagado con cupón por debajo de $99 no suma días (decisión documentada; se cambia en `prive_tenure_days`);
  - hoy no hay periodos pagados reales: Stripe está en modo prueba.

## 5. Qué requiere autorización para producción

Ninguna se aplicó ni se desplegó.

**Migraciones** (en este orden; todas idempotentes; HHMMSS válidos):
1. `20261026130000_r2_cuentas_comp_grant_email_proof.sql`
2. `20261026140000_r2_cuentas_prive_grant_email_link.sql` (depende de la 1)
3. `20261026150000_r2_cuentas_trial_card_fingerprint.sql`
4. `20261026160000_r2_cuentas_notify_admins_no_recipients.sql`
5. `20261026170000_r2_cuentas_is_pro_price_period.sql`. Modifica datos: el PRO dado a mano pasa a `comped`.
6. `20261026180000_r2_cuentas_prive_sweep_schema_probe.sql`
7. `20261026190000_r2_cuentas_prive_failure_counter.sql`

**Funciones Edge:**
- `stripe-webhook` (huella de tarjeta, avisos, factura, fallback, pausa): desplegarla **después** de las migraciones 3 y 4;
- `stripe-checkout` (`flow.ts` y la marca de prueba);
- `prive-access` no cambia de código (pasa el nuevo código `INVITATION_LINK_REQUIRED` tal cual).

**Frontend:**
- `PriveInvitation.tsx`, `priveI18n.ts`, `priveApi.ts`;
- `Pro.tsx`, `planCopy.ts`, `Legal.tsx`.

**Configuración (dueño):**
- Supabase Auth → "Confirm email" ON (N-01 de fondo);
- registrar los `price_id` de PRO en `stripe_pro_prices`;
- quitar "sin límites" de la descripción del producto en Stripe;
- al menos una fila en `admins` o `HEALTH_ALERT_EMAIL` (D-P3-3);
- `PRIVE_IP_SALT` (P3-5, límite por IP).

**Coordinación:** los prefijos de hora `13`–`19` del 26-oct son de `cuentas`. Si otro grupo usó las mismas versiones, hay que renumerar antes de aplicar.

## 6. Cambios en pruebas existentes (no se debilitó ninguna)

- `payments.sql`, `trial_no_card.sql` y `security/round_b.sql`: las cuentas de los casos de cortesía ahora se crearon antes de confirmar el correo (`created_at` anterior, o confirmación 1 min después). Así simulan la confirmación con el enlace. Las aserciones no cambian.
- `prive.sql`:
  - P16 ahora afirma que el cambio de correo **no** liga la concesión y que volver a concederla sí;
  - las cuentas 13 y 16 (concesión sin antigüedad) aceptan con el token del correo (`pt.accept_link`).
- `plan_limits_recommended.sql` L1: `active` de Stripe sin fecha ya **no** es PRO. Antes afirmaba lo contrario, que es justo el defecto D-P3-1.
- `stripeCheckoutOffer.test.ts`: con prueba, la metadata incluye además `iatos_trial: "card"`.
- `aud2_prive.sql`:
  - NEW01-b acepta con el token del correo;
  - el token de N02-B se guarda con `coalesce` (sin token, `\gset` dejaba la variable sin definir).
- `aud2_pagos_adversarial.sql`:
  - DEFECTO → FALLA;
  - X04 y X05 (D-P3-2) imprimen PENDIENTE;
  - X09 prueba el contrato −1 sin administradores, dentro de una transacción.
- `payments/run.sh` y `prive/run.sh` vuelven a aplicar las migraciones r2 después de los pasos que reaplican migraciones viejas: la siembra 135300 y el `\ir` de `aud_session.sql`.

## 7. Fuera de alcance, observado

- **D-P3-2 (doble suscripción, X04 y X05):** sigue abierto. Las pruebas quedan como PENDIENTE.
- **`price-watch-cron/index.ts:39`:** tiene la misma regex amplia de "función inexistente" que D-P3-5.
- **Prueba sin tarjeta (`apply_no_card_trial`):** también confía en `email_confirmed_at`. Con autoconfirm, una prueba por correo inventado (interruptor apagado hoy).
- **`priveUx.test.tsx`:** falla ya en `origin/main` ("YOUR WORLD IS READY" en español).
- **Eventos con `livemode` o `account` distintos (vitest del auditor):** no se revisan en el handler. No es de esta ronda.
