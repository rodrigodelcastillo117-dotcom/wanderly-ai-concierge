// Partes "vivas" del hub de Privé (con sesión Privé): "Para ti" y "Experiencia de la semana".
// Para ti: si la persona tiene un viaje activo a un destino de Privé, prive_for_you(destino, fechas)
// (el servidor ordena con sus señales: Travel DNA con permiso, guardados, solicitudes); si no, el
// universo con más contenido ordenado por prive_universe con las mismas señales. Nada se inventa:
// sin datos, la sección no aparece.
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useActiveTrip } from "@/hooks/useActiveTrip";
import { usePriveCatalog, type PriveExperience, type PriveUniverse } from "@/lib/priveCatalogApi";
import { imageQueries, universeMeta } from "@/lib/priveCatalogView";
import { displayName, matchScore, normalizeQuery, type BrowseDestination } from "@/lib/priveBrowse";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { Rail } from "./Rail";

const PUBLISHABLE = new Set(["VERIFICADO", "CURADO", "ESTIMADO"]);

/** Destino de Privé al que va el viaje activo ("Ciudad de México, México" → cdmx), o null. */
export function tripDestination(destino: string | null | undefined, list: BrowseDestination[]): BrowseDestination | null {
  const q = normalizeQuery(String(destino ?? "").split(/[,(]/)[0]);
  if (!q) return null;
  let best: BrowseDestination | null = null;
  let score = 0;
  for (const d of list) {
    const s = matchScore(d, q);
    if (s > score) { score = s; best = d; }
  }
  return score >= 65 ? best : null;
}

/** Semana ISO (para rotar la experiencia destacada una vez por semana). */
export function isoWeek(d = new Date()): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - y0.getTime()) / 864e5 + 1) / 7);
}

/** La experiencia de la semana: publicable, con reconocimientos primero; rota entre las 5 mejores. */
export function pickSpotlight(list: PriveExperience[], week = isoWeek()): PriveExperience | null {
  const strong = list.filter((e) => e.state === "VERIFICADO" || e.state === "CURADO");
  const ok = strong.length ? strong : list.filter((e) => PUBLISHABLE.has(e.state));
  if (!ok.length) return null;
  const ranked = [...ok].sort((a, b) => (b.accolades?.length ?? 0) - (a.accolades?.length ?? 0));
  const top = ranked.slice(0, Math.min(5, ranked.length));
  return top[week % top.length];
}

export function ExperienceTile({ e }: { e: PriveExperience }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const meta = universeMeta(e.universe, lang);
  const city = e.destination ? displayName(e.destination, lang) : null;
  return (
    <Link to={`/prive/experiencia/${e.slug}`} className="prive-dest-card" data-testid="prive-exp-tile">
      <PrivePhoto queries={imageQueries(e)} alt={e.name} label={e.name} illustrative={e.image?.illustrative !== false}
        className="prive-veil aspect-[4/5]" creditClassName="is-inline">
        <div className="prive-dest-meta">
          <p className="text-[10px] tracking-[0.22em] uppercase prive-gold">{meta?.name}{city ? ` · ${city}` : ""}</p>
          <p className="prive-serif text-xl leading-tight mt-1">{e.name}</p>
          {e.why && <p className="text-[12px] prive-champagne leading-snug mt-1 line-clamp-2 opacity-80">{e.why}</p>}
        </div>
      </PrivePhoto>
      <span className="sr-only">{t.browse.discover}</span>
    </Link>
  );
}

function useSafe<T>(load: (() => Promise<T>) | null, key: string): T | null {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (!load) { setV(null); return; }
    let alive = true;
    load().then((x) => { if (alive) setV(x); }).catch(() => { if (alive) setV(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return v;
}

export function PriveForYou({ destinations, universes }: { destinations: BrowseDestination[]; universes: { key: PriveUniverse; count: number }[] }) {
  const api = usePriveCatalog();
  const t = usePriveT();
  const lang = usePriveLang();
  const { trip, loading } = useActiveTrip();
  const dest = useMemo(() => (loading ? null : tripDestination(trip?.destino ?? null, destinations)), [loading, trip?.destino, destinations]);
  const topUniverse = useMemo(() => [...universes].filter((u) => u.key !== "the_table" && u.key !== "casino_grand_nights")
    .sort((a, b) => b.count - a.count)[0]?.key ?? "the_table", [universes]);
  const load = loading ? null : dest
    ? () => api.forYou(dest.slug, (trip as { fecha_salida?: string | null } | null)?.fecha_salida ?? null, (trip as { fecha_regreso?: string | null } | null)?.fecha_regreso ?? null, 10)
    : () => api.universe(topUniverse, null, 10).then((r) => r.experiences ?? []);
  const items = useSafe<PriveExperience[]>(load, `${loading}|${dest?.slug ?? ""}|${topUniverse}`);
  const list = (items ?? []).filter((e) => PUBLISHABLE.has(e.state));
  if (!list.length) return null;
  return (
    <section aria-labelledby="prive-foryou" data-testid="prive-for-you">
      <Rail label={t.browse.forYouTitle} large testId="prive-for-you-rail" heading={<>
        <h2 id="prive-foryou" className="text-3xl sm:text-4xl">{t.browse.forYouTitle}</h2>
        <p className="text-xs prive-muted mt-1">{dest ? t.browse.forYouTrip(displayName(dest, lang)) : t.browse.forYouEditor}</p>
      </>}>
        {list.map((e) => <li key={e.id}><ExperienceTile e={e} /></li>)}
      </Rail>
    </section>
  );
}

export function PriveSpotlight() {
  const api = usePriveCatalog();
  const t = usePriveT();
  const lang = usePriveLang();
  const items = useSafe<PriveExperience[]>(() => api.universe("the_table", null, 12).then((r) => r.experiences ?? []), "the_table");
  const e = useMemo(() => (items ? pickSpotlight(items) : null), [items]);
  if (!e) return null;
  const meta = universeMeta(e.universe, lang);
  const city = e.destination ? displayName(e.destination, lang) : null;
  const accolade = e.accolades?.[0];
  return (
    <section aria-labelledby="prive-spotlight" data-testid="prive-spotlight">
      <Link to={`/prive/experiencia/${e.slug}`} className="prive-spotlight group">
        <PrivePhoto queries={imageQueries(e)} alt={e.name} label={e.name} illustrative={e.image?.illustrative !== false} />
        <div className="prive-spotlight-veil" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 z-[2] p-6 sm:p-10 max-w-2xl">
          <p className="prive-eyebrow">{t.browse.spotlightEyebrow}</p>
          <div className="prive-gold-rule my-4" aria-hidden="true" />
          <p className="text-[11px] tracking-[0.22em] uppercase prive-champagne">{meta?.name}{city ? ` · ${city}` : ""}</p>
          <h2 id="prive-spotlight" className="prive-display text-4xl sm:text-6xl mt-2">{e.name}</h2>
          {accolade && <p className="text-xs prive-gold mt-3">{accolade.name} · {accolade.year}</p>}
          {e.why && <p className="text-sm sm:text-base prive-champagne mt-3 line-clamp-3 max-w-xl">{e.why}</p>}
          <span className="prive-btn prive-btn-gold mt-6 inline-flex">{t.browse.discover}<ArrowRight className="w-4 h-4" aria-hidden="true" /></span>
        </div>
      </Link>
    </section>
  );
}
