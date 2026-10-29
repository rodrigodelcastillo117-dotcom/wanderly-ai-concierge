/**
 * Lista blanca del navegador (ronda 2 de la auditoría técnica, P2-5).
 *
 * Los módulos que comparten la app y las funciones de Supabase (resolver.ts, offers.ts, ticketmaster.ts…)
 * importan `./allowlist.ts`, la lista del SERVIDOR: con la justificación interna de cada dominio y la
 * Public Suffix List completa (169 KB en el paquete público). En el build del navegador (y en el servidor
 * de desarrollo) este plugin manda esos imports a src/lib/bookingAllowlist.ts: mismas reglas y mismos
 * dominios, sin notas y con una lista de sufijos reducida. Las funciones de Supabase (Deno) no pasan por
 * Vite y siguen con la lista completa. Vitest tampoco lo usa: las pruebas del servidor prueban el
 * servidor, y src/test/pulidoR2.test.tsx compara las dos listas caso por caso.
 */
import path from "node:path";

export const SERVER_ALLOWLIST = "supabase/functions/_shared/booking/allowlist.ts";
export const CLIENT_ALLOWLIST = "src/lib/bookingAllowlist.ts";

type ResolveCtx = { resolve: (source: string, importer?: string, options?: Record<string, unknown>) => Promise<{ id: string } | null> };

export function clientAllowlist(root: string = __dirname) {
  const server = path.resolve(root, SERVER_ALLOWLIST);
  const client = path.resolve(root, CLIENT_ALLOWLIST);
  return {
    name: "iatos-client-allowlist",
    enforce: "pre" as const,
    async resolveId(this: ResolveCtx, source: string, importer: string | undefined, options: Record<string, unknown> = {}) {
      if (!importer || !/(^|\/)allowlist(\.ts)?$/.test(source)) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!r || path.resolve(r.id.split("?")[0]) !== server) return null;
      return client;
    },
  };
}
