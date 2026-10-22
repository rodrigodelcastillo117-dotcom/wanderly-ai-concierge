// Punto 6 del caso Roma → Florencia → Venecia: la tarjeta decía en grande "$280,734 MXN /persona" y
// el total abajo en chico; el dueño no supo si era por 1 o por 2. Ahora el total del viaje para todos
// es la cifra grande y el precio por persona va debajo, etiquetado. Con 1 viajero, una sola cifra.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RealTripTotal } from "@/components/RealTripTotal";
import { CASO_TRIP } from "./fixtures/casoRomaFlorenciaVenecia";

describe("Total del viaje inequívoco", () => {
  it("2 personas: 'Total para 2 personas' con $561,468 MXN en grande y '$280,734 MXN por persona' debajo", () => {
    render(<RealTripTotal trip={CASO_TRIP} noches={10} viajeros={2} />);
    expect(screen.getByTestId("trip-total-label")).toHaveTextContent("Total para 2 personas");
    const big = screen.getByTestId("trip-total-amount");
    expect(big).toHaveTextContent(/^\$561,468 MXN$/);
    expect(big).toHaveAccessibleName("Total para 2 personas: $561,468 MXN");
    expect(screen.getByTestId("trip-total-pp")).toHaveTextContent("$280,734 MXN por persona");
    // La cifra grande ya no es la de por persona ni dice "/ persona".
    expect(big.textContent).not.toMatch(/persona/);
    expect(screen.queryByText(/\/ persona/)).toBeNull();
  });

  it("1 viajero: una sola cifra, sin 'por persona'", () => {
    render(<RealTripTotal trip={{ ...CASO_TRIP, num_viajeros: 1, total_estimado: 300000 }} noches={10} viajeros={1} />);
    expect(screen.getByTestId("trip-total-label")).toHaveTextContent("Total para 1 persona");
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$300,000 MXN");
    expect(screen.queryByTestId("trip-total-pp")).toBeNull();
    expect(screen.queryByText(/por persona/)).toBeNull();
  });

  it("se mantiene lo demás: selección del usuario y cotización guardada", () => {
    render(<RealTripTotal trip={CASO_TRIP} noches={10} viajeros={2} selectionDesglose={{ vuelos: 0, hospedaje: 401960, comida: 71293 }} />);
    expect(screen.getByTestId("trip-total-amount")).toHaveTextContent("$473,253 MXN");
    expect(screen.getByText(/Total con tu selección/)).toBeInTheDocument();
  });
});
