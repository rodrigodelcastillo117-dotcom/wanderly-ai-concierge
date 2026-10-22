# IATOS — Personalización: que Iato use TUS viajes y lo que te encantó

> Pedido del dueño: "ASEGÚRATE QUE REALMENTE LA IA IATOS sí tome en cuenta TUS VIAJES para sugerirte cosas;
> si subes algo a mis mejores viajes, tenga eso prioridad de que fue lo que te gusta, para entenderte mejor."
> Y: "Evolución detectada" debe hablarle a la persona de tú, cálido, en español.

Rama `claude/wc-personal`. Fecha de la auditoría: 2026-10-22.

## 1. Auditoría: qué señales llegaban realmente a cada IA (antes de este cambio)

Leyenda: ✅ llega al prompt · ⚠️ llega parcial o mal · ❌ se ignora.

| Señal del usuario | Iato (`concierge-chat/index.ts` + `context.ts`) | Inicio / Descubrir (`recomendar-destinos`) | Restaurantes (`suggest-restaurants`) | Análisis de viaje (`analizar-viaje`) | Travel DNA (`evolucionar-dna`) |
|---|---|---|---|---|---|
| Viajes **vigentes** (futuros/en curso) | ✅ `viajes_usuario` + `viaje_en_contexto` | ⚠️ como "ya visitados" (un viaje planeado no es visitado) | ❌ | ❌ (solo el que se analiza) | ⚠️ mezclados con los pasados, sin distinguir |
| Viajes **pasados / completados** | ❌ se filtraban (`fecha_regreso >= hoy`) | ⚠️ solo el nombre de los 10 más recientes, para excluirlos | ❌ | ❌ | ⚠️ destino + total estimado, sin fechas, noches, hotel ni compañía |
| Viajes **importados** de documentos (`desde_pdf`, futuro `trips.source='documento'`) | ❌ (si ya pasaron) | ⚠️ igual que arriba | ❌ | ❌ | ⚠️ igual que arriba |
| Hotel elegido / clase / precio por noche pagado | ❌ | ❌ | ❌ | ❌ | ❌ |
| Duración típica y acompañantes reales | ❌ | ⚠️ solo lo declarado | ❌ | ❌ | ⚠️ `num_viajeros` suelto |
| Gastos reales (`expenses`) | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Mejores momentos** (`travel_moments`) | ❌ | ❌ | ❌ | ❌ | ❌ — y la tabla solo guardaba la foto y el **nombre del archivo** como "viaje" (`IMG_1234`) |
| Lugares visitados (`visited_places`, `user_visits`) | ❌ | ❌ | ❌ (`food_dna` existe pero nadie lo usa en IA) | ❌ | ❌ pedía `user_visits.rating`, columna que no existe: la consulta fallaba y siempre decía "Sin visitas registradas" |
| Favoritos (`recomendaciones.guardado`, `visited_places` favorito) | ❌ | ❌ | ❌ | ❌ | ⚠️ lista de títulos |
| Cocinas (`visited_places.cuisine`, `profiles.food_dna`) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Travel DNA (`perfil_ia.resumen`, `estilo_dominante`) | ✅ | ❌ | ❌ | ✅ | ✅ (se reescribe) |
| Perfil declarado (onboarding: ritmo, presupuesto, comida, intereses) | ✅ | ✅ | ⚠️ solo si el cliente manda `preferences` (TripDetail no lo manda) | ✅ | ✅ |
| Dislikes explícitos (alergias, `deal_breakers`, `perfil_ia.evitar`) | ✅ restricciones | ✅ | ❌ | ✅ restricciones | ✅ |
| Bóveda (tarjetas, lealtad) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Memoria de conversaciones | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ratings del usuario | ❌ no existen (el `rating` de `visited_places` es el de Google) | ❌ | ❌ | ❌ | ❌ (ver fila anterior) |
| Diario de viaje (`trip_journal_entries`) | ❌ | ❌ | ❌ | ❌ | ❌ (contenido compartido con el grupo; queda fuera a propósito) |

Hallazgos clave:

1. **Los viajes pasados no llegaban a Iato.** El chat filtra a viajes vigentes; lo que viajaste antes no existía para él.
2. **"Mejores momentos" no alimentaba ninguna IA** y además guardaba el nombre del archivo como nombre del viaje.
3. Las recomendaciones de Inicio trataban los viajes **futuros** como "ya visitados" y no citaban gustos reales.
4. `suggest-restaurants` (restaurantes de viajes importados) no personalizaba nada.
5. "Evolución detectada" se escribía en tercera persona ("Declaró 'equilibrado' pero sus viajes…").

## 2. Qué cambió

### Perfil de gustos compartido — `supabase/functions/_shared/tasteProfile.ts`

Un resumen determinista y compacto (≤ 600 tokens; ≤ 350 en el chat) de lo que a la persona le ha gustado **de verdad**:

| Señal | Peso | Notas |
|---|---|---|
| Foto en **Mejores momentos** | **10** | Su viaje (`trip_id`), destino, lugar, "¿qué te encantó?" y etiquetas que eligió; etiquetas de visión si no trae nada (lugar reconocido solo con confianza ≥ 0.75 y a la mitad de peso) |
| Favorito (destino guardado, lugar favorito) | 5 | |
| Visitado (`visited_places`, `user_visits`) | 3 | Cocinas, lugares, categorías, nivel de precio |
| Viaje pasado con evidencia (importado de documento, gastos, momentos o visitas) | 2 | Destino, mes/año, noches, viajeros, hotel elegido, precio por noche, gasto real |
| Viaje pasado solo cotizado | 1.2 | Se dice "lo cotizaste", nunca "viajaste" |
| Declarado (onboarding) | 1 | |

- Antigüedad: ×1.0 el primer año, −0.1 por año, mínimo ×0.6.
- "Evitar" (alergias, deal breakers, `perfil_ia.evitar`, notas "no me gustó") quita esos gustos de las listas.
- "Te encantó" solo para fotos destacadas y favoritos; el resto se presenta como viaje o visita.
- Privacidad: solo filas con `user_id` = la persona (los viajes compartidos de amigos y colaboradores se descartan aunque la consulta los traiga); todas las consultas filtran por `user_id`, también con la llave de servicio. Los textos se limpian (sin `< > { } \``) antes de ir a un prompt.
- Importados: cualquier viaje con fechas pasadas y `source` en `documento|import|pdf|…` (columna que agrega el otro grupo), o con vuelos/hoteles `desde_pdf`, cuenta como viaje hecho.

### Caché por persona — `_shared/tasteProfileStore.ts` + migración `20261024103000_personal_taste_profile.sql`

- Tabla `user_taste_profiles` (lectura propia por RLS, escritura solo del servidor).
- Triggers suben `rev` cuando cambia una señal: viajes (crear/borrar o fechas, destino, viajeros, hospedaje, selección, estado — no la portada ni cada guardado), momentos, visitas, favoritos, perfil declarado, preferencias (no `dna_signal`, que cambia en cada mensaje) y gastos. Los triggers solo actualizan filas existentes (borrar una cuenta no deja una fila nueva).
- El perfil guardado sirve mientras `computed_rev = rev`, la versión sea la actual y se haya calculado hoy (hora de la Ciudad de México, igual en todas las funciones). Con caché: **una lectura** por mensaje, en paralelo con las demás.
- Si hay que recalcular: en paralelo y con tope (700 ms en Iato, 800 ms en restaurantes, 1.5 s en el análisis); si tarda, se usa el anterior y el nuevo se guarda en segundo plano.

### Dónde se usa

| Función | Cómo |
|---|---|
| Iato (`concierge-chat`) | Bloque `<gustos_usuario>` (≤ 350 tokens, sin repetir lo declarado que ya va en `<perfil_usuario>`) en el mensaje de contexto; reglas "GUSTOS DEL USUARIO" en el sistema estable (en caché de prompt). Cita el porqué de tú ("Porque te encantó Mykonos…", "Como en tu viaje a Kioto…") solo con datos del bloque. Log `concierge_latency` registra `taste` (cache/computed/stale) y su tamaño. |
| Inicio y Descubrir (`recomendar-destinos`) | Gustos en el prompt; "reason" de tú citando el gusto real; ya visitados = viajes **pasados** + declarados; los futuros van como "ya planeados". La caché de 24 h se descarta si cambia la huella del perfil (`metadata.taste_hash`): subes un momento → nuevas recomendaciones. Si el límite de uso ya se alcanzó, se muestran las anteriores en vez de un error. |
| Restaurantes (`suggest-restaurants`) | Sin IA: reordena la lista real de Google por tus cocinas (visitas, favoritos, momentos) y antepone "Para ti: te gusta la cocina japonesa (4 visitas)." a su porqué; una restricción (vegano, sin gluten…) entra a la búsqueda; nunca agrega ni cambia restaurantes. |
| Análisis de viaje (`analizar-viaje`) | Gustos demostrados en el contexto del usuario; el "por_que" de hoteles, restaurantes y tours se apoya en ellos y respeta "Evitar". |
| Travel DNA (`evolucionar-dna`) | Recibe los gustos demostrados (momentos primero) y separa viajes hechos de planeados. |

### Mejores momentos con prioridad

- Al subir fotos se abre un diálogo corto: **¿De qué viaje es?** (tus viajes ya empezados, "Otro viaje" o "Prefiero no decir"), **¿Qué te encantó?** y chips (Playa, Gastronomía, Vida nocturna…). Los momentos viejos se pueden completar con el lápiz.
- Confirmación sutil: "Iato lo tomará en cuenta para tus próximas sugerencias."
- Nueva función `tag-moment`: etiquetas de visión (Gemini Flash, ≤ 200 tokens de salida, imagen reducida a 768 px cuando Storage lo permite), **una vez por foto** (caché en la fila), con tope diario por persona (`MOMENT_TAG_USER_DAILY_CAP`, 30) y total (`MOMENT_TAG_GLOBAL_DAILY_CAP`, 1000); solo lee archivos de la carpeta de la persona; no identifica personas. Después recalcula el perfil de inmediato. El cliente no puede escribir las etiquetas de visión (trigger) ni ligar un momento a un viaje ajeno (RLS).

### "Evolución detectada" de tú

- El prompt de `evolucionar-dna` (`evolucionar-dna/prompt.ts`) exige segunda persona, cálida, en español de México, con ejemplos ("Dices que prefieres un ritmo equilibrado, pero tus viajes son de ritmo intenso…") y marca el resultado `voz: "segunda_persona"`.
- Red de seguridad al guardar (`enforceSecondPerson`) y al mostrar (`dnaForDisplay`, `_shared/dnaVoice.ts`): los DNA guardados antes ("Declaró 'equilibrado' pero sus viajes…") se muestran como "En tu perfil elegiste 'equilibrado', pero tus viajes…", sin volver a llamar a la IA. Perfil (`Profile.tsx`) y el avatar del chat (`TravelerAvatar.tsx`).

### Mejoras adicionales

- `evolucionar-dna` pedía `user_visits.rating` (no existe): la consulta fallaba y el Travel DNA nunca veía tus visitas. Corregido.
- `evolucionar-dna` ya no devuelve al cliente el detalle del error del proveedor de IA (solo al log).
- `recomendar-destinos`: los viajes futuros ya no cuentan como "ya visitados"; "recientes" ahora son las recomendaciones anteriores (lo que dice el prompt), y con el límite de uso alcanzado se muestran las anteriores en vez de un error.
- Mejores momentos: ya no muestra el nombre del archivo ("IMG_1234") como nombre del viaje; botones con nombre accesible.

## 3. Despliegue

- Migración: `20261024103000_personal_taste_profile.sql` (idempotente; probada con `supabase/tests/security/run.sh` → `taste_profile.sql`, TP1–TP15).
- Funciones a redeplegar: `concierge-chat`, `recomendar-destinos`, `suggest-restaurants`, `analizar-viaje`, `evolucionar-dna` y la nueva `tag-moment`.
- Variables opcionales: `MOMENT_TAG_USER_DAILY_CAP`, `MOMENT_TAG_GLOBAL_DAILY_CAP`.
- Orden: migración → funciones → frontend. Sin la migración, las funciones siguen funcionando (respaldo en memoria por 60 s y sin escribir la caché).

## 4. Latencia y costo esperados

- **Iato:** +1 lectura por mensaje en paralelo con las que ya había (≈ 0 ms en el camino crítico con caché). Recalcular (solo cuando algo cambió o una vez al día): 8 consultas en paralelo, ≈ 40–120 ms, con tope de 700 ms. Entrada: +80 a 350 tokens (≈ +$0.00003 por mensaje en el modelo rápido; ≈ +$0.0007 en el capaz). El contexto compacto pasa de ≈ 1.7k a ≈ 1.9–2.0k tokens en el peor caso.
- **Inicio:** con caché igual que antes (+3 lecturas en paralelo, ≈ +20 ms). Se regenera cuando cambia el perfil de gustos (≈ $0.003 por regeneración con Gemini Flash); tras desplegar, solo se regeneran una vez las de quienes ya tienen señales.
- **Restaurantes:** sin costo de IA; +1 lectura (en paralelo con Google si llega una preferencia explícita).
- **tag-moment:** ≈ $0.001–0.002 por foto (una vez); tope ≈ $0.06 por persona al día y ≈ $2 al día en total con los valores por defecto. Registrado en `ai_usage_log` (`function = 'tag-moment'`).

## 5. Pruebas

- `src/test/tasteProfile.test.ts`: pesos (momentos > favoritos > visitados > viajes > declarado), antigüedad, evitar, importados, hotel elegido vs cotizado, gastos reales, nombres de archivo, visión, huella, privacidad (filas ajenas y filtros por `user_id`), tope de 600/350 tokens, caché (fresca, rev, timeout, sin tabla), que cada función reciba el perfil, voz en segunda persona y `tag-moment` (ruta propia, topes, vocabulario).
- `src/test/bestMoments.test.tsx`: subir con viaje y "qué te encantó", etiquetado en el servidor, confirmación de Iato, completar un momento viejo.
- SQL: `supabase/tests/security/taste_profile.sql` (RLS de momentos y caché, etiquetas solo del servidor, qué invalida y qué no).
