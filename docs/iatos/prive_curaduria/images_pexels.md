# Image decision (owner, 2026-10-22): images come from PEXELS

- Every experience shows a Pexels image fetched through the existing pexels-image edge function, which already has a 7-day shared cache (serp_cache, cost group). There is no new provider and no Wikimedia or Google Photos requirement.
- Query per experience, in order:
  1. `image_query` from the curation, if given. These are English keywords describing the place type and setting, e.g. "candlelit speakeasy cocktail bar", "Monaco harbour superyachts", "Michelin tasting menu plating".
  2. "<subcategory> <city>".
  3. A universe default ("fine dining", "rooftop bar night", "luxury yacht"...).
- Honesty: a Pexels photo is generic. The card and the sheet show a small "Foto ilustrativa · Pexels · <photographer>", with links to the photo page and the photographer as the Pexels guidelines ask. It is never presented as the venue unless the photo clearly depicts that exact venue, decided by a person: verified_image=true.
- Store per experience: image_url, image_photographer, image_photographer_url, image_page_url, image_source='pexels', image_is_illustrative (default true), image_checked_at.
- Fetch on first display and cache 7 days. Pexels limits are 200 requests per hour and 20,000 per month, which caching keeps well within. Prefetch city covers on city open; lazy-load cards.
