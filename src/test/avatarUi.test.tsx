// Avatar circular, sello Privé, una sola fuente del avatar y la línea de "Evolución".
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), functions: { invoke: vi.fn() }, rpc: vi.fn() } }));

import { AvatarCircle, orbitPosition, ORBIT_ANGLES } from "@/components/avatar/AvatarCircle";
import { PriveSeal } from "@/components/PriveSeal";
import { AvatarEvolutionTimeline } from "@/components/avatar/AvatarEvolutionTimeline";
import { timelineItems, type AvatarSouvenir } from "@/components/avatar/useAvatarSouvenirs";
import { pickAvatarUrl } from "@/hooks/useMyAvatar";
import { isActivePrive } from "@/hooks/usePriveSeal";
import { pickTripToEvolve } from "@/components/avatar/useAutoEvolveAvatar";
import { likenessLabel } from "@/components/AvatarCreator";

const read = (p: string) => readFileSync(p, "utf8");

describe("una sola fuente del avatar (bug de la 'R' en el perfil)", () => {
  it("profiles.avatar_url manda; perfil_ia solo como respaldo; nada que no sea http(s)", () => {
    expect(pickAvatarUrl("https://a/x.png", { avatar_url: "https://b/y.png" })).toBe("https://a/x.png");
    expect(pickAvatarUrl(null, { avatar_url: "https://b/y.png" })).toBe("https://b/y.png");
    expect(pickAvatarUrl("javascript:alert(1)", null)).toBeNull();
  });
  it("perfil, menú y tarjeta del DNA leen del mismo hook (ya no profiles por un lado y perfil_ia por otro)", () => {
    for (const f of ["src/pages/Profile.tsx", "src/components/DashboardLayout.tsx", "src/components/lux/TravelAvatarCinematic.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/useMyAvatar\(\)/);
      expect(src).not.toMatch(/select\("[^"]*avatar_url/);
      expect(src).not.toMatch(/perfil_ia as any\)\?\.avatar_url/);
    }
  });
  it("la tarjeta del DNA ya no regenera sin selfie (eso inventaba a otra persona)", () => {
    const src = read("src/components/lux/TravelAvatarCinematic.tsx");
    expect(src).not.toMatch(/functions\.invoke\("generate-avatar"/);
    expect(src).toMatch(/Volver a generar/);
    expect(src).toMatch(/Subir selfie/);
  });
});

describe("avatar circular", () => {
  it("imagen a sangre en círculo (sin barras), centrada hacia la cara", () => {
    render(<AvatarCircle url="https://cdn/a.png" name="Rodrigo" size="lg" />);
    const img = screen.getByRole("img", { name: "Avatar de Rodrigo" });
    expect(img.className).toMatch(/object-cover/);
    expect(img.parentElement?.className).toMatch(/rounded-full overflow-hidden/);
    expect((img as HTMLImageElement).style.objectPosition).toBe("50% 18%");
  });
  it("sin imagen: inicial dentro del mismo círculo", () => {
    render(<AvatarCircle url={null} name="rodrigo" />);
    expect(screen.getByText("R")).toBeInTheDocument();
  });
  it("sello Privé en el borde del anillo y recuerdos orbitando lejos de la cara", () => {
    render(<AvatarCircle url="https://cdn/a.png" name="R" size="xl" prive badges={[{ key: "1", emoji: "🚕", nombre: "Llavero de taxi amarillo" }]} />);
    expect(screen.getByRole("img", { name: "Miembro IATOS Privé" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Llavero de taxi amarillo" })).toBeInTheDocument();
    // Todas las posiciones en la mitad izquierda del círculo (la cara queda al centro).
    for (const a of ORBIT_ANGLES) expect(parseFloat(orbitPosition(a).left)).toBeLessThan(50);
  });
  it("PriveSeal: etiqueta accesible y brillo que respeta movimiento reducido", () => {
    render(<PriveSeal size="sm" />);
    expect(screen.getByLabelText("Miembro IATOS Privé")).toBeInTheDocument();
    expect(read("src/index.css")).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.prive-seal-shine \{ animation: none; \}/);
  });
  it("Privé solo con membresía activa y acceso vigente", () => {
    expect(isActivePrive({ membership_status: "active", eligible: true })).toBe(true);
    expect(isActivePrive({ membership_status: "active", eligible: false })).toBe(false);
    expect(isActivePrive({ membership_status: "invited", eligible: true })).toBe(false);
    expect(isActivePrive(null)).toBe(false);
  });
});

describe("evolución del avatar", () => {
  const row = (p: Partial<AvatarSouvenir>): AvatarSouvenir => ({
    id: Math.random().toString(), trip_id: null, trip_label: "Roma", trip_end: "2026-05-01", fuente: "fin_de_viaje", souvenir_key: "ciudad:roma",
    nombre: "Pin del Coliseo", lugar: "Roma", emoji: "🏛️", status: "aplicado", visible: true, unlocked_at: "2026-05-02T00:00:00Z", ...p,
  });
  it("línea de tiempo: del viaje más reciente al más viejo, sin filas en proceso", () => {
    const items = timelineItems([row({ trip_end: "2026-01-01" }), row({ trip_end: "2026-06-01" }), row({ status: "pendiente" })]);
    expect(items.map((i) => i.trip_end)).toEqual(["2026-06-01", "2026-01-01"]);
  });
  it("dice qué viaje desbloqueó qué detalle y si está en el avatar o en la colección", () => {
    render(<MemoryRouter><AvatarEvolutionTimeline hasAvatar rows={[
      row({ trip_label: "Nueva York", nombre: "Llavero de taxi amarillo", fuente: "documento", visible: true }),
      row({ trip_label: "Roma", visible: false, trip_end: "2025-01-01" }),
    ]} /></MemoryRouter>);
    expect(screen.getByText("Llavero de taxi amarillo")).toBeInTheDocument();
    expect(screen.getByText(/Nueva York · de un viaje que importaste/)).toBeInTheDocument();
    expect(screen.getByText("En tu avatar")).toBeInTheDocument();
    expect(screen.getByText("En tu colección")).toBeInTheDocument();
  });
  it("sin recuerdos: explica y ofrece subir un viaje pasado", () => {
    render(<MemoryRouter><AvatarEvolutionTimeline hasAvatar={false} rows={[]} /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Sube un viaje que ya hiciste/ })).toBeInTheDocument();
  });
  it("respaldo de la tarea programada: el viaje que terminó más recientemente (≤ 45 días) y sin recuerdo", () => {
    const trips = [
      { id: "a", fecha_salida: "2026-10-01", fecha_regreso: "2026-10-05" },
      { id: "b", fecha_salida: "2026-10-10", fecha_regreso: "2026-10-15" },
      { id: "c", fecha_salida: "2026-06-01", fecha_regreso: "2026-06-05" },
      { id: "d", fecha_salida: "2026-10-20", fecha_regreso: "2026-10-30" },
    ];
    expect(pickTripToEvolve(trips, new Set(), "2026-10-22")).toBe("b");
    expect(pickTripToEvolve(trips, new Set(["b"]), "2026-10-22")).toBe("a");
    expect(pickTripToEvolve(trips, new Set(["a", "b"]), "2026-10-22")).toBeNull();
  });
  it("etiqueta honesta del parecido", () => {
    expect(likenessLabel(91)).toBe("Parecido alto · 91/100");
    expect(likenessLabel(60)).toBe("Parecido bajo · 60/100");
    expect(likenessLabel(null)).toBe("Parecido sin verificar");
  });
});
