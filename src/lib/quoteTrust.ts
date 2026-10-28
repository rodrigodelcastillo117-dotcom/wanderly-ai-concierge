/**
 * Cuánto del total está verificado con el proveedor y cuánto es estimado (pura, para probarla).
 *
 * Usa los renglones del snapshot inmutable (trip_quotes.line_items) con el estado que decidió el
 * servidor (supabase/functions/_shared/quotes.ts): COTIZADO = precio en vivo vigente al cotizar,
 * PAGADO = reserva confirmada, ESTIMADO, PENDIENTE (en vivo pero vencido o sin verificar).
 * Si la cotización ya venció, nada se presenta como verificado: un COTIZADO viejo pasa a "por
 * verificar". Sin snapshot (viajes anteriores) no se afirma nada: cada precio trae su etiqueta.
 */
export type TrustLine = {
  category: string;
  label: string;
  amount: number;
  /** verificado = consultado en vivo y vigente, o pagado; estimado; por_verificar = vencido o pendiente. */
  trust: "verificado" | "estimado" | "por_verificar";
};

export type QuoteTrust = {
  /** false si no hay renglones (viaje sin snapshot): la pantalla no afirma nada. */
  known: boolean;
  verified: number;
  estimated: number;
  toVerify: number;
  lines: TrustLine[];
  /** Una frase para el usuario. */
  summary: string;
};

type LineItemLike = { category?: string; label?: string; amount?: number | string; state?: string };
type SnapshotLike = { line_items?: LineItemLike[] | null; valid_until?: string | null } | null | undefined;

const IN_TOTAL = new Set(["COTIZADO", "ESTIMADO", "PENDIENTE", "PAGADO"]);
const LABELS: Record<string, string> = {
  vuelos: "Vuelos", hospedaje: "Hospedaje", comida: "Comida", tours: "Experiencias", transporte_local: "Transporte local", extras: "Extras",
};

const fmt = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

/**
 * `labels` cambia el nombre que se muestra de un rubro (p. ej. transporte_local → "Transporte entre
 * ciudades" cuando son trenes entre ciudades); el snapshot guardado no cambia.
 */
export function quoteTrust(snapshot: SnapshotLike, now: Date = new Date(), labels: Record<string, string> = {}): QuoteTrust {
  const items = Array.isArray(snapshot?.line_items) ? snapshot!.line_items! : [];
  const vu = snapshot?.valid_until ? new Date(snapshot.valid_until) : null;
  const expired = !!vu && Number.isFinite(vu.getTime()) && now.getTime() > vu.getTime();
  const lines: TrustLine[] = [];
  for (const it of items) {
    const state = String(it?.state ?? "").toUpperCase();
    if (!IN_TOTAL.has(state)) continue;
    const amount = Math.max(0, Number(it?.amount) || 0);
    if (!(amount > 0)) continue;
    const trust: TrustLine["trust"] =
      state === "PAGADO" ? "verificado"
        : state === "COTIZADO" ? (expired ? "por_verificar" : "verificado")
          : state === "PENDIENTE" ? "por_verificar"
            : "estimado";
    const category = String(it?.category ?? "");
    lines.push({ category, label: labels[category] || it?.label || LABELS[category] || category, amount, trust });
  }
  return summarizeTrust(lines);
}

/** Totales y frase de unos renglones ya etiquetados. */
function summarizeTrust(lines: TrustLine[]): QuoteTrust {
  const sum = (t: TrustLine["trust"]) => lines.filter((l) => l.trust === t).reduce((s, l) => s + l.amount, 0);
  const verified = sum("verificado");
  const estimated = sum("estimado");
  const toVerify = sum("por_verificar");
  if (lines.length === 0) {
    return { known: false, verified: 0, estimated: 0, toVerify: 0, lines, summary: "Cada precio indica abajo si se consultó en vivo o es una estimación." };
  }
  const parts: string[] = [];
  if (verified > 0) parts.push(`${fmt(verified)} con precio consultado en vivo`);
  if (toVerify > 0) parts.push(`${fmt(toVerify)} por volver a verificar`);
  if (estimated > 0) parts.push(`${fmt(estimated)} estimado`);
  return { known: true, verified, estimated, toVerify, lines, summary: `${parts.join(" · ")}.` };
}

/**
 * Los renglones de la cotización con la MISMA etiqueta que el desglose del total (caso E2E 28-oct-2026,
 * Nueva York: "Hospedaje · en vivo $25,060" arriba y "Hospedaje $25,060 estimado" en "Ver desglose del
 * total"). `estimatedKeys` sale de estimatedRubros (tripTotal.ts): un rubro en esa lista es "estimado" en
 * los dos lugares; los demás conservan lo que dijo la cotización.
 */
export function alignTrust(trust: QuoteTrust, estimatedKeys: string[]): QuoteTrust {
  if (!trust.known) return trust;
  const set = new Set(estimatedKeys);
  return summarizeTrust(trust.lines.map((l) => (set.has(l.category) ? { ...l, trust: "estimado" as const } : l)));
}
