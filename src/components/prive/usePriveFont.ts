import { useEffect } from "react";

export const PRIVE_FONT_ID = "prive-font-cormorant";
// Una sola familia (Cormorant Garamond) con display=swap: el texto se ve al instante con la serifa
// del sistema y cambia cuando llega la fuente. Solo se pide al entrar a Privé (o a su lectura sin conexión,
// que vive fuera de PriveRoot y antes se veía con Times).
export const PRIVE_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,400&display=swap";

export function usePriveFont() {
  useEffect(() => {
    if (typeof document === "undefined" || document.getElementById(PRIVE_FONT_ID)) return;
    const link = document.createElement("link");
    link.id = PRIVE_FONT_ID;
    link.rel = "stylesheet";
    link.href = PRIVE_FONT_HREF;
    document.head.appendChild(link);
  }, []);
}
