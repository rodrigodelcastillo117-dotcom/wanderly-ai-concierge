// Distancia en línea recta entre dos coordenadas (fórmula del haversine), en km.
// Vive en _shared porque la usan analizar-viaje (trayectos cortos) y el planificador de Privé
// (concierge-chat): el empaquetador de Supabase solo incluye la carpeta de cada función y _shared,
// así que una función no puede importar archivos de otra.
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
