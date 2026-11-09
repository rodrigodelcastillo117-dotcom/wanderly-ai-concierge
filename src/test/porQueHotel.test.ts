import { describe, expect, it } from "vitest";
import { mismoHotel, porQueHotelVivo } from "../../supabase/functions/logistics-plan/porQueHotel.ts";

describe("por qué del hotel en vivo", () => {
  it("otro hotel: no hereda el texto de la IA (MIMARU Ikebukuro no está en Nihonbashi)", () => {
    const t = porQueHotelVivo({ name: "MIMARU TOKYO IKEBUKURO", hotel_class: 3, rating: 4.3 },
      { nombre: "MIMARU Tokyo Nihonbashi", por_que: "Ubicación céntrica impecable en Nihonbashi." });
    expect(t).not.toMatch(/Nihonbashi/);
    expect(t).toBe("3 estrellas · 4.3 en Google · tarifa real consultada hoy en Google Hotels.");
  });
  it("mismo hotel (mayúsculas, acentos, «Hotel»): se queda el texto de la IA", () => {
    expect(porQueHotelVivo({ name: "Hotel Gion Elite Terrace" }, { nombre: "Gion Elite Terrace", por_que: "A pasos de Gion." })).toBe("A pasos de Gion.");
    expect(mismoHotel("MIMARU Tokyo Ginza East", "Mimaru Ginza East")).toBe(true);
    expect(mismoHotel("MIMARU Tokyo Ginza East", "MIMARU Tokyo Ikebukuro")).toBe(false);
  });
  it("sin datos: solo la tarifa consultada", () =>
    expect(porQueHotelVivo({ name: "X" }, null)).toBe("Tarifa real consultada hoy en Google Hotels."));
});
