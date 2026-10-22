# IATOS Privé · The World Reimagined · reporte de prive-ux

Rama: `claude/wc-prive-ux`, construida sobre `claude/iatos-world-class` con `claude/cierre-auditoria` unida (los cambios del líder en contraseña y sesión Privé siguen intactos). No hubo push, despliegue, migración ni producción.

Alcance: Documento A completo para las áreas de prive-ux más el shell de seis áreas del Documento B §4: FOR YOU (maquetación), EXPLORE, fichas, sistema de fotos, tarjetas, MY PRIVÉ (visual), idioma, móvil, las tres propuestas de portada y los casos E2E 1–26.

## Resumen

- **Primera pantalla.** Foto a sangre completa del destino de tu próximo viaje, o de un destino emblemático que cambia en cada visita. Encima: IATOS PRIVÉ, **The World, Beyond Ordinary.** con su subtítulo en español, una línea personal ("Rodrigo, tu próximo capítulo: Ciudad de México."), los botones **Explora tu mundo** y **Pregúntale a Iato**, y la búsqueda universal, que a 390 px ya se ve sin desplazarse.
- **Sin listas infinitas.** A 390 px, el hub pasó de **10,624 px** de tarjetas de texto a unas cinco pantallas de carruseles con foto. Cualquier destino queda a dos acciones (escribir y tocar, o pestaña y tarjeta) y cualquier ficha a tres desde la búsqueda.
- **Ninguna tarjeta queda vacía.** La causa raíz de las fotos faltantes está corregida (ver §4). Si de verdad no hay foto, aparece un respaldo de marca con el nombre en filigrana.
- **Idioma.** El texto está en español por omisión y en inglés si el idioma principal de la persona es inglés. Las marcas se quedan en inglés con subtítulo en español.
- **Seis áreas.** FOR YOU · THE KEY · PRIVÉ DROPS · INSIDER · EXPLORE · MY PRIVÉ, con rutas propias. THE KEY, DROPS e INSIDER son, por ahora, páginas honestas de "en preparación" con ranuras listas para los equipos `privekey` y `privevalor`.
- **E2E 26/26 PASS** contra vite local con servidor simulado. Pruebas unitarias nuevas: `priveUx.test.tsx` (23) y `priveReimagined.test.tsx` (15).

## 1. Fase 0: diagnóstico verificado en HEAD

| # | Hallazgo de ChatGPT | Verificación en el código | Estado |
|---|---|---|---|
| 1 | Portada vacía, solo texto | `PriveHub.tsx` (antes): `<h1>` con "The World, Beyond Ordinary." sobre negro, sin imagen. Captura `antes-hub-*.jpg` | CONFIRMADO → CORREGIDO (`PriveHero.tsx`) |
| 2 | Destinos = lista enorme sin fotos | `hubSections.tsx` (antes): `GROUPS.map` con todas las regiones abiertas y `prive-tile` de solo texto, unos 108 destinos. `antes-hub-390.jpg`: 10,624 px de alto | CONFIRMADO → CORREGIDO |
| 3 | PriveImage puede dejar un bloque vacío | `PriveImage.tsx` (antes): sin foto dibujaba `<div className="h-full w-full" aria-hidden>` vacío; un 429 quedaba en caché como "sin foto" | CONFIRMADO → CORREGIDO (`PrivePhoto.tsx`) |
| 4 | Universos como botones de texto | `CatalogHome`: `prive-btn-ghost` "THE TABLE · 412" | CONFIRMADO → CORREGIDO |
| 5 | UniverseTiles sin navegación | `UniverseTiles.tsx`: `<li>` sin enlace | CONFIRMADO → CORREGIDO (`TwelveUniverses`: 12 enlaces; UniverseTiles solo queda para el adelanto y "en curaduría") |
| 6 | Universos duplicados con las colecciones de abajo | Fichas de universo arriba y `UniverseTiles` abajo en el mismo hub | CONFIRMADO → CORREGIDO (FOR YOU: The Extraordinary Edit; los 12 universos, solo en EXPLORE) |
| 7 | Sin explorador global | No existía | CONFIRMADO → CORREGIDO (`UniversalSearch` + `/prive/explorar`) |
| 8 | Contadores con demasiado protagonismo | "25 experiencias · Selección en crecimiento" en cada tarjeta | CONFIRMADO → CORREGIDO (relación geográfica primero; el conteo, secundario; cobertura solo cuando advierte algo) |
| 9 | El escritorio desaprovecha el espacio | Una columna `max-w-5xl` de texto | CONFIRMADO → CORREGIDO (portada a sangre completa, rejilla editorial, carriles) |
| 10 | No prioriza el viaje activo | El hub no leía el viaje | CONFIRMADO → CORREGIDO (portada, Curated for You y Your Next Journey usan el viaje activo resuelto con `resolveActiveTrip`; nunca otro viaje) |

## 2. Qué se construyó (por fase)

| Fase | Entrega | Archivos |
|---|---|---|
| 1 Portada | Portada cinematográfica (destino del viaje o emblemático que rota; Ken Burns; video ilustrativo de Pexels solo con movimiento permitido y sin ahorro de datos). Búsqueda universal bajo la portada. Curated for You (3–6). The Extraordinary Edit (8 colecciones que abren universos existentes; se ocultan las que no tienen contenido publicable). Your Next Journey con sus cuatro acciones, o "Planear un viaje" si no hay viaje. | `PriveHero.tsx`, `home/ForYouHome.tsx`, `home/sections.tsx`, `home/defaults.tsx`, `home/UniversalSearch.tsx` |
| 2 Navegación | Seis áreas. En escritorio, arriba. En el teléfono, una barra inferior con cinco (Para ti, The Key, Explorar, Drops, Mi Privé) e Insider en la barra superior: las seis a un toque. Área activa con `aria-current`. Filtros y búsqueda en la URL. "Pregúntale a Iato" abre el Concierge existente con la pregunta escrita (`?ask=`), no un chatbot nuevo. | `shell/PriveNav.tsx`, `PriveRoot.tsx`, `lib/priveLinks.ts`, `pages/Concierge.tsx` (una línea) |
| 3 Destinos | Destacados (6–8, con contenido). Pestañas por región, una a la vez, con carrusel e índice compacto "Ver todos (N)". Búsqueda con alias, acentos e idiomas. Relación geográfica correcta: Polanco → "Barrio de Ciudad de México"; Montecarlo → "Zona de Mónaco"; Punta Mita → "En Riviera Nayarit"; Interlomas → "Área metropolitana de Ciudad de México"; Riviera Nayarit → "Región · México". | `catalog/DestinationBrowser.tsx`, `lib/priveBrowse.ts`, `lib/priveDestinationIndex.ts` (generado) |
| 4 Universos | Doce universos con foto, marca + subtítulo, descripción y número de orden, todos navegables. Página de universo con portada, filtro por destino (en la URL) y destinos relacionados. Sin contenido: "Selección en preparación". | `home/sections.tsx` (`TwelveUniverses`), `PriveUniversePage.tsx` |
| 5 Tarjetas | FEATURED EXPERIENCE (Descubrir y Guardar a la vista), DESTINATION, EDITORIAL COLLECTION (rejilla de revista 2×2 + 1 + 4 + 2) y COMPACT EXPERIENCE (búsqueda). | `home/defaults.tsx`, `home/UniversalSearch.tsx`, `catalog/DestinationBrowser.tsx` |
| 6 Fotos | Ver §4. | `PrivePhoto.tsx`, `lib/privePhoto.ts`, `lib/stockPhoto.ts`, `pexels-image` |
| 7 Ficha | Portada más grande, "Por qué merece la pena" destacado y acciones a la vista: **Guardar en Mi Privé · Agregar a mi viaje · Solicitar con Iato · Ver opciones de reserva** (sitio oficial, otra pestaña) **· Pregúntale a Iato**. Al final, "Más en <ciudad>". | `catalog/ExperienceDetail.tsx`, `catalog/MoreInDestination.tsx`, `PriveExperiencePage.tsx` |
| 8 Make it extraordinary | Lanzador de The Privé Key en FOR YOU (texto → `/prive/key?q=…&destino=…`). El organizador completo es de `privekey`. | `home/defaults.tsx` (`PriveKeyLauncher`) |
| 9 Mi Privé | `/prive/mi`: tarjeta, Pasaporte (ranura), guardados con foto, solicitudes abiertas, el valor de tu Privé (ranura) y preferencias y seguridad (las secciones de membresía de siempre). `/prive/membresia` se conserva. | `PriveMyPage.tsx`, `PriveMembership.tsx` (`embedded`) |
| 10 WOW | La Grand Welcome aparece solo la primera vez (sin cambios de lógica). Transiciones suaves con movimiento reducido. No se dice "Tonight, somewhere extraordinary" porque no hay contenido fechado suficiente. | — |
| 11 Móvil | Revisado a 320, 375, 390, 412, 768, 1024 y 1440 px sin desplazamiento horizontal (E2E 22). Botones de al menos 44 px. La barra inferior no tapa acciones: el contenido deja libre su alto. | `prive.css` |
| 12 Scroll | 6–8 destacados en la portada y el resto en el explorador. "Ver más" de 9 en 9. Estado restaurable en la URL (`?q=`, `?region=`, `?u=`, `?destino=`) y enlaces profundos. | `catalog/ShowMore.tsx` |
| 13 Tres propuestas | Ver §3. | `home/ForYouHome.tsx`, `PriveHero.tsx` |

## 3. Tres propuestas de portada (las tres funcionan con los mismos datos)

Para verlas: `/prive?portada=a`, `?portada=b` o `?portada=c` (por omisión, c). Capturas: `despues-home-{a,b,c}-{390,1440}.jpg`.

- **A · A PRIVATE EDITORIAL.** Portada de revista en dos columnas: número de edición, titular serif grande y foto vertical; la experiencia de la semana va primero.
- **B · CONTEMPORARY PRIVATE CLUB.** Saludo de club con "Miembro desde", cuatro accesos directos (The Key, Drops, Insider, Explorar) y listas compactas.
- **C · CINEMATIC JOURNEY.** Foto o video a sangre completa, búsqueda sobre el borde de la portada y carriles de imagen.

Medido con Playwright contra vite local con datos simulados (servidor de desarrollo: el LCP es indicativo y varía con la carga de la máquina):

| Criterio | A | B | C |
|---|---|---|---|
| Búsqueda visible en la primera pantalla a 390 px | No (886 px) | No (874 px) | **Sí (711 px)** |
| Búsqueda visible a 1440 px | Sí | Sí | Sí |
| Acciones en la primera pantalla | 10–11 | **15** | 12 |
| CLS (390 / 1440) | 0 / 0.002 | 0.002 / 0.002 | 0.007 / 0.002 |
| Imágenes de Pexels en la primera pantalla | 4–5 | **1** | 2 |
| Prestigio (dirección de arte, pedido del dueño: "cinematográfico, élite") | Alto (revista) | Medio (parece tablero) | **Muy alto** |
| Accesibilidad (axe, graves) | 0 | 0 | 0 |
| Compatibilidad (ranuras de los otros equipos, móvil) | Sí | Sí | Sí |

**Elegida: C.** Es la única que cumple la meta de Fase 15 "primera pantalla con búsqueda y contenido útil" también en el teléfono, y la que mejor responde al pedido del dueño ("algo único, élite, que dé ganas de pertenecer"). Lo hace con dos imágenes en la primera pantalla y sin saltos de diseño. B queda como respaldo si se prefiere la utilidad sobre la emoción, y A como versión editorial para campañas.

## 4. Fotos: causa raíz y arreglo (Fase 6)

**Causa raíz.** Se reproduce en `antes-welcome-390.jpg`: Ciudad de México, Nueva York y Roma salen vacías con la "P".

1. La Grand Welcome (`priveApi.illustrativePhoto`) y las tarjetas del catálogo (`PriveImage`) llamaban a `pexels-image` por su cuenta, sin la fila compartida de `stockPhoto.ts` (20 por minuto, 3 a la vez, pausa tras 429). El servidor permite 30 por minuto por persona y contaba también los aciertos de caché, así que cualquier ráfaga devolvía 429.
2. Un 429, o un fallo de Pexels mismo (cuota de 200 por hora de la llave), se quedaba como "sin foto" para siempre. Además, `pexels-image` respondía `200 + image:null` cuando Pexels fallaba, que es igual a "no hay foto"; el navegador lo recordaba toda la sesión.
3. La lista de destinos ni siquiera pedía foto, y la portada del destino usaba "<name_en> skyline", que no sirve para islas, valles ni barrios.

**Arreglo.**
- `PrivePhoto` y `privePhoto.ts`: todo pasa por `loadStockPhoto`, con la misma fila y la misma caché de sesión. Cada destino tiene una cadena de consultas: curada → "<ciudad> <país>" → "<ciudad>". Un fallo temporal no se recuerda y se reintenta a los 4, 15 y 45 s. La foto se pide solo cuando la tarjeta está en pantalla (margen vertical, no a la derecha del carrusel) y se muestra con una transición suave y alto reservado (sin saltos de diseño). Si de verdad no hay foto, aparece el respaldo de marca. El crédito "Foto ilustrativa · Pexels · <fotógrafo>" va en cada foto: como texto dentro de tarjetas enlazadas (un enlace anidado abría otra pestaña) y como enlace en portadas.
- `pexels-image` (**requiere desplegar la función**):
  - la caché va antes del límite estricto, con un límite propio y amplio para aciertos;
  - si Pexels falla, sirve la copia vencida o responde `503 + Retry-After` con `upstream_error`;
  - la respuesta de Pexels se lee con tolerancia a errores.
- El índice de destinos (`scripts/prive/gen_destination_index.mjs` → `src/lib/priveDestinationIndex.ts`, 111 destinos) guarda el nombre en inglés, el país, los alias, el barrio o zona, la zona metropolitana y las consultas de foto.
- Mientras la bienvenida o la guía están abiertas, el hub no se monta, así que las seis ciudades se atienden primero.
- Fotos reales del establecimiento: no hay fuente con derechos verificados en el repositorio, así que todas siguen marcadas como ilustrativas, como pide la Fase 6. Las capturas de evidencia usan fotos de Wikipedia como sustituto local de las respuestas de Pexels (servidor simulado); no se usan en la app.

## 5. Contrato con privekey y privevalor

- Rutas dentro de `PriveRoot`: `/prive`, `/prive/key`, `/prive/drops`, `/prive/insider`, `/prive/insider/:destino`, `/prive/explorar` y `/prive/mi` (`/prive/membresia` se conserva). Están en `App.tsx`.
- `src/components/prive/key/index.ts` (**stub de prive-ux; lo reemplaza privekey**) exporta `PriveKeyLauncher`, `YourWorldIsReady`, `CuratedForYou` y `YourNextJourney`. Por ahora reexporta las versiones funcionales de `src/components/prive/home/defaults.tsx`; `YourWorldIsReady` no dibuja nada.
- `src/components/prive/value/index.ts` (**stub; lo reemplaza privevalor**) exporta `PrivateEditTeaser`, `DropsTeaser`, `PassportCard` y `ValueOfYourPrive`. Hoy devuelven `null`: no se inventan oportunidades ni valores.
- Páginas stub (las reemplazan sus dueños): `PriveKeyPage.tsx`, `PriveDropsPage.tsx` y `PriveInsiderPage.tsx`. Muestran "En preparación", la marca con su subtítulo y "Pregúntale a Iato"; nunca una página vacía.
- Contexto para las ranuras, sin props: `usePriveHome()` (datos de prive_home) y `usePriveTrip()` (viaje activo y su destino de Privé) en `src/components/prive/home/context.tsx`.
- `The Privé Key` recibe `?q=<texto>&destino=<slug>` desde el lanzador y desde la tarjeta del viaje ("Organizar una noche").
- Nuevo en `priveCatalogApi`: `search()` (prive_search existente) y `limit` opcional en `universe()` y `forYou()`. Son RPC existentes; no hay cambios de base de datos.

## 6. Idioma

- `src/lib/priveI18n.ts`: diccionario es/en tipado (la misma forma en los dos idiomas; lo comprueba una prueba).
- Cómo se decide el idioma (`resolvePriveLang`): 1) un campo de idioma del perfil, cuando exista (`profiles` no lo tiene hoy), 2) `navigator.languages`, 3) español.
- `PriveLangProvider` pone `lang="es-MX"` o `lang="en"`.
- Marcas en inglés con subtítulo: IATOS PRIVÉ, The World, Beyond Ordinary., Curated for You, The Extraordinary Edit, Your Next Journey, The Privé Key, Privé Drops, Insider, los doce universos y las ocho colecciones.
- Pendientes de otros dueños:
  - `LockScreen.tsx` y `PasswordCreator.tsx` (del líder) siguen solo en español; sus errores cambian de idioma por `messageFor`.
  - El correo de invitación (`_shared/priveEmail`) conserva sus líneas en inglés.

## 7. E2E (Fase 15) · Playwright contra vite local, servidor simulado, sin sesiones reales

Resultado: **26/26 PASS** (`docs/iatos/prive_reimagined/prive-ux-e2e.json`). En la primera corrida fallaron dos casos: el 10, por un selector de la prueba sensible a mayúsculas, y el 24, por CLS 0.122. El 24 era un defecto real y está corregido en §8.

| # | Caso | Resultado y evidencia |
|---|---|---|
| 1 | Miembro ve la portada completa | 7/7 secciones; búsqueda en la primera pantalla; 0 errores JS |
| 2 | FREE ve solo lo autorizado | Adelanto; sin barra de miembro; 0 RPC de contenido |
| 3 | Búsqueda Mónaco | «Mónaco» → /prive/destino/mc (2 acciones) |
| 4 | CDMX | «cdmx» → /prive/destino/cdmx |
| 5 | Restaurante | «Quintonil» → prive_search en los 5 destinos destacados → ficha en 3 acciones |
| 6 | Sin resultados | Lo dice, y "Pregúntale a Iato" lleva la misma frase |
| 7 | Cambio de región | Europa, sin recargar; `?region=europa` |
| 8 | Universo | /prive/universo/the_table, h1 "The Table" |
| 9 | Abrir destino | Misma pestaña |
| 10 | Abrir experiencia | Acciones a la vista |
| 11–12 | Guardar / quitar | prive_save true y luego false; `aria-pressed` |
| 13 | Agregar al viaje | prive_add_to_trip con el viaje activo; "queda como plan sin reservar" |
| 14 | Solicitar con Iato | concierge-action `prive_request`; "aún no es una reserva" |
| 15 | Enlace real de reserva | `target=_blank` externo; Privé sigue en su pestaña |
| 16 | Regresar a Privé | Atrás → la misma región seleccionada |
| 17 | Mi Privé | Tarjeta, guardados y solicitudes |
| 18 | Foto inexistente | 0 cajas vacías, 0 imágenes rotas, respaldo de marca |
| 19 | Servicio de fotos caído (503) | 0 cajas vacías, 0 rotas; reintento sin errores |
| 20 | Datos obsoletos | "Por verificar…" en gris; sin "Solicitar" (prueba unitaria) |
| 21 | Sesión Privé vencida | Candado; sesión local borrada |
| 22 | Móvil | 7 anchos × 5 pantallas sin desplazamiento horizontal |
| 23 | Accesibilidad (axe WCAG 2.1 AA) | 0 violaciones graves o críticas en 5 pantallas |
| 24 | Rendimiento | CLS 0.01 (antes 0.122); LCP 1.5 s en el servidor de desarrollo (indicativo) |
| 25 | Teclado | Pestañas con flechas, Inicio y Fin; foco visible |
| 26 | Movimiento reducido | Sin Ken Burns, sin video, `data-motion=reduced` |

Scripts (en el scratchpad de la sesión, no versionados): `e2e.cjs`, `mock.cjs`, `shoot2.cjs` y `variants.cjs`.

## 8. Rendimiento

- **CLS de la portada: 0.122 → 0.01.** Había tres causas:
  - el margen negativo de la búsqueda colapsaba hacia el contenedor;
  - la barra superior cambiaba de flujo;
  - la portada cambiaba de foto y de texto al saber si había viaje.

  Ahora hay alto reservado, desplazamiento relativo y la portada espera al viaje.
- Las fotos se piden solo al verse y con la fila compartida: en la primera pantalla de la portada C hay 2 imágenes de Pexels.
- El video de la portada se pide solo con movimiento permitido y sin ahorro de datos, y aparece cuando ya puede reproducirse.
- Todo Privé va en chunks perezosos; el paquete de entrada no crece (ver el build).

## 9. Pruebas

- `src/test/priveUx.test.tsx` (23): idioma (es por omisión; en por navegador o perfil; llaves iguales), Grand Welcome sin inglés para quien usa español, cadena de fotos, fallos temporales no recordados, nunca una caja vacía, búsqueda sin acentos, pestañas, "Ver más", portada, Curated for You con y sin viaje, Next Journey, sin `target=_blank` interno y sin enlaces anidados.
- `src/test/priveReimagined.test.tsx` (15): búsqueda universal ("Una cena romántica en París.", "Lo mejor de Mónaco.", "Yates en Los Cabos.", "Un rooftop… en Nueva York.", "Experiencias únicas en Japón.", Quintonil, Polanco, Montecarlo, roma norte), relaciones geográficas, las seis áreas, adelanto sin navegación de miembro, ranuras del contrato, búsqueda → ficha en 3 acciones, sin resultados → Iato, las tres propuestas, Explorar con la región en la URL, universo con filtro por destino y Mi Privé.
- Se actualizaron las pruebas existentes que esperaban las líneas en inglés o los textos de relleno. Ninguna se debilitó: las negativas ("no hay Agregar a mi viaje en una ficha vieja") tienen ahora su par positivo.
- **Suite completa** (`npx vitest run --testTimeout=30000`, con la máquina compartida a carga ~50): 163 archivos, **1535 de 1536 pasan**. La única falla, `serpQuota.test.ts › búsquedas idénticas…`, no es de Privé: depende del tiempo y pasa sola (12/12). Hay 7 rechazos no manejados de `TripBookingIntents.tsx` (`.not` no está en el doble de supabase), también ajenos a Privé. Las suites de Privé dan 19 archivos y 309/309.
- **`npx tsc --noEmit -p tsconfig.app.json`**: limpio. **`npm run build`**: OK; Privé va en chunks aparte y la entrada no cambia de forma apreciable. **`deno check` de pexels-image**: OK.

## 10. Requiere autorización para producción

- **Desplegar `pexels-image`** (supabase/functions/pexels-image/index.ts): caché antes del límite y `503 + Retry-After` cuando Pexels falla. Pasa `deno check`. Sin el despliegue, el cliente igual mejora (fila compartida, cadena de consultas, reintentos), pero un fallo de Pexels todavía llega como "sin foto" mientras corra la versión vieja de la función.
- **Sin migraciones.** No se tocó la base de datos.

## 11. Mejoras adicionales ("GOD TIER")

- `Concierge.tsx` acepta `?ask=` para dejar escrita la pregunta de "Pregúntale a Iato" sin enviarla (una línea, aditiva).
- Ya no se anidan enlaces en las tarjetas del catálogo: el crédito de Pexels dentro de la tarjeta abría otra pestaña al tocar la foto, y era probablemente la "pestaña nueva" que vio el dueño en la vista previa.
- "Selección en crecimiento" desaparece de tarjetas y portadas: la cobertura solo se dice cuando advierte algo.
- Prueba de la Grand Welcome más estable (antes fallaba a veces en la rama base: el temporizador se programaba después de `findByRole`).
- El idioma de las pruebas queda fijado en es-MX en `src/test/setup.ts` (jsdom decía en-US).

## 12. Riesgos y pendientes

- Las fotos de experiencias siguen siendo ilustrativas (Pexels). Fotos del lugar requieren fuente con derechos verificados, decidida por una persona (`verified_image`).
- "Para ti" sin viaje usa el universo con más contenido, ordenado por el servidor con las señales de la persona, y lo dice como "Selección editorial". La personalización completa la entrega `privekey`.
- `prive_search` registra eventos `iato_pick_shown` con superficie `iato` también cuando la búsqueda viene de la portada. Conviene una superficie propia (aditivo, del grupo de catálogo).
- El LCP se midió en el servidor de desarrollo; falta medirlo con Lighthouse sobre un build en un entorno sin la carga de los demás grupos.
- **GO** para integrar las áreas de prive-ux en desarrollo. **NO-GO a producción** hasta desplegar `pexels-image`, integrar las ranuras de `privekey` y `privevalor`, y aprobar las capturas.

## 13. Capturas (`docs/iatos/evidencia/prive-ux/`)

- Antes (`f62466e`):
  - `antes-welcome-{390,1440}.jpg`: tres ciudades vacías, en inglés;
  - `antes-hub-{390,1440}.jpg`: lista de 10,624 px;
  - `antes-destino-{390,1440}.jpg`.
- Después:
  - `despues-home-{a,b,c}-{390,1440}.jpg`, `despues-home-c-en-US-*` y `despues-home-sin-viaje-*`;
  - `despues-busqueda-*`, `despues-explorar-*`, `despues-universo-*`, `despues-destino-*`, `despues-experiencia-*`, `despues-mi-*` y `despues-welcome-*`.
