// Auditoría 10, ronda 2 (N2): el clima decía "consultado hoy 28 de octubre, 21:18 hora CDMX" a las 20:18
// (02:18 UTC; CDMX es UTC−6 todo el año) y llamó "jueves" al viernes 30. La herramienta entrega ahora la
// hora ya escrita en la zona del usuario y el día de la semana calculado.
import { describe, expect, it } from "vitest";
import { runWeather } from "../../supabase/functions/_shared/weather";
import { formatLocalStamp, longDay, withLocalStamp } from "../../supabase/functions/_shared/localTime";
import RESP from "./fixtures/auditoria10Respuestas.json";

const AT = Date.parse("2026-10-29T02:18:00Z");

/** MET Norway simulado: 4 días desde el 29 de octubre (UTC). */
function metFetch() {
  const timeseries: unknown[] = [];
  for (let h = 0; h < 24 * 5; h += 1) {
    timeseries.push({ time: new Date(AT + h * 3600_000).toISOString(), data: { instant: { details: { air_temperature: 12 + (h % 24 > 12 ? 10 : 0), wind_speed: 3 } }, next_1_hours: { summary: { symbol_code: "rainshowers_day" }, details: { precipitation_amount: 0.1 } } } });
  }
  return (async (u: string) => new Response(JSON.stringify(/met\.no/.test(u) ? { properties: { meta: { updated_at: "2026-10-29T01:00:00Z" }, timeseries } } : {}), { status: /met\.no/.test(u) ? 200 : 500 })) as unknown as typeof fetch;
}

describe("N2 · hora de consulta en la zona del usuario", () => {
  it("02:18 UTC = 20:18 del 28 de octubre en CDMX (UTC−6)", () => {
    expect(formatLocalStamp("2026-10-29T02:18:00Z", "America/Mexico_City")).toBe("28 oct 2026, 20:18 (hora CDMX)");
    expect(formatLocalStamp("2026-10-29T02:18:00Z", "Europe/Madrid")).toBe("29 oct 2026, 03:18 (hora de Madrid)");
  });
  it("el clima entrega consultado_local y el día de la semana de cada fecha", async () => {
    const r = await runWeather({ city: "Valle de Bravo", lat: 19.19, lng: -100.13, date_from: "2026-10-30", date_to: "2026-11-01" }, { fetchImpl: metFetch(), now: () => AT, userTz: "America/Mexico_City" });
    expect(r.consultado_local).toBe("28 oct 2026, 20:18 (hora CDMX)");
    expect(String(r.nota)).toMatch(/usa consultado_local tal cual/);
    const dias = (r.pronostico as { fecha: string; dia: string }[]);
    expect(dias.find((d) => d.fecha === "2026-10-30")?.dia).toBe("viernes 30 de octubre");
    // En producción el modelo escribió 21:18 y "jueves 30" (fixture del reporte de la ronda 1/2).
    expect((RESP as any).t01_clima_2.streamed).toMatch(/hora CDMX/);
  });
  it("cualquier herramienta con consultado_at / consulted_at recibe la hora local (sin tocar el ISO)", () => {
    const out = withLocalStamp({ ok: true, consulted_at: "2026-10-29T02:18:00Z", results: [] }, "America/Mexico_City") as Record<string, unknown>;
    expect(out).toMatchObject({ consulted_at: "2026-10-29T02:18:00Z", consultado_local: "28 oct 2026, 20:18 (hora CDMX)" });
    expect(withLocalStamp({ ok: true }, "America/Mexico_City")).toEqual({ ok: true });
    expect(withLocalStamp({ consulted_at: "2026-10-29T02:18:00Z" }, "zona/rara")).toEqual({ consulted_at: "2026-10-29T02:18:00Z" });
    expect(longDay("2026-11-01")).toBe("domingo 1 de noviembre");
  });
});
