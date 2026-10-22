// Un consejo del Insider's Notebook: categoría, hecho concreto, fuente con fecha de revisión, y acciones
// reales: guardar y agregarlo a las notas de un viaje ("Tips de tu concierge").
import { useState } from "react";
import { Bookmark, BookmarkCheck, NotebookPen } from "lucide-react";
import type { InsiderTip, MemberTrip } from "@/lib/priveValueModel";
import { pick } from "@/lib/priveValueModel";
import { formatValueDate, type ValueLang, type ValueText } from "@/lib/priveValueI18n";
import type { PriveValueApi } from "@/lib/priveValueApi";
import { Chip, SourceLine, smallBtn } from "./ValueUi";

export function InsiderTipCard({ tip, trips, api, lang, t, index, onChange }: {
  tip: InsiderTip; trips: MemberTrip[]; api: PriveValueApi; lang: ValueLang; t: ValueText; index?: number;
  onChange?: (tip: InsiderTip) => void;
}) {
  const [saved, setSaved] = useState(!!tip.saved);
  const [addedTo, setAddedTo] = useState<string | null>(tip.added_to_trip ?? null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Primero el viaje a este destino; si no, cualquier viaje próximo.
  const ordered = [...trips].sort((a, b) => Number(b.destination_slug === tip.destination.slug) - Number(a.destination_slug === tip.destination.slug));

  const toggleSave = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await api.tipSave(tip.id, !saved);
      if (r.ok) { setSaved(!saved); onChange?.({ ...tip, saved: !saved }); } else setMsg(t.common.error);
    } catch { setMsg(t.common.error); } finally { setBusy(false); }
  };
  const addTo = async (tripId: string) => {
    setBusy(true); setMsg(null); setPicking(false);
    try {
      const r = await api.tipAddToTrip(tip.id, tripId);
      if (r.ok) { setAddedTo(tripId); setSaved(true); onChange?.({ ...tip, saved: true, added_to_trip: tripId }); } else setMsg(t.common.error);
    } catch { setMsg(t.common.error); } finally { setBusy(false); }
  };
  const tripName = (id: string | null) => trips.find((x) => x.id === id)?.destino ?? "";
  return (
    <article className="prive-panel flex h-full flex-col gap-3 p-5" data-testid="prive-tip" aria-labelledby={`tip-${tip.slug}`}>
      <div className="flex flex-wrap items-center gap-2">
        {typeof index === "number" ? <span className="prive-serif text-2xl prive-gold" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span> : null}
        <Chip tone="gold">{t.tipCategory[tip.category]}</Chip>
        {tip.valid_until ? <Chip>{t.insider.validUntil(formatValueDate(tip.valid_until, lang))}</Chip> : null}
        {tip.stale ? <Chip tone="warn">{t.insider.stale}</Chip> : null}
      </div>
      <h3 id={`tip-${tip.slug}`} className="prive-serif text-xl leading-snug">{pick(tip.title, lang)}</h3>
      <p className="text-sm leading-relaxed prive-muted">{pick(tip.body, lang)}</p>
      <div className="mt-auto space-y-2">
        <SourceLine url={tip.source.url} name={tip.source.name} date={tip.source.checked_at} kind="checked" lang={lang} t={t} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallBtn} onClick={toggleSave} disabled={busy} aria-pressed={saved}>
            {saved ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
            {saved ? t.common.saved : t.common.save}
          </button>
          {addedTo ? (
            <span className="inline-flex min-h-[44px] items-center gap-2 text-xs prive-champagne" data-testid="prive-tip-added">
              <NotebookPen className="h-4 w-4" aria-hidden="true" />{t.insider.added}{tripName(addedTo) ? ` · ${tripName(addedTo)}` : ""}
            </span>
          ) : trips.length === 0 ? (
            <span className="inline-flex min-h-[44px] items-center text-xs prive-muted">{t.insider.noTrips}</span>
          ) : trips.length === 1 ? (
            <button type="button" className={smallBtn} disabled={busy} onClick={() => addTo(trips[0].id)}>
              <NotebookPen className="h-4 w-4" aria-hidden="true" />{t.insider.addToTrip}
            </button>
          ) : (
            <button type="button" className={smallBtn} disabled={busy} aria-expanded={picking} onClick={() => setPicking((v) => !v)}>
              <NotebookPen className="h-4 w-4" aria-hidden="true" />{t.insider.addToTrip}
            </button>
          )}
        </div>
        {picking ? (
          <fieldset className="space-y-1">
            <legend className="text-xs prive-muted">{t.insider.chooseTrip}</legend>
            <div className="flex flex-wrap gap-2">
              {ordered.map((tr) => (
                <button key={tr.id} type="button" className={smallBtn} onClick={() => addTo(tr.id)}>
                  {tr.destino}{tr.fecha_salida ? ` · ${formatValueDate(tr.fecha_salida, lang)}` : ""}
                </button>
              ))}
            </div>
          </fieldset>
        ) : null}
        {msg ? <p role="alert" className="text-xs text-amber-200">{msg}</p> : null}
      </div>
    </article>
  );
}
