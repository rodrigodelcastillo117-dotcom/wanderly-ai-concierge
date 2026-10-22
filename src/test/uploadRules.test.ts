import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, safeExtension, safeFileName, UPLOAD_RULES, uploadProblem } from "@/lib/uploadRules";

const MIGRATION = "supabase/migrations/20261022141400_sec2_storage_bucket_limits.sql";

describe("uploads (F-11)", () => {
  it("las reglas del cliente coinciden con los límites del servidor (migración)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    const blocks = sql.split(/UPDATE storage\.buckets/).slice(1);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block).toContain(`file_size_limit = ${MAX_UPLOAD_BYTES}`);
      const types = [...block.matchAll(/'([a-z]+\/[a-z0-9.+-]+)'/g)].map((m) => m[1]).sort();
      const ids = [...block.matchAll(/'(recibos|journal-photos|travel-moments)'/g)].map((m) => m[1]);
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect([...UPLOAD_RULES[id as keyof typeof UPLOAD_RULES].types].sort(), id).toEqual(types);
    }
  });

  it("rechaza HTML, SVG y archivos de más de 10 MB; acepta fotos y PDF en recibos", () => {
    expect(uploadProblem("journal-photos", { type: "text/html", size: 10 })).toMatch(/foto/);
    expect(uploadProblem("travel-moments", { type: "image/svg+xml", size: 10 })).toMatch(/foto/);
    expect(uploadProblem("journal-photos", { type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 })).toMatch(/10 MB/);
    expect(uploadProblem("journal-photos", { type: "image/heic", size: 1000 })).toBeNull();
    expect(uploadProblem("recibos", { type: "application/pdf", size: 1000 })).toBeNull();
    expect(uploadProblem("journal-photos", { type: "application/pdf", size: 1000 })).not.toBeNull();
  });

  it("sanea nombres y extensiones para la ruta en storage", () => {
    expect(safeFileName("../../Recibo cena París <x>.pdf")).toBe("Recibo-cena-Paris-x-.pdf");
    expect(safeFileName("....")).toBe("archivo");
    expect(safeExtension("foto.JPG")).toBe("jpg");
    expect(safeExtension("x.php%00.html")).toBe("html");
    expect(safeExtension("sin-extension")).toBe("jpg");
    expect(safeExtension("a.<svg>")).toBe("jpg");
  });
});
