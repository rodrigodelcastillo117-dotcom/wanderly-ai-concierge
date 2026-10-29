// R2 viajes P2-3 y P2-6: un solo formato de fecha con hora, con día y hora en la MISMA zona.
//  - Casetas: «consultado 28 oct 2026, 23:37» para una cotización del 27 oct 2026, 11:38 p.m. (día en UTC,
//    hora local).
//  - Diario: «28/10/2026, 4:17:57 p.m.» fuera del formato único.
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatInstantDateTime } from "@/lib/localDate";
import { GroundOptionInfo } from "@/components/booking/GroundOptionInfo";
import { carCost } from "../../supabase/functions/_shared/carCost.ts";
import { readFileSync } from "node:fs";

const tz = process.env.TZ;
beforeEach(() => { process.env.TZ = "America/Mexico_City"; });
afterEach(() => { process.env.TZ = tz; });

// 27 oct 2026, 23:38 en Ciudad de México = 28 oct 05:38 UTC.
const ISO = "2026-10-28T05:38:00.000Z";

describe("fecha con hora", () => {
  it("formatInstantDateTime: «27 oct 2026, 23:38» (día y hora locales)", () => {
    expect(formatInstantDateTime(ISO)).toBe("27 oct 2026, 23:38");
    expect(formatInstantDateTime(null)).toBe("—");
    expect(formatInstantDateTime("no-es-fecha")).toBe("—");
  });

  it("casetas: el día ya no se corre", () => {
    const quote = { estado: "CON_MONTO", montos: [{ monto: 196, moneda: "MXN" }], monto_mxn: 196, fx: [], fuente: "google_routes", consultado_at: ISO, pase: null, from_cache: false } as any;
    const option = { mode: "coche", aerolinea: "En tu coche", costo_auto: carCost({ kmIda: 80, kmFuente: "google_routes", tolls: quote }) };
    render(<GroundOptionInfo trip={{ ciudad_origen: "Ciudad de México", destino: "Tepoztlán" }} option={option} />);
    expect(screen.getByTestId("ground-casetas")).toHaveTextContent("consultado 27 oct 2026, 23:38");
    expect(screen.getByTestId("ground-casetas")).not.toHaveTextContent("28 oct");
  });

  it("Diario usa el formato único (sin «28/10/2026, 4:17:57 p.m.»)", () => {
    const src = readFileSync("src/pages/TripJournal.tsx", "utf8");
    expect(src).toMatch(/formatInstantDateTime\(e\.created_at\)/);
    expect(src).not.toMatch(/toLocaleString\("es-MX"\)/);
  });
});
