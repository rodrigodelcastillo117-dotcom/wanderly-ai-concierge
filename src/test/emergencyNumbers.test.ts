import { describe, it, expect } from "vitest";
import { getEmergency, UNKNOWN_EMERGENCY_TEXT } from "@/lib/emergencyNumbers";

describe("getEmergency (SOS)", () => {
  it("países fuera de la lista NO reciben 112 como dato (antes: Canadá mostraba 112)", () => {
    for (const p of ["Canadá", "Chile", "Australia", undefined, ""]) {
      const r = getEmergency(p as any);
      expect(r.verified).toBe(false);
      expect(r.numbers).toBeNull();
    }
  });
  it("reconoce alias en inglés, sin acentos y dentro de 'Ciudad, País'", () => {
    expect(getEmergency("USA").numbers?.policia).toBe("911");
    expect(getEmergency("Japan").numbers?.ambulancia).toBe("119");
    expect(getEmergency("Japon").verified).toBe(true);
    expect(getEmergency("Roma, Italia").numbers).toEqual({ policia: "113", ambulancia: "118", bomberos: "115" });
    expect(getEmergency("EE. UU.").country).toBe("Estados Unidos");
  });
  it("no confunde países por subcadena", () => {
    // "Perú" no debe salir de "Peruvian Andes" ni "Italia" de "Italianos".
    expect(getEmergency("Italianos").verified).toBe(false);
  });
  it("el texto para país desconocido es explícito", () => {
    expect(UNKNOWN_EMERGENCY_TEXT).toContain("Número no confirmado para este país");
    expect(UNKNOWN_EMERGENCY_TEXT).toContain("112");
    expect(UNKNOWN_EMERGENCY_TEXT).toContain("911");
  });
});
