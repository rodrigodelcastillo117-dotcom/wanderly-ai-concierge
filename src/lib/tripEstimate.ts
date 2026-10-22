/**
 * Estimación de REFERENCIA del costo de un viaje cuando la persona no sabe cuánto le va a costar.
 * No es una cotización: la pantalla la etiqueta como "Estimación" y se puede corregir.
 *
 * Orden: (1) el costo estimado de un viaje suyo al mismo destino, si lo tiene; (2) una referencia
 * por región desde México, nivel premium por persona: vuelo redondo en clase turista + hotel 4-5★
 * en habitación doble compartida, comidas y traslados por día. Cifras redondas y conservadoras
 * (revisadas en octubre de 2026); si no se reconoce el destino, se pide elegir la región.
 */
import { destinationCurrency } from "@/lib/currencies";

export type Region =
  | "mexico" | "norteamerica" | "caribe" | "sudamerica" | "europa" | "asia" | "medio_oriente" | "africa" | "oceania";

export const REGIONS: { id: Region; label: string; vuelo: number; diario: number }[] = [
  { id: "mexico", label: "México", vuelo: 4_500, diario: 4_500 },
  { id: "norteamerica", label: "Estados Unidos y Canadá", vuelo: 9_000, diario: 7_500 },
  { id: "caribe", label: "Caribe y Centroamérica", vuelo: 9_000, diario: 5_500 },
  { id: "sudamerica", label: "Sudamérica", vuelo: 16_000, diario: 5_000 },
  { id: "europa", label: "Europa", vuelo: 22_000, diario: 8_000 },
  { id: "asia", label: "Asia", vuelo: 28_000, diario: 6_500 },
  { id: "medio_oriente", label: "Medio Oriente", vuelo: 26_000, diario: 9_000 },
  { id: "africa", label: "África", vuelo: 30_000, diario: 6_500 },
  { id: "oceania", label: "Oceanía", vuelo: 35_000, diario: 8_000 },
];

const BY_CURRENCY: Record<string, Region> = {
  MXN: "mexico",
  USD: "norteamerica", CAD: "norteamerica",
  DOP: "caribe", CRC: "caribe", GTQ: "caribe",
  BRL: "sudamerica", ARS: "sudamerica", COP: "sudamerica", CLP: "sudamerica", PEN: "sudamerica", UYU: "sudamerica", BOB: "sudamerica", PYG: "sudamerica",
  EUR: "europa", GBP: "europa", CHF: "europa", DKK: "europa", SEK: "europa", NOK: "europa", ISK: "europa", CZK: "europa", PLN: "europa", HUF: "europa",
  JPY: "asia", CNY: "asia", HKD: "asia", KRW: "asia", SGD: "asia", THB: "asia", MYR: "asia", IDR: "asia", PHP: "asia", VND: "asia", INR: "asia",
  AED: "medio_oriente", SAR: "medio_oriente", QAR: "medio_oriente", ILS: "medio_oriente", TRY: "medio_oriente",
  EGP: "africa", MAD: "africa", ZAR: "africa",
  AUD: "oceania", NZD: "oceania",
};

/** Región del destino ("Tokio" → asia), con la misma lista de destinos que la moneda sugerida. */
export function regionOf(destino: string | null | undefined): Region | null {
  const cur = destinationCurrency({ destino: destino ?? "" });
  return cur ? BY_CURRENCY[cur] ?? null : null;
}

export type TripEstimate = {
  total: number;
  region: Region;
  regionLabel: string;
  vuelo: number;
  diario: number;
  dias: number;
  personas: number;
};

/** Estimación por región: personas × (vuelo + días × diario). null sin región reconocible. */
export function estimateTripCost(opts: { destino?: string | null; region?: Region | null; dias: number; personas: number }): TripEstimate | null {
  const region = opts.region ?? regionOf(opts.destino);
  const ref = REGIONS.find((r) => r.id === region);
  if (!ref) return null;
  const dias = Math.max(1, Math.round(Number(opts.dias) || 1));
  const personas = Math.max(1, Math.round(Number(opts.personas) || 1));
  // Redondeado a miles: es una referencia, no un precio.
  const total = Math.round((personas * (ref.vuelo + dias * ref.diario)) / 1000) * 1000;
  return { total, region: ref.id, regionLabel: ref.label, vuelo: ref.vuelo, diario: ref.diario, dias, personas };
}
