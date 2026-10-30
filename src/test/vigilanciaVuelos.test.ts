// Vigilancia proactiva · reglas de vuelos (_shared/vigilancia/vuelos.ts): identificar, frecuencia (nunca antes de
// 48 h, más seguido el día del vuelo), eventos (cancelación, retraso grande, puerta, terminal, desvío), derechos y
// textos honestos. Sin red y sin SerpApi.
import { describe, expect, it } from "vitest";
import {
  busquedasPorVuelo, claveEvento, claveIncidente, CONFIG_POR_OMISION, configDe, detectarEventos, evaluarDerechos, localAUtc, normalizarVuelo,
  proximaRevision, rutaDe, textoEvento, textoNoConcluyente, vueloDeCandidato,
} from "../../supabase/functions/_shared/vigilancia/vuelos";
import type { FlightData } from "../../supabase/functions/_shared/flight-serpapi";

const H = 3_600_000;
const lectura = (p: Partial<FlightData> = {}): FlightData => ({
  status: "a tiempo", scheduled_departure: "21:40", estimated_departure: "21:40", gate: undefined, terminal: undefined, origin: "MEX",
  destination: "MAD", delay_minutes: undefined, provider_status: "Scheduled", scheduled_arrival: "15:05", estimated_arrival: "15:05",
  arrival_delay_minutes: undefined, departure_at: undefined, arrival_at: undefined, ...p,
}) as FlightData;
const cfg = CONFIG_POR_OMISION;

describe("identificar el vuelo", () => {
  it("normaliza números de vuelo y rechaza basura", () => {
    expect(normalizarVuelo("am 401")).toBe("AM401");
    expect(normalizarVuelo("y4-1234")).toBe("Y41234");
    expect(normalizarVuelo("hola")).toBeNull();
    expect(normalizarVuelo("")).toBeNull();
    expect(rutaDe("MEX-MAD")).toEqual(["MEX", "MAD"]);
    expect(rutaDe("mex → mad")).toEqual(["MEX", "MAD"]);
    expect(rutaDe("Ciudad de México")).toEqual([null, null]);
  });

  it("hora local → UTC con la zona del aeropuerto (horario de verano incluido)", () => {
    expect(localAUtc("2026-11-01", "21:40", "America/Mexico_City")?.toISOString()).toBe("2026-11-02T03:40:00.000Z");
    expect(localAUtc("2026-07-01", "10:00", "Europe/Madrid")?.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  it("del itinerario con hora: salida exacta y primera revisión justo 48 h antes", () => {
    const f = vueloDeCandidato({ fuente: "viaje", user_id: "u1", trip_id: "t1", vuelo: "AM 401", fecha: "2026-11-01", hora_salida: "21:40", origen: "MEX", destino: "MAD" },
      new Date("2026-10-30T10:00:00Z"))!;
    expect(f).toMatchObject({ vuelo: "AM401", salida_exacta: true, zona_origen: "America/Mexico_City", salida_at: "2026-11-02T03:40:00.000Z" });
    expect(f.proxima_revision_at).toBe("2026-10-31T03:40:00.000Z");
  });

  it("sin hora: peor caso (fin del día local) para NUNCA revisar antes de 48 h", () => {
    const f = vueloDeCandidato({ fuente: "seguimiento", user_id: "u1", vuelo: "IB6400", fecha: "2026-11-02", ruta: "MAD-MEX" }, new Date("2026-10-30T10:00:00Z"))!;
    expect(f.salida_exacta).toBe(false);
    expect(f.salida_at).toBe("2026-11-02T22:59:00.000Z"); // 23:59 en Madrid
    expect(Date.parse(f.proxima_revision_at)).toBe(Date.parse(f.salida_at) - 48 * H);
  });
});

describe("frecuencia", () => {
  const salida = Date.parse("2026-11-02T12:00:00Z");
  const v = { salida_at: new Date(salida).toISOString(), salida_exacta: true, llegada_at: new Date(salida + 3 * H).toISOString() };
  const at = (h: number) => new Date(salida - h * H);

  it("nada antes de 48 h", () => {
    expect(proximaRevision(v, at(100), 0, false)?.getTime()).toBe(salida - 48 * H);
  });
  it("48–24 h: la siguiente a las 24 h; 24–6 h: cada 6 h; 6–2 h: cada hora; 2–0 h: cada 30 min", () => {
    expect(proximaRevision(v, at(47), 0, false)?.getTime()).toBe(salida - 24 * H);
    expect(proximaRevision(v, at(20), 0, false)?.getTime()).toBe(salida - 14 * H);
    expect(proximaRevision(v, at(8), 0, false)?.getTime()).toBe(salida - 6 * H); // no se salta el umbral
    expect(proximaRevision(v, at(5), 0, false)?.getTime()).toBe(salida - 4 * H);
    expect(proximaRevision(v, at(1.5), 0, false)?.getTime()).toBe(salida - 1 * H);
  });
  it("en el aire hasta 30 min después de la llegada; luego deja de vigilar", () => {
    expect(proximaRevision(v, at(-1), 0, false)?.getTime()).toBe(salida + 3 * H);
    expect(proximaRevision(v, new Date(salida + 3.6 * H), 0, false)).toBeNull();
  });
  it("terminado (aterrizó o se canceló) no se vuelve a revisar; con fallas, más espaciado", () => {
    expect(proximaRevision(v, at(1), 0, true)).toBeNull();
    expect(proximaRevision(v, at(1.9), 3, false)?.getTime()).toBe(salida - 0.9 * H);
    expect(proximaRevision(v, at(10), 6, false)?.getTime()).toBe(salida - 6 * H);
    expect(proximaRevision(v, at(3), 6, false)?.getTime()).toBe(salida - 2 * H);
  });
  it("costo acotado: ~16 búsquedas por vuelo de 3 h y ~18 por uno de 11 h", () => {
    expect(busquedasPorVuelo(3)).toBeLessThanOrEqual(16);
    expect(busquedasPorVuelo(11)).toBeLessThanOrEqual(19);
  });
});

describe("eventos", () => {
  it("cancelación: un evento urgente con incidente; ya no se vigila", () => {
    const r = detectarEventos({ status: "a tiempo" }, lectura({ status: "cancelado", provider_status: "Canceled" }), cfg);
    expect(r.eventos).toEqual([expect.objectContaining({ tipo: "cancelado", incidente: true, urgente: true })]);
    expect(r.terminado).toBe(true);
    expect(detectarEventos(r.estado, lectura({ status: "cancelado" }), cfg).eventos).toEqual([]);
  });

  it("retraso: 45 min no; 1 h aviso sin incidente; 2 h+ incidente; cada hora más vuelve a avisar", () => {
    expect(detectarEventos({}, lectura({ status: "retrasado", delay_minutes: 45 }), cfg).eventos).toEqual([]);
    const r1 = detectarEventos({}, lectura({ status: "retrasado", delay_minutes: 70 }), cfg);
    expect(r1.eventos[0]).toMatchObject({ tipo: "retraso", incidente: false, banda: 1 });
    const r2 = detectarEventos(r1.estado, lectura({ status: "retrasado", delay_minutes: 130, estimated_departure: "23:50" }), cfg);
    expect(r2.eventos[0]).toMatchObject({ tipo: "retraso", incidente: true, banda: 2, ahora: "23:50" });
    expect(detectarEventos(r2.estado, lectura({ status: "retrasado", delay_minutes: 150 }), cfg).eventos).toEqual([]);
    const r4 = detectarEventos(r2.estado, lectura({ status: "retrasado", delay_minutes: 245 }), cfg);
    expect(r4.eventos[0]).toMatchObject({ banda: 4, incidente: true, retrasoMin: 245 });
  });

  it("puerta: la primera asignación no es un cambio; el cambio sí (sin incidente por omisión)", () => {
    const r0 = detectarEventos({}, lectura({ gate: "A3" }), cfg);
    expect(r0.eventos).toEqual([]);
    const r1 = detectarEventos(r0.estado, lectura({ gate: "B12" }), cfg);
    expect(r1.eventos).toEqual([expect.objectContaining({ tipo: "puerta", antes: "A3", ahora: "B12", incidente: false })]);
    expect(detectarEventos(r0.estado, lectura({ gate: "B12" }), { ...cfg, incidente_por_puerta: true }).eventos[0].incidente).toBe(true);
    const t = detectarEventos({ terminal: "1" }, lectura({ terminal: "2" }), cfg);
    expect(t.eventos[0]).toMatchObject({ tipo: "terminal", antes: "1", ahora: "2" });
  });

  it("desvío solo si la fuente lo dice (DIVERTED); un destino distinto NO se interpreta como desvío", () => {
    expect(detectarEventos({ destino: "MAD" }, lectura({ status: "en vuelo", provider_status: "Diverted", destination: "BCN" }), cfg).eventos[0])
      .toMatchObject({ tipo: "desvio", incidente: true });
    expect(detectarEventos({ destino: "MAD" }, lectura({ status: "en vuelo", provider_status: "En Route", destination: "BCN" }), cfg).eventos).toEqual([]);
  });

  it("un estado desconocido no borra lo anterior ni inventa eventos", () => {
    const r = detectarEventos({ status: "retrasado", gate: "A3", banda: 2 }, lectura({ status: "desconocido", provider_status: "" }), cfg);
    expect(r.eventos).toEqual([]);
    expect(r.estado).toMatchObject({ status: "retrasado", gate: "A3", banda: 2 });
  });

  it("claves idempotentes: el incidente es uno por vuelo/evento/viajero; el hallazgo, por banda o puerta", () => {
    expect(claveIncidente("AM401", "2026-11-01", "retraso", "u1")).toBe("vigilancia:AM401:2026-11-01:retraso:u1");
    expect(claveIncidente("AM401", "2026-11-01", "terminal", "u1")).toBe("vigilancia:AM401:2026-11-01:puerta:u1");
    expect(claveEvento("v1", { tipo: "retraso", incidente: true, urgente: true, banda: 4 })).toBe("vuelo:v1:retraso:4");
    expect(claveEvento("v1", { tipo: "puerta", incidente: false, urgente: true, ahora: "B12" })).toBe("vuelo:v1:puerta:B12");
  });
});

describe("derechos y textos", () => {
  const ahora = new Date("2026-10-30T10:00:00Z");
  it("cancelación MAD→MEX: UE 261/2004 y Ley de Aviación Civil de México, con lo que hay que hacer ya", () => {
    const r = evaluarDerechos({ tipo: "cancelado", incidente: true, urgente: true }, { vuelo: "IB6400", fecha: "2026-10-31", origen: "MAD", destino: "MEX", salida_at: "2026-10-31T10:00:00Z" }, ahora)!;
    expect(r.caso).toMatchObject({ evento: "cancelacion", aviso_dias: 1 });
    expect(r.resumen.regimenes.join(" ")).toMatch(/261\/2004/);
    expect(r.resumen.regimenes.join(" ")).toMatch(/Aviación Civil \(México\)/);
    expect(r.resumen.texto).toMatch(/600 EUR/);
    expect(r.resumen.ahora.length).toBeGreaterThan(0);
  });
  it("sin ruta no se evalúan derechos (no se inventa)", () => {
    expect(evaluarDerechos({ tipo: "cancelado", incidente: true, urgente: true }, { vuelo: "IB6400", fecha: "2026-10-31", origen: null, destino: null }, ahora)).toBeNull();
    expect(evaluarDerechos({ tipo: "puerta", incidente: false, urgente: true }, { vuelo: "IB6400", fecha: "2026-10-31", origen: "MAD", destino: "MEX" }, ahora)).toBeNull();
  });
  it("el aviso dice la fuente, la hora local de consulta, qué hacer y quién atiende; nunca promete", () => {
    const t = textoEvento({ tipo: "cancelado", incidente: true, urgente: true }, {
      vuelo: "IB6400", fecha: "2026-10-31", origen: "MAD", destino: "MEX", consultado: new Date("2026-10-30T13:05:00Z"), zona: "Europe/Madrid",
      folio: "ABCD1234", operadorActivo: true,
    });
    expect(t.titulo).toBe("Tu vuelo IB6400 aparece cancelado");
    expect(t.cuerpo).toMatch(/Qué hacer ahora/);
    expect(t.cuerpo).toMatch(/consultado a las 14:05/);
    expect(t.cuerpo).toMatch(/Google .*SerpApi/);
    expect(t.cuerpo).toMatch(/ABCD1234: el operador de IATOS ya está buscando vuelos alternativos/);
    expect(t.cuerpo).not.toMatch(/garantiz|te reembolsaremos|seguro que/i);
    const h = textoEvento({ tipo: "cancelado", incidente: true, urgente: true }, { vuelo: "IB6400", fecha: "2026-10-31", origen: "MAD", destino: "MEX", consultado: new Date(), zona: null, folio: "X1", operadorActivo: false });
    expect(h.cuerpo).toMatch(/una persona del equipo IATOS/);
  });
  it("fuente no concluyente: lo dice sin alarmar", () => {
    const t = textoNoConcluyente({ vuelo: "AM401", fecha: "2026-11-01" });
    expect(t.cuerpo).toMatch(/NO significa que haya un problema/);
    expect(t.cuerpo).not.toMatch(/cancelad|retrasad/i);
  });
  it("configDe toma la configuración de la base y rellena lo que falte", () => {
    expect(configDe({ enabled: true, serp_tope_diario: 12 })).toMatchObject({ enabled: true, serp_tope_diario: 12, avisos_tope_diario: 3 });
    expect(configDe(null).enabled).toBe(false);
  });
});
