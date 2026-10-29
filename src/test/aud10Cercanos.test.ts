// Auditoría 10/10 (herramientas, 28-oct-2026) · Cercanos y navegación:
//  P1-4  en el celular la barra inferior tapaba «Cómo llegar» y «Marcar como visitado» del detalle.
//  P1-5  los filtros mezclaban categorías (con «Cafés» salían un cine y un hotel; con «Bares», restaurantes).
//  P2-14 las tarjetas no mostraban la distancia.
//  P2-2  en escritorio el menú lateral no tenía «Mis reservas».
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { matchesCategory } from "../../supabase/functions/nearby-places/category";
import { distanceKm, distanceLabel } from "@/lib/takeMeThere";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("P1-5 filtros de Cercanos por tipo principal", () => {
  // Lugares reales que salieron en la auditoría (tipos como los devuelve Places API New).
  const cine = { name: "La Casa del Cine Mx", primary: "movie_theater", types: ["movie_theater", "cafe", "point_of_interest"] };
  const hotel = { name: "Casa de la Luz Hotel Boutique", primary: "hotel", types: ["hotel", "lodging", "cafe"] };
  const rooftop = { name: "Faunna Rooftop", primary: "restaurant", types: ["restaurant", "bar", "food"] };
  const yucateca = { name: "Coox Hanal", primary: "mexican_restaurant", types: ["mexican_restaurant", "restaurant", "bar"] };
  const cafe = { name: "Café de Tacuba", primary: "coffee_shop", types: ["coffee_shop", "cafe", "restaurant"] };
  const cantina = { name: "La Ópera Bar", primary: "bar", types: ["bar", "restaurant"] };
  const museo = { name: "Palacio de Bellas Artes", primary: "museum", types: ["museum", "tourist_attraction"] };
  const m = (cat: string, p: { primary: string; types: string[] }) => matchesCategory(cat, p.primary, p.types);

  it("«Cafés» no trae un cine ni un hotel", () => {
    expect(m("cafe", cine)).toBe(false);
    expect(m("cafe", hotel)).toBe(false);
    expect(m("cafe", cafe)).toBe(true);
  });
  it("«Bares» no trae restaurantes", () => {
    expect(m("bar", rooftop)).toBe(false);
    expect(m("bar", yucateca)).toBe(false);
    expect(m("bar", cantina)).toBe(true);
  });
  it("«Restaurantes» incluye cocinas específicas; «Atracciones», museos y no restaurantes", () => {
    expect(m("restaurant", yucateca)).toBe(true);
    expect(m("restaurant", hotel)).toBe(false);
    expect(m("tourist_attraction", museo)).toBe(true);
    expect(m("tourist_attraction", rooftop)).toBe(false);
  });
  it("sin tipo principal decide por sus tipos, sin hoteles ni cines", () => {
    expect(matchesCategory("cafe", null, ["cafe", "food"])).toBe(true);
    expect(matchesCategory("cafe", null, ["cafe", "lodging"])).toBe(false);
  });
  it("la función filtra la respuesta de Google con esa regla", () => {
    const src = read("supabase/functions/nearby-places/index.ts");
    expect(src).toMatch(/matchesCategory\(category, p\?\.primaryType \?\? null, p\?\.types \?\? \[\]\)/);
  });
});

describe("P1-4 la hoja del lugar queda encima de la barra inferior", () => {
  it("la barra es z-40 y la hoja (y su fondo) z-50, con el área segura abajo", () => {
    expect(read("src/components/DashboardLayout.tsx")).toMatch(/aria-label="Navegación principal" className="lg:hidden fixed bottom-0 inset-x-0 z-40 /);
    const c = read("src/pages/Cercanos.tsx");
    expect(c).toMatch(/className="fixed inset-0 bg-black\/60 backdrop-blur-sm z-50"/);
    expect(c).toMatch(/className="fixed inset-x-0 bottom-0 z-50 [^"]*max-h-\[85dvh\]/);
    expect(c).toMatch(/pb-\[calc\(1\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
  });
});

describe("P2-14 distancia en las tarjetas", () => {
  it("formato legible desde tu ubicación", () => {
    expect(distanceLabel(0.347)).toBe("a 350 m");
    expect(distanceLabel(1.234)).toBe("a 1.2 km");
    expect(distanceLabel(23.6)).toBe("a 24 km");
    // Zócalo → Bellas Artes (~900 m).
    expect(distanceLabel(distanceKm({ lat: 19.4326, lng: -99.1332 }, { lat: 19.4352, lng: -99.1412 }))).toBe("a 890 m");
    expect(read("src/pages/Cercanos.tsx")).toMatch(/data-testid="nearby-distance"/);
  });
});

describe("P2-2 «Mis reservas» en el menú lateral", () => {
  it("está en los enlaces de escritorio", () => {
    const src = read("src/components/DashboardLayout.tsx");
    const links = src.slice(src.indexOf("const links = ["), src.indexOf("export const mobilePrimaryNav"));
    expect(links).toMatch(/to: "\/dashboard\/reservas", icon: BookmarkCheck, label: "Mis reservas"/);
  });
});
