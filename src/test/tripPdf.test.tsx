// PDF del viaje (caso Roma → Florencia → Venecia, 22-oct-2026). El PDF que mandó el dueño tenía: "→"
// convertido en "!'" y letras espaciadas, "★ 4.8" como "& 4.8", el título encimado con las fechas,
// "VENECIA" como país, "MESA RESERVADA" sobre restaurantes sin reserva, la tarifa de Aviasales a
// Bucarest como vuelo a Roma, rentas de coche como "VUELO / LLEGADA", el primer hotel de la lista en vez
// del elegido, un total distinto al de la página, el resumen repetido como "tips" e "iatos.app" al pie.
//
// Con TRIP_PDF_OUT=<carpeta> (y opcionalmente TRIP_PDF_PHOTOS=<carpeta con credits.json>) la prueba de
// render escribe los PDF del caso para revisarlos a ojo.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { buildTripPdf, buildTripPdfModel, pageTotalsFor, titleWords, type PdfPhoto, type PhotoRequest } from "@/lib/tripPdf";
import { RealTripTotal, tripTotals } from "@/components/RealTripTotal";
import { computeTripDesglose } from "@/lib/quote";
import { cityHotelChoices } from "@/lib/cityHotels";
import { CASO_TRIP, AVIASALES_BUH } from "./fixtures/casoRomaFlorenciaVenecia";
import { CASO_TRIP_PDF, ANALISIS } from "./fixtures/casoRomaFlorenciaVeneciaPdf";
import { pdfLinkUrls, pdfPagesText } from "./helpers/pdfText";

const FONT_DIR = join(__dirname, "..", "..", "public", "fonts", "pdf");
const loadFont = async (f: string) => new Uint8Array(readFileSync(join(FONT_DIR, f)));
const NOW = new Date("2026-10-23T12:00:00-06:00");
const NO_SEL = { selVuelo: -1, selHospedaje: -1, selTours: new Set<number>(), selHoteles: {} };
// La selección con que el dueño generó su PDF: Hotel Eden en Roma (382,899 de hospedaje → $542,407).
const EDEN = CASO_TRIP.hospedaje_json.findIndex((h) => h.nombre === "Hotel Eden");
const SEL_EDEN = { ...NO_SEL, selHoteles: { Roma: EDEN } };

async function build(trip: any = CASO_TRIP_PDF, sel: any = NO_SEL, extra: Record<string, unknown> = {}, loadPhoto?: (r: PhotoRequest) => Promise<PdfPhoto | null>) {
  return buildTripPdf(trip, { sel, now: NOW, ...extra }, { jsPDF, loadFont, loadPhoto });
}

describe("PDF del viaje: caracteres", () => {
  it("→ ★ y acentos salen tal cual en el texto del PDF (fuentes TTF incrustadas)", async () => {
    const res = await build(CASO_TRIP_PDF, SEL_EDEN); // Hotel Eden: ★ 4.8 en el PDF real
    expect(res.fontsEmbedded).toBe(true);
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).toContain("Roma → Florencia → Venecia");
    expect(text).toMatch(/★ 4\.8/);
    expect(text).not.toContain("!'");
    expect(text).not.toMatch(/R o m a/);
    expect(text).not.toMatch(/& 4\.8/);
  });

  it("un texto con → ★ á é í ó ú ñ ü € ¿ ¡ — se extrae completo", async () => {
    const probe = "→ ★ á é í ó ú ñ ü € ¿ ¡ —";
    const trip = { ...CASO_TRIP_PDF, analisis_ai: `Prueba de caracteres: ${probe}` };
    const text = pdfPagesText((await build(trip)).bytes).join("\n");
    expect(text).toContain(probe);
  });

  it("sin fuentes (no cargaron) no hay caracteres rotos: se sustituyen por equivalentes Latin-1", async () => {
    const res = await buildTripPdf(CASO_TRIP_PDF, { sel: NO_SEL, now: NOW }, { jsPDF, loadFont: async () => null });
    expect(res.fontsEmbedded).toBe(false);
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).toContain("Roma -> Florencia -> Venecia");
    expect(text).not.toContain("!'");
  });
});

describe("PDF del viaje: portada", () => {
  it("país = Italia (tripCountryLabel), no 'Venecia'", async () => {
    const res = await build();
    expect(res.model.country).toBe("Italia");
    const cover = pdfPagesText(res.bytes)[0];
    expect(cover).toContain("ITALIA");
    expect(cover).not.toMatch(/^VENECIA$/m);
  });

  it("el título largo se parte antes de cada flecha (la flecha va con la ciudad)", () => {
    expect(titleWords("Roma → Florencia → Venecia")).toEqual(["Roma", "→ Florencia", "→ Venecia"]);
  });

  it("usa la foto del viaje (cover_image_url) o una ilustrativa con crédito", async () => {
    const jpeg = new Uint8Array(readFileSync(join(__dirname, "fixtures", "edition-photo.jpg")));
    const asked: PhotoRequest[] = [];
    // R4 P2-2: una foto de Google de un lugar ya no es la portada (va la ilustrativa del destino); una foto
    // del destino que no es de Google sí.
    const google = await build({ ...CASO_TRIP_PDF, cover_image_url: "https://lh3.googleusercontent.com/p/abc=w1600" }, NO_SEL, {}, async () => null);
    expect(google.model.coverImageUrl).toBeNull();
    const res = await build({ ...CASO_TRIP_PDF, cover_image_url: "https://images.pexels.com/photos/9/roma.jpeg" }, NO_SEL, {}, async (r) => {
      asked.push(r);
      return { bytes: jpeg, credit: r.kind === "cover" ? "Foto: Google" : "Foto ilustrativa: Ana / Pexels" };
    });
    expect(asked[0]).toMatchObject({ kind: "cover", url: "https://images.pexels.com/photos/9/roma.jpeg" });
    expect(asked.filter((a) => a.kind === "city").map((a) => a.city)).toEqual(["Roma", "Florencia", "Venecia"]);
    expect(res.photos).toBe(4);
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).toContain("Foto: Google");
    expect(text).toContain("Foto ilustrativa: Ana / Pexels");
  });
});

describe("PDF del viaje: datos", () => {
  it("el total es el de la página (RealTripTotal), 'Total para 2 personas' y por persona", async () => {
    const totals = pageTotalsFor(CASO_TRIP_PDF, NO_SEL);
    render(<RealTripTotal trip={CASO_TRIP_PDF} noches={10} viajeros={2} selectionDesglose={totals.desglose} />);
    const pageAmount = screen.getByTestId("trip-total-amount").textContent!;
    const pagePp = screen.getByTestId("trip-total-pp").textContent!;
    expect(pageAmount).toBe("$561,468 MXN");
    const text = pdfPagesText((await build()).bytes).join("\n");
    expect(text).toContain("TOTAL PARA 2 PERSONAS");
    expect(text).toContain(pageAmount);
    expect(text).toContain(pagePp.replace(" por persona", ""));
    expect(text).toContain("$280,734 MXN por persona");
  });

  it("con la selección del dueño (Hotel Eden en Roma) también coincide con la página", async () => {
    const desglose = computeTripDesglose(CASO_TRIP, { ...SEL_EDEN, nochesHospedaje: 10 }, 2);
    const page = tripTotals(CASO_TRIP_PDF, 2, desglose).total;
    const res = await build(CASO_TRIP_PDF, SEL_EDEN);
    expect(res.model.totals.total).toBe(page);
    expect(pdfPagesText(res.bytes).join("\n")).toContain(`$${page.toLocaleString("es-MX")} MXN`);
  });

  it("si la página pasa su total, el PDF usa exactamente ese", async () => {
    const totals = { total: 123456, porPersona: 61728, travelers: 2, nights: 10, desglose: { vuelos: 23456, hospedaje: 100000 }, fromSelection: true, quotedTotal: 561468 };
    const res = await build(CASO_TRIP_PDF, NO_SEL, { totals });
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).toContain("$123,456 MXN");
    expect(text).toContain("$61,728 MXN por persona");
  });

  it("restaurantes: 'Restaurantes recomendados', nunca 'MESA RESERVADA'", async () => {
    const text = pdfPagesText((await build()).bytes).join("\n");
    expect(text).toContain("RESTAURANTES RECOMENDADOS");
    expect(text).toMatch(/ninguna mesa está reservada/);
    expect(text).not.toMatch(/mesa reservada/i);
  });

  it("sin tarifas descartadas: nada de Y4 102, 65h, '2 escala(s)' ni el enlace a Bucarest", async () => {
    const res = await build();
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).not.toContain("Y4 102");
    expect(text).not.toMatch(/65h/);
    expect(text).not.toMatch(/escala\(s\)/);
    expect(text).not.toMatch(/Iberia|Aeroméxico/); // estimados de IA: no se presentan como vuelo
    expect(text).toContain("Vuelo · por cotizar");
    const urls = pdfLinkUrls(res.bytes);
    expect(urls.some((u) => u.includes("BUH") || u === AVIASALES_BUH)).toBe(false);
    // Google Flights open-jaw (MEX → FCO, regreso VCE → MEX) y Kayak.
    expect(urls.some((u) => u.startsWith("https://www.google.com/travel/flights"))).toBe(true);
    expect(urls.some((u) => /kayak\.com\.mx\/flights\/MEX-(FCO|ROM)\/2026-10-22\/VCE-MEX\/2026-11-01/.test(decodeURIComponent(u)))).toBe(true);
  });

  it("las rentas de coche no son vuelos: van como tramo en coche con km y horas del road trip", async () => {
    const res = await build();
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).not.toMatch(/VUELO \/ LLEGADA/i);
    expect(text).not.toContain("Hertz / Sixt Italia");
    const leg = res.model.cities[1].arrival!;
    expect(leg).toMatchObject({ from: "Roma", to: "Florencia", mode: "En coche", state: "estimado" });
    expect(leg.km).toBeGreaterThan(200);
    expect(text).toMatch(/En coche desde Roma · \d{3} km · \d h/);
    expect(text).toMatch(/En coche desde Florencia · \d{3} km · \d h/);
    expect(text).toContain("Antes de manejar");
    expect(text).toMatch(/ZTL/);
    expect(text).toMatch(/permiso internacional/);
  });

  it("hotel elegido por ciudad (cityHotelChoices), con sus noches y total", async () => {
    const res = await build(CASO_TRIP_PDF, SEL_EDEN);
    const choices = cityHotelChoices(CASO_TRIP_PDF, SEL_EDEN);
    expect(res.model.cities.map((c) => c.hotel?.name)).toEqual(choices.map((c) => c.hotel?.nombre));
    expect(res.model.cities.map((c) => c.hotel?.name)).toEqual(["Hotel Eden", "Four Seasons Firenze", "Aman Venice"]);
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).toContain(`$${choices[0].total!.toLocaleString("es-MX")} MXN`);
    expect(text).toMatch(/4 noches · \$28,029 MXN por noche/);
    expect(text).not.toContain("Poggio Baronti");
    expect(text).not.toContain("Mosella");
  });

  it("dominio traveliatos.life (constante del sitio), nunca iatos.app", async () => {
    const res = await build();
    const text = pdfPagesText(res.bytes).join("\n");
    expect(res.model.domain).toBe("traveliatos.life");
    expect(text).toContain("traveliatos.life");
    expect(text).not.toContain("iatos.app");
    expect(pdfLinkUrls(res.bytes)).toContain("https://traveliatos.life");
  });

  it("los tips que repiten el resumen no se imprimen", async () => {
    const res = await build();
    expect(res.model.tips).toEqual([]);
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).not.toContain("Tips de tu concierge");
    expect(text.split("Itinerario exclusivo y romántico").length - 1).toBe(1);
    const withTips = await build({ ...CASO_TRIP_PDF, tips_personalizados: [ANALISIS, "Reserva la Galería Borghese con 2 semanas de anticipación."] });
    expect(withTips.model.tips).toEqual(["Reserva la Galería Borghese con 2 semanas de anticipación."]);
  });

  it("cada compra lleva su enlace clicable y su estado (pendiente / ya lo compré)", async () => {
    const plain = await build();
    const hotelKey = plain.model.buy.find((b) => b.group === "Hotel en Roma")!.key;
    const marks = new Map([[hotelKey, { key: hotelKey, id: "m1", markedBy: "owner-1", name: null, at: "2026-10-22T18:00:00Z", source: "grupo" as const }]]);
    const res = await build(CASO_TRIP_PDF, NO_SEL, { marks, userId: "owner-1" });
    const text = pdfPagesText(res.bytes).join("\n");
    expect(text).toContain("Ya lo compré · tú · 22 oct");
    expect(text).toMatch(/Pendiente/);
    expect(text).toContain("1 de 4 comprados");
    const urls = pdfLinkUrls(res.bytes);
    expect(urls.filter((u) => u.includes("booking.com")).length).toBeGreaterThanOrEqual(3);
    expect(urls.some((u) => u.includes("kayak.com") && u.includes("cars"))).toBe(true);
  });

  it("estado de cada precio como en la app (referencia / estimado / en vivo)", () => {
    const m = buildTripPdfModel(CASO_TRIP_PDF, { sel: NO_SEL, now: NOW });
    const hotel = m.buy.find((b) => b.group === "Hotel en Roma")!;
    expect(hotel.provenance).toBeTruthy();
    expect(m.route.drivingState).toBe("estimado");
  });
});

describe("PDF del viaje: otros viajes", () => {
  it("un destino, sin road trip ni fotos: se arma con portada sin foto, hotel, itinerario y sin 'Antes de manejar'", async () => {
    const trip = {
      id: "t-cun", user_id: "u1", destino: "Cancún", pais_destino: "México", ciudad_origen: "Ciudad de México", fecha_salida: "2026-12-12", fecha_regreso: "2026-12-16",
      num_viajeros: 2, total_estimado: 40000, desglose_presupuesto: { vuelos: 10000, hospedaje: 24000, comida: 6000 }, created_at: "2026-10-22T15:00:00Z",
      vuelos_json: [{ aerolinea: "Viva Aerobus", precio_por_persona: 5000, fuente_precio: "estimado", from: "Ciudad de México", to: "Cancún", escalas: "Directo", duracion: "2h 20m" }],
      hospedaje_json: [{ nombre: "Hotel Mar Caribe", precio_por_noche: 6000, fuente_precio: "estimado", rating: 4.5 }],
      restaurantes_json: [{ nombre: "La Habichuela", cocina: "Caribeña", rango_precio: "$$$" }],
      itinerario_json: [{ dia: 1, titulo: "Llegada", "mañana": "Vuelo a Cancún.", tarde: "Playa.", noche: "Cena." }],
      tips_personalizados: ["Lleva bloqueador biodegradable para los cenotes."],
    };
    const res = await build(trip, NO_SEL);
    const text = pdfPagesText(res.bytes).join("\n");
    expect(res.photos).toBe(0);
    expect(text).toContain("Cancún");
    expect(text).toContain("MÉXICO");
    expect(text).toContain("Hotel Mar Caribe");
    expect(text).toContain("RESTAURANTES RECOMENDADOS");
    expect(text).toContain("Tips de tu concierge");
    expect(text).toContain("Lleva bloqueador biodegradable");
    expect(text).not.toContain("Antes de manejar");
    expect(text).not.toMatch(/Viva Aerobus · Directo/); // estimado de IA: "Aerolínea por confirmar"
  });
});

describe("PDF del viaje: render del caso", () => {
  it("se arma sin errores en oscuro y en blanco", async () => {
    const out = process.env.TRIP_PDF_OUT;
    const photosDir = process.env.TRIP_PDF_PHOTOS;
    let loadPhoto: ((r: PhotoRequest) => Promise<PdfPhoto | null>) | undefined;
    if (photosDir && existsSync(join(photosDir, "credits.json"))) {
      const credits = JSON.parse(readFileSync(join(photosDir, "credits.json"), "utf8"));
      loadPhoto = async (r) => {
        const c = r.kind === "cover" ? credits.cover : credits[r.city ?? ""];
        return c ? { bytes: new Uint8Array(readFileSync(join(photosDir, c.file))), credit: c.credit } : null;
      };
    }
    for (const theme of ["dark", "light"] as const) {
      const res = await build(CASO_TRIP_PDF, NO_SEL, { theme }, loadPhoto);
      expect(res.pages).toBeGreaterThan(5);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, theme === "dark" ? "IATOS-roma-florencia-venecia-NUEVO.pdf" : "IATOS-roma-florencia-venecia-NUEVO-imprimir.pdf"), res.bytes);
      }
    }
  });
});
