// Perfiles de amigos (F-10 / IATOS-053). Los amigos ya no pueden leer la fila completa de
// profiles (correo, fecha de nacimiento, lealtad, food_dna, viaje activo): la RPC friend_profiles
// devuelve SOLO id, nombre, usuario y avatar de amistades aceptadas del usuario en sesión.

export type FriendProfile = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

// Interfaz mínima del cliente de Supabase (facilita las pruebas).
type RpcClient = {
  rpc: (fn: "friend_profiles", args: { p_ids?: string[] }) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Amigos aceptados (todos, o solo los ids indicados). Ante error devuelve []. */
export async function fetchFriendProfiles(client: RpcClient, ids?: string[]): Promise<FriendProfile[]> {
  if (ids && ids.length === 0) return [];
  const { data, error } = await client.rpc("friend_profiles", ids ? { p_ids: ids } : {});
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string")
    .map((r) => ({
      id: r.id as string,
      full_name: typeof r.full_name === "string" ? r.full_name : null,
      username: typeof r.username === "string" ? r.username : null,
      avatar_url: typeof r.avatar_url === "string" ? r.avatar_url : null,
    }));
}
