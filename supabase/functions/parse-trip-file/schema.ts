// Validación estricta del JSON que devuelve el modelo al leer documentos de viaje (IATOS-064).
// Sin Deno: se prueba con Vitest con respuestas de ejemplo (nunca se llama a la IA en pruebas).
//
// Antes se hacía JSON.parse y se confiaba en cualquier forma: un precio "—", una fecha "15/03",
// un arreglo que llegaba como objeto o un número como texto terminaban guardados en el viaje. Aquí
// cada campo se limpia a su tipo; lo que no cumple se vuelve null (nunca se inventa) y queda anotado
// en `avisos` para mostrarlo en la vista previa.
import { normalizeCurrency } from "./money.ts";

export type DocKind = "boleto" | "pase_abordar" | "hotel" | "crucero" | "transfer" | "itinerario" | "otro";

export type FlightX = {
  aerolinea: string | null; numero_vuelo: string | null;
  from_ciudad: string | null; from_iata: string | null; to_ciudad: string | null; to_iata: string | null;
  fecha: string | null; hora_salida: string | null; hora_llegada: string | null; duracion: string | null;
  escalas: string | null; clase: string | null; pasajeros: number | null;
  precio_total: number | null; precio_por_persona: number | null; moneda: string | null;
  confirmacion: string | null; notas: string | null; archivo: number | null;
};
export type HotelX = {
  nombre: string; ciudad: string | null; barrio: string | null; direccion: string | null;
  check_in: string | null; check_out: string | null; noches: number | null; tipo: string | null; rating: number | null;
  precio_por_noche: number | null; precio_total: number | null; moneda: string | null;
  costo_cero: boolean; motivo_gratis: string | null; confirmacion: string | null; notas: string | null; archivo: number | null;
};
export type CruiseX = {
  naviera: string | null; barco: string | null; puertos: string[]; fecha_embarque: string | null; fecha_desembarque: string | null;
  noches: number | null; camarote: string | null; precio_total: number | null; moneda: string | null;
  confirmacion: string | null; estado: string | null; notas: string | null; archivo: number | null;
};
export type TransferX = {
  tipo: string | null; from: string | null; to: string | null; fecha: string | null; hora: string | null;
  proveedor: string | null; precio: number | null; moneda: string | null; confirmacion: string | null;
};
export type DayX = {
  dia: number; fecha: string | null; ciudad: string | null; titulo: string;
  "mañana": string; tarde: string; noche: string; tips: string | null; reservas: string[];
};
export type Extraction = {
  summary: string; destino: string | null; destinations: string[]; ciudad_origen: string | null;
  fecha_salida: string | null; fecha_regreso: string | null; num_viajeros: number | null;
  presupuesto_total: number | null; presupuesto_pagado: number | null; moneda_original: string | null;
  documentos: Array<{ archivo: number; tipo: DocKind; pagado: boolean | null }>;
  vuelos: FlightX[]; hoteles: HotelX[]; cruceros: CruiseX[]; transfers: TransferX[]; itinerario: DayX[];
  pendientes: string[]; contactos: Array<{ nombre: string; valor: string }>; notas_generales: string;
};

export type ValidationResult = { ok: true; data: Extraction; avisos: string[] } | { ok: false; error: string };

const EMPTY = new Set(["", "-", "—", "–", "n/a", "na", "null", "undefined", "none", "ninguno", "no aplica", "sin dato", "?"]);

function str(v: unknown, max = 200): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (EMPTY.has(s.toLowerCase())) return null;
  return s.slice(0, max);
}

function longText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** YYYY-MM-DD de calendario real entre 1990 y 2100; cualquier otra cosa → null. */
export function isoDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? s : null;
}

function time(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Monto ≥ 0 tal cual del documento. Acepta "1,234.50" o "$ 1 234"; texto sin cifras → null. */
export function amount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v * 100) / 100 : null;
  if (typeof v !== "string") return null;
  const cleaned = v.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(cleaned)) return null;
  // "1.234,56" (coma decimal) → 1234.56 ; "1,234.56" → 1234.56
  const normalized = /,\d{1,2}$/.test(cleaned) && cleaned.includes(".") ? cleaned.replace(/\./g, "").replace(",", ".")
    : /,\d{1,2}$/.test(cleaned) ? cleaned.replace(",", ".") : cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : null;
}

function int(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.-]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= min && r <= max ? r : null;
}

function currency(v: unknown): string | null {
  return normalizeCurrency(v, null);
}

function iata(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function code(v: unknown): string | null {
  const s = str(v, 40);
  if (!s) return null;
  const c = s.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9-]{3,40}$/.test(c) ? c : null;
}

function flightNo(v: unknown): string | null {
  const s = str(v, 12);
  if (!s) return null;
  const c = s.toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(c) ? c : null;
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const strList = (v: unknown, maxItems: number, maxLen = 120) => arr(v).map((x) => str(x, maxLen)).filter((x): x is string => !!x).slice(0, maxItems);
const fileIdx = (v: unknown) => int(v, 0, 20);

const DOC_KINDS: DocKind[] = ["boleto", "pase_abordar", "hotel", "crucero", "transfer", "itinerario", "otro"];

/** Valida y limpia la respuesta del modelo (objeto o texto JSON, con o sin ```json). */
export function validateExtraction(raw: unknown): ValidationResult {
  let input: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try { input = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return { ok: false, error: "La respuesta no es JSON" };
      try { input = JSON.parse(m[0]); } catch { return { ok: false, error: "La respuesta no es JSON" }; }
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "La respuesta no es un objeto" };
  const p = input as Record<string, unknown>;
  const avisos: string[] = [];
  const note = (cond: boolean, msg: string) => { if (cond && !avisos.includes(msg)) avisos.push(msg); };

  const vuelosRaw = arr(p.vuelos);
  note(p.vuelos !== undefined && !Array.isArray(p.vuelos), "La lista de vuelos venía con un formato inválido.");
  const vuelos: FlightX[] = [];
  for (const it of vuelosRaw.slice(0, 30)) {
    const v = obj(it);
    const f: FlightX = {
      aerolinea: str(v.aerolinea, 80), numero_vuelo: flightNo(v.numero_vuelo),
      from_ciudad: str(v.from_ciudad ?? v.from, 80), from_iata: iata(v.from_iata), to_ciudad: str(v.to_ciudad ?? v.to, 80), to_iata: iata(v.to_iata),
      fecha: isoDate(v.fecha), hora_salida: time(v.hora_salida), hora_llegada: time(v.hora_llegada), duracion: str(v.duracion, 30),
      escalas: str(v.escalas, 80), clase: str(v.clase, 40), pasajeros: int(v.pasajeros, 1, 20),
      precio_total: amount(v.precio_total), precio_por_persona: amount(v.precio_por_persona), moneda: currency(v.moneda),
      confirmacion: code(v.confirmacion), notas: str(v.notas, 300), archivo: fileIdx(v.archivo),
    };
    note(v.fecha != null && !f.fecha, "Una fecha de vuelo no se pudo leer; revísala.");
    note((v.precio_total != null && f.precio_total === null) || (v.precio_por_persona != null && f.precio_por_persona === null), "Un precio de vuelo no era un número; quedó vacío.");
    if (!f.aerolinea && !f.numero_vuelo && !f.from_ciudad && !f.to_ciudad && !f.from_iata && !f.to_iata) {
      note(true, "Se ignoró un vuelo sin aerolínea ni ruta.");
      continue;
    }
    vuelos.push(f);
  }

  const hoteles: HotelX[] = [];
  for (const it of arr(p.hoteles).slice(0, 30)) {
    const h = obj(it);
    const nombre = str(h.nombre, 120);
    if (!nombre) { note(true, "Se ignoró un hospedaje sin nombre."); continue; }
    const costoCero = h.costo_cero === true;
    const hotel: HotelX = {
      nombre, ciudad: str(h.ciudad, 80), barrio: str(h.barrio, 80), direccion: str(h.direccion, 200),
      check_in: isoDate(h.check_in), check_out: isoDate(h.check_out), noches: int(h.noches, 1, 120), tipo: str(h.tipo, 60),
      rating: typeof h.rating === "number" && h.rating >= 0 && h.rating <= 10 ? h.rating : null,
      precio_por_noche: costoCero ? 0 : amount(h.precio_por_noche), precio_total: costoCero ? 0 : amount(h.precio_total),
      moneda: currency(h.moneda), costo_cero: costoCero, motivo_gratis: str(h.motivo_gratis, 160),
      confirmacion: code(h.confirmacion), notas: str(h.notas, 300), archivo: fileIdx(h.archivo),
    };
    note(hotel.check_in !== null && hotel.check_out !== null && hotel.check_out < hotel.check_in, "Un hospedaje tenía la salida antes de la llegada; revísalo.");
    note(!costoCero && h.precio_total != null && hotel.precio_total === null, "Un precio de hospedaje no era un número; quedó vacío.");
    hoteles.push(hotel);
  }

  const cruceros: CruiseX[] = arr(p.cruceros).slice(0, 10).map((it) => {
    const c = obj(it);
    return {
      naviera: str(c.naviera, 80), barco: str(c.barco, 80), puertos: strList(c.puertos, 30, 80),
      fecha_embarque: isoDate(c.fecha_embarque), fecha_desembarque: isoDate(c.fecha_desembarque), noches: int(c.noches, 1, 120),
      camarote: str(c.camarote, 60), precio_total: amount(c.precio_total), moneda: currency(c.moneda),
      confirmacion: code(c.confirmacion), estado: str(c.estado, 40), notas: str(c.notas, 300), archivo: fileIdx(c.archivo),
    };
  }).filter((c) => c.naviera || c.barco || c.puertos.length);

  const transfers: TransferX[] = arr(p.transfers).slice(0, 30).map((it) => {
    const t = obj(it);
    return {
      tipo: str(t.tipo, 40), from: str(t.from, 120), to: str(t.to, 120), fecha: isoDate(t.fecha), hora: time(t.hora),
      proveedor: str(t.proveedor, 80), precio: amount(t.precio), moneda: currency(t.moneda), confirmacion: code(t.confirmacion),
    };
  }).filter((t) => t.from || t.to || t.proveedor);

  const itinerario: DayX[] = arr(p.itinerario).slice(0, 60).map((it, i) => {
    const d = obj(it);
    return {
      dia: int(d.dia, 1, 365) ?? i + 1, fecha: isoDate(d.fecha), ciudad: str(d.ciudad, 80), titulo: str(d.titulo, 140) ?? "",
      "mañana": longText(d["mañana"] ?? d.manana, 1200), tarde: longText(d.tarde, 1200), noche: longText(d.noche, 1200),
      tips: str(d.tips, 600), reservas: strList(d.reservas, 12, 140),
    };
  });

  const documentos = arr(p.documentos).slice(0, 20).map((it) => {
    const d = obj(it);
    const tipo = DOC_KINDS.includes(d.tipo as DocKind) ? d.tipo as DocKind : "otro";
    return { archivo: fileIdx(d.archivo) ?? 0, tipo, pagado: typeof d.pagado === "boolean" ? d.pagado : null };
  });

  let salida = isoDate(p.fecha_salida);
  let regreso = isoDate(p.fecha_regreso);
  note(p.fecha_salida != null && !salida, "La fecha de salida no se pudo leer; revísala.");
  if (salida && regreso && regreso < salida) {
    note(true, "La fecha de regreso era anterior a la salida; se intercambiaron.");
    [salida, regreso] = [regreso, salida];
  }
  // Sin fechas generales: se toman de los vuelos/hoteles leídos (son del documento, no inventadas).
  const allDates = [
    ...vuelos.map((v) => v.fecha), ...hoteles.flatMap((h) => [h.check_in, h.check_out]),
    ...cruceros.flatMap((c) => [c.fecha_embarque, c.fecha_desembarque]),
  ].filter((d): d is string => !!d).sort();
  if (!salida && allDates.length) salida = allDates[0];
  if (!regreso && allDates.length > 1) regreso = allDates[allDates.length - 1];

  const data: Extraction = {
    summary: longText(p.summary, 4000),
    destino: str(p.destino, 200),
    destinations: strList(p.destinations, 20, 80),
    ciudad_origen: str(p.ciudad_origen, 80),
    fecha_salida: salida,
    fecha_regreso: regreso,
    num_viajeros: int(p.num_viajeros, 1, 20),
    presupuesto_total: amount(p.presupuesto_total),
    presupuesto_pagado: amount(p.presupuesto_pagado),
    moneda_original: currency(p.moneda_original),
    documentos,
    vuelos, hoteles, cruceros, transfers, itinerario,
    pendientes: strList(p.pendientes, 30, 200),
    contactos: arr(p.contactos).slice(0, 30).map((c) => ({ nombre: str(obj(c).nombre, 80) ?? "", valor: str(obj(c).valor, 120) ?? "" }))
      .filter((c) => c.nombre || c.valor),
    notas_generales: longText(p.notas_generales, 2000),
  };
  const useful = data.destino || data.destinations.length || vuelos.length || hoteles.length || cruceros.length;
  if (!useful) return { ok: false, error: "No encontramos vuelos, hoteles ni destino en los archivos" };
  return { ok: true, data, avisos };
}
