// Tarjetas de rango (my_member_card): las 5 variantes, la mini en el menú principal (barra lateral y
// "Más" en móvil) que se abre grande, "Cómo subir de nivel" sin la negra, la credencial junto al Travel
// Avatar, el Passport de Privé con el mismo rango y en el idioma de Privé, y prefers-reduced-motion.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";

const rpc = vi.fn();
const qb: any = { select: () => qb, eq: () => qb, lt: () => qb, order: () => qb, limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => qb, functions: { invoke: vi.fn(async () => ({ data: null, error: { message: "x" } })) } },
}));
// Objeto estable (como el AuthProvider real): DashboardLayout lee el perfil cada vez que cambia `user`.
const auth = { user: { id: "u1", email: "v@example.test", user_metadata: { full_name: "Valentina Ríos" } }, signOut: async () => {} };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useSubscription", () => ({ useSubscription: () => ({ loading: false, isPro: true }) }));
vi.mock("@/components/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/hooks/usePriveSeal", () => ({ usePriveSeal: () => false }));
vi.mock("@/hooks/useMyAvatar", () => ({ useMyAvatar: () => ({ url: null }) }));
vi.mock("@/components/avatar/useAvatarSouvenirs", async (orig) => ({ ...(await orig<object>()), useAvatarSouvenirs: () => ({ rows: [], loading: false, available: true, reload: () => {} }) }));
const access = { session: { token: "tok" } as null | { token: string }, content: vi.fn(), status: null };
vi.mock("@/hooks/usePriveAccess", () => ({ usePriveAccess: () => access }));

import { DashboardLayout } from "@/components/DashboardLayout";
import { TierCard } from "@/components/membercard/TierCard";
import { MemberCardDetail } from "@/components/membercard/MemberCardButton";
import { TravelAvatarCinematic } from "@/components/lux/TravelAvatarCinematic";
import { PassportCard } from "@/components/prive/value";
import { PriveLangProvider } from "@/components/prive/PriveLang";
import { cardReason, clearMemberCardCache, MEMBER_TIERS, parseMemberCard, tierText, type MemberCardData, type MemberTier } from "@/lib/memberCard";
import { VALUE_TEXT } from "@/lib/priveValueI18n";

const card = (tier: MemberTier, over: Partial<MemberCardData> = {}): MemberCardData => ({
  tier, since: "2025-06-01T18:00:00Z", number: tier === "blue" || tier === "gold" ? "IA-QN5U-FM8S" : "IP-7KQM-X4TD",
  tenure_days: 300, prive_days: tier.startsWith("platinum") ? 300 : null, granted: false, name: "Valentina Ríos", ...over,
});
const serve = (c: MemberCardData | Record<string, unknown> | null) =>
  rpc.mockImplementation(async (fn: string) => (fn === "my_member_card" ? { data: c, error: null } : { data: null, error: { message: "otra" } }));

const setReducedMotion = (on: boolean) => {
  window.matchMedia = ((q: string) => ({
    matches: on && q.includes("prefers-reduced-motion"), media: q, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
};

beforeEach(() => { rpc.mockReset(); clearMemberCardCache(); setReducedMotion(false); });
afterEach(() => setReducedMotion(false));

const renderLayout = () =>
  render(<MemoryRouter initialEntries={["/dashboard"]}><DashboardLayout><div>PAGINA</div></DashboardLayout></MemoryRouter>);

describe("las 5 variantes", () => {
  const faces: Record<MemberTier, RegExp> = {
    blue: /^AZUL$/, gold: /^DORADA$/, platinum_1: /^PLATINUM I$/, platinum_2: /^PLATINUM II$/, founder_black: /^FUNDADOR$/,
  };
  for (const tier of MEMBER_TIERS) {
    it(`${tier}: proporción ISO, rango, nombre, número y "Miembro desde"`, () => {
      render(<TierCard {...card(tier)} />);
      const el = screen.getByTestId("member-tier-card");
      expect(el).toHaveAttribute("data-tier", tier);
      expect(el.className).toContain("mc-card");
      expect(screen.getByTestId("member-tier-face").textContent).toMatch(faces[tier]);
      expect(el).toHaveTextContent("Valentina Ríos");
      expect(screen.getByTestId("member-tier-number")).toHaveTextContent(card(tier).number!);
      expect(el).toHaveTextContent("Miembro desde");
      expect(el).toHaveTextContent("06/25");
      expect(el.getAttribute("aria-label")).toMatch(/Tarjeta IATOS/);
    });
  }
  it("la negra lleva FUNDADOR, \"Edición negra\" y su emblema; Platinum II su marca II; las demás no", () => {
    const { rerender, container } = render(<TierCard {...card("founder_black")} />);
    expect(screen.getByTestId("member-tier-face")).toHaveTextContent("FUNDADOR");
    expect(screen.getByTestId("member-founder-legend")).toHaveTextContent("Edición negra");
    expect(container.querySelector(".mc-mark-emblem")).not.toBeNull();
    rerender(<TierCard {...card("platinum_2")} />);
    expect(container.querySelector(".mc-mark-ii")).toHaveTextContent("II");
    expect(screen.queryByTestId("member-founder-legend")).toBeNull();
    for (const t of ["blue", "gold", "platinum_1"] as const) {
      rerender(<TierCard {...card(t)} />);
      expect(container.querySelector(".mc-mark-ii, .mc-mark-emblem")).toBeNull();
      expect(screen.queryByText(/FUNDADOR|FOUNDER|Edición negra/)).toBeNull();
    }
  });
  it("en inglés (Privé en inglés) la cara dice FOUNDER / Member since", () => {
    render(<TierCard {...card("founder_black")} lang="en" />);
    expect(screen.getByTestId("member-tier-face")).toHaveTextContent("FOUNDER");
    expect(screen.getByTestId("member-tier-card")).toHaveTextContent("Member since");
  });
  it("cada variante tiene su propio acabado en el CSS (negro mate, platino II con guilloché e iridiscencia)", () => {
    const css = readFileSync("src/components/membercard/memberCard.css", "utf8");
    for (const t of MEMBER_TIERS) expect(css).toContain(`.mc-card[data-tier="${t}"]`);
    expect(css).toMatch(/data-tier="platinum_2"\]::after/);
    expect(css).toMatch(/aspect-ratio: 85\.6 \/ 54/);
  });
});

describe("solo datos del servidor", () => {
  it("rangos desconocidos o números con otra forma se rechazan (no se inventa una tarjeta)", () => {
    expect(parseMemberCard({ tier: "black" })).toBeNull();
    expect(parseMemberCard({ tier: "FOUNDER_BLACK" })).toBeNull();
    expect(parseMemberCard(null)).toBeNull();
    expect(parseMemberCard({ tier: "gold", number: "<b>1</b>" })?.number).toBeNull();
    expect(parseMemberCard({ tier: "gold", number: "IA-QN5U-FM8S", tenure_days: -3 })).toMatchObject({ number: "IA-QN5U-FM8S", tenure_days: null });
  });
  it("si la RPC falla, el menú no muestra ninguna tarjeta", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    renderLayout();
    await waitFor(() => expect(screen.queryByTestId("sidebar-card-loading")).toBeNull());
    expect(screen.queryByTestId("sidebar-card")).toBeNull();
  });
});

describe("menú principal", () => {
  it("barra lateral: mini tarjeta de TU rango; al tocarla se abre grande con el detalle", async () => {
    serve(card("platinum_1", { prive_days: 300 }));
    renderLayout();
    const mini = await screen.findByTestId("sidebar-card");
    expect(rpc).toHaveBeenCalledWith("my_member_card");
    expect(mini).toHaveAttribute("data-tier", "platinum_1");
    expect(within(mini).getByTestId("sidebar-card-card")).toHaveAttribute("data-size", "mini");
    fireEvent.click(mini);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("member-tier-card-full")).toHaveAttribute("data-tier", "platinum_1");
    expect(within(dialog).getByTestId("member-card-rank")).toHaveTextContent("Platinum I");
    expect(dialog).toHaveTextContent("Tienes IATOS Privé activo.");
    expect(within(dialog).getByTestId("member-card-days-left")).toHaveTextContent("Te faltan 65 días para Platinum II.");
  });
  it("móvil: la misma tarjeta arriba de \"Más\"", async () => {
    serve(card("gold"));
    renderLayout();
    fireEvent.click(screen.getByRole("button", { name: "Más" }));
    const sheet = await screen.findByRole("dialog");
    const mini = await within(sheet).findByTestId("more-card");
    expect(mini).toHaveAttribute("data-tier", "gold");
    expect(within(sheet).getByTestId("more-member-card")).toHaveTextContent("Dorada");
  });
  it("una sola petición para el menú y el Travel Avatar (misma cuenta)", async () => {
    serve(card("blue"));
    render(<MemoryRouter><DashboardLayout><TravelAvatarCinematic dna={null} /></DashboardLayout></MemoryRouter>);
    await screen.findByTestId("sidebar-card");
    await screen.findByTestId("avatar-card");
    expect(rpc.mock.calls.filter((c) => c[0] === "my_member_card")).toHaveLength(1);
  });
});

describe("Cómo subir de nivel", () => {
  const ladderText = (c: MemberCardData) => {
    const { unmount } = render(<MemoryRouter><MemberCardDetail card={c} /></MemoryRouter>);
    const out = screen.queryByTestId("member-card-howto")?.textContent ?? null;
    const all = screen.getByTestId("member-card-detail").textContent ?? "";
    unmount();
    return { out, all };
  };
  it("PRO → Dorada, Privé → Platinum I, 1 año en Privé → Platinum II; nunca la negra", () => {
    for (const t of ["blue", "gold", "platinum_1", "platinum_2"] as const) {
      const { out, all } = ladderText(card(t));
      expect(out).toMatch(/IATOS PRO\s*→\s*:?\s*Dorada/);
      expect(out).toMatch(/IATOS Privé\s*→\s*:?\s*Platinum I/);
      expect(out).toMatch(/1 año en Privé\s*→\s*:?\s*Platinum II/);
      expect(all).not.toMatch(/negra|black|fundador|founder|centurion/i);
    }
  });
  it("marca lo alcanzado según el rango del servidor", () => {
    render(<MemoryRouter><MemberCardDetail card={card("gold")} /></MemoryRouter>);
    expect(screen.getByTestId("member-card-step-gold")).toHaveAttribute("data-reached", "true");
    expect(screen.getByTestId("member-card-step-platinum_1")).toHaveAttribute("data-reached", "false");
    expect(screen.getByRole("link", { name: "Conoce IATOS Privé" })).toHaveAttribute("href", "/prive");
  });
  it("un otorgamiento se explica como tal (no dice que cumpliste un año)", () => {
    render(<MemoryRouter><MemberCardDetail card={card("platinum_2", { granted: true, prive_days: null })} /></MemoryRouter>);
    expect(screen.getByTestId("member-card-detail")).toHaveTextContent("Rango otorgado por IATOS.");
    expect(screen.getByTestId("member-card-detail")).not.toHaveTextContent("Cumpliste un año");
  });
  it("el fundador ve su tarjeta sin escalera", () => {
    render(<MemoryRouter><MemberCardDetail card={card("founder_black")} /></MemoryRouter>);
    expect(screen.queryByTestId("member-card-howto")).toBeNull();
    expect(screen.getByTestId("member-card-rank")).toHaveTextContent("Fundador");
  });
});

describe("Travel Avatar", () => {
  it("la credencial va junto al avatar, compacta, y se abre grande", async () => {
    serve(card("platinum_2"));
    render(<MemoryRouter><TravelAvatarCinematic dna={null} /></MemoryRouter>);
    const fig = await screen.findByTestId("avatar-member-card");
    expect(fig).toHaveTextContent("Credencial · Platinum II");
    const mini = within(fig).getByTestId("avatar-card");
    expect(within(mini).getByTestId("avatar-card-card")).toHaveAttribute("data-size", "mini");
    fireEvent.click(mini);
    expect(within(await screen.findByRole("dialog")).getByTestId("member-card-rank")).toHaveTextContent("Platinum II");
  });
});

describe("THE PRIVÉ PASSPORT", () => {
  const passport = { member: { first_name: "Valentina", member_code: "IP-7KQM-X4TD", member_since: "2026-07-01T18:00:00Z", tenure_days: 113, status: "active", founding_member: false },
    stats: { visitado: 0, experiencia: 0, favorito: 0, deseo: 0, recuerdo: 0, countries: 0 }, entries: [] };
  beforeEach(() => { access.content = vi.fn(async (fn: string) => (fn === "prive_passport" ? { ok: true, data: passport } : { ok: true, data: true })); });
  it("usa el mismo rango del servidor (Platinum II / Fundador)", async () => {
    serve(card("platinum_2"));
    const { unmount } = render(<MemoryRouter><PassportCard /></MemoryRouter>);
    const c = await screen.findByTestId("prive-passport-card");
    await waitFor(() => expect(c).toHaveAttribute("data-tier", "platinum_2"));
    expect(screen.getByTestId("prive-passport-tier-card")).toHaveAttribute("data-tier", "platinum_2");
    expect(screen.getByTestId("prive-passport-rank")).toHaveTextContent("Platinum II");
    expect(screen.getByTestId("prive-member-number")).toHaveTextContent("IP-7KQM-X4TD");
    unmount();
    serve(card("founder_black"));
    render(<MemoryRouter><PassportCard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("prive-passport-card")).toHaveAttribute("data-tier", "founder_black"));
  });
  it("Passport en el idioma de Privé: en español, sin \"Member\" ni \"Status\" en inglés", async () => {
    // El navegador dice inglés, pero Privé está en español (PriveLangProvider): el Passport lo sigue.
    rpc.mockResolvedValue({ data: null, error: { message: "sin tarjeta" } });
    render(<MemoryRouter><PriveLangProvider lang="es"><PassportCard /></PriveLangProvider></MemoryRouter>);
    const c = await screen.findByTestId("prive-passport-card");
    expect(c).toHaveTextContent("Miembro");
    expect(c).toHaveTextContent("Miembro desde");
    expect(c).toHaveTextContent("Estado: Activa");
    expect(c.textContent).not.toMatch(/Member|Status|Since/);
    expect(c.getAttribute("aria-label")).toBe("IATOS Privé · Tarjeta de miembro");
    expect(c.querySelector('[lang="en"]')).toBeNull();
  });
  it("y en inglés solo si Privé está en inglés", async () => {
    serve(card("platinum_1"));
    render(<MemoryRouter><PriveLangProvider lang="en"><PassportCard /></PriveLangProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("prive-passport-card")).toHaveAttribute("data-tier", "platinum_1"));
    expect(screen.getByTestId("prive-passport-card")).toHaveTextContent("Member since");
    expect(screen.getByTestId("prive-passport-tier-card")).toHaveTextContent("PLATINUM I");
  });
  it("el diccionario en español del Passport ya no mezcla inglés", () => {
    const p = VALUE_TEXT.es.passport;
    for (const v of [p.member, p.memberSince, p.founding, p.status, p.active, p.cardAria]) expect(v).not.toMatch(/Member|Since|Founding|Status|Active/);
  });
});

describe("prefers-reduced-motion", () => {
  it("con movimiento: la tarjeta grande se inclina y el brillo sigue al puntero", () => {
    render(<TierCard {...card("founder_black")} interactive />);
    const el = screen.getByTestId("member-tier-card");
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 126, right: 200, bottom: 126, x: 0, y: 0, toJSON: () => ({}) });
    expect(el).toHaveAttribute("data-motion", "full");
    act(() => { fireEvent.pointerMove(el, { clientX: 180, clientY: 20 }); });
    expect(el.style.getPropertyValue("--mc-ry")).not.toBe("");
    expect(el).toHaveAttribute("data-tilting", "true");
    act(() => { fireEvent.pointerLeave(el); });
    expect(el.style.getPropertyValue("--mc-ry")).toBe("");
  });
  it("con reduced motion: sin inclinación ni brillo animado", () => {
    setReducedMotion(true);
    render(<TierCard {...card("founder_black")} interactive />);
    const el = screen.getByTestId("member-tier-card");
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 126, right: 200, bottom: 126, x: 0, y: 0, toJSON: () => ({}) });
    expect(el).toHaveAttribute("data-motion", "reduce");
    act(() => { fireEvent.pointerMove(el, { clientX: 180, clientY: 20 }); });
    expect(el.style.getPropertyValue("--mc-ry")).toBe("");
    expect(el).toHaveAttribute("data-tilting", "false");
    const css = readFileSync("src/components/membercard/memberCard.css", "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/);
    expect(css).toMatch(/\.mc-card\[data-motion="reduce"\] \.mc-sheen \{ animation: none !important; \}/);
  });
});

describe("ediciones especiales (Platinum Rose Gold / Platinum II Special Edition)", () => {
  const raw = (tier: string, edition: unknown) => ({ tier, since: "2025-06-01T18:00:00Z", number: "IP-7KQM-X4TD", granted: true, name: "Sophia R", edition });
  it("parse: solo rose_gold | special y solo en Platinum; cualquier otra cosa = null", () => {
    expect(parseMemberCard(raw("platinum_2", "rose_gold"))?.edition).toBe("rose_gold");
    expect(parseMemberCard(raw("platinum_2", "special"))?.edition).toBe("special");
    expect(parseMemberCard(raw("platinum_1", "special"))?.edition).toBe("special");
    for (const bad of ["ROSE_GOLD", "gold", "black", "special ", "", 1, true, {}, ["special"], null, undefined]) {
      expect(parseMemberCard(raw("platinum_2", bad))?.edition).toBeNull();
    }
    const { edition: _drop, ...sin } = raw("platinum_2", "x");
    expect(parseMemberCard(sin)?.edition).toBeNull();
    for (const t of ["founder_black", "gold", "blue"]) expect(parseMemberCard(raw(t, "special"))?.edition).toBeNull();
    // La edición nunca cambia el rango.
    expect(parseMemberCard(raw("platinum_2", "special"))?.tier).toBe("platinum_2");
  });
  it("textos ES/EN: nombre, cara, sello y razón", () => {
    expect(tierText("platinum_2", "es", "rose_gold")).toMatchObject({ name: "Platinum Rose Gold", face: "ROSE GOLD", seal: null, reason: "Edición especial otorgada por IATOS." });
    expect(tierText("platinum_2", "es", "special")).toMatchObject({ name: "Platinum II Special Edition", face: "PLATINUM", seal: "SPECIAL EDITION", reason: "Edición especial otorgada por IATOS." });
    expect(tierText("platinum_2", "en", "rose_gold")).toMatchObject({ name: "Platinum Rose Gold", face: "ROSE GOLD", reason: "Special edition granted by IATOS." });
    expect(tierText("platinum_2", "en", "special")).toMatchObject({ name: "Platinum II Special Edition", face: "PLATINUM", seal: "SPECIAL EDITION" });
    expect(tierText("platinum_1", "es", "special").name).toBe("Platinum I Special Edition");
    // Sin edición, o fuera de Platinum, los textos de siempre.
    expect(tierText("platinum_2", "es").name).toBe("Platinum II");
    expect(tierText("founder_black", "es", "special").name).toBe("Fundador");
    expect(tierText("gold", "es", "rose_gold").name).toBe("Dorada");
    expect(cardReason(card("platinum_2", { granted: true, edition: "special" }))).toBe("Edición especial otorgada por IATOS.");
    expect(cardReason(card("platinum_2", { granted: true }))).toBe("Rango otorgado por IATOS.");
  });
  for (const size of ["full", "mini"] as const) {
    it(`Rose Gold en ${size}: data-edition, cara ROSE GOLD sin numeral, roseta y sin marca II`, () => {
      const { container } = render(<TierCard {...card("platinum_2", { edition: "rose_gold" })} size={size} />);
      const el = screen.getByTestId("member-tier-card");
      expect(el).toHaveAttribute("data-tier", "platinum_2");
      expect(el).toHaveAttribute("data-edition", "rose_gold");
      expect(el).toHaveAttribute("data-size", size);
      expect(screen.getByTestId("member-tier-face").textContent).toBe("ROSE GOLD");
      expect(container.querySelector(".mc-mark-rose")).not.toBeNull();
      expect(container.querySelector(".mc-mark-ii")).toBeNull();
      expect(screen.queryByTestId("member-edition-seal")).toBeNull();
      expect(el.getAttribute("aria-label")).toMatch(/^Tarjeta IATOS Platinum Rose Gold · Valentina Ríos/);
      expect(screen.getByTestId("member-tier-number")).toHaveTextContent("IP-7KQM-X4TD");
    });
    it(`Special Edition en ${size}: cara PLATINUM II, sello SPECIAL EDITION y marca II`, () => {
      const { container } = render(<TierCard {...card("platinum_2", { edition: "special" })} size={size} />);
      const el = screen.getByTestId("member-tier-card");
      expect(el).toHaveAttribute("data-edition", "special");
      expect(el).toHaveAttribute("data-size", size);
      expect(screen.getByTestId("member-tier-face").textContent).toBe("PLATINUM II");
      expect(screen.getByTestId("member-edition-seal")).toHaveTextContent("SPECIAL EDITION");
      expect(container.querySelector(".mc-mark-ii")).toHaveTextContent("II");
      expect(container.querySelector(".mc-mark-rose")).toBeNull();
      expect(el.getAttribute("aria-label")).toMatch(/^Tarjeta IATOS Platinum II Special Edition/);
    });
  }
  it("TierCard ignora la edición fuera de Platinum (la negra nunca lleva edición)", () => {
    const { rerender } = render(<TierCard {...card("founder_black", { edition: "special" })} />);
    expect(screen.getByTestId("member-tier-card")).not.toHaveAttribute("data-edition");
    expect(screen.getByTestId("member-tier-face")).toHaveTextContent("FUNDADOR");
    expect(screen.queryByTestId("member-edition-seal")).toBeNull();
    rerender(<TierCard {...card("gold", { edition: "rose_gold" })} />);
    expect(screen.getByTestId("member-tier-card")).not.toHaveAttribute("data-edition");
    expect(screen.getByTestId("member-tier-face").textContent).toBe("DORADA");
  });
  it("CSS propio para cada edición, borde holográfico y quieto con reduced motion", () => {
    const css = readFileSync("src/components/membercard/memberCard.css", "utf8");
    expect(css).toContain('.mc-card[data-tier][data-edition="rose_gold"] {');
    expect(css).toContain('.mc-card[data-tier][data-edition="special"] {');
    expect(css).toMatch(/data-edition="special"\]::after \{[\s\S]*animation: mc-holo/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mc-card::after, \.mc-card::before \{ animation: none !important; \}/);
    expect(css).toMatch(/\.mc-card\[data-motion="reduce"\]::after, \.mc-card\[data-motion="reduce"\]::before \{ animation: none !important; \}/);
  });
  it("detalle: nombre y razón de la edición; \"Cómo subir de nivel\" no la ofrece", () => {
    for (const edition of ["rose_gold", "special"] as const) {
      const { unmount } = render(<MemoryRouter><MemberCardDetail card={card("platinum_2", { granted: true, edition })} /></MemoryRouter>);
      expect(screen.getByTestId("member-tier-card-full")).toHaveAttribute("data-edition", edition);
      expect(screen.getByTestId("member-card-rank")).toHaveTextContent(edition === "rose_gold" ? "Platinum Rose Gold" : "Platinum II Special Edition");
      expect(screen.getByTestId("member-card-reason")).toHaveTextContent("Edición especial otorgada por IATOS.");
      const howto = screen.getByTestId("member-card-howto").textContent ?? "";
      expect(howto).toMatch(/1 año en Privé\s*→\s*:?\s*Platinum II/);
      expect(howto).not.toMatch(/rose|special|edici[oó]n|oro rosa/i);
      unmount();
    }
  });
  it("menú: la mini y el nombre muestran la edición; al abrirla, la grande también", async () => {
    serve({ ...card("platinum_2", { granted: true }), edition: "rose_gold" });
    renderLayout();
    const mini = await screen.findByTestId("sidebar-card");
    expect(mini).toHaveAttribute("data-edition", "rose_gold");
    expect(within(mini).getByTestId("sidebar-card-card")).toHaveAttribute("data-size", "mini");
    expect(screen.getByTestId("sidebar-member-card")).toHaveTextContent("Platinum Rose Gold");
    expect(mini).toHaveAccessibleName("Ver mi tarjeta Platinum Rose Gold");
    fireEvent.click(mini);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("member-tier-card-full")).toHaveAttribute("data-edition", "rose_gold");
  });
  it("THE PRIVÉ PASSPORT usa la misma edición", async () => {
    const passport = { member: { first_name: "Patricio", member_code: "IP-7KQM-X4TD", member_since: "2026-07-01T18:00:00Z", tenure_days: 113, status: "active", founding_member: false },
      stats: { visitado: 0, experiencia: 0, favorito: 0, deseo: 0, recuerdo: 0, countries: 0 }, entries: [] };
    access.content = vi.fn(async (fn: string) => (fn === "prive_passport" ? { ok: true, data: passport } : { ok: true, data: true }));
    serve({ ...card("platinum_2", { granted: true }), edition: "special" });
    render(<MemoryRouter><PassportCard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId("prive-passport-card")).toHaveAttribute("data-edition", "special"));
    expect(screen.getByTestId("prive-passport-tier-card")).toHaveAttribute("data-edition", "special");
    expect(screen.getByTestId("prive-passport-rank")).toHaveTextContent("Platinum II Special Edition");
  });
});
