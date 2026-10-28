// Nombre visible de un lugar (restaurante, hotel, atracción) sin la "basura" de los listados web que
// algunos negocios ponen en su nombre de Google (E2E 28-oct-2026):
//   "La Taberna de Peñalver Cava Baja | Restaurante La Latina" → "La Taberna de Peñalver Cava Baja"
//   "Ilios | Greek restaurant in Cancun"                          → "Ilios"
//   "Casa del Vin Santo - Ristorante Braceria Firenze"           → "Casa del Vin Santo"
// y se mandaban así a los enlaces de búsqueda (OpenTable, Maps). Con cuidado de no romper nombres reales
// con guion: "Osteria da Fortunata - Rinascimento" (sucursal), "Mezquita-Catedral", "Santuario de la
// Mariposa Monarca - Piedra Herrada" se quedan como están. Sin Deno; se prueba con Vitest.

/** Lo que va después del separador es una descripción genérica (categoría, "en <ciudad>", reseñas…). */
const GENERIC_TAIL = new RegExp(
  "^(the\\s+)?(best\\s+|mejor(es)?\\s+)?((\\p{L}+\\s+){0,2})?" +
  "(restaurantes?|restaurants?|ristorante|trattoria|osteria|bar(es)?|caf[eé]s?|cafeter[ií]a|bistr[oó]|steak\\s?house|marisquer[ií]a|taquer[ií]a|pizzer[ií]a|cocina|comida|food|tapas|cuisine|hotel|hostal|hostel|official\\s+site|sitio\\s+oficial|reservas?|booking)" +
  "(\\b|$)", "iu",
);
/** "… in Cancun", "… en La Latina", "… near …": cola de SEO aunque no empiece con una categoría. */
const SEO_TAIL = /\b(in|en|near|cerca de)\s+\p{Lu}/u;

const SEPARATORS = [" | ", " ｜ ", " – ", " — ", " - ", " · ", " • "];

export function cleanPlaceName(raw: unknown): string {
  let s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // "|" casi nunca es parte de un nombre: todo lo que sigue es del listado.
  for (const sep of [" | ", " ｜ "]) {
    const i = s.indexOf(sep);
    if (i >= 2) s = s.slice(0, i).trim();
  }
  // Guiones y puntos medios: solo si la cola es genérica (categoría o "en <lugar>").
  for (const sep of SEPARATORS.slice(2)) {
    const i = s.indexOf(sep);
    if (i < 2) continue;
    const tail = s.slice(i + sep.length).trim();
    if (GENERIC_TAIL.test(tail) || (SEO_TAIL.test(tail) && tail.split(" ").length >= 3 && /restaur|food|cocina|bar\b|caf/i.test(tail))) {
      s = s.slice(0, i).trim();
    }
  }
  s = s.replace(/[\s,;:|·•–—-]+$/u, "").trim();
  // "master Trevi Rome": la primera letra en mayúscula (los nombres de Google a veces llegan así).
  if (/^\p{Ll}/u.test(s) && /\s/.test(s)) s = s[0].toLocaleUpperCase("es") + s.slice(1);
  return s || String(raw ?? "").trim();
}

const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Nombre visible de una atracción que empató con la lista del proveedor (Google, en español): se
 * conservan los acentos de Google ("Panteon de Roma" → "Panteón de Roma") y un nombre de una sola
 * palabra lleva la ciudad para tener contexto ("David" → "David (Florencia)"). Nunca se inventa nada:
 * solo se usan el nombre del modelo, el del proveedor y la ciudad del viaje.
 */
export function visiblePlaceName(modelName: unknown, providerName: unknown, city?: string | null): string {
  const m = cleanPlaceName(modelName);
  const p = cleanPlaceName(providerName);
  let out = m || p;
  if (m && p) {
    if (fold(m) === fold(p)) out = p;
    else {
      // Acentos de las palabras del proveedor sobre las mismas palabras del modelo.
      const accented = new Map(p.split(/\s+/).filter((w) => fold(w) !== w.toLowerCase()).map((w) => [fold(w), w]));
      out = m.split(/(\s+)/).map((w) => {
        const hit = accented.get(fold(w));
        return hit ? (w[0] === w[0]?.toUpperCase() ? hit[0].toUpperCase() + hit.slice(1) : hit) : w;
      }).join("");
    }
  }
  const c = String(city ?? "").trim();
  if (out && c && !/\s/.test(out) && fold(out) !== fold(c)) out = `${out} (${c})`;
  return out;
}
