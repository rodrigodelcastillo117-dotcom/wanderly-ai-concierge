// THE PRIVATE EDITION · PDF (especificación §9.A y §14: descarga PDF, PDF multipágina, imágenes en PDF).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { buildEditionPdf, pdfSafe } from "@/lib/priveEditionPdf";
import { personalizeIssue, selectFlightEdition, DEFAULT_PREFS, type IssuePayload } from "@/lib/priveEdition";
import { payloadFromDoc } from "../../scripts/edition/payload.mjs";

const root = join(__dirname, "..", "..");
const doc = JSON.parse(readFileSync(join(root, "data/prive/edition/issue-01.json"), "utf8"));
const photo = new Uint8Array(readFileSync(join(root, "src/test/fixtures/edition-photo.jpg")));
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");
const countImages = (b: Uint8Array) => (latin1(b).match(/\/Subtype \/Image/g) ?? []).length;
const countPages = (b: Uint8Array) => (latin1(b).match(/\/Type \/Page[^s]/g) ?? []).length;

const payload = payloadFromDoc(doc) as IssuePayload;
const loaded: string[] = [];
const loadImage = async (url: string) => { loaded.push(url); return photo; };

describe("PDF de la edición", () => {
  it("genera un PDF multipágina con portada, índice, artículos, imágenes incrustadas, créditos y fecha de generación", async () => {
    const ed = personalizeIssue(payload, { ...DEFAULT_PREFS, reading_minutes: 120 });
    const articles = [...ed.sections.flatMap((s) => s.articles), ...ed.moreTime];
    const r = await buildEditionPdf({ payload, articles, lang: "es", kind: "issue", now: new Date("2026-11-01T18:00:00Z") }, { jsPDF, loadImage });
    expect(latin1(r.bytes).startsWith("%PDF-")).toBe(true);
    expect(r.pages).toBeGreaterThanOrEqual(articles.length + 3); // portada + índice + 1 por pieza + créditos
    expect(countPages(r.bytes)).toBe(r.pages);
    expect(r.imagesEmbedded).toBeGreaterThanOrEqual(9);
    expect(countImages(r.bytes)).toBeGreaterThanOrEqual(1);
    expect(r.filename).toBe("the-private-edition-01-es.pdf");
    // Créditos (Pexels + autor) y fecha de generación dentro del PDF (texto sin comprimir en los objetos de contenido no es
    // garantizado con compress=true, así que se revisa con un PDF sin comprimir abajo).
  });

  it("el texto incluye fuentes, créditos de foto con licencia y la fecha de generación", async () => {
    // Sin compresión para poder leer el texto.
    class Plain extends jsPDF { constructor(o: Record<string, unknown>) { super({ ...o, compress: false }); } }
    const articles = payload.articles!.filter((a) => a.slug === "monaco-yacht-show-2026");
    const r = await buildEditionPdf({ payload, articles, lang: "es", kind: "issue", now: new Date("2026-11-01T18:00:00Z") },
      { jsPDF: Plain as unknown as typeof jsPDF, loadImage });
    const s = latin1(r.bytes);
    expect(s).toContain("THE PRIVATE EDITION");
    expect(s).toContain("Port Hercule");
    expect(s).toContain("YachtBuyer");                       // fuente
    expect(s).toContain("https://www.monacoyachtshow.com/en/");
    expect(s).toMatch(/Foto: Reece t \/ Pexels/);            // crédito de foto
    expect(s).toContain("Pexels License");
    expect(s).toMatch(/Generada el 1 de noviembre de 2026/);
    expect(s).toContain("Foto ilustrativa");                 // el yate ilustrativo se rotula
  });

  it("una imagen sin licencia aprobada, sin permiso de PDF o que no carga NO se incrusta (y no deja hueco)", async () => {
    const p = payloadFromDoc(doc, { approvedImages: ["img_monaco_puerto"] }) as IssuePayload;
    p.images!.img_monaco_puerto = { ...p.images!.img_monaco_puerto, allow_pdf: false };
    const articles = p.articles!.filter((a) => a.slug === "monaco-yacht-show-2026");
    loaded.length = 0;
    const r = await buildEditionPdf({ payload: p, articles, lang: "es", kind: "issue" }, { jsPDF, loadImage });
    expect(r.imagesEmbedded).toBe(0);
    expect(loaded).toHaveLength(0);
    const broken = await buildEditionPdf({ payload, articles, lang: "es", kind: "issue" }, { jsPDF, loadImage: async () => null });
    expect(broken.imagesEmbedded).toBe(0);
    expect(broken.pages).toBeGreaterThanOrEqual(4);
  });

  it("Flight Edition en inglés: portada con destino, selección según tiempo y textos traducidos", async () => {
    const articles = selectFlightEdition(payload, { destination: "cdmx", interests: ["formula_1"], minutes: 12, includeGuide: true });
    expect(articles.some((a) => a.slug === "cdmx-fin-de-semana-gran-premio")).toBe(true);
    class Plain extends jsPDF { constructor(o: Record<string, unknown>) { super({ ...o, compress: false }); } }
    const r = await buildEditionPdf({ payload, articles, lang: "en", kind: "flight", destinationLabel: "Mexico City", opportunities: [], now: new Date("2026-10-29T15:00:00Z") },
      { jsPDF: Plain as unknown as typeof jsPDF, loadImage });
    const s = latin1(r.bytes);
    expect(s).toContain("FLIGHT EDITION");
    expect(s).toContain("The city accelerates");
    expect(s).toContain("Generated on");
    expect(s).toContain("We prefer zero to an invented one"); // oportunidades: cero honesto, con fecha
    expect(r.filename).toBe("the-private-edition-01-flight-en.pdf");
  });

  it("pdfSafe deja solo Latin-1 (las fuentes estándar del PDF no tienen el signo menos ni la raya)", () => {
    expect(pdfSafe("−29 — «cita» “x” … €6 → ok")).toBe("-29 - «cita» \"x\" ... EUR6 -> ok");
  });
});
