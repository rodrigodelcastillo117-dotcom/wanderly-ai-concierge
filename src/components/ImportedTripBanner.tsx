import { FileUp } from "lucide-react";
import { formatPaid, NO_PRICE_LABEL, PAID_LABEL } from "@/lib/tripImport";

type Paid = { monto: number; moneda: string } | null | undefined;

/**
 * Viaje importado de los documentos de la persona: se dice de dónde salen los precios (lo que pagó,
 * en la moneda del documento) y que el viaje ya se hizo. Nada de "cotizado".
 */
export function ImportedTripBanner({ trip }: { trip: any }) {
  if (trip?.fuente !== "documento") return null;
  const items: Array<{ label: string; paid: Paid }> = [
    ...(Array.isArray(trip.vuelos_json) ? trip.vuelos_json : []).map((v: any) => ({
      label: [v.aerolinea, v.numero_vuelo].filter((x: unknown) => x && x !== "—").join(" ") || "Vuelo",
      paid: v.pagado ?? v.precio_original,
    })),
    ...(Array.isArray(trip.hospedaje_json) ? trip.hospedaje_json : []).map((h: any) => ({
      label: h.nombre && h.nombre !== "—" ? h.nombre : "Hospedaje",
      paid: h.costo_cero ? { monto: 0, moneda: "MXN" } : h.pagado ?? h.precio_original,
    })),
  ];
  const total = Number(trip.pagado_total) > 0 && trip.pagado_moneda ? formatPaid(Number(trip.pagado_total), trip.pagado_moneda) : null;
  return (
    <section className="glass-card rounded-2xl p-4 md:p-5 border border-primary/25 space-y-3" aria-label="Viaje importado de tus documentos" data-testid="imported-trip-banner">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="flex items-center gap-2 text-sm">
          <FileUp className="w-4 h-4 text-primary" aria-hidden="true" />
          <span>Importado de tus documentos{trip.realizado ? " · viaje realizado" : ""}</span>
        </p>
        <p className="text-right">
          <span className="block font-display text-xl gold-text">{total ?? "Sin precio en tus documentos"}</span>
          {total && <span className="block text-[11px] text-muted-foreground">{PAID_LABEL}</span>}
        </p>
      </div>
      {items.length > 0 && (
        <ul className="divide-y divide-white/[0.06] text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5">
              <span className="truncate text-foreground/90">{it.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {it.paid && typeof it.paid.monto === "number"
                  ? it.paid.monto === 0 ? "Sin costo" : formatPaid(it.paid.monto, it.paid.moneda)
                  : NO_PRICE_LABEL}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default ImportedTripBanner;
