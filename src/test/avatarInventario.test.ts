// Inventario del avatar por capas: fondos por país de origen, objetos por lugar, reglas del dueño
// (Argentina sin personas reales, nada de marcas), costo único y elección de lo que se ve.
import { describe, expect, it } from "vitest";
import {
  ASSET_IMAGE_COST_USD, ciudadesSinObjetos, costoEstimado, FONDOS, fondoPrompt, fondosDePais, inventario, lugarDeRecuerdo,
  MAX_FONDOS_POR_PAIS, objetoPrompt, OBJETOS, objetosConNuevo, objetosDeRecuerdo, objetosIniciales, paisDesdePerfil,
  paisesOrigen, paisValido, planDeAssets, promptHash, recuerdosDeObjetos, resolverFondo, validarObjetos,
} from "../../supabase/functions/_shared/avatar-inventory.ts";
import { catalogCountries, GENERIC_SOUVENIR } from "../../supabase/functions/_shared/souvenirs.ts";

const nombres = (key: string) => objetosDeRecuerdo(key).map((o) => o.nombre).join(" | ");

describe("fondos: siempre del país de origen, máximo 3", () => {
  it("cubre los 16 países pedidos con 1 a 3 fondos cada uno", () => {
    for (const p of ["MX", "US", "ES", "FR", "IT", "GB", "AR", "BR", "CO", "CL", "PE", "CA", "JP", "GR", "DE", "PT"]) {
      const f = fondosDePais(p);
      expect(f.length, p).toBeGreaterThanOrEqual(1);
      expect(f.length, p).toBeLessThanOrEqual(MAX_FONDOS_POR_PAIS);
      expect(f.every((x) => x.id.startsWith(`${p.toLowerCase()}-`))).toBe(true);
    }
    const porPais = new Map<string, number>();
    for (const f of FONDOS) porPais.set(f.pais, (porPais.get(f.pais) ?? 0) + 1);
    expect(Math.max(...porPais.values())).toBeLessThanOrEqual(3);
    expect(new Set(FONDOS.map((f) => f.id)).size).toBe(FONDOS.length);
  });
  it("los ejemplos del dueño", () => {
    const n = (p: string) => fondosDePais(p).map((f) => f.nombre).join(" | ");
    expect(n("MX")).toMatch(/Ángel de la Independencia/);
    expect(n("MX")).toMatch(/Bellas Artes/);
    expect(n("US")).toMatch(/Times Square/);
    expect(n("US")).toMatch(/Casa Blanca/);
    expect(n("ES")).toMatch(/Puerta de Alcalá/);
    expect(n("ES")).toMatch(/Bernabéu/);
    expect(n("ES")).toMatch(/Sagrada Familia/);
    expect(n("FR")).toMatch(/Torre Eiffel/);
  });
  it("el fondo elegido solo vale si es de su país; si no, el primero de su país", () => {
    expect(resolverFondo("ES", "es-bernabeu")?.id).toBe("es-bernabeu");
    expect(resolverFondo("ES", "fr-eiffel")?.id).toBe("es-puerta-alcala");
    expect(resolverFondo("NO", null)).toBeNull(); // sin fondos aún: degradado de respaldo
  });
  it("país de origen desde el perfil (texto libre, con 'México' por defecto) o se pregunta", () => {
    expect(paisDesdePerfil({ pais_origen: "México" })).toBe("MX");
    expect(paisDesdePerfil({ pais_origen: "Estados Unidos" })).toBe("US");
    expect(paisDesdePerfil({ nationality: "es" })).toBe("ES");
    expect(paisDesdePerfil({ pais_origen: "argentina" })).toBe("AR");
    expect(paisDesdePerfil({ pais_origen: null, ciudad_origen: "Guadalajara" })).toBe("MX");
    expect(paisDesdePerfil({})).toBeNull();
    // Selector: primero los países con fondo, luego el resto del catálogo, sin repetir.
    const lista = paisesOrigen();
    expect(lista[0]).toMatchObject({ code: "MX", conFondo: true });
    expect(new Set(lista.map((p) => p.code)).size).toBe(lista.length);
    expect(lista.length).toBeGreaterThanOrEqual(catalogCountries().length);
    expect(paisValido("NO")).toBe(true);
    expect(paisValido("ZZ")).toBe(false);
  });
});

describe("objetos: 2 por lugar de souvenirs.ts", () => {
  it("cada ciudad, cada país y el genérico tienen exactamente 2", () => {
    expect(ciudadesSinObjetos()).toEqual([]);
    for (const [code] of catalogCountries()) expect(objetosDeRecuerdo(`pais:${code}`), code).toHaveLength(2);
    expect(objetosDeRecuerdo(GENERIC_SOUVENIR.key)).toHaveLength(2);
    expect(new Set(OBJETOS.map((o) => o.id)).size).toBe(OBJETOS.length);
    for (const o of OBJETOS) expect(o.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it("los ejemplos del dueño: croissant en París, toros en Madrid, hamburguesa en EE. UU., Río en Brasil, Grecia griega", () => {
    expect(nombres("ciudad:paris")).toMatch(/Croissant/);
    expect(nombres("ciudad:madrid")).toMatch(/Toro/);
    expect(nombres("pais:US")).toMatch(/Hamburguesa/);
    expect(nombres("pais:BR")).toMatch(/Copacabana|samba/);
    expect(nombres("ciudad:rio")).toMatch(/Pan de Azúcar/);
    expect(nombres("pais:GR")).toMatch(/jónica|griega/);
  });
  it("Argentina: fútbol genérico (camiseta albiceleste con el 10 SIN nombre) y mate; nunca una persona real", () => {
    const ar = objetosDeRecuerdo("pais:AR");
    expect(ar.map((o) => o.nombre)).toEqual(["Camiseta albiceleste con el 10", "Mate con bombilla"]);
    expect(ar[0].prompt).toMatch(/NO name/);
    expect(ar[0].prompt).toMatch(/no crest/);
  });
  it("sin personas reales ni marcas, y nada verde brillante (es el color croma)", () => {
    const prohibido = /messi|maradona|pel[eé]\b|ronaldo|neymar|disney|mickey|coca|real madrid|fc barcelona|nike|adidas|vespa|rubik|starbucks|hollywood sign|merlion|petronas|burj|cloud gate|little mermaid|cristo redentor|christ the redeemer/i;
    for (const o of OBJETOS) {
      expect(o.prompt, o.id).not.toMatch(prohibido);
      expect(o.prompt, o.id).not.toMatch(/\b(bright|neon|lime) green\b/i);
      expect(o.nombre, o.id).not.toMatch(prohibido);
    }
    for (const f of FONDOS) expect(f.prompt, f.id).not.toMatch(prohibido);
  });
  it("prompts de generación: objeto sobre verde croma plano, fondo con espacio para la persona de cuerpo completo", () => {
    const p = objetoPrompt(objetosDeRecuerdo("ciudad:paris")[0]);
    expect(p).toMatch(/croissant/);
    expect(p).toMatch(/#00FF00/);
    expect(p).toMatch(/No people, no hands/);
    const f = fondoPrompt(FONDOS[0]);
    expect(f).toMatch(/full-body standing person/);
    expect(f).toMatch(/No people/);
    expect(f).toMatch(/No text/);
  });
});

describe("costo único del inventario (se genera una vez)", () => {
  it("número de imágenes × 0.134 USD", () => {
    const plan = planDeAssets();
    expect(plan.length).toBe(FONDOS.length + OBJETOS.length);
    expect(FONDOS.length).toBe(76);
    expect(OBJETOS.length).toBe(320);
    expect(ASSET_IMAGE_COST_USD).toBe(0.134);
    expect(costoEstimado(plan.length)).toBe(53.064);
    expect(new Set(plan.map((p) => p.path)).size).toBe(plan.length);
  });
  it("huella estable del prompt (el script se salta lo ya generado)", () => {
    expect(promptHash("a")).toBe(promptHash("a"));
    expect(promptHash("a")).not.toBe(promptHash("b"));
    expect(promptHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("qué se ve: máximo 3, solo lo desbloqueado", () => {
  const ganados = ["ciudad:cdmx", "ciudad:paris", "pais:AR"];
  it("inventario = 2 objetos por recuerdo ganado", () => {
    expect(inventario(ganados).map((o) => o.id)).toEqual(["c-cdmx-1", "c-cdmx-2", "c-paris-1", "c-paris-2", "p-ar-1", "p-ar-2"]);
    expect(lugarDeRecuerdo("ciudad:paris")).toBe("París");
    expect(lugarDeRecuerdo("pais:AR")).toBe("Argentina");
  });
  it("validar lo que pide la persona: solo de su inventario, sin repetir, máximo 3", () => {
    expect(validarObjetos(["c-paris-1", "c-tokio-1", "c-paris-1", "p-ar-1", "c-cdmx-2", "c-cdmx-1"], ganados)).toEqual(["c-paris-1", "p-ar-1", "c-cdmx-2"]);
    expect(validarObjetos("x", ganados)).toEqual([]);
  });
  it("al ganar un recuerdo se muestra su primer objeto y sale el más viejo; al estrenar, uno de cada uno de los últimos 3", () => {
    expect(objetosConNuevo(["c-cdmx-1", "c-paris-1", "p-ar-1"], "ciudad:roma")).toEqual(["c-paris-1", "p-ar-1", "c-roma-1"]);
    expect(objetosConNuevo(["c-paris-2"], "ciudad:paris")).toEqual(["c-paris-2"]);
    expect(objetosIniciales(["ciudad:cdmx", "ciudad:paris", "pais:AR", "ciudad:roma"])).toEqual(["c-paris-1", "p-ar-1", "c-roma-1"]);
    expect(recuerdosDeObjetos(["c-paris-1", "c-paris-2", "p-ar-1"])).toEqual(["ciudad:paris", "pais:AR"]);
  });
});
