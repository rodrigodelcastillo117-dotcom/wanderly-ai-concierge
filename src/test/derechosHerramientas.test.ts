// Herramientas del motor de derechos para Iato/operador, registro en concierge-chat, "ver todo" con
// permiso y RLS, quejas y la integridad de la base de fuentes y contactos.
import { describe, expect, it } from "vitest";
import { TOOL_DEFS, TOOL_NAMES, toAnthropicTools, validateToolInput } from "../../supabase/functions/concierge-chat/toolDefs";
import {
  autorizaEnvio, casoDesdeArgs, OPERADOR_TOOL_DEFS, RECLAMOS_TOOL_DEFS, runReclamosTool,
} from "../../supabase/functions/_shared/derechos/herramientas";
import { enmascarar, PREGUNTA_PERMISO, verTodo } from "../../supabase/functions/_shared/derechos/contexto";
import { AIRLINE_CONTACTS, correoUtilizable, EU_NEB } from "../../supabase/functions/_shared/derechos/datos";
import { FUENTES } from "../../supabase/functions/_shared/derechos/fuentes";
import { clasificarQueja, clasificarQuejaReglas, respuestaQueja } from "../../supabase/functions/_shared/derechos/quejas";
import { decidirRespuesta, parseRespuesta, siguientePaso } from "../../supabase/functions/_shared/derechos/respuesta";
import { esCorreoDeReclamos, rutaEntrante } from "../../supabase/functions/_shared/derechos/rutas";

const USER = "0c000000-0000-0000-0000-00000000000a";

describe("registro en concierge-chat (solo registro, sin tocar el prompt)", () => {
  it("las 7 herramientas de reclamos están en TOOL_DEFS, al final (no cambia el prefijo de caché de las anteriores)", () => {
    const nombres = RECLAMOS_TOOL_DEFS.map((t) => t.name);
    expect(nombres).toEqual(["revisar_derechos_vuelo", "revisar_derechos_servicio", "preparar_reclamo", "enviar_reclamo", "seguimiento_reclamo", "registrar_queja", "ver_mi_viaje"]);
    expect(TOOL_NAMES.slice(-7)).toEqual(nombres);
    // Integración con incidentes: report_incident también se agregó al final, entre search_prive y los de reclamos;
    // las herramientas anteriores siguen en el mismo orden (el prefijo de caché no cambia).
    expect(TOOL_NAMES.indexOf("report_incident")).toBe(TOOL_NAMES.length - 8);
    expect(TOOL_NAMES.indexOf("search_prive")).toBe(TOOL_NAMES.length - 9);
    expect(toAnthropicTools().find((t) => t.name === "revisar_derechos_vuelo")).toBeTruthy();
  });
  it("validateToolInput acepta la entrada típica y exige los campos requeridos", () => {
    expect(validateToolInput("revisar_derechos_vuelo", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: "4" }))
      .toEqual({ ok: true, input: { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 4 } });
    expect(validateToolInput("revisar_derechos_vuelo", { evento: "retraso", origen: "CDG" })).toEqual({ ok: false, error: 'falta "destino"' });
    expect(validateToolInput("revisar_derechos_vuelo", { evento: "huracan", origen: "CDG", destino: "MEX", aerolinea: "AF" }).ok).toBe(false);
    expect(validateToolInput("enviar_reclamo", { id: "x" })).toEqual({ ok: false, error: 'falta "folio"' });
  });
  it("las descripciones obligan a decir la certeza y a no adivinar correos ni enviar sin folio", () => {
    const d = (n: string) => TOOL_DEFS.find((t) => t.name === n)!.description;
    expect(d("revisar_derechos_vuelo")).toMatch(/certeza/);
    expect(d("preparar_reclamo")).toMatch(/NO envía nada/);
    expect(d("enviar_reclamo")).toMatch(/folio/);
    expect(d("ver_mi_viaje")).toMatch(/permiso/);
    expect(RECLAMOS_TOOL_DEFS.find((t) => t.name === "preparar_reclamo")!.input_schema.properties.correo_proveedor.description).toMatch(/Nunca lo adivines/);
  });
  it("el operador tiene sus propias herramientas (solo administradores)", () => {
    expect(OPERADOR_TOOL_DEFS.map((t) => t.name)).toEqual(["operador_listar_reclamos", "operador_ver_reclamo", "revisar_derechos_vuelo", "revisar_derechos_servicio"]);
  });
});

describe("ejecución de herramientas", () => {
  it("revisar_derechos_vuelo funciona sin base ni red", async () => {
    const r = await runReclamosTool("revisar_derechos_vuelo", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 4 }, { userId: USER, lector: {} as never, deps: null }) as any;
    expect(r.principal).toMatchObject({ id: "EU261_compensacion", monto: { valor: 600, moneda: "EUR" } });
    expect(r.reclamar[0].nombre).toBe("Air France");
  });
  it("casoDesdeArgs convierte textos a números y arma la reubicación", () => {
    expect(casoDesdeArgs({ evento: "cancelacion", origen: "mad", destino: "mex", aerolinea: "IB", aviso_dias: "3", reubicacion_ofrecida: true, reubicacion_llega_despues_horas: "1.5", precio: 900, moneda: "eur" }))
      .toMatchObject({ origen: "mad", aviso_dias: 3, reubicacion: { ofrecida: true, llega_despues_horas: 1.5 }, precio: { monto: 900, moneda: "EUR" } });
  });
  it("enviar_reclamo: sin el folio y un «sí» en el ÚLTIMO mensaje del usuario no envía (aunque el modelo lo pida)", async () => {
    const llamadas: string[] = [];
    const deps = { db: { rpc: async (fn: string) => { llamadas.push(fn); return { data: null, error: null }; } } } as never;
    const base = { userId: USER, lector: {} as never, deps };
    expect(await runReclamosTool("enviar_reclamo", { id: "x", folio: "C-ABC123" }, { ...base, ultimoMensajeUsuario: "ok gracias" })).toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(await runReclamosTool("enviar_reclamo", { id: "x", folio: "C-ABC123" }, { ...base, ultimoMensajeUsuario: "No, todavía no envíes C-ABC123" })).toMatchObject({ code: "CONSENT_REQUIRED" });
    expect(llamadas).toEqual([]);
  });
  it("autorizaEnvio: folio + afirmación explícita, sin negación", () => {
    expect(autorizaEnvio("Sí, envía C-ABC123", "C-ABC123")).toBe(true);
    expect(autorizaEnvio("adelante con el c-abc123", "C-ABC123")).toBe(true);
    expect(autorizaEnvio("Sí, envía", "C-ABC123")).toBe(false);
    expect(autorizaEnvio("sí envía C-ZZZ999", "C-ABC123")).toBe(false);
    expect(autorizaEnvio("no envíes C-ABC123", "C-ABC123")).toBe(false);
    expect(autorizaEnvio("Sí, envía C-ABC123", "cualquiera")).toBe(false);
  });
  it("las herramientas que escriben dicen «no disponible» si no hay base (no truenan)", async () => {
    expect(await runReclamosTool("preparar_reclamo", { tipo: "vuelo" }, { userId: USER, lector: {} as never, deps: null })).toEqual({ error: "reclamos_no_disponible" });
  });
});

describe("ver todo: con permiso y con la sesión del usuario", () => {
  const lector = (tablas: Record<string, unknown[] | "error">, log: string[] = []) => ({
    from(t: string) {
      const q: any = {
        _t: t,
        select(cols: string) { log.push(`${t}:${cols.split(",")[0]}`); return q; },
        eq(c: string, v: unknown) { log.push(`${t}.${c}=${v}`); return q; },
        order() { return q; },
        limit() { const d = tablas[t]; return Promise.resolve(d === "error" ? { data: null, error: { message: "rls" } } : { data: d ?? [], error: null }); },
      };
      return q;
    },
  });
  it("sin permiso devuelve la pregunta y no lee nada", async () => {
    const log: string[] = [];
    expect(await verTodo(lector({}, log) as never, USER, { permiso: false })).toEqual({ ok: false, code: "PERMISO_REQUERIDO", pregunta: PREGUNTA_PERMISO });
    expect(log).toEqual([]);
  });
  it("con permiso lee solo lo del usuario (filtro user_id) y enmascara números de la Bóveda", async () => {
    const log: string[] = [];
    const r = await verTodo(lector({ vault_items: [{ title: "Pasaporte", number: "G12345678" }], expenses: [{ amount: 100 }], tracked_flights: "error" }, log) as never, USER, { permiso: true, alcance: ["boveda", "gastos", "vuelos"] }) as any;
    expect(r.ok).toBe(true);
    expect(r.datos.boveda).toEqual([{ title: "Pasaporte", number: "••••5678" }]);
    expect(r.datos.gastos).toEqual([{ amount: 100 }]);
    expect(r.no_disponible).toEqual(["vuelos"]);
    expect(log).toContain(`vault_items.user_id=${USER}`);
    expect(enmascarar(null)).toBeNull();
  });
});

describe("respuesta del proveedor y quejas", () => {
  it("parseRespuesta valida la salida del modelo y rechaza lo que no cumple", () => {
    expect(parseRespuesta({ resultado: "inventado" })).toBeNull();
    expect(parseRespuesta({ resultado: "acepto", monto_ofrecido: -5, moneda: "euros", citas: ["a", "b", "c", "d"] })).toMatchObject({ monto_ofrecido: null, moneda: null, citas: ["a", "b", "c"] });
  });
  it("siguiente paso por resultado", () => {
    const base = { monto_ofrecido: null, moneda: null, vale: null, datos_pedidos: "Copia del pase de abordar", motivo_rechazo: null, alega_circunstancias_extraordinarias: false, numero_caso_proveedor: null, citas: ["please send us a copy"], idioma: "en", resumen_es: "Piden el pase." };
    const pide = decidirRespuesta({ ...base, resultado: "pide_datos" }, "Hello, please send us a copy of your boarding pass", true);
    expect(siguientePaso(pide, {})).toMatchObject({ accion: "enviar_datos", estado_sugerido: "necesita_usuario" });
    const acuse = decidirRespuesta({ ...base, resultado: "acuse_recibo", citas: [] }, "We received your request", false);
    expect(siguientePaso(acuse, {})).toMatchObject({ accion: "esperar" });
    expect(siguientePaso(decidirRespuesta(null, "x", true), {})).toMatchObject({ accion: "revisar" });
  });
  it("clasificación por reglas: gravedad, qué espera y sentimiento", () => {
    expect(clasificarQuejaReglas("Cancelaron mi vuelo y nadie me dice nada, es INACEPTABLE")).toMatchObject({ categoria: "vuelo", gravedad: "alta", sentimiento: "enojado" });
    expect(clasificarQuejaReglas("Estoy en el aeropuerto, me siento mal y necesito un hospital")).toMatchObject({ gravedad: "critica", categoria: "salud", urgente: true });
    expect(clasificarQuejaReglas("¿Cómo pido el reembolso del tour?")).toMatchObject({ que_espera: "reembolso" });
  });
  it("la IA puede subir la gravedad pero nunca bajarla", async () => {
    const call = async () => ({ ok: true, status: 200, data: { content: [{ type: "tool_use", name: "record_complaint", input: { contra: "proveedor", proveedor: "Hotel X", categoria: "hotel", que_paso: "No hay habitación", que_espera: "solucion_inmediata", gravedad: "baja", sentimiento: "neutral" } }] } });
    const c = await clasificarQueja("Llegué al hotel y no hay habitación, estoy en recepción ahorita sin hotel", null as never, call);
    expect(c.gravedad).toBe("alta");
    expect(c.metodo).toBe("reglas+ia");
    expect(respuestaQueja(c, { nombre: "Ana López", caso: null })).toMatch(/^Ana, /);
  });
});

describe("rutas de correo entrante (sin romper Reservas IA)", () => {
  it("distingue reservas+, reclamos+ y casos+ en reply.traveliatos.life", () => {
    const t = "0123456789abcdef01234567";
    expect(rutaEntrante([`reservas+${t}@reply.traveliatos.life`])).toEqual({ tipo: "reserva", token: t });
    expect(rutaEntrante([[`Rec <reclamos+${t}@reply.traveliatos.life>`]])).toEqual({ tipo: "reclamo", token: t });
    expect(rutaEntrante([`casos+${t}@reply.traveliatos.life`])).toEqual({ tipo: "caso", token: t });
    expect(rutaEntrante([`casos@reply.traveliatos.life`])).toEqual({ tipo: "ninguna", token: null });
    expect(rutaEntrante([`reclamos+${t}@reply.traveliatos.life.evil.com`])).toEqual({ tipo: "ninguna", token: null });
    expect(esCorreoDeReclamos([`casos@reply.traveliatos.life`])).toBe(true);
    expect(esCorreoDeReclamos([`reservas+${t}@reply.traveliatos.life`])).toBe(false);
  });
});

describe("integridad de fuentes y contactos (nada inventado)", () => {
  it("toda fuente tiene URL oficial, fecha de consulta y cita; las de índice no se usan para afirmar", () => {
    for (const f of Object.values(FUENTES)) {
      expect(f.url, f.id).toMatch(/^https:\/\//);
      expect(f.consultado).toBe("2026-10-29");
      expect(f.cita.length, f.id).toBeGreaterThan(20);
    }
    expect(Object.values(FUENTES).filter((f) => f.estado === "no_verificado")).toEqual([]);
  });
  it("ningún contacto de aerolínea trae correo sin haberlo leído en su página oficial", () => {
    for (const c of Object.values(AIRLINE_CONTACTS)) {
      if (c.correo) expect(c.verificacion, c.nombre).toBe("pagina_leida");
      expect(correoUtilizable(c)).toBe(!!c.correo && c.verificacion === "pagina_leida");
      if (c.verificacion !== "no_verificado") expect(c.fuente_url, c.nombre).toMatch(/^https:\/\//);
    }
    // Las 12 que vuelan desde y hacia México.
    expect(Object.keys(AIRLINE_CONTACTS).sort()).toEqual(["AA", "AF", "AM", "AV", "CM", "DL", "IB", "KL", "LH", "UA", "VB", "Y4"]);
  });
  it("hay organismo nacional para los 27 de la UE + Islandia, Noruega y Suiza", () => {
    expect(Object.keys(EU_NEB)).toHaveLength(30);
    for (const o of Object.values(EU_NEB)) expect(o.fuente).toBe("EU_NEB");
  });
});
