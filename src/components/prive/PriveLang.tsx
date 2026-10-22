import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { detectPriveLang, priveText, setActivePriveLang, type PriveLang, type PriveText } from "@/lib/priveI18n";

const Ctx = createContext<PriveLang | null>(null);

/**
 * Idioma de todas las pantallas /prive/* (PriveRoot). `profileLanguage` queda listo para cuando el
 * perfil tenga un campo de idioma; hoy decide el navegador (y, si no es es ni en, español).
 */
export function PriveLangProvider({ profileLanguage, lang: forced, children }: { profileLanguage?: string | null; lang?: PriveLang; children: ReactNode }) {
  const lang = useMemo(() => forced ?? detectPriveLang(profileLanguage), [forced, profileLanguage]);
  // Para funciones sin React (messageFor, avisos de sesión).
  setActivePriveLang(lang);
  useEffect(() => () => setActivePriveLang(null), []);
  return <Ctx.Provider value={lang}>{children}</Ctx.Provider>;
}

/** Idioma vigente; fuera del proveedor (pruebas de un componente suelto) se detecta igual. */
export function usePriveLang(): PriveLang {
  const v = useContext(Ctx);
  return v ?? detectPriveLang();
}

/** Diccionario del idioma vigente. */
export function usePriveT(): PriveText {
  return priveText(usePriveLang());
}
