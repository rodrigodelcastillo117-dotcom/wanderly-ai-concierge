// "Sube un viaje que ya hiciste": de lo que leyó parse-trip-file (ya validado en el servidor) a un
// borrador editable, y del borrador a lo que guarda import_past_trip(). Puro, para probarlo.
//
// Reglas: los precios salen SOLO de los documentos (si no aparece, queda vacío y se dice); se
// guardan en la moneda del documento ("Pagado (de tu documento)"); la conversión a pesos solo se
// hace con el tipo de cambio que trajo el servidor (con fuente y fecha) y nunca 1:1.

export const IMPORT_MAX_FILES = 8;
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024; // límite del bucket trip-documents
export const IMPORT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

export const PAID_LABEL = "Pagado (de tu documento)";
export const NO_PRICE_LABEL = "No aparece en el documento";

export type DraftFlight = {
  aerolinea: string; numero_vuelo: string; from: string; to: string; to_iata: string | null; fecha: string;
  hora_salida: string; confirmacion: string; precio: number | null; precio_por_persona: number | null; moneda: string; archivo: number | null;
};
export type DraftHotel = {
  nombre: string; ciudad: string; check_in: string; check_out: string; confirmacion: string;
  precio: number | null; moneda: string; costo_cero: boolean; archivo: number | null;
};
export type ImportDraft = {
  destino: string; pais_destino: string; ciudad_origen: string; fecha_salida: string; fecha_regreso: string;
  num_viajeros: number; moneda: string; vuelos: DraftFlight[]; hoteles: DraftHotel[];
  resumen: string; destinations: string[]; avisos: string[];
  documentos: Array<{ archivo: number; tipo: string }>;
  fx: Record<string, { rate: number; source?: string; fetched_at?: string }> | null;
};

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
const cur = (v: unknown, fallback: string) => (typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : fallback);

/** Borrador a partir de la respuesta de parse-trip-file (campo `extraccion`, montos en su moneda). */
export function draftFromParse(resp: any): ImportDraft {
  const x = resp?.extraccion ?? {};
  const moneda = cur(x.moneda_original, "MXN");
  const vuelos: DraftFlight[] = (Array.isArray(x.vuelos) ? x.vuelos : []).map((v: any) => ({
    aerolinea: s(v.aerolinea), numero_vuelo: s(v.numero_vuelo), from: s(v.from_ciudad ?? v.from_iata), to: s(v.to_ciudad ?? v.to_iata),
    to_iata: typeof v.to_iata === "string" ? v.to_iata : null, fecha: s(v.fecha), hora_salida: s(v.hora_salida),
    confirmacion: s(v.confirmacion), precio: n(v.precio_total), precio_por_persona: n(v.precio_por_persona),
    moneda: cur(v.moneda, moneda), archivo: typeof v.archivo === "number" ? v.archivo : null,
  }));
  const hoteles: DraftHotel[] = (Array.isArray(x.hoteles) ? x.hoteles : []).map((h: any) => ({
    nombre: s(h.nombre), ciudad: s(h.ciudad), check_in: s(h.check_in), check_out: s(h.check_out), confirmacion: s(h.confirmacion),
    precio: h.costo_cero ? 0 : n(h.precio_total), moneda: cur(h.moneda, moneda), costo_cero: !!h.costo_cero,
    archivo: typeof h.archivo === "number" ? h.archivo : null,
  }));
  const destinations: string[] = Array.isArray(x.destinations) ? x.destinations.map(s).filter(Boolean) : [];
  const lastFlightTo = vuelos.length ? vuelos[0].to : "";
  return {
    destino: s(x.destino) || destinations[0] || hoteles[0]?.ciudad || lastFlightTo || "",
    pais_destino: "",
    ciudad_origen: s(x.ciudad_origen),
    fecha_salida: s(x.fecha_salida),
    fecha_regreso: s(x.fecha_regreso),
    num_viajeros: typeof x.num_viajeros === "number" && x.num_viajeros >= 1 ? Math.min(20, Math.round(x.num_viajeros)) : 1,
    moneda,
    vuelos, hoteles,
    resumen: s(x.summary).slice(0, 4000),
    destinations,
    avisos: Array.isArray(resp?.avisos) ? resp.avisos.map(s) : [],
    documentos: Array.isArray(x.documentos) ? x.documentos.map((d: any) => ({ archivo: Number(d.archivo) || 0, tipo: s(d.tipo) || "otro" })) : [],
    fx: resp?.fx && typeof resp.fx === "object" ? resp.fx : null,
  };
}

/** Totales pagados por moneda (solo montos totales del documento; los "por persona" no se suman). */
export function paidTotals(d: Pick<ImportDraft, "vuelos" | "hoteles">): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of [...d.vuelos, ...d.hoteles]) {
    if (typeof it.precio === "number" && it.precio > 0) out[it.moneda] = Math.round(((out[it.moneda] ?? 0) + it.precio) * 100) / 100;
  }
  return out;
}

/** Llaves de duplicado: PNR/confirmaciones y número de vuelo + fecha. */
export function importRefs(d: Pick<ImportDraft, "vuelos" | "hoteles">): string[] {
  const clean = (v: string) => v.toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9:/.-]/g, "");
  const refs = new Set<string>();
  for (const v of d.vuelos) {
    const c = clean(v.confirmacion);
    if (c.length >= 3) refs.add(`PNR:${c}`);
    const num = clean(v.numero_vuelo).replace(/^([A-Z0-9]{2})0+(\d)/, "$1$2");
    if (num.length >= 3 && /^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) refs.add(`VUELO:${num}:${v.fecha}`);
  }
  for (const h of d.hoteles) {
    const c = clean(h.confirmacion);
    if (c.length >= 3) refs.add(`HOTEL:${c}`);
  }
  return [...refs].filter((r) => /^(PNR|VUELO|HOTEL|RESERVA):[A-Z0-9:/.-]{3,60}$/.test(r));
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Errores para mostrar antes de guardar (vacío = se puede guardar). */
export function validateDraft(d: ImportDraft): string[] {
  const errs: string[] = [];
  if (!d.destino.trim()) errs.push("Escribe el destino del viaje.");
  if (!ISO.test(d.fecha_salida)) errs.push("Falta la fecha de salida (AAAA-MM-DD).");
  if (d.fecha_regreso && !ISO.test(d.fecha_regreso)) errs.push("La fecha de regreso no es válida.");
  if (ISO.test(d.fecha_salida) && ISO.test(d.fecha_regreso) && d.fecha_regreso < d.fecha_salida) errs.push("El regreso no puede ser antes de la salida.");
  if (!(d.num_viajeros >= 1 && d.num_viajeros <= 20)) errs.push("Viajeros: entre 1 y 20.");
  for (const it of [...d.vuelos, ...d.hoteles]) {
    if (it.precio !== null && !(it.precio >= 0)) { errs.push("Hay un precio inválido."); break; }
  }
  return errs;
}

/** ¿Ya pasó? (fin del viaje antes de hoy) */
export const isPastTrip = (d: Pick<ImportDraft, "fecha_salida" | "fecha_regreso">, today: string) =>
  (d.fecha_regreso || d.fecha_salida) !== "" && (d.fecha_regreso || d.fecha_salida) < today;

const toMxn = (amount: number | null, moneda: string, fx: ImportDraft["fx"]): number | null => {
  if (amount === null) return null;
  if (moneda === "MXN") return Math.round(amount);
  const r = fx?.[moneda]?.rate;
  return typeof r === "number" && r > 0 ? Math.round(amount * r) : null;
};

/** Lo que recibe import_past_trip(p_trip, p_refs). */
export function buildImportPayload(d: ImportDraft, opts: { archivos: number; today: string }) {
  const totals = paidTotals(d);
  const monedas = Object.keys(totals);
  const pagado_total = monedas.length === 1 ? totals[monedas[0]] : null;
  const pagado_moneda = monedas.length === 1 ? monedas[0] : null;
  const total_estimado = pagado_total !== null && pagado_moneda ? toMxn(pagado_total, pagado_moneda, d.fx) : null;
  const pagado = (precio: number | null, moneda: string) => (precio === null ? null : { monto: precio, moneda, fuente: "documento" });

  const vuelos_json = d.vuelos.map((v) => ({
    aerolinea: v.aerolinea || "—", numero_vuelo: v.numero_vuelo || null, from: v.from || null, to: v.to || null, to_iata: v.to_iata,
    ciudad: v.to || null, fecha: v.fecha || null, hora_salida: v.hora_salida || null, confirmacion: v.confirmacion || null,
    tier: "Pagado", precio_total: toMxn(v.precio, v.moneda, d.fx), precio_por_persona: toMxn(v.precio_por_persona, v.moneda, d.fx),
    pagado: pagado(v.precio, v.moneda), precio_original: v.precio === null ? null : { monto: v.precio, moneda: v.moneda },
    desde_pdf: true, fuente: "documento",
  }));
  const hospedaje_json = d.hoteles.map((h) => {
    const noches = ISO.test(h.check_in) && ISO.test(h.check_out) ? Math.max(0, Math.round((Date.parse(h.check_out) - Date.parse(h.check_in)) / 86400000)) : null;
    return {
      nombre: h.nombre || "—", ciudad: h.ciudad || null, check_in: h.check_in || null, check_out: h.check_out || null, noches,
      confirmacion: h.confirmacion || null, tipo: "Pagado", tier: "Pagado", costo_cero: h.costo_cero,
      precio_total: h.costo_cero ? 0 : toMxn(h.precio, h.moneda, d.fx),
      pagado: h.costo_cero ? null : pagado(h.precio, h.moneda),
      precio_original: h.costo_cero || h.precio === null ? null : { monto: h.precio, moneda: h.moneda },
      por_que: PAID_LABEL, desde_pdf: true, fuente: "documento",
    };
  });

  return {
    p_trip: {
      destino: d.destino.trim(),
      pais_destino: d.pais_destino.trim() || null,
      ciudad_origen: d.ciudad_origen.trim() || null,
      fecha_salida: d.fecha_salida,
      fecha_regreso: d.fecha_regreso || null,
      num_viajeros: d.num_viajeros,
      pagado_total,
      pagado_moneda,
      total_estimado,
      analisis_ai: d.resumen || null,
      vuelos_json,
      hospedaje_json,
      itinerario_json: {
        destinations: d.destinations.length ? d.destinations : [d.destino.trim()],
        multi: d.destinations.length > 1,
        from_pdf: true,
        importado: {
          fuente: "documento",
          archivos: opts.archivos,
          importado_el: opts.today,
          pagado_por_moneda: totals,
          fx: d.fx,
          avisos: d.avisos,
        },
        days: [],
      },
    },
    p_refs: importRefs(d),
  };
}

/** Tipo de trip_documents para cada archivo según lo que dijo el modelo. */
export function docKindFor(tipo: string | undefined): "boleto" | "reserva" | "otro" {
  if (tipo === "boleto" || tipo === "pase_abordar") return "boleto";
  if (tipo === "hotel" || tipo === "crucero" || tipo === "transfer") return "reserva";
  return "otro";
}

/** "MXN 18,400" / "USD 2,236.50" */
export function formatPaid(monto: number, moneda: string): string {
  return `${moneda} ${monto.toLocaleString("es-MX", { minimumFractionDigits: monto % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
