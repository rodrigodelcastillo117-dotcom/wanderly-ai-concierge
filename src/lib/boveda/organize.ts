// Búsqueda y orden de la Bóveda (sin números: buscar no debe depender de lo que está oculto).
import { COUNTRY_NAME } from "./alerts";
import { KIND_LABEL, type VaultItem } from "./types";

export type SortKey = "vence" | "nombre" | "recientes";

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function matchesQuery(item: VaultItem, query: string): boolean {
  const q = norm(query).trim();
  if (!q) return true;
  const hay = norm([item.title, item.issuer, item.tier, item.holder_name, KIND_LABEL[item.kind], item.visa_type,
    item.country_code ? COUNTRY_NAME[item.country_code] : null, ...(item.benefits ?? [])].filter(Boolean).join(" · "));
  return q.split(/\s+/).every((w) => hay.includes(w));
}

export function filterAndSort(items: VaultItem[], query: string, sort: SortKey): VaultItem[] {
  const list = items.filter((i) => matchesQuery(i, query));
  const byName = (a: VaultItem, b: VaultItem) => a.title.localeCompare(b.title, "es", { sensitivity: "base" });
  if (sort === "nombre") return list.sort(byName);
  if (sort === "recientes") return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  // Vence primero; lo que no vence va al final por nombre.
  return list.sort((a, b) => {
    if (a.expires_on && b.expires_on) return a.expires_on.localeCompare(b.expires_on) || byName(a, b);
    if (a.expires_on) return -1;
    if (b.expires_on) return 1;
    return byName(a, b);
  });
}
