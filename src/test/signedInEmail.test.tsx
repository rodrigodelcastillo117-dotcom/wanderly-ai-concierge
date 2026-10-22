// El dueño no encontraba con qué correo había iniciado sesión: no aparecía en Ajustes ni en el menú.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("correo de la sesión visible", () => {
  it("Mi perfil muestra 'Sesión iniciada como <correo>'", () => {
    const src = read("src/pages/Profile.tsx");
    expect(src).toMatch(/Sesión iniciada como <span className="text-foreground">\{user\.email\}<\/span>/);
  });
  it("el menú lateral muestra el correo bajo el nombre y el menú 'Más' en móvil también", () => {
    const src = read("src/components/DashboardLayout.tsx");
    expect(src).toMatch(/data-testid="sidebar-signed-in-email">\{user\?\.email \?\? "Explorador"\}/);
    expect(src).toMatch(/data-testid="more-signed-in-email"/);
  });
});
