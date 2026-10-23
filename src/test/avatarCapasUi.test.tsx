// "Tu fondo" y "Tus recuerdos" en Perfil (avatar por capas): país preguntado una vez, hasta 3 fondos
// de su país, hasta 3 recuerdos, guardar sin costo. Supabase simulado: sin red.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => ({ select: async () => ({ data: [{ id: "es-bernabeu", prompt_hash: "abcdabcdabcdabcd" }, { id: "c-paris-1", prompt_hash: "1234123412341234" }], error: null }) }),
    storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn.test/avatar-assets/${p}` } }) }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { AvatarLayersPanel } from "@/components/avatar/AvatarLayersPanel";
import { AvatarEvolutionTimeline } from "@/components/avatar/AvatarEvolutionTimeline";
import { parseLayersState } from "@/components/avatar/useAvatarLayers";
import { MemoryRouter } from "react-router-dom";

const estado = (o: Record<string, unknown> = {}) => ({
  data: {
    ok: true, capas: true, pais: "ES", pais_sugerido: "MX", fondo_id: "es-puerta-alcala", objetos: ["c-paris-1"],
    recuerdos: ["ciudad:paris", "pais:AR", "ciudad:cdmx"], persona_url: "https://signed.test/persona.png",
    cara: [0.5, 0.12, 0.28], mano: [0.33, 0.4], cuerpo_url: "https://cdn.test/cuerpo.png", ...o,
  },
  error: null,
});

beforeEach(() => invoke.mockReset());

describe("panel de fondo y recuerdos", () => {
  it("hasta 3 fondos de SU país, inventario de sus viajes, máximo 3 y guardar sin costo", async () => {
    invoke.mockImplementation(async (_fn: string, opts: any) => (opts?.body?.action === "estado" ? estado() : { data: { ok: true, url: "https://cdn.test/cara.png" }, error: null }));
    render(<AvatarLayersPanel />);
    expect(await screen.findByText("Fondo y recuerdos")).toBeInTheDocument();
    const fondos = screen.getAllByRole("radio");
    expect(fondos).toHaveLength(3);
    expect(screen.getByText("Estadio Santiago Bernabéu")).toBeInTheDocument();
    expect(screen.getByText(/Tu fondo · España/)).toBeInTheDocument();
    expect(screen.queryByText("¿De qué país eres?")).toBeNull(); // ya lo confirmó
    // Inventario: 2 objetos por lugar ganado (París, Argentina, CDMX).
    expect(screen.getByRole("button", { name: /Croissant/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Camiseta albiceleste con el 10/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Mate con bombilla/ }));
    fireEvent.click(screen.getByRole("button", { name: /Trajinera/ }));
    // Ya hay 3: los demás se deshabilitan.
    expect(screen.getByRole("button", { name: /Torre Eiffel/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Bernabéu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("avatar-capas", { body: { action: "guardar", fondo_id: "es-bernabeu", objetos: ["c-paris-1", "p-ar-2", "c-cdmx-2"] } }));
    expect(screen.getByText("Sin costo")).toBeInTheDocument();
    // Vista previa: fondo, persona y objetos con la misma geometría del servidor.
    expect(screen.getByTestId("avatar-preview").querySelector("img[alt='Vista previa de tu avatar']")).toHaveAttribute("src", "https://signed.test/persona.png");
  });
  it("si aún no confirma su país, se pregunta UNA vez con el del perfil ya elegido", async () => {
    invoke.mockImplementation(async (_fn: string, opts: any) => (opts?.body?.action === "estado" ? estado({ pais: null, fondo_id: "mx-angel" }) : { data: { ok: true, url: null }, error: null }));
    render(<AvatarLayersPanel />);
    expect(await screen.findByText("¿De qué país eres?")).toBeInTheDocument();
    const sel = screen.getByRole("combobox", { name: "Tu país de origen" }) as HTMLSelectElement;
    expect(sel.value).toBe("MX");
    fireEvent.click(screen.getByRole("button", { name: "Listo" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("avatar-capas", { body: { action: "guardar", pais: "MX" } }));
  });
  it("avatar de antes (sin capas): invita a crearlo de cuerpo completo una vez", async () => {
    invoke.mockResolvedValue(estado({ capas: false, persona_url: null }));
    const onRecreate = vi.fn();
    render(<AvatarLayersPanel onRecreate={onRecreate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Crear mi avatar de cuerpo completo" }));
    expect(onRecreate).toHaveBeenCalled();
  });
  it("lee el estado del servidor de forma tolerante", () => {
    expect(parseLayersState({ ok: false })).toBeNull();
    expect(parseLayersState({ ok: true, cara: [1, 2], mano: "x" })).toMatchObject({ capas: false, cara: null, mano: null, objetos: [] });
  });
});

describe("integración en Perfil y tarjeta del Travel DNA", () => {
  it("la línea de evolución nombra los objetos del lugar cuando el avatar es por capas", () => {
    render(<MemoryRouter><AvatarEvolutionTimeline capas hasAvatar rows={[{ id: "1", trip_id: null, trip_label: "París", trip_end: "2026-09-01", fuente: "fin_de_viaje", souvenir_key: "ciudad:paris", nombre: "Pin de la Torre Eiffel", lugar: "París", emoji: "🗼", status: "aplicado", visible: true, unlocked_at: "2026-09-02" }]} /></MemoryRouter>);
    expect(screen.getByText("Croissant y Torre Eiffel")).toBeInTheDocument();
  });
  it("Perfil muestra el panel; la tarjeta del DNA usa el cuerpo completo y los círculos el recorte de la cara", () => {
    expect(readFileSync("src/pages/Profile.tsx", "utf8")).toMatch(/<AvatarLayersPanel/);
    const card = readFileSync("src/components/lux/TravelAvatarCinematic.tsx", "utf8");
    expect(card).toMatch(/select\("version, cuerpo_url, capas"\)/);
    expect(card).toMatch(/cuerpoUrl \?/);
    expect(card).toMatch(/useMyAvatar\(\)/); // los círculos siguen con profiles.avatar_url (recorte de la cara)
  });
});
