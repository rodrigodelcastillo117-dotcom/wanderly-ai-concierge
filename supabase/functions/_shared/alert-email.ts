// Correo de las alertas (precio y vuelo). APAGADO por defecto: hoy las alertas llegan a la campana
// y por push; mandarlas también por correo es una decisión del dueño (volumen de Resend y
// consentimiento). Se enciende con ALERT_EMAILS_ENABLED=true. Nunca lanza: un correo fallido no
// detiene la corrida ni repite el aviso (va después de notify_once, que ya deduplica).
// deno-lint-ignore no-explicit-any
type Admin = { auth: { admin: { getUserById(id: string): Promise<{ data: any }> } }; from(t: string): any };

export const alertEmailsEnabled = () => (Deno.env.get("ALERT_EMAILS_ENABLED") ?? "").trim().toLowerCase() === "true";

/** Correo de la cuenta y primer nombre del perfil (service role). Null si no hay correo. */
export async function alertRecipient(admin: Admin, userId: string): Promise<{ email: string; firstName: string | null } | null> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email as string | undefined;
    if (!email) return null;
    const { data: p } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    return { email, firstName: (p?.full_name as string | null) ?? null };
  } catch {
    return null;
  }
}
