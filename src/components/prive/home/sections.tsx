// Secciones de FOR YOU propias de prive-ux: The Extraordinary Edit (colecciones como formas de
// explorar el catálogo, no entidades nuevas), destinos destacados (6–8) y los doce universos.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import type { PriveUniverse } from "@/lib/priveCatalogApi";
import { universesView } from "@/lib/priveCatalogView";
import { featuredDestinations, type BrowseDestination } from "@/lib/priveBrowse";
import type { PriveText } from "@/lib/priveI18n";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { Rail } from "@/components/prive/catalog/Rail";
import { DestinationCard } from "@/components/prive/catalog/DestinationBrowser";
import { BrandTitle } from "./BrandTitle";

/** Cada colección editorial abre un universo existente: solo experiencias publicables, nada duplicado. */
export const EXTRAORDINARY_EDITS: { key: keyof PriveText["edits"]; universe: PriveUniverse; query: string }[] = [
  { key: "art_of_dining", universe: "the_table", query: "candlelit fine dining table" },
  { key: "after_dark", universe: "after_dark", query: "jazz bar night cocktails" },
  { key: "escape_sea", universe: "yacht_sea", query: "yacht mediterranean sea" },
  { key: "extraordinary_stays", universe: "private_stays", query: "luxury villa architecture pool" },
  { key: "romantic", universe: "celebrations", query: "romantic dinner candles terrace" },
  { key: "once", universe: "iconic_events", query: "opera house gala night" },
  { key: "signature_mexico", universe: "signature_mexico", query: "mexican cuisine traditional market" },
  { key: "icons", universe: "culture_access", query: "museum grand hall art" },
];

export function ExtraordinaryEdit({ universes }: { universes: { key: PriveUniverse; count: number }[] }) {
  const t = usePriveT();
  const counts = new Map(universes.map((u) => [u.key, u.count]));
  const list = EXTRAORDINARY_EDITS.filter((e) => (counts.get(e.universe) ?? 0) > 0);
  if (!list.length) return null;
  return (
    <section aria-labelledby="prive-edit" data-testid="prive-edit">
      <div className="mb-5"><BrandTitle id="prive-edit" brand={t.home.editBrand} sub={t.home.editSub} /></div>
      <ul className="prive-edit-grid">
        {list.map((e, i) => {
          const tx = t.edits[e.key];
          return (
            <li key={e.key} className={`prive-edit-item ${i === 0 ? "is-hero" : ""} ${i === 7 ? "is-wide" : ""}`} data-edit={e.key}>
              <Link to={`/prive/universo/${e.universe}`} className="prive-dest-card h-full" aria-label={`${tx.name}${tx.sub ? ` · ${tx.sub}` : ""} · ${t.common.experiences(counts.get(e.universe) ?? 0)}`}>
                <PrivePhoto queries={[e.query, universesView("en").find((u) => u.key === e.universe)?.imageQuery]} alt={tx.name} label={tx.name}
                  className="prive-veil h-full w-full" creditClassName="is-inline">
                  <div className="prive-dest-meta">
                    {tx.sub && <p className="text-[10px] tracking-[0.24em] uppercase prive-gold">{tx.sub}</p>}
                    <p className={`prive-serif leading-tight mt-1 ${i === 0 ? "text-3xl sm:text-5xl" : "text-xl sm:text-2xl"}`}>{tx.name}</p>
                    <p className="text-[12px] prive-champagne opacity-80 mt-1 line-clamp-2">{tx.line}</p>
                  </div>
                </PrivePhoto>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FeaturedDestinations({ destinations }: { destinations: BrowseDestination[] }) {
  const t = usePriveT();
  const list = featuredDestinations(destinations.filter((d) => d.count > 0 && d.kind !== "neighborhood"), 8);
  if (!list.length) return null;
  const all = destinations.filter((d) => d.count > 0 && d.kind !== "neighborhood").length;
  return (
    <section aria-labelledby="prive-featured-dest" data-testid="prive-featured-destinations">
      <Rail label={t.home.destinationsBrand} large testId="prive-featured" heading={<BrandTitle id="prive-featured-dest" brand={t.home.destinationsBrand} sub={t.home.destinationsSub} />}
        actions={<Link to="/prive/explorar" className="text-[11px] tracking-[0.2em] uppercase prive-gold hover:text-[color:var(--pv-champagne)] min-h-[44px] inline-flex items-center gap-1 px-1">{t.home.allDestinations(all)}<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" /></Link>}>
        {list.map((d) => <li key={d.slug}><DestinationCard d={d} large /></li>)}
      </Rail>
    </section>
  );
}

/** Los doce universos (Fase 4): marca en inglés + subtítulo, foto propia, todos navegables. */
export function TwelveUniverses({ universes, layout = "grid" }: { universes: { key: PriveUniverse; count: number }[]; layout?: "grid" | "rail" }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const counts = new Map(universes.map((u) => [u.key, u.count]));
  const items = universesView(lang).map((u, i) => {
    const n = counts.get(u.key) ?? 0;
    return (
      <li key={u.key} data-universe={u.key}>
        <Link to={`/prive/universo/${u.key}`} className="prive-dest-card" aria-label={`${u.name}${u.sub ? ` · ${u.sub}` : ""} · ${n > 0 ? t.common.experiences(n) : t.explore.preparing}`}>
          <PrivePhoto queries={[u.imageQuery]} alt={u.name} label={u.name} className="prive-veil aspect-[4/5]" creditClassName="is-inline">
            <div className="prive-dest-meta">
              <p className="text-[10px] tracking-[0.3em] prive-gold">{String(i + 1).padStart(2, "0")}</p>
              <p className="prive-serif text-2xl leading-tight mt-1">{u.name}</p>
              {u.sub && <p className="text-[11px] tracking-[0.18em] uppercase prive-champagne mt-1">{u.sub}</p>}
              <p className="text-[12px] prive-muted leading-snug mt-1 line-clamp-2">{u.es}</p>
              <p className="text-[10px] tracking-[0.2em] uppercase prive-gold mt-2 opacity-80">{n > 0 ? t.common.experiences(n) : t.explore.preparing}</p>
            </div>
          </PrivePhoto>
        </Link>
      </li>
    );
  });
  return (
    <section aria-labelledby="prive-universes" data-testid="prive-twelve">
      {layout === "rail" ? (
        <Rail label={t.explore.universesBrand} large testId="prive-collections" heading={<BrandTitle id="prive-universes" brand={t.explore.universesBrand} sub={t.explore.universesSub} />}>{items}</Rail>
      ) : (
        <>
          <div className="mb-5"><BrandTitle id="prive-universes" brand={t.explore.universesBrand} sub={t.explore.universesSub} /></div>
          <ul className="prive-uni-list" data-testid="prive-collections">{items}</ul>
        </>
      )}
    </section>
  );
}
