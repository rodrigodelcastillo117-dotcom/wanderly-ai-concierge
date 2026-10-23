// Correo "Enviarme mi selección" (enviar-seleccion) y por qué el correo al crear el viaje decía todo
// "NO DISPONIBLE" (caso París → Roma → Atenas del 23-oct-2026). Sin red ni correos reales: el envío es
// una función simulada que solo guarda lo que se habría mandado.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CASO_PRA_CREADO, CASO_PRA_MULTI, PRA_NOW } from "./fixtures/casoParisRomaAtenas";
import { buildSelectionRequest, NOT_READY_LABEL, SEND_LABEL } from "@/lib/selectionEmail";
import { computeTripDesglose } from "@/lib/quote";
import { tripTotals } from "@/components/RealTripTotal";
import { buildQuoteSnapshot } from "../../supabase/functions/_shared/quotes";
import { tripQuoteEmail } from "../../supabase/functions/_shared/email-templates";
import { buildQuoteEmailInput } from "../../supabase/functions/analizar-viaje/quoteEmail";
import { reconcileBudget } from "../../supabase/functions/analizar-viaje/budget";
import {
  porCotizarLine, priceStatusOf, selectionEmail, TRIP_SENDS_PER_HOUR, validateSelectionRequest,
} from "../../supabase/functions/_shared/selection-email";
import { handleSelectionEmail, type SelectionDeps } from "../../supabase/functions/enviar-seleccion/handler";

const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")} MXN`;

type Sel = { selVuelo: number; selHospedaje: number; selTours: Set<number>; selHoteles: Record<string, number> };
const NONE: Sel = { selVuelo: -1, selHospedaje: -1, selTours: new Set(), selHoteles: {} };

/** Lo que hace la página: desglose con la selección y el total que muestra RealTripTotal. */
function page(trip: any, sel: Sel, travelers = Number(trip.num_viajeros) || 1, nights = 9) {
  const desglose = computeTripDesglose(trip, { ...sel, nochesHospedaje: nights }, travelers);
  const total = tripTotals(trip, travelers, desglose).total;
  return { desglose, total, travelers, nights };
}

function request(trip: any, sel: Sel, opts: { travelers?: number; rows?: any[]; marks?: Set<string> } = {}) {
  const p = page(trip, sel, opts.travelers);
  const r = buildSelectionRequest(trip, sel, { ...p, rows: opts.rows ?? [], marks: opts.marks ?? null });
  return { ...r, page: p };
}

/** Dependencias simuladas de enviar-seleccion: base en memoria, límite real y envío falso. */
function deps(trip: any, over: Partial<SelectionDeps> = {}) {
  const counts = new Map<string, number>();
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = [];
  const d: SelectionDeps = {
    user: { id: "owner-1", email: "dueno@example.com" },
    rateLimitUser: async () => ({ allowed: true, retryAfter: 0 }),
    hit: async (subject, bucket, rule) => {
      const k = `${subject}|${bucket}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n <= rule.limit;
    },
    loadTrip: async (id) => (id === trip.id ? trip : null),
    members: async () => [{ id: "owner-1", name: "Rodrigo del Castillo" }, { id: "amiga-2", name: "Ana López" }],
    emailOf: async (id) => ({ "owner-1": "dueno@example.com", "amiga-2": "ana@example.com" } as Record<string, string>)[id] ?? null,
    marks: async () => ({ keys: new Set<string>(), confirmed: [] }),
    send: vi.fn(async (o) => { sent.push(o); return { ok: true, id: `msg-${sent.length}` }; }),
    siteUrl: "https://traveliatos.life",
    now: PRA_NOW,
    ...over,
  };
  return { d, sent };
}

const CHOSEN: Sel = { selVuelo: 1, selHospedaje: 0, selTours: new Set([0]), selHoteles: {} };
const MULTI_CHOSEN: Sel = { selVuelo: 1, selHospedaje: -1, selTours: new Set([1]), selHoteles: { "París": 0, "Roma": 3, "Atenas": 6 } };

describe("causa: el correo al crear el viaje leía el desglose del modelo, no los precios en vivo", () => {
  it("con el desglose del modelo en 0, el correo viejo decía NO DISPONIBLE aunque el viaje tenía Air France $21,238 y Pullman $41,031 en vivo", () => {
    const t: any = CASO_PRA_CREADO;
    // reconcileBudget respeta un renglón en 0 del modelo (puede ser una exclusión que no detectó):
    // los precios en vivo de vuelos_json / hospedaje_json no llegan al desglose.
    const b = reconcileBudget({ desglose_presupuesto: t.desglose_presupuesto, vuelos: t.vuelos_json, hospedaje: t.hospedaje_json }, { dias: 9, viajeros: 1 });
    expect(b.desglose).toMatchObject({ vuelos: 0, hospedaje: 0, tours: 0, comida: 0, transporte_local: 0 });
    expect(b.valido).toBe(true);
    const snapshot = buildQuoteSnapshot({
      tripId: t.id, userId: t.user_id, origin: "analizar-viaje", breakdown: b.desglose, travelers: 1, nights: 9, rooms: 1,
      dateFrom: t.fecha_salida, dateTo: t.fecha_regreso, fx: { rate: 18.4, source: "banxico", fetched_at: PRA_NOW.toISOString(), is_fallback: false },
      reference: { vuelos: b.vueloReferencia, hospedaje: b.hotelReferencia }, now: PRA_NOW,
    });
    const old = tripQuoteEmail(buildQuoteEmailInput({ trip: t, snapshot, vueloReferencia: b.vueloReferencia, hotelReferencia: b.hotelReferencia, fxUsd: 18.4, now: PRA_NOW }));
    for (const cat of ["Vuelos", "Hospedaje", "Experiencias", "Comida", "Transporte local"]) {
      expect(old.text).toContain(`- ${cat}: — [NO DISPONIBLE] (`);
    }
    expect(old.text).toContain("sin precio confiable: no suma al total");
    // La página, con las funciones de "Comprar", sí ve los precios.
    const r = request(t, CHOSEN);
    expect(r.payload!.items.find((i) => i.kind === "vuelo")!.price).toBe(21238);
    expect(r.payload!.items.find((i) => i.kind === "hospedaje")!.price).toBe(41031);
  });

  it("analizar-viaje ya no manda correo al crear ni al re-cotizar el viaje", () => {
    const src = readFileSync("supabase/functions/analizar-viaje/index.ts", "utf8");
    expect(src).not.toMatch(/tripQuoteEmail\(|sendEmail\(|buildQuoteEmailInput\(|EdgeRuntime\.waitUntil/);
    expect(src).not.toMatch(/from "\.\.\/_shared\/email\.ts"/);
  });

  it("con los mismos datos, el correo de selección lleva los precios en vivo y ninguna fila NO DISPONIBLE", () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const v = validateSelectionRequest({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, { trip: CASO_PRA_CREADO, now: PRA_NOW });
    expect(v.ok).toBe(true);
    const m = selectionEmail((v as any).input);
    expect(m.text).toContain("$21,238 MXN (1 persona) [EN VIVO · Google Flights");
    expect(m.text).toContain("$41,031 MXN (9 noches · $4,559 MXN por noche) [EN VIVO · Google Hotels");
    for (const out of [m.text, visible(m.html)]) {
      expect(out.toLowerCase()).not.toContain("no disponible");
      expect(out).not.toContain("sin precio confiable");
    }
  });
});

describe("sin selección no hay envío", () => {
  it("el botón dice 'Elige tu vuelo y hotel…' y no hay petición", () => {
    const r = request(CASO_PRA_CREADO, NONE);
    expect(r.ready).toBe(false);
    expect(r.payload).toBeNull();
    expect(r.missing).toEqual(["tu vuelo", "tu hotel"]);
    expect(NOT_READY_LABEL).toBe("Elige tu vuelo y hotel para enviarte el resumen");
    expect(SEND_LABEL).toBe("Enviarme mi selección por correo");
    // Solo el vuelo elegido todavía no basta: falta el hotel.
    expect(request(CASO_PRA_CREADO, { ...NONE, selVuelo: 1 }).missing).toEqual(["tu hotel"]);
  });

  it("el servidor tampoco manda nada sin vuelo ni hotel (aunque llegue una petición a mano)", async () => {
    const { d, sent } = deps(CASO_PRA_CREADO);
    const res = await handleSelectionEmail({ trip_id: CASO_PRA_CREADO.id, travelers: 1, total: 0, items: [] }, d);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("sin_seleccion");
    const onlyTour = await handleSelectionEmail({ trip_id: CASO_PRA_CREADO.id, travelers: 1, total: 1450,
      items: [{ kind: "actividad", index: 0, key: "actividad:0:x", price: 1450 }] }, d);
    expect(onlyTour.body.code).toBe("sin_seleccion");
    expect(sent).toHaveLength(0);
    expect(d.send).not.toHaveBeenCalled();
  });
});

describe("con selección solo va lo elegido", () => {
  it("vuelo, hotel y experiencia elegidos; nada de las otras opciones", async () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const { d, sent } = deps(CASO_PRA_CREADO);
    const res = await handleSelectionEmail({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, d);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("dueno@example.com");
    const { text, html } = sent[0];
    expect(text).toContain("VUELO: Air France");
    expect(text).toContain("Directo");
    expect(text).toContain(": Pullman Paris Tour Eiffel");
    expect(text).toContain("EXPERIENCIA: Museo del Louvre con acceso prioritario");
    for (const no of ["Delta", "Aeroméxico", "San Régis", "L'In", "Crucero por el Sena", "Le Comptoir", "Bouillon", "Renta de auto"]) {
      expect(text).not.toContain(no);
      expect(visible(html)).not.toContain(no);
    }
    // Botón de compra precargado de cada cosa (los mismos enlaces de "Comprar") y su estado.
    expect(text).toMatch(/Comprar en Google Flights: https:\/\/www\.google\.com\/travel\/flights\?/);
    expect(text).toMatch(/Comprar en Booking\.com: https:\/\/www\.booking\.com\/searchresults\.html\?ss=Pullman/);
    expect(text).toContain("Va precargado: “Pullman Paris Tour Eiffel");
    expect(text.match(/Pendiente de comprar/g)).toHaveLength(3);
    expect(html).toContain('href="https://www.booking.com/searchresults.html?ss=Pullman');
  });

  it("restaurantes y auto solo si los marcó; 'Ya lo compré' solo con marca real", async () => {
    const marks = new Set(["restaurante:1:bouillon chartier", "hospedaje:0:pullman paris tour eiffel"]);
    const r = request(CASO_PRA_CREADO, CHOSEN, { marks });
    const restaurants = r.payload!.items.filter((i) => i.kind === "restaurante");
    expect(restaurants.map((i) => i.index)).toEqual([1]);
    // El cliente dice "comprado" también del vuelo, pero el servidor no tiene marca: va pendiente.
    const tampered = { ...r.payload!, items: r.payload!.items.map((i) => (i.kind === "vuelo" ? { ...i, bought: true } : i)) };
    const { d, sent } = deps(CASO_PRA_CREADO, { marks: async () => ({ keys: marks, confirmed: [] }) });
    await handleSelectionEmail({ ...tampered, trip_id: CASO_PRA_CREADO.id }, d);
    const text = sent[0].text;
    expect(text).toContain("RESTAURANTE: Bouillon Chartier");
    expect(text).toContain("Ya lo reservé");
    expect(text).not.toContain("Le Comptoir");
    const flightBlock = text.slice(text.indexOf("VUELO:"), text.indexOf("HOTEL"));
    expect(flightBlock).toContain("Pendiente de comprar");
    const hotelBlock = text.slice(text.indexOf("HOTEL"), text.indexOf("EXPERIENCIA"));
    expect(hotelBlock).toContain("Ya lo compré");
  });

  it("los nombres los pone el servidor y los enlaces pasan la lista blanca", () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const bad = { ...r.payload!, trip_id: CASO_PRA_CREADO.id, items: r.payload!.items.map((i) => (i.kind === "vuelo"
      ? { ...i, title: "Vuelo gratis", url: "https://evil.example.com/login" } : i.kind === "hospedaje" ? { ...i, url: "javascript:alert(1)" } : i)) };
    const v = validateSelectionRequest(bad, { trip: CASO_PRA_CREADO, now: PRA_NOW });
    expect(v.ok).toBe(true);
    const m = selectionEmail((v as any).input);
    expect(m.text).not.toContain("evil.example.com");
    expect(m.html).not.toContain("javascript:");
    expect(m.text).not.toContain("Vuelo gratis");
    expect(m.text).toContain("VUELO: Air France");
    expect(m.text).toContain("Sin enlace de compra confiable");
  });

  it("un precio que no sale de la tarifa guardada se rechaza", () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const cheap = { ...r.payload!, trip_id: CASO_PRA_CREADO.id, total: r.payload!.total - 20000,
      items: r.payload!.items.map((i) => (i.kind === "vuelo" ? { ...i, price: 1238 } : i)) };
    expect(validateSelectionRequest(cheap, { trip: CASO_PRA_CREADO, now: PRA_NOW })).toMatchObject({ ok: false, code: "precio_no_coincide" });
  });
});

describe("el total es el de la página", () => {
  it("un destino, 1 persona: mismo total que RealTripTotal", () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    expect(r.page.total).toBe(21238 + 41031 + 1450 + 4500);
    const v = validateSelectionRequest({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, { trip: CASO_PRA_CREADO, now: PRA_NOW });
    const m = selectionEmail((v as any).input);
    expect(m.text).toContain(`TOTAL PARA 1 PERSONA: ${money(r.page.total)}`);
    expect(visible(m.html)).toContain("Total para 1 persona");
    expect(visible(m.html)).toContain("$68,219");
    // Lo estimado que también suma (extras de la cotización) va con su etiqueta, nunca "en vivo".
    expect(m.text).toContain("- Extras: $4,500 MXN [ESTIMADO · cálculo de IATOS]");
    expect(m.text).toContain(porCotizarLine(["comida", "transporte local"])!);
    expect(m.text).toContain("Por cotizar: comida y transporte local (los pagas allá).");
  });

  it("multi-destino, 2 personas: 'Total para 2 personas' y la cifra por persona, iguales a la página", () => {
    const trip = { ...CASO_PRA_MULTI, num_viajeros: 2 };
    const r = request(trip, MULTI_CHOSEN, { travelers: 2 });
    expect(r.ready).toBe(true);
    const sum = r.payload!.items.reduce((s, i) => s + (i.price ?? 0), 0) + r.payload!.estimates!.reduce((s, e) => s + e.amount, 0);
    expect(sum).toBe(r.page.total);
    const v = validateSelectionRequest({ ...r.payload, trip_id: trip.id }, { trip, now: PRA_NOW });
    expect(v.ok).toBe(true);
    const m = selectionEmail((v as any).input);
    expect(m.text).toContain(`TOTAL PARA 2 PERSONAS: ${money(r.page.total)}`);
    expect(m.text).toContain(`${money(r.page.total / 2)} por persona`);
    expect(m.subject).toBe("Tu selección: París → Roma → Atenas");
  });

  it("si el total no cuadra con lo elegido, no se manda", () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    expect(validateSelectionRequest({ ...r.payload, total: r.payload!.total + 5000, trip_id: CASO_PRA_CREADO.id }, { trip: CASO_PRA_CREADO, now: PRA_NOW }))
      .toMatchObject({ ok: false, code: "total_no_coincide" });
  });
});

describe("multi-ciudad: un hotel por ciudad", () => {
  it("París, Roma y Atenas, cada uno con sus noches y su precio", () => {
    const r = request(CASO_PRA_MULTI, MULTI_CHOSEN);
    const v = validateSelectionRequest({ ...r.payload, trip_id: CASO_PRA_MULTI.id }, { trip: CASO_PRA_MULTI, now: PRA_NOW });
    expect(v.ok).toBe(true);
    const input = (v as any).input;
    expect(input.hotels.map((h: any) => [h.city, h.title, h.nights, h.price])).toEqual([
      ["París", "Pullman Paris Tour Eiffel", 3, 4559 * 3],
      ["Roma", "Hotel Artemide", 3, 3900 * 3],
      ["Atenas", "Hotel Grande Bretagne", 3, 16800 * 3],
    ]);
    const m = selectionEmail(input);
    expect(m.text).toContain("HOTEL EN PARÍS · 3 noches: Pullman Paris Tour Eiffel");
    expect(m.text).toContain("HOTEL EN ROMA · 3 noches: Hotel Artemide");
    expect(m.text).toContain("HOTEL EN ATENAS · 3 noches: Hotel Grande Bretagne");
    expect(visible(m.html)).toContain("Hotel en Atenas · 3 noches");
    expect(m.text).toContain("EXPERIENCIA: Coliseo y Foro Romano");
    expect(m.text).not.toContain("Hotel Eden");
    expect(m.text).not.toContain("Electra Metropolis");
  });

  it("si falta el hotel de una ciudad, todavía no se puede enviar", () => {
    const r = request(CASO_PRA_MULTI, { ...MULTI_CHOSEN, selHoteles: { "París": 0, "Roma": 3 } });
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual(["hotel en Atenas"]);
  });

  it("dos hoteles en la misma ciudad o noches que no son las de la ciudad: rechazado", () => {
    const r = request(CASO_PRA_MULTI, MULTI_CHOSEN);
    const items = r.payload!.items;
    const dup = { ...r.payload!, trip_id: CASO_PRA_MULTI.id, items: [...items, { ...items.find((i) => i.index === 3)!, index: 4, key: "hospedaje:4:x", price: 21500 * 3 }] };
    expect(validateSelectionRequest(dup, { trip: CASO_PRA_MULTI, now: PRA_NOW })).toMatchObject({ ok: false, code: "elemento_repetido" });
  });
});

describe("límite de envíos y destinatarios", () => {
  it(`máximo ${TRIP_SENDS_PER_HOUR} envíos por viaje y por hora; el siguiente no llama al proveedor`, async () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const { d, sent } = deps(CASO_PRA_CREADO);
    for (let i = 0; i < TRIP_SENDS_PER_HOUR; i++) expect((await handleSelectionEmail({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, d)).status).toBe(200);
    const over = await handleSelectionEmail({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, d);
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("limite_viaje");
    expect(sent).toHaveLength(TRIP_SENDS_PER_HOUR);
  });

  it("límite por persona y verificación caída: no se manda", async () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const byUser = deps(CASO_PRA_CREADO, { rateLimitUser: async () => ({ allowed: false, retryAfter: 60, scope: "user" }) });
    expect((await handleSelectionEmail({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, byUser.d)).status).toBe(429);
    const down = deps(CASO_PRA_CREADO, { hit: async () => null });
    expect((await handleSelectionEmail({ ...r.payload, trip_id: CASO_PRA_CREADO.id }, down.d)).status).toBe(503);
    expect(byUser.sent.length + down.sent.length).toBe(0);
  });

  it("solo al usuario autenticado o a miembros del viaje marcados; un correo por persona", async () => {
    const r = request(CASO_PRA_CREADO, CHOSEN);
    const body = { ...r.payload, trip_id: CASO_PRA_CREADO.id };
    // Sin sesión.
    expect((await handleSelectionEmail(body, deps(CASO_PRA_CREADO, { user: null }).d)).status).toBe(401);
    // Alguien que no es del viaje.
    const stranger = deps(CASO_PRA_CREADO, { user: { id: "otro-9", email: "x@example.com" } });
    expect((await handleSelectionEmail(body, stranger.d)).status).toBe(403);
    // Un destinatario que no es del viaje.
    const outsider = deps(CASO_PRA_CREADO);
    const res = await handleSelectionEmail({ ...body, to: "members", member_ids: ["amiga-2", "desconocido-7"] }, outsider.d);
    expect(res.status).toBe(403);
    expect(outsider.sent).toHaveLength(0);
    // A los dos miembros marcados: dos correos, cada uno con su dirección.
    const both = deps(CASO_PRA_CREADO);
    const ok = await handleSelectionEmail({ ...body, to: "members", member_ids: ["owner-1", "amiga-2"] }, both.d);
    expect(ok.body).toMatchObject({ ok: true, sent: 2 });
    expect(both.sent.map((s) => s.to)).toEqual(["dueno@example.com", "ana@example.com"]);
    expect(both.sent[1].subject).toBe("Rodrigo te comparte su selección: paris roma y atenas 10 dias");
    expect(both.sent[1].text).not.toContain("dueno@example.com");
    // Un "to" desconocido cae en "me": nunca a una dirección escrita por el cliente.
    const me = deps(CASO_PRA_CREADO);
    await handleSelectionEmail({ ...body, to: "ana@example.com", member_ids: ["amiga-2"] }, me.d);
    expect(me.sent.map((s) => s.to)).toEqual(["dueno@example.com"]);
  });

  it("la lista de miembros trae nombres, nunca correos", async () => {
    const { d } = deps(CASO_PRA_CREADO);
    const res = await handleSelectionEmail({ action: "members", trip_id: CASO_PRA_CREADO.id }, d);
    expect(res.body.members).toEqual([{ id: "owner-1", name: "Rodrigo del Castillo", you: true }, { id: "amiga-2", name: "Ana López", you: false }]);
    expect(JSON.stringify(res.body)).not.toContain("@");
  });
});

describe("formato del correo", () => {
  it("estado de cada precio: en vivo, referencia o estimado", () => {
    const at = "2026-10-23T00:49:00Z";
    expect(priceStatusOf({ fuente_precio: "serpapi", estado_dato: "CONSULTADO_EN_VIVO", consultado_at: at }, "vuelos", null, PRA_NOW).status).toBe("live");
    // En vivo de hace 3 días ya es de referencia.
    expect(priceStatusOf({ fuente_precio: "serpapi", consultado_at: "2026-10-20T00:00:00Z" }, "hospedaje", null, PRA_NOW).status).toBe("reference");
    expect(priceStatusOf({ fuente_precio: "travelpayouts", approximate_dates: true }, "vuelos", at, PRA_NOW).status).toBe("reference");
    expect(priceStatusOf({ fuente_precio: "estimado" }, "vuelos", at, PRA_NOW).status).toBe("estimate");
    expect(priceStatusOf({}, "tours", at, PRA_NOW).status).toBe("estimate");
  });

  it("HTML con estilos en línea, botón para Outlook, texto plano y secciones numeradas", () => {
    const r = request(CASO_PRA_MULTI, MULTI_CHOSEN);
    const v = validateSelectionRequest({ ...r.payload, trip_id: CASO_PRA_MULTI.id }, { trip: CASO_PRA_MULTI, now: PRA_NOW });
    const m = selectionEmail((v as any).input);
    expect(m.html).toContain("<!--[if mso]>");
    expect(m.html).toMatch(/<a href="https:\/\/traveliatos\.life\/dashboard\/viajes\/[^"]+#comprar"[^>]*style="/);
    for (const s of ["I · El viaje", "II · Tu vuelo", "III · Tus hoteles", "IV · Experiencias y reservas", "V · El total"]) expect(visible(m.html)).toContain(s);
    expect(m.text.length).toBeGreaterThan(400);
    expect(m.text).not.toMatch(/<[a-z]/i);
    expect(r.page.total).toBe(21238 + 4559 * 3 + 3900 * 3 + 16800 * 3 + 1200 + 4500);
    expect(m.preheader).toContain(`Total para 1 persona: ${money(r.page.total)} · vuelo, 3 hoteles, 1 experiencia`);
  });
});
