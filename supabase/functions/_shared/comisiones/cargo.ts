// Cargo por servicio de IATOS (por ejemplo en vuelos, donde las aerolíneas ya casi no pagan comisión). Puro; misma
// regla que public.service_fee_quote (migración 20261030020000). APAGADO: app_flags.cargo_servicio_enabled = false y la
// regla de vuelos nace sin monto (lo decide el dueño).
//
// Transparencia (lo que se le muestra al viajero ANTES de pagar):
//   · que existe, cuánto es y en qué moneda, separado del precio del proveedor;
//   · si es o no reembolsable. En boletos de o hacia EE. UU., si la agencia se queda con un cargo no reembolsable debe
//     decir que existe, cuánto es y que no se devuelve (14 CFR 399.80(l), Federal Register 12-ago-2024:
//     https://www.govinfo.gov/content/pkg/FR-2024-08-12/html/2024-17602.htm).
// Nunca se suma escondido en el precio del proveedor.

export type ReglaCargo = {
  producto: "vuelo" | "hotel" | "tour" | "traslado" | "seguro";
  modo: "fijo" | "porcentaje" | "fijo_mas_porcentaje";
  monto_fijo: number | null;
  porcentaje: number | null;
  minimo: number | null;
  maximo: number | null;
  moneda: string;
  por: "reserva" | "pasajero";
  reembolsable: boolean;
  etiqueta: string;
  activo: boolean;
};

export type Cargo =
  | { aplica: false; motivo: "apagado" | "sin_regla" | "sin_monto" | "sin_porcentaje_o_base" }
  | { aplica: true; monto: number; moneda: string; etiqueta: string; reembolsable: boolean; por: "reserva" | "pasajero"; texto: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

export function calcularCargo(regla: ReglaCargo | null | undefined, base: number | null, opts: { prendido: boolean; pasajeros?: number }): Cargo {
  if (!opts.prendido) return { aplica: false, motivo: "apagado" };
  if (!regla || !regla.activo) return { aplica: false, motivo: "sin_regla" };
  let v = 0;
  if (regla.modo !== "porcentaje") {
    if (regla.monto_fijo === null || !(regla.monto_fijo >= 0)) return { aplica: false, motivo: "sin_monto" };
    v += regla.monto_fijo;
  }
  if (regla.modo !== "fijo") {
    if (regla.porcentaje === null || base === null || !(base >= 0)) return { aplica: false, motivo: "sin_porcentaje_o_base" };
    v += r2((base * regla.porcentaje) / 100);
  }
  if (regla.por === "pasajero") v *= Math.max(1, Math.min(9, Math.round(opts.pasajeros ?? 1)));
  if (regla.minimo !== null) v = Math.max(v, regla.minimo);
  if (regla.maximo !== null) v = Math.min(v, regla.maximo);
  v = r2(v);
  return { aplica: true, monto: v, moneda: regla.moneda, etiqueta: regla.etiqueta, reembolsable: regla.reembolsable, por: regla.por, texto: textoCargo(v, regla) };
}

/** Texto para el viajero (español, sin letra chica). */
export function textoCargo(monto: number, regla: Pick<ReglaCargo, "moneda" | "etiqueta" | "reembolsable" | "por">): string {
  const cifra = new Intl.NumberFormat("es-MX", { style: "currency", currency: regla.moneda, minimumFractionDigits: 2 }).format(monto);
  return `${regla.etiqueta}: ${cifra}${regla.por === "pasajero" ? " (total por todos los pasajeros)" : ""}. Se cobra aparte del precio del proveedor y ` +
    (regla.reembolsable ? "se devuelve si cancelas." : "no es reembolsable, aunque el proveedor te devuelva el boleto.");
}
