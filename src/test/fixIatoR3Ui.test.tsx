// Auditoría 10, ronda 3 de Iato / Concierge: defectos de la pantalla (tarjetas, avisos, selector,
// historial, cookies, fotos y nombres). Datos de la cuenta demo y de las respuestas grabadas
// (fixtures/auditoriaR3.json); todo simulado, sin red.
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "ana@example.test" } }) }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/FixerButton", () => ({ FixerButton: () => <button>Fixer</button> }));
const photo = vi.hoisted(() => ({ resolve: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/placePhoto", () => ({
  cachedPlacePhoto: () => undefined, cachedResolvedPhoto: () => undefined, fetchPlacePhotoUrl: () => new Promise(() => {}),
  resolvePlacePhotoUrl: (...a: unknown[]) => photo.resolve(...(a as [])),
}));
vi.mock("@/lib/stockPhoto", () => ({ cachedStockPhoto: () => undefined, getStockPhoto: () => new Promise(() => {}) }));
vi.mock("@/hooks/useInView", () => ({ useInView: () => true }));

import { RichCard, transportFallback } from "@/components/concierge/ConciergeCards";
import { AiReservationsLinkNote, AiReservationsPanel, aiReservationsNoteText } from "@/components/reservas/AiReservationsPanel";
import { TripContextSelector, REASON_TEXT, FOLLOW_TEXT } from "@/components/concierge/TripContextSelector";
import { nextFollowTrip } from "@/lib/conciergeFollowTrip";
import { loadConversation, SUMMARY_NOTICE_TEXT, summaryNotice } from "@/lib/conciergeHistory";
import { HistoryNotice } from "@/components/concierge/HistoryNotice";
import { CookieBanner, COOKIE_BANNER_HEIGHT_VAR } from "@/components/CookieBanner";
import { SmartImage } from "@/components/media/SmartImage";
import { conciergeHeaderCopy } from "@/lib/planCopy";
import { toolStatusText } from "../../supabase/functions/concierge-chat/planner";
import { MapPin } from "lucide-react";

const ROOT = join(__dirname, "..", "..");
const src = (f: string) => readFileSync(join(ROOT, f), "utf8");
const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "auditoriaR3.json"), "utf8"));

beforeEach(() => { invoke.mockReset(); try { sessionStorage.clear(); } catch { /* */ } });

describe("N-P1-4 · tarjeta de chofer: sin el 'Reservar transfer' genérico", () => {
  it("'Chofer privado en Oaxaca · Hierve el Agua ida y vuelta · precio por cotizar' no lleva botón de Welcome Pickups", () => {
    const card = FX.d1_chofer.cards[0];
    render(<MemoryRouter><RichCard card={card} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /Reservar transfer/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Reservar transfer/ })).toBeNull();
    expect(screen.getByTestId("transport-team-note")).toHaveTextContent("Precio por cotizar: lo gestiona una persona del equipo IATOS");
    // La acción principal es la del equipo (la propuso el servidor en el mismo turno).
    expect(FX.d1_chofer.actions[0]).toMatchObject({ type: "fixer_request", confirm_label: "Pedírselo a una persona del equipo" });
  });
  it("solo un traslado de aeropuerto conserva el botón de traslado", () => {
    expect(transportFallback(FX.d1_chofer.cards[0])).toBe("team");
    expect(transportFallback({ title: "Traslado al hotel", subtitle: "Aeropuerto de Oaxaca → Hotel Casa Oaxaca" })).toBe("airport_transfer");
  });
});

const res = (over: Record<string, unknown>) => ({
  id: String(Math.random()), ref_code: "R-1", venue_name: "Contramar", venue_email: "reservas@contramar.test", venue_address: null, venue_city: "CDMX",
  venue_place_id: null, requested_local: "2026-11-06T14:30", requested_for: "2026-11-06T20:30:00Z", party_size: 2, customer_name: "Ana",
  reason: null, user_options: null, alternatives: null, confirmation: null, confirmation_code: null, venue_reply_excerpt: null,
  created_at: "2026-10-28T00:00:00Z", confirm_prompt: "Confirmar: escribiremos a Contramar en tu nombre", is_confirmed: false, ...over,
});
// La cuenta de la ronda 3: 886929f4 enviada; 8fbcd8b7 y 39491b55 en awaiting_user_ok.
const DEMO = [
  res({ status: "sent", sent_at: "2026-10-28T10:00:00Z", label: "Enviada · esperando respuesta del restaurante" }),
  res({ status: "awaiting_user_ok", requested_local: "2026-11-13T14:30", label: "Falta tu confirmación · aún no escribimos al restaurante" }),
  res({ status: "awaiting_user_ok", requested_local: "2026-11-14T14:00", label: "Falta tu confirmación · aún no escribimos al restaurante" }),
];

describe("N-P1-5 · el aviso de Mis solicitudes cuenta solo las mesas enviadas", () => {
  it("1 enviada · 2 esperan tu confirmación (antes: 'Tienes 3 mesas pedidas por correo')", async () => {
    expect(aiReservationsNoteText(DEMO as any)).toBe("Mesas por correo con Iato: 1 enviada · 2 esperan tu confirmación.");
    invoke.mockResolvedValue({ data: { ok: true, enabled: true, reservations: DEMO }, error: null });
    render(<MemoryRouter><AiReservationsLinkNote /></MemoryRouter>);
    const note = await screen.findByTestId("ai-res-link-note");
    expect(note).toHaveTextContent("1 enviada · 2 esperan tu confirmación");
    expect(note.textContent).not.toMatch(/3 mesas pedidas/);
  });
  it("una sola en borrador no se presenta como pedida", () => {
    expect(aiReservationsNoteText([DEMO[1]] as any)).toBe("Tu mesa en Contramar espera tu confirmación: aún no le escribimos al restaurante.");
    expect(aiReservationsNoteText([DEMO[0]] as any)).toBe("Tu mesa pedida por correo en Contramar: Enviada · esperando respuesta del restaurante.");
  });
});

describe("N-P2-5 · Reservas IA a 390 px y mientras carga", () => {
  it("el botón largo de confirmar baja de renglón dentro de la tarjeta y el ícono de correo no se encoge", async () => {
    invoke.mockResolvedValue({ data: { ok: true, enabled: true, reservations: [DEMO[1]] }, error: null });
    render(<AiReservationsPanel />);
    const btn = await screen.findByTestId("ai-res-confirm");
    expect(btn.className).toMatch(/whitespace-normal/);
    expect(btn.className).toMatch(/max-w-full/);
    expect(btn.className).toMatch(/h-auto/);
    const mail = btn.closest("article")!.querySelector("svg.lucide-mail")!;
    expect(mail.getAttribute("class")).toMatch(/shrink-0/);
  });
  it("si la última vez había mesas, muestra un esqueleto mientras carga (no aparece de golpe a los 3 s)", async () => {
    sessionStorage.setItem("iatos_ai_res_count", "3");
    let done!: (v: unknown) => void;
    invoke.mockReturnValue(new Promise((r) => { done = r; }));
    render(<AiReservationsPanel />);
    expect(screen.getByTestId("ai-res-skeleton")).toHaveAttribute("aria-busy", "true");
    done({ data: { ok: true, enabled: true, reservations: DEMO }, error: null });
    await screen.findAllByTestId("ai-res-confirm");
    expect(screen.queryByTestId("ai-res-skeleton")).toBeNull();
  });
});

describe("N-P2-6 · el aviso de cookies no tapa la caja de escritura del Concierge", () => {
  it("el aviso publica su alto y el Concierge lo descuenta de su altura", () => {
    localStorage.clear();
    const { unmount } = render(<MemoryRouter><CookieBanner /></MemoryRouter>);
    expect(document.documentElement.style.getPropertyValue(COOKIE_BANNER_HEIGHT_VAR)).toMatch(/px$/);
    unmount();
    expect(document.documentElement.style.getPropertyValue(COOKIE_BANNER_HEIGHT_VAR)).toBe("");
    expect(src("src/pages/Concierge.tsx")).toMatch(/className="concierge-shell flex flex-col/);
    expect(src("src/index.css")).toMatch(/\.concierge-shell \{ padding-bottom: var\(--cookie-banner-h, 0px\); \}/);
  });
});

describe("N-P2-7 · foto con esqueleto y buscador sin flecha nativa", () => {
  it("mientras la foto carga se ve un esqueleto con ícono y nombre accesible (no un recuadro vacío)", () => {
    render(<SmartImage alt="Foto de Soho House" lookup={{ name: "Soho House", city: "Ciudad de México" }} icon={MapPin} className="h-36" />);
    const sk = screen.getByTestId("smart-image-skeleton");
    expect(sk).toHaveAttribute("aria-label", "Cargando foto");
    expect(sk.querySelector("svg")).not.toBeNull();
    expect(sk.className).toMatch(/via-white\/\[0\.10\]/);
  });
  it("el buscador de Solo para miembros oculta la flecha ▼ del datalist", () => {
    expect(src("src/components/MembersOnlyPanel.tsx")).toMatch(/className="members-search /);
    expect(src("src/index.css")).toMatch(/\.members-search::-webkit-calendar-picker-indicator \{ display: none !important;/);
  });
});

const TRIPS = [
  { id: "vb", destino: "Valle de Bravo", fecha_salida: "2026-10-30", fecha_regreso: "2026-11-01" },
  { id: "oax", destino: "Oaxaca", fecha_salida: "2027-01-15", fecha_regreso: "2027-01-18" },
];

describe("N-P2-8 · el selector sigue el viaje del que trata la respuesta", () => {
  it("respuesta 'sobre Oaxaca' (lo nombró el usuario) con Valle de Bravo fijado → el selector muestra Oaxaca", () => {
    const follow = nextFollowTrip(null, { tripId: FX.d1_chofer._trip_id, reason: FX.d1_chofer._trip_reason }, "vb");
    expect(FX.d1_chofer._trip_reason).toBe("mentioned");
    expect(follow).toBe(FX.d1_chofer._trip_id);
    expect(nextFollowTrip("oax", { tripId: "oax", reason: "explicit" }, "vb")).toBe("oax");
    expect(nextFollowTrip("oax", { tripId: "vb", reason: "mentioned" }, "vb")).toBeNull();
    expect(nextFollowTrip("oax", { tripId: "vb", reason: "explicit" }, "vb")).toBeNull();
    expect(nextFollowTrip(null, { tripId: null, reason: "ambiguous" }, "vb")).toBeNull();
    render(<TripContextSelector trips={TRIPS} todayLocal="2026-10-28" pinnedId="vb" followId="oax"
      resolved={{ trip: TRIPS[0], reason: "pinned", candidates: [TRIPS[0]] } as any} onChange={() => {}} />);
    expect((screen.getByRole("combobox", { name: "Viaje en contexto" }) as HTMLSelectElement).value).toBe("oax");
    expect(screen.getByTestId("trip-phase")).toHaveTextContent(FOLLOW_TEXT);
  });
});

describe("Claridad (§4) · nombres únicos y textos claros", () => {
  it("'elegido por ti' ya no aparece: dice quién eligió el viaje", () => {
    expect(REASON_TEXT.pinned).toBe("lo fijaste tú");
    expect(REASON_TEXT.mentioned).toBe("Iato eligió este viaje");
    for (const f of ["src/components/concierge/TripContextSelector.tsx", "src/components/ActiveTripPicker.tsx"]) {
      expect(src(f)).not.toMatch(/: "elegido por ti"/);
    }
    render(<TripContextSelector trips={TRIPS} todayLocal="2026-10-28" pinnedId="vb" resolved={{ trip: TRIPS[0], reason: "pinned", candidates: [TRIPS[0]] } as any} onChange={() => {}} />);
    expect(screen.getByTestId("trip-phase")).toHaveTextContent("lo fijaste tú");
  });
  it("el asistente se llama Iato en todos los planes; la pestaña es 'Mis solicitudes' también en el celular", () => {
    expect(conciergeHeaderCopy({ isPro: true }).title).toBe("Iato te escucha");
    expect(conciergeHeaderCopy({ isPro: true, isTrialing: true, trialDaysLeft: 3 }).title).toBe("Iato te escucha");
    const page = src("src/pages/Concierge.tsx");
    expect(page).not.toMatch(/<span className="sm:hidden">Solicitudes<\/span>/);
    expect(page).toMatch(/\/>Mis solicitudes<\/span>/);
  });
  it("fuera de Privé se dice 'Solo para miembros' (no 'Members Only')", () => {
    expect(toolStatusText("search_members_venues", { city: "CDMX" })).toBe("Revisando Solo para miembros en CDMX…");
    expect(src("src/lib/planCopy.ts")).not.toMatch(/mesas de Members Only/);
  });
  it("los íconos de actualizar y de memoria tienen texto visible en pantallas anchas (además del nombre accesible)", () => {
    expect(src("src/pages/Concierge.tsx")).toMatch(/<span className="hidden lg:inline text-\[11px\] whitespace-nowrap">Actualizar<\/span>/);
    expect(src("src/components/concierge/IatoMemoryPanel.tsx")).toMatch(/data-testid="memory-label">Memoria<\/span>/);
  });
});

describe("N-P2-4 · historial resumido con aviso", () => {
  it("con resumen guardado, el chat abre con 'Conversación anterior resumida'", async () => {
    const row = { messages: [{ role: "user", content: "¿Y el hotel?" }, { role: "assistant", content: "Múbú." }], resumen_historico: "- Viaja con su pareja", resumen_actualizado_at: "2026-10-29T05:49:00Z" };
    const api: any = { select: () => api, eq: () => api, is: () => api, order: () => api, limit: () => api, maybeSingle: async () => ({ data: row, error: null }) };
    const msgs = await loadConversation({ from: () => api }, "u1", "vb");
    expect(msgs[0]).toMatchObject({ id: "hist-resumen", notice: true, text: SUMMARY_NOTICE_TEXT });
    expect(msgs.slice(1).map((m) => m.text)).toEqual(["¿Y el hotel?", "Múbú."]);
    expect(summaryNotice(null)).toBeNull();
    render(<HistoryNotice text={SUMMARY_NOTICE_TEXT} />);
    expect(screen.getByRole("note")).toHaveTextContent(/^Conversación anterior resumida/);
  });
  it("el aviso no se manda al modelo como si lo hubiera dicho Iato", () => {
    expect(src("src/pages/Concierge.tsx")).toMatch(/m\.id !== "welcome" && !m\.notice && m\.text\.trim\(\)/);
  });
});

