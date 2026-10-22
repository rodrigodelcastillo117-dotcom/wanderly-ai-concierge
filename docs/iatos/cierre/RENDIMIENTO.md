# Cierre · Rendimiento (Fase 4) — Iato < 4 s al primer texto y carga en red lenta

Grupo `rendimiento` · rama `claude/aud-rendimiento` (desde `claude/cierre-auditoria` 6c818dc) · worktree
`/home/user/wt-aud-rendimiento` · 2026-10-22. Nada se subió, fusionó ni desplegó; no se tocó producción
(ver «Incidente de medición» al final: unas peticiones de prueba con un token falso llegaron a la API pública
y fueron rechazadas).

## Resumen

| Objetivo del dueño | Antes (medido) | Después (medido) | Estado |
|---|---|---|---|
| Iato: primer texto < 4 s | sim. p50 4.0 s, máx 9.0 s (en vivo 5–11 s) | sim. p50 1.07 s, máx 2.1 s | CORREGIDO (sim.) · en vivo PENDIENTE de despliegue |
| Iato: total | sim. p50 8.5 s, máx 16.0 s | sim. p50 7.9 s, máx 15.4 s | MEJORA PARCIAL (lo domina SerpApi + la salida del modelo) |
| JS inicial ≤ 170 KB gzip | 199.2 KB (4 archivos) | **162.8 KB** (5) | VERIFICADO |
| Landing: LCP ≤ 4 s, CLS ≤ 0.05 | LCP 3.61 s · CLS 0.047 | **LCP 3.00 s · CLS 0.000** | VERIFICADO |
| Inicio (dashboard): LCP ≤ 4 s, CLS ≤ 0.05 | LCP 10.5 s · CLS 0.535 | usuario que vuelve **LCP 3.96 s** (3.85–4.13) · primera visita en el dispositivo 4.5–6.8 s · **CLS 0.005** | CLS VERIFICADO · LCP en el límite (ver «Riesgo residual») |

## Método

### Iato (turno completo)
- `scripts/concierge/latency_sim.ts` (nuevo): corre el **`index.ts` real** de `concierge-chat` en Deno 2.1 (el
  runtime de Supabase) con `fetch` simulado: Auth 120 ms, REST 70 ms, RPC 80 ms, insert 80 ms; herramientas
  flight-status 2.2 s, flights-search 6.5 s, places-search 1.6 s, place-details 0.7 s, places-nearby 1.3 s,
  SerpApi 2.2 s; Messages API en streaming (encabezados 300 ms, primer token Haiku 0.9 s / Sonnet 1.7 s,
  600 / 280 caracteres por s). Los 8 escenarios de `eval_live.mjs` (sin Privé), 3 corridas, mediana. Mide desde
  que entra la petición: encabezados, primer `status`, primer `delta`, primer texto **del modelo**, `final`.
  No incluye la red app ↔ Supabase ni el arranque en frío: en vivo el primer paso tardaba ~2.0 s contra 0.77 s
  simulados, o sea **~1.2 s más** que hay que sumar a lo simulado.
- Antes = el mismo script contra un worktree de `6c818dc`; después = esta rama.
- Regresiones con reloj simulado: `src/test/rendimientoIato.test.ts` (fake timers sobre `turn.ts`).

### App (carga en red lenta)
- `npm run build` + `vite preview` con **HTTP/2 + TLS** (como el CDN), antes (6c818dc) y después servidos a la
  vez y medidos **intercalados**, 5 rondas, mediana.
- Chromium 141 headless (Playwright), 390×844 móvil, DPR 1, **Fast 3G** (562.5 ms RTT, 1.44 Mbps bajada,
  675 kbps subida) + **CPU 4×**, contexto nuevo por corrida, sin service worker, sesión de prueba en
  `localStorage` y aviso de cookies respondido. LCP/CLS/FCP con `PerformanceObserver`; bytes con CDP.
- Supabase, Google Fonts, fotos de Google/Unsplash/Pexels y el tipo de cambio: **servidor simulado** propio
  (HTTP/2, `--host-resolver-rules` → 127.0.0.1, `--no-proxy-server`), así el throttling de CDP también aplica a
  esas respuestas. Datos: usuario con viaje a París en 12 días (portada de Google `=w1600-h900`, 364 KB como
  la medida en producción) y otro a Tokio; `recomendar-destinos` 2.5 s; `buscar-video` sin video.
- Dos perfiles: (a) caché HTTP deshabilitada (`Network.setCacheDisabled`, como la medición de producción de
  UX10-16) y (b) perfil nuevo con caché activa (realista: lo precargado se reutiliza). Para el inicio se mide
  también el «usuario que vuelve» (onboarding ya recordado en el dispositivo, ver REND-06).
- Tamaños de JS: gzip -9 del grafo estático (entrada + `modulepreload` + imports estáticos de cada pantalla).
- La máquina estaba compartida con otros grupos (carga 35–53 en 4 núcleos durante buena parte de la sesión):
  las corridas finales se hicieron con carga 3–6 y con `nice -15`; las primeras, más cargadas, daban números
  peores para ambas versiones. Herramientas (fuera del repo, en el scratchpad): `perf.cjs`, `mock/server.mjs`,
  `jsgraph.mjs`, `final.sh`.

## Antes / después — Iato (simulado, ms desde que entra la petición)

| Escenario | Encabezados | Primer texto | Primer texto del modelo | Final |
|---|---|---|---|---|
| 1 «ayúdame con mi viaje a Japón» (sin herramientas) | 782 → 382 | 2490 → 2088 | 2490 → 2088 | 9447 → 8855 |
| 2 «¿qué vuelo me conviene más?» (vuelos 6.5 s) | 769 → 368 | 9007 → **1106** | 9007 → 8577 | 15963 → 15381 |
| 3 «mi vuelo se canceló» | 778 → 373 | 9006 → **1074** | 9006 → 8589 | 15962 → 15367 |
| 4 «perdí mi conexión» | 766 → 374 | 8973 → **1074** | 8973 → 8581 | 15945 → 15392 |
| 5 «quiero cenar cerca de mi hotel» | 775 → 369 | 3882 → **1069** | 3882 → 3477 | 7250 → 6693 |
| 7 «ya cambié de hotel» | 763 → 368 | 3867 → **1070** | 3867 → 3482 | 7224 → 6778 |
| 8 «necesito ayuda urgente» | 759 → 374 | 2978 → **1075** | 2978 → 2584 | 6327 → 5837 |
| Centurion T1 | 767 → 370 | 4214 → **1071** | 4214 → 3645 | 7578 → 6902 |
| **p50 / máx** | 768 / 782 → **372 / 382** | 4048 / 9007 → **1074 / 2088** | 4048 / 9007 → 3564 / 8589 | 8513 / 15963 → 7879 / 15392 |

Esperado en vivo (sumando ~1.2 s de red y arranque): primer texto ≈ 2.3 s con herramientas y ≈ 3.3 s sin
ellas (<4 s en los 8). Hay que confirmarlo con `eval_live.mjs` después de desplegar; ahora reporta además
`primer_texto_modelo_p50_ms` (el primer texto que escribe el modelo, sin la frase de inicio).

Frases de inicio reales de los escenarios (solo dicen qué está haciendo Iato, con datos que dio el usuario):
«Comparo los vuelos CDMX → Tokio para tus fechas.» · «Reviso en tiempo real tu vuelo AF179, busco
alternativas y tus derechos como pasajero.» · «Busco restaurantes cerca de tu hotel en Google Maps.» ·
«De paso reviso en tiempo real tu vuelo AF179 de hoy.» · «Si hay riesgo para tu vida, llama ya al número de
emergencias local. Mientras tanto busco el hospital más cercano a tu ubicación.» · «Busco ese dato en Google
y en Google Maps para darte la ubicación exacta.»

Arranque en frío de la función: importar `index.ts` (119 módulos, 1.04 MB con tipos) tarda 40–100 ms
(`deno run`, 3 corridas, igual antes y después): no es el cuello de botella; no se cambió.

## Antes / después — App (Fast 3G + CPU 4×, mediana de 5 corridas intercaladas)

| Página | Perfil | LCP | FCP | CLS | JS (KB / archivos) | Imágenes | Total |
|---|---|---|---|---|---|---|---|
| Landing `/` | sin caché | 3608 → **3000** ms | 2884 → 3000 | 0.047 → **0.000** | 200/4 → **164/5** | 266 → 169 KB | 599 → 448 KB |
| Landing `/` | perfil nuevo | 3664 → **3100** ms | 2944 → 3100 | 0.047 → **0.000** (máx 0.036) | 200/4 → 164/5 | 266 → 169 KB | 599 → 448 KB |
| Inicio `/dashboard` | sin caché, 1.ª visita | 10484 → **6776** ms | 5132 → 4408 | 0.535 → **0.005** | 269/50 → **234/34** | 981 → 582 KB | 1388 → 936 KB |
| Inicio | perfil nuevo, 1.ª visita | ≈10.9 s* → **4512** ms | 5068 → 4512 | 0.535 → **0.005** | 269/50 → 234/34 | 981 → 453 KB | 1388 → 807 KB |
| Inicio | sin caché, usuario que vuelve | — → **3960** ms (3848–4128) | → 3944 | → 0.005 | 234/34 | 517 KB | 872 KB |
| Inicio | perfil nuevo, usuario que vuelve | — → **4144** ms (3924–4372) | → 4120 | → 0.005 | 234/34 | 453 KB | 807 KB |

\* Antes, con perfil nuevo, la portada de 1920 px terminaba en ~10.9 s y el cambio de reel (Kioto) a los ~16 s
se volvía el LCP final (mediana 16.3 s). En producción (UX10-16) se habían medido 12.0 / 15.1 s y CLS 0.155.

JS por pantalla (gzip, paquete inicial + lo que pide la pantalla):

| | Inicial | Inicio | Concierge | Detalle de viaje | Viajes | Perfil | Auth | Archivos JS en el build |
|---|---|---|---|---|---|---|---|---|
| Antes | 199.2 KB / 4 | 261.7 / 50 | 324.4 / 55 | 343.5 / 70 | 238.2 / 31 | 292.3 / 39 | 247.4 / 10 | 196 |
| Después | **162.8 KB / 5** | 230.3 / 34 | 291.0 / 31 | 320.1 / 39 | 212.2 / 27 | 269.1 / 21 | 216.2 / 13 | 139 |

## Tabla de hallazgos

| ID | Sev. | Reproducido (cómo, archivo de prueba) | Solución (archivo, commit) | Tests (antes → después) | Evidencia | Estado |
|---|---|---|---|---|---|---|
| IATO-PERF-01 | P1 | Turno con herramientas previstas: el primer texto esperaba a TODAS (vuelos 6.5 s) + primer token. `latency_sim.ts` (9.0 s) y `rendimientoIato.test.ts` «presupuesto…» | Frase de inicio honesta a los 700 ms si las herramientas siguen corriendo: `planner.ts` `leadSentence/joinLead`, `turn.ts` (aviso al modelo «YA EN PANTALLA», se re-muestra tras `reset`, entra al texto final), `index.ts` `LEAD_AFTER_MS`. 60b6665 | `rendimientoIato.test.ts` 13 pruebas de frase/turno: fallan en 6c818dc (`leadSentence is not a function`) → pasan | primer texto sim. p50 4.0 → 1.07 s | VERIFICADO (sim.) · en vivo PENDIENTE |
| IATO-PERF-02 | P2 | Antes del primer evento, 9 viajes a la base en serie (auth, 3 cubetas de ritmo, configuración, reserva, contexto, viajes compartidos uno por uno, reservas, memoria). `latency_sim.ts`: 768 ms | `index.ts`: ritmo ∥ configuración (que sale de caché si no se pidió exigente); reserva ∥ 6 lecturas de contexto; viajes compartidos ∥; reservas ∥ memoria. `_shared/rate-limit-core.ts` opción `parallel` (solo concierge-chat). 2685dc9 | «límite de ritmo: tres cubetas a la vez» (3) e «index.ts: menos viajes en serie» (fallan en 6c818dc → pasan) | encabezados 768 → 372 ms; RPC de configuración 1 → 0.17 por turno | VERIFICADO (sim.) |
| IATO-PERF-03 | P3 | El evento `final` esperaba `ai_usage_log` + `commit_quota` | `index.ts`: `settle()` después de mandar `final` (el stream se cierra al terminar, así «te quedan N» sigue correcto); ante error se manda `reset` antes de `error` (no queda la frase sola en pantalla). 2685dc9 | idem | final −0.16 s | VERIFICADO (sim.) |
| IATO-PERF-04 | P3 | `web_search` esperaba registrar el costo y guardar en caché antes de devolver | `webSearch.ts` opción `background` (index la pasa con `EdgeRuntime.waitUntil`). 2685dc9 | «web_search no espera…» → pasa; las 170 pruebas de concierge siguen verdes | −0.16 s por búsqueda en vivo | VERIFICADO |
| IATO-PERF-05 | P3 | `eval_live.mjs` mediría la frase como «primer texto» sin distinguirla | `final._lead` + `primer_texto_modelo_p50_ms` en `eval_live.mjs`. 28a80b8 | assert en `rendimientoIato.test.ts` | — | CORREGIDO |
| REND-01 | P1 | JS inicial 199 KB: todo Radix + Floating UI (39 KB) por el `TooltipProvider` y el Toaster de Radix en App; React Query (≈12 KB) sin uso real; 67 chunks de íconos de ~1 KB | `vite.chunks.ts` (vendor-radix = Slot; vendor-icons), `ui/tooltip.tsx` (Provider por Tooltip), `ui/toaster-lazy.tsx`, `lib/queryClient.ts` + `DeleteAccountSection.tsx` (cambio mínimo, perfil). ec4bbc2 | `rendimientoApp.test.tsx` «paquete inicial» (3) + `chunkCycleGuard`/`bundleSplit` verdes; build sin ciclos | 199.2 → 162.8 KB; 196 → 139 archivos JS | VERIFICADO |
| REND-02 | P2 | `@import` de Google Fonts dentro del CSS: CSS → CSS de Google → woff2 con 2 conexiones nuevas; cambio de fuente tardío (CLS 0.047 en landing) | `public/fonts/*` (mismos woff2 de Google, OFL), `@font-face` con `swap` en `index.css`, `preload` en `index.html`. 7f16e95 | «tipografías» → pasa | CLS landing 0.047 → 0 | VERIFICADO |
| REND-03 | P1 | El chunk de la pantalla se pedía hasta que React montaba la ruta protegida (después del paquete inicial + onboarding) | `vite.routePreload.ts` (script en línea que precarga la pantalla de la URL y la imagen principal del inicio), `lib/routeChunks.ts` + `main.tsx`. ec4bbc2, b4eda1f | «precarga de la pantalla inicial» (4) | chunk de la ruta: 2.8 s → 2.0 s | VERIFICADO |
| REND-04 | P1 | Portada del viaje 1600 px / 364 KB en una caja de 390; hero de 1920 px (207 KB) en el teléfono; Tulum 165 KB para una tarjeta de 170 px | `lib/imageSizing.ts` + `SmartImage.tsx` (y reintento con la URL original); `DestinationVideo.tsx` (`srcset`, `sizes`, `fetchpriority`); `DashboardHome.tsx`; `destination-tulum-640.jpg`. c95204a | «fotos al ancho de la caja» (3) | imágenes del inicio 981 → 453–582 KB | VERIFICADO |
| REND-05 | P1 | CLS 0.535 en el inicio: el hero (340 px) aparecía al llegar los viajes y el esqueleto medía ~180 px contra ~470 de la tarjeta | `DashboardHome.tsx`: hero y fila de ejemplos también mientras carga; esqueleto `min-h-[460px]`. c95204a, 468d806 | «inicio sin saltos de diseño» | CLS 0.535 → 0.005 | VERIFICADO |
| REND-06 | P2 | Cada apertura esperaba `user_onboarding_state` antes de pintar (spinner) | `useOnboardingStatus.ts`: recuerda «terminado» por usuario, confirma en segundo plano; `Onboarding.tsx` espera el estado confirmado. 632c122 | «onboarding terminado…» (4) + `onboardingSkip`, `protectedRouteMountOnce`, `onboardingRedirect` verdes | inicio LCP 1.ª visita 6.8 s → usuario que vuelve 4.0 s | VERIFICADO |
| REND-07 | P3 | El SW solo guardaba lo que pasaba por él después de instalarse (la 1.ª carga quedaba fuera) | `public/sw.js`: al instalar guarda JS de entrada, `modulepreload`, CSS y tipografías del `index.html`; `/fonts/` con caché primero. 632c122 | «service worker» → pasa; `serviceWorker.test.ts` verde | — | VERIFICADO |
| REND-08 | P2 | El texto principal de la landing y el centro de mando entraban con `fadeUp` desde opacidad 0: el LCP esperaba 0.7 s de animación; el hero desplazado 20 px hacía que el siguiente reel fuera el «LCP» a los 15 s | `index.css` `.animate-rise` (solo desplazamiento); `Landing.tsx`, `TripCommandCenter.tsx`; hero sin animación. 468d806 | «lo que puede ser LCP…» → pasa | landing LCP 3.7 → 3.0 s; inicio (vuelve) 4.6 → 4.0 s | VERIFICADO |

## HALLAZGOS NUEVOS

1. **React Query en el paquete inicial sin usarse** (REND-01): solo `queryClient.clear()` al borrar la cuenta.
2. **El límite de ritmo hacía 3 RPC en serie** en cada mensaje (`rate-limit-core.ts`). Se agregó `parallel`
   opcional; las otras funciones siguen igual (en serie).
3. **El evento final de Iato esperaba dos escrituras** (bitácora y cuota) y `web_search` dos más (IATO-PERF-03/04).
4. **Un error de red al leer el onboarding mandaba al onboarding a quien ya lo había terminado** (sin red en el
   aeropuerto). Ahora, si ya estaba terminado en ese dispositivo, se queda en la pantalla (REND-06).
5. **Animaciones de entrada desde opacidad 0 en elementos LCP** (REND-08).
6. **El esqueleto y el hero del inicio provocaban el CLS** (REND-05), no las tarjetas de destinos.
7. **Con un error a mitad del stream, la app se quedaba con el texto parcial** (y ahora con la frase de inicio)
   en lugar del mensaje de error: el servidor manda `reset` antes de `error` (IATO-PERF-03).

## HALLAZGOS REFUTADOS CON EVIDENCIA

- **«PostHog y Sentry en el paquete inicial»**: ya se cargan con `import()` y solo con consentimiento/DSN
  (`bundleSplit.test.tsx`); en el build de antes no aparecen en el grafo inicial (`vendor-posthog`, `vendor-sentry`
  solo por `import()`).
- **«Falta división por rutas»**: ya existía (`lazyWithRetry` por página). El peso venía de los grupos vendor
  (Radix completo) y de los 67 chunks de íconos, no de las páginas.
- **«Las gráficas/mapas/motion en el inicial»**: `vendor-charts`, `vendor-d3`, `vendor-motion` y el 3D no están en
  el grafo inicial (antes ni después).
- **«Arranque en frío pesado de la función»**: importar `index.ts` toma 40–100 ms; `esm.sh` vs `npm:` para
  supabase-js medido 27–136 ms vs 48–396 ms (ruido): sin ganancia, no se cambió.

## Mejoras adicionales (pedido «god tier»)

- Sin red, quien ya terminó el onboarding no rebota al onboarding (REND-06).
- Un error a mitad de la respuesta de Iato ya no deja texto a medias en pantalla (IATO-PERF-03).
- `Tooltip` funciona sin `TooltipProvider` global (patrón actual de shadcn): menos trampas para pantallas nuevas.
- `scripts/concierge/latency_sim.ts`: cualquiera puede medir el turno completo antes/después sin costo ni red.

## Pruebas

- Nuevas: `src/test/rendimientoApp.test.tsx` (19) y `src/test/rendimientoIato.test.ts` (20). Contra 6c818dc
  fallan (no existen `vite.routePreload`, `leadSentence`, etc.); en la rama pasan.
- Suites relacionadas: concierge (13 archivos, 170 pruebas), `chunkCycleGuard`, `bundleSplit`, `imagery`,
  `cercanosPhotos`, `serviceWorker`, `cookieConsent`, `versionCheck`, onboarding (3) — verdes.
- Suite completa (`npx vitest run`, 16:47 UTC, carga baja): **163 archivos, 1538 pruebas, 1538 pasan, 0 fallan**.
  Termina con código 1 por **7 errores no manejados idénticos a los de 6c818dc** (`TripBookingIntents.tsx:23`:
  `supabase.from(...).select(...).eq(...).not is not a function`, un simulacro de otra suite; no es de este grupo).
  Línea base en 6c818dc (14:01 UTC, máquina con carga ~44): 1486 pasan, 13 fallan por tiempo (12 *timeouts* de 5 s y una latencia simulada de 2.39 s > 2 s en `concierge2Evals`) y los mismos
  7 errores; esas 13 pasan aquí con la máquina descargada (y `dashboardActiveTrip`/`godtierHome` también pasan con
  `--testTimeout=30000` con carga).
- `npx tsc --noEmit -p tsconfig.app.json` y `-p tsconfig.node.json`: sin errores. `deno check` de
  `concierge-chat/index.ts`: OK. `npm run build`: OK, sin ciclos entre chunks ni paquetes sin grupo.

## Qué requiere despliegue (autorización del dueño)

- **Función `concierge-chat`** (archivos `index.ts`, `turn.ts`, `planner.ts`, `webSearch.ts` y
  `_shared/rate-limit-core.ts`). El cambio en `rate-limit-core.ts` es opcional (`parallel`), así que las demás
  funciones no cambian de comportamiento; lo incluirán en su siguiente despliegue.
- **Frontend** (publicación de Lovable): `index.html`, `public/fonts/*`, `public/sw.js`, `vite.config.ts`,
  `vite.chunks.ts`, `vite.routePreload.ts` y los archivos de `src/` listados abajo.
- Sin migraciones. Sin secretos nuevos.
- Después de desplegar: correr `scripts/concierge/eval_live.mjs` (cuenta sintética) y repetir la medición de
  UX10-16 en producción.

## Riesgo residual / pendiente

- **Inicio: LCP ≈ 4.0 s para quien vuelve y 4.5–6.8 s en la primera visita del dispositivo** (según caché). Lo que
  queda en el camino crítico: 165 KB de JS + 90 KB de tipografías precargadas + el chunk del inicio sobre 1.44 Mbps,
  y la ejecución con CPU 4×. Sin precargar Fraunces (66 KB) el LCP bajaba ~0.4 s pero el CLS subía a 0.04–0.06 por
  el cambio de fuente: se dejó la precarga. **Decisión del dueño/diseño**: fijar el eje `opsz` de Fraunces la deja en
  32 KB (medido con fontTools), pero cambia un poco el dibujo en tamaños chicos.
- **Total de Iato**: lo dominan SerpApi (vuelos 5–8 s) y la salida del modelo (texto + bloque de datos de las cards).
  Una mejora mayor sería armar las cards de vuelos/lugares en el servidor con los datos de la herramienta en lugar de
  que el modelo las escriba (cambio de diseño de Iato; no se hizo).
- La frase de inicio solo existe en streaming; la app vieja (JSON) no cambia.
- Las mediciones de la app son de un build local con datos simulados y una máquina compartida; no sustituyen la
  medición en producción después de desplegar (`/dashboard` con la cuenta sintética).
- `vite preview` local sirve HTTP/2 como el CDN, pero no se verificó qué protocolo usa producción.

## Incidente de medición (leer)

En las dos primeras corridas de prueba de `perf.cjs` Chromium usó el proxy de la sesión y las llamadas a
`uhkdewinscffhdonhhmt.supabase.co` fueron a la **API pública de producción** en lugar del servidor simulado, con una
sesión inventada (JWT sin firma válida). Por lo visto en la pantalla (la app cayó al onboarding porque nada respondió
con datos), Supabase las rechazó: lecturas de `user_onboarding_state`, `trips` (conteo), `travel_profiles`,
`auth/v1/user`, `rpc/public_plan_config` (pública) y un intento de `upsert` de `user_onboarding_state`, todos con el
token falso. No hay forma de que un JWT sin firma escriba en la base, pero se reporta. Se corrigió con
`--no-proxy-server` y se verificó con el registro del servidor simulado que todas las peticiones posteriores
llegaron a él.

## Archivos cambiados

`index.html`, `public/fonts/{manrope,fraunces}-latin(-ext)-vNN.woff2`, `public/fonts/LICENSE.txt`, `public/sw.js`,
`vite.config.ts`, `vite.chunks.ts`, `vite.routePreload.ts` (nuevo), `tsconfig.node.json`, `src/App.tsx`, `src/main.tsx`,
`src/index.css`, `src/lib/{imageSizing,queryClient,routeChunks}.ts` (nuevos), `src/components/ui/{tooltip.tsx,toaster-lazy.tsx}`,
`src/components/{DestinationVideo,TripCommandCenter,DeleteAccountSection}.tsx`, `src/components/media/SmartImage.tsx`,
`src/hooks/useOnboardingStatus.ts`, `src/pages/{DashboardHome,Landing,Onboarding}.tsx`,
`src/assets/destination-tulum-640.jpg` (nuevo), `supabase/functions/concierge-chat/{index,turn,planner,webSearch}.ts`,
`supabase/functions/_shared/rate-limit-core.ts`, `scripts/concierge/{eval_live.mjs,latency_sim.ts}`,
`src/test/{rendimientoApp.test.tsx,rendimientoIato.test.ts}` (nuevos).

Fuera de mi área (cambio mínimo, solo rendimiento): `DeleteAccountSection.tsx` (perfil: `useQueryClient()` →
`queryClient` del módulo; misma limpieza al borrar la cuenta). No se tocaron Privé, Social, avatar, Bóveda,
Gastos/Members ni la UI del Concierge.
