// R2 viajes (parcial de ronda 1): Lisboa seguía sin foto en Comparar. La foto de la tarjeta (debajo del
// pliegue) solo se pedía al verse y con una sola consulta; si esa consulta no traía nada, quedaba vacía.
// Ahora la comparación las pide al mostrarse (son 2–4) y con una segunda consulta de respaldo.
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { vi, it, expect, describe } from "vitest";

const asked: string[] = [];
vi.mock("@/lib/stockPhoto", () => ({
  cachedStockPhoto: () => undefined,
  getStockPhoto: async (q: string) => {
    asked.push(q);
    return q.startsWith("lisbon portugal") ? null : { image: `https://images.pexels.com/${encodeURIComponent(q)}.jpg`, photographer: "Ana", page_url: null };
  },
}));
vi.mock("@/hooks/useInView", () => ({ useInView: () => false })); // fuera de pantalla

import { SmartImage } from "@/components/media/SmartImage";
import { destinationPhotoFallbackQuery, destinationPhotoQuery } from "@/lib/compareCost";

describe("foto de Lisboa en Comparar", () => {
  it("respaldo: el lugar emblemático de la ciudad", () => {
    expect(destinationPhotoQuery("Lisboa, Portugal")).toBe("lisbon portugal city travel");
    expect(destinationPhotoFallbackQuery("Lisboa, Portugal")).toBe("Lisbon yellow tram Alfama");
    expect(destinationPhotoFallbackQuery("Madrid, España")).toBe("Madrid Cibeles");
  });

  it("si la primera consulta no trae foto, usa la segunda (aunque la tarjeta esté fuera de pantalla con eager)", async () => {
    render(<SmartImage alt="Lisboa, Portugal" stockQuery={destinationPhotoQuery("Lisboa, Portugal")} stockFallbackQuery={destinationPhotoFallbackQuery("Lisboa, Portugal")} eager className="h-32" />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Lisboa, Portugal" })).toBeInTheDocument());
    expect(screen.getByRole("img").getAttribute("src")).toContain("Lisbon%20yellow%20tram%20Alfama");
    expect([...new Set(asked)]).toEqual(["lisbon portugal city travel", "Lisbon yellow tram Alfama"]);
  });

  it("Comparar pasa la consulta de respaldo y pide las fotos al mostrarse", async () => {
    const src = (await import("node:fs")).readFileSync("src/pages/Compare.tsx", "utf8");
    expect(src.match(/stockFallbackQuery=\{destinationPhotoFallbackQuery\(r\.destino\)\} eager/g)?.length).toBe(2);
  });
});
