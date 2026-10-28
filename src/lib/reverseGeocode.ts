// Lugar aproximado (ciudad, país) de unas coordenadas para el encabezado del Concierge y la hoja de
// emergencia (BigDataCloud, versión de cliente sin llave). Auditoría 10 #15: el encabezado lo pedía cada
// minuto con las coordenadas exactas y a veces respondía 400 (error rojo en la consola). Ahora:
//   * con 2 decimales (~1 km), que basta para nombrar la ciudad y no manda la ubicación exacta;
//   * una sola vez por zona en la sesión (memoria + sessionStorage);
//   * tras un error se pausa 10 minutos y nunca lanza: sin nombre, la pantalla dice "Tu ubicación".
export type ReverseGeo = { city: string | null; countryCode: string | null };

const mem = new Map<string, ReverseGeo | null>();
const inflight = new Map<string, Promise<ReverseGeo | null>>();
const PREFIX = "iatos.revgeo.v1:";
const PAUSE_KEY = "iatos.revgeo.pause";
const PAUSE_MS = 10 * 60_000;

const r2 = (v: number) => Math.round(v * 100) / 100;
export const reverseGeoKey = (lat: number, lng: number) => `${r2(lat).toFixed(2)},${r2(lng).toFixed(2)}`;

const read = (k: string): ReverseGeo | undefined => {
  try { const v = sessionStorage.getItem(PREFIX + k); return v ? JSON.parse(v) as ReverseGeo : undefined; } catch { return undefined; }
};
const write = (k: string, v: ReverseGeo) => { try { sessionStorage.setItem(PREFIX + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const pausedUntil = () => { try { return Number(sessionStorage.getItem(PAUSE_KEY)) || 0; } catch { return 0; } };
const pause = () => { try { sessionStorage.setItem(PAUSE_KEY, String(Date.now() + PAUSE_MS)); } catch { /* sin almacenamiento */ } };

/** Solo pruebas. */
export function __resetReverseGeocode() {
  mem.clear();
  inflight.clear();
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && (k.startsWith(PREFIX) || k === PAUSE_KEY)) sessionStorage.removeItem(k);
    }
  } catch { /* sin almacenamiento */ }
}

export function reverseGeocode(lat: number, lng: number, fetchImpl: typeof fetch = fetch): Promise<ReverseGeo | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Promise.resolve(null);
  const k = reverseGeoKey(lat, lng);
  if (mem.has(k)) return Promise.resolve(mem.get(k)!);
  const s = read(k);
  if (s) { mem.set(k, s); return Promise.resolve(s); }
  if (Date.now() < pausedUntil()) return Promise.resolve(null);
  const running = inflight.get(k);
  if (running) return running;
  const [la, ln] = k.split(",");
  const p = (async () => {
    try {
      const res = await fetchImpl(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${la}&longitude=${ln}&localityLanguage=es`);
      if (!res.ok) { pause(); return null; }
      const g = await res.json().catch(() => null) as Record<string, unknown> | null;
      const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
      const out: ReverseGeo = { city: str(g?.city) ?? str(g?.locality) ?? str(g?.principalSubdivision), countryCode: str(g?.countryCode) };
      mem.set(k, out);
      write(k, out);
      return out;
    } catch {
      pause();
      return null;
    } finally {
      inflight.delete(k);
    }
  })();
  inflight.set(k, p);
  return p;
}
