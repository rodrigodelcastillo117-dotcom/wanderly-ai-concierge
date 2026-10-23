// Social · perfil del amigo: su avatar (enlace firmado), "Viajes de Carlo", su actividad con acciones
// (reaccionar, preguntar, guardar, agregar a mi viaje, reservar), el feed "Lo que hacen tus amigos" y
// "Qué ven mis amigos" en el perfil propio. Nada de precios, códigos ni horarios aunque llegaran.
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localISODate, localISODatePlus } from "@/lib/localDate";

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  inserts: [] as Array<{ table: string; row: unknown }>,
  signed: vi.fn(),
  track: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  user: { id: "aaaaaaaa-0000-4000-8000-00000000000a" },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: h.rpc, from: h.from, functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
    storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], ttl: number) => h.signed(bucket, paths, ttl) }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/media/SmartImage", () => ({
  SmartImage: ({ children, alt, imageUrl, photoRef }: { children?: React.ReactNode; alt: string; imageUrl?: string | null; photoRef?: string | null }) =>
    <div data-testid="smart-image" data-alt={alt} data-img={imageUrl ?? ""} data-ref={photoRef ?? ""}>{children}</div>,
}));
vi.mock("@/lib/stockPhoto", () => ({ getStockPhoto: async () => null, cachedStockPhoto: () => null }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("@/lib/trackBooking", () => ({ trackBookingClick: h.track }));
vi.mock("sonner", () => ({ toast: h.toast }));

import FriendProfile from "@/pages/FriendProfile";
import Social from "@/pages/Social";
import { FriendsPrivacySection } from "@/components/social/FriendsPrivacySection";
import { __resetFriendAvatars } from "@/hooks/useFriendAvatars";
import { notificationTarget } from "@/lib/notificationTarget";
import { parseActivityItem, relativeDay, reserveLink, tripDates } from "@/lib/friendActivity";

const CARLO = "bbbbbbbb-0000-4000-8000-00000000000b";
const SIGNED = "https://uhkdewinscffhdonhhmt.supabase.co/storage/v1/object/sign/travel-moments/avatars/carlo/v3.png?token=firmado";

function qb(table: string, rows: unknown) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api, order: () => api, or: () => api, gte: () => api, limit: () => api,
    update: (row: unknown) => { h.inserts.push({ table: `${table}:update`, row }); return api; },
    insert: (row: unknown) => { h.inserts.push({ table, row }); return api; },
    maybeSingle: async () => ({ data: Array.isArray(rows) ? rows[0] ?? null : rows, error: null }),
    then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return api;
}

const profile = (over: Record<string, unknown> = {}) => ({
  ok: true,
  amigo: { id: CARLO, full_name: "Carlo Ceniceros", username: "carlo", avatar_url: null, ciudad_origen: null, pais_origen: "México", is_prive: true },
  yo_prive: false, amigos_desde: "2026-05-01T12:00:00Z",
  dna: { estilo: "Trotamundos Intensivo", ritmo: null, comida: [], tardes: [], hospedaje: [] },
  en_comun: { comida: [], tardes: [], hospedaje: [], mismo_ritmo: false, mismo_presupuesto: false, destinos: [], suenos: [], yo_tengo_dna: true, amigo_tiene_dna: true, afinidad: null },
  viajes_juntos: [], viajes_juntos_total: 0, lugares: [],
  saludos: { puedo: true, proximo: null, ultimo_enviado: null, ultimo_recibido: null, gesto_recibido: null, por_devolver: false, total: 0 },
  ...over,
});

const viajes = {
  ok: true, comparte: { pasados: true, proximos: false, fechas_completas: false },
  viajes: [
    { id: null, clave: "k1", destino: "Roma", paises: ["Italia"], portada: "https://images.pexels.com/roma.jpg", fase: "pasado", juntos: false,
      mes_salida: "2026-03", mes_regreso: "2026-03", fecha_salida: null, fecha_regreso: null, presupuesto_objetivo: 99999, total_estimado: 88888 },
    { id: "t-juntos", clave: "t-juntos", destino: "Madrid", paises: ["España"], portada: null, fase: "pasado", juntos: true,
      mes_salida: "2025-09", mes_regreso: "2025-09", fecha_salida: "2025-09-01", fecha_regreso: "2025-09-06" },
  ],
};

const hace = (n: number) => localISODatePlus(-n);
const actividad = (over: Record<string, unknown>[] = []) => ({
  ok: true, comparte: { reservas: true, recomendaciones: true, favoritos: false, visitados: true, momentos: false },
  items: [
    { clave: "reserva:11111111-1111-4111-8111-111111111111", tipo: "reserva", fecha: hace(3), categoria: "restaurant", titulo: "Suntory (Polanco)",
      ciudad: "Ciudad de México", pais: "México", imagen: null, mi_reaccion: null, mis_preguntas: [],
      // Lo que NUNCA debe pintarse aunque llegara:
      price_amount: 4321.5, confirmation_code: "CONF-SECRETO-77", start_at: "2026-10-24T20:30:00Z", booking_url: "https://opentable.example/r?token=SECRETO", provider: "OpenTable" },
    { clave: "reco:22222222-2222-4222-8222-222222222222", tipo: "recomendacion", fecha: hace(10), categoria: "restaurant", titulo: "Cocina Las Ranitas",
      ciudad: "Oaxaca", estrellas: 5, nota: "El mole negro", photo_ref: "places/ABC123/photos/XYZ789", mi_reaccion: "corazon",
      mis_preguntas: [{ id: "q1", pregunta: "¿Qué pediste?", respuesta: "El mole negro, sin duda", fecha: hace(9) }] },
    { clave: "visita:33333333-3333-4333-8333-333333333333", tipo: "visitado", fecha: hace(1), categoria: "lugar", titulo: "Museo del Louvre", ciudad: "París", mis_preguntas: [] },
    ...over,
  ],
});

function rpcImpl(over: Record<string, unknown> = {}) {
  return async (fn: string) => {
    if (fn in over) return { data: over[fn], error: null };
    if (fn === "amigo_perfil") return { data: profile(), error: null };
    if (fn === "amigo_viajes") return { data: viajes, error: null };
    if (fn === "amigo_actividad") return { data: actividad(), error: null };
    if (fn === "amigos_avatares") return { data: [{ id: CARLO, bucket: "travel-moments", path: `avatars/${CARLO}/v3.png` }], error: null };
    if (fn === "reaccionar_actividad") return { data: { ok: true, mi_reaccion: "fuego" }, error: null };
    if (fn === "preguntar_actividad") return { data: { ok: true, id: "q-new" }, error: null };
    return { data: null, error: null };
  };
}

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={[`/dashboard/social/amigo/${CARLO}`]}>
      <Routes>
        <Route path="/dashboard/social/amigo/:id" element={<FriendProfile />} />
        <Route path="/dashboard/planear" element={<p>Planear</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __resetFriendAvatars();
  h.rpc.mockReset();
  h.from.mockReset();
  h.signed.mockReset();
  h.track.mockReset();
  h.inserts.length = 0;
  h.from.mockImplementation((t: string) => qb(t, t === "profiles" ? [{ full_name: "Rodrigo del Castillo", avatar_url: null, invite_code: "A3K9PQ7M" }]
    : t === "trips" ? [{ id: "mi-viaje", destino: "CDMX", fecha_salida: localISODatePlus(20), fecha_regreso: localISODatePlus(25) }] : []));
  h.signed.mockImplementation(async (_b: string, paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: SIGNED })), error: null }));
  Object.values(h.toast).forEach((f) => f.mockReset());
});

describe("avatar del amigo", () => {
  it("con profiles.avatar_url vacío muestra su Travel Avatar con enlace firmado (no la «C» dorada)", async () => {
    h.rpc.mockImplementation(rpcImpl());
    renderProfile();
    const avatar = await screen.findByTestId("friend-avatar");
    await waitFor(() => expect(within(avatar).getByRole("img", { name: "Avatar de Carlo Ceniceros" }).tagName).toBe("IMG"));
    expect(within(avatar).getByRole("img")).toHaveAttribute("src", SIGNED);
    expect(h.rpc).toHaveBeenCalledWith("amigos_avatares", { p_ids: [CARLO] });
    expect(h.signed).toHaveBeenCalledWith("travel-moments", [`avatars/${CARLO}/v3.png`], 3600);
  });

  it("si no hay avatar permitido (amigo lo apagó) se queda la inicial", async () => {
    h.rpc.mockImplementation(rpcImpl({ amigos_avatares: [] }));
    renderProfile();
    const avatar = await screen.findByTestId("friend-avatar");
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("amigos_avatares", expect.anything()));
    expect(within(avatar).getByRole("img", { name: "Avatar de Carlo Ceniceros" }).tagName).toBe("SPAN");
    expect(within(avatar).getByText("C")).toBeInTheDocument();
  });

  it("una ruta que no es de la carpeta de avatares no se firma", async () => {
    h.rpc.mockImplementation(rpcImpl({ amigos_avatares: [{ id: CARLO, path: "../documentos/pasaporte.pdf" }] }));
    renderProfile();
    await screen.findByTestId("friend-avatar");
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("amigos_avatares", expect.anything()));
    expect(h.signed).not.toHaveBeenCalled();
  });
});

describe("Viajes de Carlo", () => {
  it("muestra destino, países, mes y año, y marca el viaje compartido como «Viajaron juntos»", async () => {
    h.rpc.mockImplementation(rpcImpl());
    renderProfile();
    expect(await screen.findByRole("heading", { name: "Viajes de Carlo" })).toBeInTheDocument();
    const list = await screen.findByTestId("friend-trips");
    const cards = within(list).getAllByTestId("friend-trip");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Roma")).toBeInTheDocument();
    expect(within(cards[0]).getByText("mar 2026")).toBeInTheDocument();
    expect(within(cards[0]).getByText("Italia")).toBeInTheDocument();
    expect(within(cards[0]).queryByText("Viajaron juntos")).toBeNull();
    expect(within(cards[0]).queryByRole("link")).toBeNull();
    expect(within(cards[1]).getByText("Viajaron juntos")).toBeInTheDocument();
    expect(within(cards[1]).getByRole("link")).toHaveAttribute("href", "/dashboard/viajes/t-juntos");
    expect(within(cards[1]).getByText("1 – 6 sep 2025")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/99999|88888|presupuesto/);
  });
});

describe("actividad del amigo", () => {
  it("pinta reservas, recomendaciones y lugares con su fecha relativa y sin datos privados", async () => {
    h.rpc.mockImplementation(rpcImpl());
    renderProfile();
    expect(await screen.findByText("Reservó en Suntory (Polanco)")).toBeInTheDocument();
    expect(screen.getByText(/Ciudad de México · hace 3 días/)).toBeInTheDocument();
    expect(screen.getByText("Recomienda: Cocina Las Ranitas")).toBeInTheDocument();
    expect(screen.getByLabelText("5 de 5 estrellas")).toHaveTextContent("⭐⭐⭐⭐⭐");
    expect(screen.getByText("Estuvo en: Museo del Louvre")).toBeInTheDocument();
    expect(screen.getByText(/París · ayer/)).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    for (const secret of ["4321", "CONF-SECRETO", "20:30", "token=SECRETO", "OpenTable"]) expect(text).not.toContain(secret);
    // Foto: la de Google Places del lugar.
    expect(screen.getAllByTestId("smart-image").some((n) => n.getAttribute("data-ref") === "places/ABC123/photos/XYZ789")).toBe(true);
    // Su pregunta con la respuesta del amigo.
    expect(screen.getByText("El mole negro, sin duda")).toBeInTheDocument();
  });

  it("sin actividad compartida invita amable, sin «0»", async () => {
    h.rpc.mockImplementation(rpcImpl({ amigo_actividad: { ok: true, comparte: {}, items: [] } }));
    renderProfile();
    expect(await screen.findByTestId("activity-empty")).toHaveTextContent("Carlo aún no comparte sus reservas, recomendaciones ni lugares.");
  });

  it("reaccionar llama al servidor y marca la reacción", async () => {
    h.rpc.mockImplementation(rpcImpl());
    renderProfile();
    const card = (await screen.findByText("Reservó en Suntory (Polanco)")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Increíble" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("reaccionar_actividad", { p_amigo: CARLO, p_clave: "reserva:11111111-1111-4111-8111-111111111111", p_emoji: "fuego" }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Increíble" })).toHaveAttribute("aria-pressed", "true"));
  });

  it("si el amigo dejó de compartirlo, avisa en español", async () => {
    h.rpc.mockImplementation(rpcImpl({ reaccionar_actividad: { ok: false, error: "no_disponible" } }));
    renderProfile();
    const card = (await screen.findByText("Reservó en Suntory (Polanco)")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: "Me encanta" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Esto ya no está disponible: tu amigo dejó de compartirlo."));
  });

  it("«Preguntarle» manda la pregunta por RPC y la deja esperando respuesta", async () => {
    h.rpc.mockImplementation(rpcImpl());
    renderProfile();
    const card = (await screen.findByText("Reservó en Suntory (Polanco)")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: /Preguntarle/ }));
    fireEvent.change(within(card).getByLabelText("Pregunta para Carlo"), { target: { value: "¿Qué pediste?" } });
    fireEvent.click(within(card).getByRole("button", { name: /Enviar/ }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("preguntar_actividad", { p_amigo: CARLO, p_clave: "reserva:11111111-1111-4111-8111-111111111111", p_texto: "¿Qué pediste?" }));
    expect(await within(card).findByText("Esperando respuesta…")).toBeInTheDocument();
  });

  it("Guardar, Reservar y Agregar a mi viaje usan lo que ya existe", async () => {
    h.rpc.mockImplementation(rpcImpl());
    renderProfile();
    const card = (await screen.findByText("Reservó en Suntory (Polanco)")).closest("article")!;
    fireEvent.click(within(card).getByRole("button", { name: /Guardar/ }));
    await waitFor(() => expect(h.inserts.find((i) => i.table === "recomendaciones")).toBeTruthy());
    const fav = (h.inserts.find((i) => i.table === "recomendaciones")!.row as any[])[0];
    expect(fav).toMatchObject({ user_id: h.user.id, titulo: "Suntory (Polanco)", tipo: "restaurante", guardado: true });
    expect(JSON.stringify(fav)).not.toContain(CARLO);

    fireEvent.click(within(card).getByRole("button", { name: /Reservar/ }));
    expect(h.track).toHaveBeenCalledWith(expect.objectContaining({ category: "restaurant", provider: "OpenTable", title: "Suntory (Polanco)" }));
    expect(h.track.mock.calls[0][0].bookingUrl).toContain("opentable.com/s?term=Suntory");
    expect(h.track.mock.calls[0][0].bookingUrl).not.toContain("SECRETO");

    fireEvent.click(within(card).getByRole("button", { name: /A mi viaje/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("button", { name: /CDMX/ }));
    await waitFor(() => expect(h.inserts.find((i) => i.table === "trip_journal_entries")).toBeTruthy());
    const entry = h.inserts.find((i) => i.table === "trip_journal_entries")!.row as any;
    expect(entry).toEqual({ trip_id: "mi-viaje", author_id: h.user.id, text: "📌 Para visitar: Suntory (Polanco) · Ciudad de México" });
    expect(entry.text).not.toMatch(/Carlo/);
  });
});

describe("Social: lo que hacen tus amigos", () => {
  it("muestra el feed con el nombre de cada amigo y su avatar firmado en la lista", async () => {
    const item = { ...actividad().items[1], amigo: { id: CARLO, nombre: "Carlo" } };
    h.rpc.mockImplementation(rpcImpl({
      friend_profiles: [{ id: CARLO, full_name: "Carlo Ceniceros", username: "carlo", avatar_url: null }],
      amigos_resumen: [],
      amigos_actividad: [item],
    }));
    render(<MemoryRouter initialEntries={["/dashboard/social"]}><Routes><Route path="/dashboard/social" element={<Social />} /></Routes></MemoryRouter>);
    const feed = await screen.findByTestId("friends-feed");
    expect(within(feed).getByRole("heading", { name: "Lo que hacen tus amigos" })).toBeInTheDocument();
    expect(await within(feed).findByText("Recomienda: Cocina Las Ranitas")).toBeInTheDocument();
    expect(within(feed).getByRole("link", { name: /Carlo/ })).toHaveAttribute("href", `/dashboard/social/amigo/${CARLO}`);
    await waitFor(() => expect(screen.getAllByRole("img", { name: "Avatar de Carlo Ceniceros" }).some((n) => n.getAttribute("src") === SIGNED)).toBe(true));
  });
});

describe("Qué ven mis amigos (perfil propio)", () => {
  const own = (over: Record<string, unknown> = {}) => ({
    ok: true,
    ajustes: { avatar: true, viajes_pasados: true, viajes_proximos: false, fechas_completas: false, reservas: false, recomendaciones: false, favoritos: false, visitados: false, momentos: false },
    items: [{
      clave: "reco:22222222-2222-4222-8222-222222222222", tipo: "recomendacion", fecha: hace(2), categoria: "restaurant", titulo: "Cocina Las Ranitas", estrellas: 5,
      oculto: false, tipo_compartido: false, visible_desde: null, reacciones: { corazon: 3, fuego: 1, antojo: 0 },
      preguntas: [{ id: "q9", de: "Rodrigo", pregunta: "¿Qué pediste?", respuesta: null, fecha: hace(1) }],
    }],
    viajes: [{ id: "t1", clave: "t1", destino: "Roma", paises: ["Italia"], fase: "pasado", juntos: false, oculto: false, mes_salida: "2026-03", fecha_salida: "2026-03-10", fecha_regreso: "2026-03-17" }],
    momentos: [],
    ...over,
  });
  const renderSection = () => render(<MemoryRouter><FriendsPrivacySection /></MemoryRouter>);

  it("por defecto: avatar y viajes pasados prendidos, lo demás apagado, con un aviso amable", async () => {
    h.rpc.mockImplementation(rpcImpl({ mi_actividad_social: own() }));
    renderSection();
    expect(await screen.findByTestId("share-nudge")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("switch", { name: "Mi avatar" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: "Viajes pasados" })).toHaveAttribute("aria-checked", "true");
    for (const n of ["Viajes próximos", "Fechas exactas", "Reservas", "Recomendaciones", "Favoritos", "Lugares visitados", "Momentos"]) {
      expect(screen.getByRole("switch", { name: n })).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByText(/Nunca se muestran precios, montos, documentos, tu ubicación en vivo/)).toBeInTheDocument();
  });

  it("prender «Reservas» guarda solo ese ajuste", async () => {
    h.rpc.mockImplementation(rpcImpl({ mi_actividad_social: own(), guardar_privacidad_social: { ok: true } }));
    renderSection();
    const sw = await screen.findByRole("switch", { name: "Reservas" });
    fireEvent.click(sw);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("guardar_privacidad_social", { p_ajustes: { reservas: true } }));
  });

  it("el dueño ve el conteo de reacciones, el estado y responde preguntas", async () => {
    h.rpc.mockImplementation(rpcImpl({ mi_actividad_social: own(), responder_pregunta_social: { ok: true } }));
    renderSection();
    const list = await screen.findByTestId("own-activity");
    expect(await within(list).findByLabelText("Reacciones de tus amigos")).toHaveTextContent("❤️ 3 🔥 1");
    expect(within(list).getByText(/Apagado: prende «Recomendaciones» para compartirlo/)).toBeInTheDocument();
    fireEvent.change(within(list).getByLabelText("Tu respuesta"), { target: { value: "El mole negro" } });
    fireEvent.click(within(list).getByRole("button", { name: "Responder" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("responder_pregunta_social", { p_pregunta: "q9", p_texto: "El mole negro" }));
  });

  it("esconder una actividad llama a ocultar_social", async () => {
    h.rpc.mockImplementation(rpcImpl({ mi_actividad_social: own(), ocultar_social: { ok: true } }));
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: "Esconder Cocina Las Ranitas" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("ocultar_social", { p_clave: "reco:22222222-2222-4222-8222-222222222222", p_ocultar: true }));
    expect(await screen.findByRole("button", { name: "Mostrar Cocina Las Ranitas" })).toBeInTheDocument();
  });

  it("recomendar un lugar pasa nombre, ciudad, tipo y estrellas", async () => {
    h.rpc.mockImplementation(rpcImpl({ mi_actividad_social: own(), recomendar_lugar: { ok: true, id: "r1" } }));
    renderSection();
    fireEvent.change(await screen.findByLabelText("Nombre del lugar"), { target: { value: "Pujol" } });
    fireEvent.change(screen.getByLabelText("Ciudad"), { target: { value: "CDMX" } });
    fireEvent.click(screen.getByRole("radio", { name: "4 estrellas" }));
    fireEvent.click(screen.getByRole("button", { name: "Recomendar" }));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("recomendar_lugar", { p_nombre: "Pujol", p_estrellas: 4, p_categoria: "restaurant", p_ciudad: "CDMX", p_nota: null }));
  });
});

describe("piezas puras", () => {
  it("los avisos de reacción y pregunta llevan al perfil propio; la respuesta, a la actividad del amigo", () => {
    expect(notificationTarget({ type: "social_reaccion", related_id: CARLO })).toBe("/dashboard/perfil#que-ven-mis-amigos");
    expect(notificationTarget({ type: "social_pregunta", related_id: CARLO })).toBe("/dashboard/perfil#que-ven-mis-amigos");
    expect(notificationTarget({ type: "social_respuesta", related_id: CARLO })).toBe(`/dashboard/social/amigo/${CARLO}#actividad`);
  });

  it("fechas relativas y de viaje en español", () => {
    const today = "2026-10-23";
    expect(relativeDay("2026-10-22", today)).toBe("ayer");
    expect(relativeDay("2026-10-20", today)).toBe("hace 3 días");
    expect(relativeDay("2026-10-09", today)).toBe("hace 2 semanas");
    expect(relativeDay("2026-03-02", today)).toBe("mar 2026");
    expect(tripDates({ mesSalida: "2026-03", mesRegreso: "2026-04", fechaSalida: null, fechaRegreso: null })).toBe("mar 2026 – abr 2026");
    expect(tripDates({ mesSalida: "2026-03", mesRegreso: "2026-03", fechaSalida: "2026-03-28", fechaRegreso: "2026-04-02" })).toBe("28 mar – 2 abr 2026");
    expect(localISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("Reservar arma un enlace nuevo por tipo; un destino no se «reserva»", () => {
    expect(reserveLink({ tipo: "reserva", categoria: "hotel", titulo: "Hotel Eden", ciudad: "Roma", pais: null })?.provider).toBe("Booking.com");
    expect(reserveLink({ tipo: "visitado", categoria: "lugar", titulo: "Museo del Louvre", ciudad: "París", pais: null })?.provider).toBe("GetYourGuide");
    expect(reserveLink({ tipo: "favorito", categoria: "destino", titulo: "Kioto", ciudad: null, pais: "Japón" })).toBeNull();
  });

  it("la lectura defensiva descarta campos de más, fotos ajenas y rutas inválidas", () => {
    const i = parseActivityItem({
      clave: "reserva:x", tipo: "reserva", titulo: "Suntory", fecha: "2026-10-20T20:30:00Z", confirmation_code: "X",
      photo_ref: "https://rastreador.example/p.gif", imagen: "http://inseguro.example/x.jpg", foto_path: "../../secreto.jpg", mi_reaccion: "popo",
    })!;
    expect(i).not.toHaveProperty("confirmation_code");
    expect(i.fecha).toBeNull();
    expect(i.photoRef).toBeNull();
    expect(i.imagen).toBeNull();
    expect(i.fotoPath).toBeNull();
    expect(i.miReaccion).toBeNull();
    expect(parseActivityItem({ clave: "x", tipo: "otro", titulo: "y" })).toBeNull();
  });
});
