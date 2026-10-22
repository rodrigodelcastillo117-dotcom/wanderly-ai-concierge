# Cierre de auditoría · grupo RESERVAS (Reservas IA por correo)

Rama `claude/aud-reservas` (desde `claude/cierre-auditoria` @ `f62466e`) · 2026-10-22 · la función sigue **apagada** en producción (`app_flags.ai_reservations_enabled = false`). Nada se desplegó, nada se aplicó en producción y no se envió ningún correo real.

Commits: `309ea2e` (AUD-02) · `372ceda` (AUD-03) · `57b5f1e` (AUD-06) · `b7a237f` (mejora adicional) · este documento.

## Resumen

| ID | Severidad | Reproducido (cómo, archivo de prueba) | Solución (archivo, commit) | Tests (antes → después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| AUD-02 | P1 | Pruebas adversariales en `src/test/aiReservationsSenderAuth.test.ts` (30) y bloque «AUD-02 · remitente… de punta a punta» en `src/test/aiReservationsService.test.ts` (6). Contra el código original fallaron 12: SPF+DKIM pass con DMARC fail aceptado; otra dirección del dominio con SPF+DKIM sin DMARC aceptada; From `"reservas@casa.mx"@evil.test` leído como `reservas@casa.mx`; `reservas@casa.mx@evil.test` tomado como dominio `casa.mx`; varios buzones en el From; salto de línea inyectado; dominio padre y sufijo público (`x@com.mx`) aceptados; From del webhook ≠ From del correo descargado sin efecto; `headers.from` ≠ `from` sin efecto. | `supabase/functions/_shared/ai-reservations/core.ts` → `bareAddress` estricto, `domainOf` con la última @, `senderAuthentication()` (DMARC pass alineado al dominio del lugar o subdominio, o dirección exacta + DKIM pass, sin DMARC fail; SPF solo nunca). `service.ts` → `inboundSenderVerdict()` cruza los tres From. Misma regla en SQL: `ai_res_sender_strong` (migración AUD-06). Commit `309ea2e`. | Antes: 12 fallan (ver `audres_vitest_before.txt`). Después: 36/36 pasan; suite de reservas 161/161. | Salida antes/después abajo; aserción de `aiReservationsCore.test.ts` que aceptaba SPF+DKIM sin DMARC invertida (codificaba el defecto). | **VERIFICADO** |
| AUD-03 | P1 | `src/test/aiReservationsConfirmRules.test.ts`: las 10 frases del hallazgo en es/en/fr (30) con el modelo simulado **mintiendo** (`outcome: confirmed`, `booking_held: true`, datos de la solicitud) + 19 casos (hora inventada, personas no dichas, otro nombre, otro día, «mañana» que no es el día, pregunta pendiente, depósito, código inventado, alterno «apartado» que el correo solo ofrece…). Contra el código original fallaron 46: el código confirmaba con fecha/hora/personas omitidas y aceptaba lo que dijera el modelo. | Nuevo `supabase/functions/_shared/ai-reservations/evidence.ts` (reglas deterministas es/en/fr: horas, fechas absolutas/relativas/días, personas, nombre, duda/negación/condición/pendiente/pregunta/pago, frase explícita de confirmación, ligadura con la solicitud citada, código válido). `classifier.ts` `decideReply()` reescrito: el modelo no decide; `templates.ts` `requestFingerprint()`; `core.ts` `splitQuotedReply()`. Commit `372ceda`. | Antes: 46 de 49 fallan (los 3 que pasaban son casos positivos). Después: 49/49 pasan (+1 de la mejora). | Las 14 respuestas grabadas siguen dando el mismo resultado (`aiReservationsClassifier.test.ts`). | **VERIFICADO** |
| AUD-06 | P2 | SQL R44–R57 en `supabase/tests/ai_reservations/ai_reservations.sql` + bloque «AUD-06 · evidencia y repetición» del servicio (4). Contra el esquema original: **R45** una confirmación con solo texto de IA (`quote` + `"verified_sender": true`, sin nada del proveedor) quedó `confirmed`; R46–R52 y R56 (alterno «apartado» con solo SPF se confirmó al aceptarlo) fallaron; R44/R53/R55/R57 no existían (sin columnas/funciones). Vitest: mismo Message-ID con otro svix-id/email_id procesado dos veces (Claude llamado 2 veces). | Migración nueva `supabase/migrations/20261024170000_aud_reservas_evidence.sql` (idempotente): evidencia del proveedor sellada en `ai_reservation_inbound` (`ai_reservation_inbound_attach`), hash único del Message-ID, `ai_reservation_decisions` solo-agregar con modelo y reglas, eventos solo-agregar con evidencia, trigger `ai_reservations_guard_evidence` que recalcula todo en SQL, `apply_reply`/`claim_alternative`/`mark_sent` con la misma regla, canal `equipo` solo con actor `equipo`. `service.ts` `inboundEvidence()` + attach antes de Claude, `evidence_incomplete`, `inbound_id`; `runtime.ts` `fetchRaw` (.eml → SHA-256). Commit `57b5f1e`. | SQL: antes 44 OK + 9 FALLA + 4 sin ejecutar → después **57/57 OK**, migración idempotente. Vitest AUD-06: 4 fallan → 4 pasan. | `audres_sql_before_newtests.txt`, `audres_sql_after.txt` (ver abajo). | **VERIFICADO** (local; migración sin aplicar en producción) |

Conteo: **3 VERIFICADO**, 0 abiertos. P0 abiertos: 0. P1 abiertos: 0.

## Qué cambió, en concreto

### AUD-02 · Remitente
- **Qué da Resend de verdad** (GET `/emails/receiving/{id}`, docs consultadas 2026-10-22): `authentication: { spf, dkim, dmarc }`, cada uno `pass | fail | gray | processing_failed | unknown`, «calculados por el servidor que recibe, no vienen de los encabezados»; `null` en correos anteriores al campo. `dkim: gray` = sin firma **o el dominio firmante no coincide con el From**; `dmarc: gray` = SPF o DKIM pasaron pero no hay política DMARC (o `p=none`). No hay `d=`, selector ni detalle de alineación. También trae `message_id`, `headers`, `reply_to`, `raw.download_url` (firmado, expira). El código no suponía nada más que eso.
- **Regla:** cuenta como verificado SOLO (a) DMARC `pass` con el From en el dominio exacto al que escribimos o un subdominio suyo, o (b) From = la dirección exacta a la que escribimos + DKIM `pass` (alineado según la semántica de Resend) sin DMARC `fail`. SPF solo nunca. DMARC `fail`/`processing_failed` siempre descarta. **Corrección de la ronda r2 (A2-RES-01/04/06):** la vía (a) con otro buzón o subdominio solo vale si el dominio es propio del restaurante (no compartido y = sitio web oficial); si no, se exige la dirección exacta; DMARC distinto de `pass`/`gray` descarta. Ver `docs/iatos/cierre2/RESERVAS_BRIDGE.md`. Sin datos → no verificado → `venue_replied` (PENDING_CONFIRMATION), nunca confirmación.
- Cambio de comportamiento a favor: dirección exacta con DKIM alineado y dominio sin DMARC (`gray`) ahora sí cuenta (antes no).

### AUD-03 · Confirmaciones ambiguas
`decideReply()` solo confirma si: remitente fuerte; cita textual real con frase **explícita** de confirmación; sin duda/negación/condición/pendiente/pregunta/pago; lo que el modelo dice que está escrito lo está; sin contradicciones (otra hora, otro número de personas, otra fecha o día, otro nombre, «mañana» no resoluble); y fecha, hora y personas **escritas e iguales**, o **ligadas** a nuestra solicitud exacta: `quotedRequestLinked()` exige en la parte citada el folio `— IATOS · Ref R-XXXXXX —` de esta reserva y las tres líneas (fecha y hora, personas, nombre) con los valores actuales (es/en/fr). El nombre queda ligado por el token único del hilo (`reply_token`) o folio + remitente exacto (`ref_subject`) si no se escribe. Resultado de las frases del hallazgo: todas → `ambiguous` (venue_replied / PENDING_CONFIRMATION) salvo «Necesitamos tarjeta…» → `payment_required`. «Confirmado.» en nuestro hilo citando la solicitud sin cambios → `confirmed` con `basis: thread_quote` (probado; con otra cifra, sin folio o con otro folio → `ambiguous`). El número de confirmación solo se guarda si está escrito junto a «confirmación/código/folio…», tiene dígito y no es nuestro folio, la hora, la fecha ni las personas.

### AUD-06 · Evidencia
Por cada respuesta, antes de gastar Claude: proveedor, `provider_email_id` + `raw_pointer` (`resend:emails/receiving/<id>`), hash SHA-256 del Message-ID (índice único → repetición = `duplicate`), SHA-256 de texto+HTML y del .eml, `provider_received_at`, From, Reply-To, SPF/DKIM/DMARC, texto del restaurante (sin lo citado, ≤ 8000), ligadura y veredicto del remitente. Sellado (trigger: no se reescribe ni con `service_role`). Cada decisión queda en `ai_reservation_decisions` (modelo, `rules_version`, salida del clasificador, comprobaciones). Las transiciones a `confirmed` guardan `inbound_id`, `email_id`, código y versión de las comprobaciones de la base. La base exige, por su cuenta, todo lo anterior para confirmar. **Privacidad:** no se guarda el .eml; solo el texto del restaurante; todo es solo `service_role` y se borra con la cuenta (R43 sigue OK).

## HALLAZGOS NUEVOS

| ID | Severidad | Descripción | Estado |
|---|---|---|---|
| RES-N1 | P1 | `bareAddress` aceptaba `"reservas@casa.mx"@evil.test` como `reservas@casa.mx` (y `domainOf` tomaba el dominio tras la PRIMERA @): un atacante con DMARC válido en su dominio pasaba como el restaurante, incluso por la vía de folio + remitente exacto. | VERIFICADO (AUD-02, `309ea2e`) |
| RES-N2 | P1 | Alterno «apartado» decidido por el modelo: con `booking_held: true` y un solo alterno, al aceptarlo el usuario la reserva pasaba a `confirmed` aunque el correo solo lo **ofreciera** («Les podemos ofrecer las 21:15, ¿les funciona?»). Ahora exige frase explícita, condiciones y evidencia (TS y SQL R56). | VERIFICADO (`372ceda`, `57b5f1e`) |
| RES-N3 | P2 | Código de confirmación aceptado si era una subcadena cualquiera del correo (p. ej. «4» de «4 personas», o nuestro propio folio). | VERIFICADO (`372ceda`) |
| RES-N4 | P2 | Mismo correo (Message-ID) entregado con otro evento de Svix y otro `email_id` se procesaba dos veces (Claude ×2, dos aplicaciones). | VERIFICADO (`57b5f1e`, R53, Vitest) |
| RES-N5 | P2 | `apply_reply` aceptaba una «confirmación» con canal `equipo` (con `confirmed_by` y `evidence` en texto) desde el webhook: vía para saltar las exigencias de correo. Ahora solo `venue_email`, y `equipo` solo con actor `equipo`. | VERIFICADO (`57b5f1e`) |
| RES-N6 | P2 | Se aceptaba el dominio PADRE del correo del lugar y sufijos públicos (`x@com.mx` para `reservas@casaoaxaca.com.mx`). | VERIFICADO (`309ea2e`) |
| RES-N7 | P3 | Falso negativo: dirección exacta con DKIM alineado y dominio sin política DMARC (`gray`, muy común en restaurantes) no contaba. | VERIFICADO (`309ea2e`) |
| RES-N8 | P3 | `ai_reservation_events` se podía reescribir con `service_role` (historial no auditable). Ahora solo-agregar (R55). | VERIFICADO (`57b5f1e`) |

## HALLAZGOS REFUTADOS CON EVIDENCIA (sub-casos de AUD-02)

| Caso | Evidencia | Resultado |
|---|---|---|
| Respuesta en nuestro hilo (token correcto) pero de otro remitente | Prueba «respuesta en nuestro hilo… otro remitente con DMARC pass → unverified» pasaba ya con el código original (dominio distinto). | REFUTADO (ya protegido; queda prueba de regresión) |
| Reply-To distinto | Prueba «Reply-To distinto no cambia nada» pasaba antes: el código nunca usó Reply-To para verificar. | REFUTADO |
| Repetición por el mismo `svix-id` o `email_id` | R23 (ya existía) y R54 (nueva, pasó antes del arreglo): `ai_reservation_inbound` es único por ambos y la firma Svix tiene tolerancia de 5 min. Lo que sí faltaba era el Message-ID (RES-N4). | REFUTADO (parcial) |
| DMARC fail con From del restaurante, dominios parecidos, IDN, From en el nombre visible | Ya se rechazaban (fixture `dmarc_fail_same_domain`, igualdad exacta de dominio). Ahora con pruebas explícitas. | REFUTADO (regresión añadida) |

## Mejoras adicionales
- **El correo «revísalo tú» dice por qué** la respuesta no se tomó como confirmación (p. ej. «El restaurante no confirmó para cuántas personas», «La respuesta no dice explícitamente que la reserva quedó hecha»): `ambiguousReasonEs()` en `evidence.ts`, `userUpdateEmail('ambiguous')`. Prueba en `aiReservationsConfirmRules.test.ts`. Commit `b7a237f`.
- `docs/iatos/IATOS_RESERVAS_IA.md` §2 y §4 actualizados con la regla nueva (decía «DMARC pass, o bien SPF y DKIM pass»).

## Resultados exactos de las suites

| Suite | Antes (pruebas nuevas contra código original) | Después |
|---|---|---|
| Vitest reservas `npx vitest run src/test/aiReservations` | 8 archivos, 159 pruebas: **62 fallan** (AUD-02: 12 · AUD-03: 46 · AUD-06: 4), 97 pasan | 8 archivos, **161/161 pasan** |
| SQL `supabase/tests/ai_reservations/run.sh audres_after` | Base sin pruebas nuevas: 43/43 OK. Con R44–R57 contra el esquema original: 44 OK, FALLA R45–R52 y R56, R44/R53/R55/R57 con error (funciones inexistentes) | **57/57 OK**, sin FALLA; la migración nueva se reaplica sin error (idempotente) |
| SQL `supabase/tests/security/run.sh audres_sec` | `audres_secbase` sobre `claude/cierre-auditoria` | Salida **idéntica** a la base (138 líneas; solo cambia el nombre de la base). Único error: pg_cron (esperado) |
| `npx tsc --noEmit -p tsconfig.app.json` | — | exit 0 |
| `deno check` `ai-reservations`, `reservations-inbound`, `ai-reservations-cron` | — | exit 0 los tres (`deno.lock` borrado) |
| Vitest completo `npx vitest run` | ≈1500 verdes al empezar | 1588 pruebas: 1568 pasan, 20 fallan **por tiempo** (`Test timed out in 5000ms`, carga del equipo ~40) en 17 archivos de UI ajenos a reservas. Re-corridos solos: 15 archivos verdes con `--testTimeout=30000`; los 2 restantes (`godtierHome`, `membersMore`) verdes con `--testTimeout=60000` (13/13). Ninguno importa código de reservas. |

Commit AUD-06 verificado aislado (worktree temporal en `57b5f1e`): 160/160 de reservas.

## Requiere autorización para producción
- **Migración** `supabase/migrations/20261024170000_aud_reservas_evidence.sql` (nueva, idempotente). Debe aplicarse **junto con** el despliegue de las funciones: con la migración y el código viejo, el webhook no llama a `ai_reservation_inbound_attach` y la base rechazaría toda confirmación (queda en revisión, nunca confirma de más); con el código nuevo y sin la migración, el webhook responde 500 (`EVIDENCE_FAILED`) y Resend reintenta.
- **Funciones a desplegar** (cambió `_shared/ai-reservations/`): `ai-reservations`, `reservations-inbound`, `ai-reservations-cron`.
- Antes de encender la bandera: probar con un correo real de Resend Receiving en un entorno de pruebas (forma real de `authentication`, `message_id`, `headers`, `raw.download_url`). **PENDIENTE**: no se pudo hacer aquí (prohibido mandar correos reales).

## Riesgo residual
- La semántica de alineación DKIM sale de la documentación de Resend («gray = el dominio firmante no coincide con el From»); no se sabe si es alineación estricta o relajada. Se aceptan subdominios del dominio del lugar con DMARC `pass`.
- Si alguien obtiene la llave `service_role`, puede llamar `ai_reservation_inbound_attach` con resultados SPF/DKIM/DMARC falsos: la base recalcula la regla, pero no puede comprobar que esos valores vengan de Resend (la firma Svix cubre el webhook, no el contenido descargado). Mitigación posible: guardar el .eml y verificar DKIM en el servidor.
- El .eml no se guarda (privacidad); su huella sí. El puntero a Resend sirve mientras Resend conserve el correo (plazo no documentado).
- `linkage.quoted_request` lo calcula código determinista en TypeScript; la base confía en ese valor (no guarda la parte citada).
- Las reglas de texto cubren español, inglés y francés. En otro idioma nada confirma (queda en revisión). Son conservadoras: firmas con horarios («martes a domingo 13:00–23:00»), preguntas de cortesía o un «pero» mandan una confirmación real a revisión del usuario (falso negativo, nunca falso positivo). El usuario ve la respuesta y ahora el motivo.
- Ventana de carrera de dos webhooks con el mismo Message-ID: resuelta por el índice único (`unique_violation` → `duplicate`), probada solo en secuencia.
- `fetchRaw` (descarga del .eml) no se probó contra Resend real; si falla, falta solo `raw_sha256`.
