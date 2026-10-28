// Defecto 15 (E2E 28-oct-2026): "Llévame" siempre abría Google Maps en coche, también a unas cuadras.
// Ahora: a pie hasta 1.5 km; transporte público en distancia media en ciudades con buen transporte; coche
// si es lejos o no se sabe dónde está la persona.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { chooseTravelMode, distanceKm, hasGoodTransit } from "@/lib/takeMeThere";
import { TakeMeFromContext, TakeMeThereButton } from "@/components/concierge/TakeMeThereButton";

const SOL = { lat: 40.4169, lng: -3.7035 }; // Puerta del Sol, Madrid
const PRADO = { name: "Museo del Prado", lat: 40.4138, lng: -3.6921, address: "C. de Ruiz de Alarcón, 23, Madrid" }; // ~1 km
const BERNABEU = { name: "Estadio Santiago Bernabéu", lat: 40.4531, lng: -3.6883, address: "Av. de Concha Espina, 1, Madrid" }; // ~4 km
const TOLEDO = { name: "Catedral de Toledo", lat: 39.8567, lng: -4.0237, address: "Toledo" }; // ~68 km
const VALLE = { lat: 19.1925, lng: -100.1306 }; // Valle de Bravo
const PENA = { name: "Peña del Príncipe", lat: 19.1867, lng: -100.1214, address: "Valle de Bravo, Méx." }; // ~1.2 km
const MONARCA = { name: "Santuario Piedra Herrada", lat: 19.2547, lng: -99.9921, address: "Valle de Bravo, Méx." }; // ~16 km

describe("chooseTravelMode", () => {
  it("cerca (≤1.5 km) → a pie", () => {
    expect(distanceKm(SOL, PRADO)).toBeLessThan(1.5);
    expect(chooseTravelMode({ from: SOL, to: PRADO, city: "Madrid" })).toBe("walking");
    expect(chooseTravelMode({ from: VALLE, to: PENA, city: "Valle de Bravo" })).toBe("walking");
  });
  it("distancia media en ciudad con buen transporte → transporte público", () => {
    expect(chooseTravelMode({ from: SOL, to: BERNABEU, city: "Madrid" })).toBe("transit");
    expect(hasGoodTransit("Ciudad de México")).toBe(true);
    expect(hasGoodTransit("Valle de Bravo")).toBe(false);
  });
  it("lejos, sin buen transporte o sin saber dónde está la persona → coche", () => {
    expect(chooseTravelMode({ from: SOL, to: TOLEDO, city: "Madrid" })).toBe("driving");
    expect(chooseTravelMode({ from: VALLE, to: MONARCA, city: "Valle de Bravo" })).toBe("driving");
    expect(chooseTravelMode({ from: null, to: PRADO, city: "Madrid" })).toBe("driving");
    expect(chooseTravelMode({ from: SOL, to: { name: "X", placeId: "ChIJ123456789" }, city: "Madrid" })).toBe("driving");
  });
});

describe("botón Llévame", () => {
  it("con la ubicación de la pantalla abre Google Maps a pie y lo dice", () => {
    render(<TakeMeFromContext.Provider value={{ coords: SOL, city: "Madrid" }}><TakeMeThereButton target={PRADO} /></TakeMeFromContext.Provider>);
    const a = screen.getByTestId("take-me-there") as HTMLAnchorElement;
    expect(a.href).toContain("travelmode=walking");
    expect(a.textContent).toMatch(/Llévame · a pie/);
  });
  it("sin ubicación, en coche como antes", () => {
    render(<TakeMeThereButton target={PRADO} />);
    expect((screen.getByTestId("take-me-there") as HTMLAnchorElement).href).toContain("travelmode=driving");
  });
  it("un modo explícito manda", () => {
    render(<TakeMeThereButton target={PRADO} mode="bicycling" from={{ coords: SOL }} />);
    expect((screen.getByTestId("take-me-there") as HTMLAnchorElement).href).toContain("travelmode=bicycling");
  });
});
