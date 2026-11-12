// Recorrido 12-nov-2026 (C-WH9MRS): el Operador pedía permiso para «leer tus correos» cuando el hotel ya había respondido y
// IATOS ya había leído la respuesta. Ahora la consulta con ver_reclamos, sin permiso (es parte del caso).
import { expect, it } from "vitest";
import { ejecutarHerramienta, nuevoContexto, OPERADOR_TOOL_NAMES } from "../../supabase/functions/_shared/operador/herramientas";
import { OPERADOR_SYSTEM } from "../../supabase/functions/_shared/operador/prompt";
import type { CasoTomado, OperadorDeps } from "../../supabase/functions/_shared/operador/tipos";

const INC = "0e100000-0000-4000-8000-000000000002";
const USER = "0e100000-0000-4000-8000-00000000000b";
const CLAIMS = [
  { id: "c1", ref_code: "C-WH9MRS", provider_name: "Hotel Prueba IATOS", status: "necesita_usuario", recipient_email: "hotel@prueba.example", sent_at: "2026-11-12T01:13:43Z",
    reply: { resumen_es: "El hotel acepta pagar 1500.", resultado_final: "otro", siguiente: { mensaje: "Dicen que aceptan pagar 1500. Avísame cuando veas el pago." } } },
  { id: "c2", ref_code: "C-AAAAAA", provider_name: "Otro", status: "cancelado", recipient_email: null, sent_at: null, reply: null },
];

it("ver_reclamos devuelve lo que respondió el proveedor, sin pedir permiso y sin los cancelados", async () => {
  const rpc = async (fn: string) => fn === "claim_list_for_user" ? { data: CLAIMS, error: null }
    : fn === "claim_forward_token" ? { data: "f".repeat(24), error: null } : { data: false, error: null };
  const caso = {
    ok: true, case: { state: "activo", last_event_id: 0, runs: 0, actions: 0, spend_usd: 0, flight_searches: 0, provider_emails: 0, consents: {}, pending: null, summary: null, follow_up_at: null, last_run_at: null },
    limits: { max_actions: 25, max_spend_usd: 0.8, max_flight_searches: 1, max_provider_emails: 3, lock_seconds: 120 },
    incident: { id: INC, user_id: USER, trip_id: null, title: "Reclamo", payload: {}, category: "hotel_problema", severity: "media", origin: "usuario",
      escalation_level: 0, received_at: "2026-11-12T01:13:00Z", next_step: null, next_step_due_at: null, reopen_count: 0 },
    events: [],
  } as unknown as CasoTomado;
  const deps = { db: { rpc: async () => ({ data: { ok: true }, error: null }) }, modelo: null, modeloNombre: "x", ahora: () => new Date("2026-11-12T03:00:00Z"), owner: "op",
    reclamos: () => ({ db: { rpc }, config: {} }) } as unknown as OperadorDeps;
  const ctx = nuevoContexto(deps, caso);
  const r = await ejecutarHerramienta("ver_reclamos", {}, ctx) as { ok: boolean; reclamos: Array<Record<string, any>> };
  expect(r.ok).toBe(true);
  expect(r.reclamos).toHaveLength(1);
  expect(r.reclamos[0]).toMatchObject({ folio: "C-WH9MRS", enviado_a: "hotel@prueba.example", respuesta: { resumen: "El hotel acepta pagar 1500." } });
  expect(ctx.conocido.join("\n")).toContain("1500");
  expect(OPERADOR_TOOL_NAMES).toContain("ver_reclamos");
  expect(OPERADOR_SYSTEM).toMatch(/NO pidas permiso para leer sus correos/);
});
