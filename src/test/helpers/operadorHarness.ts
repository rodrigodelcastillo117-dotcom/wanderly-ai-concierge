// Arnés del Operador IATOS para Vitest: base falsa (incidentes + operador + reclamos), canales y búsquedas simuladas
// (nada sale a la red, ningún correo real) y modelos simulados: un guion fijo o una "política" que decide según el caso.
import { vi } from "vitest";
import { createFakeOperadorDb, type FakeOperadorDb } from "./fakeOperadorDb";
import { fakeClaimsDb } from "./fakeClaimsDb";
import { nucleoSobreIncidentes } from "../../../supabase/functions/_shared/derechos/nucleoIncidentes";
import type { ReclamosDeps } from "../../../supabase/functions/_shared/derechos/servicio";
import type { ContactoProveedor, LugarCercano, ModeloOperador, OperadorDeps } from "../../../supabase/functions/_shared/operador/tipos";
import type { DespachoDeps } from "../../../supabase/functions/_shared/operador/bucle";
import { reportIncident, type ReportIncidentInput } from "../../../supabase/functions/_shared/incident-report";

export const USER = "0d000000-0000-4000-8000-00000000000a";

export type Llamada = { name: string; input: Record<string, unknown> };
export type Paso = Llamada[] | string | { falla: number } | { refusal: true };
export type Uso = { input_tokens: number; output_tokens: number };

let toolSeq = 0;
/** Respuesta de la Messages API con herramientas o texto. */
export function respuesta(paso: Paso, uso: Uso = { input_tokens: 3000, output_tokens: 250 }) {
  if (typeof paso === "string") return { ok: true, status: 200, data: { model: "claude-sonnet-5-5", stop_reason: "end_turn", usage: uso, content: [{ type: "text", text: paso }] } };
  if ("falla" in paso) return { ok: false, status: paso.falla, data: null };
  if ("refusal" in paso) return { ok: true, status: 200, data: { model: "claude-sonnet-5-5", stop_reason: "refusal", usage: uso, content: [] } };
  return { ok: true, status: 200, data: { model: "claude-sonnet-5-5", stop_reason: "tool_use", usage: uso,
    content: [{ type: "text", text: "" }, ...paso.map((l) => ({ type: "tool_use", id: `tu_${++toolSeq}`, name: l.name, input: l.input }))] } };
}

/** Modelo con un guion fijo (cada llamada consume un paso; al acabarse, termina con una nota). */
export function guion(pasos: Paso[], uso?: Uso): ModeloOperador & { llamadas: Record<string, unknown>[] } {
  const llamadas: Record<string, unknown>[] = [];
  const f = (async (payload: Record<string, unknown>) => {
    llamadas.push(payload);
    const p = pasos.shift() ?? "Listo.";
    return respuesta(p, uso);
  }) as unknown as ModeloOperador & { llamadas: Record<string, unknown>[] };
  f.llamadas = llamadas;
  return f;
}

export type Simulacion = {
  contactos?: Array<Omit<ContactoProveedor, "id">>;
  contactoBusqueda?: Omit<ContactoProveedor, "id"> | null;
  vueloCache?: Record<string, unknown> | null;
  vuelos?: Array<Record<string, unknown>>;
  lugares?: LugarCercano[];
  nombre?: string;
  flagReclamos?: boolean;
};

export function arnes(o: { start?: Date; enabled?: boolean; modelo: ModeloOperador | null; sim?: Simulacion; limites?: Record<string, number> }) {
  const start = o.start ?? new Date("2026-10-29T14:00:00Z");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  const db: FakeOperadorDb = createFakeOperadorDb({ start, enabled: o.enabled ?? true, limites: o.limites });
  db.setUser(USER, { name: "Ana Viajera", email: "ana@example.test" });
  const sim = o.sim ?? {};
  const claims = fakeClaimsDb({ flag: sim.flagReclamos ?? true, now: () => db.now() });
  const correosReclamo: Array<{ to: string | string[]; subject: string }> = [];
  const alViajero: Array<{ titulo: string; texto: string; urgente: boolean }> = [];
  const correosProveedor: Array<{ to: string; subject: string; text: string; replyTo?: string }> = [];
  const buscarVuelos = vi.fn(async () => ({ disponible: (sim.vuelos ?? []).length > 0, fuente: "serpapi (caché)", vuelos: sim.vuelos ?? [] }));
  const verTodo = vi.fn(async () => ({ viaje: [{ destino: "Madrid", fecha_salida: "2026-10-27" }] }));
  const buscarContacto = vi.fn(async () => sim.contactoBusqueda ?? null);
  const lugares = vi.fn(async () => sim.lugares ?? [{ nombre: "Hospital Central", direccion: "Calle 1", telefono: "+34 910 000 111", mapa: "https://maps.example/h" }]);
  const reclamos = (incidentId: string): ReclamosDeps => ({
    db: { rpc: claims.rpc as never },
    sendEmail: async (m) => { correosReclamo.push(m); return { ok: true, id: `re_${correosReclamo.length}` }; },
    callModel: null,
    receivedEmail: async () => null,
    profile: async () => ({ name: sim.nombre ?? "Ana Viajera", email: "ana@example.test" }),
    nucleo: nucleoSobreIncidentes(db, { casoActual: incidentId }),
    config: { replyDomain: "reply.traveliatos.life", appUrl: "https://traveliatos.life/dashboard" },
    now: () => db.now(),
  });
  const deps: OperadorDeps = {
    db, modelo: o.modelo, modeloNombre: "claude-sonnet-5-5", ahora: () => db.now(), owner: "op-prueba-0001",
    verTodo, reclamos,
    avisarViajero: async (_u, m) => { alViajero.push({ titulo: m.titulo, texto: m.texto, urgente: m.urgente }); return [{ ok: true, channel: "telegram", to: "555001" }]; },
    estadoVuelo: async () => sim.vueloCache ?? { sin_dato: true, nota: "Ese vuelo no está en seguimiento." },
    buscarVuelos, lugares, buscarContacto,
    contactosDeReservas: async () => sim.contactos ?? [],
    nombreViajero: async () => sim.nombre ?? "Ana Viajera",
  };
  const despacho: DespachoDeps = {
    db, remitente: "IATOS Operador <operador@traveliatos.life>", dominioRespuesta: "reply.traveliatos.life",
    enviar: async (m) => { correosProveedor.push({ to: m.to, subject: m.subject, text: m.text, replyTo: m.replyTo }); return { ok: true, id: `em_${correosProveedor.length}` }; },
  };
  const reportar = (input: Omit<ReportIncidentInput, "userId"> & { userId?: string }) =>
    reportIncident({ db, deliver: async () => ({ sent: 1, failed: 0 }) }, { userId: USER, ...input } as ReportIncidentInput);
  return { db, deps, despacho, claims, correosReclamo, alViajero, correosProveedor, buscarVuelos, verTodo, buscarContacto, lugares, reportar };
}
export type Arnes = ReturnType<typeof arnes>;

/** Acciones del operador en la bitácora (data.operador.herramienta), en orden. */
export function accionesEnBitacora(db: FakeOperadorDb, id: string): string[] {
  return db.incidents.get(id)!.events
    .filter((e) => e.actor === "iato_ops" && (e.kind === "accion" || e.kind === "decision") && (e.data?.operador as { herramienta?: string } | undefined)?.herramienta)
    .map((e) => String((e.data!.operador as { herramienta: string }).herramienta));
}
