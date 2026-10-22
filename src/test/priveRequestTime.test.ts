// R10 Privé (ensayo en producción, 22-oct-2026): la solicitud "Blue Bay Marcel Ravin · 13 nov 20:30"
// se guardó como 2026-11-13T20:30:00+00:00 (21:30 en Mónaco), mientras que "Agregar al viaje" con la
// misma hora guardó 19:30Z (20:30 en Mónaco, correcto). La solicitud ahora usa la zona del destino.
import { describe, expect, it } from "vitest";
import { requestedForIso } from "@/lib/priveCatalogView";

describe("requestedForIso (hora local del destino en solicitudes Privé)", () => {
  it("Mónaco en noviembre: 20:30 locales = 19:30 UTC", () => {
    const iso = requestedForIso("2026-11-13", "20:30", "Europe/Monaco");
    expect(iso).toBe("2026-11-13T20:30:00+01:00");
    expect(new Date(iso!).toISOString()).toBe("2026-11-13T19:30:00.000Z");
  });

  it("Tokio: 20:30 locales = 11:30 UTC (antes quedaba nueve horas corrido)", () => {
    expect(new Date(requestedForIso("2026-11-13", "20:30", "Asia/Tokyo")!).toISOString()).toBe("2026-11-13T11:30:00.000Z");
  });

  it("horario de verano en Mónaco (julio): +02:00", () => {
    expect(requestedForIso("2027-07-10", "13:00", "Europe/Monaco")).toBe("2027-07-10T13:00:00+02:00");
  });

  it("sin fecha no hay hora pedida; hora inválida usa 20:00", () => {
    expect(requestedForIso("", "20:30", "Europe/Monaco")).toBeNull();
    expect(requestedForIso("2026-11-13", "", "Europe/Monaco")).toBe("2026-11-13T20:00:00+01:00");
  });
});
