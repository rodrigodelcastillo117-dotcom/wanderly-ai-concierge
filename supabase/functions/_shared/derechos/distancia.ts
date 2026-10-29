// Distancia de gran círculo entre aeropuertos (método que exige el art. 7(4) del Reglamento 261/2004).
// Usa la tabla de _shared/airports.ts (coordenadas del aeropuerto principal de cada ciudad). Un
// aeropuerto secundario de la misma ciudad (ORY, NLU, EWR…) usa las coordenadas de la ciudad: el error
// puede ser de decenas de km, por eso cerca de los umbrales (1 500 / 3 500 km) el motor dice "depende".
import { cityAirports } from "../airports.ts";

export const UMBRALES_KM = [1500, 3500] as const;
/** Margen alrededor de un umbral en el que no afirmamos el tramo (coordenadas por ciudad). */
export const MARGEN_UMBRAL_KM = 60;

export type PuntoAeropuerto = { codigo: string; ciudad: string; pais: string; lat: number; lng: number; exacto: boolean };

export function aeropuerto(codigo: unknown): PuntoAeropuerto | null {
  const raw = String(codigo ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(raw)) return null;
  const c = cityAirports(raw);
  if (!c) return null;
  return { codigo: raw, ciudad: c.name, pais: c.iso2, lat: c.lat, lng: c.lng, exacto: c.airports[0] === raw };
}

export function granCirculoKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

export type Distancia = { km: number | null; cerca_de_umbral: boolean; nota: string | null };

export function distanciaRuta(origen: string, destino: string): Distancia {
  const a = aeropuerto(origen);
  const b = aeropuerto(destino);
  if (!a || !b) return { km: null, cerca_de_umbral: false, nota: `No tenemos coordenadas de ${!a ? origen : destino}: la distancia queda pendiente.` };
  const km = granCirculoKm(a, b);
  const cerca = UMBRALES_KM.some((u) => Math.abs(km - u) <= MARGEN_UMBRAL_KM);
  const aprox = !a.exacto || !b.exacto;
  return {
    km,
    cerca_de_umbral: cerca,
    nota: cerca
      ? `La ruta mide ~${km} km, muy cerca del umbral de ${UMBRALES_KM.find((u) => Math.abs(km - u) <= MARGEN_UMBRAL_KM)} km: el tramo exacto depende de la medición oficial.`
      : aprox ? `Distancia aproximada (~${km} km) con coordenadas de la ciudad.` : null,
  };
}
