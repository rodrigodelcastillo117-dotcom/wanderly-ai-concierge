import { describe, it, expect } from "vitest";
import { nextTripAction, quoteFreshness, tripTiming } from "@/lib/tripCommand";
import { quoteTrust } from "@/lib/quoteTrust";
import { datePresets, looksLikeSentence, understandPlanText } from "@/lib/planDefaults";

const TODAY = "2026-10-22";
const NOW = new Date("2026-10-22T18:00:00Z");

describe("tripTiming", () => {
  it("cuenta los días que faltan y el día del viaje", () => {
    expect(tripTiming({ fecha_salida: "2026-11-01", fecha_regreso: "2026-11-05" }, TODAY)).toMatchObject({ phase: "proximo", daysToStart: 10, label: "Faltan 10 días" });
    expect(tripTiming({ fecha_salida: "2026-10-23", fecha_regreso: "2026-10-25" }, TODAY).label).toBe("Sales mañana");
    expect(tripTiming({ fecha_salida: "2026-10-21", fecha_regreso: "2026-10-25" }, TODAY)).toMatchObject({ phase: "en_curso", dayOfTrip: 2, totalDays: 5, label: "Día 2 de 5" });
    expect(tripTiming({ fecha_salida: "2026-10-22", fecha_regreso: "2026-10-24" }, TODAY).label).toBe("Sales hoy · día 1 de 3");
    expect(tripTiming({ fecha_salida: "2026-10-01", fecha_regreso: "2026-10-19" }, TODAY)).toMatchObject({ phase: "terminado", label: "Terminó hace 3 días" });
    expect(tripTiming({}, TODAY).phase).toBe("sin_fecha");
  });
});

describe("quoteFreshness", () => {
  it("borrador sin total = sin cotización (nunca $0 como precio)", () => {
    expect(quoteFreshness({ total_estimado: 0 }, null, NOW).status).toBe("sin_cotizacion");
  });
  it("con snapshot manda valid_until", () => {
    const q = { created_at: "2026-10-22T15:00:00Z", valid_until: "2026-10-23T15:00:00Z" };
    expect(quoteFreshness({ total_estimado: 1000 }, q, NOW)).toEqual({ status: "vigente", label: "Cotizado hace 3 h" });
    expect(quoteFreshness({ total_estimado: 1000 }, { ...q, valid_until: "2026-10-22T16:00:00Z" }, NOW).status).toBe("por_revisar");
  });
  it("sin snapshot, pasadas 24 h pide revisar; y un cambio posterior pide actualizar", () => {
    expect(quoteFreshness({ total_estimado: 1, created_at: "2026-10-19T10:00:00Z" }, null, NOW).label).toMatch(/hace 3 días: revísalos/);
    expect(quoteFreshness({ total_estimado: 1, quote_needs_update: true, created_at: "2026-10-22T17:00:00Z" }, null, NOW).label).toMatch(/actualiza/);
  });
});

describe("nextTripAction", () => {
  const base = { id: "t1", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-16", total_estimado: 23560, created_at: "2026-10-22T17:00:00Z" };
  it("una sola acción según la fase y la cotización", () => {
    expect(nextTripAction(base, { today: TODAY, now: NOW }).key).toBe("reservar");
    expect(nextTripAction({ ...base, total_estimado: 0 }, { today: TODAY, now: NOW })).toMatchObject({ key: "cotizar", to: "/dashboard/viajes/t1" });
    expect(nextTripAction({ ...base, quote_needs_update: true }, { today: TODAY, now: NOW })).toMatchObject({ key: "actualizar", to: "/dashboard/viajes/t1/editar" });
    expect(nextTripAction({ ...base, created_at: "2026-10-01T00:00:00Z" }, { today: TODAY, now: NOW }).key).toBe("revisar_precios");
    expect(nextTripAction({ ...base, fecha_salida: "2026-10-24", fecha_regreso: "2026-10-26" }, { today: TODAY, now: NOW })).toMatchObject({ key: "preparar", to: "/dashboard/viajes/t1/packing" });
    expect(nextTripAction({ ...base, fecha_salida: "2026-10-20", fecha_regreso: "2026-10-26" }, { today: TODAY, now: NOW })).toMatchObject({ key: "modo_viaje", to: "/dashboard/viajes/t1/live" });
    expect(nextTripAction({ ...base, fecha_salida: "2026-09-01", fecha_regreso: "2026-09-05" }, { today: TODAY, now: NOW }).key).toBe("recuerdos");
    expect(nextTripAction({ id: "t1" }, { today: TODAY, now: NOW }).key).toBe("poner_fechas");
  });
  it("nunca promete que IATOS reserva por el usuario", () => {
    const a = nextTripAction(base, { today: TODAY, now: NOW });
    expect(a.detail).toMatch(/directo con el proveedor/);
  });
});

describe("quoteTrust", () => {
  const snap = {
    valid_until: "2026-10-23T12:00:00Z",
    line_items: [
      { category: "vuelos", label: "Vuelos", amount: 10720, state: "COTIZADO" },
      { category: "hospedaje", label: "Hospedaje", amount: 4600, state: "ESTIMADO" },
      { category: "comida", label: "Comida", amount: 5200, state: "ESTIMADO" },
      { category: "cruceros", label: "Crucero", amount: 90000, state: "OPCIONAL" },
      { category: "tours", label: "Experiencias", amount: 0, state: "ESTIMADO" },
    ],
  };
  it("separa lo consultado en vivo de lo estimado y deja fuera lo opcional", () => {
    const t = quoteTrust(snap, NOW);
    expect(t).toMatchObject({ known: true, verified: 10720, estimated: 9800, toVerify: 0 });
    expect(t.lines).toHaveLength(3);
    expect(t.summary).toBe("$10,720 MXN con precio consultado en vivo · $9,800 MXN estimado.");
  });
  it("una cotización vencida no presenta nada como verificado", () => {
    const t = quoteTrust(snap, new Date("2026-10-24T00:00:00Z"));
    expect(t.verified).toBe(0);
    expect(t.toVerify).toBe(10720);
  });
  it("sin renglones no afirma nada", () => {
    expect(quoteTrust(null, NOW)).toMatchObject({ known: false, verified: 0 });
  });
});

describe("planDefaults", () => {
  it("atajos de fechas desde un miércoles", () => {
    const p = datePresets(new Date(2026, 9, 21));
    expect(p.map((x) => [x.salida, x.regreso])).toEqual([
      ["2026-10-23", "2026-10-25"], ["2026-11-04", "2026-11-09"], ["2026-11-20", "2026-11-27"],
    ]);
  });
  it("en sábado el fin de semana es el siguiente", () => {
    expect(datePresets(new Date(2026, 9, 24))[0].salida).toBe("2026-10-30");
  });
  it("distingue un destino de una frase y la interpreta sin IA", () => {
    expect(looksLikeSentence("Tokio")).toBe(false);
    expect(looksLikeSentence("Roma → Florencia → Venecia")).toBe(false);
    expect(understandPlanText("Oaxaca del 12 al 16 de diciembre, 2 personas", new Date(2026, 9, 21))).toEqual({
      destino: "Oaxaca", fechaSalida: "2026-12-12", fechaRegreso: "2026-12-16", viajeros: 2,
    });
    expect(understandPlanText("Algo tranquilo en diciembre con mi familia")).toBeNull();
  });
});

import { flightStatusLine } from "@/lib/tripCommand";
describe("flightStatusLine", () => {
  it("usa lo último guardado y nunca supone 'a tiempo'", () => {
    expect(flightStatusLine({ flight: "AM 123", last_status: "retrasado", last_checked_at: "2026-10-22T16:00:00Z" }, NOW)).toBe("Vuelo AM 123 · retrasado · revisado hace 2 h");
    expect(flightStatusLine({ flight: "Y4 9", last_status: null }, NOW)).toBe("Vuelo Y4 9 · aún sin estado del proveedor");
    expect(flightStatusLine({ flight: "Y4 9", last_status: "desconocido" }, NOW)).toMatch(/sin estado/);
  });
});
