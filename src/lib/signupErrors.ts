// Mensaje claro para cada rechazo de Supabase Auth al crear cuenta. Antes todo salía como "Revisa tus
// datos" y un amigo del dueño no supo que su contraseña aparecía en filtraciones conocidas
// (Supabase la rechaza con "Password is known to be weak and easy to guess", razón "pwned").
export function signupErrorMessage(raw: string | null | undefined): string {
  const m = (raw ?? "").toLowerCase();
  if (m.includes("already") || m.includes("registered")) return "Ya existe una cuenta con este correo. Inicia sesión o recupera tu contraseña.";
  if (m.includes("weak") || m.includes("pwned") || m.includes("easy to guess"))
    return "Esa contraseña aparece en filtraciones conocidas de internet. Elige otra más única (por ejemplo, una frase de 3 o 4 palabras).";
  if (m.includes("password") && (m.includes("at least") || m.includes("characters") || m.includes("should contain")))
    return "La contraseña no cumple los requisitos: usa al menos 8 caracteres, mezclando letras y números.";
  if (m.includes("invalid") && m.includes("email")) return "Ese correo no parece válido. Revísalo e intenta de nuevo.";
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes"))
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a intentar.";
  if (m.includes("signup") && m.includes("disabled")) return "Por ahora no estamos aceptando cuentas nuevas. Intenta más tarde.";
  if (m.includes("network") || m.includes("fetch")) return "No hay conexión. Revisa tu internet e intenta de nuevo.";
  return "No pudimos crear tu cuenta. Revisa tus datos e intenta de nuevo.";
}
