// «Más opciones de todo» (pedido del dueño, 11-nov-2026), viajes de varias ciudades: además de las 4–5 experiencias
// que eligió la IA en cada ciudad, los demás lugares REALES de la lista de atracciones de esa ciudad (TripAdvisor /
// Google Maps) hasta `max`, SIN precio (no hay boleto con fuente: «Precio en el sitio»). Comprar los ofrece en
// «Ver más», ordenados por el perfil del usuario. Igual que analizar-viaje/moreTours.ts. Sin Deno: se prueba con Vitest.
import { samePlace } from "./provenance.ts";

type Place = { name?: string; place_id?: string | null; web_url?: string | null; rating?: number | null; num_reviews?: number | null };

export function moreExperiences(exps: any[], places: Place[] | null, o: { source: string; city: string | null; max?: number }): any[] {
  const list = Array.isArray(exps) ? exps : [];
  const max = o.max ?? 10;
  const out: any[] = [];
  const seen = (name: string) => list.some((e) => samePlace(e?.nombre ?? e?.name, name)) || out.some((e) => samePlace(e.nombre, name));
  for (const p of Array.isArray(places) ? places : []) {
    if (list.length + out.length >= max) break;
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name || seen(name)) continue;
    const r = Number(p.rating) > 0 ? Number(p.rating) : null;
    const n = Number(p.num_reviews) > 0 ? Number(p.num_reviews) : null;
    const where = o.source === "tripadvisor" ? "TripAdvisor" : "Google Maps";
    out.push({
      nombre: name,
      fuente: o.source,
      rating: r,
      ...(n ? { num_reviews: n } : {}),
      ...(p.place_id ? { place_id: p.place_id } : {}),
      ...(o.source !== "tripadvisor" && p.web_url ? { maps_url: p.web_url } : {}),
      verificado: true,
      estado_dato: "CONSULTADO_EN_VIVO",
      alternativa: true,
      por_que: r
        ? `Lugar real en ${where}: ${r.toLocaleString("es-MX", { maximumFractionDigits: 1 })}${n ? ` (${n.toLocaleString("es-MX")} reseñas)` : ""}.`
        : `Lugar real${o.city ? ` en ${o.city}` : ""}.`,
    });
  }
  return out;
}
