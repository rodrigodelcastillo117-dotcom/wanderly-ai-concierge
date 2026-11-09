// El botón de «Enviarme mi selección» dice TODO lo que falta (antes se cortaba en 3 y no decía Osaka).
import { describe, expect, it } from "vitest";
import { notReadyLabel } from "@/lib/selectionEmail";

describe("notReadyLabel", () => {
  it("varios hoteles en una frase, sin perder ninguna ciudad", () =>
    expect(notReadyLabel(["tu vuelo", "hotel en Tokio", "hotel en Kioto", "hotel en Osaka"])).toBe("Elige tu vuelo y hoteles en Tokio, Kioto y Osaka para enviarte la selección"));
  it("un hotel: igual que antes", () => expect(notReadyLabel(["hotel en Atenas"])).toBe("Elige hotel en Atenas para enviarte la selección"));
  it("vuelo y hotel: el texto de siempre", () => expect(notReadyLabel(["tu vuelo", "tu hotel"])).toBe("Elige tu vuelo y hotel para enviarte el resumen"));
});
