// Booking Bridge: lista blanca, constructores de enlaces, canales, mensajes, resolver, adaptadores,
// estados (comparados con la migración SQL), token de salida, recheck, escaneo de sitio e Iato.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkAllowlisted, checkTrustedSource, looksLikeBrandImpersonation, processorLabel } from "../../supabase/functions/_shared/booking/allowlist";
import {
  aviasalesFromTpLink, aviasalesSearchUrl, bookingSearchUrl, mapsListingUrl, parseAviasalesSearch, parseBookingSearch,
} from "../../supabase/functions/_shared/booking/links";
import {
  containsCardNumber, countryIso, mailtoLink, normalizePhone, smsLink, telLink, whatsappLink, whatsappNumberFromUrl,
} from "../../supabase/functions/_shared/booking/channels";
import { draftRequest, langForCountry, REQUEST_LANGS } from "../../supabase/functions/_shared/booking/messages";
import { resolveBookingActions } from "../../supabase/functions/_shared/booking/resolver";
import {
  bookingPageMatchesName, flightResultFromSerp, offerFromFlightResult, offerFromTripFlight, offerFromTripHotel, offerFromTripRestaurant, offerFromVenue,
  venueFromPriveRow,
} from "../../supabase/functions/_shared/booking/offers";
import { canTransition, followUpTarget, INTENT_STATES, priveStatusToIntent, reservasStatusToIntent, TRANSITIONS } from "../../supabase/functions/_shared/booking/states";
import { signRedirect, verifyRedirect } from "../../supabase/functions/_shared/booking/redirectToken";
import { comparePrice, parseFlightBookingOptions, parseHotelPrices, recheckFlight, recheckHotel } from "../../supabase/functions/_shared/booking/recheck";
import { detectReservationLinks, robotsAllows } from "../../supabase/functions/_shared/booking/siteScan";
import { findFalseClaims, IATO_PHRASES, iatoLineFor } from "../../supabase/functions/_shared/booking/iato";
import { assistedRequestTeamEmail, bookingFollowUpEmail } from "../../supabase/functions/_shared/booking/emails";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const TRIP = { id: "11111111-1111-4111-8111-111111111111", destino: "Madrid", pais_destino: "España", ciudad_origen: "Ciudad de México",
  fecha_salida: "2026-12-05", fecha_regreso: "2026-12-12", num_viajeros: 2, created_at: "2026-10-22T10:00:00Z" };

describe("lista blanca de salida (Fase 12)", () => {
  it("permite proveedores conocidos con sus rutas", () => {
    expect(checkAllowlisted("https://www.aviasales.com/search/MEX0512MAD12122?marker=533299").ok).toBe(true);
    expect(checkAllowlisted("https://www.google.com/travel/flights?q=x").ok).toBe(true);
    expect(checkAllowlisted("https://www.opentable.com.mx/r/quintonil-ciudad-de-mexico").ok).toBe(true);
    expect(checkAllowlisted("https://wa.me/525512345678?text=hola").ok).toBe(true);
  });
  it("rechaza google.com fuera de Flights/Hotels/Maps (búsqueda genérica)", () => {
    expect(checkAllowlisted("https://www.google.com/search?q=hotel").ok).toBe(false);
    expect(checkAllowlisted("https://www.google.com/url?q=https://evil.example").ok).toBe(false);
  });
  it("rechaza http, credenciales, IPs, puertos y esquemas peligrosos", () => {
    for (const u of ["http://www.booking.com/", "https://user:pw@www.booking.com/", "https://127.0.0.1/x", "https://www.booking.com:8443/",
      "javascript:alert(1)", "data:text/html,hi", "https://localhost/x", "https://www.booking.com/\nset-cookie"]) {
      expect(checkTrustedSource(u).ok, u).toBe(false);
    }
  });
  it("tp.media solo si su destino también está permitido (sin redirect abierto vía afiliado)", () => {
    const good = "https://tp.media/click?marker=533299.hotels&u=" + encodeURIComponent("https://www.booking.com/searchresults.html?ss=Madrid");
    const bad = "https://tp.media/click?marker=533299.hotels&u=" + encodeURIComponent("https://evil.example/phish");
    expect(checkAllowlisted(good).ok).toBe(true);
    expect(checkAllowlisted(bad).ok).toBe(false);
    expect(processorLabel(good)).toBe("Booking.com");
  });
  it("detecta dominios que imitan marcas (aunque vengan de una fuente)", () => {
    for (const h of ["booking.com.reservas-mx.io", "opentable-mx.com", "secure-booking.net", "xn--bking-gra.com", "aviasales-ofertas.com"]) {
      expect(looksLikeBrandImpersonation(h), h).toBe(true);
      expect(checkTrustedSource(`https://${h}/x`).ok, h).toBe(false);
    }
    expect(checkTrustedSource("https://quintonil.com").ok).toBe(true);
    // Un dominio de proveedor conocido no entra como "fuente confiable" fuera de sus rutas permitidas.
    expect(checkTrustedSource("https://www.google.com/url?q=https://evil.example").ok).toBe(false);
    expect(checkTrustedSource("https://tp.media/click?u=" + encodeURIComponent("https://evil.example")).ok).toBe(false);
    expect(checkTrustedSource("https://www.fourseasons.com/mexico/dining/").ok).toBe(true);
  });
});

describe("constructores de enlaces documentados", () => {
  it("Aviasales: mismo formato que el ejemplo de Travelpayouts (/search/MAD2807BCN26081)", () => {
    const u = aviasalesSearchUrl({ origin: "MAD", destination: "BCN", depart: "2023-07-28", ret: "2023-08-26", adults: 1 }, "533299");
    expect(u).toBe("https://www.aviasales.com/search/MAD2807BCN26081?marker=533299");
    expect(parseAviasalesSearch(u!)).toEqual({ origin: "MAD", destination: "BCN", depart: "2807", ret: "2608", adults: 1 });
    expect(aviasalesSearchUrl({ origin: "MEX", destination: "MEX", depart: "2026-12-05", adults: 1 })).toBeNull();
    expect(aviasalesSearchUrl({ origin: "MEX", destination: "MAD", depart: "2026-02-30", adults: 1 })).toBeNull();
    expect(aviasalesFromTpLink("/search/MAD2807BCN26081?t=IB169")).toBe("https://www.aviasales.com/search/MAD2807BCN26081?t=IB169&marker=533299");
    expect(aviasalesFromTpLink("//evil.example/x")).toBeNull();
  });
  it("Booking.com: destino, fechas y ocupantes, directo (tp.media/click responde 400)", () => {
    const u = bookingSearchUrl({ query: "Hotel Urban Madrid", checkin: "2026-12-05", checkout: "2026-12-12", adults: 3 })!;
    expect(u.startsWith("https://www.booking.com/searchresults.html?")).toBe(true);
    expect(parseBookingSearch(u)).toEqual({ ss: "Hotel Urban Madrid", checkin: "2026-12-05", checkout: "2026-12-12", adults: 3 });
    expect(new URL(u).searchParams.get("no_rooms")).toBe("2");
    // Un enlace viejo envuelto en tp.media se sigue pudiendo leer (para comparar fechas).
    expect(parseBookingSearch("https://tp.media/click?marker=1.hotels&u=" + encodeURIComponent(u))?.checkin).toBe("2026-12-05");
    expect(bookingSearchUrl({ query: "x", checkin: "2026-12-12", checkout: "2026-12-05", adults: 1 })).toBeNull();
  });
  it("Google Maps URLs: query_place_id evita homónimos", () => {
    const u = new URL(mapsListingUrl("Botín, Madrid", "ChIJx5Rc1n0oQg0R5B1hVIKdWUU")!);
    expect(u.pathname).toBe("/maps/search/");
    expect(u.searchParams.get("api")).toBe("1");
    expect(u.searchParams.get("query_place_id")).toBe("ChIJx5Rc1n0oQg0R5B1hVIKdWUU");
    expect(new URL(mapsListingUrl("Botín", "<script>")!).searchParams.get("query_place_id")).toBeNull();
  });
});

describe("canales oficiales: teléfono E.164 y enlaces de un toque", () => {
  it.each([
    ["55 1234 5678", "MX", "+525512345678"], ["(55) 1234-5678", "MX", "+525512345678"], ["01 55 1234 5678", "MX", "+525512345678"],
    ["044 55 1234 5678", "MX", "+525512345678"], ["+52 1 55 1234 5678", "MX", "+5215512345678"], ["52 998 123 4567", "MX", "+529981234567"],
    ["06 12 34 56 78", "FR", "+33612345678"], ["+33 1 42 68 53 00", null, "+33142685300"], ["06 1234 5678", "IT", "+390612345678"],
    ["0039 06 1234 5678", null, "+390612345678"], ["913 66 42 17", "ES", "+34913664217"], ["(212) 555-0123", "US", "+12125550123"],
    ["03-1234-5678", "JP", "+81312345678"], ["020 7946 0018", "GB", "+442079460018"], ["+377 98 06 36 36", null, "+37798063636"],
    ["55 1234 5678 ext. 12", "MX", "+525512345678"],
  ])("%s (%s) → %s", (raw, c, want) => {
    const r = normalizePhone(raw, c);
    expect(r.ok && r.e164).toBe(want);
  });
  it("rechaza números sin país o imposibles", () => {
    expect(normalizePhone("55 1234 5678", null).ok).toBe(false);
    expect(normalizePhone("123", "MX").ok).toBe(false);
    expect(normalizePhone("llamar al hotel", "MX").ok).toBe(false);
    expect(normalizePhone("5512345", "MX").ok).toBe(false);
  });
  it("WhatsApp: formato oficial wa.me/<dígitos>?text= con acentos, emojis y saltos de línea", () => {
    const text = "Hola, ¿tienen mesa?\nSomos 2 🎉 — cumpleaños";
    const u = whatsappLink("525512345678", text)!;
    expect(u.startsWith("https://wa.me/525512345678?text=")).toBe(true);
    expect(new URL(u).searchParams.get("text")).toBe(text);
    expect(u).not.toMatch(/[\s#]/);
    expect(whatsappLink("+52 55", "x")).toBeNull();
    expect(whatsappNumberFromUrl("https://api.whatsapp.com/send?phone=34600111222&text=x")).toBe("34600111222");
    expect(whatsappNumberFromUrl("https://wa.me/message/ABCDEF")).toBeNull();
  });
  it("mailto (RFC 6068): CRLF y UTF-8; sms y tel con +", () => {
    const m = mailtoLink("reservas@botin.es", "Reserva · Botín", "Hola\nSomos 2 ñandúes")!;
    expect(m).toContain("subject=Reserva%20%C2%B7%20Bot%C3%ADn");
    expect(m).toContain("Hola%0D%0ASomos");
    expect(decodeURIComponent(m.split("body=")[1])).toBe("Hola\r\nSomos 2 ñandúes");
    expect(mailtoLink("no-es-correo", "a", "b")).toBeNull();
    expect(telLink("+34913664217")).toBe("tel:+34913664217");
    expect(smsLink("+34600111222", "Hola ñ")).toBe("sms:+34600111222?body=Hola%20%C3%B1");
  });
  it("país ISO desde trips.pais_destino; detección de tarjetas (Luhn)", () => {
    expect(countryIso("España")).toBe("ES");
    expect(countryIso("Japón")).toBe("JP");
    expect(countryIso("mx")).toBe("MX");
    expect(containsCardNumber("pagué con 4111 1111 1111 1111")).toBe(true);
    expect(containsCardNumber("itinerario Expedia 7301234567891")).toBe(false);
    expect(containsCardNumber("folio ABC123")).toBe(false);
  });
});

describe("mensaje de solicitud (6 idiomas)", () => {
  const input = { venue: "Botín", product_type: "restaurant" as const, date: "2026-12-06", time: "20:00", party_size: 2, names: "Ana López",
    occasion: "aniversario", dietary: "sin gluten" };
  it.each(REQUEST_LANGS)("%s incluye lugar, fecha local, hora y personas", (lang) => {
    const d = draftRequest(input, lang);
    expect(d.body).toContain("Botín");
    expect(d.body).toContain("20:00");
    expect(d.body).toContain(lang === "ja" ? "2名" : "2");
    expect(d.body).toContain("Ana López");
    expect(d.subject).toContain("Botín");
    expect(d.call_script.length).toBeGreaterThanOrEqual(3);
    expect(d.body).not.toMatch(/confirmad|confirmed|confermat|confirmé|予約完了/i);
  });
  it("fecha sin corrimiento de zona y en el idioma del lugar", () => {
    expect(draftRequest(input, "es").body).toContain("domingo, 6 de diciembre de 2026");
    expect(draftRequest(input, "fr").body).toContain("dimanche 6 décembre 2026");
    expect(langForCountry("IT")).toBe("it");
    expect(langForCountry("JP")).toBe("ja");
    expect(langForCountry("US")).toBe("en");
  });
  it("la firma de IATOS es opcional", () => {
    expect(draftRequest(input, "es").body).not.toContain("IATOS");
    expect(draftRequest({ ...input, sign_iatos: true }, "es").body).toContain("Enviado con IATOS");
  });
});

describe("BookingActionResolver: orden y textos del dueño", () => {
  it("ordena 1→7 y solo el nivel 1 dice 'Comprar esta oferta'", () => {
    const r = resolveBookingActions({
      product_type: "flight", title: "AM 1", now: NOW, flags: { exact_flight_form: true },
      exact: [{ url: null, form: { action: "https://www.google.com/travel/clk/f", fields: [["u", "abc"]] }, checked_at: "2026-10-22T11:30:00Z", trust: "provider_api", evidence: "x", seller: "Aeroméxico" }],
      searches: [{ url: aviasalesSearchUrl({ origin: "MEX", destination: "MAD", depart: "2026-12-05", adults: 1 }), trust: "builder", evidence: "x" }],
      maps: { query: "AICM" },
    });
    expect(r.actions.map((a) => a.kind)).toEqual(["exact_offer", "equivalent_search", "maps_listing", "save_for_later"]);
    expect(r.actions[0].label).toBe("Comprar esta oferta");
    expect(r.actions[1].label).toBe("Buscar este vuelo");
    expect(r.booking_mode).toBe("EXACT_DEEP_LINK");
    expect(r.actions.filter((a) => a.label === "Comprar esta oferta")).toHaveLength(1);
    expect(r.actions[1].disclosures).toContain("El precio puede cambiar al continuar en el proveedor.");
  });
  it("una búsqueda nunca se presenta como oferta exacta (PROVIDER_SEARCH)", () => {
    const r = resolveBookingActions({ product_type: "hotel", title: "H", now: NOW,
      searches: [{ url: bookingSearchUrl({ query: "H Madrid", checkin: "2026-12-05", checkout: "2026-12-07", adults: 2 }), trust: "builder", evidence: "x",
        preserves: { product: false, dates: true, travelers: true, room_or_fare: false } }] });
    expect(r.primary?.mode).toBe("PROVIDER_SEARCH");
    expect(r.primary?.label).toBe("Ver tarifas del hotel");
    expect(r.primary?.disclosures.join(" ")).toMatch(/habitación ni la tarifa exactas/);
  });
  it("oferta exacta vencida: no se ofrece y se pide comprobar precio", () => {
    const r = resolveBookingActions({ product_type: "flight", title: "x", now: NOW, flags: { exact_flight_form: true },
      exact: [{ url: null, form: { action: "https://www.google.com/travel/clk/f", fields: [["u", "a"]] }, checked_at: "2026-10-21T00:00:00Z", trust: "provider_api", evidence: "x" }] });
    expect(r.exact_expired).toBe(true);
    expect(r.actions.some((a) => a.kind === "exact_offer")).toBe(false);
  });
  it("sin bandera no hay compra exacta por formulario (no verificada en vivo)", () => {
    const r = resolveBookingActions({ product_type: "flight", title: "x", now: NOW,
      exact: [{ url: null, form: { action: "https://www.google.com/travel/clk/f", fields: [["u", "a"]] }, checked_at: "2026-10-22T11:59:00Z", trust: "provider_api", evidence: "x" }] });
    expect(r.actions.some((a) => a.kind === "exact_offer")).toBe(false);
  });
  it("ningún canal aparece sin fuente verificada", () => {
    const r = resolveBookingActions({ product_type: "restaurant", title: "Botín", country: "ES", now: NOW,
      whatsapp: { value: "34600111222", verified_by: "", trust: "client" }, phone: { value: "913664217", verified_by: "", trust: "client" } });
    expect(r.actions.some((a) => ["whatsapp", "phone", "sms", "email"].includes(a.kind))).toBe(false);
  });
  it("un enlace tp.media (responde 400) se abre directo en su destino permitido", () => {
    const inner = "https://www.omio.com/search?fromCity=Cancun&toCity=Tulum";
    const r = resolveBookingActions({ product_type: "transport", title: "Bus", now: NOW,
      searches: [{ url: "https://tp.media/click?marker=533299.bus&u=" + encodeURIComponent(inner), trust: "ai", evidence: "x" }] });
    expect(r.primary?.url).toBe(inner);
    expect(r.primary?.label).toBe("Buscar boletos");
  });
  it("URL de la IA a un dominio no permitido se descarta (con motivo)", () => {
    const r = resolveBookingActions({ product_type: "restaurant", title: "x", now: NOW,
      official_booking: [{ url: "https://iatos.ai/", trust: "ai", evidence: "x" }] });
    expect(r.actions.some((a) => a.kind === "official_booking_page")).toBe(false);
    expect(r.rejected[0]).toEqual({ url: "https://iatos.ai/", reason: "dominio_no_permitido" });
  });
});

describe("adaptadores sobre lo que IATOS ya tiene", () => {
  it("vuelo del viaje con fechas viejas: se descarta el enlace y se arma la búsqueda con las fechas del viaje (cambio de fechas)", () => {
    const v = { aerolinea: "Iberia", booking_link: "https://www.aviasales.com/search/MEX0111MAD08111?marker=533299", fuente_precio: "travelpayouts", precio_por_persona: 21000 };
    const o = offerFromTripFlight(v, { trip: TRIP, now: NOW });
    expect(o.rejected.map((x) => x.reason)).toContain("fechas_o_viajeros_distintos_al_viaje");
    const s = o.actions.find((a) => a.kind === "equivalent_search")!;
    expect(s.url).toBe("https://www.aviasales.com/search/MEX0512MAD12122?marker=533299");
    expect(o.price).toBe(42000);
    expect(o.booking_mode).toBe("PROVIDER_SEARCH");
  });
  it("vuelo sin enlace ni aeropuertos: no se inventa una búsqueda", () => {
    const o = offerFromTripFlight({ aerolinea: "Iberia", fuente_precio: "travelpayouts" }, { trip: TRIP, now: NOW });
    expect(o.actions.map((a) => a.kind)).toEqual(["save_for_later"]);
    expect(o.booking_mode).toBe("UNAVAILABLE");
  });
  it("vuelo estimado: avisa que el precio es una estimación", () => {
    const o = offerFromTripFlight({ aerolinea: "Volaris", fuente_precio: "estimado", precio_por_persona: 5000,
      booking_link: "https://www.aviasales.com/search/MEX0512MAD12122?marker=533299" }, { trip: TRIP, now: NOW });
    expect(o.price_is_estimate).toBe(true);
    expect(o.actions[0].disclosures.join(" ")).toMatch(/estimación/);
  });
  it("hotel del viaje: enlace de Booking con otras fechas → no se usa; búsqueda con fechas y huéspedes del viaje", () => {
    const h = { nombre: "Hotel Urban", fuente_precio: "serpapi", precio_por_noche: 4000,
      booking_url: bookingSearchUrl({ query: "Hotel Urban Madrid", checkin: "2026-11-01", checkout: "2026-11-03", adults: 2 }) };
    const o = offerFromTripHotel(h, { trip: TRIP, now: NOW });
    expect(o.rejected.map((x) => x.reason)).toContain("fechas_o_viajeros_distintos_al_viaje");
    expect(parseBookingSearch(o.actions[0].url!)).toMatchObject({ checkin: "2026-12-05", checkout: "2026-12-12", adults: 2 });
    expect(o.price).toBe(4000 * 7); // precio en vivo = grupo completo (hotelPriceRooms)
  });
  it("restaurante homónimo: un OpenTable de la IA que no nombra al lugar se rechaza", () => {
    expect(bookingPageMatchesName("https://www.opentable.com/r/botin-madrid", "Botín")).toBe(true);
    expect(bookingPageMatchesName("https://www.opentable.com/r/casa-botin-miami", "Sobrino de Botín")).toBe(false);
    const o = offerFromTripRestaurant({ nombre: "Sobrino de Botín", cta_action: "https://www.opentable.com/r/casa-botin-miami" }, { trip: TRIP, now: NOW });
    expect(o.rejected[0].reason).toBe("no_coincide_con_el_lugar");
    expect(o.actions[0].kind).toBe("equivalent_search"); // "Buscar mesa" (búsqueda), no "Abrir reservas"
    expect(o.actions[0].label).toBe("Buscar mesa");
  });
  it("lugar del catálogo Privé: abre su página pública de reservas (Tock) y ofrece solicitud asistida", () => {
    const venue = venueFromPriveRow({ id: "e1", slug: "cdmx-quintonil", name: "Quintonil", website: "https://quintonil.com",
      booking_url: "https://www.exploretock.com/quintonil", booking_method: "tock", verified_at: "2026-10-22" }, "Ciudad de México", "MX");
    const o = offerFromVenue(venue, "restaurant", { now: NOW });
    expect(o.actions[0]).toMatchObject({ kind: "official_booking_page", label: "Abrir reservas", processor: "Tock", mode: "PROVIDER_SEARCH" });
    expect(o.actions[0].disclosures.join(" ")).toMatch(/no garantiza disponibilidad/);
    expect(o.actions.map((a) => a.kind)).toEqual(["official_booking_page", "official_website", "maps_listing", "prive_request", "save_for_later"]);
    expect(o.actions.find((a) => a.kind === "equivalent_search")).toBeUndefined();
  });
  it("WhatsApp del catálogo (wa.me curado) = WhatsApp verificado con mensaje listo", () => {
    const venue = venueFromPriveRow({ id: "e2", slug: "tulum-x", name: "Casa X", booking_url: "https://wa.me/529841234567" }, "Tulum", "MX");
    const o = offerFromVenue(venue, "restaurant", { now: NOW, draft: { venue: "Casa X", product_type: "restaurant", lang: "es", date: "2026-12-06", time: "21:00", party_size: 4 } });
    const wa = o.actions.find((a) => a.kind === "whatsapp")!;
    expect(wa.label).toBe("Escribir por WhatsApp");
    expect(wa.channel?.verified_by).toMatch(/Catálogo/);
    expect(decodeURIComponent(wa.url!.split("text=")[1])).toContain("4 personas");
  });
  it("teléfono de Google: se puede llamar, pero no se ofrece WhatsApp (no está verificado)", () => {
    const o = offerFromVenue({ name: "Botín", city: "Madrid", country: "ES", phone: "913 66 42 17", source: "google_places", place_id: "ChIJx5Rc1n0oQg0R5B1hVIKdWUU" }, "restaurant", { now: NOW });
    expect(o.actions.find((a) => a.kind === "phone")?.url).toBe("tel:+34913664217");
    expect(o.actions.find((a) => a.kind === "whatsapp")).toBeUndefined();
    expect(o.actions.find((a) => a.kind === "maps_listing")?.url).toContain("query_place_id=");
  });
  it("enlace de reservas marcado roto por la revisión periódica: no se ofrece (link roto)", () => {
    const venue = venueFromPriveRow({ name: "Y", booking_url: "https://www.opentable.com/r/y", booking_url_status: "broken" }, "Madrid", "ES");
    expect(venue.booking_url).toBeNull();
  });
  it("resultado de Google Flights (SerpApi): búsqueda exacta de Google + Aviasales; recheck posible por booking_token", () => {
    const item = { flights: [{ airline: "Aeroméxico", flight_number: "AM 1", departure_airport: { id: "MEX", time: "2026-12-05 23:55" }, arrival_airport: { id: "MAD", time: "2026-12-06 18:00" } }],
      total_duration: 605, price: 1850, booking_token: "WyJDalJJ" };
    const r = flightResultFromSerp(item, 2);
    const o = offerFromFlightResult(r, { dep_iata: "MEX", arr_iata: "MAD", depart: "2026-12-05", return_date: "2026-12-12", travelers: 2, consulted_at: "2026-10-22T11:00:00Z",
      source: "serpapi", google_flights_url: "https://www.google.com/travel/flights?tfs=CBwQAho" }, { now: NOW });
    expect(o.actions[0]).toMatchObject({ kind: "recheck_price", label: "Comprobar precio" });
    expect(o.actions.filter((a) => a.kind === "equivalent_search").map((a) => a.processor)).toEqual(["Google Flights", "Aviasales"]);
    expect(o.recheckable).toBe(true);
    expect(o.price).toBe(1850);
  });
});

describe("estados: la tabla TS es la misma que la de la migración SQL", () => {
  it("mismas transiciones", () => {
    const sql = readFileSync("supabase/migrations/20261023180000_booking_bridge.sql", "utf8");
    const block = sql.slice(sql.indexOf("FUNCTION public.booking_intent_transition_ok"), sql.indexOf("$$;", sql.indexOf("FUNCTION public.booking_intent_transition_ok")));
    const pairs = new Set(Array.from(block.matchAll(/\('([A-Z_]+)','([A-Z_]+)'\)/g)).map((m) => `${m[1]}>${m[2]}`));
    const ts = new Set(INTENT_STATES.flatMap((f) => TRANSITIONS[f].map((t) => `${f}>${t}`)));
    expect([...pairs].sort()).toEqual([...ts].sort());
  });
  it("un clic nunca confirma; lo declarado queda como user_declared", () => {
    expect(canTransition("SELECTED", "CONFIRMED")).toBe(false);
    expect(followUpTarget("REDIRECTED_TO_PROVIDER", "completed")).toEqual({ to: "PENDING_CONFIRMATION", verification: "user_declared" });
    expect(followUpTarget("REDIRECTED_TO_PROVIDER", "not_completed").to).toBe("READY_TO_BOOK");
    expect(followUpTarget("REQUESTED", "not_available").to).toBe("FAILED");
  });
  it("mapeos de Privé y Reservas IA (un estado desconocido queda pendiente, nunca confirmado)", () => {
    expect(priveStatusToIntent("confirmado_externamente")).toBe("CONFIRMED");
    expect(priveStatusToIntent("solicitado")).toBe("REQUESTED");
    expect(reservasStatusToIntent("alternative_offered")).toBe("PENDING_CONFIRMATION");
    expect(reservasStatusToIntent("algo_nuevo")).toBe("PENDING_CONFIRMATION");
  });
});

describe("token de salida firmado (sin open redirects)", () => {
  const I = "22222222-2222-4222-8222-222222222222", U = "33333333-3333-4333-8333-333333333333";
  it("verifica, caduca y rechaza manipulaciones", async () => {
    const t = (await signRedirect("secreto", { i: I, u: U, o: "https://traveliatos.life" }, NOW))!;
    expect(await verifyRedirect("secreto", t, NOW + 1000)).toMatchObject({ ok: true, claims: { i: I, u: U } });
    expect(await verifyRedirect("secreto", t, NOW + 31 * 60_000)).toEqual({ ok: false, reason: "vencido" });
    expect(await verifyRedirect("otro", t, NOW)).toEqual({ ok: false, reason: "firma" });
    const [body, sig] = t.split(".");
    const forged = btoa(JSON.stringify({ i: I, u: "44444444-4444-4444-8444-444444444444", o: "x", x: NOW + 9e9 })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    expect((await verifyRedirect("secreto", `${forged}.${sig}`, NOW)).ok).toBe(false);
    expect((await verifyRedirect("secreto", `${body}.${sig.slice(0, -1)}A`, NOW)).ok).toBe(false);
  });
});

// Respuestas con la forma documentada por SerpApi (Booking Options y Property Details).
const BOOKING_OPTIONS = {
  booking_options: [
    { together: { book_with: "Aeroméxico", airline: true, price: 1910, option_title: "Básica", extensions: ["1 artículo personal"],
      booking_request: { url: "https://www.google.com/travel/clk/f", post_data: "u=EhwQAhoC&src=1" } } },
    { together: { book_with: "Expedia", price: 1875, booking_request: { url: "https://evil.example/clk", post_data: "u=x" } } },
    { separate_tickets: true, departing: { book_with: "A", price: 900 }, returning: { book_with: "B", price: 900 } },
  ],
};
const PROPERTY = {
  featured_prices: [{ source: "Booking.com", link: "https://www.google.com/aclk?sa=l&ai=abc", official: false, total_rate: { extracted_lowest: 1400 },
    rooms: [{ name: "Doble Superior", link: "https://www.google.com/aclk?sa=l&ai=room1", total_rate: { extracted_lowest: 1550 } }] }],
  prices: [{ source: "Hotel Urban", link: "https://www.hotelurban.com/es/reservar", official: true, total_rate: { extracted_lowest: 1380 } }],
};

describe("comprobar precio con la fuente original", () => {
  it("opciones de compra de Google Flights: solo vendedores con booking_request de Google; boletos separados no", () => {
    const o = parseFlightBookingOptions(BOOKING_OPTIONS);
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ seller: "Aeroméxico", price: 1910, form: { action: "https://www.google.com/travel/clk/f", fields: [["u", "EhwQAhoC"], ["src", "1"]] } });
    expect(o[1].form).toBeNull(); // dominio no permitido
  });
  it("precio diferente: se informa la diferencia", () => {
    expect(comparePrice(1850, 1875)).toMatchObject({ changed: true, direction: "up", delta: 25 });
    expect(comparePrice(1850, 1855)).toMatchObject({ changed: false, direction: "same" });
  });
  it("recheck de vuelo: llamada en vivo (no_cache) y precio más bajo de las opciones", async () => {
    let called = "";
    const res = await recheckFlight({ booking_token: "tok", origin: "MEX", destination: "MAD", depart: "2026-12-05", return_date: "2026-12-12", adults: 2, old_price: 1850 },
      { serpKey: "k", serpFetch: (async (u: string) => { called = u; return new Response(JSON.stringify(BOOKING_OPTIONS), { status: 200 }); }) as any, now: () => NOW });
    expect(new URL(called).searchParams.get("no_cache")).toBe("true");
    expect(res).toMatchObject({ ok: true, price: 1875, availability: "available_at_check", price_change: { direction: "up" } });
  });
  it("hotel agotado y habitación incorrecta", async () => {
    const sold = await recheckHotel({ property_token: "p", q: "Hotel Urban Madrid", checkin: "2026-12-05", checkout: "2026-12-07", adults: 2 },
      { serpKey: "k", serpFetch: (async () => new Response(JSON.stringify({ featured_prices: [], prices: [] }), { status: 200 })) as any });
    expect(sold).toMatchObject({ ok: true, availability: "sold_out", price: null });
    expect(parseHotelPrices(PROPERTY, "Suite Junior").room_match).toBe("mismatch");
    const m = parseHotelPrices(PROPERTY, "doble superior");
    expect(m.room_match).toBe("match");
    expect(m.options.find((x) => x.room)?.url).toBe("https://www.google.com/aclk?sa=l&ai=room1");
    // El sitio oficial (dominio fuera de la lista estricta) no se toma de una respuesta: sin enlace.
    expect(m.options.find((x) => x.seller === "Hotel Urban")).toBeUndefined();
  });
  it("proveedor caído, límite del plan y sin llave", async () => {
    const env = (r: Response) => ({ serpKey: "k", serpFetch: (async () => r) as any });
    const q = { booking_token: "t", origin: "MEX", destination: "MAD", depart: "2026-12-05", adults: 1 };
    expect(await recheckFlight(q, env(new Response("", { status: 500 })))).toMatchObject({ ok: false, code: "PROVIDER_DOWN" });
    expect(await recheckFlight(q, env(new Response("{}", { status: 429, headers: { "x-iatos-cache": "limit" } })))).toMatchObject({ ok: false, code: "LIVE_LIMIT" });
    expect(await recheckFlight(q, { serpKey: null })).toMatchObject({ ok: false, code: "RECHECK_UNAVAILABLE" });
    expect(await recheckFlight(q, { serpKey: "k", serpFetch: (async () => { throw new Error("net"); }) as any })).toMatchObject({ ok: false, code: "PROVIDER_DOWN" });
  });
});

describe("verificación sin scraping abusivo", () => {
  it("encuentra el botón público de reservas, WhatsApp, correo y teléfono del sitio oficial", () => {
    const html = `<a href="https://www.opentable.com.mx/r/rosetta-mexico">Reservar</a>
      <a href='https://resy.com/cities/ny/x'>Resy</a><a href="https://wa.me/5215512345678">WhatsApp</a>
      <a href="mailto:reservas@rosetta.com.mx?subject=x">Escríbenos</a><a href="tel:+52 55 5533 7804">Llámanos</a>
      <a href="https://booking.com.evil.io/r">falso</a><a href="/menu">Menú</a>`;
    const f = detectReservationLinks(html, "https://rosetta.com.mx/");
    expect(f.booking.map((b) => b.provider)).toEqual(["opentable", "resy"]);
    expect(f.whatsapp).toEqual(["5215512345678"]);
    expect(f.emails).toEqual(["reservas@rosetta.com.mx"]);
    expect(f.phones).toEqual(["+52 55 5533 7804"]);
  });
  it("respeta robots.txt (grupo propio o *; la regla más larga gana)", () => {
    const robots = "User-agent: *\nDisallow: /reservas\nAllow: /reservas/publico\n\nUser-agent: BadBot\nDisallow: /";
    expect(robotsAllows(robots, "/")).toBe(true);
    expect(robotsAllows(robots, "/reservas/mesa")).toBe(false);
    expect(robotsAllows(robots, "/reservas/publico/x")).toBe(true);
    expect(robotsAllows("User-agent: IATOSLinkCheck\nDisallow: /\n", "/")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /*.pdf$", "/menu.pdf")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow:", "/x")).toBe(true);
  });
});

describe("Iato: frases permitidas y prohibidas (Fase 9)", () => {
  it("detecta afirmaciones falsas y pedidos de tarjeta", () => {
    for (const t of ["Listo, ya compré tu vuelo", "Ya te reservé el hotel", "Tu mesa está confirmada para las 8", "Pásame el número de tu tarjeta", "¿Me das el CVV?"]) {
      expect(findFalseClaims(t).length, t).toBeGreaterThan(0);
    }
    expect(findFalseClaims("Tu reserva está confirmada por el proveedor", { confirmed: true })).toEqual([]);
    expect(findFalseClaims("dame tu tarjeta", { confirmed: true }).length).toBeGreaterThan(0);
    expect(findFalseClaims(IATO_PHRASES.rate_pending)).toEqual([]);
  });
  it("habla según la acción real de la oferta", () => {
    const venue = venueFromPriveRow({ name: "Rosetta", booking_url: "https://www.opentable.com.mx/r/rosetta-mexico" }, "Ciudad de México", "MX");
    expect(iatoLineFor(offerFromVenue(venue, "restaurant", { now: NOW }))).toContain(IATO_PHRASES.opentable);
    const fl = offerFromTripFlight({ aerolinea: "Iberia", fuente_precio: "travelpayouts", booking_link: "https://www.aviasales.com/search/MEX0512MAD12122?marker=533299" }, { trip: TRIP, now: NOW });
    expect(iatoLineFor(fl)).toMatch(/búsqueda de este vuelo.*No puedo llevar la tarifa exacta/);
    expect(findFalseClaims(iatoLineFor(fl))).toEqual([]);
  });
});

describe("correos mínimos del bridge (los restiliza el grupo emails)", () => {
  it("escapan datos y nunca dicen 'confirmada' antes de tiempo", () => {
    const a = assistedRequestTeamEmail({ title: "<b>Botín</b>", product_type: "restaurant", state: "REQUESTED", user_label: "ana@example.test", intent_id: "i1" });
    expect(a.html).toContain("&lt;b&gt;Botín&lt;/b&gt;");
    const f = bookingFollowUpEmail({ title: "Hotel Urban", product_type: "hotel", state: "REDIRECTED_TO_PROVIDER", processor: "Booking.com" });
    expect(f.html).toContain("declarada por ti");
    expect(f.html).not.toMatch(/Reserva confirmada/);
  });
});
