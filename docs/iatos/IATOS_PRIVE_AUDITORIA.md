# IATOS Privé · Fase 1: auditoría de lo que ya existe

> Iniciativa **P2**. No debe retrasar seguridad, pagos ni cotizaciones. Este documento solo lee código y datos: no se cambió código ni producción.
> Documentos hermanos: [Modelo de datos](IATOS_PRIVE_MODELO_DE_DATOS.md) · [Destinos globales](IATOS_PRIVE_GLOBAL_DESTINATIONS.md) · [UX](IATOS_PRIVE_UX.md) · [Estándar de curaduría](IATOS_PRIVE_CURATION_STANDARD.md) · [Pruebas](IATOS_PRIVE_TEST_MATRIX.md) · [Alianzas](IATOS_PRIVE_ALIANZAS_COMERCIALES.md).
> Convención: **VERIFICADO** = lo comprobamos hoy (2026-10-22), leyendo el repo o probando el enlace; se indica la fuente. **SUPUESTO** = inferencia que alguien debe confirmar.

---

## Resumen para fundadores (una página)

**Qué es Privé.** La evolución de "Members Only" dentro de IATOS: una selección personal del mundo extraordinario (gastronomía, noche, casinos legales, yates, estancias, eventos, cultura, bienestar, aventura, deporte, celebraciones y lo mejor de México) que Iato arma para cada viajero según su Travel DNA, sus fechas, su presupuesto y su viaje activo. No es otra app ni otro chatbot: se construye con lo que ya existe.

**Dos niveles (decisión del dueño):**
- **Privé Digital**, incluido en PRO ($99 MXN al mes): curaduría, personalización, comparación, organización y ayuda de Iato. Su costo extra estimado es de **USD 0.02 a 0.05 (MXN 0.4 a 0.9) por usuario PRO al mes en uso típico, y hasta USD 0.29 (MXN 5.4) en uso pesado** (ver [Alianzas, sección 7](IATOS_PRIVE_ALIANZAS_COMERCIALES.md#7-costos-unitarios-por-ciudad-y-por-usuario)). Cabe holgado en el neto de MXN 76.35 por usuario.
- **Privé Signature**, a futuro: experiencias privadas, reservas gestionadas y beneficios reales con contrato. Queda **apagado**. Como mucho se ve como "Próximamente · Solicitar información".

**Lo que encontramos (los números):**
1. **La base actual no sirve tal cual para un producto "élite".** `nightlife_premium` tiene 194 lugares en 18 ciudades, todos de vida nocturna:
   - ninguno tiene coordenadas;
   - 47 hacen afirmaciones que no se pueden comprobar ("el más exclusivo del mundo", "#1");
   - los precios mezclan € y $;
   - no hay fuente ni fecha de verificación;
   - hay duplicados, y 5 de 17 sitios de México no responden.

   [VERIFICADO en producción hoy por el equipo; el repo solo trae 28 de esas filas]
2. **El repo solo tiene 28 de los 194 lugares.** Los otros 166 entraron directo a la base y no están en ninguna migración. Es el mismo problema de deriva que ya registra IATOS-072. Sondeamos los 28 sitios del repo:
   - 22 responden;
   - 5 no responden;
   - 1 bloquea robots;
   - 6 llevan a la página genérica de una cadena hotelera, no a la del lugar;
   - 7 tienen superlativos;
   - 4 ponen € en Londres.
3. **El acceso está a medio corregir.** En la rama actual el panel no tiene candado: `passwordUnlocked = true` y `confirmedAdult = true` están escritos fijos en el navegador. Otro ingeniero (rama `claude/wc-sec2`, sin integrar) ya lo cambia a derechos del servidor, con `members_access()` = PRO, prueba o cortesía. Privé se monta **encima** de eso.
4. **Un hueco de seguridad que Privé no puede heredar:** cualquier usuario puede cambiar el `status` de sus propias solicitudes de concierge. Podría marcarlas como "confirmada" él mismo. Antes de mostrar "confirmado externamente" hay que cerrarlo.
5. **Casi todo lo demás se reutiliza:**
   - Iato y su arquitectura de herramientas;
   - Travel DNA;
   - viaje activo único;
   - cotizaciones y reservas;
   - solicitudes al equipo humano;
   - caché compartida de proveedores;
   - registro de costos de IA;
   - búsqueda de lugares, Pexels, rutas y afiliados.

   Hacen falta: el catálogo de destinos, el modelo de experiencias con estados de calidad, el historial de solicitudes, las métricas y la herramienta `search_prive` de Iato.

**Recomendación:**
- Seguir con el plan de 7 fases del dueño (ver [Modelo de datos, sección 9](IATOS_PRIVE_MODELO_DE_DATOS.md#9-fases-de-implementación)).
- Cargar primero las 36 ciudades piloto que se están curando con fuentes.
- Ocultar los 166 lugares heredados sin revisar hasta que una persona los verifique.

---

## 1. Inventario reutilizable (con rutas)

### 1.1 Pantallas y componentes

| Pieza | Archivo | Qué hace hoy | Cómo la usa Privé | Hallazgos |
|---|---|---|---|---|
| `MembersOnlyPanel` | `src/components/MembersOnlyPanel.tsx` | Lista los lugares de una ciudad (`nightlife_premium`), con filtro por 8 categorías, 18 ciudades escritas en el código (`FEATURED_CITIES`, l. 23-29) y el botón "Reservar con Concierge" | Se vuelve el contenedor de la home de Privé (pestaña de Concierge) | **l. 58-60:** `accessLoading=false; confirmedAdult=true; passwordUnlocked=true`, banderas del cliente puestas en lugar de autorización [VERIFICADO]. <br>**l. 105-120:** `handleReserve` no manda `trip_id`. <br>**l. 285:** `href={v.website}` sin esquema produce un enlace relativo roto (82 sitios en producción no tienen `https://`). <br>Las ciudades vienen de una lista fija, no de un catálogo. |
| `VenueDetailDialog` | `src/components/VenueDetailDialog.tsx` | Ficha en un diálogo: dress code, precio, dirección, "Cómo llegar" y "Sitio oficial" | Se vuelve la ficha de la experiencia (hoja inferior en móvil) | Sin estado de verificación, fuente, fecha, política de edad, ni encaje con el itinerario. <br>`max-w-2xl` en un `Dialog`: en el teléfono conviene `Drawer` (`src/components/ui/drawer.tsx` ya existe). |
| `MembersTeaser` + `src/lib/membersAccess.ts` | Solo en la rama `claude/wc-sec2` (sin integrar) | Adelanto para quien no es PRO: ciudades, categorías y conteos | Adelanto de Privé para cuentas gratis | Esperar a que se integre. No reimplementar. |
| `Concierge` | `src/pages/Concierge.tsx:66-80, 404-430` | Pestañas `chat` / `members` (`?tab=members`); `onReserve` cambia al chat con el mensaje listo | La pestaña "Privé" sustituye a "Members" (se conserva el alias `?tab=members`) | — |
| `CityVideoCard` | `src/components/CityVideoCard.tsx` | Tarjeta de ciudad con video (`buscar-video`, Pexels) | Portada de ciudad (la cambiamos a foto: menos peso y menos cuota) | `buscar-video` ya consume mucho de la cuota de Pexels (ver 1.5). |
| `ProGate` | `src/components/ProGate.tsx` | Candado visual por `useSubscription().isPro`; no muestra el muro de pago si falla la lectura del plan | Solo como envoltura visual; la autorización la da la RLS | Es una ayuda de interfaz, **no** una autorización (IATOS-048: las cuotas fallan abiertas). |
| `ConciergeCards` | `src/components/concierge/ConciergeCards.tsx:160-239` | "Mis reservas" y solicitudes al humano | Lista "Mis solicitudes" de Privé | Mezcla clics y reservas (IATOS-081). |
| `FixerButton` | `src/components/FixerButton.tsx` + `supabase/functions/enviar-email-fixer` + tabla `fixer_escalations` | Escalación a una persona | Respaldo para una urgencia durante una experiencia | La promesa "24/7 por WhatsApp" no tiene respaldo (IATOS-030). Privé no debe repetirla. |
| Favoritos | `src/pages/Favoritos.tsx` + tabla `recomendaciones` (`guardado`) | Lo que el usuario guardó | Estados **recomendado** y **guardado** del ciclo de Privé | Falta `experience_id` (ver modelo). |

### 1.2 Datos y funciones del servidor

| Pieza | Dónde | Uso en Privé | Hallazgos |
|---|---|---|---|
| `nightlife_premium` | `supabase/migrations/20260529162313_…sql:2-31` (tabla) y `:79-129` (28 filas) | Se migra al modelo general; queda una vista de compatibilidad | Ver sección 2. RLS de hoy: cualquier sesión lee todo (`active = true`, l. 34-37). La rama sec2 la cambia a `active AND members_access()`. |
| `nightlife_access` | misma migración `:40-77`; `20261022141700_sec2_members_gate.sql` | Declaración de mayoría de edad (`confirmed_adult`) | El propio usuario puede escribir `confirmed_adult` (políticas insert/update propias). Sirve como **declaración**, no como prueba. Privé la pasa a una RPC con versión de términos (ver [UX §6](IATOS_PRIVE_UX.md#6-diseño-legal-18)). |
| `members_gate`, `unlock_members_access` | `20261022141700_sec2_members_gate.sql` (en la rama actual) | Nada. Privé no usa contraseñas | La contraseña anterior estuvo en el código y en git (DEC-06). |
| `members_access()`, `members_access_state()`, `members_teaser()` | `wt-sec2/supabase/migrations/20261022146000_sec2_members_pro_access.sql` (sin integrar) | **Derecho de Privé Digital** = `members_access()` | Diseñar encima, sin duplicar. |
| `is_pro`, `effective_plan`, `quota_rule`, `plan_limit`, `get_access_state` | `20261022135300_pay_plan_limits_recommended.sql:11-130, 323-357` | Plan y límites de Privé (`plan_limits` con tipos nuevos) | `is_pro` = comped, o `active` vigente, o `trialing` con fecha de fin. `effective_plan` distingue free / trial / pro. |
| `plan_limits`, `app_flags`, `app_flag()` | `20261022135100_pay_plan_limits.sql:8-50` | Interruptores `prive_enabled`, `prive_signature_enabled` y `prive_on_demand_discovery` | — |
| `quota_reservations`, `reserve_quota` | `20261022135000_…`, `20261022135100_…:100-200` | Solo si el descubrimiento bajo demanda gasta SerpApi | — |
| `live_search_usage`, `live_search_take` | `20261022142000_cost_serp_cache_usage_log.sql` | Tope del descubrimiento bajo demanda | — |
| `serp_cache` | ídem, sección 1 | Caché de Pexels (7 días) y de lugares descubiertos | — |
| `ai_usage_log` | ídem, sección 2 | Costo de `prive-why` y `prive-search` | — |
| `concierge_requests` | `20260525235630_…sql:3-22`; políticas en `20261022141600_sec2_trip_id_checks.sql:45-51` | Solicitudes de Privé (se extiende) | **Hueco:** `"Users update own concierge_requests"` permite que el usuario cambie `status` y `payload` [VERIFICADO, l. 48-51]. Estados de texto libre (`pending`). Sin historial ni responsable. |
| `concierge-action` | `supabase/functions/concierge-action/index.ts` | Crea la solicitud, avisa al usuario y manda correo al equipo | Texto honesto ya corregido: "Todavía no es una reserva" (l. 105-112). <br>En sec2 exige `members_access` para `members_nightlife_reservation`. <br>Falta el tipo `prive_request` con fecha, personas y método de contacto. |
| `notifications` | `20261022141500_sec2_notifications_server_only.sql` | Avisos de cambio de estado (servidor) | El usuario solo puede insertarse avisos a sí mismo. |
| `bookings` | `20260526222517_…sql:1-36` (+ ferry) | Constancia de una reserva **confirmada externamente** | El usuario puede escribir `status` y `commission_amount` (IATOS-081). Privé solo inserta desde el servidor. |
| `trip_quotes` | `20261022133000_trip_quotes.sql` | Partida opcional "Privé" con estado `ESTIMADO` / `PENDIENTE` | Inmutable: correcto para cotizar. |
| `trips.itinerario_json` | `types.ts:1638`; esquema en `analizar-viaje/index.ts:299-312` | Encaje con el itinerario | Los días son `{dia, titulo, mañana, tarde, noche}`: **sin horas ni coordenadas**. El encaje es por franja y queda marcado "aprox." |
| `trips.selections`, `hospedaje_json` | `20261022143000_trip_selections_and_links.sql` | Punto de partida (hotel elegido) para estimar el traslado | — |
| Viaje activo | `src/lib/activeTrip.ts` → `supabase/functions/_shared/activeTrip.ts` (`resolveActiveTrip`); `profiles.active_trip_id`; `src/hooks/useActiveTrip.ts` | Ciudad y fechas por omisión de la home | Resuelve IATOS-028. |
| Travel DNA | `ai_user_preferences` (`nivel_presupuesto`, `estilo_comida`, `actividades_tarde`, `ritmo_viaje`, `restricciones_alimentarias`, `deal_breakers`, `perfil_ia`, `dna_signal`); `travel_profiles` (`intereses`, `presupuesto_rango`, `preferencias_comida`, `alergias_restricciones`, `movilidad_especial`); `profiles.food_dna` | Puntuación de "Para ti" | `concierge-chat` ya incrementa `dna_signal` por herramienta usada (`index.ts:166-180`). |
| Iato | `supabase/functions/concierge-chat/` (`index.ts` `TOOLS` + `TOOL_FUNCTIONS` l. 44-140; `tools.ts`, `cards.ts`, `guard.ts`, `prompt.ts`) | Se agrega la herramienta `search_prive` | Arquitectura limpia: una herramienta = una función del servidor. |
| `nightlife-discover` | `supabase/functions/nightlife-discover/index.ts` | **Se retira de Privé** | Perplexity + Claude/Gemini **inventa** lugares y los inserta (l. 117-220). `website` = `v.contacto` ("web o tel"): de ahí los 82 sitios sin esquema y `tehmp.lo` [SUPUESTO con evidencia fuerte]. <br>Usa un modelo retirado (IATOS-031). <br>Fallaba en 500 antes que en 401 (IATOS-110, corregido en sec2). <br>El panel actual ni siquiera la llama: lee la tabla directo. |
| Lugares | `places-search` (Text Search), `place-details` (incluye `businessStatus`), `places-nearby`, `tripadvisor-search` (TripAdvisor o SerpApi Google Maps), `geocode`, `geocode-address`; cliente `src/lib/googleMaps.ts` | Coordenadas y estado "abierto / cerrado" al curar; descubrimiento bajo demanda | `place-details` pide `reviews` y horarios. Eso puede subir la tarifa por solicitud. Para Privé basta una máscara mínima (ver Alianzas §7). |
| Rutas | `get-routes` (Routes API v2, 4 modos); `getRoutes()` en `googleMaps.ts:119-127` | Traslado exacto **solo a petición** | Gratis hasta 10,000 al mes y después USD 5 por mil (`IATOS_COSTOS_UNITARIOS.md:53`). |
| Imágenes | `pexels-image` (caché de 7 días en `serp_cache`); `buscar-video` | **Fuente única de imágenes (decisión del dueño)** | Hoy devuelve `{image, photographer}`. Faltan `photographer_url`, la página de la foto y `alt`, que pide la guía de Pexels. Es un cambio menor. |
| Afiliados | `src/lib/affiliateLinks.ts` (`getYourGuideLink`, `viatorLink`, Travelpayouts, Welcome Pickups); tabla `affiliate_clicks` | Etiqueta "reserva externa" en Extraordinary y Yate y mar | La atribución vía `tp.media` no está verificada (IATOS-077). Los botones podrían fallar en iPhone (IATOS-039). |

---

## 2. Auditoría de enlaces y datos de `nightlife_premium`

### 2.1 Datos de producción (verificados hoy por el equipo, solo lectura)

| Medida | Valor |
|---|---|
| Filas / ciudades | 194 / 18 |
| Por ciudad | Nueva York 15, Londres 15, Ciudad de México 14, Bangkok 13, París 13, Madrid 12, Las Vegas 11, Milán 11, Atenas 10, Roma 10, Saint-Tropez 10, Miami 10, Tokio 9, Dubái 9, Ibiza 8, Mykonos 8, Berlín 8, Tulum 8 |
| Categorías | speakeasy 41, members_club 37, rooftop 36, jazz_lounge 23, cabaret 20, evento_vip 19, burlesque 9, casino_vip 9. Nada de gastronomía ni de experiencias. |
| Coordenadas | 0 de 194 (`lat`/`lng` vacíos) |
| Sitio web | 188 con sitio; 6 sin sitio; **82 sin `http(s)://`** |
| Afirmaciones no comprobables | **47** ("el más exclusivo del mundo", "#1"…) |
| Precio | 95 con €, 97 con $: no es una escala única |
| Fuente y fecha de verificación | No existen columnas |
| Antigüedad | Todas creadas entre el 2026-05-29 y el 2026-06-08: **más de 90 días**. Por la regla de frescura, todas están "por verificar". |
| Duplicados en CDMX | Hanky Panky ×2 (dos dominios distintos), Parker & Lenox ×2, Soho House ×2 |
| Sondeo de sitios de México | 5 de 17 no respondieron: `restauranteelmayor.com.mx`, `handshakespeakeasy.com`, `hankypanky.com.mx`, `bonbonniere.com` y `tehmp.lo` (mal formado). "Naná Rooftop Bar" apunta a `tripadvisor.com`. `gitano.com` responde, pero hay que comprobar que sea Gitano Tulum. |
| `nightlife_access` | 2 usuarios, ambos `password_unlocked` y `confirmed_adult`. Los 11 usuarios reales tienen PRO de cortesía. |

**Conciliación con el repo [VERIFICADO]:** la migración `20260529162313_…sql` siembra **28** filas en 11 ciudades. Las otras 166 no están en el repo. Es la deriva descrita en **IATOS-072**. El origen más probable es `nightlife-discover`, que inserta lo que devuelve la IA [SUPUESTO]. Con la RLS del repo (solo `GRANT SELECT` a `authenticated`, sin política de `INSERT`), ese insert con el token del usuario debería fallar. Entonces las filas entraron con otra credencial o por SQL directo. Conviene que el dueño exporte la tabla para auditarla completa (ver 2.3).

### 2.2 Sondeo de los 28 sitios del repo [VERIFICADO 2026-10-22]

- **Método:**
  - script `…/scratchpad/prive/link_audit.mjs`;
  - normaliza a `https://`, pide HEAD y, si falla, GET;
  - tiempo límite de 15 s, sigue redirecciones y reintenta una vez si hay error de red;
  - compara el dominio final con el nombre;
  - detecta dominios de agregadores (TripAdvisor, Google, redes sociales) y páginas de cadena;
  - detecta duplicados por nombre normalizado más ciudad, superlativos y símbolo de moneda contra el país.
- **Resultados:** `…/scratchpad/prive/seed_link_audit.csv` y `seed_link_audit_summary.json`.
- **Costo:** ninguna API de pago.

| Ciudad | Filas | Responde | No responde / bloquea | Página de cadena (no del lugar) | Superlativos | Moneda incoherente | Sin coordenadas |
|---|---|---|---|---|---|---|---|
| París | 4 | 4 | 0 | 0 | 1 | 0 | 4 |
| Londres | 4 | 3 | 1 (Sushisamba: 404 en `/london`) | 0 (Connaught redirige a `maybourne.com`: revisar) | 2 | **4 (€ en Reino Unido)** | 4 |
| Nueva York | 4 | 4 | 0 | 1 (Top of The Standard → `standardhotels.com`) | 1 | 0 | 4 |
| Las Vegas | 3 | 1 | 2 (dominios de `mgmresorts.com`: tiempo agotado) | 1 (Absinthe → `spiegelworld.com`) | 0 | 0 | 3 |
| Ciudad de México | 4 | 3 | 1 (Four Seasons: 403 a robots, revisar a mano) | 1 (Soho House → `sohohouse.com` genérico) | 1 | 0 | 4 |
| Dubái | 2 | 1 | 1 (`sohogardendxb.com`: conexión agotada) | 1 (CÉ LA VI → `dxb.celavi.com`) | 0 | 0 | 2 |
| Tokio | 2 | 2 | 0 | 0 | 0 | 0 | 2 |
| Berlín | 1 | 1 | 0 | 1 (`sohohouse.com` genérico) | 1 | 0 | 1 |
| Ibiza | 2 | 2 | 0 | 1 (`experimentalgroup.com`) | 1 | 0 | 2 |
| Miami | 2 | 1 | 1 (`east-miami.com`: el socket se cierra; ¿sigue operando? SUPUESTO, verificar) | 0 | 0 | 0 | 2 |
| **Total** | **28** | **22** | **6** (5 sin respuesta + 1 bloqueo) | **6** | **7** | **4** | **28** |

**Lectura:**
- Incluso las 28 filas "buenas" (sembradas a mano) necesitan revisión: 1 de cada 5 no abre y 1 de cada 5 lleva a una página de cadena, no a la del lugar.
- No hay duplicados dentro del seed. Los duplicados de CDMX vienen de las filas añadidas después.

### 2.3 Para auditar las 194

Con una exportación de solo lectura que haga el dueño (`select * from nightlife_premium` a CSV o JSON), se corre `NODE_USE_ENV_PROXY=1 node link_audit.mjs --export filas.csv`. El mismo script audita los archivos de curaduría (`--content content_g1.json …`) antes de cargarlos.

### 2.4 Decisión sobre las filas heredadas

Ver [Modelo de datos §5](IATOS_PRIVE_MODELO_DE_DATOS.md#5-compatibilidad-con-nightlife_premium-y-deduplicación).
- Las 194 pasan al modelo nuevo con estado **PENDIENTE** y quedan ocultas en Privé.
- Las que los curadores marcan `keep_existing` se fusionan con su versión corregida.
- Las que marcan `replaces_existing_name` se desactivan con un enlace a su reemplazo.
- Nada se borra.

---

## 3. Acceso: los dos estados que conviven hoy

| Tema | Rama `claude/iatos-world-class` (hoy) | Rama `claude/wc-sec2` (en curso, otro ingeniero) | Qué hace Privé |
|---|---|---|---|
| Quién ve los lugares | Cualquier sesión (RLS `active = true`) | `active AND members_access()` | Política propia sobre la tabla nueva con `prive_digital_access()`, que **delega** en `members_access()` |
| Banderas del cliente | `confirmedAdult = true`, `passwordUnlocked = true` fijas en `MembersOnlyPanel.tsx:58-60` | Reemplazadas por `fetchMembersAccess()` y el adelanto `MembersTeaser` | Ninguna bandera del cliente decide acceso. El cliente solo **muestra** lo que la RLS devuelve. |
| Contraseña | Hash en `members_gate`; desbloqueo en el servidor con límite de intentos | Contraseña temporal con caducidad, apagada por omisión, revocable | No se usa en Privé. Si el dueño la enciende, cuenta como acceso Digital hasta su caducidad (lo decide `members_access()`). |
| Reservar | `concierge-action` sin revisar el plan | Exige `members_access` para `members_nightlife_reservation` | El mismo chequeo para `prive_request` |
| 18+ | `nightlife-discover` revisa `confirmed_adult`; el panel lo da por hecho | Igual | Declaración por RPC con versión de términos; universos 18+ filtrados por RLS |
| Prueba gratis, PRO, cortesía, vencido | `is_pro` (comped siempre; active y trialing vigentes) | Igual | Igual. Vencido = sin acceso; lo guardado y las solicitudes siguen visibles para su dueño |

---

## 4. Conciliación con el backlog

| ID | Relación con Privé | Qué hacer |
|---|---|---|
| **DEC-06 / F-16** | Contraseña de Members comprometida | La resuelve sec2. Privé no usa contraseña. |
| **DEC-07 / IATOS-013** | Members = beneficio PRO validado en el servidor | Privé Digital = `members_access()`. |
| **IATOS-031** | `nightlife-discover` usa un modelo retirado e inventa lugares | Retirar de Privé. El "descubrimiento bajo demanda" usa búsqueda de lugares real y etiquetada (ver Cobertura §5). |
| **IATOS-110** | Robustez de `nightlife-discover` | Lo cierra sec2. Pierde relevancia al retirarla. |
| **IATOS-072** | Deriva entre repo y producción | 166 filas solo en producción. La carga de Privé se hace por migración + cargador versionado. |
| **IATOS-081** | Clics contados como reservas; el usuario escribe `status` | Privé separa clic externo (métrica), solicitud y confirmación con evidencia. Agrega el candado de `status` en `concierge_requests` (**nuevo hallazgo, propuesto como IATOS-114, P1 de datos**). |
| **IATOS-025** | "Solicitud enviada" que parece confirmada | Privé usa los estados del ciclo; "confirmado externamente" solo con evidencia. |
| **IATOS-028** | Viaje activo único | Ya resuelto: Privé usa `resolveActiveTrip`. |
| **IATOS-029** | *Prompt injection* por datos de terceros | La descripción de un lugar y los resultados de búsqueda entran a Iato como **datos**, nunca como reglas. |
| **IATOS-030 / IATOS-089** | Promesas sin respaldo | Prohibido "VIP", "exclusivo" y "acceso garantizado" sin contrato (ver Calidad §4). |
| **IATOS-039 / IATOS-077** | Enlaces de afiliado en iPhone; atribución sin verificar | Probar antes de usarlos en Extraordinary (Pruebas T-87 y T-88). |
| **IATOS-014 / 015 / 017** | APIs de pago sin presupuesto; SerpApi casi agotado | Privé no consume SerpApi salvo el descubrimiento bajo demanda, apagado por omisión y con tope. |
| **IATOS-048** | `isPro` y las cuotas fallan abiertos en el cliente | La RLS decide; el cliente solo muestra. |
| **IATOS-106 / 109** | `trip_id` sin validar; notificaciones arbitrarias | Ya corregidos en sec2 para `concierge_requests` y `notifications`. |

### 4.1 Hallazgo nuevo propuesto

**IATOS-114 · P1 (datos y permisos) · El usuario puede cambiar el estado de sus solicitudes de concierge**
- **Archivo:** `supabase/migrations/20261022141600_sec2_trip_id_checks.sql:48-51`.
- **Problema:** la política `FOR UPDATE USING (auth.uid() = user_id)` no limita columnas. Desde la consola del navegador, un usuario puede poner `status = 'confirmada'` o reescribir `payload`.
- **Corrección:** un trigger de guarda (como `nightlife_access_guard_unlock`) permite al cliente solo `status → cancelado` sobre lo suyo. Todo lo demás pasa por una RPC del servidor que registra el historial. Detalle en [Modelo de datos §6](IATOS_PRIVE_MODELO_DE_DATOS.md#6-ciclo-de-una-solicitud-recomendado--guardado--solicitado--confirmado).
- **Severidad:** como toca datos y permisos, queda fuera de la regla "Privé es P2" y debe entrar al lote de seguridad.

---

## 5. Brechas (lo que no existe)

1. Catálogo normalizado de destinos (hoy: listas fijas en `MembersOnlyPanel.tsx:23` y `src/lib/countriesCities.ts`).
2. Modelo de experiencias con 12 universos, estados de calidad, disponibilidad separada, relación comercial y créditos de imagen.
3. Historial de solicitudes, persona responsable y evidencia de confirmación.
4. Métricas de vista → detalle → solicitud → confirmación.
5. Puntuación personal determinista y "por qué para ti" escrito desde hechos.
6. Herramienta `search_prive` en Iato.
7. Créditos completos de Pexels en `pexels-image`.
8. Derecho separado (apagado) para Privé Signature.
9. Proceso humano de verificación con cadencia.
