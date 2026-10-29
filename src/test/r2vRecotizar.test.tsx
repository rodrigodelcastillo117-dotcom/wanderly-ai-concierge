// R2 viajes P2-4: Budapest decía «Por recotizar» en el total pero arriba «Vuelo: Cotizado · Hospedaje:
// Cotizado · Experiencias: Cotizado», y en Mis viajes la etiqueta era «Cotizado · sin reservar».
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { BookingStateBadge } from "@/components/BookingStateBadge";
import { deriveTripBookingState } from "@/lib/bookingState";
import { invalidQuoteReason } from "@/lib/budgetSanity";
import { readFileSync } from "node:fs";

// Como el Budapest de producción: cotizado, total de $7 (desglose con error).
const BUDAPEST = {
  id: "b1", destino: "Budapest", status: "listo", total_estimado: 7, num_viajeros: 2, moneda: "MXN",
  fecha_salida: "2027-03-10", fecha_regreso: "2027-03-15",
  vuelos_json: [{ aerolinea: "Lufthansa", precio_por_persona: 3 }], hospedaje_json: [{ nombre: "Hotel", precio_noche: 2 }],
  tours_json: [{ nombre: "Tour", precio_por_persona: 2 }], desglose_presupuesto: { vuelos: 3, hospedaje: 2, tours: 2 },
};

describe("Budapest «Por recotizar» en todas las etiquetas", () => {
  it("la cotización es inválida", () => {
    expect(invalidQuoteReason(BUDAPEST)).toBe("total_absurdo");
  });

  it("detalle: ninguna etiqueta dice «Cotizado»", () => {
    render(<BookingStateBadge summary={deriveTripBookingState(BUDAPEST, [])} requote />);
    const text = screen.getByLabelText("Estado de reservas del viaje").textContent!;
    expect(text).toContain("Por recotizar · sin reservar");
    expect(text).toMatch(/Vuelo: Por recotizar/);
    expect(text).not.toMatch(/Cotizado/);
  });

  it("Mis viajes (compacta): «Por recotizar · sin reservar»", () => {
    render(<BookingStateBadge summary={deriveTripBookingState(BUDAPEST, [])} compact requote />);
    expect(screen.getByTestId("trip-booking-state")).toHaveTextContent("Por recotizar · sin reservar");
  });

  it("las dos pantallas le pasan el estado", () => {
    expect(readFileSync("src/pages/Trips.tsx", "utf8")).toMatch(/compact requote=\{!!invalidQuoteReason\(t\)\}/);
    expect(readFileSync("src/pages/TripDetail.tsx", "utf8")).toMatch(/requote=\{requote\} \/>/);
  });
});
