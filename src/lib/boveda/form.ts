// Formulario de la Bóveda ↔ fila de vault_items. Puro para poder probarlo.
import { COUNTRY_NAME } from "./alerts";
import { getProgram } from "./catalog";
import { KIND_LABEL, parseBenefitLines, sectionOfKind, type VaultItem, type VaultItemInput, type VaultKind, type VisaEntries } from "./types";

export type VaultForm = {
  program_id: string; tier_id: string; title: string; issuer: string; tier: string; number: string; holder_name: string;
  country_code: string; visa_type: string; entries: "" | VisaEntries; valid_from: string; expires_on: string;
  contact_phone: string; benefitsText: string; notes: string;
};

export const EMPTY_FORM: VaultForm = {
  program_id: "", tier_id: "", title: "", issuer: "", tier: "", number: "", holder_name: "", country_code: "",
  visa_type: "", entries: "", valid_from: "", expires_on: "", contact_phone: "", benefitsText: "", notes: "",
};

export function initialForm(kind: VaultKind): VaultForm {
  if (kind === "pasaporte") return { ...EMPTY_FORM, country_code: "MX" };
  if (kind === "visa") return { ...EMPTY_FORM, country_code: "US" };
  if (kind === "autorizacion") return { ...EMPTY_FORM, country_code: "CA" };
  return { ...EMPTY_FORM };
}

export function itemToForm(item: VaultItem): VaultForm {
  return {
    program_id: item.program_id ?? "", tier_id: item.tier_id ?? "", title: item.title, issuer: item.issuer ?? "", tier: item.tier ?? "",
    number: item.number ?? "", holder_name: item.holder_name ?? "", country_code: item.country_code ?? "", visa_type: item.visa_type ?? "",
    entries: item.entries ?? "", valid_from: item.valid_from ?? "", expires_on: item.expires_on ?? "", contact_phone: item.contact_phone ?? "",
    benefitsText: (item.benefits ?? []).join("\n"), notes: item.notes ?? "",
  };
}

const AUTH_NAME: Record<string, string> = { CA: "eTA Canadá", GB: "ETA Reino Unido", US: "ESTA EUA", EU: "ETIAS" };

export function defaultTitle(kind: VaultKind, f: Pick<VaultForm, "program_id" | "country_code">): string {
  const country = f.country_code ? COUNTRY_NAME[f.country_code] ?? f.country_code : "";
  if (kind === "pasaporte") return country === "México" ? "Pasaporte mexicano" : country ? `Pasaporte ${country}` : "Pasaporte";
  if (kind === "visa") return country ? `Visa ${country}` : "Visa";
  if (kind === "autorizacion") return AUTH_NAME[f.country_code] ?? (country ? `Autorización ${country}` : "Autorización electrónica");
  const program = getProgram(f.program_id);
  if (program) return program.name;
  return KIND_LABEL[kind];
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
const orNull = (s: string) => (clean(s) ? clean(s) : null);

export function formToInput(kind: VaultKind, f: VaultForm): VaultItemInput {
  const section = sectionOfKind(kind);
  const isCard = section === "tarjeta";
  const number = f.number.replace(/\s+/g, " ").trim();
  return {
    section, kind,
    program_id: f.program_id && getProgram(f.program_id) ? f.program_id : null,
    tier_id: f.tier_id && f.program_id ? f.tier_id : null,
    title: (clean(f.title) || defaultTitle(kind, f)).slice(0, 120),
    issuer: orNull(f.issuer),
    tier: orNull(f.tier),
    number: number ? (isCard ? number.replace(/\D/g, "").slice(-4) || number : number.toUpperCase()) : null,
    holder_name: orNull(f.holder_name),
    country_code: /^[A-Z]{2}$/.test(f.country_code) ? f.country_code : null,
    visa_type: orNull(f.visa_type),
    entries: f.entries || null,
    valid_from: isCard ? null : f.valid_from || null,
    expires_on: isCard ? null : f.expires_on || null,
    contact_phone: orNull(f.contact_phone),
    benefits: parseBenefitLines(f.benefitsText),
    benefits_unverified: false,
    notes: f.notes.trim() ? f.notes.trim().slice(0, 1000) : null,
  };
}
