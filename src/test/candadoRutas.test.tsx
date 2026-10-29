// CANDADO · rutas y menús (29-oct-2026). Falla si desaparece una ruta de App.tsx, si una ruta deja de
// montar su página, si pierde su protección (sesión / administrador), si un enlace viejo deja de
// redirigir, o si el inventario escrito deja de cubrir App.tsx. Los menús: candadoMenus.test.tsx.
//
// Cómo: se lee el árbol de rutas REAL de App (el mismo que usa react-router: createRoutesFromChildren) y se
// resuelve cada dirección con matchRoutes. La página montada se compara por identidad con el módulo
// importado (no por texto).
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Navigate, Routes, createRoutesFromChildren, matchRoutes, type RouteObject } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb } }));
// Objeto estable: un usuario nuevo en cada render vuelve a disparar los efectos [user] sin fin.
const auth = vi.hoisted(() => ({ user: { id: "u1", email: "candado@example.com" }, signOut: async () => {} }));
vi.mock("@/contexts/AuthContext", async () => {
  const actual: any = await vi.importActual("@/contexts/AuthContext");
  return { ...actual, useAuth: () => auth };
});

import App from "@/App";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminGate } from "@/components/AdminGate";
import { REDIRECCIONES, RUTAS } from "./candadoInventario";

const ROOT = path.resolve(__dirname, "../..");
const _fs = {
  readDoc: () => readFileSync(path.join(ROOT, "docs/iatos/LO_QUE_NO_SE_TOCA.md"), "utf8"),
  hasTests: (f: string) => existsSync(path.join(ROOT, f)) && /\b(it|test)\s*(\.\w+)?\s*\(/.test(readFileSync(path.join(ROOT, f), "utf8")),
};

// ─── El árbol de rutas de App, tal cual ───────────────────────────────────────────────────────────────
function findRoutesElement(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) { const f = findRoutesElement(n); if (f) return f; }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === Routes) return node;
  return findRoutesElement((node.props as { children?: ReactNode }).children);
}
const routesEl = findRoutesElement((App as () => ReactElement)());
const ROUTES: RouteObject[] = routesEl ? createRoutesFromChildren((routesEl.props as { children: ReactNode }).children) : [];

/** Todas las rutas finales (las que montan una pantalla), con su patrón completo. */
function leafPatterns(routes: RouteObject[], base = ""): string[] {
  const out: string[] = [];
  for (const r of routes) {
    const full = r.index ? base || "/" : r.path === "*" ? "*" : r.path?.startsWith("/") ? r.path : `${base.replace(/\/$/, "")}/${r.path ?? ""}`;
    if (r.children?.length) out.push(...leafPatterns(r.children, full));
    else out.push(full);
  }
  return out;
}
const APP_PATTERNS = leafPatterns(ROUTES);

const unwrap = (el: unknown): { el: ReactElement; chain: unknown[] } => {
  const chain: unknown[] = [];
  let cur = el as ReactElement;
  while (isValidElement(cur) && (cur.type === ProtectedRoute || cur.type === AdminGate)) {
    chain.push(cur.type);
    cur = (cur.props as { children: ReactElement }).children;
  }
  return { el: cur, chain };
};

const LAZY = Symbol.for("react.lazy");
/** Resuelve un React.lazy como lo hace React (lazyInitializer): lanza la promesa hasta que el módulo llega. */
async function resolveComponent(type: any): Promise<unknown> {
  if (!type || type.$$typeof !== LAZY) return type;
  for (let i = 0; i < 5; i++) {
    try { return type._init(type._payload); } catch (p: any) { if (p && typeof p.then === "function") await p.then(() => {}, () => {}); else throw p; }
  }
  throw new Error("no se pudo resolver la página");
}

const matchFor = (url: string) => matchRoutes(ROUTES, url) ?? [];

describe("CANDADO · rutas de App.tsx", () => {
  it("el árbol de rutas se lee de App (si esto falla, la prueba no está viendo App)", () => {
    expect(routesEl).not.toBeNull();
    expect(APP_PATTERNS.length).toBeGreaterThan(60);
  });

  it("ninguna ruta del inventario desaparece, y toda ruta nueva se agrega al inventario", () => {
    const inventario = RUTAS.map((r) => r.path).sort();
    const faltan = inventario.filter((p) => !APP_PATTERNS.includes(p));
    expect(faltan, `Rutas que desaparecieron de App.tsx: ${faltan.join(", ")}`).toEqual([]);
    const redirects = REDIRECCIONES.map((r) => r.path);
    const nuevas = APP_PATTERNS.filter((p) => !inventario.includes(p) && !redirects.includes(p));
    expect(nuevas, `Rutas nuevas sin inventario (agrégalas a candadoInventario.ts y a LO_QUE_NO_SE_TOCA.md): ${nuevas.join(", ")}`).toEqual([]);
  });

  it.each(RUTAS.map((r) => [r.path, r] as const))("%s monta su página con la protección de siempre", async (_p, r) => {
    const url = r.ejemplo ?? r.path;
    const matches = matchFor(url);
    expect(matches.length, `${url} no coincide con ninguna ruta`).toBeGreaterThan(0);
    const leaf = matches[matches.length - 1].route;
    if (r.path !== "*") expect(leaf.path, `${url} cae en "No encontrada"`).not.toBe("*");
    // Protección: en la ruta misma o en su contenedor (Privé: PriveRoot va dentro de ProtectedRoute).
    const chain = matches.flatMap((m) => unwrap(m.route.element).chain);
    expect(chain.includes(ProtectedRoute), `${url}: ¿exige sesión?`).toBe(r.protegida);
    expect(chain.includes(AdminGate), `${url}: ¿exige administrador?`).toBe(!!r.admin);
    // La página: la misma función que exporta su módulo.
    const { el } = unwrap(leaf.element);
    const montada = await resolveComponent(el.type);
    const mod = await r.pagina();
    expect(montada, `${url} ya no monta ${r.exportacion ?? "default"} de su página`).toBe(mod[r.exportacion ?? "default"]);
  }, 60_000);

  it.each(REDIRECCIONES.map((r) => [r.path, r.destino] as const))("el enlace viejo %s sigue llevando a %s", (path, destino) => {
    const matches = matchFor(path);
    const el = matches[matches.length - 1]?.route.element as ReactElement;
    expect(isValidElement(el) && el.type === Navigate).toBe(true);
    expect((el.props as { to: string }).to).toBe(destino);
    // Y el destino existe de verdad.
    const dest = matchFor(destino.split(/[?#]/)[0]);
    expect(dest[dest.length - 1]?.route.path).not.toBe("*");
  });

  it("el inventario escrito (docs/iatos/LO_QUE_NO_SE_TOCA.md) lista cada ruta de App.tsx", () => {
    const doc = _fs.readDoc();
    const faltan = [...APP_PATTERNS, ...REDIRECCIONES.map((r) => r.path)].filter((p) => !doc.includes("`" + p + "`"));
    expect(faltan, `Rutas sin fila en LO_QUE_NO_SE_TOCA.md: ${faltan.join(", ")}`).toEqual([]);
  });

  it("cada prueba que el inventario cita como guardiana existe y tiene pruebas", () => {
    const doc = _fs.readDoc();
    const citadas = Array.from(new Set(doc.match(/src\/test\/[A-Za-z0-9_]+\.test\.tsx?/g) ?? []));
    expect(citadas.length).toBeGreaterThan(30);
    const rotas = citadas.filter((f) => !_fs.hasTests(f));
    expect(rotas, `Pruebas guardianas que ya no existen o quedaron vacías: ${rotas.join(", ")}`).toEqual([]);
  });
});

