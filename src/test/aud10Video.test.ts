// Auditoría técnica 10/10 (P1-1) y herramientas (P2-15), 28-oct-2026: buscar-video respondía 429 en 8
// pantallas. El contador y la pausa vivían en memoria: cada recarga volvía a pedir y a chocar con el
// límite, y cada 429 dejaba un error rojo en la consola.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

import { __resetVideoMemory, __resetVideoSearch, getDestinationVideo, MAX_PER_MINUTE } from "@/lib/videoSearch";
import { videoRateLimited } from "../../supabase/functions/buscar-video/rateLimited";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fetchMock = vi.fn();
const ok = (q: string) => new Response(JSON.stringify({ url: `https://videos.example/${encodeURIComponent(q)}.mp4`, poster: null }), { status: 200 });

beforeEach(() => {
  __resetVideoSearch();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (u: string) => ok(new URL(u).searchParams.get("q") ?? ""));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("caché por consulta entre recargas", () => {
  it("una consulta ya resuelta no se vuelve a pedir después de recargar", async () => {
    const a = await getDestinationVideo("Valle de Bravo cinematic");
    expect(a.url).toMatch(/videos\.example/);
    __resetVideoMemory(); // recarga: se pierde la memoria, queda lo guardado
    const b = await getDestinationVideo("valle de bravo  CINEMATIC");
    expect(b).toEqual(a);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("límite del servidor", () => {
  it("con rate_limited (200) se pausa hasta retry_after, también después de recargar", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ url: null, poster: null, rate_limited: true, retry_after: 900 }), { status: 200 }));
    expect(await getDestinationVideo("Tokio")).toEqual({ url: null, poster: null });
    __resetVideoMemory();
    await getDestinationVideo("Tokio");
    await getDestinationVideo("Lisboa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("un 429 (servidor anterior) también pausa entre recargas", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 429, headers: { "Retry-After": "60" } }));
    await getDestinationVideo("Cancún");
    __resetVideoMemory();
    await getDestinationVideo("Mérida");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("el presupuesto por minuto se comparte entre recargas", async () => {
    for (let i = 0; i < MAX_PER_MINUTE; i++) await getDestinationVideo(`Ciudad ${i}`);
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PER_MINUTE);
    __resetVideoMemory();
    void getDestinationVideo("Una más");
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(MAX_PER_MINUTE);
  });

  it("el servidor responde 200 'sin video' con retry_after (sin 429 que ensucie la consola)", async () => {
    const r = videoRateLimited(60, { "Access-Control-Allow-Origin": "*" });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ url: null, poster: null, rate_limited: true, retry_after: 60 });
    expect(r.headers.get("Retry-After")).toBe("60");
    const src = readFileSync(join(__dirname, "..", "..", "supabase/functions/buscar-video/index.ts"), "utf8");
    expect(src).toMatch(/if \(!__rl\.allowed\) return videoRateLimited\(__rl\.retryAfter, corsHeaders\);/);
    expect(src).not.toMatch(/rateLimitResponse/);
  });
});
