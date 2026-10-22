// Tarjeta de un PRIVÉ DROP: todo lo que hace verdadera a una oportunidad, a la vista (proveedor, destino,
// tipo, beneficio real, condiciones, elegibilidad, vigencia, fuente, fecha de verificación, enlace y estado).
// Nada se esconde tras un hover. Un porcentaje solo aparece con su comparación verificable.
import { BadgeCheck, CalendarClock, Info } from "lucide-react";
import { displayPrice, effectiveDropStatus, localToday, pick, type PriveDrop } from "@/lib/priveValueModel";
import { formatMoney, formatValueDate, type ValueLang, type ValueText } from "@/lib/priveValueI18n";
import { Chip, OutLink, SourceLine, smallBtn } from "./ValueUi";

const STATUS_TONE = { activo: "good", por_verificar: "warn", vencido: "muted", programado: "muted", retirado: "muted" } as const;

export function DropCard({ drop, lang, t, onOpenLink, onFollow, following = false, compact = false, radarLabel }: {
  drop: PriveDrop; lang: ValueLang; t: ValueText; onOpenLink?: (d: PriveDrop) => void; onFollow?: (d: PriveDrop) => void; following?: boolean; compact?: boolean;
  /** En el radar: el estado del beneficio (p. ej. POSIBLE BENEFICIO), dentro de la tarjeta. */
  radarLabel?: string;
}) {
  const status = effectiveDropStatus(drop, localToday());
  const price = displayPrice(drop.price);
  const dest = drop.destination ? pick({ es: drop.destination.es, en: drop.destination.en }, lang) : t.common.global;
  const until = drop.valid_until ? t.drops.until(formatValueDate(drop.valid_until, lang)) : null;
  const from = drop.valid_from && status === "programado" ? t.drops.from(formatValueDate(drop.valid_from, lang)) : null;
  const conditions = pick(drop.conditions, lang), eligibility = pick(drop.eligibility, lang), restrictions = pick(drop.restrictions, lang);
  const titleId = `drop-${drop.slug}`;
  return (
    <article aria-labelledby={titleId} data-testid="prive-drop" data-status={status} className="prive-panel flex h-full flex-col gap-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        {radarLabel ? <Chip testId="prive-radar-suggested">{radarLabel}</Chip> : null}
        <Chip tone={drop.type === "editorial" ? "muted" : "gold"} testId="prive-drop-type">{t.dropType[drop.type]}</Chip>
        <Chip tone={STATUS_TONE[status]} testId="prive-drop-status">{t.dropStatus[status]}</Chip>
        {(drop.reasons ?? []).map((r) => <Chip key={r} tone="good">{t.drops.reasons[r]}</Chip>)}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] tracking-[0.2em] uppercase prive-muted">{drop.provider.name} · {dest}</p>
        <h3 id={titleId} className="prive-serif text-xl sm:text-2xl leading-snug">{pick(drop.title, lang)}</h3>
      </div>
      <p className="text-sm leading-relaxed text-[color:var(--pv-text)]"><span className="sr-only">{t.drops.benefit}: </span>{pick(drop.benefit, lang)}</p>
      {price ? (
        <p className="text-sm prive-champagne" data-testid="prive-drop-price">
          {t.drops.price}: <strong>{formatMoney(price.offer, price.currency, lang)}</strong>
          {price.pct !== null && price.reference !== null ? (
            <> · {t.drops.before} <s>{formatMoney(price.reference, price.currency, lang)}</s> (−{price.pct} %)</>
          ) : null}
        </p>
      ) : null}
      {!compact ? (
        <dl className="grid gap-3 text-sm">
          {conditions ? <div><dt className="text-[11px] tracking-[0.18em] uppercase prive-gold">{t.drops.conditions}</dt><dd className="prive-muted">{conditions}</dd></div> : null}
          {eligibility ? <div><dt className="text-[11px] tracking-[0.18em] uppercase prive-gold">{t.drops.eligibility}</dt><dd className="prive-muted">{eligibility}</dd></div> : null}
          {restrictions ? <div><dt className="text-[11px] tracking-[0.18em] uppercase prive-gold">{t.drops.restrictions}</dt><dd className="prive-muted">{restrictions}</dd></div> : null}
        </dl>
      ) : null}
      <p className="flex items-start gap-2 text-xs prive-muted">
        <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t.drops.validity}: {from ?? until ?? t.drops.ongoing}</span>
      </p>
      {drop.type === "editorial" ? <Note>{t.drops.editorialNote}</Note> : null}
      {drop.type === "beneficio_tarjeta" ? <Note>{t.drops.cardNote}</Note> : null}
      {drop.relationship === "afiliado" ? <Note>{t.drops.affiliate}</Note> : null}
      {drop.relationship === "publicidad" ? <Note>{t.drops.advertising}</Note> : null}
      {status === "por_verificar" ? <Note warn>{t.drops.porVerificar}</Note> : null}
      {drop.matched_program ? <p className="flex items-center gap-2 text-xs prive-champagne"><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />{t.radar.matched(drop.matched_program)}</p> : null}
      <div className="mt-auto space-y-3 pt-1">
        <SourceLine url={drop.source.url} name={drop.source.name} date={drop.last_verified_at} lang={lang} t={t} />
        <div className="flex flex-wrap gap-2">
          <OutLink href={drop.link} t={t} onOpen={() => onOpenLink?.(drop)} className="prive-btn prive-btn-gold !min-h-[44px] !px-5 !tracking-[0.14em] !text-[11px]">
            {t.common.openOfficial}
          </OutLink>
          {onFollow && drop.type !== "editorial" ? (
            <button type="button" className={smallBtn} disabled={following} aria-pressed={following} onClick={() => onFollow(drop)}>
              {following ? t.drops.following : t.drops.follow}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function Note({ children, warn = false }: { children: React.ReactNode; warn?: boolean }) {
  return (
    <p className={`flex items-start gap-2 text-xs ${warn ? "text-amber-200" : "prive-muted"}`}>
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
