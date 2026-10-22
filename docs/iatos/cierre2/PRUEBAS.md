# Segunda ronda de corrección: método y calidad de las pruebas (grupo `pruebas`)

Rama `claude/r2-pruebas`, rebasada sobre `origin/main` = `8f83f38` (el brief decía `3db952a`; `origin/main`
avanzó durante la ronda con `dfcde9f`, `c146084`, `05577ae`, `3733714` y `8f83f38`. El único choque fue en
`supabase/tests/edition/run.sh`, que resolví conservando las migraciones nuevas `202610251100*`).
Fecha: 22-oct-2026. Postgres 16 local (`/tmp/pgsec:55440`), bases `r2pruebas_*` / `r2pmut_*` / `r2pantes_*`, todas borradas al final.

Hallazgos: `INFORME_qa.md` (P2-QA-1, P2-QA-2, P3-QA-1, P3-QA-2, P3-QA-3), `INFORME_produccion.md` Q-L1,
`INFORME_pagos.md` §4, `INFORME_prive.md` P3-6 y `INFORME_transversal.md` T-P2-6.

## Resultado final (medido después del rebase)

| Comando | Resultado |
|---|---|
| `su postgres -c "PGHOST=/tmp/pgsec PGPORT=55440 bash supabase/tests/run_all.sh r2pruebas"` | **PASA, exit 0: 18 suites, 1,139 OK de 1,139 esperados, 0 fallas, 0 de 394 funciones distintas de la base en orden** |
| `unshare -n npx vitest run` **sin `.env`** (red cortada) | **205 archivos, 2,280/2,280, 0 errores no manejados, exit 0** (5 min 28 s) |
| `npx tsc --noEmit -p tsconfig.app.json` | exit 0 (48 s) |
| `npm run build` (con el `.env` del repositorio) | OK (33 s) |
| `deno check --quiet --no-lock supabase/functions/generar-packing-list/index.ts` | exit 0. El `deno.lock` de `origin/main` es versión 5 y Deno 2.1 no lo lee: hay que usar `--no-lock` |

Tabla de `run_all.sh`:

| suite | OK | esperado | fallas | rc | funciones ≠ orden | resultado |
|---|--:|--:|--:|--:|--:|---|
| ai_reservations | 57 | 57 | 0 | 0 | 0/394 | PASA |
| avatar | 41 | 41 | 0 | 0 | 0/394 | PASA |
| boveda | 50 | 50 | 0 | 0 | 0/394 | PASA |
| bridge | 42 | 42 | 0 | 0 | 0/394 | PASA |
| concierge2 | 7 | 7 | 0 | 0 | 0/394 | PASA |
| cost | 16 | 16 | 0 | 0 | 0/394 | PASA |
| edition | 51 | 51 | 0 | 0 | 0/394 | PASA |
| members_more | 30 | 30 | 0 | 0 | 0/394 | PASA |
| ops | 22 | 22 | 0 | 0 | 0/394 | PASA |
| payments | 88 | 88 | 0 | 0 | 0/394 | PASA |
| prive | 140 | 140 | 0 | 0 | 0/394 | PASA |
| prive_catalog | 110 | 110 | 0 | 0 | 0/394 | PASA |
| prive_key | 47 | 47 | 0 | 0 | 0/394 | PASA |
| privevalor | 144 | 144 | 0 | 0 | 0/394 | PASA |
| security | 186 | 186 | 0 | 0 | 0/394 | PASA |
| social | 70 | 70 | 0 | 0 | 0/394 | PASA |
| trip_quotes | 11 | 11 | 0 | 0 | 0/394 | PASA |
| trip_expediente | 27 | 27 | 0 | 0 | 0/394 | PASA |
| **TOTAL** | **1,139** | **1,139** | | | | **PASA** |

Cambios de conteo frente a `RESULTADOS_QA`:
- `ops`: 0 → 22 (11 de idempotencia, T1–T9, C1 y C2).
- `security`: 156 → 186 (+15 de `rls_attacks`, +6 de `trip_delete_conversation` y +9 de `profiles_tier`, que antes se comparaban a mano).
- `edition`: 47 → 51 (4 casos nuevos que llegaron con `3733714`).
- `trip_quotes` y `trip_expediente`: no corrían; ahora dan 11 y 27.

## Tabla de hallazgos

| ID | Sev | Prueba (falla antes / pasa después) | Corrección (archivo:línea, commit) | Mutación | Estado |
|---|---|---|---|---|---|
| **P2-QA-1** (= Q-L1, P3-6) | P2 | **Antes:** md5 de `prosrc` de la base de cada suite contra una base aplicada solo en orden. `prive` tiene 3 funciones distintas: `prive_save_progress` `051682be→6492f9d9`, `prive_record_paid_period` `8c662a6f→fde7be5d` y `prive_mark_paid_period` `42445b10→4810c3fa`. `ops` tiene 2: `clear_active_trip_on_collab_removed` y `trips_quote_basis_guard`. Las otras 14 tienen 0. **Después:** 0/394 en las 18 suites (columna "funciones ≠ orden") | `supabase/tests/lib.sh:49` (`t_build_db`), `:74` (`t_idempotency`: la idempotencia se prueba en una COPIA de la base, que se borra); `prive/run.sh:22`, `ops/run.sh:19`. Las demás suites que reaplicaban (`ai_reservations`, `bridge`, `concierge2`, `cost`, `members_more`, `privevalor`, `social`) pasaron a la copia. `avatar`, `boveda`, `edition` y `payments` (L7) reaplican sobre la misma base por una prueba de datos; el md5 confirma 0 diferencias. Commit `6b2bb99` | `20261024310000:280` `greatest(…)`→`coalesce(_welcome_version, 0)`. `prive/run.sh` viejo: **140 OK, rc=0** (oculta). Nuevo: **139/140, FALLA P50, rc=1**, y `run_all.sh` **rc=1** | CORREGIDO |
| **P2-QA-2** | P2 | **Antes** (`run.sh` viejos): M1 de payments da **rc=0**, 68 OK, 3 `ERROR` (F4, P5b, L3b) y 1 FALLA. GRANT en ops da **rc=0**, 0 OK y 0 FALLA. **Después:** cada `run.sh` sale con 1 si algo falla. `run_all.sh` con cada mutación da **rc=1** (ver columna) | `lib.sh:145` (`t_verdict`: `ERROR`→FALLA, total esperado guardado en cada `run.sh`, código de salida), `:34` (`t_apply`: migración rota = FALLA; `pg_cron` local = AVISO), `:90` (`t_brackets`: `[esperado]: real` → OK/FALLA). `ops/flight_watch_claim.sql`, `cron_health.sql` y `concurrent_claim.sh` en formato OK/FALLA; `security/rls_attacks.sql`, `profiles_tier.sql` y `trip_delete_conversation.sql` con esperado. Commits `6b2bb99`, `b1cfd5a`; `supabase/tests/run_all.sh` en `1ddd297` | 1) **M1** `20261022135300:210` `>=`→`>`: payments 68/88, 5 fallas (FALLA ERROR F4, P5b, L3b; FALLA L7; total), `run_all` **rc=1**. 2) **GRANT** de `claim_tracked_flights` a `authenticated`: ops 20/22 (FALLA T1 "reclamó 6", FALLA T3), security 185/186 (FALLA SG5), `run_all` **rc=1**. 3) **`20261024310000:280`**: prive FALLA P50, `run_all` **rc=1**. Extra: una línea basura en la `:280` da `FALLA migración 20261024310000_privekey_plans.sql: syntax error` y prive rc=1. Las cuatro mutaciones se restauraron con `git checkout` (`git diff` vacío) | CORREGIDO |
| **P3-QA-3** | P3 | **Antes:** ningún `run.sh` corría estos archivos; sobre la base de `security`, D5/D8 no cuadraban (auditoría). En base limpia, la primera corrida con veredicto dio 8 diferencias de formato `t`/`true`. **Después:** 11/11 y 27/27 | `security/run_trip.sh` (base propia, en orden). D6b y D11 (`[error abajo]`) pasan a comprobaciones reales; booleanos `true`/`false`. Commit `0bf087d` | Se cubre con la regla general (total esperado y código de salida) | CORREGIDO |
| **P3-QA-1** | P3 | **Antes** (`3db952a`, con `.env`): `vitest run tripSelectionsPersist godtierTripDetail` da 7/7 pasan, **7 errors** (`TripBookingIntents.tsx:23:30` `.not is not a function`), **exit 1**. **Después:** 0 errores; la corrida completa sale con exit 0 | `src/test/tripSelectionsPersist.test.tsx:24`, `src/test/godtierTripDetail.test.tsx:23` (`not: () => api`). Commit `1282083` | Quitar `not` del mock vuelve a dar los 7 errores (es la condición de "antes") | CORREGIDO |
| **P3-QA-2** | P3 | **Antes** (`3db952a`, sin `.env`): 6 archivos fallan (`supabaseUrl is required`), exit 1. Con el bloqueo de `fetch` ya puesto y antes de los mocks: **49 peticiones bloqueadas** en 3 archivos (21 a `/rest/v1/trips`, 21 a `/rest/v1/profiles?select=active_trip_id`, 5 a `open.er-api.com`, 2 a `geocoding-api.open-meteo.com`) y **13 pruebas en FALLA**. **Después:** `unshare -n` sin `.env`: 2,280/2,280, exit 0, 0 peticiones | `vitest.config.ts:14` (`test.env` FALSO, que pisa el `.env`), `src/test/setup.ts:10` (`fetch` bloqueado: la prueba falla con la URL), `src/test/priveHub.test.tsx:17` (`useActiveTrip`), `doubleSubmit.test.tsx:44` (`fetchFxTable`), `dashboardActiveTrip.test.tsx:45` (`fetchWeatherNow`). Commit `2064281` | Quitar cualquiera de los 3 mocks hace fallar sus pruebas con "La prueba intentó salir a la red" (es la medición de "antes") | CORREGIDO |
| **Pagos §4: CC3 no determinista** | P3 (calidad) | **Antes:** `sleep 0.5`. El método viejo (`cc3_loop.sh` de la auditoría, pausa 0, con 4 núcleos ocupados) y la mutación M1 de pagos (`pro_paid_period_lock` = `pg_sleep(0)`) dieron **5 OK falsos de 20**. **Después:** `payments/cc3_repeat.sh <db> 20`: sin mutación **20/20 OK**; con M1 **0 OK / 20 FALLA**; con M1 y 4 núcleos ocupados **0 OK / 20 FALLA** | `lib.sh:108` (`t_conc2`: compuerta con `pg_advisory_lock(20261026,k)`; la sesión 1 se queda con la transacción abierta y se comprueba en `pg_locks`; la sesión 2 corre después; se detecta si esperó un candado). `payments/concurrency.sh:61` (`pay_cc3` exige `s2_esperó=si`, `refunded` y 0 días). CONCURRENCIA ×2, CC1, CC2, CC4 y `ops` C2 usan lo mismo. Commit `b1cfd5a` | M1 de pagos (ver columna de prueba) | CORREGIDO |
| **Pagos §4: `stripeAtomicity.test.ts`** | P3 (calidad) | Es un modelo en memoria que reimplementa el SQL; no detecta M1, M2a, M2b ni M4 | Encabezado anotado (`src/test/stripeAtomicity.test.ts:9-22`) con lo que no detecta y qué pruebas SQL dan la garantía. No se borró. Commit `2cc6840` | — (anotación) | CORREGIDO (anotado) |
| **T-P2-6** (AUD-SEG-03) | P2 | **Antes:** la mutación de la auditoría (`.eq("id", trip.user_id)` en el perfil y `.eq("user_id", trip.user_id)` en el ADN de `index.ts`) deja la prueba vieja (regex) en **11/11 verde**. **Después:** con la misma mutación dentro de `loadPromptContext`, **2 pruebas FALLAN**; pasar `trip.user_id` en la llamada de `index.ts` hace fallar **1**; restaurado, **13/13** | `supabase/functions/generar-packing-list/access.ts:24` (`loadPromptContext(admin, trip, callerId)`), `index.ts:251`. `src/test/audSeguridadEdge.test.ts:110` (cliente simulado que registra filtros y filtra filas; dueño, colaborador y extraño) y una prueba de la llamada (que use `userId` de `userData.user.id` y que no lea esas tablas por fuera). Commit `5f13e13` | Ver columna de prueba | CORREGIDO (requiere publicar la función) |
| `aiReservationsConfirmRules` "cita inventada" | P3 | Sobrevive sin la corrección; la protege un fixture grabado (`IATOS_SEGUNDA_AUDITORIA.md:110`) | **No se tocó**: el grupo `reservas` trabaja en esos archivos. Nota para ellos: la prueba debe construir la cita inventada sin el fixture grabado, para que quitar `quotedRequestLinked` (`_shared/ai-reservations/evidence.ts`) la haga fallar | — | PENDIENTE (grupo `reservas`) |

## Qué se prueba y cómo (resumen)

- `supabase/tests/lib.sh` es nuevo y lo usan las 16 suites y `run_trip.sh`. La base se construye con todas las migraciones en orden y una sola vez. La idempotencia se prueba en una copia. `ERROR` cuenta como FALLA, una migración rota también, y cada suite tiene su total esperado y su código de salida.
- `supabase/tests/run_all.sh` es nuevo: base de referencia, 18 suites, comparación por md5 de `prosrc`, tabla y código de salida. Opciones `KEEP=1` y `OUT_DIR=`.
- Sigue con `sleep 0.5`: las dos pruebas de concurrencia de `cost/run.sh`. Con la máquina cargada pueden dar una FALLA falsa, pero no un OK falso. No las cambié; queda anotado en `CALIDAD_PRUEBAS.md` §4.
- Vitest: `src/test/setup.ts` bloquea `fetch`. Una prueba nueva que salga a la red falla con la URL. `XMLHttpRequest` y WebSocket no están bloqueados en el setup; la corrida con `unshare -n` (sin red) demuestra que hoy ninguna prueba los necesita.

## Observaciones

- Con carga alta (load 9–11), la primera corrida completa de Vitest dio 2 FALLA:
  - `priveUx` "sin texto en inglés": era una bomba de tiempo de `3db952a`. `activated_at` estaba fijo en `2026-10-22T18:30Z`, y también falla en el código base. `origin/main` la corrigió en `dfcde9f`; con el rebase, pasa.
  - `priveInvitation` "el token #t=…": la venció el `findBy` bajo carga. Sola pasa, y en la corrida final pasó.
- `npm run build` sigue necesitando un `.env` (`%VITE_SUPABASE_URL%` en `index.html`; P3-QA-4). No era parte de esta tarea y no lo cambié.

## Qué requiere autorización para producción

- **Función Edge `generar-packing-list`**: cambió `access.ts` e `index.ts`. El comportamiento es el mismo, solo se movieron las tres consultas a `loadPromptContext`. Hay que publicarla para que producción corra el código probado.
- **Migraciones: ninguna.** No agregué ni modifiqué migraciones; las mutaciones fueron temporales y quedaron restauradas.
- **Frontend: nada.** Solo cambiaron pruebas (`src/test/**`) y `vitest.config.ts`, que no entran al build.

## Archivos de evidencia (fuera del repositorio)

En el scratchpad de la sesión, `…/scratchpad/pr/`:
- `evidencia/final.txt` (`run_all` final) y `evidencia/vitest_final.txt`;
- `evidencia/mut_*.txt` y `evidencia/mut_*/` (`run_all` con cada mutación), `evidencia/antes_*.txt` (los mismos casos con los scripts viejos);
- `evidencia/mig_rota_prive.txt`, `evidencia/mut_seg03_*.txt`, `evidencia/vt1.txt` (peticiones bloqueadas antes de los mocks);
- `cc3_*.txt` (las repeticiones de CC3) y `antes/md5_antes.txt` (funciones distintas con los scripts viejos).

No forman parte del repositorio.
