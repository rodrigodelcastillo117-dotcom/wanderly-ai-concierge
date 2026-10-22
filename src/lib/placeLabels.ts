/**
 * Textos en español para los datos de Google Places (Cercanos y fichas de lugares).
 * Google responde en inglés ("PRICE_LEVEL_MODERATE", "restaurant"); antes se mostraban tal cual
 * ("moderate", "RESTAURANT").
 */

const PRICE: Record<string, { symbols: string; label: string }> = {
  PRICE_LEVEL_FREE: { symbols: "", label: "Gratis" },
  PRICE_LEVEL_INEXPENSIVE: { symbols: "$", label: "Económico" },
  PRICE_LEVEL_MODERATE: { symbols: "$$", label: "Moderado" },
  PRICE_LEVEL_EXPENSIVE: { symbols: "$$$", label: "Caro" },
  PRICE_LEVEL_VERY_EXPENSIVE: { symbols: "$$$$", label: "Muy caro" },
};
// La API anterior de Places usa 0–4.
const PRICE_BY_NUMBER = ["PRICE_LEVEL_FREE", "PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE", "PRICE_LEVEL_EXPENSIVE", "PRICE_LEVEL_VERY_EXPENSIVE"];

/** "$$ · Moderado". null si no hay dato o no se reconoce (mejor nada que inglés crudo). */
export function priceLevelLabel(raw: string | number | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  let key = typeof raw === "number" ? PRICE_BY_NUMBER[raw] : String(raw).trim().toUpperCase();
  if (key && /^[0-4]$/.test(key)) key = PRICE_BY_NUMBER[Number(key)];
  if (key && !key.startsWith("PRICE_LEVEL_")) key = `PRICE_LEVEL_${key}`;
  const p = key ? PRICE[key] : undefined;
  if (!p) return null;
  return p.symbols ? `${p.symbols} · ${p.label}` : p.label;
}

const TYPES: Record<string, string> = {
  restaurant: "Restaurante",
  bar_and_grill: "Bar y parrilla",
  cafe: "Café",
  coffee_shop: "Cafetería",
  bar: "Bar",
  wine_bar: "Bar de vinos",
  pub: "Pub",
  night_club: "Club nocturno",
  bakery: "Panadería",
  meal_takeaway: "Comida para llevar",
  meal_delivery: "Comida a domicilio",
  fast_food_restaurant: "Comida rápida",
  ice_cream_shop: "Heladería",
  dessert_shop: "Postres",
  brunch_restaurant: "Brunch",
  breakfast_restaurant: "Desayunos",
  fine_dining_restaurant: "Alta cocina",
  food_court: "Zona de comida",
  tourist_attraction: "Atracción turística",
  museum: "Museo",
  art_gallery: "Galería de arte",
  park: "Parque",
  national_park: "Parque nacional",
  zoo: "Zoológico",
  aquarium: "Acuario",
  amusement_park: "Parque de diversiones",
  church: "Iglesia",
  place_of_worship: "Templo",
  historical_landmark: "Sitio histórico",
  monument: "Monumento",
  cultural_center: "Centro cultural",
  performing_arts_theater: "Teatro",
  movie_theater: "Cine",
  shopping_mall: "Centro comercial",
  store: "Tienda",
  supermarket: "Supermercado",
  market: "Mercado",
  hotel: "Hotel",
  lodging: "Hospedaje",
  spa: "Spa",
  gym: "Gimnasio",
  plaza: "Plaza",
  beach: "Playa",
  viewpoint: "Mirador",
};

// "<cocina>_restaurant" → "Restaurante <cocina>".
const CUISINE: Record<string, string> = {
  mexican: "mexicano", italian: "italiano", japanese: "japonés", sushi: "de sushi", ramen: "de ramen",
  chinese: "chino", korean: "coreano", thai: "tailandés", vietnamese: "vietnamita", indian: "indio",
  spanish: "español", french: "francés", mediterranean: "mediterráneo", greek: "griego", turkish: "turco",
  lebanese: "libanés", middle_eastern: "de Medio Oriente", american: "estadounidense", hamburger: "de hamburguesas",
  pizza: "de pizza", seafood: "de mariscos", steak_house: "de cortes", barbecue: "de parrilla",
  vegetarian: "vegetariano", vegan: "vegano", brazilian: "brasileño", argentinian: "argentino", peruvian: "peruano",
  asian: "asiático", fusion: "de fusión", taco: "de tacos", buffet: "buffet", african: "africano", indonesian: "indonesio",
};

/** Tipo de lugar en español ("restaurant" → "Restaurante"). null si no se reconoce. */
export function placeTypeLabel(type: string | null | undefined): string | null {
  const t = String(type ?? "").trim().toLowerCase();
  if (!t) return null;
  if (TYPES[t]) return TYPES[t];
  if (t === "steak_house") return "Restaurante de cortes";
  const m = /^(.+)_restaurant$/.exec(t);
  if (m) return CUISINE[m[1]] ? `Restaurante ${CUISINE[m[1]]}` : "Restaurante";
  return null;
}

/** Primer tipo traducible: primero el principal y luego la lista. "Lugar" si ninguno. */
export function bestPlaceTypeLabel(primary: string | null | undefined, types: string[] = []): string {
  for (const t of [primary, ...types]) {
    const l = placeTypeLabel(t);
    if (l) return l;
  }
  return "Lugar";
}

/** Familia visual para la ilustración cuando no hay foto real del lugar. */
export type PlaceFamily = "food" | "cafe" | "bar" | "sight" | "shop" | "lodging" | "other";
export function placeFamily(primary: string | null | undefined, types: string[] = []): PlaceFamily {
  const all = [primary, ...types].filter(Boolean).map((x) => String(x).toLowerCase());
  const has = (re: RegExp) => all.some((x) => re.test(x));
  if (has(/^(cafe|coffee_shop|bakery|tea_house)$/)) return "cafe";
  if (has(/^(bar|wine_bar|pub|night_club|cocktail_bar)$/)) return "bar";
  if (has(/restaurant|^food$|meal_|steak_house|food_court|grill/)) return "food";
  if (has(/^(hotel|lodging|resort_hotel|hostel)$/)) return "lodging";
  if (has(/^(shopping_mall|store|market|supermarket|clothing_store)$/)) return "shop";
  if (has(/tourist_attraction|museum|park|gallery|landmark|monument|church|zoo|aquarium|viewpoint|plaza|beach/)) return "sight";
  return "other";
}
