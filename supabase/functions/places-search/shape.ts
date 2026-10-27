// Salida de places-search (sin Deno: se prueba con Vitest). Mismos campos de antes (id, name, address,
// lat, lng, rating, ratings_count, price_level, primary_type, types, maps_url, website, open_now,
// business_status, photo_ref, source) más los de reserva y comida que Iato necesita.
import type { GooglePlace, PlacePreset } from "../_shared/google-places.ts";
import { filterByMeal, type Meal, MEALS, mealFromText, restaurantBooking } from "../_shared/restaurantBooking.ts";
import { matchOfficialTicket, ticketSummary } from "../_shared/officialTickets.ts";

const FOOD = /\b(restaurante?s?|restaurant\w*|cena\w*|cenar|desayun\w*|brunch|comida|comer|almuerzo|trattoria|osteria|ristorante|enoteca|pizzeria|bistro|bistrot|cafe|cafeteria|bar(es)?|taberna|marisquer\w*|steak\w*|sushi|tapas|gelateria|pasteler\w*|panader\w*|romantic\w*|food|dinner|lunch|breakfast)\b/;
const norm = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "atmosphere" solo para búsquedas de comida (su SKU es más caro); "rich" para lo demás. */
export function placesSearchPreset(b: { query?: unknown; food?: unknown; meal?: unknown }): Extract<PlacePreset, "rich" | "atmosphere"> {
  if (b.food === true || (typeof b.meal === "string" && b.meal)) return "atmosphere";
  return FOOD.test(norm(b.query)) ? "atmosphere" : "rich";
}

export function placesSearchOutput(places: GooglePlace[], body: { query?: unknown; meal?: unknown; city?: unknown }, preset: PlacePreset) {
  const meal: Meal | null = typeof body.meal === "string" && (MEALS as string[]).includes(body.meal) ? body.meal as Meal : null;
  const food = preset === "atmosphere";
  const list = meal ? filterByMeal(places, meal) : places;
  const city = typeof body.city === "string" ? body.city.trim().slice(0, 80) : "";
  const results = list.map((p) => {
    const ticket = matchOfficialTicket(p.name, city || null) ?? (city ? null : matchOfficialTicket(p.name));
    return {
      id: p.place_id,
      name: p.name,
      address: p.address,
      lat: p.lat,
      lng: p.lng,
      rating: p.rating,
      ratings_count: p.user_rating_count ?? 0,
      price_level: p.price_level,
      price_level_label: p.price_level_label,
      primary_type: p.primary_type,
      types: p.types,
      maps_url: p.maps_url,
      website: p.website,
      phone: p.phone,
      phone_international: p.phone_international,
      open_now: p.open_now,
      opening_hours: p.weekday_hours,
      business_status: p.business_status,
      photo_ref: p.photo_ref,
      ...(food ? {
        reservable: p.reservable,
        sirve: { desayuno: p.serves.breakfast, brunch: p.serves.brunch, comida: p.serves.lunch, cena: p.serves.dinner },
        resumen: p.editorial_summary,
        reserva: restaurantBooking({ name: p.name, city: city || null, address: p.address, website: p.website, phone: p.phone, phoneInternational: p.phone_international, reservable: p.reservable }),
      } : {}),
      ...(ticket ? { taquilla_oficial: ticketSummary(ticket) } : {}),
      source: "Google Places (New)",
    };
  });
  return {
    results,
    consultado_at: places[0]?.consultado_at ?? new Date().toISOString(),
    ...(meal ? { filtro_comida: { comida: meal, total_sin_filtro: places.length, quedan: list.length, regla: "Solo los que Google marca que sirven esa comida." } } : {}),
    ...(!meal && food && mealFromText(body.query) ? { comida_en_consulta: mealFromText(body.query) } : {}),
  };
}
