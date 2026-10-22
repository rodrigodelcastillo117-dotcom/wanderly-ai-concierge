// Concierge 2.0 — pantalla: cliente de streaming, botones rápidos con el viaje activo, tarjeta de
// acción (Confirmar/Cancelar) y textos honestos (sin "VIP", sin "reservado").
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: "t", user: { id: "u1" } } } }) },
    functions: { invoke: (...a: any[]) => invoke(...a) },
  },
}));

import { streamConcierge, ConciergeHttpError } from "@/lib/conciergeStream";
import { buildChips, welcomeText } from "@/lib/conciergeChips";
import { ActionCard } from "@/components/concierge/ActionCard";
import { encodeEvent } from "../../supabase/functions/concierge-chat/stream";
import { readFunctionError } from "@/lib/functionErrors";

const sseResponse = (body: string) => new Response(new ReadableStream({
  start(c) { const e = new TextEncoder(); for (let i = 0; i < body.length; i += 17) c.enqueue(e.encode(body.slice(i, i + 17))); c.close(); },
}), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("cliente de streaming", () => {
  it("despacha pasos, texto en vivo, reset y la respuesta final", async () => {
    const body = [
      encodeEvent({ type: "meta", data: { _trip_id: "t1" } }),
      encodeEvent({ type: "status", data: { id: "p", text: "Consultando tu vuelo AF179…", state: "running" } }),
      encodeEvent({ type: "delta", data: { text: "Voy a revisar" } }),
      encodeEvent({ type: "reset", data: {} }),
      encodeEvent({ type: "delta", data: { text: "AF179 va a tiempo." } }),
      encodeEvent({ type: "final", data: { text: "AF179 va a tiempo.", cards: [], actions: [] } }),
    ].join("");
    const seen: string[] = [];
    let text = "";
    let final: any = null;
    const fetchImpl = vi.fn(async () => sseResponse(body));
    const mode = await streamConcierge({ url: "https://x/functions/v1/concierge-chat", accessToken: "tok", apiKey: "pk", body: { messages: [] }, fetchImpl: fetchImpl as any }, {
      onStatus: (s) => seen.push(s.text), onDelta: (d) => { text += d; }, onReset: () => { text = ""; }, onFinal: (d) => { final = d; },
    });
    expect(mode).toBe("stream");
    expect(seen).toEqual(["Consultando tu vuelo AF179…"]);
    expect(text).toBe("AF179 va a tiempo.");
    expect(final.text).toBe("AF179 va a tiempo.");
    const init = (fetchImpl.mock.calls[0] as any)[1];
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok", apikey: "pk", Accept: "text/event-stream" });
    expect(JSON.parse(init.body).stream).toBe(true);
  });
  it("servidor viejo (JSON) también funciona", async () => {
    let final: any = null;
    await streamConcierge({ url: "u", accessToken: "t", apiKey: "k", body: {}, fetchImpl: (async () => new Response(JSON.stringify({ text: "hola", cards: [] }), { headers: { "content-type": "application/json" } })) as any }, { onFinal: (d) => { final = d; } });
    expect(final.text).toBe("hola");
  });
  it("límite del plan (402) llega con el mismo contrato que functionErrors (diálogo de límite)", async () => {
    const err = await streamConcierge({ url: "u", accessToken: "t", apiKey: "k", body: {},
      fetchImpl: (async () => new Response(JSON.stringify({ code: "FREE_LIMIT_REACHED", quota: "concierge_monthly", limit: 3, used: 3 }), { status: 402 })) as any }, { onFinal: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ConciergeHttpError);
    const info = await readFunctionError(err, "x");
    expect(info.freeLimit).toMatchObject({ quota: "concierge_monthly", limit: 3 });
  });
  it("un error dentro del stream se lanza con su código (mensaje humano)", async () => {
    const body = encodeEvent({ type: "error", data: { code: "AI_UNAVAILABLE", message: "Iato no pudo responder. Intenta de nuevo en un momento.", status: 502 } });
    const err = await streamConcierge({ url: "u", accessToken: "t", apiKey: "k", body: {}, fetchImpl: (async () => sseResponse(body)) as any }, { onFinal: () => {} }).catch((e) => e);
    expect(err).toBeInstanceOf(ConciergeHttpError);
    expect(err.context.status).toBe(502);
  });
});

describe("botones rápidos con el viaje activo", () => {
  const trip = {
    id: "t1", destino: "París", fecha_salida: "2026-10-22", fecha_regreso: "2026-10-30",
    vuelos_json: [{ numero_vuelo: "AF179", fecha: "2026-10-22", from: "MEX", to: "CDG" }],
    hospedaje_json: [{ nombre: "Hôtel Le Marais", ciudad: "París", desde_pdf: true }],
  };
  it("el vuelo de hoy y el hotel van en la petición; cada botón manda su intención", () => {
    const chips = buildChips(trip, "2026-10-22");
    const by = Object.fromEntries(chips.map((c) => [c.id, c]));
    expect(by.flight).toMatchObject({ label: "¿AF179 va a tiempo?", intent: "flight_status" });
    expect(by.flight.text).toMatch(/AF179 de hoy/);
    expect(by.dining.text).toMatch(/Hôtel Le Marais/);
    expect(by.transport.text).toMatch(/Hôtel Le Marais/);
    expect(by.emergency).toMatchObject({ opens: "emergency" });
    expect(by.trip.text).toMatch(/viaje a París/);
  });
  it("Equipaje Invisible ya no promete precios ni proveedores: pide cotización a un humano", () => {
    const l = buildChips(null, "2026-10-22").find((c) => c.id === "luggage")!;
    expect(l.text).toMatch(/cotización a un humano/);
    expect(l.text).not.toMatch(/precio|Luggage Forward|link directo/);
  });
  it("saludo honesto con el viaje (sin 'cualquier capricho')", () => {
    expect(welcomeText(trip)).toMatch(/París/);
    expect(welcomeText(null)).toMatch(/Nada se reserva ni se guarda sin que lo confirmes/);
  });
});

describe("tarjeta de acción", () => {
  beforeEach(() => invoke.mockReset());
  const action = { id: "a1", type: "add_expense" as const, params: { monto: 450, moneda: "MXN", categoria: "Transporte", fecha: "2026-10-22" }, summary: "Registrar gasto: $450.00 · Transporte · mié 22 oct", confirm_label: "Registrar gasto", runs: "server" as const };
  it("nada se ejecuta hasta Confirmar; al confirmar manda la acción al servidor y muestra el resultado", async () => {
    invoke.mockResolvedValue({ data: { ok: true, message: "Gasto registrado.", link: "/dashboard/gastos" }, error: null });
    render(<MemoryRouter><ActionCard action={action} tripId="t1" /></MemoryRouter>);
    expect(screen.getByText(/Registrar gasto: \$450.00/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Registrar gasto/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Gasto registrado."));
    expect(invoke).toHaveBeenCalledWith("concierge-chat", expect.objectContaining({ body: expect.objectContaining({ mode: "action", action: { type: "add_expense", params: action.params }, trip_id: "t1" }) }));
  });
  it("Cancelar la quita sin llamar al servidor", () => {
    render(<MemoryRouter><ActionCard action={action} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Cancelar/ }));
    expect(screen.queryByText(/Registrar gasto/)).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("si el servidor rechaza (422), se ve el motivo y se puede reintentar", async () => {
    const ctx = new Response(JSON.stringify({ ok: false, message: "No tienes acceso a ese viaje." }), { status: 422 });
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("x"), { context: ctx }) });
    render(<MemoryRouter><ActionCard action={action} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Registrar gasto/ }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No tienes acceso a ese viaje."));
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeInTheDocument();
  });
  it("solicitud al Fixer muestra 'Aún no está reservado'", () => {
    render(<MemoryRouter><ActionCard action={{ ...action, type: "fixer_request", summary: "Pedirle al Fixer: Mesa en Pujol", confirm_label: "Pedírselo al Fixer", note: "Un humano del equipo lo gestiona y te avisa. Aún no está reservado." }} /></MemoryRouter>);
    expect(screen.getByText(/Aún no está reservado/)).toBeInTheDocument();
  });
});

describe("textos de la pantalla", () => {
  const src = readFileSync("src/pages/Concierge.tsx", "utf8");
  it("Modo exigente sin 'VIP' y con explicación de qué hace", () => {
    expect(src).not.toMatch(/opciones VIP|VIP/);
    expect(src).toMatch(/Modo exigente/);
    expect(src).toMatch(/la mejor, la alternativa y el plan B/);
    expect(src).not.toMatch(/Concierge pensando…/);
  });
  it("sin promesas viejas: 'cualquier capricho', 'Te confirmamos por chat', 'vía WhatsApp'", () => {
    expect(src).not.toMatch(/cualquier capricho/);
    expect(readFileSync("src/components/MembersOnlyPanel.tsx", "utf8")).not.toMatch(/Te confirmamos por chat/);
    expect(readFileSync("src/components/FixerButton.tsx", "utf8")).not.toMatch(/vía WhatsApp/);
  });
});
