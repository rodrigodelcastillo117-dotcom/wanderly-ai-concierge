// God Mode F1: estados de reserva seguros y honestos (vista reservation_state_v, guardarraíl de texto
// de Iato y etiqueta de la tarjeta de solicitud).
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  isVerifiedConfirmed, requestStatusToCanonical, reservationStateLabel, reservationStatesForPrompt, RESERVATION_STATE_RULE,
} from "../../supabase/functions/_shared/reservationState";
import { enforceNoFakeBooking, NOT_BOOKED_LINE } from "../../supabase/functions/concierge-chat/guard";
import { loadReservationStates, reservationGuardInput } from "../../supabase/functions/concierge-chat/context";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";
import { buildContextMessage, buildStableSystem } from "../../supabase/functions/concierge-chat/prompt";
import { ReservationStateBadge } from "@/components/concierge/ReservationStateBadge";

const SOLICITADA = { source_table: "concierge_requests", title: "Mesa en Pujol", kind: "reservation", raw_status: "solicitado", canonical_state: "REQUESTED", verification: "sin_evidencia" };
const CONFIRMADA = { source_table: "booking_intents", title: "Hotel Urban", kind: "hotel", raw_status: "CONFIRMED", canonical_state: "CONFIRMED", verification: "verificado_proveedor", evidence_source: "provider_api" };
const CONFIRMADA_SIN_EVIDENCIA = { ...CONFIRMADA, verification: "sin_evidencia" };

describe("estado canónico y etiqueta honesta", () => {
  it("solicitud enviada no es reserva; confirmada dice quién confirmó", () => {
    expect(reservationStateLabel(SOLICITADA).label).toBe("Solicitud enviada · aún no es una reserva");
    expect(reservationStateLabel(CONFIRMADA).label).toBe("Confirmada por el proveedor");
    expect(reservationStateLabel({ ...CONFIRMADA, verification: "verificado_equipo" }).label).toBe("Confirmada por el equipo IATOS");
    expect(reservationStateLabel({ canonical_state: "REDIRECTED_TO_PROVIDER" }).label).toMatch(/sin compra confirmada/);
    expect(reservationStateLabel({ canonical_state: "PENDING_CONFIRMATION", raw_status: "resuelto" }).label).toMatch(/sin confirmación de reserva/);
  });
  it("CONFIRMED sin evidencia nunca cuenta como reserva", () => {
    expect(isVerifiedConfirmed(CONFIRMADA)).toBe(true);
    expect(isVerifiedConfirmed(CONFIRMADA_SIN_EVIDENCIA)).toBe(false);
    expect(reservationStateLabel(CONFIRMADA_SIN_EVIDENCIA).label).toMatch(/aún no es una reserva/);
    expect(isVerifiedConfirmed(SOLICITADA)).toBe(false);
  });
  it("estados de concierge_requests → canónico igual que la vista", () => {
    expect(requestStatusToCanonical("solicitado")).toBe("REQUESTED");
    expect(requestStatusToCanonical("pending")).toBe("REQUESTED");
    expect(requestStatusToCanonical("confirmed")).toBe("PENDING_CONFIRMATION"); // sin evidencia estructurada
    expect(requestStatusToCanonical("confirmado_externamente", "reservation")).toBe("PENDING_CONFIRMATION");
    expect(requestStatusToCanonical("confirmado_externamente", "prive_request")).toBe("CONFIRMED");
    expect(requestStatusToCanonical("cancelado")).toBe("CANCELLED");
    expect(requestStatusToCanonical("rechazado")).toBe("FAILED");
    expect(requestStatusToCanonical("caducado")).toBe("EXPIRED");
  });
});

describe("Iato lee los estados reales", () => {
  it("lee my_open_reservations con el viaje; si falla o no existe, no hay estados", async () => {
    const calls: unknown[] = [];
    const ok = await loadReservationStates(async (fn, p) => { calls.push([fn, p]); return { data: [SOLICITADA], error: null }; }, "t1");
    expect(calls).toEqual([["my_open_reservations", { _trip: "t1" }]]);
    expect(ok).toHaveLength(1);
    expect(await loadReservationStates(async () => ({ data: null, error: { message: "function does not exist" } }), null)).toEqual([]);
    expect(await loadReservationStates(async () => { throw new Error("red"); }, null)).toEqual([]);
  });
  it("bloque breve en el contexto y regla dura en el sistema", () => {
    const rows = reservationStatesForPrompt([SOLICITADA, CONFIRMADA]);
    expect(rows[0]).toMatchObject({ titulo: "Mesa en Pujol", estado: "REQUESTED", etiqueta: "Solicitud enviada · aún no es una reserva" });
    const msg = buildContextMessage({ reservas: rows });
    expect(msg?.content).toMatch(/<estado_reservas_usuario>/);
    expect(msg?.content).toMatch(/Mesa en Pujol/);
    expect(buildContextMessage({ reservas: [] })).toBeNull();
    const sys = buildStableSystem();
    expect(sys).toContain(RESERVATION_STATE_RULE);
    expect(sys).toMatch(/abrir un enlace no es una compra/);
    expect(reservationStatesForPrompt(Array.from({ length: 20 }, () => SOLICITADA))).toHaveLength(8);
  });
  it("guardarraíl: solo un CONFIRMED con evidencia habilita 'confirmada'", () => {
    expect(reservationGuardInput([SOLICITADA, CONFIRMADA_SIN_EVIDENCIA]).hasVerifiedReservation).toBe(false);
    expect(reservationGuardInput([SOLICITADA, CONFIRMADA]).hasVerifiedReservation).toBe(true);
    expect(reservationGuardInput([SOLICITADA]).openRequests).toEqual([{ title: "Mesa en Pujol", label: "Solicitud enviada · aún no es una reserva" }]);
  });
});

describe("post-proceso determinista del texto", () => {
  const open = reservationGuardInput([SOLICITADA]).openRequests;
  it("'ya reservé' se reemplaza siempre, aun con reservas confirmadas", () => {
    expect(enforceNoFakeBooking("Ya reservé tu mesa en Pujol.", { hasConfirmedBookings: true }).startsWith(NOT_BOOKED_LINE)).toBe(true);
  });
  it("'tu reserva está confirmada' sin CONFIRMED con evidencia → estado real", () => {
    const out = enforceNoFakeBooking("Tu reserva está confirmada para las 21:00. Lleva saco.", { hasConfirmedBookings: false, openRequests: open });
    expect(out).toBe(`${NOT_BOOKED_LINE} Mesa en Pujol: Solicitud enviada · aún no es una reserva. Lleva saco.`);
  });
  it("con una confirmada con evidencia, 'tu reserva está confirmada' se respeta", () => {
    const t = "Tu reserva está confirmada en el Hotel Urban.";
    expect(enforceNoFakeBooking(t, { hasConfirmedBookings: true })).toBe(t);
  });
  it("abrir un enlace no es compra: 'tu vuelo ya está comprado' se quita; el condicional se respeta", () => {
    expect(enforceNoFakeBooking("Tu vuelo ya está comprado. Llega 3 h antes.").startsWith(NOT_BOOKED_LINE)).toBe(true);
    expect(enforceNoFakeBooking("Listo, ya quedó reservado.").startsWith(NOT_BOOKED_LINE)).toBe(true);
    const cond = "Si tu vuelo ya está pagado, revisa el correo de la aerolínea.";
    expect(enforceNoFakeBooking(cond)).toBe(cond);
    expect(enforceNoFakeBooking("Aún no está reservado: te dejo el enlace.")).toBe("Aún no está reservado: te dejo el enlace.");
  });
  it("finalizeTurn aplica el guardarraíl con el estado de reservation_state_v", () => {
    const g = reservationGuardInput([SOLICITADA, CONFIRMADA_SIN_EVIDENCIA]);
    const out = finalizeTurn({
      raw: "¡Listo! Tu mesa en Pujol ya está confirmada.", toolRuns: [], plan: { cards: [], suggestedActions: [] },
      actionCtx: { todayISO: "2026-10-23", trips: [], activeTripId: null },
      hasConfirmedBookings: g.hasVerifiedReservation, openRequests: g.openRequests,
    });
    expect(out.text.startsWith(NOT_BOOKED_LINE)).toBe(true);
    expect(out.text).toMatch(/Mesa en Pujol: Solicitud enviada · aún no es una reserva/);
    expect(out.guards).toContain("sin_reserva_falsa");
  });
});

describe("tarjeta de solicitud: etiqueta honesta en negro y dorado", () => {
  it("una solicitud recién enviada dice que aún no es reserva", () => {
    render(<ReservationStateBadge status="solicitado" />);
    const el = screen.getByText(/Solicitud enviada · aún no es una reserva/);
    expect(el.closest("[data-reservation-state]")?.getAttribute("data-reservation-state")).toBe("REQUESTED");
    expect(el.closest("[data-reservation-state]")?.className).toMatch(/text-primary/);
  });
  it("solo con evidencia dice confirmada y quién", () => {
    render(<ReservationStateBadge row={{ canonical_state: "CONFIRMED", verification: "verificado_equipo" }} />);
    expect(screen.getByText(/Confirmada por el equipo IATOS/)).toBeTruthy();
    render(<ReservationStateBadge status="confirmed" type="members_nightlife_reservation" />);
    expect(screen.getByText(/Esperando confirmación · aún no es una reserva/)).toBeTruthy();
  });
});
