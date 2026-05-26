
# Wanderly — IATOS Hyper-Premium Rebuild

Goal: convert the existing app into the autonomous IATOS-style travel agent you described, reusing what's already built (Concierge, Vault, Multi-Destination autonomy, Pexels imagery, Smart Spend, behavioral_insights) and filling in the missing premium pieces. Black + champagne/gold + white typography is already the active design system, so this plan focuses on structure and behavior changes — no visual redesign of unrelated screens.

## 1. Home redesign — single Smart Planning entry point

- `src/pages/DashboardHome.tsx`: remove the dual "paso a paso" + "ruta multi-destino" split cards. Replace with **one** large CTA card:
  - Background: misty-mountain image (generate `src/assets/iatos-mist-mountain.jpg` via imagegen, premium quality).
  - Title: "¿Prefieres paso a paso?"
  - Button: "+ Iniciar travesía inteligente" → navigates to `/dashboard/planear?modo=conversacional`.
- Keep the existing "Platícame tu viaje…" inline AI input above it (this is the fast-path / free-form intent capture).
- Keep "Curado para ti", "Mis próximos viajes", "Smart Spend", "AI Concierge" sections unchanged.

## 2. Conversational profiling flow (10 questions)

- New page `src/pages/PlanConversational.tsx` (mounted under `/dashboard/planear` when `?modo=conversacional` or when user has no completed `ai_user_preferences`):
  - Step-by-step elegant Q&A UI (one question at a time, gold accents, progress dots).
  - 10 questions: Ritmo, Hospedaje, Presupuesto, Gastronomía, Intereses, Deal-breakers, Compañero, Mejor viaje previo, Nivel de Planificación, Propósito emocional.
  - Persists to `ai_user_preferences` (already exists with all these columns) and marks `completado=true`.
  - On finish: routes into the existing detection engine (section 3) with the captured intent + free-form destination prompt.

## 3. Destination detection engine (Single vs. Multi)

- New shared helper `src/lib/detectRouteIntent.ts`:
  - Heuristic + AI fallback (`lovable-ai` edge function with `google/gemini-3-flash-preview`): given a free-text intent, return `{ mode: 'single' | 'multi', destinations: string[], origin?: string }`.
  - Pure heuristic first (split on "→", "luego", "y luego a", "después", " a ", commas with capitalized tokens, multiple known city names). Fallback to AI only when ambiguous.
- Wire it in:
  - `DashboardHome` "Platícame tu viaje…" submit.
  - End of conversational flow.
  - `PlanTrip.tsx` initial parse.
- Route accordingly:
  - `single` → existing `PlanTrip` deep itinerary.
  - `multi` → existing `MultiDestRoute` with destinations pre-seeded.

## 4. Logistics layer (flights + trains + roadtrips + mandatory costs)

- New edge function `supabase/functions/logistics-plan/index.ts`:
  - Input: `{ origin, destinations[], dates, num_viajeros }`.
  - Uses Lovable AI (Gemini 3 flash) to produce a structured JSON via `Output.object`:
    - `flights[]` (origin↔first city, last city↔origin),
    - `internal_transport[]` (high-speed trains, scenic roadtrips with `suggested_stops[]` of small villages, local public transport notes),
    - `mandatory_costs` (city_taxes, visa_fees, currency_buffer_pct=3),
    - `total_estimado_breakdown`.
  - Called by both `PlanTrip` and `MultiDestRoute` after detection. Result merged into `trips.itinerario_json.logistics`.
- Render logistics as **transition cards** in the itinerary timeline (section 6).

## 5. Database additions

Migration (single batch):
- `user_vault_benefits` already exists ✅ — no change needed (already supports credit_cards, airline_alliances, hotel_loyalty, car_rentals).
- Add columns to `ai_user_preferences`:
  - `behavioral_insights jsonb default '{}'::jsonb` — aggregated learning signal (distinct from the per-event `behavioral_insights` table).
  - `trip_count integer default 0` (denormalized for fast autonomy gate).
- New table `check_ins` (Google Places–powered):
  - `id, user_id, trip_id, place_id, place_name, lat, lng, category, rating, notes, created_at`.
  - RLS: owner-only CRUD.
- DB trigger `on_checkin_insert` → updates `ai_user_preferences.behavioral_insights` (increments category counts, appends place_id) and `trip_count` when a check-in completes.
- DB trigger `on_trip_insert` → increments `ai_user_preferences.trip_count` per user.

(`user_visits` already exists and overlaps with `check_ins`. We'll reuse `user_visits` and just **add the trigger** to it instead of a new table — cleaner.)

## 6. Premium itinerary view (paso a paso)

Refactor `src/pages/TripDetail.tsx`:
- **Header**: Google Maps (dark-styled) with animated gold polylines connecting destinations. Uses the existing `google_maps` connector (browser key, `loading=async`, `callback=initMap`, no `mapId`, standard `google.maps.Marker`). Animate polyline draw using `setInterval` redrawing `strokeDashoffset`.
- **Vertical timeline**:
  - **Transition cards** (`🚄 Tren Italo: Roma → Florencia`, `✈ Vuelo IB-3401`, `🚗 Roadtrip Toscana — paradas: San Gimignano, Pienza`) from `logistics.internal_transport`.
  - **Day cards** with 4 lifestyle blocks tailored to profile flags from `ai_user_preferences`:
    1. Hospedaje (Boutique/Luxury based on `hospedaje_preferencias`)
    2. Gastronomía (Foodie/Michelin based on `estilo_comida`)
    3. Experiencias (based on `actividades_tarde` + intereses)
    4. Vida Nocturna (Jazz / Clubs, gated by ritmo & propósito)
- Pull these blocks from `trips.itinerario_json.days[].blocks` (generated by `logistics-plan` and existing `plan-trip` edge function — extend that function's prompt to produce these 4 blocks per day).

## 7. Progressive autonomy (already partially built)

- Centralize gate in `src/lib/useAutonomyLevel.ts`:
  - Reads `ai_user_preferences.trip_count` + `behavioral_insights` confidence.
  - Returns `'manual' | 'autonomous'` (autonomous when `trip_count >= 3`).
- `MultiDestRoute` and the new conversational flow both call this:
  - Manual → show Route Configuration modal (Time vs. Scenery vs. Smart Spend) — already exists in `MultiDestRoute`, factor out into a reusable `<RouteConfigModal />`.
  - Autonomous → skip modal, generate immediately, show the gold "✨ Wanderly ha optimizado automáticamente esta ruta para ti" banner (already exists in `MultiDestRoute`, reuse).

## 8. AI Concierge upgrades

Extend `src/pages/Concierge.tsx`:
- **Gold microphone** button using Web Speech API (`SpeechRecognition`) — voice notes transcribe into the chat input. Animated gold ring while recording.
- **Contextual awareness**: on mount, fetch the user's nearest-future `trips` row. If `fecha_salida <= today <= fecha_regreso`, show an "Estás de viaje" pill and surface two new quick actions:
  - **Modo Emergencia** (creates `concierge_requests` row with `type='emergency'`).
  - **Lounge Access** (reads `user_vault_benefits.credit_cards` for AMEX/Priority Pass and lists eligible lounges at the user's airport via Places API).
- **God Mode**: glowing gold toggle in the header. When ON:
  - Posts a `concierge_requests` row with `type='god_mode_reservation'` and the user's last conversation context as `payload`.
  - Edge function `god-mode-sniper` (new) simulates background polling: writes periodic `notifications` rows ("Buscando mesa en…", "Mesa encontrada en Osteria X — confirmar?"). Real reservation APIs are out of scope; this is realistic simulation flagged as such in the row metadata.

## 9. Maps & Check-ins

- New component `src/components/PlaceMap.tsx`:
  - Loads Google Maps JS via the connector browser key.
  - Renders markers for `trips.itinerario_json.days[].blocks[*].place` (already has lat/lng when produced by logistics-plan).
  - Marker click → InfoWindow with name, category, rating (from Places API New `places:searchText` or `places/v1/places/{id}` through the gateway), and a **📍 Registrar Visita** button.
  - Button posts to `user_visits` (existing table) which fires the trigger from section 5 → updates `behavioral_insights`.
- Used in `TripDetail` (header map + per-day inline maps optional) and in `/dashboard/cercanos` for nearby exploration.

## 10. Sidebar nav (already fixed left sidebar in `DashboardLayout`)

- Verify items: Inicio, Planear (conversacional), Mis viajes, Descubre, Cercanos, Concierge, Gastos, Perfil. No structural change beyond removing the now-orphan "Ruta multi-destino" entry (it becomes an outcome of detection, not a separate user choice).

---

## Technical section

**New files**
- `src/pages/PlanConversational.tsx`
- `src/lib/detectRouteIntent.ts`
- `src/lib/useAutonomyLevel.ts`
- `src/components/PlaceMap.tsx`
- `src/components/RouteConfigModal.tsx` (factored from `MultiDestRoute`)
- `supabase/functions/logistics-plan/index.ts`
- `supabase/functions/detect-route-intent/index.ts`
- `supabase/functions/god-mode-sniper/index.ts`
- `src/assets/iatos-mist-mountain.jpg` (generated, premium quality)

**Edited files**
- `src/pages/DashboardHome.tsx` (single CTA)
- `src/pages/PlanTrip.tsx` (call detection + logistics-plan, generate 4-block days)
- `src/pages/MultiDestRoute.tsx` (use shared autonomy hook + modal)
- `src/pages/TripDetail.tsx` (timeline + transition cards + dark Google Map header)
- `src/pages/Concierge.tsx` (gold mic, contextual pills, God Mode toggle)
- `src/components/DashboardLayout.tsx` (sidebar cleanup)
- `src/App.tsx` (route for `/dashboard/planear` modo switch)

**Database migration (one batch)**
- `alter table ai_user_preferences add column trip_count int default 0;`
- (behavioral_insights column already present as jsonb on the table? — verify; if absent, add `behavioral_insights jsonb default '{}'::jsonb`.)
- Trigger on `user_visits` insert → upserts category counts into `ai_user_preferences.behavioral_insights` (`{ "categories": { "museum": 4, … }, "places": [...] }`).
- Trigger on `trips` insert → increments `ai_user_preferences.trip_count`.

**Edge functions config**
- All new functions use `verify_jwt = false` defaults, validate the JWT in code via `supabase.auth.getUser(token)`, return CORS headers.
- `logistics-plan` and `detect-route-intent` use the shared Lovable AI gateway helper.
- `god-mode-sniper` is invoked from the Concierge UI; it writes simulated progress to `notifications` over a few seconds.

**Connectors**
- Google Maps Platform connector already linked → reuse browser key for JS API, gateway for Places API (New) `places:searchText` and `places/v1/places/{id}` for ratings & details.

**Out of scope (call out explicitly)**
- Real restaurant reservation APIs (Resy/OpenTable). God Mode is simulated and clearly labeled in `notifications.body`.
- Real flight pricing APIs. Logistics edge function returns AI-estimated structured data, not live fares.

---

## Suggested build order
1. Migration + triggers (section 5).
2. Detection engine + logistics-plan edge function (3, 4).
3. Conversational profiling page + home CTA (1, 2).
4. Refactored TripDetail timeline + dark Google Map (6).
5. Shared autonomy hook + modal reuse (7).
6. Concierge upgrades — mic, context, God Mode (8).
7. PlaceMap component + check-in wiring (9).
8. Sidebar cleanup + final QA pass (10).

Approve to proceed, or tell me which sections to drop/reorder.
