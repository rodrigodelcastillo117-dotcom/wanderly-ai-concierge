#!/usr/bin/env node
// Cargador de la curaduría de privevalor (Privé Drops + Insider's Notebook). Igual que
// scripts/prive/load_curation.mjs: valida, produce un REPORTE y un SQL de ENSAYO. Nunca llama a producción.
//
//   node scripts/prive/load_value_curation.mjs [--month 2026-10] [--today YYYY-MM-DD] [--out <carpeta>]
//        [--emit-migration <archivo.sql>]
//
// Entrada: data/prive/valor/<AAAA-MM>/drops.json e insider.json.
// Salidas en --out (por omisión data/prive/valor/_reportes/<AAAA-MM>):
//   report.json        aceptadas, rechazadas con motivo
//   import_dry_run.sql SELECT prive_drops_import_batch(…, true) y prive_insider_import_batch(…, true) para
//                      una RÉPLICA local (ensayo: deshace todo y devuelve el reporte de la base)
// --emit-migration escribe la migración de siembra (dry_run = false) con SOLO las filas aceptadas. Aplicarla en
// producción requiere la autorización del dueño.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dropProblems, importSql, tipProblems, validateBatch } from "./value-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const root = resolve(here, "../../data/prive/valor");
const month = opt("month", existsSync(root) ? readdirSync(root).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort().pop() : null);
if (!month) { console.error("No hay carpeta data/prive/valor/<AAAA-MM>"); process.exit(1); }
const dir = join(root, month);
const today = opt("today", new Date().toISOString().slice(0, 10));
const outDir = resolve(opt("out", join(root, "_reportes", month)));
const read = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : []);

const drops = validateBatch(read("drops.json"), dropProblems, { today });
const tips = validateBatch(read("insider.json"), tipProblems, { today });
const batch = `valor-${month}`;
const report = { month, today, batch,
  drops: { accepted: drops.accepted.length, rejected: drops.rejected },
  insider: { accepted: tips.accepted.length, rejected: tips.rejected } };

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, "import_dry_run.sql"),
  importSql("prive_drops_import_batch", drops.accepted, batch, true) + importSql("prive_insider_import_batch", tips.accepted, batch, true));

const mig = opt("emit-migration");
if (mig) {
  const head = `-- IATOS Privé · privevalor 5/6 · Siembra verificada (${month}). GENERADA por scripts/prive/load_value_curation.mjs
-- desde data/prive/valor/${month}/drops.json e insider.json: solo oportunidades y consejos leídos en páginas
-- oficiales públicas, con URL y fecha de verificación (ver docs/iatos/prive_reimagined/PRIVEVALOR.md §Fuentes).
-- Pasa por los mismos importadores que la curaduría mensual (validación de la base por fila). Upsert por slug:
-- idempotente. Los Drops se vuelven "por verificar" solos a los 45 días y desaparecen al vencer.
-- Ningún beneficio de tarjeta ni beneficio IATOS: no hay ninguno verificable / no hay convenios.
DO $seed$
DECLARE r jsonb;
BEGIN
  r := ${importSql("prive_drops_import_batch", drops.accepted, batch, false).replace(/^SELECT /, "").replace(/;\n$/, "")};
  IF jsonb_array_length(r->'rejected') > 0 THEN RAISE EXCEPTION 'siembra de Drops rechazada: %', r->'rejected'; END IF;
  r := ${importSql("prive_insider_import_batch", tips.accepted, batch, false).replace(/^SELECT /, "").replace(/;\n$/, "")};
  IF jsonb_array_length(r->'rejected') > 0 THEN RAISE EXCEPTION 'siembra del Insider rechazada: %', r->'rejected'; END IF;
END $seed$;
`;
  writeFileSync(resolve(mig), head);
}

console.log(`privevalor ${month}: Drops ${drops.accepted.length} aceptados / ${drops.rejected.length} rechazados · ` +
  `Insider ${tips.accepted.length} aceptados / ${tips.rejected.length} rechazados → ${outDir}`);
for (const r of [...drops.rejected, ...tips.rejected]) console.log(`  RECHAZO ${r.slug}: ${r.problems.join("; ")}`);
process.exitCode = drops.rejected.length || tips.rejected.length ? 2 : 0;
