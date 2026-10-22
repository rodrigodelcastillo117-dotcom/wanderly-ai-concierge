// Canales oficiales de contacto (WhatsApp, correo, SMS, llamada) para que el USUARIO envíe la
// solicitud desde su propia app con un toque. Sin Deno.
//
// Formatos documentados:
//  * WhatsApp click to chat: https://wa.me/<número internacional sin +, ceros, paréntesis ni guiones>
//    ?text=<texto url-encoded> (faq.whatsapp.com/5913398998672934).
//  * mailto: RFC 6068 (subject y body con %-encoding; saltos de línea como %0D%0A).
//  * tel: RFC 3966 (número global con +). Una llamada no se puede pre-llenar: se muestra un guion.
//  * sms: RFC 5724 (sms:+número?body=…). Algunos iPhone antiguos no leen body: el texto se muestra
//    también en pantalla para copiarlo.
// Ningún canal aparece sin una fuente verificada (verified_by).

/** Código de país (ITU E.164) para los países del catálogo y los más comunes. */
export const CALLING_CODES: Record<string, string> = {
  MX: "52", US: "1", CA: "1", ES: "34", FR: "33", IT: "39", PT: "351", GB: "44", DE: "49", GR: "30", JP: "81",
  AE: "971", MC: "377", MA: "212", NL: "31", BE: "32", CH: "41", AT: "43", TR: "90", BR: "55", AR: "54", CO: "57",
  PE: "51", CL: "56", CR: "506", DO: "1", TH: "66", ID: "62", SG: "65", HK: "852", CN: "86", KR: "82", AU: "61",
  NZ: "64", ZA: "27", EG: "20", IE: "353", HR: "385", MT: "356", CY: "357", MV: "960", SC: "248", MU: "230", QA: "974",
  SA: "966", IN: "91", VN: "84", PH: "63", MY: "60", CZ: "420", HU: "36", PL: "48", DK: "45", SE: "46", NO: "47", FI: "358",
  IS: "354", BS: "1", JM: "1", PA: "507", GT: "502", BZ: "501", UY: "598", EC: "593", KE: "254", TZ: "255", LK: "94",
};

/** Países cuyo número nacional empieza con un 0 de enlace que se quita al marcar desde fuera. */
const TRUNK_ZERO = new Set(["FR", "GB", "DE", "JP", "NL", "BE", "CH", "AT", "TR", "ZA", "EG", "IE", "HR", "AU", "NZ", "KR", "CN",
  "TH", "ID", "MY", "PH", "VN", "IN", "AR", "PE", "BR", "KE", "TZ", "LK", "SE", "FI", "CZ", "HU", "PL", "MA"]);
// Italia y Mónaco conservan el 0 inicial de los fijos dentro del número internacional.

export type PhoneResult = { ok: true; e164: string; digits: string; country: string | null } | { ok: false; reason: string };

/**
 * Normaliza a E.164. `country` (ISO-2) es el país del lugar (se infiere del destino). Acepta
 * "+52 55 1234 5678", "0052…", "(55) 1234-5678" con country MX, "01 55…" (marcación vieja de MX),
 * "06 12 34 56 78" con FR, etc. Rechaza números sin país deducible o de longitud imposible.
 */
export function normalizePhone(raw: unknown, country?: string | null): PhoneResult {
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, reason: "vacio" };
  let s = String(raw).trim();
  if (!s) return { ok: false, reason: "vacio" };
  // Extensiones ("ext. 12", "x12"): WhatsApp y tel: no las marcan; se descartan.
  s = s.replace(/\s*(ext\.?|extensi[oó]n|x)\s*\d+\s*$/i, "");
  if (/[a-z]/i.test(s)) return { ok: false, reason: "caracteres" };
  const plus = s.startsWith("+");
  let digits = s.replace(/\D/g, "");
  const cc = country ? CALLING_CODES[country.toUpperCase()] : undefined;
  let detected: string | null = null;

  if (plus) {
    detected = null;
  } else if (digits.startsWith("00")) {
    digits = digits.slice(2);
  } else if (cc && digits.startsWith(cc) && digits.length >= cc.length + 8 && !(country === "MX" && digits.length === 10)) {
    // Ya trae el código de país sin "+" (p. ej. "52 55 1234 5678").
    detected = country!.toUpperCase();
  } else if (cc) {
    const C = country!.toUpperCase();
    if (C === "MX") {
      // México marca 10 dígitos desde 2019; antes "01", "044", "045" (y "1" para celulares desde fuera).
      digits = digits.replace(/^(044|045|01)/, "");
      if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
      if (digits.length !== 10) return { ok: false, reason: "longitud_mx" };
    } else if (TRUNK_ZERO.has(C) && digits.startsWith("0")) {
      digits = digits.slice(1);
    }
    digits = cc + digits;
    detected = C;
  } else {
    return { ok: false, reason: "pais_desconocido" };
  }
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return { ok: false, reason: "longitud" };
  return { ok: true, e164: `+${digits}`, digits, country: detected };
}

/** Número de un enlace wa.me/<n> o api.whatsapp.com/send?phone=<n> (catálogo o sitio oficial). */
export function whatsappNumberFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let n: string | null = null;
    if (host === "wa.me" || host === "www.wa.me") n = u.pathname.replace(/^\/+/, "").split("/")[0];
    else if (host === "api.whatsapp.com" || host === "web.whatsapp.com") n = u.searchParams.get("phone");
    if (!n) return null;
    const d = n.replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 && !d.startsWith("0") ? d : null;
  } catch {
    return null;
  }
}

/** https://wa.me/<dígitos>?text=<texto> (formato oficial de WhatsApp). */
export function whatsappLink(digits: string, text?: string | null): string | null {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length < 8 || d.length > 15 || d.startsWith("0")) return null;
  const t = (text ?? "").trim();
  return t ? `https://wa.me/${d}?text=${encodeURIComponent(t)}` : `https://wa.me/${d}`;
}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (e: unknown): e is string => typeof e === "string" && e.length <= 254 && EMAIL.test(e.trim());

/** RFC 6068: saltos de línea como CRLF codificados; el resto con encodeURIComponent. */
const enc6068 = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));

export function mailtoLink(email: string, subject: string, body: string): string | null {
  if (!isEmail(email)) return null;
  return `mailto:${email.trim()}?subject=${enc6068(subject)}&body=${enc6068(body)}`;
}

export function telLink(e164: string): string | null {
  return /^\+\d{8,15}$/.test(e164) ? `tel:${e164}` : null;
}

export function smsLink(e164: string, body: string): string | null {
  if (!/^\+\d{8,15}$/.test(e164)) return null;
  return `sms:${e164}?body=${encodeURIComponent(body)}`;
}

/** Correos de un enlace mailto: encontrado en el sitio oficial (sin parámetros). */
export function emailFromMailto(href: string): string | null {
  const m = /^mailto:([^?]+)/i.exec(href.trim());
  if (!m) return null;
  const e = decodeURIComponent(m[1]).trim();
  return isEmail(e) ? e : null;
}

const COUNTRY_NAMES: Record<string, string> = {
  mexico: "MX", "estados unidos": "US", usa: "US", "united states": "US", canada: "CA", espana: "ES", spain: "ES", francia: "FR", france: "FR",
  italia: "IT", italy: "IT", portugal: "PT", "reino unido": "GB", "united kingdom": "GB", inglaterra: "GB", alemania: "DE", germany: "DE",
  grecia: "GR", greece: "GR", japon: "JP", japan: "JP", "emiratos arabes unidos": "AE", "emiratos arabes": "AE", monaco: "MC", marruecos: "MA",
  "paises bajos": "NL", holanda: "NL", belgica: "BE", suiza: "CH", austria: "AT", turquia: "TR", brasil: "BR", argentina: "AR", colombia: "CO",
  peru: "PE", chile: "CL", "costa rica": "CR", "republica dominicana": "DO", tailandia: "TH", indonesia: "ID", singapur: "SG", australia: "AU",
  croacia: "HR", maldivas: "MV", irlanda: "IE", sudafrica: "ZA", egipto: "EG", "corea del sur": "KR", china: "CN", india: "IN", vietnam: "VN",
};

/** País ISO-2 a partir del nombre que guarda el viaje (trips.pais_destino) o de un código ya ISO. */
export function countryIso(name: unknown): string | null {
  const s = String(name ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const k = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
  return COUNTRY_NAMES[k] ?? null;
}

/** ¿Trae un número de tarjeta (13–19 dígitos que pasan Luhn)? Nunca se guardan datos de pago. */
export function containsCardNumber(text: unknown): boolean {
  const s = String(text ?? "");
  for (const m of s.matchAll(/(?:\d[ -]?){13,19}/g)) {
    const d = m[0].replace(/\D/g, "");
    if (d.length < 13 || d.length > 19) continue;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      let n = Number(d[d.length - 1 - i]);
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}
