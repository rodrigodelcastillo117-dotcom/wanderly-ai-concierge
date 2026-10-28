// Sistema de correo premium (supabase/functions/_shared/email-*.ts): formato es-MX, procedencia de
// cada cifra, escape, enlaces sin datos personales, texto plano y correos internos legibles.
import { describe, expect, it } from "vitest";
import {
  formatDateMx, formatDateRange, formatMoney, formatTime, nightsBetween, relativeFrom, safeUrl, sourceLabel,
} from "../../supabase/functions/_shared/email-format";
import {
  accountDeletedEmail, flightUpdateEmail, lineProvenance, parseFlightChange, pexelsHero, priceDropEmail, tripInviteEmail,
  tripQuoteEmail, welcomeEmail, type QuoteEmailInput,
} from "../../supabase/functions/_shared/email-templates";
import {
  conciergeRequestOpsEmail, detailRows, folioOf, isTestRequest, opsTypeLabel, requestedTimes, wallClockToInstant,
} from "../../supabase/functions/_shared/email-ops";
import { layout } from "../../supabase/functions/_shared/email";
import { buildQuoteEmailInput } from "../../supabase/functions/analizar-viaje/quoteEmail";
import { buildQuoteSnapshot } from "../../supabase/functions/_shared/quotes";

const NOW = new Date("2026-10-22T20:08:00Z"); // 14:08 h CDMX
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const TRIP = "7d0c3f7e-1111-4a2b-9c3d-5e6f7a8b9c0d";

// Enlaces que la persona puede abrir (<a> y el botón VML de Outlook); no la hoja de la fuente.
const hrefs = (html: string) => [...html.matchAll(/<(?:a|v:rect)\b[^>]*?\shref="([^"]+)"/g)].map((m) => m[1]);
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ");

const ownerQuote = (over: Partial<QuoteEmailInput> = {}): QuoteEmailInput => ({
  firstName: "Rodrigo", tripId: TRIP, quoteId: "8f3a2c1d-aaaa-4bbb-8ccc-123456789abc",
  destination: "Tokio", origin: "Ciudad de México", dateFrom: "2027-03-20", dateTo: "2027-03-25",
  travelers: 2, rooms: 1, nights: 5, currency: "MXN",
  lines: [
    { category: "vuelos", amount: 13380, state: "COTIZADO", source: "serpapi", consultedAt: ago(3) },
    { category: "hospedaje", amount: 106460, state: "COTIZADO", source: "serpapi", consultedAt: ago(3) },
    { category: "tours", amount: 6000, state: "ESTIMADO", source: "estimado" },
    { category: "comida", amount: 20000, state: "ESTIMADO", source: "estimado" },
    { category: "transporte_local", amount: 4000, state: "ESTIMADO", source: "estimado" },
    { category: "extras", amount: 5000, state: "ESTIMADO", source: "estimado" },
  ],
  quotedAt: ago(3), validUntil: "2026-10-23T20:05:00Z", now: NOW,
  ...over,
});

describe("formato es-MX", () => {
  it("dinero siempre con código de moneda", () => {
    expect(formatMoney(13380)).toBe("$13,380 MXN");
    expect(formatMoney(154840, "MXN")).toBe("$154,840 MXN");
    expect(formatMoney(1200, "USD")).toBe("US$1,200 USD");
    expect(formatMoney(-50)).toBe("−$50 MXN");
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney("abc")).toBeNull();
  });

  it("fechas legibles, sin recorrer el día por zona horaria", () => {
    expect(formatDateMx("2027-03-20")).toBe("20 de mar. de 2027");
    expect(formatDateMx("2027-02-30")).toBeNull();
    expect(formatDateRange("2027-03-20", "2027-03-25")).toBe("20 – 25 de mar. de 2027");
    expect(formatDateRange("2027-03-28", "2027-04-02")).toBe("28 de mar. – 2 de abr. de 2027");
    expect(formatDateRange("2026-12-30", "2027-01-03")).toBe("30 de dic. de 2026 – 3 de ene. de 2027");
    expect(nightsBetween("2027-03-20", "2027-03-25")).toBe(5);
    expect(nightsBetween("2027-03-25", "2027-03-20")).toBe(0);
  });

  it("horas en CDMX y frescura relativa", () => {
    expect(formatTime("2026-10-22T20:05:00Z")).toBe("14:05 h");
    expect(relativeFrom(ago(3), NOW)).toBe("hace 3 min");
    expect(relativeFrom(ago(150), NOW)).toBe("hace 3 h");
    expect(relativeFrom(ago(0.2), NOW)).toBe("justo ahora");
    expect(relativeFrom("no-fecha", NOW)).toBeNull();
  });

  it("solo enlaces https (o localhost en pruebas) y fuentes con nombre legible", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("http://evil.com")).toBeNull();
    expect(safeUrl("https://traveliatos.life/x")).toBe("https://traveliatos.life/x");
    expect(sourceLabel("serpapi", "vuelos")).toBe("Google Flights");
    expect(sourceLabel("serpapi", "hospedaje")).toBe("Google Hotels");
    expect(sourceLabel("travelpayouts")).toBe("Aviasales");
    expect(sourceLabel("lo-que-sea")).toBe("cálculo de IATOS");
  });
});

describe("cotización: procedencia de cada renglón", () => {
  it("en vivo solo con estado COTIZADO, fuente en vivo y hora de consulta; lo demás es ESTIMADO", () => {
    expect(lineProvenance({ category: "vuelos", amount: 1, state: "COTIZADO", source: "serpapi", consultedAt: ago(1) }).kind).toBe("live");
    // Sin hora de consulta o con una fuente que no es en vivo: nunca se presenta como en vivo.
    expect(lineProvenance({ category: "vuelos", amount: 1, state: "COTIZADO", source: "serpapi" }).kind).toBe("estimate");
    expect(lineProvenance({ category: "vuelos", amount: 1, state: "COTIZADO", source: "perplexity", consultedAt: ago(1) }).kind).toBe("estimate");
    // Datos viejos sin procedencia → ESTIMADO.
    expect(lineProvenance({ category: "comida", amount: 9600 }).kind).toBe("estimate");
    expect(lineProvenance({ category: "vuelos", amount: 0, state: "ESTIMADO" }).kind).toBe("unavailable");
    expect(lineProvenance({ category: "hospedaje", amount: 100, state: "PENDIENTE" }).kind).toBe("pending");
    expect(lineProvenance({ category: "vuelos", amount: 0, state: "EXCLUIDO" }).kind).toBe("excluded");
    expect(lineProvenance({ category: "crucero", amount: 100, state: "OPCIONAL" }).kind).toBe("optional");
  });

  it("el correo del dueño: moneda, fuente y hora por renglón, total estimado y nada en formato ISO", () => {
    const m = tripQuoteEmail(ownerQuote());
    expect(m.subject).toBe("Tu viaje a Tokio está cotizado");
    expect(m.text).toContain("- Vuelos: $13,380 MXN [EN VIVO · Google Flights · 14:05 h]");
    expect(m.text).toContain("- Hospedaje: $106,460 MXN [EN VIVO · Google Hotels · 14:05 h]");
    expect(m.text).toContain("- Comida: $20,000 MXN [ESTIMADO · cálculo de IATOS]");
    expect(m.text).toContain("TOTAL ESTIMADO: $154,840 MXN");
    expect(m.text).toContain("Fechas: 20 – 25 de mar. de 2027 (5 noches)");
    expect(m.text).toContain("Viajeros: 2 viajeros · 1 habitación");
    expect(m.text).toContain("Ruta: Ciudad de México → Tokio");
    expect(m.text).toContain("Cotizado hace 3 min");
    expect(m.text).toMatch(/Válido hasta el 23 de oct\. de 2026, 14:05 h/);
    expect(m.text).toContain("«Estimado» es un cálculo de IATOS");
    for (const out of [m.html, m.text]) {
      expect(out).not.toMatch(/2027-03-2\d/);
      expect(out).not.toContain("Precios estimados con datos en vivo");
    }
    expect(visible(m.html)).toContain("Total estimado");
    expect(visible(m.html)).not.toContain("Total cotizado");
    expect(m.html).toContain("$154,840");
  });

  it("'Total cotizado' solo si todo lo que suma es en vivo; lo no disponible no suma", () => {
    const live = tripQuoteEmail(ownerQuote({ lines: [
      { category: "vuelos", amount: 1000, state: "COTIZADO", source: "travelpayouts", consultedAt: ago(5) },
      { category: "hospedaje", amount: 2000, state: "COTIZADO", source: "serpapi", consultedAt: ago(5) },
      { category: "tours", amount: 0, state: "ESTIMADO" },
      { category: "crucero", label: "Crucero alternativo", amount: 50000, state: "OPCIONAL" },
    ] }));
    expect(live.text).toContain("TOTAL COTIZADO: $3,000 MXN");
    expect(live.text).toContain("[NO DISPONIBLE]");
    expect(live.text).toContain("[OPCIONAL]");
    expect(live.text).toContain("«No disponible»");
  });

  it("con tipo de cambio de respaldo lo dice y no hay renglones en vivo", () => {
    const m = tripQuoteEmail(ownerQuote({ fxIsFallback: true, lines: [{ category: "vuelos", amount: 1000, state: "ESTIMADO", source: "serpapi" }] }));
    expect(m.text).toContain("tipo de cambio de respaldo");
    expect(m.text).not.toContain("EN VIVO");
  });

  it("muestra quién viaja (adultos y niños) y habitaciones", () => {
    const m = tripQuoteEmail(ownerQuote({ travelers: 4, adults: 2, children: 2, rooms: 2 }));
    expect(m.text).toContain("Viajeros: 2 adultos · 2 niños · 2 habitaciones");
    expect(m.preheader).toContain("2 adultos · 2 niños");
  });

  it("escapa todo texto variable y no mete datos personales en los enlaces", () => {
    const m = tripQuoteEmail(ownerQuote({
      firstName: '<img src=x onerror="alert(1)">', destination: "<script>x()</script>", origin: '"><b>o</b>',
      hotel: { name: "<i>Hotel</i>", photoUrl: "javascript:alert(1)" },
      flight: { airline: "<svg onload=1>", pricePerPerson: 10 },
      hero: { url: "https://images.pexels.com/x.jpg", alt: '"><script>', credit: "<b>c</b>", creditUrl: "javascript:x" },
    }));
    expect(m.html).not.toMatch(/<script|<img src=x|<svg|<i>Hotel|<b>c<\/b>|<b>o<\/b>|javascript:/);
    expect(m.html).toContain("&lt;script&gt;x()&lt;/script&gt;");
    for (const h of hrefs(m.html)) {
      expect(h).toMatch(/^(https:\/\/|mailto:hola@traveliatos\.life$)/);
      expect(h).not.toMatch(/rodrigo|@(?!traveliatos)/i);
    }
    expect(hrefs(m.html)).toContain(`https://traveliatos.life/dashboard/viajes/${TRIP}`);
  });

  it("tarjetas ricas solo con lo que viene: horarios con +1 y foto del hotel con alt", () => {
    const m = tripQuoteEmail(ownerQuote({
      flight: { airline: "ANA", tier: "equilibrio", duration: "13 h 50 min", stops: 0, pricePerPerson: 6690, source: "serpapi", live: true, consultedAt: ago(3),
        departure: { code: "MEX", time: "2027-03-20 01:20" }, arrival: { code: "NRT", time: "2027-03-21 06:10" } },
      hotel: { name: "Hotel Uno", stars: 4, rating: 4.6, pricePerNight: 21292, source: "serpapi", live: true, consultedAt: ago(3), photoUrl: "https://lh3.googleusercontent.com/x" },
    }));
    expect(m.html).toContain("06:10 h +1");
    expect(m.html).toContain('alt="Foto de Hotel Uno"');
    expect(m.html).toContain("★★★★");
    expect(m.text).toContain("Vuelo sugerido: ANA · Directo · 13 h 50 min · $6,690 MXN por persona [EN VIVO · Google Flights · 14:05 h]");
    const bare = tripQuoteEmail(ownerQuote({ flight: { airline: "ANA", source: "perplexity", live: false } }));
    expect(bare.html).not.toContain("06:10");
    expect(bare.text).toContain("Vuelo sugerido: ANA [ESTIMADO · búsqueda web]");
  });

  it("sin foto (o con imágenes bloqueadas) la portada es tipográfica; con foto lleva crédito", () => {
    const none = tripQuoteEmail(ownerQuote({ hero: null }));
    expect(none.html).not.toContain("background-image:url(");
    expect(none.html).toContain(">Tokio<");
    const hero = pexelsHero({ image: "https://images.pexels.com/photos/1/p.jpeg", photographer: "Ana López", page_url: "https://www.pexels.com/photo/1/" }, "Tokio");
    expect(hero?.credit).toBe("Foto ilustrativa · Pexels · Ana López");
    expect(hero?.alt).toBe("Foto ilustrativa de Tokio");
    expect(pexelsHero({ image: "http://insecure/p.jpg" }, "x")).toBeNull();
    const withPhoto = tripQuoteEmail(ownerQuote({ hero }));
    expect(withPhoto.html).toContain('background="https://images.pexels.com/photos/1/p.jpeg"');
    expect(withPhoto.html).toContain("Foto ilustrativa · Pexels · Ana López");
    expect(withPhoto.html).toContain(`bgcolor="#16140F"`); // color de respaldo con imágenes bloqueadas
  });

  it("cabe en Gmail sin recortarse (< 102 KB) y declara modo oscuro", () => {
    const m = tripQuoteEmail(ownerQuote());
    expect(new TextEncoder().encode(m.html).length).toBeLessThan(102_000);
    expect(m.html).toContain('<meta name="color-scheme" content="dark">');
    expect(m.html).toContain("<v:rect"); // botón para Outlook
  });

  it("texto plano estable (snapshot)", () => {
    expect(tripQuoteEmail(ownerQuote()).text).toMatchSnapshot();
  });
});

describe("cotización desde analizar-viaje (quoteEmail.ts)", () => {
  const snapshot = buildQuoteSnapshot({
    tripId: TRIP, userId: "u", origin: "analizar-viaje", breakdown: { vuelos: 13380, hospedaje: 106460, comida: 20000 },
    travelers: 2, nights: 5, rooms: 1, dateFrom: "2027-03-20", dateTo: "2027-03-25",
    fx: { rate: 20, source: "banxico", fetched_at: ago(10), is_fallback: false },
    reference: {
      vuelos: { estado_dato: "CONSULTADO_EN_VIVO", fuente_precio: "serpapi", consultado_at: ago(3) },
      hospedaje: { estado_dato: "CONSULTADO_EN_VIVO", fuente_precio: "serpapi", consultado_at: ago(3) },
    },
    now: NOW,
  });
  const base = {
    trip: { id: TRIP, destino: "Tokio", ciudad_origen: "Ciudad de México" }, snapshot, fxUsd: 20, now: NOW,
    vueloReferencia: { aerolinea: "ANA", tier: "equilibrio", duracion: "13h 50m", escalas: "0", precio_por_persona: 6690, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: ago(3) },
    hotelReferencia: { nombre: "Hotel Uno Shibuya", tipo: "Boutique", barrio: "Shibuya", rating: 4.9, precio_por_noche: 21292, fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: ago(3) },
  };

  it("horarios y aeropuertos solo si el vuelo es el mismo de la lista en vivo", () => {
    const hit = buildQuoteEmailInput({ ...base, googleFlights: [{ airline: "ANA", price_per_person_usd: 334.5, departure: { id: "MEX", time: "2027-03-20 01:20" }, arrival: { id: "NRT", time: "2027-03-21 06:10" } }] });
    expect(hit.flight?.departure).toEqual({ code: "MEX", time: "2027-03-20 01:20" });
    expect(hit.originCode).toBe("MEX");
    const otherAirline = buildQuoteEmailInput({ ...base, googleFlights: [{ airline: "JAL", price_per_person_usd: 334.5, departure: { id: "MEX", time: "x" }, arrival: { id: "HND", time: "y" } }] });
    expect(otherAirline.flight?.departure).toBeUndefined();
    expect(otherAirline.originCode).toBeNull();
  });

  it("foto, estrellas y rating del hotel solo si el nombre coincide con Google Hotels", () => {
    const hit = buildQuoteEmailInput({ ...base, liveHotels: [{ name: "Hotel Uno Shibuya", thumbnail: "https://lh3.googleusercontent.com/a", hotel_class: "4-star hotel", rating: 4.5 }] });
    expect(hit.hotel).toMatchObject({ photoUrl: "https://lh3.googleusercontent.com/a", stars: 4, rating: 4.5, live: true });
    const miss = buildQuoteEmailInput({ ...base, liveHotels: [{ name: "Otro Hotel Distinto", thumbnail: "https://x/a" }] });
    expect(miss.hotel).toMatchObject({ photoUrl: null, stars: null, rating: null });
  });

  it("con tipo de cambio de respaldo las tarjetas no dicen 'en vivo' (igual que el desglose)", () => {
    const fallback = buildQuoteSnapshot({ ...{ tripId: TRIP, userId: "u", origin: "analizar-viaje" as const, breakdown: { vuelos: 100 }, travelers: 1, nights: 1, rooms: 1 },
      fx: { rate: 20, source: "respaldo", fetched_at: ago(1), is_fallback: true }, reference: { vuelos: { estado_dato: "CONSULTADO_EN_VIVO", consultado_at: ago(1) } }, now: NOW });
    const i = buildQuoteEmailInput({ ...base, snapshot: fallback });
    expect(i.flight?.live).toBe(false);
    expect(i.hotel?.live).toBe(false);
    expect(tripQuoteEmail(i).text).not.toContain("EN VIVO");
  });
});

describe("bienvenida, invitación, alertas y cuenta eliminada", () => {
  it("bienvenida: tres pasos con enlace, texto plano y sin datos personales en enlaces", () => {
    const m = welcomeEmail({ firstName: "valentina" });
    expect(m.subject).toBe("Valentina, tu concierge de viajes ya está listo");
    expect(m.text).toMatch(/1\. Cotiza tu primer viaje[\s\S]*2\. Cuéntame cómo viajas[\s\S]*3\. Guarda tus tarjetas/);
    expect(hrefs(m.html)).toEqual(expect.arrayContaining([
      "https://traveliatos.life/dashboard/planear", "https://traveliatos.life/onboarding/deep", "https://traveliatos.life/dashboard/perfil", "https://traveliatos.life/dashboard",
    ]));
    for (const h of hrefs(m.html)) expect(h).not.toMatch(/valentina/i);
    expect(m.text).toMatchSnapshot();
  });

  it("invitación: anfitrión escapado, fechas legibles y enlace al viaje", () => {
    const m = tripInviteEmail({ guestName: "Mariana", hostName: "<b>Rodrigo</b>", destination: "Barcelona", dateFrom: "2027-05-08", dateTo: "2027-05-16", tripId: TRIP });
    expect(m.html).not.toContain("<b>Rodrigo");
    expect(m.text).toContain("Fechas: 8 – 16 de may. de 2027 (8 noches)");
    expect(hrefs(m.html)).toContain(`https://traveliatos.life/dashboard/viajes/${TRIP}`);
  });

  it("alerta de precio: antes → ahora, ahorro, fuente y hora, cómo dejar de vigilar", () => {
    const m = priceDropEmail({ tripId: TRIP, destination: "Barcelona", originCode: "MEX", destinationCode: "BCN", adults: 2, before: 18420, now: 15960, source: "travelpayouts", checkedAt: ago(4), bookingUrl: "https://www.aviasales.com/search/x?marker=1" });
    expect(m.subject).toBe("Bajó tu vuelo a Barcelona: ahora $15,960 MXN por persona");
    expect(m.text).toContain("Antes: $18,420 MXN → Ahora: $15,960 MXN");
    expect(m.text).toContain("Ahorras $2,460 MXN por persona · $4,920 MXN en total");
    expect(m.text).toContain("[EN VIVO · Aviasales · 14:04 h]");
    expect(m.text).toContain("Dejar de vigilar este precio");
    expect(m.text).toMatchSnapshot();
  });

  it("alerta de vuelo: cambios de → a, titular claro y fuente con hora", () => {
    expect(parseFlightChange("Puerta: 72 → 75")).toEqual({ label: "Puerta", before: "72", after: "75" });
    expect(parseFlightChange("Puerta asignada: B7")).toEqual({ label: "Puerta asignada", before: null, after: "B7" });
    const m = flightUpdateEmail({ flight: "am 58", flightDate: "2027-03-20", route: "MEX → NRT", changes: ["Puerta: 72 → 75"], checkedAt: ago(2), url: `/dashboard/viajes/${TRIP}` });
    expect(m.subject).toBe("Vuelo AM 58: puerta 75");
    expect(m.text).toContain("Tu puerta cambió a la 75.");
    expect(m.text).toContain("- Puerta: 72 → 75");
    expect(hrefs(m.html)).toContain(`https://traveliatos.life/dashboard/viajes/${TRIP}`);
    expect(flightUpdateEmail({ flight: "AM1", changes: ["Vuelo cancelado"], checkedAt: ago(1), url: "/x" }).subject).toBe("Vuelo AM1 cancelado");
  });

  it("cuenta eliminada: dice qué se borró y no tiene botones a la app", () => {
    const m = accountDeletedEmail({ at: NOW, pending: true });
    expect(m.text).toContain("Tu cuenta fue eliminada.");
    expect(m.text).toContain("22 de oct. de 2026, 14:08 h");
    expect(hrefs(m.html).filter((h) => h.includes("/dashboard"))).toEqual([]);
  });

  it("todos los correos a la persona traen texto plano, preencabezado y por qué le llegan", () => {
    const all = [
      tripQuoteEmail(ownerQuote()), welcomeEmail(), tripInviteEmail({ destination: "X", tripId: TRIP }),
      priceDropEmail({ tripId: TRIP, destination: "X", before: 2, now: 1, source: "serpapi", checkedAt: ago(1) }),
      flightUpdateEmail({ flight: "AM1", changes: ["Puerta: 1 → 2"], checkedAt: ago(1), url: "/x" }), accountDeletedEmail(),
    ];
    for (const m of all) {
      expect(m.text.length).toBeGreaterThan(100);
      expect(m.preheader.length).toBeGreaterThan(5);
      expect(m.html).toMatch(/Recibes (este|esta)/);
      expect(m.text).toMatch(/Recibes (este|esta)/);
      expect(m.html).toContain("hola@traveliatos.life");
    }
  });
});

describe("correos internos de operaciones", () => {
  const prive = {
    requestId: "4be1c0de-9f3a-4c2b-8d7e-0123456789ab", type: "prive_request", title: "Le Bernardin", createdAt: NOW.toISOString(),
    client: { name: "Valentina Ruiz", email: "valentina@correo.mx", contactMethod: "whatsapp" },
    trip: null,
    experience: { name: "Le Bernardin", city: "Nueva York", country: "US", sourceUrl: "https://www.le-bernardin.com/", timezone: "America/New_York" },
    requestedFor: "2026-11-14T20:00:00", partySize: 4, preferences: "Aniversario",
    payload: { experience_id: "a3c1b2d4-0000-4000-8000-000000000001", requested_for: "2026-11-14T20:00:00", party_size: 4, contact_method: "whatsapp", plan_group: "b3c1b2d4-0000-4000-8000-000000000002" },
  };

  it("reserva Privé legible: tipo en español, hora del lugar y de CDMX, folio corto, sin JSON ni uuid", () => {
    const m = conciergeRequestOpsEmail(prive);
    // Mesa de operaciones: asunto que se entiende sin abrir el correo ("Nueva solicitud: … en … para … el …").
    expect(m.subject).toBe("Nueva solicitud: Reserva Privé en Le Bernardin para 4 personas el 14 de nov., 20:00 h · Valentina Ruiz · Folio 4BE1C0DE");
    expect(m.text).toContain("Fecha y hora: 14 de nov. de 2026, 20:00 h (hora del lugar) · 14 de nov. de 2026, 19:00 h (hora CDMX)");
    expect(m.text).toContain("Estado: Pendiente de confirmar — el cliente ve «solicitud recibida», no «reserva».");
    expect(m.text).toContain("Prefiere: WhatsApp");
    expect(m.text).toContain("Viaje: Sin viaje");
    for (const out of [m.html, m.text]) {
      expect(out).not.toContain("prive_request");
      expect(out).not.toMatch(/\{"|":/); // nada de JSON
      expect(out).not.toContain("4be1c0de-9f3a"); // ni el uuid completo
      expect(out).not.toContain("a3c1b2d4");
    }
    expect(m.text).toMatchSnapshot();
  });

  it("marca [PRUEBA] por texto o por correo de prueba", () => {
    expect(conciergeRequestOpsEmail({ ...prive, preferences: "PRUEBA no llamar" }).subject).toMatch(/^\[PRUEBA\] /);
    expect(conciergeRequestOpsEmail({ ...prive, client: { email: "x@mailinator.com" } }).subject).toMatch(/^\[PRUEBA\] /);
    expect(isTestRequest({ email: "qa+e2e@iatos.mx" })).toBe(true);
    expect(isTestRequest({ email: "rodrigo@empresa.mx", texts: ["Prueba de sonido en el bar"] })).toBe(true);
    expect(isTestRequest({ email: "rodrigo@empresa.mx", texts: ["Aprueban mesa"] })).toBe(false);
  });

  it("convierte la hora del lugar a CDMX y avisa si falta la zona", () => {
    expect(wallClockToInstant("2026-11-14T20:00:00", "America/New_York")?.toISOString()).toBe("2026-11-15T01:00:00.000Z");
    expect(wallClockToInstant("2026-07-14T20:00", "Europe/Madrid")?.toISOString()).toBe("2026-07-14T18:00:00.000Z");
    expect(requestedTimes("2026-11-14T20:00:00", null)).toMatchObject({ venue: "14 de nov. de 2026, 20:00 h", cdmx: null });
    expect(requestedTimes("2026-11-15T01:00:00Z", "America/New_York")).toEqual({ venue: "14 de nov. de 2026, 20:00 h", cdmx: "14 de nov. de 2026, 19:00 h", note: null });
  });

  it("detalle de otras solicitudes sin JSON: etiquetas, listas y enlaces https", () => {
    const rows = detailRows({ subtitle: "Mariscos", meta: ["$$$", "Reservación"], website: "https://contramar.com.mx", venue_id: "x", nested: { a: 1, b: "dos" }, raro: "javascript:alert(1)" });
    expect(rows.map((r) => r.k)).toEqual(["Detalle", "Datos", "Sitio web", "Nested", "Raro"]);
    expect(rows[1].text).toBe("$$$, Reservación");
    expect(rows[2].v).toContain('href="https://contramar.com.mx/"');
    expect(rows[3].text).toBe("a: 1 · b: dos");
    expect(rows[4].v).not.toContain("href");
    expect(opsTypeLabel("members_nightlife_reservation")).toBe("Reserva Members Only");
    expect(folioOf("4be1c0de-9f3a")).toBe("4BE1C0DE");
  });

  it("escapa lo que escribe el cliente en el correo interno", () => {
    const m = conciergeRequestOpsEmail({ ...prive, title: "<script>x</script>", preferences: '"><img src=x>', client: { name: "<b>Ana</b>", email: 'a"b@x.mx' } });
    expect(m.html).not.toMatch(/<script>x|<img src=x|<b>Ana/);
  });

  it("layout() de avisos internos (salud, cobros) usa el mismo sistema", () => {
    const html = layout("Pago &amp; cobro", "<p>detalle</p>");
    expect(html).toContain("<title>Pago &amp; cobro</title>");
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toContain("<p>detalle</p>");
  });
});
