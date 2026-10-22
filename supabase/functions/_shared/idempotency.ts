// AUD-SEG-05: idempotencia de acciones confirmadas por el usuario (Iato: Confirmar/Reintentar; botón
// de solicitud al Fixer). Sin dependencias de Deno: se prueba con Vitest (src/test/audSegIdempotency.test.tsx).
//
// El cliente genera UNA clave por confirmación y la repite en cada reintento. El servidor la aparta
// (action_idempotency, migración 20261024200000) antes de ejecutar:
//   - clave nueva → ejecuta; si salió bien guarda la respuesta; si falló libera la clave (se puede reintentar).
//   - ya terminada → devuelve la MISMA respuesta sin volver a ejecutar (no se duplica nada).
//   - todavía en curso → 409 IN_PROGRESS (el primer intento sigue trabajando).
// Si la tabla no responde se ejecuta como antes (sin clave): nunca se bloquea una acción por esto.

export const IDEM_KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;

export function idemKeyFrom(v: unknown): string | null {
  return typeof v === "string" && IDEM_KEY_RE.test(v) ? v : null;
}

export type StoredResponse = { status: number; body: Record<string, unknown> };
export type ClaimResult = { state: "new" } | { state: "running" } | { state: "done"; response: StoredResponse };

export interface IdemStore {
  claim(userId: string, scope: string, key: string): Promise<ClaimResult | null>;
  /** response = null libera la clave (la acción falló y se puede reintentar). */
  finish(userId: string, scope: string, key: string, response: StoredResponse | null): Promise<void>;
}

const IN_PROGRESS: StoredResponse = {
  status: 409,
  body: { ok: false, code: "IN_PROGRESS", message: "Tu confirmación anterior sigue en proceso. Espera unos segundos antes de reintentar." },
};

/** Respuesta "bien" que se guarda: 2xx con ok !== false. Lo demás libera la clave. */
const succeeded = (r: StoredResponse) => r.status >= 200 && r.status < 300 && r.body?.ok !== false;

export async function withIdempotency(
  store: IdemStore | null, userId: string, scope: string, key: string | null,
  run: () => Promise<StoredResponse>,
): Promise<StoredResponse & { replay?: boolean }> {
  if (!store || !key) return run();
  let claim: ClaimResult | null = null;
  try { claim = await store.claim(userId, scope, key); } catch { claim = null; }
  if (!claim) return run();
  if (claim.state === "done") return { ...claim.response, body: { ...claim.response.body, idempotent_replay: true }, replay: true };
  if (claim.state === "running") return IN_PROGRESS;
  let out: StoredResponse;
  try {
    out = await run();
  } catch (e) {
    await store.finish(userId, scope, key, null).catch(() => {});
    throw e;
  }
  await store.finish(userId, scope, key, succeeded(out) ? out : null).catch(() => {});
  return out;
}

/** Almacén sobre las RPC action_idem_claim / action_idem_finish (solo service_role). */
// deno-lint-ignore no-explicit-any -- cliente service role sin tipos generados
export function rpcIdemStore(admin: { rpc(fn: string, args: Record<string, unknown>): any }): IdemStore {
  return {
    async claim(userId, scope, key) {
      const { data, error } = await admin.rpc("action_idem_claim", { _user_id: userId, _scope: scope, _key: key });
      if (error || !data || typeof data.state !== "string") return null;
      if (data.state === "done" && data.response && typeof data.response.status === "number") {
        return { state: "done", response: { status: data.response.status, body: data.response.body ?? {} } };
      }
      if (data.state === "running") return { state: "running" };
      return data.state === "new" ? { state: "new" } : null;
    },
    async finish(userId, scope, key, response) {
      await admin.rpc("action_idem_finish", { _user_id: userId, _scope: scope, _key: key, _response: response });
    },
  };
}

/** Clave nueva para el cliente (una por confirmación). */
export function newIdemKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "");
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
