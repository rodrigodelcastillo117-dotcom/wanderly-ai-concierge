// Validación estricta de la respuesta del modelo en parsear-viaje (IATOS-064). Sin Deno: Vitest.
// Cada campo se limpia a su tipo; lo inválido queda null (la app usa sus valores por defecto) y sin
// destino no hay viaje que interpretar.

export type TripParams = {
  destino: string;
  pais_destino: string | null;
  destinations: string[];
  is_multi: boolean;
  ciudad_origen: string | null;
  fecha_salida: string | null;
  fecha_regreso: string | null;
  num_viajeros: number;
  presupuesto_objetivo: number | null;
  notas: string;
};

const s = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t && !/^(null|n\/a|-|—)$/i.test(t) ? t.slice(0, max) : null;
};

function date(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim().slice(0, 10) : "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? t : null;
}

export function validateTripParams(raw: unknown): { ok: true; data: TripParams } | { ok: false; error: string } {
  let input: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try { input = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      try { input = m ? JSON.parse(m[0]) : null; } catch { input = null; }
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "respuesta_invalida" };
  const p = input as Record<string, unknown>;
  const destinations = (Array.isArray(p.destinations) ? p.destinations : [])
    .map((d) => s(d, 80)).filter((d): d is string => !!d).slice(0, 10);
  const destino = s(p.destino, 120) ?? destinations[0] ?? null;
  if (!destino) return { ok: false, error: "sin_destino" };
  let salida = date(p.fecha_salida);
  let regreso = date(p.fecha_regreso);
  if (salida && regreso && regreso < salida) [salida, regreso] = [regreso, salida];
  const viajeros = Number(p.num_viajeros);
  const presupuesto = typeof p.presupuesto_objetivo === "number" ? p.presupuesto_objetivo : Number(String(p.presupuesto_objetivo ?? "").replace(/[^\d.]/g, ""));
  return {
    ok: true,
    data: {
      destino,
      pais_destino: s(p.pais_destino, 80),
      destinations: destinations.length ? destinations : [destino],
      is_multi: destinations.length >= 2,
      ciudad_origen: s(p.ciudad_origen, 80),
      fecha_salida: salida,
      fecha_regreso: regreso,
      num_viajeros: Number.isInteger(viajeros) && viajeros >= 1 && viajeros <= 12 ? viajeros : 2,
      presupuesto_objetivo: Number.isFinite(presupuesto) && presupuesto > 0 && presupuesto < 1e8 ? Math.round(presupuesto) : null,
      notas: s(p.notas, 300) ?? "",
    },
  };
}
