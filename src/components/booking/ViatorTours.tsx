// "Ver tours reales en Viator": botón explícito (no llama a nada hasta que se pulsa) que trae hasta 6
// tours de la Partner API de Viator (viator-search) con foto, calificación, duración, precio "desde" con
// su moneda y "Ver en Viator" (productUrl con el afiliado de IATOS). Nada se presenta como reservado.
// Términos de Viator: solo en pantallas con sesión; sin indexar (no va en páginas públicas ni en SEO).
import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search, Star, Ticket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { viatorLink } from "@/lib/affiliateLinks";
import { logBookingClick } from "@/lib/trackBooking";
import { requestViatorTours, type Invoke, type ViatorQuery, type ViatorSummary, type ViatorTourView } from "@/lib/viatorTours";

const defaultInvoke: Invoke = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>;
const btn = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-3 text-sm text-foreground transition hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const link = "inline-flex min-h-[36px] items-center gap-1 text-xs text-primary underline-offset-2 hover:underline";

/** Tarjeta de un tour de Viator (la usan Comprar, Tours y las cards "tour" de Iato). */
export function ViatorTourCard({ tour, time, city, tripId, showSource = false }: { tour: ViatorTourView; time: string | null; city?: string; tripId?: string; showSource?: boolean }) {
  return (
    <li className="flex gap-3 rounded-xl border border-border/60 bg-card/70 p-2.5" data-testid="viator-tour">
      {tour.photo ? (
        <img src={tour.photo} alt={tour.title} loading="lazy" referrerPolicy="no-referrer" className="h-16 w-16 shrink-0 rounded-lg object-cover ring-1 ring-white/[0.06]" />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-muted/40"><Ticket className="h-5 w-5 text-muted-foreground" aria-hidden="true" /></span>
      )}
      <div className="min-w-0 flex-1">
        <h5 className="line-clamp-2 text-sm font-medium leading-tight">{tour.title}</h5>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {tour.rating && (
            <span className="inline-flex items-center gap-0.5 text-foreground/90" aria-label={`Calificación ${tour.rating}`}>
              <Star className="h-3 w-3 fill-primary text-primary" aria-hidden="true" />{tour.rating.toLocaleString("es-MX", { maximumFractionDigits: 1 })}
              {tour.reviews ? <span className="text-muted-foreground">({tour.reviews.toLocaleString("es-MX")})</span> : null}
            </span>
          )}
          {tour.duration && <span>{tour.rating ? "· " : ""}{tour.duration}</span>}
        </p>
        <p className="mt-0.5 text-xs tabular-nums" data-testid="viator-tour-precio">
          {tour.priceText ?? "Precio en Viator"}{time ? <span className="text-muted-foreground"> · consultado {time}</span> : null}
        </p>
        {tour.mxnNote && <p className="text-[11px] text-muted-foreground" data-testid="viator-tour-mxn">{tour.mxnNote}</p>}
        {showSource && <p className="text-[10px] text-muted-foreground" data-testid="viator-tour-fuente">Fuente: Viator · «Ver en Viator» no es una reserva</p>}
        <a href={tour.url} target="_blank" rel="noopener noreferrer sponsored" data-testid="viator-tour-ver"
          onClick={() => void logBookingClick({ category: "activity", provider: "Viator", title: tour.title, bookingUrl: tour.url, city, tripId })}
          className="mt-1.5 inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90">
          Ver en Viator <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      </div>
    </li>
  );
}

/** Lista de resultados (o el aviso honesto) de una consulta a Viator. */
function ViatorResults({ res, q, busy, onRetry, tripId }: { res: ViatorSummary; q: ViatorQuery; busy: boolean; onRetry: () => void; tripId?: string }) {
  const search = viatorLink(q.city, q.query ?? undefined);
  if (!res.ok) {
    return (
      <div role="status" data-testid="viator-sin">
        <p className="text-sm">{res.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" className={link} onClick={onRetry} disabled={busy}><RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />Intentar de nuevo</button>
          <a className={link} href={search} target="_blank" rel="noopener noreferrer sponsored">Buscar en Viator <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
        </div>
      </div>
    );
  }
  return (
    <div data-testid="viator-lista">
      <p className="text-[11px] text-muted-foreground" data-testid="viator-fuente">Fuente: Viator{res.time ? ` · consultado ${res.time}` : ""} · precio «desde» en su moneda</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {res.tours.map((t) => <ViatorTourCard key={t.code} tour={t} time={res.time} city={q.city} tripId={tripId} />)}
      </ul>
      <p className="mt-1.5 text-[11px] text-muted-foreground">«Ver en Viator» abre la ficha en viator.com: no es una reserva; ahí eliges fecha y personas y ves el precio final.</p>
    </div>
  );
}

function useViator(q: ViatorQuery, invoke: Invoke) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ViatorSummary | null>(null);
  const run = async () => {
    if (busy || !q.city?.trim()) return;
    setBusy(true);
    try { setRes(await requestViatorTours(invoke, q)); } finally { setBusy(false); }
  };
  return { busy, res, run };
}

/** Botón "Ver tours reales en Viator" con los resultados debajo (Comprar y Tours del viaje). */
export function ViatorToursButton({ city, query, dateFrom, dateTo, tripId, invoke = defaultInvoke, className = "" }:
  { city: string; query?: string | null; dateFrom?: string | null; dateTo?: string | null; tripId?: string; invoke?: Invoke; className?: string }) {
  const q: ViatorQuery = { city, query, dateFrom, dateTo };
  const { busy, res, run } = useViator(q, invoke);
  if (!city?.trim()) return null;
  return (
    <div className={`rounded-lg border border-border/60 p-3 ${className}`} data-testid="viator-tours" data-city={city}>
      {!res ? (
        <button type="button" className={btn} onClick={run} disabled={busy} data-testid="viator-ver">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
          Ver tours reales en Viator
        </button>
      ) : <ViatorResults res={res} q={q} busy={busy} onRetry={run} tripId={tripId} />}
    </div>
  );
}

/**
 * Para un tour "Sin verificar" del plan: en lugar de la búsqueda genérica, "Ver tours reales en
 * Viator" con ese nombre; los resultados se abren en un diálogo (la tarjeta del carrusel es angosta).
 */
export function ViatorToursDialogButton({ city, query, dateFrom, dateTo, tripId, invoke = defaultInvoke }:
  { city: string; query?: string | null; dateFrom?: string | null; dateTo?: string | null; tripId?: string; invoke?: Invoke }) {
  const q: ViatorQuery = { city, query, dateFrom, dateTo };
  const { busy, res, run } = useViator(q, invoke);
  const [open, setOpen] = useState(false);
  if (!city?.trim()) return null;
  return (
    <>
      <button type="button" data-testid="pick-viator"
        onClick={() => { setOpen(true); if (!res) void run(); }}
        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:bg-primary/90">
        <Search className="h-3 w-3" aria-hidden="true" /> Ver tours reales en Viator
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tours reales en Viator</DialogTitle>
            <DialogDescription>{query ? `${query} · ${city}` : city}</DialogDescription>
          </DialogHeader>
          {busy && !res ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Consultando Viator…</p>
            : res ? <ViatorResults res={res} q={q} busy={busy} onRetry={run} tripId={tripId} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
