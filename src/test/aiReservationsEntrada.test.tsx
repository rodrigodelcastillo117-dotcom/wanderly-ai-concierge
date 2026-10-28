// Reservas IA · puerta de entrada (28-oct-2026): Iato propone "Pedir mesa por correo" solo si el
// servidor dice que está disponible; create_intent → preview → confirm_send con consentimiento;
// FEATURE_DISABLED cae a la solicitud humana; "Pedir mesa con Iato" en las tarjetas solo si está
// habilitado; nunca "reservado" antes de confirmed.
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    auth: { getSession: async () => ({ data: { session: { user: { id: "u-1" } } } }) },
  },
}));
vi.mock("@/lib/priveSession", () => ({ readPriveSession: () => null }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => <button>Fixer</button> }));

import { type ActionContext, validateAction, validateActions } from "../../supabase/functions/concierge-chat/actions";
import { aiReservationMessage, executeAction } from "../../supabase/functions/concierge-chat/actionExec";
import { AI_RESERVATION_NOTE, detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { DATA_SENTINEL } from "../../supabase/functions/concierge-chat/stream";
import { ActionCard } from "@/components/concierge/ActionCard";
import { RestaurantBookingButtons } from "@/components/booking/RestaurantBookingButtons";
import { resetAiReservationsEnabledCache } from "@/lib/aiReservations";
import { restaurantBooking } from "../../supabase/functions/_shared/restaurantBooking";

const PLACE = "ChIJkf2l5z3_0YURc6dGkqZ9Ays";
const RES_ID = "00000000-0000-4000-8000-000000000001";
const CTX: ActionContext = { todayISO: "2026-10-28", trips: [], activeTripId: null };
const PARAMS = { place_id: PLACE, nombre: "Pujol", fecha: "2026-11-07", hora: "21:00", personas: 2 };
const ON = { ...CTX, aiReservationsEnabled: true, places: [{ placeId: PLACE, name: "Pujol", city: "Ciudad de México" }] };

const reservation = (status: string, extra: Record<string, unknown> = {}) => ({
  id: RES_ID, ref_code: "R-ABC234", venue_name: "Pujol", venue_email: "reservas@pujol.com.mx", venue_address: null, venue_city: "Ciudad de México",
  venue_place_id: PLACE, requested_local: "2026-11-07T21:00", requested_for: "2026-11-08T03:00:00Z", party_size: 2, customer_name: "Rodrigo",
  status, reason: null, is_confirmed: status === "confirmed", user_options: null, alternatives: null, confirmation: null, confirmation_code: null,
  venue_reply_excerpt: null, created_at: "2026-10-28T00:00:00Z", confirm_prompt: "Confirmar: escribiremos a Pujol en tu nombre",
  label: status === "awaiting_user_ok" ? "Falta tu confirmación · aún no escribimos al restaurante"
    : status === "sent" ? "Solicitud enviada al restaurante · aún no es una reserva"
    : status === "confirmed" ? "Confirmada por escrito por el restaurante" : "No encontramos un correo de reservas · elige otra vía",
  ...extra,
});
const PREVIEW = { to: "reservas@pujol.com.mx", subject: "Solicitud de reserva · 2 personas · sáb 7 nov 21:00 · Ref R-ABC234", text: "Buenas tardes, equipo de Pujol:\nQuisiera reservar…" };

// Antes de comprometer: ninguna frase afirma que la mesa ya está reservada o confirmada.
const CLAIMS = /\b(ya )?(tienes|tengo) (tu )?mesa|reservad[oa] para|(?<!no )est[aá] reservad[oa]|qued[oó] reservad[oa]|reserva confirmada|\bconfirmada\b|\bconfirm[oó]\b/i;

beforeEach(() => { invoke.mockReset(); resetAiReservationsEnabledCache(); });

describe("Iato: la acción solo existe si Reservas IA está disponible", () => {
  it("disponible + lugar de Google de este turno → 'Pedir mesa por correo a Pujol'", () => {
    const v = validateAction("ai_reservation_request", PARAMS, ON) as any;
    expect(v.ok).toBe(true);
    expect(v.action.type).toBe("ai_reservation_request");
    expect(v.action.summary).toMatch(/^Pedir mesa por correo a Pujol · .* 21:00 · 2 personas$/);
    expect(v.action.confirm_label).toBe("Pedir mesa por correo");
    expect(v.action.note).toMatch(/nada se envía sin tu confirmación\. Aún no está reservado\./);
    expect(v.action.params).toMatchObject({ place_id: PLACE, nombre: "Pujol", ciudad: "Ciudad de México" });
  });
  it("sin place_id pero con el nombre exacto de un resultado → toma el place_id real del resultado", () => {
    const v = validateAction("ai_reservation_request", { ...PARAMS, place_id: undefined }, ON) as any;
    expect(v.action.params.place_id).toBe(PLACE);
  });
  it("no disponible (FEATURE_DISABLED / fuera del piloto) → la solicitud humana de siempre", () => {
    const v = validateAction("ai_reservation_request", PARAMS, { ...ON, aiReservationsEnabled: false }) as any;
    expect(v.ok).toBe(true);
    expect(v.action.type).toBe("fixer_request");
    expect(v.action.params).toMatchObject({ tipo: "reservation", titulo: "Reservar mesa en Pujol", personas: 2, fecha: "2026-11-07", hora: "21:00" });
  });
  it("un lugar que Google no devolvió en este turno nunca recibe correo (cae a una persona del equipo)", () => {
    const v = validateAction("ai_reservation_request", { ...PARAMS, place_id: "ChIJinventadoPorElModelo0000", nombre: "Otro" }, ON) as any;
    expect(v.action.type).toBe("fixer_request");
  });
  it("faltan datos → no se propone (Iato pregunta)", () => {
    expect(validateAction("ai_reservation_request", { ...PARAMS, hora: undefined }, ON)).toMatchObject({ ok: false, reason: "falta_hora" });
    expect(validateAction("ai_reservation_request", { ...PARAMS, fecha: "2026-10-01" }, ON)).toMatchObject({ ok: false, reason: "fecha_pasada" });
    expect(validateAction("ai_reservation_request", { ...PARAMS, personas: 40 }, ON)).toMatchObject({ ok: false, reason: "personas_invalidas" });
  });
  it("si el modelo propone las dos (correo y persona), queda una sola acción por tipo", () => {
    const { actions } = validateActions([
      { type: "ai_reservation_request", params: PARAMS },
      { type: "fixer_request", params: { tipo: "reservation", titulo: "Mesa en Pujol" } },
    ], [], { ...ON, aiReservationsEnabled: false }, () => "x");
    expect(actions.map((a) => a.type)).toEqual(["fixer_request"]);
  });
  it("planeador: 'resérvame mesa' es book_table y la nota de Reservas IA va SOLO si está disponible", () => {
    const msg = "Resérvame mesa en Pujol el sábado a las 9 para 2";
    const intents = detectIntents(msg);
    expect(intents).toContain("book_table");
    const base = { message: msg, intents, trip: null, todayISO: "2026-10-28", coords: null, hasPriveSession: false, exigente: false };
    expect(planTurn({ ...base, aiReservationsEnabled: true }).notes).toContain(AI_RESERVATION_NOTE);
    expect(planTurn({ ...base, aiReservationsEnabled: false }).notes).not.toContain(AI_RESERVATION_NOTE);
    expect(detectIntents("reservar para 4 personas en Contramar")).toContain("book_table");
  });
  it("finalizeTurn: usa los lugares de las herramientas del turno y quita 'te reservé' del texto", () => {
    const raw = `Te reservé mesa en Pujol. Te dejo el botón.\n${DATA_SENTINEL}${JSON.stringify({ actions: [{ type: "ai_reservation_request", params: { nombre: "Pujol", fecha: "2026-11-07", hora: "21:00", personas: 2 } }] })}`;
    const out = finalizeTurn({
      raw, plan: { cards: [], suggestedActions: [] }, makeId: () => "a1", userMessage: "resérvame mesa en Pujol",
      toolRuns: [{ name: "search_places", args: { query: "Pujol", city: "Ciudad de México" }, result: { results: [{ id: PLACE, name: "Pujol", address: "Tennyson 133" }] } }],
      actionCtx: { ...CTX, aiReservationsEnabled: true },
    });
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]).toMatchObject({ type: "ai_reservation_request", params: { place_id: PLACE } });
    expect(out.text).not.toMatch(/Te reservé/);
    expect(out.text).toMatch(/Aún no está reservado/);
  });
});

describe("al confirmar: create_intent (servidor) y, si no está disponible, la persona del equipo", () => {
  const deps = (respond: (name: string, body: any) => { status: number; json: any }) => {
    const calls: Array<{ name: string; body: any }> = [];
    return { calls, d: { userId: "u-1", db: {}, idempotencyKey: "k".repeat(32), callFunction: async (name: string, body: any) => { calls.push({ name, body }); return respond(name, body); } } };
  };
  it("create_intent con el lugar, la hora local y personas; devuelve el preview y nunca dice reservado", async () => {
    const { calls, d } = deps(() => ({ status: 200, json: { ok: true, reservation: reservation("awaiting_user_ok"), preview: PREVIEW, confirm_prompt: "Confirmar: escribiremos a Pujol en tu nombre", next: "confirm_send" } }));
    const r = await executeAction("ai_reservation_request", PARAMS, CTX, d);
    expect(calls).toEqual([{ name: "ai-reservations", body: expect.objectContaining({
      action: "create_intent", source: "iato", venue: { name: "Pujol", place_id: PLACE }, datetime_local: "2026-11-07T21:00", party_size: 2,
      idempotency_key: `iato:${"k".repeat(32)}`,
    }) }]);
    // Iato nunca manda confirm_send: eso lo pulsa el usuario.
    expect(calls.some((c) => c.body?.action === "confirm_send")).toBe(false);
    expect(r.ok).toBe(true);
    expect((r.data as any).ai_reservation).toMatchObject({ preview: PREVIEW, next: "confirm_send" });
    expect(r.message).toMatch(/Enviar al restaurante.*Aún no está reservado/);
    expect(r.message).not.toMatch(CLAIMS);
  });
  it("FEATURE_DISABLED → solicitud humana a la Mesa de operaciones (concierge-action)", async () => {
    const { calls, d } = deps((name) => name === "ai-reservations"
      ? { status: 403, json: { ok: false, code: "FEATURE_DISABLED", message: "Las reservas por correo con IA todavía no están activas." } }
      : { status: 200, json: { ok: true, request: { id: "abcdef12-0000" }, human_notified: true } });
    const r = await executeAction("ai_reservation_request", PARAMS, CTX, d);
    expect(calls.map((c) => c.name)).toEqual(["ai-reservations", "concierge-action"]);
    expect(calls[1].body).toMatchObject({ type: "reservation", title: "Reservar mesa en Pujol" });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/persona del equipo IATOS.*Aún no está reservado/);
  });
  it("sin correo verificado (needs_user) → lo dice y trae las vías reales", async () => {
    const opts = { phone_url: "tel:+525555454111", website: "https://pujol.com.mx", maps_url: "https://maps.google.com/?cid=1" };
    const { d } = deps(() => ({ status: 200, json: { ok: true, reservation: reservation("needs_user", { reason: "no_contact", venue_email: null, user_options: opts }), preview: null, next: "needs_user" } }));
    const r = await executeAction("ai_reservation_request", PARAMS, CTX, d);
    expect(r.message).toMatch(/No encontramos un correo de reservas verificado de Pujol/);
    expect((r.data as any).ai_reservation.reservation.user_options).toEqual(opts);
  });
  it("texto honesto por estado: solo 'confirmed' habla de confirmación", () => {
    for (const s of ["awaiting_user_ok", "sent", "venue_replied", "needs_user"]) {
      expect(aiReservationMessage({ status: s, venue_name: "Pujol" })).not.toMatch(CLAIMS);
      expect(aiReservationMessage({ status: s, venue_name: "Pujol" })).toMatch(/Aún no está reservado/);
    }
    expect(aiReservationMessage({ status: "confirmed", venue_name: "Pujol" })).toMatch(/confirmó tu reserva por escrito/);
  });
});

describe("tarjeta de Iato: preview → 'Enviar al restaurante' con consentimiento", () => {
  const action = { id: "a1", type: "ai_reservation_request" as const, params: PARAMS, summary: "Pedir mesa por correo a Pujol · sáb 7 nov 21:00 · 2 personas",
    confirm_label: "Pedir mesa por correo", runs: "server" as const, note: "Primero verás a quién y qué le escribiremos; nada se envía sin tu confirmación. Aún no está reservado." };
  it("muestra a quién y qué se escribirá; envía solo al pulsar, con share_contact y cc_me", async () => {
    invoke.mockImplementation(async (fn: string, opts: any) => {
      if (fn === "concierge-chat") return { data: { ok: true, message: "Preparé el correo para Pujol.", link: "/dashboard/reservas#reservas-ia",
        data: { ai_reservation: { reservation: reservation("awaiting_user_ok"), preview: PREVIEW, confirm_prompt: "Confirmar: escribiremos a Pujol en tu nombre", next: "confirm_send" } } }, error: null };
      if (fn === "ai-reservations" && opts.body.action === "confirm_send") return { data: { ok: true, reservation: reservation("sent") }, error: null };
      return { data: null, error: new Error("inesperado") };
    });
    render(<MemoryRouter><ActionCard action={action} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Pedir mesa por correo/ }));
    const preview = await screen.findByTestId("ai-res-preview");
    expect(preview).toHaveTextContent("reservas@pujol.com.mx");
    expect(preview).toHaveTextContent(PREVIEW.subject);
    expect(preview).toHaveTextContent(/Aún no le hemos escrito/);
    expect(invoke.mock.calls.some(([fn, o]) => fn === "ai-reservations" && o.body.action === "confirm_send")).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: /Compartir mi teléfono y correo/ }));
    fireEvent.click(screen.getByRole("button", { name: /Enviar al restaurante/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-reservations", {
      body: { action: "confirm_send", id: RES_ID, confirm: true, confirm_text: "Confirmar: escribiremos a Pujol en tu nombre", consent: { share_contact: true, cc_me: false } },
    }));
    const st = await screen.findByTestId("ai-res-status");
    expect(st).toHaveAttribute("data-status", "sent");
    expect(st).toHaveTextContent("Solicitud enviada al restaurante · aún no es una reserva · Aún no está reservado.");
    expect(screen.getByTestId("ai-res-seguir")).toHaveAttribute("href", "/dashboard/reservas#reservas-ia");
    expect(document.body.textContent).not.toMatch(/Confirmada por escrito/);
  });
});

describe("tarjeta de restaurante: 'Pedir mesa con Iato' solo si está habilitado", () => {
  const booking = restaurantBooking({ name: "Pujol", city: "Ciudad de México", website: "https://pujol.com.mx", phone: "55 5545 4111" });
  const statusOnce = (enabled: boolean) => invoke.mockImplementation(async (_fn: string, o: any) =>
    o.body.action === "status" ? { data: { ok: true, enabled, reservations: [] }, error: null } : { data: null, error: new Error("x") });

  it("deshabilitado → no aparece (y no se pide nada más)", async () => {
    statusOnce(false);
    render(<MemoryRouter><RestaurantBookingButtons booking={booking} name="Pujol" placeId={PLACE} /></MemoryRouter>);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-reservations", { body: { action: "status" } }));
    expect(screen.queryByTestId("pedir-mesa-iato")).toBeNull();
  });
  it("sin place_id de Google → no aparece ni consulta", () => {
    render(<MemoryRouter><RestaurantBookingButtons booking={booking} name="Pujol" /></MemoryRouter>);
    expect(screen.queryByTestId("pedir-mesa-iato")).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
  it("habilitado → formulario → create_intent → preview → confirm_send; una sola consulta de status por sesión", async () => {
    invoke.mockImplementation(async (_fn: string, o: any) => {
      const a = o.body.action;
      if (a === "status") return { data: { ok: true, enabled: true, reservations: [] }, error: null };
      if (a === "create_intent") return { data: { ok: true, reservation: reservation("awaiting_user_ok"), preview: PREVIEW, confirm_prompt: "Confirmar: escribiremos a Pujol en tu nombre", next: "confirm_send" }, error: null };
      if (a === "confirm_send") return { data: { ok: true, reservation: reservation("sent") }, error: null };
      return { data: null, error: new Error("x") };
    });
    render(<MemoryRouter>
      <RestaurantBookingButtons booking={booking} name="Pujol" city="Ciudad de México" placeId={PLACE} />
      <RestaurantBookingButtons booking={booking} name="Pujol" city="Ciudad de México" placeId={PLACE} />
    </MemoryRouter>);
    const btns = await screen.findAllByTestId("pedir-mesa-iato");
    expect(btns).toHaveLength(2);
    expect(invoke.mock.calls.filter(([, o]) => o.body.action === "status")).toHaveLength(1);
    fireEvent.click(btns[0]);
    fireEvent.change(await screen.findByLabelText("Fecha"), { target: { value: "2026-11-07" } });
    fireEvent.change(screen.getByLabelText("Hora"), { target: { value: "21:00" } });
    fireEvent.change(screen.getByLabelText("Personas"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Notas"), { target: { value: "Aniversario" } });
    fireEvent.click(screen.getByRole("button", { name: /Preparar el correo/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-reservations", { body: expect.objectContaining({
      action: "create_intent", source: "usuario", venue: { name: "Pujol", place_id: PLACE, city: "Ciudad de México" },
      datetime_local: "2026-11-07T21:00", party_size: 4, notes: "Aniversario", idempotency_key: expect.stringMatching(/^card:[0-9a-f]{16,}$/),
    }) }));
    expect(await screen.findByTestId("ai-res-preview")).toHaveTextContent("reservas@pujol.com.mx");
    fireEvent.click(screen.getByRole("button", { name: /Enviar al restaurante/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("ai-reservations", { body: expect.objectContaining({ action: "confirm_send", consent: { share_contact: false, cc_me: false } }) }));
    expect(await screen.findByTestId("ai-res-status")).toHaveAttribute("data-status", "sent");
  });
  it("Google dice que no toma reservaciones → no se ofrece", async () => {
    statusOnce(true);
    const noRes = restaurantBooking({ name: "Taquería", city: "CDMX", reservable: false });
    render(<MemoryRouter><RestaurantBookingButtons booking={noRes} name="Taquería" placeId={PLACE} /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("pedir-mesa-iato")).toBeNull();
  });
});

describe("Mis reservas en 390 px", () => {
  it("la etiqueta larga del estado baja de renglón y no aplasta el nombre del restaurante", async () => {
    const { AiReservationsPanel } = await import("@/components/reservas/AiReservationsPanel");
    invoke.mockResolvedValue({ data: { ok: true, enabled: true, reservations: [reservation("sent")] }, error: null });
    render(<MemoryRouter><AiReservationsPanel /></MemoryRouter>);
    const badge = await screen.findByText("Solicitud enviada al restaurante · aún no es una reserva");
    expect(badge.className).not.toMatch(/shrink-0/);
    expect(badge.className).toMatch(/whitespace-normal/);
    expect(badge.parentElement!.className).toMatch(/flex-wrap/);
  });
});
