# Operador IATOS

Pedido del dueño (29-oct-2026): *un bot especializado que resuelva TODOS los problemas de los viajeros, 24/7, que entienda cualquier queja, revise los derechos del viajero, mande correos y vea todo. "No puede fallar." Los humanos (dueño y Carlo) son el respaldo.*

Estado: **construido y probado, APAGADO**. No hay nada desplegado ni migraciones aplicadas. Se enciende con una bandera (`operador_enabled`) cuando el dueño lo apruebe.

---

## 1. Cómo funciona (para el dueño, en 10 líneas)

1. Un viajero tiene un problema: lo dice en la app ("Tengo un problema"), en el chat con Iato o por Telegram.
2. Al instante se abre un **caso con folio** y el viajero recibe qué hacer ya (eso existía y sigue igual).
3. Si el operador está encendido, el caso es suyo primero: **lo trabaja en segundos**, a cualquier hora.
4. Usa herramientas reales: revisa sus derechos (ley de cada país), el estado del vuelo, busca un vuelo alterno (una vez), lugares cercanos (hospital, policía, consulado, hotel), el contacto oficial del hotel o del chofer.
5. Le escribe al viajero (app, Telegram, correo) qué hizo, qué sigue y **a qué hora** le vuelve a escribir.
6. Le escribe al proveedor por correo, solo a un correo **con fuente** (su sitio oficial, la reserva o lo que dio el viajero), y **en el horario del proveedor**; la respuesta vuelve sola al caso.
7. Prepara reclamaciones formales, pero **solo las envía si el viajero escribe "Sí, envía C-…"**. Para ver los datos del viajero también pide permiso.
8. **Nunca paga, reserva ni cancela**; no promete reembolsos; no inventa correos, teléfonos ni datos (si lo intenta, el sistema lo bloquea).
9. **Si duda, pasa el caso a una persona** (dueño o Carlo) con un resumen: salud, seguridad, quejas contra IATOS, si el viajero lo pide, si la IA falla o si llega a un tope de gasto.
10. Todo queda en la **bitácora** del caso en la Mesa de operaciones: cada acción, cada mensaje, el gasto en IA, y si pasó a una persona y por qué.

---

## 2. Herramientas del operador (`supabase/functions/_shared/operador/herramientas.ts`)

| Herramienta | Qué hace | Límite |
|---|---|---|
| `ver_viaje` | "Ver todo": viaje, vuelos, reservas, documentos (enmascarados), gastos, conversaciones, correos reenviados, reclamos | Solo con el **sí del viajero escrito en el caso** (la base lo comprueba: `operator_consent`) |
| `pedir_permiso` | Pregunta sí/no al viajero (ver todo, enviar un reclamo) | Máx. 4 mensajes por corrida |
| `revisar_derechos_vuelo` / `revisar_derechos_servicio` | Motor de derechos (MX, UE 261, UK261, DOT, Canadá, Brasil, Montreal; hotel/traslado → banco → PROFECO) | Sin red, con fuente y certeza |
| `preparar_reclamo` | Carta formal con folio C-XXXXXX | No envía nada. Correo del proveedor solo si ya está en el caso con fuente |
| `enviar_reclamo` | Envía el reclamo | Solo con "Sí, envía C-…" del viajero (sin negación) y la bandera `reclamos_enabled` |
| `estado_vuelo` | Estado desde la caché de seguimiento | Gratis (sin búsqueda) |
| `buscar_vuelos_alternativos` | Busca vuelos con la caché compartida y el cupo del viajero (flights-search) | **Una por caso** (la base lo impide) |
| `opciones_traslado` | Opciones honestas para moverse (taxi oficial, app, transporte, pedir a una persona) | Sin precios inventados |
| `lugares_cercanos` | Hospital, policía, embajada, farmacia, hotel, cajero (Google Places) | Requiere ubicación compartida |
| `buscar_contacto_proveedor` | Contacto oficial (reservas del viajero, sitio oficial, Google Places, como Reservas IA) | Nunca adivina un correo |
| `escribir_proveedor` | Correo al proveedor (Reply-To `operador+<token>@reply.traveliatos.life`) | Solo contactos con fuente; en su horario local; máx. 3 por caso |
| `escribir_viajero` | App + push + Telegram (si lo vinculó) + correo si es urgente | Bloquea promesas indebidas y correos/teléfonos sin verificar |
| `prometer_seguimiento` | Hora en que le vuelve a escribir (si vence, el vigilante avisa al equipo) | 5 min – 24 h |
| `pedir_humano` | Pasa el caso a una persona con resumen | — |
| `proponer_cierre` | Pregunta "¿quedó resuelto?" | El caso NO se cierra sin el viajero |

**No existe ninguna herramienta para pagar, reservar o cancelar.**

### Límites de seguridad (los hace cumplir la base o el código, no el modelo)

- Bandera `app_flags.operador_enabled` (nace en `false`). Apagado: no toma nada y no gasta.
- **Candado por incidente** (`operator_claim`, 120 s): nunca dos operadores en el mismo caso. **Idempotente**: solo trabaja lo nuevo de la bitácora (marca de agua); sin nada nuevo no llama a la IA.
- **Topes por caso** (`operator_config`): 25 acciones, US$0.80 de IA, 1 búsqueda de vuelos, 3 correos a proveedores, 40 corridas al día. Al llegar a uno: pasa a una persona.
- Máximo 8 vueltas del modelo por corrida.
- **Red de seguridad**: sin IA, error, negativa del modelo, bucle o tope → persona. Salud y seguridad → siempre persona. Si el viajero escribió y el operador no le contestó → persona. Si no quedó nada prometido → se fija una hora de seguimiento (ningún caso queda sin siguiente paso).
- Lo crítico (de noche sin traslado, robo…) lo sigue el operador, pero **el equipo humano ya quedó avisado** al crearse el caso.
- Firma honesta: el viajero y el proveedor saben que escribe la IA de IATOS (AI Act art. 50).

### Modelo

El de la configuración existente (`_shared/claude.ts`): `ANTHROPIC_MODEL` si existe y, si no, el vigente (`claude-sonnet-5-5`), con respaldo del servidor. El gasto de cada llamada se calcula con los precios públicos (Sonnet 5.5: US$2 / US$10 por millón de tokens) y se descuenta del tope del caso.

---

## 3. Disparo

- **Al crearse un incidente** (función `incidente`, Iato en `concierge-chat`, Telegram): si el caso es del operador, se le despierta ya.
- **Cuando llega una respuesta**: el viajero escribe en la app (la app despierta al operador), por Telegram (`telegram-webhook`) o el proveedor responde por correo (`reclamos-inbound`, dirección `operador+<token>@`). Además, un trigger de la base marca el caso como "despertado" con cada mensaje entrante.
- **Desde el vigilante** (`incidentes-vigilante`, cada 2 min) y su propia tarea programada (`operador`, cada 2 min): casos con algo nuevo, horas de seguimiento vencidas y correos programados a proveedores.

---

## 4. Canales

| Canal | Estado | Qué falta |
|---|---|---|
| App + push | Activo | — |
| Correo | Activo (Resend) | — |
| **Telegram** | Implementado, **apagado** | El secreto `TELEGRAM_BOT_TOKEN` (ver §6) |
| WhatsApp (Meta Cloud API o Twilio) | Interfaz lista (`_shared/channels/whatsapp.ts`), **no registrada** | Aprobación del dueño, plantillas aprobadas por Meta, verificación del negocio y sus secretos |
| Voz (Twilio + Retell/Vapi) | Interfaz lista (`_shared/channels/voz.ts`), **sin llamadas reales** | Aprobación del dueño, número de Twilio México y cuenta de Retell o Vapi |

En Telegram, el viajero vincula su cuenta desde la app (**Perfil → Ajustes → Telegram → Vincular Telegram**): la app le da un código de 8 letras de un solo uso (15 min) y un botón que abre el bot. Ya vinculado, lo que escribe al bot entra al **mismo caso** abierto (o abre uno nuevo si cuenta un problema) y el operador le contesta por ahí. Para planear o buscar, el bot lo manda a la app (pendiente: el chat completo de Iato por Telegram).

---

## 5. Lo que hay que desplegar (cuando el dueño lo apruebe)

**Migraciones, en este orden** (ninguna está aplicada):

1. `20261029080000_incidentes.sql`
2. `20261029090000_reclamos.sql`
3. `20261029100000_operador.sql`

**Funciones nuevas:** `incidente`, `incidentes-vigilante`, `reclamos`, `reclamos-inbound`, `reclamos-cron`, `operador`, `telegram-webhook`, `canales`.

**Funciones con cambios:** `concierge-chat`, `ops-desk`, `reservations-inbound`, `ai-reservations`, `ai-reservations-cron` (comparten `_shared/ai-reservations/service.ts`), `flights-search` y `places-nearby` no cambian (el operador reutiliza su lógica).

**Tareas programadas (pg_cron):**
- `incidentes-vigilante-cada-2-min` → `docs/ops/programar-incidentes.sql`
- `operador-cada-2-min` → `docs/ops/programar-operador.sql`
- `reclamos-cron` diario → ver `docs/iatos/IATOS_DERECHOS_RECLAMOS.md`

---

## 6. Secretos (paso a paso para el dueño)

Dónde se pegan: **Lovable → tu proyecto → Cloud → Secrets** (o en Supabase → Edge Functions → Secrets). Se escribe el **nombre** exacto y se pega el **valor**. Nunca los mandes por chat ni correo.

| Secreto | Para qué | ¿Obligatorio? |
|---|---|---|
| `ANTHROPIC_API_KEY` | La IA del operador (ya existe para Iato) | Ya está |
| `RESEND_API_KEY` / `LOVABLE_API_KEY` | Correos (ya existen) | Ya están |
| `TELEGRAM_BOT_TOKEN` | Prender Telegram | Solo para Telegram |
| `OPERADOR_FROM_ADDRESS` | Remitente de los correos a proveedores (por omisión `operador@traveliatos.life`; debe estar verificado en Resend) | Opcional |
| `RECLAMOS_INBOUND_SECRET` | Webhook de respuestas (reclamos y operador) en Resend | Para leer respuestas de proveedores |
| `TELEGRAM_WEBHOOK_SECRET` | Solo si se quiere un secreto propio; si no, se deriva del token | Opcional |

### Crear el bot de Telegram con BotFather (5 minutos)

1. En tu teléfono abre **Telegram** y busca **@BotFather** (tiene la palomita azul de verificado).
2. Toca **Iniciar** y escribe `/newbot`.
3. Te pide un **nombre** visible: escribe, por ejemplo, `IATOS Operador`.
4. Te pide un **usuario** que termine en `bot`: por ejemplo `IatosOperadorBot` (si está ocupado, prueba otro).
5. BotFather te responde con un mensaje que incluye una línea larga como `123456789:AAH...`. **Ese es el token.** Cópialo (mantén presionado → Copiar). No lo compartas con nadie.
6. Opcional, en el mismo chat: `/setdescription` para el texto del bot ("Ayuda 24/7 para tu viaje con IATOS") y `/setuserpic` para poner el logo.
7. Entra a **Lovable → tu proyecto → Cloud → Secrets → Add secret**. Nombre: `TELEGRAM_BOT_TOKEN`. Valor: pega el token. Guarda.
8. (Cuando las funciones estén desplegadas) entra a la app con tu cuenta de administrador → **Perfil → Ajustes → Telegram** → toca **"Conectar el bot (administradores, una sola vez)"**. Debe decir "Bot conectado: @IatosOperadorBot".
9. Prueba: en esa misma tarjeta toca **Vincular Telegram**, abre el bot y toca **Iniciar**. El bot responde "Listo: tu cuenta de IATOS quedó vinculada".
10. Para apagar Telegram: borra el secreto `TELEGRAM_BOT_TOKEN` (el bot deja de responder).

---

## 7. Encender y apagar

```sql
-- Encender (con el visto bueno del dueño):
UPDATE public.app_flags SET value = 'true'::jsonb WHERE key = 'operador_enabled';
-- Apagar de inmediato:
UPDATE public.app_flags SET value = 'false'::jsonb WHERE key = 'operador_enabled';
```

Encendido, los casos nuevos nacen del operador (si da latido); apagado o caído, van directo al equipo humano como hoy.

---

## 8. Pruebas

- SQL: `supabase/tests/operador` (33 casos: bandera, candado, idempotencia, despertar, topes, consentimiento, correos con fuente y horario, Telegram, permisos).
- Vitest: `operador.test.ts` (bucle y límites), `operadorCanales.test.ts` (Telegram, respuesta del proveedor, WhatsApp/voz apagados), `operadorIntegracion.test.ts` (reclamos → incidentes), `operadorUi.test.tsx` (vincular Telegram, bitácora en la Mesa).
- **Evaluación "no puede fallar"**: `operadorEval.test.ts`, 95 escenarios de punta a punta con mocks (vuelos, traslados, hoteles, equipaje, documentos, robos, salud, seguridad, cobros, quejas, ambiguos, Telegram, en español, inglés y con faltas, y 12 donde el modelo se porta mal a propósito). Revisa en cada uno: caso creado, respuesta inmediata útil, acciones, derechos, escalamiento, cero casos perdidos, nada inventado, horario del proveedor y nada sin consentimiento.
- **Con IA real** (cuesta dinero, ~US$8–12 con Sonnet 5.5; correr solo con permiso):
  ```bash
  npm i --no-save @anthropic-ai/sdk
  OPERADOR_EVAL_REAL=1 ANTHROPIC_API_KEY=… npx vitest run src/test/operadorEval.test.ts
  # una parte: OPERADOR_EVAL_SOLO=V01,T01,H01
  ```

---

## 9. Pendientes

1. Aplicar las 3 migraciones, desplegar las funciones y programar las tareas (§5).
2. Correr la evaluación con IA real (con permiso) y revisar los casos que fallen antes de encender.
3. Encender `operador_enabled` (y `reclamos_enabled` para enviar reclamos) con el visto bueno del dueño.
4. Telegram: crear el bot y pegar el token (§6). El chat general de Iato por Telegram (planear/buscar) queda pendiente: hoy el bot atiende problemas y manda lo demás a la app.
5. WhatsApp y voz: decisión del dueño (costos en el estudio de negocio de la agencia, §6 "Bot operador con IA").
6. Verificar en Resend el remitente `operador@traveliatos.life` (o fijar `OPERADOR_FROM_ADDRESS`) y que el webhook de reclamos reciba `operador+…@reply.traveliatos.life`.
