// Auditoría 10, ronda 2 (#12): Emergencia local → "Hospital" mostraba Viagland, Jorge, Metrored Quito y
// CENTRO HOLISTICO RIGAR antes del Hospital de Jesús; "Policía" traía una "Unidad de Policia Embajada"
// con tipo de oficina. Nombres reales de la captura c4_emerg_sheet.png (Centro Histórico de CDMX).
import { describe, expect, it } from "vitest";
import { emergencyTier, nearbySearchBody, rankEmergencyPlaces } from "../../supabase/functions/places-nearby/rank";

const ZOCALO = { lat: 19.4326, lng: -99.1332 };
const at = (dLat: number) => ({ lat: ZOCALO.lat + dLat, lng: ZOCALO.lng });

const HOSPITAL = [
  { name: "Viagland", primary_type: "hospital", rating: null, ratings_count: 0, ...at(0.0008) },
  { name: "Jorge", primary_type: "hospital", rating: null, ratings_count: 0, ...at(0.001) },
  { name: "Metrored Quito", primary_type: "medical_center", rating: 5, ratings_count: 2, ...at(0.0015) },
  { name: "CENTRO HOLISTICO RIGAR", primary_type: "hospital", rating: 4.8, ratings_count: 6, ...at(0.002) },
  { name: "Hospital de Jesús", primary_type: "hospital", rating: 4.0, ratings_count: 382, ...at(0.008) },
  { name: "Hospital General de México Dr. Eduardo Liceaga", primary_type: "general_hospital", rating: 4.1, ratings_count: 9150, ...at(-0.02) },
  { name: "Hospital Veterinario Centro", primary_type: "hospital", rating: 4.6, ratings_count: 150, ...at(0.003) },
];
const POLICE = [
  { name: "Unidad de Policia Embajada", primary_type: "government_office", rating: null, ratings_count: 1, ...at(0.03) },
  { name: "Estación de Policía", primary_type: "police", rating: 4.0, ratings_count: 41, ...at(0.004) },
  { name: "DIRECCIÓN DE SEGURIDAD ESCOLAR", primary_type: "police", rating: null, ratings_count: 0, ...at(0.0042) },
  { name: "CAJA DE PREVENCIÓN DE LA POLICÍA PREVENTIVA", primary_type: "police", rating: 3.9, ratings_count: 310, ...at(0.005) },
  { name: "SECTOR 52 POLICIA AUXILIAR ORCA", primary_type: "police", rating: 4.2, ratings_count: 12, ...at(0.006) },
];

describe("#12 · Emergencia local: hospitales y policía reales primero", () => {
  it("Hospital: los reales primero (por relevancia y luego distancia); fuera personas y negocios sin relación", () => {
    const r = rankEmergencyPlaces("hospital", HOSPITAL, ZOCALO);
    expect(r.map((p) => p.name)).toEqual(["Hospital de Jesús", "Hospital General de México Dr. Eduardo Liceaga"]);
    expect(r[0].distance_m).toBeGreaterThan(800);
    for (const bad of ["Viagland", "Jorge", "Metrored Quito", "CENTRO HOLISTICO RIGAR", "Hospital Veterinario Centro"]) expect(r.some((p) => p.name === bad)).toBe(false);
  });
  it("Policía: estación real primero; oficina escolar y caja de previsión fuera", () => {
    const r = rankEmergencyPlaces("police", POLICE, ZOCALO);
    expect(r[0].name).toBe("Estación de Policía");
    expect(r.map((p) => p.name)).not.toContain("DIRECCIÓN DE SEGURIDAD ESCOLAR");
    expect(r.map((p) => p.name)).not.toContain("CAJA DE PREVENCIÓN DE LA POLICÍA PREVENTIVA");
    // La "Unidad de Policia Embajada" (tipo oficina, 1 reseña, lejos) ya no va primero.
    expect(r.findIndex((p) => p.name === "Unidad de Policia Embajada")).not.toBe(0);
  });
  it("niveles: nombre + tipo + reseñas mínimas > nombre > tipo popular", () => {
    expect(emergencyTier("hospital", HOSPITAL[4])).toBe(1);
    expect(emergencyTier("hospital", { name: "Médica Sur", primary_type: "hospital", ratings_count: 4000 })).toBe(1);
    expect(emergencyTier("hospital", { name: "Star Lomas", primary_type: "hospital", ratings_count: 4000 })).toBe(3);
    expect(emergencyTier("hospital", HOSPITAL[0])).toBeNull();
  });
  it("farmacias, cajeros y restaurantes siguen como antes (solo se agrega la distancia)", () => {
    const list = [{ name: "Farmacia X", ratings_count: 0, ...at(0.001) }];
    expect(rankEmergencyPlaces("pharmacy", list, ZOCALO).map((p) => p.name)).toEqual(["Farmacia X"]);
    expect(nearbySearchBody({ lat: 1, lng: 1, kind: "hospital" }, "hospital").maxResultCount).toBe(20);
  });
});
