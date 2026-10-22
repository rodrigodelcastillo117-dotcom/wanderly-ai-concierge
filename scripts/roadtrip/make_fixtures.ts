// Datos simulados para la evidencia visual del road trip (grupo roadtrip). SOLO PRUEBAS.
// Usa la lógica REAL (plan, planeador de Iato, finalizeTurn) con una respuesta de Google Routes
// SIMULADA para la Toscana (números de ejemplo, no consultados) y un texto del modelo SIMULADO.
// Uso: npx vite-node scripts/roadtrip/make_fixtures.ts <salida.json>
import { writeFileSync } from "node:fs";
import { buildRoadTripPlan } from "../../supabase/functions/_shared/roadtrip/plan";
import { detectIntents, planTurn } from "../../supabase/functions/concierge-chat/planner";
import { finalizeTurn } from "../../supabase/functions/concierge-chat/finalize";

const stops = ["Florencia", "San Gimignano", "Siena", "Montalcino", "Pienza", "Roma"];
// Respuesta de Google Routes simulada en 3 tramos; los otros 2 quedan ESTIMADOS (como si Google no respondiera).
const fake = (km: number, min: number) => ({ ok: true, distance_meters: km * 1000, duration_seconds: min * 60, consultado_at: "2026-10-22T18:00:00Z" });
const plan = buildRoadTripPlan({
  stops, legModes: ["coche", "coche", "coche", "coche", "coche"],
  legDates: ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"],
  live: [fake(57, 62), fake(42, 50), null, fake(25, 33), null], apiCalls: 5, now: "2026-10-22T18:00:00Z",
});

const message = "quiero hacer un road trip por la Toscana en 7 días";
const turn = planTurn({ message, intents: detectIntents(message), trip: null, todayISO: "2026-10-22", coords: null, hasPriveSession: false, exigente: false });
const text = [
  "¡Qué buen plan! Te propongo **Toscana: Chianti y Val d'Orcia** en 7 días, en coche (ruta de Visit Tuscany):",
  "- **Día 1–2:** San Gimignano y Volterra",
  "- **Día 3–4:** Siena y Montalcino",
  "- **Día 5–6:** Pienza y Val d'Orcia",
  "- **Día 7:** Radda in Chianti",
  "",
  "Las distancias que te doy son **estimadas**; al planearlo en IATOS se calculan con Google Maps. Combustible estimado con el precio oficial de la UE; la renta está **por cotizar** y casetas y estacionamiento **por confirmar**. Ojo con las **ZTL** (multa automática por cámara) y lleva **permiso internacional o traducción oficial** de tu licencia (Codice della Strada, art. 135).",
].join("\n");
const final = finalizeTurn({ raw: text, toolRuns: [], plan: turn, actionCtx: { todayISO: "2026-10-22", trips: [], activeTripId: null }, hasConfirmedBookings: false, party: 2, makeId: () => "a1" } as any);

writeFileSync(process.argv[2], JSON.stringify({ plan, iato: { text: final.text, cards: final.cards, actions: final.actions } }, null, 2));
console.log("ok", process.argv[2]);
