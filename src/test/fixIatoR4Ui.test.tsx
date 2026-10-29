// Auditoría 10, ronda 4 de Iato / Concierge: defectos de pantalla (Emergencia local, panel del avatar,
// nombres de botones, pie del globo, selector, tarjetas y "Iato" con la serifa). Todo simulado, sin red.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const invoke = vi.fn();
const chain = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generador encadenable simulado
  const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => q, insert: () => q, update: () => q,
    maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }) };
  return q;
};
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => chain(),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "sofia@example.test", user_metadata: {} } }) }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true }) }));
vi.mock("@/hooks/useActiveTrip", () => ({ useActiveTrip: () => ({ trip: null }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/reverseGeocode", () => ({ reverseGeocode: async () => ({ countryCode: "MX", city: "Ciudad de México" }) }));

import { ConciergeActions } from "@/components/ConciergeActions";
import { TravelerAvatar, avatarPanelPosition } from "@/components/TravelerAvatar";
import { FixerButton, FIXER_BUTTON_LABEL } from "@/components/FixerButton";
import { bubbleFooterTime } from "@/lib/bubbleTime";
import { compactTripLabel, TripContextSelector } from "@/components/concierge/TripContextSelector";
import { alertInternalLink, RichCard } from "@/components/concierge/ConciergeCards";
import { AiReservationsPanel, AiReservationsLinkNote, AI_RES_SEND_LABEL } from "@/components/reservas/AiReservationsPanel";
import { HistoryNotice } from "@/components/concierge/HistoryNotice";
import { SUMMARY_NOTICE_TEXT } from "@/lib/conciergeHistory";

const ROOT = join(__dirname, "..", "..");
const src = (f: string) => readFileSync(join(ROOT, f), "utf8");

beforeEach(() => { invoke.mockReset(); });

// ═══ N4-P1-2 · Emergencia local: solo se pinta la respuesta de la pestaña activa ═══
const place = (id: string, name: string, type: string, distance_m = 280) => ({
  id, name, address: "Centro, CDMX", lat: 19.43, lng: -99.13, rating: 4.2, ratings_count: 10, price_level: null, phone: null,
  maps_url: "https://maps.google.com/?cid=1", website: null, open_now: true, type, source: "Google Maps", distance_m,
});
describe("N4-P1-2 · Emergencia local sin carrera entre pestañas", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: any) => ok({ coords: { latitude: 19.4326, longitude: -99.1332 } }) } });
  });
  it("Hospital tarda más que Farmacia: con 'Farmacia' marcada se ven farmacias, nunca los hospitales que llegan al final", async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    invoke.mockImplementation((_fn: string, opts: any) => new Promise((r) => { pending[opts.body.kind] = r; }));
    render(<ConciergeActions open kind="emergency" onClose={() => {}} />);
    await waitFor(() => expect(pending.hospital).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: "Farmacia" }));
    await waitFor(() => expect(pending.pharmacy).toBeTypeOf("function"));
    // La de la pestaña anterior se cancela (AbortController) y su respuesta llega al último (como en producción: 7031 vs 7069 ms).
    expect((invoke.mock.calls[0][1] as any).signal?.aborted).toBe(true);
    await act(async () => { pending.pharmacy({ data: { places: [place("f1", "Farmacia del Ahorro Centro", "Farmacia")] }, error: null }); });
    await act(async () => { pending.hospital({ data: { places: [place("h1", "Hospital de Jesús", "Hospital")] }, error: null }); });
    expect(screen.getByText("Farmacia del Ahorro Centro")).toBeInTheDocument();
    expect(screen.queryByText("Hospital de Jesús")).toBeNull();
    expect(screen.queryByText(/Buscando lugares reales/)).toBeNull();
  });
  it("mientras carga la pestaña nueva, el indicador sigue y la lista vieja no se queda debajo", async () => {
    const pending: Record<string, (v: unknown) => void> = {};
    invoke.mockImplementation((_fn: string, opts: any) => new Promise((r) => { pending[opts.body.kind] = r; }));
    render(<ConciergeActions open kind="emergency" onClose={() => {}} />);
    await waitFor(() => expect(pending.hospital).toBeTypeOf("function"));
    await act(async () => { pending.hospital({ data: { places: [place("h1", "Hospital de Jesús", "Hospital")] }, error: null }); });
    expect(screen.getByText("Hospital de Jesús")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Policía" }));
    expect(screen.getByText(/Buscando lugares reales/)).toBeInTheDocument();
    expect(screen.queryByText("Hospital de Jesús")).toBeNull();
    expect(screen.getByTestId("live-action-places")).toHaveAttribute("aria-busy", "true");
  });
  it("N4-P2-10: la distancia no se parte ('a / 280 / m') con una categoría larga", async () => {
    invoke.mockResolvedValue({ data: { places: [place("f2", "FHN Similia Centro", "Farmacia homeopática y tienda de productos naturales", 280)] }, error: null });
    render(<ConciergeActions open kind="emergency" onClose={() => {}} />);
    const d = await screen.findByTestId("place-distance");
    expect(d).toHaveTextContent("a 280 m");
    expect(d.className).toMatch(/whitespace-nowrap/);
    expect(d.className).toMatch(/shrink-0/);
    expect(screen.getByText(/Farmacia homeopática/).className).toMatch(/truncate/);
  });
});

// ═══ N4-P1-3 · Panel del avatar en el celular ═══
describe("N4-P1-3 · panel 'Tu avatar de viajero' en el celular", () => {
  afterEach(() => { document.body.innerHTML = ""; });
  it("dentro de la pantalla (16 px a cada lado en 390 px) y alineado al botón en escritorio", () => {
    // Producción: el panel iba de x=-66 a x=274 (right-0 w-[340px] desde un botón a la mitad).
    expect(avatarPanelPosition({ bottom: 110, right: 274 }, 390)).toEqual({ top: 118, left: 16, right: 16 });
    const desk = avatarPanelPosition({ bottom: 60, right: 1200 }, 1366);
    expect(desk).toEqual({ top: 68, left: 1200 - 420, width: 420 });
  });
  it("la 'S' con corona tiene nombre y dice qué es; el panel es opaco, va encima (portal) y se cierra con Escape o tocando fuera", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    render(<div><button type="button">Ayuda abajo</button><TravelerAvatar compact /></div>);
    const trigger = screen.getByRole("button", { name: /^Tu avatar de viajero: Viajero/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveTextContent("Tuavatar");
    fireEvent.click(trigger);
    const panel = screen.getByRole("dialog", { name: "Tu avatar de viajero" });
    expect(panel.parentElement).toBe(document.body);
    expect(panel.className).toMatch(/\bbg-card\b/);
    expect(panel.className).not.toMatch(/glass-card/);
    expect(panel.className).toMatch(/\bfixed\b/);
    expect(panel.className).toMatch(/z-\[80\]/);
    expect(panel.style.left).toBe("16px");
    expect(panel.style.right).toBe("16px");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // Tocar fuera cierra, sin capa que bloquee: el botón de abajo recibe el toque.
    const below = screen.getByRole("button", { name: "Ayuda abajo" });
    const onClick = vi.fn();
    below.addEventListener("click", onClick);
    fireEvent.pointerDown(below);
    fireEvent.click(below);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClick).toHaveBeenCalled();
    // Ya no hay capa fixed inset-0.
    expect(src("src/components/TravelerAvatar.tsx")).not.toMatch(/fixed inset-0 z-40/);
  });
});

// ═══ "Hablar con una persona" igual en celular y escritorio ═══
describe("'Hablar con una persona' (escritorio) y 'Ayuda' (celular) → el mismo nombre", () => {
  it("el botón dice 'Hablar con una persona' en los dos tamaños", () => {
    render(<MemoryRouter><FixerButton trip={null} /></MemoryRouter>);
    const btn = screen.getByRole("button", { name: "Hablar con una persona del equipo IATOS" });
    expect(FIXER_BUTTON_LABEL).toBe("Hablar con una persona");
    expect(within(btn).getByTestId("fixer-label-mobile")).toHaveTextContent("Hablar conuna persona");
    expect(btn).not.toHaveTextContent(/Ayuda/);
  });
});

// ═══ N4-P2-2 · pie del globo ═══
describe("N4-P2-2 · el pie del globo dice 'consultado 02:54 (hora CDMX)'", () => {
  it("respuesta de Iato: hora de consulta con su zona; mensaje del usuario: solo la hora", () => {
    const ts = Date.parse("2026-10-29T08:54:00Z");
    const now = new Date("2026-10-29T09:00:00Z");
    expect(bubbleFooterTime(ts, { assistant: true, tz: "America/Mexico_City", now })).toBe("consultado 02:54 (hora CDMX)");
    expect(bubbleFooterTime(ts, { assistant: false, tz: "America/Mexico_City", now })).toBe("02:54");
    expect(bubbleFooterTime(ts, { assistant: true, tz: "America/Mexico_City", now: new Date("2026-10-30T18:00:00Z") })).toBe("consultado 29 oct, 02:54 (hora CDMX)");
    expect(bubbleFooterTime(ts, { assistant: true, tz: "UTC", now })).toBe("consultado 08:54 (hora UTC)");
    expect(src("src/pages/Concierge.tsx")).toMatch(/bubbleFooterParts\(msg\.ts, \{ assistant: !isUser && msg\.id !== "welcome"/);
  });
});

// ═══ N4-P2-9 · selector cortado a 390 px ═══
describe("N4-P2-9 · el selector de viaje no se corta", () => {
  const TRIPS = [
    { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" },
    { id: "oax", destino: "Oaxaca", fecha_salida: "2027-01-15", fecha_regreso: "2027-01-18" },
    { id: "bud", destino: "Budapest", fecha_salida: "2026-12-29", fecha_regreso: "2027-01-03" },
  ];
  it("nombre corto: 'Oaxaca · 15–18 ene' (antes 'Oaxaca (15 ene al 18 ene)' cortado en 'Oaxaca (15 ene al 18 e…')", () => {
    expect(compactTripLabel(TRIPS[1])).toBe("Oaxaca · 15–18 ene");
    expect(compactTripLabel(TRIPS[0])).toBe("Valle de Bravo · 30 oct–1 nov");
    expect(compactTripLabel(TRIPS[2])).toBe("Budapest · 29 dic–3 ene 27");
    expect(compactTripLabel(TRIPS[1]).length).toBeLessThan("Oaxaca (15 ene al 18 ene)".length);
  });
  it("en el celular el texto de quién eligió el viaje baja de renglón (el nombre del viaje tiene el ancho)", () => {
    render(<TripContextSelector trips={TRIPS} todayLocal="2026-10-29" pinnedId="vb" followId="oax"
      resolved={{ trip: TRIPS[0], reason: "pinned", candidates: [TRIPS[0]] } as any} onChange={() => {}} />);
    const sel = screen.getByRole("combobox", { name: "Viaje en contexto" }) as HTMLSelectElement;
    expect(sel.selectedOptions[0].textContent).toBe("Oaxaca · 15–18 ene");
    expect(screen.getByTestId("trip-phase").className).toMatch(/basis-full sm:basis-auto/);
    expect(screen.getByTestId("trip-context").className).toMatch(/flex-wrap/);
  });
});

// ═══ N4-P2-6 · tarjeta de seguro con enlace ═══
describe("N4-P2-6 · 'Sin seguro de viaje' lleva a /dashboard/seguros", () => {
  it("la tarjeta de aviso tiene el botón a la sección (y la ruta existe)", () => {
    expect(alertInternalLink({ title: "Sin seguro de viaje", body: "No detecto seguro de viaje contratado." })).toEqual({ to: "/dashboard/seguros", label: "Ver seguros de viaje" });
    expect(alertInternalLink({ title: "Ayuda inmediata", body: "Si hay riesgo para tu vida, llama al número de emergencias local ahora." })).toBeNull();
    render(<MemoryRouter><RichCard card={{ type: "alert", title: "Sin seguro de viaje", body: "No detecto seguro de viaje contratado para este viaje." } as any} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "Ver seguros de viaje" })).toHaveAttribute("href", "/dashboard/seguros");
    expect(src("src/App.tsx")).toMatch(/path="\/dashboard\/seguros"/);
  });
});

// ═══ N4-P2-4 · el mismo nombre de botón en el chat y en Mis reservas ═══
const RES = {
  id: "r1", ref_code: "R-1", venue_name: "Contramar", venue_email: "reservas@contramar.test", venue_address: null, venue_city: "CDMX",
  venue_place_id: null, requested_local: "2026-11-13T14:30", requested_for: "2026-11-13T20:30:00Z", party_size: 2, customer_name: "Sofía",
  reason: null, user_options: null, alternatives: null, confirmation: null, confirmation_code: null, venue_reply_excerpt: null,
  created_at: "2026-10-28T00:00:00Z", confirm_prompt: "Confirmar: escribiremos a Contramar en tu nombre", is_confirmed: false,
  status: "awaiting_user_ok", label: "Falta tu confirmación · aún no escribimos al restaurante",
};
describe("N4-P2-4 · «Enviar al restaurante» en el chat y en Mis reservas", () => {
  it("Mis reservas: el botón se llama como en el chat; la frase exacta se muestra y se manda igual", async () => {
    invoke.mockResolvedValue({ data: { ok: true, enabled: true, reservations: [RES] }, error: null });
    render(<MemoryRouter><AiReservationsPanel /></MemoryRouter>);
    const btn = await screen.findByRole("button", { name: AI_RES_SEND_LABEL });
    expect(btn).toHaveTextContent("Enviar al restaurante");
    expect(screen.getByTestId("ai-res-confirm-prompt")).toHaveTextContent("«Confirmar: escribiremos a Contramar en tu nombre»");
    expect(src("src/components/reservas/AiReservationSend.tsx")).toMatch(/Enviar al restaurante\n/);
    expect(src("supabase/functions/concierge-chat/actionExec.ts")).toMatch(/pulsa «Enviar al restaurante»/);
  });
});

// ═══ "Iato" con la serifa de marca (ronda 4 de cuenta) ═══
describe("'Iato' con IatoName (serifa de marca) en el aviso del historial, en Mis solicitudes y en el saludo", () => {
  it("aviso de conversación resumida", () => {
    const { container } = render(<HistoryNotice text={SUMMARY_NOTICE_TEXT} />);
    expect(container.querySelector("[data-iato-mark]")).toHaveTextContent("Iato");
    expect(screen.getByRole("note")).toHaveTextContent(SUMMARY_NOTICE_TEXT);
  });
  it("'Mesas por correo con Iato…' en Mis solicitudes", async () => {
    invoke.mockResolvedValue({ data: { ok: true, reservations: [RES, { ...RES, id: "r2", status: "sent", sent_at: "2026-10-28T10:00:00Z" }] }, error: null });
    const { container } = render(<MemoryRouter><AiReservationsLinkNote /></MemoryRouter>);
    const note = await screen.findByTestId("ai-res-link-note");
    expect(note).toHaveTextContent("Mesas por correo con Iato: 1 enviada · 1 espera tu confirmación.");
    expect(container.querySelector("[data-iato-mark]")).toHaveTextContent("Iato");
  });
  it("el saludo 'Hola, soy Iato…' se pinta con IatoName", () => {
    expect(src("src/pages/Concierge.tsx")).toMatch(/msg\.id === "welcome" \? <p data-testid="welcome-text">\{withIatoMark\(msg\.text\)\}<\/p>/);
  });
});
