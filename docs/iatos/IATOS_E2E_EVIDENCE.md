# IATOS: evidencia de pruebas de punta a punta (E2E)

- **Fecha de ejecución:** 2026-10-22, de 02:20 a 03:10 UTC (20:20–21:10 del 21 de octubre, hora del centro de México).
- **Herramientas:** QA automatizado con Playwright 1.47 (Chromium sin ventana) y llamadas REST directas. Todo lo que dice este documento es lo que se observó; nada se rellenó a mano.

## Ambientes

- **PROD:** https://traveliatos.life (`main` más el hotfix de seguridad), con el backend de producción de Supabase (`uhkdewinscffhdonhhmt`).
- **LOCAL-BRANCH:** `npm run build` y `npx vite preview` (http://127.0.0.1:4173) de la rama `claude/iatos-world-class`.
  - Se probó el **commit `8393649`**, compilado a las 02:24 UTC.
  - El build local usa la **misma** base de datos y las mismas funciones de producción. Las funciones y migraciones de la rama **no** están desplegadas.
- **La rama cambió durante las pruebas:** otras sesiones fusionaron trabajo, y a las 03:00 UTC el `HEAD` ya era **`f4c4c72`**.
  - La sección B se ejecutó contra `8393649`.
  - Al final se revisaron algunos puntos sobre `f4c4c72` (build aparte en el puerto 4174). Esa revisión se reporta por separado como **B-HEAD**.

## Cuentas (todas de prueba)

| Cuenta | Usuario | Correo | Detalle |
|---|---|---|---|
| PRO | demo `95aac578…` | `rodr***@gmail.com` | Alias del fundador, con suscripción `comped`. |
| FREE A | `96a04039…` | `rodr***@gmail.com` | Alias `+iatose2efreea`. |
| FREE B | `63751b37…` | `rodr***@gmail.com` | Alias `+iatose2efreeb`. |

- **Alta de las cuentas gratis:** se crearon con `POST /auth/v1/signup`.
  - Supabase no exige confirmar el correo: la respuesta ya trae sesión y `email_confirmed_at`. Por eso estas pruebas no quedaron bloqueadas.
  - La contraseña se guardó en `scratchpad/e2e_accounts.json`, fuera del repositorio.
- **Nivel de las cuentas nuevas:** `profiles.tier` queda en `'pro'` (es el valor por defecto de la columna). Aun así, el servidor las trata como gratis:
  - `get_access_state.is_pro` vale `false`;
  - no hay fila en `subscriptions`;
  - las cuotas gratuitas sí se aplicaron.

## Material de soporte

- **Scripts y datos crudos:** en el *scratchpad* de la sesión, no en el repositorio. Por ejemplo `pw/e2e_*.js`, `e2e/**/report_*.json` y `e2e/privacy_result.json`.
- **Capturas:** en `docs/iatos/evidencia/` (46 JPEG de calidad 60, 3.1 MB). En la captura E6 se ocultó el correo.

---

## 1. Resumen

| Sección | Qué se probó | PASS | FAIL | BLOQUEADO |
|---|---|---|---|---|
| A | Barrido de las 48 rutas en PROD, en escritorio y móvil (96 revisiones) | 94 | 2 | 0 |
| B | Las mismas 96 revisiones en LOCAL-BRANCH, más 10 verificaciones de correcciones de la rama | 97 | 8 | 1 |
| B-HEAD | Revisión complementaria sobre `f4c4c72` (no suma al total) | 3 | 1 | 0 |
| C | Privacidad entre cuentas y ataques antiguos, por REST con el token de cada usuario | 15 | 0 | 0 |
| D | Cuotas gratuitas (Iato y análisis), un análisis real y un mensaje PRO | 7 | 2 | 0 |
| E | Autenticación en PROD | 7 | 1 | 0 |
| F | Rendimiento en PROD con emulación móvil | 1 | 2 | 0 |
| **Total (sin B-HEAD)** | | **221** | **15** | **1** |

**Lo más importante**

1. **Las brechas de seguridad P0 están cerradas en producción.**
   - Se repitieron IATOS-001, 002, 003, 004 y 016 con cuentas reales y todas se bloquearon con el código HTTP esperado.
   - `send-email` ya no acepta `to` ni `html` libres, así que el hotfix sí está desplegado. El documento de hallazgos todavía marca IATOS-004 como "pendiente de despliegue".
2. **El bucle de onboarding (IATOS-005) se reproduce en PROD.**
   - En 10 s hubo **112 navegaciones** y **58 lecturas** de `user_onboarding_state`; la pantalla se quedó negra con un spinner.
   - En LOCAL-BRANCH, con el mismo flujo, hubo 1 navegación y el dashboard apareció.
3. **IATOS-111 se reproduce en PROD.**
   - El 4.º mensaje gratis y el 2.º análisis devuelven **402** con un mensaje claro en el cuerpo. Sin embargo, el usuario ve "**Edge Function returned a non-2xx status code**" y "Disculpa, hubo un tropiezo".
   - En la rama (`8393649`) ya está corregido para el análisis, **no** para Iato. En `f4c4c72` Iato ya muestra un diálogo correcto.
4. **IATOS-007 (total del viaje) e IATOS-113 (selector de avatar)** siguen mal en PROD. En la rama ya están corregidos, y se verificó.
5. **Se encontraron 9 defectos nuevos** (ver la sección 9). Los más relevantes:
   - Cercanos se cae a veces con "Algo no cargó bien" (`window.google.maps.Map is not a constructor`).
   - El frontend de la rama consulta `profiles.active_trip_id`, columna que no existe en producción, y recibe un 400. Hay que desplegar la migración antes que el frontend.
   - Un análisis CDMX→Puebla cotiza **solo vuelos con escala de 4–5 h** (46 % del total), sin ninguna opción terrestre.

---

## 2. Control de costos y efectos colaterales

| Recurso | Límite pedido | Uso real |
|---|---|---|
| Análisis completo con `analizar-viaje` (consume SerpApi) | Máximo 2 | **1**: FREE A, Puebla, respuesta 200. Hubo además **3 llamadas rechazadas por cuota** (402 en ≈1 s, sin búsquedas externas): 2 en PROD y 1 en LOCAL. En B-HEAD no hubo ninguna, porque la UI nueva ya no llama a la función. |
| Mensajes a Iato (`concierge-chat`) | Máximo 12, solo conversación | **7** en total. La IA respondió 4: 3 de FREE A y 1 de PRO. Los otros 3 se rechazaron con 402 (FREE A en PROD, LOCAL y HEAD). Todos fueron temas de conversación: playa, calzado, piel, libro y sombrero. |
| Búsquedas sueltas de SerpApi, alertas de vuelos o precios, Stripe | 0 | **0**. Durante los barridos, `page.route` bloqueaba cualquier llamada a `flights-search`, `hotels-search`, `tripadvisor-search`, `places-nearby`, `serpapi-quote`, `price-watch`, `track-flight`, `flight-status`, `analizar-viaje`, `logistics-plan`, `concierge-chat`, `send-email`, `stripe-checkout` y `stripe-portal`. El bloqueo no tuvo que actuar ni una vez en los 4 barridos. |
| Correos | Solo a alias propios | Se pidió 1 recuperación de contraseña para FREE A. La app pudo haber enviado por su cuenta el correo de bienvenida (`email-bienvenida`, al terminar el onboarding de A y B) y el de cotización (a A); no se revisó la bandeja. La prueba C9 apuntaba al alias de A y fue rechazada, así que no salió correo. |
| Datos | Solo de cuentas de prueba | Ver la sección 11. No se tocaron datos de usuarios reales. |

**Incidente de método (corregido y documentado)**

- **Qué pasó:** el primer intento del onboarding en LOCAL con FREE A no fue válido.
  - Para la sección C, antes se habían creado por REST viajes de prueba para A y B.
  - `useOnboardingStatus` interpreta a quien ya tiene viajes como usuario existente y le marca el onboarding como completo (backfill).
- **Cómo se corrigió:**
  - con el token de cada cuenta se restableció su propia fila de `user_onboarding_state` (`completed_onboarding=false`, `current_step=1`);
  - luego se repitió la prueba.
- **Resultado:** B-07 y B-08 salen de esa segunda corrida. El intento inválido se guardó aparte en `e2e/onb/invalid/`.

---

## 3. Sección A: barrido de rutas en PROD (cuenta PRO)

**Cómo se probó**

- **Pantallas:** escritorio de 1440×900 y móvil de 390×844 (emulación de iPhone 13).
- **Navegación:** inicio de sesión por el formulario; después, una carga completa de cada ruta con `page.goto`.
- **Espera:** hasta 15 s. Termina antes si ya hay contenido y no queda ningún `.animate-spin` visible.
- **Ruta con `:id`:** se usó el viaje "Los Cabos" de la cuenta PRO (`0384f50e…`).
- **Qué se registró en cada ruta:**
  - el estado HTTP y la ruta final;
  - el largo del texto visible;
  - si salió la pantalla 404 o la de error ("Algo no cargó bien");
  - si quedaba un spinner a los 15 s;
  - en móvil, si había desborde horizontal (`scrollWidth > innerWidth + 1`);
  - los errores de consola;
  - las respuestas con código ≥ 400 de Supabase y de la app.

**Cuándo cuenta como PASS**

- HTTP 200.
- Contenido visible: más de 80 caracteres, o el 404 esperado en la ruta comodín.
- Sin pantalla de error, sin spinner a los 15 s y, en móvil, sin desborde.
- **Excepción:** Concierge en móvil se marcó FAIL al revisar la captura, porque el cuadro de escritura queda tapado por la barra inferior (IATOS-087).

**Resultado A:** en escritorio, 48 de 48 PASS. En móvil, 46 PASS y 2 FAIL.

| ID | Ambiente | Pasos | Esperado | Real | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| A-D | PROD escritorio | Recorrer las 48 rutas | Todas cargan | 48/48. Las redirecciones y bloqueos que se vieron son los esperados (ver la nota debajo de la tabla). | PASS | A_prod_desktop_dashboard.jpg, A_prod_desktop_viaje.jpg, A_prod_desktop_planear.jpg, A_prod_desktop_admin_sin_permiso.jpg, A_prod_desktop_404.jpg |
| A-M-cercanos | PROD móvil | Abrir `/dashboard/cercanos` | Mapa y lista | Pantalla de error **"Algo no cargó bien"** con `TypeError: window.google.maps.Map is not a constructor` (Cercanos-qbfzvG4F.js). Pasó en los 2 barridos móviles y en 0 de 2 de escritorio. En 15 repeticiones dedicadas, en móvil y en escritorio e incluyendo la secuencia descubre→cercanos, **no** volvió a pasar: es **intermitente**. | FAIL | A_prod_mobile_cercanos_FALLA.jpg |
| A-M-concierge | PROD móvil | Abrir `/dashboard/concierge` | El cuadro de escritura se ve completo | El cuadro "Háblame o escribe lo que necesitas…" queda **debajo** de la barra inferior fija y del botón "+" | FAIL (ya conocido: IATOS-087) | A_prod_mobile_concierge_composer_tapado.jpg |
| A-M-resto | PROD móvil | Recorrer las otras 46 rutas | Cargan, sin desborde | 46/46. **Ninguna ruta tuvo desborde horizontal.** | PASS | A_prod_mobile_landing.jpg, A_prod_mobile_dashboard.jpg, A_prod_mobile_viaje.jpg, A_prod_mobile_perfil.jpg, A_prod_mobile_pro.jpg |

Redirecciones y bloqueos esperados en A-D:

- `/auth` y `/onboarding` llevan a `/dashboard`, porque el usuario ya tiene sesión y terminó el onboarding.
- `/dashboard/smart-spend` lleva a `/gastos`.
- `/dashboard/members` lleva a `/concierge?tab=members`.
- `/dashboard/admin` muestra "Acceso solo para administradores" (403 en `rpc/admin_metrics`, como debe ser).
- La ruta comodín `*` muestra el 404.

**Errores de consola que aparecen en todas las páginas de PROD**

- Son siempre los mismos 3:
  - `Access to fetch at 'https://tp-em.com/entrypoint_config…' … blocked by CORS policy`, del script de Travelpayouts;
  - `Failed to load resource: net::ERR_FAILED`;
  - `config is not valid`.
- Es ruido de un tercero. Además, ese script se carga antes de que el usuario dé su consentimiento (relacionado con IATOS-056).

**Errores de red relevantes en PROD**

- `/dashboard` (y `/auth` u `/onboarding` cuando redirigen ahí): 6 a 7 respuestas **429** de `GET /functions/v1/buscar-video` en cada carga.
- `/dashboard/members`: hasta 18 respuestas 429.

**Detalle por ruta.** Cada celda se lee así: HTTP · resultado · número de errores de consola. En LOCAL, la llamada a `tp-em.com` devuelve 403 en lugar de fallar por CORS, así que el conteo baja en 1.

| # | Ruta (App.tsx) | Ruta final | PROD escritorio | PROD móvil | LOCAL escritorio | LOCAL móvil |
|---|---|---|---|---|---|---|
| 1 | `/` | (igual) | 200 · PASS · 4 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 2 | `/auth` | /dashboard | 200 · PASS · 6 | 200 · PASS · 10 | 200 · PASS · 13 | 200 · PASS · 11 |
| 3 | `/reset-password` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 4 | `/terminos` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 5 | `/privacidad` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 6 | `/reembolsos` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 7 | `/cookies` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 8 | `/onboarding` | /dashboard | 200 · PASS · 8 | 200 · PASS · 8 | 200 · PASS · 13 | 200 · PASS · 10 |
| 9 | `/onboarding/deep` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 10 | `/dashboard` | (igual) | 200 · PASS · 10 | 200 · PASS · 10 | 200 · PASS · 4 | 200 · PASS · 7 |
| 11 | `/dashboard/planear` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 12 | `/dashboard/ruta` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 7 | 200 · PASS · 6 |
| 13 | `/dashboard/viajes` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 5 | 200 · PASS · 4 |
| 14 | `/dashboard/viajes/:id` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 |
| 15 | `/dashboard/viajes/:id/editar` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 16 | `/dashboard/viajes/:id/live` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 |
| 17 | `/dashboard/viajes/:id/mapa` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 18 | `/dashboard/viajes/:id/packing` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 19 | `/dashboard/viajes/:id/clima` | (igual) | 200 · PASS · 4 | 200 · PASS · 5 | 200 · PASS · 3 | 200 · PASS · 4 |
| 20 | `/dashboard/viajes/:id/traductor` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 21 | `/dashboard/viajes/:id/diario` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 22 | `/dashboard/viajes/:id/split` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 23 | `/dashboard/comparar` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 24 | `/dashboard/convertidor` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 25 | `/dashboard/vuelos` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 26 | `/dashboard/hoteles` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 27 | `/dashboard/seguros` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 28 | `/dashboard/beneficios` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 29 | `/dashboard/autos` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 30 | `/dashboard/esim` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 31 | `/dashboard/actividades` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 32 | `/dashboard/restaurantes` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 33 | `/dashboard/trenes` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 34 | `/dashboard/ferries` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 |
| 35 | `/dashboard/cruceros` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 |
| 36 | `/dashboard/reservas` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 37 | `/dashboard/descubre` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 10 |
| 38 | `/dashboard/cercanos` | (igual) | 200 · PASS · 3 | 200 · FAIL (pantalla de error) · 4 | 200 · FAIL (pantalla de error) · 4 | 200 · FAIL (pantalla de error) · 3 |
| 39 | `/dashboard/favoritos` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 40 | `/dashboard/social` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 41 | `/dashboard/smart-spend` | /dashboard/gastos | 200 · PASS · 3 | 200 · PASS · 6 | 200 · PASS · 3 | 200 · PASS · 2 |
| 42 | `/dashboard/gastos` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 43 | `/dashboard/concierge` | (igual) | 200 · PASS · 4 | 200 · FAIL (composer tapado) · 3 | 200 · PASS · 4 | 200 · FAIL (composer tapado) · 3 |
| 44 | `/dashboard/pro` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · FAIL (spinner >15 s) · 2 |
| 45 | `/dashboard/admin` | (igual) | 200 · PASS · 5 | 200 · PASS · 5 | 200 · PASS · 5 | 200 · PASS · 4 |
| 46 | `/dashboard/perfil` | (igual) | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 3 | 200 · PASS · 2 |
| 47 | `/dashboard/members` | /dashboard/concierge?tab=members | 200 · PASS · 17 | 200 · PASS · 15 | 200 · PASS · 19 | 200 · PASS · 21 |
| 48 | `* (/ruta-que-no-existe)` | (igual) | 200 · PASS · 4 | 200 · PASS · 4 | 200 · PASS · 4 | 200 · PASS · 3 |

---

## 4. Sección B: LOCAL-BRANCH (`8393649`) y comparación con PROD

### 4.1 Barrido de rutas

**Resultado:** en escritorio, 47 PASS y 1 FAIL. En móvil, 45 PASS y 3 FAIL. El detalle está en la tabla de la sección 3.

| ID | Ambiente | Ruta | Real | Resultado | Evidencia |
|---|---|---|---|---|---|
| B-01a | LOCAL escritorio | `/dashboard/cercanos` | "Algo no cargó bien" con `TypeError: window.google.maps.Map is not a constructor`. Es el mismo defecto que en PROD (el archivo no cambió en la rama). | FAIL | B_local_desktop_cercanos_FALLA.jpg |
| B-02a | LOCAL móvil | `/dashboard/cercanos` | Lo mismo. | FAIL | B_local_mobile_cercanos_FALLA.jpg |
| B-02b | LOCAL móvil | `/dashboard/concierge` | El cuadro de escritura queda tapado por la barra inferior, igual que en PROD. | FAIL (IATOS-087) | B_local_mobile_concierge_composer_tapado.jpg |
| B-02c | LOCAL móvil | `/dashboard/pro` | A los 15 s, la tarjeta de estado de la membresía seguía con el spinner. En 6 repeticiones posteriores no se reprodujo: es **intermitente**. En PROD no se vio. | FAIL | B_local_mobile_pro_spinner_FALLA.jpg |

**Diferencias frente a PROD**

- **`/dashboard/concierge`:** muestra más contenido.
  - Hay un selector de viaje en contexto: "Automático (Iato decide)".
  - Hay un enlace nuevo, "Lo que Iato recuerda".
  - Evidencia: B_local_desktop_concierge.jpg.
- **Error nuevo al abrir Concierge:** en cada carga, `GET /rest/v1/profiles?select=active_trip_id…` responde **400**.
  - La migración que agrega esa columna (commit `89590c3`) no está aplicada en producción.
  - La página carga de todos modos. Ver el defecto N-03.
- **`/dashboard/viajes/:id`:** más texto, por el nuevo encabezado de vigencia de la cotización.
- **Imágenes del globo 3D:** en `/dashboard/ruta`, las de `http://unpkg.com/three-globe/...` se bloquean por CORS. Pasa solo desde el origen local `http://`; no se considera defecto de producción.
- **`buscar-video`:** las llamadas desde el origen local también reciben 429, y 5 veces recibieron **500**.

### 4.2 Verificación de las correcciones de la rama

| ID | Ambiente | Pasos | Esperado | Real | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| B-03 | LOCAL, comparado con PROD | Se creó para PRO el viaje "E2E PRUEBA Presupuesto Los Cabos" (copia de Los Cabos: total $132,529 MXN, `presupuesto_objetivo` $100,000) y se abrió en ambos ambientes | Mostrar el total real y la nota de que rebasa el presupuesto | **LOCAL:** "REBASA TU PRESUPUESTO · $33,132 MXN / persona · Total del viaje $132,529 MXN… Esta cotización rebasa tu presupuesto de $100,000 MXN por $32,529 MXN". **PROD:** "AJUSTADO A TU PRESUPUESTO · $25,000 MXN / persona · Total del viaje $100,000 MXN… IATOS AI ajusta selección para no rebasarlo", es decir, se reproduce IATOS-007. | PASS en la rama (PROD: FAIL, IATOS-007) | B_local_mobile_total_presupuesto.jpg, B_prod_mobile_total_presupuesto.jpg |
| B-04 | LOCAL, comparado con PROD | Perfil → "Crear mi avatar"; se revisan los `input[type=file]` del diálogo | Botones separados para galería y cámara; la galería sin `capture` | **LOCAL:** botones "Elegir de mi galería" y "Tomar una foto". Hay un input con `aria-label="Elegir foto de la galería"` y `capture=null`, y otro con `aria-label="Tomar una foto con la cámara"` y `capture="user"`. **PROD:** un solo botón, "Seleccionar foto", con un input `capture="user"` (IATOS-113). | PASS en la rama (PROD: FAIL, IATOS-113) | B_local_mobile_avatar.jpg, B_prod_mobile_avatar.jpg |
| B-05 | LOCAL `8393649` | Revisar el `meta viewport` y la barra inferior en móvil | Zoom permitido y barra corregida, si ya se fusionaron | En `8393649` **no estaba fusionado**: el viewport sigue con `maximum-scale=1.0, user-scalable=no` (igual que PROD) y la barra tiene 7 elementos (Inicio, Viajes, Cerca, Favs, Social, Gastos, Pro). En `f4c4c72` ya está (ver B-HEAD). | BLOQUEADO (no estaba en el commit probado) | B_local_mobile_barra_inferior.jpg |
| B-06 | LOCAL móvil | En un viaje, bajar hasta el final y medir el borde inferior del último texto frente al borde superior de la barra | La barra no tapa el final del contenido | Último texto en y=553 px; la barra empieza en y=595 px. No tapa nada (lo mismo en PROD). | PASS | B_local_mobile_barra_inferior.jpg |
| B-07 | LOCAL, FREE A (onboarding nuevo, en móvil) | Iniciar sesión → "Conoce a Iato" → Continuar → Continuar → "Crear mi Travel DNA" (sin texto) → paso 5 → **"Explorar primero"** | Llegar al dashboard una sola vez | 10 s después: **1** navegación, **1** lectura de `user_onboarding_state`; la ruta final es `/dashboard` y se muestra el inicio ("E2E."). | PASS | B_onb_local_A_paso5.jpg, B_onb_local_A_tras_explorar.jpg |
| B-08 | PROD, FREE B (onboarding nuevo, en móvil) | El mismo flujo, hasta **"Explorar primero"** | (Se esperaba que fallara) | 10 s después: **112** navegaciones de `history` y **58** lecturas de `user_onboarding_state`. Las rutas alternan `/dashboard` → `/onboarding` → `/dashboard`… La pantalla queda negra con spinner (0 caracteres de texto). Al **recargar**, llega a `/dashboard` sin problema. | FAIL (IATOS-005 confirmado en producción) | B_onb_prod_B_paso5.jpg, B_onb_prod_B_bucle_FALLA.jpg, B_onb_prod_B_tras_recargar.jpg |
| B-09 | LOCAL, FREE A | Un segundo análisis desde `/dashboard/planear?q=…`, con la cuota ya agotada | Mensaje claro con acceso a PRO | El aviso dice: "Ya usaste tu análisis de viaje gratuito. Activa IATOS PRO para acceso ilimitado. **[Ver IATOS PRO]**". La función respondió 402. | PASS (en PROD sale el error técnico, ver D6b) | D_local_A_segundo_analisis_rechazo.jpg |
| B-10 | LOCAL, FREE A | 5.º mensaje a Iato, con la cuota ya agotada | Mensaje claro | El aviso dice "**Edge Function returned a non-2xx status code**" y el chat responde "Disculpa, hubo un tropiezo". La respuesta de la función fue 402 con el texto correcto. | FAIL (IATOS-111 sigue sin corregirse en Iato en `8393649`) | D_local_A_msg5_error_tecnico.jpg |
| B-11 | LOCAL | Revisar las noches del viaje de B-03 (fechas: 4 al 7 de diciembre, o sea 3 noches) | 3 noches | Dice "**2 noches**", igual que en PROD: las noches salen del itinerario y no de las fechas. En `f4c4c72` ya dice "3 noches". | FAIL (IATOS-075) | B_local_mobile_total_presupuesto.jpg |
| B-12 | LOCAL, con el backend de PROD | Abrir `/dashboard/concierge` | Sin errores de red | `GET /rest/v1/profiles?select=active_trip_id&id=eq.…` responde **400**, porque la columna no existe en producción. | FAIL (nuevo, N-03) | B_local_desktop_concierge.jpg |

### 4.3 B-HEAD: revisión complementaria sobre `f4c4c72`

No suma al total del resumen. Es un build aparte en `scratchpad/e2e/dist_head`, servido en el puerto 4174.

| ID | Pasos | Real | Resultado | Evidencia |
|---|---|---|---|---|
| H-1 | El viaje de B-03 | "REBASA TU PRESUPUESTO… $132,529 MXN · 4 personas · **3 noches**… Cotizado el 21 oct 2026". | PASS | B_head_mobile_total_3noches.jpg |
| H-2 | Mensaje de FREE A con la cuota agotada | Aparece un diálogo: "Usaste tus mensajes gratuitos… Se renuevan el próximo mes… activar IATOS PRO por $99 MXN al mes, IVA incluido… [Continuar con la versión gratuita] [Conocer IATOS PRO]". La función respondió 402. | PASS | B_head_concierge_limite_dialogo.jpg |
| H-3 | Revisar el viewport y la barra en móvil | El viewport ya no bloquea el zoom (`width=device-width, initial-scale=1.0, viewport-fit=cover`). La barra tiene 5 elementos: Inicio, Viajes, Planear, Concierge, Más. | PASS | B_head_mobile_barra_inferior.jpg |
| H-4 | FREE A sin análisis disponible abre `/dashboard/planear?q=Fin de semana en Puebla…` | Se llama a `parsear-viaje` (200) y a `get_access_state`, pero **nunca** a `analizar-viaje`. **En 30 s no apareció ningún mensaje**: ni aviso ni diálogo. El formulario queda vacío y la frase del usuario se pierde. También se intentó llenar el formulario a mano, pero el script no pudo completar los pasos, así que esa parte queda sin concluir. | FAIL (posible regresión: hay que revisarlo a mano) | B_head_planear_sin_mensaje.jpg |

---

## 5. Sección C: privacidad entre cuentas (backend de PROD, REST)

**Cómo se preparó**

- Se creó un viaje para cada cuenta: "E2E PRUEBA Privacidad A" (`1284a40c…`) y "E2E PRUEBA Privacidad B" (`195ff31c…`).
- Se agregó para B un gasto de $100 y una notificación propia.
- **Control positivo:** con su propio token, B sí ve su viaje, su gasto, su perfil y su notificación (las 4 consultas devolvieron 200 con datos).

En la tabla, "A" es el usuario que ataca, con su propio token.

| ID | Prueba | Petición | Esperado | HTTP y cuerpo (recortado) | Resultado |
|---|---|---|---|---|---|
| C1 | A lee el viaje de B | `GET /rest/v1/trips?id=eq.<viaje B>` | Vacío | `200 []` | PASS |
| C2 | A lee los gastos de B | `GET /rest/v1/expenses?or=(trip_id.eq.<viaje B>,user_id.eq.<B>)` | Vacío | `200 []` | PASS |
| C3 | A lee el perfil de B | `GET /rest/v1/profiles?select=*&id=eq.<B>` | Vacío | `200 []` | PASS |
| C4 | A lee las notificaciones de B | `GET /rest/v1/notifications?user_id=eq.<B>` | Vacío | `200 []` | PASS |
| C4b | A lista todos los viajes que puede ver | `GET /rest/v1/trips?limit=50` | Solo los suyos | `200`, únicamente `1284a40c…`, que es de A | PASS |
| C5 | A se inserta como colaborador aceptado del viaje de B (IATOS-001) | `POST /rest/v1/trip_collaborators` con `status: accepted` | Bloqueado | `403 {"code":"42501", … "permission denied for table trip_collaborators"}`. Después, B ve 0 colaboradores. | PASS |
| C6 | A crea una amistad "aceptada" con B (IATOS-002) | `POST /rest/v1/friendships` | Bloqueado | `403 {"code":"42501", … "permission denied for table friendships"}`. Después, 0 amistades. | PASS |
| C7 | A cambia el dueño (`user_id`) de su propio viaje a B (IATOS-016) | `PATCH /rest/v1/trips?id=eq.<viaje A>` | Bloqueado | `403 {"code":"42501","message":"No se puede cambiar el dueño de un viaje"}`. Después, el dueño sigue siendo A. | PASS |
| C8a | Un anónimo lista el bucket `journal-photos` (IATOS-003) | `POST /storage/v1/object/list/journal-photos`, en la raíz y en `avatars/` | Vacío | `200 []` en las dos | PASS |
| C8b | Un anónimo lista el bucket `travel-moments` (IATOS-003) | Igual, en la raíz y en `avatars/` | Vacío | `200 []` en las dos | PASS |
| C9 | `send-email` con `to`, `html` y `from` libres (IATOS-004) | `POST /functions/v1/send-email` con el token de A | Rechazado | `400 {"error":"trip_id y friend_id requeridos"}` | PASS (el hotfix está desplegado) |
| C9b | `send-email` sin sesión (solo la llave anónima) | Igual | Rechazado | `401 {"error":"unauthorized"}` | PASS |
| C10 | A inserta una notificación a nombre de B (IATOS-109) | `POST /rest/v1/notifications` con `user_id` de B | Bloqueado | `403 … "new row violates row-level security policy for table \"notifications\""`. B sigue con 1 sola notificación. | PASS |
| C11 | A lee el split de gastos del viaje de B | `GET /rest/v1/trip_split_expenses?trip_id=eq.<viaje B>` | Vacío | `200 []` | PASS |
| C12 | A lee el estado de onboarding de B | `GET /rest/v1/user_onboarding_state?user_id=eq.<B>` | Vacío | `200 []` | PASS |

Las respuestas completas están en `scratchpad/e2e/privacy_result.json` y `privacy_extra.json`, con tokens y correos ocultos.

---

## 6. Sección D: cuotas en PROD (FREE A) y un mensaje PRO

| ID | Ambiente | Pasos | Esperado | Real | Resultado | Evidencia |
|---|---|---|---|---|---|---|
| D1 | PROD, FREE A | Mensaje 1: "¿Qué me recomiendas llevar a un viaje de playa?" | Responde | `200` en 31.4 s, con una respuesta de lista de equipaje | PASS | D_prod_A_msg1.jpg |
| D2 | PROD, FREE A | Mensaje 2: "¿Qué tipo de calzado conviene para caminar en la arena?" | Responde | `200` en 12.3 s | PASS | — |
| D3 | PROD, FREE A | Mensaje 3: "Dame tres consejos para cuidar la piel del sol en la playa." | Responde | `200` en 33.8 s. **Observación:** el texto se muestra con Markdown sin interpretar (asteriscos `**…**` y `*…*` literales); ver N-05. | PASS | D_prod_A_msg3.jpg |
| D4a | PROD, FREE A | Mensaje 4: "¿Qué libro me recomiendas leer en la playa?" | El servidor lo rechaza | `402` en 1.2 s: `{"error":"upgrade_required","kind":"concierge","message":"Agotaste tus 3 mensajes gratis de este mes con el Concierge. Activa IATOS PRO para acceso ilimitado.","upgrade_url":"/dashboard/pro"}` | PASS | — |
| D4b | PROD, FREE A | Lo que ve el usuario tras el mensaje 4 | Explicación clara | Aviso: "**Edge Function returned a non-2xx status code**". En el chat: "Disculpa, hubo un tropiezo. Inténtalo de nuevo en un momento." La pantalla, además, sigue llamándose "Concierge PRO te escucha" y muestra "God Mode · Caza-Reservas VIP" a la cuenta gratis. | FAIL (IATOS-111 confirmado, como se esperaba) | D_prod_A_msg4_error_tecnico.jpg |
| D5 | PROD, FREE A | Inicio de sesión → `/dashboard/planear?q=Fin de semana en Puebla desde CDMX, 2 personas, del 12 al 14 de diciembre` | Viaje generado con etiquetas de procedencia | Viaje generado en **53 s** de punta a punta. Desglose: ≈19 s en `parsear-viaje` (se llamó **2 veces**) y **36 s** en `analizar-viaje` (200). Total $23,560 MXN para 2 personas. Detalle de etiquetas y observaciones debajo de la tabla. | PASS, con observaciones | D_prod_A_analisis_puebla.jpg, D_prod_A_analisis_puebla_completo.jpg |
| D6a | PROD, FREE A | Segundo análisis con la misma frase | El servidor lo rechaza | `402` en ≈1 s: `{"error":"upgrade_required","kind":"trip_analysis","message":"Ya usaste tu análisis de viaje gratuito. Activa IATOS PRO para acceso ilimitado.","upgrade_url":"/dashboard/pro"}` | PASS | — |
| D6b | PROD, FREE A | Lo que ve el usuario en el segundo análisis | Explicación clara | Aviso: "**Edge Function returned a non-2xx status code**". El usuario se queda en `/dashboard/planear`. (La primera captura llegó tarde y el aviso ya se había cerrado, así que se repitió una vez solo para capturar la pantalla: otro 402 en ≈1 s, sin SerpApi.) | FAIL (IATOS-111) | D_prod_A_segundo_analisis_rechazo.jpg |
| D7 | PROD, PRO | Un mensaje: "¿Qué me recomiendas llevar a un viaje de playa?" | Responde | `200` en 35.0 s. La respuesta toma en cuenta sus viajes (Puerto Escondido y Los Cabos). | PASS | D_prod_PRO_msg1.jpg |

**Detalle de D5: etiquetas de procedencia**

- **Hoteles:** 3 etiquetas "**Precio verificado en vivo · Google**".
- **Restaurantes:** "$300–$700 MXN p/p (**estimado**)".
- **Desglose:** "TOTAL ESTIMADO".
- **Vuelos:** las tarjetas **no llevan ninguna etiqueta de procedencia**, aunque en la base vienen con `fuente_precio: "serpapi"`.

**Detalle de D5: observaciones**

1. **Vuelos sin opción terrestre (N-06):** para CDMX→Puebla (unos 130 km) solo se cotizan **vuelos con 1 escala de 4 h 15 min a 5 h 27 min**, de $3,696 a $6,801 MXN por persona. Son el 46 % del total ($10,720) y no se ofrece autobús ni auto.
2. **Noches mal contadas:** dice "2 personas · **1 noches**" para un viaje del 12 al 14 de diciembre (2 noches), por IATOS-075. El itinerario tiene 2 días.
3. **Hotel en otra moneda:** la descripción de un hotel dice "Total estimado de estancia USD 95" dentro de un viaje en MXN.

---

## 7. Sección E: autenticación en PROD (FREE A)

| ID | Pasos | Esperado | Real | Resultado | Evidencia |
|---|---|---|---|---|---|
| E1 | Sin sesión, abrir `/dashboard/viajes` | Redirige a `/auth` | `/auth` | PASS | E1_prod_protegida_sin_sesion.jpg |
| E2 | Iniciar sesión desde esa pantalla | Entra | Llega a `/dashboard` en 6.5 s (`POST token 200`, `GET user 200`) | PASS | — |
| E2b | ¿Regresa a la ruta que se había pedido (`/dashboard/viajes`)? | Sí | No: llega a `/dashboard` | FAIL (ya conocido: IATOS-083) | — |
| E3 | Tocar "Cerrar sesión" | Cierra la sesión y borra el token | Llega a `/`, `POST logout 204`, quedan 0 claves `sb-*-auth-token` | PASS | E3_prod_tras_cerrar_sesion.jpg |
| E4 | Con la sesión cerrada, abrir `/dashboard` | Redirige a `/auth` | `/auth` | PASS | — |
| E5 | Abrir `/reset-password` sin enlace de correo | La página carga | Muestra "Nueva contraseña · Abre el link desde tu correo para continuar.", 2 campos de contraseña y el botón "Actualizar contraseña". **No** se probó con un enlace real de correo (IATOS-041 sigue sin verificar). | PASS | E5_prod_reset_password.jpg |
| E6 | En `/auth`, escribir el correo de FREE A y tocar "¿Olvidaste tu contraseña?" | Se envía el correo | `POST /auth/v1/recover` → `200 {}`; aviso: "Te enviamos un correo para recuperar tu contraseña". No se revisó si llegó. | PASS | E6_prod_recuperacion_free_a.jpg (correo oculto) |
| E7 | Un solo intento con una contraseña incorrecta | Error claro, sin entrar | Aviso "Credenciales inválidas"; se queda en `/auth` | PASS | — |

---

## 8. Sección F: rendimiento en PROD (emulación móvil)

**Cómo se midió**

- Playwright con CDP, emulando un Moto G4 (360×640, DPR 3).
- Caché vaciada antes de cada medición (`Network.clearBrowserCache`).
- Métricas:
  - FCP: `first-contentful-paint`;
  - LCP: `PerformanceObserver`;
  - peticiones y bytes: `Network.loadingFinished.encodedDataLength`, contados 5 s después de `load` (8 s en el perfil lento).
- Dos perfiles:
  - **sin límite**: la red del contenedor;
  - **móvil lento**: 1.6 Mbps de bajada, 750 kbps de subida, 150 ms de RTT y CPU 4× más lenta, simulado con CDP (no es el modelo *lantern* de Lighthouse).
- **Criterio:** umbrales de FCP de Lighthouse para móvil (≤ 1.8 s bueno; ≤ 3.0 s necesita mejora; > 3.0 s malo), evaluados con el perfil "móvil lento".

| Página | Perfil | FCP | LCP | DCL | load | Peticiones | Peticiones JS | JS transferido (propio) | Total transferido |
|---|---|---|---|---|---|---|---|---|---|
| `/` | sin límite | 1.45 s | 1.45 s | 1.36 s | 2.03 s | 30 | 17 | 438 kB (355 kB) | 1,216 kB |
| `/` | móvil lento | **2.84 s** | 3.48 s | 2.71 s | 2.71 s | 29 | 17 | 438 kB (355 kB) | 944 kB |
| `/auth` | sin límite | 0.72 s | 0.72 s | 0.33 s | 0.36 s | 33 | 22 | 443 kB (360 kB) | 556 kB |
| `/auth` | móvil lento | **3.05 s** | 3.05 s | 2.73 s | 2.74 s | 33 | 22 | 443 kB (360 kB) | 556 kB |
| `/dashboard` | sin límite | 0.52 s | 1.79 s | 0.33 s | 0.35 s | 120 | 39 | 468 kB (386 kB) | 2,942 kB |
| `/dashboard` | móvil lento | **3.39 s** | 4.17 s | 2.72 s | 2.73 s | 121 | 39 | 468 kB (386 kB) | 1,099 kB* |

\* Con el perfil lento, los videos no terminaron de bajar en la ventana de 8 s.

| ID | Página | Resultado | Nota |
|---|---|---|---|
| F1 | `/` | PASS (necesita mejora) | FCP de 2.84 s con el perfil lento. |
| F2 | `/auth` | FAIL (marginal) | FCP de 3.05 s. El chunk de entrada `index-B0DpVDee.js` pesa **337 kB comprimido**, y el script de Travelpayouts (57 kB) se descarga incluso en la pantalla de inicio de sesión. |
| F3 | `/dashboard` | FAIL | FCP de 3.39 s y LCP de 4.17 s. **120 peticiones y 2.9 MB** sin límite, por los videos automáticos y las docenas de llamadas a `buscar-video` (varias con 429). Ver IATOS-103 y N-04. |

Captura: F_prod_dashboard_movil_lento.jpg.

---

## 9. Defectos encontrados

### 9.1 Nuevos (no están en IATOS_HALLAZGOS_PRIORIZADOS.md)

| ID | Severidad sugerida | Ambiente | Defecto | Evidencia |
|---|---|---|---|---|
| N-01 | P2 | PROD y LOCAL | **Cercanos se cae a veces** con la pantalla de error "Algo no cargó bien" por `TypeError: window.google.maps.Map is not a constructor`. Parece una carrera en la carga de Google Maps: se usa `google.maps` antes de que exista la clase `Map`. Pasó en 4 de 6 visitas dentro de los barridos (PROD móvil 2 de 2, PROD escritorio 0 de 2, LOCAL 2 de 2) y en 0 de 15 repeticiones dedicadas. | A_prod_mobile_cercanos_FALLA.jpg, B_local_*_cercanos_FALLA.jpg |
| N-02 | P3 | Solo LOCAL (`8393649`) | **La tarjeta de estado de `/dashboard/pro` se queda en spinner** más de 15 s. Pasó en 1 de 4 visitas y en 0 de 6 repeticiones. Está en la rama, donde cambió `useSubscription`. | B_local_mobile_pro_spinner_FALLA.jpg |
| N-03 | P2 (riesgo de despliegue) | LOCAL con el backend de PROD | El Concierge de la rama consulta `profiles.active_trip_id`, una columna nueva (migración del commit `89590c3`) que **no existe en producción**, y recibe **400**. Si se despliega el frontend antes que la migración, el viaje en contexto no funcionará. Hay que fijar el orden: **primero la migración, luego el frontend**. | B_local_desktop_concierge.jpg; `report_desktop.json` de LOCAL |
| N-04 | P3 | PROD | **Inicio y Members Only lanzan docenas de `GET /functions/v1/buscar-video`** por carga, y muchas reciben **429** (hasta 18 por página; desde el origen local, además, 5 respuestas 500). IATOS-103 habla de los videos automáticos, pero no del límite de frecuencia ni de los errores. | Barridos A y B (`httpErrors`) |
| N-05 | P3 | PROD | **Las respuestas de Iato muestran Markdown sin interpretar**: se ven los asteriscos `**negritas**` y `*cursivas*`. | D_prod_A_msg3.jpg |
| N-06 | P2 | PROD | **En un trayecto corto (CDMX→Puebla, unos 130 km) el análisis solo cotiza vuelos con escala de 4 a 5 h**, de $3,696 a $6,801 MXN por persona, que son el 46 % del total. No ofrece autobús ni auto. Los datos de SerpApi son reales, pero la recomendación no tiene sentido y encarece el viaje. | D_prod_A_analisis_puebla_completo.jpg |
| N-07 | P2 (relacionado con IATOS-024 y 026) | PROD | **Las tarjetas de vuelo no muestran ninguna etiqueta de procedencia** aunque vienen de SerpApi (`fuente_precio: serpapi`). En la misma pantalla, los hoteles dicen "Precio verificado en vivo · Google". El usuario no sabe qué tan confiable es el precio del vuelo. | D_prod_A_analisis_puebla_completo.jpg |
| N-08 | P3 | PROD | **`parsear-viaje` se llama 2 veces por cada búsqueda que llega desde `?q=`**, así que la IA se paga dos veces. Se vio en los dos intentos de análisis. | `analysis/prod_A_analysis.json` |
| N-09 | P2 (posible regresión; verificar a mano) | Solo B-HEAD (`f4c4c72`) | Un usuario gratis sin análisis disponible entra a `/dashboard/planear?q=…`, y **no aparece ningún mensaje ni paywall**: el formulario queda vacío y la frase se pierde. En `8393649` sí aparecía el aviso con "Ver IATOS PRO". | B_head_planear_sin_mensaje.jpg |

**Observación menor (sin número):** las cuentas nuevas quedan con `profiles.tier='pro'` por el valor por defecto de la columna, aunque el servidor las trata como gratis. No afecta las cuotas, pero cualquier código que lea `tier` lo va a interpretar mal (ver también IATOS-052).

### 9.2 Ya conocidos y confirmados en esta corrida

| Hallazgo | Estado observado |
|---|---|
| IATOS-001, 002, 003, 016 | **Corregidos en PROD** (C5, C6, C7, C8). |
| IATOS-004 | **Corregido en PROD** (C9 y C9b): el hotfix de `send-email` está desplegado. El documento de hallazgos todavía dice "pendiente de despliegue". |
| IATOS-109 | En PROD **no** se puede insertar una notificación a nombre de otro usuario por REST (C10). No se probó la vía de las RPC ni la de las funciones. |
| IATOS-005 | **Sigue ocurriendo en PROD** (B-08: 112 navegaciones en 10 s). **Corregido en la rama** (B-07). |
| IATOS-007 | **Sigue en PROD** ("ajustado a tu presupuesto", $100,000 en lugar de $132,529). **Corregido en la rama** (B-03). |
| IATOS-113 | **Sigue en PROD** (un solo input con `capture="user"`). **Corregido en la rama** (B-04). |
| IATOS-111 | **Sigue en PROD** (D4b y D6b). En la rama `8393649`: corregido para el análisis (B-09), no para Iato (B-10). En `f4c4c72`, Iato ya está corregido (H-2), pero apareció N-09. |
| IATOS-075 | Las noches salen del itinerario y no de las fechas ("1 noches" en Puebla, "2 noches" en Los Cabos). Sigue en PROD y en `8393649`; corregido en `f4c4c72` (H-1). |
| IATOS-083 | Después de iniciar sesión se pierde la ruta que se había pedido (E2b). |
| IATOS-087 | Zoom bloqueado y "Favs" tapado por el botón "+", en PROD y en `8393649`. El cuadro de escritura de Concierge queda debajo de la barra (A-M-concierge, B-02b). En `f4c4c72` ya se permite zoom y la barra tiene 5 elementos (H-3); no se volvió a revisar el cuadro de escritura en HEAD. |
| IATOS-103 | Chunk de entrada de 337 kB comprimido; `/dashboard` con 120 peticiones y 2.9 MB (F3). |
| IATOS-056 | El script de Travelpayouts carga antes del consentimiento y produce 3 errores de consola en cada página (A y B). |
| IATOS-013 y 089 | La cuenta gratis ve "Concierge PRO te escucha" y "God Mode · Caza-Reservas VIP" (D4b). |
| IATOS-055 (contexto) | Supabase Auth **no** exige confirmar el correo: el registro devolvió sesión de inmediato. Es la condición que hace explotable IATOS-055. |

---

## 10. Qué NO se probó y por qué

- **Pagos y Stripe** (checkout, portal, webhooks y prueba de 30 días): no se permiten pagos.
- **Búsquedas de vuelos, hoteles, actividades y lugares**, tanto sueltas como desde Iato, **alertas de precio y seguimiento de vuelos**: hay que cuidar SerpApi (≈200 búsquedas). Por eso no se validó IATOS-006 (las herramientas de Iato con datos reales).
- **"Re-analizar" un viaje (IATOS-008) y el planificador multidestino (`logistics-plan`)**: consumirían más análisis de los permitidos.
- **Flujo real de invitar a un amigo y compartir viaje con correo**: se omitió para no mandar correos. El ataque a `send-email` sí se probó (C9).
- **Abrir el enlace del correo de recuperación y cambiar la contraseña (IATOS-041)**: la bandeja no se revisó como parte de la prueba.
- **Generar un avatar** (`generate-avatar`, que cuesta): solo se revisó el selector.
- **Dispositivos reales** (iPhone Safari, Android Chrome): todo fue con emulación en Chromium. La cámara y la galería reales no se abrieron.
- **Lighthouse oficial**: se usaron métricas equivalentes con Playwright y CDP. No hay puntaje de Lighthouse.
- **Funciones y migraciones de la rama**: no están desplegadas, y el build local usa el backend de producción. Lo probado en B es **solo el frontend** de la rama.
- **Onboarding con "Saltar por ahora"**: solo se probó "Explorar primero". En PROD, en el paso 5 ya no hay botón "Saltar".
- **Privacidad en la dirección B → A** y **ataques por RPC o funciones** (por ejemplo `share-trip-notify` o los "oráculos" de IATOS-107): solo se probaron lecturas e inserciones por REST de A hacia B.
- **Pruebas de carga o abuso**: excluidas por las reglas.
- **La rama después de `8393649`**: salvo los 4 puntos de B-HEAD, `f4c4c72` no se barrió completa.

---

## 11. Datos de prueba que quedaron en producción

Todo pertenece a las cuentas de prueba y no se borró nada. El dueño puede eliminarlo cuando quiera.

| Cuenta | Datos |
|---|---|
| FREE A (`96a04039…`) | Viaje "E2E PRUEBA Privacidad A" (`1284a40c…`). Viaje "E2E PRUEBA Puebla" (`92a52e51…`): el análisis lo creó con el nombre "Puebla" y después se renombró para cumplir la regla de nombres. `usage_limits`: 3 mensajes y 1 análisis. Onboarding completo. |
| FREE B (`63751b37…`) | Viaje "E2E PRUEBA Privacidad B" (`195ff31c…`), gasto "E2E PRUEBA gasto B" (`fb5c9288…`), notificación "E2E PRUEBA notificación B" (`8b0c5f73…`). Onboarding completo, después de salir del bucle recargando. |
| PRO demo (`95aac578…`) | Viaje "E2E PRUEBA Presupuesto Los Cabos" (`a3857878…`, `presupuesto_objetivo=100000`). |

**Servidores locales:** al terminar se detuvieron los dos servidores de vista previa (puertos 4173 y 4174).
