// Reglas de fuentes del análisis de viaje (sin dependencias de Deno, para poder probarlas).

// Extrae de las notas del cliente lo que describe el hospedaje, para buscarlo en Google Hotels.
const HOTEL_WORDS = /(hotel|hospedaje|alojamiento|boutique|resort|villa|caba[ñn]a|hostal|airbnb|todo incluido|all inclusive|vista al mar|frente al mar|frente a la playa|alberca|piscina|spa|lujo|5 estrellas|adults only|solo adultos)/i;
export function hotelPreference(notas: unknown): string {
  const text = String(notas ?? "").replace(/\s+/g, " ").trim();
  // Solo la frase que habla del hospedaje: "aniversario, hotel boutique en Le Marais, cenas"
  // → "hotel boutique en Le Marais". El resto confunde la búsqueda de Google Hotels.
  const clause = text.split(/[,.;]| y luego | pero /i).find((c) => HOTEL_WORDS.test(c));
  return clause ? clause.trim().slice(0, 60) : "";
}

const normName = (v: unknown) =>
  String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const sameName = (a: unknown, b: unknown) => {
  const x = normName(a), y = normName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

// La IA debe copiar lugares y hoteles de las listas en vivo. Si un nombre no está en la lista,
// no puede llevar la etiqueta de esa fuente (sería presentar una invención como dato real).
export function enforceSources(a: any, places: any[], hotels: any[], placesSource: string) {
  for (const t of Array.isArray(a?.tours) ? a.tours : []) {
    if ((t?.fuente === "google_maps" || t?.fuente === "tripadvisor") && !places.some((p) => sameName(p?.name, t?.nombre))) {
      t.fuente = "estimado";
      t.rating = null;
      t.num_reviews = null;
    } else if (t?.fuente === "tripadvisor" || t?.fuente === "google_maps") {
      t.fuente = placesSource;
    }
  }
  for (const h of Array.isArray(a?.hospedaje) ? a.hospedaje : []) {
    if (h?.fuente_precio === "serpapi" && !hotels.some((x) => sameName(x?.name, h?.nombre))) h.fuente_precio = "estimado";
  }
}
