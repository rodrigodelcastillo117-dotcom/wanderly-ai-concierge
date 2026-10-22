// Cargador de la curaduría de IATOS Privé (scripts/prive/curation-lib.mjs): validación estricta,
// estados honestos, temporada, enlaces de juego y normalización de destinos (lista exacta del dueño).
import { describe, expect, it } from "vitest";
// @ts-expect-error módulo .mjs sin tipos (script de Node)
import { dedupeKey, mapBatch, mapEntry, parseSeason, resolveCity, summarize } from "../../scripts/prive/curation-lib.mjs";
// @ts-expect-error módulo .mjs sin tipos (script de Node)
import { aliasMap, allDestinations, OWNER_ORDER, priveNorm } from "../../scripts/prive/destinations.mjs";

const TODAY = "2026-10-22";
const base = {
  city_key: "paris", city_display: "París", country: "Francia", category_group: "the_table", universe: "the_table",
  subcategory: "alta_cocina", name: "Lugar de Prueba", neighborhood: "7e", address: "1 Rue Test", lat: 48.85, lng: 2.35,
  website: "https://example.test/", booking_url: null, booking_method: "web", price_level: 4, price_note: "Menú degustación",
  dress_code: null, age_policy: "todas las edades", why_fact: "Restaurante del chef X con dos estrellas según su web.",
  accolades: [{ name: "Guía MICHELIN – 2 estrellas", year: 2026, url: "https://guide.michelin.com/x" }],
  sources: ["https://example.test/"], status: "verificado", verified_at: TODAY, notes: "", replaces_existing_name: null,
  image_query: "Paris fine dining",
};
const map = (over: Record<string, unknown>) => mapEntry({ ...base, ...over }, { today: TODAY, file: "content_g2.json" });

describe("estados", () => {
  it("verificado entra como CURADO (no VERIFICADO: falta el muestreo humano) con etiqueta EXPERIENCIA CURADA", () => {
    const r = map({});
    expect(r.ok).toBe(true);
    expect(r.row.data_state).toBe("CURADO");
    expect(r.row.verified_at).toBe(TODAY);
    expect(r.row.commercial_label).toBe("EXPERIENCIA_CURADA");
    expect(r.row.operating_status).toBe("abierto");
  });
  it("no_confirmado entra PENDIENTE y oculto, aunque traiga premios", () => {
    const r = map({ status: "no_confirmado" });
    expect(r.row.data_state).toBe("PENDIENTE");
    expect(r.row.verified_at).toBeNull();
    expect(r.row.commercial_label).toBe("NINGUNA");
  });
  it("el cargador nunca asigna PARTNER VERIFICADO ni BENEFICIO EXCLUSIVO", () => {
    const rows = [map({}), map({ notes: "oferta de socio", booking_url: "https://www.clickandboat.com/x" })].map((r) => r.row.commercial_label);
    expect(rows.every((l) => l === "EXPERIENCIA_CURADA" || l === "NINGUNA")).toBe(true);
  });
  it("marketplace (Click&Boat / oferta de socio) = canal externo partner_ota", () => {
    const r = map({ universe: "yacht_sea", booking_url: "https://www.clickandboat.com/es/x", notes: "Oferta de socio en Click&Boat" });
    expect(r.row.booking_method).toBe("partner_ota");
    expect(r.warnings.join(" ")).toMatch(/nunca PARTNER VERIFICADO/);
  });
});

describe("validación estricta", () => {
  it("rechaza un premio sin URL o sin año", () => {
    expect(map({ accolades: [{ name: "50 Best", year: 2025 }] }).ok).toBe(false);
    expect(map({ accolades: [{ name: "50 Best", url: "https://x.test" }] }).ok).toBe(false);
  });
  it("rechaza fuentes sin https, universo inválido y destino fuera del catálogo", () => {
    expect(map({ sources: ["http://x.test"] }).ok).toBe(false);
    expect(map({ universe: "nightlife" }).ok).toBe(false);
    const r = map({ city_key: "atlantis", city_display: "Atlantis" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/no está en el catálogo/);
  });
  it("rechaza lenguaje prohibido sin contrato (acceso garantizado, socio IATOS)", () => {
    expect(map({ why_fact: "Acceso garantizado a la mejor mesa." }).ok).toBe(false);
    expect(map({ why_fact: "Socio IATOS desde 2025." }).ok).toBe(false);
  });
  it("un enlace que no es https se omite (no se publica ni se 'arregla')", () => {
    const r = map({ booking_url: "http://donjulio.meitre.com/" });
    expect(r.ok).toBe(true);
    expect(r.row.booking_url).toBeNull();
  });
  it("price_level fuera de 1–4 y fechas futuras se rechazan", () => {
    expect(map({ price_level: 5 }).ok).toBe(false);
    expect(map({ verified_at: "2027-01-01" }).ok).toBe(false);
  });
  it("la nota de precio nunca se convierte en una cifra", () => {
    const r = map({ price_note: "Menú 480 € por persona" });
    expect(r.row.price_min).toBeNull();
    expect(r.row.price_source_url).toBeNull();
  });
  it("la imagen del curador (Wikimedia/Google) se ignora: se usa image_query de Pexels", () => {
    const r = map({ image: { url: "https://upload.wikimedia.org/x.jpg", source: "wikimedia" } });
    expect(JSON.stringify(r.row)).not.toMatch(/wikimedia/);
    expect(r.row.image_query).toBe("Paris fine dining");
  });
});

describe("sitios con apuestas o dominio secuestrado", () => {
  it("quita el enlace y deja la fila PENDIENTE (Helisight, Río)", () => {
    const r = map({ city_key: "rio_de_janeiro", city_display: "Río de Janeiro", name: "Helisight – vuelos panorámicos", universe: "adventure_elite",
      website: "https://helisight.com.br/", sources: ["https://helisight.com.br/", "https://riotur.test/heli"],
      notes: "El HTML del sitio contiene enlaces ajenos de apuestas: verificar la reserva directamente con el operador." });
    expect(r.ok).toBe(true);
    expect(r.row.website).toBeNull();
    expect(r.row.data_state).toBe("PENDIENTE");
    expect(r.row.sources).toEqual(["https://riotur.test/heli"]);
  });
  it("dominio secuestrado nombrado en las notas tampoco queda como fuente", () => {
    const r = map({ city_key: "cartagena", name: "Castillo San Felipe de Barajas", universe: "culture_access", website: null,
      sources: ["https://fortificacionesdecartagena.com/", "https://es.wikipedia.org/wiki/Castillo"],
      notes: "El dominio fortificacionesdecartagena.com está hoy secuestrado por spam de apuestas: no enlazar." });
    expect(r.row.sources).toEqual(["https://es.wikipedia.org/wiki/Castillo"]);
    expect(r.row.website).toBeNull();
    expect(JSON.stringify([r.row.website, r.row.booking_url, r.row.sources])).not.toMatch(/fortificacionesdecartagena/);
  });
  it('el sitio oficial se conserva si el dominio con apuestas es OTRO ("el antiguo dominio x.com redirige a apuestas")', () => {
    const r = map({ website: "https://www.nationalpolocenter.com/", sources: ["https://www.nationalpolocenter.com/"],
      notes: "El antiguo dominio internationalpoloclub.com no es fiable (redirige a un sitio de apuestas)." });
    expect(r.row.website).toBe("https://www.nationalpolocenter.com/");
    expect(r.row.data_state).toBe("CURADO");
  });
  it('"sin apuestas" en las notas de un casino no se confunde con un sitio contaminado', () => {
    const r = map({ notes: "Solo información práctica: sin enlaces de apuestas, depósitos ni bonos." });
    expect(r.row.website).toBe("https://example.test/");
    expect(r.warnings.join(" ")).not.toMatch(/apuestas\/secuestrado/);
  });
});

describe("reglas de universo y edad", () => {
  it("casino sin autoridad de licencia con fuente: PENDIENTE (la base no lo publicaría)", () => {
    const r = map({ city_key: "monaco", universe: "casino_grand_nights", name: "Casino de Monte-Carlo", age_policy: "18+ (salas de juego)" });
    expect(r.row.data_state).toBe("PENDIENTE");
    expect(r.row.age_policy).toBe("18+");
  });
  it("casino con autoridad y fuente sí queda CURADO", () => {
    const r = map({ city_key: "las vegas", universe: "casino_grand_nights", name: "Casino Test", age_policy: "21+",
      license_authority: "Nevada Gaming Control Board", license_source: "https://gaming.nv.gov/x" });
    expect(r.row.data_state).toBe("CURADO");
    expect(r.row.age_policy).toBe("21+");
  });
  it("aventura sin operador ni seguridad: PENDIENTE", () => {
    expect(map({ universe: "adventure_elite" }).row.data_state).toBe("PENDIENTE");
  });
  it("vida nocturna nunca queda para todas las edades; mínimos distintos se guardan como nota", () => {
    expect(map({ universe: "after_dark", age_policy: "todas las edades" }).row.age_policy).toBe("18+");
    const r = map({ age_policy: "desde 4 años" });
    expect(r.row.age_policy).toBe("todas");
    expect(r.row.restrictions_es).toMatch(/desde 4 años/);
  });
  it('"solo huéspedes" se dice y no implica acceso garantizado', () => {
    const r = map({ notes: "Reservas solo para huéspedes del hotel." });
    expect(r.row.restrictions_es).toMatch(/no garantiza acceso/);
  });
});

describe("temporada", () => {
  it('"Open for the season until 25 October" (2026) → cierra el 25-oct-2026, ya cerrado después', () => {
    const s = parseSeason("TEMPORADA: la web oficial indica 'Open for the season until 25 October' (2026).", "2026-10-26");
    expect(s.closes_on).toBe("2026-10-25");
    expect(s.closed_now).toBe(true);
  });
  it('"reabre el 6 de mayo de 2027" → cerrado ahora, con fecha', () => {
    const s = parseSeason("Cerrado en invierno; reabre el 6 de mayo de 2027.", TODAY);
    expect(s.reopens_on).toBe("2027-05-06");
    expect(s.closed_now).toBe(true);
  });
  it('"de abril a septiembre" → meses 4–9', () => {
    const s = parseSeason("Temporada regular de MLB de abril a septiembre.", TODAY);
    expect(s.months).toEqual([4, 5, 6, 7, 8, 9]);
    expect(s.closed_now).toBe(true);
  });
  it('"until next spring" → cerrado por temporada sin fecha, con nota de la fuente', () => {
    const r = map({ city_key: "ibiza", name: "Experimental Beach Ibiza", universe: "wellness_escape", subcategory: "beach_club",
      notes: "TEMPORADA: la web muestra 'Experimental Beach Ibiza, until next spring' – cerrado ahora (oct 2026) hasta primavera." });
    expect(r.row.operating_status).toBe("cerrado_temporal");
    expect(r.row.season_note_es).toMatch(/next spring/);
    expect(r.row.season_source).toBe("https://example.test/");
  });
  it("cierres semanales no son temporada", () => {
    expect(parseSeason("Cerrado los domingos.", TODAY)).toBeNull();
  });
});

describe("destinos: lista exacta del dueño y normalización", () => {
  it("111 destinos (110 de la lista + Mascate como primera localidad de Omán), sin alias duplicados", () => {
    const dests = allDestinations().filter((d: any) => d.dest);
    expect(dests.length).toBe(111);
    expect(OWNER_ORDER.length).toBe(111);
    expect(() => aliasMap()).not.toThrow();
  });
  it("Montecarlo es barrio de Mónaco; Polanco y Roma-Condesa de la CDMX; Punta Mita en Riviera Nayarit", () => {
    const by = new Map(allDestinations().map((d: any) => [d.slug, d]));
    expect(by.get("monaco-monte-carlo")).toMatchObject({ kind: "neighborhood", parent: "mc" });
    expect(by.get("cdmx-polanco")).toMatchObject({ kind: "neighborhood", parent: "cdmx" });
    expect(by.get("cdmx-roma-condesa")).toMatchObject({ kind: "neighborhood", parent: "cdmx" });
    expect(by.get("punta-mita")).toMatchObject({ parent: "riviera-nayarit" });
    expect(by.get("san-jose-del-cabo")).toMatchObject({ parent: "los-cabos" });
    expect(by.get("area-miami").members).toEqual(["miami", "miami-beach"]);
    expect(by.get("area-los-angeles").members).toEqual(["los-angeles", "beverly-hills", "malibu"]);
    expect(by.get("area-cdmx").members).toContain("interlomas");
    expect(by.get("mascate")).toMatchObject({ parent: "om" });
    expect(by.get("tulum").slug).not.toBe(by.get("riviera-maya").slug);
  });
  it("resuelve formas de ola 1 y ola 2 (snake, kebab, texto, barrio con parent_destination)", () => {
    expect(resolveCity({ city_key: "los_angeles" })).toEqual({ destination: "los-angeles", neighborhood: null });
    expect(resolveCity({ city_key: "st-moritz" })?.destination).toBe("st-moritz");
    expect(resolveCity({ city_key: "san-jose-del-cabo", locality_type: "city", parent_destination: "Los Cabos" })?.destination).toBe("san-jose-del-cabo");
    expect(resolveCity({ city_key: "polanco", locality_type: "neighborhood", parent_destination: "Ciudad de México" }))
      .toEqual({ destination: "cdmx", neighborhood: "cdmx-polanco" });
    expect(resolveCity({ city_key: "monaco", neighborhood: "Monte-Carlo" })).toEqual({ destination: "mc", neighborhood: "monaco-monte-carlo" });
    expect(resolveCity({ city_key: "ciudad de mexico", neighborhood: "Roma Norte" })?.neighborhood).toBe("cdmx-roma-condesa");
  });
  it("localidad precisa por la dirección: Punta de Mita → Punta Mita; 'Puerto Vallarta, Jal.' → Puerto Vallarta (Jalisco); Mascate en Omán", () => {
    expect(resolveCity({ city_key: "riviera-nayarit", neighborhood: "Punta de Mita", address: "Carretera 200 Km 19, Punta de Mita, Nay." })?.destination).toBe("punta-mita");
    expect(resolveCity({ city_key: "riviera-nayarit", neighborhood: "Zona Romántica, Puerto Vallarta", address: "Olas Altas 508, Puerto Vallarta, Jal." })?.destination).toBe("puerto-vallarta");
    expect(resolveCity({ city_key: "riviera-nayarit", address: "Riviera Nayarit, Lo de Marcos, Nay. 63724" })?.destination).toBe("riviera-nayarit");
    expect(resolveCity({ city_key: "oman", neighborhood: "Mascate – Al Ghubra" })?.destination).toBe("mascate");
    expect(resolveCity({ city_key: "oman", neighborhood: "Península de Musandam (Dibba)" })?.destination).toBe("om");
    // Sin coordenadas ni otro estado, un lugar de los Hamptons no se muda a la ciudad de Nueva York.
    expect(resolveCity({ city_key: "hamptons", address: "Southampton, New York 11968" })?.destination).toBe("hamptons");
  });
  it("normalizador y llave de duplicado iguales a los de SQL", () => {
    expect(priveNorm("Mónaco & Saint-Tropez — ÇÃO")).toBe("monaco and saint tropez cao");
    expect(dedupeKey("Fifty Mils - Four Seasons")).toBe("fifty mils");
    expect(dedupeKey("Please Don't Tell (PDT)")).toBe("please don t tell");
    expect(dedupeKey("The Bar")).toBe("the bar");
    expect(dedupeKey("Le Bar Américain")).toBe("americain");
  });
});

describe("lote", () => {
  it("acepta cualquier subconjunto y rechaza duplicados del mismo destino", () => {
    const out = mapBatch([{ ...base }, { ...base, name: "Lugar de Prueba - Hotel X" }, { ...base, name: "Otro", website: "https://example.test/otro" }], { today: TODAY });
    expect(out.accepted.length).toBe(2);
    expect(out.rejected[0].errors[0]).toMatch(/duplicado/);
    expect(out.warnings.some((w: any) => /mismo dominio/.test(w.warning))).toBe(true);
    const sum = summarize(out);
    expect(sum.paris.coverage_after_load).toBe("COBERTURA_PARCIAL");
  });
  it("duplicados en la misma jerarquía de destinos: se queda el más específico (Pujol CDMX/Polanco; Los Cabos/San José del Cabo)", () => {
    const out = mapBatch([
      { ...base, city_key: "ciudad de mexico", name: "Pujol", neighborhood: "", _file: "content_g1.json" },
      { ...base, city_key: "polanco", locality_type: "neighborhood", parent_destination: "Ciudad de México", name: "Pujol", _file: "content_g11.json" },
      { ...base, city_key: "los-cabos", name: "Cocina de Autor", _file: "content_g4.json" },
      { ...base, city_key: "san-jose-del-cabo", name: "Cocina de Autor", _file: "content_g11.json" },
      { ...base, city_key: "los-cabos", name: "Sólo No Confirmado", status: "no_confirmado", _file: "content_g4.json" },
      { ...base, city_key: "los-cabos", name: "Sólo No Confirmado", _file: "content_g11.json" },
    ], { today: TODAY });
    expect(out.accepted.map((r: any) => [r.name, r.destination_slug, r.neighborhood_slug])).toEqual([
      ["Pujol", "cdmx", "cdmx-polanco"], ["Cocina de Autor", "san-jose-del-cabo", null], ["Sólo No Confirmado", "los-cabos", null],
    ]);
    expect(out.accepted[2].data_state).toBe("CURADO"); // gana el verificado
    expect(out.rejected).toHaveLength(3);
    expect(out.rejected.every((r: any) => /misma jerarquía/.test(r.errors[0]))).toBe(true);
  });
  it("un lote vacío no falla", () => {
    expect(mapBatch([], { today: TODAY })).toEqual({ accepted: [], rejected: [], warnings: [] });
  });
});
