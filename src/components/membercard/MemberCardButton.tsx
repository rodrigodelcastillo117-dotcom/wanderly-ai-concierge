// Tu tarjeta en versión mini (menú principal, Travel Avatar). Al tocarla se abre grande con el detalle
// del rango y "Cómo subir de nivel" (PRO → Dorada, Privé → Platinum I, 1 año en Privé → Platinum II).
// La negra NO aparece en la escalera: es solo de los fundadores.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  CARD_TEXT, daysToPlatinum2, longSince, tenureLabel, tierRank, tierText,
  type CardLang, type MemberCardData,
} from "@/lib/memberCard";
import { TierCard } from "./TierCard";

/** Detalle del rango: la tarjeta grande, por qué la tienes y cómo subir. */
export function MemberCardDetail({ card, lang = "es", links = true }: { card: MemberCardData; lang?: CardLang; links?: boolean }) {
  const T = CARD_TEXT[lang];
  const tt = tierText(card.tier, lang);
  const founder = card.tier === "founder_black";
  const left = daysToPlatinum2(card);
  const since = longSince(card.since, lang);
  const tenure = tenureLabel(card.tenure_days, lang);
  return (
    <div className="space-y-5" data-testid="member-card-detail">
      <div className="mx-auto w-full max-w-[420px]">
        <TierCard tier={card.tier} name={card.name} number={card.number} since={card.since} lang={lang} interactive testId="member-tier-card-full" />
      </div>
      <div>
        <p className="text-[10px] tracking-[0.28em] uppercase text-muted-foreground">{T.rank}</p>
        <p className="font-display text-2xl leading-tight" data-testid="member-card-rank">{tt.name}</p>
        <p className="mt-1 text-sm text-muted-foreground">{card.granted ? T.granted : tt.reason}</p>
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
        <div className="col-span-2 sm:col-span-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-w-0">
          <dt className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground">{T.number}</dt>
          <dd className="mt-1 font-medium tabular-nums whitespace-nowrap">{card.number ?? "—"}</dd>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-w-0">
          <dt className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground">{T.memberSince}</dt>
          <dd className="mt-1 font-medium">{since ?? "—"}</dd>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 min-w-0">
          <dt className="text-[10px] tracking-[0.18em] uppercase text-muted-foreground">{T.tenure}</dt>
          <dd className="mt-1 font-medium">{tenure ?? "—"}</dd>
        </div>
      </dl>
      {founder ? null : (
        <section aria-labelledby="member-card-howto" data-testid="member-card-howto">
          <h3 id="member-card-howto" className="text-[11px] tracking-[0.24em] uppercase text-primary">{T.howTo}</h3>
          <ol className="mt-3 space-y-2">
            {T.ladder.map((s) => {
              const reached = tierRank(card.tier) >= tierRank(s.tier);
              const current = card.tier === s.tier;
              return (
                <li
                  key={s.tier}
                  data-testid={`member-card-step-${s.tier}`}
                  data-reached={reached ? "true" : "false"}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${current ? "border-primary/50 bg-primary/[0.07]" : "border-white/[0.06]"}`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${reached ? "border-primary/60 text-primary" : "border-white/15 text-muted-foreground"}`} aria-hidden="true">
                    {reached ? <Check className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                  </span>
                  <span className="flex-1 min-w-0">{s.step} <span aria-hidden="true">→</span><span className="sr-only">:</span> <strong className="font-medium">{s.to}</strong></span>
                  {current ? <span className="text-[10px] tracking-[0.18em] uppercase text-primary">{T.current}</span> : reached ? <span className="sr-only">{T.reached}</span> : null}
                </li>
              );
            })}
          </ol>
          {left != null ? <p className="mt-3 text-xs text-muted-foreground" data-testid="member-card-days-left">{T.daysLeft(left)}</p> : null}
          {links && card.tier === "blue" ? <Link to="/dashboard/pro" className="mt-3 inline-flex min-h-[44px] items-center text-sm text-primary underline-offset-4 hover:underline">{T.seePro}</Link> : null}
          {links && card.tier === "gold" ? <Link to="/prive" className="mt-3 inline-flex min-h-[44px] items-center text-sm text-primary underline-offset-4 hover:underline">{T.seePrive}</Link> : null}
        </section>
      )}
      <p className="text-[11px] text-muted-foreground">{T.numberNote}</p>
    </div>
  );
}

/** Mini tarjeta que abre el detalle. `card` null = todavía sin respuesta del servidor: no se inventa un rango. */
export function MemberCardButton({ card, loading = false, lang = "es", className = "", testId = "member-card-mini" }: {
  card: MemberCardData | null;
  loading?: boolean;
  lang?: CardLang;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const T = CARD_TEXT[lang];
  if (!card) {
    return loading ? <div className={`aspect-[85.6/54] w-full rounded-[7px] bg-white/[0.04] animate-pulse motion-reduce:animate-none ${className}`} data-testid={`${testId}-loading`} aria-hidden="true" /> : null;
  }
  const tt = tierText(card.tier, lang);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={T.open(tt.name)}
        className={`block w-full rounded-[8px] text-left transition-transform duration-300 hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:hover:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
        data-testid={testId}
        data-tier={card.tier}
      >
        <TierCard tier={card.tier} name={card.name} number={card.number} since={card.since} lang={lang} size="mini" testId={`${testId}-card`} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-3xl border-white/[0.08] bg-background/95 backdrop-blur-xl sm:max-w-[480px]">
          <DialogTitle className="sr-only">{`${T.card} ${tt.name}`}</DialogTitle>
          <DialogDescription className="sr-only">{card.granted ? T.granted : tt.reason}</DialogDescription>
          <MemberCardDetail card={card} lang={lang} />
        </DialogContent>
      </Dialog>
    </>
  );
}
