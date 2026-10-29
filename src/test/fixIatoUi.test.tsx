// Auditoría 10 (producción, 28-oct-2026) — pantallas del Concierge y de Members Only. Cada prueba nombra
// su defecto: #n del REPORTE_concierge o P1-n / P2 del REPORTE_prive (solo Members Only).
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const VENUES = [
  {
    id: "c1", ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria: "members_club", emoji: null,
    nombre: "Soho House Mexico City", por_que: "Primera casa de Soho House en Latinoamérica.", descripcion: null, dress_code: null, precio_estimado: "$$$$",
    reserva_requerida: false, tags: [], address: "Colima 92", website: "https://www.sohohouse.com/", fuente: "curaduria",
    effective_state: "VERIFICADO", effective_label: "NINGUNA", source_url: "https://www.sohohouse.com/", verified_at: "2026-10-22T12:00:00+00:00",
    neighborhood: "Roma", season_state: null, age_policy: "18+",
  },
  {
    id: "l1", ciudad: "ciudad de mexico", ciudad_display: "Ciudad de México", categoria: "jazz_lounge", emoji: "🎷",
    nombre: "Lugar Viejo Sin Fuente", por_que: null, descripcion: null, dress_code: null, precio_estimado: null,
    reserva_requerida: false, tags: [], address: null, website: null, fuente: "members", effective_state: null,
    effective_label: null, source_url: null, verified_at: null, neighborhood: null, season_state: null, age_policy: null,
  },
];
const rpc = vi.fn(async (fn: string) => {
  if (fn === "members_access_state") return { data: { access: true, via: "plan", password_gate: false }, error: null };
  if (fn === "members_venues") return { data: VENUES, error: null };
  // El servidor viejo contaba 16 (con lo que no se muestra); la lista muestra 1.
  if (fn === "members_cities") return { data: [{ ciudad: "cdmx", ciudad_display: "Ciudad de México", pais: "México", venues: 16 }], error: null };
  return { data: null, error: null };
});
const invoke = vi.fn(async () => ({ data: { ok: true, request: { status: "solicitado" } }, error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => rpc(fn),
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generador encadenable simulado
      const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }), insert: () => q, update: () => q, single: async () => ({ data: { id: "fe1" }, error: null }) };
      return q;
    },
    functions: { invoke: (...a: unknown[]) => invoke(...(a as [])) },
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));
const AUTH = { user: { id: "u1", email: "a@example.test", user_metadata: {} } };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => AUTH }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true }) }));
vi.mock("@/hooks/useActiveTrip", () => ({ useActiveTrip: () => ({ trip: null }) }));
vi.mock("@/components/CityVideoCard", () => ({ CityVideoCard: ({ city, subtitle }: { city: string; subtitle?: string }) => <span data-testid="city-card">{city} · {subtitle}</span> }));
vi.mock("@/components/media/VenueImage", () => ({ VenueImage: () => <span /> }));

import { MembersOnlyPanel } from "@/components/MembersOnlyPanel";
import { VenueDetailDialog } from "@/components/VenueDetailDialog";
import { validateMembersReserve } from "@/components/members/MembersReserveDialog";
import { FixerButton } from "@/components/FixerButton";
import { membersOnlySubtitle, PRO_FEATURES } from "@/lib/planCopy";
import { opsTypeLabel } from "../../supabase/functions/_shared/ops-labels";
import { __resetReverseGeocode, reverseGeocode } from "@/lib/reverseGeocode";
import { isPilotEmailSource, presentReservation } from "../../supabase/functions/_shared/ai-reservations/service";

beforeEach(() => { rpc.mockClear(); invoke.mockClear(); });

describe("Members Only", () => {
  it("#14 / P1-3: el conteo de la ciudad es el de la lista que se muestra (16 → 1)", async () => {
    render(<MemoryRouter><MembersOnlyPanel preferredCities={["Ciudad de México"]} /></MemoryRouter>);
    await screen.findByText("Soho House Mexico City");
    expect(screen.queryByText("Lugar Viejo Sin Fuente")).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId("city-card").map((e) => e.textContent)).toContain("Ciudad de México · 1 lugar"));
    expect(screen.getByRole("button", { name: /Todas/ }).textContent).toMatch(/\(1\)/);
  });

  it("P1-4: 'Reservar con Concierge' pide fecha, hora y personas, muestra el resumen y solo envía al confirmar", async () => {
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    const card = (await screen.findByText("Soho House Mexico City")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Reservar con Concierge" }));
    const dlg = await screen.findByTestId("members-reserve-dialog");
    expect(invoke).not.toHaveBeenCalled();
    // Sin fecha no avanza.
    fireEvent.click(within(dlg).getByRole("button", { name: "Revisar solicitud" }));
    expect(within(dlg).getByRole("alert").textContent).toBe("Elige la fecha.");
    fireEvent.change(within(dlg).getByLabelText("Fecha"), { target: { value: "2099-11-13" } });
    fireEvent.change(within(dlg).getByLabelText("Hora"), { target: { value: "20:30" } });
    fireEvent.change(within(dlg).getByLabelText("Personas"), { target: { value: "4" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Revisar solicitud" }));
    const summary = await within(dlg).findByTestId("members-reserve-summary");
    expect(summary.textContent).toMatch(/20:30 · 4 personas/);
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(within(dlg).getByRole("button", { name: /Confirmar solicitud/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    const [fn, opts] = invoke.mock.calls[0] as unknown as [string, { body: { type: string; payload: Record<string, unknown> } }];
    expect(fn).toBe("concierge-action");
    expect(opts.body.type).toBe("members_nightlife_reservation");
    expect(opts.body.payload).toMatchObject({ venue_id: "c1", fecha: "2099-11-13", hora: "20:30", personas: 4, party_size: 4, requested_for: "2099-11-13T20:30" });
  });

  it("P1-4: el Concierge ya no manda 'Ya pedí mesa…' al chat; lleva a Mis solicitudes", () => {
    const src = readFileSync("src/pages/Concierge.tsx", "utf8");
    expect(src).not.toMatch(/Ya pedí mesa en/);
    expect(src).toMatch(/onReserve=\{\(\) => switchTab\("solicitudes"\)\}/);
    expect(validateMembersReserve({ fecha: "2026-10-01", hora: "20:00", personas: 2 }, "2026-10-28")).toBe("La fecha ya pasó.");
    expect(validateMembersReserve({ fecha: "2026-11-01", hora: "20:00", personas: 0 }, "2026-10-28")).toMatch(/personas/);
    expect(validateMembersReserve({ fecha: "2026-11-01", hora: "20:00", personas: 2 }, "2026-10-28")).toBeNull();
  });

  it("P1-5: ni el subtítulo ni el plan PRO prometen 'acceso preferente'", () => {
    for (const isPro of [true, false]) expect(membersOnlySubtitle({ isPro })).not.toMatch(/preferente|prioridad/i);
    expect(PRO_FEATURES.join(" ")).not.toMatch(/preferente|prioridad/i);
  });

  it("P2: el subtítulo se lee completo en el celular (sin line-clamp)", async () => {
    render(<MemoryRouter><MembersOnlyPanel /></MemoryRouter>);
    const sub = await screen.findByTestId("members-subtitle");
    expect(sub.className).not.toMatch(/line-clamp/);
  });

  it("P1-6: la ficha del lugar es un diálogo con título (sin el error de DialogTitle en consola)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<VenueDetailDialog venue={VENUES[0] as never} open onClose={() => {}} onReserve={() => {}} reserving={false} />);
    expect(await screen.findByRole("dialog", { name: "Soho House Mexico City" })).toBeInTheDocument();
    expect(err.mock.calls.flat().join(" ")).not.toMatch(/DialogTitle/);
    err.mockRestore();
  });
});

describe("Hablar con una persona (#11 y #21)", () => {
  it("#21: cada enlace dice lo que hace (llamar o WhatsApp)", async () => {
    render(<MemoryRouter><FixerButton trip={null} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Hablar con una persona del equipo IATOS" }));
    const call = await screen.findByRole("link", { name: /Llamar al \+52 55 4358 0077/ });
    expect(call.getAttribute("href")).toBe("tel:+525543580077");
    expect(screen.getByRole("link", { name: /Escribir por WhatsApp/ }).getAttribute("href")).toBe("https://wa.me/525543580077");
    expect(screen.queryByText(/escríbenos directo/i)).toBeNull();
  });
  it("#11: la solicitud se nombra en español en Mis solicitudes y en la Mesa", () => {
    expect(opsTypeLabel("human_help")).toBe("Hablar con una persona");
    expect(readFileSync("src/components/FixerButton.tsx", "utf8")).toMatch(/Concierge › Mis solicitudes/);
  });
});

describe("#15: el nombre del lugar se pide una vez por zona y un 400 no rompe nada", () => {
  it("una sola llamada por zona (con 2 decimales) y sin lanzar en error", async () => {
    __resetReverseGeocode();
    // Ronda 2: la función geocode de IATOS (Google en el servidor), ya no api.bigdatacloud.net.
    const f = vi.fn(async () => ({ data: { city: "Ciudad de México", country_code: "MX" }, error: null }));
    expect(await reverseGeocode(19.43251, -99.13321, f as never)).toEqual({ city: "Ciudad de México", countryCode: "MX" });
    expect(await reverseGeocode(19.43299, -99.13349, f as never)).toEqual({ city: "Ciudad de México", countryCode: "MX" });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown[])[0]).toEqual({ mode: "city", latlng: "19.43,-99.13", language: "es" });
    __resetReverseGeocode();
    const bad = vi.fn(async () => ({ data: null, error: new Error("400") }));
    expect(await reverseGeocode(40.4, -3.7, bad as never)).toBeNull();
    // En pausa tras el error: no se vuelve a pedir enseguida.
    expect(await reverseGeocode(41.4, 2.17, bad as never)).toBeNull();
    expect(bad).toHaveBeenCalledTimes(1);
  });
  it("el Concierge y la hoja de emergencia usan el mismo lector (no un fetch cada minuto)", () => {
    for (const f of ["src/pages/Concierge.tsx", "src/components/ConciergeActions.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/bigdatacloud/);
      expect(readFileSync(f, "utf8")).toMatch(/reverseGeocode\(latitude, longitude\)/);
    }
  });
});

describe("#12: la hoja de emergencia queda encima de la barra de abajo", () => {
  it("z-index mayor que la barra (z-50) y espacio para el área segura", () => {
    const src = readFileSync("src/components/ConciergeActions.tsx", "utf8");
    expect(src).toMatch(/fixed inset-0 z-\[90\]/);
    expect(src).toMatch(/env\(safe-area-inset-bottom\)/);
    expect(readFileSync("src/components/DashboardLayout.tsx", "utf8")).toMatch(/fixed bottom-0 inset-x-0 z-(40|50)/) // la barra bajó a z-40 (herramientas); la hoja (z-[90]) sigue encima;
  });
});

describe("#20: encabezado del Concierge en el celular", () => {
  it("título corto y ubicación/viaje en dos renglones", () => {
    expect(readFileSync("src/components/concierge/ConciergeHeading.tsx", "utf8")).toMatch(/sm:hidden" data-testid="concierge-title-short">Iato te escucha/);
    const src = readFileSync("src/pages/Concierge.tsx", "utf8");
    expect(src).toMatch(/flex flex-wrap sm:flex-nowrap items-center[^"]*" data-testid="concierge-context"/);
    expect(src).toMatch(/flex min-w-0 basis-full sm:basis-auto/);
  });
});

describe("#22: destinatario de prueba del piloto avisado", () => {
  it("la reserva marca el correo de prueba y la tarjeta lo dice", () => {
    expect(isPilotEmailSource({ url: "piloto://correo-de-prueba-del-dueno" })).toBe(true);
    expect(isPilotEmailSource({ url: "https://contramar.com.mx/contacto" })).toBe(false);
    expect(presentReservation({ status: "awaiting_user_ok", venue_name: "Contramar", venue_email_source: { url: "piloto://correo-de-prueba-del-dueno" } }).venue_email_is_test).toBe(true);
    expect(readFileSync("src/components/reservas/AiReservationSend.tsx", "utf8")).toMatch(/correo de prueba del piloto: no es del restaurante/);
  });
});

describe("#23: una foto que no termina de bajar no deja la tarjeta oscura", () => {
  it("pasado el tiempo, sigue con la siguiente fuente", async () => {
    vi.useFakeTimers();
    const { SmartImage, IMAGE_LOAD_TIMEOUT_MS } = await import("@/components/media/SmartImage");
    render(<SmartImage alt="Foto" imageUrl="https://example.test/lenta.jpg" eager />);
    expect(screen.getByTestId("smart-image").getAttribute("data-kind")).toBe("real");
    await act(async () => { vi.advanceTimersByTime(IMAGE_LOAD_TIMEOUT_MS * 2 + 10); });
    expect(screen.getByTestId("smart-image").getAttribute("data-kind")).toBe("none");
    expect(screen.getByTestId("smart-image-fallback")).toBeInTheDocument();
    vi.useRealTimers();
  });
});
