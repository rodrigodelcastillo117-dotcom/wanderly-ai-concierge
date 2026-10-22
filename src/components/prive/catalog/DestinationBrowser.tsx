// Explorar destinos de Privé: "¿A dónde?" con filtro instantáneo, destacados y una región a la vez
// en un carrusel de fotos. Cualquier destino queda a dos toques (pestaña + tarjeta, o escribir + tarjeta)
// sin bajar una lista de 130 entradas. Teclado: pestañas con flechas/Inicio/Fin (patrón WAI-ARIA),
// carriles con desplazamiento nativo y botones; foco visible; movimiento reducido respetado en CSS.
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { Rail } from "./Rail";
import { PriveForYou, PriveSpotlight } from "./PriveHomeLive";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { browsable, displayName, featuredDestinations, groupByRegion, placeLine, searchDestinations, type BrowseDestination } from "@/lib/priveBrowse";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { universesView } from "@/lib/priveCatalogView";
import type { PriveUniverse } from "@/lib/priveCatalogApi";
import type { RegionKey } from "@/lib/priveI18n";

export type CatalogHomeData = {
  total: number;
  universes: { key: PriveUniverse; count: number }[];
  destinations: BrowseDestination[];
};

const SEARCH_LIMIT = 8;

export function DestinationCard({ d, large = false }: { d: BrowseDestination; large?: boolean }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const name = displayName(d, lang);
  return (
    <Link to={`/prive/destino/${d.slug}`} className="prive-dest-card" data-testid="prive-dest-card" data-slug={d.slug}>
      <PrivePhoto queries={destinationPhotoQueries(d.slug, d.name)} alt={t.common.photoAlt(name)} label={name}
        className={`prive-veil ${large ? "aspect-[4/5]" : "aspect-[3/4]"}`} creditClassName="is-inline">
        <div className="prive-dest-meta">
          {/* Relación geográfica verificable en vez de relleno; el conteo, como dato secundario. */}
          <p className="text-[10px] tracking-[0.22em] uppercase prive-gold">{placeLine(d.slug, lang)}</p>
          <p className={`prive-serif leading-tight mt-1 ${large ? "text-2xl sm:text-[1.7rem]" : "text-lg sm:text-xl"}`}>{name}</p>
          {d.count > 0 && <p className="text-[11px] prive-muted mt-1">{t.common.experiences(d.count)}</p>}
        </div>
      </PrivePhoto>
    </Link>
  );
}

export { Rail };

/** Pestañas de región. `initialKey`/`onSelect` permiten guardar la región en la URL (volver con el mismo filtro). */
export function RegionTabs({ groups, initialKey, onSelect }: { groups: { key: string; items: BrowseDestination[] }[]; initialKey?: string | null; onSelect?: (key: string) => void }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const base = useId();
  const [active, setActive] = useState(() => Math.max(0, groups.findIndex((g) => g.key === initialKey)));
  const [index, setIndex] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const label = (k: string) => (k === "destacados" ? t.browse.featuredTab : t.browse.regionNames[k as RegionKey] ?? k);
  const select = (i: number, focus = false) => {
    setActive(i);
    if (groups[i]) onSelect?.(groups[i].key);
    setIndex(false);
    if (focus) tabs.current[i]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const n = groups.length;
    const i = active;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(to, true);
  };
  const g = groups[Math.min(active, groups.length - 1)];
  if (!g) return null;
  const sorted = g.key === "destacados" ? g.items : [...g.items].sort((a, b) => displayName(a, lang).localeCompare(displayName(b, lang), lang));
  return (
    <div>
      <div role="tablist" aria-label={t.browse.regions} className="prive-tabs" data-testid="prive-region-tabs">
        {groups.map((x, i) => (
          <button key={x.key} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`${base}-tab-${x.key}`}
            aria-selected={i === active} aria-controls={`${base}-panel`} tabIndex={i === active ? 0 : -1}
            onClick={() => select(i)} onKeyDown={onKey} className="prive-tab">
            {label(x.key)}<span className="prive-tab-n" aria-hidden="true">{x.items.length}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${g.key}`} className="pt-6 outline-none" data-testid="prive-region-panel" data-region={g.key} tabIndex={0}>
        {(() => {
          // La pestaña ya nombra la región: aquí solo el conteo, sin repetir el título.
          const heading = <p className="text-xs prive-muted" aria-live="polite">{t.browse.inRegion(g.items.length, label(g.key))}</p>;
          const toggle = g.items.length > 3 ? (
            <button type="button" className="text-[11px] tracking-[0.2em] uppercase prive-gold hover:text-[color:var(--pv-champagne)] min-h-[44px] px-1"
              aria-expanded={index} onClick={() => setIndex((v) => !v)} data-testid="prive-region-toggle">
              {index ? t.browse.seeCarousel : t.browse.seeAll(g.items.length)}
            </button>
          ) : null;
          return index ? (
            <div className="space-y-4">
              <div className="flex items-end justify-between gap-3">{heading}{toggle}</div>
              <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-1" aria-label={label(g.key)} data-testid="prive-region-index">
                {sorted.map((d) => (
                  <li key={d.slug}>
                    <Link to={`/prive/destino/${d.slug}`} className="flex items-baseline justify-between gap-2 min-h-[44px] py-2 border-b border-[color:var(--pv-line)] hover:text-[color:var(--pv-champagne)]">
                      <span className="prive-serif text-lg leading-tight">{displayName(d, lang)}</span>
                      <span className="text-[11px] prive-gold shrink-0">{d.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Rail label={label(g.key)} heading={heading} actions={toggle} testId="prive-region-rail">
              {g.items.map((d) => <li key={d.slug}><DestinationCard d={d} /></li>)}
            </Rail>
          );
        })()}
      </div>
    </div>
  );
}

function Collections({ universes }: { universes: { key: PriveUniverse; count: number }[] }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const counts = new Map(universes.map((u) => [u.key, u.count]));
  const list = universesView(lang).map((u) => ({ ...u, count: counts.get(u.key) ?? 0 }))
    .sort((a, b) => Number(b.count > 0) - Number(a.count > 0));
  return (
    <section aria-labelledby="prive-collections-rail">
      <Rail label={t.browse.collectionsTitle} large testId="prive-collections" heading={<>
        <h2 id="prive-collections-rail" className="text-3xl sm:text-4xl">{t.browse.collectionsTitle}</h2>
        <p className="text-xs prive-muted mt-1">{t.browse.collectionsSub}</p>
      </>}>
        {list.map((u, i) => {
          const body = (
            <PrivePhoto queries={[u.imageQuery]} alt={t.common.photoAlt(u.name)} label={u.name} className="prive-veil aspect-[4/5]" creditClassName="is-inline">
              <div className="prive-dest-meta">
                <p className="text-[10px] tracking-[0.3em] prive-gold">{String(i + 1).padStart(2, "0")}</p>
                <p className="prive-serif text-2xl sm:text-[1.75rem] leading-tight mt-1">{u.name}</p>
                <p className="text-[12px] prive-champagne opacity-80 leading-snug mt-1 line-clamp-2">{u.es}</p>
                <p className="text-[10px] tracking-[0.22em] uppercase prive-gold mt-2">{u.count > 0 ? t.common.experiences(u.count) : t.common.curating}</p>
              </div>
            </PrivePhoto>
          );
          return (
            <li key={u.key} data-universe={u.key}>
              {u.count > 0
                ? <Link to={`/prive/universo/${u.key}`} className="prive-dest-card" aria-label={`${u.name} · ${t.common.experiences(u.count)}`}>{body}</Link>
                : <div className="prive-dest-card opacity-70">{body}</div>}
            </li>
          );
        })}
      </Rail>
    </section>
  );
}

/**
 * Inicio del catálogo Privé. Con `live` (hub real, con sesión Privé) agrega "Para ti" y la
 * "Experiencia de la semana", que piden datos al servidor; sin `live` (pruebas) solo usa `data`.
 * Orden editorial: ¿A dónde? → Para ti → Colecciones → Experiencia de la semana → Destinos
 * (Destacados + una región a la vez). Nada es una cuadrícula larga: todo está a uno o dos gestos.
 */
export function DestinationBrowser({ data, live = false }: { data: CatalogHomeData; live?: boolean }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const [q, setQ] = useState("");
  const [more, setMore] = useState(false);
  const inputId = useId();
  const list = useMemo(() => browsable(data.destinations), [data.destinations]);
  const groups = useMemo(() => {
    const featured = featuredDestinations(list, 8);
    return [...(featured.length ? [{ key: "destacados", items: featured }] : []), ...groupByRegion(list)];
  }, [list]);
  const results = useMemo(() => searchDestinations(list, q), [list, q]);
  const searching = q.trim().length > 0;
  const shown = more ? results : results.slice(0, SEARCH_LIMIT);

  return (
    <div className="space-y-16 sm:space-y-20" data-testid="prive-catalog-home" lang={lang === "en" ? "en" : "es-MX"}>
      <div className="space-y-3">
        <div role="search" className="prive-search prive-search-lg">
          <Search className="w-5 h-5 prive-gold shrink-0" aria-hidden="true" />
          <label htmlFor={inputId} className="sr-only">{t.browse.searchLabel}</label>
          <input id={inputId} type="search" inputMode="search" autoComplete="off" spellCheck={false} enterKeyHint="search"
            placeholder={t.browse.searchPlaceholder} value={q}
            onChange={(e) => { setQ(e.target.value); setMore(false); }}
            onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); setQ(""); } }}
            aria-describedby={searching ? `${inputId}-status` : undefined} data-testid="prive-dest-search" />
          {searching && (
            <button type="button" onClick={() => setQ("")} aria-label={t.browse.clearSearch} className="w-11 h-11 -mr-3 flex items-center justify-center prive-muted hover:text-[color:var(--pv-champagne)]">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="text-xs prive-muted text-center">{t.browse.summary(data.total, list.length)}</p>
      </div>

      {searching ? (
        <section aria-label={t.browse.searchLabel} className="space-y-4" data-testid="prive-search-results">
          <p id={`${inputId}-status`} role="status" aria-live="polite" className="text-sm prive-champagne">
            {results.length ? t.browse.results(results.length, q.trim()) : t.browse.noResults(q.trim())}
          </p>
          {results.length > 0 && (
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {shown.map((d) => <li key={d.slug}><DestinationCard d={d} /></li>)}
            </ul>
          )}
          {results.length > SEARCH_LIMIT && (
            <button type="button" className="prive-btn prive-btn-ghost" onClick={() => setMore((v) => !v)}>
              {more ? t.common.showLess : t.common.showMore(results.length - SEARCH_LIMIT)}
            </button>
          )}
        </section>
      ) : (
        <>
          {live && <PriveForYou destinations={list} universes={data.universes} />}
          <Collections universes={data.universes} />
          {live && <PriveSpotlight />}
          {groups.length > 0 && (
            <section aria-labelledby="prive-regions" className="space-y-5">
              <h2 id="prive-regions" className="text-3xl sm:text-4xl">{t.browse.destinations}</h2>
              <RegionTabs groups={groups} />
            </section>
          )}
        </>
      )}

      <p className="text-sm text-center"><Link to="/prive/solicitudes" className="prive-gold underline-offset-2 hover:underline">{t.browse.myRequests}</Link></p>
    </div>
  );
}
