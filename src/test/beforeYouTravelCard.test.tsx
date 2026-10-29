// Tarjeta "Antes de viajar" (pestaña Destinos del viaje): SRE primero y siempre visible, fuentes con
// fecha y para quién son, carga perezosa y una sola consulta por país. Datos: respuestas reales
// recortadas de GOV.UK y State Dept procesadas por el mismo núcleo del servidor. Sin red.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import govukIndex from "./fixtures/avisos/govuk_index.json";
import govukThailand from "./fixtures/avisos/govuk_thailand.json";
import govukJapan from "./fixtures/avisos/govuk_japan.json";
import stateList from "./fixtures/avisos/state_travel_advisories.json";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

import { supabase } from "@/integrations/supabase/client";
import { BeforeYouTravelCard } from "@/components/trip/BeforeYouTravelCard";
import { clearAdvisoryCache, fechaFuente, severity, tripCountries } from "@/lib/travelAdvisory";
import { memoryCacheStore } from "../../supabase/functions/_shared/serpCache";
import { GOVUK_API, STATE_API, type AdvisoryResult, getTravelAdvisory, makeTranslator, resetAdvisoryMemo } from "../../supabase/functions/_shared/travelAdvisories";

const NOW = Date.parse("2026-10-28T18:00:00Z");
const res = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s });
const fetchImpl = (async (u: string | URL) => {
  const url = String(u);
  if (url === GOVUK_API) return res(govukIndex);
  if (url === `${GOVUK_API}/thailand`) return res(govukThailand);
  if (url === `${GOVUK_API}/japan`) return res(govukJapan);
  if (url === STATE_API) return res(stateList);
  return res({}, 404);
}) as unknown as typeof fetch;
const PUNTOS = JSON.stringify({
  puntos: [
    { texto: "El FCDO desaconseja viajar, salvo lo esencial, a zonas a menos de 20 km de la frontera con Camboya.", fuente: "govuk" },
    { texto: "Hay inundaciones graves en varias provincias, incluida Bangkok.", fuente: "govuk" },
    { texto: "EE. UU. pide mayor precaución cerca de la frontera con Camboya por riesgo de conflicto armado.", fuente: "state_dept" },
  ],
});
async function advisory(pais: string, translated = true): Promise<AdvisoryResult> {
  resetAdvisoryMemo();
  return getTravelAdvisory(pais, {
    fetchImpl, store: memoryCacheStore(() => NOW), now: () => NOW,
    translate: makeTranslator(async () => (translated ? { ok: true, text: PUNTOS, model: "claude-haiku-5-5" } : { ok: false, text: "", model: null })),
  });
}
const invoke = vi.mocked(supabase.functions.invoke);

beforeEach(() => {
  clearAdvisoryCache();
  invoke.mockReset();
  try { window.sessionStorage.clear(); } catch { /* */ }
});

describe("BeforeYouTravelCard", () => {
  it("SRE primero y siempre visible; sin consultar nada mientras la pestaña no está visible", () => {
    render(<BeforeYouTravelCard trip={{ id: "t1", destino: "Bangkok", pais_destino: "Tailandia" }} active={false} />);
    const card = screen.getByTestId("antes-de-viajar");
    const links = within(card).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "https://www.gob.mx/guiadeviaje");
    expect(links[0]).toHaveTextContent("Para mexicanos: consulta la Guía del Viajero de la SRE");
    expect(card).toHaveTextContent("No sustituye asesoría migratoria, legal o consular.");
    expect(card).toHaveTextContent("publican estos avisos para sus propios ciudadanos");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("al abrir la pestaña: niveles, puntos en español y fuentes con fecha y para quién son", async () => {
    invoke.mockResolvedValue({ data: await advisory("TH"), error: null } as never);
    render(<BeforeYouTravelCard trip={{ id: "t1", destino: "Bangkok", pais_destino: "Tailandia" }} active />);
    await waitFor(() => expect(screen.getByTestId("avisos-fuentes")).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledWith("avisos-viaje", { body: { pais: "TH", trip_id: "t1" } });
    expect(screen.getByTestId("nivel-govuk")).toHaveTextContent("Reino Unido (FCDO): Desaconseja viajar a algunas zonas, salvo lo esencial");
    expect(screen.getByTestId("nivel-state_dept")).toHaveTextContent("EE. UU. (Depto. de Estado): Nivel 1 de 4: precauciones normales");
    expect(within(screen.getByTestId("avisos-puntos")).getAllByRole("listitem")).toHaveLength(3);
    const fuentes = screen.getByTestId("avisos-fuentes");
    expect(fuentes).toHaveTextContent("Fuente: GOV.UK (Foreign, Commonwealth & Development Office), actualizado 12 oct 2026 · Aviso para ciudadanos británicos");
    expect(fuentes).toHaveTextContent("Fuente: Departamento de Estado de EE. UU., actualizado 6 jul 2026 · Aviso para ciudadanos estadounidenses");
    const original = within(fuentes).getAllByRole("link", { name: "Ver original" }).map((a) => a.getAttribute("href"));
    expect(original[0]).toBe("https://www.gov.uk/foreign-travel-advice/thailand");
    expect(original[1]).toMatch(/travel\.state\.gov/);
    // La SRE sigue siendo el primer enlace de la tarjeta.
    expect(within(screen.getByTestId("antes-de-viajar")).getAllByRole("link")[0]).toHaveAttribute("href", "https://www.gob.mx/guiadeviaje");
  });

  it("si la traducción falló: texto original en inglés con aviso (nada inventado)", async () => {
    invoke.mockResolvedValue({ data: await advisory("TH", false), error: null } as never);
    render(<BeforeYouTravelCard trip={{ destino: "Tailandia" }} active />);
    await waitFor(() => expect(screen.getByTestId("avisos-original")).toBeInTheDocument());
    expect(screen.getByTestId("avisos-original")).toHaveTextContent("No pudimos traducirlo ahora; este es el texto original en inglés.");
    expect(screen.getByTestId("avisos-original")).toHaveTextContent(/FCDO/);
  });

  it("caché del cliente: volver a abrir el viaje no vuelve a llamar a la función", async () => {
    invoke.mockResolvedValue({ data: await advisory("TH"), error: null } as never);
    const { unmount } = render(<BeforeYouTravelCard trip={{ destino: "Tailandia" }} active />);
    await waitFor(() => expect(screen.getByTestId("avisos-fuentes")).toBeInTheDocument());
    unmount();
    render(<BeforeYouTravelCard trip={{ destino: "Tailandia" }} active />);
    await waitFor(() => expect(screen.getByTestId("avisos-fuentes")).toBeInTheDocument());
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("error de la función: lo dice y ofrece reintentar; la SRE sigue visible", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("503") } as never);
    render(<BeforeYouTravelCard trip={{ destino: "Japón" }} active />);
    await waitFor(() => expect(screen.getByText(/No pudimos consultar los avisos oficiales ahora/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.getByTestId("avisos-sre")).toBeInTheDocument();
  });

  it("viaje dentro de México: sin tarjeta", () => {
    const { container } = render(<BeforeYouTravelCard trip={{ destino: "Cancún", pais_destino: "México" }} active />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("travelAdvisory (cliente)", () => {
  it("países del viaje multidestino, sin repetir y sin México", () => {
    expect(tripCountries({ pais_destino: null, destino: "Roma" }, ["Roma", "Florencia", "Madrid", "Cancún"]).map((p) => p.iso2)).toEqual(["IT", "ES"]);
  });
  it("gravedad comparable y fecha de la fuente sin mover de zona", () => {
    expect(severity({ valor: 1, escala: "1-4" })).toBe(0);
    expect(severity({ valor: 4, escala: "1-4" })).toBe(3);
    expect(severity({ valor: 1, escala: "fcdo" })).toBe(1);
    expect(fechaFuente("2026-07-06T20:00:00-04:00")).toBe("6 jul 2026");
  });
});
