// N-07: en el viaje, las tarjetas de vuelo no mostraban la procedencia del precio (quedaba
// escondida dentro de "Ver detalle"), mientras que los hoteles sí la muestran a la vista.
import React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { vi, it, expect } from "vitest";

vi.mock("@/components/media/SmartImage", () => ({ SmartImage: () => null }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const motion = new Proxy({}, { get: (_t, tag: string) => (p: any) => React.createElement(tag, strip(p)) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import { ExpandableItemCard } from "@/components/ExpandableItemCard";
import { PriceSourceBadge } from "@/components/PriceSourceBadge";

const now = new Date("2026-10-22T03:00:00Z");

it("la insignia de procedencia del vuelo se ve sin abrir el detalle", () => {
  render(
    <ExpandableItemCard
      image={{ stockQuery: "airplane wing above clouds" }}
      title="Aeroméxico"
      subtitle="5 h 27 min · 1 escala"
      price="$3,696 / persona"
      selectable
      badge={<PriceSourceBadge source="serpapi" consultadoAt="2026-10-22T02:40:00Z" now={now} />}
    >
      <p>Notas del vuelo</p>
    </ExpandableItemCard>,
  );
  expect(screen.getByText("Consultado en vivo · Google")).toBeInTheDocument();
  // El detalle sigue cerrado.
  expect(screen.queryByText("Notas del vuelo")).toBeNull();
});

it("un vuelo estimado o viejo nunca se presenta como en vivo", () => {
  render(<PriceSourceBadge source="serpapi" consultadoAt="2026-10-10T00:00:00Z" now={now} />);
  expect(screen.queryByText(/en vivo/)).toBeNull();
});

it("las opciones de vuelo (Comprar) muestran la insignia de su precio a la vista (igual que los hoteles)", () => {
  // Rediseño del caso Roma: las tarjetas de vuelo viven en "Comprar" (TripPurchasePlan), no en Destinos.
  const src = readFileSync(path.resolve(__dirname, "../components/booking/TripPurchasePlan.tsx"), "utf8");
  const option = src.slice(src.indexOf('data-testid="vuelo-opcion"'));
  const card = option.slice(0, option.indexOf("</button>"));
  // Punto 3: el título no afirma la aerolínea de un estimado (flightAirlineLabel).
  expect(card).toContain("{flightAirlineLabel(v)}");
  expect(card).toMatch(/<PriceSourceBadge className="mt-1" source=\{v\?\.fuente_precio\} estado=\{v\?\.estado_dato\}/);
});
