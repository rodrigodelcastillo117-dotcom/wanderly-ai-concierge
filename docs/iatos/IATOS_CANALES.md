# IATOS por Telegram, WhatsApp y voz

Pedido del dueño (30-oct-2026): *el viajero habla con IATOS por donde quiera, con la misma calidad que en la app, y el Operador le responde por ese mismo canal.*

Estado: **construido y probado, APAGADO** hasta que existan los secretos de cada canal. Nada desplegado ni migraciones aplicadas.

---

## 1. Qué puede hacer el viajero por cada canal

| | App | Telegram | WhatsApp | Llamada de voz |
|---|---|---|---|---|
| Hablar con Iato completo: planear, preguntar por su viaje, vuelos, hoteles, qué hacer, clima, hora local, eventos, avisos de viaje | Sí | **Sí** (mismo Iato, misma memoria) | **Sí** | No (no hay línea de entrada) |
| Gastos: "¿cuánto llevo?" y registrar uno | Sí | **Sí**, y con la **foto del ticket** | **Sí**, y con la **foto del ticket** | — |
| Acciones (registrar gasto, agregar al itinerario, alerta de precio, seguir un vuelo…) | Botón en la tarjeta | Botones **✅ Confirmar / Cancelar** | Botones **Confirmar / Cancelar** (por Twilio: responder "sí <código>") | — |
| "¿Qué hay cerca?" con su ubicación | Sí | Compartir ubicación (vale 2 h) | Compartir ubicación (vale 2 h) | — |
| Reportar un problema y que el Operador lo trabaje | Sí | Sí (folio y guía inmediata) | Sí (folio y guía inmediata) | — |
| El Operador le contesta | App + push | Por el chat | Por el chat (fuera de 24 h, con plantilla aprobada) | — |
| Llamadas a proveedores (hotel, chofer) | — | — | — | **Preparado, apagado** (§6) |

Lo que **no** se hace por chat (y Iato lo dice): pagar, subir documentos a la bóveda, Privé (requiere la sesión de la app). Nada se registra ni se reserva sin el toque del viajero en **Confirmar**.

**Cómo decide el chat** (`supabase/functions/_shared/channels/conversacion.ts`):
1. Código de vinculación → vincula. Chat sin vincular → le dice cómo (no lee nada de nadie).
2. Botón → ejecuta esa acción **una sola vez**, solo desde el mismo chat y si sigue vinculado a la misma cuenta.
3. Ubicación → la guarda 2 horas (y si hay un caso abierto, va a su bitácora).
4. Foto → la lee `scan-receipt` y propone "Registrar gasto".
5. Con un caso abierto, va al **caso** (Operador) si: empieza con "caso", menciona el folio o un reclamo (C-…), cuenta un problema, o el Operador le escribió en las últimas 3 h (o es un "sí/ok" a algo de las últimas 24 h). Si no, va a Iato con el recordatorio "Tu caso … sigue abierto".
6. Un problema nuevo → caso con folio y guía inmediata (sin depender de la IA), el Operador lo toma.
7. Lo demás → **Iato completo**.

---

## 2. Seguridad (cómo Iato habla "como" el viajero sin exponer llaves)

- **Sesión real del viajero.** Para cada turno, el servidor abre una sesión del usuario que la base dice vinculado a ese chat (enlace mágico generado y canjeado en el servidor; **no se manda ningún correo**), llama a `concierge-chat` con **su** JWT y la cierra al terminar (solo esa sesión, nunca las de su teléfono). Así aplican **RLS, su plan (gratis/PRO), sus cuotas, sus límites y la honestidad** exactamente como en la app.
- **Firma interna atada al usuario** (`x-iatos-internal: canal_telegram|canal_whatsapp`, HMAC con la llave de servicio, 10 min, mismo patrón que `internalCall.ts`/`isAnalysisCall`). Solo cambia el formato (JSON corto, sin tablas) y quita la cubeta por IP (la IP es la de nuestro servidor). **No salta cuotas ni permisos.** Una firma de otro usuario, vencida o alterada → 401. Una firma de canal no sirve como "análisis" (que sí evita gastar búsquedas).
- **La llave de servicio nunca sale del servidor** ni el token del usuario se guarda.
- Solo usuarios con **correo confirmado** y no bloqueados; la sesión obtenida debe ser del mismo `user_id` (si no, se cierra y se rechaza).
- **Webhooks firmados:** Telegram (`X-Telegram-Bot-Api-Secret-Token`), Meta (`X-Hub-Signature-256` con el app secret, y la verificación GET con el token), Twilio (`X-Twilio-Signature`), voz (`x-iatos-voz` firmado y atado al caso). Sin firma correcta → 401; sin secretos → 503 (apagado).
- **Aislamiento probado:** cada chat solo habla con la sesión de su cuenta; un botón de Ana no funciona desde el chat de Beto ni si el chat cambia de cuenta; la ubicación de un chat no se lee desde otro.
- Idempotente: el mismo mensaje del proveedor (reintentos) se procesa una sola vez.
- El texto del modelo se escapa antes de mandarlo (no se puede inyectar HTML en Telegram) y solo se usan enlaces https.

---

## 3. Preferencias del viajero (Perfil → Ajustes → Avisos de IATOS)

- **Canal preferido:** notificaciones de la app, Telegram, WhatsApp (solo si está vinculado) o correo.
- **No molestar** (por ejemplo 22:00 a 08:00, en su zona horaria).
- Reglas (`_shared/channels/entrega.ts`), las respetan el **Operador** y la **vigilancia de vuelos**:
  - **Urgente** (el Operador lo marca urgente; vuelo cancelado o desviado; cualquier cambio de un vuelo de hoy o mañana): **por todos los canales disponibles, ya**, aunque sea de noche.
  - Normal en horario de no molestar: no suena nada; queda en la app y se entrega al terminar el horario (cola `channel_deferred`, la reparte el vigilante cada 2 min).
  - Normal: el canal preferido; si falla, el siguiente (push → Telegram → WhatsApp → correo). Si nada sale, correo de respaldo.
  - Si desvincula su canal preferido, vuelve a "app" (nunca se queda sin avisos).

---

## 4. WhatsApp paso a paso (para el dueño)

### 4.1 Qué cuesta (cifras del estudio de negocio, §6.b)

- **Meta cobra por mensaje entregado**; lo que escribe el viajero es **gratis**.
- Dentro de la **ventana de 24 h** (desde el último mensaje del viajero) se contesta con mensajes de "servicio": **1,000 gratis al mes por número**; a partir del 1,001 se cobran (desde el 1-oct-2026).
- Fuera de la ventana solo se pueden mandar **plantillas aprobadas**. Las nuestras son de **utilidad**. Referencia de terceros para México **antes del alza de oct-2026** (ChatDaddy, mar-2026): utilidad **US$0.0086**, marketing US$0.0362, autenticación US$0.0172 por mensaje. **No pude verificar la tarifa oficial vigente**: revísala en el [selector oficial de Meta](https://whatsappbusiness.com/products/platform-pricing/) (desde el 1-ene-2026 hay lista en pesos).
- **Meta directo:** solo la tarifa por mensaje (no encontramos cuota de hospedaje).
- **Twilio** (alternativa): **US$0.005 por mensaje** enviado o recibido además de la tarifa de Meta; US$0.001 por mensaje fallido.
- Ejemplo (estimado, no cotización): 1,000 avisos con plantilla al mes ≈ US$8.60 con la cifra de referencia; las respuestas dentro de las 24 h entran en los 1,000 gratis. Por Twilio se sumarían ~US$5 por esos 1,000 envíos (más US$0.005 por cada mensaje recibido).
- Sin verificar el negocio se puede empezar con un límite de **250 conversaciones iniciadas por el negocio cada 24 h**. La verificación tarda de **1 a 10 días hábiles**; el nombre visible, de 6 a 12 h por intento (se rechaza si no coincide con la web o la página de Facebook).

### 4.2 Dar de alta el número (Meta Cloud API directa, recomendado)

1. Entra a **business.facebook.com** con la cuenta de Facebook de la empresa. Si no existe, crea el **portafolio comercial** "IATOS" con el nombre legal y la web `traveliatos.life`.
2. Ve a **developers.facebook.com → Mis apps → Crear app → Otro → Negocio**. Nómbrala "IATOS WhatsApp" y elige tu portafolio.
3. En la app, agrega el producto **WhatsApp** → **Configuración de la API**.
4. **Agrega tu número**: "Agregar número de teléfono". Usa un número que **no** tenga WhatsApp instalado (o bórralo de la app primero). Escribe el **nombre visible** "IATOS" (igual que en la web). Confirma con el código por SMS o llamada.
5. **Token permanente**: en el portafolio → **Configuración del negocio → Usuarios del sistema → Agregar** (rol Administrador) → **Generar token**, elige la app y marca `whatsapp_business_messaging` y `whatsapp_business_management`. Copia el token (empieza con `EAA…`).
6. Copia también: el **Identificador del número de teléfono** (Phone number ID, en "Configuración de la API") y la **Clave secreta de la app** (App → Configuración → Básica → "Clave secreta de la app" → Mostrar).
7. **Pega los secretos** en **Lovable → tu proyecto → Cloud → Secrets** (o Supabase → Edge Functions → Secrets):

   | Nombre | Valor |
   |---|---|
   | `WHATSAPP_TOKEN` | el token permanente (`EAA…`) |
   | `WHATSAPP_PHONE_NUMBER_ID` | el identificador del número |
   | `WHATSAPP_APP_SECRET` | la clave secreta de la app |
   | `WHATSAPP_NUMERO` (opcional) | tu número público, ej. `+5215512345678` (si no, se lee de Meta) |

8. (Con las funciones desplegadas) entra a la app como administrador → **Perfil → Ajustes → WhatsApp → "Datos para conectar WhatsApp en Meta"**. Te muestra la **URL del webhook** y el **token de verificación**.
9. En Meta: **WhatsApp → Configuración → Webhook → Editar**: pega la URL y el token → **Verificar y guardar**. Luego en "Campos del webhook" suscribe **messages**.
10. **Somete las plantillas** (WhatsApp → Administrador de plantillas → Crear plantilla → categoría **Utilidad**). Copia exactamente el texto de §4.4. La revisión puede tardar **hasta 24 h**; solo se mandan las **aprobadas**.
11. Agrega un **método de pago** en el portafolio (WhatsApp Manager → Configuración de pagos): sin él, Meta deja de entregar los mensajes de servicio cobrados.
12. **Prueba**: en la app, **Perfil → Ajustes → WhatsApp → Vincular WhatsApp → Abrir WhatsApp** y envía el mensaje que ya viene escrito. Debe contestar "Listo: tu cuenta de IATOS quedó vinculada".
13. **Apagar**: borra el secreto `WHATSAPP_TOKEN` (el webhook responde 503 y no se manda nada).

### 4.3 Alternativa: Twilio

Secretos `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (`whatsapp:+52…`) y, para las plantillas, `TWILIO_WHATSAPP_CONTENT_SIDS` = `{"iatos_aviso_caso":"HX…","iatos_aviso_vuelo":"HX…"}` (los Content SID aprobados). En la consola de Twilio, en el remitente de WhatsApp, pon como "When a message comes in" la URL del webhook (`…/functions/v1/whatsapp-webhook`, método POST). Si Twilio llama a otra URL pública, ponla en `WHATSAPP_WEBHOOK_URL` (la firma se calcula sobre esa URL). Con Twilio las acciones se confirman respondiendo "sí <código>" (sin botones). Para forzar un proveedor: `WHATSAPP_PROVIDER=meta|twilio`.

### 4.4 Plantillas listas para someter (categoría Utilidad)

**`iatos_aviso_caso`** — avisos de un caso abierto cuando el viajero no ha escrito en 24 h.
- Español (es_MX): `Hola {{1}}, hay novedades en tu caso {{2}} con IATOS: {{3}}` *(salto de línea doble)* `Responde a este mensaje para seguir por aquí con el operador de IATOS.`
- Pie: `IATOS · asistente de viaje con IA`
- Ejemplos: `Ana` · `AB12CD34` · `localizamos a tu chofer y llega en 10 minutos a la puerta 3`
- Inglés (en_US): `Hi {{1}}, there is an update on your IATOS case {{2}}: {{3}}` *(salto de línea doble)* `Reply to this message to continue here with the IATOS operator.` — Pie: `IATOS · AI travel assistant`.

**`iatos_aviso_vuelo`** — cambios de un vuelo que el viajero sigue (puerta, retraso, cancelación).
- Español (es_MX): `Aviso de tu vuelo {{1}} del {{2}}: {{3}}` *(salto de línea doble)* `Te seguimos avisando por aquí. Si necesitas ayuda, responde a este mensaje.`
- Pie: `IATOS · seguimiento de vuelos`
- Ejemplos: `AM 401` · `12 de noviembre` · `cambió de puerta a la B12 y sale a las 14:35`
- Inglés (en_US): `Update on your flight {{1}} on {{2}}: {{3}}` *(salto de línea doble)* `We will keep you posted here. If you need help, reply to this message.` — Pie: `IATOS · flight tracking`.

(El texto vive en `supabase/functions/_shared/channels/whatsapp.ts`, `PLANTILLAS_WHATSAPP`; una prueba revisa que ninguna empiece ni termine con una variable.)

---

## 5. Telegram

Igual que antes (IATOS_OPERADOR.md §6): crear el bot con @BotFather y pegar `TELEGRAM_BOT_TOKEN`. Después de desplegar, un administrador toca **"Conectar el bot"** otra vez (ahora el webhook recibe también los toques de botones). Costo: gratis.

Para dejar Telegram/WhatsApp solo para problemas (sin Iato completo): secreto `CANALES_IATO=off`.

---

## 6. Voz (solo preparación, apagado)

- Proveedor: **Vapi** (`_shared/channels/voz.ts`). Elegido porque su API permite crear la llamada con un asistente transitorio (guion, primera frase y duración por llamada) y salidas estructuradas; Retell exige un agente creado antes y no documenta su firma de webhooks fuera de su SDK.
- Toda llamada abre: *"Hola, soy el asistente de IA de IATOS, llamo en nombre de <viajero> por su reserva <X>. Esta llamada puede grabarse."* Máximo 3 minutos, nunca ventas, no paga ni cancela. Resultado estructurado (`contesto`, `confirmado`, `resumen`, `dato_clave`, `siguiente_paso`, `requiere_humano`) a la bitácora del caso, marcado **"dicho por teléfono, sin comprobante"**, y despierta al Operador.
- **No hay llamadas reales**: hacen falta `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` (un número de Twilio México importado a Vapi), `VOZ_WEBHOOK_SECRET` **y** `VOZ_LLAMADAS_REALES=true` (permiso explícito del dueño). Opcionales: `VAPI_STRUCTURED_OUTPUT_ID` (crear una vez en Vapi con el esquema `RESULTADO_LLAMADA_SCHEMA`) y `VAPI_MODEL` (verificar el nombre en la lista de modelos de Vapi).
- Aún no hay una herramienta del Operador que llame (decisión del dueño). Costo estimado: US$0.10–0.35 por minuto + US$6.25–15 al mes por el número (estudio de negocio §6.c).

---

## 7. Qué desplegar

**Migración** (después de las 3 del Operador, ya aplicadas): `supabase/migrations/20261030030000_canales.sql`.

**Funciones nuevas:** `whatsapp-webhook`, `voz-webhook`.

**Funciones con cambios:** `telegram-webhook`, `canales`, `concierge-chat` (modo canal), `scan-receipt` (modo canal), `operador` (avisos con preferencias), `flight-watch-cron` (avisos por canales con preferencias), `incidentes-vigilante` (reparte los avisos diferidos), y las que empaquetan `_shared/incident-runtime.ts` u `_shared/operador/runtime.ts` (registran WhatsApp en el registro de canales y usan los avisos con preferencias): `incidente`, `ops-desk`, `reclamos-inbound`. (El cambio en `_shared/rate-limit-core.ts` e `_shared/internalCall.ts` no cambia el comportamiento de las demás funciones: no hace falta redesplegarlas por esto.)

Sin tareas programadas nuevas (el vigilante ya corre cada 2 min).

## 8. Secretos

| Secreto | Para qué | ¿Obligatorio? |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegram | Para Telegram |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` | WhatsApp por Meta | Para WhatsApp |
| `WHATSAPP_NUMERO`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_VERSION` | Número público, token propio de verificación, versión de la API (por omisión v26.0) | Opcionales |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_CONTENT_SIDS`, `WHATSAPP_WEBHOOK_URL` | WhatsApp por Twilio | Solo si se usa Twilio |
| `CANALES_IATO=off` | Dejar los chats solo para problemas | Opcional |
| `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VOZ_WEBHOOK_SECRET`, `VOZ_LLAMADAS_REALES` | Voz (apagada) | Solo con aprobación |

## 9. Pruebas

- Vitest: `src/test/canales.test.ts` (firmas de webhooks, vinculación, conversación completa por Telegram con herramientas, botón y ticket, aislamiento entre usuarios, ventana de 24 h y plantillas, no molestar, voz), `src/test/canalesUi.test.tsx` (Ajustes), más las de siempre (`operadorCanales`, `incidentesNucleo`, `audSeguridadEdge` con las compuertas de los webhooks nuevos).
- SQL: `supabase/tests/canales` (28 casos).

## 10. Pendientes

1. Aplicar la migración y desplegar (§7); el administrador vuelve a tocar "Conectar el bot" de Telegram.
2. WhatsApp: alta del número, plantillas aprobadas, método de pago y verificación del negocio (§4). Confirmar la tarifa oficial vigente en México.
3. Los límites de verificación de Supabase Auth (`/verify`, por IP) cuentan cada turno por chat: con mucho volumen, subir "Token verifications" en Supabase → Authentication → Rate limits.
4. Voz: decisión del dueño, número de Twilio México y cuenta de Vapi; luego una herramienta del Operador `llamar_proveedor`.
