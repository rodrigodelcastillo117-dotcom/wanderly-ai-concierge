// Lo que encontró la primera evaluación con IA real del Operador (operador-eval, 9-nov-2026, 55 de 95 escenarios):
// 1) pedir_permiso respondía «termina esta corrida» y la IA dejaba sin hacer derechos, contacto del proveedor, etc.;
// 2) creía que escribirle al hotel necesitaba permiso del viajero (solo ver sus datos, enviar un reclamo o pedir un
//    cambio lo necesitan);
// 3) el simulador devolvía «Hospital Central» al pedir policía o consulado y la IA, con razón, pasaba el caso a una persona;
// 4) «IB6403 cancelado otra vez» se tomaba como queja contra IATOS (no decía hotel/aerolínea/chofer).
import { afterEach, describe, expect, it, vi } from "vitest";
import { arnes, guion } from "./helpers/operadorHarness";
import { trabajarCaso } from "../../supabase/functions/_shared/operador/bucle";
import { OPERADOR_SYSTEM, expediente } from "../../supabase/functions/_shared/operador/prompt";
import { detectIncident } from "../../supabase/functions/_shared/incident-detect";

afterEach(() => { vi.useRealTimers(); });

const HOTEL = { proveedor: "Hotel Roma Centro", tipo: "hotel" as const, email: "reservas@hotelromacentro.example", telefono: null,
  sitio: "https://hotelromacentro.example", tz: "Europe/Rome", idioma: "it", fuente: { kind: "sitio_oficial" as const, url: "https://hotelromacentro.example/contatti" } };

const textoDe = (x: unknown): string => JSON.stringify(x);

describe("evaluación real: el permiso no detiene el resto del trabajo", () => {
  it("después de pedir_permiso la herramienta dice que siga, y en la misma corrida sí le escribe al hotel", async () => {
    const modelo = guion([
      [{ name: "pedir_permiso", input: { tipo: "ver_todo", mensaje: "¿Me dejas revisar tu reserva?" } }],
      [{ name: "buscar_contacto_proveedor", input: { nombre: "Hotel Roma Centro", tipo: "hotel", ciudad: "Roma" } }],
      [{ name: "escribir_proveedor", input: { contacto_id: "K1", asunto: "Prenotazione di Ana Viajera", mensaje: "Buongiorno, potete verificare la prenotazione di Ana Viajera?", idioma: "it" } }],
      "ok",
    ]);
    const h = arnes({ modelo, sim: { contactoBusqueda: HOTEL } });
    const r = await h.reportar({ descripcion: "Estoy en Roma y el hotel dice que no tengo reserva", origen: "usuario", canal: "app", ubicacion: { ciudad: "Roma", pais: "IT", zona_horaria: "Europe/Rome" } });
    if (!r.ok) throw new Error("sin caso");
    await trabajarCaso(h.deps, r.id, "nuevo");
    const tras = textoDe(modelo.llamadas[1]);
    expect(tras).not.toMatch(/termina esta corrida/);
    expect(tras).toMatch(/No esperes para lo demás/);
    expect(h.db.outbox.map((o) => o.to)).toEqual(["reservas@hotelromacentro.example"]);
  });

  it("las instrucciones dicen qué necesita permiso (solo 3 cosas) y que pedirlo nunca es el primer paso", () => {
    expect(OPERADOR_SYSTEM).toMatch(/SOLO tres cosas necesitan su sí/);
    expect(OPERADOR_SYSTEM).toMatch(/Pedir permiso nunca es tu primer paso/);
    expect(OPERADOR_SYSTEM).toMatch(/no necesitas su permiso para escribirle al hotel/);
    expect(OPERADOR_SYSTEM).toMatch(/la aerolínea y las ciudades bastan/);
    expect(OPERADOR_SYSTEM).toMatch(/preparar_reclamo y, en la misma corrida, pedir_permiso tipo enviar_reclamo/);
    expect(OPERADOR_SYSTEM).not.toMatch(/Pídelo con pedir_permiso y termina la corrida/);
  });

  it("el expediente ya no sugiere que todo necesita permiso", () => {
    const caso = {
      incident: { id: "11111111-2222-3333-4444-555555555555", category: "hotel_problema", severity: "media", title: "Hotel", trip_id: "t1", payload: {}, next_step: null, next_step_due_at: null },
      case: { last_event_id: 0, actions: 0, spend_usd: 0, flight_searches: 0, provider_emails: 0, consents: {}, pending: null, summary: null },
      limits: { max_actions: 25, max_spend_usd: 0.8, max_flight_searches: 1, max_provider_emails: 3 },
      events: [],
    } as never;
    expect(expediente(caso, "nuevo", new Date("2026-11-09T12:00:00Z"), { humanoYa: null, contactos: [] }))
      .toMatch(/NO lo necesitas para derechos, contactar al proveedor/);
  });
});

describe("evaluación real: el simulador devuelve el tipo de lugar que se pide", () => {
  it("policía → comisaría; consulado → consulado", async () => {
    const h = arnes({ modelo: guion([]) });
    const lug = h.deps.lugares!;
    expect(await lug({ lat: 48.85, lng: 2.35, tipo: "police" }, "u")).toEqual([expect.objectContaining({ nombre: expect.stringMatching(/Comisaría/) })]);
    expect(await lug({ lat: 48.85, lng: 2.35, tipo: "embassy" }, "u")).toEqual([expect.objectContaining({ nombre: expect.stringMatching(/Consulado/) })]);
  });
});

describe("evaluación real: una queja por un vuelo es con la aerolínea, no con IATOS", () => {
  it.each([
    "Vuelo IB6403 cancelado otra vez, ya van dos veces. En el mostrador me dieron este correo para reclamar",
    "Es la tercera vez que me pierden la maleta, qué mal servicio",
  ])("«%s»", (t) => {
    const d = detectIncident(t);
    if (d.queja) expect(d.queja.subtipo).not.toBe("servicio_iatos");
  });

  it("si habla de IATOS, sigue siendo queja contra IATOS", () => {
    const d = detectIncident("Pésimo servicio de ustedes, el vuelo que me recomendaron se canceló y nadie de IATOS me ayudó");
    expect(d.queja?.subtipo).toBe("servicio_iatos");
  });
});

// Segunda evaluación real (9-nov-2026, 95 escenarios): lo que encontró.
describe("evaluación real 2: «te cancelaron» no es una promesa", () => {
  it("contar lo que hizo la aerolínea pasa; prometer sigue bloqueado", async () => {
    const { promesaIndebida } = await import("../../supabase/functions/_shared/operador/politica");
    expect(promesaIndebida("Lamento que te cancelaron el vuelo otra vez")).toBeNull();
    expect(promesaIndebida("Si no te devolvieron el dinero, lo reclamamos")).toBeNull();
    expect(promesaIndebida("Ya te reembolsamos los 200 euros")).toBeTruthy();
    expect(promesaIndebida("Te cancelo la reserva ahora")).toBeTruthy();
    expect(promesaIndebida("Te garantizo el reembolso")).toBeTruthy();
  });
});

describe("evaluación real 2: preparar_reclamo dice qué falta", () => {
  it("sin origen ni destino no responde «BAD_REQUEST» sino la lista de lo que hay que preguntar", async () => {
    const { faltanParaReclamo } = await import("../../supabase/functions/_shared/operador/herramientas");
    expect(faltanParaReclamo({ tipo: "vuelo", aerolinea: "IB", vuelo: "IB6403" })).toEqual(["ciudad de origen (IATA)", "ciudad de destino (IATA)"]);
    expect(faltanParaReclamo({ tipo: "vuelo", aerolinea: "IB", origen: "MAD", destino: "MEX" })).toEqual([]);
    expect(faltanParaReclamo({ tipo: "servicio", problema: "cobro_doble" })).toEqual(["proveedor (nombre)"]);
  });

  it("en el bucle: la IA recibe FALTAN_DATOS con la instrucción de preguntar solo eso", async () => {
    const modelo = guion([[{ name: "preparar_reclamo", input: { tipo: "vuelo", evento: "cancelacion", aerolinea: "IB", vuelo: "IB6403" } }], "ok"]);
    const h = arnes({ modelo });
    const r = await h.reportar({ descripcion: "Vuelo IB6403 cancelado otra vez", origen: "usuario", canal: "app" });
    if (!r.ok) throw new Error("sin caso");
    await trabajarCaso(h.deps, r.id, "nuevo");
    const tras = textoDe(modelo.llamadas[1]);
    expect(tras).toMatch(/FALTAN_DATOS/);
    expect(tras).toMatch(/ciudad de origen/);
    expect(tras).not.toMatch(/BAD_REQUEST/);
  });
});

describe("evaluación real 2: sin nombre del proveedor, busca en SUS reservas por tipo", () => {
  const TRASLADO = { proveedor: "Traslados Madrid", tipo: "traslado" as const, email: "reservas@trasladosmadrid.example", telefono: null, sitio: null,
    tz: "Europe/Madrid", idioma: "es", fuente: { kind: "reserva" as const, booking: "TC-1" } };

  it("un traslado en sus reservas → lo encuentra y le escribe, sin buscar en internet", async () => {
    const modelo = guion([
      [{ name: "buscar_contacto_proveedor", input: { tipo: "traslado" } }],
      [{ name: "escribir_proveedor", input: { contacto_id: "K1", asunto: "Recogida no realizada", mensaje: "Buenos días, nadie llegó a recoger a Ana Viajera en el hotel. ¿Pueden confirmar?", idioma: "es" } }],
      "ok",
    ]);
    const h = arnes({ modelo, sim: { contactos: [TRASLADO], contactoBusqueda: HOTEL } });
    const r = await h.reportar({ descripcion: "Nadie fue a recogerme al hotel para el traslado", origen: "usuario", canal: "app" });
    if (!r.ok) throw new Error("sin caso");
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(h.db.outbox.map((o) => o.to)).toEqual(["reservas@trasladosmadrid.example"]);
  });

  it("sin reservas de ese tipo y sin nombre → pide el nombre; no adivina con internet", async () => {
    const modelo = guion([[{ name: "buscar_contacto_proveedor", input: { tipo: "hotel", ciudad: "Madrid" } }], "ok"]);
    const h = arnes({ modelo, sim: { contactos: [TRASLADO], contactoBusqueda: HOTEL } });
    const r = await h.reportar({ descripcion: "El hotel de Madrid dice que no tengo reserva", origen: "usuario", canal: "app" });
    if (!r.ok) throw new Error("sin caso");
    await trabajarCaso(h.deps, r.id, "nuevo");
    const tras = textoDe(modelo.llamadas[1]);
    expect(tras).toMatch(/FALTA_NOMBRE/);
    expect(tras).not.toMatch(/hotelromacentro/);
  });

  it("dos traslados en sus reservas → no elige: pregunta cuál", async () => {
    const modelo = guion([[{ name: "buscar_contacto_proveedor", input: { tipo: "traslado" } }], "ok"]);
    const h = arnes({ modelo, sim: { contactos: [TRASLADO, { ...TRASLADO, proveedor: "Shuttle Barajas", email: "info@shuttlebarajas.example" }] } });
    const r = await h.reportar({ descripcion: "El chofer no llegó", origen: "usuario", canal: "app" });
    if (!r.ok) throw new Error("sin caso");
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(textoDe(modelo.llamadas[1])).toMatch(/VARIOS/);
    expect(h.db.outbox).toEqual([]);
  });
});

describe("evaluación real 2: los adversarios de «IA rota» no se califican con la IA real", () => {
  it("se reportan como solo_simulado, sin llamar al modelo ni contar en el resumen", async () => {
    const { correrTandaEval } = await import("../../supabase/functions/_shared/operador/eval/servidor");
    const modelo = vi.fn(async () => ({ ok: false as const, status: 500, data: null }));
    const t = await correrTandaEval({ solo: ["X07"], desde: 0, cantidad: 1, tope_usd: 1 }, { modelo: modelo as never, reloj: { fijar: () => {}, soltar: () => {} } as never });
    expect(t.escenarios[0]).toMatchObject({ id: "X07", omitido: "solo_simulado", fallas: [] });
    expect(modelo).not.toHaveBeenCalled();
    expect(t.resumen.total).toBe(0);
  });
});
