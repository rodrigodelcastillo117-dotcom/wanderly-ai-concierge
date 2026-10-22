// Detalle del viaje y Mis viajes (grupo godtier): "qué sigue" con una acción, total con qué está
// verificado y qué es estimado, lista agrupada y sin "$0" para borradores.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { vi, it, expect, describe, beforeEach } from "vitest";
import { TripNextStep } from "@/components/TripNextStep";
import { RealTripTotal } from "@/components/RealTripTotal";
import { quoteTrust } from "@/lib/quoteTrust";
import { groupTripsForList } from "@/lib/tripList";
import { localISODatePlus } from "@/lib/localDate";

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; };
const inRouter = (ui: React.ReactNode) => render(
  <MemoryRouter initialEntries={["/dashboard/viajes/t1"]}>
    <Routes>
      <Route path="/dashboard/viajes/t1" element={<>{ui}<div id="trip-destinos">DESTINOS</div><div id="trip-total">TOTAL</div></>} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

const NOW = new Date();
const quoted = { id: "t1", fecha_salida: localISODatePlus(40), fecha_regreso: localISODatePlus(44), total_estimado: 23560, created_at: NOW.toISOString() };

describe("TripNextStep", () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

  it("confirma que quedó guardado y la acción 'reservar' baja a las opciones (no recarga la página)", () => {
    inRouter(<TripNextStep trip={quoted} quote={null} isOwner />);
    expect(screen.getByText("Guardado en Mis viajes")).toBeInTheDocument();
    expect(screen.getByText("Faltan 40 días")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Elige y reserva" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Elegir vuelo y hotel/ }));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(document.getElementById("trip-destinos"));
  });

  it("si cambió el viaje después de cotizar, manda a actualizar la cotización", async () => {
    inRouter(<TripNextStep trip={{ ...quoted, quote_needs_update: true }} quote={null} isOwner={false} />);
    expect(screen.getByText("Viaje compartido contigo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Actualizar cotización/ }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/dashboard/viajes/t1/editar"));
  });

  it("la barra móvil muestra cuánto falta, el total y la misma acción", () => {
    inRouter(<TripNextStep trip={quoted} quote={null} isOwner variant="bar" totalLabel="Total $23,560 MXN" />);
    const bar = screen.getByTestId("trip-next-bar");
    expect(bar.className).toContain("lg:hidden");
    expect(screen.getByText("Total $23,560 MXN")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Elegir vuelo y hotel/ })).toBeInTheDocument();
  });
});

describe("RealTripTotal · verificado vs estimado", () => {
  const trip = { total_estimado: 20520, vuelos_json: [{}], hospedaje_json: [] };
  const trust = quoteTrust({
    valid_until: new Date(Date.now() + 3600_000).toISOString(),
    line_items: [
      { category: "vuelos", label: "Vuelos", amount: 10720, state: "COTIZADO" },
      { category: "hospedaje", label: "Hospedaje", amount: 9800, state: "ESTIMADO" },
    ],
  });

  it("dice qué parte del total se consultó en vivo y cuál es estimada, renglón por renglón", () => {
    render(<RealTripTotal trip={trip} noches={2} viajeros={2} trust={trust} />);
    // Punto 6 (caso Roma): el total para las 2 personas es la cifra grande; por persona va abajo, etiquetado.
    expect(screen.getByTestId("trip-total-label")).toHaveTextContent("Total para 2 personas");
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$20,520 MXN");
    expect(screen.getByTestId("trip-total-pp")).toHaveTextContent("$10,260 MXN por persona");
    expect(screen.getByText("$10,720 MXN con precio consultado en vivo · $9,800 MXN estimado.")).toBeInTheDocument();
    expect(document.querySelector('[data-trust="verificado"]')).toHaveTextContent(/Vuelos.*en vivo/);
    expect(document.querySelector('[data-trust="estimado"]')).toHaveTextContent(/Hospedaje.*estimado/);
    // Sin presupuesto del usuario no se habla de presupuesto (antes: "cotización base respetada").
    expect(screen.queryByText(/presupuesto/i)).toBeNull();
    expect(screen.queryByText(/Inversión real/)).toBeNull();
  });

  it("sin renglones no afirma nada y remite a la etiqueta de cada precio", () => {
    render(<RealTripTotal trip={trip} noches={2} viajeros={2} trust={quoteTrust(null)} />);
    expect(screen.getByText(/Cada precio indica abajo/)).toBeInTheDocument();
  });

  it("con presupuesto lo compara en palabras claras", () => {
    render(<RealTripTotal trip={{ ...trip, presupuesto_objetivo: 30000 }} noches={2} viajeros={2} />);
    expect(screen.getByText("Dentro de tu presupuesto")).toBeInTheDocument();
  });
});

describe("groupTripsForList", () => {
  it("próximos por fecha de salida (sin fecha al final) y pasados aparte, del más reciente", () => {
    const today = "2026-10-22";
    const g = groupTripsForList([
      { id: "a", fecha_salida: "2026-12-01", fecha_regreso: "2026-12-05" },
      { id: "b", fecha_salida: null },
      { id: "c", fecha_salida: "2026-10-21", fecha_regreso: "2026-10-25" },
      { id: "d", fecha_salida: "2026-01-01", fecha_regreso: "2026-01-05" },
      { id: "e", fecha_salida: "2026-08-01", fecha_regreso: "2026-08-05" },
    ], today);
    expect(g.map((x) => [x.title, x.trips.map((t) => t.id)])).toEqual([
      ["Próximos y en curso", ["c", "a", "b"]],
      ["Viajes pasados", ["e", "d"]],
    ]);
  });
});
