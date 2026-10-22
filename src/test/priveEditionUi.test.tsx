// THE PRIVATE EDITION · pantallas: revista (portada, índice, artículo con fuentes y créditos), FREE bloqueado,
// cambio de idioma, sin conexión sin reservas, panel editorial solo para admins y vista previa marcada.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { payloadFromDoc } from "../../scripts/edition/payload.mjs";
import type { IssuePayload } from "@/lib/priveEdition";

const doc = JSON.parse(readFileSync(join(__dirname, "..", "..", "data/prive/edition/issue-01.json"), "utf8"));
const payload = payloadFromDoc(doc) as IssuePayload;
const previewPayload = payloadFromDoc(doc, { preview: true, approvedImages: ["img_cdmx_angel_noche"] }) as IssuePayload;

const content = vi.fn();
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => ({ content, session: { token: "t".repeat(43) } }) }));
const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }), functions: { invoke: vi.fn() } },
}));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));

import EditionRoot from "@/pages/prive/edition/EditionRoot";
import LatestIssuePage from "@/pages/prive/edition/LatestIssuePage";
import ArticlePage from "@/pages/prive/edition/ArticlePage";
import OpportunitiesPage from "@/pages/prive/edition/OpportunitiesPage";
import EditionAdminPage from "@/pages/prive/edition/EditionAdminPage";
import { ArticleView } from "@/components/prive/edition/Magazine";

const prefsResp = { saved: false, edition_kind: "mi_mezcla", interests: {}, excluded: [], language: null, reading_minutes: 120, section_order: [], show_name_on_cover: false, personalization_consent: false, first_name: "Rodrigo" };
const memberContent = (fn: string) => {
  if (fn === "prive_edition_prefs") return { ok: true, data: prefsResp };
  if (fn === "prive_edition_issue") return { ok: true, data: payload };
  if (fn === "prive_drops") return { ok: false, code: "NOT_AVAILABLE" };
  return { ok: true, data: {} };
};
const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/prive/edicion" element={<EditionRoot />}>
        <Route index element={<LatestIssuePage />} />
        <Route path="articulo/:slug" element={<ArticlePage />} />
        <Route path="oportunidades" element={<OpportunitiesPage />} />
      </Route>
      <Route path="/dashboard/admin/edicion" element={<EditionAdminPage />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  content.mockReset(); rpc.mockReset();
  try { localStorage.clear(); } catch { /* noop */ }
  window.scrollTo = vi.fn() as never;
  // jsdom dice "en-US": el miembro de estas pruebas tiene el navegador en español (el idioma sale del navegador).
  Object.defineProperty(navigator, "language", { value: "es-MX", configurable: true });
});

describe("revista para el miembro", () => {
  it("portada, número, fecha, índice con secciones y tiempos; nota honesta de edición común", async () => {
    content.mockImplementation(async (fn: string) => memberContent(fn));
    renderAt("/prive/edicion");
    const cover = await screen.findByTestId("edition-cover");
    expect(within(cover).getByText("THE PRIVATE EDITION")).toBeInTheDocument();
    expect(within(cover).getByText(/Nº 01 · Noviembre 2026/)).toBeInTheDocument();
    expect(within(cover).getByRole("heading", { level: 1, name: "La ciudad acelera" })).toBeInTheDocument();
    expect(within(cover).getByText(/Foto ilustrativa · Foto:/)).toBeInTheDocument();
    expect(screen.getAllByTestId("toc-item").length).toBeGreaterThanOrEqual(10);
    expect(screen.getByText(/Edición común de este mes/)).toBeInTheDocument();
    // Las seis áreas de navegación con marca en inglés y subtítulo en español.
    const nav = screen.getByRole("navigation", { name: "THE PRIVATE EDITION" });
    for (const b of ["Latest Issue", "My Edition", "World Briefing", "Privé Opportunities", "Flight Edition", "Library"]) expect(within(nav).getByText(b)).toBeInTheDocument();
    expect(within(nav).getByText("Último número")).toBeInTheDocument();
  });

  it("FREE / sin Privé: el servidor responde PRIVE_NOT_PRO y no se muestra ningún contenido", async () => {
    content.mockResolvedValue({ ok: false, code: "PRIVE_NOT_PRO" });
    renderAt("/prive/edicion");
    expect(await screen.findByTestId("prive-locked")).toBeInTheDocument();
    expect(screen.queryByText("La ciudad acelera")).not.toBeInTheDocument();
  });

  it("artículo: fuentes con fechas, créditos y licencia, cita destacada, análisis señalado y acciones reales", async () => {
    content.mockImplementation(async (fn: string) => memberContent(fn));
    renderAt("/prive/edicion/articulo/cdmx-fin-de-semana-gran-premio");
    const art = await screen.findByTestId("edition-article");
    expect(within(art).getByRole("heading", { level: 1, name: "La ciudad acelera" })).toBeInTheDocument();
    const sources = within(art).getByTestId("sources");
    expect(within(sources).getAllByRole("listitem")).toHaveLength(7);
    expect(within(sources).getByRole("link", { name: /F1 Schedule 2026/ })).toHaveAttribute("href", "https://www.formula1.com/en/racing/2026");
    expect(within(sources).getAllByText(/consultada el 22 de octubre de 2026/).length).toBe(7);
    expect(within(art).getAllByText(/Pexels License/).length).toBeGreaterThan(0);
    expect(within(art).getByText(/Los accesos sólo serán permitidos/)).toBeInTheDocument();
    expect(within(art).getAllByText("Análisis editorial").length).toBeGreaterThan(0);
    const actions = within(art).getByTestId("actions");
    expect(within(actions).getByRole("button", { name: "Explorar Ciudad de México en Privé" })).toBeEnabled();
    expect(within(actions).getByRole("link", { name: /Boletos y guía oficial/ })).toHaveAttribute("href", "https://www.mexicogp.mx/");
  });

  it("cambio de idioma: el mismo artículo en inglés", async () => {
    content.mockImplementation(async (fn: string) => memberContent(fn));
    renderAt("/prive/edicion/articulo/merida-guadalajara-mesa-mexicana");
    await screen.findByTestId("edition-article");
    fireEvent.click(screen.getByRole("button", { name: "en" }));
    expect(await screen.findByRole("heading", { level: 1, name: "The southeast joins the map" })).toBeInTheDocument();
    expect(screen.getByText("Sources")).toBeInTheDocument();
    expect(screen.getByText("Latest Issue")).toBeInTheDocument();
    expect(screen.getByText("This month's issue")).toBeInTheDocument();
  });

  it("artículo no publicado: el servidor dice que no existe y no se muestra nada de él", async () => {
    content.mockImplementation(async (fn: string) => (fn === "prive_edition_article" ? { ok: true, data: { found: false } } : memberContent(fn)));
    renderAt("/prive/edicion/articulo/borrador-secreto");
    expect(await screen.findByTestId("edition-not-found")).toBeInTheDocument();
  });

  it("Privé Opportunities sin Drops disponible: cero honesto, nada inventado", async () => {
    content.mockImplementation(async (fn: string) => memberContent(fn));
    renderAt("/prive/edicion/oportunidades");
    expect(await screen.findByTestId("opp-unavailable")).toBeInTheDocument();
    expect(screen.queryAllByTestId("opportunity")).toHaveLength(0);
  });

  it("Privé Opportunities: la vencida no aparece", async () => {
    const live = { id: "a", slug: "vigente", type: "promocion_publica", status: "activo", title: { es: "Tarifa publicada" }, provider: { name: "Hotel Ejemplo" },
      benefit: { es: "Desayuno incluido" }, source: { url: "https://hotel.example.com/p" }, link: "https://hotel.example.com/p", last_verified_at: "2026-10-20T00:00:00Z", valid_until: "2099-12-31" };
    const expired = { ...live, id: "b", slug: "vencida", title: { es: "Promoción vencida" }, valid_until: "2020-01-01" };
    content.mockImplementation(async (fn: string) => (fn === "prive_drops" ? { ok: true, data: { items: [live, expired], expired_recent: 0, generated_at: "2026-10-22T12:00:00Z" } } : memberContent(fn)));
    renderAt("/prive/edicion/oportunidades");
    const cards = await screen.findAllByTestId("opportunity");
    expect(cards).toHaveLength(1);
    expect(screen.queryByText("Promoción vencida")).not.toBeInTheDocument();
  });
});

describe("sin conexión", () => {
  it("las acciones que necesitan red se deshabilitan y se dice que no se puede reservar sin conexión", () => {
    const a = payload.articles!.find((x) => x.slug === "cdmx-fin-de-semana-gran-premio")!;
    render(<MemoryRouter><ArticleView article={a} images={payload.images!} lang="es" offline /></MemoryRouter>);
    expect(screen.getByText(/Sin conexión no se puede reservar, pagar ni consultar disponibilidad/)).toBeInTheDocument();
    const actions = screen.getByTestId("actions");
    for (const b of within(actions).getAllByRole("button")) expect(b).toBeDisabled();
    expect(within(actions).getByText(/Boletos y guía oficial/).closest("a")).not.toHaveAttribute("href");
  });
});

describe("panel editorial", () => {
  it("solo admins: el servidor responde EDITION_NOT_ADMIN y no se ve nada", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "EDITION_NOT_ADMIN" } });
    renderAt("/dashboard/admin/edicion");
    expect(await screen.findByTestId("edition-admin-denied")).toBeInTheDocument();
  });

  it("admin: piezas en revisión con sus bloqueos y la vista previa marcada como demostración", async () => {
    const overview = {
      issues: [{ ...previewPayload.issue, checks: { blocking: ["not_enough_content:0"], warnings: [] } }],
      articles: previewPayload.articles!.map((a) => ({ ...a, checks: { blocking: a.slug === "monaco-yacht-show-2026" ? ["image_not_licensed:img_monaco_puerto"] : [], warnings: ["ai_draft_needs_human_read"] }, source_count: a.sources!.length })),
      sources: [], images: [], reviews: [], downloads: { pdf_30d: 0, offline_30d: 0, avg_pdf_bytes: null, avg_pdf_ms: null }, generated_at: "2026-10-22T12:00:00Z",
    };
    rpc.mockImplementation(async (fn: string) => ({ data: fn === "edition_admin_overview" ? overview : previewPayload, error: null }));
    renderAt("/dashboard/admin/edicion?vista=revision&a=monaco-yacht-show-2026");
    const editor = await screen.findByTestId("article-editor");
    expect(within(editor).getByText(/Imagen sin licencia aprobada: img_monaco_puerto/)).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Aprobar" })).toBeInTheDocument();
    expect(within(editor).getByRole("button", { name: "Retirar" })).toBeInTheDocument();
    expect(screen.getAllByText("borrador IA").length).toBe(16);
  });

  it("vista previa (modo demostración): banner visible y foto con licencia pendiente marcada", async () => {
    rpc.mockImplementation(async (fn: string) => ({ data: fn === "edition_admin_overview"
      ? { issues: [], articles: [], sources: [], images: [], reviews: [], downloads: {}, generated_at: "" } : previewPayload, error: null }));
    renderAt("/dashboard/admin/edicion?vista=preview&a=monaco-yacht-show-2026");
    expect(await screen.findByTestId("preview-banner")).toHaveTextContent("VISTA PREVIA · MODO DEMOSTRACIÓN · NO PUBLICADO");
    await waitFor(() => expect(screen.getAllByText(/Licencia pendiente de aprobación/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Borrador asistido por IA/).length).toBeGreaterThan(0);
  });
});
