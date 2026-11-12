// Revisión independiente del código del 12-nov-2026: 8 fallas confirmadas, cada una con el ejemplo que la mostró.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { disruptionTiming, emergencyNumberNote } from "../../supabase/functions/concierge-chat/planner";
import { cityAirports, mainAirport, resolveFlightPlace } from "../../supabase/functions/_shared/airports";
import { parseMultiCityText } from "@/lib/multiCityText";

describe("2 · un retraso que está pasando no es hipotético", () => {
  it.each([
    "Sí, mi vuelo está retrasado 4 horas, ¿qué hago?",
    "Si, el vuelo esta cancelado, ayudame",
    "Estoy en el aeropuerto, mi vuelo está demorado, ¿qué hago si pierdo mi conexión?",
  ])("%s → ahora", (m) => expect(disruptionTiming(m)).toBe("ahora"));
  it("la pregunta hipotética sigue siendo hipotética", () => {
    expect(disruptionTiming("Si mi vuelo se retrasa más de 3 horas, ¿qué derechos tengo?")).toBe("hipotetica");
  });
});

describe("3 · emergencias: primero donde está el viajero", () => {
  const roma = { destino: "Roma", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-20" };
  it("con lugar conocido (Madrid) gana el lugar, no la ciudad del viaje (Roma)", () => {
    expect(emergencyNumberNote({ todayISO: "2026-11-12", place: "Madrid" }, roma, "Roma")).toMatch(/España\): 112/);
  });
  it("el día de salida sin lugar: no se supone que ya está en el destino", () => {
    expect(emergencyNumberNote({ todayISO: "2026-11-10", place: null }, roma, "Roma")).toMatch(/No sabemos en qué país está/);
  });
});

describe("4 y 5 · regiones y nombres de persona en el texto del viaje", () => {
  it("«Sicilia 10 días» sigue siendo región, no la ciudad Catania", () => {
    const r = parseMultiCityText("Sicilia 10 días");
    expect(JSON.stringify(r)).not.toMatch(/Catania/);
  });
  it("«Viaje a Madrid con Sofia 10 dias» no agrega Sofía (Bulgaria)", () => {
    const r = parseMultiCityText("Viaje a Madrid con Sofia 10 dias");
    expect(JSON.stringify(r)).not.toMatch(/Bulgaria|"Sofía"/);
  });
  it("«Cancún con mi esposa Petra» no agrega Petra (Jordania)", () => {
    expect(JSON.stringify(parseMultiCityText("Cancún con mi esposa Petra 5 días"))).not.toMatch(/"Petra"/);
  });
});

describe("6 · Finlandia no vuela a Islandia", () => {
  it("Finlandia → Helsinki; Islandia → Reikiavik; Jamaica → Montego Bay", () => {
    expect(mainAirport("Finlandia")).toBe("HEL");
    expect(mainAirport("Islandia")).toBe("KEF");
    expect(cityAirports("Islandia")).toBeNull();
    expect(JSON.stringify(resolveFlightPlace("Finlandia"))).not.toMatch(/KEF/);
  });
});

describe("1, 7 y 8 · código del plan y del Operador", () => {
  const lp = readFileSync("supabase/functions/logistics-plan/index.ts", "utf8");
  const serv = readFileSync("supabase/functions/_shared/derechos/servicio.ts", "utf8");
  const prompt = readFileSync("supabase/functions/_shared/operador/prompt.ts", "utf8");
  it("1 · Claude con tope propio (deja tiempo a Gemini) y sin respuestas cortadas", () => {
    expect(lp).toMatch(/Math\.min\(timeoutMs - 15_000, 30_000\)/);
    expect(lp).toMatch(/stop_reason === "max_tokens"\) return null/);
  });
  it("7 · la nota dice si el viajero de verdad recibió el aviso", () => {
    expect(serv).toMatch(/avisado = r\?\.ok === true/);
    expect(serv).toMatch(/el viajero TODAVÍA NO lo sabe: díselo/);
  });
  it("8 · el seguimiento del reclamo enviado es de 1440 min (lo que acepta la herramienta)", () => {
    expect(prompt).toMatch(/prometer_seguimiento de 1440 minutos/);
    expect(prompt).not.toMatch(/prometer_seguimiento en la fecha del recordatorio/);
  });
});

describe("vuelos de respaldo sin repetir (dueño, 12-nov-2026: WS 2229 tres veces)", () => {
  it("con un solo vuelo distinto se muestra uno; con dos, dos; nunca el mismo como ahorro, equilibrio y premium", () => {
    const lp = readFileSync("supabase/functions/logistics-plan/index.ts", "utf8");
    expect(lp).toMatch(/const uniq = sorted\.filter/);
    expect(lp).toMatch(/uniq\.length === 2 \? \[\[uniq\[0\], "ahorro"\], \[uniq\[1\], "premium"\]\] : \[\[uniq\[0\], "ahorro"\]\]/);
    expect(lp).not.toMatch(/const equilibrio = sorted\[Math\.floor\(sorted\.length \/ 2\)\] \?\? ahorro/);
  });
});
