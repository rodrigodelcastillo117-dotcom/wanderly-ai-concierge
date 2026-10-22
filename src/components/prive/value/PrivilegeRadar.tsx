// THE PRIVILEGE RADAR: programas y tarjetas de la Bóveda (solo nombres y niveles), POSIBLES BENEFICIOS por
// coincidencia de marca (que NO son elegibilidad) y los beneficios que la persona sigue, con sus cuatro
// estados: POSIBLE BENEFICIO · ELEGIBILIDAD POR COMPROBAR · BENEFICIO VERIFICADO · BENEFICIO UTILIZADO.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Radar, Trash2 } from "lucide-react";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { localToday, nextRadarStates, radarTransitionError, visibleDrops, type PriveDrop, type RadarItem, type RadarResponse, type RadarState } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { formatValueDate, useValueText, type ValueLang } from "@/lib/priveValueI18n";
import { BrandTitle, Chip, Field, inputCls, smallBtn, smallGoldBtn, textareaCls } from "./ValueUi";
import { DropCard } from "./DropCard";

const STATE_TONE: Record<RadarState, "muted" | "warn" | "good" | "gold"> = { posible: "muted", por_comprobar: "warn", verificado: "good", utilizado: "gold" };

export function PrivilegeRadar({ destination = null, lang, headingLevel = "h2" }: { destination?: string | null; lang?: ValueLang; headingLevel?: "h1" | "h2" }) {
  const api = usePriveValue();
  const t = useValueText(lang);
  const [data, setData] = useState<RadarResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "locked" | "error">("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.radar(destination)); setState("ready"); }
    catch (e) { setState(e instanceof PriveLockedError ? "locked" : "error"); }
  }, [api, destination]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (state === "ready") void api.track("radar_view", { destination, surface: "radar" }); }, [api, state, destination]);

  const save = async (payload: Parameters<typeof api.radarSave>[0]) => {
    setMsg(null);
    try {
      const r = await api.radarSave(payload);
      if (!r.ok) { setMsg(t.radar.errors[r.code] ?? t.radar.errors.default); return false; }
      await load();
      return true;
    } catch { setMsg(t.radar.errors.default); return false; }
  };
  if (state === "locked") return null;
  const suggestions = visibleDrops(data?.suggestions, localToday());
  return (
    <section aria-labelledby="prive-radar" className="space-y-6" data-testid="prive-radar">
      <BrandTitle id="prive-radar" as={headingLevel} name={t.brand.radar.name} sub={t.brand.radar.sub} />
      <p className="max-w-3xl text-sm prive-muted">{t.radar.intro}</p>
      {state === "loading" ? <p role="status" className="text-sm prive-muted">{t.common.loading}</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-amber-200">{t.common.error} <button type="button" className="prive-link" onClick={() => void load()}>{t.common.retry}</button></p> : null}
      {msg ? <p role="alert" className="text-sm text-amber-200" data-testid="prive-radar-error">{msg}</p> : null}
      {data ? (
        <>
          <div className="prive-panel space-y-3 p-5">
            <h3 className="text-[11px] tracking-[0.2em] uppercase prive-gold">{t.radar.programs}</h3>
            {data.programs.length ? (
              <ul className="flex flex-wrap gap-2">
                {data.programs.map((p) => <li key={`${p.kind}-${p.label}`}><Chip>{p.label}{p.tier ? ` · ${p.tier}` : ""}</Chip></li>)}
              </ul>
            ) : <p className="text-sm prive-muted">{t.radar.noPrograms}</p>}
            <p className="text-[11px] prive-muted">{t.radar.noNumbers}</p>
            <Link to="/dashboard/beneficios" className="prive-link inline-flex min-h-[44px] items-center text-sm">{t.radar.goVault}</Link>
          </div>

          <div className="space-y-3">
            <h3 className="prive-serif text-xl">{t.radar.suggestions}</h3>
            {suggestions.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {suggestions.map((d: PriveDrop) => (
                  <DropCard key={d.id} drop={d} lang={t.lang} t={t} compact radarLabel={t.radarState.posible}
                    onOpenLink={(x) => void api.track("drop_link_open", { ref: x.id, surface: "radar" })}
                    onFollow={(x) => void save({ drop_id: x.id, state: "por_comprobar" })} />
                ))}
              </div>
            ) : <p className="text-sm prive-muted">{t.radar.noSuggestions}</p>}
          </div>

          <div className="space-y-3">
            <h3 className="prive-serif text-xl">{t.radar.tracked}</h3>
            {data.items.length ? (
              <ul className="grid gap-4 md:grid-cols-2">
                {data.items.map((it) => <li key={it.id}><RadarItemCard item={it} t={t} onSave={save} onDelete={async () => { await api.radarDelete(it.id); await load(); }} /></li>)}
              </ul>
            ) : <p className="text-sm prive-muted">{t.radar.noTracked}</p>}
            <ManualBenefit t={t} onSave={save} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function RadarItemCard({ item, t, onSave, onDelete }: {
  item: RadarItem; t: ReturnType<typeof useValueText>; onSave: (p: Parameters<ReturnType<typeof usePriveValue>["radarSave"]>[0]) => Promise<boolean>; onDelete: () => Promise<void>;
}) {
  const [target, setTarget] = useState<RadarState | null>(null);
  const [note, setNote] = useState("");
  const [usedAt, setUsedAt] = useState(localToday());
  const [err, setErr] = useState<string | null>(null);
  const lang = t.lang;
  const go = async (to: RadarState) => {
    const e = radarTransitionError(item, to, to === "verificado" ? note.trim() || null : null);
    if (e) { setErr(t.radar.errors[e]); setTarget(to); return; }
    const ok = await onSave({ id: item.id, state: to, verification_note: to === "verificado" && note.trim() ? note.trim() : undefined, used_at: to === "utilizado" ? usedAt : undefined });
    if (ok) { setTarget(null); setErr(null); setNote(""); }
  };
  return (
    <article className="prive-panel space-y-3 p-5" data-testid="prive-radar-item" data-state={item.state}>
      <div className="flex flex-wrap items-center gap-2">
        <Radar className="h-4 w-4 prive-gold" aria-hidden="true" />
        <Chip tone={STATE_TONE[item.state]} testId="prive-radar-state">{t.radarState[item.state]}</Chip>
        {item.drop_status === "vencido" ? <Chip>{t.dropStatus.vencido}</Chip> : null}
      </div>
      <p className="text-[11px] tracking-[0.2em] uppercase prive-muted">{item.program}</p>
      <p className="text-sm">{item.benefit}</p>
      {item.conditions ? <p className="text-xs prive-muted">{item.conditions}</p> : null}
      {item.verification_note ? <p className="text-xs prive-champagne">{t.radar.howVerified} {item.verification_note}{item.verified_at ? ` · ${formatValueDate(item.verified_at, lang)}` : ""}</p> : null}
      {item.used_at ? <p className="text-xs prive-champagne">{t.radar.usedOn}: {formatValueDate(item.used_at, lang)}</p> : null}
      {item.source_url ? <a className="prive-link text-xs" href={item.source_url} target="_blank" rel="noopener noreferrer">{t.common.source}</a> : null}
      {target === "verificado" ? (
        <Field id={`note-${item.id}`} label={t.radar.howVerified} hint={t.radar.howVerifiedHint}>
          <textarea id={`note-${item.id}`} className={textareaCls} value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
        </Field>
      ) : null}
      {target === "utilizado" && item.state === "verificado" ? (
        <Field id={`used-${item.id}`} label={t.radar.usedOn}>
          <input id={`used-${item.id}`} type="date" className={inputCls} value={usedAt} max={localToday()} onChange={(e) => setUsedAt(e.target.value)} />
        </Field>
      ) : null}
      {err ? <p role="alert" className="text-xs text-amber-200">{err}</p> : null}
      <div className="flex flex-wrap gap-2">
        {nextRadarStates(item.state).map((to) => (
          <button key={to} type="button" className={to === "verificado" || to === "utilizado" ? smallGoldBtn : smallBtn}
            onClick={() => (target === to || (to !== "verificado" && to !== "utilizado") ? void go(to) : (setTarget(to), setErr(null)))}>
            {t.radarAction[to]}
          </button>
        ))}
        <button type="button" className={smallBtn} onClick={() => void onDelete()} aria-label={`${t.common.remove}: ${item.benefit}`}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function ManualBenefit({ t, onSave }: { t: ReturnType<typeof useValueText>; onSave: (p: Parameters<ReturnType<typeof usePriveValue>["radarSave"]>[0]) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [program, setProgram] = useState("");
  const [benefit, setBenefit] = useState("");
  if (!open) return <button type="button" className={smallBtn} onClick={() => setOpen(true)}>{t.radar.addManual}</button>;
  return (
    <form className="prive-panel grid gap-3 p-5 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      if (await onSave({ program, benefit, state: "posible" })) { setOpen(false); setProgram(""); setBenefit(""); }
    }}>
      <Field id="radar-program" label={t.radar.program}><input id="radar-program" className={inputCls} required minLength={2} maxLength={80} value={program} onChange={(e) => setProgram(e.target.value)} /></Field>
      <Field id="radar-benefit" label={t.radar.benefitText}><input id="radar-benefit" className={inputCls} required minLength={3} maxLength={300} value={benefit} onChange={(e) => setBenefit(e.target.value)} /></Field>
      <p className="text-[11px] prive-muted sm:col-span-2">{t.radar.noNumbers}</p>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={smallGoldBtn}>{t.common.add}</button>
        <button type="button" className={smallBtn} onClick={() => setOpen(false)}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
