// "Recuerdos": desde el 12-nov-2026 vive en Mi perfil (junto a Gastos y Documentos y tarjetas), y su ruta.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), auth: { onAuthStateChange: vi.fn() } } }));

import { mobileMoreNav } from "@/components/DashboardLayout";

describe("menú", () => {
  it("Recuerdos está a un toque desde Mi perfil (que sigue en «Más»), con su ruta protegida", () => {
    expect(mobileMoreNav.find((l) => l.to === "/dashboard/perfil")).toBeTruthy();
    const perfil = readFileSync("src/pages/Profile.tsx", "utf8");
    expect(perfil).toMatch(/to: "\/dashboard\/recuerdos", icon: Images, label: "Recuerdos"/);
    expect(readFileSync("src/App.tsx", "utf8")).toContain('<Route path="/dashboard/recuerdos" element={<ProtectedRoute><Recuerdos /></ProtectedRoute>} />');
  });
});
