// "Mis reclamos" (Concierge › Mis solicitudes): la carta que preparó Iato se ve, se copia y se marca como
// enviada; "Enviar en mi nombre" solo aparece con el envío encendido y correo verificado, y pide un sí.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

import { MyClaims } from "@/components/concierge/MyClaims";
import { claimStatusText } from "@/lib/claims";

const base = {
  id: "00000000-0000-0000-0000-0000000000c1", ref_code: "C-ABC234", kind: "vuelo", target: "proveedor", status: "esperando_ok",
  provider_name: "Iberia", channel: "formulario", recipient_email: null, form_url: "https://www.iberia.com/reclamaciones",
  subject: "Reclamación vuelo IB6400", body_text: "Estimados señores: solicito la compensación de 600 EUR por el retraso del vuelo IB6400.",
  sent_at: null, created_at: new Date(Date.now() - 3 * 3600e3).toISOString(), reply: null,
};

beforeEach(() => invoke.mockReset());

it("sin envío por correo: muestra la carta, el formulario oficial y «Ya la envié», sin «Enviar en mi nombre»", async () => {
  invoke.mockResolvedValue({ data: { ok: true, reclamos: [base], envio_activo: false }, error: null });
  render(<MyClaims />);
  expect(await screen.findByText("Iberia")).toBeInTheDocument();
  expect(screen.getByText(/Folio C-ABC234/)).toBeInTheDocument();
  expect(screen.getByText(/Creada hace 3 h/)).toBeInTheDocument();
  expect(screen.getByText("Carta lista · falta enviarla")).toBeInTheDocument();
  expect(screen.getByTestId("claim-formulario")).toHaveAttribute("href", base.form_url);
  expect(screen.getByTestId("claim-how-to-send")).toHaveTextContent("Copia la carta y pégala en el formulario oficial de Iberia");
  expect(screen.queryByTestId("claim-enviar")).toBeNull();
  fireEvent.click(screen.getByTestId("claim-ver-carta"));
  expect(screen.getByTestId("claim-carta")).toHaveTextContent("600 EUR");
  invoke.mockResolvedValue({ data: { ok: true, claim: { ...base, status: "enviado" } }, error: null });
  fireEvent.click(screen.getByTestId("claim-ya-envie"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("reclamos", { body: { action: "ya_lo_envie", id: base.id } }));
});

it("con envío encendido y correo verificado: pide confirmación antes de enviar", async () => {
  const c = { ...base, channel: "correo", recipient_email: "customer.relations@aerolinea.example", form_url: null };
  invoke.mockResolvedValueOnce({ data: { ok: true, reclamos: [c], envio_activo: true }, error: null });
  render(<MyClaims />);
  fireEvent.click(await screen.findByTestId("claim-enviar"));
  expect(screen.getByTestId("claim-confirmar")).toHaveTextContent("customer.relations@aerolinea.example");
  expect(invoke).toHaveBeenCalledTimes(1); // abrir la confirmación no envía nada
  invoke.mockResolvedValue({ data: { ok: true, claim: { ...c, status: "enviado" } }, error: null });
  fireEvent.click(screen.getByTestId("claim-confirmar-si"));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("reclamos", { body: expect.objectContaining({ action: "confirmar_envio", id: c.id, confirm: true, cc_me: true }) }));
});

it("si el servidor dice que el envío no está activo, lo explica sin fingir que se envió", async () => {
  const c = { ...base, channel: "correo", recipient_email: "a@b.example", form_url: null };
  invoke.mockResolvedValueOnce({ data: { ok: true, reclamos: [c], envio_activo: true }, error: null });
  render(<MyClaims />);
  fireEvent.click(await screen.findByTestId("claim-enviar"));
  const res = new Response(JSON.stringify({ ok: false, code: "FEATURE_DISABLED", message: "El envío de reclamaciones por correo todavía no está activo. Te dejo la carta lista para que la envíes tú." }), { status: 403 });
  invoke.mockResolvedValue({ data: null, error: { context: res } });
  fireEvent.click(screen.getByTestId("claim-confirmar-si"));
  expect(await screen.findByText(/todavía no está activo/)).toBeInTheDocument();
});

it("botón «Reclamar con Iato» deja la petición escrita en el chat (no la envía sola)", async () => {
  invoke.mockResolvedValue({ data: { ok: true, reclamos: [], envio_activo: false }, error: null });
  const ask = vi.fn();
  render(<MyClaims onAskIato={ask} />);
  fireEvent.click(await screen.findByTestId("claim-nuevo"));
  expect(ask).toHaveBeenCalledWith(expect.stringMatching(/reclamar a una aerolínea/i));
});

it("los reclamos cancelados no se muestran y los estados se leen en palabras simples", async () => {
  invoke.mockResolvedValue({ data: { ok: true, reclamos: [{ ...base, status: "cancelado" }], envio_activo: false }, error: null });
  render(<MyClaims />);
  await waitFor(() => expect(invoke).toHaveBeenCalled());
  expect(screen.queryByTestId("claim")).toBeNull();
  expect(claimStatusText("escalable")).toBe("Sin respuesta: se puede escalar");
  expect(claimStatusText("enviado")).toBe("Enviada · esperando respuesta");
});
