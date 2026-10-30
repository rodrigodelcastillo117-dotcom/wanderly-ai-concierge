// Vigilancia proactiva · avisos de viaje y confirmaciones previas (reglas puras): hora local y tope diario, check-in
// honesto, documentos con las reglas de la Bóveda, clima extremo (MET Norway), alertas oficiales nuevas, plan de
// envío al proveedor (consentimiento, su horario), correo, lectura de la respuesta y plazo sin respuesta.
import { describe, expect, it } from "vitest";
import {
  avisoCheckin, avisoClima, avisosDocumentos, CHECKIN_VERIFICADO, climaExtremo, climaPorRevisar, decidirEnvio, decidirSeguridad,
  siguienteHoraDecente, zonaViajero, type ViajeVentana,
} from "../../supabase/functions/_shared/vigilancia/avisos";
import {
  clasificarRespuesta, correoConfirmacion, direccionConfirmacion, planEnvio, textoPreventivo, venceSinRespuesta, type Confirmacion,
} from "../../supabase/functions/_shared/vigilancia/confirmaciones";
import { CONFIG_POR_OMISION as cfg } from "../../supabase/functions/_shared/vigilancia/vuelos";
import { buildAlerts } from "@/lib/boveda/alerts";
import type { AvisoFuente } from "../../supabase/functions/_shared/travelAdvisories";

const H = 3_600_000;

describe("hora local del viajero y entrega", () => {
  it("antes del viaje se usa su ciudad de origen; ya en viaje, el destino", () => {
    const t = { destino: "Madrid", ciudad_origen: "Ciudad de México", fecha_salida: "2026-11-05", fecha_regreso: "2026-11-12" };
    expect(zonaViajero(t, new Date("2026-11-01T12:00:00Z"))).toBe("America/Mexico_City");
    expect(zonaViajero(t, new Date("2026-11-06T12:00:00Z"))).toBe("Europe/Madrid");
    expect(zonaViajero({ ...t, ciudad_origen: null }, new Date("2026-11-01T12:00:00Z"))).toBe("America/Mexico_City");
  });

  it("de madrugada espera a las 8:00 locales; de día sale ya", () => {
    // 09:00 UTC = 03:00 en CDMX
    const r = siguienteHoraDecente(new Date("2026-11-03T09:00:00Z"), "America/Mexico_City", 8, 21);
    expect(r.toISOString()).toBe("2026-11-03T14:00:00.000Z");
    const d = new Date("2026-11-03T18:00:00Z");
    expect(siguienteHoraDecente(d, "America/Mexico_City", 8, 21)).toBe(d);
  });

  it("lo urgente del vuelo sale a cualquier hora y sin contar el tope", () => {
    expect(decidirEnvio({ urgente: true, zona_horaria: "America/Mexico_City", expira_at: null }, 99, cfg, new Date("2026-11-03T09:00:00Z"))).toEqual({ accion: "enviar" });
  });
  it("lo no urgente: espera la buena hora, respeta el tope diario y se vence si ya no sirve", () => {
    const noche = new Date("2026-11-03T09:00:00Z");
    expect(decidirEnvio({ urgente: false, zona_horaria: "America/Mexico_City", expira_at: null }, 0, cfg, noche)).toMatchObject({ accion: "esperar", motivo: "hora" });
    const dia = new Date("2026-11-03T18:00:00Z");
    expect(decidirEnvio({ urgente: false, zona_horaria: "America/Mexico_City", expira_at: null }, 0, cfg, dia)).toEqual({ accion: "enviar" });
    expect(decidirEnvio({ urgente: false, zona_horaria: "America/Mexico_City", expira_at: null }, 3, cfg, dia)).toMatchObject({ accion: "esperar", motivo: "tope" });
    expect(decidirEnvio({ urgente: false, zona_horaria: "America/Mexico_City", expira_at: "2026-11-03T10:00:00Z" }, 0, cfg, noche)).toEqual({ accion: "vencer" });
  });
});

describe("check-in en línea", () => {
  const t = { id: "t1", user_id: "u1" };
  const v = { id: "v1", vuelo: "AM401", fecha: "2026-11-05", origen: "MEX", destino: "MAD", salida_at: "2026-11-06T03:40:00Z", salida_exacta: true,
    zona_origen: "America/Mexico_City", activo: true, estado: {} };
  it("sin dato verificado de la aerolínea: aviso genérico honesto 24 h antes, una sola vez por vuelo", () => {
    expect(CHECKIN_VERIFICADO.AM).toBeUndefined();
    const a = avisoCheckin(t, v, "America/Mexico_City", new Date("2026-11-04T12:00:00Z"))!;
    expect(a.clave).toBe("checkin:v1");
    expect(a.programado_para).toBe("2026-11-05T03:40:00.000Z");
    expect(a.cuerpo).toMatch(/no tenemos verificado el horario exacto de Aeroméxico/);
    expect(a.urgente).toBe(false);
  });
  it("no se avisa de un vuelo cancelado ni a menos de 2 h", () => {
    expect(avisoCheckin(t, { ...v, estado: { status: "cancelado" } }, "UTC", new Date("2026-11-05T12:00:00Z"))).toBeNull();
    expect(avisoCheckin(t, v, "UTC", new Date("2026-11-06T02:00:00Z"))).toBeNull();
  });
});

describe("documentos (mismas reglas con fuente que la Bóveda)", () => {
  const viaje = (docs: ViajeVentana["documentos"], destino = "Nueva York"): ViajeVentana => ({
    id: "t1", user_id: "u1", destino, pais_destino: null, fecha_salida: "2026-11-10", fecha_regreso: "2026-11-20", documentos: docs,
  });
  const pp = (expires: string) => ({ id: "p1", kind: "pasaporte", title: "Pasaporte", country_code: "MX", expires_on: expires, valid_from: null });
  const ahora = new Date("2026-11-01T18:00:00Z");

  it("EUA con pasaporte mexicano y sin visa → aviso con fuente oficial; coincide con la Bóveda de la app", () => {
    const a = avisosDocumentos(viaje([pp("2030-01-01")]), "America/Mexico_City", ahora);
    expect(a.map((x) => x.clave)).toEqual(["docs:t1:entrada:US"]);
    expect(a[0].cuerpo).toMatch(/travel\.state\.gov/);
    const app = buildAlerts([{ ...pp("2030-01-01"), section: "documento", user_id: "u1" } as never], [{ id: "t1", destino: "Nueva York", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-20" }], "2026-11-01");
    expect(app.some((x) => x.id === "entry-t1" && x.level === "critica")).toBe(true);
  });
  it("con visa vigente no se avisa; pasaporte que vence en el viaje o sin pasaporte sí", () => {
    expect(avisosDocumentos(viaje([pp("2030-01-01"), { id: "v", kind: "visa", title: "Visa EUA", country_code: "US", expires_on: "2031-01-01", valid_from: null }]), "UTC", ahora)).toEqual([]);
    expect(avisosDocumentos(viaje([pp("2026-11-15")]), "UTC", ahora).map((x) => x.clave)).toContain("docs:t1:pasaporte_vence");
    expect(avisosDocumentos(viaje([]), "UTC", ahora).map((x) => x.clave)).toEqual(["docs:t1:sin_pasaporte"]);
  });
  it("viaje nacional: nada", () => {
    expect(avisosDocumentos(viaje([pp("2030-01-01")], "Cancún"), "UTC", ahora)).toEqual([]);
  });
});

describe("clima extremo (MET Norway)", () => {
  it("umbrales: tormenta, lluvia ≥ 30 mm, viento ≥ 60 km/h; un día normal no avisa", () => {
    expect(climaExtremo({ date: "x", tmax: 25, tmin: 15, code: 3, precipMm: 2, windKmh: 20 })).toEqual([]);
    expect(climaExtremo({ date: "x", tmax: 25, tmin: 15, code: 95, precipMm: 40, windKmh: 70 }).length).toBe(3);
  });
  it("revisa el día de salida (origen y destino) solo si es hoy, mañana o pasado", () => {
    const t: ViajeVentana = { id: "t1", user_id: "u1", destino: "Madrid", fecha_salida: "2026-11-02", fecha_regreso: "2026-11-09", ciudad_origen: "Ciudad de México" };
    expect(climaPorRevisar(t, new Date("2026-11-01T12:00:00Z")).map((x) => `${x.ciudad}:${x.papel}`)).toEqual(["Ciudad de México:salida", "Madrid:llegada"]);
    expect(climaPorRevisar(t, new Date("2026-10-25T12:00:00Z"))).toEqual([]);
  });
  it("aviso con fuente y hora de consulta a partir del pronóstico", () => {
    const met = { updatedAt: null, timeseries: [8, 12, 16].map((h) => ({ time: `2026-11-02T${String(h).padStart(2, "0")}:00:00Z`, data: {
      instant: { details: { air_temperature: 14, wind_speed: 25 } }, next_1_hours: { summary: { symbol_code: "heavyrainandthunder" }, details: { precipitation_amount: 15 } },
    } })) };
    const a = avisoClima({ id: "t1", user_id: "u1" }, { ciudad: "Madrid", fecha: "2026-11-02", lng: -3.7, papel: "llegada" }, met as never, "Europe/Madrid", new Date("2026-11-01T12:00:00Z"))!;
    expect(a.titulo).toBe("Clima extremo en Madrid el día que llegas");
    expect(a.cuerpo).toMatch(/tormenta/);
    expect(a.cuerpo).toMatch(/MET Norway/);
    expect(a.clave).toBe("clima:t1:2026-11-02:Madrid");
  });
});

describe("alertas oficiales de seguridad", () => {
  const f = (valor: number, cambio: string): AvisoFuente => ({
    fuente: "state_dept", fuente_nombre: "Departamento de Estado de EUA", para_quien: "ciudadanos estadounidenses",
    nivel: { valor, escala: "1-4", etiqueta: `Nivel ${valor}`, original: "" }, resumen: "", secciones: {}, ultimo_cambio: cambio,
    actualizado_at: "2026-10-01", url: "https://travel.state.gov/x", consultado_at: "", idioma: "en",
  });
  const t = { id: "t1", user_id: "u1", destino: "Lima" };
  it("primera vez: guarda la línea base y solo avisa si el nivel ya es alto", () => {
    expect(decidirSeguridad(t, f(2, "a"), null, "UTC")).toMatchObject({ registrar: { tipo: "seguridad_linea_base" }, aviso: null });
    expect(decidirSeguridad(t, f(3, "a"), null, "UTC").aviso?.titulo).toBe("Alerta oficial para Lima");
  });
  it("después: sin cambio nada; si sube o publica un cambio, una alerta nueva", () => {
    const base = decidirSeguridad(t, f(2, "a"), null, "UTC").registrar!;
    const previo = { firma: String(base.datos.firma), nivel: 2 };
    expect(decidirSeguridad(t, f(2, "a"), previo, "UTC")).toEqual({ registrar: null, aviso: null });
    expect(decidirSeguridad(t, f(3, "b"), previo, "UTC").aviso?.titulo).toBe("Nueva alerta oficial para Lima");
    expect(decidirSeguridad(t, f(1, "c"), previo, "UTC").aviso).toBeNull(); // bajó: se registra, no se alarma
  });
});

describe("confirmaciones previas", () => {
  const c = (p: Partial<Confirmacion> = {}): Confirmacion => ({
    id: "c1", user_id: "u1", trip_id: "t1", origen: "ai_reservation", origen_id: "r1", tipo: "restaurante", proveedor: "Casa Lucio",
    correo: "reservas@casalucio.es", fuente: { kind: "reserva", url: "https://casalucio.es/contacto" }, zona_horaria: "Europe/Madrid", idioma: "es",
    servicio_at: "2026-11-02T20:30:00Z", servicio_local: "2 nov, 21:30", personas: 4, referencia: "IA-7F3K", titular: "Ana Pérez", estado: "pendiente",
    enviar_desde: null, enviada_at: null, reply_token: "a".repeat(24), consentimiento: true, viajero: "Ana Pérez", ...p,
  });
  it("sin consentimiento NO se contacta", () => {
    expect(planEnvio(c({ consentimiento: false }), cfg, new Date("2026-11-01T12:00:00Z"))).toEqual({ accion: "sin_consentimiento" });
  });
  it("con consentimiento: dentro de 48 h y en el horario local del proveedor; de noche, se programa", () => {
    expect(planEnvio(c(), cfg, new Date("2026-11-01T12:00:00Z"))).toMatchObject({ accion: "enviar", horaLocal: "13:00" });
    const noche = planEnvio(c(), cfg, new Date("2026-11-01T23:30:00Z")); // 00:30 en Madrid
    expect(noche).toMatchObject({ accion: "esperar" });
    expect((noche as { desde: Date }).desde.toISOString()).toBe("2026-11-02T09:00:00.000Z"); // 10:00 en Madrid
    expect(planEnvio(c(), cfg, new Date("2026-10-29T12:00:00Z"))).toMatchObject({ accion: "esperar" });
    expect(planEnvio(c(), cfg, new Date("2026-11-02T14:00:00Z"))).toMatchObject({ accion: "vencida" });
  });
  it("correo en el idioma del proveedor, con referencia, sin inventar datos", () => {
    const m = correoConfirmacion(c({ idioma: "en" }));
    expect(m.asunto).toMatch(/Booking reconfirmation · Casa Lucio · Reference IA-7F3K/);
    expect(m.texto).toMatch(/on behalf of our client Ana Pérez to reconfirm their booking for a table on 2 nov, 21:30 for 4 people\. Reference: IA-7F3K\./);
    expect(correoConfirmacion(c()).texto).toMatch(/reconfirmar su reserva de mesa el 2 nov, 21:30 para 4 personas/);
    expect(direccionConfirmacion("a".repeat(24), "reply.traveliatos.life")).toBe(`confirma+${"a".repeat(24)}@reply.traveliatos.life`);
  });
  it("respuesta: problema gana; 'confirma' solo con remitente verificado; lo demás es ambiguo", () => {
    expect(clasificarRespuesta("Confirmado, los esperamos el sábado.", true)).toBe("confirma");
    expect(clasificarRespuesta("Confirmed, see you!", false)).toBe("ambigua");
    expect(clasificarRespuesta("Lo sentimos, no tenemos ninguna reserva a ese nombre.", true)).toBe("problema");
    expect(clasificarRespuesta("We cannot confirm, fully booked", true)).toBe("problema");
    expect(clasificarRespuesta("Gracias por escribir.", true)).toBe("ambigua");
  });
  it("sin respuesta: el plazo vence a las 12 h o 8 h antes del servicio (lo primero)", () => {
    expect(venceSinRespuesta(c({ enviada_at: "2026-11-01T12:00:00Z" }), cfg, new Date("2026-11-01T23:00:00Z"))).toBe(false);
    expect(venceSinRespuesta(c({ enviada_at: "2026-11-01T12:00:00Z" }), cfg, new Date("2026-11-02T00:00:00Z"))).toBe(true);
    expect(venceSinRespuesta(c({ enviada_at: "2026-11-02T08:00:00Z" }), cfg, new Date("2026-11-02T12:31:00Z"))).toBe(true);
  });
  it("texto preventivo: sin alarma, dice qué pasa y que el equipo lo asegura", () => {
    const t = textoPreventivo(c(), "sin_respuesta");
    expect(t.cuerpo).toMatch(/Casa Lucio no respondió/);
    expect(t.cuerpo).toMatch(/asegurarlo antes de que llegues/);
  });
});
