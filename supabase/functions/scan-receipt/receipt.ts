// Lectura de tickets con un modelo de visión. Lógica pura (Vitest, sin Deno).
//
// Reglas:
//   - Solo se lee un archivo del bucket privado trip-receipts dentro de la carpeta de la persona en ese
//     viaje: <viaje>/<quien subió>/<archivo> (nunca una URL que mande el cliente).
//   - El modelo copia lo que ve; lo que no se lee es null. Aquí se valida campo por campo: montos >= 0,
//     moneda ISO, fecha real. Si no hay un total legible, no hay gasto que proponer.
//   - Nada se guarda: la app llena el formulario y la persona confirma o corrige.
//   - La confianza baja si el modelo duda o si los números no cuadran entre sí, y se dice por qué.

export const RECEIPT_BUCKET = "trip-receipts";
export const RECEIPT_MODEL = "google/gemini-flash-latest";
/** Imágenes más grandes no se mandan completas (costo y tiempo); se intenta la versión reducida. */
export const MAX_RECEIPT_BYTES = 8 * 1024 * 1024;
export const RECEIPT_MAX_TOKENS = 4096;

/**
 * Texto de la respuesta del modelo: el endpoint compatible a veces manda `content` como lista de partes
 * ([{ type: "text", text }]) en lugar de un texto; antes eso se leía como "sin total".
 */
export function receiptContent(choice: unknown): unknown {
  const msg = (choice as { message?: { content?: unknown } } | null)?.message;
  const c = msg?.content;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : "")).join("");
  return c;
}

/** ¿La respuesta se cortó por tokens? (finish_reason "length" / "max_tokens"). */
export function receiptTruncated(choice: unknown): boolean {
  return /^(length|max_tokens)$/i.test(String((choice as { finish_reason?: unknown } | null)?.finish_reason ?? ""));
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/[A-Za-z0-9._-]{1,120}$`);

/** La ruta es <tripId>/<userId>/<archivo> y no se sale de esa carpeta. */
export function receiptPathOk(path: unknown, tripId: string, userId: string): boolean {
  if (typeof path !== "string" || path.includes("..")) return false;
  const m = PATH_RE.exec(path);
  return !!m && m[1] === tripId && m[2] === userId;
}

export function mimeForReceipt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" } as Record<string, string>)[ext] ?? "image/jpeg";
}

export const RECEIPT_PROMPT = `Lee este ticket, factura o comprobante de compra. Devuelve SOLO JSON:
{"legible": true|false,
 "comercio": "nombre del negocio tal como aparece" | null,
 "fecha": "YYYY-MM-DD" | null,
 "total": número (el TOTAL pagado, con impuestos y propina si vienen incluidos) | null,
 "moneda": "código ISO de 3 letras (EUR, MXN, USD, GBP…)" | null,
 "subtotal": número | null,
 "propina": número | null,
 "iva": número (IVA, VAT, TVA, MwSt u otro impuesto al consumo) | null,
 "conceptos": [{"nombre": texto, "cantidad": número | null, "importe": número | null}],
 "confianza": número de 0 a 1 (qué tan seguro estás del total, la moneda y la fecha),
 "dudas": ["qué no se lee bien, en español"]}
Reglas: NO inventes. Si algo no se lee o no aparece, null. Números sin símbolos ni separadores de miles
(1234.5). Fechas europeas: 03/11/2026 es 3 de noviembre. La moneda solo si la indica el ticket (símbolo,
código o país inequívoco); "$" solo no basta: usa la pista del viaje únicamente si el ticket no la
contradice. Si la foto no es un ticket o no se puede leer, "legible": false.`;

export function receiptBody(dataUrl: string, hints: { currency?: string | null; destination?: string | null } = {}) {
  const pista = [
    hints.destination ? `Destino del viaje: ${String(hints.destination).slice(0, 120)}.` : "",
    hints.currency ? `Moneda local probable: ${String(hints.currency).slice(0, 3).toUpperCase()}.` : "",
  ].filter(Boolean).join(" ");
  return {
    model: RECEIPT_MODEL,
    // El Flash vigente "piensa" antes de responder y esos tokens cuentan en max_tokens: con 1500 la
    // respuesta llegaba cortada (JSON incompleto → 422 "No pudimos leer el ticket" con una foto legible,
    // auditoría 10/10 P2-10). Con 4096 cabe el razonamiento y el JSON completo.
    max_tokens: RECEIPT_MAX_TOKENS,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: RECEIPT_PROMPT + (pista ? `\nPista: ${pista}` : "") },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }],
  };
}

export type ReceiptItem = { name: string; quantity: number | null; amount: number | null };
export type ReceiptReading = {
  merchant: string | null;
  date: string | null;
  total: number;
  currency: string | null;
  subtotal: number | null;
  tip: number | null;
  tax: number | null;
  items: ReceiptItem[];
  /** 0..1 */
  confidenceScore: number;
  confidence: "alta" | "media" | "baja";
  /** Qué revisar, en español. */
  warnings: string[];
};
export type ReceiptResult =
  | { ok: true; receipt: ReceiptReading }
  | { ok: false; code: "ilegible" | "sin_total" | "respuesta_invalida"; message: string };

const CURRENCY_SYMBOLS: Record<string, string> = { "€": "EUR", "£": "GBP", "US$": "USD", "USD$": "USD", "MX$": "MXN", "MN": "MXN", "¥": "JPY", "R$": "BRL", "CHF": "CHF" };

/** "1.234,56", "1,234.56", "12,5", "€ 30" → número. null si no es un número razonable. */
export function readNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // El separador que va al final es el decimal.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "12,50" decimal; "1,234" miles.
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const money = (v: unknown, max = 10_000_000): number | null => {
  const n = readNumber(v);
  return n != null && n >= 0 && n < max ? Math.round(n * 100) / 100 : null;
};

export function readCurrency(v: unknown): string | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (/^[A-Z]{3}$/.test(s) && s !== "NUL") return s;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) if (s === sym.toUpperCase()) return code;
  return null;
}

/** Fecha YYYY-MM-DD real, entre 2000 y mañana. */
export function readDate(v: unknown, today: string): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  const t = new Date(`${today}T00:00:00Z`);
  if (d.getUTCFullYear() < 2000 || d.getTime() > t.getTime() + 86_400_000) return null;
  return s;
}

const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/[<>{}`\\]/g, "").replace(/\s+/g, " ").trim();
  return s && !/^null$/i.test(s) ? s.slice(0, max) : null;
};

function parseJson(content: unknown): Record<string, unknown> | null {
  if (content && typeof content === "object") return content as Record<string, unknown>;
  if (typeof content !== "string") return null;
  const txt = content.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(txt); } catch { /* sigue */ }
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/** Respuesta del modelo → lectura validada (o por qué no sirve). */
export function parseReceipt(content: unknown, today: string): ReceiptResult {
  const data = parseJson(content);
  if (!data) return { ok: false, code: "respuesta_invalida", message: "No pudimos leer el ticket. Prueba con otra foto o captúralo a mano." };
  if (data.legible === false) {
    return { ok: false, code: "ilegible", message: "No se alcanza a leer el ticket. Toma la foto de frente, con luz y sin cortar el total, o captúralo a mano." };
  }
  const total = money(data.total);
  if (total == null || total <= 0) {
    return { ok: false, code: "sin_total", message: "No se ve el total del ticket. Escríbelo tú o toma otra foto donde se vea completo." };
  }
  const warnings: string[] = [];
  const currency = readCurrency(data.moneda);
  if (!currency) warnings.push("No se ve la moneda: revísala.");
  const date = readDate(data.fecha, today);
  if (!date) warnings.push(data.fecha ? "La fecha no parece correcta: revísala." : "No se ve la fecha: revísala.");
  const subtotal = money(data.subtotal);
  const tip = money(data.propina);
  const tax = money(data.iva);
  const items: ReceiptItem[] = [];
  for (const it of Array.isArray(data.conceptos) ? data.conceptos : []) {
    const name = clean((it as Record<string, unknown>)?.nombre, 80);
    if (!name) continue;
    items.push({ name, quantity: money((it as Record<string, unknown>)?.cantidad, 10_000), amount: money((it as Record<string, unknown>)?.importe) });
    if (items.length >= 30) break;
  }
  const tol = Math.max(1, total * 0.02);
  const itemsSum = items.reduce((s, x) => s + (x.amount ?? 0), 0);
  if (items.length >= 2 && items.every((x) => x.amount != null) && Math.abs(itemsSum - total) > tol
      && Math.abs(itemsSum + (tip ?? 0) - total) > tol && Math.abs(itemsSum + (tip ?? 0) + (tax ?? 0) - total) > tol) {
    warnings.push("Los conceptos no suman el total: revisa el monto.");
  }
  if (subtotal != null && subtotal > total + tol) warnings.push("El subtotal es mayor que el total: revisa el monto.");
  if (tip != null && tip > total) warnings.push("La propina es mayor que el total: revísala.");
  if (tax != null && tax > total) warnings.push("El IVA es mayor que el total: revísalo.");
  for (const d of Array.isArray(data.dudas) ? data.dudas.slice(0, 3) : []) {
    const s = clean(d, 120);
    if (s) warnings.push(s.endsWith(".") ? s : `${s}.`);
  }
  const raw = readNumber(data.confianza);
  let score = raw == null ? 0.6 : Math.max(0, Math.min(1, raw));
  if (!currency) score -= 0.2;
  if (!date) score -= 0.1;
  score -= 0.15 * warnings.filter((w) => /no suman|mayor que/.test(w)).length;
  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const confidence = score >= 0.8 ? "alta" : score >= 0.55 ? "media" : "baja";
  return {
    ok: true,
    receipt: { merchant: clean(data.comercio, 120), date, total, currency, subtotal, tip, tax, items, confidenceScore: score, confidence, warnings },
  };
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
