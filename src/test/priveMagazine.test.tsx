// THE PRIVATE EDITION · modo revista (dueño, 2026-10-22: «que parezca revista»): portada a página completa,
// índice con número de página, páginas que se pasan (teclado, botones, bordes), folio, pliego de doble página
// en la computadora, salida a la vista continua, última página recordada, acceso a «Personalizar mi edición»
// y nada en inglés cuando el idioma es español. Paginación sin perder ni una palabra.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { payloadFromDoc } from "../../scripts/edition/payload.mjs";
import { DEFAULT_PREFS, personalizeIssue, type IssuePayload } from "@/lib/priveEdition";
import {
  assemblePages, bodyFlow, buildPieces, endFlow, estimateMeasurer, paginateFlow, PAGE_KEY, spreadsOf, type FlowItem,
} from "@/lib/priveMagazine";
import { EDITION_TEXT } from "@/lib/priveEditionI18n";

const doc = JSON.parse(readFileSync(join(__dirname, "..", "..", "data/prive/edition/issue-01.json"), "utf8"));
const payload = payloadFromDoc(doc) as IssuePayload;

const content = vi.fn();
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => ({ content, session: { token: "t".repeat(43) } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(), from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }), functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));
// El monograma usa framer-motion; aquí basta un SVG quieto.
vi.mock("@/components/prive/Monogram", () => ({ Monogram: () => <svg aria-hidden="true" /> }));

import EditionRoot from "@/pages/prive/edition/EditionRoot";
import LatestIssuePage from "@/pages/prive/edition/LatestIssuePage";
import ArticlePage from "@/pages/prive/edition/ArticlePage";

const basePrefs = { saved: false, edition_kind: "mi_mezcla", interests: {}, excluded: [], language: null, reading_minutes: 120, section_order: [], show_name_on_cover: false, personalization_consent: false, first_name: "Rodrigo" };
let prefsResp: Record<string, unknown> = basePrefs;
const memberContent = async (fn: string) => {
  if (fn === "prive_edition_prefs") return { ok: true, data: prefsResp };
  if (fn === "prive_edition_issue") return { ok: true, data: payload };
  if (fn === "prive_edition_save") return { ok: true, data: { ok: true } };
  return { ok: true, data: {} };
};
const tree = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/prive/edicion" element={<EditionRoot />}>
        <Route index element={<LatestIssuePage />} />
        <Route path="articulo/:slug" element={<ArticlePage />} />
        <Route path="mi-edicion" element={<p data-testid="my-edition-page">My Edition</p>} />
      </Route>
    </Routes>
  </MemoryRouter>
);
const renderAt = (path: string) => render(tree(path));
const setViewport = (w: number, h: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: h, configurable: true, writable: true });
};
const current = () => document.querySelector("[data-unit][data-current]") as HTMLElement;
const status = () => screen.getByTestId("mz-status").textContent ?? "";
const total = () => Number(/de (\d+)$/.exec(status())?.[1] ?? /of (\d+)$/.exec(status())?.[1]);
const press = (key: string) => act(() => { fireEvent.keyDown(window, { key }); });

beforeEach(() => {
  content.mockReset();
  content.mockImplementation(memberContent);
  prefsResp = basePrefs;
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* noop */ }
  window.scrollTo = vi.fn() as never;
  Object.defineProperty(navigator, "language", { value: "es-MX", configurable: true });
  setViewport(390, 844);
});
afterEach(() => setViewport(1024, 768));

describe("modo revista (celular, una página a la vez)", () => {
  it("es lo predeterminado al abrir el número: portada a página completa con nombre, número, mes, titulares y crédito", async () => {
    renderAt("/prive/edicion");
    const reader = await screen.findByTestId("mz-reader");
    expect(reader).toHaveAttribute("aria-roledescription", "carrusel");
    expect(screen.queryByTestId("edition-cover")).toBeNull(); // la vista continua no se monta
    const cover = within(current()).getByTestId("mz-cover");
    expect(within(cover).getByText("THE PRIVATE EDITION")).toBeInTheDocument();
    expect(within(cover).getByText("Nº 01 · Noviembre 2026")).toBeInTheDocument();
    expect(within(cover).getByRole("heading", { level: 1, name: /La ciudad acelera/ })).toBeInTheDocument();
    for (const line of ["Fórmula 1 y Día de Muertos en el mismo fin de semana", "Mérida en el mapa de la guía", "Mónaco después del Yacht Show"]) {
      expect(within(cover).getByText(line)).toBeInTheDocument();
    }
    expect(within(cover).getByText(/Foto ilustrativa · Foto:/)).toBeInTheDocument();
    expect(status()).toMatch(/^Página 1 de \d+$/);
    expect(total()).toBeGreaterThan(20);
  });

  it("paso de página con teclado ← → y con los botones; «Página X de Y» y folio abajo", async () => {
    renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    expect(screen.getByTestId("mz-prev")).toBeDisabled();
    // Navegación obvia, sin gestos escondidos: flechas con nombre, botón «Índice» con texto y «Página X de Y».
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Índice" })).toHaveTextContent("Índice");
    expect(screen.getByRole("button", { name: "Vista continua" })).toBeInTheDocument();
    press("ArrowRight");
    expect(status()).toBe(`Página 2 de ${total()}`);
    expect(current()).toHaveAttribute("aria-label", `Página 2 de ${total()}`);
    expect(current()).toHaveAttribute("aria-roledescription", "página");
    expect(within(current()).getByTestId("mz-folio")).toHaveTextContent(/^2 · THE PRIVATE EDITION · Noviembre 2026$/);
    fireEvent.click(screen.getByTestId("mz-next"));
    expect(status()).toBe(`Página 3 de ${total()}`);
    fireEvent.click(screen.getByTestId("mz-prev"));
    press("ArrowLeft");
    expect(status()).toBe(`Página 1 de ${total()}`);
    // Las páginas que no están en pantalla quedan fuera del orden de tabulación y del lector de pantalla.
    const others = document.querySelectorAll("[data-unit]:not([data-current])");
    expect(others.length).toBeGreaterThan(10);
    for (const u of [...others].slice(0, 5)) { expect(u).toHaveAttribute("aria-hidden", "true"); expect(u).toHaveAttribute("inert"); }
    press("End");
    press("ArrowRight");
    expect(status()).toMatch(/^Página \d+ de \d+$/);
  });

  it("índice («Índice») con número de página de cada pieza; tocar una pieza lleva a esa página y le da el foco", async () => {
    renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    fireEvent.click(screen.getByTestId("mz-contents"));
    const toc = current();
    expect(within(toc).getByRole("heading", { name: "Índice" })).toBeInTheDocument();
    const entries = [...document.querySelectorAll("[data-unit] [data-testid=mz-toc-entry]")] as HTMLElement[];
    expect(entries.length).toBeGreaterThanOrEqual(10);
    for (const e of entries) expect(e.querySelector(".pg")?.textContent).toMatch(/^\d+$/);
    const merida = entries.find((e) => /El sureste entra al mapa/.test(e.textContent ?? ""))!;
    const pg = Number(merida.querySelector(".pg")!.textContent);
    expect(merida).toHaveAccessibleName(`El sureste entra al mapa, página ${pg}`);
    fireEvent.click(merida);
    expect(status()).toBe(`Página ${pg} de ${total()}`);
    expect(current()).toHaveAttribute("data-unit");
    expect(document.activeElement).toBe(current());
    // La apertura del reportaje: foto a sangre con crédito y licencia; la siguiente, título, entradilla y firma.
    expect(within(current()).getByTestId("mz-page")).toHaveAttribute("data-kind", "photo");
    expect(within(current()).getByText(/Pexels License/)).toBeInTheDocument();
    press("ArrowRight");
    expect(within(current()).getByRole("heading", { level: 2, name: "El sureste entra al mapa" })).toBeInTheDocument();
    expect(within(current()).getByText(/min de lectura/)).toBeInTheDocument();
  });

  it("acceso claro a «Personalizar mi edición» en portada e índice; sin intereses, la línea de edición común", async () => {
    renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    const cta = within(current()).getByRole("link", { name: "Personalizar mi edición" });
    expect(cta).toHaveAttribute("href", "/prive/edicion/mi-edicion");
    fireEvent.click(screen.getByTestId("mz-contents"));
    expect(within(current()).getByText("Esta es la edición común. Elige tus temas y la ordenamos a tu medida.")).toBeInTheDocument();
    fireEvent.click(within(current()).getByRole("link", { name: "Personalizar mi edición" }));
    expect(await screen.findByTestId("my-edition-page")).toBeInTheDocument();
  });

  it("con intereses elegidos ya no dice «edición común» (sigue el acceso para ajustarla)", async () => {
    prefsResp = { ...basePrefs, saved: true, interests: { yates_y_embarcaciones: 3 }, personalization_consent: true };
    renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    fireEvent.click(screen.getByTestId("mz-contents"));
    expect(within(current()).queryByText(/Esta es la edición común/)).toBeNull();
    expect(within(current()).getByText(/No es una investigación individual/)).toBeInTheDocument();
    expect(within(current()).getByRole("link", { name: "Personalizar mi edición" })).toBeInTheDocument();
  });

  it("al abrir un artículo: revista en su apertura; fuentes y «Del artículo a la experiencia» en su propia página", async () => {
    renderAt("/prive/edicion/articulo/cdmx-fin-de-semana-gran-premio");
    await screen.findByTestId("mz-reader");
    expect(within(current()).getByTestId("mz-page")).toHaveAttribute("data-kind", "photo");
    // Avanzar hasta la página de fuentes de la pieza.
    let guard = 0;
    while (within(current()).getByTestId("mz-page").getAttribute("data-kind") !== "end" && guard++ < 30) press("ArrowRight");
    const end = current();
    expect(within(end).getByText("Fuentes · 7 fuentes")).toBeInTheDocument();
    const srcs = [...document.querySelectorAll("[data-unit] .mz-page.end")].filter((p) => p.getAttribute("data-slug") === "cdmx-fin-de-semana-gran-premio");
    // Cada fuente empieza una sola vez (una fuente larga puede seguir en la columna siguiente).
    const starts = srcs.flatMap((p) => [...p.querySelectorAll("[data-src-start]")]);
    expect(new Set(starts.map((i) => i.getAttribute("data-src"))).size).toBe(7);
    expect(starts).toHaveLength(7);
    const all = srcs.flatMap((p) => [...p.querySelectorAll("[data-src]")]).map((i) => i.textContent ?? "").join(" ");
    expect(all.match(/consultada el 22 de octubre de 2026/g)).toHaveLength(7);
    // Botones reales al final de la pieza.
    while (!within(current()).queryByTestId("mz-actions") && guard++ < 40) press("ArrowRight");
    const actions = within(current()).getByTestId("mz-actions");
    expect(within(actions).getByRole("button", { name: "Explorar Ciudad de México en Privé" })).toBeEnabled();
    expect(within(actions).getByRole("link", { name: /Boletos y guía oficial/ })).toHaveAttribute("href", "https://www.mexicogp.mx/");
    expect(within(current()).getByText("Del artículo a la experiencia")).toBeInTheDocument();
  });

  it("«Vista continua» sale del modo revista al mismo artículo y «Leer como revista» regresa", async () => {
    renderAt("/prive/edicion/articulo/merida-guadalajara-mesa-mexicana");
    await screen.findByTestId("mz-reader");
    fireEvent.click(screen.getByTestId("mz-exit"));
    const art = await screen.findByTestId("edition-article");
    expect(within(art).getByRole("heading", { level: 1, name: "El sureste entra al mapa" })).toBeInTheDocument();
    expect(screen.queryByTestId("mz-reader")).toBeNull();
    expect(sessionStorage.getItem("iatos_edition_view")).toBe("continuous");
    fireEvent.click(screen.getByRole("button", { name: "Leer como revista" }));
    expect(await screen.findByTestId("mz-reader")).toBeInTheDocument();
    expect(within(current()).getByTestId("mz-page")).toHaveAttribute("data-kind", "photo");
  });

  it("recuerda la última página leída de cada número (y no falla si el almacenamiento está bloqueado)", async () => {
    const first = renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    for (let i = 0; i < 6; i++) press("ArrowRight");
    const seen = status();
    expect(seen).toMatch(/^Página 7 de/);
    expect(JSON.parse(localStorage.getItem(PAGE_KEY("n01-noviembre-2026"))!)).toEqual(expect.objectContaining({ piece: expect.any(String) }));
    first.unmount();
    const second = renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    expect(status()).toBe(seen);
    second.unmount();
    // Modo privado: localStorage lanza; la revista abre en la portada sin romperse.
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const spy2 = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      renderAt("/prive/edicion");
      await screen.findByTestId("mz-reader");
      expect(status()).toMatch(/^Página 1 de/);
      press("ArrowRight");
      expect(status()).toMatch(/^Página 2 de/);
    } finally { spy.mockRestore(); spy2.mockRestore(); }
  });

  it("en español: ni una línea en inglés en toda la revista (salvo las marcas)", async () => {
    const { container } = renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    const n = total();
    let text = "";
    for (let i = 0; i < n; i++) { text += ` ${current().textContent} ${screen.getByTestId("mz-status").textContent}`; press("ArrowRight"); }
    text += ` ${container.querySelector(".mz-controls")!.textContent}`;
    const en = EDITION_TEXT.en.mz as Record<string, unknown>;
    const es = EDITION_TEXT.es.mz as Record<string, unknown>;
    for (const [k, v] of Object.entries(en)) {
      if (typeof v === "string" && v !== es[k]) expect(text, k).not.toContain(v);
    }
    expect(text).not.toMatch(/\b(Page|Pages|Contents|Previous|Next|Sources|Continuous view|Personali[sz]e|Swipe|From Page to Experience|Back to the cover|End of issue|min read|Photo:|Illustrative photo|Verified facts|Editorial analysis)\b/);
    // Etiquetas de verificación y créditos sí están, en español.
    expect(text).toContain("Hechos verificados");
    expect(text).toContain("Foto ilustrativa");
  });

  it("en inglés: la misma revista con sus textos en inglés", async () => {
    renderAt("/prive/edicion");
    await screen.findByTestId("mz-reader");
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(status()).toMatch(/^Page 1 of \d+$/);
    expect(within(current()).getByText("No. 01 · November 2026")).toBeInTheDocument();
    expect(within(current()).getByRole("link", { name: "Personalize my edition" })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mz-contents"));
    expect(within(current()).getByRole("heading", { name: "Contents" })).toBeInTheDocument();
    expect(within(current()).getByText("This is the shared edition. Choose your topics and we'll tailor it to you.")).toBeInTheDocument();
  });
});

describe("modo revista (computadora, pliego de doble página)", () => {
  beforeEach(() => setViewport(1440, 900));

  it("portada sola; luego pliegos de dos páginas; la apertura es foto | título en el mismo pliego; clic en los bordes", async () => {
    renderAt("/prive/edicion");
    const reader = await screen.findByTestId("mz-reader");
    expect(reader).toHaveAttribute("data-layout", "spread");
    expect(within(current()).getAllByTestId("mz-page")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("mz-edge-next"));
    expect(status()).toMatch(/^Páginas 2 y 3 de \d+$/);
    expect(current()).toHaveAttribute("aria-roledescription", "pliego");
    const pages = within(current()).getAllByTestId("mz-page");
    expect(pages.map((p) => p.getAttribute("data-side"))).toEqual(["left", "right"]);
    expect(within(pages[0]).getByTestId("mz-folio")).toHaveTextContent("2 · THE PRIVATE EDITION · Noviembre 2026");
    // Cada reportaje con foto abre en un pliego: foto a la izquierda, título a la derecha.
    for (let i = 0; i < 40; i++) {
      const ps = within(current()).getAllByTestId("mz-page");
      if (ps[0]?.getAttribute("data-kind") === "photo") {
        expect(ps).toHaveLength(2);
        expect(ps[1]).toHaveAttribute("data-kind", "body");
        expect(within(ps[1]).getByRole("heading", { level: 2 })).toBeInTheDocument();
      }
      expect(ps.some((p) => p.getAttribute("data-kind") === "photo" && p.getAttribute("data-side") === "right")).toBe(false);
      press("ArrowRight");
    }
    // La contraportada va sola, con la marca.
    expect(within(current()).getAllByTestId("mz-page")).toHaveLength(1);
    expect(within(current()).getByTestId("mz-back")).toHaveTextContent("THE PRIVATE EDITION");
    fireEvent.click(within(current()).getByRole("button", { name: "Volver a la portada" }));
    expect(status()).toMatch(/^Página 1 de/);
  });
});

describe("paginación (lógica pura)", () => {
  const ed = personalizeIssue(payload, { ...DEFAULT_PREFS, reading_minutes: 120 });
  const pieces = buildPieces(ed, payload.images!);
  const cfgs = [
    { cols: 1 as const, colW: 346, fullW: 346, height: 470, fontPx: 16.5, lineH: 25.6 },
    { cols: 2 as const, colW: 236, fullW: 498, height: 540, fontPx: 14.5, lineH: 21.8 },
    { cols: 2 as const, colW: 250, fullW: 526, height: 300, fontPx: 14.5, lineH: 21.8 },
  ];
  const wordsOf = (items: FlowItem[], pages: ReturnType<typeof paginateFlow>) => {
    const got: string[] = [];
    for (const p of pages) for (const s of p.segments) for (const part of "span" in s ? [s.span] : s.cols.flat()) {
      const it = items[part.id];
      if (it.t === "p") got.push(...it.words.slice(part.from ?? 0, part.to));
      else got.push(`#${it.id}:${part.from ?? 0}`);
    }
    return got;
  };

  it("no pierde ni repite una palabra ni un bloque, y ninguna columna pasa del alto de la página", () => {
    for (const cfg of cfgs) for (const piece of pieces) for (const items of [bodyFlow(piece, "es", payload.images!), endFlow(piece, "es")]) {
      if (!items.length) continue;
      const m = estimateMeasurer(items, cfg);
      const pages = paginateFlow(items, { cols: cfg.cols, height: cfg.height, lineH: cfg.lineH }, m);
      const expected: string[] = [];
      for (const it of items) if (it.t === "p") expected.push(...it.words);
      const got = wordsOf(items, pages);
      expect(got.filter((w) => !w.startsWith("#"))).toEqual(expected);
      // Cada bloque que no es párrafo aparece (listas: por tramos sin huecos).
      for (const it of items.filter((x) => x.t !== "p" && x.kind !== "list")) expect(got.filter((w) => w === `#${it.id}:0`)).toHaveLength(1);
      for (const p of pages) {
        let y = 0;
        let parts = 0;
        for (const s of p.segments) {
          if ("span" in s) { y += s.span.h ?? 0; parts++; continue; }
          y += Math.max(...s.cols.map((col) => col.reduce((acc, part) => acc + (part.h ?? 0), 0)));
          parts += s.cols.flat().length;
        }
        // Un elemento que no cabe ni solo en una página vacía se coloca igual (página demasiado baja).
        if (parts > 1) expect(y).toBeLessThanOrEqual(cfg.height + 0.5);
      }
    }
  });

  it("pliegos: la foto de apertura siempre a la izquierda; portada y contraportada solas", () => {
    const pf = pieces.map((piece) => ({ piece, body: [{ segments: [] }], end: endFlow(piece, "es").length ? [{ segments: [] }] : [] }));
    const pages = assemblePages({ cover: true, toc: [{ segments: [] }], pieces: pf, back: true, spread: true });
    const units = spreadsOf(pages.length, true, true, true);
    expect(units[0]).toEqual([0]);
    expect(units[units.length - 1]).toEqual([pages.length - 1]);
    for (const u of units.slice(1, -1)) expect(u).toHaveLength(2);
    pages.forEach((p, i) => { if (p.kind === "photo") expect(i % 2).toBe(1); });
    expect(pages.filter((p) => p.kind === "photo")).toHaveLength(3);
  });
});
