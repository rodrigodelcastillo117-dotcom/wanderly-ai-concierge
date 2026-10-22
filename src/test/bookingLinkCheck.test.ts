// Revisión periódica de enlaces (booking-links-cron): robots.txt, un host por corrida, bloqueos
// anti-bots ≠ roto, "soft 404" y redirecciones a otro dominio.
import { describe, expect, it } from "vitest";
import { checkOne, isSoft404, pickBatch } from "../../supabase/functions/booking-links-cron/linkcheck";

const link = (url: string, kind = "reservation_page") => ({ id: "1", url, host: new URL(url).hostname, kind });
const fakeFetch = (routes: Record<string, Response | (() => Response)>) => (async (u: string) => {
  const r = routes[u] ?? routes["*"];
  if (!r) return new Response("", { status: 404 });
  return typeof r === "function" ? r() : r.clone();
}) as unknown as typeof fetch;

describe("booking-links-cron", () => {
  it("un host por corrida y tope por corrida", () => {
    const rows = ["https://www.opentable.com/r/a", "https://www.opentable.com/r/b", "https://resy.com/x", "https://quintonil.com"].map((u, i) => ({ ...link(u), id: String(i) }));
    expect(pickBatch(rows, 10).map((r) => r.url)).toEqual(["https://www.opentable.com/r/a", "https://resy.com/x", "https://quintonil.com"]);
    expect(pickBatch(rows, 2)).toHaveLength(2);
  });
  it("respeta robots.txt", async () => {
    const v = await checkOne(link("https://quintonil.com/reservas"), fakeFetch({
      "https://quintonil.com/robots.txt": new Response("User-agent: *\nDisallow: /reservas"),
    }));
    expect(v.status).toBe("robots_disallowed");
  });
  it("403/429 = bloqueado (no se insiste); 404 = roto; soft 404 = roto", async () => {
    expect((await checkOne(link("https://resy.com/a"), fakeFetch({ "https://resy.com/a": new Response("", { status: 403 }) }))).status).toBe("blocked");
    expect((await checkOne(link("https://resy.com/b"), fakeFetch({ "https://resy.com/b": new Response("", { status: 404 }) }))).status).toBe("broken");
    const soft = new Response("<html><title>Reservas</title><body><h1>Sorry, but we can't find that page.</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } });
    expect((await checkOne(link("https://resy.com/c"), fakeFetch({ "https://resy.com/c": soft }))).status).toBe("broken");
    expect(isSoft404("<title>Rules</title><p>Reservation at Rules</p>")).toBe(false);
  });
  it("redirección a otro dominio no permitido = sospechosa (no se sigue)", async () => {
    const v = await checkOne(link("https://quintonil.com"), fakeFetch({
      "https://quintonil.com/": new Response("", { status: 302, headers: { location: "https://promo-premios.example/ganaste" } }),
    }));
    expect(v).toMatchObject({ status: "redirected_offsite", final_host: "promo-premios.example" });
  });
  it("sitio oficial: guarda los canales públicos encontrados, con fecha y caducidad", async () => {
    const html = `<a href="https://www.opentable.com.mx/r/rosetta-mexico">Reservar</a><a href="https://wa.me/5215512345678">WA</a>`;
    const v = await checkOne(link("https://rosetta.com.mx", "official_site"), fakeFetch({
      "https://rosetta.com.mx/": new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    }), Date.parse("2026-10-22T12:00:00Z"));
    expect(v.status).toBe("ok");
    expect(v.findings).toMatchObject({ booking: [{ provider: "opentable" }], whatsapp: ["5215512345678"] });
    expect(v.expires_at).toBe("2026-11-21T12:00:00.000Z");
  });
  it("una URL insegura ni se pide", async () => {
    let called = false;
    const v = await checkOne(link("https://127.0.0.1/x"), (async () => { called = true; return new Response(""); }) as any);
    expect(v.status).toBe("unknown");
    expect(called).toBe(false);
  });
});
