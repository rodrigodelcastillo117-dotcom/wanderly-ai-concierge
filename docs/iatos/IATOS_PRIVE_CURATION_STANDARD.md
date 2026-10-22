# IATOS Privé · Calidad, fuentes y política de imágenes

> Parte de la serie Privé. Campos y CHECK: [Modelo de datos §3](IATOS_PRIVE_MODELO_DE_DATOS.md#3-experiencias). Pruebas de estas reglas: [Matriz de pruebas](IATOS_PRIVE_TEST_MATRIX.md).

## Resumen para fundadores

- **Si un dato no tiene fuente, no se publica.** Si la fuente es vieja, se nota.
- **El orden de confianza:**
  1. el sitio oficial del lugar;
  2. las guías con premios públicos (Michelin, 50 Best, La Liste, Forbes Travel Guide), con año y enlace;
  3. los registros oficiales (por ejemplo, el permiso de un casino);
  4. la prensa seria, con fecha;
  5. Google Maps o TripAdvisor, solo para saber si sigue abierto y dónde está.

  Lo que escribe una IA **nunca** es una fuente.
- **Cada ficha vence a los 90 días.** Pasado ese tiempo dice "por verificar", sola.
- **Mantenimiento:**
  - un robot revisa los enlaces cada semana (gratis);
  - una persona reverifica unas 43 fichas por semana, unas 8 horas;
  - de cada lote nuevo, una persona revisa al azar el 20% antes de publicarlo.
- **Fotos:** se usan fotos de Pexels (gratis), siempre con el crédito "Foto ilustrativa · Pexels · <fotógrafo>". No se presentan como el lugar, salvo que una persona confirme que sí lo son.
- **Casinos:** solo los que tienen permiso legal y solo con información práctica. Sin apuestas, sin bonos, sin enlaces de afiliado de juego, y con la regla de edad visible.
- **Palabras prohibidas sin contrato:** "VIP", "exclusivo", "acceso garantizado", "beneficio IATOS" y "socio IATOS".

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

**Quién:** se propone un rol **"Curaduría Privé"** con una persona responsable y una suplente [SUPUESTO: el dueño decide quién]. Los agentes de IA ayudan a investigar, pero **no** dejan una ficha en VERIFICADO sin el muestreo humano.

## 3. Qué cuenta como cada estado

| Estado | Definición | Se muestra | Iato lo recomienda |
|---|---|---|---|
| **VERIFICADO** | Fuente nivel 1 consultada hace ≤ 90 días; nombre y dirección coinciden; abierto; lote aprobado en el muestreo (o revisión humana 100%) | Sí, con ✓ y la fecha | Sí |
| **CURADO** | Respaldado por fuentes de nivel 2–4 con URL, o por nivel 1 revisado por un agente y todavía sin muestreo; ≤ 90 días | Sí, con la etiqueta "Curado: pendiente de verificación en sitio oficial" | Sí, diciendo el estado |
| **ESTIMADO** | Existe y está abierto, pero un dato práctico clave (precio, horario o reserva) está estimado y no publicado por el lugar | Sí: "Precio estimado" junto al dato | Sí, diciéndolo |
| **PENDIENTE** | Cargado sin revisión (los 194 heredados, o lo que la curaduría marcó `no_confirmado` sin fuente útil) o descubierto en búsqueda | No en el catálogo. Solo en el descubrimiento bajo demanda, con su etiqueta | No, salvo el descubrimiento etiquetado |
| **DESACTUALIZADO** (calculado) | Fue VERIFICADO, CURADO o ESTIMADO, y su última verificación tiene más de 90 días | Sí, en gris: "Por verificar: última revisión <fecha>" | No (lo excluye `prive-search`) |
| **NO DISPONIBLE** | Cerrado temporal o permanente, evento pasado o temporada fuera de fechas | Solo si el usuario lo había guardado o pedido, en gris y sin botón de solicitar | No |

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
