// Card de transporte de Iato ("Tren Madrid → Sevilla", "Ferry Barcelona → Palma", "Lancha en Cancún"):
// a dónde lleva "Ver horarios y precio". La card no trae fecha, así que no se arma un enlace externo
// a medias: se abre la pantalla de IATOS (Trenes o Ferris) con la ruta ya escrita y ahí, con la fecha,
// salen los enlaces precargados del operador (Renfe, DB, 12Go) o las salidas en vivo de Ferryhopper.
// Nunca un precio.
export type GroundCardLink = { label: string; href: string; mode: "tren" | "ferry" | "yate" };

const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function groundCardLink(card: { title?: string | null; subtitle?: string | null; meta?: string | null }): GroundCardLink | null {
  const text = norm(`${card.title ?? ""} ${card.meta ?? ""}`);
  const mode = /\b(yate|lancha|velero|catamaran|barco privado)\b/.test(text) ? "yate"
    : /\b(ferry|ferri|ferris|ferries)\b/.test(text) ? "ferry"
    : /\b(tren|trenes|ave|shinkansen|frecciarossa|tgv|ice)\b/.test(text) ? "tren" : null;
  if (!mode) return null;
  const parts = String(card.subtitle ?? "").split("→").map((s) => s.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
  if (mode === "yate") {
    const place = parts[0] ?? "";
    return { mode, label: "Buscar yate o lancha", href: `/dashboard/ferries${place ? `?boat=${encodeURIComponent(place)}` : ""}#yate` };
  }
  if (parts.length !== 2 || norm(parts[0]) === norm(parts[1])) return null;
  const qs = new URLSearchParams({ origin: parts[0], dest: parts[1] });
  if (mode === "ferry") return { mode, label: "Ver salidas y precio en vivo", href: `/dashboard/ferries?${qs.toString()}` };
  return { mode, label: "Ver horarios y precio", href: `/dashboard/trenes?${qs.toString()}` };
}
