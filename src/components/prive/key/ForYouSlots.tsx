// Ranuras de FOR YOU (contrato con prive-ux): THE KEY destacado, "Curated for You" y "Your Next Journey".
// Personalización honesta: se dice si está priorizado por el viaje, ordenado por gustos (con permiso) o si es una
// selección editorial verificada aún no personalizada. Nunca se elige otro viaje por error.
import { Link } from "react-router-dom";
import { ArrowRight, CalendarDays, Compass, KeyRound, Sparkles } from "lucide-react";
import { PriveImage } from "@/components/prive/catalog/PriveImage";
import { imageQueries, universeMeta } from "@/lib/priveCatalogView";
import type { PriveExperience } from "@/lib/priveCatalogApi";
import { personalizationLabel, reasonText } from "@/lib/priveKeyForYou";
import { useKeyLang, KEY_TEXT, type KeyLang } from "@/lib/priveKeyI18n";
import { useForYouData } from "./useForYouData";
import "./key.css";

const keyHref = (w: string, mode?: string) => `/prive/key?w=${encodeURIComponent(w)}${mode ? `&mode=${mode}` : ""}`;

export function ExperienceTile({ e, lang }: { e: PriveExperience; lang: KeyLang }) {
  const reasons = reasonText(e.reasons, lang);
  const uni = universeMeta(e.universe);
  return (
    <article className="pk-card flex h-full flex-col" data-testid="pk-tile">
      <div className="pk-card-photo">
        <div className="pk-fallback absolute inset-0 flex items-end p-3 text-xs prive-champagne" aria-hidden="true">{uni?.title}</div>
        <PriveImage queries={imageQueries(e)} illustrative={e.image?.illustrative !== false} alt={lang === "en" ? `Illustrative photo for ${e.name}` : `Foto ilustrativa para ${e.name}`} className="h-full w-full" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-[11px] uppercase tracking-[0.2em] prive-gold">{uni?.title}{e.destination?.name ? ` · ${e.destination.name}` : ""}</p>
        <h3 className="prive-serif text-xl leading-snug">{e.name}</h3>
        <p className="text-sm prive-muted line-clamp-3">{reasons[0] ?? e.why ?? ""}</p>
        {e.state !== "VERIFICADO" && <p className="text-[11px] text-amber-200/90">{lang === "en" ? "Curated · pending verification on the official site" : "Curado · pendiente de verificación en el sitio oficial"}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link to={`/prive/experiencia/${e.slug}`} className="prive-btn prive-btn-ghost text-sm">{lang === "en" ? "View" : "Ver"}</Link>
          <Link to={keyHref(lang === "en" ? `A night around ${e.name} in ${e.destination?.name ?? ""}` : `Una noche alrededor de ${e.name} en ${e.destination?.name ?? ""}`)}
            className="pk-chip text-xs"><KeyRound className="h-3.5 w-3.5" aria-hidden="true" />{lang === "en" ? "Make it a plan" : "Convertirlo en plan"}</Link>
        </div>
      </div>
    </article>
  );
}

/** Acceso destacado a The Privé Key (FOR YOU). */
export function PriveKeyLauncher() {
  const lang = useKeyLang();
  const t = KEY_TEXT[lang];
  return (
    <section className="pk-hero" aria-labelledby="pk-launch-title" data-testid="pk-launcher">
      <div className="relative z-10 grid gap-5 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div className="space-y-3">
          <p className="prive-eyebrow">{t.brand}</p>
          <h2 id="pk-launch-title" className="prive-display text-3xl sm:text-4xl">{t.tagline}</h2>
          <p className="text-sm prive-champagne">{t.brandSub}. {t.intro}</p>
          <Link to="/prive/key" className="prive-btn prive-btn-gold inline-flex items-center">{t.submit}<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
        </div>
        <ul className="grid gap-2" aria-label={lang === "en" ? "Examples" : "Ejemplos"}>
          {t.examples.slice(0, 3).map((ex) => <li key={ex}><Link className="pk-example" to={keyHref(ex)}>{ex}</Link></li>)}
          <li className="flex flex-wrap gap-2 pt-1">
            <Link to="/prive/key?mode=h48" className="pk-chip text-xs">{t.modes.h48}</Link>
            <Link to="/prive/key?mode=surprise" className="pk-chip text-xs"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t.modes.surprise}</Link>
          </li>
        </ul>
      </div>
    </section>
  );
}

/** "Curated for You": 3–6 experiencias con su motivo. */
export function CuratedForYou() {
  const lang = useKeyLang();
  const { loading, source, items, kind, home, choose, chooseTrip } = useForYouData({ limit: 6 });
  const en = lang === "en";
  return (
    <section aria-labelledby="pk-curated" className="space-y-4" data-testid="pk-curated" data-personalization={kind ?? "loading"}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="prive-eyebrow">CURATED FOR YOU</p>
          <h2 id="pk-curated" className="prive-serif text-2xl sm:text-3xl">{en ? "Curated for you" : "Seleccionado para ti"}</h2>
          {source && kind && <p className="text-sm prive-muted" data-testid="pk-personalization">{personalizationLabel(kind, source, lang)}</p>}
        </div>
      </div>
      {source?.kind === "ambiguous" && (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={en ? "Which trip?" : "¿Para qué viaje?"}>
          <span className="prive-champagne">{en ? "You have several upcoming trips. For which one?" : "Tienes varios viajes próximos. ¿Para cuál?"}</span>
          {source.candidates.map((c) => <button key={c.id} type="button" className="pk-chip text-xs" onClick={() => chooseTrip(c.id)}>{c.label}</button>)}
        </div>
      )}
      {source?.kind === "trip_no_coverage" && (
        <p className="text-sm prive-champagne" role="status">
          {en ? `There's no verified Privé selection yet for ${source.place}.` : `Aún no hay una selección Privé verificada para ${source.place}.`}
          {source.fallback ? (en ? ` Meanwhile, an editorial selection in ${source.fallback.name}.` : ` Mientras, una selección editorial en ${source.fallback.name}.`) : ""}
        </p>
      )}
      {loading && <div className="pk-scroll" role="status" aria-label={en ? "Loading" : "Cargando"}>{[0, 1, 2].map((i) => <div key={i} className="pk-skeleton" style={{ minHeight: "16rem" }} />)}</div>}
      {!loading && items.length > 0 && <div className="pk-scroll">{items.slice(0, 6).map((e) => <ExperienceTile key={e.id} e={e} lang={lang} />)}</div>}
      {!loading && items.length === 0 && (
        <p className="text-sm prive-muted">{en ? "No verified experiences to show here yet. We only show what we could check." : "Todavía no hay experiencias verificadas para mostrar aquí. Solo mostramos lo que pudimos comprobar."}</p>
      )}
      {!loading && (kind === "editorial" || kind === "chosen") && home.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="prive-muted">{en ? "Explore another destination:" : "Ver otro destino:"}</span>
          {[...home].filter((d) => d.count > 0 && d.kind !== "neighborhood").sort((a, b) => b.count - a.count).slice(0, 5).map((d) => (
            <button key={d.slug} type="button" className="pk-chip text-xs" onClick={() => choose(d.slug)}>{d.name}</button>
          ))}
        </div>
      )}
    </section>
  );
}

const fmtRange = (from: string | null, to: string | null, lang: KeyLang) => {
  const f = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(lang === "en" ? "en-US" : "es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  return from && to ? `${f(from)} – ${f(to)}` : from ? f(from) : "";
};

/** "Your Next Journey": el viaje activo correcto; sin viaje (o con empate), una invitación honesta. */
export function YourNextJourney() {
  const lang = useKeyLang();
  const en = lang === "en";
  const { source, loading } = useForYouData({ limit: 6 });
  if (loading && !source) return <div className="pk-skeleton" style={{ minHeight: "10rem" }} role="status" aria-label={en ? "Loading" : "Cargando"} />;
  if (source?.kind === "trip") {
    const city = source.destination.name;
    return (
      <section className="pk-hero" aria-labelledby="pk-next" data-testid="pk-next-journey">
        <div className="relative z-10 space-y-4">
          <p className="prive-eyebrow">YOUR NEXT JOURNEY</p>
          <h2 id="pk-next" className="prive-display text-3xl sm:text-4xl">{en ? `Your next chapter: ${city}.` : `Tu próximo capítulo: ${city}.`}</h2>
          <p className="text-sm prive-champagne"><CalendarDays className="mr-1 inline h-4 w-4" aria-hidden="true" />{fmtRange(source.from, source.to, lang) || source.label}</p>
          <div className="flex flex-wrap gap-2">
            <Link to={`/prive/destino/${source.destination.slug}`} className="prive-btn prive-btn-gold"><Compass className="mr-2 h-4 w-4" aria-hidden="true" />{en ? `Explore ${city}` : `Explorar ${city}`}</Link>
            <Link to={`/prive/destino/${source.destination.slug}`} className="prive-btn prive-btn-ghost">{en ? "Experiences for my dates" : "Ver experiencias para mis fechas"}</Link>
            <Link to={keyHref(en ? `Plan a special night in ${city}` : `Organiza una noche especial en ${city}`)} className="prive-btn prive-btn-ghost">
              <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />{en ? "Plan a night" : "Organizar una noche"}</Link>
            <Link to={`/dashboard/viajes/${source.trip.id}`} className="prive-btn prive-btn-ghost">{en ? "My itinerary" : "Ver mi itinerario"}</Link>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="prive-panel space-y-3 p-5 sm:p-6" aria-labelledby="pk-next" data-testid="pk-next-journey">
      <p className="prive-eyebrow">YOUR NEXT JOURNEY</p>
      <h2 id="pk-next" className="prive-serif text-2xl">{source?.kind === "ambiguous" ? (en ? "Which trip comes next?" : "¿Cuál es tu próximo viaje?") : (en ? "Your next journey" : "Tu próximo viaje")}</h2>
      <p className="text-sm prive-muted">
        {source?.kind === "ambiguous"
          ? (en ? "You have several upcoming trips; we won't guess. Pick one in “Curated for you” or pin it in your trips." : "Tienes varios viajes próximos y no adivinamos. Elige uno en “Seleccionado para ti” o fíjalo en tus viajes.")
          : source?.kind === "trip_no_coverage"
            ? (en ? `Your trip to ${source.place} doesn't have a verified Privé selection yet.` : `Tu viaje a ${source.place} aún no tiene selección Privé verificada.`)
            : (en ? "No upcoming trip yet. Plan one and Privé will prioritise its destination and dates." : "Aún no tienes un viaje próximo. Planea uno y Privé priorizará su destino y sus fechas.")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link to="/dashboard/planear" className="prive-btn prive-btn-gold">{en ? "Plan a trip" : "Planear un viaje"}</Link>
        <Link to="/prive/key" className="prive-btn prive-btn-ghost"><KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />{KEY_TEXT[lang].submit}</Link>
      </div>
    </section>
  );
}
