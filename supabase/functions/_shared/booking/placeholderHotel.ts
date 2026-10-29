// Hoteles "de referencia" que escribió la IA sin ser un hotel real (auditoría 28-oct-2026):
// "Boutique hotel en el Centro Histórico (por confirmar en Google Hotels)", "Hotel 5★ clásico en Zona T /
// Chicó (por confirmar)". Son una zona y un nivel de precio, no un hotel: no llevan botón de compra (Booking
// buscaba esa frase literal), no son el origen de las distancias y se presentan como "Elegir hotel".
// Puro (cliente y Edge Functions).

const LIVE = new Set(["serpapi", "google_hotels", "serpapi-hotels", "booking", "tripadvisor"]);
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function isPlaceholderHotel(h: any): boolean {
  if (!h || typeof h !== "object") return false;
  if (h.desde_usuario === true || h.desde_pdf === true) return false;
  const name = norm(h.nombre ?? h.name);
  if (!name.trim()) return true;
  if (/\(\s*por confirmar|por confirmar\s*\)|\bpor definir\b|\bpor elegir\b/.test(name)) return true;
  const live = LIVE.has(norm(h.fuente_precio ?? h.fuente)) || !!h.property_token || !!h.place_id;
  if (live) return false;
  // "Hotel boutique en …", "Hotel 5★ clásico en …", "Hostal económico cerca de …": una categoría y una zona.
  return /^(hotel|boutique hotel|hotel boutique|hostal|hostel|resort|departamento|apartamento|airbnb|posada|casa)\b[^,]{0,40}\b(en|cerca de|junto a|zona)\b/.test(name)
    && /\b(boutique|clasico|lujo|economico|centrico|5|4|3|estrellas|★|categoria|tipo|estilo|zona|centro|historico)\b|★/.test(name);
}

/** "Hotel 5★ clásico en Zona T / Chicó (por confirmar)" → "Hotel 5★ clásico en Zona T / Chicó". */
export function placeholderHotelLabel(h: any): string {
  return String(h?.nombre ?? h?.name ?? "").replace(/\s*\((?:[^)]*por confirmar[^)]*)\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}
