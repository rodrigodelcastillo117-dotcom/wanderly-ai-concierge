# IATOS Privé · Experience Planner e Iato (`search_prive`)

> Parte de la serie Privé. Datos: [Modelo de datos](IATOS_PRIVE_MODELO_DE_DATOS.md). Evidencia: [Estándar de curaduría](IATOS_PRIVE_CURATION_STANDARD.md). Destinos: [Destinos globales](IATOS_PRIVE_GLOBAL_DESTINATIONS.md).
> Estado: construido en la rama `claude/wc-prive-catalog`, probado con Vitest y en una réplica local. Las funciones del servidor cambiadas necesitan despliegue.

## Resumen para fundadores

- **Iato ya puede buscar en Privé**, pero **solo en lo verificado o curado** y solo si el miembro desbloqueó Privé en esa sesión. Sin sesión, Iato dice cómo desbloquear y **no menciona ningún lugar**.
- **El "Experience Planner" arma planes compuestos sin IA**: con lo que pidió el usuario, sus fechas, su hotel y las fichas del catálogo, propone días y horarios, y los valida (horario publicado, temporada, traslados, presupuesto, edad, dress code, reserva, choques). Iato solo lo explica.
- **Nada se reserva.** El plan dice "propuesta"; guardarlo en el viaje lo deja como "plan sin reservar"; pedirlo crea una **solicitud** que el equipo gestiona. "Confirmado" solo aparece cuando el proveedor confirmó, con folio o documento.
- **El ejemplo del dueño (Mónaco, tres noches) con los datos reales de hoy:** el planner propone la tarde en un club de playa y la cena, y **dice con honestidad** que todavía no hay en el catálogo un paseo privado en barco verificado ni un casino publicable (el Casino de Monte-Carlo está cargado, pero sin la autoridad de licencia con fuente sigue PENDIENTE). No inventa ninguno.

---

## 1. Qué hace Iato

1. El chat (`src/pages/Concierge.tsx`) manda la sesión Privé del usuario, si existe, en el encabezado `x-prive-session`.
2. `concierge-chat` expone la herramienta **`search_prive`** (`supabase/functions/concierge-chat/prive.ts`). Llama a la RPC `prive_search` **con el JWT del usuario**, así que la base decide con `prive_require` (PRO vigente, 90 días pagados o concesión, membresía activa y sesión Privé válida).
3. Respuestas posibles:
   - **Sin sesión o sin derecho:** `{available:false, reason:"PRIVE_…", motivo}`. Iato explica cómo desbloquear. Cero nombres.
   - **Ciudad sin cobertura:** "Sin selección verificada de IATOS Privé aquí: dilo tal cual y no inventes lugares."
   - **Con resultados:** por ciudad, máximo 3 por universo (4 si pidió plan), con estado, etiqueta, edad, forma de reserva, precio ("por confirmar" si no hay fuente), horario ("horario por confirmar") y temporada. La base ya excluye PENDIENTE, DESACTUALIZADO y NO DISPONIBLE; un casino solo aparece si el usuario lo pidió.
4. Reglas de la herramienta (en su descripción): recomendar solo lo que devolvió, respetar la ciudad de cada lugar, decir el estado si no es VERIFICADO, traslados "aprox.", y no decir reservado, confirmado, VIP, exclusivo ni garantizado. Casinos: solo información práctica, sin apuestas, con su edad.
5. Cada lugar mostrado queda como evento `iato_pick_shown` (estado "recomendado" del ciclo), sin texto del usuario.

## 2. Validaciones deterministas del planner (`supabase/functions/_shared/privePlanner.ts`)

| Validación | Regla |
|---|---|
| Intenciones | Frases en español o inglés → tabla fija: cena, restaurante, espectáculo, lounge, concierto, beach club, navegación, golf, spa, arte, gastronomía, evento, casino, propuesta, fotografía, cultural, hotel, traslado, regreso |
| Horario | Solo si la ficha trae horario **con fuente**; el plan se ajusta a esa ventana. Sin fuente: hora sugerida + "horario por confirmar" |
| Temporada | Si la ficha está cerrada por temporada en esa fecha, no se propone y se dice por qué ("cerrado por temporada el 2026-11-12 …") |
| Traslados | Distancia en línea recta (`haversineKm` de `analizar-viaje/groundTransport.ts`, reutilizada) × 1.4 a 20 km/h + 10 min, redondeado a 5. **Siempre ESTIMADO** y "aprox.". Sin coordenadas: "Traslado no calculado: falta la ubicación exacta" (se reservan 30 min para no encimar) |
| Duración | La publicada si tiene fuente; si no, una duración por tipo, marcada "estimada" |
| Presupuesto | Suma **solo** precios con fuente (por persona × personas, o por grupo). Lo demás: "precio por confirmar". Si las monedas no coinciden, no suma |
| Edad | 18+ / 21+ con identificación; si alguien del grupo es menor, ese lugar no entra |
| Dress code, reserva, restricciones | Se listan tal como vienen de la fuente; "Requiere reserva: se solicita, no está confirmada" |
| Choques | Nada se encima; si no cabe en un día, se prueba otro; si no cabe en ningún día, se dice |
| Alternativas | Hasta 2 por paso, del mismo catálogo |
| Lo que no hay | "Sin opción verificada en el catálogo de <destino> para … Iato no inventa lugares." |
| Determinismo | Mismas entradas → mismo plan (prueba) |

**Plantillas compuestas** (las 8 del dueño): cena + espectáculo + lounge; restaurante + traslado + concierto; beach club + navegación + cena; golf + spa + restaurante; arte + gastronomía + evento; casino legal + espectáculo + regreso; propuesta romántica + fotografía + cena; experiencia cultural + traslado + hotel. Los pasos de la plantilla van el mismo día; lo demás se reparte en los días menos cargados.

## 3. Guardar en el viaje y solicitar (sin un segundo sistema de viajes)

- **Agregar al viaje** (`prive_add_to_trip`): cada paso queda en `bookings` con `trip_id` — el mismo enlace E-22 que usan las herramientas del viaje —, `status = 'pending'`, `provider = 'iatos_prive'`, la hora con el desfase real de la zona del destino y, en `raw_payload`, `estado: 'planeado'`, la plantilla y el traslado ESTIMADO. El expediente lo muestra como "no reservado" (`isConfirmedBooking` = false). El viaje por omisión es el activo (`useActiveTrip` → `resolveActiveTrip`).
- **Solicitar con Iato:** `concierge-action` con `type: 'prive_request'` → `prive_request_create` (con la sesión Privé) → `concierge_requests` en `solicitado` + historial + aviso "Solicitud enviada · aún no es una reserva" → correo al equipo.
- **Ciclo:** recomendado (`iato_pick_shown`) → guardado (`recomendaciones.experience_id`, solo por `prive_save`) → solicitado → pendiente de confirmación → confirmado externamente (con evidencia; crea la constancia `confirmed` en `bookings`) → cancelado. También rechazado y caducado. Solo `prive_request_transition` (equipo o servidor) cambia el estado; un trigger rechaza cualquier otro cambio, incluso con la llave de servicio. Cada paso guarda actor, nota y, si aplica, la escalación de Fixer y el responsable.

## 4. Ejemplo trabajado: "Estoy en Mónaco tres noches…"

> "Estoy en Mónaco tres noches. Quiero una cena espectacular, conocer un casino elegante, pasar una tarde en un beach club y disfrutar un paseo privado en barco."

**Paso 1 · Intenciones:** `cena`, `casino`, `beach_club`, `navegacion` → plantilla **beach club + navegación + cena** (cubre 3 de las 4).

**Paso 2 · Con los datos reales de la curaduría de octubre (réplica local), 17-jun-2027, 2 personas, hotel Hôtel de Paris:**

```
Día 1 (2027-06-17):
- 13:00 sugerido · horario por confirmar: Tarde en un beach club en La Note Bleue [CURADO] · traslado ≈ 15 min en auto (aprox.). Precio por confirmar (nivel $$$).
- 20:00 sugerido · horario por confirmar: Cena en Le Louis XV – Alain Ducasse à l'Hôtel de Paris [CURADO] · traslado ≈ 15 min en auto (aprox.). Precio por confirmar (nivel $$$$).
Sin colocar: Paseo en barco — Sin opción verificada en el catálogo de Mónaco para "Paseo en barco". Iato no inventa lugares.
Sin colocar: Casino (información práctica) — Sin opción verificada en el catálogo de Mónaco para "Casino (información práctica)". Iato no inventa lugares.
Precio por confirmar: ninguno de estos lugares publica un precio con fuente.
Es una propuesta de Iato: nada está reservado ni confirmado.
Requisitos: Edad mínima 18 años (identificación oficial) · Requiere reserva: se solicita, no está confirmada.
```

Por qué: la única ficha de "Yacht & Sea" de Mónaco es el Monaco Yacht Show (un salón náutico, no un paseo; el planner lo excluye), y el Casino de Monte-Carlo está PENDIENTE hasta que una persona agregue la autoridad de licencia con su fuente. Cuando eso pase, el casino entrará como información práctica, 18+, en otra noche.

**Paso 3 · Con fichas de prueba completas** (ficticias, `src/test/fixtures/priveMonaco.json`; prueba "ejemplo del dueño"):
- Día 1: beach club 13:00 → paseo privado en barco (EXPERIENCIA PRIVADA, 3 h publicadas) → la cena **no cabe** antes del cierre publicado (22:30) y pasa a otro día, dentro de su horario.
- Otra noche: casino 22:45, "horario por confirmar", 18+, "IATOS no promueve ni intermedia apuestas".
- Presupuesto: 2 × 380 EUR (menú con fuente) + 1,200 EUR (barco con fuente) = **desde 1,960 EUR**; 2 lugares con precio por confirmar.
- En noviembre, los clubes de playa de la prueba están cerrados por temporada: el planner no los propone y dice por qué.

**Paso 4 · Lo que dice Iato:** explica el plan en bloques por día, con "aprox." en los traslados y "por confirmar" donde aplica, ofrece "Guardar en mi viaje" y "Solicitar con Iato", y nunca dice "reservado".

## 5. Pantallas (dentro del hub de Privé del grupo ui)

`/prive` (sección "Tu selección por destino", registrada en `PRIVE_HUB_SECTIONS`), `/prive/destino/:slug` (con el planner), `/prive/universo/:key`, `/prive/experiencia/:slug` y `/prive/solicitudes`. Todas usan `usePriveAccess().content`: sin sesión no llaman; un código PRIVE_* borra la sesión y vuelve al candado.

## 6. Qué se reutilizó, qué se construyó y qué se corrigió

- **Reutilizado:** la arquitectura de herramientas de `concierge-chat` (una herramienta = una función), `prepareToolResultForModel`/`slimToolResult`, `haversineKm`, `resolveActiveTrip`, `bookings` y su enlace con el viaje, `concierge-action` y su correo al equipo, `notify_once`, `check_rate_limit`, `prive_require` (core), `usePriveAccess` y el sistema visual (ui).
- **Construido:** `search_prive`, `privePlanner.ts`, `prive_search`, `prive_for_you`, `prive_add_to_trip`, `prive_request_*`, `concierge_request_events`, pantallas del catálogo.
- **Corregido:** `haversineKm` ahora se exporta (antes era interna); `pexels-image` devuelve también la página de la foto, el perfil del fotógrafo y el texto alternativo para dar el crédito completo.

## 7. Pruebas (resultado real)

| Prueba | Resultado |
|---|---|
| `src/test/privePlanner.test.ts` (ejemplo de Mónaco, temporada, edad, horario cerrado, sin coordenadas, 8 plantillas, zonas horarias, determinismo) | 20 OK |
| `src/test/searchPrive.test.ts` (sin sesión, errores PRIVE_*, filtros, ciudad sin cobertura, plan) | 10 OK |
| `src/test/priveCatalogUi.test.tsx` (candado, estados, etiquetas con evidencia, Pexels, 18+, solicitar, hub) | 16 OK |
| `supabase/tests/prive_catalog/run.sh` (solicitudes R1–R17, viaje M14, consentimiento M16) | 110 OK en total |
| Suite completa `npx vitest run` | 122 archivos, 1,001 pruebas OK |

## 8. Lo que no se pudo verificar, costos, riesgos y autorizaciones

- **No verificado:** el comportamiento del modelo de Iato con la herramienta en vivo (no se llamó a ningún modelo); la redacción final la cuida la descripción de la herramienta y las pruebas de evaluación existentes.
- **Costo:** `search_prive` y el planner no llaman proveedores pagados (solo la base). Las fotos usan la caché de Pexels. Una búsqueda de Privé agrega unos 2–3 mil tokens de contexto a la conversación de Iato.
- **Riesgos:** los horarios casi nunca vienen estructurados en la curaduría (por eso "horario por confirmar" será lo normal hasta que el equipo los capture con fuente); las fichas de aventura sin requisitos de seguridad siguen ocultas.
- **Requiere autorización productiva / despliegue:** funciones `concierge-chat`, `concierge-action`, `pexels-image` y `analizar-viaje` (solo exporta una función); migraciones `20261023100000`–`20261023100600`.
