// Decisión de acceso para funciones programadas (verify_jwt = false), sin dependencias de Deno
// para poder probarla. Falla cerrada: sin una credencial válida siempre devuelve false.

export type CronAuthDeps = {
  env: (k: string) => string | undefined;
  /** true solo si la credencial es de servicio (puede listar usuarios de Auth). */
  probeServiceKey: (bearer: string) => Promise<boolean>;
  /** true si el secreto coincide con el de Supabase Vault (función verify_cron_secret). */
  verifyVaultSecret: (secret: string) => Promise<boolean>;
};

/** Comparación en tiempo constante para que el tiempo de respuesta no revele el secreto. */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Solo las llaves de servicio tienen esta forma; evita gastar una llamada a Auth con basura. */
export const looksLikeServiceKey = (bearer: string) => /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(bearer) || /^sb_secret_[\w-]{10,}$/.test(bearer);

export async function checkCronAuth(headers: Headers, deps: CronAuthDeps): Promise<boolean> {
  const cronHeader = headers.get("x-cron-secret") ?? headers.get("x-cron-key") ?? "";
  const bearer = (headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  const cronSecret = deps.env("CRON_SECRET") ?? "";
  if (cronSecret && safeEqual(cronHeader, cronSecret)) return true;

  const serviceKey = deps.env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && safeEqual(bearer, serviceKey)) return true;

  // A project can hold both a legacy JWT service key and a new sb_secret_ key, so
  // a valid credential may not match the env string. Ask Auth instead: only a
  // service-role credential can list users.
  if (bearer && looksLikeServiceKey(bearer)) {
    try {
      if (await deps.probeServiceKey(bearer)) return true;
    } catch {
      // fall through
    }
  }

  // Database schedulers send a secret kept in Supabase Vault (see
  // docs/ops/programar-tareas.sql); it is checked in the database.
  if (cronHeader.length >= 32 && serviceKey) {
    try {
      if ((await deps.verifyVaultSecret(cronHeader)) === true) return true;
    } catch {
      // fall through
    }
  }
  return false;
}
