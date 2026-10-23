# IATOS · Misión God Mode · Inventario de preservación (ANTES)

Auditoría de solo lectura sobre `origin/main` @ `f1cc3e4` (23-oct-2026). No se cambió código.
Uso: antes de cada fase God Mode, comparar contra esta lista; al cerrar la fase, repetir el inventario (DESPUÉS) y marcar cualquier diferencia. **Ninguna fila puede desaparecer.**

Candados del dueño (de `IATOS_HALLAZGOS_PRIORIZADOS.md`, sección MISIÓN GOD MODE): no eliminar ninguna función de Concierge PRO; negro y dorado; identidad de Privé; invitación, ceremonia y Grand Welcome intocables; PRO Fundadores $99 MXN y regla de 90 días intocables; nada inventado; una sola inteligencia (Iato) para PRO y Privé.

---

## A. Concierge PRO

### A.1 Rutas
| Ruta | Archivo | Nota |
|---|---|---|
| `/dashboard/concierge` | `src/pages/Concierge.tsx` (783 líneas) | `ProtectedRoute`. Pestañas `?tab=chat` (por omisión) y `?tab=members` |
| `/dashboard/members` | `src/App.tsx:177` | Redirige a `/dashboard/concierge?tab=members` (enlaces viejos: conservar) |
| `/dashboard/reservas` | `src/pages/Reservas.tsx` | Monta `src/components/reservas/AiReservationsPanel.tsx` (Reservas IA, apagado por bandera) |
| `/dashboard/planear` · `/dashboard/ruta` · `/dashboard/explorar` | `src/pages/PlanTrip.tsx` · `MultiDestRoute.tsx` · `ExploreDestinations.tsx` | Planear viaje / multidestino / Explorar destinos (ver matriz) |

### A.2 Botones y acciones visibles (Concierge.tsx y componentes)
**Cabecera (`Concierge.tsx:465-530`)**
| Elemento | Archivo | Qué hace |
|---|---|---|
| Avatar del viajero (compacto) | `src/components/TravelerAvatar.tsx` | Lee `ai_user_preferences`, `travel_profiles`, `profiles`; botón "evolucionar" → función `evolucionar-dna` |
| Botón **Fixer** | `src/components/FixerButton.tsx` | Inserta `fixer_escalations`, abre WhatsApp y manda correo con `enviar-email-fixer` (Resend) |
| Etiqueta de ubicación (MapPin) | `src/lib/conciergeLocation.ts` | GPS del navegador con `GEO_GIVE_UP_MS`; etiqueta de lugar físico |
| **Selector de viaje** | `src/components/concierge/TripContextSelector.tsx` + `src/lib/activeTrip.ts`, `src/lib/profileActiveTrip.ts` | Viaje en contexto (fijado por el usuario o resuelto); separado de la ubicación física |
| Botón "Actualizar ubicación y viajes" | `Concierge.tsx:497` | Refresca GPS y viajes (también solo cada minuto) |
| **"Lo que Iato recuerda de ti"** | `src/components/concierge/IatoMemoryPanel.tsx` | Ver y borrar conversaciones (`concierge_conversations`), mensajes (`behavioral_insights`) y "Borrar todo" (también limpia `ai_user_preferences.dna_signal`) |
| Encabezado según plan | `src/components/concierge/ConciergeHeading.tsx` | Usa `useSubscription` (PRO, prueba, días restantes) |
| Pestañas **Concierge / Members Only** | `Concierge.tsx:511-526` | Línea dorada bajo la activa |
| Clima actual | `src/lib/metNorway.ts` | MET Norway con atribución (`MET_ATTRIBUTION`) |
| Notificaciones en vivo | `Concierge.tsx:266` | Realtime de `notifications` del usuario |

**Conversación y compositor (`Concierge.tsx:551-646`)**
| Elemento | Archivo | Qué hace |
|---|---|---|
| Mensaje de bienvenida + **Atajos** (lista vertical, botón "Atajos") | `src/lib/conciergeChips.ts` (`buildChips`, `welcomeText`) | Chips: **"¿Mi vuelo / ¿XX123 va a tiempo?"** (abre `FlightStatusDialog`), **"Cena cerca"** (cerca del hotel o de ti), **"Pedir transporte"**, **"Emergencia local"** (abre panel), **"Equipaje Invisible"**, **"Mi viaje a …"** |
| **Modo exigente** (interruptor + "¿Qué hace?") | `Concierge.tsx:119, 429-453, 579`; servidor `god_mode` | Modelo más capaz y más opciones; apagado por omisión; insignia "Modo exigente" con corona en cada respuesta |
| Caja de texto "Mensaje para Iato" | `Concierge.tsx:616` | Envío por streaming (`src/lib/conciergeStream.ts` → SSE de `concierge-chat`) |
| **Dictado por voz** (Mic) | `Concierge.tsx:386, 621-630` | Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`), aviso si no hay soporte |
| Enviar | `Concierge.tsx:633` | |
| "Elige el viaje" (cuando Iato duda) | `Concierge.tsx:755-760` | `chooseTripAndRetry` |
| Respuesta incompleta | `incompleteReplyText` en `conciergeStream.ts` | Texto honesto si se corta el stream |
| Historial | `src/lib/conciergeHistory.ts` | Recarga la conversación de `concierge_conversations` |
| Paneles en vivo **Transporte / Cena / Emergencia** | `src/components/ConciergeActions.tsx` | `places-nearby` y `geocode-address`; emergencia con pestañas hospital/policía/farmacia/embajada y números por país (`emergencyNumbers.test.ts`) |
| Estado de vuelo | `src/components/FlightStatusDialog.tsx` | Función `flight-status` |

**Tarjetas de respuesta (`src/components/concierge/ConciergeCards.tsx`)** — tipos válidos del servidor (`concierge-chat/cards.ts:12`): `flight`, `hotel`, `attraction`, `restaurant`, `place`, `source`, `transport`, `alert`, `luggage`, `jet`.
| Acción en tarjeta | Destino |
|---|---|
| Etiqueta de precio con frescura (`CONSULTADO_EN_VIVO` / `OBSOLETO` / `NO_VERIFICADO` / `SOLICITUD_HUMANA`) | `_shared/priceFreshness.ts` |
| Botón afiliado / proveedor (`ActionButton`), registro de clic | `affiliate_clicks`, `src/lib/trackBooking.ts` |
| **"Llévame"** | `src/components/concierge/TakeMeThereButton.tsx` + `src/lib/takeMeThere.ts` (Maps URLs `api=1`, `destination_place_id`, `dir_action=navigate` solo móvil, sin origen inventado) |
| Enlaces de lugar: sitio, llamar, OpenTable, Google Maps | `concierge-chat/actions.ts:389-403` |
| "Solicitar" (reservation / alert / pickup / jet) | `concierge-action` → `concierge_requests` + aviso a un humano por correo |
| Tarjetas `jet` y `luggage` | Siempre `SOLICITUD_HUMANA`, sin precio ("Solicitar cotización"): no hay proveedor (`cards.ts:470`) |

**Acciones propuestas por Iato (`src/components/concierge/ActionCard.tsx`, `concierge-chat/actions.ts:13`)** — se ejecutan solo si el usuario confirma: `create_trip`, `add_itinerary_item`, `add_expense`, `add_packing_items`, `create_price_alert`, `track_flight`, `save_place`, `update_trip_hotel`, `fixer_request` (tipos `reservation`, `transport`, `rebooking`, `luggage`, `other`), `prive_request`, `export_calendar` (cliente), `open_emergency` (cliente).

**Members Only (`src/components/MembersOnlyPanel.tsx`)** — catálogo de lugares (`src/lib/membersVenues.ts`, `VenueDetailDialog.tsx`; la función `nightlife-discover` existe pero ningún componente de Concierge la llama); acceso decidido por el servidor (`members_access`); solicitud `members_nightlife_reservation` vía `concierge-action`.

### A.3 Herramientas de IA
**`concierge-chat` (`toolDefs.ts`, mapa `index.ts:67-73`)**
| Herramienta | Función / proveedor |
|---|---|
| `check_flight_status` | `flight-status` (SerpApi; respaldo Perplexity marcado) |
| `search_flights` | `flights-search` (SerpApi Google Flights; Travelpayouts como referencia) |
| `search_hotels` | `hotels-search` (SerpApi Google Hotels) |
| `search_places` | `places-search` + `place-details` (Google Places New; respaldo SerpApi Maps) — `concierge-chat/index.ts:697-714`. **Ojo:** la auditoría de Google APIs propone borrar `places-search` y `place-details`; hacerlo rompería esta herramienta |
| `search_nearby` | `places-nearby` (Google Places Nearby) |
| `web_search` | `webSearch.ts`: SerpApi Google web con caché 24 h (`serp_cache`), respaldo Wikipedia |
| `search_attractions` | `tripadvisor-search` (TripAdvisor o SerpApi Maps) |
| `search_members_venues` | catálogo Members Only (base) |
| `search_prive` | `prive.ts`: catálogo Privé con la sesión Privé del usuario |

Módulos que no se pueden perder: `planner.ts` (intenciones y prefetch), `location.ts` + `turnPlace.ts` (ubicación física / viaje / destino pedido), `context.ts`, `cards.ts` (validación y evidencia), `guard.ts`, `finalize.ts`, `brevity.ts`, `roadtrip.ts`, `priveKeyMode.ts` (`mode: "prive_key"`, sin modelo), `actionExec.ts`, `loop.ts`, `anthropic.ts`, `router.ts`, `stream.ts`, `errors.ts`.

**`concierge-action` (`supabase/functions/concierge-action/index.ts`)** — tipos: `reservation`, `alert`, `pickup`, `jet` (desde tarjetas), `members_nightlife_reservation` (exige `members_access`), `prive_request` (RPC `prive_request_create`, exige sesión Privé). Escribe `concierge_requests` (`status = 'solicitado'`), `notifications` y manda correo de operaciones a `FIXER_EMAIL` (por omisión `hola@traveliatos.life`). Respuesta: `confirmation_required: true` ("todavía no es una reserva").

### A.4 Hooks y librerías del cliente
`useAuth` (`src/contexts/AuthContext.tsx`), `useSubscription` (+ `notifyAccessChanged`), `useActiveTrip` (`src/hooks/useActiveTrip.ts`); libs `activeTrip`, `profileActiveTrip`, `localDate`, `conciergeStream`, `conciergeChips`, `conciergeHistory`, `conciergeLocation`, `takeMeThere`, `priveSession` (Iato sabe si hay sesión Privé), `metNorway`, `authRestore`, `trackBooking`, `analytics`.

### A.5 Funciones edge que usa Concierge
Directas desde la pantalla: `concierge-chat`, `concierge-action`, `places-nearby`, `geocode-address`, `flight-status`, `enviar-email-fixer`, `evolucionar-dna`. Desde `concierge-chat` (herramientas y acciones): `flights-search`, `hotels-search`, `tripadvisor-search`, `places-search`, `place-details`, `price-watch` (`create_price_alert`), `track-flight` (`track_flight`). Relacionadas fuera de la pantalla: `booking-bridge` / `booking-go` (salida al proveedor desde el viaje), `serpapi-quote`, `ai-reservations` (apagada).

### A.6 Permisos y cuotas
| Regla | Dónde |
|---|---|
| Ruta protegida (sesión IATOS) | `ProtectedRoute` en `App.tsx` |
| Cuota de mensajes: gratis 3/mes; PRO 100/mes **solo si** `app_flags.pro_limits_enforced = true` (hoy `false` → ilimitado) | `20261022135100_pay_plan_limits.sql`; `reserveQuota(..., "concierge")` en `concierge-chat/index.ts` |
| Límite de ritmo 10/min y 120/h | `concierge-chat/index.ts` (ver `IATOS_COSTOS_UNITARIOS.md` §2.3) |
| Modo exigente: tope diario `app_flags.concierge_exigente_daily_limit` = `null` (sin tope); al pasarlo responde en modo normal y lo dice | `20261023130000_concierge2_runtime_config.sql` |
| Modelos por nivel: `app_flags.concierge_models` (`claude-haiku-5-5` rápido, `claude-sonnet-5-5` capaz, respaldo gateway) | ídem |
| Búsquedas en vivo del plan (`live_search_take`) | `webSearch.ts`, funciones de búsqueda |
| Members Only solo PRO (`members_access`); `members_requires_prive = false` | `MembersOnlyPanel.tsx`, `concierge-action` |
| `concierge_requests` sin escritura desde el cliente | `20261022146300_sec_concierge_requests_server_only.sql` |

### A.7 Pruebas que lo cubren (Vitest, `src/test/`)
`concierge2Actions`, `concierge2Client`, `concierge2Core`, `concierge2Evals`, `concierge2Honesty`, `conciergeCards`, `conciergeChatUi`, `conciergeContextoLugar`, `conciergeCtaHosts`, `conciergeErrors`, `conciergePlanCopy`, `conciergeTools`, `conciergeUbicacion`, `takeMeThere`, `precioVerificable`, `iatoEvals`, `rendimientoIato`, `roadtripIato`, `searchPrive`, `priveKeyMode`, `audIatoCierre`, `audIatoMejoras`, `audIatoRefutados`, `fixerEmail`, `flightStatus`, `emergencyNumbers`, `membersGate`, `membersMore`, `gastosMembersUx`, `activeTripPages`, `profileActiveTrip`, `dashboardActiveTrip`. SQL: `supabase/tests/concierge2`, `members_more`, `cost`, `security`.

---

## B. IATOS Privé

### B.1 INTOCABLES (invitación, ceremonia, Grand Welcome, activación)
Ningún cambio de texto, tiempos, animación, estilo o flujo sin GO explícito del dueño.
| Pieza | Archivos |
|---|---|
| Invitación (ruta `/prive/invitacion`) | `src/pages/prive/PriveInvitation.tsx` |
| Sobre | `src/components/prive/Envelope.tsx` |
| Contraseña Privé | `src/components/prive/PasswordCreator.tsx`, `src/lib/privePassword.ts`, `src/lib/priveCredential.ts` |
| Usuario Privé | `src/components/prive/PriveUsernameField.tsx` |
| Grand Welcome | `src/components/prive/GrandWelcome.tsx` (montado en `PriveHub.tsx:315`) |
| Ceremonia / onboarding | `src/components/prive/PriveOnboarding.tsx`, `src/lib/priveOnboarding.ts` (`shouldAutoPlayWelcome`, `onboardingResumeStep`) |
| Candado | `src/components/prive/LockScreen.tsx` (`PriveHub.tsx:310`) |
| Identidad visual | `Monogram.tsx`, `MemberCard.tsx` (tarjeta Rose Gold / Special Edition), `PriveSeal.tsx`, `prive.css`, `motion.ts`, `timings.ts`, `PriveLang.tsx`, `ProgressRing.tsx` |
| Sesión y acceso | `src/pages/prive/PriveRoot.tsx`, `src/lib/priveSession.ts`, `src/lib/priveApi.ts` (→ función `prive-access`), `PriveReset.tsx` (`/prive/restablecer`), `ReportCompromised.tsx` |
| Servidor | `supabase/functions/prive-access`, `prive-cron`, `prive-tenure-backfill`; `_shared/prive-core.ts`, `prive-email.ts`, `prive-invite-sender.ts`, `prive-tenure.ts` (regla de 90 días) |
| Tablas | `prive_invitations`, `prive_credentials`, `prive_sessions`, `prive_memberships`, `prive_membership_events`, `prive_grants`, `prive_password_resets`, `prive_auth_attempts`, `prive_ip_blocks`, `prive_age_confirmations` |
| Pruebas | `priveInvitation`, `priveAuth`, `priveEntry`, `priveAccess`, `priveTenure`, `priveMemberCardRango`, `priveEmail`, `priveEmailDeliverability`, `priveCore`; SQL `supabase/tests/prive` |
| Doc | `docs/iatos/IATOS_PRIVE_CINEMATIC_WELCOME.md`, `IATOS_PRIVE_INVITATIONS.md`, `IATOS_PRIVE_ONBOARDING.md` |

`PriveHub.tsx` es mixto: las ramas `locked` / Grand Welcome / onboarding son intocables; el resto (For You) se puede tocar con cuidado.

### B.2 Secciones (sí se pueden mejorar, sin quitar nada)
| Sección | Ruta | Archivos |
|---|---|---|
| **For You** (portada "Para ti") | `/prive` | `PriveHub.tsx`, `components/prive/home/ForYouHome.tsx`, `PersonalIdeas.tsx`, `UniversalSearch.tsx`, `sections.tsx`, `context.tsx`; `components/prive/key/ForYouSlots.tsx`, `useForYouData.ts`; `src/lib/priveKeyForYou.ts`; `PriveHero.tsx`, `UniverseTiles.tsx`, `PriveCatalogSlot.tsx` |
| **Explorar** (+ **mapa**, **¿cuándo ir?**, **ruleta**) | `/prive/explorar` | `PriveExplorePage.tsx`; `components/prive/explore/WorldMap.tsx` (mapa), `InspirationRoulette.tsx` (ruleta), `WhenToGo.tsx`, `MonthPicker.tsx`, `DestinationSheet.tsx`, `useExploreData.ts`, `useIdeas.ts`; `src/lib/priveExplore.ts`, `priveExploreGeo.ts` |
| **The Key** | `/prive/key` | `PriveKeyPage.tsx`; `components/prive/key/PriveKeyStudio.tsx`, `KeyQuestions.tsx`, `ProposalCard.tsx`, `QuickTaste.tsx`, `MyPlans.tsx`, `TripPickerDialog.tsx`, `YourWorldIsReady.tsx`; `src/lib/priveKey.ts`; servidor `concierge-chat/priveKeyMode.ts`, `_shared/priveKey.ts`, `priveKeyPlaces.ts`, `privePlanner.ts`; tablas `prive_key_plans` (`guardado`/`en_viaje`/`archivado`), `prive_key_events` |
| **Desk** | — | **No existe** una sección o componente "Desk". Lo más cercano: solicitudes Privé (`/prive/solicitudes`, `PriveRequestsPage.tsx`, `catalog/RequestDialog.tsx`) y el Fixer de Concierge |
| **Drops** (+ Privilege Radar) | `/prive/drops` | `PriveDropsPage.tsx`; `components/prive/value/DropCard.tsx`, `DropsTeaser.tsx`, `PrivilegeRadar.tsx`, `ValueOfYourPrive.tsx`, `PassportCard.tsx`; tablas `prive_drops`, `prive_radar_items`, `prive_value_entries`, `prive_passport_entries` |
| **Insider** | `/prive/insider`, `/prive/insider/:destino` | `PriveInsiderPage.tsx`; `value/InsiderTipCard.tsx`, `BeforeYouGo.tsx`, `EditorialFallback.tsx`; tablas `prive_insider_tips`, `prive_saved_tips` |
| **Revista** (THE PRIVATE EDITION) | `/prive/edicion/*`, `/prive/edicion/sin-conexion` | `src/pages/prive/edition/*`, `components/prive/edition/Magazine.tsx`, `MagazineReader.tsx`, `PrivateEditionTeaser.tsx`, `EditionContext.tsx`; `src/lib/priveEdition*.ts`; tablas `edition_*`; función `edition-link-check` |
| Catálogo | `/prive/destino/:slug`, `/prive/universo/:key`, `/prive/experiencia/:slug` | `PriveDestinationPage.tsx`, `PriveUniversePage.tsx`, `PriveExperiencePage.tsx`; `components/prive/catalog/*` (incluye `ExperiencePlanner.tsx`, `AddToTripDialog.tsx`, `AgeGate.tsx`) |
| Mi Privé / Membresía | `/prive/mi`, `/prive/membresia` | `PriveMyPage.tsx`, `PriveMembership.tsx` |
| Navegación | — | `components/prive/shell/PriveNav.tsx`, `PriveBack.tsx`, `PriveComingSoon.tsx` |

Pruebas de secciones: `priveHub`, `priveKeyForYou`, `priveKey`, `priveKeyUi`, `priveExplore`, `priveCatalogUi`, `privePlanner`, `priveValueUi`, `priveValueModel`, `priveValueCuration`, `priveMagazine`, `priveEdition*`, `priveReimagined`, `priveUx`, `priveUiContract`, `priveRequestTime`; SQL `prive_catalog`, `prive_key`, `prive_ideas`, `privevalor`, `edition`.
