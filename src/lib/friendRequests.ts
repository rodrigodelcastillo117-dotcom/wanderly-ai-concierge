// Solicitudes de amistad (T-P2-1). La amistad ya no se crea con solo conocer el código: el código o
// el enlace /?ref= mandan una SOLICITUD y la otra persona la acepta o la rechaza. Todo pasa por
// funciones del servidor (migración 20261026110000_r2_privacidad_social_consent.sql).

export type FriendRequestIn = { id: string; full_name: string | null; username: string | null; avatar_url: string | null; created_at: string };
export type FriendRequestOut = { id: string; created_at: string };
export type BlockedUser = { id: string; nombre: string };
export type FriendRequests = { recibidas: FriendRequestIn[]; enviadas: FriendRequestOut[]; bloqueados: BlockedUser[] };

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
type Result = { ok?: boolean; error?: string; estado?: string; codigo?: string; amigo_id?: string } | null;

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function parseFriendRequests(data: unknown): FriendRequests {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    recibidas: arr<FriendRequestIn>(d.recibidas).filter((r) => typeof r?.id === "string"),
    enviadas: arr<FriendRequestOut>(d.enviadas).filter((r) => typeof r?.id === "string"),
    bloqueados: arr<BlockedUser>(d.bloqueados).filter((r) => typeof r?.id === "string"),
  };
}

/** Mensaje para la persona según lo que respondió agregar_amigo_por_codigo. */
export function connectMessage(r: Result): { ok: boolean; text: string } {
  if (r?.ok && r.estado === "amigos") return { ok: true, text: "¡Ya son amigos!" };
  if (r?.ok) return { ok: true, text: "Solicitud enviada. Cuando la acepte, aparecerá en tus amigos." };
  const msgs: Record<string, string> = {
    codigo_invalido: "Código inválido",
    es_tu_propio_codigo: "Ese es tu propio código",
    no_autenticado: "Inicia sesión primero",
    lo_bloqueaste: "Bloqueaste a esta persona. Desbloquéala en Social para mandarle una solicitud.",
    demasiados_intentos: "Demasiados intentos. Espera un rato y vuelve a probar.",
  };
  return { ok: false, text: msgs[r?.error ?? ""] ?? "No se pudo conectar" };
}

async function call(client: RpcClient, fn: string, args?: Record<string, unknown>): Promise<Result> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, error: "error" };
  return (data as Result) ?? { ok: false, error: "error" };
}

export const sendFriendRequest = (c: RpcClient, codigo: string) => call(c, "agregar_amigo_por_codigo", { p_codigo: codigo });
export const respondFriendRequest = (c: RpcClient, otro: string, aceptar: boolean) =>
  call(c, "responder_solicitud_amistad", { p_otro: otro, p_aceptar: aceptar });
export const cancelFriendRequest = (c: RpcClient, otro: string) => call(c, "cancelar_solicitud_amistad", { p_otro: otro });
export const removeFriend = (c: RpcClient, otro: string, bloquear = false) => call(c, "quitar_amigo", { p_otro: otro, p_bloquear: bloquear });
export const blockUser = (c: RpcClient, otro: string) => call(c, "bloquear_usuario", { p_otro: otro });
export const unblockUser = (c: RpcClient, otro: string) => call(c, "desbloquear_usuario", { p_otro: otro });
export const rotateInviteCode = (c: RpcClient) => call(c, "regenerar_codigo_invitacion");

export async function loadFriendRequests(c: RpcClient): Promise<FriendRequests> {
  const { data, error } = await c.rpc("solicitudes_amistad");
  return parseFriendRequests(error ? null : data);
}
