# IATOS Privé · Política de membresía y antigüedad ("The 90-Day Invitation")

> Parte de la serie Privé. Invitaciones, contraseña y sesiones: [IATOS_PRIVE_INVITATIONS.md](IATOS_PRIVE_INVITATIONS.md).
> Correo: [IATOS_PRIVE_EMAIL_DESIGN.md](IATOS_PRIVE_EMAIL_DESIGN.md). Contrato técnico: `scratchpad/prive/prive_contract.md` (§0–§3).
> **Nada de esto está en producción.** Las migraciones y funciones están en la rama `claude/wc-prive-core` y necesitan el GO del dueño.

## Resumen para fundadores

- **Quién entra a Privé:** una persona con IATOS PRO **vigente hoy** que acumuló **90 días pagados** de PRO
  (o a quien el equipo le dio una **concesión** por escrito), que **aceptó** su invitación y que escribe
  **su propia contraseña Privé**. Las cinco cosas se revisan en el servidor en cada pantalla sensible.
- **Qué cuenta como "día pagado":** solo los días cubiertos por una factura de Stripe **cobrada con monto mayor a $0**.
  - La prueba gratis **no cuenta** (sus facturas son de $0).
  - La cortesía (PRO regalado) **no cuenta**: para ellos Privé solo llega por concesión.
  - Los días se **suman** aunque haya huecos: si alguien pagó 60 días, se fue y regresó, sigue en 60.
  - Solo cuentan los días **ya transcurridos**: pagar un año por adelantado no da Privé ese mismo día.
- **Reembolsos y disputas:** un reembolso total o una disputa perdida **quitan** los días de esa factura.
  Mientras una disputa está abierta, esos días **no cuentan**; si se gana, vuelven.
- **Si la persona deja de ser PRO, pierde Privé en la siguiente llamada**, aunque tenga la contraseña.
  Si cancela la renovación, conserva Privé **hasta el final del periodo que ya pagó**.
- **Si regresa** (vuelve a pagar PRO) después de haber llegado a 90 días y activado su membresía,
  **recupera Privé sin volver a esperar 90 días**, salvo que su membresía se haya revocado por fraude u otra causa documentada.
- **Costo de operar esto:** prácticamente cero (consultas a la base, una tarea programada por hora, un correo por persona invitada y correos de seguridad ocasionales; la revisión de contraseñas filtradas es gratuita).

---

## 1. La regla del dueño, en orden

Cada vez que alguien abre contenido Privé, la base de datos (función `prive_require`) revisa, en este orden:

| # | Revisión | Si falla, la app recibe |
|---|---|---|
| 1 | Hay sesión de IATOS (usuario con sesión iniciada) | `PRIVE_NO_SESSION` |
| 2 | Es PRO **hoy** (`is_pro`: pagado vigente, prueba vigente o cortesía) | `PRIVE_NOT_PRO` |
| 3 | Su membresía Privé **no** está revocada | `PRIVE_REVOKED` |
| 4 | Tiene ≥ 90 días pagados **o** una concesión vigente | `PRIVE_NOT_ELIGIBLE` |
| 5 | Aceptó su invitación (membresía activada) | `PRIVE_NOT_ACTIVATED` |
| 6 | Trae una sesión Privé válida (contraseña escrita en esta sesión de IATOS, sin vencer) | `PRIVE_NO_SESSION` / `PRIVE_SESSION_INVALID` / `PRIVE_SESSION_EXPIRED` |

- Las revisiones 2 a 5 van **antes** que la contraseña: sin derecho, la contraseña no sirve de nada.
- No existe contraseña maestra ni compartida. La contraseña de un miembro no abre la cuenta de otro.

## 2. Qué es un "día pagado" (antigüedad)

**Fuente:** la tabla `pro_paid_periods`, una fila por factura de Stripe pagada con monto mayor a $0. La llena:
- `stripe-webhook` al recibir `invoice.paid` / `invoice.payment_succeeded`;
- `prive-tenure-backfill` para las facturas viejas (pagadas antes de que existiera la tabla).

**Periodo de cada factura:** el de sus renglones de suscripción con monto positivo (inicio más temprano a fin más tardío).
Los créditos de prorrateo (renglones negativos al cambiar de plan) se ignoran.

**Cálculo** (`prive_tenure_days`):
1. Se toman los periodos con estado `paid` o `partially_refunded`.
2. Se **unen** (lo encimado cuenta una sola vez).
3. Se **recortan a "ahora"** (los días futuros todavía no cuentan).
4. Se suman y se redondea hacia abajo a días completos (24 h).

**Por qué días reales y no "meses":** un mes de febrero tiene 28 días y uno de marzo 31. Contar meses haría que
quien empezó en febrero llegara antes que quien empezó en marzo. Con días reales, 90 días son 90 días para todos.

## 3. Casos y ejemplos resueltos

Las fechas son ejemplos. "Hora" = la misma hora del cobro original (Stripe cobra a la misma hora cada mes).

### 3.1 Mensual normal, empezando a mitad de mes
- Pagos el 15-ene, 15-feb y 15-mar (2026).
- Periodos: 15-ene→15-feb (31 d) + 15-feb→15-mar (28 d) + 15-mar→15-abr (31 d).
- El 14-abr lleva **89**; el **15-abr a la hora del cobro llega a 90** y la siguiente corrida de la tarea (máximo 1 hora después) lo invita.

### 3.2 Empezando en febrero (mes corto)
- Pagos el 1-feb, 1-mar, 1-abr, 1-may (2026).
- 1-feb→1-may = 28 + 31 + 30 = **89 días**. El cobro del 1-may abre el periodo de mayo; a partir de ahí los días siguen sumando y llega a **90 el 2-may** a la hora del cobro.
- Esto está probado (prueba SQL `P05b`: feb+mar+abr = 89, no 90; `P05c`: con mayo completo, 120).
- Año bisiesto (2028): febrero tiene 29 días; el cálculo lo toma solo, sin reglas especiales.

### 3.3 Prueba gratis y luego pago
- Prueba de 30 días (con o sin tarjeta) y después paga.
- La factura de la prueba es de $0: **no se registra**. Los días empiezan el día del primer cobro real.
- Una cuenta en prueba de 120 días tiene **0** días pagados (prueba `P04`).

### 3.4 Cupón del 100 % o descuento parcial
- Cupón del 100 %: factura de $0 → no cuenta.
- Descuento parcial (por ejemplo 50 %): la factura tiene monto > 0 → **sí cuenta completa**. Si el dueño prefiere otra regla, es una decisión (ver §8).

### 3.5 Pago con huecos (se va y regresa)
- Pagó ene y feb (59 días), canceló, y volvió a pagar en junio.
- En junio sigue con 59; con 31 días de junio-julio llega a 90.
- Los huecos **nunca reinician** la cuenta (D2). Solo una revocación documentada la bloquea.

### 3.6 Periodos encimados
- Cambió de plan a mitad de mes y Stripe cobró un periodo que se enciman 10 días con el anterior.
- Esos 10 días cuentan **una sola vez** (prueba `P05`: [200→170] ∪ [180→150] = 50 días, no 60).
- Respaldo de una cuenta vieja con 4 facturas de 31 días desde el día 5 de cada mes: se enciman 3 días en marzo por febrero corto → **121 días**, no 124 (prueba `P13`).

### 3.7 Plan anual
- Un pago anual cubre 365 días, pero **solo cuentan los transcurridos**: a los 90 días del pago llega a 90.

### 3.8 Cancelar la renovación
- Si cancela pero su periodo pagado sigue vigente, **conserva PRO y Privé hasta el final de ese periodo** (`is_pro` sigue verdadero hasta `current_period_end`; prueba `P09`).
- Esos días sí cuentan: fueron pagados.

### 3.9 PRO termina de verdad
- En cuanto el periodo pagado termina (o Stripe la cancela), la **siguiente** llamada a Privé responde `PRIVE_NOT_PRO`, aunque tenga una sesión Privé abierta y la contraseña correcta (prueba `P10`).
- La tarea horaria además cierra sus sesiones Privé (prueba `P10b`).

### 3.10 Reactivación
- Ya había llegado a 90 días y activado su membresía; dejó de pagar; vuelve a pagar.
- Al volver a ser PRO **recupera Privé de inmediato**: su antigüedad sigue en ≥ 90 y su membresía sigue activa. Solo tiene que escribir su contraseña Privé otra vez (sus sesiones se cerraron). No se crea otra invitación (prueba `P11`).

### 3.11 Reembolso total
- Se reembolsa por completo la factura de marzo (31 días) de alguien con 95 días → baja a 64 (prueba `P06`: 95 → 65 con un periodo de 30).
- Si baja de 90 y ya era miembro activo, **su acceso se pausa** (`PRIVE_NOT_ELIGIBLE`) y sus sesiones Privé se cierran. **No es una revocación**: cuando vuelva a sumar 90 días pagados, regresa solo (D3).
- Además, la política de sec2 sigue igual: si era la factura vigente, `payments.ts` revoca el PRO de ese periodo (salvo otro derecho).
- Si el reembolso es de una factura **anterior**, el PRO de hoy no cambia, pero los días de esa factura dejan de contar.

### 3.12 Reembolso parcial
- La factura queda como `partially_refunded` y **sigue contando** (prueba `P06b`). Queda registrado para revisión, como en sec2.

### 3.13 Disputa (contracargo)
- **Abierta:** los días de esa factura **no cuentan** mientras esté abierta (`disputed`).
- **Ganada** (o consulta cerrada sin contracargo, `warning_closed`): vuelven a contar, con el estado que tenían antes (pruebas `P07`, `P08b`).
- **Perdida:** igual que un reembolso total; no vuelven aunque después llegue un "ganada" (prueba `P08`).

### 3.14 Fraude u otra causa documentada
- Un administrador revoca la membresía con `admin_revoke_prive(usuario, 'fraud', motivo, responsable)`.
- Queda **bloqueada aunque tenga PRO y 90 días**; la tarea nunca la vuelve a invitar; la contraseña ya no sirve (prueba `P12`).
- Si todavía no tenía membresía, se crea una ya revocada para que nunca se le invite (prueba `P12b`).
- Solo un administrador la restaura (`admin_restore_prive`, queda en la bitácora; prueba `P12c`).

### 3.15 Cortesías (PRO regalado) y concesiones de Privé
- La cortesía (`comp_grants`, estado `comped`) da PRO pero **no días pagados** (prueba `P14`: 0 días).
- Para darles Privé existe la **concesión** (`prive_grants`): con motivo, vigencia opcional, quién la dio y revocación.
- Concesión **sin** PRO: no entra (`PRIVE_NOT_PRO`) hasta que tenga PRO; en cuanto lo tenga, la tarea la invita (pruebas `P15`, `P15b`).
- Concesión a un correo que aún no tiene cuenta: se liga sola al registrarse o al cambiar (y confirmar) su correo (prueba `P16`).
- Concesión vencida o revocada: si no tiene 90 días pagados, su acceso se pausa y sus sesiones se cierran (pruebas `P17`, `P18`).

### 3.16 Suscripciones viejas (antes de esta versión)
- Sus facturas no están en `pro_paid_periods`. Hasta correr el respaldo, **tendrían 0 días** y no serían invitadas.
- `prive-tenure-backfill` lee de Stripe las facturas pagadas de los clientes que ya están en `subscriptions` y las guarda con `source='backfill'`. Es idempotente (la factura es la llave) y por defecto **solo simula**.
- **Debe correrse antes de encender la tarea en producción** (ver [LEEME](../ops/LEEME.md)).

### 3.17 Borrar la cuenta
- `purge_account_data` borra todo lo de Privé de esa persona (membresía, contraseña, sesiones, periodos pagados; prueba `P62`).
- Si después crea otra cuenta, empieza en 0 días. El registro financiero de Stripe (`stripe_payment_events`) sigue intacto como antes.

## 4. Estados de la membresía

| Estado | Significa | Cómo llega |
|---|---|---|
| (ninguno) | Aún no cumple, o cumple y la tarea no ha corrido | — |
| `invited` | Cumple; tiene invitación y aviso en la app | `prive_evaluate_eligibility` (tarea horaria) o concesión de admin |
| `active` | Aceptó la invitación | `prive_accept_invitation` |
| `revoked` | Bloqueada por un administrador (fraude, admin u otra) | `admin_revoke_prive`; se sale solo con `admin_restore_prive` |

La pausa por falta de PRO o de días **no** cambia el estado: es una revisión en vivo.

## 5. Lo que se reutilizó, lo que se construyó y lo que se corrigió

**Se reutilizó (sin duplicar):**
- `subscriptions` + `is_pro` como única fuente de "PRO hoy".
- La política de reembolsos y disputas de sec2 (`payments.ts`, `revoke_paid_access`): Privé solo agrega el estado del periodo.
- `notify_once` para los avisos en la app (una sola vez por llave), `app_flags`, `verify_cron_secret` / `isAuthorizedCron`, `sendEmail` y `escapeHtml`.
- El patrón de `comp_grants` + trigger en `auth.users` para aplicar concesiones por correo.

**Se construyó:**
- Migraciones `20261023090000`–`20261023090300` (tablas, antigüedad, membresía, invitaciones, concesiones, contraseña, sesiones, bloqueos, periodos pagados).
- `stripe-webhook`: registro de periodos pagados y su estado ante reembolsos/disputas (módulo puro `_shared/prive-tenure.ts`).
- Funciones `prive-access`, `prive-cron`, `prive-tenure-backfill`.

**Se corrigió:** antes no existía forma de saber cuántos días había **pagado** alguien (solo si era PRO hoy). Sin eso, la regla de 90 días no se podía cumplir ni auditar.

## 6. Pruebas ejecutadas (locales, 2026-10-22)

| Suite | Resultado |
|---|---|
| `supabase/tests/prive/run.sh` (SQL, base desechable con todas las migraciones) | **89 OK, 0 FALLA** |
| Vitest completo (`npx vitest run`) | **111 archivos, 828 pruebas OK** (incluye 91 nuevas de Privé en 5 archivos) |
| `npx tsc --noEmit -p tsconfig.app.json` | OK |
| `deno check` de `prive-access`, `prive-cron`, `prive-tenure-backfill`, `stripe-webhook`, `send-email`, `health-check`, `concierge-action` | OK |
| Suites de seguridad, pagos, ops y costos | Salida **idéntica** a la rama base |
| `npm run build` | OK |

Casos de política (nombres en `supabase/tests/prive/prive.sql`): `P01` 89 días no elegible · `P02` 90 días invitado una vez · `P03` re-correr la tarea no duplica · `P04` prueba no cuenta · `P05/P05b/P05c` huecos, encimados y febrero · `P06/P06b` reembolsos · `P07/P08/P08b` disputas · `P09` cancelación con periodo vigente · `P10/P10b` PRO vencido · `P11` reactivación · `P12/P12b/P12c` fraude · `P13/P13b` cuentas viejas · `P14–P18` concesiones.

## 7. Qué no pudo verificarse

- **Stripe real:** no se llamó a Stripe (regla del dueño). La forma de las facturas se tomó de la versión de API fijada (`2024-12-18.acacia`) y del formato nuevo (`parent`), con datos de prueba.
- **Producción:** no se aplicó ninguna migración ni se publicó ninguna función. No se sabe cuántas cuentas cumplirían hoy los 90 días hasta correr el respaldo en modo simulación.
- **Planes anuales o descuentos parciales reales:** no sabemos si existen en Stripe; la regla está escrita pero no se vio un caso real.

## 8. Costos, riesgos y decisiones del dueño

**Costos:** ninguno nuevo de proveedores. La tarea `prive-cron` corre una vez por hora (consultas ligeras). El respaldo solo **lee** de Stripe (sin costo). Un correo por persona invitada.

**Riesgos:**
- Si no se corre el respaldo antes de encender la tarea, los clientes antiguos esperarán 90 días "de nuevo" aunque ya los hayan pagado.
- Un reembolso o disputa que llegue antes de que exista el periodo (orden de eventos de Stripe) no lo encuentra (`no_period`); el respaldo posterior lo registraría como pagado. Riesgo bajo; se puede revisar con la consulta de [INVITATIONS §8](IATOS_PRIVE_INVITATIONS.md#8-operación-de-administrador-sql).
- La regla "descuento parcial cuenta completo" puede no ser la deseada.

**Decisiones del dueño (requieren autorización productiva):**
1. Aplicar las 4 migraciones `2026102309*` en producción.
2. Publicar `prive-access`, `prive-cron`, `prive-tenure-backfill` y la nueva versión de `stripe-webhook`.
3. Correr `prive-tenure-backfill` en simulación, revisar el conteo, y luego con `dry_run=false`.
4. Programar `prive-cron` (SQL en el LEEME) — hasta entonces nadie es invitado.
5. Confirmar: ¿un reembolso parcial sigue contando? (hoy sí, por contrato) · ¿un descuento parcial cuenta completo? (hoy sí) · ¿borrar la cuenta reinicia la antigüedad? (hoy sí).
6. `members_requires_prive` sigue en `false` (Members Only sigue siendo beneficio PRO, D1).
