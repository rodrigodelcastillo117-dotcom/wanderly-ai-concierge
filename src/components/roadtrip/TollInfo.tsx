// Casetas de un tramo en coche: monto REAL de Google Maps (Routes API) o por qué no hay monto.
// Nunca consulta al abrir la pantalla: con `consultable` muestra un botón y solo al pulsarlo pide la
// ruta en coche (get-routes, modo DRIVE). Nunca dice "sin casetas" ni inventa un monto.
import { useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import { getRoutes } from "@/lib/googleMaps";
import { tollLine, type TollQuote } from "@/lib/roadtrip";

const key = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Casetas que logistics-plan consultó para el tramo from → to del viaje (o null). */
export function roadLegTolls(trip: any, from: string, to: string): TollQuote | null {
  const legs = trip?.itinerario_json?.logistics?.road_trip?.legs;
  if (!Array.isArray(legs)) return null;
  const leg = legs.find((l: any) => key(l?.from) === key(from) && key(l?.to) === key(to));
  return leg?.tolls ?? null;
}

export function TollInfo({ quote, from, to, consultable = false, className = "" }: {
  quote?: TollQuote | null;
  from?: string;
  to?: string;
  /** Ofrecer "Consultar casetas" si no hay dato (consulta pagada: solo al pulsar). */
  consultable?: boolean;
  className?: string;
}) {
  const [asked, setAsked] = useState<TollQuote | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const q = quote ?? asked ?? null;
  const tried = asked !== undefined;

  const consult = async () => {
    if (!from || !to || loading) return;
    setLoading(true);
    setError(false);
    try {
      const r = await getRoutes({ origin: { address: from }, destination: { address: to }, modes: ["DRIVE"] });
      const drive = r.find((x) => x.mode === "DRIVE");
      setAsked(drive && drive.available ? drive.tolls ?? null : null);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  if (!q && !tried && consultable && from && to) {
    return (
      <p className={`flex flex-wrap items-center gap-2 text-xs text-muted-foreground ${className}`} data-testid="casetas" data-estado="SIN_CONSULTAR">
        <Receipt className="w-3 h-3 text-primary" aria-hidden="true" />
        <span>Casetas: sin consultar</span>
        <button type="button" onClick={() => void consult()} disabled={loading} data-testid="casetas-consultar"
          className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline disabled:opacity-60">
          {loading && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
          Consultar casetas en Google Maps
        </button>
        {error && <span className="text-amber-500">No pudimos consultar Google Maps. Intenta más tarde.</span>}
      </p>
    );
  }

  const live = q?.estado === "CON_MONTO";
  return (
    <p className={`flex flex-wrap items-center gap-2 text-xs ${live ? "text-foreground" : "text-muted-foreground"} ${className}`} data-testid="casetas" data-estado={q?.estado ?? "NO_DISPONIBLE"}>
      <Receipt className="w-3 h-3 text-primary" aria-hidden="true" />
      <span className="min-w-0 break-words">{tollLine(q)}</span>
      {live && <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary">en vivo</span>}
      {!live && <span className="text-[11px]">No se suma al total.</span>}
      {tried && !quote && live && <span className="text-[11px] text-muted-foreground">Consulta informativa: el total del viaje suma las casetas consultadas al generarlo.</span>}
    </p>
  );
}
