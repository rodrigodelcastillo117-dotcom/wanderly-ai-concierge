import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Palette (matches index.css tokens)
const GOLD: [number, number, number] = [201, 169, 97];      // #C9A961
const GOLD_GLOW: [number, number, number] = [220, 188, 130];
const CARBON: [number, number, number] = [10, 10, 10];      // #0A0A0A
const CREAM: [number, number, number] = [245, 241, 234];    // #F5F1EA
const MUTED: [number, number, number] = [150, 145, 135];
const SURFACE: [number, number, number] = [22, 22, 22];

const fmtMXN = (n: number) =>
  `$${Math.round(Number(n) || 0).toLocaleString("es-MX")} MXN`;

type Selection = {
  selVuelo: number;
  selHospedaje: number;
  nochesEfectivas: number;
  selTours: Set<number>;
};

export async function generateTripPDF(trip: any, sel: Selection, computed: { desglose: Record<string, number>; total: number }) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const margin = 48;

  // ---------- COVER ----------
  doc.setFillColor(...CARBON);
  doc.rect(0, 0, W, H, "F");

  // Gold radial-ish accent using overlapping circles
  for (let i = 0; i < 6; i++) {
    doc.setFillColor(GOLD[0], GOLD[1], GOLD[2]);
    (doc as any).setGState?.(new (doc as any).GState({ opacity: 0.04 - i * 0.005 }));
    doc.circle(W / 2, 80, 220 - i * 28, "F");
  }
  (doc as any).setGState?.(new (doc as any).GState({ opacity: 1 }));

  // Brand
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("IATOS · TU CONCIERGE DE VIAJES", margin, margin + 4);

  // Hairline
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(margin, margin + 16, margin + 60, margin + 16);

  // Country label
  doc.setTextColor(GOLD_GLOW[0], GOLD_GLOW[1], GOLD_GLOW[2]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text((trip.pais_destino ?? "").toUpperCase(), margin, H / 2 - 80);

  // Destination title
  doc.setTextColor(...CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(48);
  const titleLines = doc.splitTextToSize(String(trip.destino ?? "Tu viaje"), W - margin * 2);
  doc.text(titleLines, margin, H / 2 - 30);

  // Meta line
  const fechaSalida = trip.fecha_salida ? new Date(trip.fecha_salida).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "";
  const fechaRegreso = trip.fecha_regreso ? new Date(trip.fecha_regreso).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }) : "";
  doc.setTextColor(...CREAM);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  const metaY = H / 2 + 20;
  doc.text(`${fechaSalida} — ${fechaRegreso}`, margin, metaY);
  doc.text(`${trip.num_viajeros ?? 1} ${(trip.num_viajeros ?? 1) === 1 ? "viajero" : "viajeros"}  ·  Desde ${trip.ciudad_origen ?? ""}`, margin, metaY + 16);

  // Total card
  const cardY = H - 200;
  doc.setFillColor(...SURFACE);
  doc.roundedRect(margin, cardY, W - margin * 2, 110, 12, 12, "F");
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, cardY, W - margin * 2, 110, 12, 12, "S");

  doc.setTextColor(...GOLD);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("INVERSIÓN TOTAL ESTIMADA", margin + 20, cardY + 26);

  doc.setTextColor(...CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(34);
  doc.text(fmtMXN(computed.total), margin + 20, cardY + 68);

  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Cotización generada por IATOS AI · sujeta a disponibilidad real al momento de reservar.", margin + 20, cardY + 92);

  // Footer
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.setFontSize(8);
  doc.text(`Generado el ${new Date().toLocaleDateString("es-MX")}`, margin, H - 32);
  doc.setTextColor(...GOLD);
  doc.text("iatos.app", W - margin, H - 32, { align: "right" });

  // ---------- CONTENT PAGES ----------
  doc.addPage();
  let cursor = drawSectionHeader(doc, margin, margin, "Resumen del viaje");

  // Analysis paragraph
  if (trip.analisis_ai) {
    cursor = ensureSpace(doc, cursor, 80, margin);
    doc.setTextColor(...CREAM);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(String(trip.analisis_ai), W - margin * 2);
    doc.text(lines, margin, cursor);
    cursor += lines.length * 13 + 18;
  }

  // Budget breakdown
  cursor = ensureSpace(doc, cursor, 100, margin);
  cursor = drawSectionHeader(doc, margin, cursor, "Desglose de presupuesto");
  const desgloseRows = Object.entries(computed.desglose)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => [labelFor(k), fmtMXN(Number(v))]);
  desgloseRows.push(["Total", fmtMXN(computed.total)]);

  autoTable(doc, {
    startY: cursor,
    margin: { left: margin, right: margin },
    head: [["Concepto", "Monto"]],
    body: desgloseRows,
    theme: "plain",
    styles: { font: "helvetica", fontSize: 10, textColor: CREAM, cellPadding: 8 },
    headStyles: { fillColor: SURFACE, textColor: GOLD, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [18, 18, 18] },
    columnStyles: { 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.row.index === desgloseRows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = GOLD;
      }
    },
  });
  cursor = (doc as any).lastAutoTable.finalY + 26;

  // Build per-city sections
  const itinObj = trip?.itinerario_json;
  const isMulti = !!(itinObj && !Array.isArray(itinObj) && itinObj.multi);
  const itinDays: any[] = Array.isArray(itinObj) ? itinObj : Array.isArray(itinObj?.days) ? itinObj.days : [];
  const destinations: string[] = isMulti ? itinObj.destinations ?? [] : [trip.destino];

  for (const city of destinations) {
    cursor = ensureSpace(doc, cursor, 140, margin);
    cursor = drawSectionHeader(doc, margin, cursor, city);

    // Vuelo seleccionado
    const cityVuelos = isMulti
      ? (trip.vuelos_json ?? []).filter((v: any) => (v.ciudad || v.to) === city)
      : (trip.vuelos_json ?? []);
    const selectedVuelo = sel.selVuelo >= 0 ? trip.vuelos_json?.[sel.selVuelo] : null;
    const vueloForCity = selectedVuelo && cityVuelos.includes(selectedVuelo) ? selectedVuelo : cityVuelos[0];
    if (vueloForCity) {
      cursor = drawSubHeader(doc, margin, cursor, "Vuelo / Llegada");
      cursor = drawKV(doc, margin, cursor, vueloForCity.aerolinea ?? vueloForCity.provider ?? "—", `${vueloForCity.duracion ?? ""} ${vueloForCity.escalas ? "· " + vueloForCity.escalas : ""}`.trim(), vueloForCity.precio_por_persona ? `${fmtMXN(vueloForCity.precio_por_persona)} / persona` : "");
    }

    // Hospedaje seleccionado
    const cityHosp = isMulti
      ? (trip.hospedaje_json ?? []).filter((h: any) => h.ciudad === city)
      : (trip.hospedaje_json ?? []);
    const selectedHotel = sel.selHospedaje >= 0 ? trip.hospedaje_json?.[sel.selHospedaje] : null;
    const hotelForCity = selectedHotel && cityHosp.includes(selectedHotel) ? selectedHotel : cityHosp[0];
    if (hotelForCity) {
      cursor = drawSubHeader(doc, margin, cursor, "Hospedaje");
      cursor = drawKV(doc, margin, cursor, hotelForCity.nombre ?? "—", `${hotelForCity.barrio ?? ""}${hotelForCity.rating ? " · ★ " + hotelForCity.rating : ""}`, hotelForCity.precio_por_noche ? `${fmtMXN(hotelForCity.precio_por_noche)} / noche` : "");
    }

    // Itinerario
    const cityDays = isMulti ? itinDays.filter((d: any) => d.ciudad === city) : itinDays;
    if (cityDays.length) {
      cursor = drawSubHeader(doc, margin, cursor, "Itinerario día por día");
      for (const d of cityDays) {
        const text = `Día ${d.dia} — ${d.titulo ?? ""}`;
        const morning = d["mañana"] ?? d.manana ?? "";
        const para = `• Mañana: ${morning}\n• Tarde: ${d.tarde ?? ""}\n• Noche: ${d.noche ?? ""}`;
        cursor = ensureSpace(doc, cursor, 70, margin);
        doc.setTextColor(...GOLD);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        doc.text(text, margin, cursor);
        cursor += 14;
        doc.setTextColor(...CREAM);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        const lines = doc.splitTextToSize(para, W - margin * 2);
        doc.text(lines, margin, cursor);
        cursor += lines.length * 12 + 8;
      }
    }

    // Experiencias seleccionadas
    const cityTours = isMulti ? (trip.tours_json ?? []).filter((t: any) => t.ciudad === city) : (trip.tours_json ?? []);
    const toursElegidos = cityTours.filter((t: any) => {
      const i = (trip.tours_json ?? []).indexOf(t);
      return sel.selTours.has(i);
    });
    if (toursElegidos.length) {
      cursor = drawSubHeader(doc, margin, cursor, "Experiencias seleccionadas");
      for (const t of toursElegidos) {
        cursor = drawKV(doc, margin, cursor, t.nombre ?? "—", t.duracion ?? "", t.precio_por_persona ? `${fmtMXN(t.precio_por_persona)} / persona` : "");
      }
    }

    // Mesa reservada
    const cityRest = isMulti ? (trip.restaurantes_json ?? []).filter((r: any) => r.ciudad === city) : (trip.restaurantes_json ?? []);
    if (cityRest.length) {
      cursor = drawSubHeader(doc, margin, cursor, "Mesa reservada");
      for (const r of cityRest.slice(0, 6)) {
        cursor = drawKV(doc, margin, cursor, r.nombre ?? "—", r.cocina ?? "", r.rango_precio ?? "");
      }
    }

    cursor += 8;
  }

  // Tips
  if (Array.isArray(trip.tips_personalizados) && trip.tips_personalizados.length) {
    cursor = ensureSpace(doc, cursor, 80, margin);
    cursor = drawSectionHeader(doc, margin, cursor, "Tips de tu concierge");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...CREAM);
    trip.tips_personalizados.forEach((tip: string, idx: number) => {
      cursor = ensureSpace(doc, cursor, 30, margin);
      const lines = doc.splitTextToSize(`${String(idx + 1).padStart(2, "0")}.  ${tip}`, W - margin * 2);
      doc.text(lines, margin, cursor);
      cursor += lines.length * 13 + 6;
    });
  }

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    if (i > 1) doc.text(`IATOS · ${trip.destino ?? ""}  ·  ${i} / ${pages}`, W / 2, H - 20, { align: "center" });
  }

  doc.save(`IATOS-${slug(trip.destino ?? "viaje")}.pdf`);
}

function slug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function labelFor(k: string) {
  return { vuelos: "Vuelos", hospedaje: "Hospedaje", comida: "Comida", tours: "Tours / Experiencias", transporte_local: "Transporte local", extras: "Extras" }[k] ?? k;
}

function ensureSpace(doc: jsPDF, cursor: number, needed: number, margin: number): number {
  const H = doc.internal.pageSize.getHeight();
  if (cursor + needed > H - margin) {
    doc.addPage();
    // Dark background each page
    doc.setFillColor(...CARBON);
    doc.rect(0, 0, doc.internal.pageSize.getWidth(), H, "F");
    return margin;
  }
  return cursor;
}

function drawSectionHeader(doc: jsPDF, x: number, y: number, label: string): number {
  y = ensureSpace(doc, y, 40, x);
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("IATOS", doc.internal.pageSize.getWidth() - x, x - 12, { align: "right" });
  doc.setTextColor(...CREAM);
  doc.setFontSize(20);
  doc.text(label, x, y);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.8);
  doc.line(x, y + 6, x + 40, y + 6);
  return y + 28;
}

function drawSubHeader(doc: jsPDF, x: number, y: number, label: string): number {
  y = ensureSpace(doc, y, 28, x);
  doc.setTextColor(...GOLD);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(label.toUpperCase(), x, y);
  y += 14;
  return y;
}

function drawKV(doc: jsPDF, x: number, y: number, title: string, sub: string, right: string): number {
  const W = doc.internal.pageSize.getWidth();
  y = ensureSpace(doc, y, 32, x);
  doc.setTextColor(...CREAM);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const titleLines = doc.splitTextToSize(title, W - x * 2 - 140);
  doc.text(titleLines, x, y);
  if (right) {
    doc.setTextColor(...GOLD);
    doc.setFont("helvetica", "bold");
    doc.text(right, W - x, y, { align: "right" });
  }
  y += titleLines.length * 13;
  if (sub) {
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const subLines = doc.splitTextToSize(sub, W - x * 2);
    doc.text(subLines, x, y);
    y += subLines.length * 11;
  }
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.4);
  doc.line(x, y + 4, W - x, y + 4);
  return y + 14;
}
