// Comparar destinos (auditoría 28-oct-2026): el costo diario salía en USD y la app habla en MXN. La IA
// sigue dando su estimado en USD (es lo que conoce); aquí se pasa a MXN con el tipo de cambio de la app
// (con su fuente y fecha) y se conserva la cifra original en USD como referencia. Puro.
import { convert, type FxTable } from "@/lib/fx";
import { cityAirports } from "../../supabase/functions/_shared/airports.ts";

/** "$80-120", "80 – 120 USD", "US$150" → { min, max }. null si no hay cifras. */
export function parseUsdRange(raw: unknown): { min: number; max: number | null } | null {
  const s = String(raw ?? "").replace(/,/g, "");
  const nums = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  const [a, b] = nums;
  return { min: Math.min(a, b ?? a), max: b != null && b !== a ? Math.max(a, b) : null };
}

const fmt = (n: number) => Math.round(n / 10) * 10;
const money = (n: number) => `$${fmt(n).toLocaleString("es-MX")}`;

/** Costo diario en MXN ("$1,480–2,220 MXN") y la nota de dónde sale. Sin cifras o sin tasa: el texto tal cual. */
export function dailyCostMxn(raw: unknown, fx: FxTable | null): { text: string; note: string | null } {
  const r = parseUsdRange(raw);
  const a = r && fx ? convert(r.min, "USD", "MXN", fx) : null;
  const b = r?.max != null && fx ? convert(r.max, "USD", "MXN", fx) : null;
  if (!r || a == null || (r.max != null && b == null)) return { text: String(raw ?? "").trim() || "—", note: null };
  const rate = convert(1, "USD", "MXN", fx!);
  return {
    text: `${money(a)}${b != null ? `–${money(b).slice(1)}` : ""} MXN por día`,
    note: `De USD ${r.min}${r.max != null ? `–${r.max}` : ""} (estimado de la IA) · 1 USD = ${rate?.toFixed(2)} MXN`,
  };
}

/** Consulta de foto para un destino escrito en español ("Lisboa, Portugal" → "lisbon portugal city travel"). */
export function destinationPhotoQuery(dest: string): string {
  const [city, ...rest] = String(dest ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const c = cityAirports(city);
  const en = c?.aliases?.find((x) => /^[a-z][a-z ]+$/.test(x) && x.length > 3) ?? city ?? "";
  return [en, c?.country ?? rest[0] ?? "", "city travel"].filter(Boolean).join(" ").toLowerCase();
}
