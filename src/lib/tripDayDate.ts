// Fecha corta de un día del itinerario ("mié 10 mar"). El servidor pone `fecha` (YYYY-MM-DD) en cada
// día desde el 28-oct-2026; viajes viejos no la traen y se muestran como antes.
const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function tripDayDate(fecha: unknown): string | null {
  if (typeof fecha !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCMonth() !== Number(m[2]) - 1) return null;
  return `${DIAS[d.getUTCDay()]} ${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`;
}
