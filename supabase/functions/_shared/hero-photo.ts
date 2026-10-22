// Foto de portada para los correos: la misma búsqueda de Pexels que usa pexels-image (misma llave
// de la caché compartida public.serp_cache, 7 días), así un destino ya visto en la app no gasta
// otra consulta. Nunca bloquea un correo: con cualquier falla, sin llave o pasado el tiempo límite
// devuelve null y la plantilla usa su portada tipográfica.
import { cacheGet, cacheKey, cachePut, freshnessOf } from "./serpCache.ts";
import { dbCacheStore, logUsage } from "./serpRuntime.ts";
import { type PexelsResult, pexelsHero } from "./email-templates.ts";
import type { HeroImage } from "./email-kit.ts";

export async function heroPhoto(
  query: string | null | undefined,
  opts: { fn: string; userId?: string | null; timeoutMs?: number } = { fn: "email" },
): Promise<HeroImage | null> {
  const q = String(query ?? "").trim().slice(0, 100);
  const apiKey = Deno.env.get("PEXELS_API_KEY");
  if (!q || !apiKey) return null;
  const work = (async () => {
    const store = dbCacheStore();
    const key = await cacheKey("pexels_photo", { query: q.toLowerCase() });
    const hit = await cacheGet(store, key);
    if (hit && freshnessOf(hit).fresh) return pexelsHero(hit.response as PexelsResult, q);
    const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 2500),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const photo = data?.photos?.[0];
    const safe = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : null);
    // Mismo formato que guarda pexels-image, para compartir la caché.
    const result: PexelsResult = {
      image: safe(photo?.src?.landscape ?? photo?.src?.large ?? photo?.src?.medium),
      photographer: typeof photo?.photographer === "string" ? photo.photographer : null,
      photographer_url: safe(photo?.photographer_url),
      page_url: safe(photo?.url),
      alt: typeof photo?.alt === "string" ? photo.alt.slice(0, 200) : null,
    };
    await cachePut(store, key, "pexels_photo", result);
    await logUsage({ user_id: opts.userId ?? null, function: opts.fn, provider: "pexels", searches: 0 });
    return pexelsHero(result, q);
  })();
  try {
    return await Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), (opts.timeoutMs ?? 2500) + 500))]);
  } catch (e) {
    console.warn("heroPhoto: sin foto", (e as Error)?.message);
    return null;
  }
}
