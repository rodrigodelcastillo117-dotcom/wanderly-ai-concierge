// Reservas IA: descubrimiento del correo de reservas. Nunca se adivina: solo correos que aparecen
// escritos en el sitio oficial (que viene de Google o del catálogo, no del cliente).
import { describe, expect, it, vi } from "vitest";
import {
  contactLinks, discoverVenueContact, extractEmails, isSafePublicUrl, safeFetchPage,
} from "../../supabase/functions/_shared/ai-reservations/contact";

const google = {
  id: "ChIJ_casaoaxaca_0001", displayName: { text: "Casa Oaxaca" }, formattedAddress: "Constitución 104, Oaxaca, México",
  internationalPhoneNumber: "+52 951 514 4173", websiteUri: "https://casaoaxaca.com.mx/", googleMapsUri: "https://maps.google.com/?cid=1",
  timeZone: { id: "America/Mexico_City" }, businessStatus: "OPERATIONAL",
  addressComponents: [{ shortText: "MX", longText: "México", types: ["country"] }, { shortText: "Oaxaca", longText: "Oaxaca de Juárez", types: ["locality"] }],
};
const page = (body: string) => `<html><head><script>var x="spam@sentry.io"</script></head><body>${body}</body></html>`;

function deps(pages: Record<string, string>, model?: (p: Record<string, unknown>) => unknown) {
  return {
    googlePlace: vi.fn(async () => google),
    fetchPage: vi.fn(async (url: string) => (pages[url] ? { url, html: pages[url] } : null)),
    callModel: model ? vi.fn(async (p: Record<string, unknown>) => ({ ok: true, status: 200, data: model(p) })) : null,
  };
}
const seed = { name: "Casa Oaxaca", place_id: "ChIJ_casaoaxaca_0001" };

describe("descubrimiento de contacto", () => {
  it("toma sitio, teléfono, zona horaria y país de Google; correo de reservas claro sin gastar Claude", async () => {
    const d = deps({
      "https://casaoaxaca.com.mx/": page(`<a href="/contacto">Contacto</a> <img src="logo@2x.png">`),
      "https://casaoaxaca.com.mx/contacto": page(`<p>Reservaciones: <a href="mailto:reservaciones@casaoaxaca.com.mx">escríbenos</a></p><p>Prensa: prensa@casaoaxaca.com.mx</p>`),
    }, () => { throw new Error("no debe llamarse"); });
    const v = await discoverVenueContact(seed, d, new Date("2026-11-01T00:00:00Z"));
    expect(v).toMatchObject({ timezone: "America/Mexico_City", country: "MX", city: "Oaxaca de Juárez", language: "es", email: "reservaciones@casaoaxaca.com.mx", claude_calls: 0 });
    expect(v.email_source).toMatchObject({ kind: "website", url: "https://casaoaxaca.com.mx/contacto", method: "deterministic" });
    expect(v.email_source!.quote).toContain("reservaciones@casaoaxaca.com.mx");
    expect(d.callModel!).not.toHaveBeenCalled();
  });

  it("varios correos ambiguos → Claude elige y se valida que el correo y la URL existan", async () => {
    const d = deps({
      "https://casaoaxaca.com.mx/": page(`<footer>hola@casaoaxaca.com.mx · eventos@casaoaxaca.com.mx</footer>`),
    }, () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "choose_reservation_email", input: { email: "hola@casaoaxaca.com.mx", source_url: "https://casaoaxaca.com.mx/", purpose: "general_contact" } }] }));
    const v = await discoverVenueContact(seed, d);
    expect(v.email).toBe("hola@casaoaxaca.com.mx");
    expect(v.email_source).toMatchObject({ method: "model", url: "https://casaoaxaca.com.mx/" });
    expect(v.claude_calls).toBe(1);
    const sent = (d.callModel!.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(sent.tool_choice).toEqual({ type: "auto" });
    expect(String(sent.system)).toMatch(/never construct or guess/i);
  });

  it("si Claude inventa un correo que no está en la página, se descarta (needs_user)", async () => {
    const d = deps({ "https://casaoaxaca.com.mx/": page(`hola@casaoaxaca.com.mx, eventos@casaoaxaca.com.mx`) },
      () => ({ content: [{ type: "tool_use", name: "choose_reservation_email", input: { email: "reservas@casaoaxaca.com.mx", source_url: null, purpose: "reservations" } }] }));
    const v = await discoverVenueContact(seed, d);
    expect(v.email).toBeNull();
    expect(v.user_options).toMatchObject({ phone_url: "tel:+529515144173", whatsapp_url: "https://wa.me/529515144173", fixer: true, website: "https://casaoaxaca.com.mx/" });
  });

  it("sin correos en el sitio → needs_user sin llamar a Claude; sin sitio → ni se descarga nada", async () => {
    const d = deps({ "https://casaoaxaca.com.mx/": page("Llámanos al 951 514 4173") }, () => ({}));
    const v = await discoverVenueContact(seed, d);
    expect(v.email).toBeNull();
    expect(d.callModel!).not.toHaveBeenCalled();
    const noSite = { ...deps({}), googlePlace: vi.fn(async () => ({ ...google, websiteUri: undefined })) };
    const v2 = await discoverVenueContact(seed, noSite);
    expect(v2.email).toBeNull();
    expect(noSite.fetchPage).not.toHaveBeenCalled();
  });

  it("el sitio de un lugar Privé viene del catálogo; el país del destino elige el idioma", async () => {
    const d = {
      priveExperience: vi.fn(async () => ({ id: "e1", name: "Le Comptoir", address: "9 Carrefour de l'Odéon", website: "https://lecomptoir.fr", booking_url: null, google_place_id: null, city: "París", country: "FR", timezone: "Europe/Paris" })),
      fetchPage: vi.fn(async (url: string) => ({ url, html: page("Réservations : reservation@lecomptoir.fr") })),
    };
    const v = await discoverVenueContact({ name: "x", experience_id: "e1" }, d);
    expect(v).toMatchObject({ name: "Le Comptoir", language: "fr", timezone: "Europe/Paris", email: "reservation@lecomptoir.fr" });
  });
});

describe("extracción y red segura", () => {
  it("ignora correos de plantillas, scripts y nombres de archivo", () => {
    expect(extractEmails(page(`<img src="hero@2x.jpg"> user@example.com contacto&#64;lugar.mx <a href="mailto:Reservas@Lugar.mx?subject=hola">x</a>`)).sort())
      .toEqual(["contacto@lugar.mx", "reservas@lugar.mx"]);
  });
  it("solo sigue enlaces de contacto del mismo sitio", () => {
    const links = contactLinks(`<a href="/contact">Contact</a><a href="https://evil.test/contacto">x</a><a href="mailto:a@b.c">m</a><a href="/menu">Menú</a><a href="https://www.lugar.mx/reservaciones">R</a>`, "https://www.lugar.mx/");
    expect(links).toEqual(["https://www.lugar.mx/contact", "https://www.lugar.mx/reservaciones"]);
  });
  it("bloquea http, IPs, localhost, puertos y credenciales (SSRF)", () => {
    for (const u of ["http://lugar.mx", "https://127.0.0.1/", "https://[::1]/", "https://localhost/", "https://lugar.mx:8443/", "https://a:b@lugar.mx/", "https://metadata.google.internal/", "https://intranet/"]) {
      expect(isSafePublicUrl(u)).toBe(false);
    }
    expect(isSafePublicUrl("https://lugar.mx/contacto")).toBe(true);
  });
  it("revalida cada redirección: un 302 hacia una IP interna no se sigue", async () => {
    const f = vi.fn(async (url: string) => url.includes("lugar.mx")
      ? new Response(null, { status: 302, headers: { location: "https://169.254.169.254/latest" } })
      : new Response("<html>secreto</html>", { headers: { "content-type": "text/html" } }));
    expect(await safeFetchPage(f as unknown as typeof fetch, "https://lugar.mx/")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
});
