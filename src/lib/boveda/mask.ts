// Números enmascarados por defecto: solo se ven los últimos 4 caracteres ("••••1234") hasta que la
// persona toca "mostrar". Un número de 4 o menos caracteres se oculta completo.
const DOT = "•";

export function maskNumber(value: string | null | undefined, visible = 4): string {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.length <= visible) return DOT.repeat(4);
  return DOT.repeat(4) + v.slice(-visible);
}

/** Tarjetas: lo guardado ya son solo los últimos 4 dígitos, que se pueden mostrar. */
export function cardDisplay(last4: string | null | undefined): string {
  return last4 ? `${DOT.repeat(4)} ${last4}` : "";
}

/** Para leerlo o dictarlo: grupos de 4 ("G123 4567"). */
export function groupNumber(value: string | null | undefined): string {
  const v = (value ?? "").replace(/\s+/g, "");
  return v.replace(/(.{4})(?=.)/g, "$1 ");
}
