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
