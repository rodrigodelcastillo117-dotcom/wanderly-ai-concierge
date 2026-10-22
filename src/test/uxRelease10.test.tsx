// Release 10 · UX en producción (grupo ux): defectos vistos en traveliatos.life con Playwright y
// sus correcciones. Cada prueba nombra el defecto (UX10-xx de docs/iatos/evidencia/release10/ux).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { tripLabel } from "@/lib/activeTrip";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(async () => ({ data: null, error: null })), from: vi.fn() },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", email: "a@b.mx" } }) }));
vi.mock("@/hooks/useActiveTrip", () => ({ useActiveTrip: () => ({ trip: null }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));

import { FixerButton } from "@/components/FixerButton";
import { EditWithAIDialog } from "@/components/EditWithAIDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("UX10-07 · Fixer: diálogo accesible y copy honesto", () => {
  it("abre como diálogo modal con nombre, mueve el foco adentro y Escape lo cierra devolviendo el foco", async () => {
    render(<FixerButton />);
    const trigger = screen.getByRole("button", { name: /fixer/i });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Asistencia humana" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toHaveAttribute("aria-label", "Cerrar");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab no sale del diálogo (antes recorría la página tapada)", async () => {
    render(<FixerButton />);
    fireEvent.click(screen.getByRole("button", { name: /fixer/i }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const focusables = dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]");
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(focusables[focusables.length - 1]);
  });

  it("dice 'sujeto a disponibilidad' desde el primer paso y no promete WhatsApp ni un 'humano premium'", async () => {
    render(<FixerButton />);
    const trigger = screen.getByRole("button", { name: /fixer/i });
    expect(trigger.getAttribute("title")).toMatch(/sujeta a disponibilidad/);
    expect(trigger.getAttribute("title")).not.toMatch(/toma el control/);
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/sujeto a disponibilidad/);
    expect(read("src/components/FixerButton.tsx")).not.toMatch(/abre conversación por WhatsApp/);
  });
});

describe("UX10-10 · etiqueta de viaje sin fechas", () => {
  it("no muestra '(? al ?)'", () => {
    expect(tripLabel({ id: "1", destino: "Roma", fecha_salida: null, fecha_regreso: null })).toBe("Roma (sin fechas)");
    expect(tripLabel({ id: "1", destino: "Roma", fecha_salida: "2026-12-12", fecha_regreso: null })).toBe("Roma (desde el 12 dic)");
    expect(tripLabel({ id: "1", destino: "Roma", fecha_salida: null, fecha_regreso: "2026-12-14" })).toBe("Roma (hasta el 14 dic)");
    expect(tripLabel({ id: "1", destino: "Roma", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-14" })).toBe("Roma (12 dic al 14 dic)");
    expect(tripLabel({ id: "1", destino: null, fecha_salida: "no-fecha", fecha_regreso: null })).not.toMatch(/\?/);
  });
});

describe("UX10-08 · copy de socios sin '24/7' ni 'ilimitado'", () => {
  it.each(["src/pages/Insurance.tsx", "src/pages/TripCars.tsx", "src/pages/TripESIM.tsx"])("%s", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/24\/7/);
    expect(src).not.toMatch(/ilimitad/i);
  });
});

// Guardas de maquetación: en jsdom no hay layout, así que se fija la clase que evita cada defecto
// medido en producción (ver RESULTADOS.md para la medición con Playwright).
describe("guardas de maquetación y accesibilidad", () => {
  it("UX10-01 · ruta multi-destino y planear: la columna móvil no crece al ancho del contenido", () => {
    expect(read("src/pages/MultiDestRoute.tsx")).toMatch(/className="grid grid-cols-1 lg:grid-cols-\[1fr_360px\]/);
    expect(read("src/pages/PlanTrip.tsx")).toMatch(/grid grid-cols-1 lg:grid-cols-\[1fr_360px\]/);
  });

  it("UX10-02 · landing: el logo puede encogerse para que 'Empezar gratis' quepa a 320 px", () => {
    const src = read("src/pages/Landing.tsx");
    const logo = src.match(/<img src=\{iatosLogo\}[^>]*>/)?.[0] ?? "";
    expect(logo).toMatch(/min-w-0/);
    expect(logo).not.toMatch(/shrink-0/);
  });

  it("UX10-05 · barra móvil: logo y avatar con al menos 40 px", () => {
    const src = read("src/components/DashboardLayout.tsx");
    expect(src).toMatch(/<Link to="\/dashboard" className="flex items-center min-h-10" aria-label="IATOS, inicio">/);
    expect(src).toMatch(/aria-label="Mi perfil"\n\s+className="ml-1 w-10 h-10/);
  });

  it("UX10-06 · Concierge: enviar, dictar, mensaje y conversación tienen nombre accesible", () => {
    const src = read("src/pages/Concierge.tsx");
    expect(src).toMatch(/aria-label="Enviar mensaje"/);
    expect(src).toMatch(/aria-label=\{listening \? "Detener dictado" : "Dictar por voz"\}/);
    expect(src).toMatch(/aria-label="Mensaje para Iato"/);
    expect(src).toMatch(/ref=\{scrollRef\} tabIndex=\{0\} role="region" aria-label="Conversación con Iato"/);
  });

  it("UX10-09 · Members (adelanto): los conteos no usan opacidad (contraste 3.4:1)", () => {
    expect(read("src/components/MembersTeaser.tsx")).not.toMatch(/opacity-60">\(\{n\}\)/);
  });
});

describe("UX10-04 · notificaciones en móvil", () => {
  it("el panel no se ancla a la campana en móvil (se salía por la izquierda a 390 px)", () => {
    const src = read("src/components/NotificationBell.tsx");
    expect(src).toMatch(/className="fixed inset-x-3 [^"]*sm:absolute sm:inset-x-auto[^"]*sm:right-0/);
    expect(src).not.toMatch(/className="absolute right-0 mt-2 w-\[340px\]/);
  });
});

describe("UX10-11 · Concierge: la ubicación no se queda 'Detectando…' para siempre", () => {
  it("dice 'Ubicación no disponible' si el permiso se niega o falla", async () => {
    const { conciergeLocationLabel } = await import("@/lib/conciergeLocation");
    expect(conciergeLocationLabel("pending", null)).toBe("Detectando tu ubicación real…");
    expect(conciergeLocationLabel("unavailable", null)).toBe("Ubicación no disponible");
    expect(conciergeLocationLabel("ok", { place: "Puebla", temp: 21 })).toBe("Puebla · 21°C");
    const src = read("src/pages/Concierge.tsx");
    expect(src).not.toMatch(/permission denied — silent/);
    expect(src).toMatch(/\(\) => setGeoState\(\(s\) => \(s === "ok" \? s : "unavailable"\)\)/);
    // Aviso de permiso sin contestar: el navegador no llama a nadie; hay un límite propio.
    expect(src).toMatch(/setTimeout\(\(\) => setGeoState\(\(s\) => \(s === "pending" \? "unavailable" : s\)\), GEO_GIVE_UP_MS\)/);
  });
});

describe("UX10-03 · Concierge en pantallas bajas", () => {
  it("los atajos van en una fila desplazable en móvil para que el compositor no quede bajo la barra", () => {
    const src = read("src/pages/Concierge.tsx");
    expect(src).toMatch(/className="flex flex-nowrap overflow-x-auto sm:flex-wrap/);
    expect(src).toMatch(/className="flex shrink-0 whitespace-nowrap items-center gap-1.5 px-3 py-1.5 rounded-full/);
    // "Modo exigente" va en la fila de atajos en móvil (sin renglón propio) y expone su estado.
    expect(src).toMatch(/<div className="hidden sm:flex items-center justify-end mb-2">\n\s+\{godModeToggle\}/);
    expect(src).toMatch(/<div className="sm:hidden shrink-0">\n\s+\{godModeToggle\}/);
    expect(src).toMatch(/aria-pressed=\{godMode\}/);
  });
});

describe("UX10-12 · Editar con IA: diálogo accesible, sobre la barra inferior y sin texto técnico", () => {
  it("es un diálogo modal con nombre, enfoca el texto y Escape lo cierra", async () => {
    render(<EditWithAIDialog tripId="t1" onUpdated={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Editar viaje con IA" });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Editar viaje con IATOS AI" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    // z-[100]: la barra inferior móvil es z-50 y quedaba encima de "Aplicar cambios".
    expect(dialog.parentElement?.className).toMatch(/z-\[100\]/);
    await waitFor(() => expect(document.activeElement).toHaveAttribute("aria-label", "Cambios que quieres en tu viaje"));
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(trigger);
  });

  it("un error del servidor se muestra en español claro, no 'Edge Function returned a non-2xx status code'", async () => {
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: { status: 503, json: async () => ({ error: "boom" }), text: async () => "{\"error\":\"boom\"}", clone() { return this; } },
    });
    vi.mocked(supabase.functions.invoke).mockResolvedValueOnce({ data: null, error: err } as never);
    render(<EditWithAIDialog tripId="t1" onUpdated={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar viaje con IA" }));
    fireEvent.change(await screen.findByLabelText("Cambios que quieres en tu viaje"), { target: { value: "Cambia Roma por Milán" } });
    fireEvent.click(screen.getByRole("button", { name: /Aplicar cambios/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const shown = String(vi.mocked(toast.error).mock.calls.at(-1)?.[0]);
    expect(shown).not.toMatch(/non-2xx|Edge Function/);
    expect(shown).toMatch(/no está disponible/);
  });
});

describe("UX10-13 · fotos del detalle de viaje: sin amplificar errores", () => {
  it("si la llamada falla no reintenta con otras consultas; si no hubo foto, sí", async () => {
    const { resolveCityImage } = await import("@/components/CityCollapsible");
    const fail = vi.fn(async () => ({ image: null, failed: true, rateLimited: true }));
    expect(await resolveCityImage("Museo Amparo Puebla Centro", fail)).toBeNull();
    expect(fail).toHaveBeenCalledTimes(1);

    const empty = vi.fn(async (q: string) => ({ image: q === "Museo" ? "https://img/m.jpg" : null, failed: false, rateLimited: false }));
    expect(await resolveCityImage("Museo Amparo Puebla", empty)).toBe("https://img/m.jpg");
    expect(empty.mock.calls.map((c) => c[0])).toEqual(["Museo Amparo Puebla", "Museo Amparo", "Museo"]);
  });

  it("tras un 429 deja de llamar a pexels-image por un minuto", async () => {
    const { resolveCityImage, __resetCityImageBlock } = await import("@/components/CityCollapsible");
    __resetCityImageBlock();
    const invoke = vi.mocked(supabase.functions.invoke);
    invoke.mockReset();
    invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("x"), { context: { status: 429 } }) } as never);
    await resolveCityImage("Catedral de Puebla");
    await resolveCityImage("Biblioteca Palafoxiana");
    await resolveCityImage("Callejón de los Sapos");
    expect(invoke).toHaveBeenCalledTimes(1);
    __resetCityImageBlock();
  });
});
