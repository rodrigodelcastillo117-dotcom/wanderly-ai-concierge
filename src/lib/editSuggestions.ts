// Sugerencias de "Editar viaje con IA" a partir del viaje que se está editando (E2E 28-oct-2026: en el
// viaje de Madrid salían "Quita Florencia y agrega Cinque Terre 2 noches" y "termine en Roma": eran
// ejemplos fijos del cliente, iguales para todos los viajes). Solo usan los datos del propio viaje
// (ciudades, fechas, hospedaje elegido); nunca proponen otro destino.
import { tripDestinations } from "../../supabase/functions/_shared/booking/tripRoute.ts";
import { arrivalByLand } from "@/lib/groundTrip";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fmt = (iso: string) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;

export type EditSuggestions = { ejemplos: string[]; placeholder: string };

export function editSuggestions(trip: any): EditSuggestions {
  const cities = tripDestinations(trip);
  const first = cities[0] ?? null;
  const last = cities[cities.length - 1] ?? null;
  const out: string[] = [];
  if (cities.length > 1) {
    out.push(`Agrega una noche más en ${first} y quita una de ${last}`);
    out.push(`Reorganiza los días para pasar más tiempo en ${cities[1]}`);
  } else if (first) {
    out.push(`Agrega una noche más en ${first}`);
    out.push(`Agrega un tour gastronómico en ${first}`);
  }
  // Un viaje por carretera no tiene vuelos (Valle de Bravo, San Miguel de Allende en coche): no se sugieren.
  out.push(arrivalByLand(trip) ? "Baja el presupuesto: hoteles de 3★ y restaurantes más sencillos" : "Baja el presupuesto: hoteles de 3★ y vuelos económicos");
  const salida = typeof trip?.fecha_salida === "string" && ISO.test(trip.fecha_salida) ? trip.fecha_salida : null;
  const regreso = typeof trip?.fecha_regreso === "string" && ISO.test(trip.fecha_regreso) ? trip.fecha_regreso : null;
  if (salida && regreso) out.push(`Cambia las fechas: salgo el ${fmt(addDays(salida, 7))} y regreso el ${fmt(addDays(regreso, 7))}`);
  out.push(cities.length > 1 ? "Agrega un tour gastronómico en cada ciudad" : "Sube el hotel a 4★ cerca del centro");
  const placeholder = first
    ? `Ej: ${cities.length > 1 ? `Agrega una noche en ${first}` : `Agrega una noche más en ${first}`}, sube a 4★ y agrega un tour gastronómico...`
    : "Ej: Sube a 4★, baja el presupuesto o agrega un tour gastronómico...";
  return { ejemplos: out, placeholder };
}
