// Evidencia: genera el PDF del Nº 01 con las fotos REALES (descargadas de images.pexels.com) y lo guarda.
// Uso: npx vite-node scripts/edition/pdf-evidence.ts <salida.pdf> [es|en] [issue|flight]
import { readFileSync, writeFileSync } from "node:fs";
import { jsPDF } from "jspdf";
import { buildEditionPdf } from "@/lib/priveEditionPdf";
import { personalizeIssue, selectFlightEdition, DEFAULT_PREFS, type IssuePayload } from "@/lib/priveEdition";
import { payloadFromDoc } from "./payload.mjs";

const [out = "edition.pdf", lang = "es", kind = "issue"] = process.argv.slice(2);
const doc = JSON.parse(readFileSync("data/prive/edition/issue-01.json", "utf8"));
const payload = payloadFromDoc(doc) as IssuePayload;
const ed = personalizeIssue(payload, { ...DEFAULT_PREFS, reading_minutes: 120 });
const articles = kind === "flight"
  ? selectFlightEdition(payload, { destination: "cdmx", interests: ["formula_1", "gastronomia"], minutes: 15, includeGuide: true })
  : [...ed.sections.flatMap((s) => s.articles), ...ed.moreTime];
const t = Date.now();
const r = await buildEditionPdf({ payload, articles, lang: lang as "es" | "en", kind: kind as "issue" | "flight", destinationLabel: kind === "flight" ? (lang === "en" ? "Mexico City" : "Ciudad de México") : null,
  opportunities: [], opportunitiesAsOf: new Date().toISOString(), appOrigin: "https://app.iatos.mx" }, {
  jsPDF,
  loadImage: async (url) => { const res = await fetch(url); return res.ok ? new Uint8Array(await res.arrayBuffer()) : null; },
});
writeFileSync(out, r.bytes);
console.log(JSON.stringify({ out, pages: r.pages, images: r.imagesEmbedded, kb: Math.round(r.bytes.length / 1024), ms_total: Date.now() - t, ms_build: r.ms, articles: articles.length }));
