// Botones de precio real bajo demanda (Google Flights / Google Hotels): no llaman a nada hasta que se pulsan.
//  * MultiCityFareButton: "Consultar precio real del recorrido" (Google Flights, varias ciudades).
//  * HotelOffersButton: "Ver ofertas reales" (Google Hotels, precio total por proveedor con su enlace).
// Cada resultado dice fuente y hora de consulta; nada se presenta como reserva.
import { noteLiveSearchState } from "@/lib/livePause";
import { useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  requestHotelOffers, requestMultiFare, tripMultiCityLegs,
  type HotelOffersQuery, type HotelOffersSummary, type InterCityLeg, type Invoke, type MultiFareSummary,
} from "@/lib/realFares";
import { SlowLoading } from "@/components/brand/SlowLoading";
import { fetchFxTable, fxLabel } from "@/lib/fx";

const defaultInvoke: Invoke = (fn, opts) => supabase.functions.invoke(fn, opts) as unknown as Promise<{ data: any; error: any }>;
const usd = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} USD`;
const money = (n: number, cur: string) => `$${Math.round(n).toLocaleString("es-MX")} ${cur}`;
const btn = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-primary/50 px-3 text-sm text-foreground transition hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const link = "inline-flex min-h-[36px] items-center gap-1 text-xs text-primary underline-offset-2 hover:underline";

export function MultiCityFareButton({ trip, interLegs, invoke = defaultInvoke }: { trip: any; interLegs: InterCityLeg[]; invoke?: Invoke }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<MultiFareSummary | null>(null);
  const plan = tripMultiCityLegs(trip, interLegs);
  const travelers = Math.max(1, Math.min(9, Math.round(Number(trip?.num_viajeros) || 1)));
  const fx = Number(trip?.itinerario_json?.logistics?.fx_usd_mxn) || 0;
  // Vuelo del plan ya cotizado en Google Flights (logistics-plan, open-jaw en MXN): "Actualizar precio"
  // repite esa búsqueda con la misma clase y moneda, y compara con el precio del plan.
  const liveRow = (Array.isArray(trip?.vuelos_json) ? trip.vuelos_json : []).find((v: any) => String(v?.fuente_precio ?? "") === "en_vivo") ?? null;
  const planTotal = liveRow ? Number(liveRow.price_total_mxn) || (Number(liveRow.precio_por_persona) || 0) * travelers : 0;
  if (plan.missing && !plan.legs.length) return null;
  const run = async () => {
    if (busy || plan.missing) return;
    setBusy(true);
    try { setRes(await requestMultiFare(invoke, plan.legs, travelers, liveRow ? { travel_class: liveRow.travel_class ?? null, currency: "MXN" } : {})); } finally { setBusy(false); }
  };
  const shown = (r: Extract<MultiFareSummary, { ok: true }>, pp = false) =>
    r.currency && r.currency !== "USD" ? money(pp ? r.perPerson : r.total, r.currency) : usd(pp ? r.perPersonUsd : r.totalUsd);
  return (
    <div className="mt-3 rounded-lg border border-border/60 p-3" data-testid="multi-precio-real">
      {!res && (
        <>
          <button type="button" className={btn} onClick={run} disabled={busy || !!plan.missing} data-testid="multi-precio-consultar">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
            {liveRow ? "Actualizar precio" : "Consultar precio real del recorrido"}
          </button>
          <SlowLoading active={busy} size="sm" className="justify-start" label="Consultando Google Flights…" />
          <p className="mt-1.5 text-xs text-muted-foreground" data-testid="multi-precio-tramos">
            {plan.legs.map((l) => `${l.from}→${l.to}`).join(" · ")}
            {plan.omitted.length > 0 && <> · por tierra (no incluidos): {plan.omitted.map((o) => `${o.from}→${o.to}`).join(", ")}</>}
          </p>
          {plan.missing && <p className="mt-1 text-xs text-amber-400/90">{plan.missing}</p>}
        </>
      )}
      {res && <SlowLoading active={busy} size="sm" className="justify-start" label="Actualizando precio en Google Flights…" />}
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
            <span className="text-sm font-medium tabular-nums" data-testid="multi-precio-total">{shown(res)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {res.travelers > 1 ? `${shown(res, true)} por persona · ` : ""}{fx > 0 && res.currency === "USD" ? `≈ $${Math.round(res.totalUsd * fx).toLocaleString("es-MX")} MXN · ` : ""}
            {res.airlines.length ? `Aerolíneas: ${res.airlines.join(", ")}` : ""}
          </p>
          {planTotal > 0 && res.currency === "MXN" && (
            <p className="mt-0.5 text-xs text-muted-foreground" data-testid="multi-precio-antes">
              Precio del plan: {money(planTotal, "MXN")}{res.total !== planTotal ? ` · ${res.total > planTotal ? "subió" : "bajó"} ${money(Math.abs(res.total - planTotal), "MXN")}` : " · sin cambio"}. El total del viaje sigue con el precio del plan.
            </p>
          )}
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

/** Tipo de cambio con su fuente ("1 USD = 18.63 MXN · frankfurter (27/10/2026)"). */
export type OffersFx = { rate: number; label: string };

/** Tipo de cambio de la app (open.er-api.com, o el último guardado / el de respaldo), con su fuente. */
async function appFx(): Promise<OffersFx | null> {
  try {
    const t = await fetchFxTable();
    const rate = Number(t.rates.MXN);
    return rate > 0 ? { rate, label: `1 USD = ${rate.toFixed(2)} MXN · ${fxLabel(t)}` } : null;
  } catch { return null; }
}

/**
 * "Ver ofertas reales" de un hotel. Google Hotels da los precios en USD; bajo una tarjeta en MXN se
 * muestran en MXN (`currency="MXN"`) con el tipo de cambio de la cotización del viaje (`fx`) o, sin él, el
 * de la app, siempre con su fuente, y la cifra original en USD en pequeño (caso E2E 28-oct-2026: "Booking.com
 * $1,030 USD" bajo un hotel de "$21,651 MXN").
 */
export function HotelOffersButton({ query, invoke = defaultInvoke, className = "", currency = "USD", fx = null }: { query: HotelOffersQuery; invoke?: Invoke; className?: string; currency?: "USD" | "MXN"; fx?: OffersFx | null }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<HotelOffersSummary | null>(null);
  const [usedFx, setUsedFx] = useState<OffersFx | null>(null);
  if (!query.property_token || !query.checkin || !query.checkout) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [r, rate] = await Promise.all([
        requestHotelOffers(invoke, query),
        currency === "MXN" ? (fx && fx.rate > 0 ? Promise.resolve(fx) : appFx()) : Promise.resolve(null),
      ]);
      setUsedFx(rate);
      setRes(r);
      if (!r.ok) noteLiveSearchState({ busquedas_en_pausa: /en pausa/i.test(r.message ?? "") });
    } finally { setBusy(false); }
  };
  // Sin tipo de cambio (nunca 1:1 a ciegas) se queda en USD.
  const inMxn = currency === "MXN" && !!usedFx && usedFx.rate > 0;
  return (
    <div className={className} data-testid="hotel-ofertas">
      {!res ? (
        <button type="button" className={btn} onClick={run} disabled={busy} data-testid="hotel-ofertas-ver">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}Ver ofertas reales
        </button>
      ) : !res.ok ? (
        <div role="status" data-testid="hotel-ofertas-sin">
          {/* Dice de qué hotel es (el aviso quedaba debajo del Premium aunque se consultó el de la cotización). */}
          <p className="text-xs">{query.name ? <span className="font-medium">{query.name}: </span> : null}{res.message}</p>
          <button type="button" className={`${link} mt-1`} onClick={run} disabled={busy}>Intentar de nuevo</button>
        </div>
      ) : (
        <div className="rounded-lg border border-border/60 p-2" data-testid="hotel-ofertas-lista">
          {query.name && <p className="text-xs font-medium" data-testid="hotel-ofertas-hotel">{query.name}</p>}
          <p className="text-[11px] text-muted-foreground" data-testid="hotel-ofertas-fuente">
            Google Hotels{res.time ? ` · consultado ${res.time}` : ""}{res.savedPrice ? " · precio guardado, no en vivo" : ""} · total de la estancia
          </p>
          {inMxn && <p className="text-[11px] text-muted-foreground" data-testid="hotel-ofertas-tc">En MXN · {usedFx!.label}</p>}
          <ul className="mt-1 divide-y divide-border/40">
            {res.offers.map((o) => (
              <li key={o.source} className="flex items-center justify-between gap-2 py-1.5" data-testid="hotel-oferta" data-source={o.source}>
                <span className="min-w-0">
                  <span className="block truncate text-sm">{o.source}</span>
                  {o.freeCancellation && <span className="block text-[11px] text-emerald-400">Cancelación gratis</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-sm font-medium tabular-nums" data-testid="hotel-oferta-precio">{inMxn ? money(o.totalUsd * usedFx!.rate, "MXN") : usd(o.totalUsd)}</span>
                  {inMxn && <span className="text-[10px] text-muted-foreground tabular-nums">{usd(o.totalUsd)}</span>}
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
      <SlowLoading active={busy} size="sm" className="justify-start" label={res ? "Actualizando precio en Google Hotels…" : "Consultando Google Hotels…"} />
    </div>
  );
}
