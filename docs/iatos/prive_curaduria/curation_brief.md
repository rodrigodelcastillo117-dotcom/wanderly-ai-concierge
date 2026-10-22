# IATOS Privé — curation brief (for research agents)

Goal: an elite, 18+, editorial selection of REAL venues and experiences for each assigned city, for affluent travelers. Quality and verifiability over quantity. One fabricated detail ruins trust: never invent.

Per city deliver:
- The Table (fine dining / chef's tables / iconic tables): 6 venues.
- After Dark (speakeasies, cocktail bars on the World's 50 Best Bars lists, jazz clubs, members clubs, rooftops, cabaret): 6 venues. Review the existing rows for the city in the repo seed (see below) and KEEP the good ones (fix the website, dedupe), REPLACE weak or unverifiable ones and set `replaces_existing_name`.
- Extraordinary (bookable special experiences: private boat, helicopter or hot-air balloon, private museum access sold publicly, cooking with a chef, wine tasting at a famous house, etc.): 4. Prefer the official operator; GetYourGuide/Viator listings are fine when they are the real booking channel, as "oferta de socio", never "VIP".

Sources (open the pages; a search snippet is not a source):
- Official venue website (required for status "verificado").
- Michelin Guide (guide.michelin.com), The World's 50 Best Restaurants/Bars and the regional 50 Best lists (theworlds50best.com, worlds50bestbars.com), La Liste, Forbes Travel Guide, the official tourism board.
- An accolade is included ONLY with name + year + URL you opened.
- Coordinates: from the official site, Wikipedia or OpenStreetMap Nominatim (https://nominatim.openstreetmap.org/search?format=json&q=...; at most 1 request per second, with header User-Agent "IATOS-curation/1.0 (contact via iatos)"). If unsure, leave null.

Rules:
- status "verificado" only if the official site loaded today and its name/address match. Otherwise "no_confirmado".
- why_fact: one factual sentence (accolade, chef, concept, setting), no unverifiable superlatives ("el mejor", "el más exclusivo") unless quoting a ranked accolade with its source.
- price_level 1–4 in local terms; price_note: a range in local currency only if the source states it (e.g. a tasting menu price), else describe it without numbers.
- age_policy: "18+" by default for nightlife; "21+" where the venue states it (US venues usually do); for restaurants, "todas las edades" unless stated.
- booking_method: web | resy | opentable | sevenrooms | tock | phone | email | walk_in | concierge_request; booking_url = the official booking page if one exists.
- dress_code: only if the venue states it.
- Diversity: different neighborhoods and styles, a mix of iconic and insider places. No closed venues: check that the venue is open in 2026 (official site, recent news).
- Never claim partnership, exclusivity, discounts or perks.

Output: a JSON array in the file given in your task, with fields
{city_key, city_display, country, category_group ("the_table"|"after_dark"|"extraordinary"), subcategory, name, neighborhood, address, lat, lng, website, booking_url, booking_method, price_level, price_note, dress_code, age_policy, why_fact, accolades:[{name,year,url}], sources:[url], status, verified_at:"2026-10-22", notes, replaces_existing_name}
Also add, per city, entries for EXISTING rows that should be kept, with corrected fields, and set `"keep_existing": true` plus the original name.

Existing data: the seed rows of public.nightlife_premium are in the repo migrations (grep -l "nightlife_premium" /home/user/wanderly-ai-concierge/supabase/migrations/*.sql). Read only. Do not touch the repo, git or production.
