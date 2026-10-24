// THE PRIVÉ PASSPORT (MY PRIVÉ): tarjeta de miembro (nombre, Member Since, número no sensible, antigüedad,
// estado; "Founding Member" solo si el servidor lo afirma con su fecha de corte) y el registro VOLUNTARIO y
// privado de destinos visitados, experiencias, favoritos, deseos y recuerdos. Sin niveles por riqueza.
import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Monogram } from "@/components/prive/Monogram";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { isFoundingMember, localToday, passportEntryError, tenureParts, type PassportData, type PassportEntry, type PassportKind } from "@/lib/priveValueModel";
import { usePriveValue } from "@/lib/priveValueApi";
import { formatValueDate, useValueText, type ValueLang, type ValueText } from "@/lib/priveValueI18n";
import { BrandTitle, Chip, Field, inputCls, smallBtn, smallGoldBtn, textareaCls } from "./ValueUi";
import { CARD_TEXT, daysToPlatinum2, tierRank, tierText, useMemberCard } from "@/lib/memberCard";
import { TierCard } from "@/components/membercard/TierCard";

const KINDS: PassportKind[] = ["visitado", "experiencia", "favorito", "deseo", "recuerdo"];

export function PassportCard({ lang }: { lang?: ValueLang } = {}) {
  const api = usePriveValue();
  const t = useValueText(lang);
  const [data, setData] = useState<PassportData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "locked" | "error">("loading");
  const load = useCallback(async () => {
    try { setData(await api.passport()); setState("ready"); }
    catch (e) { setState(e instanceof PriveLockedError ? "locked" : "error"); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (state === "ready") void api.track("passport_view", { surface: "my_prive" }); }, [api, state]);
  // El rango de la tarjeta lo da el servidor (my_member_card): Platinum I/II o Fundador. Sin respuesta, la
  // tarjeta clásica del Passport (nunca un rango supuesto). Va ANTES del return temprano: si iba después,
  // al pasar de "loading" a "locked" React veía menos hooks (error #300) y /prive/mi caía en "Algo no cargó bien".
  const { card: tierCard } = useMemberCard();
  if (state === "locked") return null;
  const m = data?.member;
  const tp = tenureParts(m?.tenure_days);
  const founding = isFoundingMember(m);
  const ranked = tierCard && tierRank(tierCard.tier) >= tierRank("platinum_1") ? tierCard : null;
  const left = ranked ? daysToPlatinum2(ranked) : null;
  return (
    <section aria-labelledby="prive-passport" className="space-y-6" data-testid="prive-passport">
      <BrandTitle id="prive-passport" name={t.brand.passport.name} sub={t.brand.passport.sub} />
      {state === "loading" ? <p role="status" className="text-sm prive-muted">{t.common.loading}</p> : null}
      {state === "error" ? <p role="alert" className="text-sm text-amber-200">{t.common.error}</p> : null}
      {data && m ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr] lg:items-start">
          <div className="space-y-3">
            {ranked ? (
              <div className="space-y-3" data-testid="prive-passport-card" data-tier={ranked.tier} data-edition={ranked.edition ?? undefined}>
                <TierCard tier={ranked.tier} edition={ranked.edition} name={ranked.name ?? m.first_name} number={ranked.number ?? m.member_code} since={ranked.since ?? m.member_since}
                  lang={t.lang} interactive testId="prive-passport-tier-card" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 text-sm">
                  <p className="prive-serif text-xl" data-testid="prive-passport-rank">{tierText(ranked.tier, t.lang, ranked.edition).name}</p>
                  <p className="text-xs prive-champagne">{t.passport.status}: {m.status === "active" ? t.passport.active : t.passport.inactive}</p>
                </div>
                <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                  <div>
                    <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">{t.passport.memberNumber}</p>
                    <p className="prive-card-code whitespace-nowrap text-sm prive-champagne" data-testid="prive-member-number">{ranked.number ?? m.member_code ?? "—"}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">{t.passport.memberSince}</p>
                    <p className="text-sm prive-champagne">{formatValueDate(m.member_since, t.lang) || "—"}</p>
                  </div>
                </div>
                {founding ? <p><Chip tone="gold" testId="prive-founding">{t.passport.founding}</Chip></p> : null}
                {left != null ? <p className="text-[11px] prive-muted" data-testid="prive-passport-days-left">{CARD_TEXT[t.lang].daysLeft(left)}</p> : null}
              </div>
            ) : (
            <div className="prive-card text-left" data-testid="prive-passport-card" aria-label={t.passport.cardAria}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="prive-eyebrow">IATOS Privé</p>
                  <p className="mt-1 text-[11px] tracking-[0.2em] uppercase prive-muted">{t.passport.member}</p>
                </div>
                <Monogram size={46} />
              </div>
              <div>
                <p className="prive-serif text-2xl sm:text-[1.7rem] leading-tight">{m.first_name ?? "—"}</p>
                <p className="mt-1 text-xs prive-champagne">{t.passport.status}: {m.status === "active" ? t.passport.active : t.passport.inactive}</p>
                {founding ? <p className="mt-2"><Chip tone="gold" testId="prive-founding">{t.passport.founding}</Chip></p> : null}
              </div>
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
                <div>
                  <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">{t.passport.memberNumber}</p>
                  <p className="prive-card-code whitespace-nowrap text-sm prive-champagne" data-testid="prive-member-number">{m.member_code ?? "—"}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] tracking-[0.2em] uppercase prive-muted">{t.passport.memberSince}</p>
                  <p className="text-sm prive-champagne">{formatValueDate(m.member_since, t.lang) || "—"}</p>
                </div>
              </div>
            </div>
            )}
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="prive-panel p-4"><dt className="text-[10px] tracking-[0.2em] uppercase prive-muted">{t.passport.tenure}</dt><dd className="prive-serif text-xl">{tp ? t.passport.tenureText(tp.years, tp.months, tp.days) : "—"}</dd></div>
              <div className="prive-panel p-4"><dt className="text-[10px] tracking-[0.2em] uppercase prive-muted">{t.passportKind.visitado}</dt><dd className="prive-serif text-xl">{t.passport.countries(data.stats.countries)}</dd></div>
            </dl>
            {founding && m.founding_cutoff ? <p className="text-[11px] prive-muted">{t.passport.foundingCriteria(formatValueDate(m.founding_cutoff, t.lang))}</p> : null}
            <p className="text-[11px] prive-muted">{t.passport.numberNote}</p>
            <p className="text-[11px] prive-champagne">{t.passport.privacy}</p>
          </div>
          <div className="space-y-4">
            <ul className="flex flex-wrap gap-2" aria-label={t.brand.passport.name}>
              {KINDS.map((k) => <li key={k}><Chip>{t.passportKind[k]} · {data.stats[k] ?? 0}</Chip></li>)}
            </ul>
            <PassportForm t={t} onSaved={load} />
            {data.entries.length ? (
              <ol className="relative space-y-4 border-l border-[color:var(--pv-line)] pl-5" data-testid="prive-passport-timeline">
                {data.entries.map((e) => <TimelineItem key={e.id} e={e} t={t} onDelete={async () => { await api.passportDelete(e.id); await load(); }} />)}
              </ol>
            ) : <p className="prive-panel p-5 text-sm prive-muted" role="status">{t.passport.empty}</p>}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TimelineItem({ e, t, onDelete }: { e: PassportEntry; t: ValueText; onDelete: () => Promise<void> }) {
  const place = e.destination ? (t.lang === "en" ? e.destination.en : e.destination.es) : e.place ?? e.experience?.name ?? "";
  return (
    <li className="relative" data-testid="prive-passport-entry" data-kind={e.kind}>
      <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border border-[color:var(--pv-line-strong)] bg-[color:var(--pv-black)]" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.18em] uppercase prive-gold">{t.passportKind[e.kind]}{e.happened_on ? ` · ${formatValueDate(e.happened_on, t.lang)}` : ""}</p>
          <p className="prive-serif text-xl leading-snug">{e.title}</p>
          {place ? <p className="text-sm prive-champagne">{place}</p> : null}
          {e.note ? <p className="mt-1 text-sm prive-muted whitespace-pre-line">{e.note}</p> : null}
        </div>
        <button type="button" className={smallBtn} onClick={() => void onDelete()} aria-label={`${t.common.remove}: ${e.title}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
      </div>
    </li>
  );
}

function PassportForm({ t, onSaved }: { t: ValueText; onSaved: () => Promise<void> }) {
  const api = usePriveValue();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ kind: PassportKind; title: string; place: string; happened_on: string; note: string }>({ kind: "visitado", title: "", place: "", happened_on: "", note: "" });
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button type="button" className={smallGoldBtn} onClick={() => setOpen(true)}>{t.passport.add}</button>;
  return (
    <form className="prive-panel grid gap-3 p-5 sm:grid-cols-2" data-testid="prive-passport-form" onSubmit={async (ev) => {
      ev.preventDefault();
      const v = passportEntryError({ kind: f.kind, title: f.title, destination_text: f.place, note: f.note, happened_on: f.happened_on || null });
      if (v) { setErr(t.passport.errors[v] ?? t.passport.errors.default); return; }
      try {
        // El texto del lugar se intenta resolver como destino del catálogo (alias, acentos); si no, queda como lugar libre.
        const r = await api.passportSave({ kind: f.kind, title: f.title.trim(), destination: f.place.trim(), place: f.place.trim(),
          happened_on: f.happened_on || null, note: f.note.trim() || null });
        if (!r.ok) { setErr(t.passport.errors.default); return; }
        setOpen(false); setErr(null); setF({ kind: "visitado", title: "", place: "", happened_on: "", note: "" }); await onSaved();
      } catch { setErr(t.passport.errors.default); }
    }}>
      <Field id="pp-kind" label={t.passport.kind}>
        <select id="pp-kind" className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as PassportKind })}>
          {KINDS.map((k) => <option key={k} value={k}>{t.passportKind[k]}</option>)}
        </select>
      </Field>
      <Field id="pp-place" label={t.passport.place}><input id="pp-place" className={inputCls} maxLength={120} value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
      <Field id="pp-title" label={t.passport.title}><input id="pp-title" className={inputCls} maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field id="pp-date" label={t.passport.date}><input id="pp-date" type="date" className={inputCls} value={f.happened_on} max={f.kind === "deseo" ? undefined : localToday()} onChange={(e) => setF({ ...f, happened_on: e.target.value })} /></Field>
      <div className="sm:col-span-2"><Field id="pp-note" label={t.passport.note}><textarea id="pp-note" className={textareaCls} maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field></div>
      <p className="text-[11px] prive-champagne sm:col-span-2">{t.passport.privacy}</p>
      {err ? <p role="alert" className="text-xs text-amber-200 sm:col-span-2">{err}</p> : null}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={smallGoldBtn}>{t.common.save}</button>
        <button type="button" className={smallBtn} onClick={() => setOpen(false)}>{t.common.cancel}</button>
      </div>
    </form>
  );
}
