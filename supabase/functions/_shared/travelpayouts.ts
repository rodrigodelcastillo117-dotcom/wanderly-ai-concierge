// Server-to-server fare lookups for scheduled jobs. travelpayouts-flights and
// flights-search require a user JWT, so cron jobs call the providers directly.

export async function resolveIata(input: string | null | undefined): Promise<string | null> {
  const cleaned = (input ?? "").trim();
  if (!cleaned) return null;
  if (/^[A-Za-z]{3}$/.test(cleaned)) return cleaned.toUpperCase();
  try {
    const url = `https://autocomplete.travelpayouts.com/places2?term=${encodeURIComponent(cleaned)}&locale=en&types[]=city&types[]=airport`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const hit = arr.find((x: { type?: string; code?: string }) => x?.type === "city" && x?.code) ??
      arr.find((x: { code?: string }) => x?.code);
    return hit?.code ? String(hit.code).toUpperCase() : null;
  } catch {
    return null;
  }
}

export type CheapestFare = {
  priceUsd: number;
  bookingLink: string;
  approximateDates: boolean;
  source: "travelpayouts" | "google_flights";
};

type FareQuery = {
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string | null;
};

const ddmm = (d?: string | null) => {
  const p = (d ?? "").split("-");
  return p.length === 3 ? `${p[2]}${p[1]}` : "";
};

export function aviasalesSearchLink(q: FareQuery, marker: string): string {
  return `https://www.aviasales.com/search/${q.origin}${ddmm(q.departureDate)}${q.destination}${ddmm(q.returnDate)}1?marker=${marker}`;
}

// Cheapest cached fare per passenger (USD) from Aviasales users' searches in the
// last 48h. Falls back to the departure month, flagged approximate.
export async function travelpayoutsFare(q: FareQuery, token: string, marker: string): Promise<CheapestFare | null> {
  const query = async (departAt: string, returnAt?: string | null) => {
    const params = new URLSearchParams({
      origin: q.origin,
      destination: q.destination,
      departure_at: departAt,
      currency: "usd",
      sorting: "price",
      direct: "false",
      limit: "10",
      // The API defaults to one-way; a round trip must say so explicitly.
      one_way: returnAt ? "false" : "true",
      token,
    });
    if (returnAt) params.set("return_at", returnAt);
    try {
      const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`, {
        headers: { "X-Access-Token": token, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data?.success && Array.isArray(data?.data) ? data.data : [];
    } catch {
      return [];
    }
  };

  let rows = await query(q.departureDate, q.returnDate);
  let approximateDates = false;
  if (rows.length === 0) {
    rows = await query(q.departureDate.slice(0, 7), q.returnDate ? q.returnDate.slice(0, 7) : null);
    approximateDates = rows.length > 0;
  }
  const best = rows
    .filter((r: { price?: number }) => Number(r?.price) > 0)
    .sort((a: { price: number }, b: { price: number }) => Number(a.price) - Number(b.price))[0];
  if (!best) return null;

  const link: string = best.link ?? "";
  const bookingLink = link
    ? `https://www.aviasales.com${link}${link.includes("?") ? "&" : "?"}marker=${marker}`
    : aviasalesSearchLink(q, marker);
  return { priceUsd: Number(best.price), bookingLink, approximateDates, source: "travelpayouts" };
}

// Live Google Flights price for the exact dates, 1 adult (SerpApi, metered).
export async function googleFlightsFare(q: FareQuery, serpKey: string, marker: string, doFetch: typeof fetch = fetch): Promise<CheapestFare | null> {
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_flights");
  u.searchParams.set("departure_id", q.origin);
  u.searchParams.set("arrival_id", q.destination);
  u.searchParams.set("outbound_date", q.departureDate);
  if (q.returnDate) u.searchParams.set("return_date", q.returnDate);
  u.searchParams.set("type", q.returnDate ? "1" : "2");
  u.searchParams.set("adults", "1");
  u.searchParams.set("currency", "USD");
  u.searchParams.set("hl", "es");
  u.searchParams.set("sort_by", "2");
  u.searchParams.set("api_key", serpKey);
  try {
    const r = await doFetch(u.toString(), { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    const prices = [...(j?.best_flights ?? []), ...(j?.other_flights ?? [])]
      .map((f: { price?: number }) => Number(f?.price))
      .filter((p: number) => p > 0);
    if (!prices.length) return null;
    return {
      priceUsd: Math.min(...prices),
      bookingLink: aviasalesSearchLink(q, marker),
      approximateDates: false,
      source: "google_flights",
    };
  } catch {
    // Never log the request URL: it carries the API key.
    return null;
  }
}

// Free cached fares first; live Google Flights only when the cache has nothing
// for the exact dates (a month-level cache hit would be a different date).
// A watch whose baseline came from Google Flights keeps querying it first, so
// its checks stay comparable with the baseline.
export async function cheapestFare(
  q: FareQuery,
  // serpFetch: el fetch de la caché compartida de SerpApi (vuelos 6 h), si quien llama lo tiene.
  keys: { travelpayoutsToken?: string; serpKey?: string; marker: string; serpFetch?: typeof fetch },
  prefer: CheapestFare["source"] = "travelpayouts",
): Promise<CheapestFare | null> {
  const gfFirst = prefer === "google_flights" && keys.serpKey;
  if (gfFirst) {
    const gf = await googleFlightsFare(q, keys.serpKey!, keys.marker, keys.serpFetch);
    if (gf) return gf;
  }
  const tp = keys.travelpayoutsToken ? await travelpayoutsFare(q, keys.travelpayoutsToken, keys.marker) : null;
  if (tp && !tp.approximateDates) return tp;
  const gf = !gfFirst && keys.serpKey ? await googleFlightsFare(q, keys.serpKey, keys.marker, keys.serpFetch) : null;
  return gf ?? tp;
}
