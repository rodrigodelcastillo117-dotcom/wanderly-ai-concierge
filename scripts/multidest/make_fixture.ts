// Fixture de la evidencia visual del caso Roma → Florencia → Venecia (SOLO PRUEBAS, datos del reporte
// del dueño en src/test/fixtures/casoRomaFlorenciaVenecia.ts) con el panel del road trip armado por la
// lógica real (tramos en coche Roma → Florencia → Venecia, sin consulta a Google: distancias estimadas).
// Uso: npx vite-node scripts/multidest/make_fixture.ts /tmp/md_fixture.json
import { writeFileSync } from "node:fs";
import { CASO_TRIP } from "../../src/test/fixtures/casoRomaFlorenciaVenecia";
import { buildRoadTripPlan } from "../../src/lib/roadtrip";

const road = buildRoadTripPlan({ stops: ["Roma", "Florencia", "Venecia"], legModes: ["coche", "coche"], legDates: ["2026-10-26", "2026-10-29"], live: [null, null] });
const trip = {
  ...CASO_TRIP,
  user_id: "00000000-0000-4000-8000-0000000000c1",
  id: "00000000-0000-4000-8000-0000000000d1",
  updated_at: "2026-10-22T15:00:00Z",
  analisis_ai: "Roma, Florencia y Venecia en 10 noches (datos simulados del caso).",
  tips_personalizados: ["Reserva el Coliseo con anticipación.", "En Venecia lleva zapatos cómodos."],
  itinerario_json: { ...CASO_TRIP.itinerario_json, logistics: { ...CASO_TRIP.itinerario_json.logistics, road_trip: road, leg_modes: ["coche", "coche"], fx_usd_mxn: 18.76 } },
};
writeFileSync(process.argv[2], JSON.stringify({ trip }, null, 2));
console.log("ok", process.argv[2]);
