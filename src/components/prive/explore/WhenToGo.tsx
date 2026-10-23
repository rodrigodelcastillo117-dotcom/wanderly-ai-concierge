// Pestaña "Mapa" de Explorar: "¿A dónde ir en <mes>?". Elegir el mes marca cada destino Privé del catálogo
// con su clima típico (NASA POWER, con fuente), los eventos con fecha del catálogo y las horas de vuelo
// estimadas desde la ciudad de la persona. Tocar un destino abre su tarjeta. Se carga diferido (React.lazy):
// los datos de clima y el mapa solo bajan al abrir esta pestaña.
import { lazy, Suspense, useId, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import "./explore.css";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { browsable, displayName, type BrowseDestination } from "@/lib/priveBrowse";
import { PRIVE_CLIMATE_SOURCE, PRIVE_GEO } from "@/lib/priveExploreGeo";
import { eventsByDestination, flightEstimate, inSeason, monthClimate, seasonMonths, yearFor } from "@/lib/priveExplore";
import { DestinationSheet, SeasonBadge } from "./DestinationSheet";
import { MonthPicker, parseMonth } from "./MonthPicker";
import { useCatalogEvents, useOrigin } from "./useExploreData";
import type { MapPin } from "./WorldMap";

const WorldMap = lazy(() => import("./WorldMap"));

type Filter = "all" | "season" | "events";
const PAGE = 12;

export default function WhenToGo({ destinations }: { destinations: BrowseDestination[] }) {
  const t = usePriveT();
  const lang = usePriveLang();
  const [sp, setSp] = useSearchParams();
  const month = parseMonth(sp.get("mes"));
  const setMonth = (m: number) => { const n = new URLSearchParams(sp); n.set("mes", String(m + 1)); setSp(n, { replace: true }); };
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const events = useCatalogEvents();
  const { origin, options, choose } = useOrigin(lang);
  const legendId = useId();
  const listId = useId();
  const m = t.map.months[month];

  const rows = useMemo(() => {
    const evs = eventsByDestination(events, yearFor(month), month);
    return browsable(destinations)
      .filter((d) => PRIVE_GEO[d.slug])
      .map((d) => {
        const geo = PRIVE_GEO[d.slug];
        const climate = monthClimate(geo, month);
        return { d, name: displayName(d, lang), geo, climate, events: evs.get(d.slug) ?? [], flight: flightEstimate(origin?.coord, geo) };
      })
      .sort((a, b) => Number(inSeason(b.climate.kind)) - Number(inSeason(a.climate.kind)) || b.events.length - a.events.length
        || b.d.count - a.d.count || a.name.localeCompare(b.name, lang));
  }, [destinations, events, month, lang, origin?.coord]);
  const counts = useMemo(() => ({
    all: rows.length, season: rows.filter((r) => inSeason(r.climate.kind)).length, events: rows.filter((r) => r.events.length > 0).length,
  }), [rows]);
  const visible = useMemo(() => rows.filter((r) => filter === "all" || (filter === "season" ? inSeason(r.climate.kind) : r.events.length > 0)), [rows, filter]);
  const pins: MapPin[] = useMemo(() => visible.map((r) => ({ slug: r.d.slug, name: r.name, lat: r.geo.lat, lng: r.geo.lng, kind: r.climate.kind, events: r.events.length })), [visible]);
  const sel = selected ? rows.find((r) => r.d.slug === selected) ?? null : null;
  const top = rows.filter((r) => inSeason(r.climate.kind)).slice(0, 5);

  const pick = (slug: string) => setSelected(slug);
  // Desde la lista: en escritorio se ve el mapa con la tarjeta encima; en el teléfono, la tarjeta (va debajo del mapa).
  const revealSheet = () => window.requestAnimationFrame?.(() => {
    const wide = window.matchMedia?.("(min-width: 1024px)").matches;
    document.getElementById(wide ? "pv-map-wrap" : "pv-sheet-wrap")?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: t.map.filterAll(counts.all) },
    { key: "season", label: t.map.filterSeason(counts.season) },
    { key: "events", label: t.map.filterEvents(counts.events) },
  ];

  return (
    <section aria-labelledby="pv-when-title" className="space-y-5" data-testid="prive-explore-map" data-month={month}>
      <header className="space-y-4">
        <h2 id="pv-when-title" className="text-3xl sm:text-[2.6rem] leading-tight">{t.map.whereIn(m)}</h2>
        <MonthPicker value={month} onChange={(v) => { setMonth(v ?? month); setShown(PAGE); }} label={t.map.monthLabel} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div role="radiogroup" aria-label={t.map.filterLabel} className="flex flex-wrap gap-2">
            {filters.map((f) => (
              <button key={f.key} type="button" role="radio" aria-checked={filter === f.key} className="pv-x-chip" onClick={() => { setFilter(f.key); setShown(PAGE); }}>
                {f.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs prive-muted">
            {t.map.origin}
            <select className="pv-x-select" value={origin?.key ?? ""} onChange={(e) => choose(e.target.value)} data-testid="prive-map-origin">
              {!origin && <option value="">{t.map.originPick}</option>}
              {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        </div>
      </header>

      <a href={`#${listId}`} className="sr-only focus:not-sr-only focus:inline-block prive-link text-sm">{t.map.skipToList}</a>
      {/* El mapa ocupa todo el ancho; la tarjeta del destino flota a la derecha en escritorio y va debajo en el teléfono. */}
      <div className="relative scroll-mt-24" id="pv-map-wrap">
        <Suspense fallback={<div className="pv-map flex items-center justify-center text-sm prive-muted" role="status">{t.map.loadingMap}</div>}>
          <WorldMap pins={pins} selected={selected} onSelect={pick} label={t.map.mapLabel(m)} describedBy={legendId} />
        </Suspense>
        <div id="pv-sheet-wrap" aria-live="polite" className={`scroll-mt-24 ${sel ? "mt-5 lg:mt-0 lg:absolute lg:z-[4] lg:right-4 lg:top-4 lg:bottom-4 lg:w-[360px] lg:overflow-y-auto lg:rounded-[22px] pv-sheet-float" : ""}`}>
          {sel && (
            <DestinationSheet slug={sel.d.slug} name={sel.name} month={month} climate={sel.climate} best={seasonMonths(sel.geo)} events={sel.events}
              flight={sel.flight} origin={origin} count={sel.d.count} onClose={() => setSelected(null)} />
          )}
        </div>
      </div>
      {!sel && (
        <div className="prive-panel p-5 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:items-start" data-testid="prive-map-summary">
          <div className="space-y-2">
            <p className="text-sm prive-champagne">{t.map.summary(m, counts.season, counts.events)}</p>
            <p className="text-xs prive-muted">{t.map.pickHint}</p>
          </div>
          {top.length > 0 && (
            <div className="space-y-1">
              <p className="prive-eyebrow">{t.map.topPicks(m)}</p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1">
                {top.map((r) => (
                  <li key={r.d.slug}>
                    <button type="button" className="min-h-[44px] inline-flex items-baseline gap-2 prive-champagne hover:text-[color:var(--pv-gold)]" onClick={() => pick(r.d.slug)}>
                      <span className="prive-serif text-xl">{r.name}</span>
                      {r.climate.high != null && <span className="text-xs prive-muted">{r.climate.high} °C</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div id={legendId} className="space-y-2">
        <div className="pv-legend" aria-hidden="true">
          <span><i className="pv-dot is-good" />{t.map.good}</span>
          <span><i className="pv-dot is-snow" />{t.map.snow}</span>
          <span><i className="pv-dot" />{t.map.off}</span>
          <span><i className="pv-dot is-event" />{t.map.withEvents}</span>
        </div>
        <p className="text-[11px] prive-muted max-w-3xl">
          {t.map.legend}{" "}
          <a className="prive-link" href={PRIVE_CLIMATE_SOURCE.url} target="_blank" rel="noopener noreferrer">{PRIVE_CLIMATE_SOURCE.name} {PRIVE_CLIMATE_SOURCE.version}</a>
          {" · "}{PRIVE_CLIMATE_SOURCE.checked}
        </p>
      </div>

      <section aria-labelledby={`${listId}-h`} className="space-y-3 pt-2">
        <h3 id={`${listId}-h`} className="text-2xl">{t.map.listTitle(m)}</h3>
        {visible.length === 0 ? <p className="text-sm prive-muted">{t.map.noneInFilter}</p> : (
          <ul id={listId} tabIndex={-1} className="pv-dest-list" data-testid="prive-map-list" aria-label={t.map.listTitle(m)}>
            {visible.slice(0, shown).map((r) => {
              const parts = [r.name, r.climate.kind === "good" ? t.map.good : r.climate.kind === "snow" ? t.map.snow : r.climate.kind === "off" ? t.map.off : t.map.unknown];
              if (r.climate.high != null) parts.push(`${r.climate.high} °C`);
              if (r.events.length) parts.push(t.map.events(r.events.length));
              if (r.flight && origin && !r.flight.short) parts.push(`${t.map.flight(r.flight.hours, origin.label)} (${t.map.estimate})`);
              return (
                <li key={r.d.slug}>
                  <button type="button" className="pv-dest-row" aria-pressed={selected === r.d.slug} aria-label={parts.join(". ")} data-slug={r.d.slug}
                    data-kind={r.climate.kind} onClick={() => { pick(r.d.slug); revealSheet(); }}>
                    <span className="min-w-0 flex-1">
                      <span className="block prive-serif text-lg leading-tight truncate">{r.name}</span>
                      <span className="block text-[11px] prive-muted">
                        {r.climate.high != null ? `${r.climate.high}° / ${r.climate.low}°` : ""}
                        {r.flight && origin && !r.flight.short ? ` · ≈ ${r.flight.hours} h` : ""}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <SeasonBadge kind={r.climate.kind} />
                      {r.events.length > 0 && <span className="pv-badge is-event">{t.map.events(r.events.length)}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {visible.length > shown && (
          <div className="flex justify-center">
            <button type="button" className="prive-btn prive-btn-ghost" onClick={() => setShown((n) => n + PAGE * 2)}>{t.common.showMore(visible.length - shown)}</button>
          </div>
        )}
      </section>
    </section>
  );
}
