# IATOS Privé · Experiencia de usuario y dirección visual

> Parte de la serie Privé. Datos: [Modelo de datos](IATOS_PRIVE_MODELO_DE_DATOS.md). Textos permitidos y prohibidos: [Calidad §4](IATOS_PRIVE_CURATION_STANDARD.md#4-lenguaje-permitido-y-prohibido).

## Resumen para fundadores

- **La regla de diseño:** "cuando alguien abra IATOS Privé no encuentre otra guía turística: encuentre una selección del mundo extraordinario, preparada especialmente para él."
- **Lo primero que se ve es "Para ti en <ciudad>":** de 4 a 8 experiencias que Iato eligió por el Travel DNA, las fechas y el presupuesto, cada una con una frase de por qué. El directorio completo queda abajo, por universo.
- **Lujo editorial**, no catálogo:
  - negro profundo, champaña y oro;
  - mucho espacio, tipografía con serifa para los títulos;
  - una foto grande por ciudad;
  - tarjetas limpias con pocos datos, todos verificables.
- **Honestidad visible:**
  - cada ficha dice si está verificada y cuándo;
  - si la foto es ilustrativa, lo dice;
  - si la disponibilidad no se consultó, lo dice;
  - pedir algo se llama "Solicitar con Iato", nunca "Reservar".
- **18+:** la noche, los casinos y lo que el lugar marque 18+ o 21+ piden una confirmación de edad con términos. Esa confirmación se guarda en el servidor, no en el navegador.
- **Pensado para el teléfono:** botones de 44 px, carga rápida y movimiento discreto, que se apaga si el usuario lo pide en su sistema.
- **Signature no se vende:** como mucho aparece "Próximamente · Solicitar información".

---

## 1. Dónde vive

- Es la pestaña **"Privé"** de Concierge (`src/pages/Concierge.tsx`). Reemplaza a "Members".
- `?tab=members` y `/dashboard/members` siguen funcionando como alias de `?tab=prive`.
- El contenedor es `MembersOnlyPanel`, renombrado a `PrivePanel` y con sus piezas reutilizadas.
- Desde la ficha del viaje (`TripDetail`), un acceso "Privé en <ciudad>" abre la home ya filtrada al viaje.

## 2. Home

| Orden | Bloque | Contenido | Reutiliza |
|---|---|---|---|
| 1 | **Encabezado** | Eyebrow "IATOS PRIVÉ", título "The World, Beyond Ordinary" (fijo, en inglés en ambos idiomas, por marca [SUPUESTO]) y selector de ciudad | `ConciergeHeading` |
| 2 | **Ciudad o viaje activo** | Si hay viaje activo (`useActiveTrip` → `resolveActiveTrip`): "Tu viaje a París · 12–15 nov". Si no: la última ciudad vista, o la ciudad de origen (`profiles.ciudad_origen`) si tiene cobertura. | `useActiveTrip`, `TripContextSelector` |
| 3 | **Portada de ciudad** | Foto grande (Pexels) con crédito "Foto ilustrativa · Pexels · <fotógrafo>", la intro del editor en 2 líneas y la insignia de cobertura si no es PILOTO | `pexels-image` (caché de 7 días) |
| 4 | **Para ti en <ciudad>** | Carrusel de 4 a 8 tarjetas de `prive_for_you`. Cada una con una línea "Por qué para ti" (plantilla en la lista; la frase de Iato al abrir la ficha) y la etiqueta "Elegido por Iato" | MembersOnlyPanel (tarjeta) |
| 5 | **Universos destacados** | Fichas grandes de los 3 a 4 universos con más afinidad, y "Ver los 12" | — |
| 6 | **Experiencias verificadas** | Carriles por universo (solo los que tienen ≥ 1 elemento visible). Cada carril muestra hasta 10 tarjetas, ordenadas por VERIFICADO primero y luego puntuación | — |
| 7 | **Próximos eventos** | Solo `iconic_events` con fecha dentro del viaje o de los próximos 60 días; con fecha y fuente | — |
| 8 | **Guardados** | Hasta 6, con "Comparar" (2 a 3) y "Ver todo" (Favoritos) | `recomendaciones` + `Favoritos.tsx` |
| 9 | **Mis solicitudes** | Estado actual con su historial (§4) | `ConciergeCards` |
| 10 | **Signature** | Tarjeta sobria: "IATOS Privé Signature · Próximamente". Botón "Solicitar información", que crea una solicitud `prive_signature_interest` (sin precio y sin promesa). **Se oculta por completo** mientras `prive_signature_enabled` esté apagado y el dueño no apruebe ni siquiera el aviso [decisión del dueño]. | `concierge-action` |

**Cuenta gratis (sin derecho):**
- Se muestran los bloques 1 a 3 y el **adelanto**: "En París hay 16 experiencias seleccionadas en 7 universos".
- Las tarjetas aparecen difuminadas, **sin nombres** (lo da `prive_teaser`).
- CTA: "Disponible con IATOS PRO" y la línea de prueba de `planCopy.ts` (`trialCopy`).
- Es el mismo patrón que `MembersTeaser` de sec2. No se inventa un adelanto con nombres.

### 2.1 Selector de ciudad (36 destinos y más)

- Hoja inferior (`Sheet`/`Drawer`) con búsqueda:
  - por nombre y sobrenombres (`prive_destination_aliases`: "Montecarlo" → Mónaco, "CDMX");
  - tolera acentos y errores comunes.
- Agrupado por región, en este orden: México, Norteamérica, Latinoamérica y Caribe, Europa, Medio Oriente y África, Asia y Oceanía.
- Arriba, fijos: "Tu viaje" y "Recientes".
- Cada fila lleva el nombre, el país y su nivel de cobertura con un punto: oro = piloto, champaña = parcial, gris = sin cobertura.
- Los corredores se abren en sus localidades: "Los Cabos → San José del Cabo · Cabo San Lucas".
- Si la búsqueda no encuentra nada: "No encontramos <texto>. ¿Quieres que lo agreguemos?" (suma a la cola de demanda).

## 3. Tarjeta y ficha

### 3.1 Tarjeta (lista)

- **Contenido:**
  - foto 4:5 con el crédito pequeño abajo;
  - insignia de reconocimiento si existe ("MICHELIN ★★ 2025" o "The World's 50 Best Bars 2025 · #12"), que abre la fuente;
  - nombre (serif) y barrio;
  - una línea: `$$$ · Smart casual · 18+ · Reserva en web`.
- **Estados visibles:** `CURADO`, `ESTIMADO` o `DESACTUALIZADO` como etiqueta de texto (no solo de color). VERIFICADO lleva una marca discreta ✓ con la fecha en la ficha.
- **Relación comercial:** solo si `effective_commercial_status ≠ none`. Etiquetas: "Reserva externa", "Socio IATOS", "Beneficio IATOS" (con el texto del contrato) o "Acceso confirmado".
- **Toda la tarjeta es tocable** (mínimo 44 × 44 px). Guardar es un botón aparte: corazón de 44 px con `aria-pressed`.

### 3.2 Ficha (hoja inferior en móvil, diálogo en escritorio)

Evoluciona `VenueDetailDialog`. En móvil usa `Drawer` (`src/components/ui/drawer.tsx`), con 90% de alto y arrastre para cerrar.

1. **Foto** con crédito y "Foto ilustrativa" (o "Foto del lugar" si `verified_image`).
2. **Nombre**, universo, barrio y ciudad.
3. **Estado de los datos:** "Verificado el 14 oct 2026 · Fuente: sitio oficial". Si tiene más de 90 días: "Por verificar: última revisión 2 jun 2026".
4. **Por qué para ti:** la frase de Iato, desde hechos. Si la IA falla o no pasa el validador, se usa la plantilla.
5. **Lo que dice la fuente:** descripción factual y reconocimientos con año y enlace.
6. **Datos prácticos** en una cuadrícula de 2 columnas:
   - precio: escala y nota; montos solo con fuente;
   - dress code;
   - edad;
   - cómo se reserva;
   - política de cancelación (si la hay);
   - dirección, con "Cómo llegar" a Google Maps.
7. **Disponibilidad:** "No consultada", salvo que alguien la haya consultado ("Consultada el 20 oct: lista de espera").
8. **Encaje con tu itinerario** (si hay viaje activo y la fecha cae en él):
   - "Día 2 · Noche libre en tu plan";
   - "Desde tu hotel: ≈ 15 min en auto (aprox.)";
   - botón "Calcular traslado exacto" (`get-routes`);
   - si el día está ocupado: "Ese día tienes: <titulo>".
9. **Acciones:**
   - primaria **"Solicitar con Iato"**: abre un formulario corto con fecha y hora, personas, preferencias y medio de contacto;
   - secundaria **"Reservar en el sitio oficial"**, solo si existe `booking_url` o `website` (abre en pestaña nueva y registra `external_click`);
   - "Guardar" y "Compartir".
10. **Pie:**
    - "IATOS no tiene relación comercial con este lugar" si es `none`;
    - para casinos: "Información práctica. IATOS no promueve ni intermedia apuestas."

**Confirmación tras solicitar:**
- Mensaje: "Solicitud enviada. El equipo de IATOS la gestiona; te avisaremos cuando el lugar la confirme. **Aún no es una reserva.**"
- En "Mis solicitudes" queda en **Solicitado**.

## 4. Mis solicitudes

- **Línea de tiempo por solicitud:** Solicitado → Pendiente de confirmación → Confirmado por el lugar (folio, quién confirmó, fecha) / Rechazado / Caducado / Cancelado.
- Solo **"Confirmado por el lugar"** usa el color de éxito. "Solicitado" es neutro.
- El usuario puede **cancelar** mientras no esté confirmada. Si ya está confirmada: "Para cancelar, contacta al lugar o pídelo a Iato".

## 5. Estados vacíos y errores

| Caso | Texto |
|---|---|
| Ciudad sin cobertura | "Aún no tenemos selección para <ciudad>." Más "Avísame cuando llegue" y, si el descubrimiento está encendido, "Buscar en vivo con Iato (no verificado)". |
| Universo vacío en esa ciudad | El carril no se muestra. En "Ver los 12": "Sin selección en <ciudad> por ahora". |
| Sin coincidencias de filtros | "Nada coincide con esos filtros." Más "Quitar filtros". |
| Para ti sin datos de DNA | Se muestran los VERIFICADOS mejor valorados con la etiqueta "Selección del editor", y "Completa tu Travel DNA para recomendaciones a tu medida". |
| Error de red | "No pudimos cargar Privé. Reintentar." No se muestra contenido viejo como si fuera actual. |
| No se pudo verificar el plan | El mismo comportamiento que `ProGate`: "No pudimos verificar tu plan." Más "Reintentar". Nunca el muro de pago por una falla nuestra. |
| Lugar cerrado (guardado antes) | La tarjeta en gris con "No disponible: cerrado según <fuente>, <fecha>", sin el botón de solicitar. |

## 6. Diseño legal 18+

- **Cuándo se pide:** al abrir por primera vez `after_dark`, `casino_grand_nights` o cualquier ficha con `age_policy` 18+ o 21+.
- **Cómo se ve:** una hoja con el texto de términos de la versión vigente (`app_flags.prive_adult_terms_version`):
  - "Confirmo que tengo 18 años o más y la edad legal para consumir alcohol y entrar a estos lugares en el país que visito";
  - más el enlace a Términos (`src/pages/Legal.tsx`).
- **Botones:** "Confirmo" y "Ahora no". El segundo regresa a los universos aptos para todas las edades.
- **Cómo se guarda:**
  - "Confirmo" llama a `prive_confirm_adult(version)` (servidor), que guarda `confirmed_adult_at`, `adult_terms_version` y `adult_confirmed_via='prive_sheet'`;
  - si `profiles.fecha_nacimiento` indica menos de 18 años, la RPC lo rechaza.
- **Qué no se hace:**
  - el cliente nunca decide: no hay `confirmedAdult = true` en el código; la RLS (`prive_adult_confirmed()`) filtra las filas;
  - no se presenta como verificación de identidad: el lugar puede pedir una identificación en la puerta, y así se dice.
- **21+ (EE. UU.):** la tarjeta muestra "21+ según el lugar". La confirmación 18+ no sustituye esa regla; solo informa.
- **Si cambian los términos:** al subir la versión, se pide confirmar otra vez.

## 7. Dirección visual

| Elemento | Especificación |
|---|---|
| Color | Fondo `#0A0A0A` (`--background: 0 0% 4%`, `src/index.css:12`); borde `rgba(201,169,97,.18)`; oro `#C9A961` (`--primary: 41 47% 59%`, `src/index.css:25`) [VERIFICADO]; superficie `#141416`; champaña `#E8DCC2` para el texto secundario; texto principal `#F5F2EA`. El oro solo marca acentos y acciones, nunca bloques grandes. |
| Contraste | Oro sobre negro ≈ 9:1 y champaña sobre negro ≈ 14:1 (AA y AAA). El texto gris no baja de 4.5:1. |
| Tipografía | Títulos en `font-fraunces` (ya existe en la app); cuerpo en la sans actual. Escala: 32/24/20/16/14. Eyebrows en versalitas con `tracking-[0.2em]`, como hoy. |
| Espacio | Margen lateral de 16 px en móvil y 24–40 px en escritorio; 24 px entre bloques y 48 px entre secciones. Radio de 16 px en tarjetas y 24 px en hojas. |
| Fotos | Sin filtros que cambien el lugar; un velo negro de abajo hacia arriba (40%) para legibilidad. Crédito siempre visible. |
| Iconos | `lucide-react` (ya en uso), de 20 px. Sin emojis en las tarjetas nuevas (la tabla vieja los usaba). |
| Movimiento | Entrada de tarjetas: opacidad 0→1 y 8 px hacia arriba en 220 ms (`ease-out`), escalonada 40 ms (máximo 6). Hoja: 280 ms. Sin parallax ni carruseles automáticos. Con `prefers-reduced-motion: reduce`, todo pasa a un fundido de 0 ms o 80 ms y sin desplazamiento. |
| Botones | Alto mínimo de 44 px. Primario: degradado oro (`bg-gradient-gold`, existe). Secundario: borde oro de 1 px. Foco visible: anillo champaña de 2 px. |

### 7.1 Componentes y estados

| Componente | Estados |
|---|---|
| `PriveHome` | cargando (esqueletos), con viaje, sin viaje, sin derecho (adelanto), error |
| `CityPicker` | cerrado, abierto, buscando, sin resultados |
| `CityCover` | cargando (color sólido), con foto, sin foto (degradado y nombre), crédito |
| `ForYouRail` / `UniverseRail` | cargando, con elementos, vacío (no se muestra) |
| `ExperienceCard` | normal, guardada, estado ≠ VERIFICADO, desactualizada, no disponible, con etiqueta comercial |
| `ExperienceSheet` | cargando por qué, por qué listo, plantilla, sin viaje, con viaje (libre u ocupado), traslado aprox. o exacto, error de ruta |
| `RequestForm` | vacío, inválido, enviando, enviado, error (sin duplicar el envío: IATOS-104) |
| `RequestTimeline` | cada estado del ciclo |
| `AgeGateSheet` | primera vez, términos nuevos, rechazado por fecha de nacimiento |
| `StateBadge`, `AccoladeBadge`, `CommercialLabel`, `ImageCredit` | — |
| `SignatureTeaser` | oculto (por omisión), "Próximamente", solicitud de información enviada |

## 8. Rendimiento (presupuesto)

| Medida | Meta (teléfono de gama media, 4G) |
|---|---|
| LCP de la home de Privé | ≤ 2.5 s |
| JS adicional | ≤ 35 KB gzip, en un *chunk* que carga solo al abrir Privé |
| Primera pantalla | 1 portada + 4 tarjetas. El resto con `loading="lazy"`. |
| Imágenes | `srcset` de Pexels (`medium`/`large`); ≤ 120 KB por tarjeta y ≤ 250 KB la portada |
| Datos | 1 llamada `prive_for_you` + 1 lectura de la vista por ciudad (≤ 60 filas, sin campos largos). La ficha pide sus campos largos al abrirse. |
| CLS | ≤ 0.1: proporciones fijas en fotos y esqueletos |

El video de `CityVideoCard` no se usa en Privé: pesa más y consume la cuota de Pexels (ver [Alianzas §7](IATOS_PRIVE_ALIANZAS_COMERCIALES.md#7-costos-unitarios-por-ciudad-y-por-usuario)).

## 9. Accesibilidad (WCAG 2.2 AA)

- **Etiquetas:** los estados se dicen con texto, no solo con color. Las insignias tienen `aria-label` completo ("Verificado el 14 de octubre de 2026").
- **Navegación:**
  - los carriles se recorren con teclado (Tab y flechas), y cada carril es una `section` con su encabezado;
  - la hoja atrapa el foco y regresa al elemento que la abrió;
  - Esc cierra.
- **Imágenes:** `alt` descriptivo de la foto ilustrativa (de Pexels `alt`), no el nombre del lugar, para no confundir. Si `verified_image`, entonces sí "Fachada de <lugar>".
- **Tamaños:** áreas táctiles de ≥ 44 px; el texto escala hasta 200% sin cortar.
- **Avisos:** confirmaciones en una región `aria-live="polite"`.

## 10. Idiomas (es / en) y zonas horarias

- **Textos fijos:** en un diccionario `src/lib/priveCopy.ts` (es-MX por omisión, en). Son los mismos principios que `planCopy.ts`.
- **Contenido:** campos `_es` y `_en`. Si falta `_en`, se muestra `_es` con la marca "(en español)". Nunca se traduce al vuelo con IA sin revisión.
- **Nombres propios:** no se traducen.
- **Fechas y horas:**
  - con `Intl.DateTimeFormat` en la **zona del destino** (`prive_destinations.timezone`) cuando se habla del lugar: "Sáb 14 nov, 21:00 (hora de París)";
  - en la zona del usuario para "verificado el…".
- **Monedas:** `price_note` en moneda local; equivalencia en MXN solo si existe `price_min`, con tipo de cambio y fecha (la misma fuente que `trip_quotes`).
