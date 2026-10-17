// Server-to-server Travelpayouts helpers for scheduled jobs. travelpayouts-flights
// requires a user JWT, so cron jobs call the provider directly through these.

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
};

// Cheapest cached round-trip fare per passenger, in USD. Falls back to the
// whole departure month (flagged approximate) when the exact date isn't cached.
export async function cheapestFareUsd(opts: {
  token: string;
  marker: string;
  origin: string;
  destination: string;
  departureDate: string;
  returnDate?: string | null;
}): Promise<CheapestFare | null> {
  const query = async (departAt: string, returnAt?: string | null) => {
    const params = new URLSearchParams({
      origin: opts.origin,
      destination: opts.destination,
      departure_at: departAt,
      currency: "usd",
      sorting: "price",
      direct: "false",
      limit: "10",
      token: opts.token,
    });
    if (returnAt) params.set("return_at", returnAt);
    const res = await fetch(`https://api.travelpayouts.com/aviasales/v3/prices_for_dates?${params}`, {
      headers: { "X-Access-Token": opts.token, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.success && Array.isArray(data?.data) ? data.data : [];
  };

  let rows = await query(opts.departureDate, opts.returnDate);
  let approximateDates = false;
  if (rows.length === 0) {
    rows = await query(opts.departureDate.slice(0, 7), opts.returnDate ? opts.returnDate.slice(0, 7) : null);
    approximateDates = rows.length > 0;
  }
  const best = rows
    .filter((r: { price?: number }) => Number(r?.price) > 0)
    .sort((a: { price: number }, b: { price: number }) => Number(a.price) - Number(b.price))[0];
  if (!best) return null;

  const link: string = best.link ?? "";
  const bookingLink = link
    ? `https://www.aviasales.com${link}${link.includes("?") ? "&" : "?"}marker=${opts.marker}`
    : `https://www.aviasales.com/search/${opts.origin}${opts.departureDate.replaceAll("-", "").slice(2)}${opts.destination}?marker=${opts.marker}`;

  return { priceUsd: Number(best.price), bookingLink, approximateDates };
}
