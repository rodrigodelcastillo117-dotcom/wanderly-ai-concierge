# Avatar que se parece y evoluciona · Viajes pasados desde documentos

Grupo avatar-viajes, rama `claude/wc-avatar`. Qué cambió, por qué, cómo desplegarlo y qué hay que
revisar en vivo después de desplegarlo (desde aquí no se pudo llamar a la IA real).

## 1. Por qué el avatar no se parecía (causa raíz)

1. **El botón «Re-generar» de la tarjeta del Travel DNA no mandaba la selfie.** Llamaba a
   `generate-avatar` solo con estilo y destino, el modelo inventaba a «a single androgynous luxury
   traveler» y esa imagen pasaba a ser tu avatar. Cualquier «evolución» borraba tu cara.
2. **El prompt pedía cuerpo completo, de pies a cabeza, en 3:4.** La cara ocupaba cerca del 8 % de
   la imagen: el modelo no tenía píxeles para conservar los rasgos.
3. **«Caricatura», «ojos expresivos estilizados» y el outfit/escenario del último viaje** competían
   con la identidad. Nada pedía conservar lentes, barba, tono de piel, entradas o edad.
4. **La selfie se mandaba tal cual** (hasta 8 MB, a veces de lado por la orientación EXIF), una sola
   vez, con `google/gemini-2.5-flash-image` (Google lo anunció como retirado el 2-oct-2026) y sin
   verificar el parecido.
5. **El avatar vivía en dos lugares.** `generate-avatar` lo guardaba en
   `ai_user_preferences.perfil_ia.avatar_url`; el encabezado del perfil y Social leían
   `profiles.avatar_url`. Por eso el dueño veía la «R» arriba y su avatar abajo. Además
   `evolucionar-dna` reescribía `perfil_ia` completo y borraba el avatar de ahí.

## 2. Qué se hizo

**Parecido.** Hasta 3 fotos, orientadas y reducidas a 1024 px en el navegador. El prompt fija qué
conservar (forma de cara, tono de piel, pelo y entradas, ojos y cejas, barba, lentes, edad), sin
caricatura, en retrato cuadrado de cabeza y hombros. Modelo `google/gemini-3-pro-image-preview` con
respaldo a `gemini-3.1-flash-image-preview` y a `gemini-2.5-flash-image` (lista configurable en
`AVATAR_IMAGE_MODELS`). Un juez de visión (`gemini-flash-latest`) compara selfie y avatar con una
calificación de 0 a 100. Por debajo de 72 se reintenta **una** vez, con las diferencias que encontró
el juez. Se ofrecen **2 versiones** para elegir y la calificación queda guardada.

**Privacidad.** La selfie no se guarda en ningún lado: viaja en la petición y se descarta. Las
variantes viven en el bucket privado `avatar-private` y la app las ve con enlaces firmados de
15 minutos. Las que no eliges se borran. La imagen base (sin recuerdos) también es privada. Solo el
avatar elegido se publica en `travel-moments/avatars/{uid}/…`, que Social necesita para mostrarlo.
Al borrar la cuenta se borra todo (prueba DEL1/DEL2).

**Una sola fuente.** `profiles.avatar_url` es la fuente única: el servidor la escribe al elegir o al
evolucionar. La migración rescata los avatares que solo estaban en `perfil_ia`. El perfil, el menú,
la barra móvil y la tarjeta del DNA usan `useMyAvatar()` y el componente circular `AvatarCircle`. El
sello dorado `PriveSeal` aparece solo con membresía Privé activa y vigente (`prive_status()`).

**Evolución.** Cada viaje que termina, o que importas ya pasado, gana un recuerdo del destino:
CDMX → pin del Ángel, Nueva York → llavero de taxi amarillo, París → pin de la Torre Eiffel,
Tokio → omamori, y así. El catálogo tiene 88 ciudades y 71 países con respaldo por colores de
bandera; está en `supabase/functions/_shared/souvenirs.ts`. Nada va en la cabeza ni en la cara.
Máximo 3 recuerdos visibles; los demás quedan en la colección. La imagen nueva siempre se edita a
partir de la base privada, así que la cara no se degrada. Si el juez dice que la persona cambió, no
se publica. Es idempotente por viaje (`avatar_claim_trip`). Llega un aviso: «Tu avatar ganó un
detalle de Roma». En el perfil aparece la línea de «Evolución».

**Viajes pasados.** En `/dashboard/viajes/importar` subes PDF o capturas (hasta 8). `parse-trip-file`
ahora valida campo por campo (IATOS-064, también `parsear-viaje`). Una vista previa editable muestra
los precios **solo del documento**, en su moneda («Pagado (de tu documento)»). Si un precio no
aparece, queda vacío y se dice. `import_past_trip()` guarda con `fuente='documento'`,
`realizado`, `pagado_total` y `pagado_moneda`, y `status='listo'`, compatible con
`trips_status_chk`. No duplica el mismo PNR, número de vuelo con fecha o confirmación de hotel. Los
archivos quedan en privado en `trip-documents`. Después se pide el recuerdo del avatar y se
recalcula el Travel DNA.

**Travel DNA.** Etiquetas en español. Las barras salen de los viajes hechos (3 puntos), los
planeados (1), los lugares visitados y las preferencias. Una barra sin datos dice «Sin datos aún» y,
si no hay nada, «Aún no hay datos», con un camino para llenarlo.

## 3. Qué desplegar (no se aplicó nada en producción)

1. Migraciones, en orden:
   - `20261024200000_avatar_evolution.sql`
   - `20261024200100_trip_import_documents.sql`
2. Funciones:
   - `generate-avatar` (reescrita)
   - `avatar-evolve` (nueva; `verify_jwt = false` en `config.toml` porque valida sesión o secreto)
   - `parse-trip-file`
   - `parsear-viaje`
   - `evolucionar-dna`
3. Tarea diaria: `docs/iatos/avatar/programar-avatar-evolucion.sql`, en el editor SQL.
4. Opcional: `AVATAR_IMAGE_MODELS`, `AVATAR_DAILY_IMAGES` (8 por omisión) y
   `AVATAR_DAILY_EVOLUTION_IMAGES` (4 por omisión).

## 4. Revisar en vivo después de desplegar

- [ ] Que el gateway de Lovable acepte `google/gemini-3-pro-image-preview` con `modalities
  ["image","text"]` y regrese `message.images[0].image_url.url`. Si no, revisa en los logs qué
  modelo respondió (ai_usage_log.model) y ajusta `AVATAR_IMAGE_MODELS`.
- [ ] Que el juez (`gemini-flash-latest`) acepte 2 imágenes y responda JSON `{score, diferencias}`.
- [ ] Crear el avatar con la selfie del dueño. Las 2 versiones deben parecerse y la calificación debe
  ser 72 o más. Que el encabezado, el menú y Social muestren la misma imagen.
- [ ] Que la migración haya rescatado el avatar del dueño: `profiles.avatar_url` ya no debe ser null.
- [ ] Importar un boleto real y una reserva de hotel. Precios iguales al documento y en su moneda;
  marcado como pasado; volver a subirlos debe decir «ya está en Mis viajes».
- [ ] Que llegue el aviso «Tu avatar ganó un detalle de …» y que la cara no cambie en la edición.
- [ ] Que la tarea diaria corra (`cron_health`) y que `avatar-evolve` responda 401 sin secreto.
- [ ] Borrar una cuenta de prueba y confirmar que desaparecen `avatar-private/{uid}/…` y
  `travel-moments/avatars/{uid}/…`.

## 5. Costo por avatar (estimado con precios públicos; la factura manda)

| Acción | Imágenes | USD aprox. |
|---|---|---|
| Crear (2 versiones, sin reintento) | 2 × 0.134 + juez 2 × ~0.002 | **~0.27** |
| Crear, peor caso (2 reintentos) | 4 × 0.134 + juez 4 × ~0.002 | ~0.54 |
| Evolución por viaje | 1 × 0.134 + juez ~0.002 (peor caso 2 imágenes: ~0.27) | **~0.14** |
| Respaldo `gemini-2.5-flash-image` | 0.039 por imagen | ~0.08 al crear |

Topes por persona cada 24 h: 8 imágenes al crear (unos USD 1.07) y 4 de evolución (USD 0.54),
además del rate limit por minuto y por hora. Cada llamada queda en `ai_usage_log` con su costo
estimado.
