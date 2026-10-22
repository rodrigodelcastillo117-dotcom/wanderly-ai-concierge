// Social: "Ver" abre el perfil del amigo, perfil privado, viajes juntos, postal con los dos
// avatares, saludos con límite de 24 h y nada de datos sensibles en pantalla.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localISODatePlus } from "@/lib/localDate";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  invoke: vi.fn(async () => ({ data: null, error: null })),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  user: { id: "aaaaaaaa-0000-4000-8000-00000000000a" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: h.rpc, from: h.from, functions: { invoke: h.invoke } },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/media/SmartImage", () => ({
  SmartImage: ({ children, alt }: { children?: React.ReactNode; alt: string }) => <div data-testid="smart-image" data-alt={alt}>{children}</div>,
}));
vi.mock("@/lib/stockPhoto", () => ({ getStockPhoto: async () => null, cachedStockPhoto: () => null }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("sonner", () => ({ toast: h.toast }));

import Social from "@/pages/Social";
import { InviteFriendDialog } from "@/components/InviteFriendDialog";
import FriendProfile from "@/pages/FriendProfile";
import { notificationTarget } from "@/lib/notificationTarget";
import { commonGround, parseFriendProfile, parseFriendSummaries, pickPostcardTrip, summaryLine, untilText } from "@/lib/social";
import { drawPostcard, postcardCaption, POSTCARD_W, POSTCARD_H } from "@/lib/postcard";
import { flagEmoji, uniqueCountries } from "@/lib/countryFlags";

const ME = "aaaaaaaa-0000-4000-8000-00000000000a";
const CARLO = "bbbbbbbb-0000-4000-8000-00000000000b";

function qb(rows: unknown) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api, order: () => api, or: () => api, delete: () => api,
    maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return api;
}

function profileResponse(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    amigo: {
      id: CARLO, full_name: "Carlo Bianchi", username: "carlo", avatar_url: "https://cdn.example.test/carlo.png",
      ciudad_origen: "Guadalajara", pais_origen: "México", is_prive: true,
      // Lo que NUNCA debe pintarse aunque llegara:
      email: "carlo-secreto@example.test", phone: "+52 55 1234 5678", fecha_nacimiento: "1991-07-14", loyalty_programs: [{ numero: "CP-998877" }],
    },
    yo_prive: false,
    amigos_desde: "2026-10-01T12:00:00Z",
    dna: { estilo: "Explorador gastronómico", ritmo: "equilibrado", comida: ["foodie"], tardes: ["museos", "playas"], hospedaje: ["boutique"] },
    en_comun: { comida: ["foodie"], tardes: ["museos"], hospedaje: [], mismo_ritmo: true, mismo_presupuesto: false, destinos: ["cdmx"], suenos: ["Japón"], yo_tengo_dna: true, amigo_tiene_dna: true, afinidad: 72 },
    viajes_juntos: [
      { id: "t2", destino: "Tokio", pais_destino: "Japón", fecha_salida: localISODatePlus(40), fecha_regreso: localISODatePlus(50), cover_image_url: null, status: "listo" },
      { id: "t1", destino: "Roma", pais_destino: "Italia", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-17", cover_image_url: "https://cdn.example.test/roma.jpg", status: "listo" },
      { id: "t4", destino: "Madrid", pais_destino: "España", fecha_salida: "2025-09-01", fecha_regreso: "2025-09-06", cover_image_url: null, status: "listo" },
    ],
    viajes_juntos_total: 3,
    lugares: [{ ciudad: "Roma", pais: "Italia" }, { ciudad: "Oaxaca", pais: "México" }, { ciudad: "CDMX", pais: null }],
    saludos: { puedo: true, proximo: null, ultimo_enviado: null, ultimo_recibido: null, gesto_recibido: null, por_devolver: false, total: 4 },
    ...over,
  };
}

function renderProfile(id = CARLO) {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/social/amigo/${id}`]}>
      <Routes>
        <Route path="/dashboard/social/amigo/:id" element={<FriendProfile />} />
        <Route path="/dashboard/social" element={<p>Pantalla Social</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  h.from.mockImplementation((t: string) => qb(t === "profiles" ? [{ full_name: "Rodrigo del Castillo", avatar_url: "https://cdn.example.test/rodrigo.png", invite_code: "A3K9PQ7M" }] : []));
  Object.values(h.toast).forEach((f) => f.mockReset());
});

describe("lista de amigos en Social", () => {
  it('"Ver" abre la página de perfil del amigo y no muestra "0 %"', async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === "friend_profiles") return { data: [{ id: CARLO, full_name: "Carlo Bianchi", username: "carlo", avatar_url: null }], error: null };
      if (fn === "amigos_resumen") return { data: [{ amigo_id: CARLO, is_prive: true, viajes_juntos: 0, afinidad: 0, en_comun: { comida: ["foodie"] }, saludo_por_devolver: false }], error: null };
      return { data: null, error: null };
    });
    function Amigo() { const { id } = useParams(); return <p>Perfil de {id}</p>; }
    render(
      <MemoryRouter initialEntries={["/dashboard/social"]}>
        <Routes>
          <Route path="/dashboard/social" element={<Social />} />
          <Route path="/dashboard/social/amigo/:id" element={<Amigo />} />
        </Routes>
      </MemoryRouter>,
    );
    const ver = await screen.findByRole("button", { name: "Ver perfil de Carlo Bianchi" });
    expect(await screen.findByText("🌮 Los dos aman la comida callejera")).toBeInTheDocument();
    expect(screen.queryByText(/0\s?%/)).toBeNull();
    expect(h.rpc).not.toHaveBeenCalledWith("compatibilidad_viaje", expect.anything());
    expect(screen.getByRole("img", { name: "Miembro IATOS Privé" })).toBeInTheDocument();
    fireEvent.click(ver);
    expect(await screen.findByText(`Perfil de ${CARLO}`)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("perfil de un amigo", () => {
  it("quien no es amigo ve un perfil privado, sin datos", async () => {
    h.rpc.mockResolvedValue({ data: { ok: false, error: "privado" }, error: null });
    renderProfile();
    expect(await screen.findByText("Este perfil es privado")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("amigo_perfil", { p_amigo: CARLO });
    expect(screen.queryByTestId("friend-avatar")).toBeNull();
    expect(screen.getByRole("link", { name: "Volver a Social" })).toHaveAttribute("href", "/dashboard/social");
  });

  it("un id inválido es privado sin llamar al servidor", async () => {
    renderProfile("no-es-un-id");
    expect(await screen.findByText("Este perfil es privado")).toBeInTheDocument();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("muestra avatar, ciudad, contador de viajes juntos y la lista con fotos", async () => {
    h.rpc.mockResolvedValue({ data: profileResponse(), error: null });
    renderProfile();
    expect(await screen.findByRole("heading", { level: 1, name: /^Carlo Bianchi/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("friend-avatar")).getByRole("img", { name: "Avatar de Carlo Bianchi" })).toHaveAttribute("src", "https://cdn.example.test/carlo.png");
    expect(screen.getByText("Guadalajara, México")).toBeInTheDocument();
    expect(screen.getByText("Amigos desde octubre 2026")).toBeInTheDocument();
    expect(screen.getByTestId("shared-trips-count")).toHaveTextContent("3");
    expect(screen.getByTestId("pokes-count")).toHaveTextContent("4");
    const viajes = screen.getByRole("region", { name: "Viajes juntos" });
    expect(within(viajes).getAllByRole("heading", { level: 3 }).map((x) => x.textContent)).toEqual(["Tokio", "Roma", "Madrid"]);
    expect(within(viajes).getByRole("link", { name: /Roma/ })).toHaveAttribute("href", "/dashboard/viajes/t1");
    // Afinidad alta + frases positivas.
    expect(screen.getByTestId("affinity")).toHaveTextContent("72%");
    expect(screen.getByText("Ambos viajaron a CDMX")).toBeInTheDocument();
    expect(screen.getByText("Los dos sueñan con Japón")).toBeInTheDocument();
    // Banderas de países.
    expect(screen.getByTitle("Italia")).toHaveTextContent("🇮🇹");
  });

  it("la postal lleva los dos avatares y por defecto el último viaje vivido", async () => {
    h.rpc.mockResolvedValue({ data: profileResponse(), error: null });
    renderProfile();
    const postal = await screen.findByTestId("postcard");
    const avatars = within(postal).getAllByTestId("postcard-avatar");
    expect(avatars).toHaveLength(2);
    expect(within(postal).getByRole("img", { name: "Avatar de Rodrigo" })).toHaveAttribute("src", "https://cdn.example.test/rodrigo.png");
    expect(within(postal).getByRole("img", { name: "Avatar de Carlo" })).toHaveAttribute("src", "https://cdn.example.test/carlo.png");
    expect(postal).toHaveAccessibleName("Postal: Rodrigo & Carlo · Roma 2026");
    // Carlo es Privé y yo no: un solo sello en la postal.
    expect(within(postal).getAllByTestId("prive-seal")).toHaveLength(1);
    // Cambiar el destino de la postal a un sueño en común.
    fireEvent.click(screen.getByRole("button", { name: "✨ Japón" }));
    expect(await screen.findByTestId("postcard")).toHaveAccessibleName("Postal: Rodrigo & Carlo · Japón · Próximamente");
  });

  it("no pinta correo, teléfono, fecha de nacimiento ni lealtad aunque el servidor los mande", async () => {
    h.rpc.mockResolvedValue({ data: profileResponse(), error: null });
    const { container } = renderProfile();
    await screen.findByRole("heading", { level: 1, name: /^Carlo Bianchi/ });
    const html = container.innerHTML;
    for (const secreto of ["carlo-secreto", "example.test/carlo-secreto", "1234 5678", "1991-07-14", "CP-998877"]) expect(html).not.toContain(secreto);
    const parsed = parseFriendProfile(profileResponse());
    expect(parsed.status === "ok" && Object.keys(parsed.data.amigo).sort()).toEqual(["avatar_url", "ciudad_origen", "full_name", "id", "is_prive", "pais_origen", "username"]);
  });

  it("sin Travel DNA propio invita a completarlo en vez de mostrar 0 %", async () => {
    h.rpc.mockResolvedValue({
      data: profileResponse({ en_comun: { comida: [], tardes: [], hospedaje: [], mismo_ritmo: false, destinos: [], suenos: [], yo_tengo_dna: false, amigo_tiene_dna: true, afinidad: null } }),
      error: null,
    });
    renderProfile();
    expect(await screen.findByText(/Completa tu Travel DNA para descubrir en qué se parecen/)).toBeInTheDocument();
    expect(screen.queryByTestId("affinity")).toBeNull();
    expect(screen.getByRole("link", { name: "Completar mi Travel DNA" })).toHaveAttribute("href", "/onboarding/deep");
  });

  it("Saludar manda el saludo por RPC y luego espera 24 h", async () => {
    h.rpc.mockImplementation(async (fn: string, args: any) => {
      if (fn === "amigo_perfil") return { data: profileResponse(), error: null };
      if (fn === "saludar_amigo") return { data: { ok: true, gesto: args.p_gesto, proximo: new Date(Date.now() + 24 * 3600e3).toISOString(), total: 5 }, error: null };
      return { data: null, error: null };
    });
    renderProfile();
    fireEvent.click(await screen.findByRole("button", { name: /Saludar/ }));
    expect(await screen.findByTestId("poke-cooldown")).toHaveTextContent("otro en 24 h");
    expect(h.rpc).toHaveBeenCalledWith("saludar_amigo", { p_amigo: CARLO, p_gesto: "saludo" });
    expect(screen.getByTestId("pokes-count")).toHaveTextContent("5");
    expect(screen.queryByRole("button", { name: /Saludar/ })).toBeNull();
    // Nunca escribe directo en notificaciones.
    expect(h.from).not.toHaveBeenCalledWith("notifications");
  });

  it("si el servidor dice muy_pronto, lo explica y bloquea el botón", async () => {
    const proximo = new Date(Date.now() + 5 * 3600e3).toISOString();
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === "amigo_perfil") return { data: profileResponse(), error: null };
      if (fn === "saludar_amigo") return { data: { ok: false, error: "muy_pronto", proximo }, error: null };
      return { data: null, error: null };
    });
    renderProfile();
    fireEvent.click(await screen.findByRole("button", { name: /Brindis/ }));
    expect(await screen.findByTestId("poke-cooldown")).toHaveTextContent("otro en 5 h");
    expect(h.toast.info).toHaveBeenCalledWith(expect.stringContaining("Ya saludaste a Carlo hoy"));
  });

  it("si te saludaron, ofrece devolver el saludo", async () => {
    h.rpc.mockResolvedValue({
      data: profileResponse({ saludos: { puedo: true, ultimo_recibido: new Date().toISOString(), gesto_recibido: "brindis", por_devolver: true, total: 1 } }),
      error: null,
    });
    renderProfile();
    expect(await screen.findByRole("button", { name: /Devolver saludo/ })).toBeInTheDocument();
    expect(screen.getByText(/Carlo brindó por su próximo viaje/)).toBeInTheDocument();
  });
});

describe("sello Privé", () => {
  it("aparece junto al nombre de un amigo Privé y no en uno que no lo es", async () => {
    h.rpc.mockResolvedValue({ data: profileResponse(), error: null });
    const { unmount } = renderProfile();
    const h1 = await screen.findByRole("heading", { level: 1, name: /Carlo Bianchi/ });
    expect(within(h1).getByRole("img", { name: "Miembro IATOS Privé" })).toBeInTheDocument();
    expect(screen.getByText("Miembro IATOS Privé", { selector: "p" })).toBeInTheDocument();
    unmount();
    const plain = profileResponse();
    (plain.amigo as Record<string, unknown>).is_prive = false;
    h.rpc.mockResolvedValue({ data: plain, error: null });
    renderProfile();
    await screen.findByRole("heading", { level: 1, name: /^Carlo Bianchi/ });
    expect(screen.queryByTestId("prive-seal")).toBeNull();
  });

  it("solo acepta true literal (un texto no enciende el sello)", () => {
    const r = profileResponse();
    (r.amigo as Record<string, unknown>).is_prive = "true";
    const p = parseFriendProfile(r);
    expect(p.status === "ok" && p.data.amigo.is_prive).toBe(false);
  });
});

describe("Invitar al viaje (mejora)", () => {
  it("muestra el avatar del amigo y un error en español en vez del código del servidor", async () => {
    h.rpc.mockImplementation(async (fn: string) => {
      if (fn === "friend_profiles") return { data: [{ id: CARLO, full_name: "Carlo Bianchi", username: "carlo", avatar_url: "https://cdn.example.test/carlo.png" }], error: null };
      if (fn === "invitar_amigo_viaje") return { data: { ok: false, error: "no_eres_dueno" }, error: null };
      return { data: null, error: null };
    });
    render(<MemoryRouter><InviteFriendDialog tripId="t1" isOwner /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Compartir viaje" }));
    expect(await screen.findByRole("img", { name: "Avatar de Carlo Bianchi" })).toHaveAttribute("src", "https://cdn.example.test/carlo.png");
    fireEvent.click(screen.getByRole("button", { name: /Invitar/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Solo quien creó el viaje puede invitar."));
    expect(h.toast.error).not.toHaveBeenCalledWith("no_eres_dueno");
  });
});

describe("lógica de Social", () => {
  it("summaryLine nunca dice 0 % y prioriza saludos y viajes", () => {
    const base = { amigo_id: CARLO, is_prive: false, afinidad: 0, en_comun: { comida: [], tardes: [], hospedaje: [], mismo_ritmo: false, mismo_presupuesto: false, destinos: [], suenos: [] } };
    expect(summaryLine({ ...base, viajes_juntos: 0, saludo_por_devolver: false }, "Carlo")).toBe("Su primer viaje juntos está por escribirse");
    expect(summaryLine({ ...base, viajes_juntos: 3, saludo_por_devolver: false }, "Carlo")).toBe("3 viajes juntos");
    expect(summaryLine({ ...base, viajes_juntos: 1, saludo_por_devolver: false }, "Carlo")).toBe("1 viaje juntos");
    expect(summaryLine({ ...base, viajes_juntos: 3, saludo_por_devolver: true }, "Carlo")).toBe("Carlo te mandó un saludo ✈️");
    expect(summaryLine(undefined, "Carlo")).toBe("Toca para ver su perfil");
  });

  it("commonGround arma frases positivas y parseFriendSummaries ignora basura", () => {
    const items = commonGround({ comida: ["foodie", "inventado"], tardes: ["playas"], hospedaje: [], mismo_ritmo: true, destinos: ["cdmx"], suenos: [] }, "slow");
    expect(items.map((i) => i.text)).toEqual(["Ambos viajaron a CDMX", "Los dos aman la comida callejera", "Los dos son de playa", "Los dos viajan sin prisas"]);
    const m = parseFriendSummaries([{ amigo_id: CARLO, viajes_juntos: "2", afinidad: null }, null, { nada: 1 }]);
    expect([...m.keys()]).toEqual([CARLO]);
    expect(m.get(CARLO)!.viajes_juntos).toBe(2);
  });

  it("perfil privado / eres_tu / error", () => {
    expect(parseFriendProfile({ ok: false, error: "privado" })).toEqual({ status: "privado" });
    expect(parseFriendProfile({ ok: false, error: "eres_tu" })).toEqual({ status: "eres_tu" });
    expect(parseFriendProfile(null)).toEqual({ status: "error" });
    // Avatar que no es https no se usa.
    const p = parseFriendProfile(profileResponse({ amigo: { id: CARLO, full_name: "C", avatar_url: "javascript:alert(1)" } }));
    expect(p.status === "ok" && p.data.amigo.avatar_url).toBeNull();
  });

  it("untilText, pickPostcardTrip, banderas y aviso de saludo", () => {
    const now = Date.parse("2026-10-22T10:00:00Z");
    expect(untilText("2026-10-22T10:30:00Z", now)).toBe("en 30 min");
    expect(untilText("2026-10-22T15:00:00Z", now)).toBe("en 5 h");
    const trips = parseFriendProfile(profileResponse());
    if (trips.status !== "ok") throw new Error("x");
    expect(pickPostcardTrip(trips.data.viajes_juntos, "2026-10-22")?.destino).toBe("Roma");
    expect(flagEmoji("MX")).toBe("🇲🇽");
    expect(uniqueCountries([{ ciudad: "Roma", pais: "Italia" }, { ciudad: "Milán", pais: "italia" }, { ciudad: "Japón", pais: null }]).map((c) => c.code)).toEqual(["IT", "JP"]);
    expect(notificationTarget({ type: "social_poke", related_id: CARLO })).toBe(`/dashboard/social/amigo/${CARLO}`);
  });
});

const noCanvas = () => ({ width: 0, height: 0, getContext: () => null }) as unknown as HTMLCanvasElement;

describe("postal en canvas", () => {
  it("dibuja la foto y los dos avatares con los nombres", () => {
    const calls: string[] = [];
    const grad = { addColorStop: () => {} };
    const ctx: any = new Proxy({}, {
      get: (t: any, k: string) => {
        if (k in t) return t[k];
        if (k === "measureText") return (s: string) => ({ width: s.length * 10 });
        if (k.startsWith("create")) return () => grad;
        return (...args: unknown[]) => { calls.push(`${k}:${typeof args[0] === "string" ? args[0] : ""}`); };
      },
      set: (t: any, k: string, v: unknown) => { t[k] = v; return true; },
    });
    const img = (n: string) => ({ naturalWidth: 400, naturalHeight: 800, n }) as unknown as HTMLImageElement;
    const draws: string[] = [];
    ctx.drawImage = (i: any) => { draws.push(i?.n ?? "canvas"); };
    const p = { place: "Roma", country: "Italia", year: "2026", names: ["Rodrigo", "Carlo"] as [string, string], avatars: ["a", "b"] as [string, string] };
    drawPostcard(ctx, { ...p, prive: [false, true] }, { photo: img("foto"), avatars: [img("rodrigo"), img("carlo")] }, noCanvas);
    expect(draws).toEqual(expect.arrayContaining(["foto", "rodrigo", "carlo"]));
    expect(calls).toContain("fillText:Rodrigo & Carlo");
    expect(calls).toContain("fillText:SALUDOS DESDE");
    expect(postcardCaption(p)).toBe("Rodrigo & Carlo · Roma 2026");
    expect([POSTCARD_W, POSTCARD_H]).toEqual([1080, 1350]);
  });

  it("sin foto ni avatares usa iniciales (nunca una imagen rota)", () => {
    const texts: string[] = [];
    const grad = { addColorStop: () => {} };
    const ctx: any = new Proxy({}, {
      get: (t: any, k: string) => {
        if (k in t) return t[k];
        if (k === "measureText") return (s: string) => ({ width: s.length * 10 });
        if (k.startsWith("create")) return () => grad;
        if (k === "fillText") return (s: string) => texts.push(s);
        return () => {};
      },
      set: (t: any, k: string, v: unknown) => { t[k] = v; return true; },
    });
    drawPostcard(ctx, { place: "Japón", upcoming: true, names: ["Rodrigo", "Carlo"], avatars: [null, null] }, { photo: null, avatars: [null, null] }, noCanvas);
    expect(texts).toEqual(expect.arrayContaining(["R", "C", "PRÓXIMO DESTINO"]));
  });
});
