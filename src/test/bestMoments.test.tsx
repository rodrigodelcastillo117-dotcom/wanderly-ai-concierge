// Mejores momentos: al subir una foto se elige el viaje y lo que más gustó, se etiqueta en el
// servidor (tag-moment) y se confirma en sutil: "Iato lo tomará en cuenta para tus próximas sugerencias".
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
  inserts: [] as any[],
  updates: [] as any[],
  moments: [] as any[],
  trips: [{ id: "t1", destino: "Mykonos, Grecia", fecha_salida: "2025-07-01", fecha_regreso: "2025-07-07" }],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const api: any = {
      select: () => api, eq: () => api, lte: () => api, order: () => api, limit: () => api,
      insert: (row: any) => { h.inserts.push(row); return { select: () => ({ single: async () => ({ data: { id: `m${h.inserts.length}` }, error: null }) }) }; },
      update: (row: any) => { h.updates.push(row); return { eq: async () => ({ error: null }) }; },
      delete: () => ({ eq: async () => ({ error: null }) }),
      then: (res: any, rej: any) => Promise.resolve({ data: table === "trips" ? h.trips : h.moments, error: null }).then(res, rej),
    };
    return api;
  };
  const storage = {
    from: () => ({
      upload: async () => ({ error: null }),
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/travel-moments/${path}` } }),
      remove: async () => ({ error: null }),
    }),
  };
  return { supabase: { from, storage, functions: { invoke: h.invoke } } };
});
// Usuario estable (como el del AuthContext real): un objeto nuevo en cada render volvía a cargar la
// lista sin parar.
const authUser = vi.hoisted(() => ({ id: "u1" }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { BestMomentsPanel, IATO_MOMENT_NOTICE, momentLabel } from "@/components/lux/BestMomentsPanel";

beforeEach(() => {
  h.inserts.length = 0;
  h.updates.length = 0;
  h.moments = [];
  h.invoke.mockClear();
  toast.success.mockClear();
});

describe("Mejores momentos", () => {
  it("el nombre del archivo nunca se muestra como viaje", () => {
    expect(momentLabel({ destino: null, trip_name: "IMG_1234" })).toBeNull();
    expect(momentLabel({ destino: "Mykonos", trip_name: "IMG_1234" })).toBe("Mykonos");
    expect(momentLabel({ destino: null, trip_name: "Kioto" })).toBe("Kioto");
  });

  it("al subir: eliges viaje y lo que te encantó, se etiqueta en el servidor y se confirma que Iato lo tomará en cuenta", async () => {
    render(<BestMomentsPanel />);
    const input = await screen.findByLabelText("Elegir fotos de tus mejores momentos");
    await waitFor(() => expect(screen.getByText("Sube fotos de tus mejores viajes")).toBeInTheDocument());
    // JPEG mínimo válido: desde T-P2-2 la foto se limpia (EXIF/GPS) antes de subir, como en la Bóveda.
    const jpegBytes = [0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0xff, 0xd9];
    const file = new File([new Uint8Array(jpegBytes)], "IMG_1234.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });

    const select = await screen.findByLabelText("¿De qué viaje es?");
    expect((select as HTMLSelectElement).value).toBe("t1"); // tu viaje más reciente
    fireEvent.change(screen.getByLabelText("¿Qué te encantó? (opcional)"), { target: { value: "El atardecer en Little Venice" } });
    fireEvent.click(screen.getByRole("button", { name: "Playa" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar momento" }));

    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0]).toMatchObject({
      user_id: "u1", trip_id: "t1", destino: "Mykonos", trip_name: "Mykonos, Grecia", caption: "El atardecer en Little Venice", tags: ["playa"],
    });
    expect(h.inserts[0].trip_name).not.toContain("IMG");
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("tag-moment", { body: { moment_id: "m1" } }));
    expect(toast.success).toHaveBeenCalledWith("Momento guardado", { description: IATO_MOMENT_NOTICE });
    expect(IATO_MOMENT_NOTICE).toBe("Iato lo tomará en cuenta para tus próximas sugerencias.");
  }, 30_000);

  it("un momento viejo (sin viaje) se puede completar y también vuelve a enseñarle a Iato", async () => {
    h.moments = [{ id: "old", image_url: "https://x/travel-moments/u1/a.jpg", caption: null, trip_name: "DSC_0042", created_at: "2026-01-01" }];
    render(<BestMomentsPanel />);
    fireEvent.click(await screen.findByText("¿De qué viaje es?"));
    fireEvent.change(await screen.findByLabelText("¿De qué viaje es?"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.updates[0]).toMatchObject({ trip_id: "t1", destino: "Mykonos" });
    await waitFor(() => expect(h.invoke).toHaveBeenCalledWith("tag-moment", { body: { moment_id: "old" } }));
    expect(toast.success).toHaveBeenCalledWith("Momento actualizado", { description: IATO_MOMENT_NOTICE });
  }, 30_000);
});
