// Hotel por ciudad en un viaje multi-destino (Roma → Florencia → Venecia): cada ciudad con sus
// noches, su hotel elegido (o el del nivel de la cotización) y su precio. Lo usan "Comprar mi viaje",
// el desglose (quote.ts) y la página del viaje, para que el total cuadre con lo que se compra.
import { cityStays, sameCity, type CityStay } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { hotelPriceRooms } from "../../supabase/functions/_shared/rooms.ts";

export type CityHotelChoice = {
  stay: CityStay;
  /** Índice en trips.hospedaje_json del hotel elegido para esa ciudad; -1 si no hay; -2 "ya tengo". */
  index: number;
  hotel: any | null;
  /** Opciones de esa ciudad (índices en hospedaje_json), ahorro → premium. */
  options: number[];
  /** Precio del hotel elegido por las noches de la ciudad (MXN), o null sin precio. */
  total: number | null;
  /** true si lo eligió el usuario (no el nivel de la cotización). */
  chosen: boolean;
};

const TIER_ORDER = ["ahorro", "equilibrio", "premium"];
const price = (h: any) => Number(h?.precio_por_noche) || 0;

/** Índices de hospedaje_json de una ciudad, del más barato al más caro. */
export function hotelOptionsForCity(trip: any, city: string): number[] {
  const list: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  return list.map((h, i) => [h, i] as const).filter(([h]) => sameCity(h?.ciudad, city))
    .sort((a, b) => price(a[0]) - price(b[0])).map(([, i]) => i);
}

/** Hotel de la cotización para la ciudad: el del nivel elegido (logistics.selected_tier) o el intermedio. */
export function quotedHotelForCity(trip: any, city: string): number {
  const opts = hotelOptionsForCity(trip, city);
  if (!opts.length) return -1;
  const tier = String(trip?.itinerario_json?.logistics?.selected_tier ?? "");
  const list: any[] = trip.hospedaje_json;
  const byTier = opts.find((i) => String(list[i]?.tier ?? "").toLowerCase() === tier);
  if (byTier != null) return byTier;
  const byOrder = TIER_ORDER.indexOf(tier);
  return opts[Math.min(opts.length - 1, byOrder >= 0 ? byOrder : Math.floor((opts.length - 1) / 2))];
}

/** ¿El viaje es multi-destino con hoteles por ciudad? */
export function hasCityHotels(trip: any): boolean {
  const list: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  // Un viaje traído ("Ya tengo mi viaje") va por ciudad aunque no haya dicho su hotel en todas.
  return cityStays(trip).length > 1 && (list.some((h) => h?.ciudad) || trip?.itinerario_json?.traido === true);
}

/**
 * Hotel por ciudad según la selección: `selHoteles[ciudad]` (multi), o `selHospedaje` si ese hotel es
 * de la ciudad, o el de la cotización.
 */
export function cityHotelChoices(trip: any, sel: { selHospedaje?: number; selHoteles?: Record<string, number> | null } = {}): CityHotelChoice[] {
  const list: any[] = Array.isArray(trip?.hospedaje_json) ? trip.hospedaje_json : [];
  const travelers = Math.max(1, Math.round(Number(trip?.num_viajeros) || 1));
  return cityStays(trip).map((stay) => {
    const options = hotelOptionsForCity(trip, stay.city);
    const own = Object.entries(sel.selHoteles ?? {}).find(([c]) => sameCity(c, stay.city))?.[1];
    let index = -1;
    let chosen = false;
    if (typeof own === "number" && (own === -2 || options.includes(own))) { index = own; chosen = true; }
    else if (typeof sel.selHospedaje === "number" && sel.selHospedaje >= 0 && options.includes(sel.selHospedaje)) { index = sel.selHospedaje; chosen = true; }
    else index = quotedHotelForCity(trip, stay.city);
    const hotel = index >= 0 ? list[index] : null;
    const total = hotel && price(hotel) > 0 ? Math.round(price(hotel) * stay.nights * hotelPriceRooms(hotel, travelers)) : null;
    return { stay, index, hotel, options, total, chosen };
  });
}
