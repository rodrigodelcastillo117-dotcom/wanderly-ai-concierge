// Mesa de operaciones: vocabulario común (tipos de solicitud y etapas) para el correo al dueño, el
// correo al usuario y las pantallas (/admin/operaciones y "Mis solicitudes"). Puro, sin Deno ni React.
import { oneLine } from "./email-format.ts";

export const OPS_TYPE_LABEL: Record<string, string> = {
  prive_request: "Reserva Privé",
  members_nightlife_reservation: "Reserva Members Only",
  reservation: "Reserva de mesa",
  pickup: "Recolección de equipaje",
  transport: "Transporte",
  jet: "Jet privado",
  alert: "Alerta del concierge",
  fixer: "Solicitud al Fixer",
  fixer_request: "Solicitud al equipo",
  // Botón "Hablar con una persona" (fixer_escalations → espejo en concierge_requests, auditoría 10 #11).
  human_help: "Hablar con una persona",
  rebooking: "Cambio de vuelo",
  booking_assist: "Ayuda para reservar",
  ai_reservation: "Reserva IA",
  // "¿Algo no se entiende? Cuéntanos" (función enviar-opinion, migración 20261029060000_opiniones).
  opinion: "Opinión",
};

export const opsTypeLabel = (type: string) =>
  OPS_TYPE_LABEL[type] ?? (oneLine(String(type ?? "").replace(/_/g, " "), 40).replace(/^./, (c) => c.toUpperCase()) || "Solicitud");

/** Folio corto: las primeras 8 letras/números del id, en mayúsculas (igual que el folio de la app). */
export const folioOf = (id: string | null | undefined) => String(id ?? "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase() || "—";

export type OpsStage = "nueva" | "en_proceso" | "resuelta" | "no_se_pudo" | "cancelada" | "vencida";
export const OPS_STAGES: OpsStage[] = ["nueva", "en_proceso", "resuelta", "no_se_pudo", "cancelada", "vencida"];

/** Etiqueta de la etapa para el equipo. */
export const OPS_STAGE_LABEL: Record<OpsStage, string> = {
  nueva: "Nueva",
  en_proceso: "En proceso",
  resuelta: "Resuelta",
  no_se_pudo: "No se pudo",
  cancelada: "Cancelada",
  vencida: "Vencida",
};

/**
 * Lo que ve el usuario de su solicitud. Honesto: solo una Privé confirmada por el proveedor o una
 * reserva IA confirmada con evidencia se dicen "confirmadas"; lo demás que resolvió el equipo dice
 * "resuelta por el equipo" (con su comprobante, si lo dejó).
 */
export function userStageText(stage: string | null | undefined, type?: string | null): string {
  // Una opinión no la "atiende" nadie como un pedido: la lee el equipo y, si hace falta, la resuelve.
  if (type === "opinion") {
    switch (stage) {
      case "en_proceso": return "Leída por el equipo IATOS";
      case "resuelta": return "Resuelta por el equipo IATOS";
      case "no_se_pudo": case "cancelada": case "vencida": return "Cerrada por el equipo IATOS";
      default: return "Recibida · la leerá el equipo IATOS";
    }
  }
  switch (stage) {
    case "nueva": return "Recibida · la atenderá una persona del equipo IATOS";
    case "en_proceso": return "En proceso · una persona del equipo IATOS la está atendiendo";
    case "resuelta":
      if (type === "prive_request") return "Confirmado por el proveedor";
      if (type === "ai_reservation") return "Confirmada por el equipo IATOS";
      return "Resuelta por el equipo IATOS";
    case "no_se_pudo": return "No se pudo completar";
    case "cancelada": return "Cancelada";
    case "vencida": return "Venció sin respuesta";
    default: return "Recibida · la atenderá una persona del equipo IATOS";
  }
}

/** Tipos que, mientras sigan abiertos, todavía NO son una reserva (se dice en pantalla). */
export const isBookingLike = (type: string | null | undefined) =>
  ["reservation", "prive_request", "members_nightlife_reservation", "ai_reservation", "booking_assist", "transport", "jet", "pickup"].includes(String(type ?? ""));
