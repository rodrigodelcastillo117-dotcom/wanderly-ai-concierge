# IATOS · Comisiones y reservas en la mano

Para: el dueño. Fecha: 30-oct-2026. Rama `claude/comisiones`. Investigación de negocio que lo motiva: el estudio "cómo pasar de app con enlaces a agencia digital" (comisiones, proveedores, permisos).

**Estado: construido y probado, todo lo que mueve dinero está APAGADO.** Nada está desplegado ni la migración aplicada. No se firmó nada, no se pidió ninguna llave y no se hizo ninguna reserva ni cobro real.

---

## 1. En 10 líneas

1. **Libro de clics.** Cada vez que alguien abre un socio (Aviasales, Booking, Viator…) queda registrado una sola vez, con su producto y su red, venga del botón que venga (antes había tres registros distintos).
2. **Libro de comisiones.** Cada venta afiliada queda con su estado: **pendiente, confirmada, pagada o rechazada**. Las de Travelpayouts se leen solas una vez al día con el token que ya tienen.
3. **Tablero.** En **Métricas (/dashboard/admin) → Comisiones** ves lo ganado este mes, por proveedor y por producto, los clics y lo que falta aprobar.
4. **Reservas gestionadas.** Es una reserva que IATOS tiene "en la mano": con el localizador del proveedor y su API para consultarla, cancelarla o cambiarla. Cada una tiene un folio **R-XXXXXX**.
5. **El Operador IA** ya puede ver esas reservas y **pedir** un cambio o una cancelación, solo si el viajero escribió *"Sí, cancela R-XXXXXX"* y si la política del proveedor lo permite.
6. **Una persona aprueba** (tú o Carlo, en el tablero). Solo entonces la tarea lo hace con el proveedor. La IA nunca cancela ni paga sola.
7. **Hoteles con RateHawk** y **tours con Viator** quedaron conectados por código, probados con las respuestas de su documentación oficial. Se encienden cuando firmes y pegues las llaves.
8. **Traslados (Mozio o Blacklane):** ninguno publica su documentación técnica, así que quedó solo la "forma" del conector, marcada **NO VERIFICADO**.
9. **Cargo por servicio** (por ejemplo, en vuelos): listo y apagado; tú decides el monto. Se muestra siempre aparte y diciendo si es reembolsable.
10. Todo queda con historial: quién pidió, el texto exacto del viajero, quién aprobó y qué respondió el proveedor.

---

## 2. Qué hay, pieza por pieza

| Pieza | Dónde vive | Estado |
|---|---|---|
| Libro de clics (amplía `affiliate_clicks`; copia los clics de `bookings` pendientes —`trackBookingClick`— y las salidas de `booking-go`) | migración `20261030020000_comisiones.sql` | Listo al aplicar la migración (sin cambios en la app) |
| Libro de comisiones (`commissions`, historial `commission_events`) | migración + `supabase/functions/_shared/comisiones/travelpayouts.ts` + función `comisiones-sync` | Listo; lee Travelpayouts al agendar la tarea |
| Reservas gestionadas (`managed_bookings`, historial y solicitudes) ligadas al Booking Bridge (`booking_intents`) y a "Mis reservas" (`bookings`) | migración + `supabase/functions/_shared/proveedores/` + funciones `reservas-gestionadas` y `proveedores-webhook` | Listo; sin proveedor firmado no hay reservas |
| Operador IA: `ver_servicios_gestionados` y `pedir_cambio_servicio` (+ `pedir_permiso` para cancelar/cambiar) | `supabase/functions/_shared/operador/herramientas.ts`, `prompt.ts` | Listo (el operador sigue apagado con `operador_enabled`) |
| Hoteles RateHawk (buscar, cotizar, reservar, consultar, cancelar; cambiar = cancelar y reservar con una persona; webhook firmado) | `_shared/proveedores/ratehawk.ts` | Verificado contra documentación oficial; sin llaves |
| Tours Viator Full + Booking (nivel de la llave, estado, cancelar, cambiar, reservar con el formulario de pago de Viator, avisos) | `_shared/proveedores/viatorReservas.ts` | Verificado contra documentación oficial; la llave actual es Basic según el inventario (ver §3) |
| Traslados (Mozio / Blacklane) | `_shared/proveedores/traslados.ts` | **NO VERIFICADO**: solo la interfaz |
| Cargo por servicio | tabla `service_fee_rules`, `_shared/comisiones/cargo.ts` | Apagado y sin monto |
| Tablero para administradores | `src/components/AdminCommissionsCard.tsx` en `/dashboard/admin` | Listo; el viajero no ve nada nuevo |

### Cómo se cuenta el dinero
- **Ganado** = confirmado + pagado. **Pendiente** se muestra aparte porque puede caerse (el viajero cancela).
- **Pagada** = Travelpayouts ya incluyó esa venta en un pago a IATOS.
- Cada moneda va por separado (no se suman dólares con euros).
- Las reservas de **prueba (sandbox)** nunca cuentan como dinero.
- En una reserva gestionada, la comisión es lo que el proveedor reporta o, si no, venta − neto. Pasa de pendiente a confirmada cuando el servicio ya ocurrió.

### Cómo se cancela o cambia una reserva gestionada (paso a paso)
1. El viajero dice "quiero cancelar mi hotel". El Operador revisa con `ver_servicios_gestionados` y le explica la política del proveedor (por ejemplo, "gratis hasta el 1 de diciembre", con su fuente).
2. Le pide permiso: *"Si quieres que la cancelemos, responde: «Sí, cancela R-AB23CD»"*.
3. Con ese mensaje real del viajero (la base lo comprueba: no sirve un mensaje del equipo, ni un "no", ni otro folio), el Operador **pide** la cancelación. Queda "Por aprobar".
4. Tú o Carlo la ven en **Métricas → Comisiones → Cambios y cancelaciones por aprobar**, con el texto del viajero y la política, y tocan **Aprobar** o **Rechazar**.
5. La tarea `reservas-gestionadas` (cada hora) la hace con el proveedor **solo si** está prendida `reservas_gestionadas_cambios_enabled` (y, en producción, `proveedores_reservas_enabled`). Si el proveedor no contesta en 15 minutos, queda "Revisar a mano": **nunca se repite sola** (para no cancelar dos veces).
6. La reserva, la comisión y la intención del Booking Bridge quedan canceladas con su historial.

---

## 3. Proveedor por proveedor: qué falta firmar y qué secreto pegar

**Dónde se pegan los secretos:** Lovable → tu proyecto → **Cloud → Secrets** (o Supabase → Edge Functions → Secrets). Se escribe el **nombre** exacto y se pega el **valor**. Nunca por chat ni correo.

### Travelpayouts (vuelos y afiliados que ya tienen) — listo
- **Qué falta:** nada que firmar. Solo desplegar `comisiones-sync` y agendar la tarea (§5).
- **Secreto:** `TRAVELPAYOUTS_TOKEN` (ya existe).
- **Fuente oficial:** API de finanzas de Travelpayouts (`/finance/v2/get_user_actions_affecting_balance`, `get_user_payments`, `get_user_actions_affecting_payment`), artículo de su centro de ayuda actualizado el 22-oct-2026. Los ids de programa 100 (Aviasales) y 84 (Booking.com) vienen de su documentación; los demás aparecen como "Programa N".
- **Ojo (ya conocido, BB-02):** los enlaces `tp.media/click` responden error 400; esos clics no generan comisión hasta que se generen las ligas en el panel de Travelpayouts.

### Hoteles: RateHawk (Emerging Travel Group) — código listo, falta firmar
- **Qué firmar:** contrato B2B con RateHawk (tienen empresa en CDMX: *Emerging Travel Solutions Mexico*). Pide primero **llaves de sandbox**; después pasan una **certificación** y te dan llaves de producción. Pide que el contrato permita **cancelar por API** (si no, la API responde "no cancelable" en tarifas no reembolsables).
- **Secretos:**
  | Nombre | Valor |
  |---|---|
  | `RATEHAWK_KEY_ID` | el número de la llave (`KEY_ID`) |
  | `RATEHAWK_API_KEY` | la llave (`API_KEY`) |
  | `RATEHAWK_ENTORNO` | `sandbox` mientras pruebas; `produccion` cuando te certifiquen |
- **Webhook:** pide al soporte de ETG que registre esta URL: `https://uhkdewinscffhdonhhmt.supabase.co/functions/v1/proveedores-webhook?p=ratehawk`. La firma se verifica con la misma llave.
- **Importante:** no uses llaves del entorno "test" de ETG: su hotel de prueba implica **reservas reales con responsabilidad financiera** (lo dice su documentación). Para probar, solo sandbox.
- **Pago:** el código solo usa los tipos de pago de agencia (saldo/depósito o pago en el hotel), nunca tarjeta.
- **Cambios:** su API no modifica reservas: un cambio es cancelar (si la política lo permite) y reservar de nuevo, con una persona.

### Tours: Viator — código listo, falta subir de nivel
- **Hoy:** el inventario dice que `VIATOR_API_KEY` es **Basic** (afiliado): sirve para buscar y mandar a viator.com, **no** para cancelar ni cambiar. Para confirmarlo sin gastar: **Métricas → Comisiones → Revisar proveedores** (hace dos lecturas: `/bookings/cancel-reasons` solo responde con Full + Booking; `/products/modified-since` solo con Full). No lo pude correr aquí porque la llave solo está en producción.
- **Qué pedir:** a Viator, el nivel **"Full + Booking"** (requiere aprobación y certificación). Viator sigue siendo quien cobra y reembolsa ("merchant of record").
- **Secretos:** `VIATOR_API_KEY` (ya existe). Para probar: `VIATOR_API_KEY_SANDBOX` (si existe la de producción, se usa la de producción).
- **Falta en la app:** para **reservar** dentro de IATOS hace falta el formulario de pago de Viator en pantalla (su iFrame da un `paymentToken`). No se hizo (sin cambios visuales). Cancelar y cambiar reservas sí quedan listos.
- **Avisos:** Viator no manda webhooks; la tarea consulta el estado cada hora.

### Traslados: Mozio o Blacklane — NO VERIFICADO
- Ninguno publica su documentación técnica (Mozio: su página de socios dice que tiene REST API y webhooks, pero `api.mozio.com/docs` responde 403; Blacklane: dice que tiene API para agencias y que en Sabre, Amadeus y Travelport está "en vivo para reservas y cancelaciones", pero entrega la documentación al dar de alta).
- **Qué firmar:** con uno de los dos (el estudio sugiere Blacklane por su atención 24/7, o Mozio por cobertura). Al firmar, pide su documentación de API y llaves de prueba; con eso se implementa el conector (la forma ya está: buscar, cotizar, reservar, consultar, cancelar, cambiar, webhook).
- **Secretos:** se definirán con su documentación (no se inventaron nombres).

### Seguros y vuelos propios
- **Seguros:** seguir como afiliado. Vender seguros con la marca IATOS puede requerir autorización de la CNSF: pedir opinión legal (estudio de negocio §2.5).
- **Vuelos con la reserva en la mano (Duffel o consolidador):** no se construyó (fase 3 del estudio). Mientras, el **cargo por servicio** es la forma de ganar en vuelos.

---

## 4. Cargo por servicio (apagado)

- La regla de **vuelos** ya existe **sin monto**. Tú decides: fijo, porcentaje o ambos; por reserva o por pasajero; mínimo, máximo; y si es reembolsable.
- Al viajero se le muestra **antes de pagar**, aparte del precio del proveedor, con su monto y si se devuelve. En boletos de o hacia EE. UU., si no es reembolsable hay que decirlo así (regla DOT 14 CFR 399.80(l)).
- Se prende con dos pasos (monto y bandera): ejemplo en `docs/ops/programar-comisiones.sql` §4.
- Falta la pantalla donde se muestre (cuando haya cobro a nombre de IATOS). Antes, definir con el contador cómo se factura (estudio §3.3).

---

## 5. Lo que hay que desplegar (cuando lo apruebes)

1. **Migración:** `supabase/migrations/20261030020000_comisiones.sql`.
2. **Funciones nuevas:** `comisiones-sync`, `reservas-gestionadas`, `proveedores-webhook`.
3. **Funciones con cambios:** `operador` (y las que comparten `_shared/operador/`: `incidente`, `incidentes-vigilante`, `reclamos-inbound`, `telegram-webhook`, `concierge-chat`; su código no cambió, solo se recompila).
4. **Tareas programadas:** correr `docs/ops/programar-comisiones.sql` (diaria de comisiones, 09:17 UTC; reservas gestionadas, cada hora al minuto 23).
5. **Front:** publicar la app (solo cambia el tablero de administradores).

### Banderas
| Bandera | Nace | Qué hace |
|---|---|---|
| `comisiones_sync_enabled` | **prendida** | Lee Travelpayouts (solo lectura) |
| `reservas_gestionadas_cambios_enabled` | apagada | La tarea ejecuta lo que una persona aprobó |
| `proveedores_reservas_enabled` | apagada | Permite reservar/cancelar/cambiar en **producción** |
| `cargo_servicio_enabled` | apagada | Cobra el cargo por servicio |

---

## 6. Lo NO VERIFICADO (dicho tal cual)

- **Nada se probó en vivo:** este entorno no tiene `TRAVELPAYOUTS_TOKEN`, ni llaves de RateHawk, ni la de Viator. Los formatos salen de los ejemplos de la documentación oficial (pruebas con esas respuestas en `src/test/fixtures/proveedores/`).
- **Travelpayouts:** la documentación no dice la zona horaria de `booked_at`; se toma como UTC.
- **RateHawk:** cuál de sus montos es "neto" para IATOS (`amount_sell` vs. `amount_payable`/`amount_sell_b2b2c`) depende del contrato (neto o bruto); confirmarlo en la certificación.
- **Viator:** el nivel real de la llave (el inventario dice Basic); "Revisar proveedores" lo confirma.
- **Traslados:** sin documentación pública de Mozio ni de Blacklane: solo interfaz.
- **SubID por clic** (para ligar cada venta con su clic exacto): Travelpayouts documenta `sub_id` en ligas cortas `tp.st` y `marker=ID.subID` en White Label, pero no para las ligas actuales; no se activó. Hoy la venta se liga por programa y fecha, no por clic.

## 7. Pendientes

1. Firmar con RateHawk (sandbox → certificación → producción) y pegar sus secretos.
2. Pedir a Viator el nivel Full + Booking; poner su formulario de pago en la app cuando se quiera reservar tours dentro de IATOS.
3. Elegir Mozio o Blacklane, firmar y pedir su documentación para implementar el conector de traslados.
4. Decidir el cargo por servicio y su pantalla; antes, el tratamiento fiscal con el contador.
5. Generar en el panel de Travelpayouts las ligas que hoy fallan (`tp.media`, BB-02) y, si se quiere ligar venta ↔ clic, ligas con SubID.
6. Pantalla de checkout para reservas gestionadas (hoy el viajero no ve nada nuevo, a propósito).

## 8. Pruebas

- SQL: `supabase/tests/comisiones` (28 casos) en `run_all.sh`.
- Vitest: `comisionesTravelpayouts.test.ts`, `proveedoresRatehawk.test.ts`, `proveedoresViator.test.ts`, `reservasGestionadas.test.ts`, `operadorGestionadas.test.ts`, `adminCommissions.test.tsx`.
