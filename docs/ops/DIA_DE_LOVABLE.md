# El día de Lovable: guía de un solo paso

Esta guía es para el día en que el dueño recargue créditos en Lovable. Ese día se publica todo el backend nuevo: incidentes, Operador IA, derechos y reclamos, canales (Telegram y WhatsApp), vigilancia proactiva y comisiones. Después se publica el frontend.

**Cómo usarla.** Sigue los pasos **en este orden**, sin saltarte ninguno. Cada paso dice qué debes ver para pasar al siguiente. Si algo no sale como dice, detente y ve al paso **i)**, que apaga todo en un minuto.

**Dónde se hace cada cosa:**
- **SQL editor:** Lovable → tu proyecto → **Cloud** → **SQL editor** → pegar → **Run**.
- **Secretos:** Lovable → tu proyecto → **Cloud** → **Secrets**.
- **Chat de Lovable:** el cuadro de mensajes del proyecto.

**Antes de empezar.**
- La rama `claude/integra-backend` debe estar unida a `main` en GitHub; `main` debe incluir el commit `da5820a` o uno posterior (último cambio de código de esta guía).
- Ten a la mano los secretos del paso d.

Tiempo estimado: de 60 a 90 minutos, más la evaluación del paso g.

---

## a) Migraciones 20261030010000, 020000 y 030000

Se usa el método de siempre (`_deploy_log`):
1. La base descarga cada archivo del raw de GitHub, de un commit fijo.
2. Se compara su huella sha256 y su tamaño.
3. Se aplica con `_deploy_apply`.
4. Se registra en `schema_migrations`.

Las tres migraciones juntas se aplican en una sola transacción: si una falla, no queda ninguna a medias.

| Archivo | sha256 | bytes |
|---|---|---|
| `20261030010000_vigilancia.sql` | `6c781c7fedb80310bc872ea2c54477dbc89cb365e59dd24d3df4fdeae3805560` | 48481 |
| `20261030020000_comisiones.sql` | `476cad34e0e28d5f5b5789c3c4399765ce300fc8239c631a1a0444c0ca3b5665` | 64079 |
| `20261030030000_canales.sql` | `8c1fd075a0f33102ecefcc9275246731fc4f4045e923dc1df3667ca3c866dd88` | 19979 |

El commit fijo es `c21ceb9f5096331c73ec512544d49e0a11987b69`. Si `main` tiene un commit más nuevo, también sirve, siempre que las huellas coincidan: la comparación lo comprueba.

**a1. Revisar que no estén aplicadas.** El resultado debe salir vacío. Si aparece alguna versión, esa migración ya está aplicada: salta al paso a6.

```sql
SELECT version FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261030010000','20261030020000','20261030030000');
```

**a2. Descargar.** Primero se borran los intentos anteriores que no se aplicaron.

```sql
DELETE FROM public._deploy_log
 WHERE f LIKE 'supabase/migrations/202610300%' AND applied_at IS NULL;

WITH m(f, sha, b) AS (VALUES
  ('supabase/migrations/20261030010000_vigilancia.sql','6c781c7fedb80310bc872ea2c54477dbc89cb365e59dd24d3df4fdeae3805560',48481),
  ('supabase/migrations/20261030020000_comisiones.sql','476cad34e0e28d5f5b5789c3c4399765ce300fc8239c631a1a0444c0ca3b5665',64079),
  ('supabase/migrations/20261030030000_canales.sql','8c1fd075a0f33102ecefcc9275246731fc4f4045e923dc1df3667ca3c866dd88',19979))
INSERT INTO public._deploy_log(f, req, sha256, bytes)
SELECT f, net.http_get(url := 'https://raw.githubusercontent.com/rodrigodelcastillo117-dotcom/wanderly-ai-concierge/c21ceb9f5096331c73ec512544d49e0a11987b69/' || f,
                       timeout_milliseconds := 60000), sha, b FROM m
RETURNING f, req;
```

**a3. Comparar huellas y tamaños.** Espera 10 segundos y corre esta consulta.

```sql
SELECT d.f, r.status_code,
       octet_length(convert_to(r.content,'UTF8')) AS bytes_bajados, d.bytes AS bytes_esperados,
       encode(sha256(convert_to(r.content,'UTF8')),'hex') = d.sha256 AS sha_ok
  FROM public._deploy_log d LEFT JOIN net._http_response r ON r.id = d.req
 WHERE d.f LIKE 'supabase/migrations/202610300%' ORDER BY d.f;
```

Para seguir, las **3 filas** deben mostrar `status_code = 200`, `bytes_bajados = bytes_esperados` y `sha_ok = true`.
- Si `status_code` sale vacío, la descarga no ha terminado: espera otros 10 segundos y repite.
- Si alguna fila trae `false` o un código distinto de 200, **detente**: el archivo no es el esperado.

**a4. Aplicar las tres.** Corre esta línea **sola**.

```sql
SELECT public._deploy_apply('20261030010000', '20261030030001') AS r;
```

Debe decir `3 aplicadas`. Si sale un error, no se aplicó ninguna; copia el error y detente.

**a5. Registrar.** Corre esta consulta **aparte**: si va junto a un error, también se revierte.

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('20261030010000','vigilancia'), ('20261030020000','comisiones'), ('20261030030000','canales')
ON CONFLICT (version) DO NOTHING;
```

**a6. Dejar la vigilancia en pausa hasta el paso h.** Esta migración la deja encendida. Con esta consulta no avisa a nadie mientras se publica lo demás.

```sql
UPDATE public.app_flags SET value = 'false'::jsonb, updated_at = now() WHERE key = 'vigilancia_enabled';
SELECT key, value FROM public.app_flags
 WHERE key IN ('vigilancia_enabled','operador_enabled','reclamos_enabled','comisiones_sync_enabled',
               'reservas_gestionadas_cambios_enabled','proveedores_reservas_enabled','cargo_servicio_enabled')
 ORDER BY key;
```

Para seguir, todas deben salir en `false`. La única excepción es `comisiones_sync_enabled = true`, que solo **lee** ventas de Travelpayouts.

---

## b) Pedirle a Lovable que sincronice y despliegue las funciones

Hay que desplegar **85 funciones**, comparadas con el código que hoy está en producción (2c9c674):
- **15 son nuevas:** canales, comisiones-sync, incidente, incidentes-vigilante, operador, operador-eval, proveedores-webhook, reclamos, reclamos-cron, reclamos-inbound, reservas-gestionadas, telegram-webhook, vigilancia-cron, voz-webhook y whatsapp-webhook.
- **12 cambian su comportamiento.**
- **58 solo cambian por código compartido.**

Van en **tres tandas** de 27, 29 y 29. Pega cada mensaje **tal cual** en el chat de Lovable, uno a la vez. Espera a que Lovable responda que terminó antes de mandar el siguiente.

**Mensaje 1** (sincroniza y despliega las 15 nuevas y las 12 que cambian su comportamiento):

```
Deploy only — do NOT edit, create or commit any file. First sync edge functions from GitHub main exactly: `git fetch origin main` then `git archive origin/main supabase | tar -x`; confirm `git diff origin/main -- supabase` is empty (main must include commit da5820a). Then deploy exactly these 27 Edge Functions (15 are NEW: canales, comisiones-sync, incidente, incidentes-vigilante, operador, operador-eval, proveedores-webhook, reclamos, reclamos-cron, reclamos-inbound, reservas-gestionadas, telegram-webhook, vigilancia-cron, voz-webhook, whatsapp-webhook — use the verify_jwt values in supabase/config.toml):

canales comisiones-sync incidente incidentes-vigilante operador operador-eval proveedores-webhook reclamos reclamos-cron reclamos-inbound reservas-gestionadas telegram-webhook vigilancia-cron voz-webhook whatsapp-webhook ai-reservations ai-reservations-cron concierge-action concierge-chat enviar-opinion flight-watch-cron flights-search health-check ops-desk places-nearby reservations-inbound scan-receipt

Report which deployed OK and any failures with the error. Do not change secrets.
```

**Mensaje 2:**

```
Deploy only — do NOT edit, create or commit any file. The supabase folder is already synced with GitHub main (confirm `git diff origin/main -- supabase` is still empty). Deploy exactly these 29 Edge Functions:

ai-tool analizar-preferencias-ruta analizar-viaje aprender-diario auditar-perfil avatar-evolve avisos-viaje booking-bridge buscar-promociones buscar-video card-benefits-lookup delete-account editar-viaje-ai edition-link-check email-bienvenida enviar-email-fixer enviar-seleccion evolucionar-dna experiencias-top ferry-search flight-status generar-packing-list generate-avatar geocode geocode-address get-routes hotels-search interpretar-viaje logistics-plan

Report which deployed OK and any failures with the error. Do not change secrets.
```

**Mensaje 3:**

```
Deploy only — do NOT edit, create or commit any file. The supabase folder is already synced with GitHub main (confirm `git diff origin/main -- supabase` is still empty). Deploy exactly these 29 Edge Functions:

mark-visited nearby-places nightlife-discover parse-trip-file parsear-viaje pexels-image place-details place-photo place-resolve places-search price-watch price-watch-cron prive-access prive-cron recomendar-destinos resolver-fechas send-email serpapi-quote share-trip-notify stripe-webhook suggest-packing suggest-restaurants tag-moment track-flight transcribir-nota travelpayouts-flights trip-files-purge tripadvisor-search viator-search

Report which deployed OK and any failures with the error. Do not change secrets.
```

**Para seguir:** Lovable debe reportar **OK en las 85**. Si alguna falla, manda otra vez el mismo mensaje solo con las que fallaron.

No hace falta redesplegar estas 9, porque su código no cambió: account-deletion-retry, booking-go, booking-links-cron, evaluar-logros, prive-tenure-backfill, push-subscribe, stripe-checkout, stripe-portal y update-food-dna.

---

## c) Programar las tareas automáticas (SQL, en este orden)

Abre cada archivo de `docs/ops/`, copia **todo** su contenido, pégalo en el SQL editor y presiona **Run**. Todos se pueden correr más de una vez y ninguno contiene secretos: usan el `cron_shared_secret` de Vault, que ya existe.

| # | Archivo | Tareas | Por qué en este orden |
|---|---|---|---|
| 1 | `programar-incidentes.sql` | `incidentes-vigilante-cada-2-min` | Es la red de seguridad: escala lo que nadie atiende, avisa al equipo y entrega los avisos que esperaban el fin del horario de no molestar. Va primero. |
| 2 | `programar-operador.sql` | `operador-cada-2-min` | Corre pero **no toma nada** mientras `operador_enabled = false`. No ejecutes los `UPDATE` comentados. |
| 3 | `programar-reclamos.sql` | `reclamos-seguimiento-diario` (15:41 UTC) | Sin `reclamos_enabled` no sale ningún correo. |
| 4 | `programar-comisiones.sql` | `comisiones-sync-diario`, `reservas-gestionadas-cada-hora` | Solo lee ventas. Ejecutar cambios con un proveedor sigue apagado. |
| 5 | `programar-vigilancia.sql` | `vigilancia-vuelos-cada-10-min`, `vigilancia-previos-cada-hora` | No hace nada mientras `vigilancia_enabled = false` (paso a6). |

Las tareas de `programar-tareas.sql` ya existen en producción: `flight-watch-every-15-min`, `price-watch-twice-daily` y `health-check-daily`. **No** la vuelvas a correr.

**Para seguir.** Corre esta consulta y revisa que salgan las **10 tareas** con `active = true`:

```sql
SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
```

Las 10 tareas son:
- comisiones-sync-diario
- flight-watch-every-15-min
- health-check-daily
- incidentes-vigilante-cada-2-min
- operador-cada-2-min
- price-watch-twice-daily
- reclamos-seguimiento-diario
- reservas-gestionadas-cada-hora
- vigilancia-previos-cada-hora
- vigilancia-vuelos-cada-10-min

**Cinco minutos después**, corre esta consulta. Las tareas que corren cada 2 minutos deben mostrar `status = succeeded`:

```sql
SELECT j.jobname, d.status, d.start_time, left(d.return_message, 80) AS mensaje
  FROM cron.job_run_details d JOIN cron.job j USING (jobid)
 WHERE d.start_time > now() - interval '10 minutes' ORDER BY d.start_time DESC LIMIT 20;
```

---

## d) Secretos: qué pegar, por canal o proveedor

Pégalos en Lovable → Cloud → **Secrets**: escribe el **nombre** exacto y pega el **valor**. **Nunca** los mandes por chat ni por correo.

**Ya existen; no los toques:**
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `LOVABLE_API_KEY`
- `GOOGLE_MAPS_API_KEY`
- `SERPAPI_PRIVATE_KEY`
- `TRAVELPAYOUTS_TOKEN`
- `VIATOR_API_KEY`

| Canal o proveedor | Secretos | ¿Obligatorio? |
|---|---|---|
| **Respuestas por correo**: reclamos, Operador y confirmaciones de la vigilancia | `RECLAMOS_INBOUND_SECRET`. En Resend se crea un **segundo webhook** `email.received` → `https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/reclamos-inbound`, y su *signing secret* es este valor. | **Sí**, para leer las respuestas de proveedores. Sin él, las respuestas no se procesan. |
| **SerpApi** (cupo) | `SERPAPI_DAILY_BUDGET=8` y `SERPAPI_MONTHLY_BUDGET=250` (plan gratis) | **Sí**, recomendado: frena el gasto de toda la cuenta. `SERPAPI_FLIGHTS_RESERVE` es opcional. |
| **Telegram** | `TELEGRAM_BOT_TOKEN`. Cómo crear el bot: `docs/iatos/IATOS_OPERADOR.md` §6. | Solo si quieres Telegram. Opcionales: `TELEGRAM_WEBHOOK_SECRET` y `TELEGRAM_BOT_USERNAME`. |
| **WhatsApp por Meta** | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` (o `WHATSAPP_PHONE_ID`) y `WHATSAPP_APP_SECRET` | Solo si quieres WhatsApp. Opcionales: `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMERO`, `WHATSAPP_GRAPH_VERSION`, `WHATSAPP_PROVIDER` y `WHATSAPP_WEBHOOK_URL`. Paso a paso: `docs/iatos/IATOS_CANALES.md` §4. |
| **WhatsApp por Twilio** (en lugar de Meta) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` y `TWILIO_WHATSAPP_CONTENT_SIDS` | Solo si eliges Twilio. |
| **Voz (Vapi)** | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VOZ_WEBHOOK_SECRET` y `VOZ_LLAMADAS_REALES=true` | **No**: queda apagada hasta que el dueño lo decida. Opcionales: `VAPI_MODEL` y `VAPI_STRUCTURED_OUTPUT_ID`. |
| **RateHawk** (comisiones de hoteles) | `RATEHAWK_KEY_ID`, `RATEHAWK_API_KEY` y `RATEHAWK_ENTORNO` | Solo cuando esté firmado el contrato. |
| **Viator sandbox** | `VIATOR_API_KEY_SANDBOX` | Opcional. |
| **Remitentes** | `VIGILANCIA_FROM_ADDRESS`, `OPERADOR_FROM_ADDRESS` y `RECLAMOS_FROM_ADDRESS` | Opcionales. Por omisión se usan `concierge@`, `operador@` y `reclamos@traveliatos.life`, que deben estar verificados en Resend. |
| **Interruptor de Iato por chats** | `CANALES_IATO=off` | Opcional: deja Telegram y WhatsApp solo para problemas. |

Las funciones leen los secretos al momento, así que no hace falta volver a desplegar. Después de pegar `TELEGRAM_BOT_TOKEN`, un administrador entra a la app → **Perfil → Ajustes → Telegram** → **"Conectar el bot"**.

---

## e) Publicar el frontend

1. **Antes de publicar**, el dueño aprueba lo que se ve nuevo (regla del candado: `docs/iatos/LO_QUE_NO_SE_TOCA.md`):
   - en Ajustes, las tarjetas WhatsApp, Avisos de IATOS y Contacto a proveedores;
   - la sección Vigilancia de la Mesa;
   - el tablero de comisiones.

   Las capturas se sacan con `npm run candado:visual`.
2. En Lovable, botón **Publish** (arriba a la derecha) → **Update**.
3. Espera a que diga que se publicó y abre https://traveliatos.life en una ventana privada.

El frontend va **al final**, cuando las migraciones (a) y las funciones (b) ya están arriba. Si sale antes, pide columnas y funciones que todavía no existen (`docs/ops/LEEME.md`).

---

## f) Smoke de producción

Córrelo desde una computadora con el repositorio clonado. La contraseña de la cuenta demo **solo** se pasa por variable de entorno.

```bash
npm i --no-save playwright@1.56.1 && npx playwright install chromium   # la primera vez
IATOS_SMOKE_EMAIL=… IATOS_SMOKE_PASSWORD=… npm run candado:smoke
```

**Qué revisar:**
- **Código de salida 0** y **OK 5/5**: entrar; Mis viajes con fotos; ruta con el globo 3D; un viaje con su foto y su total; Iato con su cuadro de mensaje y sus atajos.
- **`reporte.json` y las capturas en `smoke-out/<fecha>/`:**
  - Mis viajes debe tener **todas** sus tarjetas con foto (el 29 de octubre fueron 24 de 24).
  - El globo debe verse con tamaño (no 0x0).
  - Iato debe mostrar sus 8 atajos.
- **La lista de "bloqueado a propósito"** al final del reporte: es normal (el smoke no gasta nada).
- **Si sale 1 (FALLA):** se regresa a la versión anterior **antes** de investigar (paso i, punto 3).
- **Si sale 2:** faltan credenciales o Playwright; no es una falla de la app.

Además, entra con tu cuenta de administrador y revisa a mano:
- **/admin/operaciones:** carga, y se ve la sección Vigilancia.
- **Perfil → Ajustes:** se ven las tarjetas de Telegram, WhatsApp y Avisos de IATOS.

---

## g) Evaluación real del Operador desde el servidor (la llave no sale)

La función **`operador-eval`** corre los escenarios de la evaluación "no puede fallar" (`_shared/operador/eval/escenarios.ts`) con **IA real**.

**Qué hace y qué no:**
- La llave de Anthropic se queda en los secretos del servidor.
- Todo lo demás es memoria simulada: **no** escribe en la base real y **no** manda correos, mensajes ni push.
- **Solo administradores:** se valida la sesión y `public.admins`.
- Tiene un **tope de gasto por llamada**: 1 USD por omisión, máximo 5.
- Corre **una evaluación a la vez**, con un escenario por llamada. Cada escenario tarda de 30 a 90 segundos.
- Costo completo: unos 8 a 12 USD por los 95 escenarios. **Solo se corre con permiso del dueño.**

**Cómo correrla:**
1. Entra a https://traveliatos.life con tu cuenta de **administrador**.
2. Abre la consola del navegador: F12 → **Console**.
3. Pega este código. Primero corre 3 escenarios de prueba (unos 0.30 USD):

```js
const sesion = JSON.parse(localStorage.getItem("sb-uhkdewinscffhdonhhmt-auth-token"));
const evalOp = (body) => fetch("https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/operador-eval", {
  method: "POST", headers: { Authorization: `Bearer ${sesion.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body) }).then((r) => r.json());
for (const id of ["V01", "T01", "H01"]) console.log(id, await evalOp({ solo: [id], tope_usd: 1 }));
```

4. **Si los 3 salen con `fallas: []`**, corre la evaluación completa. El ciclo se detiene solo al terminar o al llegar a 15 USD:

```js
let desde = 0, gasto = 0; const todos = [];
while (desde !== null && gasto < 15) {
  const r = await evalOp({ desde, cantidad: 1, tope_usd: 1 });
  if (!r.ok) { console.warn("se detuvo en", desde, r); break; }
  todos.push(...r.escenarios); gasto += r.gasto_usd; desde = r.siguiente;
  console.log(`${todos.length}/${r.total_escenarios} · gasto ${gasto.toFixed(2)} USD`, r.escenarios.map((e) => `${e.id}:${e.fallas.join(",") || "ok"}`).join(" "));
}
console.table(todos.map((e) => ({ id: e.id, fallas: e.fallas.join(", "), usd: e.gasto_usd, incompleto: e.incompleto })));
```

**Cómo leer el resultado:**
- **`fallas: []`:** el escenario pasó.
- **`fallas` con nombres:** el escenario falló en esos criterios. Los criterios son:
  - `categoria`
  - `acciones_correctas`
  - `derechos`
  - `escalamiento`
  - `cero_perdidos`
  - `nada_inventado`
  - `horario_proveedor`
  - `sin_consentimiento_nada`
  - `una_busqueda`

  `bitacora` muestra lo que hizo el Operador en ese escenario.
- **Encender el Operador (paso h) exige:** **cero** fallas en `nada_inventado` y en `sin_consentimiento_nada`, y que el dueño revise las demás.

**Respuestas de error:**

| Respuesta | Qué significa |
|---|---|
| `401` o `403` | No entraste con una cuenta de administrador. |
| `503 SIN_LLAVE` | Falta `ANTHROPIC_API_KEY`. |
| `409 OCUPADO` | Ya hay otra evaluación corriendo. |
| `504` | Un escenario tardó más de 150 segundos: repítelo con `{ solo: ["ID"] }`. |

Si en la consola sale un 401 que pide `apikey`, agrega el encabezado `apikey` con la llave pública del proyecto (`VITE_SUPABASE_PUBLISHABLE_KEY` del `.env` del repositorio).

---

## h) Encender, en orden seguro

Enciende **una cosa a la vez**. Antes de pasar a la siguiente, deja pasar **al menos un día** y revisa la Mesa (/admin/operaciones). Cada encendido es un `UPDATE` en el SQL editor.

**1. Canales.**
- Telegram: "Conectar el bot" (paso d).
- WhatsApp: solo después de que Meta apruebe las plantillas `iatos_aviso_caso` e `iatos_aviso_vuelo` (`IATOS_CANALES.md` §4).

**2. Vigilancia proactiva.**
- Avisa de cambios de vuelo, check-in, documentos, clima extremo y alertas oficiales.
- Los avisos salen por la entrega de canales del Operador:
  - por el canal preferido de cada viajero;
  - respetando su horario de no molestar;
  - lo urgente sale ya, por todos sus canales;
  - como máximo 3 avisos no urgentes al día por viajero.
- Solo escribe a un proveedor si el viajero lo autorizó.

```sql
UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'vigilancia_enabled';
```

**3. Operador IA.** Solo con la evaluación g revisada.
- Encendido, los casos nuevos los toma el Operador.
- Si deja de dar señal (latido cada 2 minutos), van directo al equipo humano.
- Se enciende con **una sola** bandera, `app_flags.operador_enabled`. La columna `incident_config.ai_operator_enabled` hace lo mismo; déjala en `false` para que haya un solo interruptor.

```sql
UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'operador_enabled';
-- Verificar: el latido debe ser de hace menos de 5 minutos.
SELECT ai_operator_enabled, ai_operator_heartbeat_at FROM public.incident_config;
```

**4. Envío de reclamos.** Hace falta que antes funcione `RECLAMOS_INBOUND_SECRET` con el webhook de Resend. El reclamo sale solo cuando el viajero responde "Sí, envía C-…".

```sql
UPDATE public.app_flags SET value = 'true'::jsonb, updated_at = now() WHERE key = 'reclamos_enabled';
```

**5. Comisiones: ejecutar cambios, reservar con proveedores y cobrar cargo por servicio.**
- Se queda en `false` hasta que estén firmados los contratos.
- Pasos: `docs/ops/programar-comisiones.sql` §3 y §4.

---

## i) Apagar todo en un minuto

Pega este bloque en el SQL editor y presiona **Run**. Hace tres cosas:
- **apaga** el Operador, la vigilancia, el envío de reclamos y las comisiones;
- **pausa** sus tareas automáticas;
- **deja encendida la red de seguridad:** el vigilante de incidentes y los avisos al equipo, el seguimiento de vuelos, las alertas de precio y la revisión diaria.

Con esto, todo caso nuevo va directo al equipo humano, como antes.

```sql
UPDATE public.app_flags SET value = 'false'::jsonb, updated_at = now()
 WHERE key IN ('operador_enabled','vigilancia_enabled','reclamos_enabled','comisiones_sync_enabled',
               'reservas_gestionadas_cambios_enabled','proveedores_reservas_enabled','cargo_servicio_enabled');
UPDATE public.incident_config SET ai_operator_enabled = false WHERE id;
SELECT cron.alter_job(jobid, active := false) FROM cron.job
 WHERE jobname IN ('operador-cada-2-min','vigilancia-vuelos-cada-10-min','vigilancia-previos-cada-hora',
                   'reclamos-seguimiento-diario','comisiones-sync-diario','reservas-gestionadas-cada-hora');
SELECT key, value FROM public.app_flags WHERE key LIKE '%enabled' ORDER BY key;
SELECT jobname, active FROM cron.job ORDER BY jobname;
```

**Si hace falta más:**
1. **Chats (Telegram y WhatsApp):**
   - En Secrets, pon `CANALES_IATO=off` para dejar los chats solo para problemas.
   - Para cortar un canal por completo, borra `TELEGRAM_BOT_TOKEN` o `WHATSAPP_TOKEN`: el webhook responde 503 y no sale nada.
2. **Llamadas de voz:** ya están apagadas sin `VOZ_LLAMADAS_REALES=true`.
3. **Frontend:** en Lovable → historial de versiones, elige la versión anterior → **Restore** → **Publish**.

**Qué no hace falta tocar:**
- **Las migraciones:** no se revierten, porque solo agregan tablas y funciones.
- **Las funciones:** con las banderas apagadas no hacen nada.

**Para volver a encender:** usa el mismo bloque con `active := true` y `'true'::jsonb`, una cosa a la vez, como en el paso h.
