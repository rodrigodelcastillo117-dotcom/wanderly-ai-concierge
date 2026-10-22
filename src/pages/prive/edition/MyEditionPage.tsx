// My Edition: el miembro elige su edición (Viajes, Negocios, Estilo de vida o Mi mezcla), sus intereses con
// intensidad, temas excluidos, idioma, tiempo de lectura, orden de secciones y si su nombre va en la portada.
// Nada se deduce: solo lo que elige, y los intereses solo se guardan con su consentimiento.
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEdition } from "@/components/prive/edition/EditionContext";
import { IssueIndex } from "@/components/prive/edition/Magazine";
import {
  DEFAULT_PREFS, DEFAULT_SECTION_ORDER, EDITION_KINDS, INTERESTS, personalizeIssue, type EditionPrefs, type SectionKey,
} from "@/lib/priveEdition";
import { editionText } from "@/lib/priveEditionI18n";

export default function MyEditionPage() {
  const { prefs, savePrefs, lang, setLang, issue, reload } = useEdition();
  const T = editionText(lang);
  const [draft, setDraft] = useState<EditionPrefs>(prefs);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(prefs); }, [prefs]);

  const order: SectionKey[] = useMemo(() => {
    const o = [...draft.section_order];
    for (const s of DEFAULT_SECTION_ORDER) if (!o.includes(s)) o.push(s);
    return o;
  }, [draft.section_order]);
  const preview = useMemo(() => (issue?.found ? personalizeIssue(issue, draft) : null), [issue, draft]);

  const setInterest = (key: string, v: number) => setDraft((d) => {
    const interests = { ...d.interests };
    if (!v) delete interests[key]; else interests[key] = v;
    return { ...d, interests, excluded: d.excluded.filter((x) => x !== key) };
  });
  const toggleExcluded = (key: string) => setDraft((d) => ({
    ...d,
    excluded: d.excluded.includes(key) ? d.excluded.filter((x) => x !== key) : [...d.excluded, key],
    interests: Object.fromEntries(Object.entries(d.interests).filter(([k]) => k !== key)),
  }));
  const move = (i: number, dir: -1 | 1) => setDraft((d) => {
    const o = [...order];
    const j = i + dir;
    if (j < 0 || j >= o.length) return d;
    [o[i], o[j]] = [o[j], o[i]];
    return { ...d, section_order: o };
  });

  const onSave = async () => {
    setBusy(true); setMsg(null);
    const ok = await savePrefs({ ...draft, interests: draft.personalization_consent ? draft.interests : {} });
    if (ok && draft.language) setLang(draft.language);
    setBusy(false);
    setMsg(ok ? T.mine.savedOk : T.mine.saveError);
  };
  const onReset = async () => {
    setBusy(true);
    // RLS: cada miembro puede borrar SU fila (derecho de supresión), sin pasar por la sesión Privé.
    const { error } = await (supabase.from as unknown as (t: string) => { delete: () => { not: (c: string, o: string, v: null) => Promise<{ error: unknown }> } })("edition_member_prefs")
      .delete().not("user_id", "is", null);
    setBusy(false);
    setDraft(DEFAULT_PREFS);
    setMsg(error ? T.mine.saveError : T.mine.resetOk);
    if (!error) reload();
  };

  const intensity = T.mine.intensity;
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-8 py-10">
      <p className="ped-kicker">{T.mine.sub}</p>
      <h1 className="ped-display text-5xl sm:text-6xl mt-2">{T.mine.title}</h1>
      <div className="ped-spread mt-10">
        <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); void onSave(); }} aria-label={T.mine.title}>
          <fieldset>
            <legend className="ped-field-label">{T.mine.kind}</legend>
            <div className="mt-3 flex flex-wrap gap-2" role="radiogroup">
              {EDITION_KINDS.map((k) => (
                <button key={k.key} type="button" role="radio" aria-checked={draft.edition_kind === k.key} className="ped-choice"
                  onClick={() => setDraft((d) => ({ ...d, edition_kind: k.key }))}>{k[lang]}</button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="ped-field-label">{T.mine.interests}</legend>
            <p className="ped-meta mt-1">{T.mine.interestsHelp}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 list-none p-0" data-testid="interests">
              {INTERESTS.map((it) => {
                const v = draft.interests[it.key] ?? 0;
                const excluded = draft.excluded.includes(it.key);
                return (
                  <li key={it.key} className="flex items-center justify-between gap-2 border-b border-[color:var(--ped-line)] py-1.5">
                    <span className={`text-sm ${excluded ? "line-through opacity-50" : ""}`}>{it[lang]}</span>
                    <span className="flex gap-1" role="group" aria-label={it[lang]}>
                      {[1, 2, 3].map((n) => (
                        <button key={n} type="button" className="ped-choice !min-h-[36px] !px-2 text-xs" aria-pressed={v === n}
                          aria-label={`${it[lang]}: ${intensity[n - 1]}`} onClick={() => setInterest(it.key, v === n ? 0 : n)} disabled={excluded}>
                          {"●".repeat(n)}
                        </button>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="ped-field-label">{T.mine.excluded}</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {INTERESTS.map((it) => (
                <button key={it.key} type="button" className="ped-choice text-xs" aria-pressed={draft.excluded.includes(it.key)} onClick={() => toggleExcluded(it.key)}>
                  {it[lang]}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-6 sm:grid-cols-2">
            <label className="block">
              <span className="ped-field-label">{T.mine.language}</span>
              <select className="ped-input mt-2" value={draft.language ?? lang} onChange={(e) => setDraft((d) => ({ ...d, language: e.target.value as "es" | "en" }))}>
                <option value="es">Español</option><option value="en">English</option>
              </select>
            </label>
            <label className="block">
              <span className="ped-field-label">{T.mine.minutes}: {T.mine.minutesValue(draft.reading_minutes)}</span>
              <input type="range" min={5} max={60} step={5} className="w-full mt-4 accent-[#c9a961]" value={draft.reading_minutes}
                onChange={(e) => setDraft((d) => ({ ...d, reading_minutes: Number(e.target.value) }))} />
            </label>
          </div>

          <fieldset>
            <legend className="ped-field-label">{T.mine.order}</legend>
            <ol className="mt-3 list-none p-0 space-y-1">
              {order.map((s, i) => (
                <li key={s} className="flex items-center justify-between border-b border-[color:var(--ped-line)] py-1">
                  <span className="text-sm">{i + 1}. {T.sections[s]}</span>
                  <span className="flex gap-1">
                    <button type="button" className="ped-choice !min-h-[40px] !px-2" aria-label={`${T.mine.up}: ${T.sections[s]}`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></button>
                    <button type="button" className="ped-choice !min-h-[40px] !px-2" aria-label={`${T.mine.down}: ${T.sections[s]}`} disabled={i === order.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></button>
                  </span>
                </li>
              ))}
            </ol>
          </fieldset>

          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a961]" checked={draft.show_name_on_cover}
              onChange={(e) => setDraft((d) => ({ ...d, show_name_on_cover: e.target.checked }))} />
            <span className="text-sm">{T.mine.coverName}</span>
          </label>
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[#c9a961]" checked={draft.personalization_consent}
              onChange={(e) => setDraft((d) => ({ ...d, personalization_consent: e.target.checked }))} data-testid="consent" />
            <span className="text-sm">{T.mine.consent}</span>
          </label>
          {!draft.personalization_consent && Object.keys(draft.interests).length > 0 && <p className="ped-meta" role="note">{T.mine.consentNeeded}</p>}

          <div className="flex flex-wrap gap-3">
            <button type="submit" className="ped-btn" disabled={busy}>{T.mine.saveBtn}</button>
            <button type="button" className="ped-btn ghost" disabled={busy} onClick={() => void onReset()}>{T.mine.reset}</button>
          </div>
          {msg && <p role="status" className="ped-meta">{msg}</p>}
        </form>

        <div>
          <p className="ped-kicker">{T.mine.previewTitle}</p>
          {preview ? (
            <IssueIndex sections={preview.sections.filter((s) => s.key !== "oportunidades")} lang={lang}
              hrefFor={(slug) => `/prive/edicion/articulo/${slug}`} readingMinutes={preview.readingMinutes}
              moreTime={preview.moreTime} hiddenCount={preview.hidden.length} />
          ) : <p className="ped-dek mt-4">{T.emptyIssue}</p>}
        </div>
      </div>
    </div>
  );
}
