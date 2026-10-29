// Opiniones ("¿Algo no se entiende? Cuéntanos"): validación del servidor, función enviar-opinion con
// base, límite y correo simulados, correo al equipo (asunto, datos, HTML escapado), entrada discreta en el
// menú y al pie (sin botón flotante), diálogo con sus estados, y la vista en la Mesa de operaciones.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// La casilla (Radix) mide su tamaño con ResizeObserver, que jsdom no trae.
(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const rpc = vi.fn();
const invoke = vi.fn();
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => qb },
}));
const auth = { user: { id: "u1", email: "alvaro@correo.mx" }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: false }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));

import {
  opinionTeamEmail, opinionTitle, sanitizeRoute, screenName, tripIdFromRoute, validateOpinion,
} from "../../supabase/functions/_shared/opinion";
import { ownerAlertEmail, sendOwnerAlert, teamReplyEmail, type OpsItem } from "../../supabase/functions/_shared/ops-desk";
import { opsTypeLabel, userStageText } from "../../supabase/functions/_shared/ops-labels";
import { isPaidBucket } from "../../supabase/functions/_shared/rate-limit-core";
import { OPINION_LIMITS, submitOpinion, type OpinionDeps } from "../../supabase/functions/enviar-opinion/core";
import { contextLines, opinionContext, sendOpinion } from "@/lib/opinion";
import { OpinionDialog } from "@/components/opinion/OpinionDialog";
import { DashboardLayout } from "@/components/DashboardLayout";
import { MyTeamRequests } from "@/components/concierge/MyTeamRequests";

const TRIP = "0b100000-0000-0000-0000-00000000000a";
const SITE = "https://traveliatos.life";

beforeEach(() => { rpc.mockReset(); invoke.mockReset(); });

// ───────────────────────────── validación (servidor) ─────────────────────────────
describe("validación de la opinión", () => {
  it("acepta lo válido; la casilla de contacto viene marcada si no dicen lo contrario", () => {
    const v = validateOpinion({ tipo: "confuso", texto: "  No entendí dónde ver mis vuelos  ", calificacion: 3, ruta: `/dashboard/viajes/${TRIP}`, dispositivo: "celular" });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value).toMatchObject({ tipo: "confuso", texto: "No entendí dónde ver mis vuelos", calificacion: 3, contactar: true,
      pantalla: "Detalle del viaje", dispositivo: "celular", trip_id: TRIP });
    expect(validateOpinion({ tipo: "idea", texto: "Una idea", contactar: false }).ok && (validateOpinion({ tipo: "idea", texto: "Una idea", contactar: false }) as any).value.contactar).toBe(false);
  });

  it("rechaza tipo inventado, texto vacío o de más de 2000 y calificación fuera de 1–5", () => {
    expect(validateOpinion({ tipo: "queja", texto: "hola hola" })).toMatchObject({ ok: false, code: "INVALID_TYPE" });
    expect(validateOpinion({ tipo: "idea", texto: "  " })).toMatchObject({ ok: false, code: "TEXT_REQUIRED" });
    expect(validateOpinion({ tipo: "idea", texto: "a".repeat(2001) })).toMatchObject({ ok: false, code: "TEXT_TOO_LONG" });
    expect(validateOpinion({ tipo: "idea", texto: "a".repeat(2000) }).ok).toBe(true);
    expect(validateOpinion({ tipo: "idea", texto: "una idea", calificacion: 6 })).toMatchObject({ ok: false, code: "INVALID_RATING" });
    expect(validateOpinion({ tipo: "idea", texto: "una idea", calificacion: 2.5 })).toMatchObject({ ok: false, code: "INVALID_RATING" });
    expect(validateOpinion(null)).toMatchObject({ ok: false });
  });

  it("la ruta se guarda sin consulta, fragmento ni códigos; la pantalla la nombra el servidor", () => {
    expect(sanitizeRoute("/reset-password?code=abc123#token=xyz")).toBe("/reset-password");
    expect(sanitizeRoute("/prive/key/AbCd1234EfGh5678IjKl")).toBe("/prive/key/:codigo");
    expect(sanitizeRoute(`/dashboard/viajes/${TRIP.toUpperCase()}/mapa`)).toBe(`/dashboard/viajes/${TRIP}/mapa`);
    expect(sanitizeRoute("https://evil.test/x")).toBeNull();
    expect(sanitizeRoute("//evil.test")).toBeNull();
    expect(screenName("/dashboard/viajes")).toBe("Mis viajes");
    expect(screenName(`/dashboard/viajes/${TRIP}/packing`)).toBe("Equipaje del viaje");
    expect(tripIdFromRoute("/dashboard/viajes/importar")).toBeNull();
    // Lo que diga el cliente sobre la pantalla no se usa.
    const v = validateOpinion({ tipo: "idea", texto: "una idea", ruta: "/dashboard", pantalla: "<script>" });
    expect(v.ok && v.value.pantalla).toBe("Inicio");
  });

  it("el título se entiende en la mesa y en Mis solicitudes", () => {
    expect(opinionTitle({ tipo: "confuso", texto: "No entendí dónde ver mis vuelos" })).toBe("Algo es confuso: No entendí dónde ver mis vuelos");
    expect(opinionTitle({ tipo: "idea", texto: "palabra ".repeat(40) }).length).toBeLessThanOrEqual(120);
    expect(opsTypeLabel("opinion")).toBe("Opinión");
    expect(userStageText("nueva", "opinion")).toBe("Recibida · la leerá el equipo IATOS");
    expect(userStageText("en_proceso", "opinion")).toBe("Leída por el equipo IATOS");
  });
});

// ───────────────────────────── función enviar-opinion (simulada) ─────────────────────────────
const deps = (over: Partial<OpinionDeps> = {}): OpinionDeps & { inserted: Record<string, unknown>[]; alerts: [string, string | null][] } => {
  const inserted: Record<string, unknown>[] = [];
  const alerts: [string, string | null][] = [];
  return {
    inserted, alerts,
    userId: "u1", userEmail: "alvaro@correo.mx",
    rateLimit: async () => ({ allowed: true, retryAfter: 0 }),
    tripVisible: async (id) => id === TRIP,
    insert: async (row) => { inserted.push(row); return { data: { id: "0b200000-0000-0000-0000-000000000001", status: "solicitado" }, error: null }; },
    alert: async (id, replyTo) => { alerts.push([id, replyTo]); return { notified: true }; },
    ...over,
  };
};

describe("enviar-opinion", () => {
  it("guarda la opinión como solicitud de la mesa y avisa al equipo con el correo del usuario", async () => {
    const d = deps();
    const r = await submitOpinion(d, { tipo: "confuso", texto: "No entendí dónde ver mis vuelos", calificacion: 4, ruta: `/dashboard/viajes/${TRIP}`, dispositivo: "celular", version: "index-AbC123" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, folio: "0B200000", team_notified: true, contexto: { pantalla: "Detalle del viaje", trip_id: TRIP } });
    expect(d.inserted[0]).toMatchObject({ user_id: "u1", trip_id: TRIP, type: "opinion", status: "solicitado", title: "Algo es confuso: No entendí dónde ver mis vuelos",
      payload: { tipo: "confuso", texto: "No entendí dónde ver mis vuelos", calificacion: 4, contactar: true, ruta: `/dashboard/viajes/${TRIP}`, pantalla: "Detalle del viaje", dispositivo: "celular", version: "index-AbC123", origen: "app_opinion" } });
    expect(d.alerts).toEqual([["0b200000-0000-0000-0000-000000000001", "alvaro@correo.mx"]]);
  });

  it("sin permiso de correo no se pasa su dirección para responder; un viaje ajeno no se liga", async () => {
    const d = deps();
    await submitOpinion(d, { tipo: "idea", texto: "Una idea", contactar: false, trip_id: "0b100000-0000-0000-0000-0000000000ff" });
    expect(d.inserted[0].trip_id).toBeNull();
    expect(d.alerts[0][1]).toBeNull();
  });

  it("límite por persona (10 por hora) con el rate-limit que ya existe; falla cerrada si no se puede verificar", async () => {
    expect(OPINION_LIMITS).toMatchObject({ perHour: 10 });
    expect(isPaidBucket("enviar-opinion")).toBe(true);
    const limited = deps({ rateLimit: async () => ({ allowed: false, retryAfter: 900, scope: "user" }) });
    const r = await submitOpinion(limited, { tipo: "idea", texto: "Una idea" });
    expect(r.status).toBe(429);
    expect(String(r.body.message)).toMatch(/varias opiniones/);
    expect(limited.inserted).toHaveLength(0);
    const down = await submitOpinion(deps({ rateLimit: async () => ({ allowed: false, retryAfter: 30, scope: "unavailable" }) }), { tipo: "idea", texto: "Una idea" });
    expect(down.status).toBe(503);
    // El tope de la base también se traduce a 429.
    const db = await submitOpinion(deps({ insert: async () => ({ data: null, error: { code: "P0001", message: "OPINION_RATE_LIMIT: máximo 10" } }) }), { tipo: "idea", texto: "Una idea" });
    expect(db.status).toBe(429);
  });

  it("valida en el servidor (400) y si el correo falla la opinión igual quedó en la mesa", async () => {
    const bad = deps();
    expect((await submitOpinion(bad, { tipo: "idea", texto: "" })).status).toBe(400);
    expect(bad.inserted).toHaveLength(0);
    const r = await submitOpinion(deps({ alert: async () => { throw new Error("resend caído"); } }), { tipo: "idea", texto: "Una idea" });
    expect(r).toMatchObject({ status: 200, body: { ok: true, team_notified: false } });
    const failed = await submitOpinion(deps({ insert: async () => ({ data: null, error: { code: "XX000", message: "boom" } }) }), { tipo: "idea", texto: "Una idea" });
    expect(failed.status).toBe(500);
  });

  it("el reintento con la misma clave no duplica la opinión ni el correo", async () => {
    const store = new Map<string, { status: number; body: Record<string, unknown> }>();
    const idem = {
      claim: async (_u: string, _s: string, k: string) => (store.has(k) ? { state: "done" as const, response: store.get(k)! } : { state: "new" as const }),
      finish: async (_u: string, _s: string, k: string, resp: { status: number; body: Record<string, unknown> } | null) => { if (resp) store.set(k, resp); },
    };
    const d = deps({ idem });
    const body = { tipo: "idea", texto: "Una idea", idempotency_key: "k".repeat(24) };
    await submitOpinion(d, body);
    const again = await submitOpinion(d, body);
    expect(again.body).toMatchObject({ ok: true, idempotent_replay: true });
    expect(d.inserted).toHaveLength(1);
    expect(d.alerts).toHaveLength(1);
  });
});

// ───────────────────────────── correo al equipo ─────────────────────────────
const alertItem: OpsItem = {
  source: "concierge_request", id: "0b200000-0000-0000-0000-000000000001", type: "opinion", title: "Algo es confuso: no entendí", status: "solicitado",
  stage: "nueva", created_at: "2026-10-29T18:00:00Z",
  payload: { tipo: "confuso", texto: "No entendí <script>alert(1)</script>\ndónde ver mis vuelos", calificacion: 2, contactar: true,
    ruta: `/dashboard/viajes/${TRIP}`, pantalla: "Detalle del viaje", dispositivo: "celular", version: "index-AbC123" },
  trip: { id: TRIP, destino: "Oaxaca" },
  user: { id: "u1", name: "Álvaro Viajero", email: "alvaro@correo.mx" },
};

describe("correo al equipo por cada opinión", () => {
  it("asunto claro y nombre, correo, pantalla y texto; el HTML va escapado", () => {
    const m = ownerAlertEmail(alertItem, SITE);
    expect(m).toEqual(opinionTeamEmail(alertItem, SITE));
    expect(m.subject).toBe(`Opinión IATOS · Confuso · /dashboard/viajes/${TRIP}`);
    for (const t of ["Álvaro Viajero", "alvaro@correo.mx", "Detalle del viaje", "Oaxaca", "Celular · versión index-AbC123", "Calificación: 2 de 5"]) expect(m.text).toContain(t);
    expect(m.text).toContain("dónde ver mis vuelos");
    expect(m.html).not.toContain("<script>alert(1)</script>");
    expect(m.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(m.html).toContain(`href="${SITE}/admin/operaciones?id=0b200000-0000-0000-0000-000000000001"`);
  });

  it("se manda a todo el equipo (FIXER_EMAIL) con la marca de la mesa; sin permiso de correo, sin «responder a»", async () => {
    const sent: any[] = [];
    const calls: string[] = [];
    const noContact = { ...alertItem, payload: { ...alertItem.payload, contactar: false } };
    const mk = (item: OpsItem) => ({
      rpc: async (fn: string) => { calls.push(fn); return fn === "ops_owner_alert_claim" ? { data: { ok: true, alert: item }, error: null } : { data: { ok: true }, error: null }; },
      send: async (m: any) => { sent.push(m); return { ok: true, id: "em_1" }; },
      siteUrl: SITE, ownerEmail: ["dueno@iatos.mx", "carlo@iatos.mx"],
    });
    await sendOwnerAlert(mk(alertItem), alertItem.id, { replyTo: "alvaro@correo.mx" });
    await sendOwnerAlert(mk(noContact), alertItem.id, { replyTo: null });
    expect(calls).toEqual(["ops_owner_alert_claim", "ops_owner_alert_finish", "ops_owner_alert_claim", "ops_owner_alert_finish"]);
    expect(sent[0]).toMatchObject({ to: ["dueno@iatos.mx", "carlo@iatos.mx"], replyTo: "alvaro@correo.mx" });
    expect(sent[0].subject).toMatch(/^Opinión IATOS · Confuso/);
    expect(sent[1].replyTo).toBeUndefined();
    expect(sent[1].text).toContain("No quiere que le escriban por correo");
  });

  it("la respuesta del equipo al usuario no habla de reservas", () => {
    const m = teamReplyEmail({ reply: { id: "r1", kind: "respuesta", body: "Gracias, Álvaro.", source: "concierge_request", source_id: alertItem.id },
      to: "alvaro@correo.mx", name: "Álvaro", item: { ...alertItem, stage: "en_proceso" } }, SITE);
    expect(m.text).not.toMatch(/reserva/i);
    expect(m.text).toContain("Tu opinión: Algo es confuso");
    expect(m.text).toContain("nos mandaste tu opinión desde la app");
  });
});

// ───────────────────────────── app: envío y estados ─────────────────────────────
describe("envío desde la app", () => {
  it("adjunta solo pantalla, dispositivo, versión y viaje, y se lo dice al usuario", () => {
    const c = opinionContext(`/dashboard/viajes/${TRIP}?tab=vuelos`);
    expect(c).toMatchObject({ ruta: `/dashboard/viajes/${TRIP}`, pantalla: "Detalle del viaje", trip_id: TRIP });
    expect(["celular", "escritorio"]).toContain(c.dispositivo);
    const lines = contextLines(c).join(" | ");
    // Ronda 3, P2-1: en palabras ("Pantalla: Detalle del viaje · Celular"); la ruta, la versión y el id
    // del viaje se envían pero no se muestran.
    expect(lines).toMatch(/Pantalla: Detalle del viaje · (Celular|Escritorio)/);
    expect(lines).toContain("Viaje: el que tienes abierto");
    expect(lines).not.toContain("0b100000");
  });

  it("sin conexión no llama al servidor y lo dice; red caída y límite también", async () => {
    const ctx = opinionContext("/dashboard");
    const d = { tipo: "idea" as const, texto: "Una idea", calificacion: null, contactar: true };
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await sendOpinion(d, ctx, "k".repeat(20))).toMatchObject({ ok: false, kind: "offline" });
    expect(invoke).not.toHaveBeenCalled();
    spy.mockReturnValue(true);
    invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error("Failed to send a request to the Edge Function"), { name: "FunctionsFetchError" }) });
    expect(await sendOpinion(d, ctx, "k".repeat(20))).toMatchObject({ ok: false, kind: "offline" });
    invoke.mockResolvedValueOnce({ data: null, error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError", context: new Response(JSON.stringify({ code: "RATE_LIMITED", message: "Ya nos mandaste varias opiniones en poco tiempo." }), { status: 429 }) }) });
    expect(await sendOpinion(d, ctx, "k".repeat(20))).toMatchObject({ ok: false, kind: "rate_limited", message: "Ya nos mandaste varias opiniones en poco tiempo." });
    invoke.mockResolvedValueOnce({ data: { ok: true, folio: "0B200000", team_notified: true }, error: null });
    expect(await sendOpinion(d, ctx, "k".repeat(20))).toEqual({ ok: true, folio: "0B200000", teamNotified: true });
    expect(invoke).toHaveBeenLastCalledWith("enviar-opinion", { body: expect.objectContaining({ tipo: "idea", texto: "Una idea", contactar: true, ruta: "/dashboard", idempotency_key: "k".repeat(20) }) });
    spy.mockRestore();
  });

  it("diálogo: tipo, texto, calificación, casilla marcada, envío y «¡Gracias! Le llegó al equipo de IATOS.»", async () => {
    invoke.mockResolvedValue({ data: { ok: true, folio: "0B200000", team_notified: true }, error: null });
    render(<MemoryRouter><OpinionDialog open onOpenChange={() => {}} pathname="/dashboard/viajes" /></MemoryRouter>);
    const dlg = screen.getByTestId("opinion-dialog");
    expect(within(dlg).getByRole("checkbox", { name: "Pueden contactarme por correo" })).toHaveAttribute("data-state", "checked");
    expect(within(dlg).getByTestId("opinion-context")).toHaveTextContent(/Pantalla: Mis viajes · (Celular|Escritorio)/);
    // Sin tipo no se envía.
    fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" }));
    expect(await within(dlg).findByText("Elige qué nos quieres contar.")).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("radio", { name: "Algo es confuso" }));
    fireEvent.change(within(dlg).getByLabelText("Cuéntanos con tus palabras"), { target: { value: "No entendí dónde ver mis vuelos" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "4 de 5" }));
    expect(within(dlg).getByText("31/2000")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" }));
    expect(await screen.findByText("¡Gracias! Le llegó al equipo de IATOS.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("enviar-opinion", { body: expect.objectContaining({ tipo: "confuso", calificacion: 4, contactar: true, ruta: "/dashboard/viajes" }) });
    expect(screen.getByText(/Folio 0B200000/)).toBeInTheDocument();
  });

  it("diálogo sin conexión: lo dice, no lo da por enviado y conserva el texto", async () => {
    const spy = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<MemoryRouter><OpinionDialog open onOpenChange={() => {}} pathname="/dashboard" /></MemoryRouter>);
    const dlg = screen.getByTestId("opinion-dialog");
    fireEvent.click(within(dlg).getByRole("radio", { name: "Algo no funciona" }));
    fireEvent.change(within(dlg).getByLabelText("Cuéntanos con tus palabras"), { target: { value: "No carga el mapa" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Enviar" }));
    expect(await within(dlg).findByTestId("opinion-error")).toHaveTextContent("Estás sin conexión. Tu opinión no se envió");
    expect(within(dlg).getByLabelText("Cuéntanos con tus palabras")).toHaveValue("No carga el mapa");
    expect(within(dlg).getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText(/Le llegó al equipo/)).toBeNull();
    spy.mockRestore();
  });
});

// ───────────────────────────── entrada discreta ─────────────────────────────
describe("entrada en el menú y al pie (sin botón flotante)", () => {
  const renderAt = (path: string) => render(
    <MemoryRouter initialEntries={[path]}><DashboardLayout><div>PAGINA</div></DashboardLayout></MemoryRouter>,
  );

  it("«Más» y el menú lateral tienen la opción; al pie hay un enlace de texto gris; nada fijo nuevo", async () => {
    renderAt("/dashboard/viajes");
    const footer = screen.getByTestId("opinion-footer-link");
    expect(footer).toHaveTextContent("¿Algo no se entiende? Cuéntanos");
    expect(footer.className).toContain("text-xs");
    expect(footer.className).toContain("text-muted-foreground");
    expect(footer.closest(".fixed, .sticky")).toBeNull();
    expect(screen.getByTestId("sidebar-opinion")).toHaveTextContent("¿Algo no se entiende? Cuéntanos");
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const more = within(screen.getByRole("dialog"));
    fireEvent.click(more.getByTestId("more-opinion"));
    expect(await screen.findByTestId("opinion-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("opinion-context")).toHaveTextContent("Mis viajes");
  });

  it("al pie se abre el diálogo; en el chat del Concierge no se agrega (el compositor va pegado abajo)", async () => {
    const { unmount } = renderAt("/dashboard");
    await act(async () => { fireEvent.click(screen.getByTestId("opinion-footer-link")); });
    expect(await screen.findByTestId("opinion-dialog")).toBeInTheDocument();
    unmount();
    renderAt("/dashboard/concierge");
    expect(screen.queryByTestId("opinion-footer-link")).toBeNull();
    expect(screen.getByTestId("sidebar-opinion")).toBeInTheDocument();
  });
});

// ───────────────────────────── Mesa de operaciones ─────────────────────────────
describe("Mesa de operaciones: opiniones", () => {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  const opinion = { ...alertItem, created_at: ago(1), history: [], replies: [], owner: null, alert: { status: "enviado" } };
  const reserva = {
    source: "concierge_request", id: "7e300000-0000-0000-0000-000000000001", type: "reservation", title: "Mesa en Contramar", status: "solicitado",
    stage: "nueva", created_at: ago(2), place: "Contramar", payload: {}, user: { name: "Ana", email: "ana@correo.mx" }, history: [], replies: [],
  };
  const list = { generated_at: new Date().toISOString(), counts: { nueva: 2 }, items: [opinion, reserva] };

  it("filtro «Opiniones», detalle con texto, calificación, pantalla y contacto, y acciones de opinión", async () => {
    const { default: AdminOperations } = await import("@/pages/AdminOperations");
    rpc.mockImplementation(async (fn: string) => fn === "admin_ops_list" ? { data: list, error: null }
      : fn === "admin_opinion_mark" ? { data: { ok: true, item: { ...opinion, stage: "en_proceso" } }, error: null } : { data: null, error: null });
    render(<MemoryRouter initialEntries={["/admin/operaciones"]}><AdminOperations /></MemoryRouter>);
    expect(await screen.findAllByTestId("ops-item")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("filter-opinions"));
    const cards = screen.getAllByTestId("ops-item");
    expect(cards).toHaveLength(1);
    const card = within(cards[0]);
    expect(card.getAllByText("Opinión").length).toBeGreaterThan(0);
    const detail = within(card.getByTestId("opinion-detail"));
    expect(detail.getByText(/Álvaro Viajero/)).toBeInTheDocument();
    expect(detail.getByText("alvaro@correo.mx")).toHaveAttribute("href", "mailto:alvaro@correo.mx");
    expect(detail.getByText(/dónde ver mis vuelos/)).toBeInTheDocument();
    expect(detail.getByText("★★☆☆☆ (2 de 5)")).toBeInTheDocument();
    expect(detail.getByText(`Detalle del viaje · /dashboard/viajes/${TRIP}`)).toBeInTheDocument();
    expect(detail.getByText("Acepta que le escriban por correo")).toBeInTheDocument();
    const actions = within(card.getByTestId("opinion-actions"));
    expect(actions.queryByRole("button", { name: /No se pudo/ })).toBeNull();
    expect(actions.queryByRole("button", { name: /^Tomar/ })).toBeNull();
    fireEvent.click(actions.getByRole("button", { name: /Marcar leída/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_opinion_mark", { _id: opinion.id, _mark: "leida" }));
    expect(await screen.findByText("Marcada como leída: queda en proceso a tu nombre.")).toBeInTheDocument();
  });

  it("Responder usa la mesa (admin_ops_act) y avisa si el usuario no quiere correo", async () => {
    const { default: AdminOperations } = await import("@/pages/AdminOperations");
    const noMail = { ...opinion, payload: { ...opinion.payload, contactar: false } };
    rpc.mockImplementation(async (fn: string) => fn === "admin_ops_list" ? { data: { ...list, items: [noMail] }, error: null }
      : fn === "admin_ops_act" ? { data: { ok: true, reply_id: "r1", item: noMail }, error: null } : { data: null, error: null });
    invoke.mockResolvedValue({ data: { email_status: "sin_correo" }, error: null });
    render(<MemoryRouter initialEntries={["/admin/operaciones"]}><AdminOperations /></MemoryRouter>);
    const card = within((await screen.findAllByTestId("ops-item"))[0]);
    expect(card.getByText("No quiere correo: la respuesta la verá solo en la app")).toBeInTheDocument();
    fireEvent.click(card.getByRole("button", { name: /Responder/ }));
    expect(card.getByText(/tu respuesta la verá solo en la app/)).toBeInTheDocument();
    fireEvent.change(card.getByLabelText("Mensaje para el usuario"), { target: { value: "Gracias, ya lo estamos viendo." } });
    fireEvent.click(card.getByRole("button", { name: "Enviar al usuario" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_ops_act", expect.objectContaining({ _id: opinion.id, _action: "responder" })));
    expect(await screen.findByText(/El usuario no tiene correo: lo verá en la app/)).toBeInTheDocument();
  });

  it("«Mis solicitudes» muestra la opinión con su estado de opinión (no de reserva)", async () => {
    rpc.mockResolvedValue({ data: [{ source: "concierge_request", id: opinion.id, type: "opinion", title: "Algo es confuso: no entendí", status: "solicitado",
      stage: "nueva", created_at: ago(1), replies: [], history: [] }], error: null });
    render(<MyTeamRequests />);
    const item = within(await screen.findByTestId("team-request"));
    expect(item.getByText("Opinión")).toBeInTheDocument();
    expect(item.getByText("Recibida · la leerá el equipo IATOS")).toBeInTheDocument();
    expect(item.queryByText(/aún no es una reserva/)).toBeNull();
    expect(item.getByText("La lee una persona del equipo IATOS; si te responde, lo verás aquí.")).toBeInTheDocument();
  });
});
