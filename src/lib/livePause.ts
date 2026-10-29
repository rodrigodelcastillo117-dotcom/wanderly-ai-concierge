// ¿Las búsquedas de precios en vivo están en pausa? (cuota o presupuesto de SerpApi agotado). El servidor
// lo dice en cada respuesta (busquedas_en_pausa); aquí se recuerda 30 min en esta pestaña para que la
// pantalla de carga del análisis no diga "consultando en vivo" cuando no lo está (auditoría 28-oct-2026).
const KEY = "iatos:busquedas-en-pausa";
const TTL_MS = 30 * 60_000;

export function noteLiveSearchState(data: unknown, now = Date.now()): void {
  const d = data as { busquedas_en_pausa?: unknown; fallas?: unknown } | null;
  const paused = d?.busquedas_en_pausa === true || (Array.isArray(d?.fallas) && d!.fallas.some((x) => /en_pausa/.test(String(x))));
  try {
    if (paused) sessionStorage.setItem(KEY, String(now));
  } catch { /* sin almacenamiento */ }
}

export function liveSearchesPausedRecently(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    return at > 0 && now - at < TTL_MS;
  } catch { return false; }
}
