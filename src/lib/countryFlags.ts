/**
 * Banderas para nombres de país como los guarda IATOS (en español, con o sin acentos; también los
 * nombres en inglés más comunes). Sin dependencia: ISO 3166-1 alfa-2 → emoji de bandera.
 */
const ISO: Record<string, string> = {
  mexico: "MX", "estados unidos": "US", eeuu: "US", usa: "US", "united states": "US", canada: "CA",
  guatemala: "GT", belice: "BZ", "el salvador": "SV", honduras: "HN", nicaragua: "NI", "costa rica": "CR", panama: "PA",
  cuba: "CU", "republica dominicana": "DO", "puerto rico": "PR", jamaica: "JM", bahamas: "BS", aruba: "AW", curazao: "CW",
  colombia: "CO", venezuela: "VE", ecuador: "EC", peru: "PE", bolivia: "BO", chile: "CL", argentina: "AR", uruguay: "UY",
  paraguay: "PY", brasil: "BR", brazil: "BR",
  espana: "ES", spain: "ES", portugal: "PT", francia: "FR", france: "FR", italia: "IT", italy: "IT", alemania: "DE", germany: "DE",
  "reino unido": "GB", inglaterra: "GB", escocia: "GB", "united kingdom": "GB", uk: "GB", irlanda: "IE", "paises bajos": "NL",
  holanda: "NL", belgica: "BE", suiza: "CH", austria: "AT", grecia: "GR", greece: "GR", croacia: "HR", noruega: "NO",
  suecia: "SE", dinamarca: "DK", finlandia: "FI", islandia: "IS", polonia: "PL", "republica checa": "CZ", chequia: "CZ",
  hungria: "HU", turquia: "TR", turkey: "TR", monaco: "MC", malta: "MT", rumania: "RO", eslovenia: "SI", montenegro: "ME",
  marruecos: "MA", egipto: "EG", sudafrica: "ZA", kenia: "KE", tanzania: "TZ", mauricio: "MU", seychelles: "SC",
  "emiratos arabes unidos": "AE", emiratos: "AE", dubai: "AE", qatar: "QA", catar: "QA", israel: "IL", jordania: "JO",
  japon: "JP", japan: "JP", china: "CN", "corea del sur": "KR", corea: "KR", tailandia: "TH", thailand: "TH", vietnam: "VN",
  indonesia: "ID", bali: "ID", filipinas: "PH", singapur: "SG", malasia: "MY", india: "IN", maldivas: "MV", "sri lanka": "LK",
  camboya: "KH", nepal: "NP", australia: "AU", "nueva zelanda": "NZ", "polinesia francesa": "PF", fiyi: "FJ",
};

export function normalizeCountry(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
}

export function countryCode(name: string | null | undefined): string | null {
  if (!name) return null;
  return ISO[normalizeCountry(name)] ?? null;
}

export function flagEmoji(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "🌍";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Países únicos (por código, en orden de aparición) a partir de los lugares de un perfil. */
export function uniqueCountries(lugares: { ciudad: string; pais: string | null }[]): { name: string; code: string | null }[] {
  const seen = new Map<string, { name: string; code: string | null }>();
  for (const l of lugares) {
    // Un "lugar" declarado puede ser el propio país ("Japón").
    const name = l.pais ?? (countryCode(l.ciudad) ? l.ciudad : null);
    if (!name) continue;
    const code = countryCode(name);
    const key = code ?? normalizeCountry(name);
    if (!seen.has(key)) seen.set(key, { name, code });
  }
  return [...seen.values()];
}
