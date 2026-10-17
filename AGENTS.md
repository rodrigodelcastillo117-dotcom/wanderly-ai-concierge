# Architecture rules

- Flight status normalizes structured SerpApi Google widgets in `supabase/functions/flight-status/serpapi.ts`, with optional Perplexity fallback; keep the mapper independently testable and reject mismatched dates so another day's status cannot be presented as current.