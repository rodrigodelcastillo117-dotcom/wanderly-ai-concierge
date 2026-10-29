// Borrador rápido (28-oct-2026): la IA de interpretar-viaje tarda 10–17 s en un viaje complejo. En cuanto la
// persona envía su texto ve el borrador del lector local (editable, sin poder generar) y, cuando la IA
// responde, su interpretación lo reemplaza sin pisar lo que la persona editó. Si la IA falla o tarda más de
// 45 s, el borrador queda como base con su aviso. Sin red: IA simulada y fake timers.
import React from "react";
import { render, screen, act, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";
import { DIEGO_AI, DIEGO_TEXT } from "./fixtures/viajeComplejo";
import {
  acceptSuggestion, addStop, checkCoverage, describeSpec, excludeMention, openQuestions, removeStop, setReturnVia, setTripBasics, updateStop,
  validateTripSpec, type TripSpec,
} from "../../supabase/functions/_shared/tripSpec";
import { draftNote, draftSpec, mergeDraftWithAi, DRAFT_FAIL_AVISO } from "@/lib/tripSpecDraft";

const TODAY = new Date("2026-10-28T12:00:00");
const HUNGRIA_TEXT = "Hungría, Atenas y París del 15 de noviembre al 19 de diciembre de 2027, somos 2 personas";
/** Lo que devolvería la IA para Hungría: Budapest y Eger (propuestas) y sus noches. */
const HUNGRIA_AI = {
  intencion: "viaje_futuro", origen: "Ciudad de México",
  paradas: [
    { id: "p1", ciudad: "Budapest", pais: "Hungría", de_region: "Hungría", rol: "estancia", noches: 4, llegada_por: "vuelo", sugerida: true, texto: "Hungría" },
    { id: "p2", ciudad: "Eger", pais: "Hungría", de_region: "Hungría", rol: "estancia", noches: 2, llegada_por: "tren", sugerida: true, texto: "Hungría" },
    { id: "p3", ciudad: "Atenas", pais: "Grecia", rol: "estancia", noches: 5, llegada_por: "vuelo", sugerida: false, texto: "Atenas" },
    { id: "p4", ciudad: "París", pais: "Francia", rol: "estancia", noches: 6, llegada_por: "vuelo", sugerida: false, texto: "París" },
  ],
  regreso: { a: "Ciudad de México", via: null, modo: "vuelo" },
  fecha_salida: "2027-11-15", fecha_regreso: "2027-12-19", fechas_expresas: true, viajeros: 2,
  preferencias: [], reservas: [], sugerencias: [],
  menciones: [
    { texto: "Hungría", tipo: "pais", estado: "parada", ref: "p1" },
    { texto: "Atenas", tipo: "ciudad", estado: "parada", ref: "p3" },
    { texto: "París", tipo: "ciudad", estado: "parada", ref: "p4" },
  ],
  preguntas: [],
};
/** Como la entrega el servidor (validada), y finalizada como en el cliente. */
const aiSpec = (raw: unknown, text: string): TripSpec => {
  const v = validateTripSpec(JSON.stringify(raw), text, { origen: "Ciudad de México" });
  if (!v.ok) throw new Error("fixture inválido");
  return v.spec;
};
const city = (s: TripSpec, c: string) => s.paradas.find((p) => p.ciudad === c)!;

describe("borrador local: lo que el lector local puede, y lo demás como pendiente (nunca perdido)", () => {
  it("Hungría, Atenas y París: Budapest propuesta (pendiente) en el orden escrito, fechas y viajeros", () => {
    const s = draftSpec(HUNGRIA_TEXT, { origen: "Ciudad de México", today: TODAY });
    expect(s.paradas.map((p) => [p.ciudad, p.sugerida])).toEqual([["Budapest", true], ["Atenas", false], ["París", false]]);
    expect(s.fecha_salida).toBe("2027-11-15");
    expect(s.fecha_regreso).toBe("2027-12-19");
    expect(s.viajeros).toBe(2);
    expect(openQuestions(s).map((q) => `${q.tipo}:${q.texto}`)).toEqual(["ciudades_de_pais:Hungría"]);
    expect(checkCoverage(s).ok).toBe(true);
  });

  it("caso Diego: país con su sugerencia, crucero, Cape Town, regreso por Londres, fechas y viajeros", () => {
    const s = draftSpec(DIEGO_TEXT, { today: TODAY });
    expect(s.consulta_original).toBe(DIEGO_TEXT);
    expect(s.origen).toBe("Ciudad de México");
    expect(s.paradas.map((p) => [p.ciudad, p.llegada_por, p.sugerida])).toEqual([["Riad", "vuelo", true], ["Ciudad del Cabo", "crucero", false]]); // a otro continente: vuelo por defecto (R2 P1-2)
    expect(s.regreso.via).toBe("Londres");
    expect([s.fecha_salida, s.fecha_regreso, s.viajeros]).toEqual(["2027-11-15", "2027-12-19", 2]);
    // Lo que el lector local no sabe (más ciudades de Arabia, puertos y noches del crucero, ¿escala o estancia?) queda pendiente.
    expect(openQuestions(s).map((q) => q.tipo).sort()).toEqual(["ciudades_de_pais", "conexion_o_estancia", "crucero"]);
    expect(checkCoverage(s).ok).toBe(true);
  });

  it("'crucero de X a Y', 'regreso vía X', 'tren a X' y fechas con año", () => {
    const t = "Roma, tren a Florencia, crucero de Barcelona a Atenas y regreso vía Madrid, del 15 de noviembre al 19 de diciembre de 2027";
    const s = draftSpec(t, { origen: "Ciudad de México", today: TODAY });
    expect(s.paradas.map((p) => [p.ciudad, p.llegada_por])).toEqual([["Roma", "vuelo"], ["Florencia", "tren"], ["Barcelona", "por_definir"], ["Atenas", "crucero"]]); // CDMX → Roma: vuelo por defecto (R2 P1-2)
    expect(city(s, "Atenas").crucero).toMatchObject({ puerto_salida: "Barcelona", puerto_llegada: "Atenas", naviera: null });
    expect(s.regreso.via).toBe("Madrid");
    expect([s.fecha_salida, s.fecha_regreso]).toEqual(["2027-11-15", "2027-12-19"]);
    expect(describeSpec(s)).toContain("crucero (Barcelona → Atenas)");
    // Sin noches del crucero: se pregunta (no se inventa).
    expect(openQuestions(s).map((q) => q.tipo).sort()).toEqual(["conexion_o_estancia", "crucero"]);
  });

  it("'crucero de 7 noches desde Miami hasta Cozumel': puertos y noches a bordo; Miami no se vuelve el origen", () => {
    const t = "crucero de 7 noches desde Miami hasta Cozumel";
    const s = draftSpec(t, { origen: "Ciudad de México", today: TODAY });
    expect(s.origen).toBe("Ciudad de México");
    expect(city(s, "Cozumel").crucero).toMatchObject({ puerto_salida: "Miami", puerto_llegada: "Cozumel", noches: 7 });
    expect(openQuestions(s).some((q) => q.tipo === "crucero")).toBe(false);
  });
});

describe("la respuesta de la IA respeta lo que la persona editó en el borrador", () => {
  it("parada quitada no vuelve; parada agregada se conserva en su lugar; noches y fechas de la persona ganan", () => {
    const base = draftSpec(HUNGRIA_TEXT, { origen: "Ciudad de México", today: TODAY });
    let e = removeStop(base, city(base, "Atenas").id);
    e = updateStop(e, city(e, "París").id, { noches: 7 });
    e = addStop(e, "Roma");
    e = setTripBasics(e, { fecha_regreso: "2027-12-21" });
    const m = mergeDraftWithAi(base, e, aiSpec(HUNGRIA_AI, HUNGRIA_TEXT), { origen: "Ciudad de México" });
    expect(m.spec.paradas.map((p) => p.ciudad)).toEqual(["Budapest", "Eger", "París", "Roma"]);
    expect(city(m.spec, "París").noches).toBe(7); // la persona
    expect(city(m.spec, "Budapest").noches).toBe(4); // la IA (no se tocó)
    expect(m.spec.fecha_regreso).toBe("2027-12-21");
    expect(m.spec.fuente).toBe("ia");
    expect(m.spec.consulta_original).toBe(HUNGRIA_TEXT);
    expect(m.agrego).toEqual(["Eger"]);
    expect(m.nota).toBe("Iato completó tu viaje: agregó Eger.");
    // Atenas queda como exclusión aprobada: la cobertura sigue completa (nada se perdió en silencio).
    expect(m.spec.menciones.find((x) => x.texto === "Atenas")?.estado).toBe("excluido");
    expect(checkCoverage(m.spec).ok).toBe(true);
  });

  it("lo ya respondido no se vuelve a preguntar: Hungría → Budapest confirmada (Eger no entra)", () => {
    const base = draftSpec(HUNGRIA_TEXT, { origen: "Ciudad de México", today: TODAY });
    const e = acceptSuggestion(base, openQuestions(base)[0].id);
    const m = mergeDraftWithAi(base, e, aiSpec(HUNGRIA_AI, HUNGRIA_TEXT), { origen: "Ciudad de México" });
    expect(m.spec.paradas.map((p) => [p.ciudad, p.sugerida])).toEqual([["Budapest", false], ["Atenas", false], ["París", false]]);
    expect(openQuestions(m.spec)).toEqual([]);
    // R3 viajes P2-11: «coincide con tu resumen» confundía (la persona escribió un texto, no un resumen).
    expect(m.nota).toBe("Iato revisó tu viaje: no falta nada.");
  });

  it("Hungría excluida en el borrador → la IA no la vuelve a poner", () => {
    const base = draftSpec(HUNGRIA_TEXT, { origen: "Ciudad de México", today: TODAY });
    const e = excludeMention(base, openQuestions(base)[0].id);
    const m = mergeDraftWithAi(base, e, aiSpec(HUNGRIA_AI, HUNGRIA_TEXT), { origen: "Ciudad de México" });
    expect(m.spec.paradas.map((p) => p.ciudad)).toEqual(["Atenas", "París"]);
    expect(checkCoverage(m.spec).ok).toBe(true);
  });

  it("caso Diego: Londres como estancia y noches en Ciudad del Cabo se conservan; la IA agrega AlUla y Yeda", () => {
    const base = draftSpec(DIEGO_TEXT, { today: TODAY });
    let e = setReturnVia(base, null, "estancia");
    e = updateStop(e, city(e, "Ciudad del Cabo").id, { noches: 5 });
    const m = mergeDraftWithAi(base, e, aiSpec(DIEGO_AI, DIEGO_TEXT));
    expect(m.spec.paradas.map((p) => p.ciudad)).toEqual(["Riad", "AlUla", "Yeda", "Ciudad del Cabo", "Londres"]);
    expect(city(m.spec, "Ciudad del Cabo").noches).toBe(5);
    expect(city(m.spec, "Ciudad del Cabo").llegada_por).toBe("crucero");
    expect(m.spec.regreso.via).toBeNull();
    expect(openQuestions(m.spec).map((q) => q.tipo).sort()).toEqual(["ciudades_de_pais", "crucero"]);
    expect(m.nota).toBe("Iato completó tu viaje: agregó AlUla y Yeda.");
    expect(checkCoverage(m.spec).ok).toBe(true);
  });

  it("aviso: agregó X, preguntó por Y", () => {
    expect(draftNote(["AlUla", "Yeda"], ["el crucero"])).toBe("Iato completó tu viaje: agregó AlUla y Yeda; preguntó por el crucero.");
  });
});

// ─── UI: PlanTrip con ?q (como llega del Inicio o de la ventana "Planear viaje") ───

const ia = vi.hoisted(() => ({ mode: "pending" as "pending" | "error" | "never", resolve: (_v: unknown) => {}, calls: [] as string[] }));
const invoke = vi.fn(async (fn: string, o: any) => {
  ia.calls.push(fn);
  if (fn === "interpretar-viaje") {
    if (ia.mode === "error") return { data: null, error: new Error("502") };
    return new Promise((r) => { if (ia.mode === "pending") ia.resolve = r; });
  }
  return { data: null, error: null, _o: o };
});
const qb: any = { select: () => qb, eq: () => qb, maybeSingle: async () => ({ data: { ciudad_origen: "Ciudad de México" }, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => qb, functions: { invoke: (f: string, o: any) => invoke(f, o) } } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: any) => <>{children}</> }));
vi.mock("@/components/AnalysisProgress", () => ({ AnalysisProgress: () => <p>ANALIZANDO</p> }));
vi.mock("@/components/TripBuildPreview", () => ({ TripBuildPreview: () => null }));
vi.mock("@/components/OriginPicker", () => ({ OriginPicker: () => null }));
vi.mock("@/components/VoiceInput", () => ({ VoiceInput: () => null }));
vi.mock("@/lib/analytics", () => ({ track: () => {} }));
vi.mock("framer-motion", () => {
  const strip = (p: any) => { const { initial, animate, exit, transition, ...r } = p; return r; };
  const cache: Record<string, any> = {};
  const motion = new Proxy({}, { get: (_t, tag: string) => (cache[tag] ??= (p: any) => React.createElement(tag, strip(p))) });
  return { motion, AnimatePresence: ({ children }: any) => <>{children}</> };
});

import PlanTrip from "@/pages/PlanTrip";

const renderPlan = (text: string) => render(
  <MemoryRouter initialEntries={[`/dashboard/planear?q=${encodeURIComponent(text)}`]}>
    <Routes>
      <Route path="/dashboard/planear" element={<PlanTrip />} />
      <Route path="/dashboard/viajes/:id" element={<p>VIAJE</p>} />
    </Routes>
  </MemoryRouter>,
);
const stops = () => screen.getAllByTestId("spec-parada").map((li) => li.querySelector("span.truncate")?.firstChild?.textContent);
const confirmBtn = () => screen.getByTestId("spec-confirmar");
const paid = () => ia.calls.filter((f) => f === "analizar-viaje" || f === "logistics-plan");
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  localStorage.clear();
  invoke.mockClear();
  ia.calls.length = 0;
  ia.mode = "pending";
});
afterEach(() => { vi.useRealTimers(); });

describe("PlanTrip: borrador al instante", () => {
  it("el borrador aparece antes de la respuesta, no deja generar y la IA lo completa respetando las ediciones", async () => {
    renderPlan(HUNGRIA_TEXT);
    // Al instante, sin esperar a la IA: "Tu viaje, como lo entendimos" con el borrador local.
    expect(screen.getByTestId("spec-review")).toBeInTheDocument();
    expect(screen.getByTestId("spec-borrador")).toHaveTextContent("Borrador · Iato lo está revisando…");
    expect(stops()).toEqual(["Budapest", "Atenas", "París"]);
    expect(confirmBtn()).toBeDisabled();
    expect(confirmBtn()).toHaveTextContent("Esperando a Iato…");
    await waitFor(() => expect(ia.calls).toContain("interpretar-viaje"));
    expect(screen.queryByTestId("spec-borrador-globo")).toBeNull();
    // Pasados 5 s, el globo pequeño de la marca.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByTestId("spec-borrador-globo")).toBeInTheDocument();

    // Se edita mientras tanto: quita Atenas, 7 noches en París y agrega Roma.
    fireEvent.click(screen.getByRole("button", { name: "Quitar Atenas" }));
    fireEvent.change(screen.getByLabelText("Noches en París"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Agregar parada"), { target: { value: "Roma" } });
    fireEvent.click(screen.getByRole("button", { name: /Agregar$/ }));
    expect(stops()).toEqual(["Budapest", "París", "Roma"]);
    expect(confirmBtn()).toBeDisabled();

    await act(async () => { ia.resolve({ data: { ok: true, spec: aiSpec(HUNGRIA_AI, HUNGRIA_TEXT) }, error: null }); await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByTestId("spec-borrador")).toBeNull();
    expect(screen.getByTestId("spec-ia-nota")).toHaveTextContent("Iato completó tu viaje: agregó Eger.");
    expect(stops()).toEqual(["Budapest", "Eger", "París", "Roma"]); // Atenas no vuelve; Roma se conserva
    expect((screen.getByLabelText("Noches en París") as HTMLInputElement).value).toBe("7");
    // Cobertura normal: Hungría (Budapest y Eger) sigue pendiente de confirmar.
    expect(confirmBtn()).toHaveTextContent("Resuelve 1 pendiente");
    fireEvent.click(within(screen.getByTestId("spec-pregunta")).getByTestId("spec-aceptar"));
    expect(confirmBtn()).toBeEnabled();
    expect(confirmBtn()).toHaveTextContent("Sí, armar mi viaje");
    expect(paid()).toHaveLength(0); // sin gasto hasta confirmar
    expect(ia.calls.filter((f) => f === "interpretar-viaje")).toHaveLength(1);
  });

  it("aunque el borrador no tenga pendientes, no se genera hasta que Iato responda; si la IA falla, el borrador queda con su aviso y se puede generar", async () => {
    ia.mode = "error";
    let resolveCtx: () => void = () => {};
    // El perfil tarda: la IA aún no se llama y el borrador ya está en pantalla.
    const gate = new Promise<void>((r) => { resolveCtx = r; });
    const orig = qb.maybeSingle;
    qb.maybeSingle = async () => { await gate; return orig(); };
    try {
      renderPlan(HUNGRIA_TEXT);
      // Mientras el perfil no llega, también falta el origen: se escribe y se confirma Hungría → Budapest.
      const preg = (t: string) => screen.getAllByTestId("spec-pregunta").find((q) => q.getAttribute("data-tipo") === t)!;
      fireEvent.change(within(preg("origen")).getByLabelText("Ciudad de salida"), { target: { value: "Monterrey" } });
      fireEvent.click(within(preg("origen")).getByRole("button", { name: "Usar" }));
      fireEvent.click(within(preg("ciudades_de_pais")).getByTestId("spec-aceptar"));
      expect(screen.queryAllByTestId("spec-pregunta")).toHaveLength(0);
      expect(confirmBtn()).toBeDisabled();
      expect(confirmBtn()).toHaveTextContent("Esperando a Iato…");
      await act(async () => { resolveCtx(); await vi.advanceTimersByTimeAsync(0); });
    } finally { qb.maybeSingle = orig; }
    await waitFor(() => expect(screen.getByTestId("spec-aviso")).toHaveTextContent(DRAFT_FAIL_AVISO));
    expect(screen.queryByTestId("spec-borrador")).toBeNull();
    expect(stops()).toEqual(["Budapest", "Atenas", "París"]); // lo que la persona confirmó sigue ahí
    expect(screen.getByLabelText("Sales de")).toHaveValue("Monterrey"); // su origen gana sobre el del perfil
    expect(screen.getByTestId("spec-original")).toHaveTextContent(HUNGRIA_TEXT); // el texto original, guardado
    expect(confirmBtn()).toBeEnabled();
    expect(paid()).toHaveLength(0);
  });

  it("si la IA tarda más de 45 s, el borrador (caso Diego) queda como base, con sus pendientes y su aviso", async () => {
    ia.mode = "never";
    renderPlan(DIEGO_TEXT);
    expect(screen.getByTestId("spec-borrador")).toBeInTheDocument();
    expect(stops()).toEqual(["Riad", "Ciudad del Cabo"]);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(44_000); });
    expect(screen.getByTestId("spec-borrador")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(screen.queryByTestId("spec-borrador")).toBeNull();
    expect(screen.getByTestId("spec-aviso")).toHaveTextContent(DRAFT_FAIL_AVISO);
    expect(stops()).toEqual(["Riad", "Ciudad del Cabo"]);
    expect(screen.getByTestId("spec-entendi")).toHaveTextContent("Londres (¿escala o estancia?)");
    // Con pendientes no se genera (validador de cobertura normal).
    expect(confirmBtn()).toBeDisabled();
    expect(confirmBtn()).toHaveTextContent("Resuelve 3 pendientes");
    expect(screen.getByTestId("spec-original")).toHaveTextContent(DIEGO_TEXT);
    expect(paid()).toHaveLength(0);
  });
});
