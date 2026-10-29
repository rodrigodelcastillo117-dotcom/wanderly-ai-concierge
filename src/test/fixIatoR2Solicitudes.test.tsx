// Auditoría 10, ronda 2 (N8): "Mis solicitudes" tardaba 2.6 s en aparecer porque la lista se pedía
// recién al abrir la pestaña. Ahora se lee en segundo plano al abrir el Concierge y la pestaña la pinta
// al instante (se actualiza detrás).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { MyTeamRequests } from "@/components/concierge/MyTeamRequests";
import { __resetMyTeamRequestsCache, prefetchMyTeamRequests } from "@/lib/opsDesk";

const ROW = { source: "concierge_request", id: "08f79149-0000-4000-8000-000000000001", type: "human_help", title: "Pregunta general: PRUEBA AUDITORÍA", status: "solicitado", stage: "nueva",
  created_at: new Date().toISOString(), replies: [], history: [] };

beforeEach(() => { __resetMyTeamRequestsCache(); rpc.mockReset(); });

describe("N8 · Mis solicitudes al instante", () => {
  it("con la lectura anticipada, la pestaña pinta la lista en el primer render (sin esperar a la base)", async () => {
    let resolve: (v: unknown) => void = () => {};
    rpc.mockImplementationOnce(() => Promise.resolve({ data: [ROW], error: null }));
    prefetchMyTeamRequests();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    // La actualización de fondo tarda (como la red real): la lista ya se ve igual.
    rpc.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<MyTeamRequests />);
    expect(screen.getByTestId("team-request")).toHaveTextContent("PRUEBA AUDITORÍA");
    expect(screen.getByText(/Folio 08F79149/i)).toBeInTheDocument();
    resolve({ data: [ROW], error: null });
  });
  it("una sola lectura aunque se pida varias veces a la vez; si la actualización falla, se queda la lista", async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: [ROW], error: null }));
    prefetchMyTeamRequests();
    prefetchMyTeamRequests();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: "boom" } }));
    render(<MyTeamRequests />);
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("team-request")).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos cargar/)).toBeNull();
  });
});
