// Llave de idempotencia por intento para los análisis (IATOS-P1-FREE-02).
// Se guarda en sessionStorage junto con la "firma" de los datos del viaje: si la respuesta se pierde
// (red, recarga, doble clic) el reintento manda la MISMA llave y el servidor devuelve el viaje ya
// guardado sin gastar otro análisis. Al terminar bien se borra: el siguiente análisis es otro intento.
const PREFIX = "iatos:rk:";

const newKey = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function signature(params: unknown): string {
  try {
    return JSON.stringify(params ?? null);
  } catch {
    return String(params);
  }
}

export function getRequestKey(scope: string, params: unknown): string {
  const sig = signature(params);
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREFIX + scope) ?? "null") as { sig?: string; key?: string } | null;
    if (saved?.sig === sig && typeof saved.key === "string") return saved.key;
  } catch {
    /* sessionStorage no disponible (modo privado, vista previa): llave nueva */
  }
  const key = newKey();
  try {
    sessionStorage.setItem(PREFIX + scope, JSON.stringify({ sig, key }));
  } catch {
    /* sin almacenamiento: la llave vale solo para este intento */
  }
  return key;
}

export function clearRequestKey(scope: string) {
  try {
    sessionStorage.removeItem(PREFIX + scope);
  } catch {
    /* nada que limpiar */
  }
}
