// Capturas de las muestras de correo con Chromium (Playwright), sin salir a internet:
//   * "con recursos": las fotos de muestra y la fuente de Google se sirven desde una carpeta local
//     (EMAIL_ASSETS_DIR) interceptando sus URLs reales.
//   * "sin recursos": se bloquea toda petición externa (como un cliente con imágenes bloqueadas).
// Uso: PW_REQUIRE_FROM=<carpeta con playwright-core> EMAIL_ASSETS_DIR=<carpeta> node scripts/emails/screenshot.mjs [prefijo]
import { createRequire } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(process.env.PW_REQUIRE_FROM ?? import.meta.url);
const { chromium } = require("playwright-core");
const DIR = resolve("docs/iatos/evidencia/emails");
const ASSETS = process.env.EMAIL_ASSETS_DIR ?? "";
const only = process.argv[2] ?? "";

const LOCAL = {
  "upload.wikimedia.org": (u) => {
    const map = {
      "Minato_City": "tokyo.jpg", "Tokyo_Tower": "tokyotower.jpg", "Sagrada_Familia": "barcelona.jpg", "Amantaka": "hotel.jpg",
    };
    const k = Object.keys(map).find((x) => u.includes(x));
    return k ? { path: join(ASSETS, map[k]), type: "image/jpeg" } : null;
  },
  "fonts.googleapis.com": () => ({ body: readFileSync(join(ASSETS, "fonts.css"), "utf8"), type: "text/css" }),
  "fonts.gstatic.com": (u) => ({ path: join(ASSETS, u.split("/").pop()), type: "font/woff2" }),
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--headless=new"] });
const variants = [
  { tag: "escritorio-600", width: 680, external: true },
  { tag: "movil-390", width: 390, external: true },
  { tag: "movil-390-sin-recursos-externos", width: 390, external: false },
];
const files = readdirSync(DIR).filter((f) => f.endsWith(".html") && f.startsWith(only) && !f.startsWith("antes-"));
for (const f of files) {
  for (const v of variants) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("file:")) return route.continue();
      if (!v.external) return route.abort();
      const host = new URL(url).hostname;
      const hit = LOCAL[host]?.(url);
      if (hit?.path && existsSync(hit.path)) return route.fulfill({ status: 200, contentType: hit.type, body: readFileSync(hit.path) });
      if (hit?.body) return route.fulfill({ status: 200, contentType: hit.type, body: hit.body });
      return route.abort();
    });
    await page.goto(pathToFileURL(join(DIR, f)).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(150);
    const out = join(DIR, `${f.replace(/\.html$/, "")}--${v.tag}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(out.replace(process.cwd() + "/", ""));
    await ctx.close();
  }
}
await browser.close();
