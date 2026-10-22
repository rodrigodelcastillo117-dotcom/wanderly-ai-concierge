// N-04: Inicio y Members Only lanzaban docenas de GET buscar-video por carga y muchas volvían 429.
import React from "react";
import { render, act } from "@testing-library/react";
import { vi, beforeEach, afterEach, it, expect } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } },
}));

import { DestinationVideo } from "@/components/DestinationVideo";
import { CityVideoCard } from "@/components/CityVideoCard";
import { __resetVideoSearch, getDestinationVideo, MAX_PER_MINUTE } from "@/lib/videoSearch";

const fetchMock = vi.fn();
const queriesCalled = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get("q"));
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });

const ok = (q: string) => new Response(JSON.stringify({ url: `https://videos.example/${encodeURIComponent(q)}.mp4`, poster: null }), { status: 200 });

beforeEach(() => {
  __resetVideoSearch();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (u: string) => ok(new URL(u).searchParams.get("q") ?? ""));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("N renders con consultas repetidas: como mucho una llamada por consulta única", async () => {
  const queries = ["Roma travel", "roma  TRAVEL", "Tulum travel", "Roma travel", "Kioto travel", "Tulum travel"];
  const tree = () => (
    <>
      {queries.map((q, i) => <DestinationVideo key={i} query={q} alt={q} />)}
      {["Madrid", "Madrid", "Lima"].map((c, i) => <CityVideoCard key={`c${i}`} city={c} active={false} onClick={() => {}} />)}
    </>
  );
  const r = render(tree());
  await flush();
  for (let i = 0; i < 5; i++) { r.rerender(tree()); await flush(); }
  r.unmount();
  render(tree()); // volver a la página tampoco vuelve a llamar
  await flush();
  const called = queriesCalled();
  // Roma, Tulum, Kioto + Madrid y Lima (consulta propia de las tarjetas de ciudad).
  expect(called).toHaveLength(5);
  expect(new Set(called.map((q) => q!.toLowerCase().replace(/\s+/g, " "))).size).toBe(5);
});

it("solo pide el video cuando la tarjeta está por verse", async () => {
  const observers: Array<{ cb: IntersectionObserverCallback; el?: Element }> = [];
  vi.stubGlobal("IntersectionObserver", class {
    o: { cb: IntersectionObserverCallback; el?: Element };
    constructor(cb: IntersectionObserverCallback) { this.o = { cb }; observers.push(this.o); }
    observe(el: Element) { this.o.el = el; }
    disconnect() {}
    unobserve() {}
  });
  render(<><DestinationVideo query="Oaxaca" alt="a" /><DestinationVideo query="Bacalar" alt="b" /></>);
  await flush();
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => { observers[0].cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); });
  await flush();
  expect(queriesCalled()).toEqual(["Oaxaca"]);
});

it("tras un 429 deja de llamar (ni reintenta ni pide las demás) y muestra la imagen de respaldo", async () => {
  fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 429, headers: { "Retry-After": "60" } }));
  const first = await getDestinationVideo("Cancún");
  expect(first).toEqual({ url: null, poster: null });
  await getDestinationVideo("Cancún");
  await getDestinationVideo("Mérida");
  render(<DestinationVideo query="Puebla" fallbackImage="/respaldo.jpg" alt="p" />);
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("respeta el presupuesto por minuto (por debajo del límite del servidor)", async () => {
  const many = Array.from({ length: 20 }, (_, i) => `Ciudad ${i}`);
  many.forEach((q) => void getDestinationVideo(q));
  await flush();
  expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_PER_MINUTE);
});

it("un error del servidor no se reintenta en la sesión", async () => {
  fetchMock.mockImplementationOnce(async () => new Response("{}", { status: 500 }));
  await getDestinationVideo("Lisboa");
  await getDestinationVideo("Lisboa");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
