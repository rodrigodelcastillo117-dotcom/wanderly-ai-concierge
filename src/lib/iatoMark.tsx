// "Iato" en la fuente de la app (Manrope) se leía "lato": su I mayúscula es una barra igual a la l
// minúscula (auditoría de cuenta 28-oct, #19). El nombre se pinta con la serifa de marca (Fraunces),
// cuya I lleva remates. Solo cambia la forma de la letra; el texto sigue igual para lectores de pantalla.
import { Fragment, type ReactNode } from "react";

export function withIatoMark(text: string): ReactNode {
  const parts = text.split(/\b(Iato)\b/);
  if (parts.length === 1) return text;
  return parts.map((p, i) => (p === "Iato"
    ? <span key={i} className="font-display not-italic" data-iato-mark="">Iato</span>
    : <Fragment key={i}>{p}</Fragment>));
}
