// Una propuesta de The Privé Key (THE SIGNATURE / THE INSIDER / THE UNEXPECTED / SURPRISE ME): secuencia con
// horas, motivo, costo según fuente, traslado ESTIMADO, qué se puede pedir y qué falta confirmar, y los enlaces
// reales de reserva del Booking Bridge. Nada aquí afirma una reserva.
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bookmark, BookmarkCheck, CalendarPlus, ChevronDown, ExternalLink, MessageCircle, Send } from "lucide-react";
import { BookingActions } from "@/components/booking/BookingActions";
import { PriveImage } from "@/components/prive/catalog/PriveImage";
import { RequestDialog } from "@/components/prive/catalog/RequestDialog";
import { offerFromVenue } from "@/lib/booking";
import { imageQueries, universeMeta } from "@/lib/priveCatalogView";
import type { PriveExperience, PriveLockedError } from "@/lib/priveCatalogApi";
import type { KeyProposal, KeyStep } from "@/lib/priveKey";
import type { KeyLang, KeyText } from "@/lib/priveKeyI18n";

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

const STATE_BADGE: Record<string, { es: string; en: string; tone: "ok" | "warn" }> = {
  VERIFICADO: { es: "Verificado", en: "Verified", tone: "ok" },
  CURADO: { es: "Curado · por verificar", en: "Curated · to verify", tone: "warn" },
  ESTIMADO: { es: "Datos estimados", en: "Estimated data", tone: "warn" },
};

function StepBooking({ s, tripId, city, onOpened }: { s: KeyStep; tripId?: string | null; city: string | null; onOpened: () => void }) {
  const product = s.experience.universe === "the_table" ? "restaurant" : s.experience.universe === "iconic_events" ? "event" : "experience";
  const offer = offerFromVenue({ name: s.experience.name, city, website: s.experience.website ?? null, booking_url: s.experience.booking_url ?? null,
    booking_method: s.experience.booking_method ?? null, source: "prive_catalog", verified_at: s.experience.verified_at ?? null, prive_slug: s.experience.slug ?? null },
    product, { allow_assisted: false });
  return (
    <div onClickCapture={onOpened}>
      <BookingActions offer={offer} source={{ type: "venue", name: s.experience.name, city, prive_slug: s.experience.slug ?? null, product_type: product, trip_id: tripId ?? null }}
        tripId={tripId ?? null} max={1} />
    </div>
  );
}

export function ProposalCard({ p, lang, t, tripId, saved, inTrip, busy, onSave, onAddTrip, askHref, onTrack, onLocked, featured = false }: {
  p: KeyProposal; lang: KeyLang; t: KeyText; tripId?: string | null; saved: boolean; inTrip: boolean; busy?: boolean;
  onSave: () => void; onAddTrip: () => void; askHref: string; onTrack: (event: "booking_opened" | "request_started" | "ask_iato" | "proposal_opened") => void;
  onLocked: (code: PriveLockedError["code"]) => void; featured?: boolean;
}) {
  const [openBooking, setOpenBooking] = useState<number | null>(null);
  const [request, setRequest] = useState<KeyStep | null>(null);
  const lead = p.steps[0];
  const city = lead?.experience.destination?.name ?? null;
  const tracked = useRef(new Set<string>()).current;
  const once = (k: string, fn: () => void) => { if (!tracked.has(k)) { tracked.add(k); fn(); } };
  return (
    <article className="pk-tier" data-tier={p.tier} data-testid={`pk-proposal-${p.tier}`} aria-labelledby={`pk-${p.tier}-title`}>
      <div className="pk-tier-photo">
        <div className="pk-fallback" aria-hidden="true"><span className="prive-serif text-lg opacity-60">{universeMeta(lead?.experience.universe ?? "")?.title ?? ""}</span></div>
        {lead && (
          <PriveImage queries={imageQueries({ image: lead.experience.image as PriveExperience["image"], subcategory: lead.experience.subcategory,
            destination: lead.experience.destination ?? undefined, universe: lead.experience.universe as PriveExperience["universe"] })}
            illustrative alt={lang === "en" ? `Illustrative photo for ${lead.experience.name}` : `Foto ilustrativa para ${lead.experience.name}`} className="h-full w-full" />
        )}
        <div className="pk-tier-head">
          <p id={`pk-${p.tier}-title`} className="pk-tier-title">{p.title}</p>
          <p className="prive-serif text-2xl leading-tight text-[color:var(--pv-text)]">{p.subtitle}</p>
        </div>
      </div>
      <div className="space-y-5 p-4 sm:p-5">
        <p className="text-sm prive-champagne">{p.concept}</p>
        <section aria-label={t.stepsTitle}>
          <ol className="pk-timeline">
            {p.steps.map((s, i) => {
              const badge = STATE_BADGE[s.experience.state];
              return (
                <li key={`${s.experience.id}-${i}`}>
                  {i > 0 && s.transfer && <p className="pk-transfer">{t.transferEst}: {s.transfer.text}</p>}
                  <p className="pk-time">{p.days > 1 ? `${s.date} · ` : ""}{s.time_text}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.18em] prive-muted">{s.intent_label}</p>
                  <h3 className="prive-serif text-xl leading-snug">
                    {s.experience.slug
                      ? <Link to={`/prive/experiencia/${s.experience.slug}`} className="hover:text-[color:var(--pv-gold)]" onClick={() => onTrack("proposal_opened")}>{s.experience.name}</Link>
                      : s.experience.name}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {s.experience.neighborhood && <span className="text-xs prive-muted">{s.experience.neighborhood}</span>}
                    {badge && <span className={`pk-badge ${badge.tone === "ok" ? "pk-badge-ok" : "pk-badge-warn"}`}>{lang === "en" ? badge.en : badge.es}</span>}
                  </div>
                  <p className="mt-2 text-sm">{s.reason}</p>
                  <p className="mt-1 text-xs prive-muted">
                    <span className="prive-gold">{t.cost}:</span> {s.cost.text}
                    {s.cost.source_url && host(s.cost.source_url) && (
                      <> · <a href={s.cost.source_url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">{host(s.cost.source_url)}</a></>
                    )}
                  </p>
                  {s.requirements.length > 0 && <ul className="pk-list mt-1 prive-muted">{s.requirements.map((r) => <li key={r}>{r}</li>)}</ul>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className="pk-chip text-xs" aria-expanded={openBooking === i} onClick={() => setOpenBooking(openBooking === i ? null : i)}>
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />{t.howToBook}<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className="pk-chip text-xs" onClick={() => { setRequest(s); onTrack("request_started"); }}>
                      <Send className="h-3.5 w-3.5" aria-hidden="true" />{t.request}
                    </button>
                  </div>
                  {openBooking === i && (
                    <div className="mt-2 rounded-xl border border-[color:var(--pv-line)] p-3" data-testid="pk-booking">
                      <StepBooking s={s} tripId={tripId} city={city} onOpened={() => once(`b${i}`, () => onTrack("booking_opened"))} />
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {p.return_to_hotel && <p className="pk-transfer">{p.return_to_hotel.text} · ESTIMADO</p>}
        </section>
        {p.unplaced.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 p-3 text-xs text-amber-200" role="status">{p.unplaced.map((u) => <p key={u.intent}>{u.reason}</p>)}</div>
        )}
        <p className={`text-sm ${p.budget.status === "dentro" ? "text-emerald-200" : "prive-champagne"}`} data-testid="pk-budget">{p.budget.text}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-label={t.confirmable}>
            <h4 className="prive-eyebrow mb-1.5">{t.confirmable}</h4>
            <ul className="pk-list">{p.confirmable.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
          <section aria-label={t.pending}>
            <h4 className="prive-eyebrow mb-1.5">{t.pending}</h4>
            <ul className="pk-list prive-muted">{p.pending.map((x) => <li key={x}>{x}</li>)}</ul>
          </section>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={featured ? "prive-btn prive-btn-gold" : "prive-btn prive-btn-ghost"} onClick={onSave} disabled={saved || busy} aria-pressed={saved}>
            {saved ? <BookmarkCheck className="mr-2 h-4 w-4" aria-hidden="true" /> : <Bookmark className="mr-2 h-4 w-4" aria-hidden="true" />}{saved ? t.saved : t.save}
          </button>
          <button type="button" className="prive-btn prive-btn-ghost" onClick={onAddTrip} disabled={inTrip || busy}>
            <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />{inTrip ? t.addedTrip : t.addTrip}
          </button>
          <Link to={askHref} className="prive-btn prive-btn-ghost" onClick={() => onTrack("ask_iato")}>
            <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />{t.askIato}
          </Link>
        </div>
        <p className="text-[11px] prive-muted">{p.disclaimers[0]}</p>
      </div>
      {request && (
        <RequestDialog e={{ id: request.experience.id, name: request.experience.name, destination: request.experience.destination ?? undefined } as PriveExperience}
          open={!!request} onOpenChange={(v) => !v && setRequest(null)} tripId={tripId ?? null} onLocked={onLocked} />
      )}
    </article>
  );
}
