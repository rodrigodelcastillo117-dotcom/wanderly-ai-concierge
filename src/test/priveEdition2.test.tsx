// THE PRIVATE EDITION · segunda tanda (cierre de la integración): sección protagonista de FOR YOU con sus tres
// estados honestos, versión INSIDER, Flight Edition (próximo viaje, guía práctica, PDF vs. sin internet, espacio),
// riesgos de iOS y From Page to Experience con ?ask=. Las respuestas simuladas tienen la forma EXACTA de las RPC
// (supabase/migrations/20261025100100_edition_rpc.sql y 20261025110000_edition2_status_correcciones.sql); lo que
// se prueba contra la base real está en supabase/tests/edition/edition.sql (E45–E46) y en scripts/edition/e2e-real.mjs.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import { payloadFromDoc } from "../../scripts/edition/payload.mjs";
import type { IssuePayload, PracticalGuide } from "@/lib/priveEdition";

const root = join(__dirname, "..", "..");
const doc = JSON.parse(readFileSync(join(root, "data/prive/edition/issue-01.json"), "utf8"));
const payload = payloadFromDoc(doc, { publishedAt: "2026-11-01T12:00:00Z" }) as IssuePayload;

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }), functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" } }) }));

import { PrivateEditionSection, __resetEditionSectionCache } from "@/components/prive/edition/PrivateEditionTeaser";
import { nextTrip } from "@/pages/prive/edition/FlightEditionPage";
import { estimateOfflineBytes, isIOS, AVG_IMAGE_BYTES, offlineImageUrls, packPayload } from "@/lib/priveEditionOffline";
import { resolveAction, INTERESTS, personalizeIssue, DEFAULT_PREFS, upcomingAgenda } from "@/lib/priveEdition";
import { createEditionApi } from "@/lib/priveEditionApi";
import { buildEditionPdf } from "@/lib/priveEditionPdf";

const STATUS_REVIEW = { latest: null, published_count: 0, in_review: true, next_scheduled_for: null, prefs_saved: false, generated_at: "2026-10-22T18:00:00Z" };
const STATUS_LIVE = { latest: { slug: "n01-noviembre-2026", number: 1, period_label: { es: "Noviembre 2026", en: "November 2026" }, published_at: "2026-11-01T12:00:00Z" },
  published_count: 1, in_review: false, next_scheduled_for: null, prefs_saved: true, generated_at: "2026-11-01T18:00:00Z" };
const PREFS = { saved: true, edition_kind: "mi_mezcla", interests: { yates_y_embarcaciones: 3 }, excluded: [], language: "es", reading_minutes: 30, section_order: [],
  show_name_on_cover: true, personalization_consent: true, first_name: "Valentina" };
const ok = (data: unknown) => ({ data, error: null });
const pgErr = (message: string, code = "P0001") => ({ data: null, error: { message, code, details: null, hint: null } });

const renderSection = (props: Parameters<typeof PrivateEditionSection>[0] = {}) =>
  render(<MemoryRouter><PrivateEditionSection {...props} /></MemoryRouter>);
const withSession = () => localStorage.setItem("iatos.prive.session", JSON.stringify({ token: "t".repeat(43), expiresAt: new Date(Date.now() + 3600e3).toISOString(), userId: "u-1", remember: true }));

beforeEach(() => {
  rpc.mockReset();
  __resetEditionSectionCache();
  try { localStorage.clear(); } catch { /* noop */ }
  Object.defineProperty(navigator, "language", { value: "es-MX", configurable: true });
});

describe("FOR YOU · sección protagonista de la revista", () => {
  it("sin sesión Privé: presentación estática, sin pedir nada al servidor ni mostrar piezas", async () => {
    renderSection();
    const sec = await screen.findByTestId("private-edition-section");
    await waitFor(() => expect(sec).toHaveAttribute("data-state", "static"));
    expect(screen.getByText(/Exclusiva para miembros Privé/)).toBeInTheDocument();
    expect(screen.queryByTestId("edition-section-actions")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("miembro sin número aprobado: «primer número en revisión editorial», solo Elegir intereses, ninguna pieza", async () => {
    withSession();
    rpc.mockImplementation(async (fn: string) => (fn === "prive_edition_status" ? ok(STATUS_REVIEW) : pgErr("no debería llamarse")));
    renderSection();
    expect(await screen.findByTestId("edition-section-review")).toHaveTextContent("Primer número en revisión editorial");
    expect(screen.getByTestId("private-edition-section")).toHaveAttribute("data-state", "review");
    expect(screen.getByTestId("edition-review-cover")).toBeInTheDocument();
    const links = within(screen.getByTestId("edition-section-actions")).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Elegir intereses"]);
    expect(links[0]).toHaveAttribute("href", "/prive/edicion/mi-edicion");
    expect(screen.queryByTestId("edition-section-picks")).toBeNull();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["prive_edition_status"]);   // ni issue ni prefs
    expect(rpc.mock.calls[0][1]).toEqual({ _ps: "t".repeat(43) });
  });

  it("número programado: lo dice con su fecha", async () => {
    withSession();
    rpc.mockResolvedValue(ok({ ...STATUS_REVIEW, next_scheduled_for: "2026-11-01T12:00:00Z" }));
    renderSection();
    expect(await screen.findByTestId("edition-section-review")).toHaveTextContent(/Próximo número programado para el 1 de noviembre de 2026/);
  });

  it("número publicado: portada, «Mi edición personalizada» (3 piezas, sin carta ni breves) y los cuatro accesos", async () => {
    withSession();
    rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "prive_edition_status") return ok(STATUS_LIVE);
      if (fn === "prive_edition_issue") { expect(args).toEqual({ _slug: "n01-noviembre-2026", _ps: "t".repeat(43) }); return ok(payload); }
      if (fn === "prive_edition_prefs") return ok(PREFS);
      return pgErr("inesperada");
    });
    renderSection();
    const thumb = await screen.findByTestId("edition-cover-thumb");
    expect(within(thumb).getByText("THE PRIVATE EDITION")).toBeInTheDocument();
    const actions = within(screen.getByTestId("edition-section-actions")).getAllByRole("link");
    expect(actions.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Leer revista", "/prive/edicion"], ["Elegir intereses", "/prive/edicion/mi-edicion"],
      ["Descargar para un vuelo", "/prive/edicion/vuelo"], ["Biblioteca", "/prive/edicion/biblioteca"],
    ]);
    const picks = within(screen.getByTestId("edition-section-picks")).getAllByRole("link");
    expect(picks).toHaveLength(3);
    // Personalizada con yates: la pieza de Mónaco sube; nunca la carta ni un breve.
    expect(picks[0]).toHaveAttribute("href", "/prive/edicion/articulo/monaco-yacht-show-2026");
    for (const p of picks) expect(p.getAttribute("href")).not.toMatch(/carta-del-editor|brief-/);
    expect(screen.getByText("La edición de Valentina")).toBeInTheDocument();
    expect(screen.getByText(/Selección y orden automáticos/)).toBeInTheDocument();
  });

  it("servidor sin prive_edition_status (migración sin aplicar): usa la biblioteca y no se rompe", async () => {
    withSession();
    rpc.mockImplementation(async (fn: string) => {
      if (fn === "prive_edition_status") return pgErr("Could not find the function public.prive_edition_status(_ps) in the schema cache", "PGRST202");
      if (fn === "prive_edition_library") return ok({ issues: [], images: {}, saved_count: 0, generated_at: "2026-10-22T18:00:00Z" });
      return pgErr("inesperada");
    });
    renderSection();
    expect(await screen.findByTestId("edition-section-review")).toHaveTextContent(/El primer número está en preparación editorial/);
  });

  it("FREE o PRO sin Privé (el servidor responde PRIVE_*): presentación estática, nada protegido", async () => {
    withSession();
    rpc.mockResolvedValue(pgErr("PRIVE_NOT_PRO"));
    renderSection();
    await waitFor(() => expect(screen.getByTestId("private-edition-section")).toHaveAttribute("data-state", "static"));
    expect(screen.queryByTestId("edition-section-picks")).toBeNull();
    expect(screen.queryByText("La ciudad acelera")).toBeNull();
  });

  it("INSIDER: piezas del destino (slug del Insider) y nada si el número no tiene ese lugar", async () => {
    withSession();
    rpc.mockImplementation(async (fn: string) => (fn === "prive_edition_status" ? ok(STATUS_LIVE) : fn === "prive_edition_issue" ? ok(payload) : ok(PREFS)));
    const a = renderSection({ variant: "insider", destination: "cdmx" });
    const sec = await screen.findByTestId("edition-section-picks");
    expect(within(sec).getAllByRole("link")[0]).toHaveAttribute("href", "/prive/edicion/articulo/cdmx-fin-de-semana-gran-premio");
    a.unmount();
    renderSection({ variant: "insider", destination: "paris" });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("private-edition-section")).toBeNull();
  });
});

describe("Flight Edition y modo sin internet", () => {
  it("el próximo viaje: el que está en curso o el de salida más cercana", () => {
    const t = (id: string, s: string | null, r: string | null) => ({ id, fecha_salida: s, fecha_regreso: r });
    expect(nextTrip([t("b", "2026-12-01", null), t("a", "2026-10-30", "2026-11-02")], "2026-10-22")?.id).toBe("a");
    expect(nextTrip([t("now", "2026-10-20", "2026-10-25"), t("a", "2026-10-30", null)], "2026-10-22")?.id).toBe("now");
    expect(nextTrip([t("x", null, null)], "2026-10-22")).toBeNull();
  });

  it("cuánto ocupará: JSON real de la selección + fotos con permiso offline a su promedio medido", () => {
    const arts = payload.articles!.filter((a) => a.destinations.includes("cdmx"));
    const p = packPayload(payload, arts);
    const imgs = offlineImageUrls(p, p.articles ?? []).length;
    const est = estimateOfflineBytes(payload, arts);
    expect(imgs).toBeGreaterThan(0);
    expect(est).toBeGreaterThan(imgs * AVG_IMAGE_BYTES);
    expect(est).toBeLessThan(imgs * AVG_IMAGE_BYTES + JSON.stringify(p).length + 10_000);
  });

  it("iOS: iPhone, iPad y iPadOS (Mac táctil) se detectan; Android y escritorio no", () => {
    expect(isIOS({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" })).toBe(true);
    expect(isIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", maxTouchPoints: 5 })).toBe(true);
    expect(isIOS({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15", maxTouchPoints: 0 })).toBe(false);
    expect(isIOS({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36" })).toBe(false);
  });

  it("guía práctica: solo consejos vigentes con fuente https y fecha, «antes de llegar» primero, máx. 6", async () => {
    const tip = (id: string, extra: Record<string, unknown> = {}) => ({ id, slug: id, category: "llegada", title: { es: `T ${id}` }, body: { es: "b" }, rank: 50,
      source: { url: "https://ejemplo.gob.mx/x", name: "Fuente", checked_at: "2026-10-01" }, ...extra });
    const content = vi.fn(async () => ({ ok: true as const, data: { found: true, destination: { es: "Ciudad de México" }, tips: [
      tip("a", { rank: 10 }), tip("b", { before_you_go: true, rank: 40 }), tip("viejo", { stale: true }), tip("http", { source: { url: "http://x", name: "x", checked_at: "2026-10-01" } }),
      tip("vencido", { valid_until: "2026-10-01" }), tip("sin-fecha", { source: { url: "https://x", name: "x", checked_at: "" } }),
      tip("c"), tip("d"), tip("e"), tip("f"), tip("g"),
    ] } }));
    const g = await createEditionApi(content as never).practicalGuide("cdmx", "2026-10-22") as PracticalGuide;
    expect(content).toHaveBeenCalledWith("prive_insider", { _destination: "cdmx" });
    expect(g.destination).toBe("Ciudad de México");
    expect(g.tips.map((t) => t.id)).toEqual(["b", "a", "c", "d", "e", "f"]);
    const none = await createEditionApi((async () => ({ ok: true, data: { found: false } })) as never).practicalGuide("atlantida");
    expect(none).toBeNull();
  });

  it("el PDF de Flight Edition lleva la guía práctica con fuente y fecha de revisión", async () => {
    class Plain extends jsPDF { constructor(o: Record<string, unknown>) { super({ ...o, compress: false }); } }
    const guide: PracticalGuide = { destination: "Ciudad de México", as_of: "2026-10-22T18:00:00Z", tips: [
      { id: "1", category: "llegada", title: { es: "Hoy No Circula también aplica a autos foráneos" }, body: { es: "Revisa tu holograma antes de rentar." },
        source: { url: "https://www.sedema.cdmx.gob.mx/", name: "SEDEMA", checked_at: "2026-10-01" } },
    ] };
    const articles = payload.articles!.filter((a) => a.slug === "cdmx-fin-de-semana-gran-premio");
    const r = await buildEditionPdf({ payload, articles, lang: "es", kind: "flight", destinationLabel: "Ciudad de México", guide, now: new Date("2026-10-22T18:00:00Z") },
      { jsPDF: Plain as unknown as typeof jsPDF, loadImage: async () => null });
    const s = Buffer.from(r.bytes).toString("latin1");
    expect(s).toContain("Antes de llegar a Ciudad de M");
    expect(s).toContain("Hoy No Circula");
    expect(s).toContain("SEDEMA");
    expect(s).toContain("https://www.sedema.cdmx.gob.mx/");
  });
});

describe("portada que vence (Gran Premio: vigente hasta el 2-nov)", () => {
  it("vencida, deja la portada al siguiente reportaje vigente con foto; la pieza sigue en el índice con su aviso", () => {
    const expired = { ...payload, articles: payload.articles!.map((a) => (a.slug === "cdmx-fin-de-semana-gran-premio" ? { ...a, expired: true } : a)) };
    const ed = personalizeIssue(expired, { ...DEFAULT_PREFS, reading_minutes: 120 });
    expect(ed.cover?.slug).toBe("merida-guadalajara-mesa-mexicana");
    expect(ed.coverImage).toBe("img_merida_catedral");
    expect([...ed.sections.flatMap((s) => s.articles), ...ed.moreTime].some((a) => a.slug === "cdmx-fin-de-semana-gran-premio")).toBe(true);
    // Vigente, la portada es la del editor.
    expect(personalizeIssue(payload, DEFAULT_PREFS).cover?.slug).toBe("cdmx-fin-de-semana-gran-premio");
  });
  it("agenda: las fechas que ya terminaron no se muestran (ni en línea, ni sin conexión, ni en el PDF)", () => {
    const items = [{ date: "2026-10-30", end: "2026-11-01" }, { date: "2026-10-31" }, { date: "2026-11-05" }];
    expect(upcomingAgenda(items, "2026-11-01")).toEqual({ items: [items[0], items[2]], past: 1 });
    expect(upcomingAgenda(items, "2026-10-22").past).toBe(0);
  });
});

describe("From Page to Experience e intereses", () => {
  it("«Pregúntale a Iato» lleva la pregunta en state.prefill y en ?ask= (el enlace del PDF no tiene estado)", () => {
    const r = resolveAction({ kind: "ask_iato", label: { es: "Pregúntale a Iato" }, prompt: { es: "Arma mi fin de semana del Gran Premio" } }, "es");
    expect(r).toMatchObject({ kind: "internal", state: { prefill: "Arma mi fin de semana del Gran Premio" } });
    expect(r && "to" in r ? r.to : "").toBe(`/dashboard/concierge?ask=${encodeURIComponent("Arma mi fin de semana del Gran Premio")}`);
  });

  it("los intereses que pidió el dueño están todos (sin separar por género)", () => {
    const labels = INTERESTS.map((i) => i.es.toLowerCase());
    for (const w of ["yates", "aviación", "superautos", "relojes", "moda", "belleza", "joyería", "finanzas", "negocios", "tecnología", "inteligencia artificial",
      "deportes", "fórmula 1", "gastronomía", "viajes", "arte", "noticias mundiales", "méxico", "cultura", "wellness"]) {
      expect(labels.some((l) => l.includes(w))).toBe(true);
    }
    expect(labels.some((l) => /mujer|hombre|femenin|masculin/.test(l))).toBe(false);
  });
});
