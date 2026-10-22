import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { pexelsCredit } from "@/lib/priveCatalogView";

type Photo = { image: string | null; photographer?: string | null; photographer_url?: string | null; page_url?: string | null; alt?: string | null };
const cache = new Map<string, Promise<Photo | null>>();

// Foto de Pexels por la función pexels-image (caché compartida de 7 días). Se prueba cada consulta en
// orden (curador → subcategoría + ciudad → universo) hasta que una traiga foto.
async function fetchPhoto(queries: string[]): Promise<Photo | null> {
  for (const q of queries) {
    if (!cache.has(q)) {
      cache.set(q, supabase.functions.invoke("pexels-image", { body: { query: q } })
        .then(({ data, error }) => (error || !data?.image ? null : (data as Photo)))
        .catch(() => null));
    }
    const p = await cache.get(q)!;
    if (p?.image) return p;
  }
  return null;
}

export function PriveImage({ queries, illustrative = true, className = "", alt }: { queries: string[]; illustrative?: boolean; className?: string; alt: string }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const key = queries.join("|");
  useEffect(() => {
    let alive = true;
    void fetchPhoto(queries).then((p) => { if (alive) setPhoto(p); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <figure className={`relative overflow-hidden bg-[color:var(--pv-surface)] ${className}`}>
      {photo?.image
        ? <img src={photo.image} alt={photo.alt || alt} loading="lazy" className="h-full w-full object-cover" />
        : <div className="h-full w-full" aria-hidden="true" />}
      {photo?.image && (
        <figcaption className="absolute bottom-0 left-0 right-0 bg-black/55 px-2 py-0.5 text-[10px] text-[color:var(--pv-champagne)]">
          <a href={photo.page_url || "https://www.pexels.com"} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {pexelsCredit(null, illustrative)}
          </a>
          {photo.photographer && (
            <>
              {" · "}
              <a href={photo.photographer_url || "https://www.pexels.com"} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                {photo.photographer}
              </a>
            </>
          )}
        </figcaption>
      )}
    </figure>
  );
}
