// Aviso "te compartí un viaje" (F-19 / IATOS-109). Lógica pura, probada en src/test/shareTripNotify.test.ts.
//
// Antes el cliente mandaba title, message y url LIBRES y se guardaban tal cual en las
// notificaciones de los amigos: cualquiera podía mandarles "Tu cuenta será suspendida, entra a
// https://phishing…" con el nombre de IATOS. Ahora el servidor arma el texto con una plantilla fija
// y solo acepta datos estructurados y acotados: destinos (texto corto), fechas ISO y una ruta
// interna de la app. title/message/url del cliente se ignoran.

export const MAX_FRIENDS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Solo rutas internas conocidas (sin esquema ni dominio: no puede apuntar fuera de la app).
const APP_PATH = /^\/dashboard(\/[A-Za-z0-9\-_/]*)?(\?[A-Za-z0-9\-_=&%.+]*)?$/;

export type ShareInput = {
  friendIds: string[];
  destinos: string[];
  fechaSalida: string | null;
  fechaRegreso: string | null;
  path: string | null;
};

/** Destino en texto plano corto: sin URLs, sin saltos ni símbolos de marcado. */
export function cleanPlace(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v
    .replace(/https?:\/\/\S+|www\.\S+/gi, "")
    .replace(/[<>{}[\]`"\\|]/g, "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return t || null;
}

export function parseShareBody(body: unknown): ShareInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const friendIds = Array.from(new Set(
    (Array.isArray(b.friend_ids) ? b.friend_ids : []).filter((x): x is string => typeof x === "string" && UUID.test(x)),
  )).slice(0, MAX_FRIENDS);
  if (!friendIds.length) return null;
  const destinos = (Array.isArray(b.destinos) ? b.destinos : [])
    .map(cleanPlace).filter((x): x is string => !!x).slice(0, 6);
  // Acepta "2026-11-10" o "2026-11-10T…" y guarda solo la fecha.
  const date = (v: unknown) => (typeof v === "string" && ISO_DATE.test(v.slice(0, 10)) ? v.slice(0, 10) : null);
  const path = typeof b.path === "string" && b.path.length <= 200 && APP_PATH.test(b.path) ? b.path : null;
  return { friendIds, destinos, fechaSalida: date(b.fecha_salida), fechaRegreso: date(b.fecha_regreso), path };
}

const fmt = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

/** Título y cuerpo de la notificación, siempre con la misma plantilla. */
export function buildShareNotification(
  senderName: string,
  input: ShareInput,
  appOrigin: string,
): { title: string; body: string } {
  const name = cleanPlace(senderName) ?? "Un amigo";
  const ruta = input.destinos.length ? `: ${input.destinos.join(" → ")}` : "";
  const fechas = input.fechaSalida
    ? ` (${fmt(input.fechaSalida)}${input.fechaRegreso ? ` → ${fmt(input.fechaRegreso)}` : ""})`
    : "";
  const link = input.path ? `\n${appOrigin.replace(/\/$/, "")}${input.path}` : "";
  return {
    title: `${name} te compartió un viaje ✈️`,
    body: `Mira este viaje que estoy armando con IATOS AI${ruta}${fechas}.${link}`,
  };
}
