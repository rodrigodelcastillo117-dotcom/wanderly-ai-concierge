import { describe, it, expect, beforeEach, vi } from "vitest";
import { getRequestKey, clearRequestKey } from "@/lib/requestKey";

const args = { destino: "Cancún", ciudad_origen: "CDMX", fecha_salida: "2026-12-01", fecha_regreso: "2026-12-08", num_viajeros: 2 };

beforeEach(() => sessionStorage.clear());

describe("llave de idempotencia del análisis (sessionStorage)", () => {
  it("doble clic y reintento: misma llave para los mismos datos", () => {
    const k = getRequestKey("analizar-viaje", args);
    expect(getRequestKey("analizar-viaje", { ...args })).toBe(k);
  });

  it("recarga del navegador: la llave sobrevive porque vive en sessionStorage", async () => {
    const k = getRequestKey("analizar-viaje", args);
    vi.resetModules();
    const fresh = await import("@/lib/requestKey");
    expect(fresh.getRequestKey("analizar-viaje", args)).toBe(k);
  });

  it("al terminar bien se limpia: el siguiente análisis es otro intento", () => {
    const k = getRequestKey("analizar-viaje", args);
    clearRequestKey("analizar-viaje");
    expect(getRequestKey("analizar-viaje", args)).not.toBe(k);
  });

  it("otros datos → otra llave; la llave es aceptada por el servidor (8-100 caracteres seguros)", () => {
    const k = getRequestKey("analizar-viaje", args);
    const k2 = getRequestKey("analizar-viaje", { ...args, destino: "Tulum" });
    expect(k2).not.toBe(k);
    expect(k2).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
  });

  it("sin sessionStorage (modo privado) igual devuelve una llave", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getRequestKey("logistics-plan", args)).toMatch(/^[A-Za-z0-9_-]{8,100}$/);
    spy.mockRestore();
  });
});
