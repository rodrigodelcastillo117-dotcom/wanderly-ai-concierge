// Recorrido 12-nov-2026: «tengo fiebre y estoy en el hotel» con un viaje a Lisboa en contexto → Iato dijo «llama al 911».
// El número de emergencias es el del país donde ESTÁ el viajero (lista cerrada); si no se sabe, los dos.
import { describe, expect, it } from "vitest";
import { detectIntents, emergencyNumberNote, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { getEmergency } from "@/lib/emergencyNumbers";

const lisboa = { id: "t1", destino: "Lisboa → Oporto → Sevilla", fecha_salida: "2026-11-10", fecha_regreso: "2026-11-20", num_viajeros: 2 };

describe("número de emergencias según dónde está el viajero", () => {
  it("de viaje en Lisboa: 112 (Portugal)", () => {
    expect(emergencyNumberNote({ todayISO: "2026-11-12", place: null }, lisboa, "Lisboa")).toMatch(/\(Portugal\): 112\./);
  });
  it("viaje futuro y sin ubicación: no afirma un solo número", () => {
    const note = emergencyNumberNote({ todayISO: "2026-11-01", place: null }, lisboa, "Lisboa");
    expect(note).toMatch(/No sabemos en qué país está/);
    expect(note).toMatch(/911 en México.*112 en Europa/);
  });
  it("con ubicación conocida (Roma): números de Italia", () => {
    expect(emergencyNumberNote({ todayISO: "2026-11-01", place: "Roma" }, null, null)).toMatch(/Italia\): policía 113, ambulancia 118, bomberos 115/);
  });
  it("«tengo fiebre y estoy en el hotel» activa la nota", () => {
    const message = "Me siento muy mal, tengo fiebre y estoy en el hotel";
    const plan = planTurn({ message, intents: detectIntents(message), trip: lisboa, todayISO: "2026-11-12", coords: null, hasPriveSession: false, exigente: false });
    expect(plan.notes.join(" ")).toMatch(/Portugal\): 112/);
  });
  it("la lista de la app ya trae Portugal y Alemania (112, Unión Europea) y sigue sin inventar otros", () => {
    expect(getEmergency("Portugal")).toMatchObject({ verified: true, numbers: { ambulancia: "112" } });
    expect(getEmergency("Berlín, Alemania").verified).toBe(true);
    expect(getEmergency("Canadá").verified).toBe(false);
  });
});
