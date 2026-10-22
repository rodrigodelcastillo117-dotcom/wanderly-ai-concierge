// Alertas de la Bóveda: vigencias y requisitos de entrada para tus próximos viajes.
// Reglas con fuente: solo las que se revisaron en un sitio oficial (`sourceUrl`) para pasaporte
// MEXICANO. Cualquier otro caso es un aviso genérico "verifica requisitos" con la Guía del Viajero
// de la SRE. Nada de esto sustituye la consulta oficial: los requisitos cambian.
import { diffLocalDays, formatLocalDate, localISODate, parseLocalDate } from "@/lib/localDate";
import type { VaultItem } from "./types";

export type TripLite = {
  id: string;
  destino: string;
  pais_destino?: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  status?: string | null;
};

export type AlertLevel = "critica" | "aviso" | "info";

export type VaultAlert = {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  itemId?: string;
  tripId?: string;
  sourceUrl?: string;
  sourceLabel?: string;
};

export const SRE_GUIDE = { url: "https://guiadelviajero.sre.gob.mx/", label: "Guía del Viajero (SRE)" };

/** Países con regla curada para pasaporte mexicano + Schengen. */
export const ENTRY_RULES_MX: Record<string, { level: AlertLevel; needs: "visa" | "eta_o_visa" | "eta" | null; title: string; detail: string; sourceUrl: string; sourceLabel: string }> = {
  US: {
    level: "critica", needs: "visa", title: "EUA pide visa con pasaporte mexicano",
    detail: "No vemos una visa de EUA vigente para las fechas de tu viaje en tu bóveda. Si ya la tienes, agrégala.",
    sourceUrl: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html", sourceLabel: "travel.state.gov",
  },
  CA: {
    level: "aviso", needs: "eta_o_visa", title: "Canadá: eTA o visa según tu caso",
    detail: "Con pasaporte mexicano y llegando en avión, pides eTA si tienes visa de EUA vigente o tuviste visa canadiense en los últimos 10 años; si no, necesitas visa de visitante (también por tierra o crucero).",
    sourceUrl: "https://www.canada.ca/en/immigration-refugees-citizenship/campaigns/eta-work-visa-mexico-es.html", sourceLabel: "canada.ca",
  },
  GB: {
    level: "aviso", needs: "eta", title: "Reino Unido pide ETA",
    detail: "Con pasaporte mexicano necesitas una Autorización Electrónica de Viaje (ETA) si no tienes visa británica; tramítala con el mismo pasaporte con el que viajarás.",
    sourceUrl: "https://www.gov.uk/guidance/check-when-you-can-get-an-electronic-travel-authorisation-eta", sourceLabel: "gov.uk",
  },
  SCHENGEN: {
    level: "info", needs: null, title: "Espacio Schengen sin visa para estancias cortas",
    detail: "Con pasaporte mexicano no necesitas visa para turismo de hasta 90 días en 180. Tu entrada se registra en el sistema EES; revisa si ya aplica ETIAS antes de volar.",
    sourceUrl: "https://travel-europe.europa.eu/", sourceLabel: "travel-europe.europa.eu",
  },
  JP: {
    level: "info", needs: null, title: "Japón sin visa hasta 90 días",
    detail: "Con pasaporte mexicano entras sin visa para turismo de hasta 90 días; lleva boleto de salida.",
    sourceUrl: "https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html", sourceLabel: "mofa.go.jp",
  },
};

export const SCHENGEN = new Set(["AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IS", "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK"]);

export const COUNTRY_NAME: Record<string, string> = {
  MX: "México", US: "EUA", CA: "Canadá", GB: "Reino Unido", JP: "Japón", EU: "Espacio Schengen",
  ES: "España", FR: "Francia", IT: "Italia", DE: "Alemania", PT: "Portugal", GR: "Grecia", NL: "Países Bajos",
  BE: "Bélgica", CH: "Suiza", AT: "Austria", CZ: "República Checa", HU: "Hungría", PL: "Polonia", HR: "Croacia",
  DK: "Dinamarca", SE: "Suecia", NO: "Noruega", FI: "Finlandia", IS: "Islandia", MT: "Malta", LU: "Luxemburgo",
  SI: "Eslovenia", SK: "Eslovaquia", EE: "Estonia", LV: "Letonia", LT: "Lituania", LI: "Liechtenstein", BG: "Bulgaria", RO: "Rumania",
  IE: "Irlanda", AR: "Argentina", BR: "Brasil", CO: "Colombia", CL: "Chile", PE: "Perú", CR: "Costa Rica", CU: "Cuba",
  DO: "República Dominicana", GT: "Guatemala", PA: "Panamá", CN: "China", KR: "Corea del Sur", IN: "India", AU: "Australia",
  NZ: "Nueva Zelanda", AE: "Emiratos Árabes Unidos", TR: "Turquía", EG: "Egipto", MA: "Marruecos", ZA: "Sudáfrica",
  TH: "Tailandia", SG: "Singapur", IL: "Israel",
};

// Nombres de país y destinos frecuentes → ISO 3166-1 alfa-2. Sin coincidencia = país desconocido.
const ALIASES: Record<string, readonly string[]> = {
  MX: ["mexico", "cdmx", "ciudad de mexico", "cancun", "tulum", "playa del carmen", "riviera maya", "los cabos", "cabo san lucas", "puerto vallarta",
    "oaxaca", "puebla", "guadalajara", "monterrey", "merida", "san miguel de allende", "queretaro", "acapulco", "huatulco", "mazatlan", "chiapas",
    "valle de guadalupe", "holbox", "bacalar", "zihuatanejo", "ixtapa", "guanajuato", "morelia", "veracruz", "nayarit", "sayulita", "punta mita"],
  US: ["estados unidos", "estados unidos de america", "eua", "ee uu", "eeuu", "usa", "united states", "nueva york", "new york", "miami", "orlando",
    "los angeles", "las vegas", "san francisco", "chicago", "houston", "dallas", "san antonio", "austin", "boston", "washington", "seattle",
    "san diego", "hawai", "hawaii", "honolulu", "maui", "phoenix", "atlanta", "nashville", "nueva orleans", "new orleans", "filadelfia", "aspen", "vail", "napa"],
  CA: ["canada", "toronto", "vancouver", "montreal", "quebec", "calgary", "banff", "ottawa", "whistler"],
  GB: ["reino unido", "inglaterra", "united kingdom", "gran bretana", "escocia", "gales", "londres", "london", "edimburgo", "manchester", "liverpool"],
  JP: ["japon", "japan", "tokio", "tokyo", "kioto", "kyoto", "osaka", "hokkaido", "okinawa"],
  ES: ["espana", "spain", "madrid", "barcelona", "sevilla", "valencia", "ibiza", "mallorca", "bilbao", "malaga", "granada", "san sebastian", "marbella"],
  FR: ["francia", "france", "paris", "niza", "nice", "lyon", "marsella", "burdeos", "provenza", "cannes", "saint tropez"],
  IT: ["italia", "italy", "roma", "rome", "milan", "florencia", "venecia", "napoles", "toscana", "amalfi", "capri", "sicilia", "cerdena", "lago de como", "positano"],
  DE: ["alemania", "germany", "berlin", "munich", "frankfurt", "hamburgo"],
  PT: ["portugal", "lisboa", "oporto", "algarve", "madeira", "azores"],
  GR: ["grecia", "greece", "atenas", "santorini", "mykonos", "creta"],
  NL: ["paises bajos", "holanda", "amsterdam"],
  BE: ["belgica", "bruselas", "brujas"],
  CH: ["suiza", "zurich", "ginebra", "zermatt", "st moritz"],
  AT: ["austria", "viena", "salzburgo"],
  CZ: ["republica checa", "chequia", "praga"],
  HU: ["hungria", "budapest"],
  PL: ["polonia", "cracovia", "varsovia"],
  HR: ["croacia", "dubrovnik", "split", "zagreb"],
  DK: ["dinamarca", "copenhague"],
  SE: ["suecia", "estocolmo"],
  NO: ["noruega", "oslo"],
  FI: ["finlandia", "helsinki", "laponia"],
  IS: ["islandia", "reikiavik", "reykjavik"],
  MT: ["malta"], LU: ["luxemburgo"], SI: ["eslovenia", "liubliana"], SK: ["eslovaquia"], EE: ["estonia"], LV: ["letonia"], LT: ["lituania"],
  LI: ["liechtenstein"], BG: ["bulgaria"], RO: ["rumania"],
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ALIAS_LIST: Array<[string, string]> = Object.entries(ALIASES)
  .flatMap(([code, names]) => names.map((n) => [norm(n), code] as [string, string]))
  .sort((a, b) => b[0].length - a[0].length);

/** País (ISO2) de un texto libre como "Roma, Italia" o "Nueva York". null si no lo reconocemos. */
export function countryFromText(text: string | null | undefined): string | null {
  const t = norm(text ?? "");
  if (!t) return null;
  if (/^[a-z]{2}$/.test(t) && COUNTRY_NAME[t.toUpperCase()]) return t.toUpperCase();
  const padded = ` ${t} `;
  for (const [alias, code] of ALIAS_LIST) if (padded.includes(` ${alias} `)) return code;
  return null;
}

export function countryOfTrip(trip: Pick<TripLite, "destino" | "pais_destino">): string | null {
  return countryFromText(trip.pais_destino) ?? countryFromText(trip.destino);
}

export type ExpiryState = "vencido" | "pronto" | "vigente" | "sin_fecha";

/** Estado de vigencia: "pronto" = vence en 90 días o menos. */
export function expiryStatus(expires: string | null | undefined, today = localISODate()): { state: ExpiryState; days: number | null } {
  if (!expires || !parseLocalDate(expires)) return { state: "sin_fecha", days: null };
  const days = diffLocalDays(today, expires);
  if (days < 0) return { state: "vencido", days };
  if (days <= 90) return { state: "pronto", days };
  return { state: "vigente", days };
}

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
};

export const fmtDate = (iso: string) => formatLocalDate(iso, { day: "numeric", month: "short", year: "numeric" });
const fmt = fmtDate;

const tripEnd = (t: TripLite) => t.fecha_regreso || t.fecha_salida;

/** Viajes por venir (o en curso) con fechas, ordenados por salida. */
export function upcomingTrips(trips: TripLite[], today = localISODate()): TripLite[] {
  return trips
    .filter((t) => !!t.fecha_salida && (tripEnd(t) ?? "") >= today && !/cancel/i.test(t.status ?? ""))
    .sort((a, b) => (a.fecha_salida ?? "").localeCompare(b.fecha_salida ?? ""));
}

const validThrough = (item: VaultItem, date: string) => !item.expires_on || item.expires_on >= date;

const LEVEL_ORDER: Record<AlertLevel, number> = { critica: 0, aviso: 1, info: 2 };

export function buildAlerts(items: VaultItem[], trips: TripLite[], today = localISODate()): VaultAlert[] {
  const alerts: VaultAlert[] = [];
  const passports = items.filter((i) => i.kind === "pasaporte").sort((a, b) => (b.expires_on ?? "9999").localeCompare(a.expires_on ?? "9999"));
  const passport = passports[0] ?? null;
  const nationality = passport?.country_code ?? null;

  for (const trip of upcomingTrips(trips, today).slice(0, 6)) {
    const country = countryOfTrip(trip);
    const start = trip.fecha_salida as string;
    const end = tripEnd(trip) as string;
    const domestic = country === "MX" && (nationality === "MX" || nationality === null);
    if (domestic) continue;
    const where = trip.destino;

    // Pasaporte
    if (!passport) {
      alerts.push({ id: `pp-none-${trip.id}`, level: "aviso", tripId: trip.id, title: `Agrega tu pasaporte para ${where}`,
        detail: "Así revisamos su vigencia contra las fechas de tu viaje." });
    } else if (passport.expires_on && passport.expires_on < end) {
      alerts.push({ id: `pp-exp-${trip.id}`, level: "critica", tripId: trip.id, itemId: passport.id,
        title: `Tu pasaporte vence antes de tu viaje a ${where}`,
        detail: `Vence el ${fmt(passport.expires_on)} y regresas el ${fmt(end)}. Renuévalo antes de viajar.`,
        sourceUrl: "https://www.gob.mx/sre", sourceLabel: "SRE" });
    } else if (passport.expires_on && passport.expires_on < addMonths(end, 6)) {
      alerts.push({ id: `pp-6m-${trip.id}`, level: "aviso", tripId: trip.id, itemId: passport.id,
        title: `Pasaporte con menos de 6 meses de vigencia para ${where}`,
        detail: `Vence el ${fmt(passport.expires_on)}. Muchos países piden 6 meses de vigencia al entrar: confirma el requisito de tu destino.`,
        sourceUrl: SRE_GUIDE.url, sourceLabel: SRE_GUIDE.label });
    }

    // Visas guardadas para ese destino que vencen antes del viaje (cualquier nacionalidad).
    const visaKey = country && SCHENGEN.has(country) ? ["EU", country] : country ? [country] : [];
    const destVisas = items.filter((i) => (i.kind === "visa" || i.kind === "autorizacion") && i.country_code && visaKey.includes(i.country_code));
    for (const v of destVisas) {
      if (v.expires_on && v.expires_on < end) {
        alerts.push({ id: `visa-exp-${v.id}-${trip.id}`, level: "critica", tripId: trip.id, itemId: v.id,
          title: `${v.title} vence antes de tu viaje a ${where}`,
          detail: `Vence el ${fmt(v.expires_on)} y regresas el ${fmt(end)}.` });
      }
    }

    // Requisitos de entrada (solo reglas con fuente, pasaporte mexicano).
    const ruleKey = country && SCHENGEN.has(country) ? "SCHENGEN" : country;
    const rule = nationality === "MX" && ruleKey ? ENTRY_RULES_MX[ruleKey] : undefined;
    if (rule) {
      const covered = (kinds: string[]) => destVisas.some((v) => kinds.includes(v.kind) && validThrough(v, end));
      const ok = rule.needs === null ? false
        : rule.needs === "visa" ? covered(["visa"])
        : covered(["visa", "autorizacion"]);
      if (!ok) {
        alerts.push({ id: `entry-${trip.id}`, level: rule.level, tripId: trip.id, title: `${rule.title} · ${where}`,
          detail: rule.detail, sourceUrl: rule.sourceUrl, sourceLabel: rule.sourceLabel });
      }
    } else {
      alerts.push({ id: `entry-${trip.id}`, level: "info", tripId: trip.id, title: `Verifica requisitos de entrada · ${where}`,
        detail: nationality && nationality !== "MX"
          ? "Los requisitos dependen de tu nacionalidad y de tu destino; revísalos en el sitio oficial."
          : "No tenemos una regla revisada para este destino; consulta visa, vacunas y vigencia del pasaporte en la fuente oficial.",
        sourceUrl: SRE_GUIDE.url, sourceLabel: SRE_GUIDE.label });
    }

    // Seguro de viaje que no cubre todo el viaje.
    const insurances = items.filter((i) => i.kind === "seguro_viaje" || i.kind === "asistencia");
    if (insurances.length && !insurances.some((i) => validThrough(i, end) && (!i.valid_from || i.valid_from <= start))) {
      alerts.push({ id: `ins-${trip.id}`, level: "aviso", tripId: trip.id, title: `Tu seguro de viaje no cubre todo tu viaje a ${where}`,
        detail: "Revisa las fechas de tu póliza o agrega la de este viaje." });
    }
  }

  // Vigencias generales.
  for (const item of items) {
    if (item.section === "tarjeta") continue;
    const { state, days } = expiryStatus(item.expires_on, today);
    if (state === "vencido") {
      alerts.push({ id: `exp-${item.id}`, level: item.kind === "pasaporte" ? "critica" : "aviso", itemId: item.id,
        title: `${item.title} venció`, detail: `Venció el ${fmt(item.expires_on as string)}.` });
    } else if (state === "pronto" && days !== null && days <= 60) {
      alerts.push({ id: `exp-${item.id}`, level: "info", itemId: item.id,
        title: `${item.title} vence ${days === 0 ? "hoy" : `en ${days} día${days === 1 ? "" : "s"}`}`,
        detail: `Vence el ${fmt(item.expires_on as string)}.` });
    }
  }

  const seen = new Set<string>();
  return alerts.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)))
    .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
