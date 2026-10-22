// Guardas para "intenciones de un solo uso" que llegan por URL (?q=…, ?autoCheapest=1).
//
// Por qué: esas intenciones disparan un análisis caro (IA + proveedores) que INSERTA
// un viaje. Si quedan en el historial, al pulsar "Atrás" desde el viaje generado la
// página vuelve a montar, relee la URL y crea un viaje duplicado. Además de limpiar la
// URL al consumirla, guardamos aquí (sessionStorage) qué intención ya se procesó y qué
// viaje produjo, para que un remontaje nunca vuelva a lanzar el mismo análisis.

const KEY = "iatos_auto_intents_v1";
// Lo suficiente para cubrir un análisis largo + navegación de ida y vuelta.
const TTL_MS = 30 * 60 * 1000;
// Si un intento quedó "en curso" más de esto, asumimos que falló y se puede reintentar.
const IN_FLIGHT_MS = 3 * 60 * 1000;

export interface IntentRecord {
  requestId: string;
  at: number;
  tripId?: string;
}

type Store = Record<string, IntentRecord>;

function read(now: number): Store {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: Store = raw ? JSON.parse(raw) : {};
    // Purga de entradas viejas para que no crezca sin límite.
    for (const k of Object.keys(parsed)) if (now - (parsed[k]?.at ?? 0) > TTL_MS) delete parsed[k];
    return parsed;
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* sin sessionStorage: seguimos con la limpieza de URL como única defensa */
  }
}

export function intentFingerprint(kind: string, value: string): string {
  return `${kind}:${value.trim().toLowerCase()}`;
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export type ClaimResult =
  | { status: "claimed"; requestId: string }
  | { status: "done"; tripId: string }
  | { status: "in_flight" };

/**
 * Intenta reservar una intención. Solo la primera llamada obtiene "claimed";
 * las siguientes reciben el viaje ya creado o "in_flight" si sigue en proceso.
 */
export function claimIntent(fp: string, now = Date.now()): ClaimResult {
  const store = read(now);
  const prev = store[fp];
  if (prev?.tripId) return { status: "done", tripId: prev.tripId };
  if (prev && now - prev.at < IN_FLIGHT_MS) return { status: "in_flight" };
  const requestId = newRequestId();
  store[fp] = { requestId, at: now };
  write(store);
  return { status: "claimed", requestId };
}

export function completeIntent(fp: string, tripId: string, now = Date.now()) {
  const store = read(now);
  store[fp] = { requestId: store[fp]?.requestId ?? newRequestId(), at: now, tripId };
  write(store);
}

/** Si el análisis falló, liberamos la intención para que el usuario pueda reintentar. */
export function releaseIntent(fp: string, now = Date.now()) {
  const store = read(now);
  delete store[fp];
  write(store);
}
