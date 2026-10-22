// THE VALUE OF YOUR PRIVÉ (opcional, en MY PRIVÉ): cuatro cajas que nunca se suman entre sí ni entre monedas
// — ahorro comprobado, estimado, potencial y valor sin ahorro (experiencias organizadas). Un ahorro existe
// solo con precio de referencia con fuente y lo que se pagó; el monto lo calcula la base (referencia − pagado).
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { splitValue, valueEntryError, type ValueEntry, type ValueKind, type ValueSummary } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { formatMoney, formatValueDate, useValueText, type ValueLang, type ValueText } from "@/lib/priveValueI18n";
import { BrandTitle, Field, inputCls, smallBtn, smallGoldBtn } from "./ValueUi";

const KINDS: ValueKind[] = ["comprobado", "estimado", "potencial", "sin_ahorro"];
const CURRENCIES = ["MXN", "USD", "EUR", "GBP", "JPY", "CAD", "CHF", "AED"];

export function ValueOfYourPrive({ lang }: { lang?: ValueLang } = {}) {
  const api = usePriveValue();
  const t = useValueText(lang);
  const [data, setData] = useState<ValueSummary | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "locked" | "error">("loading");
  const load = useCallback(async () => {
    try { setData(await api.valueSummary()); setState("ready"); }
    catch (e) { setState(e instanceof PriveLockedError ? "locked" : "error"); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (state === "ready") void api.track("value_view", { surface: "my_prive" }); }, [api, state]);
  if (state === "locked") return null;
  const split = splitValue(data?.entries, data?.organized_plans ?? 0);
  // Beneficios del radar aún no usados (posibles o por comprobar): potencial SIN monto, nunca convertido a dinero.
  const pending = split.potentialWithoutAmount + (data?.radar?.posible ?? 0) + (data?.radar?.por_comprobar ?? 0);
  const boxes: { kind: ValueKind; rows: { currency: string; amount: number; count: number }[]; extra?: string }[] = [
    { kind: "comprobado", rows: split.proven },
    { kind: "estimado", rows: split.estimated },
    { kind: "potencial", rows: split.potential, extra: pending ? t.value.potentialNoAmount(pending) : undefined },
  ];
  return (
    <section aria-labelledby="prive-value" className="space-y-5" data-testid="prive-value">
      <BrandTitle id="prive-value" name={t.brand.value.name} sub={t.brand.value.sub} />
      <p className="max-w-3xl text-sm prive-muted">{t.value.intro}</p>
      {state === "loading" ? <p role="status" className="text-sm prive-muted">{t.common.loading}</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-amber-200">{t.common.error}</p> : null}
      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {boxes.map((b) => (
              <div key={b.kind} className="prive-panel space-y-2 p-5" data-testid={`prive-value-${b.kind}`}>
                <h3 className="text-[11px] tracking-[0.2em] uppercase prive-gold">{t.value.box[b.kind]}</h3>
                {b.rows.length ? b.rows.map((r) => (
                  <p key={r.currency} className="prive-serif text-3xl" data-testid="prive-value-amount">
                    {formatMoney(r.amount, r.currency, t.lang)} <span className="text-xs prive-muted font-sans">· {t.value.entries(r.count)}</span>
                  </p>
                )) : b.extra ? null : <p className="prive-serif text-2xl prive-muted">{t.value.none}</p>}
                {b.extra ? <p className={b.rows.length ? "text-xs prive-champagne" : "prive-serif text-xl prive-champagne"}>{b.extra}</p> : null}
                <p className="text-[11px] prive-muted">{t.value.boxHelp[b.kind]}</p>
              </div>
            ))}
            <div className="prive-panel space-y-2 p-5" data-testid="prive-value-sin_ahorro">
              <h3 className="text-[11px] tracking-[0.2em] uppercase prive-gold">{t.value.box.sin_ahorro}</h3>
              {split.nonMonetary.length || split.organizedPlans ? (
                <ul className="space-y-1 text-sm">
                  {split.organizedPlans ? <li className="prive-champagne">{t.value.plans(split.organizedPlans)}</li> : null}
                  {split.nonMonetary.slice(0, 4).map((e) => <li key={e.id}><span className="prive-serif text-lg">{e.title}</span> <span className="prive-muted">· {e.non_monetary_note}</span></li>)}
                </ul>
              ) : <p className="prive-serif text-2xl prive-muted">{t.value.none}</p>}
              <p className="text-[11px] prive-muted">{t.value.boxHelp.sin_ahorro}</p>
            </div>
          </div>
          {split.isEmpty ? <p className="text-sm prive-champagne" role="status">{t.value.empty}</p> : null}
          <EntryForm t={t} onSaved={load} />
          {data.entries.length ? (
            <ul className="divide-y divide-[color:var(--pv-line)] prive-panel">
              {data.entries.map((e) => <EntryRow key={e.id} e={e} t={t} onDelete={async () => { await api.valueDelete(e.id); await load(); }} />)}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function EntryRow({ e, t, onDelete }: { e: ValueEntry; t: ValueText; onDelete: () => Promise<void> }) {
  const amount = e.savings_amount != null && e.currency ? formatMoney(Number(e.savings_amount), e.currency, t.lang) : null;
  return (
    <li className="flex items-start justify-between gap-3 p-4" data-testid="prive-value-entry" data-kind={e.kind}>
      <div className="min-w-0 space-y-0.5">
        <p className="text-[11px] tracking-[0.18em] uppercase prive-gold">{t.value.box[e.kind]}</p>
        <p className="text-sm">{e.title}{amount ? <> · <strong>{amount}</strong></> : null}</p>
        {e.reference_source ? <p className="text-xs prive-muted">{t.value.referenceSource}: {e.reference_source}</p> : null}
        {e.evidence_note ? <p className="text-xs prive-muted">{t.value.evidence}: {e.evidence_note}</p> : null}
        {e.non_monetary_note ? <p className="text-xs prive-muted">{e.non_monetary_note}</p> : null}
        {e.occurred_on ? <p className="text-xs prive-muted">{formatValueDate(e.occurred_on, t.lang)}</p> : null}
      </div>
      <button type="button" className={smallBtn} onClick={() => void onDelete()} aria-label={`${t.common.remove}: ${e.title}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
    </li>
  );
}

function EntryForm({ t, onSaved }: { t: ValueText; onSaved: () => Promise<void> }) {
  const api = usePriveValue();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Partial<ValueEntry>>({ kind: "comprobado", currency: "MXN" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof ValueEntry, v: unknown) => setF((x) => ({ ...x, [k]: v === "" ? null : v }));
  // Un ahorro potencial se registra desde un beneficio del radar (no a mano): aquí solo los otros tres.
  const kinds = KINDS.filter((k) => k !== "potencial");
  if (!open) return <button type="button" className={smallGoldBtn} onClick={() => setOpen(true)}>{t.value.add}</button>;
  const money = f.kind !== "sin_ahorro";
  return (
    <form className="prive-panel grid gap-3 p-5 sm:grid-cols-2" data-testid="prive-value-form" onSubmit={async (e) => {
      e.preventDefault();
      const entry: Partial<ValueEntry> = money ? { ...f, non_monetary_note: null } : { ...f, currency: null, reference_amount: null, paid_amount: null, reference_source: null, evidence_note: null };
      const v = valueEntryError(entry);
      if (v) { setErr(t.value.errors[v] ?? t.value.errors.default); return; }
      try {
        const r = await api.valueSave(entry);
        if (!r.ok) { setErr(t.value.errors.default); return; }
        setOpen(false); setErr(null); setF({ kind: "comprobado", currency: "MXN" }); await onSaved();
      } catch { setErr(t.value.errors.default); }
    }}>
      <Field id="value-kind" label={t.value.kind}>
        <select id="value-kind" className={inputCls} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
          {kinds.map((k) => <option key={k} value={k}>{t.value.box[k]}</option>)}
        </select>
      </Field>
      <Field id="value-title" label={t.value.title}><input id="value-title" className={inputCls} maxLength={120} value={f.title ?? ""} onChange={(e) => set("title", e.target.value)} /></Field>
      {money ? (
        <>
          <Field id="value-currency" label={t.value.currency}>
            <select id="value-currency" className={inputCls} value={f.currency ?? "MXN"} onChange={(e) => set("currency", e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field id="value-ref" label={t.value.reference}><input id="value-ref" className={inputCls} inputMode="decimal" type="number" min="0" step="0.01" value={f.reference_amount ?? ""} onChange={(e) => set("reference_amount", e.target.value)} /></Field>
          <Field id="value-paid" label={t.value.paid}><input id="value-paid" className={inputCls} inputMode="decimal" type="number" min="0" step="0.01" value={f.paid_amount ?? ""} onChange={(e) => set("paid_amount", e.target.value)} /></Field>
          <Field id="value-src" label={t.value.referenceSource}><input id="value-src" className={inputCls} maxLength={300} value={f.reference_source ?? ""} onChange={(e) => set("reference_source", e.target.value)} /></Field>
          {f.kind === "comprobado" ? (
            <Field id="value-evidence" label={t.value.evidence}><input id="value-evidence" className={inputCls} maxLength={400} value={f.evidence_note ?? ""} onChange={(e) => set("evidence_note", e.target.value)} /></Field>
          ) : null}
        </>
      ) : (
        <Field id="value-nm" label={t.value.nonMonetary}><input id="value-nm" className={inputCls} maxLength={300} value={f.non_monetary_note ?? ""} onChange={(e) => set("non_monetary_note", e.target.value)} /></Field>
      )}
      {err ? <p role="alert" className="text-xs text-amber-200 sm:col-span-2">{err}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={smallGoldBtn}>{t.common.save}</button>
        <button type="button" className={smallBtn} onClick={() => setOpen(false)}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
