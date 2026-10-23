// Botones de precio real bajo demanda (SerpApi, ya contratado): no llaman a nada hasta que se pulsan.
//  * MultiCityFareButton: "Consultar precio real del recorrido" (Google Flights, varias ciudades).
//  * HotelOffersButton: "Ver ofertas reales" (Google Hotels, precio total por proveedor con su enlace).
// Cada resultado dice fuente y hora de consulta; nada se presenta como reserva.
import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  requestHotelOffers, requestMultiFare, tripMultiCityLegs,
  type HotelOffersQuery, type HotelOffersSummary, type InterCityLeg, type Invoke, type MultiFareSummary,
} from "@/lib/realFares";

const defaultInvoke: Invoke = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>;
const usd = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} USD`;
const btn = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-3 text-sm text-foreground transition hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const link = "inline-flex min-h-[36px] items-center gap-1 text-xs text-primary underline-offset-2 hover:underline";

export function MultiCityFareButton({ trip, interLegs, invoke = defaultInvoke }: { trip: any; interLegs: InterCityLeg[]; invoke?: Invoke }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<MultiFareSummary | null>(null);
  const plan = tripMultiCityLegs(trip, interLegs);
  const travelers = Math.max(1, Math.min(9, Math.round(Number(trip?.num_viajeros) || 1)));
  const fx = Number(trip?.itinerario_json?.logistics?.fx_usd_mxn) || 0;
  if (plan.missing && !plan.legs.length) return null;
  const run = async () => {
    if (busy || plan.missing) return;
    setBusy(true);
    try { setRes(await requestMultiFare(invoke, plan.legs, travelers)); } finally { setBusy(false); }
  };
  return (
    <div className="mt-3 rounded-lg border border-border/60 p-3" data-testid="multi-precio-real">
      {!res && (
        <>
          <button type="button" className={btn} onClick={run} disabled={busy || !!plan.missing} data-testid="multi-precio-consultar">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            Consultar precio real del recorrido
          </button>
          <p className="mt-1.5 text-xs text-muted-foreground" data-testid="multi-precio-tramos">
            {plan.legs.map((l) => `${l.from}→${l.to}`).join(" · ")}
            {plan.omitted.length > 0 && <> · por tierra (no incluidos): {plan.omitted.map((o) => `${o.from}→${o.to}`).join(", ")}</>}
          </p>
          {plan.missing && <p className="mt-1 text-xs text-amber-400/90">{plan.missing}</p>}
        </>
      )}
      {res && !res.ok && (
        <div role="status" data-testid="multi-precio-sin">
          <p className="text-sm">{res.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className={btn} onClick={run} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />Intentar de nuevo</button>
            {res.url && <a className={link} href={res.url} target="_blank" rel="noopener noreferrer">Buscar en Google Flights <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
          </div>
        </div>
      )}
      {res && res.ok && (
        <div data-testid="multi-precio-resultado">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Precio real del recorrido</span>
            <span className="text-sm font-medium tabular-nums" data-testid="multi-precio-total">{usd(res.totalUsd)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {res.travelers > 1 ? `${usd(res.perPersonUsd)} por persona · ` : ""}{fx > 0 ? `≈ $${Math.round(res.totalUsd * fx).toLocaleString("es-MX")} MXN · ` : ""}
            {res.airlines.length ? `Aerolíneas: ${res.airlines.join(", ")}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground" data-testid="multi-precio-fuente">
            Fuente: {res.source}{res.time ? ` · consultado ${res.time}` : ""}{res.savedPrice ? " · precio guardado, no en vivo" : ""}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{res.note} No es una reserva: confirma el precio al comprar.</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className={btn} onClick={run} disabled={busy} data-testid="multi-precio-actualizar">
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />Actualizar precio
            </button>
            {res.url && <a className={link} href={res.url} target="_blank" rel="noopener noreferrer">Ver en Google Flights <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>}
          </div>
        </div>
      )}
    </div>
  );
}

export function HotelOffersButton({ query, invoke = defaultInvoke, className = "" }: { query: HotelOffersQuery; invoke?: Invoke; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<HotelOffersSummary | null>(null);
  if (!query.property_token || !query.checkin || !query.checkout) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try { setRes(await requestHotelOffers(invoke, query)); } finally { setBusy(false); }
  };
  return (
    <div className={className} data-testid="hotel-ofertas">
      {!res ? (
        <button type="button" className={btn} onClick={run} disabled={busy} data-testid="hotel-ofertas-ver">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}Ver ofertas reales
        </button>
      ) : !res.ok ? (
        <div role="status" data-testid="hotel-ofertas-sin">
          <p className="text-xs">{res.message}</p>
          <button type="button" className={`${link} mt-1`} onClick={run} disabled={busy}>Intentar de nuevo</button>
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 p-2" data-testid="hotel-ofertas-lista">
          <p className="text-[11px] text-muted-foreground" data-testid="hotel-ofertas-fuente">
            Google Hotels{res.time ? ` · consultado ${res.time}` : ""}{res.savedPrice ? " · precio guardado, no en vivo" : ""} · total de la estancia
          </p>
          <ul className="mt-1 divide-y divide-border/40">
            {res.offers.map((o) => (
              <li key={o.source} className="flex items-center justify-between gap-2 py-1.5" data-testid="hotel-oferta" data-source={o.source}>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{o.source}</span>
                  {o.freeCancellation && <span className="block text-[11px] text-emerald-400">Cancelación gratis</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-sm font-medium tabular-nums">{usd(o.totalUsd)}</span>
                  {o.url ? <a className={link} href={o.url} target="_blank" rel="noopener noreferrer" data-testid="hotel-oferta-link">{o.label} <ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                    : <span className="text-[11px] text-muted-foreground">Sin enlace directo</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">No es una reserva: el proveedor confirma el precio final.</p>
          <button type="button" className={`${link} mt-1`} onClick={run} disabled={busy} data-testid="hotel-ofertas-actualizar">
            <RefreshCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} aria-hidden="true" />Actualizar precio
          </button>
        </div>
      )}
    </div>
  );
}
