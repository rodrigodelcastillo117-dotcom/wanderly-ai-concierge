// Enlace al caso que manda el Operador IA al viajero (push / Telegram / WhatsApp / correo).
// Fallo (reporte de vigilancia, 30-oct-2026): herramientas.ts armaba /dashboard/concierge?tab=requests&id=…, pero el
// Concierge solo reconoce ?tab=members y ?tab=solicitudes, así que el enlace abría el chat y no el caso. Además
// «Mis solicitudes» ignoraba el id. Ahora: ?tab=solicitudes&id=<caso> (el mismo formato que la vigilancia) y la
// lista lleva la vista a ese caso.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { arnes, guion } from "./helpers/operadorHarness";
import { trabajarCaso } from "../../supabase/functions/_shared/operador/bucle";
import { appUrlCaso } from "../../supabase/functions/_shared/operador/herramientas";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: vi.fn() }, from: () => ({}) },
}));

import { MyTeamRequests } from "@/components/concierge/MyTeamRequests";
import { __resetMyTeamRequestsCache } from "@/lib/opsDesk";

/** Pestañas que entiende la pantalla del Concierge (tabFrom en src/pages/Concierge.tsx). */
function pestañasDelConcierge(): string[] {
  const src = readFileSync(resolve(__dirname, "../pages/Concierge.tsx"), "utf8");
  const m = src.match(/const tabFrom = \(t: string \| null\): Tab => \(([^?]+)\?/);
  if (!m) throw new Error("no encontré tabFrom en Concierge.tsx");
  return [...m[1].matchAll(/t === "([a-z_]+)"/g)].map((x) => x[1]);
}

describe("Operador IA → enlace al caso", () => {
  it("el aviso al viajero lleva ?tab=solicitudes&id=<caso>, una pestaña que el Concierge sí reconoce", async () => {
    const h = arnes({ modelo: guion([[{ name: "escribir_viajero", input: { mensaje: "Estoy revisando tu traslado." } }], "ok"]) });
    const urls: string[] = [];
    const original = h.deps.avisarViajero!;
    h.deps.avisarViajero = async (u, m, id) => { urls.push(m.url); return original(u, m, id); };
    const r = await h.reportar({ descripcion: "El chofer del traslado no llegó al aeropuerto", origen: "usuario", canal: "app" });
    if (!r.ok) throw new Error(JSON.stringify(r));
    await trabajarCaso(h.deps, r.id, "nuevo");
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0], "https://traveliatos.life");
    expect(url.pathname).toBe("/dashboard/concierge");
    expect(pestañasDelConcierge()).toContain(url.searchParams.get("tab"));
    expect(url.searchParams.get("tab")).toBe("solicitudes");
    expect(url.searchParams.get("id")).toBe(r.id);
    expect(urls[0]).toBe(appUrlCaso(r.id));
  });
  it("mismo formato que la vigilancia (un solo tipo de enlace a un caso)", () => {
    const runner = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/vigilancia/runner.ts"), "utf8");
    expect(runner).toContain("/dashboard/concierge?tab=solicitudes&id=${");
    expect(appUrlCaso("abc")).toBe("/dashboard/concierge?tab=solicitudes&id=abc");
  });
});

describe("«Mis solicitudes» abre el caso del enlace", () => {
  const CASO = "55555555-5555-4555-8555-555555555555";
  const fila = (id: string, title: string) => ({
    source: "concierge_request", id, type: "incidente", title, status: "en_proceso", stage: "en_proceso", created_at: new Date().toISOString(),
    history: [], replies: [], incident: { is_open: true, next_step: "Te escribimos", messages: [] },
  });
  let scrolled: string[] = [];
  beforeEach(() => {
    rpc.mockReset(); __resetMyTeamRequestsCache(); scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id); } as never;
  });
  afterEach(() => { window.history.replaceState(null, "", "/"); });

  it("con ?id=<caso> lleva la vista a ese caso y lo marca como el actual", async () => {
    window.history.replaceState(null, "", `/dashboard/concierge?tab=solicitudes&id=${CASO}`);
    rpc.mockImplementation(async (fn: string) => fn === "my_team_requests"
      ? { data: [fila("11111111-1111-4111-8111-111111111111", "Otra solicitud"), fila(CASO, "Traslado no llegó")], error: null }
      : { data: null, error: null });
    render(<MyTeamRequests />);
    await screen.findByText("Traslado no llegó");
    await waitFor(() => expect(scrolled).toEqual([`solicitud-${CASO}`]));
    const items = screen.getAllByTestId("team-request");
    expect(items[1]).toHaveAttribute("aria-current", "true");
    expect(items[0]).not.toHaveAttribute("aria-current");
  });
  it("sin id no mueve la vista", async () => {
    window.history.replaceState(null, "", "/dashboard/concierge?tab=solicitudes");
    rpc.mockImplementation(async (fn: string) => fn === "my_team_requests" ? { data: [fila(CASO, "Traslado no llegó")], error: null } : { data: null, error: null });
    render(<MyTeamRequests />);
    await screen.findByText("Traslado no llegó");
    expect(scrolled).toEqual([]);
  });
});
