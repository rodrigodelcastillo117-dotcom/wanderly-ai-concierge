#!/usr/bin/env node
// Regenera la copia fijada de la Public Suffix List (AUD-07): supabase/functions/_shared/booking/psl_data.ts.
//
// Uso:
//   node scripts/booking/update_psl.mjs                      # descarga https://publicsuffix.org/list/public_suffix_list.dat
//   node scripts/booking/update_psl.mjs ruta/a/public_suffix_list.dat
//
// La app NUNCA descarga la lista en tiempo de ejecución: este script se corre a mano (p. ej. cada
// trimestre o cuando un proveedor nuevo use un sufijo nuevo), se revisa el diff y se hace commit. El
// archivo generado guarda la fuente, VERSION, COMMIT y el sha256 del .dat original para poder
// auditarlo. Licencia de la lista: Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/).
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { domainToASCII } from "node:url";

const SOURCE = "https://publicsuffix.org/list/public_suffix_list.dat";
const OUT = new URL("../../supabase/functions/_shared/booking/psl_data.ts", import.meta.url);

const arg = process.argv[2];
const raw = arg ? readFileSync(arg, "utf8") : await (await fetch(SOURCE)).text();
const version = /\/\/ VERSION: (\S+)/.exec(raw)?.[1];
const commit = /\/\/ COMMIT: ([0-9a-f]{40})/.exec(raw)?.[1];
if (!version || !commit || !raw.includes("===BEGIN ICANN DOMAINS===")) throw new Error("No parece la PSL oficial (faltan VERSION/COMMIT/secciones).");
const sha256 = createHash("sha256").update(raw).digest("hex");

const icann = [];
const priv = [];
let section = null;
for (const line of raw.split("\n")) {
  if (line.includes("===BEGIN ICANN DOMAINS===")) section = icann;
  else if (line.includes("===BEGIN PRIVATE DOMAINS===")) section = priv;
  const rule = line.trim().split(/\s/)[0];
  if (!section || !rule || rule.startsWith("//")) continue;
  const bang = rule.startsWith("!") ? "!" : "";
  const star = rule.startsWith("*.") ? "*." : "";
  const body = rule.slice(bang.length + star.length);
  const ascii = domainToASCII(body);
  if (!ascii || ascii !== ascii.toLowerCase() || /[^a-z0-9.-]/.test(ascii)) throw new Error(`Regla inválida: ${rule}`);
  section.push(bang + star + ascii);
}
if (icann.length < 5000 || priv.length < 1000) throw new Error(`Lista demasiado corta (${icann.length} ICANN, ${priv.length} privadas).`);

const out = `// GENERADO por scripts/booking/update_psl.mjs — no editar a mano.
//
// Copia fijada de la Public Suffix List (Mozilla, https://publicsuffix.org) para calcular el dominio
// registrable sin ir a la red en tiempo de ejecución (AUD-07, docs/iatos/cierre/BRIDGE.md).
//   Fuente:  ${SOURCE}
//   VERSION: ${version}
//   COMMIT: ${commit}
//   SHA256: ${sha256}
//   Reglas: ${icann.length} ICANN + ${priv.length} privadas (IDN convertidas a punycode).
// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.

export const PSL_META = { source: ${JSON.stringify(SOURCE)}, version: ${JSON.stringify(version)}, commit: ${JSON.stringify(commit)}, sha256: ${JSON.stringify(sha256)} } as const;

/** Reglas ICANN separadas por coma ("!" = excepción, "*." = comodín). */
export const PSL_ICANN = ${JSON.stringify(icann.join(","))};

/** Reglas de la sección privada (hostings como github.io, wixsite.com, blogspot.com). */
export const PSL_PRIVATE = ${JSON.stringify(priv.join(","))};
`;
writeFileSync(OUT, out);
console.log(`psl_data.ts: VERSION ${version}, COMMIT ${commit}, ${icann.length} ICANN + ${priv.length} privadas, ${out.length} bytes`);
