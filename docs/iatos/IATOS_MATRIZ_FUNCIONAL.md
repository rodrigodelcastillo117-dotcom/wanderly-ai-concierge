# IATOS: matriz funcional

- **Fecha:** 2026-10-22. Rama `claude/iatos-world-class` (commit auditado `b5aca1b`). Producción: https://traveliatos.life
- **Documentos relacionados:** [IATOS_AUDITORIA_BASELINE.md](./IATOS_AUDITORIA_BASELINE.md) (método) e [IATOS_HALLAZGOS_PRIORIZADOS.md](./IATOS_HALLAZGOS_PRIORIZADOS.md) (detalle de cada ID).

## Cómo leer esta matriz

**Estado: uno solo por fila. Describe lo que corre hoy en producción.**

| Estado | Significado |
|---|---|
| **IMPLEMENTADO Y VERIFICADO** | Una prueba automática del repo importa el código real y prueba el comportamiento, o se verificó en vivo. |
| **IMPLEMENTADO PERO NO PROBADO** | Existe y está desplegado, pero ninguna prueba ni verificación en vivo demuestra que funcione bien. Que una función responda al *preflight* solo prueba que está desplegada. |
| **PARCIALMENTE IMPLEMENTADO** | Hace una parte de lo que promete. |
| **IMPLEMENTADO PERO DEFECTUOSO** | Hay un defecto demostrado o confirmado en el código. Si ya existe una corrección en la rama, se indica entre paréntesis, pero el estado sigue siendo el de producción. |
| **INEXISTENTE** | Se promete o se necesita, pero no hay código. |
| **BLOQUEADO** | Depende de algo externo (configuración, proveedor o decisión del dueño). |

**Columna Gratis/PRO.** Así está programado hoy, no como se anuncia.
- **Gratis:** cualquier cuenta registrada, sin límite diario; solo hay límites por minuto y por hora.
- **Cuota:** límite del servidor para cuentas gratis.
- **Anunciado PRO, gratis en la práctica:** aparece en la lista de beneficios PRO pero no se protege.
- **Público:** sin sesión.
- **Servidor:** lo invocan otras funciones o tareas.

## Resumen

| Tipo | Total | Verificado | No probado | Parcial | Defectuoso | Inexistente | Bloqueado |
|---|---|---|---|---|---|---|---|
| Rutas | 48 | 1 | 17 | 7 | 21 | 0 | 2 |
| Funciones de servidor | 53 | 0 | 32 | 3 | 17 | 0 | 1 |
| Módulos de plataforma y capacidades | 36 | 11 | 5 | 1 | 7 | 9 | 3 |

En los módulos, "verificado" incluye 5 elementos verificados en vivo: RLS, la migración de seguridad, el bucket `travel-moments`, la tarea de vuelos y la autenticación de cron. Los demás verificados lo están por pruebas automáticas.

---

## 1. Rutas (48)

| # | Ruta / módulo | Qué hace | Fuentes de datos | Estado | Gratis/PRO | Hallazgos |
|---|---|---|---|---|---|---|
| 1 | `/` Landing | Página de venta con el llamado a registrarse | Estática | IMPLEMENTADO PERO DEFECTUOSO | Público | IATOS-012, 089 |
| 2 | `/auth` | Iniciar sesión, registrarse, pedir el cambio de contraseña | Supabase Auth, `ai_user_preferences`, `travel_profiles` | IMPLEMENTADO PERO DEFECTUOSO | Público | IATOS-083, 084, 104 |
| 3 | `/reset-password` | Poner una contraseña nueva desde el correo | Supabase Auth (`PASSWORD_RECOVERY`, `updateUser`) | IMPLEMENTADO PERO DEFECTUOSO | Público | IATOS-041 |
| 4 | `/terminos` | Términos y condiciones | Estática (`Legal.tsx`) | IMPLEMENTADO PERO NO PROBADO | Público | IATOS-012, 013 |
| 5 | `/privacidad` | Aviso de privacidad | Estática | IMPLEMENTADO PERO NO PROBADO | Público | IATOS-108 |
| 6 | `/reembolsos` | Política de reembolsos | Estática | IMPLEMENTADO PERO NO PROBADO | Público | IATOS-049 |
| 7 | `/cookies` | Política de cookies, más el aviso de consentimiento | Estática, `CookieBanner` | IMPLEMENTADO PERO DEFECTUOSO | Público | IATOS-056 |
| 8 | `/onboarding` | 5 pantallas obligatorias: bienvenida, tarjetas, lealtad, Travel DNA y primer viaje | `user_onboarding_state`, `trips`, `travel_profiles`; funciones `evolucionar-dna`, `email-bienvenida` | IMPLEMENTADO PERO DEFECTUOSO (bucle P0; corrección en rama, pendiente de despliegue) | Gratis | IATOS-005, 090 |
| 9 | `/onboarding/deep` | Perfil de viajero de 17 pasos más el avatar | `ai_user_preferences`, `travel_profiles`, `profiles`; función `auditar-perfil` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-083 |
| 10 | `/dashboard` Inicio | Escribir un viaje en lenguaje natural, recomendaciones, próximos viajes, Smart Spend y herramientas | `profiles`, `trips` (los 2 últimos), `expenses`, open.er-api; función `recomendar-destinos` | PARCIALMENTE IMPLEMENTADO | Gratis | IATOS-028, 073, 082, 086, 103 |
| 11 | `/dashboard/planear` | Asistente de un destino, o modo "emoción"; analiza y crea el viaje | `profiles`; funciones `parsear-viaje`, `analizar-viaje` | IMPLEMENTADO PERO DEFECTUOSO | Cuota: 1 análisis de por vida | IATOS-042, 021, 022, 012 |
| 12 | `/dashboard/ruta` | Ruta de varios destinos con globo 3D | `profiles`, `trips`, `behavioral_insights`; funciones `logistics-plan`, `parsear-viaje` | IMPLEMENTADO PERO NO PROBADO | Gratis (evade la cuota) | IATOS-021, 026, 103 |
| 13 | `/dashboard/viajes` | Lista de viajes propios y compartidos | `trips`, `trip_collaborators`; función `pexels-image` | IMPLEMENTADO PERO DEFECTUOSO | Gratis | IATOS-085, 099 |
| 14 | `/dashboard/viajes/:id` | Centro del viaje: total, opciones por ciudad, cotización en vivo, alerta de precio, PDF, invitar, editar con IA | `trips`, `recomendaciones`; funciones `suggest-restaurants`, `serpapi-quote`, `price-watch` | IMPLEMENTADO PERO DEFECTUOSO (total = presupuesto, P0; corrección en rama) | Gratis | IATOS-007, 009, 035, 075, 026, 062, 039, 087 |
| 15 | `…/:id/editar` | Editar datos, re-analizar, borrar | `trips`; función `analizar-viaje` | IMPLEMENTADO PERO DEFECTUOSO | Gratis | IATOS-008 |
| 16 | `…/:id/live` | Modo en viaje: plan del día, acciones rápidas, SOS | `trips`, tabla fija de emergencias | PARCIALMENTE IMPLEMENTADO | Gratis | IATOS-043, 089 |
| 17 | `…/:id/mapa` | Mapa día por día | `trips`; función `geocode`, Google Maps | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 18 | `…/:id/packing` | Lista de equipaje con IA | `packing_lists`, `trips`; función `generar-packing-list` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-101, 106 |
| 19 | `…/:id/clima` | Pronóstico, o histórico si faltan más de 16 días | open-meteo | PARCIALMENTE IMPLEMENTADO | Gratis | IATOS-099 |
| 20 | `…/:id/traductor` | Frases clave del destino | `trips`; función `ai-tool` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-099 |
| 21 | `…/:id/diario` | Diario con fotos | `trip_journal_entries`, bucket `journal-photos` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-003, 054 |
| 22 | `…/:id/split` | Dividir gastos entre personas | `trip_split_people`, `trip_split_expenses` | IMPLEMENTADO PERO DEFECTUOSO | Gratis | IATOS-079 |
| 23 | `/dashboard/comparar` | Comparar de 2 a 4 destinos con IA | Función `ai-tool` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-091 |
| 24 | `/dashboard/convertidor` | Conversor de moneda (con caché offline) | open.er-api, localStorage | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-099 |
| 25 | `/dashboard/vuelos` | Búsqueda de vuelos en vivo y enlaces de afiliado | Función `flights-search` (SerpApi, Travelpayouts, IA); `bookings` | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Anunciado PRO, gratis en la práctica | IATOS-039, 024, 013, 102, 099 |
| 26 | `/dashboard/hoteles` | Búsqueda de hoteles en vivo, Booking y Airbnb | Función `hotels-search`; `bookings` | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Anunciado PRO, gratis en la práctica | IATOS-039, 024, 040, 077, 013 |
| 27 | `/dashboard/seguros` | Socios de seguro de viaje | `bookings` (clic), textos fijos | PARCIALMENTE IMPLEMENTADO | Gratis | IATOS-089, 039 |
| 28 | `/dashboard/beneficios` | "Beneficios IATOS PRO" (ofertas de terceros) | Estática, `bookings` (clic) | PARCIALMENTE IMPLEMENTADO | Anunciado PRO, gratis en la práctica | IATOS-013, 089 |
| 29 | `/dashboard/autos` | Enlaces a renta de autos | `bookings` (clic) | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 077, 089 |
| 30 | `/dashboard/esim` | Enlaces a eSIM | `bookings` (clic) | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 077 |
| 31 | `/dashboard/actividades` | Tours y actividades | Función `tripadvisor-search`; `bookings` | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 077 |
| 32 | `/dashboard/restaurantes` | Enlaces a reservar restaurante | `bookings` (clic) | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 081, 089 |
| 33 | `/dashboard/trenes` | Enlaces a trenes | `bookings` (clic) | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 081, 088 |
| 34 | `/dashboard/ferries` | Enlaces a ferris | `bookings` (clic) | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 088 |
| 35 | `/dashboard/cruceros` | Enlaces a cruceros | `bookings` (clic) | IMPLEMENTADO PERO DEFECTUOSO (probable en iOS) | Gratis | IATOS-039, 089 |
| 36 | `/dashboard/reservas` | "Mis reservas" | `bookings` | PARCIALMENTE IMPLEMENTADO | Gratis | IATOS-081, 082 |
| 37 | `/dashboard/descubre` | Recomendaciones de IA y guardar favoritos | `recomendaciones`; hook `useAIRecommendations` (probado) | IMPLEMENTADO PERO NO PROBADO (la página) | Gratis | IATOS-086 |
| 38 | `/dashboard/cercanos` | Lugares cercanos y "visitado" | `profiles`, `trips`, `visited_places`; funciones `nearby-places`, `mark-visited` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-028, 099, 014 |
| 39 | `/dashboard/favoritos` | Destinos guardados | `recomendaciones` | PARCIALMENTE IMPLEMENTADO | Gratis | IATOS-101 |
| 40 | `/dashboard/social` | Amigos por código, compatibilidad, insignias, misiones | `mis_amigos`, `profiles`, `badges`, `user_badges`; RPC `agregar_amigo_por_codigo`, `compatibilidad_viaje`; función `evaluar-logros` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-002, 053, 110, 104 |
| 41 | `/dashboard/smart-spend` | Redirige a `/dashboard/gastos` | — | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-101 |
| 42 | `/dashboard/gastos` | Gastos, Smart Spend, calculadora de ahorro | `expenses`, bucket `recibos` (privado), `TripSavingsCalculator` (probado) | IMPLEMENTADO PERO DEFECTUOSO | Gratis | IATOS-010, 082, 104, 054 |
| 43 | `/dashboard/concierge` | Chat con Iato, acciones rápidas, Members Only, Fixer | `trips`, `notifications`; funciones `concierge-chat`, `concierge-action`, `nightlife-discover`, `enviar-email-fixer`; open-meteo | IMPLEMENTADO PERO DEFECTUOSO (herramientas como error, P0; corrección en rama) | Cuota: 3 mensajes al mes (chat); resto anunciado PRO, gratis en la práctica | IATOS-006, 022, 023, 025, 028, 029, 030, 059, 060, 061, 087 |
| 44 | `/dashboard/pro` | Suscripción: checkout y portal de Stripe | RPC `get_access_state`, `subscriptions`; funciones `stripe-checkout`, `stripe-portal` | BLOQUEADO (Stripe en modo prueba) | — | IATOS-011, 012, 013, 018, 019, 020 |
| 45 | `/dashboard/admin` | Métricas para administradores | RPC `admin_metrics` (verifica `admins`), `health_checks` | IMPLEMENTADO Y VERIFICADO (`adminMetrics.test.tsx`) | Admin | IATOS-081, 069 |
| 46 | `/dashboard/perfil` | Perfil, avatar, Travel DNA, borrar cuenta, cerrar sesión | `profiles`, `ai_user_preferences`, `admins`; funciones `evolucionar-dna`, `delete-account` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-050, 052, 087 |
| 47 | `/dashboard/members` | Redirige a `/dashboard/concierge?tab=members` | (MembersOnlyPanel: `nightlife_premium`, función `nightlife-discover`) | BLOQUEADO (vida nocturna depende de un modelo retirado, IATOS-031) | Anunciado PRO, gratis en la práctica | IATOS-013, 031 |
| 48 | `*` 404 | Página no encontrada | — | IMPLEMENTADO PERO NO PROBADO | Público | IATOS-088 |

---

## 2. Funciones de servidor (53)

Las 53 están desplegadas: sondeo OPTIONS en vivo, 51 responden 200 y las 2 de cron responden 401 sin el secreto. Ninguna tiene una prueba de punta a punta del *handler*. Algunas tienen probados sus helpers puros (se indica).

| # | Función | Qué hace | Fuentes / proveedores | Estado | Gratis/PRO | Hallazgos |
|---|---|---|---|---|---|---|
| 1 | `ai-tool` | IA genérica (traductor, comparar) | Gateway de IA | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014, 091 |
| 2 | `analizar-preferencias-ruta` | Lee preferencias para la ruta multidestino | IA (`gemini-3-flash-preview`) | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 3 | `analizar-viaje` | Cotización completa de un destino (3 opciones) y correo | Claude `claude-sonnet-5-5` (respaldo Gemini), Perplexity, SerpApi, `travelpayouts-flights`, FX | IMPLEMENTADO PERO DEFECTUOSO (`enforceSources` sí está probado) | Cuota: 1 de por vida; PRO ilimitado | IATOS-009, 036, 037, 047, 063, 026, 074, 092, 052 |
| 4 | `auditar-perfil` | Analiza el perfil de viajero | IA | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-058 |
| 5 | `buscar-promociones` | Promociones de las tarjetas del usuario (bóveda) | Perplexity + Claude (modelo retirado) | IMPLEMENTADO PERO DEFECTUOSO | Anunciado PRO, gratis en la práctica | IATOS-031, 013, 029 |
| 6 | `buscar-video` | Video de destino | Pexels | IMPLEMENTADO PERO NO PROBADO | Gratis | — |
| 7 | `card-benefits-lookup` | Beneficios de una tarjeta | IA | IMPLEMENTADO PERO NO PROBADO | Anunciado PRO, gratis en la práctica | IATOS-013, 058 |
| 8 | `concierge-action` | Reservas, traslados, jet: crea una solicitud y manda un correo a un humano | Resend, `concierge_requests`, `notifications` | IMPLEMENTADO PERO DEFECTUOSO | Anunciado PRO, gratis en la práctica | IATOS-013, 025, 051, 014 |
| 9 | `concierge-chat` | Iato: chat con herramientas, memoria y elección de viaje | Gemini → Lovable (`aiFetch` probado), herramientas: `flights-search`, `hotels-search`, `tripadvisor-search`, `places-nearby`, `flight-status` | IMPLEMENTADO PERO DEFECTUOSO (recorte de herramientas, P0; corrección en rama) | Cuota: 3 al mes; PRO ilimitado | IATOS-006, 023, 024, 025, 026, 028, 029, 032, 047, 048, 059, 060 |
| 10 | `delete-account` | Borra la cuenta y cancela Stripe | Stripe, `purge_account_data` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-050, 018, 108 |
| 11 | `editar-viaje-ai` | Edita el viaje con IA y "recotiza" | IA (`gemini-2.5-pro`) | IMPLEMENTADO PERO DEFECTUOSO | Gratis | IATOS-027, 080 |
| 12 | `email-bienvenida` | Correo de bienvenida | Resend | BLOQUEADO (dominio sin verificar) | Gratis | IATOS-034 |
| 13 | `enviar-email-fixer` | Escalación al "Fixer humano" por correo | Resend, `fixer_escalations` | PARCIALMENTE IMPLEMENTADO | Anunciado PRO, gratis en la práctica | IATOS-030, 051, 034, 013 |
| 14 | `evaluar-logros` | Otorga insignias y misiones | BD (`user_badges`, `user_missions`) | IMPLEMENTADO PERO DEFECTUOSO (probable) | Gratis | IATOS-110 |
| 15 | `evolucionar-dna` | Actualiza el Travel DNA | IA | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 16 | `flight-status` | Estado de un vuelo | SerpApi (normalizador probado), Perplexity | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-032, 015, 014 |
| 17 | `flight-watch-cron` | Revisa los vuelos seguidos cada 15 min y avisa | SerpApi, `tracked_flights`, `notifications`, web push | IMPLEMENTADO PERO DEFECTUOSO (en vivo corre: 32 ejecuciones, 0 fallos; hoy 0 vuelos) | Servidor | IATOS-033, 032, 044, 065, 066, 067, 068, 017 |
| 18 | `flights-search` | Búsqueda de vuelos | SerpApi Google Flights, Travelpayouts, respaldo IA | IMPLEMENTADO PERO DEFECTUOSO | Anunciado PRO, gratis en la práctica | IATOS-024, 057, 014, 013, 015 |
| 19 | `generar-packing-list` | Lista de equipaje | IA | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 20 | `generate-avatar` | Genera el avatar (bucket `travel-moments`) | IA de imagen (Lovable) | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-003, 014 |
| 21 | `geocode` | Geocodificación | Google Maps | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 22 | `geocode-address` | Geocodificación de dirección | Google Maps | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 23 | `get-routes` | Rutas entre puntos | Google Routes | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 24 | `health-check` | Revisión diaria de proveedores y correo a los admins | Gemini, Lovable, Anthropic, SerpApi, Travelpayouts, Stripe; `health_checks`; Resend | PARCIALMENTE IMPLEMENTADO (`checks.ts` probado; el correo no llega) | Servidor | IATOS-034, 069, 070, 015 |
| 25 | `hotels-search` | Búsqueda de hoteles | SerpApi Google Hotels, respaldo IA | IMPLEMENTADO PERO DEFECTUOSO | Anunciado PRO, gratis en la práctica | IATOS-024, 040, 077, 013, 014 |
| 26 | `logistics-plan` | Plan multidestino con hoteles y vuelos por ciudad | IA (`gemini-2.5-pro`), `flights-search`, `hotels-search`, Travelpayouts, TripAdvisor | IMPLEMENTADO PERO DEFECTUOSO | Gratis (evade la cuota; logística anunciada como PRO) | IATOS-021, 026, 057, 014 |
| 27 | `mark-visited` | Marca un lugar como visitado | Google Places, IA | IMPLEMENTADO PERO NO PROBADO | Gratis (sin límite de frecuencia) | IATOS-014 |
| 28 | `nearby-places` | Lugares cercanos | Google Places | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 29 | `nightlife-discover` | Vida nocturna premium (Members Only) | Perplexity + Claude (modelo retirado) | IMPLEMENTADO PERO DEFECTUOSO | Anunciado PRO, gratis en la práctica | IATOS-031, 110, 013 |
| 30 | `parse-trip-file` | Extrae el viaje de un PDF o imagen | IA de visión | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-029, 064, 074, 081 |
| 31 | `parsear-viaje` | Interpreta texto libre ("Roma 5 días en marzo") | IA (respaldo del cliente `parseTripFallback`, probado) | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-064, 074 |
| 32 | `pexels-image` | Imagen de destino | Pexels | IMPLEMENTADO PERO NO PROBADO | Gratis | — |
| 33 | `place-details` | Detalle de un lugar | Google Places | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 34 | `place-photo` | Foto de un lugar | Google Places | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 35 | `places-nearby` | Cercanos para Iato | Google Places, respaldo SerpApi | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-094, 014 |
| 36 | `places-search` | Búsqueda de lugares | Google Places | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 37 | `price-watch` | Activa o desactiva la alerta de precio de un viaje | Travelpayouts / SerpApi, FX | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-038 |
| 38 | `price-watch-cron` | Revisa precios 2 veces al día y avisa si bajan | Travelpayouts / SerpApi, FX, `price_watches`, push (`rules.ts` probado) | IMPLEMENTADO PERO DEFECTUOSO (alertas falsas por FX; hoy 0 alertas) | Servidor | IATOS-038, 066, 095 |
| 39 | `push-subscribe` | Registra la suscripción a push | BD | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-096 |
| 40 | `recomendar-destinos` | Recomendaciones de destinos | IA | IMPLEMENTADO PERO NO PROBADO (la invocación desde el cliente sí está probada) | Gratis | IATOS-094, 014 |
| 41 | `resolver-fechas` | Interpreta fechas relativas | IA (`gemini-3-flash-preview`) | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-032 |
| 42 | `send-email` | Correo de invitación a un viaje | Resend | IMPLEMENTADO PERO DEFECTUOSO (*relay* abierto en producción; corrección en rama, pendiente de despliegue) | Gratis | IATOS-004, 034 |
| 43 | `serpapi-quote` | Cotización en vivo de vuelo + hotel | SerpApi, IA, FX | PARCIALMENTE IMPLEMENTADO | Anunciado PRO, gratis en la práctica | IATOS-076, 014, 074 |
| 44 | `share-trip-notify` | Avisa a los amigos que se compartió un viaje | `notifications`, `mis_amigos` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-109 |
| 45 | `stripe-checkout` | Crea la sesión de pago (prueba de 30 días) | Stripe | IMPLEMENTADO PERO DEFECTUOSO | — | IATOS-011, 012, 018, 020, 046, 093 |
| 46 | `stripe-portal` | Abre el portal de facturación | Stripe | IMPLEMENTADO PERO NO PROBADO | — | IATOS-093 |
| 47 | `stripe-webhook` | Sincroniza el estado de la suscripción | Stripe (firma verificada), `subscriptions` | IMPLEMENTADO PERO DEFECTUOSO | Servidor | IATOS-019, 045, 046, 049 |
| 48 | `suggest-packing` | Sugerencias de equipaje | IA | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-058 |
| 49 | `suggest-restaurants` | Restaurantes sugeridos | IA (sin fuente) | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-062 |
| 50 | `track-flight` | Activa o detiene el seguimiento de un vuelo | `tracked_flights` (llave de servicio) | IMPLEMENTADO PERO DEFECTUOSO (sin tope ni límite de frecuencia en producción; corrección en rama, pendiente de despliegue) | Gratis | IATOS-017, 044, 032 |
| 51 | `travelpayouts-flights` | Tarifas de Aviasales (fuente primaria del análisis) | Travelpayouts | IMPLEMENTADO PERO DEFECTUOSO | Servidor / Gratis | IATOS-036, 040, 078, 057 |
| 52 | `tripadvisor-search` | Atracciones y tours | SerpApi / TripAdvisor / Google | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-014 |
| 53 | `update-food-dna` | Actualiza las preferencias de comida | BD | IMPLEMENTADO PERO NO PROBADO | Gratis | — |

---

## 3. Módulos de plataforma y capacidades transversales (36)

| # | Módulo / capacidad | Qué hace | Fuentes de datos | Estado | Gratis/PRO | Hallazgos |
|---|---|---|---|---|---|---|
| 1 | RLS de la base | Protección por usuario en las 44 tablas | Postgres (verificado en vivo) | IMPLEMENTADO Y VERIFICADO (RLS activo en 44/44; quedan huecos P2 y P3) | — | IATOS-052, 053, 106, 107, 109 |
| 2 | Corrección de seguridad `20261022120000_security_p0_fixes.sql` | Cierra colaborador falso, amistad falsa, listado de buckets, cambio de dueño y escritura directa de vuelos | Postgres | IMPLEMENTADO Y VERIFICADO (aplicada y verificada en producción el 2026-10-22) | — | IATOS-001, 002, 003, 016, 017 |
| 3 | Bucket `recibos` | Recibos de gastos | Storage (privado) | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-054 |
| 4 | Bucket `journal-photos` | Fotos del diario | Storage (público; listado cerrado el 2026-10-22) | PARCIALMENTE IMPLEMENTADO (las URL públicas siguen abiertas) | Gratis | IATOS-003, 054 |
| 5 | Bucket `travel-moments` | Momentos y avatares | Storage (público; listado cerrado el 2026-10-22) | IMPLEMENTADO Y VERIFICADO (listado anónimo devuelve `[]`; el avatar público sirve) | Gratis | IATOS-003, 054 |
| 6 | Tarea `flight-watch-every-15-min` | Dispara `flight-watch-cron` | pg_cron + pg_net + Vault | IMPLEMENTADO Y VERIFICADO (en vivo: 32 corridas, 0 fallos) | Servidor | IATOS-033, 067 |
| 7 | Tarea `price-watch-twice-daily` | Dispara `price-watch-cron` (03:17 y 15:17 UTC) | pg_cron | IMPLEMENTADO PERO NO PROBADO (existe en vivo; sin corridas al hacer el inventario) | Servidor | IATOS-095 |
| 8 | Tarea `health-check-daily` | Dispara `health-check` (13:07 UTC) | pg_cron | IMPLEMENTADO PERO NO PROBADO (existe en vivo; sin corridas al hacer el inventario) | Servidor | IATOS-069 |
| 9 | Autenticación de cron (`isAuthorizedCron`) | Solo deja pasar llamadas con el secreto | `_shared/cron-auth.ts`, `verify_cron_secret` | IMPLEMENTADO Y VERIFICADO (en vivo responde 401 sin el secreto) | Servidor | IATOS-096, 072 |
| 10 | Registro de migraciones | Mantener el repo y producción iguales | `supabase_migrations` (35) contra el repo (49) | IMPLEMENTADO PERO DEFECTUOSO | — | IATOS-072 |
| 11 | Cuotas gratis (`consume_free_quota`, `get_access_state`, `is_pro`) | 3 mensajes al mes y 1 análisis | Postgres | IMPLEMENTADO PERO DEFECTUOSO | — | IATOS-047, 048, 092, 021 |
| 12 | Hook `useSubscription` | Lee el estado PRO en el cliente | RPC y tabla | IMPLEMENTADO Y VERIFICADO (`subscription.test.ts`, solo el mapeo) | — | — |
| 13 | Protección PRO en el servidor de los beneficios anunciados | Members, Fixer, cotizaciones, bóveda, logística | — | INEXISTENTE | Anunciado PRO | IATOS-013 |
| 14 | Muro de pago en la UI (`ProGate`, manejo de 402) | Invitar a PRO al agotar la cuota | `ProGate.tsx` (sin usar) | INEXISTENTE | — | IATOS-022 |
| 15 | Prueba automática de 30 días al registrarse | Lo que promete la página principal | — | INEXISTENTE | — | IATOS-012 |
| 16 | Cobro real con Stripe e IVA | Cobrar $99 MXN al mes | Stripe (modo prueba) | BLOQUEADO | PRO | IATOS-011 |
| 17 | Reembolsos y disputas | Reflejar un reembolso en el acceso | — | INEXISTENTE | PRO | IATOS-049 |
| 18 | Correo transaccional | Bienvenida, cotización, invitación, alertas | Resend vía Lovable (dominio sin verificar) | BLOQUEADO | — | IATOS-034 |
| 19 | Límites de frecuencia (`check_rate_limit`) | Límites por minuto, por hora y por IP | Postgres | IMPLEMENTADO PERO NO PROBADO (falla abierto; la IP viene de `X-Forwarded-For`) | — | IATOS-014, 048 |
| 20 | Cadena de respaldo de IA (`aiFetch`) | Gemini → `flash-latest` → Lovable | Gemini, Lovable | IMPLEMENTADO Y VERIFICADO (`aiFetch.test.ts`) | — | IATOS-058 |
| 21 | Origen del precio (`enforceSources`) | Tours y hoteles contra las listas en vivo | `analizar-viaje/sources.ts` | IMPLEMENTADO Y VERIFICADO (`tripSources.test.ts`; no cubre vuelos) | — | IATOS-026 |
| 22 | Insignia de origen (`PriceSourceBadge`) | "En vivo" contra "Estimado" | `fuente_precio` | IMPLEMENTADO PERO DEFECTUOSO | — | IATOS-026, 057 |
| 23 | Total del viaje (`RealTripTotal`) | Inversión total por grupo y por persona | `trips` | IMPLEMENTADO PERO DEFECTUOSO (corrección en rama, `realTripTotal.test.ts`) | — | IATOS-007, 035 |
| 24 | Calculadora de ahorro (`computeSavings`) | Cuánto ahorrar para el viaje | Local | IMPLEMENTADO Y VERIFICADO (`tripSavings.test.ts`) | Gratis | IATOS-099 |
| 25 | Reglas de alerta de precio (`rules.ts`) | ≥5 % y ≥$500, separación de 20 h, misma fuente | — | IMPLEMENTADO Y VERIFICADO (`priceWatch.test.ts`) | — | IATOS-038 |
| 26 | Tipo de cambio (`_shared/fx.ts` y copias) | USD/EUR → MXN | frankfurter, respaldo 20.5 | IMPLEMENTADO PERO DEFECTUOSO | — | IATOS-074, 073 |
| 27 | Marker de Aviasales | Atribución de vuelos | `affiliateLinks.ts` | IMPLEMENTADO Y VERIFICADO (`affiliateLinks.test.ts`, solo el texto) | — | IATOS-040 |
| 28 | Atribución `tp.media` (Booking, GYG, Viator…) | Comisión de los demás socios | Travelpayouts | BLOQUEADO (falta confirmar los programas) | — | IATOS-077 |
| 29 | Registro de clics (`trackBookingClick`) | Medir los clics de afiliado | `bookings` | IMPLEMENTADO PERO DEFECTUOSO | — | IATOS-039, 081 |
| 30 | Notificaciones en la app y push | Campana, tiempo real, web push (VAPID) | `notifications`, `push_subscriptions`, `sw.js` | IMPLEMENTADO PERO NO PROBADO | Gratis | IATOS-097, 068, 066 |
| 31 | "Viaje activo" único compartido entre módulos | Que todos hablen del mismo viaje | — | INEXISTENTE | — | IATOS-028 |
| 32 | Memoria de Iato visible y editable | Ver o borrar lo que Iato recuerda | `concierge_conversations` (sin UI) | INEXISTENTE | — | IATOS-059 |
| 33 | Set de evaluación automatizado de Iato | 20 casos deterministas (diseño en el informe B, C-3) | — | INEXISTENTE | — | IATOS-006, 023-029 |
| 34 | *Snapshot* y vigencia de la cotización; estados Pagado/Pendiente | Cotización fechada y trazable | — | INEXISTENTE | — | IATOS-080, 081 |
| 35 | Modo offline y bóveda de documentos | Itinerario y SOS sin red; boletos y pasaporte | `sw.js` (solo push) | INEXISTENTE | — | IATOS-100 |
| 36 | Telemetría y consentimiento | PostHog, Sentry, script de Travelpayouts | `index.html`, `analytics.ts`, `sentry.ts` | IMPLEMENTADO PERO DEFECTUOSO (carga antes del consentimiento; envía el correo) | — | IATOS-056, 108 |
