// Versiones funcionales de las ranuras de FOR YOU que el contrato asigna a `privekey`
// (CuratedForYou, YourNextJourney, PriveKeyLauncher). Se exportan desde src/components/prive/key/index.ts
// mientras ese equipo no publique las suyas. Sin props obligatorias; leen el contexto de la portada.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Bookmark, BookmarkCheck, CalendarDays, KeyRound } from "lucide-react";
import { usePriveCatalog, type PriveExperience } from "@/lib/priveCatalogApi";
import { imageQueries, shortDate, universeMeta } from "@/lib/priveCatalogView";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { displayName, placeLine } from "@/lib/priveBrowse";
import { askIatoHref, PLAN_TRIP_HREF } from "@/lib/priveLinks";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { Rail } from "@/components/prive/catalog/Rail";
import { usePriveHome, usePriveTrip } from "./context";
import { BrandTitle } from "./BrandTitle";

const PUBLISHABLE = new Set(["VERIFICADO", "CURADO", "ESTIMADO"]);

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

function useLoad<T>(load: (() => Promise<T>) | null, key: string): { data: T | null; done: boolean } {
  const [state, setState] = useState<{ data: T | null; done: boolean }>({ data: null, done: false });
  useEffect(() => {
    if (!load) return;
    let alive = true;
    setState({ data: null, done: false });
    load().then((x) => { if (alive) setState({ data: x, done: true }); }).catch(() => { if (alive) setState({ data: null, done: true }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/**
 * CURATED FOR YOU (Fase 1.3): 3–6 experiencias. Con viaje activo a un destino de Privé:
 * prive_for_you(destino, fechas) — el servidor ordena con las señales de la persona. Sin viaje:
 * selección editorial verificable del universo con más contenido, dicha como tal (sin fingir).
 */
export function CuratedForYou() {
  const api = usePriveCatalog();
  const t = usePriveT();
  const lang = usePriveLang();
  const home = usePriveHome();
  const { dest, trip, loading } = usePriveTrip();
  const top = useMemo(() => [...(home?.universes ?? [])].filter((u) => u.key !== "casino_grand_nights").sort((a, b) => b.count - a.count)[0]?.key ?? "the_table", [home]);
  const load = loading ? null : dest
    ? () => api.forYou(dest.slug, trip?.fecha_salida ?? null, trip?.fecha_regreso ?? null, 6)
    : () => api.universe(top, null, 6).then((r) => r.experiences ?? []);
  const { data } = useLoad<PriveExperience[]>(load, `${loading}|${dest?.slug ?? ""}|${top}`);
  const list = (data ?? []).filter((e) => PUBLISHABLE.has(e.state)).slice(0, 6);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="prive-curated" data-testid="prive-for-you">
      <Rail label={t.home.curatedBrand} large testId="prive-for-you-rail" heading={
        <BrandTitle id="prive-curated" brand={t.home.curatedBrand} sub={t.home.curatedSub}
          note={dest ? t.home.curatedTrip(displayName(dest, lang)) : t.home.curatedEditor} />}>
        {list.map((e) => <li key={e.id}><FeaturedExperienceCard e={e} /></li>)}
      </Rail>
    </section>
  );
}

/** YOUR NEXT JOURNEY (Fase 1.5): el viaje activo (nunca otro) o una invitación a planear uno. */
export function YourNextJourney() {
  const t = usePriveT();
  const lang = usePriveLang();
  const home = usePriveHome();
  const { trip, dest, loading } = usePriveTrip();
  if (loading) return null;
  if (!trip) {
    return (
      <section aria-labelledby="prive-next" className="prive-panel p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center justify-between gap-5" data-testid="prive-next-journey">
        <BrandTitle id="prive-next" brand={t.home.nextBrand} sub={t.home.nextSub} note={t.home.nextNoTripBody} small />
        <Link to={PLAN_TRIP_HREF} className="prive-btn prive-btn-gold shrink-0">{t.home.nextPlan}</Link>
      </section>
    );
  }
  const city = dest ? displayName(dest, lang) : (trip.destino ?? "").split(",")[0];
  const inCatalog = dest ? (home?.destinations ?? []).find((d) => d.slug === dest.slug) : null;
  const dates = trip.fecha_salida ? t.home.nextDates(shortDate(trip.fecha_salida, lang), trip.fecha_regreso ? shortDate(trip.fecha_regreso, lang) : null) : null;
  const q = new URLSearchParams();
  if (trip.fecha_salida) q.set("desde", trip.fecha_salida);
  if (trip.fecha_regreso) q.set("hasta", trip.fecha_regreso);
  return (
    <section aria-labelledby="prive-next" className="prive-journey" data-testid="prive-next-journey">
      {/* Otra foto de la ciudad (la segunda consulta) para no repetir la de la portada. */}
      {dest && <PrivePhoto queries={[...destinationPhotoQueries(dest.slug, dest.name).slice(1), ...destinationPhotoQueries(dest.slug, dest.name).slice(0, 1)]} alt={t.common.photoAlt(city)} label={city} className="prive-journey-photo" creditClassName="is-hero" />}
      <div className="prive-journey-veil" aria-hidden="true" />
      <div className="relative z-[2] p-6 sm:p-10 flex flex-col justify-end h-full">
        <p className="prive-eyebrow">{t.home.nextBrand}{t.home.nextSub ? <span className="prive-muted normal-case tracking-normal"> · {t.home.nextSub}</span> : null}</p>
        <h2 id="prive-next" className="prive-display text-4xl sm:text-5xl mt-3">{t.home.nextTitle(city)}</h2>
        {dates && <p className="text-sm prive-champagne mt-2 inline-flex items-center gap-2"><CalendarDays className="w-4 h-4" aria-hidden="true" />{dates}{dest ? ` · ${placeLine(dest.slug, lang)}` : ""}</p>}
        {dest && inCatalog && inCatalog.count > 0 ? (
          <div className="mt-6 space-y-3">
            <Link to={`/prive/destino/${dest.slug}`} className="prive-btn prive-btn-gold">{t.home.nextExplore(city)}</Link>
            <div className="flex flex-wrap gap-2">
              <Link to={`/prive/destino/${dest.slug}?${q.toString()}#para-tus-fechas`} className="prive-chip-btn prive-btn-glass">{t.home.nextForDates}</Link>
              <Link to={`/prive/key?destino=${dest.slug}`} className="prive-chip-btn prive-btn-glass">{t.home.nextNight}</Link>
              <Link to={`/dashboard/viajes/${trip.id}`} className="prive-chip-btn prive-btn-glass">{t.home.nextAdd}</Link>
            </div>
          </div>
        ) : (
          <div className="mt-5 space-y-4 max-w-xl">
            <p className="text-sm prive-muted">{t.home.nextNotInPrive(city)}</p>
            <div className="flex flex-wrap gap-2">
              <Link to={askIatoHref(t.exp.askAbout(city, null))} className="prive-btn prive-btn-gold">{t.home.askIato}</Link>
              <Link to={`/dashboard/viajes/${trip.id}`} className="prive-btn prive-btn-ghost prive-btn-glass">{t.home.nextTrip(city)}</Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Acceso destacado a THE PRIVÉ KEY: escribir lo que se quiere vivir y abrir The Key con ese texto. */
export function PriveKeyLauncher() {
  const t = usePriveT();
  const navigate = useNavigate();
  const { dest } = usePriveTrip();
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams();
    if (text.trim()) q.set("q", text.trim().slice(0, 400));
    if (dest) q.set("destino", dest.slug);
    navigate(`/prive/key${q.toString() ? `?${q}` : ""}`);
  };
  return (
    <section aria-labelledby="prive-key-launch" className="prive-key-card" data-testid="prive-key-launcher">
      <div className="flex items-center gap-3"><KeyRound className="w-5 h-5 prive-gold" aria-hidden="true" />
        <BrandTitle id="prive-key-launch" brand={t.home.keyBrand} sub={t.home.keySub} small />
      </div>
      <p className="text-sm prive-muted mt-3 max-w-xl">{t.home.keyBody}</p>
      <form onSubmit={submit} className="mt-5 flex flex-col sm:flex-row gap-3">
        <label htmlFor="prive-key-input" className="sr-only">{t.home.keyBrand}</label>
        <input id="prive-key-input" className="prive-input flex-1" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} placeholder={t.home.keyPlaceholder} />
        <button type="submit" className="prive-btn prive-btn-gold shrink-0">{t.home.keyCta}<ArrowRight className="w-4 h-4" aria-hidden="true" /></button>
      </form>
    </section>
  );
}
