// Solo lo que falta (lugar, fecha, personas, presupuesto), en una sola ronda y con botones: nada por tecla.
import { useState } from "react";
import type { KeyAnswers, KeyQuestion } from "@/lib/priveKey";
import type { KeyLang, KeyText } from "@/lib/priveKeyI18n";

export function KeyQuestions({ questions, t, lang, busy, hint, onSubmit }: {
  questions: KeyQuestion[]; t: KeyText; lang: KeyLang; busy?: boolean; hint?: string | null; onSubmit: (a: KeyAnswers) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const budgetCur = (questions.find((q) => q.id === "budget")?.options.find((o) => o.value !== "open")?.value.split(" ")[1]) ?? "MXN";
  const [cur, setCur] = useState(budgetCur);
  const value = (q: KeyQuestion) => custom[q.id]?.trim() ? (q.id === "budget" ? `${custom[q.id].replace(/[^\d]/g, "")} ${cur}` : custom[q.id].trim()) : vals[q.id];
  const ready = questions.every((q) => !!value(q));
  const submit = () => {
    const a: KeyAnswers = {};
    for (const q of questions) {
      const v = value(q);
      if (!v) continue;
      if (q.id === "destination") a.destination = v;
      if (q.id === "date") a.date = v;
      if (q.id === "party") a.party = Math.max(1, Math.min(30, Number(v) || 2));
      if (q.id === "budget") {
        if (v === "open") a.budget = "open";
        else { const [n, c] = v.split(" "); const amount = Number(n); if (amount > 0) a.budget = { amount, currency: (c || cur).toUpperCase() }; }
      }
    }
    onSubmit(a);
  };
  const label: Record<KeyQuestion["id"], string> = { destination: t.placeLabel, date: t.dateLabel, party: t.partyLabel, budget: t.budgetLabel };
  return (
    <section className="prive-panel space-y-5 p-5 sm:p-6" aria-labelledby="pk-q-title" data-testid="pk-questions">
      <div>
        <h2 id="pk-q-title" className="prive-serif text-2xl">{t.questionsTitle}</h2>
        <p className="text-sm prive-muted">{t.questionsHint}</p>
        {hint && <p className="mt-1 text-sm prive-champagne">{hint}</p>}
      </div>
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2" data-question={q.id}>
          <legend className="text-base">{q.text}</legend>
          {q.hint && <p className="text-xs prive-muted">{q.hint}</p>}
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label[q.id]}>
            {q.options.map((o) => (
              <button key={o.value} type="button" role="radio" aria-checked={vals[q.id] === o.value && !custom[q.id]} className="pk-chip"
                onClick={() => { setVals((s) => ({ ...s, [q.id]: o.value })); setCustom((s) => ({ ...s, [q.id]: "" })); }}>
                {o.label}
              </button>
            ))}
          </div>
          <div className="flex max-w-md flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor={`pk-q-${q.id}`}>{label[q.id]} · {t.other}</label>
            <input id={`pk-q-${q.id}`} className="prive-input min-h-[44px] flex-1 rounded-lg px-3 text-sm"
              type={q.input === "date" ? "date" : q.input === "number" ? "number" : q.input === "budget" ? "text" : "text"}
              inputMode={q.input === "budget" || q.input === "number" ? "numeric" : undefined} min={q.input === "number" ? 1 : undefined} max={q.input === "number" ? 30 : undefined}
              placeholder={q.input === "place" ? (lang === "en" ? "City or neighbourhood" : "Ciudad o barrio") : q.input === "budget" ? "8,000" : t.other}
              value={custom[q.id] ?? ""} onChange={(e) => setCustom((s) => ({ ...s, [q.id]: e.target.value }))} />
            {q.input === "budget" && (
              <select aria-label={t.currency} className="prive-input min-h-[44px] rounded-lg px-2 text-sm" value={cur} onChange={(e) => setCur(e.target.value)}>
                {["MXN", "USD", "EUR"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
          </div>
        </fieldset>
      ))}
      <button type="button" className="prive-btn prive-btn-gold" disabled={!ready || busy} onClick={submit}>{busy ? t.thinking : t.continue}</button>
    </section>
  );
}
