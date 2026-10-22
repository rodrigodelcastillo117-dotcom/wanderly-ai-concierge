/**
 * Pide al navegador que guarde la contraseña Privé (Chrome/Edge/Android: Credential Management).
 * Con el campo de usuario "correo · Privé" queda separada de la contraseña de la cuenta IATOS, y
 * la próxima vez el candado se autollena con la correcta. Safari no tiene esta API: ahí el campo
 * de usuario + autocomplete="new-password" hacen que ofrezca guardarla al enviar el formulario.
 * Nunca lanza; la contraseña no se guarda en ningún almacenamiento de la app.
 */
export async function offerToSavePrivePassword(email: string | null | undefined, password: string): Promise<boolean> {
  try {
    const w = window as unknown as { PasswordCredential?: new (data: { id: string; password: string; name?: string }) => Credential };
    if (!email || !password || !w.PasswordCredential || !navigator.credentials?.store) return false;
    await navigator.credentials.store(new w.PasswordCredential({ id: `${email} · Privé`, password, name: "IATOS Privé" }));
    return true;
  } catch {
    return false;
  }
}
