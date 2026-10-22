# IATOS Privé · Estándar de curaduría (Curation Standard)

> Parte de la serie Privé (antes `IATOS_PRIVE_CALIDAD_FUENTES.md`). Campos y CHECK: [Modelo de datos §3](IATOS_PRIVE_MODELO_DE_DATOS.md#3-experiencias). Destinos: [Destinos globales](IATOS_PRIVE_GLOBAL_DESTINATIONS.md). Planificador: [Experience Planner](IATOS_PRIVE_EXPERIENCE_PLANNER.md). Pruebas: [Matriz de pruebas](IATOS_PRIVE_TEST_MATRIX.md).
> Estado: construido en la rama `claude/wc-prive-catalog` y probado en una réplica local. **Nada está aplicado en producción.**

## Resumen para fundadores

- **Si un dato no tiene fuente, no se publica.** Y ahora no es una promesa del equipo: la base de datos lo impide (reglas CHECK y disparadores). Un precio sin URL, un horario sin URL, un casino sin autoridad que lo autorice o una aventura sin requisitos de seguridad **no se pueden guardar como publicables**.
- **Cinco estados de confianza más uno calculado:** VERIFICADO, CURADO, ESTIMADO, PENDIENTE, NO DISPONIBLE y **DESACTUALIZADO**, que se pone solo a los 90 días de la última revisión.
- **Existencia, disponibilidad y relación comercial son tres datos distintos.** "Existe y está abierto" no quiere decir "hay lugar", y ninguna de las dos dice "es socio de IATOS".
- **Etiquetas comerciales solo con evidencia:**
  - EXPERIENCIA CURADA: lugar público elegido por IATOS (sin acuerdo).
  - PARTNER VERIFICADO: requiere un acuerdo **firmado y vigente** en el registro de alianzas, con documento.
  - BENEFICIO EXCLUSIVO: requiere un beneficio concreto escrito en ese acuerdo; el texto vive en el registro, no en la ficha.
  - EXPERIENCIA PRIVADA: requiere operador real, su sitio y las condiciones.
  - ACCESO CONFIRMADO: solo existe en una solicitud que el proveedor confirmó, con folio o documento.
  - El registro de alianzas está **vacío**: hoy ninguna ficha puede decir "partner" ni "beneficio".
- **La curaduría de octubre de 2026 ya pasó por el cargador** (ensayo, sin escribir en producción): 1,272 fichas, 1,260 aceptadas, 12 rechazadas por duplicado o fuente sin https. Quedan 1,097 CURADO (publicables con la etiqueta "pendiente de verificación en sitio oficial") y 163 PENDIENTE (ocultas).
- **Ninguna ficha es VERIFICADO todavía:** eso exige el muestreo humano del 20% por lote. Es la siguiente tarea del equipo.
- **Fotos:** Pexels, siempre "Foto ilustrativa · Pexels · <fotógrafo>", con enlaces. Nunca se presentan como el lugar.

---

## 1. Jerarquía de fuentes

| Nivel | Fuente | Sirve para | No sirve para |
|---|---|---|---|
| 1 | **Sitio oficial** del lugar u operador, o su plataforma oficial de reservas (Resy, OpenTable, SevenRooms, Tock) enlazada desde el sitio | Existencia, dirección, horario, dress code, edad, política de reserva y cancelación, precio publicado | Premios que el propio lugar se atribuye sin enlace a quien los otorgó |
| 2 | **Guías y premios:** guide.michelin.com, theworlds50best.com (y las listas regionales: Latin America's, Asia's, North America's, MENA), worlds50bestbars.com, La Liste, Forbes Travel Guide | Insignias de reconocimiento (nombre + **año** + URL abierta), `why_fact` | Afirmar que el lugar sigue abierto hoy |
| 3 | **Registros oficiales y oficinas de turismo** (regulador de juego, permisos de operador de aventura, capitanía de puerto) | `license_authority`, `license_ref`, permisos de operación | Calidad o estilo |
| 4 | **Prensa seria con fecha** (sección de gastronomía o viajes de medios reconocidos) | Contexto, aperturas, cierres | Precio o disponibilidad |
| 5 | **Plataformas** (Google Places vía `place-details`, `tripadvisor-search`, OpenStreetMap Nominatim) | `operating_status` (`businessStatus`), coordenadas, `google_place_id` | Premios, calificativos y "por qué" |
| ✗ | Texto generado por IA, blogs sin autor, agregadores de "top 10", redes sociales sin cuenta oficial | Nada | — |

**Reglas:**
- Un reconocimiento sin año y sin URL abierta por quien cura **no se publica**.
- Los rankings llevan número y año: "#12 en The World's 50 Best Bars 2025".
- Nunca "uno de los mejores del mundo".

## 2. Proceso de verificación y cadencia

### 2.1 Alta (lote nuevo)

1. Un equipo de curaduría (asistida por agentes, como los de `content_g1…g6.json`) llena la ficha según `scratchpad/prive/curation_brief.md` y el *addendum*.
2. **Validación automática** (cargador, [Modelo §9.2](IATOS_PRIVE_MODELO_DE_DATOS.md#92-cargador-de-curaduría-no-es-migración)):
   - esquema;
   - URLs `https`;
   - el sitio responde y el dominio coincide con el nombre (`link_audit.mjs --content`);
   - reglas de casino y aventura;
   - deduplicación.
3. **Muestreo humano del 20% al azar** del lote (mínimo 5 por ciudad). Se abre el sitio oficial y se comparan nombre, dirección, edad, dress code y premio. Se registra el resultado.
   - **0 errores críticos** (lugar inexistente o cerrado, premio inventado, dirección equivocada): el lote pasa a **VERIFICADO**, con `verified_by='curaduria_asistida+muestreo:<persona>'`.
   - **1 error crítico o más:** se revisa el **100%** de esa ciudad antes de publicar.
4. **Socios** (partner, beneficio, acceso): verificación humana del 100%, con el contrato a la vista.

### 2.2 Mantenimiento

| Tarea | Frecuencia | Quién | Costo |
|---|---|---|---|
| Revisión de enlaces (`link_audit.mjs` sobre todo el catálogo; a futuro, tarea programada) | Semanal | Robot. Las alertas van a la persona curadora. | USD 0 (HEAD/GET a los sitios) |
| Estado abierto / cerrado (`place-details`, campo `businessStatus`, con `google_place_id` guardado) | Mensual, solo VERIFICADO | Robot | ~550 al mes, dentro de las solicitudes gratis de Place Details ([Alianzas §7](IATOS_PRIVE_ALIANZAS_COMERCIALES.md#7-costos-unitarios-por-ciudad-y-por-usuario)) |
| Reverificación completa | Cada 90 días por ficha (~550 / 13 semanas ≈ **43 por semana**) | Persona curadora (designa el dueño) | ~10–12 min por ficha ≈ **8 h a la semana** [SUPUESTO] |
| Eventos (`iconic_events`) | Al cargarlos y 14 días antes de la fecha | Persona curadora | — |
| Precios con monto | Cada 90 días o antes si la fuente cambia | Persona curadora | — |
| Socios | Mensual; y al vencer el contrato, automático (la etiqueta cae sola) | Responsable comercial | — |
| Reporte de usuario ("Este dato está mal") | Respuesta en ≤ 5 días hábiles | Persona curadora | — |

**Volumen hoy:** ~1,260 fichas aceptadas (oct-2026) → ~97 reverificaciones por semana con ciclo de 90 días [SUPUESTO: ~10–12 min cada una ≈ 17–19 h a la semana]. Con ese volumen conviene priorizar las ciudades con más demanda (`prive_events`).

**Quién:** se propone un rol **"Curaduría Privé"** con una persona responsable y una suplente [SUPUESTO: el dueño decide quién]. Los agentes de IA ayudan a investigar, pero **no** dejan una ficha en VERIFICADO sin el muestreo humano.

## 3. Qué cuenta como cada estado

| Estado | Definición | Se muestra | Iato lo recomienda |
|---|---|---|---|
| **VERIFICADO** | Fuente nivel 1 consultada hace ≤ 90 días; nombre y dirección coinciden; abierto; lote aprobado en el muestreo (o revisión humana 100%) | Sí, con ✓ y la fecha | Sí |
| **CURADO** | Respaldado por fuentes de nivel 2–4 con URL, o por nivel 1 revisado por un agente y todavía sin muestreo; ≤ 90 días | Sí, con la etiqueta "Curado: pendiente de verificación en sitio oficial" | Sí, diciendo el estado |
| **ESTIMADO** | Existe y está abierto, pero un dato práctico clave (precio, horario o reserva) está estimado y no publicado por el lugar | Sí: "Precio estimado" junto al dato | Sí, diciéndolo |
| **PENDIENTE** | Cargado sin revisión (los 194 heredados, o lo que la curaduría marcó `no_confirmado` sin fuente útil) o descubierto en búsqueda | No en el catálogo. Solo en el descubrimiento bajo demanda, con su etiqueta | No, salvo el descubrimiento etiquetado |
| **DESACTUALIZADO** (calculado) | Fue VERIFICADO, CURADO o ESTIMADO, y su última verificación tiene más de 90 días | Sí, en gris: "Por verificar: última revisión <fecha>" | No (lo excluye `prive-search`) |
| **NO DISPONIBLE** | Cerrado permanente, cerrado temporal **sin** fecha ni nota de temporada con fuente, evento pasado, vigencia vencida o reemplazado. (Cerrado por temporada **con** fuente se muestra como "Cerrado por temporada", no como abierto.) | Solo si el usuario lo había guardado o pedido, en gris y sin botón de solicitar | No |

**Disponibilidad ≠ estado:** `availability_state` es `no_consultada` por omisión. Solo cambia cuando alguien consultó **para una fecha**, con `availability_checked_at` y `availability_for`. Una consulta vale ese día; después vuelve a "no consultada".

## 4. Lenguaje permitido y prohibido

| Prohibido | Cuándo se permite | Alternativa |
|---|---|---|
| "VIP", "Exclusive Access", "acceso garantizado" | Nunca como insignia de IATOS. "VIP" solo si es el nombre oficial de un producto que vende el lugar, entre comillas y con fuente. | "Solicitud gestionada por Iato" |
| "Exclusivo", "solo miembros" | Solo si `is_members_only_venue = true` con fuente del propio club: "Club privado: el club admite a miembros y a sus invitados" | — |
| "El mejor", "#1", "el más…", "legendario" | Solo citando un ranking con año y fuente | El dato del premio |
| "Socio IATOS", "Beneficio IATOS", "Acceso confirmado" | Solo con un acuerdo `firmado` y vigente | "Reserva externa" o nada |
| "Reservado", "Confirmado" | Solo con `confirmado_externamente` y evidencia | "Solicitud enviada · aún no es una reserva" |
| "Lista de espera" | Solo si el lugar opera una lista de espera real y documentada (por ejemplo, en Resy) | — |
| "Disponible hoy" | Solo con `availability_state='disponible'` consultado ese día | "Disponibilidad no consultada" |

**Fundamento legal en México [VERIFICADO con fuentes secundarias]:**
- El **artículo 32 de la Ley Federal de Protección al Consumidor** prohíbe la publicidad que induce a error por ser "inexacta, falsa, exagerada, parcial, artificiosa o tendenciosa", y PROFECO puede sancionar (art. 123).
- Resumen de la SCJN: https://www.scjn.gob.mx/sites/default/files/sinopsis_asuntos_destacados/documento/2017-01/1S-110315-JRCD-2244.pdf
- Texto vigente: confirmarlo en el DOF con un abogado.

## 5. Política de imágenes

Decisión del dueño, 2026-10-22: **Pexels** reemplaza la jerarquía de Wikimedia y Google Photos.

1. **Fuente:** solo Pexels, a través de `pexels-image`, con caché compartida de 7 días en `serp_cache`, más el guardado en la fila de la experiencia (se refresca cada 90 días).
2. **Consulta:** `image_query` de la curaduría (en inglés, describe el tipo de lugar: "candlelit speakeasy cocktail bar"), luego `"<subcategory> <ciudad>"` y luego el valor por omisión del universo.
3. **Honestidad:**
   - una foto de Pexels es **genérica**;
   - la tarjeta y la ficha muestran "Foto ilustrativa · Pexels · <fotógrafo>", con enlace a la página de la foto y al perfil del fotógrafo, como piden las guías de la API de Pexels;
   - `verified_image = true` solo lo pone una persona cuando la foto muestra **ese** lugar; entonces dice "Foto del lugar · Pexels · <fotógrafo>".
4. **Cuidados de licencia** [SUPUESTO: confirmar con la licencia vigente de pexels.com]:
   - no sugerir que las personas que salen en la foto respaldan el lugar o son clientes;
   - evitar fotos con personas identificables en `after_dark` y `casino_grand_nights`;
   - no vender la foto sin modificar.
5. **Prohibido:** copiar fotos del sitio oficial, de Google o de redes sin licencia. Las fotos de prensa del lugar se dejan para Signature, con el permiso por escrito en el acuerdo.
6. **Límites:** Pexels permite 200 solicitudes por hora y 20,000 al mes. Esa cuota **se comparte** con `buscar-video` (694 llamadas en 24 h para 8 usuarios, `IATOS_COSTOS_UNITARIOS.md:204`). Por eso:
   - Privé guarda la URL en la fila;
   - precalienta las portadas de forma escalonada (≤ 100 por hora);
   - no usa video.

## 6. Casinos: cómo se marcan legalmente

- **Solo casinos con permiso vigente** del regulador del lugar. `license_authority` es obligatorio (CHECK) y se cita la fuente. Ejemplos de autoridad [SUPUESTO: confirmar cada uno al curar]:
  - México: Secretaría de Gobernación (permisos de la Ley Federal de Juegos y Sorteos);
  - Nevada: Nevada Gaming Control Board;
  - Reino Unido: Gambling Commission;
  - Mónaco: el casino lo opera la Société des Bains de Mer.
- **Solo descubrimiento e información práctica:** arquitectura, historia, restaurante o bar, dress code, horario, edad y requisitos de entrada (identificación). Nada de estrategias, probabilidades ni promociones.
- **Sin monetización del juego:** sin enlaces de afiliado de apuestas, sin bonos, sin depósitos, sin "registro con código". `affiliateLinks.ts` no tendrá funciones de juego. Una prueba lo revisa (T-58).
- **Edad:** `age_policy` 18+ o 21+ según el lugar (CHECK). Se exige la declaración 18+ ([UX §6](IATOS_PRIVE_UX.md#6-diseño-legal-18)). En la ficha: "Información práctica. IATOS no promueve ni intermedia apuestas. Juega con responsabilidad."
- **Donde el juego no es legal**, el universo no existe para ese destino.
- **Personalización:** Iato no "empuja" el casino. Solo aparece en "Para ti" si el usuario lo pidió o si su DNA tiene señal explícita de ese universo.

## 7. Alcohol, vida nocturna y menores

- Las fichas con servicio de alcohol como actividad principal (`after_dark`, `casino`) son 18+ como mínimo.
- Nada de promociones de consumo ("barra libre", "2×1"), salvo que sean texto de un contrato de socio y cumplan las reglas locales.
- **Prohibido curar:** clubes de *strip*, servicios de acompañamiento o contenido sexual (la misma regla que ya tenía `nightlife-discover`). El cabaret y el burlesque artísticos solo con fuente de nivel 1–2.

## 8. Datos personales (LFPDPPP)

- **Ley vigente [VERIFICADO con fuentes secundarias]:** la nueva **Ley Federal de Protección de Datos Personales en Posesión de los Particulares**, publicada en el DOF el 20-mar-2025 y vigente desde el 21-mar-2025, abrogó la de 2010. Las funciones del INAI pasaron a la **Secretaría Anticorrupción y Buen Gobierno**. Fuente: https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares
- **Implicaciones para Privé:**
  - mandar el nombre del cliente, la fecha y las preferencias a un restaurante es una **transferencia** que debe estar en el aviso de privacidad y que se hace solo con la solicitud del usuario;
  - los socios firman el uso limitado de esos datos ([Alianzas §4](IATOS_PRIVE_ALIANZAS_COMERCIALES.md#4-checklist-de-acuerdo-una-página));
  - `prive_events` no guarda texto libre.

---

## 9. Evidencia por campo (lo que la base exige)

| Campo | Para publicarse necesita | Si falta | Dónde se impone |
|---|---|---|---|
| Nombre, universo, subcategoría | Texto real (sin traducir), uno de los 12 universos | Se rechaza | CHECK `universe`, `subcategory` |
| Destino | Un destino de la lista del dueño (país-destino, región o localidad); barrio opcional que sea de ese destino | Se rechaza | trigger `prive_experiences_guard` |
| Estado VERIFICADO / CURADO / ESTIMADO | ≥ 1 fuente https, fecha de verificación y `why_fact` | No se puede guardar | CHECK `prive_sourced_states` |
| VERIFICADO | Además, sitio oficial (`website`) | No se puede guardar | CHECK `prive_verified_official` |
| Premios | Nombre, año (1950–2099) y URL https | No se puede guardar | `prive_accolades_ok` |
| Fuentes | URL https | No se puede guardar | `prive_sources_ok` |
| Precio con monto | URL de la fuente, moneda y fecha de consulta | No se puede guardar; la pantalla dice "precio por confirmar" | CHECK `prive_price_has_source` |
| Horario | JSON por día + URL de la fuente | No se puede guardar; "horario por confirmar" | CHECK `prive_hours_have_source` |
| Duración | Fuente | El planificador usa una duración ESTIMADA y lo dice | CHECK `prive_duration_has_source` |
| Temporada | Fuente (`season_source`) | No se guarda la temporada | CHECK `prive_season_sourced` |
| Disponibilidad ≠ "no consultada" | Fecha de consulta, fuente y fechas consultadas | No se puede guardar | CHECK `prive_availability_consulted` |
| Club privado | Fuente del propio club | No se puede guardar | CHECK `prive_members_only_sourced` |
| Casino publicable | Autoridad que otorga la licencia + URL + edad 18+/21+ | Queda PENDIENTE | CHECK `prive_casino_rules` |
| Aventura publicable | Operador + requisitos de seguridad | Queda PENDIENTE | CHECK `prive_adventure_rules` |
| Imagen "del lugar" | Que una persona marque `verified_image` | Siempre "Foto ilustrativa" | CHECK `prive_image_illustrative` |
| Duplicado | Llave de nombre única por destino y por familia de destinos | Se rechaza (cargador y `prive_import_batch`) | UNIQUE `prive_dedupe` + `prive_destination_root` |

## 10. Etiquetas comerciales y su evidencia

| Etiqueta | Evidencia mínima | Qué la quita sola |
|---|---|---|
| EXPERIENCIA CURADA | Estado VERIFICADO o CURADO | Pasar a PENDIENTE, DESACTUALIZADO o NO DISPONIBLE |
| PARTNER VERIFICADO | `prive_partner_agreements` con estado `firmado`, fecha de firma, vigencia, documento de evidencia (`evidence_document_path`), firmante, responsable de IATOS y condiciones; la ficha en VERIFICADO | Que venza el acuerdo: la vista la regresa a EXPERIENCIA CURADA |
| BENEFICIO EXCLUSIVO | Lo anterior + `prive_partner_benefits` (texto literal, condiciones, cláusula) del **mismo** acuerdo (llave compuesta) | Que venza el acuerdo o el beneficio |
| EXPERIENCIA PRIVADA | Operador, sitio https del operador y condiciones | — |
| ACCESO CONFIRMADO | Solicitud en `confirmado_externamente` con `confirmed_by`, `confirmed_at` y folio o documento | Cancelación |

- El cargador **nunca** pone PARTNER ni BENEFICIO: `prive_import_batch` rechaza esas filas. Solo una persona del equipo, con el contrato a la vista.
- Un marketplace (Click&Boat, GetYourGuide, Viator…) es un canal externo (`booking_method = partner_ota`), **nunca** "partner".
- "Solo huéspedes" o "solo socios" se dice como restricción y aclara que solicitar no garantiza acceso.

## 11. Reglas automáticas del cargador (`scripts/prive/load_curation.mjs`)

1. **Entrada:** `data/prive/curaduria/<AAAA-MM>/content_g*.json`, `content_new.json` y `content_updates.json`; cualquier subconjunto; las dos formas de los curadores (ola 1 y ola 2 con `locality_type` y `parent_destination`).
2. **Estado:** `verificado` → CURADO (pasa a VERIFICADO solo con el muestreo humano); `no_confirmado` → PENDIENTE (oculto).
3. **Destino:** alias exacto (Montecarlo → barrio de Mónaco; Polanco → barrio de CDMX). Si el barrio o la dirección nombran una localidad hija, o una localidad de **otro estado** confirmada por la dirección o las coordenadas, la ficha se mueve ahí ("Puerto Vallarta, Jal." archivado en Riviera Nayarit → Puerto Vallarta; "Mascate – Al Ghubra" → Mascate).
4. **Sitios contaminados:** si las notas dicen que el sitio tiene apuestas inyectadas o un dominio secuestrado, se quita el enlace; si las notas nombran otro dominio, solo se quitan los enlaces a ese dominio. Un "sin apuestas" en la nota de un casino no se confunde.
5. **Temporada:** "until 25 October", "reabre el 6 de mayo de 2027", "de abril a septiembre", "until next spring" → temporada con fuente. Un lugar cerrado por temporada se muestra "Cerrado por temporada", **nunca** como abierto.
6. **Edad:** 21+, 18+, "solo adultos" → la regla; otros mínimos ("desde 4 años") quedan como restricción; vida nocturna y casino nunca son "todas las edades".
7. **Enlaces:** solo https; uno que no lo es se omite (no se "arregla").
8. **Duplicados:** misma llave de nombre en la misma familia de destinos (Pujol en CDMX y en Polanco; Cocina de Autor en Los Cabos y en San José del Cabo). Se queda la de mejor estado y, a igual estado, la más específica.
9. **Imagen:** se ignora la imagen del curador; se usa `image_query` (Pexels).
10. **Salida:** reporte, filas y un SQL de ensayo para una réplica. El cargador no se conecta a ninguna base.

## 12. Qué se reutilizó, qué se construyó y qué se corrigió

- **Reutilizado:** `pexels-image` y su caché de 7 días; `app_flags` (umbrales de cobertura y versión de la declaración 18+); `check_rate_limit`; `notify_once`; `concierge_requests` sobre el arreglo IATOS-114; `bookings` (constancia y "agregar al viaje"); `has_trip_access`; `haversineKm` de `analizar-viaje/groundTransport.ts`; `resolveActiveTrip`/`useActiveTrip`; `prive_require` y el sistema visual del grupo core y ui.
- **Construido:** registro de alianzas (vacío), catálogo de experiencias con estados y etiquetas con evidencia, vista de estado efectivo, cobertura calculada, copia de los heredados como PENDIENTE, cargador con reporte de ensayo, `prive_import_batch`.
- **Corregido:** los 28 lugares heredados del repo dejaron de ser visibles sin revisión (23 quedaron actualizados por la curaduría y 5 reemplazados); un sitio sin `https://` ya no se publica como enlace roto.

## 13. Pruebas (resultado real)

| Suite | Qué prueba | Resultado |
|---|---|---|
| `supabase/tests/prive_catalog/run.sh` | Acceso sin sesión, adelanto sin nombres, estados (incl. DESACTUALIZADO a los 90 días), etiquetas imposibles sin evidencia, cobertura, alias y duplicados, temporada, solicitudes solo por el servidor, nada sin confirmar se ve confirmado, consentimiento de Travel DNA, carga | **110 OK, 0 FALLA** |
| `supabase/tests/prive/run.sh` (grupo core) | Antigüedad, sesiones, permisos (P54 ahora incluye las RPC del catálogo del contrato §5) | **89 OK, 0 FALLA** |
| `src/test/priveCuration.test.ts` | Validación del cargador, temporada, sitios con apuestas, casinos, aventura, destinos y duplicados | **33 pruebas OK** |

## 14. Lo que no se pudo verificar, costos, riesgos y autorizaciones

- **No verificado:** ninguna ficha tiene muestreo humano todavía (por eso no hay VERIFICADO). Los premios Michelin de varias ciudades vienen de listas de Wikipedia porque guide.michelin.com bloquea la carga automática: siguen siendo CURADO hasta que una persona los compare.
- **Casinos:** 8 fichas; las que no traen autoridad de licencia con fuente (6 en el ensayo) quedan PENDIENTE hasta que una persona la agregue.
- **Aventura:** 47 fichas sin operador o requisitos de seguridad estructurados quedan PENDIENTE.
- **Costo:** USD 0 en APIs para la carga (sin llamadas a proveedores). Las fotos usan la caché de Pexels (límite 20,000 al mes compartido con `buscar-video`). El costo grande es humano: muestreo del 20% del lote (~250 fichas, ~45 h) y reverificación de ~97 fichas por semana.
- **Riesgos:** descripciones de curaduría con palabras como "exclusivo" o "VIP" (17 + 3 avisos) deben revisarse antes de verificar; 111 avisos de "mismo dominio" (casi todos restaurantes de un mismo hotel) son para revisión humana.
- **Requiere autorización productiva:** aplicar las migraciones `20261023100000`–`20261023100600`, correr `prive_import_batch(…, false)` con el lote de octubre, y la designación de la persona de curaduría.
