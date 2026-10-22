import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BenefitsBlock } from "@/components/boveda/BenefitsBlock";
import { buildSummaryPrompt, redactIdentifiers } from "@/lib/boveda/aiSummary";
import { buildAlerts, countryFromText, expiryStatus, type TripLite } from "@/lib/boveda/alerts";
import { ALLIANCE_TIERS, CATALOG, NO_BENEFITS_COPY, curatedBenefits, findProgramByName } from "@/lib/boveda/catalog";
import { cardLook } from "@/lib/boveda/cardStyle";
import { defaultTitle, formToInput, initialForm, itemToForm } from "@/lib/boveda/form";
import { cardDisplay, groupNumber, maskNumber } from "@/lib/boveda/mask";
import { filterAndSort } from "@/lib/boveda/organize";
import { KINDS_BY_SECTION, VAULT_SECTIONS, parseBenefitLines, validateItem, type VaultItem } from "@/lib/boveda/types";

const MIGRATION = readFileSync("supabase/migrations/20261023190000_boveda.sql", "utf8");
const TODAY = "2026-10-22";

let n = 0;
const item = (over: Partial<VaultItem>): VaultItem => ({
  id: `i${++n}`, user_id: "u", section: "documento", kind: "pasaporte", program_id: null, tier_id: null, title: "Pasaporte mexicano",
  issuer: null, tier: null, number: null, holder_name: null, country_code: null, visa_type: null, entries: null, valid_from: null,
  expires_on: null, contact_phone: null, benefits: [], benefits_unverified: false, notes: null,
  created_at: `2026-01-0${(n % 9) + 1}T00:00:00Z`, updated_at: "2026-01-01T00:00:00Z", ...over,
});
const trip = (over: Partial<TripLite>): TripLite => ({ id: `t${++n}`, destino: "Roma", pais_destino: null, fecha_salida: "2026-12-01", fecha_regreso: "2026-12-10", ...over });
const passport = (expires: string, country = "MX") => item({ kind: "pasaporte", section: "documento", country_code: country, expires_on: expires, number: "G12345678" });

describe("Bóveda · números enmascarados", () => {
  it("muestra solo los últimos 4 (••••1234) y oculta completos los cortos", () => {
    expect(maskNumber("G12345678")).toBe("••••5678");
    expect(maskNumber("AB 12 34 99")).toBe("••••3499");
    expect(maskNumber("123")).toBe("••••");
    expect(maskNumber("1234")).toBe("••••");
    expect(maskNumber("")).toBe("");
    expect(maskNumber(null)).toBe("");
    expect(maskNumber("G12345678")).not.toContain("1234");
  });
  it("tarjetas: solo los 4 guardados; agrupar para leer", () => {
    expect(cardDisplay("1005")).toBe("•••• 1005");
    expect(groupNumber("G12345678")).toBe("G123 4567 8");
  });
});

describe("Bóveda · catálogo curado (nunca inventa)", () => {
  it("ids válidos para la base y únicos", () => {
    const ids = CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of CATALOG) {
      expect(p.id).toMatch(/^[a-z0-9-]{1,60}$/);
      for (const t of p.tiers) expect(t.id, `${p.id}/${t.id}`).toMatch(/^[a-z0-9-]{1,60}$/);
      if (p.officialUrl) expect(p.officialUrl).toMatch(/^https:\/\//);
    }
  });

  it("todo beneficio curado trae fuente https y fecha de verificación", () => {
    let curatedCount = 0;
    for (const p of CATALOG) {
      for (const t of p.tiers) {
        const c = curatedBenefits(p.id, t.id);
        if (t.benefits?.length || t.alliance) {
          expect(c, `${p.id}/${t.id}`).not.toBeNull();
          expect(c!.sourceUrl).toMatch(/^https:\/\//);
          expect(c!.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(c!.benefits.length).toBeGreaterThan(0);
          curatedCount++;
        } else {
          expect(c, `${p.id}/${t.id} sin beneficios curados`).toBeNull();
        }
      }
    }
    expect(curatedCount).toBeGreaterThan(40);
    for (const a of Object.values(ALLIANCE_TIERS)) expect(a.sourceUrl).toMatch(/^https:\/\/www\.(staralliance|oneworld|skyteam)\.com\//);
  });

  it("devuelve null (no rellena) para programas, niveles o tarjetas sin curar", () => {
    expect(curatedBenefits("inventado", "gold")).toBeNull();
    expect(curatedBenefits("marriott-bonvoy", null)).toBeNull();
    expect(curatedBenefits("marriott-bonvoy", "member")).toBeNull();
    expect(curatedBenefits("marriott-bonvoy", "nivel-inexistente")).toBeNull();
    expect(curatedBenefits("bbva-mx", "titular")).toBeNull();
    expect(curatedBenefits("volaris", "x")).toBeNull();
    expect(curatedBenefits(null, null)).toBeNull();
  });

  it("aerolíneas: muestra los de la alianza del nivel", () => {
    expect(curatedBenefits("united-mileageplus", "premier-gold")?.scopeLabel).toBe("Beneficios de Star Alliance Gold");
    expect(curatedBenefits("aa-aadvantage", "executive-platinum")?.scopeLabel).toBe("Beneficios de oneworld Emerald");
    expect(curatedBenefits("aeromexico-rewards", "skyteam-elite-plus")?.scopeLabel).toBe("Beneficios de SkyTeam Elite Plus");
  });

  it("encuentra programas por nombre o alias", () => {
    expect(findProgramByName("Club Premier")?.id).toBe("aeromexico-rewards");
    expect(findProgramByName("marriott")?.id).toBe("marriott-bonvoy");
    expect(findProgramByName("xy")).toBeNull();
  });

  it("sin beneficios curados ni propios: «Agrega tus beneficios o consulta la fuente» con el sitio oficial", () => {
    render(<BenefitsBlock item={{ program_id: "bbva-mx", tier_id: null, benefits: [], benefits_unverified: false }} />);
    expect(screen.getByTestId("no-benefits")).toHaveTextContent(NO_BENEFITS_COPY);
    expect(screen.getByRole("link", { name: /bbva\.mx/ })).toHaveAttribute("href", "https://www.bbva.mx/");
  });

  it("con curados: lista, fuente y «verificado el»; los propios aparte", () => {
    render(<BenefitsBlock item={{ program_id: "hilton-honors", tier_id: "diamond", benefits: ["Upgrade a suite en mi hotel favorito"], benefits_unverified: false }} />);
    expect(screen.getByTestId("curated-benefits")).toHaveTextContent("100% de puntos extra");
    expect(screen.getByTestId("curated-benefits")).toHaveTextContent(/verificado el/);
    expect(screen.getByTestId("own-benefits")).toHaveTextContent("Upgrade a suite");
  });
});

describe("Bóveda · alertas de vigencia y requisitos", () => {
  it("pasaporte que vence antes de regresar: crítica", () => {
    const a = buildAlerts([passport("2026-12-05")], [trip({ destino: "Roma, Italia" })], TODAY);
    expect(a.find((x) => x.id.startsWith("pp-exp"))?.level).toBe("critica");
  });

  it("pasaporte con menos de 6 meses al regresar: aviso con fuente SRE", () => {
    const a = buildAlerts([passport("2027-04-01")], [trip({ destino: "París" })], TODAY);
    const pp = a.find((x) => x.id.startsWith("pp-6m"));
    expect(pp?.level).toBe("aviso");
    expect(pp?.sourceUrl).toMatch(/sre\.gob\.mx/);
    expect(buildAlerts([passport("2027-07-01")], [trip({ destino: "París" })], TODAY).some((x) => x.id.startsWith("pp-"))).toBe(false);
  });

  it("un mismo problema del pasaporte en varios viajes es UNA alerta con todos los destinos", () => {
    const a = buildAlerts([passport("2027-03-10")], [trip({ destino: "Nueva York" }), trip({ destino: "Londres", fecha_salida: "2027-01-08", fecha_regreso: "2027-01-16" })], TODAY);
    const pp = a.filter((x) => x.id.startsWith("pp-"));
    expect(pp).toHaveLength(1);
    expect(pp[0].title).toBe("Pasaporte con menos de 6 meses de vigencia para Nueva York y Londres");
  });

  it("EUA con pasaporte mexicano y sin visa: crítica con travel.state.gov; con visa vigente no", () => {
    const t = trip({ destino: "Nueva York" });
    const none = buildAlerts([passport("2030-01-01")], [t], TODAY).find((x) => x.id === `entry-${t.id}`);
    expect(none?.level).toBe("critica");
    expect(none?.sourceUrl).toContain("travel.state.gov");
    const visa = item({ kind: "visa", country_code: "US", expires_on: "2031-01-01", title: "Visa EUA" });
    expect(buildAlerts([passport("2030-01-01"), visa], [t], TODAY).some((x) => x.id === `entry-${t.id}`)).toBe(false);
  });

  it("visa guardada que vence antes del viaje: crítica", () => {
    const t = trip({ destino: "Miami", fecha_salida: "2026-12-01", fecha_regreso: "2026-12-10" });
    const visa = item({ kind: "visa", country_code: "US", expires_on: "2026-12-03", title: "Visa EUA" });
    const a = buildAlerts([passport("2030-01-01"), visa], [t], TODAY);
    expect(a.find((x) => x.id.startsWith(`visa-exp-${visa.id}`))?.level).toBe("critica");
  });

  it("Canadá: eTA guardada cubre; sin ella, aviso con canada.ca", () => {
    const t = trip({ destino: "Toronto" });
    expect(buildAlerts([passport("2030-01-01")], [t], TODAY).find((x) => x.id === `entry-${t.id}`)?.sourceUrl).toContain("canada.ca");
    const eta = item({ kind: "autorizacion", country_code: "CA", expires_on: "2030-01-01", title: "eTA Canadá" });
    expect(buildAlerts([passport("2030-01-01"), eta], [t], TODAY).some((x) => x.id === `entry-${t.id}`)).toBe(false);
  });

  it("viaje nacional: sin alertas de pasaporte ni visa", () => {
    const a = buildAlerts([passport("2026-11-01")], [trip({ destino: "Puebla" })], TODAY);
    expect(a.filter((x) => x.tripId)).toEqual([]);
  });

  it("destino sin regla revisada: genérico «verifica requisitos» con la Guía del Viajero", () => {
    const t = trip({ destino: "Marrakech" });
    const a = buildAlerts([passport("2030-01-01")], [t], TODAY).find((x) => x.id === `entry-${t.id}`);
    expect(a?.title).toMatch(/Verifica requisitos/);
    expect(a?.sourceUrl).toBe("https://guiadelviajero.sre.gob.mx/");
  });

  it("pasaporte no mexicano: nunca aplica reglas de pasaporte mexicano", () => {
    const t = trip({ destino: "Nueva York" });
    const a = buildAlerts([passport("2030-01-01", "ES")], [t], TODAY).find((x) => x.id === `entry-${t.id}`);
    expect(a?.level).toBe("info");
    expect(a?.title).toMatch(/Verifica requisitos/);
  });

  it("sin pasaporte guardado: pide agregarlo; viajes pasados o cancelados no cuentan", () => {
    expect(buildAlerts([], [trip({ destino: "Madrid" })], TODAY).some((x) => x.id.startsWith("pp-none"))).toBe(true);
    expect(buildAlerts([], [trip({ destino: "Madrid", fecha_salida: "2026-01-01", fecha_regreso: "2026-01-05" })], TODAY)).toEqual([]);
    expect(buildAlerts([], [trip({ destino: "Madrid", status: "cancelado" })], TODAY)).toEqual([]);
  });

  it("seguro de viaje que no cubre el viaje y vigencias vencidas o próximas", () => {
    const ins = item({ section: "seguro", kind: "seguro_viaje", title: "AXA viaje", expires_on: "2026-12-05" });
    const a = buildAlerts([passport("2030-01-01"), ins], [trip({ destino: "Roma" })], TODAY);
    expect(a.some((x) => x.id.startsWith("ins-"))).toBe(true);
    const old = item({ section: "membresia", kind: "viajero_confiable", title: "Global Entry", expires_on: "2026-10-01" });
    const soon = item({ section: "membresia", kind: "sala", title: "Priority Pass", expires_on: "2026-11-15" });
    const b = buildAlerts([old, soon], [], TODAY);
    expect(b.find((x) => x.itemId === old.id)?.title).toMatch(/venció/);
    expect(b.find((x) => x.itemId === soon.id)?.title).toMatch(/vence en 24 días/);
  });

  it("reconoce países y ciudades; estados de vigencia", () => {
    expect(countryFromText("Roma, Italia")).toBe("IT");
    expect(countryFromText("Nueva York")).toBe("US");
    expect(countryFromText("Los Cabos")).toBe("MX");
    expect(countryFromText("Ciudad inventada")).toBeNull();
    expect(expiryStatus("2026-10-21", TODAY).state).toBe("vencido");
    expect(expiryStatus("2026-12-01", TODAY).state).toBe("pronto");
    expect(expiryStatus("2028-01-01", TODAY).state).toBe("vigente");
    expect(expiryStatus("2026-02-31", TODAY).state).toBe("sin_fecha");
  });
});

describe("Bóveda · formulario y reglas de tarjetas", () => {
  it("una tarjeta nunca guarda número completo ni vencimiento", () => {
    const f = { ...initialForm("tarjeta"), title: "Platinum", number: "4111 1111 1111 1005", expires_on: "2030-01-01", valid_from: "2025-01-01" };
    const input = formToInput("tarjeta", f);
    expect(input.number).toBe("1005");
    expect(input.expires_on).toBeNull();
    expect(input.valid_from).toBeNull();
    expect(validateItem(input)).toBeNull();
    expect(validateItem({ ...input, number: "411111111111" })).toMatch(/últimos 4/);
    expect(validateItem({ ...input, expires_on: "2030-01-01" })).toMatch(/vencimiento/);
  });

  it("igual que los CHECK de la base: tarjeta solo 4 dígitos y sin vencimiento", () => {
    expect(MIGRATION).toContain("number ~ '^[0-9]{4}$'");
    expect(MIGRATION).toMatch(/section <> 'tarjeta' OR \(expires_on IS NULL AND valid_from IS NULL\)/);
    for (const s of VAULT_SECTIONS) for (const k of KINDS_BY_SECTION[s]) expect(MIGRATION, k).toContain(`'${k}'`);
  });

  it("títulos por defecto, limpieza y validaciones", () => {
    expect(defaultTitle("pasaporte", { program_id: "", country_code: "MX" })).toBe("Pasaporte mexicano");
    expect(defaultTitle("visa", { program_id: "", country_code: "US" })).toBe("Visa EUA");
    expect(defaultTitle("autorizacion", { program_id: "", country_code: "GB" })).toBe("ETA Reino Unido");
    expect(defaultTitle("hotel", { program_id: "marriott-bonvoy", country_code: "" })).toBe("Marriott Bonvoy");
    const p = formToInput("pasaporte", { ...initialForm("pasaporte"), number: " g1234 5678 " });
    expect(p).toMatchObject({ title: "Pasaporte mexicano", number: "G1234 5678", country_code: "MX", section: "documento" });
    expect(validateItem({ ...p, number: "<script>" })).toMatch(/solo puede llevar/);
    expect(validateItem({ ...p, valid_from: "2030-01-01", expires_on: "2029-01-01" })).toMatch(/posterior/);
    expect(parseBenefitLines("• Sala VIP\n\n- Upgrade \n* Desayuno")).toEqual(["Sala VIP", "Upgrade", "Desayuno"]);
    const back = itemToForm(item({ benefits: ["a", "b"], expires_on: "2030-01-01" }));
    expect(back.benefitsText).toBe("a\nb");
    expect(back.expires_on).toBe("2030-01-01");
  });

  it("buscar no usa números; ordenar por vencimiento deja sin fecha al final", () => {
    const a = item({ title: "Visa EUA", expires_on: "2030-01-01", number: "SECRETO1" });
    const b = item({ title: "INE", kind: "ine", expires_on: null });
    const c = item({ title: "Pasaporte", expires_on: "2027-01-01" });
    expect(filterAndSort([a, b, c], "", "vence").map((i) => i.title)).toEqual(["Pasaporte", "Visa EUA", "INE"]);
    expect(filterAndSort([a, b, c], "SECRETO1", "vence")).toEqual([]);
    expect(filterAndSort([a, b, c], "visa", "nombre").map((i) => i.title)).toEqual(["Visa EUA"]);
  });

  it("acabado tipo cartera según nivel y documento", () => {
    expect(cardLook(item({ kind: "pasaporte" })).finish).toBe("passport");
    expect(cardLook(item({ section: "tarjeta", kind: "tarjeta", title: "Centurion" })).finish).toBe("obsidian");
    expect(cardLook(item({ section: "tarjeta", kind: "tarjeta", title: "The Platinum Card" })).finish).toBe("platinum");
    expect(cardLook(item({ section: "membresia", kind: "hotel", title: "Marriott", tier: "Gold Elite" })).finish).toBe("gold");
    expect(cardLook(item({ section: "membresia", kind: "aerolinea", title: "United", tier: "Premier 1K" })).finish).toBe("diamond");
  });
});

describe("Bóveda · «Iato, resúmeme» sin documentos ni números", () => {
  const vault = [
    passport("2030-01-01"),
    item({ kind: "visa", country_code: "US", number: "V9988776", title: "Visa EUA", holder_name: "Ana Prueba" }),
    item({ section: "membresia", kind: "hotel", title: "Marriott Bonvoy", program_id: "marriott-bonvoy", tier_id: "platinum", tier: "Platinum Elite",
      number: "MB123456789", holder_name: "Ana Prueba", notes: "PIN 4455 cuenta MB123456789" }),
    item({ section: "tarjeta", kind: "tarjeta", title: "The Platinum Card", number: "1005", tier: "Platino", benefits: ["Seguro de renta de auto"] }),
    item({ section: "seguro", kind: "seguro_viaje", title: "Póliza AXA", number: "POL-778899", contact_phone: "+52 55 1111 2222", benefits: ["Gastos médicos ref ABC123456"] }),
  ];
  const { prompt, system, lines } = buildSummaryPrompt(vault, trip({ destino: "Madrid" }));

  it("solo programas, niveles y beneficios; ningún documento, número, titular, teléfono ni nota", () => {
    expect(lines).toHaveLength(3);
    for (const secret of ["G12345678", "V9988776", "Visa EUA", "Pasaporte", "MB123456789", "1005", "POL-778899", "Ana Prueba", "1111 2222", "PIN", "ABC123456"]) {
      expect(prompt, secret).not.toContain(secret);
      expect(system).not.toContain(secret);
    }
    expect(prompt).toContain("Marriott Bonvoy (Platinum Elite)");
    expect(prompt).toContain("50% de puntos extra");
    expect(prompt).toContain("Seguro de renta de auto");
    expect(prompt).toContain("Madrid");
    expect(system).toMatch(/Usa SOLO los beneficios listados/);
  });

  it("redacta identificadores con dígitos", () => {
    expect(redactIdentifiers("socio AM12345678 nivel Gold")).toBe("socio [omitido] nivel Gold");
    expect(redactIdentifiers("2x1 en boletos")).toBe("2x1 en boletos");
  });
});
