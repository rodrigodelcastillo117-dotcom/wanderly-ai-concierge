# IATOS · Lo que no se toca

**Por qué existe.** El 29-oct-2026 se publicaron mejoras y Carlo (socio, usuario clave) dejó de ver tres cosas que usa a diario: las fotos de sus viajes de varias ciudades, "el mundito" (el globo 3D de la ruta) y cotizar directo (le pedía un paso de más). Se regresó como antes en `e614ff0`. Este documento y las pruebas "candado" existen para que **no vuelva a pasar**: lo que está aquí no desaparece ni cambia de lugar sin que el dueño lo apruebe.

Pedido del dueño: *"que no se pierda nada, que sea fácil, rápido, élite"*.

---

## 1. Regla de publicación

**Ningún cambio visual se publica sin las tres cosas:**

1. **Capturas de antes y después aprobadas por el dueño.** Se sacan con `npm run candado:visual` (antes del cambio: la referencia; después: `docs/iatos/candado-visual/ultima-corrida/`, con el mapa de diferencias en rojo). Si el dueño aprueba, se actualizan las referencias con `npm run candado:visual -- --actualizar` en el mismo cambio, y el mensaje del commit dice "aprobado por el dueño el <fecha>".
2. **Las pruebas candado en verde:** `npm run candado` (y la suite completa `npx vitest run`).
3. **El smoke de producción en verde** justo después de publicar: `npm run candado:smoke` (ver §5). Si falla, se regresa a la versión anterior antes de investigar.

Además:

- **Quitar o mover algo de este documento** (una ruta, una entrada del menú, una herramienta de Iato, una pantalla de Privé) exige: la aprobación escrita del dueño, actualizar este documento y `src/test/candadoInventario.ts` en el mismo cambio. Las pruebas candado fallan si se quita algo sin hacerlo.
- **No se debilita una prueba candado para que pase.** Si una prueba candado falla, se arregla el código, no la prueba. Cambiar una prueba candado es un cambio del candado y necesita la misma aprobación.
- Colores negro y dorado, diseño principal y todo IATOS Privé (invitación, ceremonia, Grand Welcome): **no se cambian**.

---

## 2. Funciones y experiencias que los usuarios clave valoran

Cada fila: dónde vive y qué prueba la protege. Las pruebas `candado*` se escribieron para este documento; las demás ya existían y se citan como guardianas (la prueba `src/test/candadoRutas.test.tsx` falla si una de las pruebas citadas aquí deja de existir).

| # | Qué | Dónde vive | Pruebas que la protegen |
|---|---|---|---|
| 1 | **El globo 3D ("el mundito") en el flujo multidestino**: al escribir un viaje de varias ciudades se llega directo a la ruta, y la ruta muestra el globo con el origen y cada ciudad en orden | `src/components/RouteGlobe3D.tsx`, montado en `src/pages/MultiDestRoute.tsx` (ruta `/dashboard/ruta`) | `src/test/candadoPlanear.test.tsx`, `src/test/comoAntes.test.tsx`, `src/test/multidestDates.test.tsx`, `src/test/rutaVentanaFechas.test.tsx`; visual `10-ruta-globo`; smoke paso 3 |
| 2 | **Fotos de los viajes** en Mis viajes, Inicio y el encabezado del viaje, también en viajes de varias ciudades (la foto es de la **primera** ciudad, nunca de otra ni de la ruta completa); la portada guardada del viaje se muestra | `src/pages/Trips.tsx`, `src/pages/DashboardHome.tsx`, `src/pages/TripDetail.tsx`, `src/lib/tripImagery.ts`, `src/lib/stockPhoto.ts`, `src/components/media/SmartImage.tsx` | `src/test/candadoViaje.test.tsx`, `src/test/comoAntes.test.tsx`, `src/test/comoAntesLib.test.ts`; visual `04-inicio`, `05-mis-viajes`, `06-viaje-resumen`; smoke pasos 2 y 4 (cuenta las fotos cargadas) |
| 3 | **Cotizar directo**, sin paso de revisión cuando no hay preguntas: una ciudad con todo dicho → cotiza y abre el viaje; varias ciudades → la ruta con el globo. Si falta un dato real, solo se pregunta ese dato | `src/pages/PlanTrip.tsx`, `src/lib/planDirect.ts`, `src/components/plan/PlanQuickQuestions.tsx`, `src/components/plan/PlanTripDialog.tsx` | `src/test/candadoPlanear.test.tsx` (sin ningún clic), `src/test/comoAntes.test.tsx`, `src/test/planTripBack.test.tsx`, `src/test/planTripFreeLimit.test.tsx`, `src/test/planTripDesdeVentana.test.tsx`; visual `09-planear` |
| 4 | **Iato y sus herramientas**: vuelos, hoteles, lugares, cerca de mí, búsqueda con fuente, avisos de viaje, clima, hora local, eventos, tours, ranking de la ciudad, lugares para miembros y catálogo Privé; atajos del chat (mi vuelo, plan de hoy, clima, gastos, cena cerca, transporte, emergencia, Equipaje Invisible, mi viaje); pestañas Concierge / Solo para miembros / Mis solicitudes | `src/pages/Concierge.tsx`, `src/lib/conciergeChips.ts`, `supabase/functions/concierge-chat/toolDefs.ts` (lista única de herramientas) | `src/test/candadoIato.test.tsx`, `src/test/conciergeChatUi.test.tsx`, `src/test/concierge2Core.test.ts`, `src/test/fixIatoR4Ui.test.tsx`, `src/test/searchPrive.test.ts`, `src/test/climaIato.test.ts`, `src/test/avisosIato.test.ts`; visual `11-iato`; smoke paso 5 |
| 5 | **Reservas IA** (Iato pide la mesa por ti; estado en Mis reservas) | `src/pages/Reservas.tsx`, `src/components/reservas/AiReservationsPanel.tsx`, `src/lib/aiReservations.ts`, función `ai-reservations` | `src/test/aiReservationsPanel.test.tsx`, `src/test/aiReservationsEntrada.test.tsx`, `src/test/aiReservationsService.test.ts`, `src/test/aiReservationsCore.test.ts`, `src/test/aud10Reservas.test.tsx` |
| 6 | **Mesa de operaciones** (lo que atiende una persona del equipo; enlace de los correos al dueño) | `src/pages/AdminOperations.tsx` (rutas `/dashboard/admin/operaciones` y `/admin/operaciones`), `src/lib/opsDesk.ts`, `src/components/AdminGate.tsx` | `src/test/adminOperations.test.tsx`, `src/test/opiniones.test.tsx`, `src/test/candadoRutas.test.tsx` (exige administrador); visual `15-mesa` |
| 7 | **Buzón de opiniones** ("¿Algo no se entiende? Cuéntanos": menú lateral, hoja «Más» y pie de pantalla) | `src/components/opinion/OpinionEntry.tsx`, `src/components/opinion/OpinionDialog.tsx`, función `enviar-opinion` | `src/test/candadoMenus.test.tsx`, `src/test/opiniones.test.tsx` |
| 8 | **Inicio de sesión con Google** ("Continuar con Google", por omisión encendido) | `src/pages/Auth.tsx`, `src/lib/googleLogin.ts`, `src/integrations/lovable/index.ts` | `src/test/fixCuentaAuditoria.test.tsx`, `src/test/pulidoR2.test.tsx`, `src/test/authReturnTo.test.tsx`; visual `02-auth` |
| 9 | **Estilo negro y dorado** (fondo carbón #0A0A0A, dorado champagne ≈ #C9A961, crema, degradado dorado de los botones; paleta Privé; barra del navegador negra) | `src/index.css` (`:root`), `tailwind.config.ts`, `src/components/prive/prive.css`, `index.html` | `src/test/candadoMarca.test.ts`, `src/test/a11yContrast.test.tsx`; las 15 capturas del candado visual |
| 10 | **IATOS Privé completo**: hub, invitación (sobre), ceremonia y **Grand Welcome**, MY PRIVÉ, EXPLORE, THE KEY, DROPS, INSIDER, catálogo, solicitudes y THE PRIVATE EDITION | `src/pages/prive/*` (dentro de `PriveRoot`), `src/components/prive/Envelope.tsx`, `src/components/prive/GrandWelcome.tsx`, `src/components/prive/*` | `src/test/priveInvitation.test.tsx`, `src/test/priveUx.test.tsx`, `src/test/priveBundle.test.ts`, `src/test/priveHub.test.tsx`, `src/test/fixPriveAuditoria.test.tsx`, `src/test/priveLib.test.ts`, `src/test/priveEditionUi.test.tsx`, `src/test/candadoRutas.test.tsx`; visual `14-prive` |
| 11 | **Gastos** (por viaje, divisas, dividir entre amigos) | `src/pages/Gastos.tsx`, `src/pages/TripSplit.tsx`, `src/components/tripExpenses/*` | `src/test/aud10Gastos.test.tsx`, `src/test/expensesCurrencies.test.tsx`, `src/test/gastosSplit.test.tsx`, `src/test/tripSplitLive.test.tsx`; visual `13-gastos` |
| 12 | **Documentos y tarjetas** (bóveda: pasaporte, membresías, tarjetas, seguros) | `src/pages/Benefits.tsx`, `src/components/boveda/*` | `src/test/bovedaPage.test.tsx`, `src/test/bovedaCore.test.tsx`, `src/test/aud10Boveda.test.tsx` |
| 13 | **Equipaje** (lista de equipaje del viaje) | `src/pages/TripPacking.tsx` | `src/test/pulidoR2.test.tsx`, `src/test/cuentaR3.test.tsx`, `src/test/candadoRutas.test.tsx` |
| 14 | **Diario** del viaje (con voz) | `src/pages/TripJournal.tsx`, `src/components/journal/*` | `src/test/diarioVoz.test.tsx`, `src/test/diarioAprende.test.ts` |
| 15 | **Recuerdos** (fotos y videos por fecha y viaje) | `src/pages/Recuerdos.tsx`, `src/components/recuerdos/*` | `src/test/recuerdosUi.test.tsx`, `src/test/recuerdosModel.test.ts`, `src/test/recuerdosNav.test.ts` |
| 16 | **Totales en MXN con fuente** (una sola cifra, "Total estimado" o "Total de tu selección", qué parte es precio consultado y cuál estimado, marca de proveedor) | `src/components/RealTripTotal.tsx`, `src/lib/tripTotal.ts`, `src/components/PriceSourceBadge.tsx` | `src/test/candadoViaje.test.tsx`, `src/test/realTripTotal.test.ts`, `src/test/r3vTotales.test.tsx`, `src/test/tripTotalStates.test.tsx`, `src/test/priceSourceBadge.test.tsx`, `src/test/hermanoEtiquetaTotal.test.tsx` |
| 17 | **Menús**: menú lateral (Inicio, Mis viajes, Cerca de ti, Favoritos, Recuerdos, Social, Gastos, Mis reservas, Documentos y tarjetas, Concierge + Planear viaje, PRO, Privé, Ayuda), barra inferior del celular (Inicio, Viajes, Planear, Concierge, Más) y hoja «Más» | `src/components/DashboardLayout.tsx` | `src/test/candadoMenus.test.tsx`, `src/test/bottomNav.test.tsx` |
| 18 | **Todas las rutas de la app** (§3) | `src/App.tsx` | `src/test/candadoRutas.test.tsx` |

---

## 3. Todas las rutas de `src/App.tsx`

`src/test/candadoRutas.test.tsx` lee el árbol de rutas real de App y comprueba, para cada fila: que la ruta existe, que monta **esa** página (la misma función, no un texto), y que conserva su protección. Falla también si aparece una ruta nueva que no esté en esta tabla y en `src/test/candadoInventario.ts`.

| Ruta | Página | Acceso |
|---|---|---|
| `/` | `src/pages/Landing.tsx` | pública |
| `/auth` | `src/pages/Auth.tsx` | pública |
| `/reset-password` | `src/pages/ResetPassword.tsx` | pública |
| `/terminos` | `src/pages/Legal.tsx (Terminos)` | pública |
| `/privacidad` | `src/pages/Legal.tsx (Privacidad)` | pública |
| `/reembolsos` | `src/pages/Legal.tsx (Reembolsos)` | pública |
| `/cookies` | `src/pages/Legal.tsx (Cookies)` | pública |
| `/ayuda` | `src/pages/Legal.tsx (Ayuda)` | pública |
| `/prive/edicion/sin-conexion` | `src/pages/prive/edition/EditionOfflinePage.tsx` | pública |
| `/onboarding` | `src/pages/Onboarding.tsx` | sesión |
| `/onboarding/deep` | `src/pages/OnboardingDeep.tsx` | sesión |
| `/dashboard` | `src/pages/DashboardHome.tsx` | sesión |
| `/dashboard/planear` | `src/pages/PlanTrip.tsx` | sesión |
| `/dashboard/ruta` | `src/pages/MultiDestRoute.tsx` | sesión |
| `/dashboard/explorar` | `src/pages/ExploreDestinations.tsx` | sesión |
| `/dashboard/viajes` | `src/pages/Trips.tsx` | sesión |
| `/dashboard/viajes/importar` | `src/pages/ImportPastTrip.tsx` | sesión |
| `/dashboard/viajes/:id` | `src/pages/TripDetail.tsx` | sesión |
| `/dashboard/viajes/:id/editar` | `src/pages/EditTrip.tsx` | sesión |
| `/dashboard/viajes/:id/live` | `src/pages/LiveTrip.tsx` | sesión |
| `/dashboard/viajes/:id/mapa` | `src/pages/TripMap.tsx` | sesión |
| `/dashboard/viajes/:id/packing` | `src/pages/TripPacking.tsx` | sesión |
| `/dashboard/viajes/:id/clima` | `src/pages/TripWeather.tsx` | sesión |
| `/dashboard/viajes/:id/traductor` | `src/pages/TripTranslator.tsx` | sesión |
| `/dashboard/viajes/:id/diario` | `src/pages/TripJournal.tsx` | sesión |
| `/dashboard/viajes/:id/split` | `src/pages/TripSplit.tsx` | sesión |
| `/dashboard/comparar` | `src/pages/Compare.tsx` | sesión |
| `/dashboard/convertidor` | `src/pages/Currency.tsx` | sesión |
| `/dashboard/vuelos` | `src/pages/TripFlights.tsx` | sesión |
| `/dashboard/hoteles` | `src/pages/TripHotels.tsx` | sesión |
| `/dashboard/seguros` | `src/pages/Insurance.tsx` | sesión |
| `/dashboard/beneficios` | `src/pages/Benefits.tsx` | sesión |
| `/dashboard/autos` | `src/pages/TripCars.tsx` | sesión |
| `/dashboard/esim` | `src/pages/TripESIM.tsx` | sesión |
| `/dashboard/actividades` | `src/pages/TripActivities.tsx` | sesión |
| `/dashboard/restaurantes` | `src/pages/Restaurantes.tsx` | sesión |
| `/dashboard/trenes` | `src/pages/Trenes.tsx` | sesión |
| `/dashboard/ferries` | `src/pages/Ferries.tsx` | sesión |
| `/dashboard/cruceros` | `src/pages/Cruceros.tsx` | sesión |
| `/dashboard/reservas` | `src/pages/Reservas.tsx` | sesión |
| `/dashboard/descubre` | `src/pages/Discover.tsx` | sesión |
| `/dashboard/cercanos` | `src/pages/Cercanos.tsx` | sesión |
| `/dashboard/favoritos` | `src/pages/Favoritos.tsx` | sesión |
| `/dashboard/social` | `src/pages/Social.tsx` | sesión |
| `/dashboard/social/amigo/:id` | `src/pages/FriendProfile.tsx` | sesión |
| `/dashboard/gastos` | `src/pages/Gastos.tsx` | sesión |
| `/dashboard/recuerdos` | `src/pages/Recuerdos.tsx` | sesión |
| `/dashboard/concierge` | `src/pages/Concierge.tsx` | sesión |
| `/dashboard/pro` | `src/pages/Pro.tsx` | sesión |
| `/dashboard/perfil` | `src/pages/Profile.tsx` | sesión |
| `/wrapped` | `src/pages/Wrapped.tsx` | sesión |
| `/wrapped/:year` | `src/pages/Wrapped.tsx` | sesión |
| `/dashboard/admin` | `src/pages/AdminMetrics.tsx` | admin |
| `/dashboard/admin/operaciones` | `src/pages/AdminOperations.tsx` | admin |
| `/admin/operaciones` | `src/pages/AdminOperations.tsx` | admin |
| `/dashboard/admin/edicion` | `src/pages/prive/edition/EditionAdminPage.tsx` | admin |
| `/prive` | `src/pages/prive/PriveHub.tsx` | sesión |
| `/prive/invitacion` | `src/pages/prive/PriveInvitation.tsx` | sesión |
| `/prive/mi` | `src/pages/prive/PriveMyPage.tsx` | sesión |
| `/prive/membresia` | `src/pages/prive/PriveMembership.tsx` | sesión |
| `/prive/explorar` | `src/pages/prive/PriveExplorePage.tsx` | sesión |
| `/prive/key` | `src/pages/prive/PriveKeyPage.tsx` | sesión |
| `/prive/drops` | `src/pages/prive/PriveDropsPage.tsx` | sesión |
| `/prive/insider` | `src/pages/prive/PriveInsiderPage.tsx` | sesión |
| `/prive/insider/:destino` | `src/pages/prive/PriveInsiderPage.tsx` | sesión |
| `/prive/restablecer` | `src/pages/prive/PriveReset.tsx` | sesión |
| `/prive/destino/:slug` | `src/pages/prive/PriveDestinationPage.tsx` | sesión |
| `/prive/universo/:key` | `src/pages/prive/PriveUniversePage.tsx` | sesión |
| `/prive/experiencia/:slug` | `src/pages/prive/PriveExperiencePage.tsx` | sesión |
| `/prive/solicitudes` | `src/pages/prive/PriveRequestsPage.tsx` | sesión |
| `/prive/edicion` | `src/pages/prive/edition/LatestIssuePage.tsx` | sesión |
| `/prive/edicion/numero/:issue` | `src/pages/prive/edition/LatestIssuePage.tsx` | sesión |
| `/prive/edicion/articulo/:slug` | `src/pages/prive/edition/ArticlePage.tsx` | sesión |
| `/prive/edicion/mi-edicion` | `src/pages/prive/edition/MyEditionPage.tsx` | sesión |
| `/prive/edicion/briefing` | `src/pages/prive/edition/WorldBriefPage.tsx` | sesión |
| `/prive/edicion/oportunidades` | `src/pages/prive/edition/OpportunitiesPage.tsx` | sesión |
| `/prive/edicion/vuelo` | `src/pages/prive/edition/FlightEditionPage.tsx` | sesión |
| `/prive/edicion/biblioteca` | `src/pages/prive/edition/LibraryPage.tsx` | sesión |
| `*` | `src/pages/NotFound.tsx` | pública |

**Enlaces viejos** (correos, marcadores) que deben seguir llegando a su pantalla:

| Ruta | Lleva a |
|---|---|
| `/faq` | `/ayuda` |
| `/precios` | `/ayuda#planes` |
| `/dashboard/smart-spend` | `/dashboard/gastos` |
| `/dashboard/members` | `/dashboard/concierge?tab=members` |

**Total protegido:** 79 rutas que montan pantalla + 4 enlaces viejos = 83 direcciones.

---

## 4. Pruebas candado (vitest)

Se corren con todo lo demás (`npx vitest run`) o solas con `npm run candado`. Comprueban comportamiento (qué se monta, a dónde se llega, qué foto se pide), no textos.

| Prueba | Falla si… |
|---|---|
| `src/test/candadoRutas.test.tsx` | desaparece una ruta de App.tsx; una ruta deja de montar su página; una ruta pierde "exige sesión" o "exige administrador"; un enlace viejo deja de redirigir; aparece una ruta sin fila en este documento; una prueba guardiana citada aquí desaparece |
| `src/test/candadoMenus.test.tsx` | desaparece una entrada del menú lateral, de la barra inferior o de la hoja «Más»; un enlace del menú lleva a una pantalla que no existe; el buzón de opiniones deja de abrirse |
| `src/test/candadoPlanear.test.tsx` | la ruta multidestino deja de montar el globo 3D con sus ciudades; un viaje de varias ciudades escrito con todo deja de llegar directo al globo; uno de una ciudad deja de cotizar directo; vuelve un paso que pide un clic antes de llegar; se cotiza o se usa IA antes de tiempo |
| `src/test/candadoViaje.test.tsx` | una tarjeta de viaje de varias ciudades (Mis viajes, Inicio) o el encabezado del viaje no pide foto, o pide la de otra ciudad / la ruta completa; la portada guardada deja de verse; el total deja de estar en MXN o pierde de dónde sale |
| `src/test/candadoMarca.test.ts` | cambia cualquier color de la marca (en cualquier regla del CSS, también un "tema claro" nuevo), el degradado dorado, la conexión de Tailwind con esos colores, la paleta de Privé o la barra negra del navegador |
| `src/test/candadoIato.test.tsx` | Iato pierde una herramienta, una deja de aceptar una entrada válida o de llegar al modelo principal y al de respaldo; se pierde un atajo del chat; la pantalla de Iato pierde el cuadro de mensaje, los atajos o una pestaña |

Lista de lo protegido en forma de datos: `src/test/candadoInventario.ts` (rutas, menús, herramientas y pestañas de Iato).

---

## 5. Candado visual (capturas de referencia)

- **Qué:** las 15 pantallas más usadas a 390x844 (celular) con datos simulados: landing, auth, Ayuda, Inicio, Mis viajes, viaje (Resumen, Comprar, Itinerario), Planear, la ruta con el globo, Iato, Perfil, Gastos, Privé hub y Mesa de operaciones.
- **Referencias:** `docs/iatos/candado-visual/referencia/*.png` (en el repo).
- **Comparar:** `npm run candado:visual`. Levanta su propio servidor local con datos simulados (no toca producción, no gasta), congela la fecha (29-oct-2026, 12:00 Ciudad de México), sirve fotos simuladas y apaga animaciones; marca **FALLA** si más del 1 % de los píxeles de una pantalla cambió (`--umbral 0.02` para 2 %). El globo gira solo: se tapa en la captura, pero se exige que exista. Deja las capturas nuevas y los mapas de diferencias (en rojo) en `docs/iatos/candado-visual/ultima-corrida/` (no se suben). Tarda ~1.5 min, por eso no va dentro de vitest.
- **Actualizar referencias** (solo con aprobación del dueño, §1): `npm run candado:visual -- --actualizar`. Una sola pantalla: `--solo 10-ruta`.
- Requiere Playwright con Chromium (`npm i -D playwright && npx playwright install chromium`, o la variable `PW_CHROMIUM_PATH`).

---

## 6. Revisión diaria en producción (smoke)

- **Script:** `scripts/smoke/produccion.cjs` (`npm run candado:smoke`).
- **Qué hace**, con la cuenta demo en https://traveliatos.life: entra; abre Mis viajes y **cuenta las fotos cargadas**; abre la ruta con el globo y comprueba que el globo se ve; abre un viaje (foto y total); abre Iato y comprueba el cuadro de mensaje y los atajos. Reporta OK/FALLA por paso, con una captura de cada pantalla y `reporte.json` (en `./smoke-out/<fecha>/` o `--out <carpeta>`).
- **Qué NO hace:** no manda mensajes a Iato, no genera ni cotiza viajes, no gasta búsquedas: el navegador bloquea toda función del servidor salvo las fotos ilustrativas gratuitas (`pexels-image`, `buscar-video`) y toda escritura a tablas. Lo bloqueado se lista al final del reporte.
- **Credenciales:** solo por variables de entorno, **nunca en el repo**: `IATOS_SMOKE_EMAIL` y `IATOS_SMOKE_PASSWORD` (la contraseña de la cuenta demo). Opcional: `IATOS_SMOKE_BASE` o `--base` para otro dominio, `--escritorio` para 1440x900.
- **Código de salida:** 0 = todo OK, 1 = algún paso FALLA, 2 = no se pudo correr (faltan credenciales o Playwright).
- **Primera corrida (29-oct-2026, producción, cuenta demo):** OK 5/5 — entrar 7.0 s; Mis viajes 24 de 24 tarjetas con foto cargada; globo 3D montado (308x380); viaje "Valle de Bravo" con foto y total $16,953 MXN; Iato con cuadro de mensaje y 8 atajos. Bloqueado a propósito: `recomendar-destinos`, `geocode`, `booking-bridge`, `place-photo`.

**Cómo programarlo todos los días** (elige una):

1. **GitHub Actions** (recomendado): guarda `IATOS_SMOKE_EMAIL` e `IATOS_SMOKE_PASSWORD` como *secrets* del repositorio y agrega `.github/workflows/smoke-produccion.yml`:

   ```yaml
   name: Smoke de producción
   on:
     schedule: [{ cron: "17 13 * * *" }]   # 07:17 Ciudad de México, todos los días
     workflow_dispatch: {}
   jobs:
     smoke:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 22 }
         - run: npm i --no-save playwright@1.56.1 && npx playwright install --with-deps chromium
         - run: node scripts/smoke/produccion.cjs --out smoke-out/hoy
           env:
             IATOS_SMOKE_EMAIL: ${{ secrets.IATOS_SMOKE_EMAIL }}
             IATOS_SMOKE_PASSWORD: ${{ secrets.IATOS_SMOKE_PASSWORD }}
         - uses: actions/upload-artifact@v4
           if: always()
           with: { name: smoke-produccion, path: smoke-out/hoy }
   ```

   Si falla, GitHub avisa por correo a quien vigila el repositorio; las capturas quedan en el artefacto.
2. **Cron en un servidor propio:** `17 7 * * * cd /ruta/al/repo && IATOS_SMOKE_EMAIL=… IATOS_SMOKE_PASSWORD=… node scripts/smoke/produccion.cjs >> smoke.log 2>&1` (la contraseña en un archivo de entorno con permisos 600, fuera del repo).
3. **Después de cada publicación:** correrlo a mano (regla de §1).

No se dejó programado todavía: necesita que el dueño guarde la contraseña de la cuenta demo como *secret*.
