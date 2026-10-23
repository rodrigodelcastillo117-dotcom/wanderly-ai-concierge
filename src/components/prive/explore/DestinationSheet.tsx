// Tarjeta del destino en el mapa "¿Cuándo ir?": foto, por qué en ese mes (clima con fuente), eventos con
// fecha del catálogo, horas de vuelo ESTIMADAS y "Ver destino" / "Planear".
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Plane, X } from "lucide-react";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { placeLine } from "@/lib/priveBrowse";
import { PRIVE_LOCALE } from "@/lib/priveI18n";
import type { PriveExperience } from "@/lib/priveCatalogApi";
import { eventDates, planHref, type FlightEstimate, type MonthClimate } from "@/lib/priveExplore";
import type { Origin } from "./useExploreData";

export function SeasonBadge({ kind }: { kind: MonthClimate["kind"] }) {
  const t = usePriveT();
  const label = kind === "good" ? t.map.good : kind === "snow" ? t.map.snow : kind === "off" ? t.map.off : t.map.unknown;
  return <span className={`pv-badge ${kind === "good" ? "is-good" : kind === "snow" ? "is-snow" : ""}`}>{label}</span>;
}

export function DestinationSheet({ slug, name, month, climate, best, events, flight, origin, count, onClose }: {
  slug: string; name: string; month: number; climate: MonthClimate; best: number[]; events: PriveExperience[];
  flight: FlightEstimate | null; origin: Origin | null; count: number; onClose: () => void;
}) {
  const t = usePriveT();
  const lang = usePriveLang();
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [slug]);
  const m = t.map.months[month];
  const why = climate.kind === "good" ? t.map.whyGood(m) : climate.kind === "snow" ? t.map.whySnow(m) : climate.kind === "off" ? t.map.whyOff(m) : null;
  return (
    <article className="pv-sheet" aria-labelledby="pv-sheet-title" data-testid="prive-map-sheet" data-slug={slug}>
      <div className="relative">
        <PrivePhoto queries={destinationPhotoQueries(slug, name)} alt={t.common.photoAlt(name)} label={name} className="prive-veil" creditClassName="is-inline" />
        <button type="button" onClick={onClose} aria-label={t.map.close}
          className="absolute right-3 top-3 z-[3] w-10 h-10 rounded-full flex items-center justify-center bg-black/60 border border-[color:var(--pv-line-strong)] text-[color:var(--pv-champagne)]">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <div className="p-5 space-y-3">
        <div>
          <p className="text-[10px] tracking-[0.22em] uppercase prive-gold">{placeLine(slug, lang)}</p>
          <h3 id="pv-sheet-title" ref={head} tabIndex={-1} className="prive-serif text-3xl leading-tight mt-1 focus:outline-none">{name}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <SeasonBadge kind={climate.kind} />
          {events.length > 0 && <span className="pv-badge is-event">{t.map.events(events.length)}</span>}
        </div>
        {why && <p className="text-sm prive-champagne">{why}</p>}
        {climate.high != null && climate.low != null && climate.rain != null && (
          <p className="text-sm" data-testid="prive-map-climate">{t.map.climateLine(climate.high, climate.low, climate.rain)}</p>
        )}
        {climate.snow != null && climate.snow >= 0.2 && <p className="text-xs prive-muted">{t.map.snowLine(Math.round(climate.snow * 100))}</p>}
        {best.length > 0 && best.length < 12 && <p className="text-xs prive-muted">{t.map.bestMonths(best.map((i) => t.map.monthsShort[i]).join(", "))}</p>}
        <p className="text-[11px] prive-muted">{t.map.climateSource}</p>
        {events.length > 0 && (
          <div className="space-y-2 pt-1" data-testid="prive-map-events">
            <p className="prive-eyebrow">{t.map.eventsTitle(m)}</p>
            <ul className="space-y-2">
              {events.slice(0, 4).map((e) => (
                <li key={e.id} className="flex items-start gap-2 text-sm">
                  <CalendarDays className="w-4 h-4 mt-0.5 prive-gold flex-none" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="prive-champagne">{e.name}</span> <span className="prive-muted">· {eventDates(e, PRIVE_LOCALE[lang])}</span>
                    <Link to={`/prive/experiencia/${e.slug}`} className="block text-xs prive-link mt-0.5">{t.map.eventSource}</Link>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-sm flex items-start gap-2 pt-1" data-testid="prive-map-flight">
          <Plane className="w-4 h-4 mt-0.5 prive-gold flex-none" aria-hidden="true" />
          {origin && flight ? (
            <span>
              {flight.short ? t.map.flightShort(origin.label) : t.map.flight(flight.hours, origin.label)}
              <span className="block text-[11px] prive-muted">{t.map.flightNote}</span>
            </span>
          ) : origin && origin.key === slug ? null : <span className="prive-muted">{t.map.originNone}</span>}
        </div>
        {count > 0 && <p className="text-xs prive-muted">{t.common.experiences(count)}</p>}
        <div className="flex flex-wrap gap-2 pt-2">
          <Link to={`/prive/destino/${slug}`} className="prive-btn prive-btn-gold">{t.map.open}</Link>
          <Link to={planHref(name)} className="prive-btn prive-btn-ghost">{t.map.plan}</Link>
        </div>
      </div>
    </article>
  );
}
