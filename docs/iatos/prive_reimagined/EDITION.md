# THE PRIVATE EDITION: primer número terminado

**Equipo:** edition · **Rama:** `claude/wc-edition` (desde `claude/cierre-auditoria`) · **Fecha:** 22 de octubre de 2026
**Especificación:** `prive_private_edition_spec.md` (dueño) + contrato de Privé reimaginado.
**Producción:** no se tocó. Nada está desplegado ni aplicado. Lo que necesita autorización está en la §16.

En una frase: hay una revista real dentro de Privé (`/prive/edicion`). El Nº 01 (noviembre de 2026) tiene 16 piezas originales, 34 fuentes registradas y 12 fotos con licencia. Todo está en `pending_review`, listo para que el responsable editorial lo lea y lo apruebe en `/dashboard/admin/edicion`. Con eso aprobado ya funcionan la lectura en línea, el PDF y la lectura sin conexión, que se probó en modo avión real.

---

## 1. Plan editorial

| Pilar | Piezas del Nº 01 | Por qué |
|---|---|---|
| Portada | **«La ciudad acelera»**: GP de la Ciudad de México (30 oct–1 nov) y Desfile de Día de Muertos (31 oct) | Tiene fecha cierta y relevancia para México, y se puede convertir en un plan (explorar CDMX, organizar con Iato). |
| Reportajes | «El sureste entra al mapa»: Mérida y Guadalajara tras la Guía MICHELIN (mayo) y las Llaves 2026 (septiembre) · «Port Hercule, en septiembre»: 35.º Monaco Yacht Show | Gastronomía, hoteles y yates, con distinciones fechadas y fuentes primarias. |
| Agenda y breves | Watches and Wonders 2027 · Art Basel Miami Beach · PGA Tour en Los Cabos · «Fechas para apartar» (9 fechas oficiales) | Relojería, arte y golf; cada fecha lleva su fuente. |
| Explicadores (información, no asesoría) | Tasa de Banxico en 6.50 % · Calendario europeo de la IA de alto riesgo | Finanzas e IA explicadas, con avisos claros de que no son asesoría. |
| The World Brief | Nobel de Economía · LVMH 3T · INEGI viajeros (agosto) · Banxico 24-sep · Delta–Aeroméxico (tribunal) · Desfile | Seis hechos fechados, cada uno con fuente primaria más corroboración. |
| Carta del editor | «Una revista que se puede comprobar» | Explica las reglas: fuentes, IA como redactora y no como autoridad, correcciones visibles. |

- **Lo que este número no cubre** (moda, belleza, superautos, aviación privada, bienestar): no se rellenó. Si el miembro los elige, My Edition le avisa que todavía no hay piezas de esos temas.
- **Frecuencia:** una revista mensual. The World Brief solo se actualiza cuando hay fuentes nuevas. Las oportunidades se actualizan según su vigencia y no cuentan como número nuevo. La Flight Edition se genera cuando el miembro la pide.
- **Flujo editorial:** investigación → fuentes → borrador asistido por IA → verificación → revisión → maquetación → publicación. El plan está guardado en `edition_issues.plan` y se ve en el panel.

## 2. Diseño de portada

La portada va a sangre con la foto con licencia. Lleva la cabecera *THE PRIVATE EDITION* / *Curated Around Your World.*, el número y el mes, el antetítulo, el título grande, las líneas de portada, los botones Leer e Índice, y el crédito de la foto con la etiqueta «Foto ilustrativa» cuando corresponde.

- **Portada personal:** si el miembro tiene intereses, la portada pasa al reportaje que más coincide con ellos (con su foto). Si lo pidió, lleva su nombre («La edición de Valentina») y siempre la nota «Selección y orden automáticos… No es una investigación individual».
- **Evidencia:** `docs/iatos/evidencia/edition/01-portada__1440.jpg` y `01-portada__390.jpg`. La portada del PDF está en `pdf-n01-es-01.jpg`.

## 3. Índice configurable

- **En escritorio** es una doble página: a la izquierda la carta del editor, a la derecha el índice numerado con secciones y minutos de lectura.
- **El miembro controla:**
  - el orden de las secciones;
  - los temas excluidos (las piezas se ocultan y el índice dice cuántas);
  - el tiempo de lectura (lo que no cabe pasa a «Si tienes más tiempo»).
- **El índice del PDF** lleva números de página reales.
- **Evidencia:** `02-indice__*.jpg` y `06-my-edition__*.jpg` (la vista previa del índice se actualiza mientras el miembro elige).

## 4. Artículos reales, originales y verificados

- **Volumen:** 16 piezas, unas 2,375 palabras en español y 2,129 en inglés. Todas tienen traducción completa (lo comprueba una prueba).
- **Originalidad:** los textos son originales. No se copió ningún artículo; las citas textuales son breves y van atribuidas (por ejemplo, la guía oficial de MexicoGP y Monaco Life).
- **Hechos, análisis y avisos:** cada hecho lleva su fecha. El análisis editorial va en un recuadro marcado «Análisis editorial» y los avisos en «Aviso» (finanzas e IA: no es asesoría).
- **Verificación hecha el 22-oct-2026** con búsqueda y lectura directa de fuentes primarias y medios reconocidos. Lo que no se pudo confirmar en dos fuentes no se publicó:
  - totales nacionales de estrellas MICHELIN (los medios no coinciden);
  - fechas de vuelos de Volaris (contradictorias);
  - número de habitaciones del Hotel Sevilla;
  - días VIP de Art Basel.
- **Dos verificaciones quedan para el editor** (anotadas en el registro de fuentes):
  - nobelprize.org devolvió 403 a la consulta automática; los laureados y la motivación se corroboraron con AAP y APA/Reuters;
  - las fechas del Omnibus de IA vienen de K&L Gates y Sidley; conviene confirmarlas en EUR-Lex.
- **Cada pieza está marcada como borrador:** `drafted_by = 'claude'` y estado `pending_review`. Al lector le aparece «Texto preparado con asistencia de IA y revisado por {firma}» solo después de la aprobación. Si el editor modifica el texto, pasa a `drafted_by = 'human'` y vuelve a revisión.
- **Fuente única del contenido:** `data/prive/edition/issue-01.json`. La migración `20261025100200_edition_seed_n01.sql` se genera desde ahí con `scripts/edition/build-seed.mjs`, que se niega a generar si falta una fuente, una licencia, la fecha de un breve, o si un enlace oficial no tiene fuente. Una prueba exige que la migración sea idéntica a la generada.

## 5. Sistema de fuentes y licencias

- **Registro de fuentes (`edition_sources`)** guarda por cada fuente:
  - una de las 7 categorías del dueño (primaria oficial, datos públicos, medio periodístico, material del proveedor, foto con licencia, artículo IATOS, licenciado de tercero);
  - URL https, entidad y autor;
  - fecha de publicación y de consulta;
  - datos usados, derechos de reutilización, atribución, restricciones de distribución y evidencia de verificación;
  - el estado del enlace (`unchecked/ok/broken/blocked`).
- **Imágenes (`edition_images`):**
  - proveedor, página, autor, licencia y su enlace;
  - si es ilustrativa y **qué representa realmente** («No es ninguno de los yates mencionados»);
  - texto alternativo, punto focal, permiso de uso en PDF y offline;
  - el estado de la licencia (`pending/approved/blocked`). La base impide aprobar una imagen sin licencia ni crédito (CHECK).
- **Las 12 fotos** son de Pexels: se verificó la página de cada una (autor, ubicación, licencia), se sirven desde el CDN de Pexels con crédito y licencia, y no hay ninguna foto editorial comercial.
- **Reglas que comprueba la base en el servidor:**
  - una imagen sin licencia aprobada nunca sale a lectura, PDF ni offline: se quita del cuerpo;
  - una fuente rota bloquea la aprobación;
  - un tema sensible (finanzas) necesita dos fuentes;
  - un breve con un hecho de hace más de 90 días no se aprueba;
  - un enlace «oficial» a un dominio que no es fuente de la pieza se bloquea (enlace comercial falso).
- **Función `edition-link-check`:** un admin la usa para comprobar los enlaces. Clasifica 2xx/3xx como ok, 404/5xx/sin respuesta como rota, y 401/403/429 como bloqueada, que queda para revisión humana.

## 6. Panel de aprobación (`/dashboard/admin/edicion`, solo admins)

- **Acceso:** el servidor exige `public.admins` en cada RPC `edition_admin_*`, igual que `admin_metrics`. Un no admin ve «Solo el equipo editorial…».
- **Pestañas:**
  - **Revisión:** cada pieza con su estado, sus bloqueos explicados en lenguaje de editor y un editor de título, entradilla y cuerpo en es/en. Acciones: aprobar con firma, rechazar con motivo, programar, publicar, retirar con nota pública, volver a revisión y «Ver como miembro».
  - **Número:** comprobaciones, aprobar, programar, publicar y retirar.
  - **Fuentes:** tabla con derechos y estado del enlace, y el botón «Comprobar enlaces».
  - **Imágenes y licencias:** aprobar o bloquear cada licencia.
  - **Bitácora y costos.**
  - **Vista previa (demo):** el número completo como lo verá el miembro, con la franja **«VISTA PREVIA · MODO DEMOSTRACIÓN · NO PUBLICADO»**. Las fotos con licencia pendiente y los borradores de IA van marcados.
- **Correcciones:** un artículo publicado no se edita en silencio. Se corrige con una nota pública fechada que el lector ve.
- **Evidencia:** `11-panel-revision__*`, `12-panel-vista-previa__*`, `13-panel-licencias__*`.

## 7. Oportunidades verificadas (Privé Opportunities = PRIVÉ DROPS)

- **No se duplicó el modelo de datos:** la pantalla lee `prive_drops(_ps, _destination, _types, _interests, _limit)` de privevalor. Esa función todavía no está en mi base; su migración `20261024100000_privevalor_drops.sql` sigue sin confirmar en su rama.
- **Interfaz estrecha** `Opportunity` en `src/lib/priveEdition.ts`. Si la RPC no existe (`NOT_AVAILABLE`), la pantalla dice que Drops aún no está disponible y muestra **cero**.
- **El cliente vuelve a filtrar** aunque el servidor ya lo haga (`isOpportunityLive`):
  - deja fuera lo vencido, programado o retirado;
  - deja fuera lo que no tiene fuente o enlace https o fecha de verificación.
- **En cada oportunidad** se muestra la relación comercial (promoción pública, afiliado, publicidad o convenio) y «información a la fecha».
- **Hoy hay cero oportunidades en esta rama**, a propósito: no había ninguna pública verificable con URL y vigencia que cumpliera las reglas.
- **Las claves de intereses coinciden con las de privevalor** (`formula_1`, `hoteles_y_villas`…). Los 25 intereses están en `edition_interest_keys()`; para el líder: conviene que privevalor use exactamente esta lista.

## 8. Personalización

- **Edición común y barata:** hay una sola biblioteca editorial. `personalizeIssue()` es una función pura del navegador: **0 llamadas de IA y 0 RPC extra por miembro**.
- **Ediciones:** Viajes, Negocios, Estilo de vida y Mi mezcla.
- **Intereses:** los 25 del dueño, cada uno con intensidad 1, 2 o 3. Además: temas excluidos, idioma (es/en), tiempo de lectura (5–60 min), orden de secciones y nombre en la portada.
- **Consentimiento:** sin él no se guardan intereses (lo comprueba la base). Hay un botón «Borrar mis preferencias» (RLS del dueño).
- **Nunca se infiere por sexo ni por género:** la función no recibe el perfil y una prueba lo comprueba.
- **Flight Edition:** toma un viaje existente del miembro (por ejemplo «Ciudad de México, México» → `cdmx`) o un destino, junto con temas, minutos, idioma y la opción de guía del destino.

## 9. Lectura en línea

- **Maquetación de revista:**
  - en escritorio, la apertura es una **doble página** (foto a sangre a la izquierda, título a la derecha; la prueba E2E comprueba 2 columnas);
  - en el cuerpo: capitular, citas destacadas a todo lo ancho, recuadros de datos, notas de análisis y aviso, fotos medianas y anchas con crédito, agenda;
  - fuentes con fechas, «From Page to Experience», anterior/siguiente y barra de progreso;
  - en móvil, lectura editorial en una columna, sin scroll horizontal (comprobado en todas las pantallas a 390 y 1440).
- **Navegación de 6 áreas:** Latest Issue · My Edition · World Briefing · Privé Opportunities · Flight Edition · Library. La marca va en inglés con subtítulo en español.
- **Library:** números anteriores, The Reading List (guardados) y las copias guardadas en este dispositivo.
- **Idioma:** se cambia con ES/EN; si falta la traducción, se muestra el español y se avisa.
- **From Page to Experience:** las acciones solo van a rutas que ya existen o a enlaces oficiales https:
  - `/prive/destino/:slug` y `/prive/universo/:key`, donde están las fichas con Booking Bridge;
  - Iato (`/dashboard/concierge`) con el texto ya escrito, que nunca se envía solo;
  - `/dashboard/planear`, `/dashboard/hoteles` y `/dashboard/restaurantes`;
  - enlaces oficiales https de dominios que son fuente de la pieza.

  No se inventan disponibilidad ni alianzas: «IATOS no vende boletos ni tiene acuerdos…».

## 10. PDF descargable

- **Cómo se genera:** en el navegador con **jsPDF**, la librería que la app ya usa (chunk `vendor-pdf`). Se carga con `import()` solo al pulsar «Descargar PDF»; una prueba vigila que no haya `import` estático.
- **Contenido:**
  - portada a sangre con la foto, número, fecha y Flight Edition / destino;
  - índice con números de página;
  - apertura de cada pieza, cuerpo a dos columnas, citas, recuadros y notas;
  - fotos incrustadas solo con licencia aprobada y `allow_pdf`, cada una con crédito y qué representa;
  - fuentes por pieza y enlaces de «From Page to Experience»;
  - oportunidades «a la fecha»;
  - página de créditos y licencias, aviso de que no se puede revocar a distancia;
  - pie con número de página y **fecha de generación**.
- **Medido:**

  | PDF | Páginas | Fotos incrustadas | Tamaño | Tiempo de generación |
  |---|---|---|---|---|
  | Número completo, es | 24 | 12 | 2.9 MB | ≈1.2 s |
  | Flight Edition, en | 16 | 12 | 2.9 MB | ≈1.0 s |

  Los tiempos son de Node; en el navegador el orden es similar.
- **Evidencia:** `pdf-n01-es-01..05.jpg`, `pdf-n01-es-todas-las-paginas.jpg`, `pdf-flight-en-01..03.jpg`.

## 11. Piloto de lectura sin conexión (PWA)

- **Cómo se guarda:** en Cache Storage (`iatos-edition-v1`) por usuario, con un hash del id:
  - el JSON de la copia, con solo lo publicado y con licencia;
  - cada foto descargada de verdad por CORS;
  - el «app shell» que ya está cargado (`/` y `/assets/*`).
- **Atómico:** si una foto o la escritura falla, se borra lo parcial y **no se declara descargado**.
- **Antes de guardar:** se revisa la cuota (`navigator.storage.estimate`) y se pide `persist()`.
- **Pantalla `/prive/edicion/sin-conexion`:**
  - queda fuera de ProtectedRoute porque en un avión la sesión no se puede renovar, y **no llama a la red**;
  - lee solo las copias de este usuario y en este dispositivo; las fotos salen como `blob:` locales;
  - muestra la fecha de generación;
  - **no permite reservar, pagar ni consultar disponibilidad** (acciones deshabilitadas con aviso).
- **Al volver la red,** con la sesión Privé vigente, reconcilia con el servidor: quita lo retirado y actualiza lo corregido. Si una licencia se retira, la foto desaparece también de la copia.
- **Al cerrar sesión** se borran las copias por tres vías: `AuthContext`, el Service Worker (`iatos:clear-user-cache`) y la conservación entre versiones del SW.
- **Probado de verdad** con Playwright sobre el build de producción y su Service Worker, en `context.setOffline(true)`:
  - la copia se guardó (14 piezas, 11 fotos, 3.69 MB);
  - sin red: la app abrió, mostró el índice, abrió un artículo con todas sus fotos (`blob:`, `naturalWidth > 0`), las acciones estaban deshabilitadas y se veía la fecha de generación;
  - **al recargar sin red siguió funcionando**;
  - al volver la red avisó, y al cerrar sesión la caché quedó en 0 entradas.

  Capturas: `14-offline-portada__390.jpg`, `15-offline-articulo__390.jpg`, `16-offline-articulo-final__390.jpg`.
- **Límite honesto:** solo se probó Chromium (Playwright con viewport móvil emulado). **Safari/iOS no se probó**: allí el almacenamiento puede borrarse tras días sin uso. Queda PENDIENTE en un iPhone real.
- **Audio Edition:** fase posterior (lo dice la pantalla).

## 12. Pruebas y evidencia

| Suite | Resultado |
|---|---|
| `supabase/tests/edition/run.sh` (Postgres local, bases `edi_*`) | **47/47 OK**. Cubre: FREE y PRO sin Privé negados por API directa; sin lectura directa de tablas; borradores invisibles para miembros; panel solo para admins; imagen sin licencia, fuente rota, tema sensible con una fuente, breve viejo y enlace comercial falso bloqueados; contenido mínimo para publicar; publicar solo lo aprobado; corrección con nota; retiro; programación sin cron; World Brief sin vencidos; preferencias y guardados del dueño (RLS) con consentimiento; descargas propias; sesión vencida; borrado de cuenta que conserva la revista; migraciones idempotentes; toda `prive_edition_*` empieza con `prive_require`. |
| `supabase/tests/prive/run.sh` | **89/89 OK**. Agregué las 9 `prive_edition_*` a la lista explícita de P54. No es un comodín: E43 comprueba que cada una exige `prive_require`. |
| `supabase/tests/security/run.sh` | Sin fallas; idéntica a la rama base salvo rutas. |
| vitest nuevas | `priveEdition.test.ts` 47 · `priveEditionPdf.test.ts` 5 · `priveEditionUi.test.tsx` 11 = **63 OK** |
| vitest completo | **1557/1563**. Las 6 que fallan son tiempos límite de 5 s en archivos que no toqué y que pasan aisladas. Dos también vencen el límite de 5 s **en el commit base** con la máquina cargada por los otros equipos; con `--testTimeout=30000` pasan. |
| `tsc --noEmit -p tsconfig.app.json` | Limpio |
| `npm run build` | OK. Sin chunks circulares; jsPDF sigue en `vendor-pdf` perezoso; CSS y páginas de la edición en chunks aparte; **el contenido del número no está en el bundle**. |
| `deno check` de `edition-link-check` (Deno 2.1) | OK (`deno.lock` borrado) |
| Playwright `scripts/edition/e2e.mjs` (390 y 1440, datos simulados, nada a internet) | **44/44 OK**, incluido el modo avión real. Resultados en `docs/iatos/evidencia/edition/resultados.json`. |

**Cobertura de la §14 de la especificación:**

| Punto de la §14 | Dónde se prueba |
|---|---|
| Intereses, personalización, idioma | vitest |
| Fecha y procedencia | vitest + SQL E24 |
| Fuentes rotas | SQL E12 + vitest |
| Artículo no aprobado | SQL E06/E07/E22 + UI |
| Imagen sin licencia | SQL E11/E25 + vitest + PDF |
| Promoción vencida | vitest + UI |
| Beneficio no elegible | Lo filtra Drops en el servidor; aquí, estado y fuente |
| Enlace comercial falso | SQL E16 + generador |
| Revista sin contenido suficiente | SQL E20 + vitest |
| PDF multipágina con imágenes | vitest |
| Offline real, modo avión, cierre de sesión, recuperación de conexión | Playwright + vitest |
| Sesión Privé vencida | SQL E38 + vitest |
| FREE | SQL E01 + UI |
| Iato y From Page to Experience | vitest |
| Costos | §13 |
| Accesibilidad y rendimiento | Foco visible, alt, roles, sin scroll horizontal, chunks perezosos |

**Pendiente:** Safari/iOS real y Lighthouse.

## 13. Costos estimados y medidos

**Medidos:**
- JSON del número: 95 KB (26 KB gzip) por visita al número; las demás RPC pesan menos de 5 KB.
- PDF: se genera en el dispositivo; costo de servidor 0; 2.9 MB y unos 1.2 s.
- Copia offline: unos 3.7 MB por número, descargados al dispositivo desde el CDN de Pexels, sin egreso de IATOS.
- Siembra por número: unos 120 KB en la base.
- `edition-link-check`: 34 peticiones HEAD por corrida.

**Personalización:** 0 llamadas de IA por miembro. Se ordena la edición común en el navegador; no se regenera nada por miembro.

**Redacción asistida por número (estimado; los tokens de esta sesión no se pueden medir desde dentro):**
- Supuestos: unos 400k tokens de entrada de investigación y unos 30k de salida (es + en + JSON), con Claude Opus 5.5 a $4/$20 por MTok.
- Resultado: ≈ US$1.60 + US$0.60, más unas 25 búsquedas web, ≈ **US$2.5 por número**. Con dos rondas de revisión, menos de US$5.
- Con Sonnet 5.5 ($2/$10) sería la mitad; con Batch, otro 50 %.
- Es un costo **por número, no por miembro**: con 1,000 miembros resulta menos de US$0.005 por miembro al mes, frente a un PRO de $99 MXN.

**Egreso:** unos 0.3 MB al mes por miembro activo (≈ 0.3 GB/mes con 1,000 miembros). Las fotos las sirve Pexels.

**Conclusión:** la revista es viable con PRO a $99 MXN. El costo real es el tiempo humano del editor (lectura y aprobación de unas 16 piezas al mes, estimado en 2–3 h), no la IA.

## 14. GO / NO-GO

**GO técnico** para integrar la rama: código, pruebas y evidencia completos, sin regresiones atribuibles.

**NO-GO para publicar a miembros** hasta que pase todo esto:
1. Autorizar y aplicar en producción las 3 migraciones (§16) y desplegar `edition-link-check`.
2. El responsable editorial lee y aprueba cada pieza, firma, aprueba las 12 licencias en el panel, corre «Comprobar enlaces» y confirma los 2 datos marcados (Nobel en nobelprize.org, Omnibus de IA en EUR-Lex).
3. **La portada es urgente:** el GP es del 30 oct al 1 nov y la pieza vence el 2 nov.
   - Si el número se aprueba después del 2 de noviembre, la base bloqueará la portada por vencida. El editor tendría que reescribirla en pasado o elegir otra portada.
   - Para que sirva, debe aprobarse a más tardar el 28–29 de octubre.
4. Integrar PRIVÉ DROPS (privevalor). Hasta entonces, Privé Opportunities muestra un cero honesto.
5. Prueba en iPhone real del piloto offline (Safari).

## 15. Mejoras adicionales («GOD TIER»)

- **«Pregúntale a Iato» con texto escrito desde cualquier pantalla:** `Concierge.tsx` acepta `location.state.prefill` y lo pone en la caja, sin enviarlo. Sirve también a las acciones de prive-ux y privekey.
- **El Service Worker conserva las cachés de la edición** entre versiones y las borra al cerrar sesión, sin tocar la estrategia existente de viajes.
- **El shell de la app queda en caché antes de guardar una copia offline.** Antes, un primer arranque sin red podía quedar en blanco si los bundles no se habían pedido con el SW activo.
- **El P54 de Privé** ahora documenta explícitamente las RPC de la edición, y una prueba nueva (E43) es más estricta que la lista: exige que cada una empiece con `prive_require`.
- **Bug evitado:** dentro de `SECURITY DEFINER`, `current_user` es el dueño de la función. El chequeo de `service_role` se hace solo con el rol del JWT, para que nadie salte el control de admin.

## 16. Requiere autorización para producción

| Qué | Archivo |
|---|---|
| Migración: tablas, reglas, RLS | `supabase/migrations/20261025100000_edition_core.sql` |
| Migración: RPC de lectura y panel | `supabase/migrations/20261025100100_edition_rpc.sql` |
| Migración: siembra del Nº 01 en revisión | `supabase/migrations/20261025100200_edition_seed_n01.sql` |
| Edge function | `supabase/functions/edition-link-check/` (`verify_jwt` por omisión) |

## 17. Para el líder: integración con los otros equipos

- **Rutas en `App.tsx`:**
  - `/prive/edicion/*` como hijas de `/prive` (dentro de PriveRoot);
  - `/prive/edicion/sin-conexion` como ruta de primer nivel;
  - `/dashboard/admin/edicion` dentro de ProtectedRoute.
- **Ranura:** `<PrivateEditionTeaser destination? variant="for-you"|"insider" />` en `src/components/prive/edition/index.ts`. Sin número publicado no renderiza nada. prive-ux debe montarla en FOR YOU; privevalor, en INSIDER con `destination`.
- **Toques fuera de mi carpeta** (aditivos y mínimos):
  - `src/contexts/AuthContext.tsx`: una línea para borrar la caché de la edición al cerrar sesión;
  - `public/sw.js`;
  - `src/pages/Concierge.tsx`: el texto ya escrito para Iato;
  - `supabase/tests/prive/prive.sql`: la lista de P54.
- **privevalor:** la edición consume `prive_drops` tal como está en su migración. Si cambian la firma o la forma de `prive_drop_json`, hay que ajustar `Opportunity` y `createEditionApi().opportunities`.

## Riesgo residual

- Todo el texto lo redactó la IA a partir de fuentes leídas el 22-oct-2026. Una lectura humana completa es obligatoria; el panel lo exige y la base no publica nada sin aprobación.
- Las fotos se sirven desde el CDN de Pexels. Si Pexels retira una, la lectura la oculta (no hay hueco) y el editor debe reemplazarla.
- La lectura offline en Safari/iOS no está probada.
