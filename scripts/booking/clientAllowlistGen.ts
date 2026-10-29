// Genera src/lib/bookingAllowlist.data.ts: la lista blanca del navegador (ronda 2 de la auditoría técnica,
// P2-5). Antes el paquete público cargaba supabase/functions/_shared/booking/allowlist.ts entero: 169 KB
// con la justificación interna de cada dominio ("why") y la Public Suffix List completa.
//
// El navegador recibe:
//  * los MISMOS proveedores (dominio, rutas, hosts, tipo de redirect…) en el mismo orden, sin `why`;
//  * una lista de sufijos reducida: todos los TLD de la sección ICANN, los sufijos de segundo nivel con
//    etiquetas genéricas (com.mx, co.uk, gob.mx, gov.it…) y los sufijos privados de alojamiento más usados
//    (github.io, netlify.app, wixsite.com…). Sirve para pintar botones; booking-bridge y booking-go vuelven a
//    revisar con la lista completa antes de guardar o redirigir.
//
// Uso (después de cambiar PROVIDERS en allowlist.ts o de regenerar psl_data.ts):
//   npx tsx scripts/booking/clientAllowlistGen.ts
// src/test/pulidoR2.test.tsx falla si el archivo generado no coincide con la lista del servidor.
import type { ProviderInfo } from "../../supabase/functions/_shared/booking/allowlist.ts";

export const CLIENT_ALLOWLIST_DATA_PATH = "src/lib/bookingAllowlist.data.ts";

/** Sufijos privados (sección PRIVATE de la PSL) de plataformas donde cualquiera publica un sitio. */
export const PRIVATE_HOSTING_SUFFIXES = [
  "blogspot.com", "github.io", "gitlab.io", "bitbucket.io", "wixsite.com", "netlify.app", "vercel.app", "herokuapp.com", "web.app",
  "firebaseapp.com", "pages.dev", "workers.dev", "r2.dev", "azurewebsites.net", "azurestaticapps.net", "cloudapp.net", "cloudfront.net",
  "appspot.com", "elasticbeanstalk.com", "amplifyapp.com", "s3.amazonaws.com", "ngrok.io", "ngrok-free.app", "webflow.io", "myshopify.com",
  "carrd.co", "framer.app", "framer.website", "notion.site", "my.canva.site", "onrender.com", "fly.dev", "replit.app", "repl.co", "surge.sh",
  "deno.dev", "ondigitalocean.app", "up.railway.app", "pythonanywhere.com", "readthedocs.io", "typedream.app", "translate.goog",
  "duckdns.org", "no-ip.org", "ddns.net", "hopto.org", "zapto.org", "sytes.net", "myftp.biz", "freeddns.org", "dynv6.net", "rhcloud.com",
  // Sufijos con nombre de marca: sin ellos, "places.googleapis.com" parecería imitar a Google.
  "googleapis.com", "googlecode.com", "withgoogle.com", "withyoutube.com",
];

/**
 * Sufijos de segundo nivel que se incluyen: los de etiqueta "genérica" (aparece bajo al menos 4 TLD
 * distintos: com, gob, co, ac, org…) y los de etiqueta corta (≤ 3 letras: "res.in"), que de otro modo se
 * confundirían con una marca corta en el detector de dominios falsos.
 */
const GENERIC_MIN_TLDS = 4;
const SHORT_SLD = 3;

export function buildClientAllowlistSource(providers: readonly ProviderInfo[], pslIcann: string, pslPrivate: string): string {
  const rules = pslIcann.split(",").filter(Boolean);
  const tlds = new Set<string>();
  for (const r of rules) {
    if (r.startsWith("!")) continue;
    const plain = r.startsWith("*.") ? r.slice(2) : r;
    if (!plain.includes(".")) tlds.add(plain);
  }
  const second = rules.filter((r) => !/^[!*]/.test(r) && r.split(".").length === 2);
  const seen = new Map<string, number>();
  for (const r of second) seen.set(r.split(".")[0], (seen.get(r.split(".")[0]) ?? 0) + 1);
  const byTld = new Map<string, string[]>();
  for (const r of second) {
    const [sld, tld] = r.split(".");
    if ((seen.get(sld) ?? 0) < GENERIC_MIN_TLDS && sld.length > SHORT_SLD) continue;
    byTld.set(tld, [...(byTld.get(tld) ?? []), sld]);
  }
  const priv = new Set(pslPrivate.split(","));
  const missing = PRIVATE_HOSTING_SUFFIXES.filter((s) => !priv.has(s));
  if (missing.length) throw new Error(`No están en la sección privada de la PSL: ${missing.join(", ")}`);

  const lit = (v: unknown) => JSON.stringify(v);
  const row = (p: ProviderInfo) => {
    const parts = [`domain: ${lit(p.domain)}`, `provider: ${lit(p.provider)}`, `label: ${lit(p.label)}`, `kind: ${lit(p.kind)}`];
    if (p.paths) parts.push(`paths: ${p.paths.toString()}`);
    if (p.redirector) parts.push(`redirector: ${lit(p.redirector)}`);
    if (p.hosts) parts.push(`hosts: ${lit(p.hosts)}`);
    if (p.serverOnly) parts.push("serverOnly: true");
    if (p.noBrand) parts.push("noBrand: true");
    return `  { ${parts.join(", ")} },`;
  };
  return [
    "// GENERADO por scripts/booking/clientAllowlistGen.ts desde supabase/functions/_shared/booking/allowlist.ts y",
    "// psl_data.ts. No se edita a mano: después de cambiar la lista del servidor, corre",
    "//   npx tsx scripts/booking/clientAllowlistGen.ts",
    "// (src/test/pulidoR2.test.tsx falla si no coincide). Sin la justificación interna de cada dominio.",
    'import type { ProviderRule } from "../../supabase/functions/_shared/booking/allowlistCore.ts";',
    "",
    "/** Proveedores permitidos (mismo orden y reglas que el servidor). */",
    "export const CLIENT_PROVIDERS: ProviderRule[] = [",
    ...providers.map(row),
    "];",
    "",
    "/** TLD de la sección ICANN de la Public Suffix List. */",
    `export const PSL_LITE_TLDS = ${lit([...tlds].join(","))};`,
    "",
    "/** Sufijos de segundo nivel con etiqueta genérica o corta, agrupados por TLD (\"mx:com|gob|org,…\"). */",
    `export const PSL_LITE_SECOND_LEVEL = ${lit([...byTld.entries()].map(([t, s]) => `${t}:${s.join("|")}`).join(","))};`,
    "",
    "/** Sufijos privados de plataformas de alojamiento (cada sitio es de un dueño distinto). */",
    `export const PSL_LITE_PRIVATE = ${lit(PRIVATE_HOSTING_SUFFIXES.join(","))};`,
    "",
  ].join("\n");
}

// CLI: npx tsx scripts/booking/clientAllowlistGen.ts
const isMain = typeof process !== "undefined" && Array.isArray(process.argv) && /clientAllowlistGen\.ts$/.test(process.argv[1] ?? "");
if (isMain) {
  const { PROVIDERS } = await import("../../supabase/functions/_shared/booking/allowlist.ts");
  const { PSL_ICANN, PSL_PRIVATE } = await import("../../supabase/functions/_shared/booking/psl_data.ts");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(CLIENT_ALLOWLIST_DATA_PATH, buildClientAllowlistSource(PROVIDERS, PSL_ICANN, PSL_PRIVATE));
  console.log(`Escrito ${CLIENT_ALLOWLIST_DATA_PATH} (${PROVIDERS.length} proveedores).`);
}
