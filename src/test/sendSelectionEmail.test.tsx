// Botón "Enviarme mi selección por correo" (pestaña Comprar). Sin vuelo y hotel elegidos el botón está
// apagado con "Elige tu vuelo y hotel para enviarte el resumen" y no llama a nada; con la selección
// llama a enviar-seleccion (simulado: ninguna prueba manda correos).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const fake = vi.hoisted(() => ({
  invoke: vi.fn(async (_fn: string, _opts: any) => ({ data: { ok: true, sent: 1 }, error: null })),
}));
vi.mock("@/integrations/supabase/client", () => {
  // La tabla de marcas del grupo "no existe": el hook usa solo bookings (modo propio).
  const chain: any = { select: () => chain, eq: () => chain, then: (ok: any) => Promise.resolve({ data: null, error: { message: "no simulada" } }).then(ok) };
  return { supabase: { from: () => chain, functions: { invoke: fake.invoke } } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { SendSelectionEmail } from "@/components/booking/SendSelectionEmail";
import { CASO_PRA_CREADO } from "./fixtures/casoParisRomaAtenas";
import { computeTripDesglose } from "@/lib/quote";
import { tripTotals } from "@/components/RealTripTotal";

async function renderWith(sel: { selVuelo: number; selHospedaje: number; selTours: Set<number> }) {
  const trip: any = CASO_PRA_CREADO;
  const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: 9, selHoteles: {} }, 1);
  const total = tripTotals(trip, 1, desglose).total;
  const r = render(<SendSelectionEmail trip={trip} {...sel} selHoteles={{}} travelers={1} nights={9} desglose={desglose} total={total} bookings={[]} userId="owner-1" />);
  await act(async () => {}); // carga de marcas (simulada)
  return r;
}

describe("SendSelectionEmail", () => {
  beforeEach(() => fake.invoke.mockClear());

  it("sin selección: botón apagado, dice qué falta y no envía", async () => {
    await renderWith({ selVuelo: -1, selHospedaje: -1, selTours: new Set() });
    const btn = screen.getByTestId("enviar-seleccion-boton");
    expect(btn).toBeDisabled();
    expect(btn).toHaveTextContent("Elige tu vuelo y hotel para enviarte el resumen");
    expect(screen.getByTestId("enviar-seleccion-falta")).toHaveTextContent("Falta elegir: tu vuelo · tu hotel");
    fireEvent.click(btn);
    expect(fake.invoke).not.toHaveBeenCalled();
  });

  it("con vuelo y hotel: 'Enviarme mi selección por correo' manda solo lo elegido a mi correo", async () => {
    await renderWith({ selVuelo: 1, selHospedaje: 0, selTours: new Set() });
    const btn = screen.getByTestId("enviar-seleccion-boton");
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent("Enviarme mi selección por correo");
    fireEvent.click(btn);
    await waitFor(() => expect(fake.invoke).toHaveBeenCalledTimes(1));
    const [fn, opts] = fake.invoke.mock.calls[0];
    expect(fn).toBe("enviar-seleccion");
    expect(opts.body).toMatchObject({ trip_id: CASO_PRA_CREADO.id, to: "me", travelers: 1, total: 21238 + 41031 + 4500 });
    expect(opts.body.items.map((i: any) => [i.kind, i.index])).toEqual([["vuelo", 1], ["hospedaje", 0]]);
    expect(opts.body.member_ids).toBeUndefined();
  });
});
