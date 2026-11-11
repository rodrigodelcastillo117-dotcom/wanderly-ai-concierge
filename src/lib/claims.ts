// Mis reclamos (aerolíneas, hoteles, traslados): lo que Iato preparó con el usuario (función `reclamos`).
// Nada se envía sin el «sí» explícito del usuario, y solo si el envío por correo está encendido en el
// servidor (app_flags.reclamos_enabled → `envio_activo`). Apagado: la carta está lista para copiarla
// y pegarla en el formulario oficial del proveedor.
import { supabase } from "@/integrations/supabase/client";

export type ClaimStatus =
  | "esperando_ok" | "enviando" | "enviado" | "recordado" | "respondido" | "necesita_usuario"
  | "escalable" | "escalado" | "resuelto" | "cerrado" | "cancelado" | "fallido";

export type Claim = {
  id: string;
  ref_code: string;
  kind: "vuelo" | "hotel" | "traslado" | "agencia" | "tour" | "otro";
  target: "proveedor" | "organismo";
  status: ClaimStatus;
  provider_name: string;
  channel: "correo" | "formulario" | "telefono" | "sitio";
  recipient_email: string | null;
  form_url: string | null;
  subject: string;
  body_text: string;
  sent_at: string | null;
  created_at: string;
  reply?: { resumen_es?: string | null } | null;
};

export type ClaimsResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; code: string; message?: string };

const NETWORK = { ok: false as const, code: "NETWORK", message: "No pudimos conectar. Inténtalo de nuevo." };

async function call<T>(body: Record<string, unknown>): Promise<ClaimsResult<T>> {
  let data: unknown, error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke("reclamos", { body }));
  } catch {
    return NETWORK;
  }
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const parsed = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    return (parsed as ClaimsResult<T>) ?? NETWORK;
  }
  return data as ClaimsResult<T>;
}

export const myClaims = () => call<{ reclamos: Claim[]; envio_activo?: boolean }>({ action: "estado" });
export const sendClaim = (id: string, ccMe: boolean) =>
  call<{ claim: Claim }>({ action: "confirmar_envio", id, confirm: true, cc_me: ccMe, confirm_text: "Autorizo a IATOS a enviar esta reclamación en mi nombre (botón «Enviar en mi nombre»)" });
export const markClaimSentByMe = (id: string) => call<{ claim: Claim }>({ action: "ya_lo_envie", id });
export const markClaimResolved = (id: string) => call<{ claim: Claim }>({ action: "resuelto", id });
export const cancelClaim = (id: string) => call<{ claim: Claim }>({ action: "cancelar", id });

/** Estado en palabras del viajero. */
export function claimStatusText(s: ClaimStatus): string {
  switch (s) {
    case "esperando_ok": return "Carta lista · falta enviarla";
    case "enviando": return "Enviando…";
    case "enviado": return "Enviada · esperando respuesta";
    case "recordado": return "Enviada · ya les recordamos";
    case "respondido": return "Ya respondieron";
    case "necesita_usuario": return "Necesitamos un dato tuyo";
    case "escalable": return "Sin respuesta: se puede escalar";
    case "escalado": return "Escalada a la autoridad";
    case "resuelto": return "Resuelta";
    case "cerrado": return "Cerrada";
    case "cancelado": return "Cancelada";
    case "fallido": return "No se pudo enviar";
  }
}

export function claimKindText(k: Claim["kind"], target: Claim["target"]): string {
  if (target === "organismo") return "Queja ante la autoridad";
  return k === "vuelo" ? "Reclamo a aerolínea" : k === "hotel" ? "Reclamo a hotel" : k === "traslado" ? "Reclamo de traslado"
    : k === "agencia" ? "Reclamo a agencia" : k === "tour" ? "Reclamo de tour" : "Reclamo";
}

/** ¿Se puede mandar por correo desde IATOS? Solo con correo verificado, carta sin enviar y el envío encendido. */
export const canSendFromApp = (c: Claim, envioActivo: boolean) =>
  envioActivo && c.status === "esperando_ok" && c.channel === "correo" && !!c.recipient_email;

export const OPEN_CLAIM = new Set<ClaimStatus>(["esperando_ok", "enviando", "enviado", "recordado", "respondido", "necesita_usuario", "escalable", "escalado"]);

/** Texto para pedirle a Iato un reclamo nuevo desde el chat. */
export const NEW_CLAIM_PROMPT = "Quiero reclamar a una aerolínea: revisa mis derechos y prepárame la carta.";
