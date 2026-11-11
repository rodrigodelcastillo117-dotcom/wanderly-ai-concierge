// «Más opciones de todo» (pedido del dueño, 11-nov-2026): además de las 4–6 experiencias que eligió la IA, los demás
// lugares REALES de la misma lista de atracciones (Google Maps / TripAdvisor) hasta `max`, sin precio (no hay boleto con
// fuente: «Precio en el sitio»). Comprar los ofrece en «Ver más», ordenados por el perfil del usuario. Sin Deno.
import { sameName } from "./sources.ts";

export function moreTours(tours: any[], places: any[], o: { source: string; city: string; max?: number }): any[] {
  const list = Array.isArray(tours) ? tours : [];
  const max = o.max ?? 10;
  const out: any[] = [];
  for (const p of Array.isArray(places) ? places : []) {
    if (list.length + out.length >= max) break;
    if (!p?.name || list.some((t) => sameName(t?.nombre, p.name)) || out.some((t) => sameName(t.nombre, p.name))) continue;
    const r = Number(p.rating) > 0 ? Number(p.rating) : null;
    const n = Number(p.num_reviews) > 0 ? Number(p.num_reviews) : null;
    out.push({
      nombre: String(p.name),
      ciudad: o.city,
      fuente: o.source,
      rating: r,
      num_reviews: n,
      ...(p.place_id ? { place_id: p.place_id } : {}),
      ...(p.web_url ? { maps_url: p.web_url } : {}),
      verificado: true,
      estado_dato: "CONSULTADO_EN_VIVO",
      alternativa: true,
      por_que: r ? `Lugar real en ${o.source === "tripadvisor" ? "TripAdvisor" : "Google Maps"}: ${r.toLocaleString("es-MX", { maximumFractionDigits: 1 })}${n ? ` (${n.toLocaleString("es-MX")} reseñas)` : ""}.` : "Lugar real cerca de tu destino.",
    });
  }
  return out;
}
