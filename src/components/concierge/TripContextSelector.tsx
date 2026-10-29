import { Plane } from "lucide-react";
import { isTripEnded, type ActiveTripResult } from "@/lib/activeTrip";
import { shortTripName } from "../../../supabase/functions/_shared/tripName.ts";
import { withIatoMark } from "@/lib/iatoMark";

export type ContextTrip = {
  id: string;
  destino?: string | null;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  created_at?: string | null;
};

// "elegido por ti" se leía como "lo elegiste tú" cuando lo había elegido Iato (auditoría 10, ronda 3, §4).
// Ahora dice quién lo eligió: tú lo fijaste, o Iato lo eligió (y por qué).
export const REASON_TEXT: Record<string, string> = {
  pinned: "lo fijaste tú",
  explicit: "lo fijaste tú",
  mentioned: "Iato eligió este viaje",
  in_progress: "en curso",
  single_upcoming: "tu próximo viaje",
};
const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const ymd = (v?: string | null) => {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? { y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]) } : null;
};

/**
 * Nombre corto del viaje para el selector del chat (auditoría 10, ronda 4, N4-P2-9): a 390 px
 * "Oaxaca (15 ene al 18 ene)" se cortaba en "Oaxaca (15 ene al 18 e…". Ahora "Oaxaca · 15–18 ene",
 * "Valle de Bravo · 30 oct–1 nov".
 */
export function compactTripLabel(t: ContextTrip): string {
  const name = shortTripName(t as any) || t.destino || "Sin destino";
  const a = ymd(t.fecha_salida);
  const b = ymd(t.fecha_regreso);
  if (!a && !b) return name;
  if (!b) return `${name} · desde ${a!.d} ${MES_CORTO[a!.mo]}`;
  if (!a) return `${name} · hasta ${b.d} ${MES_CORTO[b.mo]}`;
  const yr = a.y !== b.y ? ` ${String(b.y).slice(2)}` : "";
  const range = a.mo === b.mo && a.y === b.y
    ? (a.d === b.d ? `${a.d} ${MES_CORTO[a.mo]}` : `${a.d}–${b.d} ${MES_CORTO[a.mo]}`)
    : `${a.d} ${MES_CORTO[a.mo]}–${b.d} ${MES_CORTO[b.mo]}${yr}`;
  return `${name} · ${range}`;
}

/** Texto junto al selector cuando la última respuesta de Iato fue sobre otro viaje (N-P2-8). */
export const FOLLOW_TEXT = "Iato habla de este viaje";

/**
 * Muestra sobre qué viaje está hablando Iato y deja cambiarlo (guarda profiles.active_trip_id).
 * "Automático" = Iato decide: el viaje que menciones, el que está en curso o el único próximo; si
 * hay empate, te pregunta.
 *
 * `phaseHint` (de location.ts) reemplaza "en curso" cuando la ubicación dice otra cosa: el día de
 * salida, todavía en tu ciudad, el viaje "sale hoy" (caso Huixquilucan → Roma, 22-oct-2026).
 * Compacto: una sola línea que se recorta en vez de desbordar el encabezado.
 */
export function TripContextSelector({ trips, todayLocal, pinnedId, resolved, onChange, phaseHint, followId = null, className = "" }: {
  trips: ContextTrip[];
  todayLocal: string;
  pinnedId: string | null;
  resolved: ActiveTripResult<ContextTrip>;
  onChange: (id: string | null) => void;
  phaseHint?: string | null;
  /** Viaje del que trató la última respuesta de Iato (lo nombró el usuario): el selector lo sigue (N-P2-8). */
  followId?: string | null;
  className?: string;
}) {
  const options = trips.filter((t) => !isTripEnded(t, todayLocal) || t.id === pinnedId || t.id === followId);
  if (!options.length) return null;
  const following = !!followId && options.some((t) => t.id === followId);
  const reasonHint = resolved.trip
    ? REASON_TEXT[resolved.reason] ?? ""
    : resolved.reason === "ambiguous" ? "Iato te preguntará cuál" : "";
  const hint = following ? FOLLOW_TEXT : resolved.trip && phaseHint ? phaseHint : reasonHint;
  const value = following ? followId! : pinnedId && options.some((t) => t.id === pinnedId) ? pinnedId : "";
  return (
    // Un solo renglón también en el celular (ola 9.5: el encabezado ocupaba 4 renglones): el viaje tiene el
    // ancho que necesita y quién lo eligió va al lado, en letra chica, recortado si no cabe (texto completo
    // en el title). N4-P2-9: el nombre corto del viaje ("Oaxaca · 15–18 ene") ya no se corta.
    <label className={`flex min-w-0 flex-nowrap items-center gap-x-1 ${className}`} data-testid="trip-context">
      <Plane className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
      <span className="sr-only">Viaje en contexto:</span>
      <select
        aria-label="Viaje en contexto"
        value={value}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 shrink sm:flex-none max-w-[13.5rem] sm:max-w-[18rem] truncate rounded-full border border-primary/30 bg-background/60 px-2 py-0.5 text-[11px] text-foreground focus:border-primary focus:outline-none"
      >
        <option value="">
          {resolved.trip && !pinnedId ? `Automático · ${resolved.trip.destino ?? "viaje"}` : "Automático (Iato decide)"}
        </option>
        {options.map((t) => (
          <option key={t.id} value={t.id}>{compactTripLabel(t)}</option>
        ))}
      </select>
      {hint && <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[10px] sm:text-[11px] text-muted-foreground" title={hint} data-testid="trip-phase">{withIatoMark(hint)}</span>}
    </label>
  );
}
