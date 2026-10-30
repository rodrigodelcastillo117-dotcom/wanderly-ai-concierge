// Operador IATOS · reservas gestionadas: puede VER las reservas que IATOS tiene en la mano y PEDIR un cambio o una
// cancelación, solo con el sí escrito del viajero (con el folio) y sin ejecutar nada: lo aprueba una persona.
import { describe, expect, it, vi } from "vitest";
import { ejecutarHerramienta, nuevoContexto, OPERADOR_TOOL_NAMES, OPERADOR_TOOLS } from "../../supabase/functions/_shared/operador/herramientas";
import { OPERADOR_SYSTEM } from "../../supabase/functions/_shared/operador/prompt";
import type { CasoTomado, EventoCaso, OperadorDeps } from "../../supabase/functions/_shared/operador/tipos";

const INC = "0e100000-0000-4000-8000-000000000001";
const USER = "0e100000-0000-4000-8000-00000000000a";
const RESERVA = { id: "m1", ref_code: "R-AB23CD", provider: "ratehawk", product_type: "hotel", title: "Hotel Madrid", provider_ref: "361911424",
  status: "confirmada", cancellable: true, free_cancel_until: "2026-12-01T05:00:00Z", changeable: false, policies: { fuente: "RateHawk hotel/order/info" } };

function montar(mensajes: string[], respuestas: Record<string, unknown> = {}) {
  const llamadas: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    llamadas.push({ fn, args });
    if (fn in respuestas) return { data: respuestas[fn], error: null };
    return { data: { ok: true }, error: null };
  });
  const events: EventoCaso[] = mensajes.map((body, i) => ({ id: 100 + i, at: `2026-10-30T10:0${i}:00Z`, kind: i === 0 ? "creado" : "mensaje", actor: "usuario",
    direction: "entrante", channel: "app", body }));
  const caso = {
    ok: true, case: { state: "activo", last_event_id: 0, runs: 0, actions: 0, spend_usd: 0, flight_searches: 0, provider_emails: 0, consents: {}, pending: null, summary: null, follow_up_at: null, last_run_at: null },
    limits: { max_actions: 25, max_spend_usd: 0.8, max_flight_searches: 1, max_provider_emails: 3, lock_seconds: 120 },
    incident: { id: INC, user_id: USER, trip_id: null, title: "Hotel", payload: {}, category: "hotel_problema", severity: "media", origin: "usuario",
      escalation_level: 0, received_at: "2026-10-30T10:00:00Z", next_step: null, next_step_due_at: null, reopen_count: 0 },
    events,
  } as CasoTomado;
  const deps = { db: { rpc }, modelo: null, modeloNombre: "x", ahora: () => new Date("2026-10-30T10:10:00Z"), owner: "op-prueba-gestionadas" } as unknown as OperadorDeps;
  return { ctx: nuevoContexto(deps, caso), llamadas };
}

describe("operador · reservas gestionadas", () => {
  it("las herramientas nuevas existen y ninguna paga, reserva o cancela por sí misma (la regla de nombres sigue)", () => {
    expect(OPERADOR_TOOL_NAMES).toEqual(expect.arrayContaining(["ver_servicios_gestionados", "pedir_cambio_servicio"]));
    expect(OPERADOR_TOOL_NAMES.filter((n) => /pag|reserv|cancel|refund|reembols|book|pay/i.test(n))).toEqual([]);
    const pedir = OPERADOR_TOOLS.find((t) => t.name === "pedir_cambio_servicio")!;
    expect(pedir.description).toMatch(/PIDE \(no ejecuta\)/);
    expect(OPERADOR_SYSTEM).toMatch(/una persona del equipo lo aprueba/);
  });

  it("ver_servicios_gestionados: con su candado (owner) y las reservas sin neto ni margen; sin reservas lo dice claro", async () => {
    const a = montar(["Quiero cancelar mi hotel"], { managed_bookings_for_case: { ok: true, reservas: [RESERVA] } });
    const r = await ejecutarHerramienta("ver_servicios_gestionados", {}, a.ctx);
    expect(a.llamadas[0]).toEqual({ fn: "managed_bookings_for_case", args: { _incident: INC, _owner: "op-prueba-gestionadas" } });
    expect(r).toMatchObject({ ok: true, reservas: [RESERVA] });
    // El folio y el localizador ya son "conocidos": se pueden escribir al viajero sin que el filtro de datos inventados los bloquee.
    expect(a.ctx.conocido.join("\n")).toContain("361911424");
    const b = montar(["x"], { managed_bookings_for_case: { ok: true, reservas: [] } });
    expect(await ejecutarHerramienta("ver_servicios_gestionados", {}, b.ctx)).toMatchObject({ ok: true, reservas: [], nota: expect.stringMatching(/no podemos cancelarlas/) });
  });

  it("sin el sí escrito con el folio no se pide nada (ni se llama a la base)", async () => {
    for (const msgs of [["Quiero cancelar mi hotel"], ["Quiero cancelar", "sí"], ["Sí, cancela R-ZZ99ZZ"], ["Sí, cambia R-AB23CD"]]) {
      const a = montar(msgs);
      const r = await ejecutarHerramienta("pedir_cambio_servicio", { folio: "R-AB23CD", accion: "cancelacion" }, a.ctx);
      expect(r).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
      expect(a.llamadas).toHaveLength(0);
    }
  });

  it("con «Sí, cancela R-AB23CD» del viajero: pide (pendiente de aprobación) con ESE evento como consentimiento", async () => {
    const a = montar(["Quiero cancelar mi hotel", "Sí, cancela R-AB23CD por favor"], {
      managed_booking_request_change: { ok: true, status: "pendiente_aprobacion", politica: { permitido: true, gratis: true } },
    });
    const r = await ejecutarHerramienta("pedir_cambio_servicio", { folio: "r-ab23cd", accion: "cancelacion", detalle: "Se le canceló el vuelo" }, a.ctx);
    expect(r).toMatchObject({ ok: true, estado: "pendiente_aprobacion", nota: expect.stringMatching(/una persona del equipo lo aprueba/) });
    expect(a.llamadas).toEqual([{ fn: "managed_booking_request_change", args: {
      _incident: INC, _owner: "op-prueba-gestionadas", _ref_code: "R-AB23CD", _kind: "cancelacion", _consent_event: 101, _details: { detalle: "Se le canceló el vuelo" } } }]);
    // Nunca llama a un proveedor ni a una función que ejecute: solo a la RPC que registra la solicitud.
    expect(a.llamadas.map((l) => l.fn)).not.toContain("managed_requests_claim");
  });

  it("si la política del proveedor no lo permite, lo dice con el motivo y sugiere una persona", async () => {
    const a = montar(["Sí, cambia R-AB23CD al 24"], { managed_booking_request_change: { ok: false, code: "NOT_ALLOWED", motivo: "El proveedor no permite cambios por API" } });
    const r = await ejecutarHerramienta("pedir_cambio_servicio", { folio: "R-AB23CD", accion: "cambio" }, a.ctx);
    expect(r).toMatchObject({ ok: false, code: "NOT_ALLOWED", motivo: "El proveedor no permite cambios por API", instruccion: expect.stringMatching(/pedir_humano/) });
  });

  it("pedir_permiso para cancelar_servicio exige el folio R-… y le dice al viajero la frase exacta", async () => {
    const a = montar(["Quiero cancelar mi hotel"], { incident_add_event: { ok: true, event_id: 200 } });
    expect(await ejecutarHerramienta("pedir_permiso", { tipo: "cancelar_servicio", mensaje: "¿Cancelo tu hotel? Es gratis hasta el 1 de diciembre." }, a.ctx))
      .toMatchObject({ ok: false });
    const r = await ejecutarHerramienta("pedir_permiso", { tipo: "cancelar_servicio", folio: "R-AB23CD", mensaje: "¿Cancelo tu hotel? Es gratis hasta el 1 de diciembre." }, a.ctx);
    expect(r).toMatchObject({ ok: true, enviado: true });
    const ev = a.llamadas.find((l) => l.fn === "incident_add_event")!;
    expect(String((ev.args._ev as { body: string }).body)).toContain("«Sí, cancela R-AB23CD»");
  });
});
