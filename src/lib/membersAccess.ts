// Members Only = exclusivo de IATOS PRO (ronda sec2-b). El servidor decide el acceso
// (members_access_state: is_pro, o contraseña temporal vigente) y la RLS de nightlife_premium solo
// devuelve lugares a quien tiene derecho. Sin derecho, la pantalla muestra un adelanto
// (members_teaser): ciudades, categorías y conteos, sin nombres, direcciones ni sitios.

export type MembersAccess = {
  access: boolean;
  via: "plan" | "password" | null;
  accessExpiresAt: string | null;
  passwordGate: boolean;
};

export type TeaserRow = { ciudad: string; ciudad_display: string | null; pais: string | null; categoria: string; venues: number };

export type TeaserSummary = {
  cities: Array<{ ciudad: string; display: string; pais: string | null; total: number }>;
  categories: Record<string, number>;
  total: number;
};

type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export const NO_ACCESS: MembersAccess = { access: false, via: null, accessExpiresAt: null, passwordGate: false };

/** Estado de acceso del usuario en sesión. Ante error: sin acceso (el servidor igual lo bloquea). */
export async function fetchMembersAccess(client: RpcClient): Promise<MembersAccess> {
  const { data, error } = await client.rpc("members_access_state");
  if (error || !data || typeof data !== "object") return NO_ACCESS;
  const d = data as Record<string, unknown>;
  return {
    access: d.access === true,
    via: d.via === "plan" || d.via === "password" ? d.via : null,
    accessExpiresAt: typeof d.access_expires_at === "string" ? d.access_expires_at : null,
    passwordGate: d.password_gate === true,
  };
}

export async function fetchMembersTeaser(client: RpcClient, ciudad?: string): Promise<TeaserRow[]> {
  const { data, error } = await client.rpc("members_teaser", ciudad ? { p_ciudad: ciudad } : {});
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({
      ciudad: String(r.ciudad ?? ""),
      ciudad_display: typeof r.ciudad_display === "string" ? r.ciudad_display : null,
      pais: typeof r.pais === "string" ? r.pais : null,
      categoria: String(r.categoria ?? ""),
      venues: Number(r.venues) || 0,
    }))
    .filter((r) => r.ciudad && r.categoria);
}

export function summarizeTeaser(rows: TeaserRow[]): TeaserSummary {
  const cities = new Map<string, { ciudad: string; display: string; pais: string | null; total: number }>();
  const categories: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const c = cities.get(r.ciudad) ?? { ciudad: r.ciudad, display: r.ciudad_display || r.ciudad, pais: r.pais, total: 0 };
    c.total += r.venues;
    cities.set(r.ciudad, c);
    categories[r.categoria] = (categories[r.categoria] ?? 0) + r.venues;
    total += r.venues;
  }
  return { cities: [...cities.values()].sort((a, b) => b.total - a.total || a.display.localeCompare(b.display)), categories, total };
}

/** Mensaje del intento de desbloqueo con la contraseña temporal. */
export const UNLOCK_ERRORS: Record<string, string> = {
  contrasena_incorrecta: "Contraseña incorrecta",
  demasiados_intentos: "Demasiados intentos. Espera una hora e inténtalo de nuevo.",
  no_configurado: "El acceso con contraseña no está disponible. «Solo para miembros» es parte de IATOS PRO.",
  no_autenticado: "Tu sesión expiró. Vuelve a iniciar sesión.",
};
