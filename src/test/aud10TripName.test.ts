// Auditoría 10/10 (herramientas y técnica, 28-oct-2026): un viaje guardado con la frase completa como
// destino ("Quiero conocer España 15 días…") aparecía así en Inicio, Mis viajes, Perfil, Recuerdos y
// Gastos, y estiraba las listas a 574 px en un celular de 390. Se arregla la causa (al crear el viaje) y
// el nombre que se muestra (sin editar datos guardados).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { looksLikeRawPrompt, placeFromPrompt, shortTripName, storedTripDestino, tripOptionLabel } from "@/lib/tripName";
import { tripLabel } from "@/lib/activeTrip";

const PROMPT = "Quiero conocer España 15 días, no sé qué ciudades. Del 4 al 19 de mayo, somos 2 personas y queremos comer muy bien";
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("nombre corto del viaje", () => {
  it("reconoce la frase y no confunde destinos ni rutas", () => {
    expect(looksLikeRawPrompt(PROMPT)).toBe(true);
    for (const d of ["Tokio", "Valle de Bravo", "Ciudad de México", "Roma → Florencia → Venecia", "Lisboa, Portugal", "San Miguel de Allende"]) {
      expect(looksLikeRawPrompt(d)).toBe(false);
    }
  });

  it("muestra el lugar de la frase, las paradas entendidas o el país", () => {
    expect(placeFromPrompt(PROMPT)).toBe("España");
    expect(shortTripName({ destino: PROMPT })).toBe("España");
    expect(shortTripName({ destino: "Tokio", pais_destino: "Japón" })).toBe("Tokio");
    const itinerario_json = { days: [], consulta: { consulta_original: PROMPT, interpretacion: { paradas: [
      { ciudad: "Madrid", rol: "estancia" }, { ciudad: "Sevilla", rol: "estancia" }, { ciudad: "Ciudad de México", rol: "origen" },
    ] } } };
    expect(shortTripName({ destino: PROMPT, itinerario_json })).toBe("Madrid → Sevilla");
    expect(shortTripName({ destino: "Quiero ir de vacaciones con mi familia en diciembre", pais_destino: "México" })).toBe("México");
  });

  it("los selectores llevan nombre corto y fechas (Madrid ×3 ya se distingue)", () => {
    expect(tripLabel({ id: "a", destino: PROMPT, fecha_salida: "2027-05-04", fecha_regreso: "2027-05-19" })).toMatch(/^España \(/);
    const label = tripOptionLabel({ destino: "Madrid", fecha_salida: "2027-05-04", fecha_regreso: "2027-05-19" });
    expect(label).toMatch(/^Madrid · 4 may/);
    expect(label).toMatch(/2027$/);
  });

  it("al crear el viaje se guarda el lugar, no la frase (la frase queda en la consulta)", () => {
    expect(storedTripDestino(PROMPT, "España")).toBe("España");
    expect(storedTripDestino("Oaxaca", "México")).toBe("Oaxaca");
    const src = read("supabase/functions/analizar-viaje/index.ts");
    expect(src).toMatch(/destino: storedTripDestino\(body\.destino/);
    // El planeador manda la frase al intérprete en lugar de usarla como destino.
    expect(read("src/pages/PlanTrip.tsx")).toMatch(/if \(looksLikeRawPrompt\(destino\)\) \{ void interpretNow\(\); return; \}/);
  });

  it("las listas usan el nombre corto", () => {
    for (const f of ["src/pages/Trips.tsx", "src/pages/DashboardHome.tsx", "src/components/social/FriendsPrivacySection.tsx",
      "src/components/TripCommandCenter.tsx", "src/pages/TripDetail.tsx", "src/pages/Gastos.tsx", "src/lib/recuerdos/api.ts"]) {
      expect(read(f), f).toMatch(/shortTripName\(/);
    }
    for (const f of ["src/pages/Recuerdos.tsx", "src/components/recuerdos/RecuerdosUploader.tsx", "src/components/recuerdos/RecuerdosViewer.tsx"]) {
      expect(read(f), f).toMatch(/tripOptionLabel\(t\)/);
    }
  });
});
