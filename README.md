# IATOS AI

IATOS is a luxury AI travel-concierge web app: it plans and prices real trips
(flights, hotels, tours, transfers) from live third-party data, runs an
AI concierge that can actually act (search flights, check hotel prices, pull
real attraction data, check flight status), and monetizes through affiliate
booking links plus an optional Stripe subscription tier.

Live app: https://traveliatos.life (also published at
https://iatos-ai.lovable.app). Built and edited both in code and via the
[Lovable](https://lovable.dev) AI editor — both sides sync through this
GitHub repo.

## Stack

- **Frontend**: Vite + React 18 + TypeScript + Tailwind CSS + shadcn/ui
  (Radix primitives), React Router, TanStack Query, Framer Motion.
  Route-level code splitting via `React.lazy` (see `src/lib/lazyRetry.ts`
  for the stale-chunk-after-deploy retry wrapper) and a top-level Sentry
  error boundary (`src/components/AppErrorBoundary.tsx`).
- **Backend**: Supabase — Postgres with RLS on every table, Supabase Auth,
  and ~49 Deno edge functions under `supabase/functions/` (business logic,
  AI calls, third-party API integrations). Shared helpers live in
  `supabase/functions/_shared/` (auth verification, rate limiting,
  entitlements/quota, email sending, live FX).
- **AI**: Google Gemini, called directly with the project's own key when
  `GEMINI_API_KEY` is set and through the Lovable AI Gateway otherwise (or as
  fallback) — see `supabase/functions/_shared/ai.ts` — for
  itinerary/pricing generation and the Concierge's tool-calling loop;
  Perplexity (`sonar`) for web-grounded research (promotions, nightlife,
  flight status) where configured.
- **Real-world data providers**: Travelpayouts/Aviasales (flights),
  SerpApi (Google Hotels pricing, Google Flights, and a generic-search
  fallback for live flight status), TripAdvisor Content API (attractions —
  real names/ratings, not real-time ticket prices), Google Maps/Places
  (geocoding, nearby places).
- **Payments**: Stripe, BYOK (bring-your-own-key) — checkout, billing
  portal and webhook are fully implemented (`supabase/functions/stripe-*`)
  but inert until the account's own Stripe keys are configured as secrets.
- **Monetization**: every outbound booking link is required to go through
  `src/lib/affiliateLinks.ts`'s helpers (`tpDeepLink`, `withMarker`, and
  per-vertical helpers like `getYourGuideLink`, `airaloLink`,
  `bookingLink`) so affiliate commission is never silently lost.

## Data-honesty convention

Prices and recommendations are labeled by how real they are, via
`src/components/PriceSourceBadge.tsx`:

- **live** (gold) — a real-time price from a live API (Travelpayouts,
  SerpApi).
- **curated** (blue) — a real, named source (e.g. TripAdvisor) without a
  real-time price.
- **estimated** (grey) — an AI-generated estimate, shown as such.

Any new price-bearing feature should carry one of these badges rather than
presenting an AI estimate as a confirmed number.

## Local development

```sh
npm install
npm run dev        # Vite dev server
npm run build       # production build
npm run test        # vitest
npm run lint         # eslint
```

The frontend talks to the project's live Supabase backend (see
`src/integrations/supabase/client.ts`); there's no local Supabase stack
required for frontend work. To edit/deploy edge functions, use the
Supabase CLI or the Lovable editor.

## Database

`supabase/migrations/` rebuilds the full production schema from an empty
Supabase database (42 tables, 2 views, 18 functions — verified by replaying
every migration on Postgres 16 and diffing against the live-generated
`src/integrations/supabase/types.ts`). Objects that were created live before
they were versioned have idempotent "restore" migrations that are no-ops on
production. One known gap: the triggers that bump `ai_user_preferences.trip_count`
/ `visit_count` exist only in production; their functions are versioned, the
trigger definitions are not.

Operational steps that need a person (scheduling, admin access) are in
`docs/ops/LEEME.md`.

## Secrets / environment

Configured in Supabase Project Settings → Secrets (edge functions) and as
`VITE_*` build-time env vars (frontend). None of the actual values are
checked into this repo. At minimum, the app needs:

| Secret | Used for |
|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Core backend |
| `TRAVELPAYOUTS_TOKEN` / `TRAVELPAYOUTS_MARKER` | Flight data + affiliate commission |
| `SERPAPI_PRIVATE_KEY` | Hotel pricing, flight status fallback, places |
| `TRIPADVISOR_API_KEY` | Attractions data |
| `GEMINI_API_KEY` | Primary AI provider: Google Gemini called directly (`_shared/ai.ts`); falls back to the Lovable gateway |
| `LOVABLE_API_KEY` | AI gateway fallback and image generation, email send |
| `RESEND_API_KEY` | Transactional email |
| `GOOGLE_MAPS_API_KEY` | Geocoding / Places |
| `CRON_SECRET` | Authenticates scheduled cron-triggered functions |
| `VAPID_*` | Web push notifications |
| `STRIPE_SECRET_KEY` / `STRIPE_PRICE_ID` / `STRIPE_WEBHOOK_SECRET` | Billing (optional — app runs without it, subscriptions stay "comped") |
| `PERPLEXITY_API_KEY` | Optional — web-grounded fallback for flight status, promos, nightlife |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | Optional — error monitoring |
| `VITE_POSTHOG_KEY` | Optional — product analytics |

Every feature that depends on an unconfigured secret fails honestly
(an explicit error or a clearly-labeled estimate) rather than fabricating
data — see the data-honesty convention above.

## Handover notes (for a new owner)

Accounts and keys to move or re-create under the new owner, then replace in
Lovable → More → Secrets:

- **Stripe** (`STRIPE_*`): the "IATOS" Stripe account; switch test keys to
  live keys and recreate the product/price and webhook in live mode.
- **Google Gemini** (`GEMINI_API_KEY`): primary AI provider. Enable billing in
  Google AI Studio for production so customer prompts are not used for training.
- **SerpApi** (`SERPAPI_PRIVATE_KEY`): Google Flights, Google Hotels and Google
  Maps data (flights, hotels, attractions with real ratings/reviews).
- **Travelpayouts** (`TRAVELPAYOUTS_TOKEN` / `TRAVELPAYOUTS_MARKER`): affiliate
  commission on flights, hotels and tours; change the marker to the new owner's.
- **TripAdvisor** (`TRIPADVISOR_API_KEY`): optional. The current key is rejected
  (TripAdvisor moved its API to a paid plan); attractions fall back to Google Maps
  automatically.
- **Planned: Viator Partner API** (`VIATOR_API_KEY`, free Basic Access for
  affiliates) to show real tour prices. Tours currently show real places and
  ratings with estimated prices and affiliate booking links.

## Editing

- **Via Lovable**: open the project at
  https://lovable.dev/projects/7c80960a-e5cd-46b2-b94a-34145bb7f1f4 and
  prompt changes; they commit to this repo automatically.
- **Via git**: clone, branch, commit and push as usual — Lovable picks up
  changes pushed to `main`.
