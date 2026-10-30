// "Mi mundo" (Perfil): los países y ciudades de TODOS los viajes del usuario, los ya hechos y los
// planeados, para el globo y el conteo de países. Cálculo puro, sin red. Reglas:
//   · Solo datos reales de sus viajes: las paradas salen del viaje (ruta multidestino o "destino",
//     igual que IATOS Wrapped: tripStops) y el país, del catálogo de la app o del país del viaje.
//   · Coordenadas SOLO de las tablas de la app (airports.ts: ciudades con aeropuerto y lugares sin él,
//     como Sintra o Kioto). Nunca se geocodifica aquí: cero búsquedas de pago. Una ciudad sin
//     coordenadas conocidas igual cuenta su país (se pinta el país), solo no lleva punto.
//   · Hecho = el viaje ya empezó (vivido o en curso, tripPhase de Social). Lo demás (por venir o sin
//     fecha) es planeado. Si un país o ciudad está en los dos, cuenta como hecho.
//   · La ciudad de origen no es un destino: no cuenta.
import { CITIES, TOWNS, normCity } from "../../supabase/functions/_shared/airports.ts";
import { matchCountry } from "../../supabase/functions/_shared/souvenirs.ts";
import { tripStops, type WrappedTrip } from "@/lib/wrapped";
import { tripPhase } from "@/lib/social";

export type MundoEstado = "hecho" | "planeado";

export type MundoTrip = {
  id: string;
  destino: string | null;
  pais_destino?: string | null;
  fecha_salida?: string | null;
  fecha_regreso?: string | null;
  itinerario_json?: unknown;
  /** Lo mismo que itinerario_json.destinations, cuando la consulta solo trae esa parte del JSON. */
  destinations?: unknown;
};

export type MundoCiudad = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  estado: MundoEstado;
  /** ISO2 del país, si se conoce. */
  iso2: string | null;
  /** Viajes en que aparece. */
  viajes: number;
};

export type MundoPais = { iso2: string | null; name: string; flag: string; estado: MundoEstado; ciudades: number };

export type MiMundo = {
  /** Ciudades con coordenadas conocidas (los puntos del globo). */
  ciudades: MundoCiudad[];
  /** Ciudades de los viajes sin coordenadas en las tablas (cuentan su país, no llevan punto). */
  sinCoordenadas: string[];
  paises: MundoPais[];
  paisesHechos: number;
  paisesPlaneados: number;
  ciudadesHechas: number;
  ciudadesPlaneadas: number;
  viajes: number;
};

type Place = { name: string; lat: number; lng: number; iso2: string };
const PLACES = new Map<string, Place>();
for (const c of CITIES) for (const n of [c.name, ...(c.aliases ?? [])]) if (!PLACES.has(normCity(n))) PLACES.set(normCity(n), { name: c.name, lat: c.lat, lng: c.lng, iso2: c.iso2 });
for (const t of TOWNS) for (const n of [t.name, ...(t.aliases ?? [])]) if (!PLACES.has(normCity(n))) PLACES.set(normCity(n), { name: t.name, lat: t.lat, lng: t.lng, iso2: t.iso2 });

/** Coordenadas y país de un lugar conocido por las tablas de la app (sin red). */
export function knownPlace(name: unknown): Place | null {
  return PLACES.get(normCity(name)) ?? null;
}

function countryByIso(iso2: string): { iso2: string; name: string; flag: string } {
  const r = matchCountry(iso2);
  return r ? { iso2: r[0], name: r[1], flag: r[6] } : { iso2, name: iso2, flag: "🌍" };
}

const rank = (e: MundoEstado) => (e === "hecho" ? 1 : 0);
const better = (a: MundoEstado, b: MundoEstado): MundoEstado => (rank(b) > rank(a) ? b : a);

/** Estado del viaje para "Mi mundo": hecho si ya empezó (vivido o en curso). */
export function tripEstado(t: Pick<MundoTrip, "fecha_salida" | "fecha_regreso">, today: string): MundoEstado {
  const ph = tripPhase({ fecha_salida: t.fecha_salida ?? null, fecha_regreso: t.fecha_regreso ?? null } as any, today);
  return ph === "vivido" || ph === "en_curso" ? "hecho" : "planeado";
}

export function buildMiMundo(trips: MundoTrip[], today: string): MiMundo {
  // Todas las ciudades (con o sin coordenadas) y los países, con su mejor estado.
  const ciudades = new Map<string, Omit<MundoCiudad, "lat" | "lng"> & { lat: number | null; lng: number | null }>();
  const paises = new Map<string, MundoPais & { cities: Set<string> }>();
  let viajes = 0;

  for (const trip of trips) {
    const itin = trip.itinerario_json && typeof trip.itinerario_json === "object" && !Array.isArray(trip.itinerario_json)
      ? trip.itinerario_json as Record<string, unknown> : {};
    const destinations = Array.isArray(trip.destinations) ? trip.destinations : itin.destinations;
    const wt: WrappedTrip = { id: trip.id, destino: trip.destino, pais_destino: trip.pais_destino ?? null, itinerario_json: { destinations } };
    const stops = tripStops(wt);
    if (!stops.length) continue;
    viajes++;
    const estado = tripEstado(trip, today);
    const tripCountry = trip.pais_destino ? matchCountry(trip.pais_destino) : null;
    const seenInTrip = new Set<string>();
    for (const s of stops) {
      const place = s.isCity ? knownPlace(s.label) : null;
      // País: el de la parada (catálogo); si no, el de la tabla de ciudades; si no, el país del viaje.
      const iso2 = s.country?.code ?? place?.iso2 ?? null;
      const pais = iso2 ? countryByIso(iso2)
        : s.country ? { iso2: null, name: s.country.name, flag: s.country.flag }
        : tripCountry ? { iso2: tripCountry[0], name: tripCountry[1], flag: tripCountry[6] } : null;
      const cityKey = s.isCity ? normCity(s.label) : "";
      if (pais) {
        const pk = pais.iso2 ?? normCity(pais.name);
        const prev = paises.get(pk);
        if (prev) prev.estado = better(prev.estado, estado);
        else paises.set(pk, { iso2: pais.iso2, name: pais.name, flag: pais.flag, estado, ciudades: 0, cities: new Set() });
        if (cityKey) paises.get(pk)!.cities.add(cityKey);
      }
      if (!cityKey || seenInTrip.has(cityKey)) continue;
      seenInTrip.add(cityKey);
      const prev = ciudades.get(cityKey);
      if (prev) { prev.estado = better(prev.estado, estado); prev.viajes++; continue; }
      ciudades.set(cityKey, { key: cityKey, name: s.label, lat: place?.lat ?? null, lng: place?.lng ?? null, estado, iso2: pais?.iso2 ?? null, viajes: 1 });
    }
  }

  const paisList: MundoPais[] = [...paises.values()]
    .map(({ cities, ...p }) => ({ ...p, ciudades: cities.size }))
    .sort((a, b) => rank(b.estado) - rank(a.estado) || a.name.localeCompare(b.name, "es"));
  const todas = [...ciudades.values()];
  return {
    ciudades: todas.filter((c): c is MundoCiudad => c.lat != null && c.lng != null),
    sinCoordenadas: todas.filter((c) => c.lat == null || c.lng == null).map((c) => c.name),
    paises: paisList,
    paisesHechos: paisList.filter((p) => p.estado === "hecho").length,
    paisesPlaneados: paisList.filter((p) => p.estado === "planeado").length,
    ciudadesHechas: todas.filter((c) => c.estado === "hecho").length,
    ciudadesPlaneadas: todas.filter((c) => c.estado === "planeado").length,
    viajes,
  };
}

/** "3 países", "1 país". */
export const paisesTexto = (n: number) => `${n} ${n === 1 ? "país" : "países"}`;
