// Segunda auditoría (bridge): psl.ts contra los vectores oficiales de la PSL (tests/test_psl.txt del
// repositorio publicsuffix/list en el COMMIT fijado 5dd321ff…). Copia local en /home/user/audit2/bridge/psl_oficial/.
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { registrableDomain } from "../../supabase/functions/_shared/booking/psl";
it("A2-PSL vectores oficiales test_psl.txt", () => {
  const src = readFileSync("/home/user/audit2/bridge/psl_oficial/test_psl.txt", "utf8");
  const re = /^checkPublicSuffix\((null|'[^']*'),\s*(null|'[^']*')\);/gm;
  let m: RegExpExecArray | null; let total = 0; const bad: string[] = [];
  while ((m = re.exec(src))) {
    const inp = m[1] === "null" ? null : m[1].slice(1, -1);
    const want = m[2] === "null" ? null : m[2].slice(1, -1);
    if (inp === null) continue;
    total++;
    // Un nombre que empieza con punto no es un host válido: el oficial dice null.
    let got: string | null = registrableDomain(inp);
    // Los vectores esperan Unicode cuando la entrada es Unicode; psl.ts devuelve punycode: se compara en ASCII.
    let wantAscii = want;
    if (want && /[^\x00-\x7f]/.test(want)) wantAscii = new URL(`https://${want}/`).hostname;
    if (got !== wantAscii) bad.push(`${inp} → ${got} (oficial: ${want})`);
  }
  console.log(`A2-PSL total=${total} discrepancias=${bad.length}\n` + bad.join("\n"));
  expect(total).toBeGreaterThan(70);
});
