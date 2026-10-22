// Tarjeta FEATURED EXPERIENCE de prive-ux (Mi Privé, "Más en <ciudad>"). Las ranuras de FOR YOU
// (CuratedForYou, YourNextJourney, PriveKeyLauncher) son de privekey: src/components/prive/key.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { imageQueries, universeMeta } from "@/lib/priveCatalogView";
import { displayName } from "@/lib/priveBrowse";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";

/** Tarjeta FEATURED EXPERIENCE (Fase 5): foto, nombre, destino y categoría, motivo, Ver y Guardar visibles. */
export function FeaturedExperienceCard({ e, size = "lg" }: { e: PriveExperience; size?: "lg" | "md" }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const api = usePriveCatalog();
  const [saved, setSaved] = useState(!!e.saved);
  const meta = universeMeta(e.universe, lang);
  const city = e.destination ? displayName(e.destination, lang) : null;
  const reason = e.why ?? (Array.isArray(e.reasons) ? e.reasons[0] : null);
  const toggle = async () => {
    const next = !saved;
    setSaved(next);
    try { const r = await api.save(e.id, next); if (!r.ok) setSaved(!next); } catch { setSaved(!next); }
  };
  return (
    <article className="prive-feature" data-testid="prive-exp-tile">
      <Link to={`/prive/experiencia/${e.slug}`} className="block focus-visible:outline-none" aria-label={`${e.name}${city ? ` · ${city}` : ""}`}>
        <PrivePhoto queries={imageQueries(e)} alt={e.name} label={e.name} illustrative={e.image?.illustrative !== false}
          className={`prive-veil ${size === "lg" ? "aspect-[4/5]" : "aspect-[1/1]"}`} creditClassName="is-inline">
          <div className="prive-dest-meta">
            <p className="text-[10px] tracking-[0.22em] uppercase prive-gold">{meta?.name}{city ? ` · ${city}` : ""}</p>
            <p className={`prive-serif leading-tight mt-1 ${size === "lg" ? "text-2xl" : "text-xl"}`}>{e.name}</p>
          </div>
        </PrivePhoto>
      </Link>
      <div className="px-1 pt-3 space-y-2">
        {reason && <p className="text-[13px] prive-muted leading-snug line-clamp-2">{reason}</p>}
        <div className="flex items-center gap-2">
          <Link to={`/prive/experiencia/${e.slug}`} className="prive-chip-btn">{t.browse.discover}</Link>
          <button type="button" onClick={() => void toggle()} aria-pressed={saved} className="prive-chip-btn">
            {saved ? <BookmarkCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />}
            {saved ? t.catalog.detail.saved : t.catalog.detail.save}
          </button>
        </div>
      </div>
    </article>
  );
}
