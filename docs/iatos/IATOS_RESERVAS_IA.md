# IATOS · Reservas IA v1 (canal correo)

> Pedido del dueño: «lo que quiero es que la IA se encargue de reservar, no yo, la IA, que concierge reserve y mande un correo con confirmación de que se logró la reservación».
>
> Rama `claude/wc-reservas` · fecha 2026-10-22 · **apagado por defecto** (`app_flags.ai_reservations_enabled = false`).

## 1. Resumen para fundadores

- **Qué hace.** Cuando un usuario quiere mesa en un restaurante, Iato arma la solicitud y le muestra al usuario exactamente a quién y qué le va a escribir. El usuario pulsa **«Confirmar: escribiremos a &lt;restaurante&gt; en tu nombre»**. Entonces IATOS manda un correo cortés al restaurante, en su idioma (español, inglés o francés), desde `reservas@traveliatos.life`. Cada reserva tiene su propia dirección de respuesta (`reservas+<código>@reply.traveliatos.life`).
- **Cuando el restaurante contesta**, IATOS lee la respuesta con Claude y decide:
  - **Confirmada.** Solo si el restaurante lo escribió, el remitente está verificado y la fecha, la hora y las personas coinciden. El usuario recibe un aviso en la app y un correo que **cita la respuesta del restaurante como prueba**. El correo trae el archivo de calendario (.ics), Google Calendar, Outlook y «Cómo llegar».
  - **Otro horario.** El usuario lo elige en la app e IATOS le contesta al restaurante.
  - **No hay lugar, piden datos, piden tarjeta o respuesta dudosa.** El usuario lo ve tal cual, con opciones: llamar, WhatsApp, el sitio del restaurante o el Fixer.
  - **Sin respuesta.** Le escribimos **una sola vez** más. Si sigue sin contestar, la solicitud vence y le ofrecemos el Fixer al usuario.
- **Qué NO hace (a propósito).**
  - No usa OpenTable, Resy, TheFork, SevenRooms ni Google Reservations, porque requieren contrato.
  - No inventa correos.
  - No paga ni comparte tarjetas.
  - Nunca dice «confirmada» antes de que el restaurante lo confirme por escrito.
- **Costo por reserva:** ~USD 0.01–0.05 en Claude, más hasta USD 0.02 de Google Places. El detalle está en el §6.
- **Para encenderlo** se necesitan seis pasos del dueño (§5). Los más importantes son el registro MX de `reply.traveliatos.life` en Resend, el webhook con su secreto y cambiar la bandera.
- **Siguiente fase:** llamadas con voz IA y WhatsApp Business (§10). **Fase 3:** reservas reales de hoteles y vuelos por API (Duffel, LiteAPI) para el Booking Bridge.

## 2. Cómo funciona

```
Iato / app / Booking Bridge
   │ create_intent (lugar de Google o Privé, fecha y hora local, personas)
   ▼
[servidor] busca el contacto oficial ──► sin correo verificable → needs_user (llamar · WhatsApp · sitio · Fixer)
   │ correo encontrado (con URL y cita de dónde salió)
   ▼
awaiting_user_ok ── el usuario ve el texto y pulsa «Confirmar: escribiremos a X en tu nombre»
   │ confirm_send (consentimiento: compartir mi contacto sí/no · copia para mí sí/no)
   ▼
sent ── correo al restaurante · Reply-To reservas+<token>@reply.traveliatos.life
   │                         └─ sin respuesta: 1 recordatorio (a la mitad del plazo, máx. 24 h) → expired
   ▼ respuesta (webhook firmado de Resend)
Claude clasifica (salida estructurada) → reglas verificables deciden:
   confirmed · needs_user (alterno / pide datos / pide tarjeta) · declined · venue_replied (no verificable) · sin cambio (respuesta automática)
```

**Estados** (`ai_reservations.status`): `draft`, `awaiting_user_ok`, `sent`, `venue_replied`, `needs_user`, `confirmed`, `declined`, `expired`, `cancelled`, `failed`. Las transiciones legales son las de `public.ai_reservation_transition_ok` (y `TRANSITIONS` en `core.ts`; una prueba exige que coincidan).

### Cómo se encuentra el correo del restaurante (nunca se adivina)
1. **Nuestros datos.** Del catálogo Privé tomamos el sitio, el enlace de reservas y el destino. De Google Place Details tomamos `websiteUri`, el teléfono, `timeZone` y el mapa. Solo se aceptan lugares identificados por `place_id` de Google o `experience_id` de Privé, para que el destino del correo salga de una fuente confiable y nadie pueda usar IATOS para escribirle a cualquier dirección.
2. **Sitio oficial.** Se descarga la página de inicio y hasta 2 páginas de contacto o reservas: solo https públicos, sin IPs ni redirecciones a redes internas, con un máximo de 8 s y 1.5 MB.
3. **Correos encontrados.** Si hay un único correo con nombre de reservas (`reservas@`, `booking@`…), se usa sin IA. Si hay varios, Claude elige uno de la lista, y se valida que esté escrito en la página citada. Se guarda la URL y la frase como fuente (`venue_email_source`).
4. **Sin correo**, la solicitud queda en `needs_user` con opciones (teléfono, WhatsApp si el número es internacional, enlace del lugar y Fixer).

### Cuándo se considera confirmada (regla de honestidad)
Actualizado en el cierre de auditoría (AUD-02, AUD-03, AUD-06; detalle en `docs/iatos/cierre/RESERVAS.md`). Todas las condiciones a la vez, sin importar lo que diga el modelo:
1. **Remitente con autenticación fuerte** (`senderAuthentication` en `core.ts`, y la misma regla en SQL `ai_res_sender_strong`). Resend da `authentication.{spf,dkim,dmarc}` = `pass | fail | gray | processing_failed | unknown`, calculados por el servidor que recibe.
   - el From es **exactamente** la dirección a la que escribimos, con DMARC `pass`, o con DKIM `pass` (Resend reporta `gray` si el firmante no coincide con el From) y DMARC `gray`; **o**
   - (ronda r2, A2-RES-01) otra dirección del dominio del restaurante, o de un subdominio suyo, con DMARC `pass`, **solo si el dominio es propio**: no es un buzón compartido (`SHARED_MAILBOX_DOMAINS` en `core.ts` = `ai_res_freemail_domains()` en SQL: gmail, hotmail/outlook/live en todos sus países, yahoo, icloud/me/mac, gmx, web.de, orange/wanadoo/free/sfr, libero, terra, uol, infinitummail, prodigy…) **y** coincide con el host del sitio web oficial guardado en la reserva (`venue_website`, sin `www.`). Sin sitio web, o con el sitio en otro dominio, el dominio se trata como compartido y se exige la dirección exacta.
   - DMARC con cualquier valor distinto de `pass` o `gray` (`fail`, `processing_failed`, `unknown`, ausente o inesperado) descarta (A2-RES-06). SPF solo no basta: DMARC `pass` obtenido solo por SPF alineado cuenta únicamente para la dirección exacta o para un dominio propio (A2-RES-04, riesgo reducido). Dominio padre, dominios parecidos (guion, otro TLD, IDN/punycode), From con varios buzones, varias @ o parte local entre comillas → no verificado.
   - El From del webhook, el del correo descargado y el encabezado From crudo deben coincidir. Si el correo trae encabezados, debe haber exactamente un From legible, venga como objeto (sin importar mayúsculas) o como lista `[{name, value}]` (A2-RES-07).
2. **Una cita textual** que aparece en el correo y que es una frase **explícita** de confirmación («confirmamos», «confirmed», «nous confirmons»…). «Sí, perfecto», «tenemos disponibilidad», «podemos recibirlos» o «nos vemos» no confirman.
3. **Sin dudas, negaciones, condiciones, pendientes, preguntas ni pago** en la respuesta (`evidence.ts`). Si piden tarjeta o garantía → decide el usuario.
4. **Fecha, hora, personas y nombre aceptados**: escritos por el restaurante e iguales a la solicitud, o ligados a nuestra solicitud exacta (la respuesta cita el folio y las tres líneas de la solicitud sin cambios). El nombre también queda ligado por el token único del hilo. Cualquier contradicción (otra hora, otro número de personas, otro día, otro nombre) → queda para revisión.
   - «Sí, pero a las 21:15» es un **alterno**. Solo cuenta como «apartado» si el correo lo dice explícitamente con las mismas exigencias; si el usuario lo acepta, entonces se confirma con esa cita.
5. **Número de confirmación** solo si está escrito junto a «confirmación/código/folio…»; nunca se inventa.
6. **Evidencia del proveedor guardada** (AUD-06): Message-ID (único: un correo repetido no se procesa dos veces), huellas SHA-256 del cuerpo y del .eml, fecha de recepción, SPF/DKIM/DMARC, texto del restaurante y ligadura con la solicitud; y la decisión registrada con el id del modelo.

La base de datos lo vuelve a exigir por su cuenta: el CHECK `ai_res_confirmed_has_evidence` y el trigger `ai_reservations_guard_evidence` (migración `20261024170000_aud_reservas_evidence.sql`) recalculan el remitente con los datos del proveedor y comprueban cita, código, condiciones y registro de la decisión. El texto que produce la IA, por sí solo, no puede confirmar nada ni con la llave de servicio. Solo al confirmarse se crea la constancia en `bookings`, que aparece en **Mis reservas**.

## 3. Qué es honesto y qué todavía no es posible

| Sí | Todavía no |
|---|---|
| Pedir mesa por correo a lugares con correo público en su sitio oficial | Lugares que solo reservan por OpenTable, Resy, TheFork, SevenRooms o teléfono (requieren contrato o voz: Fase 2) |
| Confirmar solo con respuesta escrita verificada | Garantizar que el restaurante cumpla (la confirmación es del restaurante) |
| Proponer y aceptar un alterno | Negociar por varios mensajes (v1: un alterno elegido y su confirmación) |
| Avisar al restaurante si el usuario cancela | Contestar automáticamente preguntas del restaurante (needs_info): el usuario lo resuelve directamente o con el Fixer |
| Copia al usuario si la pide (correo aparte, sin revelar su dirección) | Adjuntar el .ics al correo. `sendEmail` aún no admite adjuntos, así que va como enlace firmado. Petición abierta al grupo de correos |
| Respuestas a `reservas+token@reply…`, o al folio `Ref R-XXXXXX` del asunto si el remitente es el mismo correo al que escribimos | Respuestas enviadas a `reservas@traveliatos.life` (el dominio raíz no recibe en Resend; ver §5, paso 1.4) |

## 4. Seguridad y privacidad

- **Patrón IATOS-114.** Los clientes no escriben nada. El usuario lee lo suyo por RLS y por columnas: el token de respuesta, el candado y la evidencia interna no son visibles, y `SELECT *` desde el cliente falla. Todo cambio pasa por funciones `SECURITY DEFINER` que solo ejecuta `service_role`. Un trigger rechaza escrituras directas incluso con la llave de servicio: desde la ronda r2 (A2-RES-11, migración `20261026040000_r2_reservas_guardia.sql`) la guardia exige que escriba el **dueño** de la tabla (una de esas funciones), no solo la variable de sesión `aires.actor`, que cualquier sesión podía fijar con `set_config`; además `service_role` ya no tiene INSERT/UPDATE/DELETE/TRUNCATE sobre `ai_reservations`, y una reserva `confirmed` congela lo confirmado. Hasta la r2 esta frase **no era cierta** (la segunda auditoría lo refutó, A7/A7b). El canal `equipo` existe solo a través de `ai_reservation_transition`.
- **Webhook firmado** con Svix (`RESEND_INBOUND_SECRET`):
  - Sin secreto → 503.
  - Sin firma o con firma inválida → 401.
  - Más de 5 min de diferencia → rechazado.
  - Es idempotente por `svix-id`, `email_id` y `Message-ID` (AUD-06).
  - Si falla la descarga o Claude, responde 500 y Resend reintenta: el reintento retoma la misma fila.
- **Límites** (ajustables en `app_flags.ai_reservations_limits`):
  - 5 envíos por usuario al día y 5 solicitudes activas por usuario.
  - **3 por restaurante al día**, sumando todos los usuarios.
  - 200 globales al día.
  - 10 llamadas por minuto a la API por usuario.
- **Datos que guardamos de la respuesta:**
  - Un **extracto** sin correos, teléfonos ni números tipo tarjeta.
  - Las citas, los ids de correo y el dominio del remitente.
  - Desde AUD-06, como evidencia (solo `service_role`, se borra con la cuenta): el texto que escribió el restaurante (sin lo citado), su dirección From y Reply-To, SPF/DKIM/DMARC, el hash del Message-ID, las huellas SHA-256 del cuerpo y del .eml y el puntero al correo en Resend. El .eml completo no se guarda.
- **Correo del usuario.** El usuario puede borrar su cuenta: `purge_account_data` borra sus reservas IA, su historial y los correos recibidos (prueba R43).

## 5. Pasos del dueño para encenderlo

> Nada de esto lo hizo el agente: no hubo despliegues ni llamadas a producción.

1. **Recepción de correo en Resend** (dominio `reply.traveliatos.life`).
   1. En Resend, entra a **Domains → Add domain** y escribe `reply.traveliatos.life`. Usa un subdominio para no tocar el MX actual de `traveliatos.life`.
   2. En la sección **Receiving** del dominio, copia el registro **MX** que muestra Resend. El valor exacto depende de la región (p. ej. `inbound-smtp.<región>.amazonaws.com` o `receive.forge.rmta.net`). Agrégalo en el DNS de `traveliatos.life`:
      - **Tipo:** MX.
      - **Nombre/host:** `reply`.
      - **Valor:** el que muestra Resend.
      - **Prioridad:** la que indica Resend.
      - Debe ser el MX de menor prioridad de `reply.traveliatos.life` (Resend lo advierte).
   3. Pulsa **I've added the record** y espera a que diga **verified**. Fuente: https://resend.com/docs/dashboard/receiving/custom-domains (consultada el 2026-10-22).
   4. **Recomendado:** si el correo de `traveliatos.life` lo maneja Google Workspace u otro proveedor, crea un reenvío de `reservas@traveliatos.life` a `reservas@reply.traveliatos.life`. Así, si un restaurante contesta al remitente en vez de a la dirección de respuesta, se reconoce por el folio del asunto, pero solo si contesta desde el mismo correo al que escribimos.
   5. Verifica que `traveliatos.life` siga verificado para **envío** en Resend (ya se usa `hola@traveliatos.life`).
2. **Webhook de Resend.**
   1. Entra a **Webhooks → Add endpoint**.
   2. URL: `https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/reservations-inbound`.
   3. Evento: **`email.received`**.
   4. Copia el **Signing secret** (`whsec_…`).
3. **Secretos** (en Lovable → Cloud → Secrets, o en Supabase → Edge Functions → Secrets):
   - `RESEND_INBOUND_SECRET` = el `whsec_…` del paso 2. **Obligatorio**: sin él, el webhook responde 503 y no procesa nada.
   - `RESEND_RECEIVING_API_KEY` = una llave `re_…` de Resend con permiso de lectura. **Solo si hace falta.** Para leer el contenido del correo, la función llama a `GET /emails/receiving/{id}` a través del gateway de Lovable con `RESEND_API_KEY`. Si los registros muestran `receiving fetch 401/404`, el gateway no expone Receiving: crea esta llave y la función llamará directo a `api.resend.com`.
   - **Opcionales:**
     - `AI_RESERVATIONS_REPLY_DOMAIN`: por defecto `reply.traveliatos.life`.
     - `AI_RESERVATIONS_FROM_ADDRESS`: por defecto `reservas@traveliatos.life`.
     - `AI_RESERVATIONS_LINK_SECRET`: firma del enlace .ics; si no se define, se usa la llave de servicio.
   - **Ya existentes y necesarios:** `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY`, `RESEND_API_KEY`, `GOOGLE_MAPS_API_KEY` y `CRON_SECRET` (o el secreto de Vault).
4. **Migración y funciones** (con GO del dueño):
   - Migración `supabase/migrations/20261023170000_ai_reservations.sql`.
   - Funciones `ai-reservations`, `reservations-inbound` y `ai-reservations-cron`. Las tres llevan `verify_jwt = false` en `supabase/config.toml`:
     - `ai-reservations` valida el JWT dentro de la función en todo POST; el GET solo sirve el .ics con enlace firmado.
     - `reservations-inbound` exige la firma de Resend.
     - `ai-reservations-cron` usa la autenticación de cron.
5. **Tarea programada** (Lovable → Cloud → SQL editor; mismo secreto de Vault que `docs/ops/programar-tareas.sql`):
   ```sql
   SELECT cron.schedule('ai-reservations-every-30-min', '7,37 * * * *', $cmd$
     SELECT net.http_post(
       url := 'https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/ai-reservations-cron',
       headers := jsonb_build_object('Content-Type', 'application/json',
         'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1)),
       body := '{}'::jsonb, timeout_milliseconds := 120000);
   $cmd$);
   ```
6. **Encender** (al final, y primero con una prueba propia):
   ```sql
   UPDATE public.app_flags SET value = 'true', updated_at = now() WHERE key = 'ai_reservations_enabled';
   ```
   **Prueba de humo segura.**
   - Antes de abrirlo a usuarios, usa un «restaurante» propio: un lugar de Google cuyo sitio publique **un correo tuyo**.
   - Crea una solicitud, confírmala, responde desde ese correo «Confirmamos su reserva para 2 personas…» y verifica el aviso y el correo de confirmación.
   - **No pruebes con restaurantes reales.**
   - Para apagarlo, vuelve a poner `'false'`. Con la bandera apagada no se crean solicitudes ni sale ningún correo, el webhook acusa recibo sin procesar y el cron no hace nada.

## 6. Costos por reserva (estimados, 2026-10-22)

**Claude.** Se usa el modelo de `_shared/claude.ts` (`claude-sonnet-5-5`, sin razonamiento extendido). Cuesta USD 2.00 por millón de tokens de entrada y USD 10.00 por millón de salida (https://platform.claude.com/docs/en/about-claude/pricing, también en `IATOS_COSTOS_UNITARIOS.md`).

| Paso | Cuándo ocurre | Tokens (supuesto) | USD |
|---|---|---|---|
| Elegir el correo del sitio | Solo si hay varios correos ambiguos (si hay uno claro de reservas, no hay llamada) | ~2,500 entrada + ~300 salida | ~0.008 |
| Clasificar una respuesta | Una vez por correo recibido (los reintentos idempotentes no repiten) | ~1,500 + ~400 | ~0.007 |
| **Total típico** | 1–3 respuestas | | **~0.01–0.03** (peor caso razonable ~0.05) |

**Google Place Details (Enterprise).** Es el SKU que incluye sitio web y teléfono. Cuesta USD 20 por 1,000, es decir ~USD 0.02 por solicitud, con 1,000 gratis al mes (https://developers.google.com/maps/billing-and-pricing/pricing, consultada el 2026-10-22).

**Resend.** Cada reserva usa 1 correo al restaurante, 0–1 recordatorio, 1–2 avisos al usuario y, opcionalmente, 1 copia. Los correos **recibidos también cuentan** contra la cuota. El plan Free incluye 3,000 al mes con tope de 100 al día; Pro cuesta USD 20 al mes por 50,000 (https://resend.com/pricing, consultada el 2026-10-22).

## 7. Legal y consentimiento (para revisión del dueño o un abogado)

- **Escribimos en nombre del cliente** solo después de que pulsa el botón con la frase exacta. Guardamos el texto aceptado y la hora en `consent`.
- **El correo es transparente.** Dice que lo envía el asistente de IA de IATOS a petición del cliente, que nunca pediremos ni enviaremos datos de pago, y cómo dejar de recibir solicitudes (hola@traveliatos.life).
- **Datos que se comparten con el restaurante:**
  - Siempre: nombre, fecha, hora, personas y las notas que el usuario escriba.
  - Teléfono y correo, **solo si marca** «Compartir mi teléfono y correo».
  - La copia al usuario va en un correo aparte, así que el restaurante no ve su dirección.
- **Aviso de privacidad.** Conviene agregar que, a petición del usuario, IATOS comparte esos datos con el restaurante elegido y procesa su respuesta con un proveedor de IA. Lo decide el dueño (ver «Decisiones» en el reporte).
- **Bajas de restaurantes.** Si un restaurante pide no recibir solicitudes, hoy se atiende a mano. Una lista de exclusión automática queda como mejora futura.

## 8. API para Concierge 2.0 y el Booking Bridge

**Formas de llamar:**
- `POST /functions/v1/ai-reservations` con el JWT del usuario (`supabase.functions.invoke("ai-reservations", { body })`).
- Desde otra edge function, sin HTTP: `import { createIntent, confirmSend, … } from "../_shared/ai-reservations/service.ts"` y `buildServiceDeps()` de `runtime.ts`. `_shared` se empaqueta con cada función.

**Respuestas:**
- Éxito: `{ ok: true, … }`.
- Error: `{ ok: false, code, message }`. `message` va en español para mostrarlo tal cual.
- Códigos HTTP: 403 `FEATURE_DISABLED`, 404 `NOT_FOUND`, 409 `IN_PROGRESS`/`ALREADY_SENT`, 429 límites, 400 el resto.

| action | Cuerpo | Respuesta |
|---|---|---|
| `create_intent` | `{ venue: { name, place_id? \| experience_id?, city?, country?, timezone?, language? }, datetime_local: "YYYY-MM-DDTHH:MM" (hora local del lugar), party_size: 1–20, customer?: { name?, email?, phone? }, notes?: string ≤500, trip_id?, source?: "iato"\|"usuario"\|"booking_bridge", bridge_offer_id?, idempotency_key? }` | `{ reservation, confirm_prompt: "Confirmar: escribiremos a X en tu nombre", preview: { to, subject, text } \| null, next: "confirm_send" \| "needs_user", replay }` |
| `confirm_send` | `{ id, confirm: true, confirm_text?: <la frase mostrada>, consent: { share_contact: bool, cc_me: bool } }` | `{ reservation }` (status `sent`) |
| `choose_alternative` | `{ id, index }` (índice en `reservation.alternatives`) | `{ reservation }` (`sent`, o `confirmed` si el restaurante ya lo había apartado por escrito) |
| `cancel` | `{ id }` | `{ reservation, venue_notified, message }` |
| `status` | `{ id? }` | `{ enabled, reservations: [ … + history ] }` |

`reservation` trae los campos públicos de `ai_reservations` y además:
- `label`: texto honesto.
- `is_confirmed`.
- `bridge_state`.
- `confirm_prompt`.

**Reglas para Iato (Concierge 2.0):**
- Nunca decir «reservé», «confirmada» ni «mesa confirmada» salvo con `is_confirmed: true`.
- Antes de `confirm_send`, mostrar `confirm_prompt` y `preview` y esperar el sí explícito del usuario. Iato **no** debe llamar `confirm_send` por su cuenta.
- Ante `needs_user` con `reason: "no_contact"`, ofrecer `user_options` (llamar, WhatsApp, sitio) o el Fixer.

### Booking Bridge (modo REQUEST para restaurantes)
`createIntentFromBridgeOffer(buildServiceDeps(), userId, offer)` está en `_shared/ai-reservations/bridge.ts`. La oferta lleva:
- `offer_id`, `product_type: "restaurant"`.
- `provider: "google_places"` y `provider_offer_id` (el place_id), o `venue.place_id` / `venue.experience_id`.
- `datetime_local`, `traveler_count`, `language`, `restrictions` y `trip_id`.

La intención usa `idempotency_key = bridge:<offer_id>`: la misma oferta dos veces devuelve la misma intención.

| ai_reservations.status | Estado del bridge |
|---|---|
| `draft` | SELECTED |
| `awaiting_user_ok` | READY_TO_BOOK |
| `sent` | REQUESTED |
| `venue_replied` · `needs_user` (alterno, datos, tarjeta, no verificado) | PENDING_CONFIRMATION |
| `needs_user` con `reason = no_contact` | FAILED (sin canal verificable: el bridge ofrece otra vía) |
| `confirmed` | CONFIRMED (solo con confirmación escrita verificada) |
| `declined` · `failed` | FAILED |
| `cancelled` | CANCELLED |
| `expired` | EXPIRED |

Reservas IA nunca produce PRICE_RECHECK_REQUIRED ni REDIRECTED_TO_PROVIDER, porque no hay precio ni redirección.

## 9. Pruebas (cómo correrlas)

- **Vitest:** `npx vitest run src/test/aiReservations*`. Cubre:
  - El clasificador con 14 respuestas simuladas en el formato de la Messages API: sí claro, sí a otra hora, no, fuera de oficina, spam, francés, varios alternos, pide datos, pide tarjeta, cita inventada, remitente falso, DMARC fallido, otro número de personas y negativa del modelo.
  - Token, firma Svix, cron, mapa del bridge, descubrimiento de contacto y SSRF.
  - El flujo completo con webhook duplicado, alterno, cancelación y bandera apagada.
  - Plantillas y panel.
- **SQL:** `PGHOST=… PGPORT=… supabase/tests/ai_reservations/run.sh <db>`. Son 43 casos R01–R43: RLS, permisos, guardia, evidencia obligatoria, idempotencia, límites, recordatorio único, vencimiento, bandera y borrado de cuenta.
- **Origen de las respuestas de prueba.** Las respuestas de Claude en `src/test/fixtures/ai-reservations/replies.json` se escribieron a mano con la forma exacta de la API. No salen de llamadas reales: las pruebas no llaman APIs de pago.

## 10. Hoja de ruta

### Fase 2a · Llamadas con voz IA (para lugares sin correo)
Arquitectura propuesta:
- Twilio (número y llamada saliente) más un proveedor de agente de voz.
- El agente lee la solicitud, escucha y transcribe la respuesta, y el mismo clasificador decide.
- «Confirmada» exige la grabación o transcripción como evidencia y el aviso legal de grabación según el país.
- Requiere decisión del dueño: hay leyes de llamadas automatizadas y consentimiento de grabación por país.

| Opción | Precio publicado (consultado 2026-10-22) | Notas |
|---|---|---|
| Twilio (telefonía) | Llamadas salientes a México: USD 0.0160/min a fijo y 0.0473/min a móvil. Número local MX: USD 6.25/mes. ConversationRelay: USD 0.07/min. Llamada saliente en EE. UU.: USD 0.014/min | https://www.twilio.com/en-us/voice/pricing/mx · https://www.twilio.com/en-us/voice/pricing/us («Pricing current as of August 2026») |
| Retell AI | USD 0.07–0.31/min en total. Infraestructura de voz: USD 0.055/min. LLM aparte (p. ej. Claude 4.5 Haiku: USD 0.025/min). Telefonía Twilio EE. UU.: USD 0.015/min. 20 llamadas simultáneas incluidas. USD 10 de crédito inicial | https://www.retellai.com/pricing (la página no muestra fecha de vigencia) |
| Vapi | Hosting: USD 0.05/min. Voz a texto, LLM, texto a voz y telefonía se cobran aparte al costo del proveedor (p. ej. Twilio: USD 0.014/min saliente). Calculadora: USD 82–129 por 1,000 min | https://vapi.ai/pricing (sin fecha de vigencia) |
| ElevenLabs Agents | USD 0.08/min (0.16/min por encima de la concurrencia). Los modelos en tiempo real cobran el LLM aparte | https://elevenlabs.io/pricing/api |

**Orden de magnitud:** una llamada de reserva de ~2 min cuesta ~USD 0.25–0.70 entre voz y telefonía, contra ~USD 0.02 por correo.

### Fase 2b · WhatsApp Business Platform
- **Requisitos:** número verificado, cuenta de WhatsApp Business con Meta (verificación del negocio y método de pago registrado) y plantillas aprobadas, porque el primer mensaje a un restaurante es de plantilla.
- **Precios.** Desde el 1 de julio de 2025 Meta cobra **por mensaje entregado**. El precio depende de la categoría (marketing, utility, authentication, service) y del país; México tiene tarifa propia.
- **Cambios del 1 de octubre de 2026:**
  - Los mensajes de servicio y los utility dentro de la ventana de 24 h pasaron a cobrarse.
  - Hay 1,000 mensajes de servicio gratis al mes por número.
- Fuente: https://developers.facebook.com/docs/whatsapp/pricing (consultada el 2026-10-22). Las tarifas exactas están en las tablas CSV/PDF enlazadas en esa página.
- **Encaje con IATOS:** el mismo modelo de estados con `channel = whatsapp`. Hoy el enlace `wa.me` solo se ofrece como opción manual al usuario.

### Fase 3 · Reservas reales con API (Booking Bridge)
- **Duffel (vuelos y estancias).**
  - USD 3.00 por orden confirmada, más 1 % del valor (Managed Content).
  - USD 2.00 por servicio adicional pagado.
  - USD 0.005 por búsqueda que pase de una proporción de 1,500 búsquedas por compra.
  - Stays: reparto de ganancia, hay que hablar con ventas.
  - Fuente: https://duffel.com/pricing (sin fecha de vigencia).
  - **Duffel Links** es un flujo de búsqueda y compra alojado por Duffel. Requiere que la organización esté en un país soportado por Duffel Payments: https://duffel.com/docs/guides/duffel-links.
- **LiteAPI (Nuitee, hoteles).**
  - Tarifas → Prebook → Book es gratis bajo sus términos y «con una relación búsqueda/compra razonable».
  - Índice de precios: USD 0.05 por petición. Lugares: USD 0.01 por petición.
  - Fuente: https://docs.liteapi.travel/reference/api-pricing-usage-costs.
  - La comisión se fija con `margin` si LiteAPI es el comercio que cobra, o con tarifa neta si cobramos nosotros: https://docs.liteapi.travel/docs/revenue-management-and-commission.
- Ninguna de las dos está contratada. Activarlas requiere contrato, manejo de pagos, reembolsos y soporte (decisión del dueño, ver el reporte del grupo bridge).

## 11. Archivos

- **Esquema:** `supabase/migrations/20261023170000_ai_reservations.sql`.
- **Lógica:** `supabase/functions/_shared/ai-reservations/`.
  - `core.ts`: estados, token, remitente, cron y bridge.
  - `classifier.ts`: Claude y la decisión.
  - `contact.ts`: descubrimiento del correo.
  - `signature.ts`: Svix y enlaces firmados.
  - `templates.ts`: correos y .ics, en módulo propio para que el grupo de correos los reestilice.
  - `service.ts`: flujos.
  - `runtime.ts`: conexión Deno.
  - `bridge.ts`.
- **Funciones:** `supabase/functions/ai-reservations`, `reservations-inbound`, `ai-reservations-cron`.
- **App:** `src/components/reservas/AiReservationsPanel.tsx` (en Mis reservas) y `src/lib/aiReservations.ts`.
- **Pruebas:** `src/test/aiReservations*.test.ts(x)` y `supabase/tests/ai_reservations/`.
