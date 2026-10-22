// N-06: CDMX→Puebla (~130 km) se cotizaba solo con vuelos de 1 escala de 4–5 h. Reglas puras de
// trayecto corto de analizar-viaje.
import { describe, it, expect } from "vitest";
import {
  applyShortTripRules, detectShortTrip, findCity, groundSearchLinks, isReasonableShortFlight,
  groundDoorToDoor, parseDurationMinutes, parseStops, shortFlightVerdict, shortTripPromptBlock,
  shortTripTransportTotal, travelerPrefs,
} from "../../supabase/functions/analizar-viaje/groundTransport.ts";

describe("detectShortTrip", () => {
  it("CDMX → Puebla es corto (aprox. 130–150 km, ~2 h)", () => {
    const t = detectShortTrip("Ciudad de México", "Puebla")!;
    expect(t).not.toBeNull();
    expect(t.approxRoadKm).toBeGreaterThan(110);
    expect(t.approxRoadKm).toBeLessThan(170);
    expect(t.approxDriveHours).toBeGreaterThan(1.4);
    expect(t.approxDriveHours).toBeLessThan(2.5);
  });

  it("reconoce alias y acentos (CDMX, Querétaro, Cuernavaca)", () => {
    expect(detectShortTrip("CDMX", "Santiago de Querétaro")).not.toBeNull();
    expect(detectShortTrip("Mexico City", "cuernavaca, Morelos")).not.toBeNull();
    expect(findCity("León, Guanajuato")?.key).toBe("leon");
  });

  it("trayectos largos o ciudades desconocidas no cambian nada", () => {
    expect(detectShortTrip("Ciudad de México", "Cancún")).toBeNull();
    expect(detectShortTrip("Ciudad de México", "Guadalajara")).toBeNull(); // > 350 km por carretera
    expect(detectShortTrip("Ciudad de México", "Madrid")).toBeNull();
    expect(detectShortTrip("Puebla", "Puebla")).toBeNull();
    expect(detectShortTrip("", "Puebla")).toBeNull();
  });
});

describe("vuelos razonables", () => {
  it("interpreta duraciones y escalas", () => {
    expect(parseDurationMinutes("4h 15m")).toBe(255);
    expect(parseDurationMinutes("5 h 27 min")).toBe(327);
    expect(parseDurationMinutes(95)).toBe(95);
    expect(parseDurationMinutes("—")).toBeNull();
    expect(parseStops("Directo")).toBe(0);
    expect(parseStops("1 escala")).toBe(1);
    expect(parseStops("2 escalas")).toBe(2);
    expect(parseStops("")).toBeNull();
  });

  it("caso real CDMX→Puebla (Google Flights, 22-oct-2026): los vuelos con escala de 4h15–5h27 ya no pasan", () => {
    const t = detectShortTrip("Ciudad de México", "Puebla")!;
    const none = travelerPrefs("");
    for (const minutes of [257, 327, 255]) {
      const v = shortFlightVerdict(1, minutes, t, none);
      expect(v.show).toBe(false);
      expect(v.doorToDoorMin!).toBeGreaterThan(groundDoorToDoor(t).bus * 2);
    }
    // Con la regla anterior (< 3 × manejo) los de 4h15 y 4h17 sí pasaban: por eso se cambió.
    expect(255 < 3 * t.approxDriveHours * 60).toBe(true);
  });

  it("prioriza el directo cuando compite puerta a puerta; con escala solo con ventaja o si lo piden", () => {
    const t = { origin: "A", destination: "B", approxRoadKm: 300, approxDriveHours: 4 }; // ~4 h por carretera
    const none = travelerPrefs("");
    expect(shortFlightVerdict(0, 60, t, none).show).toBe(true); // 1 h + aeropuertos, compite
    expect(shortFlightVerdict(1, 150, t, none).show).toBe(false); // con escala, sin ventaja
    expect(shortFlightVerdict(1, 150, t, travelerPrefs("no me importa hacer escala")).show).toBe(true);
    expect(shortFlightVerdict(1, 150, t, travelerPrefs("vuelo sin escalas")).show).toBe(false);
    const short = detectShortTrip("CDMX", "Puebla")!;
    expect(shortFlightVerdict(0, 50, short, none).show).toBe(false); // directo más lento que el auto
    expect(shortFlightVerdict(0, 50, short, travelerPrefs("quiero ir en avión")).show).toBe(true);
  });

  it("sin datos de duración o escalas no se afirma nada; NaN cuenta como sin dato", () => {
    expect(isReasonableShortFlight(null, 60, 2)).toBe(false);
    expect(isReasonableShortFlight(0, null, 2)).toBe(false);
    expect(isReasonableShortFlight(Number(undefined), 60, 4)).toBe(false);
  });

  it("lee preferencias del viajero de sus notas", () => {
    expect(travelerPrefs("Queremos algo cómodo y en avión")).toMatchObject({ comfort: true, wantsFlight: true, acceptsStops: false });
    expect(travelerPrefs("lo más barato posible")).toMatchObject({ budget: true });
  });
});

describe("applyShortTripRules", () => {
  const t = detectShortTrip("Ciudad de México", "Puebla")!;
  const links = groundSearchLinks(t.origin, t.destination, "2026-12-12");

  it("terrestre siempre 'estimado' con rango y la liga del servidor; vuelos irrazonables fuera", () => {
    const out = applyShortTripRules([
      { tier: "ahorro", modo: "autobus", aerolinea: "Autobús ADO", duracion: "2 h", escalas: "Directo", precio_por_persona: 900, precio_min: 500, precio_max: 400, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: "x", booking_link: "https://inventado.example" },
      { tier: "equilibrio", aerolinea: "Viva Aerobus", duracion: "7h 05m", escalas: "1 escala", precio_por_persona: 6801, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" },
      { tier: "premium", aerolinea: "Aeroméxico", duracion: "1h 0m", escalas: "Directo", precio_por_persona: 3000, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" },
    ], t, links, travelerPrefs("quiero ir en avión")); // el directo de 1 h solo se muestra porque lo pidió
    expect(out.map((v) => v.tier)).toEqual(["ahorro", "premium"]);
    const bus = out[0];
    expect(bus).toMatchObject({ modo: "autobus", fuente_precio: "estimado", estado_dato: "ESTIMADO", precio_min: 400, precio_max: 500, booking_link: links.bus });
    expect(bus.precio_por_persona).toBe(450); // fuera del rango → punto medio
    expect(bus.consultado_at).toBeUndefined();
    expect(bus.notas).toMatch(/estimado/i);
    // El vuelo razonable conserva su fuente (la decide enforceSources antes).
    expect(out[1]).toMatchObject({ modo: "avion", fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO" });
  });

  it("detecta opciones terrestres por el texto y usa la liga de Maps para auto", () => {
    const out = applyShortTripRules([{ tier: "equilibrio", aerolinea: "Auto propio por carretera", duracion: "2 h", escalas: "Carretera", precio_por_persona: 600 }], t, links);
    expect(out[0].modo).toBe("auto");
    expect(out[0].booking_link).toBe(links.car);
  });

  it("si solo había vuelos con escala larga, agrega una opción terrestre SIN precio inventado", () => {
    // Evidencia D5: escalas de 4 h 15 min a 5 h 27 min → duración total muy por encima de 3 × manejo.
    const out = applyShortTripRules([
      { tier: "ahorro", aerolinea: "Volaris", duracion: "6h 50m", escalas: "1 escala", precio_por_persona: 3696, fuente_precio: "serpapi" },
      { tier: "equilibrio", aerolinea: "Viva", duracion: "8h 02m", escalas: "1 escala", precio_por_persona: 6801, fuente_precio: "serpapi" },
    ], t, links);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ modo: "autobus", precio_por_persona: 0, fuente_precio: "estimado", booking_link: links.bus });
    expect(shortTripTransportTotal(out, 2)).toBe(0);
  });

  it("renglón de transporte: opción equilibrio con precio × viajeros", () => {
    expect(shortTripTransportTotal([
      { tier: "ahorro", precio_por_persona: 400 },
      { tier: "equilibrio", precio_por_persona: 700 },
    ], 2)).toBe(1400);
  });
});

describe("ligas y prompt", () => {
  it("Omio directo para autobús (sin el redirect tp.media roto) y Google Maps para auto", () => {
    const l = groundSearchLinks("Ciudad de México", "Puebla", "2026-12-12");
    expect(l.bus).toMatch(/^https:\/\/www\.omio\.com\/search\?fromCity=Ciudad\+de\+M/);
    expect(l.car).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1/);
  });

  it("el prompt pide terrestre estimado con rango y limita los vuelos", () => {
    const p = shortTripPromptBlock(detectShortTrip("CDMX", "Puebla")!);
    expect(p).toMatch(/PUERTA A PUERTA/);
    expect(p).toMatch(/DIRECTOS/);
    expect(p).toMatch(/fuente_precio="estimado"/);
    expect(p).toMatch(/precio_min y precio_max/);
    expect(p).toMatch(/aprox/);
    expect(shortTripPromptBlock(detectShortTrip("CDMX", "Puebla")!, travelerPrefs("barato"))).toMatch(/ahorro = autobús/);
  });
});
