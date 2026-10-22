# Release 10 · Grupo ux · Fases 10 y 11 en producción (2026-10-22)

Entorno: https://traveliatos.life con Playwright (Chromium de /opt/pw-browsers, headless), cuenta sintética
**A (free)** solamente. La cuenta B no se usó. Rama: `claude/wc-r10-ux` (worktree `/home/user/wt-ux`, base
`claude/iatos-world-class` 0e50f1e). Nada se subió ni se fusionó.

**Versión del frontend probada** (cambió durante la sesión, sin aviso):

| Etiqueta | Chunk principal | Commit | Pruebas que corrieron sobre ella |
|---|---|---|---|
| V1 | `assets/index-CMK6gH6h.js` | b04ad9e | Barrido de rutas (7 anchos), Privé/Members (1ª pasada), axe, teclado |
| V2 | `assets/index-BnriLFFh.js` | 0e50f1e (Members Only) | Privé/Members (2ª pasada), red lenta, censo de funciones, verificación prod vs local, 429 de fotos |
| V3 | ver sección «Re-verificación tras la publicación» | — | Gastos, Cercanos, Smart Spend |

El cambio V1→V2 ocurrió entre las 07:05 y las 07:44 UTC; la pasada de «botones muertos» quedó a caballo entre
ambas. Las diferencias entre V1 y V2 son solo de Members Only (UI de `members_venues`); el adelanto para free se
re-ejecutó en V2 con el mismo resultado.

Herramientas (fuera del repo, en el scratchpad): `sweep.js` (barrido), `audit.js` (auditoría en página),
`prive.js`, `axe.js` (@axe-core/playwright 4.x), `keyboard.js`, `fixer_kb.js`, `deadbtn.js`, `perf.js` (CDP:
Fast 3G = 562.5 ms RTT, 1.44 Mbps de bajada, 675 kbps de subida; CPU 4×), `census.js`, `verify.js`. Una guardia
de red abortaba en el navegador las funciones de SerpApi/IA/pagos/correos/borrados (ver «Incidente» abajo).

## Resumen

| Estado | Filas |
|---|---|
| PASS | 27 |
| FAIL | 24 |
| BLOCKED | 0 |
| NOT_RUN | 2 |
| NOT_APPLICABLE | 0 |

Defectos: **P0 0 · P1 1 · P2 12 · P3 12**. Ninguno de seguridad.
Corregidos en la rama (con prueba): 15 · parcial: 1 · sin corregir: 9 (P3 casi todos, o decisión del dueño).

### Incidente de la propia prueba (leer primero)
Al reproducir el texto técnico de «Editar con IA» con una respuesta 503 simulada, la ruta simulada quedó
registrada **antes** que la guardia general de Playwright; la guardia se ejecutó primero y dejó pasar la llamada.
Resultado: **4 llamadas reales a `editar-viaje-ai`** (07:37:03, :11, :24, :31 UTC; 4 filas nuevas en
`trip_quotes`) sobre el viaje sintético de A «E2E PRUEBA Puebla» (`92a52e51…`). El tope de IA del grupo era 3:
**se excedió en 1**. La IA reescribió textos de hospedaje/itinerario de ese viaje (datos de A, nadie más). No
hay respaldo previo para restaurarlo; se deja como está. La guardia se corrigió (lista completa de funciones de
costo y orden de registro) y el censo posterior confirma qué llama cada pantalla.
Observación para el grupo de viaje: tras 4 ediciones concurrentes, `trips.current_quote_id` quedó en la 3.ª
cotización (88e8a752, 07:37:24) y no en la última (400b0422, 07:37:31); `trips.updated_at` = 07:37:11.

Gasto: **SerpApi 0** (todas las funciones de SerpApi abortadas en el navegador; el censo confirma que ninguna
pantalla las llama al cargar). **IA 4** (las 4 de arriba). `recomendar-destinos` (IA) se llamó en cada carga del
dashboard pero respondió desde su caché de 24 h (fila creada 02:35 UTC, antes de esta sesión): 0 llamadas a la IA.
`concierge-chat` 0. Stripe: «Contratar IATOS PRO» se pulsó 2 veces en la pasada de botones; `stripe-checkout` fue
abortado en el navegador (no se creó sesión). Correos: 0.

## Defectos priorizados

| Def. | Sev. | Pantalla / ancho | Qué pasa (medido en prod) | Estado en la rama | Prueba |
|---|---|---|---|---|---|
| UX10-03 | **P1** | /dashboard/concierge a 375×667 y 320×568 | El compositor de Iato queda **debajo** de la barra inferior (borde inferior 688 px vs barra en 589 px a 375×667); la zona de conversación mide 48 px. A 390×844 la conversación mide 96 px. | PARCIAL: a 375×667 el compositor ya se ve (574 < 589) y a 390×844 la conversación pasa a 222 px; a 320×568 sigue tapado (602 vs 490). Ver DECISIONES. | `uxRelease10` «UX10-03» + `verificacion_local.json` |
| UX10-01 | P2 | /dashboard/ruta (y patrón en /dashboard/planear), 320–412 | La columna de la cuadrícula crece a 634 px en una pantalla de 390: el formulario queda cortado a la derecha (no hay scroll porque `main` oculta el desborde). | CORREGIDO (`grid-cols-1`): columna 342 px, borde 366 < 390. | «UX10-01» |
| UX10-02 | P2 | Landing a 320 | «Empezar gratis» sale 36 px fuera de la pantalla (borde 340 > 320). | CORREGIDO: borde 304. | «UX10-02» |
| UX10-04 | P2 | Panel de notificaciones a 320–412 | El panel (340 px, anclado a la campana) empieza en x = −54: el título se lee «…caciones». | CORREGIDO: x 12 → 378. | «UX10-04» |
| UX10-07 | P2 | Fixer (Concierge), todos | No es un diálogo para lectores de pantalla (sin `role=dialog`/`aria-modal`), el foco se queda detrás, Tab recorre la página tapada, **Escape no cierra** (2/2 anchos). La copia promete «Un humano revisa tu caso y abre conversación por WhatsApp» y el tooltip «Un humano premium toma el control vía WhatsApp»; no dice «sujeto a disponibilidad». | CORREGIDO: hook `useModalA11y`, copia «…sujeto a disponibilidad». | «UX10-07» (3) |
| UX10-12 | P2 | «Editar con IA» en el detalle del viaje, 390 | Mismo problema de diálogo; además la barra inferior tapa «Cancelar / Aplicar cambios» (el punto central del botón cae en la barra); y un error del servidor se mostraba con `e.message` («Edge Function returned a non-2xx status code»). | CORREGIDO: portal a `<body>`, `z-[100]`, `readFunctionError`. Verificado local: el clic cae en «Aplicar cambios». | «UX10-12» (2) |
| UX10-11 | P2 | Concierge, todos | Sin permiso de ubicación (o aviso sin contestar) el encabezado dice «Detectando tu ubicación real…» para siempre (15 s+ en los 7 anchos). | CORREGIDO: «Ubicación no disponible» (error o 12 s sin respuesta). | «UX10-11» |
| UX10-13 | P2 | /dashboard/viajes/:id | Cada tarjeta pide su foto a `pexels-image` y, si falla, reintenta con 2 consultas más: una carga hizo **42 POST** (límite 30/min) y las 42 devolvieron **429** (2/2 cargas tras 70 s de reposo; el límite por hora ya estaba agotado por el barrido). Se ven 2 imágenes. | CORREGIDO: sin reintentos tras un fallo y pausa de 60 s tras un 429. | «UX10-13» (2) |
| UX10-06 | P2 | Concierge | axe **critical** `button-name`: el botón Enviar no tiene nombre; la zona de conversación no es accesible por teclado (`scrollable-region-focusable`). | CORREGIDO: «Enviar mensaje», «Dictar por voz», «Mensaje para Iato», región «Conversación con Iato». | «UX10-06» |
| UX10-08 | P2 | /dashboard/seguros, /dashboard/autos, /dashboard/esim | Copia de socios: «Atención 24/7 en español», «soporte 24/7», «Datos ilimitados en 170+ destinos». | CORREGIDO. | «UX10-08» (3) |
| UX10-09 | P2 | Members (adelanto), 1440 | axe `color-contrast` serious ×9: los conteos «(175)» con `opacity-60` dan 3.41:1. | CORREGIDO. | «UX10-09» |
| UX10-16 | P2 | /dashboard en red lenta (390, Fast 3G + CPU 4×) | Frío (sin service worker): LCP 12.0 s y 15.1 s, TTI ≈ 10.3–10.5 s, **CLS 0.155** (4/4 corridas), 1.48–1.68 MB, 36 archivos JS (249 KB gzip). Los primeros ~5 s solo hay un spinner; el skeleton aparece a ~6 s. Lo más pesado: una imagen de `lh3.googleusercontent.com` de 364 KB y `hero-santorini` completa (207 KB) en móvil (la landing sí usa la de 960 px). | NO CORREGIDO (perf; ver «Pendiente»). | `data/perf_r*.json` |
| UX10-05 | P3 | Todas las pantallas privadas, ≤412 | Objetivos < 40 px: logo de la barra 98×28, avatar 36×36, «Volver» 80×30 (22 rutas), cierre de consejos 22×22. | CORREGIDO (estos cuatro). | «UX10-05», «UX10-05b» |
| UX10-17 | P3 | Concierge ≤412 | Siguen < 40 px: «Auto-refresh 60s» 105×16, «Lo que Iato recuerda» 121×16, selector «Viaje en contexto» 256×25; el aviso «Iato te preguntará cuál» queda en una columna de ~40 px. | NO CORREGIDO (va con la decisión de UX10-03). | barrido |
| UX10-18 | P3 | Varias, ≤412 | Otros < 40 px: puntos del carrusel 6×4, iconos editar/borrar de Mis viajes 30×30, «Buscar con voz» 28×28, «¿Olvidaste tu contraseña?» 20 px de alto, enlaces legales del pie 17 px. | NO CORREGIDO. | barrido, axe `target-size` |
| UX10-10 | P3 | Selector de viaje del Concierge | Un viaje sin fechas se muestra «SEC-TEST-A-own (? al ?)». | CORREGIDO («(sin fechas)»; está en `_shared/activeTrip.ts`, también lo usa `concierge-chat`). | «UX10-10» |
| UX10-14 | P3 | /dashboard/actividades a 320 | Pestañas encimadas: «AtraccionesRestaurantes». | NO CORREGIDO. | img |
| UX10-15 | P3 | /dashboard/gastos a 320 | Tercera pestaña recortada: «Calculad… de viaj». | NO CORREGIDO; re-verificar con V3. | img |
| UX10-19 | P3 | /dashboard/viajes/:id/clima | Con un destino que no se geolocaliza: «No se pudieron determinar los destinos.» sin acción (callejón sin salida). | NO CORREGIDO. | hoja 320 c |
| UX10-20 | P3 | /prive | Titular en inglés («There are places you visit. And there are worlds you enter.») en una app es-MX. | DECISIÓN DEL DUEÑO (marca). | PRV-01 |
| UX10-21 | P3 | /prive/invitacion (free que nunca tuvo PRO) | «Tu plan PRO no está activo en este momento» sugiere que lo tuvo. | NO CORREGIDO. | PRV-02 |
| UX10-22 | P3 | /prive/restablecer (free sin membresía) | Ofrece «Enviarme el enlace» para restablecer una contraseña Privé que la cuenta no tiene (no se pulsó). | NO CORREGIDO. | `prive.json` |
| UX10-23 | P3 | /dashboard (1440) | Fecha «Jueves, 22 De Octubre De 2026» (mayúsculas de título; en español van minúsculas). | NO CORREGIDO. | img botones |
| UX10-24 | P3 | /dashboard/esim, /dashboard/ferries | Ejemplos en inglés («Spain, Japan, Mexico…», «Athens (Piraeus)»). En eSIM el texto arma la URL de Airalo en inglés, así que traducirlo rompería el enlace. | NO CORREGIDO (necesita mapa de países). | hoja 320 a/b |
| UX10-25 | P3 | Perfil; tarjetas del dashboard; Pro | axe serious: botón destructivo 4.25:1; `label-content-name-mismatch` en tarjetas «Planear viaje a …»; `scrollable-region-focusable` en chips del perfil. | NO CORREGIDO. | `data/axe.json` |

No se encontraron botones muertos (ver 3.3), imágenes rotas (0/404 cargas), texto técnico en pantalla (0/404),
ni scroll horizontal de página (0/404; el desborde existe pero queda recortado: UX10-01/02/04/14/15).

## Tabla de pruebas

Columnas: ID · Requisito · Entrada exacta · Entorno · Versión · Esperado · Observado · Evidencia · Estado · Defecto · Commit corrección · Reejecución

### 1. Inventario de pantallas

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado | Defecto | Commit | Reejecución |
|---|---|---|---|---|---|---|---|---|---|---|---|
| INV-01 | Visitar cada ruta de App.tsx en 320/375/390/412/768/1024/1440 | 8 públicas sin sesión + 49 privadas como A (incl. `?tab=members`, `/dashboard/members`, `/dashboard/smart-spend` y 8 subrutas `/prive/*`) × 7 anchos; alturas 568/812/844/915/1024/768/900 | prod | V1 | Cada ruta carga | 404 cargas, todas 200; 404 propio para `/ruta-que-no-existe`; `/dashboard/admin` muestra «Acceso solo para administradores» | `data/barrido.json`, `img/INV_hoja_320_*.jpg` | PASS | — | — | — |
| INV-02 | Privadas sin sesión | `/dashboard`, `/prive`, `/prive/invitacion`, `/dashboard/concierge?tab=members`, `/dashboard/viajes/:id` a 390 | prod | V1 | Redirigen a /auth sin error | Las 5 llegan a /auth («Bienvenido de vuelta») | `barrido.json` (sesion `anon-private`) | PASS | — | — | — |
| INV-03 | Sin scroll horizontal | `scrollWidth > innerWidth` en las 404 cargas | prod | V1 | 0 | 0 (pero ver INV-04) | `barrido.json` | PASS | — | — | — |
| INV-04 | Sin contenido cortado/encimado | Medición de cajas + revisión de capturas | prod | V1 | Nada fuera de la pantalla | Ruta 320–412 (columna 634 px), landing 320 (botón a 340 px), notificaciones 320–412 (x −54), actividades 320, gastos 320, aviso de viaje del Concierge | `img/UX10-01*`, `UX10-02*`, `UX10-04*`, `UX10-14*`, `UX10-15*` | FAIL | UX10-01/02/04 (P2), 14/15/17 (P3) | 529b3b4 (01/02/04) | local OK (`verificacion_local.json`) |
| INV-05 | Objetivos táctiles ≥ 40 px en móvil | Todos los interactivos visibles, ≤412 | prod | V1 | ≥ 40×40 | 225 de 233 cargas móviles tienen alguno < 40 px | `barrido.json` (`tapEj`) | FAIL | UX10-05, 17, 18 (P3) | 529b3b4, 5108217 (parcial) | prueba unitaria |
| INV-06 | Imágenes rotas | `img.complete && naturalWidth==0` | prod | V1 | 0 | 0 | `barrido.json` | PASS | — | — | — |
| INV-07 | Errores de consola | `console.error` + `pageerror` | prod | V1 | Solo esperados | 404 de la ruta inexistente (log del propio NotFound), 403 de `rpc/admin_metrics` en /dashboard/admin (cuenta no admin, la pantalla lo explica), 429 de `buscar-video`/`pexels-image` | `barrido.json` | PASS | (429 → INV-08) | — | — |
| INV-08 | Red 4xx/5xx | Respuestas ≥ 400 | prod | V1, V2 | Ninguna por uso normal | `POST functions/v1/pexels-image` 429 ×42 por carga de /dashboard/viajes/:id; `GET buscar-video` 429 (artefacto: 7 contextos en paralelo; el límite es 15/min por usuario y el dashboard hace 2 por carga); `POST rest/v1/rpc/admin_metrics` 403 (esperado) | `barrido.json`, `pexels.js` | FAIL | UX10-13 (P2) | 529b3b4 | prueba unitaria |
| INV-09 | Texto técnico en pantalla | Regex (non-2xx, undefined, null, NaN, JSON, TypeError, «Error: », inglés de error…) sobre `innerText` | prod | V1 | 0 | 0 en 404 cargas. En código: «Editar con IA» mostraba `e.message` crudo | `barrido.json`, prueba «UX10-12» | FAIL | UX10-12 (P2) | 529b3b4 | prueba unitaria (falla con el código anterior) |
| INV-10 | Botones muertos | Clic una vez en cada botón visible y seguro de 11 pantallas a 390 y 1440 (lista de exclusión: pagar, borrar, enviar, invitar, Fixer-enviar, guardar, crear, analizar…) | prod | V1→V2 | Cada clic hace algo | 249 botones: 52 navegan, 58 cambian la página, 14 abren diálogo, 81 omitidos por riesgo, 18 no localizables por texto; 26 «sin efecto» explicados: pestaña ya activa, Ajustes/Mi perfil estando en Perfil, Notificaciones a 390 (panel fuera de pantalla = UX10-04), Fixer/Editar con IA (abren, pero sin `role=dialog`) | `data/botones.json`, `img/UX10-04_prod*` | PASS | — | — | — |
| INV-11 | Estados vacíos sin salida | Revisión de capturas | prod | V1 | Cada vacío ofrece qué hacer | Favoritos, Social, Gastos, Reservas, Solicitudes Privé lo ofrecen; Clima no | hoja 320 c | FAIL | UX10-19 (P3) | — | — |
| INV-12 | Cargadores que no terminan | Spinner/pulso visible a los 15 s | prod | V1 | 0 | Concierge «Detectando tu ubicación real…» en los 7 anchos. (Packing/Perfil: pulsos decorativos, no cargadores) | `barrido.json` | FAIL | UX10-11 (P2) | 529b3b4 | local: «Ubicación no disponible» |
| INV-13 | Chat de Iato usable en teléfonos bajos | /dashboard/concierge a 320×568, 375×667, 375×812, 390×844 | prod | V2 | Compositor visible sobre la barra | Tapado a 320×568 y 375×667; conversación 48/48/64/96 px | `img/UX10-03_*`, `verificacion_prod.json` | FAIL | UX10-03 (P1) | 529b3b4 (parcial) | local: 375×667 OK, 320×568 sigue |

### 2. Privé y Members como usuario free

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado | Defecto | Commit | Reejecución |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PRV-01 | Adelanto /prive premium y honesto | /prive a 390 y 1440 como A | prod | V1, V2 | Sin escasez falsa; explica cómo se entra | Explica 90 días de PRO pagado, qué no cuenta, invitación personal; 12 colecciones «EN CURADURÍA»; 0 coincidencias de escasez (quedan, últimos, cupo, solo hoy, lista de espera, VIP, garantizado…); CTA «Conocer IATOS PRO» → /dashboard/pro | `img/PRV-01_prive_390.jpg`, `prive.json` | PASS | (UX10-20 P3, titular en inglés) | — | V2 igual |
| PRV-02 | /prive/invitacion sin token | Navegar directo, sin `#t=` | prod | V1, V2 | Estado tranquilo | «Privé es parte de IATOS PRO» + «Ver mi plan» + «Salir de la invitación»; sin errores | `img/PRV-02_*` | PASS | (UX10-21 P3) | — | V2 igual |
| PRV-03 | Members (adelanto) con conteos y sin nombres | /dashboard/concierge?tab=members a 390/1440; red inspeccionada | prod | V1, V2 | Conteos sí, nombres/direcciones no | «382 lugares en 79 ciudades», 9 categorías con conteo, ciudades con conteo; `rpc/members_teaser` no trae `nombre`/`address`/`website`; no se llama `nightlife_premium` ni `members_venues` | `img/PRV-03_*`, `prive.json` | PASS | (UX10-09 contraste) | — | V2 igual |
| PRV-04 | Entradas a Privé | Dashboard (barra lateral 1440; menú «Más» 390), enlace «IATOS Privé» en Members | prod | V1, V2 | Llevan a /prive | Las tres llegan a /prive | `prive.json` | PASS | — | — | — |
| PRV-05 | Movimiento reducido | `reducedMotion: 'reduce'` en /prive e /prive/invitacion | prod | V1, V2 | Se ve todo | `data-motion="reduced"`, mismo contenido | `img/PRV-05_*` | PASS | — | — | — |
| PRV-06 | Subrutas bloqueadas | /prive/membresia, /solicitudes, /destino/paris, /universo/gastronomia, /experiencia/demo | prod | V1 | Estado bloqueado claro | «Aún no tienes una membresía Privé activa», «Aún no has hecho solicitudes», «Desbloquea IATOS Privé…» + «Ir a IATOS Privé» | hoja 320 c/d | PASS | — | — | — |
| PRV-07 | Restablecer sin membresía | /prive/restablecer como A | prod | V1 | No ofrecer algo inexistente | Ofrece enviar enlace para restablecer contraseña Privé (no se pulsó) | hoja 320 d | FAIL | UX10-22 (P3) | — | — |

### 3. Accesibilidad

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado | Defecto | Commit | Reejecución |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A11Y-01 | Foco visible | 45 Tab desde la carga en Landing, Auth, Dashboard, Concierge, Planear, Pro, Privé (1440) | prod | V1 | Anillo en cada parada | 0 paradas sin anillo; ninguna parada oculta | `data/teclado.json` | PASS | — | — | — |
| A11Y-02 | Orden del foco | Mismo recorrido | prod | V1 | Lógico | Barra lateral → barra superior → contenido; landing: cabecera → hero → pie. No hay enlace «saltar al contenido» (P3, en UX10-25) | `teclado.json` | PASS | — | — | — |
| A11Y-03 | Escape cierra diálogos | «Lo que Iato recuerda», Fixer (390 y 1440), Editar con IA | prod | V1, V2 | Cierra y devuelve el foco | «Lo que Iato recuerda»: sí. Fixer: no (2/2). Editar con IA: no | `fixer_kb.js`, `verificacion_prod.json` | FAIL | UX10-07, UX10-12 (P2) | 529b3b4, a986d42 | local: sí (`verificacion_local.json`) |
| A11Y-04 | axe sin serious/critical | 12 pantallas × 390 y 1440, reglas wcag2a/aa, 21a/aa, 22aa | prod | V1 | 0 | critical: `button-name` (Concierge). serious: `color-contrast` (Members ×9, Perfil ×1), `scrollable-region-focusable` (Concierge, Perfil), `target-size` (Dashboard ×12, Pro ×2), `label-content-name-mismatch` (Dashboard ×4, Privé, Viaje). Landing, Auth, Planear, Invitación, Mis viajes: 0 | `data/axe.json` | FAIL | UX10-06, 09 (P2), 25 (P3) | 529b3b4 | prueba unitaria |
| A11Y-05 | Contraste de texto y botones primarios | axe `color-contrast` en las 12 pantallas | prod | V1 | ≥ 4.5:1 | Botones dorados y texto principal pasan; fallan conteos de Members (3.41) y botón destructivo del Perfil (4.25) | `axe.json` | FAIL | UX10-09 (P2), UX10-25 (P3) | 529b3b4 (Members) | — |

### 4. Red lenta (390, Fast 3G + CPU 4×)

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado | Defecto | Commit | Reejecución |
|---|---|---|---|---|---|---|---|---|---|---|---|
| PERF-01 | Landing | `/` sin caché, 4 corridas (2 con service worker, 2 sin) | prod | V2 | LCP ≤ 4 s en 3G rápido, CLS ≤ 0.1 | LCP 6.3 / 4.3 / 4.6 / 4.0 s (elemento: H1); FCP 3.3–5.6 s; CLS 0.006; TTI ≈ 3.3–5.6 s; JS 207 KB gzip (6 archivos); total 590 KB; el texto está desde el primer cuadro (sin skeleton, no lo necesita) | `data/perf_r1..r4.json` | PASS | (LCP > 4 s en 3/4 corridas: anotar) | — | — |
| PERF-02 | Dashboard | `/dashboard` como A, sin caché | prod | V2 | LCP ≤ 4 s, CLS ≤ 0.1, skeleton mientras carga | Con SW: LCP 5.6 / 4.9 s; frío sin SW: 12.0 / 15.1 s; CLS 0.155 en las 4; TTI ≈ 5.2 / 7.9 / 10.3 / 10.5 s; JS 249 KB gzip en 36 archivos; total 0.93–1.68 MB, ~100 peticiones; 0–5 s solo spinner, skeleton a ~6 s | `perf_r*.json`, `img/PERF_*` | FAIL | UX10-16 (P2) | — | — |
| PERF-03 | 10 peticiones más pesadas (dashboard, frío) | r3 | prod | V2 | — | 1) lh3.googleusercontent.com/grass-cs/… imagen 364 KB · 2) /assets/hero-santorini-6PyvMmg-.jpg 207 KB · 3) /assets/destination-tulum-CK3UTv47.jpg 165 KB · 4) destination-kyoto 78 KB · 5) fuente Fraunces 66 KB · 6) vendor-core.js 56 KB · 7) vendor-supabase.js 52 KB · 8) images.unsplash.com/photo-1551918120… 48 KB · 9) index-BnriLFFh.js 47 KB · 10) vendor-radix.js 33 KB | `perf_r3.json` | PASS (dato) | — | — | — |

### 5. Copia y honestidad

| ID | Requisito | Entrada exacta | Entorno | Versión | Esperado | Observado | Evidencia | Estado | Defecto | Commit | Reejecución |
|---|---|---|---|---|---|---|---|---|---|---|---|
| COPY-01 | Sin «ilimitado» | `innerText` de las 404 cargas | prod | V1 | 0 | «Datos ilimitados en 170+ destinos» (Holafly, /dashboard/esim) | `img/UX10-08_prod_esim*` | FAIL | UX10-08 (P2) | 529b3b4 | prueba |
| COPY-02 | Sin «24/7» | Igual | prod | V1 | 0 | «Atención 24/7 en español» (Heymondo, /dashboard/seguros), «soporte 24/7» (Rentalcars, /dashboard/autos) | `img/UX10-08_prod_seguros*` | FAIL | UX10-08 (P2) | 529b3b4 | prueba |
| COPY-03 | Sin «VIP garantizado» | Igual + «garantizad» | prod | V1 | 0 | 0. «VIP» solo como nombre de categoría (Casino VIP, Evento VIP) y «Modo exigente · opciones VIP» | `barrido.json` | PASS | — | — | — |
| COPY-04 | Sin «sin tarjeta» (prueba sin tarjeta apagada) | Igual, como free y sin sesión | prod | V1 | 0 | 0 (la copia de prueba lee `public_plan_config`) | `barrido.json` | PASS | — | — | — |
| COPY-05 | «Reserva confirmada» solo si hay reserva | Igual | prod | V1 | Sin promesa falsa | Solo en «Mis reservas» con estado vacío «Aún no hay reservas confirmadas…» | hoja 320 b | PASS | — | — | — |
| COPY-06 | Fixer dice «sujeto a disponibilidad» | Landing, Términos, Reembolsos, Pro, diálogo del Fixer | prod | V1 | En todas | Landing/Términos/Reembolsos/Pro sí; el diálogo del Fixer y su tooltip no (prometían WhatsApp y «humano premium») | `barrido.json` (`fixer`), `img/UX10-07_prod*` | FAIL | UX10-07 (P2) | 529b3b4 | prueba |
| COPY-07 | Textos en es-MX | Capturas | prod | V1 | Español | Titular de Privé en inglés; ejemplos en inglés en eSIM/Ferries; fecha con mayúsculas de título | hojas 320 | FAIL | UX10-20, 23, 24 (P3) | — | — |
| COPY-08 | Sin marcadores crudos | Capturas | prod | V1 | Sin «?», «undefined» | «(? al ?)» en el selector de viaje | `prive.json` (texto Members) | FAIL | UX10-10 (P3) | 529b3b4 | prueba |
| COPY-09 | Re-verificar Gastos / Cercanos / Smart Spend tras la publicación | — | prod | V3 | — | ver sección siguiente | — | NOT_RUN | — | — | — |
| COPY-10 | Contraste y copia de Members en la UI nueva (PRO) | — | — | — | — | Requiere una cuenta PRO; B la está usando otro grupo | — | NOT_RUN | — | — | — |

## Re-verificación tras la publicación (V3)

(Se completa abajo cuando prod publique el nuevo frontend: Smart Spend, monedas de Gastos, fotos de Cercanos.)

## Commits de la rama `claude/wc-r10-ux`

| Commit | Qué |
|---|---|
| 529b3b4 | UX10-01…13: maquetación, diálogos accesibles, copia honesta, ubicación, fotos sin amplificar errores |
| a986d42 | UX10-12: diálogo de «Editar con IA» en portal (la barra inferior seguía encima) |
| 5108217 | UX10-05b: «Volver» y cierre de consejos a 40 px |

Pruebas: `src/test/uxRelease10.test.tsx` (20 casos; con el código anterior fallan los que corresponden).
`npx vitest run`: 125 archivos, 1030 pruebas, todo pasa. `npx tsc --noEmit -p tsconfig.app.json`: OK.
`deno check supabase/functions/concierge-chat/index.ts`: OK. `npm run build`: OK.

Funciones de Supabase afectadas: `supabase/functions/_shared/activeTrip.ts` (texto de `tripLabel`), que usa
`concierge-chat`: el texto del frontend cambia al publicar; el de las preguntas de Iato, al redesplegar
`concierge-chat` (Lovable). Migraciones: ninguna.

## DECISIONES DEL DUEÑO
1. **Concierge en pantallas muy bajas (UX10-03, residual a 320×568, y UX10-17):** el encabezado de contexto mide
   ~320 px. Opciones: (a) encabezado plegable en móvil («Detalles»), (b) que el encabezado se desplace con la
   conversación y solo el compositor quede fijo, (c) dejarlo (iPhone SE de 1.ª generación es minoritario).
2. **Titular de Privé en inglés (UX10-20):** ¿es firma de marca o se traduce?

## Pendiente (no corregido aquí)
- UX10-16: dashboard pesado en red lenta (servir `hero-santorini` de 960 px en móvil, reservar alto de las
  tarjetas para bajar CLS 0.155, skeleton en vez del spinner de ruta, revisar la imagen de 364 KB de
  googleusercontent).
- UX10-14/15/17/18/19/21–25 (P3).
- Otros `toast.error(e?.message ?? …)` (≈30 sitios: Compare, Gastos, TripTranslator, TripPacking, Cercanos,
  MembersOnlyPanel, EditableBudget, TripDetail PDF…) pueden mostrar «Edge Function returned a non-2xx status
  code» si su función falla; no se reprodujeron en prod (habría que provocar fallos reales). Conviene pasarlos por
  `readFunctionError` como se hizo en «Editar con IA».

## Cuentas y limpieza
- Usada: A (free). No se crearon cuentas. B no se tocó.
- Cambios en datos de A: viaje «E2E PRUEBA Puebla» reescrito por las 4 ediciones de IA del incidente (+4 filas
  en `trip_quotes`); en la pasada de botones se pulsaron los niveles AHORRO/EQUILIBRIO/PREMIUM y duraciones de
  actividades de ese viaje (pueden haber cambiado `trips.selections`) y un «Reservar hotel →» (abre el sitio
  del socio; puede registrar una visita en «Mis reservas»). No se borró nada; no hay respaldo para revertir el
  viaje.
