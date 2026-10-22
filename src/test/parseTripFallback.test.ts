import { describe, it, expect } from "vitest";
import { parseTripFallback } from "@/lib/parseTripFallback";

// Miércoles 21 de octubre de 2026
const today = new Date(2026, 9, 21);

describe("parseTripFallback", () => {
  it("extracts destination and a weekday range", () => {
    const r = parseTripFallback("viaje a puerto escondido a hotel boutique con vista al mar de jueves a lunes", today);
    expect(r.destino).toBe("Puerto Escondido");
    expect(r.fechaSalida).toBe("2026-10-22");
    expect(r.fechaRegreso).toBe("2026-10-26");
  });

  it("keeps accents and handles travelers", () => {
    const r = parseTripFallback("Quiero ir a Mérida con mi pareja el fin de semana", today);
    expect(r.destino).toBe("Mérida");
    expect(r.fechaSalida).toBe("2026-10-23");
    expect(r.fechaRegreso).toBe("2026-10-25");
    expect(r.viajeros).toBe(2);
  });

  it("uses a short query as the destination", () => {
    expect(parseTripFallback("Tokio", today).destino).toBe("Tokio");
    expect(parseTripFallback("algo bonito y barato cerca del mar para descansar", today).destino).toBeNull();
  });

  it("reads an explicit number of travelers", () => {
    expect(parseTripFallback("vacaciones en Cancún para 4 personas", today).viajeros).toBe(4);
  });
});

describe("parseTripFallback · frase natural en Planear (godtier)", () => {
  it("lee destino al inicio, rango explícito y viajeros", () => {
    const r = parseTripFallback("Oaxaca del 12 al 16 de diciembre, 2 personas", today);
    expect(r.destino).toBe("Oaxaca");
    expect(r.fechaSalida).toBe("2026-12-12");
    expect(r.fechaRegreso).toBe("2026-12-16");
    expect(r.viajeros).toBe(2);
  });

  it("rango entre meses que cruza de año y destino de varias palabras", () => {
    const r = parseTripFallback("Ciudad de México, 28 de diciembre al 3 de enero", today);
    expect(r.destino).toBe("Ciudad de México");
    expect(r.fechaSalida).toBe("2026-12-28");
    expect(r.fechaRegreso).toBe("2027-01-03");
  });

  it("un mes ya pasado este año se entiende como el próximo", () => {
    const r = parseTripFallback("Tokio del 3 al 10 de abril", today);
    expect(r.fechaSalida).toBe("2027-04-03");
    expect(r.fechaRegreso).toBe("2027-04-10");
  });

  it("no inventa fechas imposibles ni destinos en frases sin lugar", () => {
    expect(parseTripFallback("Roma del 30 al 31 de febrero", today).fechaSalida).toBeNull();
    expect(parseTripFallback("Mi viaje soñado para descansar con amigos", today).destino).toBeNull();
  });
});
