// THE PRIVÉ KEY · "Make it Extraordinary": el deseo en palabras → solo lo que falta → hasta tres propuestas.
// Es Iato en su modo Privé (concierge-chat, mode prive_key): nada se calcula por tecla; solo al enviar o al
// contestar. Mide el tiempo a la primera opción útil (first_option) para el recorrido de Doc B §3 y §18.
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, RotateCcw, Sparkles, Heart } from "lucide-react";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { askIatoAbout, askIatoHref, planPayload, usePriveKeyApi, type KeyAnswers, type KeyMode, type KeyProposal, type KeyResponse } from "@/lib/priveKey";
import type { KeyLang, KeyText } from "@/lib/priveKeyI18n";
import { ProposalCard } from "./ProposalCard";
import { KeyQuestions } from "./KeyQuestions";
import { TripPickerDialog } from "./TripPickerDialog";
import "./key.css";

/** Foto de cada nivel: el primer paso cuyo universo no ilustró ya otro nivel (evita tres fotos iguales). */
function photoIndex(ps: KeyProposal[], i: number): number {
  const used = new Set<string>();
  for (let k = 0; k < i; k++) { const s = ps[k].steps[photoIndex(ps, k)]; if (s) used.add(s.experience.universe); }
  const idx = ps[i].steps.findIndex((s) => !used.has(s.experience.universe));
  return idx < 0 ? 0 : idx;
}

type Props = { lang: KeyLang; t: KeyText; initialWish?: string | null; initialMode?: KeyMode | null; autoSubmit?: boolean; onPlanSaved?: () => void; startedAt?: number };

export function PriveKeyStudio({ lang, t, initialWish, initialMode, autoSubmit, onPlanSaved, startedAt }: Props) {
  const api = usePriveKeyApi();
  const navigate = useNavigate();
  const [text, setText] = useState(initialWish ?? "");
  const [mode, setMode] = useState<KeyMode | null>(initialMode ?? null);
  const [answers, setAnswers] = useState<KeyAnswers>({});
  const [res, setRes] = useState<KeyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exclude, setExclude] = useState<string[]>([]);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [inTrip, setInTrip] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<KeyProposal | null>(null);
  const [pickerMsg, setPickerMsg] = useState<string | null>(null);
  const t0 = useRef(startedAt ?? (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const firstOptionMs = useRef<number | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const onLocked = useCallback(() => navigate("/prive", { replace: true }), [navigate]);
  useEffect(() => { void api.track("key_open"); }, [api]);

  const run = useCallback(async (opts: { answers?: KeyAnswers; exclude?: string[]; mode?: KeyMode | null; wish?: string } = {}) => {
    const wish = (opts.wish ?? text).trim();
    if (wish.length < 2) return;
    setLoading(true); setError(null);
    const m = opts.mode !== undefined ? opts.mode : mode;
    void api.track("wish_submitted", { mode: m ?? undefined });
    try {
      const r = await api.plan({ wish, answers: opts.answers ?? answers, mode: m, exclude: opts.exclude ?? exclude, lang });
      setRes(r);
      if (!r.ok) {
        setError(r.code === "KEY_DAILY_LIMIT" ? t.limit : t.error);
        if (r.code === "KEY_DAILY_LIMIT") void api.track("limit_reached");
      } else if (r.status === "questions") {
        void api.track("questions_shown", { mode: r.wish?.mode });
      } else if (r.status === "proposals" && r.proposals?.length) {
        const now = typeof performance !== "undefined" ? performance.now() : Date.now();
        const ms = Math.round(now - t0.current);
        if (firstOptionMs.current == null) {
          firstOptionMs.current = ms;
          void api.track("first_option", { ms, mode: r.wish?.mode, destination: r.destination?.slug ?? null });
        }
        void api.track(r.wish?.mode === "surprise" ? "surprise_shown" : "proposals_shown", { mode: r.wish?.mode, destination: r.destination?.slug ?? null });
        requestAnimationFrame(() => resultsRef.current?.focus());
      } else if (r.status === "no_coverage") {
        void api.track("no_coverage", { mode: r.wish?.mode });
      }
    } catch (e) {
      if (e instanceof PriveLockedError) { onLocked(); return; }
      setError(t.error);
    } finally { setLoading(false); }
  }, [api, answers, exclude, lang, mode, onLocked, t, text]);

  // Un enlace explícito (Launcher, Your World is Ready) puede abrir con un deseo ya escrito: una sola vez.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoSubmit && initialWish && !autoRan.current) { autoRan.current = true; void run({ wish: initialWish }); }
  }, [autoSubmit, initialWish, run]);

  const wishMeta = () => ({ text: text.trim(), mode: (res?.wish?.mode ?? mode ?? "key") as KeyMode, destination: res?.destination?.slug ?? res?.wish?.destinationQuery ?? null,
    party: res?.wish?.party ?? null, budget: res?.wish?.budget ?? null });

  const save = async (p: KeyProposal): Promise<string | null> => {
    if (saved[p.tier + p.title]) return saved[p.tier + p.title];
    setBusy(p.tier);
    try {
      const r = await api.save(planPayload(p, wishMeta()));
      if (r.ok && r.id) { setSaved((s) => ({ ...s, [p.tier + p.title]: r.id! })); onPlanSaved?.(); return r.id; }
      setError(t.error); return null;
    } catch (e) {
      if (e instanceof PriveLockedError) onLocked(); else setError(t.error);
      return null;
    } finally { setBusy(null); }
  };

  const addToTrip = async (p: KeyProposal, tripId: string) => {
    setPickerMsg(null);
    const id = await save(p);
    if (!id) return;
    setBusy(p.tier);
    try {
      const r = await api.addToTrip(id, tripId);
      if (r.ok) { setInTrip((s) => ({ ...s, [p.tier + p.title]: true })); setPicker(null); onPlanSaved?.(); }
      else setPickerMsg(t.error);
    } catch (e) {
      if (e instanceof PriveLockedError) onLocked(); else setPickerMsg(t.error);
    } finally { setBusy(null); }
  };

  const reset = () => { setRes(null); setAnswers({}); setExclude([]); setError(null); setSaved({}); setInTrip({}); };
  const proposals = res?.ok && res.status === "proposals" ? res.proposals ?? [] : [];
  const surprise = res?.wish?.mode === "surprise";
  const tripId = res?.trip?.id ?? null;

  return (
    <div className="space-y-8" data-testid="pk-studio" data-first-option-ms={firstOptionMs.current ?? undefined}>
      <section className="pk-hero" aria-labelledby="pk-title">
        <div className="relative z-10 space-y-5">
          <div className="flex items-center gap-3">
            <span className="pk-key-mark"><KeyRound className="h-5 w-5" aria-hidden="true" /></span>
            <div>
              <h1 id="pk-title" className="prive-display text-2xl sm:text-4xl">{t.brand}</h1>
              <p className="prive-champagne text-sm sm:text-base">{t.tagline} · <span className="prive-muted">{t.brandSub}</span></p>
            </div>
          </div>
          <p className="max-w-2xl text-sm sm:text-base prive-champagne">{t.intro}</p>
          <form onSubmit={(e) => { e.preventDefault(); setAnswers({}); setExclude([]); void run({ answers: {}, exclude: [] }); }} className="space-y-3">
            <label htmlFor="pk-wish" className="sr-only">{t.placeholder}</label>
            <textarea id="pk-wish" className="pk-textarea" value={text} maxLength={600} placeholder={t.placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run({ answers: {}, exclude: [] }); } }} />
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Modo">
              {(["key", "h48", "surprise"] as KeyMode[]).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className="pk-chip" onClick={() => setMode(mode === m ? null : m)}>
                  {m === "surprise" ? <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                  <span>{t.modes[m]}</span>{m !== "key" && <span className="prive-muted text-xs">· {t.modesSub[m]}</span>}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="prive-btn prive-btn-gold" disabled={loading || text.trim().length < 2}>{loading ? t.thinking : t.submit}</button>
              {res && <button type="button" className="pk-chip" onClick={reset}><RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />{t.newWish}</button>}
            </div>
          </form>
          {!res && (
            <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Ejemplos">
              {t.examples.map((ex) => (
                <li key={ex}><button type="button" className="pk-example" onClick={() => setText(ex)}>{ex}</button></li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {loading && !proposals.length && (
        <div className="grid gap-5 md:grid-cols-3" role="status" aria-label={t.thinking}>
          {[0, 1, 2].map((i) => <div key={i} className="pk-skeleton" />)}
        </div>
      )}
      {error && <p className="rounded-xl border border-amber-500/30 p-3 text-sm text-amber-200" role="alert">{error}</p>}

      {res?.ok && res.status === "questions" && res.questions && (
        <KeyQuestions questions={res.questions} t={t} lang={lang} busy={loading} hint={res.trip_choice && res.trip_choice.length > 1 ? t.tripPick : null}
          onSubmit={(a) => { const next = { ...answers, ...a }; setAnswers(next); void run({ answers: next }); }} />
      )}

      {res?.ok && (res.status === "proposals" || res.status === "no_coverage") && (
        <div ref={resultsRef} tabIndex={-1} className="space-y-5 outline-none" aria-live="polite" data-testid="pk-results">
          <div className="space-y-1 text-sm">
            {res.trip && <p className="prive-champagne">{t.forTrip(res.trip.label)}</p>}
            {res.trip_note && <p className="prive-muted">{res.trip_note}</p>}
            {res.hotel_note && <p className="prive-muted">{res.hotel_note}</p>}
            {res.wish?.notes?.map((n) => <p key={n} className="prive-muted">{n}</p>)}
            {res.note && <p className="prive-champagne" role="status">{res.note}</p>}
            {res.fx_note && <p className="text-xs prive-muted">{res.fx_note}</p>}
          </div>
          {proposals.length > 0 && (
            <div className={surprise ? "max-w-xl" : "grid gap-5 lg:grid-cols-3"}>
              {proposals.map((p, i) => (
                <ProposalCard key={p.tier + p.title} p={p} lang={lang} t={t} tripId={tripId} featured={i === 0} photoStep={photoIndex(proposals, i)}
                  saved={!!saved[p.tier + p.title]} inTrip={!!inTrip[p.tier + p.title]} busy={busy === p.tier}
                  onSave={() => void save(p)} onAddTrip={() => { setPickerMsg(null); setPicker(p); }}
                  askHref={askIatoHref(askIatoAbout(p, lang))} onLocked={onLocked}
                  onTrack={(ev) => void api.track(ev, { mode: res.wish?.mode, tier: p.tier })} />
              ))}
            </div>
          )}
          {surprise && proposals.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="prive-btn prive-btn-gold" onClick={async () => { const id = await save(proposals[0]); if (id) void api.track("surprise_love", { plan_id: id }); }}>
                <Heart className="mr-2 h-4 w-4" aria-hidden="true" />{t.love}
              </button>
              <button type="button" className="prive-btn prive-btn-ghost" disabled={loading} onClick={() => {
                const next = [...exclude, ...proposals.flatMap((p) => p.steps.map((s) => s.experience.id))];
                setExclude(next); void api.track("surprise_another"); void run({ exclude: next });
              }}>
                <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />{t.another}
              </button>
            </div>
          )}
          {res.cost && <p className="text-[11px] prive-muted" data-testid="pk-cost">{t.costNote(res.cost.ms, res.cost.cache)}</p>}
        </div>
      )}

      {picker && (
        <TripPickerDialog open={!!picker} onOpenChange={(v) => !v && setPicker(null)} preferredTripId={tripId} t={t} busy={busy === picker.tier} message={pickerMsg}
          onPick={(id) => void addToTrip(picker, id)} />
      )}
    </div>
  );
}
