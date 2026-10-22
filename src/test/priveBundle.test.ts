import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Privé no hace crecer el paquete inicial: rutas con React.lazy, y lo único que entra al inicio es
// priveSession.ts (diminuto, sin dependencias), que AuthContext necesita para limpiar al salir.
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("IATOS Privé y el paquete inicial", () => {
  it("las pantallas Privé se cargan con import() bajo demanda", () => {
    const app = read("src/App.tsx");
    for (const page of ["PriveRoot", "PriveHub", "PriveInvitation", "PriveMembership", "PriveReset"]) {
      expect(app).toMatch(new RegExp(`const ${page} = lazyWithRetry\\(\\(\\) => import\\("\\./pages/prive/${page}"\\)\\)`));
      expect(app).not.toMatch(new RegExp(`^import ${page}`, "m"));
    }
  });
  it("AuthContext solo importa priveSession (sin framer-motion, ni el cliente Privé)", () => {
    const ctx = read("src/contexts/AuthContext.tsx");
    expect(ctx).toMatch(/from "@\/lib\/priveSession"/);
    expect(ctx).not.toMatch(/priveApi|usePriveAccess|components\/prive/);
    expect(read("src/lib/priveSession.ts")).not.toMatch(/^import /m);
  });
  it("sin video ni audio en la ceremonia", () => {
    for (const f of ["src/pages/prive/PriveInvitation.tsx", "src/components/prive/GrandWelcome.tsx", "src/components/prive/Envelope.tsx"]) {
      expect(read(f)).not.toMatch(/<video|<audio|new Audio\(/);
    }
  });
});
