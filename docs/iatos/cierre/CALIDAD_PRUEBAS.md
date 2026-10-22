# Cierre de auditoría: calidad de las pruebas (grupo `seguridad`, fase 3)

Alcance: `src/test/**` (177 archivos, 1,791 pruebas después del merge de `claude/cierre-auditoria`) y
`supabase/tests/**` (11 suites SQL). Hice tres cosas:
1. Medí cuántas aserciones hace cada prueba.
2. Busqué patrones débiles.
3. Rompí a propósito funciones críticas (mutaciones), anoté qué prueba lo detecta y revertí cada cambio.

Las pruebas débiles que encontré las reforcé. No se debilitó ninguna.

## 0. Estado vigente (corrección posterior a la segunda auditoría, 22-oct-2026, rama `claude/r2-pruebas`)

Las cifras de las secciones 1 a 5 son del primer cierre (177 archivos, 1,791 pruebas, 11 suites). Las
vigentes, medidas en esta ronda sobre `origin/main` (`8f83f38`) + la rama, son estas:

| Qué | Cifra real | Cómo se mide |
|---|---|---|
| Vitest | **205 archivos, 2,280/2,280 pruebas, exit 0** (5 min 28 s) | `npx vitest run` **sin `.env` y con la red cortada** (`unshare -n`) |
| Errores no manejados | 0 (antes 7, de `TripBookingIntents.tsx:23`) | mismo comando |
| Peticiones de red reales | 0: `src/test/setup.ts` bloquea `fetch`; una petición no simulada hace FALLAR la prueba con su URL (antes ~35: 30 al `VITE_SUPABASE_URL` del `.env`, que apunta a producción) | mismo comando |
| Dependencia del `.env` | ninguna: `vitest.config.ts` fija valores FALSOS en `test.env` (antes 6 archivos no cargaban sin `.env`) | mismo comando |
| `tsc --noEmit -p tsconfig.app.json` / `npm run build` | exit 0 / OK (build con `.env`) | |
| Archivos que simulan `@/integrations/supabase/client` | 69 | `grep -rl` |
| Snapshots | 4 (`emailSystem.test.ts`; 1 solo-snapshot) | `grep` |
| `skip`/`only`/`todo` | 0 | `grep` |
| Suites SQL | **18** (16 + `trip_quotes` + `trip_expediente`), **1,139 OK de 1,139 esperados**, 0 FALLA | `supabase/tests/run_all.sh` |

### `supabase/tests/run_all.sh` (nuevo)

```
su postgres -c "PGHOST=/tmp/pgsec PGPORT=55440 bash supabase/tests/run_all.sh <prefijo>"
```
- Construye una base de **referencia** con todas las migraciones aplicadas una sola vez, en orden.
- Corre las 16 suites y `security/run_trip.sh quotes|expediente`, cada una en su base `<prefijo>_<suite>`.
- Por suite: código de salida, OK / esperado, fallas y **md5 de `prosrc` de cada función** contra la
  referencia. Una función distinta o ausente es FALLA (la suite probó una versión que no es la de producción).
- Imprime la tabla y sale con 0 solo si todo pasa. `KEEP=1` conserva las bases; `OUT_DIR=` guarda la salida.

Reglas comunes (`supabase/tests/lib.sh`), que ahora cumplen las 18 suites:
- La base de las pruebas tiene las migraciones **en orden, una sola vez**. La idempotencia se prueba en una
  **copia** de la base que se borra (`t_idempotency`). Antes `prive/run.sh` y `ops/run.sh` reaplicaban
  migraciones viejas al final y probaban versiones viejas de 5 funciones (ver §2).
- Una migración que no se aplica es **FALLA** (la de `pg_cron`, que no existe en local, sale como AVISO).
- Una aserción que falla nunca queda como `ERROR`: sale como `FALLA ERROR` y cuenta.
- Cada `run.sh` guarda su **total esperado de OK** y sale con código distinto de 0 si hay una falla o si el
  total no coincide (un bloque que deja de correr ya no pasa inadvertido).
- `ops`, `rls_attacks`, `profiles_tier`, `trip_delete_conversation`, `trip_quotes` y `trip_expediente`
  imprimían valores para comparar a mano; ahora cada caso es OK/FALLA.
- Las pruebas de concurrencia de `payments` (CONCURRENCIA ×2, CC1–CC4) y la de `ops` coordinan las dos
  sesiones con una compuerta de candados (`t_conc2`), no con `sleep`. CC3 exige que la sesión 2 haya esperado
  el candado de la factura. `payments/cc3_repeat.sh <db> 20`: 20/20 OK sin mutación; 20/20 FALLA con la
  mutación M1 de pagos (sin candado), también con 4 núcleos ocupados (el método viejo dio 5 OK falsos de 20).

Mutaciones que ahora hacen fallar `run_all.sh` (y que antes salían con código 0): ver
`docs/iatos/cierre2/PRUEBAS.md`.

## 1. Aserciones reales por prueba (medido, no estimado)

Corrí la suite completa con un `afterEach` temporal que guarda `expect.getState().assertionCalls` de cada prueba. El archivo de configuración temporal ya se borró y no se subió.

- **0 pruebas sin aserciones** de 1,786 medidas.
- Distribución: 388 con 1 aserción, 442 con 2, 300 con 3, 250 con 4 y 406 con 5 o más.
- 26 pruebas tienen **una sola** aserción y es de presencia (`toBeInTheDocument`/`toBeTruthy`). Casi todas son de pantalla y es legítimo: comprueban que se ve un texto. La más débil en algo crítico era `adminMetrics` "shows an access message for non-admins": solo miraba el texto y no que no se mostraran datos. **Reforzada:** ahora exige que se pidió `admin_metrics` y que no aparecen cifras, gráficas ni el panel de servicios.

Búsqueda de patrones:

| Patrón | Resultado |
|---|---|
| `expect(true)` / `expect(1).toBe(1)` | 0 |
| `it.skip` / `.only` / `.todo` / `xit` | 0 |
| Pruebas que solo comparan contra un snapshot | 1: `emailSystem.test.ts` "texto plano estable (snapshot)". Los otros 2 snapshots van junto con aserciones explícitas. Riesgo: `vitest -u` lo aprueba a ciegas |
| `.catch(() => {})` que se traga errores | 1: `googleMapsLoader.test.ts:71`. Es legítimo: evita un rechazo sin manejar **después** de las aserciones |
| try/catch sin aserción | 0 |
| Títulos duplicados | 1 par (`functionErrors` / `quota`: "límite de un plan de pago…"). Prueban módulos distintos, no es duplicación |
| Archivos que mockean `@/integrations/supabase/client` | 59. Son pantallas. No ejercen RLS ni funciones Edge, y eso está bien siempre que la regla real tenga su prueba SQL o unitaria (ver §3) |

## 2. Simulaciones y permisos

- **`bookingBridgeE2E.test.ts` se llama "E2E" pero es una simulación.** Usa los handlers reales de `booking-bridge` y `booking-go` con un almacén en memoria que **imita** las reglas SQL. El encabezado lo dice con honestidad, pero el nombre engaña. Si las reglas SQL cambian, la copia puede quedar desfasada. Las reglas reales se prueban en `supabase/tests/bridge/bridge.sql` (42 OK).
- **Permisos con roles reales.**
  - Solo las suites SQL usan `anon`, `authenticated` y `service_role` con claims del JWT.
  - Ninguna prueba de Vitest prueba RLS, y no puede: usa mocks.
  - Aun en SQL, `auth.uid()`, `auth.jwt()` y `storage.objects` son **stubs** (`supabase/tests/security/01_supabase_stubs.sql`). No pasan por PostgREST, GoTrue ni la API de Storage.
  - Por eso lo que depende de esas capas queda **VERIFICAR EN VIVO**: `pg-safeupdate`, límites del bucket y `verify_jwt` desplegado.
- **(Corregido en la segunda ronda: ver §0.)** **Suites que vuelven a aplicar migraciones al final.** Es una "segunda pasada de idempotencia", y la base de prueba puede quedar con versiones **viejas** de funciones que una migración posterior redefine:
  - `ops/run.sh` deja `clear_active_trip_on_collab_removed` y `trips_quote_basis_guard` como estaban en `2026102213*`.
  - `prive/run.sh` reaplica `2026102309*`. Por eso mi primer intento de mutar `prive_require` con una migración posterior **no se aplicó** y dio un falso "nadie lo detecta". Lo repetí aplicando la mutación después del ciclo de idempotencia.
  - `ai_reservations` y `bridge` reaplican también sus migraciones `aud_*`, así que su estado final sí es el correcto.
- **(Corregido en la segunda ronda: ahora sale como FALLA ERROR y el total esperado lo detecta.)** **Archivos SQL que se cortan al primer error.** `payments/run.sh` corre cada archivo con `ON_ERROR_STOP=1`. Ante una falla imprime `ERROR: …` y salta el resto de ese archivo sin decir qué pruebas no corrieron. Por ejemplo, con M1 pasó de 63 a 39 OK. Se detecta, pero el conteo de OK no sirve como cobertura.

## 3. Pruebas mutantes (13 + 4 extra, todas revertidas)

Método (los scripts están en `scratchpad/audseg_evidence/mut/`):
- **TypeScript:** `run_ts.py`. Reemplaza una línea, corre `vitest related <archivo>` (todas las pruebas que dependen del módulo), restaura el archivo y comprueba `git diff --quiet`.
- **SQL:** `run_sql.sh` agrega una migración temporal `20261099990000_mutacion_temporal.sql`, corre la suite en una base `audseg_mut_*`, borra el archivo y la base.

Al terminar, `git status` quedó limpio y no quedó ninguna migración temporal.

| # | Función crítica | Mutación | Pruebas que la detectan (antes) | Después de reforzar |
|---|---|---|---|---|
| M1 | Cuotas (`reserve_quota`) | `>=` → `>` en el límite mensual (deja pasar 1 de más) | `payments`: R4, P5b, L3b (cortan 3 archivos). `cost`: ninguna | Igual |
| M2 | `prive_require` | quitar `AND s.user_id = v_uid` (token de otra cuenta) | **Ninguna** de 89 (`prive.sql` P31 choca antes con la liga a la sesión de Auth) | **PS2** (`supabase/tests/prive/aud_seg_strength.sql`) |
| M3 | Política RLS (`is_trip_collaborator`) | quitar `status = 'accepted'` (una invitación pendiente da acceso) | **Ninguna** de 116 en `security` | **SC1, SC2** (`aud_seguridad.sql`) |
| M3B | Política RLS (`expenses` SELECT) | `USING (true)` | **Ninguna** | **SX2, SX3** (barrido de lectura cruzada en 15 tablas) |
| M4 | Etiquetas de procedencia (`provenanceOf`) | un precio "en vivo" vencido sigue como en vivo (sin `!fresh`) | 6: flightProvenance, priceSourceBadge ×2, provenance ×3 | Igual |
| M5 | Máquina de estados de reserva (`followUpTarget`) | lo que declara el usuario → CONFIRMED | 2: bookingBridge, bookingBridgeE2E #15 | Igual |
| M6 | Idempotencia de Stripe (`handlePaymentEvent`) | ignorar el evento ya visto | 2: stripePayments, priveTenure | Igual |
| M7 | Severidad de alertas de salud | "última corrida falló" pasa a aviso (warning) | **1**: healthAlerts | Igual (cubierta, pero solo por una prueba) |
| M8 | Validación de enlaces de tarjetas (`hostBacked`) | `endsWith(k)` sin el punto (`evilopentable.com` pasa) | **1**: conciergeCtaHosts | **2** (+ `audSegStrength.test.ts`) |
| M9 | Puerta de confirmación de Reservas IA | confirmar sin cita textual del restaurante | **1**: aiReservationsClassifier `model_invents_quote` | Igual |
| M10 | Borrado de cuenta (`runDeletion`) | quitar el `break` tras un paso bloqueante fallido | **1**: accountDeletion (solo cuando falla Stripe) | **3** (falla storage o Stripe, en `audSegStrength.test.ts`) |
| X1 | Remitente verificado (`senderVerified`) | `return true` | 2: aiReservationsClassifier, aiReservationsCore | Igual |
| X2 | `safeHttpsUrl` | aceptar `https://user:pw@…` | **1**: iatoEvals "solo https" | **2** (+ `audSegStrength.test.ts`) |
| X3 | Cuota TS que falla cerrada | `allowed: true` si la RPC truena | 1: quota | Igual |
| X4 | Firma interna (`verifyInternal`) | no revisar la caducidad | 1: costControls | Igual |

Lectura:
- Las tres mutaciones que **nadie** detectaba eran de permisos: RLS y sesión Privé. La razón es que las pruebas de permisos atacaban "con todo mal a la vez". Si una defensa se rompía, otra la tapaba. Las nuevas pruebas aíslan cada defensa.
- Ninguna mutación de lógica de negocio (cuotas, procedencia, estados, Stripe, Reservas IA, borrado) sobrevivió.
- Evidencia: salidas en `/tmp/claude-0/-home-user-reto/8647f9df-5459-5399-a533-ae256c643445/scratchpad/audseg_evidence/mut/` (`*.txt`, `*.json`).

## 4. Pruebas que fallan por tiempo, no por el código

Con la máquina cargada por los otros grupos (carga 40-50), estas pruebas fallaron y pasan solas:

| Prueba | Causa | Acción |
|---|---|---|
| `security/concurrent_rate_limit.sh` (R4) | `sleep 0.5`: la sesión 2 llegaba antes que la 1 | **Corregida:** espera a la sesión 1 en `pg_stat_activity`. Pasó 3 de 3 con carga de 44 |
| `serpQuota.test.ts` "pagan una sola búsqueda…" | `setTimeout(5)`: la segunda búsqueda llegaba antes de que la primera se registrara | **Corregida:** `vi.waitFor` hasta que la primera está en SerpApi. 3 de 3 |
| `godtierHome` ×2, `dashboardActiveTrip`, `expensesCurrencies`, `godtierPlan`, `tripSplitLive` | límite de 5 s de Vitest (tardan 6-9 s bajo carga) | Pasan solas o con `--testTimeout=30000`. Sin cambio |
| `membersMore` "la solicitud de reserva sigue igual" | lee `invoke.mock.calls[0]`; bajo carga la foto (`place-photo`) se pide primero | Frágil, dependiente del orden. Recomendado: buscar la llamada por nombre |
| `payments`/`cost` `run.sh` | mismo `sleep 0.5` en sus pruebas de concurrencia | **`payments` corregida** en la segunda ronda (compuerta de candados, §0). `cost` sigue con `sleep 0.5`: con carga puede dar una FALLA falsa, nunca un OK falso |

## 5. Pruebas nuevas o reforzadas en esta fase

- `supabase/tests/security/aud_seguridad.sql`:
  - **SG1-SG8:** inventario del esquema.
  - **SJ1-SJ6:** diario.
  - **SS1-SS3:** almacenamiento.
  - **SR1-SR4:** RPC de equipo y oráculos.
  - **SX1-SX4:** lectura cruzada.
  - **SC1-SC2:** invitación pendiente.
- `supabase/tests/security/action_idempotency.sql`: **IK1-IK12**.
- `supabase/tests/prive/aud_seg_strength.sql`: **PS1-PS2**.
- `src/test/audSeguridadEdge.test.ts`: reglas de las 64 funciones Edge (auth, puertas, límite de uso) y las correcciones AUD-SEG-02/03/04, más la mejora de la bóveda.
- `src/test/audSegIdempotency.test.tsx`: AUD-SEG-05 (cliente y servidor).
- `src/test/audSegStrength.test.ts`: M8, M10 y X2.
- `src/test/adminMetrics.test.tsx`: caso de usuario no administrador reforzado.

## Riesgo residual

- 69 archivos de pantalla prueban con un Supabase falso (59 en el primer cierre). Una regla del servidor que solo tenga prueba de pantalla no está probada.
- Las suites SQL usan stubs de `auth` y `storage`. Hace falta una prueba en vivo de solo lectura con dos cuentas de prueba (PostgREST real) para cerrar del todo RLS y almacenamiento.
- Las mutaciones M7, M9, X3 y X4 las detecta una sola prueba cada una: cubiertas, pero frágiles.
