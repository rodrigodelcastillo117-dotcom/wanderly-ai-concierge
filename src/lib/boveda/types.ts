// Bóveda: tipos y etiquetas. La fuente de verdad son las tablas vault_items / vault_files y el
// bucket privado travel-vault (migración 20261023190000_boveda.sql). Los CHECK del servidor mandan;
// aquí se repiten para avisar antes de guardar.

export const VAULT_BUCKET = "travel-vault" as const;

export const VAULT_SECTIONS = ["documento", "membresia", "tarjeta", "seguro"] as const;
export type VaultSection = (typeof VAULT_SECTIONS)[number];

export const SECTION_LABEL: Record<VaultSection, string> = {
  documento: "Documentos",
  membresia: "Membresías",
  tarjeta: "Tarjetas",
  seguro: "Seguros",
};

export const KINDS_BY_SECTION = {
  documento: ["pasaporte", "visa", "autorizacion", "ine", "licencia", "vacuna", "otro_documento"],
  membresia: ["aerolinea", "hotel", "auto", "crucero", "sala", "viajero_confiable", "otra_membresia"],
  tarjeta: ["tarjeta"],
  seguro: ["seguro_viaje", "seguro_medico", "asistencia", "otro_seguro"],
} as const satisfies Record<VaultSection, readonly string[]>;

export type VaultKind = (typeof KINDS_BY_SECTION)[VaultSection][number];

export const KIND_LABEL: Record<VaultKind, string> = {
  pasaporte: "Pasaporte",
  visa: "Visa",
  autorizacion: "Autorización electrónica (eTA, ETA, ESTA)",
  ine: "INE",
  licencia: "Licencia de manejo",
  vacuna: "Certificado de vacunación",
  otro_documento: "Otro documento",
  aerolinea: "Aerolínea",
  hotel: "Hotel",
  auto: "Renta de autos",
  crucero: "Crucero",
  sala: "Salas VIP",
  viajero_confiable: "Viajero confiable",
  otra_membresia: "Otra membresía",
  tarjeta: "Tarjeta",
  seguro_viaje: "Seguro de viaje",
  seguro_medico: "Seguro médico",
  asistencia: "Asistencia en viaje",
  otro_seguro: "Otro seguro",
};

export function sectionOfKind(kind: VaultKind): VaultSection {
  for (const s of VAULT_SECTIONS) if ((KINDS_BY_SECTION[s] as readonly string[]).includes(kind)) return s;
  return "documento";
}

/** Documentos de identidad: número enmascarado y foto oculta hasta que la persona toque "mostrar". */
export const IDENTITY_KINDS: readonly VaultKind[] = ["pasaporte", "visa", "autorizacion", "ine", "licencia"];

export type VisaEntries = "una" | "doble" | "multiple";
export const ENTRIES_LABEL: Record<VisaEntries, string> = { una: "Una entrada", doble: "Dos entradas", multiple: "Múltiples entradas" };

export type VaultItem = {
  id: string;
  user_id: string;
  section: VaultSection;
  kind: VaultKind;
  program_id: string | null;
  tier_id: string | null;
  title: string;
  issuer: string | null;
  tier: string | null;
  number: string | null;
  holder_name: string | null;
  country_code: string | null;
  visa_type: string | null;
  entries: VisaEntries | null;
  valid_from: string | null;
  expires_on: string | null;
  contact_phone: string | null;
  benefits: string[];
  benefits_unverified: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type VaultItemInput = Omit<VaultItem, "id" | "user_id" | "created_at" | "updated_at">;

export type VaultFileSide = "frente" | "reverso" | "pagina" | "pdf";
export const SIDE_LABEL: Record<VaultFileSide, string> = { frente: "Frente", reverso: "Reverso", pagina: "Página", pdf: "PDF" };

export type VaultFile = {
  id: string;
  user_id: string;
  item_id: string;
  side: VaultFileSide;
  storage_path: string;
  mime: "image/jpeg" | "application/pdf";
  size: number;
  created_at: string;
};

/** Límites del servidor (CHECK de vault_items). */
export const LIMITS = {
  title: 120, issuer: 120, tier: 60, number: 64, holder: 120, visaType: 60, notes: 1000,
  benefits: 40, benefitLength: 200, filesPerItem: 6,
} as const;

const NUMBER_RE = /^[A-Za-z0-9 ./-]{1,64}$/;
const CARD_LAST4_RE = /^[0-9]{4}$/;
const PHONE_RE = /^[0-9+() -]{3,30}$/;

/** Normaliza y valida lo que se va a guardar. Devuelve el primer problema (para el usuario) o null. */
export function validateItem(input: VaultItemInput): string | null {
  if (!input.title?.trim()) return "Ponle un nombre (por ejemplo, «Pasaporte» o «Marriott Bonvoy»).";
  if (input.title.trim().length > LIMITS.title) return "El nombre es muy largo.";
  if (sectionOfKind(input.kind) !== input.section) return "Ese tipo no corresponde a la sección.";
  if (input.number) {
    if (input.section === "tarjeta" && !CARD_LAST4_RE.test(input.number)) {
      return "De tus tarjetas solo guardamos los últimos 4 dígitos.";
    }
    if (!NUMBER_RE.test(input.number)) return "El número solo puede llevar letras, números, espacios, puntos, guiones o diagonales.";
  }
  if (input.section === "tarjeta" && (input.expires_on || input.valid_from)) {
    return "No guardamos la fecha de vencimiento de tus tarjetas.";
  }
  if (input.valid_from && input.expires_on && input.valid_from > input.expires_on) {
    return "La fecha de inicio es posterior al vencimiento.";
  }
  if (input.contact_phone && !PHONE_RE.test(input.contact_phone)) return "Revisa el teléfono: solo números, espacios, +, guiones y paréntesis.";
  if (input.benefits.length > LIMITS.benefits) return `Máximo ${LIMITS.benefits} beneficios por programa.`;
  if (input.benefits.some((b) => b.length > LIMITS.benefitLength)) return `Cada beneficio puede tener hasta ${LIMITS.benefitLength} caracteres.`;
  if ((input.notes ?? "").length > LIMITS.notes) return "Las notas son muy largas.";
  return null;
}

/** Texto libre (un beneficio por línea) → lista limpia. */
export function parseBenefitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.replace(/^[\s•*-]+/, "").trim()).filter(Boolean)
    .map((l) => l.slice(0, LIMITS.benefitLength)).slice(0, LIMITS.benefits);
}
