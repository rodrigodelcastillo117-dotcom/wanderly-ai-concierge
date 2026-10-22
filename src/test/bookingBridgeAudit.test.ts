// Cierre de auditoría (2026-10-22) · AUD-04 (destinos externos del Booking Bridge) y AUD-07 (dominio
// registrable y phishing). Cada bloque reproduce un ataque concreto contra allowlist.ts, booking-go y
// booking-links-cron. Reporte: docs/iatos/cierre/BRIDGE.md.
import { describe, expect, it } from "vitest";
import * as AL from "../../supabase/functions/_shared/booking/allowlist";
import { resolveGo } from "../../supabase/functions/booking-go/go";
import { signRedirect } from "../../supabase/functions/_shared/booking/redirectToken";
import { resolveBookingActions } from "../../supabase/functions/_shared/booking/resolver";
import { checkOne } from "../../supabase/functions/booking-links-cron/linkcheck";

const { checkAllowlisted, checkTrustedSource, looksLikeBrandImpersonation, registrableDomain } = AL;
const SECRET = "service-key-de-prueba";
const I = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const U = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-10-22T12:00:00Z");
const enc = encodeURIComponent;

/** Huella del destino tal como la firma booking-bridge: base64url(SHA-256(url)). */
async function sha(url: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url)));
  let s = "";
  for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function goWith(stored: string, claims: Record<string, unknown>) {
  const t = await signRedirect(SECRET, { i: I, u: U, o: "https://traveliatos.life", ...claims } as any, NOW);
  return resolveGo(`https://x.supabase.co/functions/v1/booking-go?t=${enc(t!)}`, {
    secret: SECRET, now: () => NOW + 1000,
    markRedirected: async () => ({ ok: true, target_url: stored, trip_id: null }),
  });
}

// ───────────────────────────── AUD-07 · dominio registrable (Public Suffix List) ─────────────────────────────

describe("AUD-07 · dominio registrable con la Public Suffix List", () => {
  it("sufijos compuestos, comodines, excepciones y dominios privados de la PSL", () => {
    const cases: Array<[string, string | null]> = [
      ["www.booking.com", "booking.com"],
      ["www.example.co.uk", "example.co.uk"],
      ["a.b.example.com.mx", "example.com.mx"],
      ["www.sat.gob.mx", "sat.gob.mx"],
      ["reservas.example.com.au", "example.com.au"],
      ["shop.example.ltd.uk", "example.ltd.uk"], // ltd.uk es sufijo público
      ["www.example.k12.ca.us", "example.k12.ca.us"], // sufijo de 3 niveles
      ["www.city.kawasaki.jp", "city.kawasaki.jp"], // !city.kawasaki.jp (excepción)
      ["a.b.kawasaki.jp", "a.b.kawasaki.jp"], // *.kawasaki.jp (comodín)
      ["foo.blogspot.com", "foo.blogspot.com"], // sección privada: cada blog es su propio dominio
      ["chef.wixsite.com", "chef.wixsite.com"],
      ["restaurante.github.io", "restaurante.github.io"],
      ["www.bücher.de", "xn--bcher-kva.de"], // Unicode → punycode
      ["xn--bcher-kva.de", "xn--bcher-kva.de"],
      ["WWW.Booking.COM.", "booking.com"], // mayúsculas y punto final
      ["co.uk", null], // un sufijo público no es un dominio registrable
      ["github.io", null],
      ["127.0.0.1", null],
      ["localhost", null],
      ["restaurante.tld-que-no-existe", null],
    ];
    for (const [host, want] of cases) expect(registrableDomain(host), host).toBe(want);
  });

  it("la copia de la PSL está fijada (fuente, versión, commit y sha256 en el archivo)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/_shared/booking/psl_data.ts", "utf8");
    expect(src).toMatch(/https:\/\/publicsuffix\.org\/list\/public_suffix_list\.dat/);
    expect(src).toMatch(/VERSION: \d{4}-\d{2}-\d{2}/);
    expect(src).toMatch(/COMMIT: [0-9a-f]{40}/);
    expect(src).toMatch(/SHA256: [0-9a-f]{64}/);
  });

  it("booking-links-cron: una redirección a OTRO sitio del mismo hosting (wixsite, github.io) es salir del dominio", async () => {
    const fetchStub = (async (u: string) => (u === "https://chef.wixsite.com/menu"
      ? new Response("", { status: 302, headers: { location: "https://pagos-chef.wixsite.com/login" } })
      : new Response("", { status: 404 }))) as unknown as typeof fetch;
    const v = await checkOne({ id: "1", url: "https://chef.wixsite.com/menu", host: "chef.wixsite.com", kind: "official_site" }, fetchStub);
    expect(v).toMatchObject({ status: "redirected_offsite", final_host: "pagos-chef.wixsite.com" });
  });

  it("booking-links-cron no sigue saltos a http, IPs ni hosts internos aunque sean del mismo sitio", async () => {
    for (const loc of ["http://chef.wixsite.com/menu", "https://169.254.169.254/latest/meta-data/", "https://localhost./"]) {
      const seen: string[] = [];
      const fetchStub = (async (u: string) => {
        seen.push(u);
        return u === "https://chef.wixsite.com/menu" ? new Response("", { status: 302, headers: { location: loc } }) : new Response("", { status: 404 });
      }) as unknown as typeof fetch;
      const v = await checkOne({ id: "1", url: "https://chef.wixsite.com/menu", host: "chef.wixsite.com", kind: "official_site" }, fetchStub);
      expect(v.status, loc).toBe("redirected_offsite");
      expect(seen, loc).not.toContain(loc);
    }
  });

  it("dominios parecidos a una marca (sustitución de letras, una letra de diferencia, otro TLD, sufijo compuesto)", () => {
    for (const h of [
      "bookingcom.ltd.uk", "b00king.com", "www.bookimg.com", "opentab1e.com", "aeromexic0.com", "vivaaerobus.co", "lufthansa-deals.com",
      "iberia-vuelos.mx", "booking.com.evil.io", "evil-booking.com", "xn--bking-gra.com", "reservas.thef0rk.es", "sevenr00ms.com",
      "resy-reservas.com", "kayak-ofertas.com",
    ]) {
      expect(looksLikeBrandImpersonation(h), h).toBe(true);
      expect(checkTrustedSource(`https://${h}/`).ok, h).toBe(false);
    }
    // Homógrafos Unicode: el parser de URL los pasa a punycode y se rechazan.
    for (const u of ["https://www.bооking.com/", "https://www.οpentable.com/", "https://www.аirbnb.com/"]) {
      expect(checkAllowlisted(u).ok, u).toBe(false);
      expect(checkTrustedSource(u).ok, u).toBe(false);
    }
  });

  it("no hay falsos positivos por subcadenas cortas de marca (sitios reales de restaurantes)", () => {
    for (const h of ["fresyogurt.com", "deltaburger.mx", "unitedtacos.com", "quintonil.com", "botin.es", "www.fourseasons.com", "pujol.com.mx"]) {
      expect(looksLikeBrandImpersonation(h), h).toBe(false);
      expect(checkTrustedSource(`https://${h}/`).ok, h).toBe(true);
    }
    // Dominios reales de marcas que no están en la lista estricta: no son "falsos".
    for (const h of ["www.expedia.com", "www.expedia.mx", "www.hotels.com", "www.tripadvisor.com.mx"]) expect(looksLikeBrandImpersonation(h), h).toBe(false);
  });

  it("proveedores legítimos de reservas pasan la lista estricta (OpenTable, Resy, SevenRooms, Tock, TheFork, Booking.com, aerolíneas)", () => {
    for (const u of [
      "https://www.opentable.com/r/rules-london", "https://www.opentable.com.mx/r/quintonil-ciudad-de-mexico", "https://www.opentable.co.uk/r/rules-london",
      "https://resy.com/cities/ny/carbone", "https://www.sevenrooms.com/reservations/carbonemiami", "https://www.exploretock.com/alinea",
      "https://www.thefork.com/restaurant/x-r1", "https://www.thefork.es/restaurante/botin-r1", "https://www.booking.com/hotel/es/urban.html",
      "https://www.aeromexico.com/es-mx", "https://www.iberia.com/mx/", "https://www.vivaaerobus.com/es-mx", "https://www.volaris.com/",
      "https://www.lufthansa.com/mx/es/homepage", "https://international.ado.com.mx/",
    ]) expect(checkAllowlisted(u).ok, u).toBe(true);
    // Expedia es real pero IATOS no arma ni recibe enlaces suyos: no entra a la lista estricta (no se inventan dominios).
    expect(checkAllowlisted("https://www.expedia.mx/Hotel-Search").reason).toBe("dominio_no_permitido");
    expect(checkTrustedSource("https://www.expedia.mx/Hotel-Search").ok).toBe(true);
  });

  it("un TLD que no existe en la PSL no es un host público", () => {
    expect(checkTrustedSource("https://restaurante.tld-que-no-existe/").ok).toBe(false);
    expect(checkTrustedSource("https://intranet.corp/").ok).toBe(false);
  });

  it("cada entrada de la lista blanca dice por qué es legítima", () => {
    for (const p of AL.PROVIDERS as any[]) {
      expect(typeof p.why === "string" && p.why.length > 10, p.domain).toBe(true);
      // El dominio declarado es exactamente un dominio registrable (o un subdominio concreto, como international.ado.com.mx).
      expect(registrableDomain(p.domain), p.domain).not.toBeNull();
    }
  });
});

// ───────────────────────────── AUD-04 · destinos externos ─────────────────────────────

describe("AUD-04 · URLs maliciosas que nunca deben salir (lista estricta y fuente confiable)", () => {
  it("esquemas, credenciales, IPs en todas sus formas, puertos, http", () => {
    for (const u of [
      "http://www.booking.com/", "javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:x", "file:///etc/passwd",
      "https://user:pass@www.booking.com/", "https://booking.com@evil.io/", "https://www.booking.com:444/",
      "https://3232235521/", "https://0x7f000001/", "https://0177.0.0.1/", "https://127.1/", "https://0x7f.0.0.1/", "https://[::1]/",
      "https://[::ffff:127.0.0.1]/", "https://[2001:db8::1]/", "https://169.254.169.254/latest/meta-data/", "https://localhost./",
      "https://127.0.0.1./", "https://metadata.google.internal/", "//evil.io/x", "https:/\\evil.io",
    ]) {
      expect(checkAllowlisted(u).ok, u).toBe(false);
      expect(checkTrustedSource(u).ok, u).toBe(false);
    }
  });

  it("caracteres de control, CRLF, barras invertidas y espacios", () => {
    for (const u of [
      "https://www.booking.com/\r\nLocation: https://evil.io", "https://www.booking.com/%0d%0a\nx", "https://www.booking.com\\@evil.io/",
      "https://www.booking.com/ x", "https://www.booking.com/\u0000", "https://www.booking.com/a\tb",
    ]) expect(checkTrustedSource(u).ok, u).toBe(false);
    // Un CRLF codificado no rompe el encabezado Location: la URL normalizada no trae CR/LF reales.
    const v = checkAllowlisted("https://www.booking.com/searchresults.html?ss=%0d%0aSet-Cookie:x");
    expect(v.ok).toBe(true);
    expect(v.url).not.toMatch(/[\r\n]/);
  });

  it("rutas de google.com: sin salir por /url, /search, ni con barras o puntos codificados", () => {
    for (const u of [
      "https://www.google.com/url?q=https://evil.io", "https://www.google.com/search?q=x", "https://www.google.com/maps/../url?q=https://evil.io",
      "https://www.google.com/travel/flights/../../url?q=https://evil.io", "https://www.google.com/maps/..%2F..%2Furl?q=https://evil.io",
      "https://www.google.com/maps%2F..%2Furl?q=https://evil.io", "https://www.google.com/travel/flights%5C..%5Curl",
      "https://www.google.com/aclk/..%2furl?q=https://evil.io", "https://maps.google.com.evil.io/maps",
    ]) expect(checkAllowlisted(u).ok, u).toBe(false);
  });

  it("cadenas de redirects: un afiliado o redirect de anuncios no puede envolver otro", () => {
    const aclk = "https://www.google.com/aclk?sa=l&adurl=" + enc("https://evil.io/pago");
    const clk = "https://www.google.com/travel/clk/f?pcurl=" + enc("https://evil.io/pago");
    for (const inner of [aclk, clk, "https://tp.media/click?u=" + enc("https://www.booking.com/"), "https://www.google.com/url?q=" + enc("https://evil.io")]) {
      expect(checkAllowlisted("https://tp.media/click?marker=1&u=" + enc(inner)).ok, inner).toBe(false);
    }
  });

  it("lo que escribió la IA o mandó el cliente no puede salir por un redirect cuyo destino final no se ve (aclk, travel/clk, tp.media)", () => {
    const aclk = "https://www.google.com/aclk?sa=l&adurl=" + enc("https://evil.io/pago");
    for (const trust of ["ai", "client"] as const) {
      const r = resolveBookingActions({ product_type: "hotel", title: "Hotel X", website: { url: aclk, trust, evidence: "EV" }, now: NOW });
      expect(r.actions.some((a) => a.url === aclk), trust).toBe(false);
      expect(r.rejected.map((x) => x.reason).join(","), trust).toMatch(/redirect/);
    }
    // El mismo enlace de precios de Google Hotels que trae SerpApi (fuente del servidor) sí se ofrece.
    const ok = resolveBookingActions({ product_type: "hotel", title: "Hotel X", website: { url: aclk, trust: "provider_api", evidence: "EV" }, now: NOW });
    expect(ok.actions.some((a) => a.url === aclk)).toBe(true);
  });
});

describe("AUD-04 · booking-go: el token queda atado al destino guardado y a su nivel de confianza", () => {
  const OFFER = "https://www.booking.com/searchresults.html?ss=Hotel+Urban+Madrid&checkin=2026-12-05&checkout=2026-12-12&group_adults=2";

  it("destino intacto: redirige", async () => {
    const r = await goWith(OFFER, { h: await sha(OFFER), t: "a" });
    expect(r).toMatchObject({ status: 302, location: OFFER, reason: "ok" });
  });

  it("si cambian el destino guardado por un dominio cualquiera (no imita marca): no redirige", async () => {
    const r = await goWith("https://pagos-seguros-reserva.com/checkout", { h: await sha(OFFER), t: "a" });
    expect(r.location).toContain("traveliatos.life");
    expect(r.reason).toBe("destino_bloqueado");
  });

  it("si cambian el destino por OTRA URL permitida (otra oferta): no redirige", async () => {
    const r = await goWith("https://www.booking.com/hotel/mx/otro-hotel.html", { h: await sha(OFFER), t: "a" });
    expect(r.reason).toBe("destino_bloqueado");
  });

  it("un destino firmado como lista estricta no se acepta por la vía 'fuente confiable'", async () => {
    const site = "https://quintonil.com/reservas";
    expect((await goWith(site, { h: await sha(site), t: "a" })).reason).toBe("destino_bloqueado");
    expect((await goWith(site, { h: await sha(site), t: "s" })).reason).toBe("ok");
  });

  it("token sin huella (emitido antes del cambio): solo la lista estricta", async () => {
    expect((await goWith("https://pagos-seguros-reserva.com/checkout", {})).reason).toBe("destino_bloqueado");
    expect((await goWith(OFFER, {})).reason).toBe("ok");
  });

  it("mejora: con lectura previa, un destino bloqueado NO marca la intención como 'salió al proveedor'", async () => {
    const t = await signRedirect(SECRET, { i: I, u: U, o: "https://traveliatos.life", h: await sha(OFFER), t: "a" }, NOW);
    let marked = 0;
    const go = (stored: string) => resolveGo(`https://x/booking-go?t=${enc(t!)}`, { secret: SECRET, now: () => NOW,
      peekTarget: async () => ({ ok: true, target_url: stored }),
      markRedirected: async () => { marked++; return { ok: true, target_url: stored }; } });
    expect((await go("https://pagos-seguros-reserva.com/x")).reason).toBe("destino_bloqueado");
    expect(marked).toBe(0);
    expect((await go(OFFER)).reason).toBe("ok");
    expect(marked).toBe(1);
  });

  it("token vencido, alterado o de otro formato: regresa a IATOS", async () => {
    const t = (await signRedirect(SECRET, { i: I, u: U, o: "https://traveliatos.life" }, NOW - 31 * 60_000))!;
    const deps = { secret: SECRET, now: () => NOW, markRedirected: async () => ({ ok: true, target_url: OFFER }) };
    expect((await resolveGo(`https://x/booking-go?t=${enc(t)}`, deps)).reason).toBe("enlace_vencido");
    expect((await resolveGo(`https://x/booking-go?t=${enc(t.slice(0, -1) + "A")}`, deps)).reason).toBe("enlace_invalido");
    expect((await resolveGo("https://x/booking-go?u=https://evil.io", deps)).location).toContain("traveliatos.life");
    // El origen firmado tampoco puede ser un dominio ajeno: safeOrigin lo reemplaza por el de IATOS.
    const t2 = (await signRedirect(SECRET, { i: I, u: U, o: "https://evil.io" }, NOW))!;
    const r = await resolveGo(`https://x/booking-go?t=${enc(t2)}`, { ...deps, markRedirected: async () => ({ ok: false, code: "NOT_FOUND" }) });
    expect(new URL(r.location).hostname).not.toBe("evil.io");
  });
});
