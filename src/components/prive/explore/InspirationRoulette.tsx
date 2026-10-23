// Pestaña "Ruleta" de Explorar: un modo juego. Eliges un ánimo (los doce universos), un presupuesto aproximado
// y, si quieres, un mes; la ruleta propone destinos sorpresa uno por uno con razones REALES (conteos y
// reconocimientos del catálogo, clima con fuente, eventos con fecha y lo que el servidor calculó con tus gustos
// solo si diste permiso). Deslizar a la derecha = "Me late" (se guarda en tus Ideas); a la izquierda = "Otro".
// En escritorio, botones y flechas del teclado. Con "reducir movimiento" no hay giro ni vuelo de tarjetas.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, RotateCcw, Sparkles, X } from "lucide-react";
import "./explore.css";
import { usePriveCatalog, type PriveExperience, type PriveUniverse } from "@/lib/priveCatalogApi";
import { universesView } from "@/lib/priveCatalogView";
import { displayName, placeLine } from "@/lib/priveBrowse";
import { destinationPhotoQueries } from "@/lib/privePhoto";
import { reasonText } from "@/lib/priveKeyForYou";
import { PRIVE_GEO } from "@/lib/priveExploreGeo";
import { PRIVE_LOCALE } from "@/lib/priveI18n";
import {
  BUDGET_MAX, eventDates, expReasons, MOODS, monthClimate, planHref, rouletteCandidates, shuffleDeck, type BudgetKey, type RouletteCandidate,
} from "@/lib/priveExplore";
import { PrivePhoto } from "@/components/prive/PrivePhoto";
import { usePriveMotion } from "@/components/prive/motion";
import { usePriveLang, usePriveT } from "@/components/prive/PriveLang";
import { MonthPicker } from "./MonthPicker";
import { useCatalogEvents, useIdeas } from "./useExploreData";

type Phase = "setup" | "loading" | "deck" | "liked" | "end" | "empty" | "error";
const SWIPE = 90;
const DECK_MAX = 24;

/** Razones de una tarjeta, en orden de fuerza. Solo datos del catálogo, del clima con fuente y del servidor. */
export function cardReasons(c: RouletteCandidate, opts: { universe: PriveUniverse; month: number | null; lang: "es" | "en"; isIdea: boolean;
  t: ReturnType<typeof usePriveT> }): string[] {
  const { t, lang } = opts;
  const uni = universesView(lang).find((u) => u.key === opts.universe)?.name ?? opts.universe;
  const out: string[] = [t.roulette.reasonCount(c.experiences.length, uni)];
  const top = c.experiences[0];
  if (top) out.push(`${t.roulette.reasonTop(top.name)}${top.why ? `: ${top.why}` : ""}`);
  const acc = c.experiences.find((e) => e.accolades?.length);
  if (acc?.accolades?.[0]) out.push(t.roulette.reasonAccolade(acc.name, acc.accolades[0].name, acc.accolades[0].year));
  // Del servidor (prive_score): gustos (solo con permiso) y nivel de presupuesto; "verificado" ya lo dicen las fichas.
  const server = reasonText(c.experiences.flatMap(expReasons).filter((r) => r.startsWith("dna:") || (r.startsWith("presupuesto:nivel_"))), lang);
  out.push(...server);
  if (opts.month != null) {
    const mc = monthClimate(PRIVE_GEO[c.slug], opts.month);
    const m = t.map.months[opts.month];
    if (mc.kind === "good" && mc.high != null) out.push(t.roulette.reasonSeason(m, mc.high));
    else if (mc.kind === "snow") out.push(t.roulette.reasonSnow(m));
    else if (mc.kind === "off") out.push(t.roulette.reasonOff(m));
  }
  const ev = c.events[0];
  if (ev) out.push(t.roulette.reasonEvent(ev.name, eventDates(ev, PRIVE_LOCALE[lang])));
  if (opts.isIdea) out.push(t.roulette.reasonIdea);
  return out.slice(0, 6);
}

export default function InspirationRoulette() {
  const t = usePriveT();
  const lang = usePriveLang();
  const api = usePriveCatalog();
  const { reduce, rise } = usePriveMotion();
  const events = useCatalogEvents();
  const { ideas, save } = useIdeas();
  const [mood, setMood] = useState<PriveUniverse | null>(null);
  const [budget, setBudget] = useState<BudgetKey>("any");
  const [month, setMonth] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [deck, setDeck] = useState<RouletteCandidate[]>([]);
  const [i, setI] = useState(0);
  const [liked, setLiked] = useState<RouletteCandidate[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [dx, setDx] = useState(0);
  const [exit, setExit] = useState<0 | 1 | -1>(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; id: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const ideaSlugs = useMemo(() => new Set((ideas ?? []).map((x) => x.slug)), [ideas]);
  const moods = useMemo(() => {
    const v = universesView(lang);
    return MOODS.map((k) => v.find((u) => u.key === k)!).filter(Boolean);
  }, [lang]);
  const card = deck[i] ?? null;

  useEffect(() => { if (phase === "deck") cardRef.current?.focus({ preventScroll: true }); }, [phase, i]);
  // Al cambiar de etapa (girar, me late, fin) la vista vuelve al título: la tarjeta y sus botones quedan a la vista.
  useEffect(() => {
    if (phase === "setup" || phase === "loading") return;
    document.getElementById("pv-rl-title")?.scrollIntoView?.({ block: "start" });
  }, [phase]);

  const spin = async () => {
    if (!mood) return;
    setPhase("loading"); setStatus(null); setLiked([]);
    try {
      const r = await api.universe(mood, null, 200);
      const list = rouletteCandidates((r?.experiences ?? []) as PriveExperience[], { budget, month, geo: PRIVE_GEO, events });
      const d = shuffleDeck(list.slice(0, DECK_MAX), Date.now() % 100_000);
      setDeck(d); setI(0); setDx(0); setExit(0);
      setPhase(d.length ? "deck" : "empty");
    } catch {
      setPhase("error");
    }
  };

  const advance = () => {
    setDx(0); setExit(0);
    if (i + 1 >= deck.length) setPhase("end");
    else { setI(i + 1); setPhase("deck"); }
  };
  const fly = (dir: 1 | -1, then: () => void) => {
    if (reduce) { then(); return; }
    setExit(dir);
    window.setTimeout(then, 260);
  };
  const skip = () => { if (card && phase === "deck") fly(-1, advance); };
  const like = () => {
    if (!card || phase !== "deck") return;
    const c = card;
    fly(1, () => {
      setDx(0); setExit(0);
      setLiked((l) => (l.some((x) => x.slug === c.slug) ? l : [...l, c]));
      setPhase("liked");
      save(c.slug, true, { universe: mood, month, budget, source: "ruleta" })
        .then(() => setStatus(t.roulette.savedIdea(displayName({ slug: c.slug, name: c.name }, lang))))
        .catch(() => setStatus(t.roulette.saveError));
    });
  };

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    drag.current = { x: e.clientX, id: e.pointerId };
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom */ }
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => { if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x); };
  const onUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    const d = e.clientX - drag.current.x;
    drag.current = null;
    setDragging(false);
    if (d > SWIPE) like(); else if (d < -SWIPE) skip(); else setDx(0);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") { e.preventDefault(); like(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); skip(); }
  };

  const reset = () => { setPhase("setup"); setDeck([]); setI(0); setStatus(null); };

  if (phase === "setup" || phase === "loading") {
    return (
      <section aria-labelledby="pv-rl-title" className="space-y-7" data-testid="prive-roulette" data-phase={phase}>
        <header className="space-y-2">
          <h2 id="pv-rl-title" className="text-3xl sm:text-[2.6rem] leading-tight">{t.roulette.title}</h2>
          <p className="text-sm prive-muted max-w-xl">{t.roulette.intro}</p>
        </header>
        <fieldset className="space-y-3">
          <legend className="prive-eyebrow mb-3">{t.roulette.moodLabel}</legend>
          <div role="radiogroup" aria-label={t.roulette.moodLabel} className="pv-moods">
            {moods.map((u) => (
              <button key={u.key} type="button" role="radio" aria-checked={mood === u.key} className="pv-mood" onClick={() => setMood(u.key)} data-mood={u.key}>
                <b>{u.name}</b>{u.sub && <small>{u.sub}</small>}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="prive-eyebrow mb-3">{t.roulette.budgetLabel}</legend>
          <div role="radiogroup" aria-label={t.roulette.budgetLabel} className="flex flex-wrap gap-2">
            {(Object.keys(BUDGET_MAX) as BudgetKey[]).map((b) => (
              <button key={b} type="button" role="radio" aria-checked={budget === b} className="pv-x-chip" onClick={() => setBudget(b)}>{t.roulette.budgets[b]}</button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-3">
          <legend className="prive-eyebrow mb-3">{t.roulette.monthLabel}</legend>
          <MonthPicker value={month} onChange={setMonth} label={t.roulette.monthLabel} allowAny anyLabel={t.roulette.anyMonth} />
        </fieldset>
        <div>
          <button type="button" className="prive-btn prive-btn-gold" disabled={!mood || phase === "loading"} onClick={() => void spin()} data-testid="prive-roulette-spin">
            <Sparkles className="w-4 h-4" aria-hidden="true" />{phase === "loading" ? t.roulette.spinning : t.roulette.spin}
          </button>
          {phase === "loading" && <p role="status" className="sr-only">{t.roulette.spinning}</p>}
        </div>
      </section>
    );
  }

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="pv-rl-title" className="text-2xl sm:text-3xl scroll-mt-24">{t.roulette.title}</h2>
      <button type="button" className="prive-chip-btn" onClick={reset}><RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />{t.roulette.changeMood}</button>
    </div>
  );

  if (phase === "empty" || phase === "error") {
    return (
      <section aria-labelledby="pv-rl-title" className="space-y-5" data-testid="prive-roulette" data-phase={phase}>
        {header}
        <p role="status" className="text-sm prive-muted">{phase === "empty" ? t.roulette.empty : t.roulette.error}</p>
      </section>
    );
  }

  if (phase === "end") {
    return (
      <section aria-labelledby="pv-rl-title" className="space-y-5" data-testid="prive-roulette" data-phase="end">
        {header}
        <p role="status" className="text-sm prive-champagne">{t.roulette.end}</p>
        {liked.length > 0 && (
          <div className="space-y-3">
            <p className="prive-eyebrow">{t.roulette.likedTitle}</p>
            <ul className="space-y-2">
              {liked.map((c) => {
                const nm = displayName({ slug: c.slug, name: c.name }, lang);
                return (
                  <li key={c.slug} className="flex flex-wrap items-center justify-between gap-2 prive-panel px-4 py-3">
                    <span className="prive-serif text-xl">{nm}</span>
                    <span className="flex gap-2">
                      <Link to={`/prive/destino/${c.slug}`} className="prive-chip-btn">{t.roulette.seeDest}</Link>
                      <Link to={planHref(nm)} className="prive-chip-btn">{t.roulette.plan}</Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <button type="button" className="prive-btn prive-btn-gold" onClick={() => void spin()}><Sparkles className="w-4 h-4" aria-hidden="true" />{t.roulette.spin}</button>
      </section>
    );
  }

  const c = card!;
  const name = displayName({ slug: c.slug, name: c.name }, lang);
  if (phase === "liked") {
    return (
      <section aria-labelledby="pv-rl-title" className="space-y-5" data-testid="prive-roulette" data-phase="liked">
        {header}
        <div className="pv-deck">
          <article className="pv-card" aria-labelledby="pv-liked-name">
            <PrivePhoto queries={destinationPhotoQueries(c.slug, c.name)} alt={t.common.photoAlt(name)} label={name} eager creditClassName="is-inline" />
            <div className="pv-card-veil" />
            <div className="absolute inset-x-0 bottom-0 z-[2] p-6 space-y-3">
              <p className="prive-eyebrow"><Heart className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />{t.roulette.like}</p>
              <h3 id="pv-liked-name" className="prive-display text-4xl sm:text-5xl">{name}</h3>
              {status && <p role="status" className="text-sm prive-champagne" data-testid="prive-roulette-status">{status}</p>}
            </div>
          </article>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link to={planHref(name)} className="prive-btn prive-btn-gold" data-testid="prive-roulette-plan">{t.roulette.plan}</Link>
          <Link to={`/prive/destino/${c.slug}`} className="prive-btn prive-btn-ghost">{t.roulette.seeDest}</Link>
          <button type="button" className="prive-btn prive-btn-ghost" onClick={advance}>{t.roulette.keepGoing}</button>
        </div>
      </section>
    );
  }

  const reasons = cardReasons(c, { universe: mood!, month, lang, isIdea: ideaSlugs.has(c.slug), t });
  const offset = exit ? exit * 640 : dx;
  const style = { transform: `translateX(${offset}px) rotate(${reduce ? 0 : offset / 22}deg)`, opacity: exit ? 0 : 1 };
  return (
    <section aria-labelledby="pv-rl-title" className="space-y-5" data-testid="prive-roulette" data-phase="deck">
      {header}
      <p className="text-xs prive-muted text-center" aria-live="polite">{t.roulette.cardOf(i + 1, deck.length)}</p>
      <motion.div key={c.slug} className="pv-deck" {...rise(0, 18, 0.55)}>
        {i + 1 < deck.length && <div className="pv-card-under" aria-hidden="true" />}
        <div ref={cardRef} tabIndex={0} role="group" aria-roledescription={t.roulette.title} aria-labelledby="pv-card-name" aria-describedby="pv-card-hint"
          className={`pv-card ${dragging ? "is-dragging" : ""}`} style={style} data-testid="prive-roulette-card" data-slug={c.slug}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setDragging(false); setDx(0); }} onKeyDown={onKey}>
          <PrivePhoto queries={destinationPhotoQueries(c.slug, c.name)} alt={t.common.photoAlt(name)} label={name} eager creditClassName="is-inline" />
          <div className="pv-card-veil" />
          <span className="pv-card-stamp is-like" style={{ opacity: Math.max(0, Math.min(1, dx / SWIPE)) }} aria-hidden="true">{t.roulette.like}</span>
          <span className="pv-card-stamp is-skip" style={{ opacity: Math.max(0, Math.min(1, -dx / SWIPE)) }} aria-hidden="true">{t.roulette.skip}</span>
          <div className="absolute inset-x-0 bottom-0 z-[2] p-5 sm:p-6">
            <p className="text-[10px] tracking-[0.22em] uppercase prive-gold">{placeLine(c.slug, lang)}</p>
            <h3 id="pv-card-name" className="prive-display text-4xl sm:text-5xl mt-1">{name}</h3>
          </div>
        </div>
      </motion.div>
      <div className="max-w-[30rem] mx-auto space-y-2" data-testid="prive-roulette-reasons">
        <p className="prive-eyebrow">{t.roulette.why}</p>
        <ul className="pv-reasons space-y-1.5 text-sm prive-champagne">
          {reasons.map((r) => <li key={r}><span>{r}</span></li>)}
        </ul>
      </div>
      <div className="pv-actions">
        <button type="button" className="pv-round" onClick={skip} aria-label={t.roulette.skip} data-testid="prive-roulette-skip"><X className="w-6 h-6" aria-hidden="true" /></button>
        <button type="button" className="pv-round is-like" onClick={like} aria-label={t.roulette.like} data-testid="prive-roulette-like"><Heart className="w-6 h-6" aria-hidden="true" /></button>
      </div>
      <p id="pv-card-hint" className="text-[11px] prive-muted text-center">{t.roulette.swipeHint}</p>
    </section>
  );
}
