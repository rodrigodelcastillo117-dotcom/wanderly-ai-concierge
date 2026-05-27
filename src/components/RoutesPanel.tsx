import { useEffect, useState } from "react";
import { Car, Bus, Footprints, Bike, ExternalLink, ChevronDown, ChevronUp, Loader2, AlertCircle } from "lucide-react";
import { getRoutes, type RouteMode, type RoutePoint, type RouteResult } from "@/lib/googleMaps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MODE_META: Record<RouteMode, { label: string; icon: typeof Car }> = {
  DRIVE: { label: "Auto", icon: Car },
  TRANSIT: { label: "Transporte público", icon: Bus },
  WALK: { label: "Caminando", icon: Footprints },
  BICYCLE: { label: "Bici", icon: Bike },
};

const ORDER: RouteMode[] = ["DRIVE", "TRANSIT", "WALK", "BICYCLE"];

interface Props {
  origin: RoutePoint;
  destination: RoutePoint;
  destinationLabel?: string;
  autoFetch?: boolean;
}

export function RoutesPanel({ origin, destination, destinationLabel, autoFetch = true }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [active, setActive] = useState<RouteMode>("DRIVE");
  const [expanded, setExpanded] = useState(false);

  const fetchRoutes = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getRoutes({ origin, destination });
      setRoutes(r);
      const first = r.find((x) => x.available);
      if (first) setActive(first.mode);
    } catch (e) {
      setError((e as Error).message ?? "No se pudo calcular la ruta");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoFetch) fetchRoutes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng, origin.placeId, destination.lat, destination.lng, destination.placeId]);

  const sorted = ORDER.map((m) => routes.find((r) => r.mode === m)).filter(Boolean) as RouteResult[];
  const current = sorted.find((r) => r.mode === active);

  if (!autoFetch && routes.length === 0 && !loading) {
    return (
      <Button variant="outline" size="sm" onClick={fetchRoutes}>
        ¿Cómo llegar{destinationLabel ? ` a ${destinationLabel}` : ""}?
      </Button>
    );
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      <div className="p-3 border-b">
        <div className="text-sm font-medium">Cómo llegar{destinationLabel ? ` · ${destinationLabel}` : ""}</div>
      </div>

      {loading && (
        <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando rutas…
        </div>
      )}

      {error && (
        <div className="p-4 flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={fetchRoutes}>Reintentar</Button>
        </div>
      )}

      {!loading && !error && sorted.length > 0 && (
        <>
          <div className="grid grid-cols-4 gap-1 p-2 border-b">
            {sorted.map((r) => {
              const meta = MODE_META[r.mode];
              const Icon = meta.icon;
              const isActive = r.mode === active;
              const disabled = !r.available;
              return (
                <button
                  key={r.mode}
                  onClick={() => !disabled && setActive(r.mode)}
                  disabled={disabled}
                  className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-xs transition ${
                    isActive ? "bg-primary text-primary-foreground" : disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium leading-tight">{meta.label}</span>
                  <span className="text-[10px] opacity-80">
                    {r.available ? r.duration_text ?? "—" : "N/D"}
                  </span>
                </button>
              );
            })}
          </div>

          {current && current.available && (
            <div className="p-3 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-sm">
                  <Badge variant="secondary">{current.duration_text}</Badge>
                  <Badge variant="outline">{current.distance_text}</Badge>
                  {current.transit_summary && current.transit_summary.transfers > 0 && (
                    <Badge variant="outline">{current.transit_summary.transfers} transbordo(s)</Badge>
                  )}
                </div>
                <Button asChild size="sm">
                  <a href={current.maps_url} target="_blank" rel="noreferrer">
                    Abrir en Google Maps <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </div>

              {current.transit_summary && current.transit_summary.lines.length > 0 && (
                <div className="flex flex-wrap gap-1 text-xs">
                  {current.transit_summary.lines.map((l, i) => (
                    <Badge key={i} variant="secondary">{l}</Badge>
                  ))}
                </div>
              )}

              <div>
                <button
                  onClick={() => setExpanded((v) => !v)}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {expanded ? "Ocultar" : "Ver"} pasos ({current.steps.length})
                </button>
                {expanded && (
                  <ol className="mt-2 space-y-2 text-sm">
                    {current.steps.map((s, i) => (
                      <li key={i} className="flex gap-2 border-l-2 border-muted pl-3 py-0.5">
                        <span className="text-xs text-muted-foreground shrink-0 w-5">{i + 1}.</span>
                        <div className="min-w-0">
                          <div>{s.instruction ?? s.mode}</div>
                          {s.transit && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {s.transit.line_short ?? s.transit.line}
                              {s.transit.headsign ? ` → ${s.transit.headsign}` : ""}
                              {s.transit.departure_stop ? ` · desde ${s.transit.departure_stop}` : ""}
                              {s.transit.arrival_stop ? ` hasta ${s.transit.arrival_stop}` : ""}
                              {s.transit.num_stops ? ` (${s.transit.num_stops} paradas)` : ""}
                            </div>
                          )}
                          <div className="text-[11px] text-muted-foreground">
                            {[s.distance, s.duration].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}

          {current && !current.available && (
            <div className="p-4 text-sm text-muted-foreground">
              {MODE_META[current.mode].label} no disponible para esta ruta.
              {"reason" in current && current.reason ? ` (${current.reason})` : ""}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default RoutesPanel;
