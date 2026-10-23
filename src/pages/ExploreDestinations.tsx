// Explorar destinos (/dashboard/explorar): lista con foto, fechas, escalas, duración y precio, y el
// mapa del mundo oscuro con el precio en cada marcador. Mismos datos y caché que la ventana
// "Planear viaje" (fetchExplore): abrir la página, cambiar filtros o mover el mapa NO gasta.
// Solo "Buscar precios" (o llegar con ?buscar=1 desde el botón "Explorar destinos") puede consultar
// a Google, una vez, con la cuota del plan y el freno de gasto; un acierto de la caché de 12 h no gasta.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ExploreMap } from "@/components/plan/ExploreMap";
import { DestinationRow } from "@/components/plan/DestinationCards";
import {
  cachedExplore, DEFAULT_ORIGIN, fetchExplore, flightSearchPath, freshnessLabel, consultedHHMM, originChips, type ExploreState,
} from "@/lib/exploreFlights";

const MONTHS = ["Próximos 6 meses", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const ExploreDestinations = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [origin, setOrigin] = useState(params.get("origen") || DEFAULT_ORIGIN);
  const [userOrigin, setUserOrigin] = useState<string | null>(null);
  const [month, setMonth] = useState(() => {
    const m = Number(params.get("mes") ?? 0);
    return Number.isInteger(m) && m >= 0 && m <= 12 ? m : 0;
  });
  const [onlyDirect, setOnlyDirect] = useState(false);
  const [maxPrice, setMaxPrice] = useState<string>("");
  const [state, setState] = useState<ExploreState | null>(() => cachedExplore(params.get("origen") || DEFAULT_ORIGIN, 0));
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  // ?buscar=1 viene del botón "Explorar destinos" (acción explícita). Se usa una sola vez y se quita
  // de la URL: recargar la página ya no vuelve a buscar.
  const wantLive = useRef(params.get("buscar") === "1");

  useEffect(() => {
    if (!user || params.get("origen")) return;
    Promise.resolve(supabase.from("profiles").select("ciudad_origen").eq("id", user.id).maybeSingle())
      .then(({ data }) => {
        const c = typeof data?.ciudad_origen === "string" ? data.ciudad_origen.trim() : "";
        if (c) { setUserOrigin(c); setOrigin(c); }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const reqId = useRef(0);
  const lastKey = useRef<string | null>(null);
  const load = async (live: boolean) => {
    const id = ++reqId.current;
    setLoading(true);
    let next: ExploreState;
    try {
      next = await fetchExplore(origin, { month, live });
    } catch {
      next = { estado: "sin_precios", motivo: "No pudimos consultar precios ahora.", limite: false };
    }
    // Solo la respuesta más reciente pinta (cambiar de origen rápido no mezcla listas).
    if (id !== reqId.current) return;
    setState(next);
    setLoading(false);
  };

  useEffect(() => {
    const key = `${origin}|${month}`;
    if (lastKey.current === key) return; // el doble montaje de desarrollo no repite la lectura
    lastKey.current = key;
    const live = wantLive.current;
    if (live) {
      wantLive.current = false;
      const next = new URLSearchParams(params);
      next.delete("buscar");
      setParams(next, { replace: true });
    }
    void load(live);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, month]);

  const chips = useMemo(() => originChips(userOrigin ?? (params.get("origen") || null)), [userOrigin]); // eslint-disable-line react-hooks/exhaustive-deps
  const destinos = useMemo(() => {
    if (state?.estado !== "ok") return [];
    const cap = Number(maxPrice);
    return state.destinos.filter((d) => (!onlyDirect || d.escalas === 0) && (!(cap > 0) || (d.precio_mxn != null && d.precio_mxn <= cap)));
  }, [state, onlyDirect, maxPrice]);
  const consultadoAt = state?.estado === "ok" ? state.consultadoAt : null;
  const open = (d: (typeof destinos)[number]) => navigate(flightSearchPath(origin, d));

  return (
    <DashboardLayout>
      <div className="mx-auto w-full max-w-7xl px-4 pb-28 pt-4 lg:pb-8">
        <h1 className="font-display text-2xl text-foreground">Explorar destinos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Vuelos desde {origin}. Precios de referencia por persona, ida y vuelta, en clase turista.</p>

        <div className="mt-4 flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          {/* En móvil el mapa va arriba y la lista abajo. */}
          <ExploreMap origin={origin} destinos={destinos} selected={selected} onSelect={(d) => setSelected(d.destino)}
            label={`Mapa de destinos desde ${origin} con precios`} className="order-1 h-64 lg:order-2 lg:sticky lg:top-4 lg:h-[calc(100vh-7rem)]" />

          <div className="order-2 min-w-0 lg:order-1">
            <div role="group" aria-label="Ciudad de salida" className="flex flex-wrap gap-2">
              {chips.map((c) => (
                <button key={c} type="button" aria-pressed={origin === c} onClick={() => setOrigin(c)}
                  className={`rounded-full border px-3 py-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${origin === c ? "border-primary/60 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>
                  {c}
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="explorar-mes" className="sr-only">Mes</label>
              <select id="explorar-mes" value={month} onChange={(e) => setMonth(Number(e.target.value))}
                className="rounded-full border border-border/60 bg-black/40 px-3 py-2 text-xs text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <label className="flex items-center gap-2 rounded-full border border-border/60 px-3 py-2 text-xs text-foreground">
                <input type="checkbox" checked={onlyDirect} onChange={(e) => setOnlyDirect(e.target.checked)} className="accent-[hsl(41_47%_59%)]" />
                Solo directos
              </label>
              <label htmlFor="explorar-tope" className="sr-only">Precio máximo en MXN</label>
              <input id="explorar-tope" inputMode="numeric" placeholder="Tope MXN" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value.replace(/[^0-9]/g, ""))}
                className="w-28 rounded-full border border-border/60 bg-black/40 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground" aria-live="polite">
              <span>
                {state?.estado === "ok"
                  ? [`${destinos.length} destinos`, consultedHHMM(consultadoAt), freshnessLabel(consultadoAt), "Google (Explorar)"].filter(Boolean).join(" · ")
                  : loading ? "Leyendo precios guardados…" : ""}
              </span>
              <button type="button" onClick={() => load(true)} disabled={loading}
                className="flex items-center gap-1.5 rounded-full bg-gradient-gold px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <RefreshCw aria-hidden className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Buscar precios
              </button>
            </div>
            {state?.estado === "ok" && state.aviso && <p role="status" className="mt-2 text-xs text-amber-400/90">{state.aviso}</p>}

            {state && state.estado !== "ok" && !loading && (
              <p data-testid="explore-empty" role="status" className="mt-4 rounded-2xl border border-dashed border-border/60 px-4 py-4 text-sm text-muted-foreground">
                Sin precio ahora. {state.motivo}
                {state.estado === "sin_cache" && " Buscar precios usa una búsqueda de tu plan solo si nadie consultó este origen en las últimas 12 horas."}
              </p>
            )}

            <ul className="mt-3 space-y-2" aria-label={`Destinos desde ${origin}`}>
              {destinos.map((d) => (
                <DestinationRow key={`${d.destino}-${d.salida}`} d={d} consultadoAt={consultadoAt} selected={selected === d.destino}
                  onHover={() => setSelected(d.destino)} onOpen={() => open(d)} />
              ))}
            </ul>
            {state?.estado === "ok" && destinos.length === 0 && (
              <p className="mt-3 text-sm text-muted-foreground">Ningún destino cumple los filtros.</p>
            )}
            {state?.estado === "ok" && (
              <p className="mt-4 text-[11px] text-muted-foreground">
                Precios de referencia: al abrir un destino buscas ese vuelo y el precio se vuelve a consultar antes de comprar. IATOS no reserva desde aquí.
              </p>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ExploreDestinations;
