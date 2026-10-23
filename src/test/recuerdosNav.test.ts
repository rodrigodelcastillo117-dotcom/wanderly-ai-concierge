// "Recuerdos" en el menú principal: escritorio (barra lateral) y celular (menú "Más"), y su ruta.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), auth: { onAuthStateChange: vi.fn() } } }));

import { mobileMoreNav } from "@/components/DashboardLayout";

describe("menú", () => {
  it("Recuerdos está en el menú del celular y en la barra de escritorio, con su ruta protegida", () => {
    expect(mobileMoreNav.find((l) => l.to === "/dashboard/recuerdos")?.label).toBe("Recuerdos");
    const layout = readFileSync("src/components/DashboardLayout.tsx", "utf8");
    expect(layout.match(/to: "\/dashboard\/recuerdos", icon: Images, label: "Recuerdos"/g)).toHaveLength(2);
    expect(readFileSync("src/App.tsx", "utf8")).toContain('<Route path="/dashboard/recuerdos" element={<ProtectedRoute><Recuerdos /></ProtectedRoute>} />');
  });
});
