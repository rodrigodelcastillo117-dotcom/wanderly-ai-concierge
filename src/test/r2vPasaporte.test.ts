// R2 viajes P2-12: «Tu pasaporte vence durante tu viaje a Tokio y Lima… regresas el 20 feb», pero Lima
// regresa el 16 feb: la fecha era la del primer viaje del grupo.
import { describe, it, expect } from "vitest";
import { buildAlerts, type TripLite } from "@/lib/boveda/alerts";
import type { VaultItem } from "@/lib/boveda/types";

const pp = { id: "pp", user_id: "u", section: "documento", kind: "pasaporte", program_id: null, tier_id: null, title: "Pasaporte",
  issuer: null, tier: null, number: null, holder_name: null, country_code: "MX", visa_type: null, entries: null, valid_from: null,
  expires_on: "2027-02-12", contact_phone: null, benefits: [], benefits_unverified: false, notes: null, created_at: "", updated_at: "" } as VaultItem;

const TRIPS: TripLite[] = [
  { id: "tyo", destino: "Tokio", pais_destino: "Japón", fecha_salida: "2027-02-10", fecha_regreso: "2027-02-20" },
  { id: "lim", destino: "Lima", pais_destino: "Perú", fecha_salida: "2027-02-11", fecha_regreso: "2027-02-16" },
];

describe("alerta del pasaporte con la fecha de cada viaje", () => {
  it("vence durante: regresas de Tokio el 20 feb y de Lima el 16 feb", () => {
    const a = buildAlerts([pp], TRIPS, "2026-10-29").find((x) => x.id.startsWith("pp-exp-durante"))!;
    expect(a.title).toBe("Tu pasaporte vence durante tu viaje a Tokio y Lima");
    expect(a.detail).toBe("Vence el 12 feb 2027 y regresas de Tokio el 20 feb 2027 y de Lima el 16 feb 2027. Renuévalo antes de viajar.");
  });

  it("un solo viaje: igual que antes", () => {
    const a = buildAlerts([pp], [TRIPS[1]], "2026-10-29").find((x) => x.id.startsWith("pp-exp-"))!;
    expect(a.detail).toBe("Vence el 12 feb 2027 y regresas el 16 feb 2027. Renuévalo antes de viajar.");
  });

  it("vence antes: la salida de cada viaje", () => {
    const a = buildAlerts([{ ...pp, expires_on: "2027-02-01" }], TRIPS, "2026-10-29").find((x) => x.id.startsWith("pp-exp-antes"))!;
    expect(a.detail).toBe("Vence el 1 feb 2027, antes de que salgas a Tokio el 10 feb 2027 y a Lima el 11 feb 2027. Renuévalo antes de viajar.");
  });
});
