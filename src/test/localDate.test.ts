import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  daysFromToday, diffLocalDays, formatInstant, formatLocalDate, localISODatePlus, parseLocalDate,
} from "@/lib/localDate";
import { formatDateOnly, parseDateOnly } from "@/lib/dateUtils";

// E-25: en la Ciudad de México new Date("2026-10-01") es el 30 de septiembre a las 18:00.
describe("fechas de calendario en America/Mexico_City", () => {
  const tz = process.env.TZ;
  beforeEach(() => { process.env.TZ = "America/Mexico_City"; });
  afterEach(() => { process.env.TZ = tz; });

  it("el bug existía: new Date('YYYY-MM-DD') cae el día anterior", () => {
    expect(new Date("2026-10-01").getDate()).toBe(30);
  });

  it("parseLocalDate lee el mismo día del calendario", () => {
    const d = parseLocalDate("2026-10-01")!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 1]);
    expect(parseLocalDate("2026-10-01T00:00:00Z")!.getDate()).toBe(1);
    expect(parseLocalDate("2026-02-31")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
    expect(parseLocalDate("mañana")).toBeNull();
  });

  it("formatLocalDate muestra 1 de octubre, no 30 de septiembre", () => {
    expect(formatLocalDate("2026-10-01", { day: "numeric", month: "long" })).toBe("1 de octubre");
    expect(formatLocalDate(null)).toBe("—");
    // La API vieja delega en la misma implementación.
    expect(formatDateOnly("2026-10-01", { day: "numeric", month: "long" })).toBe("1 de octubre");
    expect(parseDateOnly("2026-10-01")!.getDate()).toBe(1);
  });

  it("formatInstant pasa un timestamp UTC a la fecha local (no toma la parte de fecha)", () => {
    // 03:00 UTC del 2 de octubre = 21:00 del 1 de octubre en CDMX.
    expect(formatInstant("2026-10-02T03:00:00+00:00", { day: "numeric", month: "long" })).toBe("1 de octubre");
    expect(formatInstant("no es fecha")).toBe("—");
  });

  it("días entre fechas y días desde hoy", () => {
    expect(diffLocalDays("2026-10-01", "2026-10-08")).toBe(7);
    const tonight = new Date(2026, 9, 1, 22, 30); // 1 oct 22:30 local (ya es 2 oct en UTC)
    expect(daysFromToday("2026-10-01", tonight)).toBe(0);
    expect(daysFromToday("2026-10-02", tonight)).toBe(1);
    expect(daysFromToday("2026-09-28", tonight)).toBe(-3);
    expect(daysFromToday(undefined, tonight)).toBeNull();
    expect(localISODatePlus(5, parseLocalDate("2026-10-30")!)).toBe("2026-11-04");
  });
});

// Ninguna pantalla vuelve a formatear una fecha de calendario con new Date(campo).toLocale…
describe("sin new Date(fecha).toLocaleDateString en src/", () => {
  const root = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "test") walk(p); }
      else if (/\.(tsx?|jsx?)$/.test(f)) files.push(p);
    }
  };
  walk(root);
  it.each(["fecha_salida", "fecha_regreso", "expense_date"])("%s no se parsea como UTC", (field) => {
    const re = new RegExp(`new Date\\([\\w.?]*${field}\\)`);
    const offenders = files.filter((f) => re.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
