// Operador IATOS · el bucle y sus límites con un modelo de guion fijo (sin red, sin correos reales).
import { afterEach, describe, expect, it, vi } from "vitest";
import { accionesEnBitacora, arnes, guion, USER } from "./helpers/operadorHarness";
import { despacharCorreos, MAX_VUELTAS, tickOperador, trabajarCaso } from "../../supabase/functions/_shared/operador/bucle";
import { autorizaVerTodo, costoUsd, datosNoVerificados, promesaIndebida, requiereHumanoYa, ventanaProveedor } from "../../supabase/functions/_shared/operador/politica";
import { OPERADOR_TOOL_NAMES } from "../../supabase/functions/_shared/operador/herramientas";

afterEach(() => { vi.useRealTimers(); });

const HOTEL = { proveedor: "Hotel Roma Centro", tipo: "hotel" as const, email: "reservas@hotelromacentro.example", telefono: "+39 06 1234 5678",
  sitio: "https://hotelromacentro.example", tz: "Europe/Rome", idioma: "it", fuente: { kind: "sitio_oficial" as const, url: "https://hotelromacentro.example/contatti" } };

async function caso(h: ReturnType<typeof arnes>, texto: string, extra: Record<string, unknown> = {}) {
  const r = await h.reportar({ descripcion: texto, origen: "usuario", canal: "app", ...extra });
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}

describe("operador: reglas fijas (politica.ts)", () => {
  it("salud, seguridad y lo crítico van a una persona desde el inicio", () => {
    expect(requiereHumanoYa("salud", "media").si).toBe(true);
    expect(requiereHumanoYa("seguridad", "alta").si).toBe(true);
    expect(requiereHumanoYa("robo", "critica").si).toBe(true);
    expect(requiereHumanoYa("equipaje", "media").si).toBe(false);
  });
  it("horario del proveedor: traslado a las 23:30 en Cancún sale a las 08:00 de su hora; un hotel atiende 24 h", () => {
    const ahora = new Date("2026-10-30T04:30:00Z"); // 23:30 en Cancún (UTC-5)
    const t = ventanaProveedor("traslado", "America/Cancun", ahora);
    expect(t.enviarYa).toBe(false);
    expect(t.horaLocal).toBe("23:30");
    expect(t.enviarDesde.toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(ventanaProveedor("hotel", "Europe/Rome", ahora).enviarYa).toBe(true);
    expect(ventanaProveedor("tour", null, ahora).enviarYa).toBe(true); // sin zona no se adivina
  });
  it("permiso para ver todo: un sí claro; cualquier negación o duda, no", () => {
    expect(autorizaVerTodo("Sí, adelante")).toBe(true);
    expect(autorizaVerTodo("yes go ahead")).toBe(true);
    expect(autorizaVerTodo("no, todavía no")).toBe(false);
    expect(autorizaVerTodo("¿para qué lo necesitas?")).toBe(false);
  });
  it("promesas indebidas y datos sin verificar", () => {
    expect(promesaIndebida("Ya te reembolsamos los 200 euros")).toBeTruthy();
    expect(promesaIndebida("We have refunded your ticket")).toBeTruthy();
    expect(promesaIndebida("Voy a pedir al hotel que revise el cobro")).toBeNull();
    expect(datosNoVerificados("Escribe a reservas@inventado.com o llama al +34 600 111 222", "nada")).toEqual(["reservas@inventado.com", "+34 600 111 222"]);
    expect(datosNoVerificados("Llama al 112", "")).toEqual([]);
    expect(datosNoVerificados("Su teléfono: +39 06 1234 5678", JSON.stringify(HOTEL))).toEqual([]);
  });
  it("costo por llamada con los precios publicados (Sonnet 5.5: 2/10 USD por millón)", () => {
    expect(costoUsd("claude-sonnet-5-5", { input_tokens: 10_000, output_tokens: 1_000 })).toBeCloseTo(0.03, 5);
    expect(costoUsd("modelo-desconocido", { input_tokens: 1_000_000 })).toBe(5); // el más caro conocido
  });
  it("el operador no tiene ninguna herramienta para pagar, reservar o cancelar", () => {
    expect(OPERADOR_TOOL_NAMES.filter((n) => /pag|reserv|cancel|refund|reembols|book|pay/i.test(n))).toEqual([]);
  });
});

describe("operador: bandera, candado e idempotencia", () => {
  it("apagado: no toma nada, no gasta y el tick lo dice", async () => {
    const modelo = guion([]);
    const h = arnes({ enabled: false, modelo });
    const r = await caso(h, "Me cancelaron el vuelo IB6403");
    expect((await trabajarCaso(h.deps, r.id, "nuevo")).resultado).toBe("apagado");
    expect((await tickOperador(h.deps)).apagado).toBe(true);
    expect(modelo.llamadas).toHaveLength(0);
  });

  it("dos operadores a la vez sobre el mismo caso: uno trabaja, el otro queda fuera (candado)", async () => {
    const modelo = guion([[{ name: "escribir_viajero", input: { mensaje: "Ya estoy revisando tu vuelo." } }], "Listo"]);
    const h = arnes({ modelo });
    const r = await caso(h, "Me cancelaron el vuelo IB6403 de Madrid");
    const [a, b] = await Promise.all([trabajarCaso(h.deps, r.id, "nuevo"), trabajarCaso({ ...h.deps, owner: "op-otro-00002" }, r.id, "nuevo")]);
    expect([a.resultado, b.resultado].sort()).toEqual(["ocupado", "trabajado"]);
  });

  it("sin nada nuevo no vuelve a llamar al modelo; un mensaje del viajero lo despierta", async () => {
    const modelo = guion([
      [{ name: "escribir_viajero", input: { mensaje: "Ya estoy revisando tu vuelo." } }, { name: "prometer_seguimiento", input: { siguiente_paso: "Te digo qué opciones hay", minutos: 30 } }], "ok",
      [{ name: "escribir_viajero", input: { mensaje: "Recibido, sigo en ello." } }], "ok",
    ]);
    const h = arnes({ modelo });
    const r = await caso(h, "Me cancelaron el vuelo IB6403 de Madrid");
    expect((await trabajarCaso(h.deps, r.id, "nuevo")).resultado).toBe("trabajado");
    const llamadas = modelo.llamadas.length;
    expect((await trabajarCaso(h.deps, r.id, "vigilante")).resultado).toBe("nada_nuevo");
    expect(modelo.llamadas.length).toBe(llamadas);
    expect((await tickOperador(h.deps)).casos).toEqual([]); // nada que hacer
    h.db.userMessage(r.id, "¿Ya hay noticias?");
    const t = await tickOperador(h.deps);
    expect(t.casos.map((c) => c.resultado)).toEqual(["trabajado"]);
    expect(modelo.llamadas.length).toBeGreaterThan(llamadas);
  });
});

describe("operador: cada acción en la bitácora y nada sin consentimiento", () => {
  it("reclamo: preparar sí; enviar sin el sí del viajero NO; con «Sí, envía C-…» en el caso, sí", async () => {
    const modelo = guion([
      [{ name: "revisar_derechos_vuelo", input: { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", vuelo: "IB6403", fecha: "2026-10-28", aviso_dias: 0 } }],
      [{ name: "preparar_reclamo", input: { tipo: "vuelo", evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", vuelo: "IB6403", fecha: "2026-10-28", aviso_dias: 0, correo_proveedor: "inventado@iberia.example" } }],
      [{ name: "preparar_reclamo", input: { tipo: "vuelo", evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", vuelo: "IB6403", fecha: "2026-10-28", aviso_dias: 0, correo_proveedor: "claims@iberia.example" } }],
      [{ name: "enviar_reclamo", input: { folio: "C-TEST01" } }], // intento sin permiso
      [{ name: "pedir_permiso", input: { tipo: "enviar_reclamo", folio: "C-TEST01", mensaje: "Preparé tu reclamo a Iberia con folio C-TEST01." } }],
      "Esperando su permiso.",
      // Corrida 2: «Mejor espera, todavía no» → intenta enviar y la negación lo impide.
      [{ name: "enviar_reclamo", input: { folio: "C-TEST01" } }],
      [{ name: "escribir_viajero", input: { mensaje: "Entendido, no lo envío. Avísame cuando quieras." } }], "ok",
      // Corrida 3: «Sí, envía C-TEST01».
      [{ name: "enviar_reclamo", input: { folio: "C-TEST01" } }],
      [{ name: "escribir_viajero", input: { mensaje: "Envié tu reclamo C-TEST01 a Iberia. Te aviso cuando respondan." } }, { name: "prometer_seguimiento", input: { siguiente_paso: "Esperamos respuesta de Iberia", minutos: 1440 } }],
      "Enviado.",
    ]);
    const h = arnes({ modelo });
    const r = await caso(h, "Iberia me canceló el vuelo IB6403 de Madrid a México y no me dieron otro. En el mostrador me dieron este correo para reclamar: claims@iberia.example");
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(h.correosReclamo).toHaveLength(0);
    const reclamo = [...h.claims.claims.values()][0];
    expect(reclamo.ref_code).toBe("C-TEST01");
    expect(reclamo.status).toBe("esperando_ok");
    // El modelo no puede "decir" que hubo permiso: tiene que estar escrito por el viajero.
    h.db.userMessage(r.id, "Mejor espera, todavía no");
    await trabajarCaso(h.deps, r.id, "mensaje");
    expect(h.correosReclamo).toHaveLength(0);
    h.db.userMessage(r.id, "Sí, envía C-TEST01");
    await trabajarCaso(h.deps, r.id, "mensaje");
    expect(h.correosReclamo).toHaveLength(1);
    expect(h.correosReclamo[0].to).toBe("claims@iberia.example");
    expect(h.claims.claims.size).toBe(1); // el correo inventado no preparó nada
    expect(reclamo.status).toBe("enviado");
    const acciones = accionesEnBitacora(h.db, r.id);
    expect(acciones).toEqual(expect.arrayContaining(["revisar_derechos_vuelo", "preparar_reclamo", "enviar_reclamo", "pedir_permiso", "escribir_viajero", "prometer_seguimiento"]));
    // Cada acción queda en la bitácora con su resultado (también las rechazadas).
    const ev = h.db.incidents.get(r.id)!.events.filter((e) => e.actor === "iato_ops" && e.kind === "accion");
    expect(ev.some((e) => /enviar_reclamo \(no se pudo\)/.test(String(e.body)))).toBe(true);
    expect(ev.every((e) => typeof (e.data?.operador as { gasto_usd?: number }).gasto_usd === "number")).toBe(true);
  });

  it("ver todo: sin permiso no lee nada; con «sí» del viajero, sí", async () => {
    const modelo = guion([
      [{ name: "ver_viaje", input: {} }],
      [{ name: "pedir_permiso", input: { tipo: "ver_todo", mensaje: "¿Me dejas revisar tu viaje y tus reservas para resolverlo?" } }], "espero",
      [{ name: "ver_viaje", input: { alcance: ["viaje", "reservas"] } }],
      [{ name: "escribir_viajero", input: { mensaje: "Ya revisé tu viaje." } }], "listo",
    ]);
    const h = arnes({ modelo });
    const r = await caso(h, "El hotel dice que no tengo reserva");
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(h.verTodo).not.toHaveBeenCalled();
    h.db.userMessage(r.id, "Sí, adelante");
    await trabajarCaso(h.deps, r.id, "mensaje");
    expect(h.verTodo).toHaveBeenCalledTimes(1);
  });
});

describe("operador: nunca inventa ni promete de más", () => {
  it("correo inventado, contacto desconocido o promesa de reembolso: no sale nada", async () => {
    const modelo = guion([
      [{ name: "escribir_proveedor", input: { contacto_id: "K99", asunto: "Reserva", mensaje: "Hola, ¿tienen la reserva de Ana?" } }],
      [{ name: "escribir_viajero", input: { mensaje: "Escríbeles a reservas@hotel-inventado.com" } }],
      [{ name: "escribir_viajero", input: { mensaje: "Ya te reembolsamos la noche." } }],
      [{ name: "buscar_contacto_proveedor", input: { nombre: "Hotel Roma Centro", tipo: "hotel" } }],
      [{ name: "escribir_proveedor", input: { contacto_id: "K1", asunto: "Prenotazione di Ana Viajera", mensaje: "Buongiorno, la nostra viaggiatrice è alla reception e non trovate la prenotazione. Potete verificare?", idioma: "it" } }],
      [{ name: "escribir_viajero", input: { mensaje: "Le escribí al Hotel Roma Centro (reservas@hotelromacentro.example, +39 06 1234 5678) para que revisen tu reserva." } }, { name: "prometer_seguimiento", input: { siguiente_paso: "Te digo qué responde el hotel", minutos: 30 } }],
      "ok",
    ]);
    const h = arnes({ modelo, sim: { contactoBusqueda: HOTEL } });
    const r = await caso(h, "Estoy en Roma y el hotel dice que no tengo reserva", { ubicacion: { ciudad: "Roma", pais: "IT", zona_horaria: "Europe/Rome" } });
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(h.alViajero.map((m) => m.texto).join("\n")).not.toMatch(/inventado|reembolsamos/);
    expect(h.db.outbox.map((o) => o.to)).toEqual(["reservas@hotelromacentro.example"]);
    expect(h.db.outbox[0].source).toMatchObject({ kind: "sitio_oficial", url: "https://hotelromacentro.example/contatti" });
    expect(h.db.outbox[0].body).toMatch(/Assistente IA di IATOS, per conto di Ana Viajera/);
    await despacharCorreos(h.despacho);
    expect(h.correosProveedor).toHaveLength(1);
    expect(h.correosProveedor[0].replyTo).toMatch(/^operador\+[0-9a-f]{24}@reply\.traveliatos\.life$/);
  });

  it("una sola búsqueda de vuelos por caso (la segunda no se hace)", async () => {
    const q = { origen: "MAD", destino: "MEX", fecha: "2026-10-30" };
    const modelo = guion([[{ name: "buscar_vuelos_alternativos", input: q }], [{ name: "buscar_vuelos_alternativos", input: { ...q, fecha: "2026-10-31" } }],
      [{ name: "escribir_viajero", input: { mensaje: "Encontré 1 opción de referencia para mañana." } }], "ok"]);
    const h = arnes({ modelo, sim: { vuelos: [{ aerolinea: "IB", salida: "2026-10-30T12:00", precio: 900 }] } });
    const r = await caso(h, "Me cancelaron el vuelo de Madrid a México");
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(h.buscarVuelos).toHaveBeenCalledTimes(1);
    expect(h.db.cases.get(r.id)!.flights).toBe(1);
  });
});

describe("operador: si duda, escala (y ningún caso se pierde)", () => {
  it("sin IA disponible → a una persona con resumen", async () => {
    const h = arnes({ modelo: null });
    const r = await caso(h, "Perdí mi maleta en el aeropuerto de Cancún");
    const x = await trabajarCaso(h.deps, r.id, "nuevo");
    expect(x.resultado).toBe("a_humano");
    expect(h.db.incidents.get(r.id)!.assignee).toBe("humano");
    expect(h.db.alerts.some((a) => a.requestId === r.id && a.reason === "necesita_humano")).toBe(true);
  });
  it("la IA falla o se niega → a una persona", async () => {
    for (const paso of [{ falla: 529 }, { refusal: true as const }]) {
      const h = arnes({ modelo: guion([paso]) });
      const r = await caso(h, "El chofer no llegó al aeropuerto");
      expect((await trabajarCaso(h.deps, r.id, "nuevo")).escalado).toBe(true);
      vi.useRealTimers();
    }
  });
  it("salud: aunque el modelo no lo pida, pasa a una persona", async () => {
    const h = arnes({ modelo: guion([[{ name: "lugares_cercanos", input: { tipo: "hospital" } }], [{ name: "escribir_viajero", input: { mensaje: "El hospital más cercano es Hospital Central (Calle 1).", urgente: true } }], "listo"]) });
    const r = await caso(h, "Mi esposa se desmayó en el hotel en Madrid", { ubicacion: { lat: 40.41, lng: -3.70, zona_horaria: "Europe/Madrid" } });
    const x = await trabajarCaso(h.deps, r.id, "nuevo");
    expect(x.escalado).toBe(true);
    expect(h.alViajero[0].urgente).toBe(true);
  });
  it("el viajero escribió y el operador no le contestó → a una persona", async () => {
    const h = arnes({ modelo: guion(["No hago nada."]) });
    const r = await caso(h, "Me cobraron dos veces el hotel");
    expect((await trabajarCaso(h.deps, r.id, "nuevo")).escalado).toBe(true);
  });
  it("bucle sin fin → tope de vueltas → a una persona", async () => {
    const pasos = Array.from({ length: MAX_VUELTAS + 2 }, () => [{ name: "estado_vuelo", input: { vuelo: "IB6403" } }]);
    const h = arnes({ modelo: guion(pasos) });
    const r = await caso(h, "Mi vuelo IB6403 viene retrasado 5 horas");
    const x = await trabajarCaso(h.deps, r.id, "nuevo");
    expect(x.escalado).toBe(true);
    expect(x.acciones.length).toBe(MAX_VUELTAS);
  });
  it("tope de gasto en IA del caso → a una persona", async () => {
    const h = arnes({ modelo: guion([[{ name: "estado_vuelo", input: { vuelo: "IB6403" } }], [{ name: "estado_vuelo", input: { vuelo: "IB6403" } }]], { input_tokens: 200_000, output_tokens: 20_000 }) });
    const r = await caso(h, "Mi vuelo IB6403 viene retrasado 5 horas");
    const x = await trabajarCaso(h.deps, r.id, "nuevo");
    expect(x.escalado).toBe(true);
    expect(h.db.cases.get(r.id)!.spend).toBeLessThanOrEqual(0.8);
  });
  it("sin promesa del modelo, queda una hora de seguimiento (nunca sin siguiente paso)", async () => {
    const h = arnes({ modelo: guion([[{ name: "escribir_viajero", input: { mensaje: "Estoy revisando." } }], "ok"]) });
    const r = await caso(h, "Mi maleta llegó rota");
    await trabajarCaso(h.deps, r.id, "nuevo");
    const inc = h.db.incidents.get(r.id)!;
    expect(inc.assignee).toBe("iato_ops");
    expect(inc.due).toBeGreaterThan(Date.now());
    expect(h.db.cases.get(r.id)!.followUpAt).toBe(inc.due);
  });
});

describe("operador: correo del proveedor en su horario y su respuesta vuelve al caso", () => {
  it("traslado de noche: el correo queda programado para las 08:00 de Cancún y sale entonces", async () => {
    const chofer = { proveedor: "Traslados Caribe", tipo: "traslado" as const, email: "ops@trasladoscaribe.example", telefono: null, sitio: null, tz: "America/Cancun", idioma: "es",
      fuente: { kind: "reserva" as const, booking: "TC-7781" } };
    const h = arnes({ start: new Date("2026-10-30T04:30:00Z"), sim: { contactos: [chofer] }, modelo: guion([
      [{ name: "buscar_contacto_proveedor", input: { nombre: "Traslados Caribe", tipo: "traslado" } }],
      [{ name: "escribir_proveedor", input: { contacto_id: "K1", asunto: "Pasajera Ana Viajera sin traslado TC-7781", mensaje: "Buenas noches, nuestra pasajera llegó y no encuentra al chofer de la reserva TC-7781." } }],
      [{ name: "opciones_traslado", input: { donde: "aeropuerto de Cancún", de_noche: true } }],
      [{ name: "escribir_viajero", input: { mensaje: "Traslados Caribe abre a las 08:00; les escribí. Mientras, toma un taxi del módulo oficial." } }], "ok",
    ]) });
    const r = await caso(h, "Llegué a Cancún y el chofer no está, reserva TC-7781", { ubicacion: { ciudad: "Cancún", zona_horaria: "America/Cancun" } });
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(h.db.outbox).toHaveLength(1);
    expect(new Date(h.db.outbox[0].sendAfter).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect((await despacharCorreos(h.despacho)).enviados).toBe(0);
    h.db.advance(9 * 60);
    expect((await despacharCorreos(h.despacho)).enviados).toBe(1);
    expect(h.db.incidents.get(r.id)!.events.some((e) => e.actor === "iato_ops" && e.channel === "email" && e.direction === "saliente")).toBe(true);
    // Crítico (de noche sin traslado): además pasó a una persona.
    expect(h.db.incidents.get(r.id)!.assignee).toBe("humano");
    expect(USER).toBeTruthy();
  });
});
