# IATOS AI · Cierre de la auditoría independiente (paquete para la segunda auditoría)

| Dato | Valor |
|---|---|
| Fecha | 22-oct-2026 |
| Primera auditoría (ChatGPT) | ZIP del commit `06865cb`: **69/100, NO-GO para vender PRO**, hallazgos AUD-01…AUD-08 |
| Código de este cierre | rama `claude/cierre-auditoria`; base `591a71a` (= lo publicado hoy ~17:30 UTC) + el commit que agrega este documento |
| `main` en GitHub | `fa81580` = `591a71a` + `src/integrations/supabase/types.ts` y `deno.lock` regenerados por Lovable (sin cambios de lógica) |
| Producción | https://traveliatos.life, app `assets/index-CH2-FXCW.js`; Supabase con 113 migraciones registradas y 66 funciones Edge |
| Reportes de cada grupo | `docs/iatos/cierre/*.md`, `docs/iatos/prive_reimagined/*.md`, `docs/iatos/avatar/AVATAR_VIAJES.md`, `docs/iatos/IATOS_ENTREGABILIDAD_CORREO.md` |

Este documento resume los reportes de cada grupo. Cada fila apunta al reporte que tiene el detalle: archivo, línea, commit, prueba y salida antes/después. Lo que no se pudo comprobar dice **BLOQUEADO** o **PENDIENTE**, y nunca cuenta como aprobado.

---

## 1. Resumen ejecutivo y veredicto

**Veredicto: NO-GO para vender IATOS PRO al público.**

La razón es una sola y no es de código. Stripe sigue en **modo PRUEBA** y la certificación comercial (AUD-08) está **BLOQUEADA** hasta que el dueño haga los cambios en el panel de Stripe y firme las Fases 0–3 de `cierre/STRIPE_CERTIFICACION.md`. Mientras tanto, una protección del propio código impide cobrar mal: el checkout responde **503** porque el precio configurado no es MXN 9900 al mes con IVA incluido. Hoy no se puede cobrar un peso.

Lo que sí cambió desde la primera auditoría:

- **7 de los 8 hallazgos están VERIFICADOS.** Cada uno tiene una prueba que fallaba con el código auditado y pasa con el código nuevo, y ya está publicado en producción: 23 migraciones aplicadas hoy con checksum verificado y 66 funciones desplegadas. AUD-08 tiene el código corregido, pero la certificación queda BLOQUEADA en el dueño.
- **0 P0 y 0 P1 abiertos en código.** El único P1 que sigue abierto es AUD-08, y lo cierra el dueño en el panel.
- Los grupos encontraron **más de 70 hallazgos nuevos** más allá de AUD-01…08 (sección 3). Todos los P1 y P2 de código están corregidos con prueba. Los P3 y las decisiones de producto quedan listados.
- QA final sobre `591a71a`: `tsc` OK; Vitest 204 archivos y **2258/2258**; build OK; `deno check` 66/66; 16 suites SQL con **0 FALLA**.
- De los 20 módulos (sección 5), **14 tienen GO y 6 NO-GO**: auth, avatar, The Private Edition, reservas IA (apagada a propósito), pagos/Stripe y correo. Cinco de esos seis NO-GO dependen de una acción del dueño (panel, DNS, aprobación editorial o una prueba en vivo autorizada), no de código por escribir. El sexto, reservas IA, está apagado a propósito y además le falta una prueba con un correo real en un entorno de pruebas.

Calificación sugerida para la segunda auditoría: que la ponga el auditor. Aquí solo se afirma lo que tiene prueba o evidencia.

---

## 2. Hallazgos de la primera auditoría (AUD-01…AUD-08)

| ID | Severidad | Reproducido | Solución | Tests | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-01 · sesiones Privé que fallaban abiertas | P1 | `supabase/tests/prive/aud_session.sql` S01–S13 con JWT reales y `SET ROLE authenticated`. En `f62466e` fallaban 11 caminos: cuenta suspendida (`banned_until`) o borrada (`deleted_at`) entraba; si no se podía leer `auth.sessions`, o la tabla o la columna no existían, se **aceptaba**; `prive_unlock` sin `session_id`, o con uno ajeno, emitía sesión; una sesión sin ligar autorizaba las 12 RPC de contenido. Edge: 3 de 5 casos AUD-01 de `priveAccess.test.ts` fallaban | `supabase/migrations/20261024010000_aud_prive_session_fail_closed.sql`: `prive_auth_session_alive` falla cerrado, `prive_require` niega sesiones sin ligar y `prive_unlock` no emite sin sesión de Auth viva; barrido en `20261024020000`; `supabase/functions/prive-access/actions.ts` responde 401. Commits `6e5d15f`, `0457a2e` | `aud_session.sql`: 22 OK / 14 FALLA → **48/48**; `priveAccess.test.ts`: 3 FALLA → 38/38; suite `prive` final **140 OK** | `docs/iatos/cierre/evidencia_prive/aud_session_ANTES.txt`, `aud_session_DESPUES.txt`, `priveAccess_AUD01_ANTES.txt`; `cierre/PRIVE.md` | **VERIFICADO** (sub-caso "PRO terminado con sesión vieja": REFUTADO, ya se negaba) |
| AUD-02 · remitente de Reservas IA suplantable | P1 | `src/test/aiReservationsSenderAuth.test.ts` (30) + 6 de punta a punta en `aiReservationsService.test.ts`. Fallaban 12: SPF+DKIM con DMARC fail aceptado, `"reservas@casa.mx"@evil.test` leído como el restaurante, dominio padre y sufijo público aceptados, From del webhook distinto del correo descargado sin efecto | `_shared/ai-reservations/core.ts` (`bareAddress` estricto, `domainOf` con la última @, `senderAuthentication()`: DMARC pass alineado, o dirección exacta + DKIM pass sin DMARC fail, y SPF solo nunca cuenta); `service.ts` `inboundSenderVerdict()`; misma regla en SQL (`ai_res_sender_strong`). Commit `309ea2e` | 12 fallan → **36/36**; reservas Vitest 161/161 | `cierre/RESERVAS.md` (salidas antes/después) | **VERIFICADO** (función apagada en producción) |
| AUD-03 · confirmaciones ambiguas tomadas como reserva | P1 | `src/test/aiReservationsConfirmRules.test.ts`: las 10 frases del hallazgo en es/en/fr con el modelo simulado **mintiendo**, más 19 casos (hora inventada, otro día, depósito, alterno solo ofrecido…). Fallaban 46 de 49 | `_shared/ai-reservations/evidence.ts` (reglas deterministas es/en/fr); `classifier.ts` `decideReply()`: el modelo ya no decide; el folio y la solicitud citada quedan ligados. Commit `372ceda` | 46/49 fallan → **49/49** | `cierre/RESERVAS.md` | **VERIFICADO** |
| AUD-04 · salidas del Booking Bridge a destinos no comprobados | P2 | `src/test/bookingBridgeAudit.test.ts`, `bookingBridgeE2E.test.ts`, `externalLinks.test.ts`. Contra `f62466e`: 18 fallan / 7 pasan, y E2E 4 fallan. Casos: el token no estaba atado al destino firmado; un redirect opaco (`google.com/aclk`) quedaba firmado; un colaborador ponía phishing como "Sitio oficial"; la salida llevaba al destino de otra acción; `localhost.`, TLD falsos, rutas codificadas, saltos http en el cron | `_shared/booking/redirectToken.ts` (huella SHA-256 + nivel), `booking-go/go.ts`, `allowlist.ts` (`redirector`, `checkUntrusted`), `resolver.ts` (sitio "sin verificar"), `handler.ts`, `booking-links-cron/linkcheck.ts`, migración `20261024070000_aud_bridge_target_trace.sql`. Commits `fa42140`, `1132a3a` | Bridge Vitest **136/136**; SQL `bridge` 41 OK + 1 FALLA → **42/42** | `cierre/BRIDGE.md` (AUD-04a…k) | **VERIFICADO** |
| AUD-05 · Stripe atómico e idempotente | P2 | Mundo en memoria con las reglas del SQL + SQL real con dos transacciones (`pg_sleep`) y fallas inyectadas en cada dependencia. **Defectos reales:** un reembolso o disputa anterior al periodo pagado dejaba ese periodo `paid` y contaba para Privé (AP08–AP11 FALLA); carrera reembolso/`invoice.paid` (CC3 FALLA); disputa abierta después de cerrada; aviso de disputa fallido marcado como hecho; segunda suscripción viva cobrada en silencio | `supabase/migrations/20261024051500_aud_pagos_payment_event_atomic.sql` (`stripe_commit_payment_event` en una transacción, candado por factura, re-aplicación de decisiones previas); `stripe-webhook/payments.ts`, `handler.ts`, `index.ts`. Commit `3b66f27` (+ `fa99cbf`) | SQL `payments`: AP08–AP11, AP15, CC3, CC4 FALLA y AP13/14/16 ERROR → **88 OK, 0 FALLA**; Vitest de pagos 159/159 | `docs/iatos/cierre/evidencia/pagos/AUD-05_*`; `cierre/PAGOS.md` | **VERIFICADO** (sub-casos 05.1–05.3 y 05.9, de eventos repetidos, fuera de orden y ciclo de vida: REFUTADOS, ya eran correctos) |
| AUD-06 · evidencia insuficiente para confirmar una reserva | P2 | SQL R44–R57 en `supabase/tests/ai_reservations/ai_reservations.sql` + 4 de Vitest. Contra el esquema original, una "confirmación" con solo texto de IA quedaba `confirmed` (R45), con 9 FALLA y 4 sin ejecutar. Mismo Message-ID con otro `svix-id` procesado dos veces | Migración `20261024170000_aud_reservas_evidence.sql`: evidencia del proveedor sellada, hash único del Message-ID, decisiones y eventos de solo agregar, trigger que recalcula la regla en SQL; `service.ts` `inboundEvidence()`, `runtime.ts` `fetchRaw`. Commit `57b5f1e` | SQL **57/57**; Vitest AUD-06 4 fallan → 4/4 | `cierre/RESERVAS.md` | **VERIFICADO** |
| AUD-07 · dominio registrable y detección de phishing | P2 | Bloque "AUD-07" de `bookingBridgeAudit.test.ts`. "Últimas 2 etiquetas" fallaba con `ltd.uk`, `k12.ca.us`, `*.kawasaki.jp`, IDN y sufijos privados (`wixsite.com`, `github.io`). Falsos negativos (`b00king.com`, `aeromexic0.com`…) y falsos positivos (`fresyogurt.com`) | PSL fijada `_shared/booking/psl_data.ts` (VERSION 2026-10-20_08-40-56_UTC, con SHA-256), `_shared/booking/psl.ts` (algoritmo oficial), `scripts/booking/update_psl.mjs`; detector sobre la etiqueta registrable con sustituciones y distancia de edición. Commit `fa42140` | 7 ✗ / 1 ✓ → **8/8** (+1 de PSL fijada) | `cierre/BRIDGE.md` | **VERIFICADO** |
| AUD-08 · certificación comercial (GO contradictorio, precio sin revisar) | P1 | 08.1: `IATOS_ESTADO_FINAL.md` decía GO mientras Stripe estaba BLOQUEADO; lecturas públicas: modo prueba, `mailer_autoconfirm: true`, ninguna compra real reembolsada. 08.2: el checkout cobraba cualquier `STRIPE_PRICE_ID` (USD, IVA por fuera, anual) y con Adaptive Pricing cobró en USD (`stripeCheckoutOffer.test.ts`, 18 casos) | Veredicto corregido a CONDICIONADO en `IATOS_ESTADO_FINAL.md`; `_shared/stripe-offer.ts` (`EXPECTED_PRICE` MXN 9900/mes `inclusive`), `stripe-checkout/index.ts` (503 sin crear nada), `logic.ts` (`currency=mxn`, `adaptive_pricing.enabled=false`, expira sesiones abiertas); `health-check?action=stripe_config`. Commits `d793869`, `9838d49`, `87bf85b` | 18 casos no existían → 18/18; `stripeConfigProbe.test.ts` 8/8 | `docs/iatos/cierre/evidencia/pagos/AUD-08_*`; en vivo, `stripe_config` reporta los problemas de la sección 6.4 y el checkout responde 503 | **BLOQUEADO**. El código está VERIFICADO; la certificación (Fases 0–3) la ejecuta y firma el dueño |

**Conteo:** 7 VERIFICADO y 1 BLOQUEADO. AUD-08 no cuenta como aprobado.

---

## 3. HALLAZGOS NUEVOS ENCONTRADOS POR CLAUDE

Los encontraron los grupos durante el cierre y no estaban en la primera auditoría. El detalle de cada uno, con su prueba, está en el reporte del grupo.

### 3.1 Privé (`cierre/PRIVE.md`, `cierre/FASE0_ESTADO.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| NEW-01 | P2 | Revocar una concesión Privé dejaba viva la invitación y la membresía en `invited`. Al cumplir 90 días, el enlace viejo se aceptaba (N01d). Era el caso real de la cuenta Gmail del dueño | VERIFICADO (`20261024020000`, con limpieza única). En producción, la invitación quedó revocada |
| NEW-P1 / SES-LS | P2 | Desde `f62466e`, la sesión Privé normal (en `localStorage`) sobrevivía al cierre del navegador | CORREGIDO (cookie de sesión del navegador, `1a96d3b`; 3 pruebas nuevas) |
| NEW-P2 | P3 | `prive-cron` no está programado en producción: el barrido nunca corre. La seguridad no depende de él, porque `prive_require` revisa todo en cada llamada | PENDIENTE (decisión del dueño) |
| NEW-P3 | P3 | `members_requires_prive` es solo informativa: `members_access` no la consulta | CONFIRMADO, documentado (decisión D1 del dueño) |
| NEW-P4 | P3 | `request_reset` sin correo en la cuenta gastaba uno de los 3 intentos por hora | VERIFICADO (`229596f`) |
| REMEMBER | — | Pedido del dueño: "mantener mi sesión en este dispositivo (30 días)", opcional y apagado por omisión | VERIFICADO (función nueva, `20261024030000`) |

### 3.2 Reservas IA (`cierre/RESERVAS.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| RES-N1 | P1 | `bareAddress` aceptaba `"reservas@casa.mx"@evil.test` como el restaurante | VERIFICADO (`309ea2e`) |
| RES-N2 | P1 | Un alterno solo "ofrecido" pasaba a `confirmed` al aceptarlo el usuario | VERIFICADO (`372ceda`, `57b5f1e`, SQL R56) |
| RES-N3 | P2 | El código de confirmación podía ser cualquier subcadena (el "4" de "4 personas", o nuestro propio folio) | VERIFICADO |
| RES-N4 | P2 | El mismo Message-ID con otro evento Svix se procesaba dos veces (Claude ×2) | VERIFICADO (R53) |
| RES-N5 | P2 | `apply_reply` aceptaba una confirmación con canal `equipo` desde el webhook | VERIFICADO |
| RES-N6 | P2 | Se aceptaban el dominio padre y los sufijos públicos (`x@com.mx`) | VERIFICADO |
| RES-N7 | P3 | Falso negativo: dirección exacta + DKIM alineado sin política DMARC no contaba | VERIFICADO |
| RES-N8 | P3 | `ai_reservation_events` se podía reescribir con `service_role` | VERIFICADO (solo agregar, R55) |

### 3.3 Booking Bridge (`cierre/BRIDGE.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| AUD-04c | P2 | Un colaborador del viaje podía poner un sitio de phishing que el dueño veía como "Sitio oficial" | VERIFICADO |
| AUD-04d | P2 | La salida llevaba al destino de otra acción de la misma oferta | VERIFICADO |
| AUD-04e | P3 | Un cambio de destino no dejaba historial | VERIFICADO (migración `20261024070000`) |
| AUD-04f/g/h | P3 | `localhost.`, TLD inexistente, rutas con `%2F`, saltos http en `booking-links-cron` | VERIFICADO |
| AUD-04i | P3 | La UI no distinguía oferta exacta de búsqueda general y nunca mostraba `?salida=` | CORREGIDO |
| AUD-04j | P3 | Un `target=_blank` sin `rel` no recibía `noopener` | VERIFICADO |
| BR-N1 | P3 | `booking-go` marcaba "salió al proveedor" **antes** de revisar el destino | CORREGIDO (`peekTarget`) |
| BR-N2 | — | `IATOS_BOOKING_BRIDGE_PROVEEDORES.md` §3 estaba desactualizado | CORREGIDO |

### 3.4 Pagos (`cierre/PAGOS.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| AUD-05.4…05.8, 05.10 | P2/P3 | Defectos reales dentro de AUD-05 (ver la tabla de la sección 2) | VERIFICADO |
| N-01 | P2 | Supabase Auth con `mailer_autoconfirm: true` en producción: quien se registre primero con un correo de `comp_grants` obtiene PRO de cortesía sin ser dueño del correo. Con la prueba sin tarjeta encendida, habría pruebas infinitas | **BLOQUEADO** (dueño: "Confirm email" ON) |
| N-02 | P3 | `apply_prive_grant` liga una concesión Privé pendiente a quien se registre con ese correo, sin exigir confirmación | PENDIENTE (se resuelve con N-01; sigue exigiendo PRO para entrar) |
| N-03 | P3 | `stripe-portal` devolvía al navegador el error crudo de Stripe | CORREGIDO (`d793869`, sin prueba automática) |
| N-04 | P3 | La pantalla PRO dice "Mensajes sin límite" y la lista de PRO dice "100 al mes" | PENDIENTE (decisión DEC-01) |
| N-05 | P2 | Una suscripción que cobra sin cuenta de IATOS respondía 200 en silencio | VERIFICADO (aviso a administradores, `fa99cbf`) |
| N-06 | P3 | `is_pro` no mira `price_id` ni `pause_collection` | Riesgo residual (se controla con la configuración del panel) |

### 3.5 Seguridad y calidad de pruebas (`cierre/SEGURIDAD.md`, `cierre/CALIDAD_PRUEBAS.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| AUD-SEG-01 | P3 | Un colaborador expulsado podía reescribir o mover sus notas del diario con un UPDATE sin filtro | VERIFICADO (`20261024010100`) |
| AUD-SEG-02 | P2 | `mark-visited` llamaba a Place Details de pago sin límite de uso | VERIFICADO |
| AUD-SEG-03 | P2 | `generar-packing-list` llamado por un colaborador mandaba al modelo el perfil y la bóveda **del dueño** y le quitaba su lista | VERIFICADO |
| AUD-SEG-04 | P3 | `track-flight` ligaba un vuelo al viaje de otra persona con la llave de servicio | VERIFICADO |
| AUD-SEG-05 | P2 | "Reintentar" tras un timeout duplicaba solicitudes al Fixer o viajes | VERIFICADO (`20261024200200`, IK1–IK12) |
| SEG-MEJ | P3 | La bóveda nunca llegaba al prompt del equipaje porque leía columnas inexistentes | CORREGIDO (`65df1f1`, sin números de socio) |
| SEG-N1…N11 | P3 | Fotos del diario en buckets públicos (N1); amistad sin consentimiento (N2); pasaportes visibles a los editores del viaje (N3); `<img>` con cualquier URL, usable como píxel de rastreo (N4); detalle interno en algunos errores (N5); `checkCronAuth` amplifica tráfico (N6); `affiliate_clicks` con `user_id NULL` (N7); CORS `*` (N8); Sentry fuera del borrado (N9); `push-subscribe` reasigna el endpoint (N10); sin límite de uso en `stripe-checkout`/`stripe-portal` (N11) | PENDIENTE (P3, decisión de producto) |
| CAL-01 | — | Tres mutaciones de permisos que **ninguna prueba detectaba**: M2 (`prive_require` sin `user_id`), M3 (colaborador con invitación pendiente), M3B (`expenses` con `USING (true)`) | VERIFICADO (PS2, SC1/SC2, SX2/SX3 las detectan ahora) |
| CAL-02 | — | `prive/run.sh` y `ops/run.sh` re-aplican migraciones viejas al final y pueden probar versiones viejas de funciones; `payments/run.sh` se corta al primer error sin decir qué no corrió | Documentado; `prive/run.sh` corregido para re-aplicar también `20261024*_aud_prive_*` |
| CAL-03 | — | `bookingBridgeE2E.test.ts` se llama "E2E" pero es una simulación en memoria | Documentado (las reglas reales se prueban en `bridge.sql`) |
| CAL-04 | — | Pruebas frágiles por tiempo (`concurrent_rate_limit.sh` con `sleep 0.5`, `serpQuota`) | CORREGIDO |

### 3.6 Iato, cotizaciones y operación (`cierre/IATO_COTIZACIONES_OPERACION.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| AUD-IATO-01 | P2 | El turno no tenía tope total (180–260 s) y Supabase lo cortaba a los 150 s sin `final` ni `error` | VERIFICADO (`8aa1be7`, tope de 120 s) |
| AUD-IATO-02 | P3 | El costo de los turnos fallidos no llegaba a `ai_usage_log` | VERIFICADO |
| AUD-IATO-03 | P2 | Iato decía "solicitud enviada al Fixer" aunque el correo al equipo hubiera fallado | VERIFICADO (`10b9e5c`) |
| AUD-IATO-04 | P2 | Un precio de otra opción salía con la insignia "consultado en vivo" | VERIFICADO (`8e76ce4`) |
| AUD-IATO-05 | P2 | Precio por persona mostrado como "total"; base del hotel tomada del texto del modelo | VERIFICADO |
| AUD-IATO-06 | P2 | `web_search` de Iato se saltaba el freno de SerpApi | VERIFICADO (`678671d`) |
| AUD-Q-07 | P2 | Se cobraban análisis de viajes con fechas pasadas o inválidas | VERIFICADO (`7474ef8`) |
| AUD-OPS-08 | P3 | La alerta de precio decía "tipo de cambio de hoy" usando la tabla de respaldo | VERIFICADO (`ee19828`) |
| MEJ-01/02 | — | Un timeout total con texto ya no abre el circuit breaker; el texto parcial se marca "Respuesta incompleta" | VERIFICADO (`962059f`) |

### 3.7 Rendimiento (`cierre/RENDIMIENTO.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| IATO-PERF-01 | P1 | El primer texto de Iato esperaba a todas las herramientas: p50 4.0 s y máximo 9.0 s simulados (5–11 s en vivo) | VERIFICADO en simulación (p50 1.07 s); medición en vivo PENDIENTE (`eval_live.mjs`) |
| IATO-PERF-02…05 | P2/P3 | 9 viajes a la base en serie antes del primer evento; el `final` esperaba dos escrituras; `web_search` esperaba la caché; la métrica no distinguía la frase inicial | VERIFICADO / CORREGIDO |
| REND-01 | P1 | JS inicial de 199 KB (Radix completo y React Query sin usarse) | VERIFICADO (162.8 KB) |
| REND-02…08 | P1–P3 | Fuentes por `@import`; el chunk de la ruta se pedía tarde; fotos de 1600 px en cajas de 390; CLS 0.535 en el inicio; spinner de onboarding en cada apertura; SW sin la primera carga; animaciones desde opacidad 0 en elementos LCP | VERIFICADO (CLS del inicio 0.535 → 0.005) |
| REND-N4 | P2 | Sin red, un error al leer el onboarding mandaba al onboarding a quien ya lo había terminado | VERIFICADO |
| REND-N7 | P3 | Con un error a mitad del stream, la app se quedaba con el texto parcial | VERIFICADO (`reset` antes de `error`) |

### 3.8 Privé reimaginado (`prive_reimagined/*.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| UX-01…10 | P2/P3 | Diagnóstico de la primera auditoría de UX, confirmado en el código: portada vacía, lista de 10,624 px, bloque vacío sin foto, universos sin navegación o duplicados, sin buscador global, viaje activo ignorado | CONFIRMADO → CORREGIDO (`prive-ux.md` §1) |
| UX-FOTO | P2 | Causa raíz de las fotos faltantes: ráfagas con 429, un 429 o un fallo de Pexels recordado como "sin foto" para siempre, consultas inútiles. Además, enlaces anidados abrían otra pestaña | CORREGIDO (`PrivePhoto`, `pexels-image` con caché antes del límite y 503 + Retry-After) |
| PK-01 | P2 | `prive_save_progress` descartaba `dna_consent`: el Travel DNA de Privé nunca se podía activar | VERIFICADO (SQL D1–D3 FALLA → OK, `20261024310000`) |
| PV-01 | P3 | `prive_has_card_number` era ejecutable por `anon`/`authenticated` (lo detectó P53) | CORREGIDO |
| PV-02 | P2 | Quitar un beneficio del radar con un ahorro potencial ligado rompía un CHECK y, con él, `purge_account_data` (el borrado de cuenta) | VERIFICADO (V17 + Z01) |
| PV-03 | P3 | La Bóveda mostraba beneficios sin fuente, alguno probablemente obsoleto ("Hoteles.com Rewards · 1 noche gratis cada 10") | Parcial: las afirmaciones concretas ya no están en `src/components/boveda/PartnerOffers.tsx`, pero siguen el nombre "Hoteles.com Rewards" y un código promocional de Airalo sin fuente. P3 PENDIENTE (observación del redactor, sin verificar en los sitios oficiales) |
| ED-01 | — | En `SECURITY DEFINER`, `current_user` es el dueño de la función: el chequeo de `service_role` se hace con el rol del JWT | Evitado antes de entregar (SN1/SN1c) |

### 3.9 Avatar y viajes pasados (`avatar/AVATAR_VIAJES.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| AV-01 | P2 | "Re-generar" no mandaba la selfie: el modelo inventaba a otra persona y borraba tu cara | CORREGIDO |
| AV-02 | P2 | El prompt pedía cuerpo completo (la cara ocupaba ~8 %), con caricatura y outfit del viaje compitiendo con la identidad | CORREGIDO (retrato, rasgos fijados, juez de parecido ≥ 72) |
| AV-03 | P2 | La selfie iba sin orientar ni reducir, con `gemini-2.5-flash-image` (anunciado como retirado el 2-oct-2026) y sin verificar el parecido | CORREGIDO; el modelo nuevo está PENDIENTE de verificación en vivo |
| AV-04 | P2 | El avatar vivía en dos lugares (`perfil_ia` y `profiles.avatar_url`) y `evolucionar-dna` lo borraba | CORREGIDO (una sola fuente + rescate en la migración) |
| AV-05 | P3 | IATOS-064: `parse-trip-file`/`parsear-viaje` sin validación campo por campo | CORREGIDO |
| AV-06 | P3 | Pedido del dueño: mujeres nunca con barba; hombres solo si la foto la muestra | CORREGIDO (`8c8bfaf`) |

### 3.10 Correo (`IATOS_ENTREGABILIDAD_CORREO.md`)

| ID | Sev. | Hallazgo | Estado |
|---|---|---|---|
| MAIL-01 | P2 | `traveliatos.life` **no tiene MX**: `hola@` no recibe y las respuestas rebotan | BLOQUEADO (DNS del dueño) |
| MAIL-02 | P3 | DMARC `p=none` sin `rua`: nadie recibe los reportes | BLOQUEADO (DNS del dueño) |
| MAIL-03 | P2 | La invitación Privé tenía señales de spam: asunto en inglés tipo "awaits you", 60 rellenos invisibles, fuentes remotas, botón en mayúsculas, pie hacia un buzón inexistente | CORREGIDO (`priveEmailDeliverability.test.ts`) |

### 3.11 Incidente de medición (grupo rendimiento)

En dos corridas de `perf.cjs`, Chromium usó el proxy de la sesión y unas lecturas con un **token inventado** (JWT sin firma válida) llegaron a la API pública de producción: `user_onboarding_state`, `trips`, `travel_profiles`, `auth/v1/user`, `rpc/public_plan_config`, y un intento de `upsert`. Supabase las rechazó y **no hubo cambios de datos**. Se corrigió con `--no-proxy-server` y se comprobó en el registro del servidor simulado que las peticiones siguientes llegaron a él.

---

## 4. HALLAZGOS REFUTADOS CON EVIDENCIA

| Grupo | Sospecha | Por qué no se sostiene | Prueba |
|---|---|---|---|
| Privé | PRO terminado con sesión Privé y contraseña vivas sigue entrando | `prive_require`, `prive_unlock` y las 12 RPC devuelven `PRIVE_NOT_PRO` | S12–S12d, P10 |
| Privé | Sesión de Auth cerrada, cierre global o `not_after` vencido | Ya se negaba cuando la sesión estaba ligada y `auth.sessions` se podía leer | S02, S03, S06 (OK antes) |
| Privé | Token de invitación usable justo después de revocar | No se aceptaba mientras no cumplía (el defecto era posterior: NEW-01) | N01c |
| Privé | Solicitud Privé con el viaje de otra cuenta | `prive_request_create` responde `TRIP_NOT_FOUND` | T01, T02 |
| Privé | RPC de administración abiertas | Sin EXECUTE para `anon`/`authenticated` no admin | S13, S13b |
| Privé | Hace falta compatibilidad para hashes no canónicos | No: el restablecimiento por correo cubre el caso | `PRIVE.md` (evaluación) |
| Reservas | Otro remitente en nuestro hilo; Reply-To distinto | Ya se rechazaban | Pruebas de regresión en `aiReservationsSenderAuth.test.ts` |
| Reservas | Repetición por el mismo `svix-id` o `email_id` | Únicos en `ai_reservation_inbound` + tolerancia Svix de 5 min (faltaba solo el Message-ID: RES-N4) | R23, R54 |
| Reservas | DMARC fail, dominios parecidos, IDN, From en el nombre visible | Ya se rechazaban | fixture `dmarc_fail_same_domain` |
| Bridge | Open redirect `booking-go?u=` | `booking-go` nunca lee URLs de la petición | `bookingBridgeAudit.test.ts`, E2E 19 |
| Bridge | Token alterado, vencido o de otro usuario | HMAC-SHA256 en tiempo constante, 30 min, filtro por `user_id` | idem; SQL B5 |
| Bridge | Cambiar el destino desde el cliente | Sin escritura para `authenticated`; transiciones solo `service_role` | SQL AUD04-1…4, B1/B2/B7 |
| Bridge | Credenciales en la URL, esquemas peligrosos, IP en decimal/hex/octal/IPv6, CRLF, homógrafos | `basicCheck`, parser WHATWG, punycode | "esquemas, credenciales, IPs…", bloque AUD-07 |
| Bridge | `tpDeepLink`/`groundTransport.ts` abren redirects | Hosts fijos; el texto del usuario nunca llega a la autoridad | Revisión de código + `affiliateLinks.test.ts` |
| Pagos | Evento repetido crea doble PRO o doble periodo | Candado de fila, `UNIQUE(stripe_invoice_id)`, `event_id` como llave | A1–A4, AP01/AP02, CC1/CC2, CC4 |
| Pagos | Eventos fuera de orden regresan el estado | Relee Stripe + `stale_event` | AP03, C1 |
| Pagos | `invoice.paid` antes del checkout deja sin PRO | Metadata + fila previa con customer | AP04, AP05, C2–C3 |
| Pagos | Falla a mitad deja la suscripción a medias | Cada paso es idempotente y responde 500 → el reintento converge | Vitest D (12 fallas inyectadas), AP17 |
| Pagos | Ciclo de vida (cancelar, vencer, reactivar) | Correcto | AP06, AP18–AP20, E1–E4 |
| Seguridad | Vistas que se saltan RLS | Sin GRANT a los clientes | SG6 |
| Seguridad | `SECURITY DEFINER` ejecutable por PUBLIC o sin `search_path` | 180 de 180 fijan `search_path` y ninguna es PUBLIC | SG2, SG3 |
| Seguridad | Oráculo `is_trip_owner(viaje, otra_cuenta)`; `get_access_state` de otra cuenta | Bloqueados | SR2, SR3 |
| Seguridad | `../` en el almacenamiento; SSRF; cron sin secreto; webhooks sin firma; fuerza bruta del código de amigo (32⁸) | Bloqueados | SS3, `audSeguridadEdge.test.ts`, `cronAuth.test.ts` |
| Seguridad (wave2) | Huecos en las 46 funciones y 4 políticas nuevas (privekey, privevalor, edition, avatar, importar) | Revisadas una por una: 0 hallazgos | SN1–SN5 |
| Iato | Inyección de órdenes por el nombre de un hotel o una nota | Datos neutralizados en el mensaje de contexto | REF-01 |
| Iato | Iato dice "te reservé" | `enforceNoFakeBooking` | REF-02 |
| Iato | Acción con tarjeta vieja sobre un viaje sin acceso; datos de otro usuario en el contexto | Relectura con RLS y revalidación | REF-03, REF-08 |
| Iato | Costos por modelo mal calculados | Coinciden con la tabla vigente | REF-04 |
| Iato | App "escribiendo" para siempre; cuota consumida con ambos proveedores caídos | Error explícito y `releaseQuota` | REF-05, REF-07 |
| Iato | Crons de vuelos y precios se enciman | `FOR UPDATE SKIP LOCKED` + `notify_once` | REF-09 (SQL `ops`, `cost`) |
| Iato | Cotizaciones sin etiqueta de impuestos o procedencia; vuelos contados dos veces | Etiquetadas; `price_per_person_usd` × viajeros una sola vez | REF-10, REF-11 |
| Rendimiento | PostHog/Sentry, gráficas, mapas o motion en el paquete inicial; falta división por rutas; arranque en frío pesado | No están en el grafo inicial; `lazyWithRetry` ya existía; importar `index.ts` toma 40–100 ms | `bundleSplit.test.tsx`, medición |

---

## 5. Certificación por módulo (20)

**GO** = listo para usarse en producción con personas reales, con el riesgo residual escrito. **NO-GO** = no debe ofrecerse todavía. En los dos casos, la última columna dice qué falta.

| # | Módulo | Veredicto | Base | Qué falta / riesgo residual |
|---|---|---|---|---|
| 1 | Auth | **NO-GO** | El inicio de sesión funciona; `mailer_autoconfirm: true` en producción (N-01) | El dueño activa "Confirm email". Sin eso, la cortesía PRO y las concesiones Privé pendientes se pueden reclamar sin ser dueño del correo |
| 2 | Iato / concierge | **GO** | AUD-IATO-01…06, AUD-SEG-05 y rendimiento: publicados | Primer texto < 4 s **medido solo en simulación**: falta `eval_live.mjs` en vivo. Las solicitudes al Fixer sin aviso al equipo no tienen reintento (P2, PENDIENTE) |
| 3 | Cotizaciones | **GO** | AUD-IATO-04/05, AUD-Q-07, AUD-OPS-08 | P3 de `serpapi-quote` (`nights` del cliente) y estado semántico de Travelpayouts |
| 4 | Viajes | **GO** | AUD-SEG-01/03/04, barrido RLS (SX1–SX4, SC1/SC2) | SEG-N1 (fotos del diario públicas por URL), SEG-N3 (pasaportes visibles a los editores del viaje) |
| 5 | Importar viajes | **GO** | `import_past_trip` (SN4/SN5), validación campo por campo, precios solo del documento | Recomendado: importar un boleto y una reserva reales en vivo (checklist de `AVATAR_VIAJES.md` §4) |
| 6 | Avatar | **NO-GO** | Código corregido y desplegado; `avatar-evolve` responde 401 sin secreto | Falta verificar en vivo que el gateway acepta `gemini-3-pro-image-preview` y el juez, y crear el avatar del dueño con calificación ≥ 72. La tarea diaria de evolución no está programada (requiere OK) |
| 7 | Travel DNA / personalización | **GO** | En español, con datos reales (sin "0 %"); Iato usa tus viajes; `dna_consent` corregido (PK-01) | — |
| 8 | Social | **GO** | Publicado; suite `social` 70 OK; funciones sociales revisadas (SG5) | SEG-N2: la amistad no pide consentimiento (P3) |
| 9 | Gastos | **GO** | Publicado (pestañas, calculadora sin viaje); lectura cruzada negada (SX) | — |
| 10 | Members Only | **GO** | Publicado; suite `members_more` 30 OK | NEW-P3: `members_requires_prive` es solo informativa |
| 11 | Bóveda | **GO** | `vault_items` con RLS solo del dueño, bucket privado, últimos 4 dígitos; suite `boveda` 50 OK; los 3 elementos de la bóveda vieja copiados en producción | PV-03 (P3): nombre de programa y código promocional sin fuente en "Ofertas de socios" |
| 12 | Privé acceso / sesión | **GO** | AUD-01 y NEW-01 VERIFICADOS y publicados; el dueño y su hermana activos; la invitación pendiente de la cuenta Gmail del dueño, revocada | `prive-cron` sin programar (NEW-P2). `PRIVE_IP_SALT` sin verificar (secretos). Confirmar que `postgres` puede leer `auth.sessions`/`auth.users` (si no, Privé falla cerrado para todos) |
| 13 | Privé reimaginado | **GO** | Integrado en `591a71a` (E2E 26/26, simulado); `pexels-image` desplegado con las 66 funciones | Fotos ilustrativas (Pexels), no del lugar; falta medir el LCP en producción y probar en Safari/iOS |
| 14 | The Privé Key | **GO** | 0 IA y 1 RPC por plan; 92/92 Vitest; `prive_key` 47 OK | La curaduría casi no tiene precios ni horarios con fuente: muchas propuestas dirán "por confirmar" (honesto) |
| 15 | Drops / Insider / Passport | **GO** | 9 Drops vigentes en producción; `privevalor` 144 OK | Re-verificación mensual (~1.5 h); la siembra pasa sola a "por verificar" el 6-dic-2026 |
| 16 | The Private Edition | **NO-GO** | N.º 01 sembrado en `pending_review`: nadie lo ve hasta que el editor lo apruebe | El editor lee y aprueba las 16 piezas y las 12 licencias. **La portada vence el 2-nov**: aprobar a más tardar el 28–29-oct. Offline en Safari/iOS sin probar |
| 17 | Reservas IA (apagada) | **NO-GO** | AUD-02/03/06 VERIFICADOS y publicados; `ai_reservations_enabled = false` a propósito | Antes de encenderla: prueba con un correo real de Resend Receiving en un entorno de pruebas (PENDIENTE). `ai-reservations-cron` sigue sin programar a propósito |
| 18 | Booking Bridge | **GO** | AUD-04/07 VERIFICADOS y publicados | El detector de marcas es heurístico; `google.com/aclk` sigue permitido (destino final de Google); la PSL se regenera cada trimestre |
| 19 | Pagos / Stripe | **NO-GO** | AUD-05 VERIFICADO; AUD-08 **BLOQUEADO**; Stripe en modo TEST; checkout en 503 por la protección AUD-08 | Todo lo de la sección 6.4 y las Fases 0–3 de `STRIPE_CERTIFICACION.md`, firmadas |
| 20 | Correo | **NO-GO** | Envío transaccional funcionando (dominio verificado en Resend, DKIM alineado); contenido corregido (MAIL-03) | Sin MX (`hola@` rebota), DMARC sin `rua`, sin Postmaster y sin calentamiento: las invitaciones pueden caer en Spam |

**Total: 14 GO, 6 NO-GO.** Los NO-GO no cuentan como aprobados.

---

## 6. Resultados de la QA final y estado de producción

### 6.1 QA final (la verificó el líder sobre `591a71a`)

| Prueba | Resultado |
|---|---|
| `npx tsc --noEmit -p tsconfig.app.json` | OK |
| `npx vitest run` | **204 archivos, 2258/2258** |
| `npm run build` | OK |
| `deno check` | **66/66 funciones** |

| Suite SQL (`supabase/tests/<suite>/run.sh`) | OK | FALLA |
|---|---|---|
| ai_reservations | 57 | 0 |
| avatar | 41 | 0 |
| boveda | 50 | 0 |
| bridge | 42 | 0 |
| concierge2 | 7 | 0 |
| cost | 16 | 0 |
| edition | 47 | 0 |
| members_more | 30 | 0 |
| ops | (no imprime "OK"; valores observados = esperados) | 0 |
| payments | 88 | 0 |
| prive | 140 | 0 |
| prive_catalog | 110 | 0 |
| prive_key | 47 | 0 |
| privevalor | 144 | 0 |
| security | 156 | 0 |
| social | 70 | 0 |

El único error local esperado es la migración de `pg_cron`, que no existe en un Postgres local. Los `ERROR: permission denied` que imprime `security` son las aserciones de los ataques que se niegan.

### 6.2 Producción (la verificó el líder)

- **Migraciones:** 113 registradas. Las 23 de hoy se aplicaron con la descarga fijada al SHA del commit y el checksum SHA-256 verificado. Las cuentas cuadran: 90 en FASE0, cuando el líder comprobó que no había migraciones del repo sin aplicar, más 23. El repo tiene 127 archivos; esa diferencia de 14 ya existía en FASE0. El auditor la puede conciliar con la lista de migraciones del proyecto.
- **Funciones:** 66 desplegadas. La app en vivo es `assets/index-CH2-FXCW.js` en https://traveliatos.life.
- **`avatar-evolve`** responde 401 sin secreto.
- **Privé:** el dueño y su hermana están activos. La invitación pendiente de la cuenta Gmail del dueño quedó revocada (NEW-01). Los 3 elementos de la Bóveda vieja se copiaron. Hay 9 Drops vigentes.
- **Supabase Auth:** `mailer_autoconfirm: true` (N-01, acción del dueño).
- **Tareas programadas:** `prive-cron` no está programado. La tarea diaria de evolución del avatar tampoco: requiere OK (`docs/iatos/avatar/programar-avatar-evolucion.sql`).
- **The Private Edition N.º 01:** sembrada en `pending_review`. No es visible hasta que el editor la apruebe, y la portada vence el 2-nov.
- **Incidente de medición** (sección 3.11): lecturas con un token inventado, rechazadas, sin cambios de datos.

### 6.3 Interruptores

El último estado leído es el de FASE0 (13:45 UTC) y no se volvió a leer al cierre: `ai_reservations_enabled=false`, `trial_no_card_enabled=false`, `pro_limits_enforced=false`, `members_requires_prive=false`. El checkout en 503 y el resto de la sección 6.2 sí se verificaron al cierre.

### 6.4 Stripe en vivo (`health-check?action=stripe_config`)

| Revisión | Resultado en vivo | Esperado |
|---|---|---|
| Modo | **TEST** | live (después de la Fase 2) |
| Precio | `tax_behavior: unspecified` | `inclusive`: MXN 9900 al mes con IVA incluido |
| Texto del producto | dice "sin límites" | sin "sin límites", "ilimitado", "24/7" ni "VIP" |
| Eventos del webhook | faltan `invoice.paid`, `charge.refunded`, `charge.dispute.created` y `charge.dispute.closed` | los 9 de `REQUIRED_WEBHOOK_EVENTS` |
| Versión de API del webhook | `2026-09-30.endive` | `2024-12-18.acacia` |
| Portal de clientes | no enlaza privacidad ni términos | `https://traveliatos.life/privacidad` y `/terminos` |
| Impuestos | sin registro de IVA en México | registro activo en MX |
| Checkout | **503** (protección AUD-08: el precio no coincide) | abre solo con el precio correcto |

Sin `invoice.paid` ni `charge.refunded`, un cobro real no registraría el periodo pagado ni revocaría el acceso al reembolsar. Por eso la protección del checkout y el NO-GO son correctos.

---

## 7. Acciones pendientes del dueño

1. **Stripe** (`cierre/STRIPE_CERTIFICACION.md`). En el modo que corresponda:
   - el precio de PRO en MXN 99.00 mensual con impuestos **incluidos** (`inclusive`);
   - quitar "sin límites" del texto del producto;
   - agregar al webhook `invoice.paid`, `charge.refunded`, `charge.dispute.created` y `charge.dispute.closed`, con la versión `2024-12-18.acacia`;
   - enlazar privacidad y términos en el portal (cancelar al fin del periodo, cambiar tarjeta, sin cambio de plan);
   - Stripe Tax con registro de IVA en México;
   - revisar los cupones del 100 % y nunca pausar cobros desde el panel.
   
   Después: Fase 1 (T0–T15 en prueba), Fase 2 (live; `stripe_config` con `ok: true` y `mode: "live"`), Fase 3 (compra real de $99 MXN reembolsada) y la firma de la tabla §8. También la revisión legal de términos, privacidad y reembolsos.
2. **Supabase Auth:** Authentication → Providers → Email → **"Confirm email" = ON** (N-01). No encender `trial_no_card_enabled` antes.
3. **DNS y correo** (`IATOS_ENTREGABILIDAD_CORREO.md` §3):
   - MX y SPF en la raíz para un buzón real `hola@traveliatos.life`;
   - DMARC `p=none` **con `rua`**;
   - alta en Google Postmaster Tools;
   - 2–3 semanas de calentamiento y después DMARC `quarantine`;
   - el secreto opcional `PRIVE_REPLY_TO`.
4. **The Private Edition:** aprobar las piezas, las licencias y "Comprobar enlaces" en `/dashboard/admin/edicion` **a más tardar el 28–29-oct** (la portada vence el 2-nov).
5. **Tareas programadas** (requieren OK): `prive-cron` (NEW-P2; durante el calentamiento del correo, con menos de 50 invitaciones por corrida) y la evolución diaria del avatar. `ai-reservations-cron` sigue apagado hasta la prueba con un correo real.
6. **Verificaciones en vivo que requieren autorización:**
   - crear el avatar con la selfie del dueño;
   - `eval_live.mjs` de Iato con la cuenta sintética;
   - la lectura de privilegios sobre `auth.sessions`/`auth.users` (`cierre/PRIVE.md`, "Requiere autorización");
   - `PRIVE_IP_SALT` presente;
   - `pg-safeupdate` activo;
   - `verify_jwt` desplegado igual que `config.toml`.
7. **Decisiones de producto:** N-04 (texto "sin límite" o encender los límites, DEC-01), SEG-N1…N11, la columna `notified_at` con reintento para las solicitudes al Fixer sin aviso y PV-03.

---

## 8. Riesgo residual consolidado

| Riesgo | Sev. | Estado | Fuente |
|---|---|---|---|
| Stripe en TEST, configuración que no coincide con el código y ninguna compra real reembolsada. Nada de pagos se probó contra Stripe real (Adaptive Pricing, `sessions.expire`, Stripe Tax) | P1 | **BLOQUEADO** | `PAGOS.md`, `STRIPE_CERTIFICACION.md` |
| `mailer_autoconfirm: true`: cortesía PRO y concesión Privé reclamables con un correo ajeno (N-01, N-02) | P2 | **BLOQUEADO** | `PAGOS.md` |
| Correo sin MX ni DMARC con reportes: invitaciones en Spam | P2 | **BLOQUEADO** (DNS) | `IATOS_ENTREGABILIDAD_CORREO.md` |
| Solicitudes al Fixer con `human_notified=false` sin reintento ni alerta | P2 | PENDIENTE | `IATO_COTIZACIONES_OPERACION.md` |
| Avatar con un modelo de imagen sin probar en vivo | P2 | PENDIENTE | `AVATAR_VIAJES.md` |
| Reservas IA sin prueba con un correo real de Resend Receiving; la alineación DKIM sale de la documentación de Resend; quien tenga la llave `service_role` podría sellar SPF/DKIM falsos | P2 | PENDIENTE (función apagada) | `RESERVAS.md` |
| La sesión Privé depende de que `postgres` lea `auth.sessions`/`auth.users`; `PRIVE_IP_SALT` sin verificar | P2 | PENDIENTE (lectura en vivo) | `PRIVE.md` |
| `prive-cron` sin programar: no hay barrido automático | P3 | PENDIENTE | `PRIVE.md` |
| Latencia de Iato y LCP medidos en simulación o local; en producción, por medir | P3 | PENDIENTE | `RENDIMIENTO.md`, `prive-ux.md` |
| Inicio: LCP ≈ 4.0 s para quien vuelve y 4.5–6.8 s en la primera visita del dispositivo | P3 | Aceptado o decisión de diseño (fuente Fraunces) | `RENDIMIENTO.md` |
| RLS y almacenamiento probados con stubs de `auth`/`storage`, no con PostgREST real; 59 archivos de pantalla con Supabase simulado | P3 | PENDIENTE (prueba en vivo de solo lectura con dos cuentas) | `CALIDAD_PRUEBAS.md` |
| `is_pro` no distingue el precio ni los cobros pausados (N-06) | P3 | Depende de la configuración del panel | `PAGOS.md` |
| Detector de phishing heurístico; `google.com/aclk` permitido; PSL que envejece | P3 | Aceptado | `BRIDGE.md` |
| The Private Edition redactada por IA: requiere lectura humana completa; fotos en el CDN de Pexels; offline sin probar en Safari | P3 | PENDIENTE (editor) | `EDITION.md` |
| Curaduría Privé con pocos precios y horarios con fuente; fotos ilustrativas | P3 | Aceptado (se dice en pantalla) | `PRIVEKEY.md`, `prive-ux.md` |
| Notas de seguridad SEG-N1…N11 | P3 | PENDIENTE | `SEGURIDAD.md` |
| Mutaciones M7, M9, X3 y X4 detectadas por una sola prueba cada una | P3 | Aceptado | `CALIDAD_PRUEBAS.md` |
| Sesión recordada de 30 días: en un dispositivo desbloqueado, Privé no pide la contraseña | P3 | Aceptado por el dueño (opcional) | `PRIVE.md` |
| Incidente de medición: lecturas con un token inventado llegaron a producción y fueron rechazadas | — | Cerrado, sin cambios de datos | `RENDIMIENTO.md` |

---

## 9. Cómo verificar este cierre

1. Empezar por esta página, luego `cierre/FASE0_ESTADO.md` (estado de partida) y el reporte de cada grupo.
2. Correr las pruebas (sección 6.1). El `MANIFIESTO.txt` del paquete trae los comandos.
3. Para cada AUD-0x, revisar la prueba nombrada en la tabla de la sección 2 contra `06865cb` (el ZIP auditado) y contra este commit. El paquete incluye `DIFF_desde_06865cb.patch`.
4. Lo que dice BLOQUEADO o PENDIENTE no se puede verificar desde el código: requiere el panel de Stripe o de Supabase, DNS o una prueba en vivo autorizada.
