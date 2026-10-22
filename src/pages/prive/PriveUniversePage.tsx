import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { usePriveCatalog, type PriveUniverse } from "@/lib/priveCatalogApi";
import { universeMeta } from "@/lib/priveCatalogView";
import { displayName } from "@/lib/priveBrowse";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { ShowMore } from "@/components/prive/catalog/ShowMore";
import { AgeGate } from "@/components/prive/catalog/AgeGate";
import { ExperienceCard } from "@/components/prive/catalog/ExperienceCard";
import { PriveCatalogShell } from "@/components/prive/catalog/PriveCatalogShell";
import { PRIVE } from "@/components/prive/catalog/theme";
import { usePriveLoad } from "@/components/prive/catalog/usePriveLoad";

/**
 * /prive/universo/:key[?destino=slug] — un universo con identidad (Fase 4): foto propia, marca en
 * inglés con subtítulo, descripción, filtro por destino (en la URL, para volver igual) y destinos
 * relacionados. Sin contenido verificable: "Selección en preparación", nunca una página que parezca llena.
 */
export default function PriveUniversePage() {
  const api = usePriveCatalog();
  const { key = "" } = useParams();
  const [sp, setSp] = useSearchParams();
  const dest = sp.get("destino");
  const t = usePriveT();
  const lang = usePriveLang();
  const meta = universeMeta(key, lang);
  const { data, loading, locked, error, reload } = usePriveLoad(() => api.universe(key as PriveUniverse, null), [key]);
  const all = useMemo(() => data?.experiences ?? [], [data]);
  const byDest = useMemo(() => {
    const m = new Map<string, { slug: string; name: string; n: number }>();
    for (const e of all) if (e.destination) {
      const cur = m.get(e.destination.slug) ?? { slug: e.destination.slug, name: e.destination.name, n: 0 };
      cur.n += 1; m.set(e.destination.slug, cur);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [all]);
  const shown = dest ? all.filter((e) => e.destination?.slug === dest) : all;
  const pick = (slug: string | null) => { const n = new URLSearchParams(sp); if (slug) n.set("destino", slug); else n.delete("destino"); setSp(n, { replace: true }); };
  return (
    <PriveCatalogShell loading={loading} locked={locked} error={error} back="/prive/explorar" backLabel={t.shell.explore}>
      {!meta || !data?.found ? (
        <p className={PRIVE.muted} role="status">{t.catalog.universeNotFound}</p>
      ) : (
        <div className="space-y-10">
          <header className="prive-dest-hero" data-testid="prive-universe-hero">
            <PrivePhoto queries={[meta.imageQuery]} alt={meta.name} label={meta.name} eager className="prive-veil prive-dest-hero-photo" creditLinks creditClassName="is-hero">
              <div className="absolute inset-x-0 bottom-0 z-[2] p-6 sm:p-10 max-w-3xl">
                <p className={`text-[11px] tracking-[0.24em] uppercase ${PRIVE.gold}`}>IATOS PRIVÉ</p>
                <h1 className="prive-display text-5xl sm:text-7xl mt-2">{meta.name}</h1>
                {meta.sub && <p className="text-[12px] tracking-[0.2em] uppercase prive-champagne mt-2">{meta.sub}</p>}
                <p className="prive-champagne mt-3 text-sm sm:text-base">{meta.es}</p>
              </div>
            </PrivePhoto>
          </header>
          {meta.note && <p className="text-xs text-[#d8c08a]" role="note">{meta.note}</p>}
          <AgeGate count={data.age_locked_count ?? 0} termsVersion={(data as { adult_terms_version?: string }).adult_terms_version ?? ""} onConfirmed={reload} />
          {all.length === 0 ? (
            <div className={`${PRIVE.card} p-6 space-y-2`} role="status">
              <p className="prive-eyebrow">{t.explore.preparing}</p>
              <p className={`text-sm ${PRIVE.muted}`}>{t.catalog.universeEmpty}</p>
              <Link to="/prive/explorar" className="prive-link text-sm">{t.shell.explore}</Link>
            </div>
          ) : (
            <>
              {byDest.length > 1 && (
                <nav aria-label={t.explore.filterBy} className="prive-chip-row">
                  <button type="button" onClick={() => pick(null)} aria-pressed={!dest} className={`rounded-full px-3 py-1 text-xs ${!dest ? PRIVE.button : PRIVE.ghost}`}>{t.explore.filterAll}</button>
                  {byDest.map((d) => (
                    <button type="button" key={d.slug} onClick={() => pick(d.slug)} aria-pressed={dest === d.slug}
                      className={`rounded-full px-3 py-1 text-xs ${dest === d.slug ? PRIVE.button : PRIVE.ghost}`}>{displayName(d, lang)} · {d.n}</button>
                  ))}
                </nav>
              )}
              <ShowMore items={shown} resetKey={`${key}|${dest ?? ""}`} render={(e) => <ExperienceCard key={e.id} e={e} />} />
              {byDest.length > 0 && (
                <section aria-labelledby="prive-uni-related" className="space-y-3">
                  <h2 id="prive-uni-related" className="text-2xl">{t.explore.related}</h2>
                  <p className="text-sm">{byDest.slice(0, 8).map((d, i) => (
                    <span key={d.slug}>{i ? " · " : ""}<Link to={`/prive/destino/${d.slug}?u=${key}`} className="prive-link">{displayName(d, lang)}</Link></span>
                  ))}</p>
                </section>
              )}
            </>
          )}
        </div>
      )}
    </PriveCatalogShell>
  );
}
