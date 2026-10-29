// Filtro de categoría de Cercanos (auditoría 10/10, P1-5, 28-oct-2026). Puro: lo prueba Vitest.
//
// Causa: la búsqueda pide a Google includedTypes=[<categoría>], que trae cualquier lugar que tenga ese
// tipo ENTRE sus tipos secundarios. Con «Cafés» salían primero un cine y un hotel boutique (ambos tienen
// "cafe" en types), y con «Bares» un restaurante con terraza y una cocina yucateca. El tipo que describe
// al lugar es primaryType: aquí se queda solo lo que de verdad es de la categoría elegida.

const CAFE = new Set(["cafe", "coffee_shop", "tea_house", "cafeteria", "coffee_roastery", "coffee_stand"]);
const BAR = new Set(["bar", "pub", "wine_bar", "cocktail_bar", "beer_hall", "beer_garden", "brewery", "brewpub", "night_club", "lounge_bar", "sports_bar", "bar_and_grill", "irish_pub", "hookah_bar", "gastropub"]);
const LODGING = /^(hotel|lodging|motel|hostel|resort_hotel|bed_and_breakfast|guest_house|inn|extended_stay_hotel|campground|cottage|farmstay|private_guest_room|budget_japanese_inn|japanese_inn)$/;
const FOOD = /(^|_)restaurant$|^(restaurant|steak_house|food_court|diner|bistro|brunch_restaurant|pizzeria|taqueria|deli|meal_takeaway|meal_delivery|fast_food_restaurant|buffet_restaurant)$/;
const SHOP = /(^|_)(store|shop|market|mall|supermarket)$/;

const isCafe = (t: string) => CAFE.has(t);
const isBar = (t: string) => BAR.has(t);
const isFood = (t: string) => FOOD.test(t);

/** ¿El lugar es de la categoría pedida? Se decide por primaryType; sin él, por sus tipos (sin hoteles ni cines). */
export function matchesCategory(category: string | null | undefined, primary: string | null | undefined, types: readonly string[] = []): boolean {
  const cat = String(category ?? "restaurant");
  const p = String(primary ?? "").toLowerCase();
  const all = types.map((t) => String(t).toLowerCase());
  const pick = (test: (t: string) => boolean) => (p ? test(p) : all.some(test) && !all.some((t) => LODGING.test(t) || t === "movie_theater"));
  switch (cat) {
    case "cafe": return pick(isCafe);
    case "bar": return pick(isBar);
    case "restaurant": return pick(isFood);
    case "tourist_attraction":
      // Atracciones: cualquier cosa que no sea comida, bebida, hospedaje ni tienda.
      return !(p && (isFood(p) || isCafe(p) || isBar(p) || LODGING.test(p) || SHOP.test(p)));
    default:
      return true;
  }
}
