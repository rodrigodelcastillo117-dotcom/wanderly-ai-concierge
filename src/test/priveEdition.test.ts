// THE PRIVATE EDITION · pruebas de la especificación §14 que se automatizan sin navegador real:
// intereses, personalización, idioma, fecha y procedencia, artículo no aprobado/imagen sin licencia (forma del
// servidor), promoción vencida, enlace comercial falso, revista sin contenido suficiente, From Page to
// Experience, lectura offline (Cache Storage simulado), cierre de sesión, recuperación de conexión, costos.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_PREFS, EDITION_KINDS, INTEREST_KEYS, effectiveWeights, hasEnoughContent, imageAllowed, isOpportunityLive, liveOpportunities,
  matchDestination, personalizeIssue, reconcilePack, resolveAction, resolveLanguage, selectFlightEdition, tr, type EditionPrefs,
  type IssuePayload, type Opportunity,
} from "@/lib/priveEdition";
import { EDITION_TEXT } from "@/lib/priveEditionI18n";
import {
  clearAllOfflineEditions, deleteOfflinePack, listOfflinePacks, readOfflinePack, saveOfflinePack, storedUserId, packPayload, EDITION_CACHE,
} from "@/lib/priveEditionOffline";
import { createEditionApi } from "@/lib/priveEditionApi";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { classify, isCheckableUrl, checkLink } from "../../supabase/functions/edition-link-check/check";
import { payloadFromDoc } from "../../scripts/edition/payload.mjs";
import { buildSeedSql, validateIssue, INTEREST_KEYS as SEED_KEYS } from "../../scripts/edition/build-seed.mjs";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const doc = JSON.parse(read("data/prive/edition/issue-01.json"));
const payload = payloadFromDoc(doc) as IssuePayload;
const prefs = (p: Partial<EditionPrefs>): EditionPrefs => ({ ...DEFAULT_PREFS, ...p });
const slugs = (xs: { slug: string }[]) => xs.map((x) => x.slug);

describe("intereses (§2)", () => {
  it("los 25 intereses del dueño, iguales en la app, el generador y la base", () => {
    expect(INTEREST_KEYS).toHaveLength(25);
    expect(SEED_KEYS).toEqual(INTEREST_KEYS);
    const sql = read("supabase/migrations/20261025100000_edition_core.sql");
    const arr = /edition_interest_keys\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/.exec(sql)![1];
    expect(arr.match(/'([a-z_0-9]+)'/g)!.map((s) => s.replace(/'/g, ""))).toEqual(INTEREST_KEYS);
  });
  it("las ediciones Viajes / Negocios / Estilo de vida / Mi mezcla existen y solo usan intereses válidos", () => {
    expect(EDITION_KINDS.map((k) => k.key)).toEqual(["viajes", "negocios", "estilo_de_vida", "mi_mezcla"]);
    for (const k of EDITION_KINDS) for (const key of Object.keys(k.preset)) expect(INTEREST_KEYS).toContain(key);
  });
  it("sin consentimiento, los intereses del miembro no cuentan", () => {
    expect(effectiveWeights(prefs({ interests: { golf: 3 }, personalization_consent: false }))).toEqual({});
    expect(effectiveWeights(prefs({ interests: { golf: 3 }, personalization_consent: true }))).toEqual({ golf: 3 });
  });
});

describe("personalización barata sobre la edición común (§8)", () => {
  it("edición común: la portada del editor y el orden editorial", () => {
    const ed = personalizeIssue(payload, prefs({ reading_minutes: 120 }));
    expect(ed.personalized).toBe(false);
    expect(ed.cover?.slug).toBe("cdmx-fin-de-semana-gran-premio");
    expect(ed.sections.map((s) => s.key).slice(0, 3)).toEqual(["carta", "portada", "reportajes"]);
  });
  it("Edición de negocios pone finanzas e IA primero en sus secciones; la de viajes, Mérida y Mónaco", () => {
    const biz = personalizeIssue(payload, prefs({ edition_kind: "negocios", reading_minutes: 120 }));
    expect(slugs(biz.sections.find((s) => s.key === "explicadores")!.articles).sort()).toEqual(["banxico-pausa-6-50", "ue-ia-alto-riesgo-2027"]);
    expect(biz.sections.find((s) => s.key === "explicadores")!.articles[0].topics).toContain("negocios");
    const travel = personalizeIssue(payload, prefs({ edition_kind: "viajes", reading_minutes: 120 }));
    expect(slugs(travel.sections.find((s) => s.key === "reportajes")!.articles)).toEqual(["merida-guadalajara-mesa-mexicana", "monaco-yacht-show-2026"]);
  });
  it("Mi mezcla con yates: la portada personal pasa a Mónaco (con su foto) y se dice que es selección automática", () => {
    const ed = personalizeIssue(payload, prefs({ interests: { yates_y_embarcaciones: 3, experiencias_extraordinarias: 3 }, personalization_consent: true, reading_minutes: 120 }));
    expect(ed.cover?.slug).toBe("monaco-yacht-show-2026");
    expect(ed.coverImage).toBe("img_monaco_puerto");
    expect(EDITION_TEXT.es.personalizedNote).toMatch(/No es una investigación individual/);
  });
  it("temas excluidos ocultan las piezas (nunca la carta) y lo dice", () => {
    const ed = personalizeIssue(payload, prefs({ excluded: ["finanzas_y_mercados"], reading_minutes: 120 }));
    const all = [...ed.sections.flatMap((s) => s.articles), ...ed.moreTime];
    expect(all.some((a) => a.topics.includes("finanzas_y_mercados"))).toBe(false);
    expect(ed.hidden.length).toBeGreaterThanOrEqual(3);
    expect(all.some((a) => a.format === "letter")).toBe(true);
  });
  it("tiempo de lectura: entra lo prioritario; lo demás queda en 'si tienes más tiempo'", () => {
    const ed = personalizeIssue(payload, prefs({ reading_minutes: 5 }));
    expect(ed.readingMinutes).toBeLessThanOrEqual(8);
    expect(ed.moreTime.length).toBeGreaterThan(0);
    expect(slugs(ed.sections.flatMap((s) => s.articles))).toContain("cdmx-fin-de-semana-gran-premio");
  });
  it("orden de secciones del miembro", () => {
    const ed = personalizeIssue(payload, prefs({ section_order: ["world_brief", "agenda"], reading_minutes: 120 }));
    expect(ed.sections.map((s) => s.key).slice(0, 2)).toEqual(["world_brief", "agenda"]);
  });
  it("nunca infiere por sexo o género: un dato de perfil no cambia nada (la función no recibe perfil)", () => {
    const base = personalizeIssue(payload, prefs({ reading_minutes: 20 }));
    const withGender = personalizeIssue(payload, { ...prefs({ reading_minutes: 20 }), gender: "female", sexo: "M" } as EditionPrefs);
    expect(withGender).toEqual(base);
    const src = read("src/lib/priveEdition.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\b(gender|genero|género|sexo)\b/i);
  });
  it("avisa los intereses que este número aún no cubre (moda, belleza…) en vez de rellenar", () => {
    const ed = personalizeIssue(payload, prefs({ interests: { belleza: 3, moda: 2 }, personalization_consent: true }));
    expect(ed.uncovered).toContain("belleza");
  });
  it("revista sin contenido suficiente no se presenta como número", () => {
    expect(hasEnoughContent(payload)).toBe(true);
    expect(hasEnoughContent({ ...payload, articles: payload.articles!.filter((a) => a.format === "brief").concat(payload.articles!.slice(0, 2)) })).toBe(false);
    expect(hasEnoughContent({ found: false })).toBe(false);
  });
});

describe("idioma (cambio de idioma)", () => {
  it("elige el del miembro, luego el del navegador, luego español", () => {
    expect(resolveLanguage({ language: "en" }, "es-MX")).toBe("en");
    expect(resolveLanguage({ language: null }, "en-US")).toBe("en");
    expect(resolveLanguage(null, "fr-FR")).toBe("es");
  });
  it("todas las piezas del Nº 01 tienen versión en inglés (título, entradilla y cuerpo)", () => {
    for (const a of doc.articles) {
      expect(a.title.en, a.slug).toBeTruthy();
      expect(a.dek.en, a.slug).toBeTruthy();
      for (const b of a.body) if ("es" in b) expect(b.en, `${a.slug} ${b.t}`).toBeTruthy();
    }
  });
  it("si falta la traducción se muestra el español y se avisa", () => {
    expect(tr({ es: "Hola" }, "en")).toEqual({ text: "Hola", fallback: true });
    expect(tr({ es: "Hola", en: "Hi" }, "en")).toEqual({ text: "Hi", fallback: false });
  });
  it("el diccionario es/en tiene las mismas claves", () => {
    const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
    expect(keys(EDITION_TEXT.en).sort()).toEqual(keys(EDITION_TEXT.es).sort());
  });
});

describe("fuentes, fechas y reglas editoriales del primer número", () => {
  it("el Nº 01 cumple las reglas del generador (fuentes, licencias, enlaces oficiales, breves con fecha)", () => {
    expect(validateIssue(doc)).toEqual([]);
  });
  it("toda fuente tiene URL https, fecha de consulta y derechos de reutilización", () => {
    for (const s of doc.sources) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.consulted_at).toBe("2026-10-22");
      expect(s.reuse_rights.length).toBeGreaterThan(10);
      if (s.published_at) expect(s.published_at <= s.consulted_at).toBe(true);
    }
  });
  it("los breves (World Brief) traen hechos de los últimos 90 días, nunca historia presentada como nueva", () => {
    for (const a of doc.articles.filter((x: { format: string }) => x.format === "brief")) {
      const days = (Date.parse("2026-10-22") - Date.parse(a.fact_date)) / 864e5;
      expect(days, a.slug).toBeGreaterThanOrEqual(0);
      expect(days, a.slug).toBeLessThanOrEqual(90);
    }
  });
  it("sin fuentes, con enlace comercial falso, con imagen sin licencia o breve sin fecha: el generador se niega", () => {
    const bad = structuredClone(doc);
    bad.articles[1].sources = [];
    bad.articles[2].actions.push({ kind: "official_link", url: "https://ofertas-falsas.example.com/x", label: { es: "Reserva ya" } });
    bad.images[0].license = null;
    bad.articles.find((a: { format: string }) => a.format === "brief").fact_date = null;
    const errs = validateIssue(bad).join("\n");
    expect(errs).toMatch(/sin fuentes/);
    expect(errs).toMatch(/enlace oficial sin fuente/);
    expect(errs).toMatch(/falta license/);
    expect(errs).toMatch(/breve sin fecha/);
    expect(() => buildSeedSql(bad)).toThrow(/no cumple las reglas/);
  });
  it("la migración de siembra es exactamente la que produce el generador (sin ediciones a mano) y nace en revisión", () => {
    const sql = read("supabase/migrations/20261025100200_edition_seed_n01.sql");
    // La siembra YA está aplicada en producción: el archivo queda congelado (huella) y las correcciones
    // posteriores van en 20261025110000. El JSON = siembra + correcciones: si se deshacen las
    // correcciones, el generador vuelve a producir exactamente la siembra.
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    expect(createHash("sha256").update(sql).digest("hex")).toBe("2f5fedf1097d851131fbe257740b44f44cd523629a7f3a321c98ac932da5202d");
    const original = structuredClone(doc);
    original.articles.find((a: { slug: string }) => a.slug === "carta-del-editor-n01").byline = { es: "Dirección editorial de IATOS Privé · borrador pendiente de firma", en: "IATOS Privé editorial direction · draft pending signature" };
    original.sources.find((s: { key: string }) => s.key === "nobel_econ_2026").verification = "La página oficial respondió 403 al consultarla de forma automatizada; nombres y motivación corroborados con AAP (The Senior) y APA/Reuters del 12-oct-2026. El editor debe abrir el enlace oficial antes de aprobar.";
    const bx = original.articles.find((a: { slug: string }) => a.slug === "banxico-pausa-6-50");
    bx.sources = bx.sources.filter((x: { key: string }) => x.key !== "nobel_econ_2026");
    delete original._corrections;
    expect(sql).toBe(buildSeedSql(original, "data/prive/edition/issue-01.json"));
    const fix = read("supabase/migrations/20261025110000_edition2_status_correcciones.sql");
    expect(fix).toContain(doc.articles[0].byline.es);
    expect(fix).toContain(doc.sources.find((s: { key: string }) => s.key === "nobel_econ_2026").verification);
    expect(fix).toContain(doc.articles.find((a: { slug: string }) => a.slug === "banxico-pausa-6-50").sources.find((x: { key: string }) => x.key === "nobel_econ_2026").used_for);
    expect(sql).toMatch(/'pending_review'/);
    expect(sql).not.toMatch(/'published'/);
    expect(sql).not.toMatch(/license_status\)[\s\S]*?'approved'/);
  });
  it("las fotos ilustrativas lo dicen (qué representan y que no son el lugar/producto)", () => {
    for (const i of doc.images.filter((x: { illustrative: boolean }) => x.illustrative)) expect(i.depicts.es).toMatch(/\./);
    expect(doc.images.find((i: { key: string }) => i.key === "img_yate_mar").depicts.es).toMatch(/No es ninguno de los yates/);
  });
});

describe("imágenes con licencia", () => {
  const img = payload.images!.img_monaco_puerto;
  it("sin licencia aprobada no se usa; en vista previa del editor sí, marcada; nunca en PDF/offline", () => {
    expect(imageAllowed(img, "online")).toBe(true);
    expect(imageAllowed({ ...img, license_status: "pending" }, "online")).toBe(false);
    expect(imageAllowed({ ...img, license_status: "pending" }, "online", true)).toBe(true);
    expect(imageAllowed({ ...img, license_status: "pending" }, "pdf", true)).toBe(false);
    expect(imageAllowed({ ...img, license_status: "blocked" }, "online", true)).toBe(false);
    expect(imageAllowed({ ...img, license: undefined }, "online")).toBe(false);
    expect(imageAllowed({ ...img, url: "http://x/y.jpg" }, "online")).toBe(false);
    expect(imageAllowed({ ...img, allow_offline: false }, "offline")).toBe(false);
  });
  it("forma del servidor: con una licencia sin aprobar, la foto desaparece del cuerpo y del mapa", () => {
    const p = payloadFromDoc(doc, { approvedImages: ["img_monaco_puerto"] }) as IssuePayload;
    const monaco = p.articles!.find((a) => a.slug === "monaco-yacht-show-2026")!;
    expect(monaco.body!.some((b) => b.t === "img")).toBe(false);
    expect(Object.keys(p.images!)).toEqual(["img_monaco_puerto"]);
  });
});

describe("Privé Opportunities = PRIVÉ DROPS (§6)", () => {
  const base: Opportunity = {
    id: "1", slug: "x", type: "promocion_publica", status: "activo", title: { es: "Tarifa" }, provider: { name: "Hotel" }, benefit: { es: "Desayuno incluido" },
    source: { url: "https://hotel.example.com/promo" }, link: "https://hotel.example.com/promo", last_verified_at: "2026-10-20T00:00:00Z", valid_until: "2026-11-30",
  };
  it("promoción vencida, programada, retirada o sin fuente/enlace https: oculta", () => {
    expect(isOpportunityLive(base, "2026-10-22")).toBe(true);
    expect(isOpportunityLive({ ...base, valid_until: "2026-10-21" }, "2026-10-22")).toBe(false);
    expect(isOpportunityLive({ ...base, valid_from: "2026-11-01" }, "2026-10-22")).toBe(false);
    expect(isOpportunityLive({ ...base, status: "vencido" }, "2026-10-22")).toBe(false);
    expect(isOpportunityLive({ ...base, status: "retirado" }, "2026-10-22")).toBe(false);
    expect(isOpportunityLive({ ...base, source: { url: "http://x" } }, "2026-10-22")).toBe(false);
    expect(isOpportunityLive({ ...base, last_verified_at: "" }, "2026-10-22")).toBe(false);
    expect(liveOpportunities([base, { ...base, id: "2", valid_until: "2026-01-01" }], "2026-10-22")).toHaveLength(1);
  });
  it("si Drops aún no existe en la base, la lista es cero 'no disponible' (nunca inventada)", async () => {
    const content = vi.fn(async () => ({ ok: false as const, code: "NOT_AVAILABLE" as const }));
    const api = createEditionApi(content as never);
    await expect(api.opportunities()).resolves.toEqual({ available: false, items: [], expired_recent: 0, generated_at: null });
    expect(content).toHaveBeenCalledWith("prive_drops", expect.objectContaining({ _limit: 20 }));
  });
});

describe("autorización (cliente): FREE y sesión vencida", () => {
  it("un PRIVE_NOT_PRO del servidor manda al candado (no hay contenido en el cliente)", async () => {
    const api = createEditionApi((async () => ({ ok: false, code: "PRIVE_NOT_PRO" })) as never);
    await expect(api.issue()).rejects.toBeInstanceOf(PriveLockedError);
    const expired = createEditionApi((async () => ({ ok: false, code: "PRIVE_SESSION_EXPIRED" })) as never);
    await expect(expired.library()).rejects.toMatchObject({ code: "PRIVE_SESSION_EXPIRED" });
  });
  it("el bundle no trae el contenido del número (solo el servidor lo entrega)", () => {
    for (const f of ["src/lib/priveEdition.ts", "src/pages/prive/edition/LatestIssuePage.tsx", "src/pages/prive/edition/EditionAdminPage.tsx", "src/components/prive/edition/Magazine.tsx"]) {
      expect(read(f)).not.toMatch(/issue-01\.json|Port Hercule|Huniik/);
    }
  });
  it("las RPC de lectura se llaman prive_edition_* (el cliente Privé solo permite prive_*)", () => {
    const api = read("src/lib/priveEditionApi.ts");
    for (const m of api.matchAll(/c<[^>]+>\("([a-z_]+)"/g)) expect(m[1]).toMatch(/^prive_edition_/);
  });
});

describe("From Page to Experience (§10)", () => {
  const routes = read("src/App.tsx");
  it("cada acción del Nº 01 lleva a una ruta existente de la app o a un enlace oficial https", () => {
    for (const a of doc.articles) for (const act of a.actions) {
      const r = resolveAction(act, "es");
      expect(r, `${a.slug} ${act.kind}`).not.toBeNull();
      if (r!.kind === "external") expect(r!.href).toMatch(/^https:\/\//);
      else {
        const path = r!.to.split("?")[0];
        const ok = [/^\/prive\/destino\//, /^\/prive\/universo\//, /^\/dashboard\/concierge$/, /^\/dashboard\/planear$/, /^\/dashboard\/hoteles$/, /^\/dashboard\/restaurantes$/].some((re) => re.test(path));
        expect(ok, path).toBe(true);
      }
    }
    for (const p of ['path="/dashboard/concierge"', 'path="/dashboard/planear"', 'path="/dashboard/hoteles"', 'path="/dashboard/restaurantes"', 'path="destino/:slug"', 'path="universo/:key"']) expect(routes).toContain(p);
  });
  it("acciones desconocidas, universos inexistentes o enlaces no https se descartan (sin botones inventados)", () => {
    expect(resolveAction({ kind: "official_link", url: "http://inseguro.example.com", label: { es: "x" } }, "es")).toBeNull();
    expect(resolveAction({ kind: "explore_universe", target: "vip_lounge", label: { es: "x" } }, "es")).toBeNull();
    expect(resolveAction({ kind: "book_now" as never, label: { es: "Reserva" } }, "es")).toBeNull();
  });
  it("Pregúntale a Iato llega con el texto pre-escrito (no se envía solo)", () => {
    const r = resolveAction(doc.articles[1].actions.find((a: { kind: string }) => a.kind === "ask_iato"), "es")!;
    expect(r.kind === "internal" && r.state?.prefill).toMatch(/Gran Premio/);
    expect(read("src/pages/Concierge.tsx")).toMatch(/state\.prefill/);
  });
});

describe("Flight Edition (§9)", () => {
  it("con guía del destino, lo de ese destino entra primero; respeta el tiempo elegido", () => {
    const sel = selectFlightEdition(payload, { destination: "merida", interests: [], minutes: 6, includeGuide: true });
    expect(slugs(sel)).toContain("merida-guadalajara-mesa-mexicana");
    expect(sel.reduce((s, a) => s + a.reading_minutes, 0)).toBeLessThanOrEqual(8);
  });
  it("un viaje con texto libre se asocia al destino ('Ciudad de México, México' → cdmx)", () => {
    expect(matchDestination("Ciudad de México, México", payload.articles!)).toBe("cdmx");
    expect(matchDestination("Monte Carlo", payload.articles!)).toBe("mc");
    expect(matchDestination("Lima", payload.articles!)).toBeNull();
  });
});

// ───────────── Cache Storage simulado (la API real del navegador no existe en jsdom) ─────────────
class FakeCache {
  store = new Map<string, Response>();
  async match(k: string | Request) { const r = this.store.get(String(k)); return r ? r.clone() : undefined; }
  async put(k: string | Request, r: Response) { this.store.set(String(k), r.clone()); }
  async delete(k: string | Request) { return this.store.delete(String(k)); }
  async keys() { return [...this.store.keys()]; }
}
class FakeCaches {
  map = new Map<string, FakeCache>();
  async open(n: string) { if (!this.map.has(n)) this.map.set(n, new FakeCache()); return this.map.get(n)!; }
  async delete(n: string) { return this.map.delete(n); }
  async match(k: string, o?: { cacheName?: string }) { const c = o?.cacheName ? this.map.get(o.cacheName) : undefined; return c?.match(k); }
  async keys() { return [...this.map.keys()]; }
}

describe("lectura sin conexión (§9.B): guardar, leer sin red, cerrar sesión, volver la red", () => {
  let fc: FakeCaches;
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const okFetch = vi.fn(async () => new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } }));
  beforeEach(() => {
    fc = new FakeCaches();
    vi.stubGlobal("caches", fc);
    okFetch.mockClear();
  });
  const input = () => ({ id: "issue-n01-es", kind: "issue" as const, title: "Nº 01", lang: "es" as const, payload, articles: payload.articles! });

  it("guarda el número con TODAS sus imágenes y se lee sin red", async () => {
    const r = await saveOfflinePack("u-1", input(), okFetch as never);
    expect(r.ok).toBe(true);
    expect(r.images).toBe(Object.keys(packPayload(payload, payload.articles!).images!).length);
    expect(r.images).toBeGreaterThanOrEqual(10);
    expect(r.articles).toBe(16);
    expect(r.bytes).toBeGreaterThan(30_000);
    const offlineFetch = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    vi.stubGlobal("fetch", offlineFetch);
    const pack = await readOfflinePack("u-1", "issue-n01-es");
    expect(pack?.payload.articles?.length).toBe(16);
    expect(pack?.generated_at).toBeTruthy();
    const img = payload.images!.img_monaco_puerto.url;
    expect(await (await fc.open(EDITION_CACHE)).match(img)).toBeTruthy();
    expect(offlineFetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.stubGlobal("caches", fc);
  });
  it("si una imagen no se puede descargar, la copia NO se declara descargada y no queda nada a medias", async () => {
    let n = 0;
    const flaky = vi.fn(async () => (++n > 3 ? new Response("", { status: 503 }) : new Response(jpeg, { status: 200, headers: { "content-type": "image/jpeg" } })));
    const r = await saveOfflinePack("u-1", input(), flaky as never);
    expect(r.ok).toBe(false);
    expect(await listOfflinePacks("u-1")).toEqual([]);
    const c = await fc.open(EDITION_CACHE);
    expect((await c.keys()).length).toBe(0);
  });
  it("cada cuenta ve solo sus copias; al cerrar sesión se borra todo", async () => {
    await saveOfflinePack("u-1", input(), okFetch as never);
    expect(await listOfflinePacks("u-1")).toHaveLength(1);
    expect(await listOfflinePacks("u-2")).toEqual([]);
    expect(await readOfflinePack("u-2", "issue-n01-es")).toBeNull();
    await clearAllOfflineEditions();
    expect(await listOfflinePacks("u-1")).toEqual([]);
  });
  it("borrar una copia quita sus imágenes", async () => {
    await saveOfflinePack("u-1", input(), okFetch as never);
    await deleteOfflinePack("u-1", "issue-n01-es");
    const c = await fc.open(EDITION_CACHE);
    expect((await c.keys()).filter((k) => k.startsWith("https://"))).toEqual([]);
  });
  it("al volver la red: lo retirado sale de la copia y lo corregido se actualiza (con su licencia vigente)", () => {
    const fresh = structuredClone(payload);
    fresh.retracted = [{ slug: "brief-delta-aeromexico-tribunal", at: "2026-11-02", note: "x" }];
    fresh.articles = fresh.articles!.filter((a) => a.slug !== "brief-delta-aeromexico-tribunal");
    const pga = fresh.articles.find((a) => a.slug === "pga-tour-los-cabos-2026")!;
    pga.version = 2; pga.correction = { note: "Se precisó la fecha.", at: "2026-11-02" };
    delete fresh.images!.img_golf;
    const { next, updated, removed } = reconcilePack(payload, fresh);
    expect(removed).toEqual(["brief-delta-aeromexico-tribunal"]);
    expect(updated).toEqual(["pga-tour-los-cabos-2026"]);
    expect(next.articles!.find((a) => a.slug === "pga-tour-los-cabos-2026")!.correction?.note).toBe("Se precisó la fecha.");
    expect(next.images!.img_golf).toBeUndefined();
  });
  it("lee el usuario de la sesión guardada sin red (para abrir la copia en modo avión)", () => {
    const s = new Map<string, string>([["sb-abc-auth-token", JSON.stringify({ user: { id: "11111111-1111-4111-8111-111111111111" } })]]);
    const storage = { length: s.size, key: (i: number) => [...s.keys()][i], getItem: (k: string) => s.get(k) ?? null } as unknown as Storage;
    expect(storedUserId(storage)).toBe("11111111-1111-4111-8111-111111111111");
  });
  it("el Service Worker conserva la caché de la edición y la borra al cerrar sesión; AuthContext también", () => {
    const sw = read("public/sw.js");
    expect(sw).toMatch(/EDITION_CACHE = 'iatos-edition-v1'/);
    expect(sw).toMatch(/k !== EDITION_CACHE/);
    expect(sw).toMatch(/caches\.delete\(EDITION_CACHE\)/);
    expect(read("src/contexts/AuthContext.tsx")).toMatch(/caches\.delete\("iatos-edition-v1"\)/);
  });
});

describe("enlaces de fuentes (fuentes rotas)", () => {
  it("clasifica: 2xx/3xx ok, 404/410/5xx/sin respuesta rota, 401/403/429 bloqueada (revisión humana)", () => {
    expect(classify(200)).toBe("ok");
    expect(classify(301)).toBe("ok");
    expect(classify(404)).toBe("broken");
    expect(classify(500)).toBe("broken");
    expect(classify(null)).toBe("broken");
    expect(classify(403)).toBe("blocked");
    expect(classify(429)).toBe("blocked");
  });
  it("solo https públicos (sin IP ni localhost)", () => {
    expect(isCheckableUrl("https://www.banxico.org.mx/x")).toBe(true);
    expect(isCheckableUrl("http://www.banxico.org.mx/x")).toBe(false);
    expect(isCheckableUrl("https://127.0.0.1/x")).toBe(false);
    expect(isCheckableUrl("https://localhost/x")).toBe(false);
  });
  it("HEAD rechazado → GET; error de red → rota", async () => {
    const f = vi.fn().mockResolvedValueOnce({ status: 405 }).mockResolvedValueOnce({ status: 200 });
    await expect(checkLink("https://example.com/a", f)).resolves.toEqual({ status: "ok", http: 200 });
    const dead = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    await expect(checkLink("https://example.com/b", dead)).resolves.toEqual({ status: "broken", http: null });
  });
});

describe("rendimiento y costos", () => {
  it("jsPDF se carga solo al pedir el PDF (import dinámico); ninguna página lo importa estático", () => {
    expect(read("src/lib/priveEditionPdf.ts")).toMatch(/await import\("jspdf"\)/);
    expect(read("src/lib/priveEditionPdf.ts")).not.toMatch(/^import jsPDF/m);
    for (const f of ["FlightEditionPage", "LatestIssuePage", "ArticlePage", "LibraryPage", "EditionRoot"]) {
      expect(read(`src/pages/prive/edition/${f}.tsx`)).not.toMatch(/^import .*priveEditionPdf/m);
    }
    expect(read("src/pages/prive/edition/FlightEditionPage.tsx")).toMatch(/await import\("@\/lib\/priveEditionPdf"\)/);
  });
  it("las rutas de la edición son perezosas (no crecen el paquete inicial)", () => {
    const app = read("src/App.tsx");
    for (const p of ["EditionRoot", "LatestIssuePage", "FlightEditionPage", "EditionOfflinePage", "EditionAdminPage"]) expect(app).toMatch(new RegExp(`lazyWithRetry\\(\\(\\) => import\\("\\./pages/prive/edition/${p}"\\)\\)`));
  });
  it("personalizar no llama a la red ni a IA: es una función pura y rápida", () => {
    const t = performance.now();
    for (let i = 0; i < 1000; i++) personalizeIssue(payload, prefs({ edition_kind: "viajes", reading_minutes: 15 }));
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
