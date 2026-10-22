// T-P2-1: en Social la amistad es una SOLICITUD que la otra persona acepta o rechaza; el código se
// puede cambiar; quitar a un amigo usa el servidor (quitar_amigo) y permite bloquear; la campana deja
// aceptar o rechazar. Nada escribe directo en friendships.
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  invoke: vi.fn(async () => ({ data: null, error: null })),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  user: { id: "aaaaaaaa-0000-4000-8000-00000000000a" },
  writes: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc, from: h.from, functions: { invoke: h.invoke },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel: () => {},
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("sonner", () => ({ toast: h.toast }));

import Social from "@/pages/Social";
import { NotificationBell } from "@/components/NotificationBell";
import { connectMessage, parseFriendRequests } from "@/lib/friendRequests";
import { notificationTarget } from "@/lib/notificationTarget";

const BETO = "bbbbbbbb-0000-4000-8000-00000000000b";

function qb(table: string, rows: unknown) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api, order: () => api, or: () => api, limit: () => api,
    delete: () => { h.writes.push(`delete:${table}`); return api; },
    update: () => { h.writes.push(`update:${table}`); return api; },
    insert: () => { h.writes.push(`insert:${table}`); return api; },
    maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null, count: 0 }).then(res, rej),
  };
  return api;
}

let requests: unknown;
beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.writes = [];
  Object.values(h.toast).forEach((f) => f.mockReset());
  requests = { recibidas: [{ id: BETO, full_name: "Beto Pérez", username: "beto", avatar_url: null, created_at: "2026-10-22T10:00:00Z" }], enviadas: [], bloqueados: [] };
  h.from.mockImplementation((t: string) => qb(t, t === "profiles" ? [{ invite_code: "A3K9PQ7M" }] : []));
  h.rpc.mockImplementation(async (fn: string) => {
    if (fn === "solicitudes_amistad") return { data: requests, error: null };
    if (fn === "friend_profiles") return { data: [], error: null };
    if (fn === "responder_solicitud_amistad") return { data: { ok: true, estado: "amigos" }, error: null };
    if (fn === "agregar_amigo_por_codigo") return { data: { ok: true, estado: "pendiente" }, error: null };
    if (fn === "regenerar_codigo_invitacion") return { data: { ok: true, codigo: "ZQ7M3K9P" }, error: null };
    return { data: null, error: null };
  });
});

const renderSocial = () => render(
  <MemoryRouter initialEntries={["/dashboard/social"]}>
    <Routes><Route path="/dashboard/social" element={<Social />} /></Routes>
  </MemoryRouter>,
);

describe("Social: solicitudes de amistad (T-P2-1)", () => {
  it("muestra la solicitud pendiente y aceptar llama responder_solicitud_amistad", async () => {
    renderSocial();
    expect(await screen.findByText("Solicitudes de amistad")).toBeInTheDocument();
    expect(screen.getByText("Beto Pérez")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("responder_solicitud_amistad", { p_otro: BETO, p_aceptar: true }));
    expect(h.writes.filter((w) => w.endsWith(":friendships"))).toEqual([]);
  });

  it("rechazar y bloquear también pasan por el servidor", async () => {
    renderSocial();
    fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("responder_solicitud_amistad", { p_otro: BETO, p_aceptar: false }));
    fireEvent.click(await screen.findByRole("button", { name: "Bloquear a Beto Pérez" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("bloquear_usuario", { p_otro: BETO }));
  });

  it("usar un código dice 'Solicitud enviada', no '¡Conectados!'", async () => {
    renderSocial();
    { const t = await screen.findByRole("tab", { name: "Conectar" }); fireEvent.mouseDown(t, { button: 0 }); fireEvent.click(t); }
    fireEvent.change(await screen.findByLabelText("Código de tu amigo"), { target: { value: "b3k9pq7m" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar solicitud" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("agregar_amigo_por_codigo", { p_codigo: "B3K9PQ7M" }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Solicitud enviada/)));
    expect(h.toast.success).not.toHaveBeenCalledWith("¡Conectados!");
  });

  it("se puede cambiar el código (con confirmación) y el nuevo se muestra", async () => {
    renderSocial();
    { const t = await screen.findByRole("tab", { name: "Conectar" }); fireEvent.mouseDown(t, { button: 0 }); fireEvent.click(t); }
    fireEvent.click(await screen.findByRole("button", { name: /Cambiar mi código/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, cambiar mi código" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("regenerar_codigo_invitacion", undefined));
    expect(await screen.findByText("ZQ7M3K9P")).toBeInTheDocument();
  });

  it("la campana deja aceptar una solicitud y el aviso lleva a Social", async () => {
    h.from.mockImplementation((t: string) => qb(t, t === "notifications"
      ? [{ id: "n1", type: "friend_request", title: "Beto quiere conectar contigo", body: "Acepta o rechaza su solicitud de amistad en Social.", related_id: BETO, read: false, created_at: new Date().toISOString() }]
      : []));
    render(<MemoryRouter><NotificationBell /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Notificaciones" }));
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("responder_solicitud_amistad", { p_otro: BETO, p_aceptar: true }));
    expect(notificationTarget({ type: "friend_request", related_id: BETO })).toBe("/dashboard/social");
    expect(notificationTarget({ type: "friend_accepted", related_id: BETO })).toBe(`/dashboard/social/amigo/${BETO}`);
  });

  it("mensajes y lectura defensiva de la respuesta", () => {
    expect(connectMessage({ ok: true, estado: "pendiente" }).text).toMatch(/^Solicitud enviada/);
    expect(connectMessage({ ok: true, estado: "amigos" }).text).toBe("¡Ya son amigos!");
    expect(connectMessage({ ok: false, error: "lo_bloqueaste" }).ok).toBe(false);
    expect(parseFriendRequests(null)).toEqual({ recibidas: [], enviadas: [], bloqueados: [] });
    expect(parseFriendRequests({ recibidas: [{ nada: 1 }, { id: "x" }] }).recibidas).toHaveLength(1);
  });
});
