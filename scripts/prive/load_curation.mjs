#!/usr/bin/env node
// Cargador de la curaduría de IATOS Privé. Lee los archivos de una ronda mensual, valida estrictamente
// (curation-lib.mjs) y produce un REPORTE DE ENSAYO. Nunca llama a producción.
//
//   node scripts/prive/load_curation.mjs [--month 2026-10] [--dir <carpeta>] [--files 1,3,5]
//        [--out <carpeta de salida>] [--today YYYY-MM-DD] [--json]
//
// Entrada por omisión: data/prive/curaduria/<AAAA-MM>/ del repo (el mes más reciente si no se da
// --month). Acepta content_g1…g13.json (rondas iniciales) y content_new.json / content_updates.json
// (rondas mensuales), cualquier subconjunto.
// Salidas en --out (por omisión <carpeta>/../_reportes/<AAAA-MM>, fuera del control de versiones
// salvo que se quiera guardar):
//   report.json         resumen por archivo y destino, rechazos con motivo, avisos
//   import_rows.json    filas listas para public.prive_import_batch
//   import_dry_run.sql  SELECT prive_import_batch(…, true) para correr en una RÉPLICA local con psql
//                       (ensayo: deshace todo y devuelve el reporte de la base)
// Aplicar de verdad (dry_run=false) requiere la aprobación del dueño y se hace a mano, en una
// réplica primero (supabase/tests/prive_catalog/run.sh) y después en producción con su GO.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mapBatch, summarize } from "./curation-lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const curRoot = resolve(here, "../../data/prive/curaduria");
const latestMonth = () => (existsSync(curRoot) ? readdirSync(curRoot).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort().pop() : null);
const month = opt("month", latestMonth());
const dir = resolve(opt("dir", process.env.PRIVE_CONTENT_DIR ?? (month ? join(curRoot, month) : ".")));
const only = opt("files") ? new Set(opt("files").split(",").map((x) => Number(x.trim()))) : null;
const outDir = resolve(opt("out", join(curRoot, "_reportes", month ?? "sin_mes")));
const today = opt("today", new Date().toISOString().slice(0, 10));
const coords = JSON.parse(readFileSync(join(here, "destinations.coords.json"), "utf8"));

const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => /^content_(g\d+|new|updates)\.json$/.test(f))
      .map((f) => ({ f, n: /^content_g(\d+)/.test(f) ? Number(f.match(/\d+/)[0]) : f === "content_new.json" ? 100 : 101 }))
      .filter(({ n }) => (n >= 100 || (n >= 1 && n <= 13)) && (!only || only.has(n)))
      .sort((a, b) => a.n - b.n)
  : [];

const perFile = {};
const entries = [];
for (const { f } of files) {
  try {
    const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!Array.isArray(data)) { perFile[f] = { error: "el archivo no es un arreglo JSON" }; continue; }
    data.forEach((e, i) => entries.push(e && typeof e === "object" ? { ...e, _file: f, _index: i } : e));
    perFile[f] = { entries: data.length };
  } catch (err) {
    perFile[f] = { error: `JSON inválido: ${err.message}` };
  }
}

const result = mapBatch(entries, { today, destinationCoords: coords });
for (const r of result.accepted) delete r._file;
const byFile = {};
for (const x of entries) { if (x?._file) (byFile[x._file] ??= { accepted: 0, rejected: 0 }); }
for (const r of result.rejected) if (r.file) byFile[r.file].rejected++;
for (const f of Object.keys(byFile)) byFile[f].accepted = (perFile[f]?.entries ?? 0) - byFile[f].rejected;
const states = result.accepted.reduce((m, r) => ({ ...m, [r.data_state]: (m[r.data_state] ?? 0) + 1 }), {});
const report = {
  generated_at: new Date().toISOString(), today, month, dir, files: perFile, by_file: byFile,
  totals: { entries: entries.length, accepted: result.accepted.length, rejected: result.rejected.length, by_state: states,
    seasonal_closed: result.accepted.filter((r) => r.operating_status === "cerrado_temporal").length,
    gambling_or_hijacked_domain_notes: result.warnings.filter((w) => /apuestas/.test(w.warning)).length },
  by_destination: summarize(result),
  rejected: result.rejected,
  warnings: result.warnings,
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
writeFileSync(join(outDir, "import_rows.json"), JSON.stringify(result.accepted, null, 1));
const batch = `curaduria_${month ?? today}`;
const tag = "$prive_rows$";
writeFileSync(join(outDir, "import_dry_run.sql"),
  `-- Ensayo (no aplica nada): correr SOLO contra una réplica local.\nSET request.jwt.claim.role = 'service_role';\nSELECT jsonb_pretty(public.prive_import_batch(${tag}${JSON.stringify(result.accepted)}${tag}::jsonb, '${batch}', true));\n`);

if (args.includes("--json")) {
  console.log(JSON.stringify(report.totals));
} else {
  console.log(`Archivos: ${files.map((x) => x.f).join(", ") || "(ninguno)"}`);
  for (const [f, v] of Object.entries(perFile)) console.log(`  ${f}: ${v.error ?? `${v.entries} entradas, ${byFile[f]?.accepted ?? 0} aceptadas, ${byFile[f]?.rejected ?? 0} rechazadas`}`);
  console.log(`Total: ${report.totals.entries} entradas · ${report.totals.accepted} aceptadas (${JSON.stringify(states)}) · ${report.totals.rejected} rechazadas · ${result.warnings.length} avisos`);
  console.log(`Cerradas por temporada: ${report.totals.seasonal_closed} · fichas con dominio de apuestas/secuestrado (enlace quitado): ${report.totals.gambling_or_hijacked_domain_notes}`);
  console.log(`Reporte: ${join(outDir, "report.json")}`);
}
