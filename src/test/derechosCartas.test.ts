// Cartas formales de reclamación (supabase/functions/_shared/derechos/cartas.ts y servicios.ts).
import { describe, expect, it } from "vitest";
import { evaluarVuelo } from "../../supabase/functions/_shared/derechos/motor";
import { cartaAerolinea, cartaOrganismo, hechosDe, recordatorio } from "../../supabase/functions/_shared/derechos/cartas";
import { EU_NEB, PROFECO } from "../../supabase/functions/_shared/derechos/datos";
import { cartaServicio, evaluarServicio } from "../../supabase/functions/_shared/derechos/servicios";

const MADMEX = evaluarVuelo({ evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", vuelo: "IB6403", fecha: "2026-10-26", aviso_dias: 3, reubicacion: { ofrecida: false }, motivo: "razones operativas", precio: { monto: 18400, moneda: "MXN" } });
const PAX = { nombre: "Rodrigo del Castillo", reserva: "ABC123", boleto: "0752412345678", correo: "rodrigo@example.com" };

describe("carta a la aerolínea", () => {
  const c = cartaAerolinea({ evaluacion: MADMEX, pasajero: PAX, ref: "C-7K2QXM", fecha_carta: "2026-10-29", gastos: [{ concepto: "Hotel en Madrid", monto: 120, moneda: "EUR" }], eleccion: "reembolso" });
  it("en el idioma del proveedor (Iberia → español) con folio, vuelo y reserva en el asunto", () => {
    expect(c.idioma).toBe("es");
    expect(c.asunto).toBe("Reclamación formal — vuelo IB6403 2026-10-26 · ABC123 · Ref. C-7K2QXM");
  });
  it("datos del pasajero, hechos, fundamento citado, monto pedido y plazo de respuesta", () => {
    expect(c.texto).toContain("Nombre: Rodrigo del Castillo");
    expect(c.texto).toContain("Número de boleto: 0752412345678");
    expect(c.texto).toContain("Me avisaron 3 día(s) antes de la salida programada.");
    expect(c.fundamentos).toContain("Reglamento (CE) n.º 261/2004, art. 5 (cancelación)");
    expect(c.texto).toMatch(/El pago de EUR\s?600\.00 por pasajero/);
    expect(c.texto).toMatch(/al menos MXN\s?4,600\.00/); // 25 % de 18 400 (LAC 47 Bis VI)
    expect(c.texto).toContain("Hotel en Madrid: EUR");
    expect(c.texto).toContain("reembolso completo del boleto");
    expect(c.plazo_respuesta_dias).toBe(14);
    expect(c.texto).toContain("en un plazo máximo de 14 días naturales");
    expect(c.texto).toContain("no acepto vales ni millas");
    expect(c.texto).toContain("Agencia Estatal de Seguridad Aérea (AESA)");
  });
  it("Iberia solo tiene formulario: destinatario sin correo (nunca se adivina) y con el enlace oficial", () => {
    expect(c.destinatario).toEqual({ nombre: "Iberia", correo: null, url: "https://www.iberia.com/us/claims-receipts/", canal: "formulario" });
  });
  it("HTML escapado: un relato con etiquetas no inyecta HTML", () => {
    const x = cartaAerolinea({ evaluacion: MADMEX, pasajero: { nombre: "<b>Ana</b>" }, ref: "C-AAAAAA", fecha_carta: "2026-10-29", relato: "<script>alert(1)</script> nos dejaron sin hotel" });
    expect(x.html).not.toContain("<script>");
    expect(x.html).toContain("&lt;script&gt;");
    expect(x.texto).toContain("«<script>alert(1)</script> nos dejaron sin hotel»"); // el texto plano lo cita tal cual
  });
  it("Air France → francés; KLM/Lufthansa → inglés; Brasil → portugués", () => {
    const af = cartaAerolinea({ evaluacion: evaluarVuelo({ evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 5 }), pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-10-29" });
    expect(af.idioma).toBe("fr");
    expect(af.texto).toContain("Règlement (CE) n° 261/2004");
    expect(af.texto).toMatch(/600,00\s?EUR/);
    const kl = cartaAerolinea({ evaluacion: evaluarVuelo({ evento: "retraso", origen: "AMS", destino: "MEX", aerolinea: "KL", horas_retraso_llegada: 5 }), pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-10-29" });
    expect(kl.idioma).toBe("en");
    expect(kl.texto).toContain("Regulation (EC) No 261/2004");
    expect(kl.texto).toContain("Please reply in writing within 14 calendar days");
    const g3 = cartaAerolinea({ evaluacion: evaluarVuelo({ evento: "sobreventa", origen: "GRU", destino: "GIG", aerolinea: "G3", voluntario: false }), pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-10-29" });
    expect(g3.idioma).toBe("pt");
    expect(g3.texto).toContain("Resolução ANAC nº 400/2016, art. 24");
    expect(g3.texto).toContain("250 DES");
    expect(g3.plazo_respuesta_dias).toBe(10);
  });
  it("el relato del usuario va citado tal cual y marcado como original en español si la carta es en otro idioma", () => {
    const x = cartaAerolinea({ evaluacion: evaluarVuelo({ evento: "retraso", origen: "AMS", destino: "MEX", aerolinea: "KL", horas_retraso_llegada: 5 }), pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-10-29", relato: "Esperamos 5 horas sin comida" });
    expect(x.texto).toContain("Passenger's account (original wording, in Spanish)");
    expect(x.texto).toContain("«Esperamos 5 horas sin comida»");
  });
  it("una ley mexicana sola (vuelo nacional) pide pago en 10 días naturales", () => {
    const e = evaluarVuelo({ evento: "cancelacion", origen: "MEX", destino: "CUN", aerolinea: "AM", motivo: "operativo", precio: { monto: 4000, moneda: "MXN" } });
    const x = cartaAerolinea({ evaluacion: e, pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-10-29" });
    expect(x.plazo_respuesta_dias).toBe(10);
    expect(x.texto).toContain("Ley de Aviación Civil (México), art. 47 Bis, fracción VI");
    expect(x.texto).toContain("Procuraduría Federal del Consumidor (PROFECO)");
  });
  it("hechos sin datos inventados: solo lo que trae el caso", () => {
    const h = hechosDe(evaluarVuelo({ evento: "retraso", origen: "MEX", destino: "CUN", aerolinea: "AM" }), "es");
    expect(h).toEqual(["Aeroméxico, vuelo MEX–CUN: retraso del vuelo.", "Distancia de gran círculo de la ruta: ~1284 km."]);
  });
});

describe("carta al organismo (escalamiento)", () => {
  it("AESA, en español, con el reclamo previo y la falta de respuesta", () => {
    const o = cartaOrganismo({ evaluacion: MADMEX, pasajero: PAX, ref: "C-7K2QXM", fecha_carta: "2026-12-29", organismo: EU_NEB.ES, reclamo_previo: { fecha: "2026-10-29", respuesta: null } });
    expect(o.idioma).toBe("es");
    expect(o.asunto).toMatch(/^Queja contra Iberia/);
    expect(o.texto).toContain("Reclamé a la aerolínea el 29 de octubre de 2026.");
    expect(o.texto).toContain("No he recibido respuesta.");
    expect(o.destinatario.url).toBe("https://www.seguridadaerea.gob.es/es/consultas");
    expect(o.destinatario.correo).toBeNull(); // AESA: el correo es solo para consultas
  });
  it("LBA (Alemania): inglés y correo oficial de la lista de la Comisión; PROFECO en español", () => {
    const e = evaluarVuelo({ evento: "retraso", origen: "FRA", destino: "MEX", aerolinea: "LH", horas_retraso_llegada: 6 });
    const o = cartaOrganismo({ evaluacion: e, pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-12-29", organismo: EU_NEB.DE, reclamo_previo: { fecha: "2026-10-29", respuesta: "We regret that compensation is not payable" } });
    expect(o.idioma).toBe("en");
    expect(o.destinatario.correo).toBe("fluggastrechte@lba.de");
    expect(o.texto).toContain('Their reply was: "We regret that compensation is not payable".');
    const p = cartaOrganismo({ evaluacion: evaluarVuelo({ evento: "cancelacion", origen: "MEX", destino: "CUN", aerolinea: "AM" }), pasajero: PAX, ref: "C-AAAAAA", fecha_carta: "2026-12-29", organismo: PROFECO, reclamo_previo: { fecha: "2026-10-29" } });
    expect(p.idioma).toBe("es");
    expect(p.destinatario.url).toContain("concilianet.profeco.gob.mx");
  });
});

describe("recordatorio y cartas de hotel / traslado / agencia", () => {
  it("recordatorio en el idioma de la carta y en el mismo hilo (Re:)", () => {
    const r = recordatorio("en", "C-AAAAAA", "Formal claim — flight KL685", "2026-10-01T10:00:00Z", 16);
    expect(r.asunto).toBe("Re: Formal claim — flight KL685");
    expect(r.texto).toContain("16 days have passed without a reply");
  });
  it("sobreventa de hotel en México: devolución + bonificación ≥20 % (LFPC 92 Bis/Ter) y ruta proveedor → banco → PROFECO", () => {
    const caso = { problema: "sobreventa_hotel" as const, proveedor: { nombre: "Hotel Ejemplo Cancún", tipo: "hotel" as const, pais: "MX" }, monto_pagado: 9000, moneda: "MXN", pagado_con: "tarjeta_credito" as const, fecha_cargo: "2026-10-01", hoy: "2026-10-29", reserva: "H-778" };
    const ev = evaluarServicio(caso);
    expect(ev.derechos.find((d) => d.id === "SV_bonificacion")?.monto).toEqual({ valor: 1800, moneda: "MXN", tipo: "minimo" });
    expect(ev.ruta.map((r) => r.a_quien)).toEqual(["proveedor", "banco", "organismo"]);
    expect(ev.ruta[1].cuando).toContain("62 días"); // 90 − 28 desde el cargo
    expect(ev.plazos.map((p) => p.fuente)).toEqual(["MX_LTOSF_23", "MX_LFPC_14"]);
    const c = cartaServicio(caso, ev, { nombre: "Rodrigo del Castillo" }, "C-BBBBBB", "2026-10-29");
    expect(c.texto).toContain("artículos 92 Bis y 92 Ter de la Ley Federal de Protección al Consumidor");
    expect(c.texto).toContain("1800 MXN");
    expect(c.destinatario.correo).toBeNull(); // sin correo con fuente → no se inventa
  });
  it("cobro doble con correo que venía en la reserva: se puede usar porque tiene fuente", () => {
    const caso = { problema: "cobro_doble" as const, proveedor: { nombre: "Traslados Ejemplo", tipo: "traslado" as const, correo: "reservas@traslados.example", correo_fuente: "reserva" as const }, monto_cobrado_de_mas: 850, moneda: "MXN" };
    const c = cartaServicio(caso, evaluarServicio(caso), { nombre: "Ana" }, "C-CCCCCC", "2026-10-29");
    expect(c.destinatario).toMatchObject({ correo: "reservas@traslados.example", canal: "correo" });
    expect(c.texto).toContain("devolución inmediata de 850 MXN");
  });
  it("hotel fuera de México: no se cita la LFPC y se avisa que PROFECO puede no alcanzarlo", () => {
    const caso = { problema: "servicio_no_prestado" as const, proveedor: { nombre: "Hotel Roma", tipo: "hotel" as const, pais: "IT" }, monto_pagado: 300, moneda: "EUR" };
    const ev = evaluarServicio(caso);
    expect(ev.avisos.join(" ")).toMatch(/no es mexicano/);
    expect(ev.derechos[0].certeza).toBe("depende");
    const c = cartaServicio(caso, ev, { nombre: "Ana" }, "C-DDDDDD", "2026-10-29", "en");
    expect(c.texto).not.toContain("Federal Consumer Protection Law");
    expect(c.idioma).toBe("en");
  });
});
