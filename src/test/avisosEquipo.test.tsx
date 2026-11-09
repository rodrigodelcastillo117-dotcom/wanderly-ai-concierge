// Mesa → «Avisos a mi celular»: a quién le llegan los avisos cuando el Operador IA pasa un caso a una persona,
// activar el celular, prueba a toda la guardia y entrar/salir. Lógica (avisosEquipo.ts) y pantalla.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { cambiarGuardia, estadoAvisos, pruebaAvisos, type AvisosDeps } from "../../supabase/functions/_shared/avisosEquipo";

const invoke = vi.fn();
const subscribePush = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@/lib/pushNotifications", () => ({ subscribePush: () => subscribePush() }));
import { AvisosEquipoPanel } from "@/components/incident/AvisosEquipoPanel";

const YO = { id: "u-rod", email: "rodrigo@iatos.mx", nombre: "Rodrigo" };
const deps = (o: Partial<AvisosDeps> = {}): AvisosDeps & { correos: string[]; pushes: string[] } => {
  const correos: string[] = []; const pushes: string[] = [];
  return {
    correos, pushes,
    guardia: async () => [{ email: "hola@traveliatos.life", role: "primario", user_id: null, fallback: true }],
    guardiaConfigurada: async () => false,
    dispositivos: async () => 0,
    correo: async (to) => { correos.push(to); return { ok: true }; },
    push: async (uid) => { pushes.push(uid); return 1; },
    unirse: async () => ({ ok: true }),
    salir: async () => ({ ok: true }),
    ...o,
  };
};

describe("avisos al equipo · lógica", () => {
  it("sin guardia configurada y sin celulares: dice exactamente qué falta", async () => {
    const e = await estadoAvisos(deps(), YO);
    expect(e.configurada).toBe(false);
    expect(e.yo).toEqual({ email: "rodrigo@iatos.mx", en_guardia: false, celular: false });
    expect(e.faltan).toHaveLength(2);
    expect(e.faltan[0]).toMatch(/FIXER_EMAIL/);
    expect(e.faltan[1]).toMatch(/Activar en este celular/);
  });

  it("guardia con alguien que tiene el celular activado: no falta nada", async () => {
    const e = await estadoAvisos(deps({
      guardiaConfigurada: async () => true,
      guardia: async () => [{ email: "Rodrigo@iatos.mx", role: "primario", user_id: "u-rod" }, { email: "carlo@iatos.mx", role: "respaldo", user_id: "u-car" }],
      dispositivos: async (uid) => (uid === "u-rod" ? 2 : 0),
    }), YO);
    expect(e.faltan).toEqual([]);
    expect(e.yo).toMatchObject({ en_guardia: true, celular: true });
    expect(e.guardia.map((g) => [g.email, g.celular])).toEqual([["Rodrigo@iatos.mx", true], ["carlo@iatos.mx", false]]);
  });

  it("la prueba va a TODA la guardia: correo a cada uno y push solo a quien tiene cuenta; dice PRUEBA", async () => {
    const asuntos: string[] = [];
    const d = deps({
      guardia: async () => [{ email: "rodrigo@iatos.mx", role: "primario", user_id: "u-rod" }, { email: "carlo@iatos.mx", role: "respaldo", user_id: null }],
      correo: async (to, asunto) => { asuntos.push(asunto); return to.startsWith("carlo") ? { ok: false, error: "rebotó" } : { ok: true }; },
    });
    const r = await pruebaAvisos(d, YO);
    expect(r.ok).toBe(true);
    expect(asuntos.every((a) => /^PRUEBA/.test(a))).toBe(true);
    expect(d.pushes).toEqual(["u-rod"]);
    expect(r.resultados).toEqual([
      { email: "rodrigo@iatos.mx", correo: true, error: null, celular: true },
      { email: "carlo@iatos.mx", correo: false, error: "rebotó", celular: false },
    ]);
  });

  it("sin guardia no manda nada", async () => {
    const d = deps({ guardia: async () => [] });
    expect(await pruebaAvisos(d, YO)).toMatchObject({ ok: false, code: "SIN_GUARDIA" });
    expect(d.correos).toEqual([]);
  });

  it("entrar a la guardia usa SU correo (en minúsculas) y el rol pedido; salir también", async () => {
    const unirse = vi.fn(async () => ({ ok: true })); const salir = vi.fn(async () => ({ ok: true }));
    const d = deps({ unirse, salir });
    await cambiarGuardia(d, { ...YO, email: "Rodrigo@IATOS.mx" }, "unirme", "respaldo");
    expect(unirse).toHaveBeenCalledWith({ email: "rodrigo@iatos.mx", name: "Rodrigo", role: "respaldo" });
    await cambiarGuardia(d, YO, "unirme", "lo-que-sea");
    expect(unirse).toHaveBeenLastCalledWith(expect.objectContaining({ role: "primario" }));
    await cambiarGuardia(d, YO, "salir", null);
    expect(salir).toHaveBeenCalledWith("rodrigo@iatos.mx");
    expect(await cambiarGuardia(d, { id: "x", email: null }, "unirme", null)).toMatchObject({ ok: false, code: "SIN_CORREO" });
  });
});

const ESTADO = {
  ok: true, configurada: false, yo: { email: "rodrigo@iatos.mx", en_guardia: false, celular: false },
  guardia: [{ email: "hola@traveliatos.life", nombre: null, rol: "primario", celular: false, de_turno: true }],
  faltan: ["La guardia sale del secreto FIXER_EMAIL: agrégate…", "Nadie de la guardia tiene el celular activado…"],
};

describe("avisos al equipo · pantalla", () => {
  beforeEach(() => { invoke.mockReset(); subscribePush.mockReset(); });

  it("si falta algo se abre sola, en ámbar, con lo que falta y quién está en la guardia", async () => {
    invoke.mockResolvedValue({ data: ESTADO, error: null });
    render(<AvisosEquipoPanel />);
    const panel = await screen.findByTestId("avisos-equipo");
    expect(panel).toHaveAttribute("open");
    expect(invoke).toHaveBeenCalledWith("ops-desk", { body: { accion: "avisos_estado" } });
    expect(screen.getByText(/FIXER_EMAIL: agrégate/)).toBeInTheDocument();
    expect(screen.getByText("hola@traveliatos.life")).toBeInTheDocument();
    expect(screen.getByText("celular sin activar · guardia: 1", { exact: false })).toBeInTheDocument();
  });

  it("Activar en este celular pide permiso del navegador y recarga el estado", async () => {
    invoke.mockResolvedValue({ data: ESTADO, error: null });
    subscribePush.mockResolvedValue({ ok: true });
    render(<AvisosEquipoPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Activar en este celular" }));
    expect(await screen.findByText(/este celular ya recibe los avisos urgentes/)).toBeInTheDocument();
    expect(subscribePush).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter((c) => c[1].body.accion === "avisos_estado").length).toBe(2);
  });

  it("Mandar aviso de prueba muestra el resultado por persona", async () => {
    invoke.mockImplementation(async (_f: string, { body }: { body: { accion: string } }) => body.accion === "avisos_prueba"
      ? { data: { ok: true, resultados: [{ email: "hola@traveliatos.life", correo: true, error: null, celular: false }] }, error: null }
      : { data: ESTADO, error: null });
    render(<AvisosEquipoPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Mandar aviso de prueba" }));
    expect(await screen.findByText(/hola@traveliatos.life: correo enviado/)).toBeInTheDocument();
  });

  it("Entrar a la guardia la guarda como primario", async () => {
    invoke.mockImplementation(async (_f: string, { body }: { body: { accion: string } }) => body.accion === "avisos_unirme"
      ? { data: { ...ESTADO, configurada: true, yo: { ...ESTADO.yo, en_guardia: true }, faltan: [] }, error: null }
      : { data: ESTADO, error: null });
    render(<AvisosEquipoPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Entrar a la guardia" }));
    expect(await screen.findByText("Ya estás en la guardia.")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("ops-desk", { body: { accion: "avisos_unirme", rol: "primario" } });
    expect(screen.getByRole("button", { name: "Salir de la guardia" })).toBeInTheDocument();
  });

  it("si la función no responde, no se muestra nada", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("403") });
    const { container } = render(<AvisosEquipoPanel />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });
});
