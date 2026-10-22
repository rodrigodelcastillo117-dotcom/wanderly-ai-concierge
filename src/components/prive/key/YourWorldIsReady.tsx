// YOUR WORLD IS READY (Doc B §3): la primera selección personal tras la invitación, la contraseña y el Grand Welcome.
// Objetivo medible: abrir en ≤ 2 minutos una experiencia que interese y entender cómo convertirla en plan
// (eventos world_ready_shown / world_ready_open con ms). Nunca bloquea: todo carga por partes, con respaldo.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { KeyRound, Sparkles, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { WELCOME_VERSION } from "@/lib/priveCopy";
import { personalizationLabel } from "@/lib/priveKeyForYou";
import { usePriveKeyApi, type KeyResponse } from "@/lib/priveKey";
import { useKeyLang, KEY_TEXT } from "@/lib/priveKeyI18n";
import { ExperienceTile } from "./ForYouSlots";
import { QuickTaste } from "./QuickTaste";
import { useForYouData } from "./useForYouData";
import "./key.css";

export const WORLD_READY_DAYS = 30;
const doneKey = (uid: string) => `pk-world-ready-done:${uid}`;
const readDone = (uid: string) => { try { return localStorage.getItem(doneKey(uid)) === "1"; } catch { return false; } };

/** ¿Toca mostrarla? Miembro activo hace ≤ 30 días, ceremonia ya vista y no la cerró. */
export function shouldShowWorldReady(s: { membership_status: string; activated_at: string | null; welcome_version_seen: number } | null, done: boolean, now = Date.now()) {
  if (!s || done || s.membership_status !== "active" || !s.activated_at) return false;
  if (s.welcome_version_seen < WELCOME_VERSION) return false;
  const days = (now - Date.parse(s.activated_at)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 && days <= WORLD_READY_DAYS;
}

export function YourWorldIsReady() {
  const { user } = useAuth();
  const { status, unlocked } = usePriveAccess();
  const lang = useKeyLang();
  const t = KEY_TEXT[lang];
  const en = lang === "en";
  const uid = user?.id ?? "";
  const [done, setDone] = useState(() => readDone(uid));
  const show = unlocked && shouldShowWorldReady(status, done);
  if (!show) return null;
  return <WorldReadyBody firstName={status?.first_name ?? null} onDone={() => { try { localStorage.setItem(doneKey(uid), "1"); } catch { /* modo privado */ } setDone(true); }} lang={lang} t={t} en={en} />;
}

function WorldReadyBody({ firstName, onDone, lang, t, en }: { firstName: string | null; onDone: () => void; lang: "es" | "en"; t: typeof KEY_TEXT.es; en: boolean }) {
  const api = usePriveKeyApi();
  const { loading, source, items, kind, home, choose, dnaConsent } = useForYouData({ limit: 3 });
  const shownAt = useRef(typeof performance !== "undefined" ? performance.now() : Date.now());
  const opened = useRef(false);
  const [plan, setPlan] = useState<KeyResponse | null>(null);
  const [planState, setPlanState] = useState<"idle" | "loading" | "done" | "failed">("idle");
  useEffect(() => { void api.track("world_ready_shown"); }, [api]);
  const markOpen = () => {
    if (opened.current) return;
    opened.current = true;
    void api.track("world_ready_open", { ms: Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - shownAt.current) });
  };
  const dest = source ? (source.kind === "trip" || source.kind === "chosen" ? source.destination : source.kind === "editorial" ? source.destination : source.fallback) : null;
  const date = source?.kind === "trip" ? source.from : null;

  // Una propuesta completa de The Key, en segundo plano y con tope de tiempo: nunca bloquea la pantalla.
  useEffect(() => {
    if (!dest) return;
    let alive = true;
    setPlanState("loading");
    const timer = setTimeout(() => { if (alive) setPlanState((s) => (s === "loading" ? "failed" : s)); }, 8000);
    api.plan({ wish: en ? `An extraordinary night in ${dest.name}` : `Una noche extraordinaria en ${dest.name}`,
      answers: { destination: dest.slug, date: date ?? "today", party: 2, budget: "open" }, lang })
      .then((r) => { if (alive) { setPlan(r); setPlanState(r.ok && r.proposals?.length ? "done" : "failed"); } })
      .catch(() => { if (alive) setPlanState("failed"); })
      .finally(() => clearTimeout(timer));
    return () => { alive = false; clearTimeout(timer); };
  }, [dest?.slug, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = plan?.proposals?.[0];
  return (
    <section className="pk-hero space-y-6" aria-labelledby="pk-wr" data-testid="pk-world-ready">
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div>
          <p className="prive-eyebrow">YOUR WORLD IS READY</p>
          <h2 id="pk-wr" className="prive-display text-3xl sm:text-5xl">{en ? `Your world is ready${firstName ? `, ${firstName}` : ""}.` : `Tu mundo está listo${firstName ? `, ${firstName}` : ""}.`}</h2>
          {source && kind && <p className="mt-2 text-sm prive-muted">{personalizationLabel(kind, source, lang)}</p>}
        </div>
        <button type="button" className="pk-chip" onClick={onDone} aria-label={en ? "Done, hide" : "Listo, ocultar"}><X className="h-4 w-4" aria-hidden="true" /></button>
      </div>

      {source?.kind === "editorial" && home.length > 0 && (
        <div className="relative z-10 flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={en ? "Where first?" : "¿Por dónde empezamos?"}>
          <span className="prive-champagne">{en ? "Where would you like to start?" : "¿Por dónde te gustaría empezar?"}</span>
          {[...home].filter((d) => d.count > 0 && d.kind !== "neighborhood").sort((a, b) => b.count - a.count).slice(0, 6).map((d) => (
            <button key={d.slug} type="button" className="pk-chip text-xs" onClick={() => choose(d.slug)}>{d.name}</button>
          ))}
        </div>
      )}

      <div className="relative z-10 space-y-3">
        <h3 className="prive-serif text-xl">{en ? "Three to begin with" : "Tres para empezar"}</h3>
        {loading ? <div className="pk-scroll" role="status">{[0, 1, 2].map((i) => <div key={i} className="pk-skeleton" style={{ minHeight: "14rem" }} />)}</div>
          : items.length ? <div className="pk-scroll" onClickCapture={markOpen}>{items.slice(0, 3).map((e) => <ExperienceTile key={e.id} e={e} lang={lang} />)}</div>
          : <p className="text-sm prive-muted">{en ? "No verified selection here yet; we don't show what we couldn't check." : "Aún no hay selección verificada aquí; no mostramos lo que no pudimos comprobar."}</p>}
      </div>

      <div className="relative z-10 space-y-2" onClickCapture={markOpen}>
        <h3 className="prive-serif text-xl">{t.brand} · {en ? "a complete plan" : "una propuesta completa"}</h3>
        {planState === "loading" && <p className="text-sm prive-muted" role="status">{t.thinking}</p>}
        {planState === "done" && first && (
          <div className="pk-card space-y-2 p-4" data-testid="pk-wr-plan">
            <p className="pk-tier-title text-xs">{first.title} · <span className="prive-champagne">{first.subtitle}</span></p>
            <ol className="space-y-1 text-sm">{first.steps.map((s) => <li key={s.experience.id}><span className="pk-time mr-2">{s.start}</span>{s.intent_label}: {s.experience.name}</li>)}</ol>
            <p className="text-xs prive-muted">{en ? "Example for 2 people · adjust it in The Key. Nothing is booked." : "Ejemplo para 2 personas · ajústalo en The Key. Nada está reservado."}</p>
            <Link to={`/prive/key?w=${encodeURIComponent(en ? `An extraordinary night in ${dest?.name ?? ""}` : `Una noche extraordinaria en ${dest?.name ?? ""}`)}`} className="prive-btn prive-btn-gold inline-flex">
              <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />{en ? "Open the three proposals" : "Ver las tres propuestas"}</Link>
          </div>
        )}
        {planState === "failed" && <Link to="/prive/key" className="prive-btn prive-btn-ghost inline-flex"><KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />{t.submit}</Link>}
      </div>

      <nav className="relative z-10 flex flex-wrap gap-2 text-sm" aria-label={en ? "More for you" : "Más para ti"}>
        {dest && <Link className="pk-chip" to={`/prive/insider/${dest.slug}`}>{en ? `Before you go · ${dest.name}` : `Antes de ir · ${dest.name}`}</Link>}
        <Link className="pk-chip" to="/prive/drops">{en ? "Opportunities that apply" : "Oportunidades que aplican"}</Link>
        <Link className="pk-chip" to="/prive/mi">{en ? "My card and passport" : "Mi tarjeta y pasaporte"}</Link>
        <Link className="pk-chip" to="/prive/key?mode=surprise"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{t.modes.surprise}</Link>
      </nav>

      {!dnaConsent && <div className="relative z-10"><QuickTaste lang={lang} /></div>}
    </section>
  );
}
