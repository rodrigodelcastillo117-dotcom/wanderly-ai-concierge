// Ejecuta public/sw.js en un sandbox con `self`, `caches` y `fetch` falsos para
// comprobar el modo offline sin navegador.
import { readFileSync } from "fs";
import path from "path";
import vm from "vm";
import { describe, it, expect, beforeEach } from "vitest";

const code = readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");

function makeEnv() {
  const stores = new Map<string, Map<string, any>>();
  const keyOf = (k: any) => (typeof k === "string" ? new URL(k, "https://app.test").href : k.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      add: async (u: string) => { m.set(keyOf(u), new Response("precache:" + u)); },
      put: async (k: any, r: any) => { m.delete(keyOf(k)); m.set(keyOf(k), r); },
      delete: async (k: any) => m.delete(keyOf(k)),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      match: async (k: any) => m.get(keyOf(k)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (k: any, opts: any = {}) => {
      const names = opts.cacheName ? [opts.cacheName] : [...stores.keys()];
      for (const n of names) { const hit = stores.get(n)?.get(keyOf(k)); if (hit) return hit; }
      return undefined;
    },
  };
  let online = true;
  let net = 0;
  const fetchFn = async (req: any) => {
    net++;
    if (!online) throw new TypeError("Failed to fetch");
    return new Response(`net:${req.url}#${net}`, { status: 200 });
  };
  const handlers: Record<string, (e: any) => void> = {};
  const self: any = {
    location: { origin: "https://app.test" },
    addEventListener: (t: string, h: any) => { handlers[t] = h; },
    skipWaiting: async () => {}, clients: { claim: async () => {} }, registration: {},
  };
  vm.runInNewContext(code, { self, caches, fetch: fetchFn, URL, Response, Promise, console, encodeURIComponent });
  const dispatch = async (type: string, data: any = {}) => {
    let responded: Promise<any> | undefined; const waits: Promise<any>[] = [];
    handlers[type]({ ...data, respondWith: (p: any) => { responded = Promise.resolve(p); }, waitUntil: (p: any) => waits.push(p) });
    await Promise.all(waits);
    return responded;
  };
  const get = (url: string, mode = "cors", accept = "application/json") =>
    ({ url, method: "GET", mode, headers: { get: (h: string) => (h === "accept" ? accept : null) } });
  return { stores, dispatch, get, setOnline: (v: boolean) => { online = v; }, netCount: () => net };
}

let env: ReturnType<typeof makeEnv>;
beforeEach(async () => {
  env = makeEnv();
  await env.dispatch("install");
  await env.dispatch("activate");
});

const tripUrl = (id: string) => `https://proj.supabase.co/rest/v1/trips?select=*&id=eq.${id}`;

describe("service worker offline", () => {
  it("sin red, una navegación profunda abre el app shell guardado", async () => {
    await (await env.dispatch("fetch", { request: env.get("https://app.test/dashboard/viajes/1", "navigate") }));
    env.setOnline(false);
    const res = await env.dispatch("fetch", { request: env.get("https://app.test/dashboard/viajes/2", "navigate") });
    expect(await (await res).text()).toMatch(/^net:https:\/\/app\.test\/dashboard\/viajes\/1/);
  });

  it("los últimos viajes vistos se leen sin conexión; con red siempre se pide lo fresco", async () => {
    await env.dispatch("fetch", { request: env.get(tripUrl("a")) });
    const before = env.netCount();
    await env.dispatch("fetch", { request: env.get(tripUrl("a")) });
    expect(env.netCount()).toBe(before + 1); // red primero
    env.setOnline(false);
    const res = await env.dispatch("fetch", { request: env.get(tripUrl("a")) });
    expect(await (await res).text()).toContain("id=eq.a");
    await expect(env.dispatch("fetch", { request: env.get(tripUrl("nunca-visto")) }).then((p) => p)).rejects.toThrow();
  });

  it("guarda como máximo 8 viajes y se borra al cerrar sesión", async () => {
    for (let i = 0; i < 12; i++) await env.dispatch("fetch", { request: env.get(tripUrl(String(i))) });
    expect(env.stores.get("iatos-data-v1")!.size).toBe(8);
    await env.dispatch("message", { data: { type: "iatos:clear-user-cache" } });
    expect(env.stores.has("iatos-data-v1")).toBe(false);
  });

  it("no intercepta escrituras ni otras APIs", async () => {
    expect(await env.dispatch("fetch", { request: { ...env.get(tripUrl("a")), method: "PATCH" } })).toBeUndefined();
    expect(await env.dispatch("fetch", { request: env.get("https://proj.supabase.co/rest/v1/expenses?select=*") })).toBeUndefined();
    expect(await env.dispatch("fetch", { request: env.get("https://proj.supabase.co/functions/v1/analizar-viaje") })).toBeUndefined();
  });

  it("los bundles con hash se sirven de caché aunque no haya red", async () => {
    await env.dispatch("fetch", { request: env.get("https://app.test/assets/index-abc123.js") });
    env.setOnline(false);
    const res = await env.dispatch("fetch", { request: env.get("https://app.test/assets/index-abc123.js") });
    expect(await (await res).text()).toContain("index-abc123.js");
  });
});
