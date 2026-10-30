# IATOS · Motor de derechos y reclamaciones (Operador IATOS)

Rama `claude/derechos-reclamos` · 29-oct-2026. Código: `supabase/functions/_shared/derechos/`.
Pedido del dueño: el bot "puede revisar los derechos del viajero, quejas, mandar correos, ver todo" y "no puede fallar".

Reglas que el código cumple:
- Cada derecho, monto o plazo cita una fuente de `fuentes.ts`, consultada el **29-oct-2026**. Solo se afirma con fuentes `verificado` (texto oficial leído).
- Siempre se da la certeza: **te corresponde** / **probablemente** / **depende de…**, y de qué depende.
- **Nunca se adivina un correo.** Un destinatario de correo exige su fuente (`directorio_oficial`, `correo_del_proveedor`, `reserva`, `usuario_confirmado`); la base lo vuelve a exigir con un CHECK. Sin correo verificado, la carta se prepara para pegarla en el formulario oficial.
- Nada sale sin consentimiento explícito y con la bandera `reclamos_enabled` (apagada por defecto).

## 1. Fuentes verificadas (consultadas el 29-oct-2026)

| Régimen | Qué se usa | Fuente oficial | Estado |
|---|---|---|---|
| México · Ley de Aviación Civil | art. 47 Bis fr. III, V (retraso: >1 h política; >2 h ≥7.5 %; >4 h opciones de cancelación), VI (cancelación: reembolso/otro vuelo/otra fecha + ≥25 %), VII, IX, X (pago en 10 días naturales); arts. 52 y 52 Bis (sobreventa: opciones + ≥25 %); art. 62 (equipaje facturado 150 UMA; de mano hasta 80 UMA). Última reforma DOF 14-11-2025 | https://www.diputados.gob.mx/LeyesBiblio/pdf/LAC.pdf | verificado |
| México · UMA 2026 | $117.31 diarios desde 1-feb-2026 (150 UMA = 17,596.50 MXN; 80 UMA = 9,384.80 MXN) | https://dof.gob.mx/nota_detalle.php?codigo=5778072&fecha=09%2F01%2F2026 | verificado |
| México · LFPC | arts. 7 (respetar reservaciones), 14 (prescripción 1 año), 65 Ter 1 (agencias), 92 Bis/92 Ter (bonificación ≥20 %), 99 (requisitos de queja). Última reforma DOF 12-12-2025 | https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPC.pdf | verificado |
| México · LTOSF art. 23 | aclaración ante el banco en 90 días naturales; dictamen en 45 días | https://www.diputados.gob.mx/LeyesBiblio/pdf/LTOSF.pdf | verificado |
| PROFECO | Teléfono del Consumidor 55 5568 8722 / 800 468 8722; Concilianet (solo proveedores registrados); requisitos de queja; extranjero: extranjeros@profeco.gob.mx | https://www.gob.mx/profeco/articulos/telefono-del-consumidor · https://concilianet.profeco.gob.mx/Concilianet/inicio.jsp · https://www.gob.mx/profeco/articulos/proceso-y-requisitos-de-quejas-y-denuncias | verificado |
| UE · Reg. (CE) 261/2004 | arts. 3, 4, 5, 6, 7 (250/400/600 €, 50 %, gran círculo), 8, 9, 10, 14 | https://www.legislation.gov.uk/eur/2004/261/adopted (texto adoptado; EUR-Lex no se dejó leer) | verificado |
| UE · Your Europe | retraso ≥3 h a la llegada: 250/400/300/600 €; fallas técnicas casi nunca son extraordinarias; aerolínea primero, autoridad si no responde en 2 meses; equipaje 7/21 días | https://europa.eu/youreurope/citizens/travel/passenger-rights/air/index_en.htm (revisada 21/09/2026) | verificado |
| UE · Organismos nacionales | 27 + Islandia, Noruega, Suiza, con formulario/correo/teléfono | https://transport.ec.europa.eu/document/download/d7b5dd33-4083-4faa-8132-b6dc8b3a1c07_en?filename=2004_261_national_enforcement_bodies.pdf (actualizada 13-oct-2026) | verificado |
| Reino Unido · UK261 | art. 3 (ámbito; límite: sección 9 Limitation Act 1980), art. 7 (£220/£350/£520) | https://www.legislation.gov.uk/eur/2004/261 | verificado |
| Reino Unido · CAA | £260 con 3–4 h en >3 500 km; reembolso >5 h; ADR o PACT | https://www.caa.co.uk/air-passengers/travel-problems-and-rights/flight-delays-and-cancellations/delays/ | verificado |
| EE. UU. · 14 CFR 260 (2024) | cambio significativo 3 h nacional / 6 h internacional; reembolso automático completo; 7 días hábiles (tarjeta) / 20 días; maleta retrasada 12/15/30 h | https://www.ecfr.gov/current/title-14/part-260 | verificado |
| EE. UU. · 14 CFR 250.5 | denegación de embarque: 200 % (máx. 1 075 USD) / 400 % (máx. 2 150 USD); solo vuelos que salen de EE. UU. | https://www.ecfr.gov/current/title-14/part-250 | verificado |
| EE. UU. · 14 CFR 254.4 | equipaje nacional ≥ 4 700 USD | https://www.ecfr.gov/current/title-14/part-254 | verificado |
| EE. UU. · DOT queja | formulario OACP (aerolínea primero) | https://airconsumer.dot.gov/consumer/s/complaint-form | solo índice (403) |
| Canadá · APPR SOR/2019-150 | art. 10 (fuera de control), 11–12, 17 (reembolso 30 días), 19 (CAD 400/700/1 000 grande; 125/250/500 pequeña; pedir antes de 1 año; respuesta 30 días), 20 (CAD 900/1 800/2 400) | https://laws-lois.justice.gc.ca/eng/regulations/SOR-2019-150/ (última modificación 2022) | verificado |
| Canadá · CTA | vuelos hacia/desde/dentro de Canadá; aerolínea primero, 30 días | https://protection-passager-passenger.otc-cta.gc.ca/en | solo índice |
| Brasil · ANAC Res. 400/2016 | arts. 21 (alternativas), 24 (preterição 250/500 DEG), 26–27 (asistencia 1/2/4 h), 29/31 (reembolso 7 días), 32 (equipaje 7/21 días), 38 (respuesta 10 días) — texto compilado oficial en inglés de ANAC | https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/resolucoes-2016/resolucao-no-400-13-12-2016 | verificado |
| Brasil · Anac Passageiro | canal de reclamación desde 13-abr-2026 | https://www.gov.br/anac/pt-br/canais_atendimento/anacpassageiro | solo índice (captcha) |
| Convenio de Montreal 1999 | arts. 17, 19, 22, 31 (7 días daño / 21 días retraso, por escrito), 35 (2 años) | https://www.legislation.gov.uk/ukpga/1961/27/schedule/1B | verificado |
| Montreal · límites 2024 | 1 519 DEG equipaje; 6 303 DEG retraso (desde 28-dic-2024) | https://www.legislation.gov.uk/uksi/2025/123/made | verificado |

### Contactos de reclamación de aerolíneas (29-oct-2026)

| Aerolínea | Canal | Verificación |
|---|---|---|
| Volaris | Formulario "Tu experiencia" (tuexperiencia.volaris.com); no atiende quejas por redes | página/PDF oficial leído |
| Delta | Formulario Comment & Complaint + formulario de reembolso; correo postal en Atlanta; sin correo electrónico | página oficial leída |
| Aeroméxico | Formulario de contacto (post-viaje); 55 5133 4000 | solo índice (dominio bloqueado en esta sesión) |
| Viva Aerobus | Call Center 81 8215 0150 (sus términos) | solo índice |
| American | Formulario "Compliments and complaints"; reembolsos aa.com/refunds | solo índice (403) |
| Iberia | Reclamaciones (formularios vuelo cancelado / retrasado) | solo índice (403) |
| KLM | Compensación en línea | solo índice |
| Lufthansa | Formulario fast-compensation | solo índice (403) |
| Avianca | Formulario de sugerencias, quejas y reclamos | solo índice (403) |
| Copa | Formulario del Centro de Ayuda (15 días) | solo índice (401) |
| United | — | **NO VERIFICADO** (solo un dominio de pruebas) |
| Air France | — | **NO VERIFICADO** el enlace exacto |

Ninguna aerolínea tiene hoy un correo con verificación "página leída": todas las cartas a aerolíneas se preparan para su formulario, salvo que el usuario dé un correo que la aerolínea le dio por escrito (`usuario_confirmado`) o venga en su reserva.

## 2. Interfaz del módulo (`_shared/derechos/`)

- `motor.ts` · `evaluarVuelo(caso: CasoVuelo): Evaluacion` — puro. Entrada: evento, origen/destino/destino final (IATA), aerolínea operadora, fechas, horas de retraso a la llegada y a la salida, días de aviso, reubicación (sale antes / llega después), motivo, clase, precio, voluntario, pernocta, equipaje. Salida: `regimenes`, `derechos[]` (monto, certeza, depende_de, fuente), `principal`, `pruebas`, `ahora`, `reclamar[]` (aerolínea → organismo), `plazos`, `avisos`, `resumen`.
- `distancia.ts` · gran círculo con coordenadas de `_shared/airports.ts`; ±60 km de 1 500/3 500 → "depende".
- `servicios.ts` · `evaluarServicio` y `cartaServicio` (hotel, traslado, agencia, tour: cobro doble, no prestado, sobreventa, reserva no encontrada, deficiente). Ruta proveedor → banco → PROFECO.
- `cartas.ts` · `cartaAerolinea`, `cartaOrganismo`, `recordatorio`, `correoUsuario` (es/en/pt/fr).
- `respuesta.ts` · clasificador de la respuesta del proveedor (herramienta estricta `record_provider_reply`: aceptó / rechazó / pide datos / ofrece vale / acuse / otro), `decidirRespuesta` (cita textual comprobable y remitente verificado o se baja a "otro") y `siguientePaso` (confirmar pago, rechazar vale con fundamento, enviar datos, escalar con carta lista, esperar, revisar).
- `quejas.ts` · `clasificarQueja` (reglas + IA opcional que solo sube la gravedad) y `respuestaQueja`.
- `contexto.ts` · `verTodo(lectorConJWTdelUsuario, userId, {permiso, alcance})` — sin permiso devuelve la pregunta; con permiso lee con RLS y enmascara números de la Bóveda.
- `rutas.ts` · direcciones `reclamos+<token>@` y `casos+<token>@reply.traveliatos.life`.
- `servicio.ts` · orquestación con dependencias inyectadas: `prepararReclamoVuelo`, `prepararReclamoServicio`, `confirmarEnvio`, `marcarEnviadoPorUsuario`, `estadoReclamos`, `cancelarReclamo`, `resolverReclamo`, `escalarReclamo`, `registrarQueja`, `handleInbound`, `runSeguimiento`.
- `nucleo.ts` · **adaptador al núcleo de incidentes** (interfaz `NucleoIncidentes` + `nucleoNulo`). Punto de conexión: `runtime.ts › nucleoDesdeEntorno()`.
- `herramientas.ts` · definiciones y ejecutor de herramientas para Iato y el operador.

## 3. Correo entrante sin romper Reservas IA

Mismo dominio `reply.traveliatos.life` y mismo proveedor (Resend Receiving):
- `reservas+<token>@` → Reservas IA (sin cambios).
- `reclamos+<token>@` → respuesta del proveedor (Reply-To de cada carta).
- `casos+<token-por-usuario>@` → correos que el usuario reenvía; se aceptan solo si vienen de su propio correo con DMARC/DKIM; con folio `C-XXXXXX` se ligan a su reclamo.
- `casos@` sin token se ignora (no se puede saber de quién es).

Se registra un **segundo webhook** en Resend apuntando a `reclamos-inbound` (secreto propio `RECLAMOS_INBOUND_SECRET`). `reservations-inbound` acusa recibo e ignora reclamos+/casos (cambio mínimo en `_shared/ai-reservations/service.ts`).

## 4. Pendientes para activar
1. Aplicar la migración `20261029090000_reclamos.sql`; desplegar `reclamos`, `reclamos-inbound`, `reclamos-cron` y `concierge-chat`, `reservations-inbound`, `ai-reservations`, `ai-reservations-cron` (comparten `_shared/ai-reservations/service.ts`).
2. Resend: segundo webhook `email.received` → `reclamos-inbound`; secreto `RECLAMOS_INBOUND_SECRET`. Verificar que `reclamos@traveliatos.life` pueda enviar (o fijar `RECLAMOS_FROM_ADDRESS`).
3. pg_cron diario para `reclamos-cron` (mismo patrón que `ai-reservations-cron`): `docs/ops/programar-reclamos.sql` (tarea `reclamos-seguimiento-diario`, 15:41 UTC = 09:41 en CDMX).
4. Conectar `nucleoDesdeEntorno` al núcleo de incidentes.
5. Encender `app_flags.reclamos_enabled` cuando el dueño lo apruebe.
6. Botón de confirmar envío en la app (hoy el consentimiento se da en el chat con el folio, o por la API `confirmar_envio`).
