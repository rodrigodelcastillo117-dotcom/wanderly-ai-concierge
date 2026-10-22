// "Iato, resúmeme mis beneficios para este viaje": arma lo que se manda a la IA (función ai-tool).
// Solo viaja: nombre del programa, nivel y beneficios (curados o escritos por la persona) de
// Membresías, Tarjetas y Seguros, más destino y fechas del viaje. NUNCA documentos (pasaporte, visas,
// INE…), números de socio/póliza/tarjeta, titulares, teléfonos, notas ni fotos.
import { curatedBenefits } from "./catalog";
import type { TripLite } from "./alerts";
import type { VaultItem } from "./types";
import { KIND_LABEL } from "./types";

const SHARED_SECTIONS = new Set(["membresia", "tarjeta", "seguro"]);

/** Quita cualquier cosa con pinta de número de cuenta (6+ caracteres alfanuméricos con dígitos). */
export function redactIdentifiers(text: string): string {
  return text.replace(/\b(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{6,}\b/g, "[omitido]");
}

export type SummaryLine = { kind: string; program: string; tier: string | null; benefits: string[]; verified: boolean };

export function summaryLines(items: VaultItem[]): SummaryLine[] {
  return items.filter((i) => SHARED_SECTIONS.has(i.section)).map((i) => {
    const curated = curatedBenefits(i.program_id, i.tier_id);
    const benefits = [...(curated?.benefits ?? []), ...i.benefits].map((b) => redactIdentifiers(b).slice(0, 200));
    return {
      kind: KIND_LABEL[i.kind],
      program: redactIdentifiers(i.title).slice(0, 120),
      tier: i.tier ? redactIdentifiers(i.tier).slice(0, 60) : null,
      benefits: Array.from(new Set(benefits)).slice(0, 20),
      verified: !!curated,
    };
  });
}

export const SUMMARY_SYSTEM = `Eres Iato, concierge de viajes de IATOS. Respondes en español de México, en tono cálido y preciso.
Te damos la lista de membresías, tarjetas y seguros de la persona con SUS beneficios y un viaje.
Reglas estrictas:
- Usa SOLO los beneficios listados. No agregues beneficios, montos ni condiciones que no estén en la lista.
- Si un programa no trae beneficios, di que no hay beneficios registrados y sugiere consultar la fuente oficial.
- Si algo depende de disponibilidad, del país o del banco, dilo.
- Formato: máximo 8 viñetas cortas agrupadas por momento del viaje (aeropuerto, vuelo, hotel, auto, seguro), y una línea final "Confirma condiciones con cada programa antes de viajar".`;

export function buildSummaryPrompt(items: VaultItem[], trip: TripLite | null): { system: string; prompt: string; lines: SummaryLine[] } {
  const lines = summaryLines(items);
  const tripText = trip
    ? `Viaje: ${redactIdentifiers(trip.destino).slice(0, 120)}${trip.fecha_salida ? `, del ${trip.fecha_salida}` : ""}${trip.fecha_regreso ? ` al ${trip.fecha_regreso}` : ""}.`
    : "Sin viaje seleccionado: resume los beneficios más útiles para viajar en general.";
  const body = lines.map((l) => {
    const head = `- ${l.kind}: ${l.program}${l.tier ? ` (${l.tier})` : ""}`;
    return l.benefits.length ? `${head}\n${l.benefits.map((b) => `  · ${b}`).join("\n")}` : `${head}\n  · (sin beneficios registrados)`;
  }).join("\n");
  return { system: SUMMARY_SYSTEM, prompt: `${tripText}\n\nProgramas y beneficios:\n${body || "- (ninguno)"}`, lines };
}
