import { useAuth } from "@/contexts/AuthContext";

/**
 * Campo oculto de "usuario" para los gestores de contraseñas. Sin él, el navegador guarda la
 * contraseña Privé y la de la cuenta IATOS bajo el mismo correo y luego autollena la equivocada
 * en el candado de Privé ("contraseña incorrecta"). Con "correo · Privé" quedan como dos entradas.
 */
export function PriveUsernameField() {
  const { user } = useAuth();
  if (!user?.email) return null;
  return (
    <input
      type="text"
      name="username"
      autoComplete="username"
      value={`${user.email} · Privé`}
      readOnly
      hidden
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
