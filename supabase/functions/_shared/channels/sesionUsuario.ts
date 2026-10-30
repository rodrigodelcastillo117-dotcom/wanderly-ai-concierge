// Sesión REAL del viajero vinculado, para que Iato por Telegram/WhatsApp lea y escriba con SUS permisos (RLS), su plan
// y sus cuotas, igual que en la app. Puro: los clientes de Supabase llegan por parámetro (probado con Vitest).
//
// Cómo: con la llave de servicio (solo en el servidor) se genera un enlace mágico para el correo del usuario
// (auth.admin.generateLink: NO manda correo) y se canjea su token de inmediato (auth.verifyOtp) → access_token de ese
// usuario. Al terminar el turno se cierra ESA sesión (auth.admin.signOut(jwt, "local"): solo esta, nunca sus otras
// sesiones de la app). El token nunca sale del servidor ni se guarda.
//
// Barandales: solo para el user_id que la base dice vinculado al chat (channel_link_for); el usuario debe tener correo
// confirmado y no estar bloqueado; la sesión obtenida debe ser de ESE user_id (si no, se cierra y se rechaza).
export type SesionCanal = { ok: true; token: string; cerrar: () => Promise<void> } | { ok: false; code: "SIN_CORREO" | "NO_CONFIRMADO" | "BLOQUEADO" | "FALLO" };

type AuthUser = { id?: string; email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null; banned_until?: string | null; deleted_at?: string | null };
export type AdminAuthLike = {
  auth: {
    admin: {
      getUserById(id: string): Promise<{ data: { user: AuthUser | null } | null; error: unknown }>;
      generateLink(p: { type: "magiclink"; email: string }): Promise<{ data: { properties?: { hashed_token?: string } | null } | null; error: unknown }>;
      signOut(jwt: string, scope?: "global" | "local" | "others"): Promise<{ error: unknown } | unknown>;
    };
  };
};
export type AnonAuthLike = {
  auth: { verifyOtp(p: { token_hash: string; type: "magiclink" | "email" }): Promise<{ data: { session?: { access_token?: string; user?: { id?: string } } | null } | null; error: unknown }> };
};

export async function abrirSesionDeUsuario(o: { admin: AdminAuthLike; anon: AnonAuthLike; userId: string; ahora?: Date }): Promise<SesionCanal> {
  try {
    const { data: ud } = await o.admin.auth.admin.getUserById(o.userId);
    const u = ud?.user;
    if (!u?.id || u.id !== o.userId || u.deleted_at) return { ok: false, code: "FALLO" };
    if (!u.email) return { ok: false, code: "SIN_CORREO" };
    if (!(u.email_confirmed_at ?? u.confirmed_at)) return { ok: false, code: "NO_CONFIRMADO" };
    if (u.banned_until && Date.parse(u.banned_until) > (o.ahora ?? new Date()).getTime()) return { ok: false, code: "BLOQUEADO" };
    const { data: link, error: le } = await o.admin.auth.admin.generateLink({ type: "magiclink", email: u.email });
    const hash = link?.properties?.hashed_token;
    if (le || !hash) return { ok: false, code: "FALLO" };
    let r = await o.anon.auth.verifyOtp({ token_hash: hash, type: "magiclink" });
    if (r.error || !r.data?.session?.access_token) r = await o.anon.auth.verifyOtp({ token_hash: hash, type: "email" });
    const token = r.data?.session?.access_token;
    if (r.error || !token) return { ok: false, code: "FALLO" };
    const cerrar = async () => { await Promise.resolve(o.admin.auth.admin.signOut(token, "local")).catch(() => undefined); };
    // Aislamiento: la sesión debe ser del MISMO usuario vinculado.
    if (r.data?.session?.user?.id !== o.userId) {
      await cerrar();
      return { ok: false, code: "FALLO" };
    }
    return { ok: true, token, cerrar };
  } catch {
    return { ok: false, code: "FALLO" };
  }
}

export const MENSAJE_SIN_SESION: Record<Exclude<SesionCanal, { ok: true }>["code"], string> = {
  SIN_CORREO: "Para conversar con Iato por aquí, tu cuenta de IATOS necesita un correo. Agrégalo en la app (Perfil).",
  NO_CONFIRMADO: "Para conversar con Iato por aquí, confirma primero tu correo (revisa el mensaje de bienvenida de IATOS).",
  BLOQUEADO: "Tu cuenta de IATOS no está activa. Escríbenos desde la app o a hola@traveliatos.life.",
  FALLO: "No pude abrir tu sesión de IATOS en este momento. Inténtalo de nuevo en un minuto o sigue en la app.",
};
