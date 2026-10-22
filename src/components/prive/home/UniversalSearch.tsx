// Búsqueda universal (Fase 1.2) para FOR YOU y EXPLORE. Mientras se escribe: destinos al instante
// (sin servidor). Al confirmar (Enter o el botón): prive_search con destino, universos y palabras clave.
// Sin resultados: se dice, y "Pregúntale a Iato" lleva la misma frase al Concierge (IA solo si la
// persona lo pide; nunca por tecla). La consulta queda en la URL (?q=) para volver con el mismo estado.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Search, Sparkles, X } from "lucide-react";
import { usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { imageQueries, universeMeta } from "@/lib/priveCatalogView";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { displayName, placeLine, type BrowseDestination } from "@/lib/priveBrowse";
import { destinationMatches, parseSearch, searchArgs } from "@/lib/priveSearch";
import { askIatoHref } from "@/lib/priveLinks";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";

/** COMPACT EXPERIENCE (Fase 5): foto pequeña, texto útil y la acción a la vista. */
export function CompactExperienceCard({ e }: { e: PriveExperience }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const meta = universeMeta(e.universe, lang);
  const city = e.destination ? displayName(e.destination, lang) : null;
  return (
    <Link to={`/prive/experiencia/${e.slug}`} className="prive-compact" data-testid="prive-compact-exp">
      <PrivePhoto queries={imageQueries(e)} alt={e.name} label={e.name} className="prive-compact-photo" credit={false} />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] tracking-[0.2em] uppercase prive-gold truncate">{meta?.name}{city ? ` · ${city}` : ""}</span>
        <span className="block prive-serif text-lg leading-tight mt-0.5">{e.name}</span>
        {e.why && <span className="block text-[12px] prive-muted leading-snug line-clamp-2 mt-1">{e.why}</span>}
      </span>
      <span className="prive-compact-go" aria-hidden="true"><ArrowRight className="w-4 h-4" /></span>
    </Link>
  );
}

function CompactDestination({ d }: { d: BrowseDestination }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const name = displayName(d, lang);
  return (
    <Link to={`/prive/destino/${d.slug}`} className="prive-compact" data-testid="prive-search-dest" data-slug={d.slug}>
      <PrivePhoto queries={destinationPhotoQueries(d.slug, d.name)} alt={t.common.photoAlt(name)} label={name} className="prive-compact-photo" credit={false} />
      <span className="min-w-0 flex-1">
        <span className="block prive-serif text-lg leading-tight">{name}</span>
        <span className="block text-[12px] prive-muted mt-0.5">{placeLine(d.slug, lang)}{d.count > 0 ? ` · ${t.common.experiences(d.count)}` : ""}</span>
      </span>
      <span className="prive-compact-go" aria-hidden="true"><ArrowRight className="w-4 h-4" /></span>
    </Link>
  );
}

type Result = { status: "idle" | "loading" | "done" | "error"; q: string; items: PriveExperience[]; city: string | null };

export function UniversalSearch({ destinations, fallbackCities, variant = "hero" }: {
  destinations: BrowseDestination[]; fallbackCities: string[]; variant?: "hero" | "plain";
}) {
  const t = usePriveT();
  const lang = usePriveLang();
  const api = usePriveCatalog();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(() => sp.get("q") ?? "");
  const [res, setRes] = useState<Result>({ status: "idle", q: "", items: [], city: null });
  const id = useId();
  const ran = useRef<string | null>(null);
  const parsed = useMemo(() => parseSearch(q), [q]);
  const dests = useMemo(() => destinationMatches(destinations, parsed).slice(0, 6), [destinations, parsed]);
  const typing = q.trim().length > 0;

  const run = async (query: string) => {
    const p = parseSearch(query);
    if (!query.trim()) return;
    ran.current = query;
    setRes({ status: "loading", q: query, items: [], city: null });
    const next = new URLSearchParams(sp);
    next.set("q", query.trim());
    setSp(next, { replace: true });
    try {
      const r = await api.search(searchArgs(p, fallbackCities));
      const items = (r.cities ?? []).flatMap((c) => c.items ?? []).filter((e) => e.state !== "DESACTUALIZADO");
      const uniq = [...new Map(items.map((e) => [e.id, e])).values()].slice(0, 12);
      const city = p.cities.length === 1 ? (r.cities?.[0]?.city?.name ?? null) : null;
      setRes({ status: "done", q: query, items: uniq, city });
    } catch {
      setRes({ status: "error", q: query, items: [], city: null });
    }
  };

  // Al volver con ?q= en la URL, se repite la búsqueda una vez (restaurar contexto).
  useEffect(() => {
    const initial = sp.get("q");
    if (initial && ran.current === null) void run(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: FormEvent) => { e.preventDefault(); void run(q); };
  const clear = () => {
    setQ(""); ran.current = null; setRes({ status: "idle", q: "", items: [], city: null });
    const next = new URLSearchParams(sp); next.delete("q"); setSp(next, { replace: true });
  };
  const showExpButton = typing && !parsed.destinationOnly && res.q !== q;

  return (
    <div className="space-y-4" data-testid="prive-universal-search">
      <form role="search" onSubmit={submit} className={`prive-search ${variant === "hero" ? "prive-search-lg" : ""}`}>
        <Search className="w-5 h-5 prive-gold shrink-0" aria-hidden="true" />
        <label htmlFor={id} className="sr-only">{t.home.searchLabel}</label>
        <input id={id} type="search" inputMode="search" autoComplete="off" spellCheck={false} enterKeyHint="search"
          placeholder={t.home.searchPlaceholder} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && q) { e.preventDefault(); clear(); } }} data-testid="prive-search-input" />
        {typing && (
          <button type="button" onClick={clear} aria-label={t.browse.clearSearch} className="w-11 h-11 -mr-3 flex items-center justify-center prive-muted hover:text-[color:var(--pv-champagne)]">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </form>

      {typing && (dests.length > 0 || showExpButton) && (
        <div className="prive-search-panel" aria-live="polite">
          {dests.length > 0 && (
            <div>
              <p className="prive-eyebrow mb-2">{t.home.destResults}</p>
              <ul className="grid sm:grid-cols-2 gap-2">{dests.map((d) => <li key={d.slug}><CompactDestination d={d} /></li>)}</ul>
            </div>
          )}
          {showExpButton && (
            <button type="button" onClick={() => void run(q)} className="prive-btn prive-btn-ghost w-full sm:w-auto mt-3 normal-case tracking-normal text-sm" data-testid="prive-search-run">
              <Search className="w-4 h-4" aria-hidden="true" />{t.home.searchExperiences(q.trim())}
            </button>
          )}
        </div>
      )}

      {res.status !== "idle" && (
        <section aria-label={t.home.searchLabel} className="space-y-3" data-testid="prive-search-exp-results">
          <p role="status" className="text-sm prive-champagne">
            {res.status === "loading" ? t.home.searching
              : res.items.length ? t.home.expResults(res.items.length, res.city) : t.home.noExp(res.q)}
          </p>
          {res.items.length > 0 && <ul className="grid sm:grid-cols-2 gap-2">{res.items.map((e) => <li key={e.id}><CompactExperienceCard e={e} /></li>)}</ul>}
          {(res.status === "done" || res.status === "error") && (
            <Link to={askIatoHref(res.q)} className="inline-flex items-center gap-2 text-sm prive-gold underline-offset-4 hover:underline" data-testid="prive-search-ask">
              <Sparkles className="w-4 h-4" aria-hidden="true" />{t.home.askIatoAbout(res.q)}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
