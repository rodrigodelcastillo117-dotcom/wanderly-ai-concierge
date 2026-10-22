# THE PRIVATE EDITION · Nº 01 (Noviembre 2026): qué aprobar y cómo

Revisión hecha el **22 de octubre de 2026** sobre `data/prive/edition/issue-01.json` y la siembra que ya está en producción (`20261025100200`). Equipo: edition.

**Nada se aprobó ni se publicó.** Aprobar y publicar es decisión del editor, y se hace en el panel.

---

## 0. Lo urgente, en cuatro líneas

1. **La portada vence el 2 de noviembre.** La pieza de portada es «La ciudad acelera» (Gran Premio, del 30 de octubre al 1 de noviembre).
   - Si se aprueba después del 2 de noviembre, la base la bloquea por vencida (`expired`).
   - **Fecha límite: apruébala el jueves 29 de octubre y publica el número ese mismo día.** Así los miembros la leen antes del fin de semana del GP.
2. **Antes de aprobar la carta, aplica la migración `20261025110000_edition2_status_correcciones.sql`** (requiere tu autorización).
   - Esa migración quita la palabra «borrador» de la firma de la carta. Si apruebas la carta sin ella, se publica con «borrador pendiente de firma».
   - Esa migración también agrega `prive_edition_status`, que hace que FOR YOU diga «primer número en revisión editorial».
3. **Una sola pieza necesita que confirmes un dato a mano antes de aprobarla:** «Bruselas mueve el reloj de la IA de alto riesgo». Las fechas deben verificarse en EUR-Lex.
   - Si no puedes confirmarlas, no la apruebes. El número se puede publicar sin ella.
4. **Hay fotos y fuentes que no puedes revisar con un robot.** Las páginas de Pexels, michelin.com y miamilivingmagazine.com bloquean robots (403/429). Ábrelas tú en el navegador; está explicado abajo.

---

## 1. Comparación: JSON contra producción

| | `issue-01.json` | Siembra (`20261025100200`) | Producción (verificado por el líder) |
|---|---|---|---|
| Número | 1 (`n01-noviembre-2026`), `pending_review` | igual | 1 en `pending_review` |
| Artículos | 16 | 16 (`pending_review`) | 16 en `pending_review` |
| Fuentes | 34 | 34 (48 vínculos artículo-fuente) | 34 |
| Imágenes | 12, todas Pexels | 12 (`license_status = pending`) | 12 en `pending` |

- **La siembra es idéntica al JSON original.** La prueba `src/test/priveEdition.test.ts` lo demuestra:
  1. reconstruye el JSON tal como era antes de las correcciones;
  2. genera el SQL con `scripts/edition/build-seed.mjs`;
  3. lo compara byte a byte con la migración congelada (sha256 `2f5fedf1…202d`).
- **Las tres correcciones de contenido** están en el JSON, en `_corrections`, y en la migración nueva `20261025110000`, que es idempotente y solo toca filas que nadie ha revisado:

| # | Dónde | Antes | Después | Por qué |
|---|---|---|---|---|
| 1 | Carta del editor, firma (`byline`) | «Dirección editorial de IATOS Privé · borrador pendiente de firma» | «Dirección editorial de IATOS Privé» | Publicada con la palabra «borrador» sería falsa. Tu crédito sale de la firma que escribes al aprobar (`approved_by_label`). |
| 2 | Fuente `nobel_econ_2026`, nota de verificación | «La página oficial respondió 403…» | «Página oficial leída el 22-oct-2026: «for microeconomic foundations of macroeconomic stabilisation», Robert E. Hall y Michael Woodford…» | La página oficial ya responde 200 y confirma la motivación. El dato deja de estar pendiente. |
| 3 | Explicador de Banxico, fuentes | El párrafo del Nobel citaba solo agencias (AAP, APA/Reuters) | Además se vincula `nobel_econ_2026` como fuente primaria (el texto no cambia) | Si hay fuente primaria verificada, va en la lista de fuentes. |

- **Prueba SQL E45c:** las tres correcciones se aplican una sola vez (versión 2 de la carta, una sola fila en la bitácora, el vínculo de la fuente), y volver a correr la migración no las repite.

---

## 2. Enlaces: comprobación HTTP de solo lectura (22-oct-2026)

- **Fuentes (34):** 32 responden **200**. Las otras dos bloquean robots, no están rotas:
  - **michelin.com** responde 403;
  - **miamilivingmagazine.com** responde 429.

  La función `edition-link-check` del panel las marca como «bloqueado». Es un **aviso**, no un bloqueo, porque un 403/429 a un robot no prueba que la página no exista.

  **Ábrelas tú en el navegador:**
  - `michelin_keys_2026` → https://www.michelin.com/en/publications/products-and-services/michelin-guide-2026-michelin-key-selection
  - `miamiliving_ab` → https://www.miamilivingmagazine.com/post/art-basel-miami-beach-2026-ultimate-guide
- **Fotos (12):** las 12 URL del CDN (`images.pexels.com`) responden **200**. Las 12 páginas de Pexels (`www.pexels.com/photo/…`) responden 403 a robots, así que hay que abrirlas a mano para ver al autor y la licencia (paso 3 del §5).

---

## 3. Pieza por pieza

**Columnas:**
- **Vence:** el campo `valid_until`. Después de esa fecha, la pieza:
  - sale del World Brief;
  - en la revista lleva el aviso «Información vigente hasta…»;
  - ya no se puede aprobar.
- **Hecho:** el campo `fact_date`.
- **Fuentes:** el estado HTTP del 22-oct.
- **Recomendación:**
  - **APROBAR:** se puede aprobar tal cual después de leerla;
  - **CORREGIR:** hay que tocar algo antes de aprobarla;
  - **RETENER:** no aprobar hasta confirmar el dato;
  - **RETIRAR:** quitarla del número.

| # | Pieza (tipo / sección) | Hecho → vence | Fuentes (estado) | Datos que confirmar a mano | Foto (licencia) | Recomendación |
|---|---|---|---|---|---|---|
| 1 | **Una revista que se puede comprobar** (carta / carta) | — → sin vencimiento | Sin fuentes (texto editorial) | Que el texto te represente; tú lo firmas al aprobar. | — | **APROBAR**, después de aplicar la migración `20261025110000` (firma sin «borrador»). |
| 2 | **La ciudad acelera** (reportaje / **portada**) | 22-oct → **2-nov** | `f1_calendar_2026` 200 · `f1_mexico_2026` 200 · `mercedes_altitud` 200 · `mexicogp_como_llegar` 200 · `mexicogp_home` 200 · `expansion_desfile` 200 · `porEsto_desfile` 200 | 1) Los horarios del fin de semana en hora del centro (UTC−6): la conversión es de la redacción. Revísalos en formula1.com la semana de la carrera.<br>2) El desfile, sábado 31-oct a las 14:00 (CDMX).<br>3) Los camiones gratuitos de 7:00 a 20:00 (guía del promotor). | `img_cdmx_angel_noche` (portada) · `img_f1_circuito` · `img_desfile_muertos`. Las tres son Pexels e ilustrativas. | **APROBAR YA** (vence el 2-nov). |
| 3 | **El sureste entra al mapa** (reportaje / reportajes) | 18-sep → sin vencimiento | `adn40_ceremonia` 200 · `elrestaurante_michelin` 200 · `rivieramaya_michelin` 200 · `michelin_keys_2026` **403 (bloqueo a robots)** · `outlook_keys` 200 | 1) Abre michelin.com a mano y confirma la selección de Llaves 2026.<br>2) El texto **no** publica totales nacionales de estrellas porque los medios difieren; consérvalo así. | `img_merida_catedral` (no ilustrativa: es el lugar) · `img_chile_nogada` (ilustrativa) | **APROBAR**, después de abrir michelin.com. |
| 4 | **Port Hercule, en septiembre** (reportaje / reportajes) | 23-sep → sin vencimiento | `mys_oficial` 200 · `yachtbuyer_mys` 200 · `monacolife_mys` 200 | Es una pieza retrospectiva del Yacht Show de septiembre; cuida que no se lea como un evento por venir. | `img_monaco_puerto` (el lugar) · `img_yate_mar` (ilustrativa) | **APROBAR** |
| 5 | **Ginebra ya marcó la hora** (breve / agenda) | 23-jun → 11-abr-2027 | `ww_oficial` 200 · `sjx_ww2027` 200 | Las fechas de Watches and Wonders 2027 (5–11 abr) en el sitio oficial. | `img_reloj` (ilustrativa, sin marca) | **APROBAR** |
| 6 | **Diciembre en Miami Beach** (breve / agenda) | 16-oct → 6-dic | `artbasel_mb` 200 · `miamiliving_ab` **429 (bloqueo a robots)** | 1) Abre miamilivingmagazine.com a mano.<br>2) Su fecha de publicación es aproximada («hace 6 días»).<br>3) Los días públicos (4–6 dic) están en artbasel.com. | `img_miami_ocean_drive` (ilustrativa) | **APROBAR**, después de abrir la fuente. |
| 7 | **El PGA Tour vuelve a Los Cabos** (breve / agenda) | 22-oct → 8-nov | `pgatour_wwt` 200 | Fechas del torneo, 5 al 8 de noviembre. Hay una sola fuente: es la oficial del organizador, y la pieza no es sensible. | `img_cabo_costa` (el lugar) · `img_golf` (ilustrativa) | **APROBAR** |
| 8 | **La tasa en 6.50%: cómo leer la pausa** (explicador / explicadores, **sensible**) | 24-sep → **5-nov** | `banxico_anuncios` 200 · `bbva_agenda_2026` 200 · `aap_nobel` 200 · `apa_nobel` 200 · `nobel_econ_2026` 200 (agregada por la corrección 3) | 1) La tasa sigue en 6.50% el día que publiques.<br>2) El próximo anuncio, jueves 5-nov a las 13:00. | — | **APROBAR**. **Vence el 5-nov:** ese día hay que actualizarla o dejarla vencer. |
| 9 | **Bruselas mueve el reloj de la IA de alto riesgo** (explicador / explicadores) | 27-jul → sin vencimiento | `klgates_omnibus` 200 · `sidley_omnibus` 200 | **Confirma en EUR-Lex** las fechas del Omnibus digital sobre IA (publicación en el Diario Oficial y entrada en vigor). EUR-Lex respondió a nuestro robot con una página de verificación (202) y no se pudo leer. | — | **RETENER** hasta confirmarlo en EUR-Lex; si se confirma, APROBAR. |
| 10 | **Nobel de Economía para Robert E. Hall y Michael Woodford** (breve / World Brief) | 12-oct → 31-dic | `nobel_econ_2026` 200 (motivación confirmada en la página oficial) · `aap_nobel` 200 · `apa_nobel` 200 | Ninguno: ya está confirmado en nobelprize.org (corrección 2). | — | **APROBAR** |
| 11 | **LVMH crece 1% orgánico en el tercer trimestre; China pesa en la moda** (breve / World Brief) | 12-oct → 31-ene-2027 | `lvmh_q3_2026` 200 · `fashionunited_lvmh` 200 | El +1% orgánico está en el comunicado de LVMH. La fecha de FashionUnited se infirió de su URL. | — | **APROBAR** |
| 12 | **México recibió 7.99 millones de viajeros internacionales en agosto** (breve / World Brief) | 14-oct → **12-nov** | `inegi_evi_ago2026` 200 (PDF oficial) · `cronica_inegi` 200 | La cifra de 7.99 millones está en el boletín del INEGI. | — | **APROBAR**. Vence el 12-nov, cuando el INEGI publica septiembre. |
| 13 | **Banxico mantiene su tasa en 6.50% por tercera reunión** (breve / World Brief, sensible) | 24-sep → **5-nov** | `banxico_anuncios` 200 · `bbva_agenda_2026` 200 | Igual que la pieza 8. | — | **APROBAR**. Vence el 5-nov. |
| 14 | **Un tribunal de EE. UU. mantiene viva la alianza Delta–Aeroméxico** (breve / World Brief) | 21-ago → 31-dic | `delta_jv` 200 (comunicado de una de las partes; se presenta como tal) · `insideflyer_jv` 200 | El hecho cumple **90 días el 19 de noviembre**. Después de esa fecha la base ya no deja aprobarlo («historia presentada como nueva»), y una vez publicado seguiría visible hasta el 31-dic. | — | **CORREGIR su vigencia a `2026-11-19`** (campo «Vigente hasta» en «Revisión»; nuevo en esta tanda) y **APROBAR** antes del 19-nov. |
| 15 | **Desfile de Día de Muertos: sábado 31 de octubre, 14:00** (breve / World Brief) | 14-oct → **31-oct** | `expansion_desfile` 200 · `porEsto_desfile` 200 | La hora y la ruta (Reforma, Diana Cazadora → 5 de Mayo → Zócalo). | — | **APROBAR YA**. Vence el 31-oct; después sale solo del World Brief. |
| 16 | **Fechas para apartar** (agenda / agenda) | 22-oct → sin vencimiento | `f1_calendar_2026`, `expansion_desfile`, `pgatour_wwt`, `bbva_agenda_2026`, `inegi_evi_ago2026`, `artbasel_mb`, `md_tianguis2027`, `ww_oficial`, `mys_oficial`: todas 200 | Cada fecha sale de su fuente. **Mejora hecha:** las fechas que ya pasaron se ocultan solas en línea, sin conexión y en el PDF (prueba «agenda»). | — | **APROBAR** |

**Resumen:**
- 13 se pueden aprobar tal cual después de leerlas (una, la de Banxico, ya con la fuente primaria que agrega la migración).
- 1 se aprueba después de aplicar la migración (la carta).
- 1 necesita corregir su vigencia (Delta–Aeroméxico).
- 1 se retiene hasta confirmar en EUR-Lex.
- Ninguna hay que retirarla.

**Lo que la base hace cumplir sola** (no se puede saltar desde el panel):
- foto sin licencia aprobada → no se aprueba;
- fuente rota → no se aprueba;
- pieza sensible con una sola fuente → no se aprueba;
- breve con un hecho de más de 90 días → no se aprueba;
- pieza vencida → no se aprueba;
- enlace «oficial» a un dominio que no es fuente → no se aprueba;
- número sin portada aprobada o con menos de 4 piezas → no se aprueba.

---

## 4. Foto por foto

**Las 12 son Pexels License** (https://www.pexels.com/license/). En términos generales, la licencia:
- **permite** usarlas gratis, modificarlas y usarlas sin atribución (nosotros atribuimos igual);
- **no permite** venderlas sin modificar, insinuar que una persona o marca respalda algo, ni redistribuirlas como fotos sueltas en otro banco de imágenes.

**PDF y sin conexión:** incluirlas dentro de la revista, en el PDF personal del miembro o en su copia sin conexión es uso de la foto dentro de una obra, no redistribución de la foto suelta. Por eso `allow_pdf` y `allow_offline` están en «sí».

**Fotos ilustrativas:** la revista las rotula como «Foto ilustrativa» y dice qué muestran y qué no.

| Clave | Autor | Licencia | URL (CDN, 200) | Página Pexels | ¿PDF? | ¿Sin conexión? | Ilustrativa | Notas para aprobar |
|---|---|---|---|---|---|---|---|---|
| `img_cdmx_angel_noche` (**portada**) | Israyosoy S. | Pexels License | https://images.pexels.com/photos/36642849/pexels-photo-36642849.jpeg | 403 a robots: ábrela a mano | sí | sí | sí | El Ángel de noche; fecha de la toma no indicada. |
| `img_f1_circuito` | Jenda Kubeš | Pexels License | https://images.pexels.com/photos/14079604/pexels-photo-14079604.jpeg | ídem | sí | sí | sí | **Se ven marcas en el auto.** Va rotulada como ilustrativa y sin respaldo de ningún equipo; la licencia no da derechos sobre las marcas. Si prefieres no arriesgar, bloquéala: la pieza queda con dos fotos. |
| `img_desfile_muertos` | Mike The Fabrica | Pexels License | https://images.pexels.com/photos/29560099/pexels-photo-29560099.jpeg | ídem | sí | sí | sí | **Persona identificable** (Catrina) en un evento público, en un uso editorial respetuoso. Es de una edición anterior y así se dice. |
| `img_merida_catedral` | Edgar Rodrigo | Pexels License | https://images.pexels.com/photos/13688731/pexels-photo-13688731.jpeg | ídem | sí | sí | no | Es el lugar nombrado. |
| `img_chile_nogada` | Luis Merlos Vega | Pexels License | https://images.pexels.com/photos/27989311/pexels-photo-27989311.jpeg | ídem | sí | sí | sí | No es un platillo de los restaurantes mencionados; así se dice. |
| `img_monaco_puerto` | Reece t | Pexels License | https://images.pexels.com/photos/32992932/pexels-photo-32992932.jpeg | ídem | sí | sí | no | Port Hercule; no necesariamente durante el Yacht Show. |
| `img_yate_mar` | Oriana Polito | Pexels License | https://images.pexels.com/photos/9408818/pexels-photo-9408818.jpeg | ídem | sí | sí | sí | No es ninguno de los yates mencionados. |
| `img_reloj` | Mat Brown | Pexels License | https://images.pexels.com/photos/1034065/pexels-photo-1034065.jpeg | ídem | sí | sí | sí | Marca no identificada; no representa a ningún expositor. |
| `img_miami_ocean_drive` | Luis Erives | Pexels License | https://images.pexels.com/photos/11457815/pexels-photo-11457815.jpeg | ídem | sí | sí | sí | No es la sede de Art Basel. |
| `img_golf` | Kindel Media | Pexels License | https://images.pexels.com/photos/6573665/pexels-photo-6573665.jpeg | ídem | sí | sí | sí | No es El Cardonal at Diamante. |
| `img_cabo_costa` | Israel Torres | Pexels License | https://images.pexels.com/photos/17415445/pexels-photo-17415445.jpeg | ídem | sí | sí | no | Cabo San Lucas. |
| `img_ala_avion` | Anastasiya Vragova | Pexels License | https://images.pexels.com/photos/6791741/pexels-photo-6791741.jpeg | ídem | sí | sí | sí | Portada de la Flight Edition; aerolínea no identificada. |

---

## 5. Pasos exactos en `/dashboard/admin/edicion`

Entra con una de tus dos cuentas de administrador (las dos están en `public.admins`). Un no administrador ve «Solo el equipo editorial…».

0. **Antes de empezar:** autoriza y aplica `supabase/migrations/20261025110000_edition2_status_correcciones.sql`.
   - Sin ella, la carta se aprobaría con «borrador» en la firma.
   - Sin ella, FOR YOU muestra «El primer número está en preparación editorial» (la sección funciona igual, con la biblioteca).
1. **Pestaña «Fuentes» → «Comprobar enlaces».**
   - Espera: 32 en «ok» y 2 en «bloqueado» (michelin.com y miamilivingmagazine.com). «Bloqueado» es un aviso.
   - Abre esas dos a mano en el navegador.
   - Si alguna sale **rota** (404 o 410), el panel bloqueará las piezas que la usan.
2. **Pestaña «Imágenes y licencias».** Para cada una de las 12 fotos:
   1. haz clic en «página» y confirma en Pexels el autor y que dice «Free to use»;
   2. haz clic en **«Aprobar licencia»**. El botón desaparece cuando queda aprobada.
   - Para no usar una foto, haz clic en «Bloquear» y escribe el motivo. La foto desaparece de la pieza sin dejar hueco.
3. **Pestaña «Revisión».** Empieza por la portada («La ciudad acelera»). Para cada pieza:
   1. haz clic en la pieza de la lista; lee el texto, las fuentes y los bloqueos (en rojo) y avisos (en ámbar);
   2. si hay que corregir algo, edítalo en el editor (es/en) y guarda;
   3. haz clic en **«Aprobar»** y escribe tu firma para el crédito público, por ejemplo «Rodrigo del Castillo, director editorial».
   - **Delta–Aeroméxico:** antes de aprobarla, cambia «Vigente hasta» a `2026-11-19` y guarda.
   - **IA de alto riesgo:** no la apruebes hasta confirmarla en EUR-Lex. El número se publica igual sin ella.
4. **Pestaña «Vista previa (demo)».** Lee el número completo tal como lo verá el miembro.
   - La franja dice «VISTA PREVIA · MODO DEMOSTRACIÓN · NO PUBLICADO».
   - Las fotos o piezas pendientes salen marcadas.
5. **Pestaña «Número».** Las comprobaciones deben estar en verde.
   1. Haz clic en **«Aprobar número»** y escribe tu firma.
   2. Haz clic en **«Publicar ahora»**, o en «Programar» para una fecha y hora de la Ciudad de México.
   - **Hazlo a más tardar el jueves 29 de octubre.**
6. **Comprueba como miembro** (con una cuenta Privé):
   - **`/prive` (FOR YOU):**
     - la sección THE PRIVATE EDITION muestra la portada del Nº 01, «Mi edición personalizada» con tres piezas, y los accesos **Leer revista · Elegir intereses · Descargar para un vuelo · Biblioteca**;
     - en la cabecera aparece **«Revista»**.
   - **`/prive/insider/cdmx`:** al final aparece «Del número de este mes, sobre este destino», con «La ciudad acelera».
   - **`/prive/edicion/vuelo`:** el próximo viaje viene elegido, aparece la guía práctica con fuentes y están los dos botones (PDF y sin internet).
7. **Si algo sale mal después de publicar:**
   - para corregir, ve a «Revisión» → editar. La corrección lleva una nota pública obligatoria y fechada.
   - para retirar, usa «Retirar» con una nota pública. El lector ve solo el aviso, y las copias sin conexión lo quitan al volver la red.

**Esto mismo se probó de punta a punta en local:**
- Postgres con todas las migraciones y la siembra, y la UI real del panel (`scripts/edition/e2e-real.mjs`):
  - 12 licencias aprobadas con clics;
  - 16 piezas aprobadas;
  - número aprobado y publicado;
  - el miembro ve la portada en FOR YOU, y todos los accesos funcionan.
- Evidencia: `docs/iatos/evidencia/edition2/03-…05-panel-*.jpg` y `06-foryou-revista-publicada__*.jpg`.

---

## 6. La portada que vence el 2 de noviembre

- **Qué pasa en cada fecha:**

| Fecha | Qué pasa |
|---|---|
| Hasta el 2-nov | La portada se puede aprobar. Fecha recomendada para aprobar y publicar: 29-oct, antes del fin de semana del GP. |
| Desde el 3-nov, si no se aprobó | La base bloquea la portada por vencida. El número no se puede aprobar (`cover_article_not_approved`) hasta tener otra portada, y el panel **no** tiene un botón para cambiar la portada de un número. |
| Desde el 3-nov, si ya se publicó | La pieza sigue en el índice con el aviso «Información vigente hasta el 2 de noviembre de 2026». **Mejora hecha:** la portada la toma sola el siguiente reportaje vigente con foto («El sureste entra al mapa», foto de la Catedral de Mérida). Nunca queda una portada vencida (prueba «portada que vence»). |

- **Plan B, si no llegas al 2-nov:** con una migración puntual que yo preparo, el número toma otra portada (Mérida); o la pieza del GP se reescribe en pasado. **Las dos opciones requieren tu autorización.**

---

## 7. Lo que NO hice (y por qué)

- **No aprobé ni publiqué nada** (está prohibido; es tu decisión).
- **No apliqué migraciones en producción.** La nueva es `20261025110000` y está pendiente de tu autorización.
- **No escribí a nadie ni toqué Lovable.**
- **No cambié textos que no fueran errores.** La vigencia de Delta–Aeroméxico la decides tú en el panel, que deja constancia en la bitácora.
