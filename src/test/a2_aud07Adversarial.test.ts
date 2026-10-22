// Segunda auditoría independiente (grupo bridge) · AUD-07 / AUD-04: casos adversariales nuevos.
// Las pruebas "A2-F*" documentan defectos: FALLAN con 7670102 y pasan con el diff propuesto en INFORME.md.
// Ronda r2: copiadas a la rama como regresión, más O1/O2 (endurecimientos) y falsos positivos de A2-F2.
import { describe, expect, it } from "vitest";
import { checkAllowlisted, checkTrustedSource, checkUntrusted, looksLikeBrandImpersonation, PROVIDERS, registrableDomain } from "../../supabase/functions/_shared/booking/allowlist";

const no = (u: string) => {
  expect(checkAllowlisted(u).ok, `strict ${u}`).toBe(false);
  expect(checkUntrusted(u).ok, `untrusted ${u}`).toBe(false);
  expect(checkTrustedSource(u).ok, `trusted ${u}`).toBe(false);
};

describe("A2 · AUD-07 casos que el arreglo SÍ resiste", () => {
  it("IDN homógrafos (cirílico і/а, ı sin punto), punycode mixto", () => {
    for (const u of ["https://www.bookіng.com/", "https://bookıng.com/", "https://www.аirbnb.com/", "https://xn--bookng-9wa.com/", "https://www.xn--bking-gra.com/"]) no(u);
  });
  it("credenciales, puerto, IP decimal/octal/hex, javascript:, data:, backslash", () => {
    for (const u of ["https://booking.com@evil.io/", "https://www.booking.com:8443/", "https://3232235521/", "https://0300.0250.0.1/", "https://0xC0A80001/",
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "https://evil.io\\@booking.com", "https://www.google.com/maps/%2e%2e/url?q=https://evil.io"]) no(u);
  });
  it("subdominio largo, sufijos privados, eTLD de varios niveles, marcas parecidas", () => {
    for (const u of ["https://booking.com.evil.io/", "https://www.booking.com.evil.io/", "https://booking.com.evil.test/", "https://opentable.com.mx.evil.io/",
      "https://booking.github.io/", "https://bookingcom.blogspot.com/", "https://reservas.booking.com.mx/", "https://booking.co.uk/",
      "https://bookinq.com/", "https://b00king.com/", "https://boooking.com/", "https://bokking.com/", "https://booklng.com/", "https://0pentable.com/"]) no(u);
    expect(registrableDomain("a.b.example.com.mx")).toBe("example.com.mx");
    expect(registrableDomain("a.b.co.uk")).toBe("b.co.uk");
    expect(registrableDomain("x.blogspot.com")).toBe("x.blogspot.com");
  });
  it("mayúsculas y puerto 443 explícito se normalizan (siguen siendo booking.com)", () => {
    expect(checkAllowlisted("https://WWW.BOOKING.COM:443/").url).toBe("https://www.booking.com/");
  });
});

describe("A2 · defectos encontrados", () => {
  it("A2-F1 punto final en un dominio de PROVEEDOR salta la regla 'proveedor solo con reglas estrictas' (open redirect de Google/tp.media como fuente confiable)", () => {
    for (const u of ["https://www.google.com./url?q=https://evil.io", "https://www.google.com./aclk?adurl=https://evil.io", "https://tp.media./click?u=https://evil.io"]) {
      expect(checkTrustedSource(u).ok, u).toBe(false);
    }
  });
  it("A2-F2 (heurística, P3) dominios parecidos que el detector NO marca", () => {
    const missed = ["air-bnb.com", "vlator.com", "reesy.com", "resyy.com", "googie.com", "googIe.com", "deltaairlines-mx.com", "tp-media.com"].filter((h) => !looksLikeBrandImpersonation(h));
    console.log("A2-F2 no detectados:", missed.join(", "));
    expect(missed).toEqual([]);
    for (const h of ["https://air-bnb.com/", "https://www.googIe.com/", "https://tp-media.com/click"]) expect(checkTrustedSource(h).ok, h).toBe(false);
  });
  it("A2-F2 sin falsos positivos: los dominios reales de la lista, marcas reales y restaurantes reales no se marcan", () => {
    const real = [...new Set(PROVIDERS.map((p) => p.domain))];
    for (const d of real) {
      expect(looksLikeBrandImpersonation(d), d).toBe(false);
      expect(looksLikeBrandImpersonation(`www.${d}`), `www.${d}`).toBe(false);
    }
    for (const h of ["fresyogurt.com", "deltaburger.mx", "unitedtacos.com", "quintonil.com", "botin.es", "www.fourseasons.com", "pujol.com.mx",
      "www.expedia.com", "www.expedia.mx", "www.hotels.com", "www.tripadvisor.com.mx", "hotel-delta.com", "rosy.mx", "della.com.mx", "resto.com",
      "lalibrairie.fr", "villa-italia.com", "gogole-pizza.com.mx", "kayakmexico-tours.com.mx", "maps.google.com", "sevilla.es", "lavilla.mx"]) {
      expect(looksLikeBrandImpersonation(h), h).toBe(false);
    }
  });
  it("O1 endurecimiento: solo www.google.com / google.com / maps.google.com valen para /maps, /travel y /aclk (no sites.google.com)", () => {
    for (const u of ["https://sites.google.com/maps/x", "https://sites.google.com/travel/flights?x=1", "https://sites.google.com/travel/hotels/x",
      "https://sites.google.com/aclk?adurl=https://evil.io", "https://evil.google.com/maps/search/?api=1&query=x", "https://docs.google.com/travel/clk/f?pcurl=x"]) {
      expect(checkAllowlisted(u).ok, u).toBe(false);
      expect(checkTrustedSource(u).ok, u).toBe(false);
    }
    for (const u of ["https://www.google.com/maps/search/?api=1&query=Pujol", "https://maps.google.com/maps?q=x", "https://google.com/maps/dir/?api=1",
      "https://www.google.com/travel/flights?q=x", "https://www.google.com/travel/hotels/x", "https://www.google.com/aclk?sa=l"]) {
      expect(checkAllowlisted(u).ok, u).toBe(true);
    }
  });
  it("O2 endurecimiento: doble (o triple) codificación de '/', '\\' y '.' en la ruta se rechaza", () => {
    for (const u of ["https://www.google.com/maps/%252e%252e%252furl?q=https://evil.io", "https://www.google.com/maps/%25252f..%25252furl",
      "https://www.google.com/maps/%255c%255curl", "https://www.google.com/maps/%2E%2E/url"]) {
      expect(checkAllowlisted(u).ok, u).toBe(false);
      expect(checkTrustedSource(u).ok, u).toBe(false);
    }
  });
});

import { checkOne } from "../../supabase/functions/booking-links-cron/linkcheck";
describe("A2 · booking-links-cron", () => {
  it("A2-F3 robots.txt se pide con redirect:'follow' (sigue saltos a http/IP/internos sin revisarlos)", async () => {
    const calls: Array<{ u: string; redirect?: string }> = [];
    const stub = (async (u: string, init?: RequestInit) => { calls.push({ u, redirect: init?.redirect }); return new Response("", { status: 404 }); }) as unknown as typeof fetch;
    await checkOne({ id: "1", url: "https://quintonil.com/", host: "quintonil.com", kind: "official_site" }, stub);
    console.log("A2-F3", JSON.stringify(calls));
    expect(calls.every((c) => c.redirect === "manual"), JSON.stringify(calls)).toBe(true);
  });
  it("A2-F3 robots.txt: cada salto se valida; a http, IP, host interno u otro dominio no se pide", async () => {
    for (const loc of ["http://quintonil.com/robots.txt", "https://10.0.0.1/robots.txt", "https://localhost./robots.txt", "https://metadata.internal/r",
      "https://evil.io/robots.txt", "https://quintonil.com:8443/robots.txt"]) {
      const calls: string[] = [];
      const stub = (async (u: string) => {
        calls.push(u);
        if (u === "https://quintonil.com/robots.txt") return new Response("", { status: 301, headers: { location: loc } });
        return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
      }) as unknown as typeof fetch;
      await checkOne({ id: "1", url: "https://quintonil.com/", host: "quintonil.com", kind: "official_site" }, stub);
      expect(calls, loc).not.toContain(loc);
    }
    // Un salto seguro dentro del mismo dominio sí se sigue (y su Disallow se respeta).
    const calls: string[] = [];
    const stub = (async (u: string) => {
      calls.push(u);
      if (u === "https://quintonil.com/robots.txt") return new Response("", { status: 301, headers: { location: "https://www.quintonil.com/robots.txt" } });
      if (u === "https://www.quintonil.com/robots.txt") return new Response("User-agent: *\nDisallow: /", { status: 200 });
      return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    const r = await checkOne({ id: "1", url: "https://quintonil.com/", host: "quintonil.com", kind: "official_site" }, stub);
    expect(calls).toContain("https://www.quintonil.com/robots.txt");
    expect(r.status).toBe("robots_disallowed");
  });
});
