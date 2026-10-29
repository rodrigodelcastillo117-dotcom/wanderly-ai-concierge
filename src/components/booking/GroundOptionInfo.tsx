// Detalle de una opción por tierra en "Comprar" (caso CDMX → Tepoztlán, 27-oct-2026):
//  - En tu coche: casetas REALES de Google Maps (ida × 2, con hora de consulta) y gasolina "estimado" con
//    su fórmula y la fuente del precio (Profeco). En un viaje guardado antes del arreglo, las casetas se
//    consultan solo al pulsar (TollInfo), nunca se inventan.
//  - Autobús: sin precio; el botón lleva a ADO (o la línea) y aquí se dice que el precio está en su sitio.
import { Fuel, Receipt } from "lucide-react";
import { TollInfo } from "@/components/roadtrip/TollInfo";
import { busLinkFor, carCostFor, isBusOption, isHiredCarOption } from "@/lib/groundTrip";
import { tollTime } from "../../../supabase/functions/_shared/tollQuote.ts";
import { formatInstantDateTime } from "@/lib/localDate";

const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

/** Una línea corta para dentro de la tarjeta de la opción (sin enlaces: va dentro de un botón). */
export function groundOptionSummary(trip: any, v: any): { price: string; sub: string } | null {
  const cost = carCostFor(trip, v);
  if (cost) {
    const hasTolls = cost.casetas.total_mxn !== null;
    return {
      price: cost.total_mxn ? money(cost.total_mxn) : "Por calcular",
      sub: hasTolls ? "Por el coche · casetas reales + gasolina estimada" : "Por el coche · gasolina estimada; casetas por consultar",
    };
  }
  if (isBusOption(v)) {
    const bus = busLinkFor(trip);
    return { price: "Precio en el sitio", sub: bus ? `Horarios y precio en ${bus.site}` : "Horarios y precio con la línea" };
  }
  if (isHiredCarOption(v)) return { price: "Por cotizar", sub: "Precio con el operador: IATOS no lo cotiza" };
  return null;
}

export function GroundOptionInfo({ trip, option, className = "" }: { trip: any; option: any; className?: string }) {
  const cost = carCostFor(trip, option);
  if (cost) {
    const iso = cost.casetas.consultado_at;
    // Día y hora en la misma zona (antes el día salía en UTC y la hora local: un día corrido de noche).
    const at = iso && tollTime(iso) ? formatInstantDateTime(iso) : null;
    return (
      <div className={`space-y-1 rounded-lg border border-border/50 bg-surface/30 p-3 text-xs ${className}`} data-testid="ground-costo">
        {cost.casetas.total_mxn !== null ? (
          <p className="flex flex-wrap items-center gap-1.5" data-testid="ground-casetas" data-estado="CON_MONTO">
            <Receipt className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>Casetas: {money(cost.casetas.total_mxn)} ida y vuelta ({money(cost.casetas.ida_mxn ?? 0)} de ida × 2)</span>
            <span className="text-muted-foreground">· Google Maps{at ? ` · consultado ${at}` : ""}</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] tracking-wide text-primary">real</span>
          </p>
        ) : (
          <TollInfo quote={cost.casetas.quote} from={trip?.ciudad_origen} to={trip?.destino} consultable={cost.casetas.estado === "SIN_CONSULTAR"} />
        )}
        {cost.gasolina.total_mxn !== null ? (
          <div data-testid="ground-gasolina">
            <p className="flex flex-wrap items-center gap-1.5">
              <Fuel className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>Gasolina: ~{money(cost.gasolina.total_mxn)}</span>
              <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] tracking-wide text-muted-foreground">estimado</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground" data-testid="ground-formula">
              {cost.gasolina.formula}. Precio promedio de la gasolina regular:{" "}
              <a href={cost.gasolina.fuente.url} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">Profeco</a>{" "}
              (semana al {fmtDay(cost.gasolina.fuente.data_date)}). Consumo supuesto; el real depende de tu coche.
            </p>
          </div>
        ) : <p className="text-muted-foreground">Gasolina: sin distancia para estimarla.</p>}
        <p className="text-[11px] text-muted-foreground">Es el costo del coche (no por persona). No incluye estacionamiento.</p>
      </div>
    );
  }
  if (isBusOption(option)) {
    const bus = busLinkFor(trip);
    return (
      <p className={`text-xs text-muted-foreground ${className}`} data-testid="ground-bus">
        {bus ? `Llega con: ${bus.lleva}. El precio y la compra son en ${bus.site}; IATOS no lo cotiza.` : "Horarios y precio con la línea de autobús: IATOS no lo cotiza."}
      </p>
    );
  }
  if (isHiredCarOption(option)) {
    return <p className={`text-xs text-muted-foreground ${className}`} data-testid="ground-contratado">Chofer o traslado privado: el precio lo da el operador; IATOS no lo cotiza ni lo inventa.</p>;
  }
  return null;
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d} ${MES[m - 1]} ${y}` : iso;
}
