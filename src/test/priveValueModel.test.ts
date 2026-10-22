// privevalor · reglas puras: vigencia y vencimiento de Drops, ningún porcentaje sin comparación verificable,
// estados del Privilege Radar, separación del valor (comprobado ≠ estimado ≠ potencial ≠ sin ahorro, sin
// mezclar monedas), Before You Go y privacidad del Passport.
import { describe, expect, it } from "vitest";
import {
  beforeYouGoIsNear, displayPrice, effectiveDropStatus, groupByCategory, hasUnverifiablePercent, isFoundingMember, localToday,
  nextRadarStates, passportEntryError, radarTransitionError, splitValue, tenureParts, topFive, valueEntryError, verifiableDiscount,
  visibleDrops, type InsiderTip, type PriveDrop, type ValueEntry,
} from "@/lib/priveValueModel";

const NOW = new Date("2026-10-22T18:00:00Z");
const TODAY = "2026-10-22";
const drop = (over: Partial<PriveDrop> = {}): PriveDrop => ({
  id: "d1", slug: "louvre", type: "promocion_publica", status: "activo",
  title: { es: "Louvre gratis el primer viernes", en: "Free Louvre" }, provider: { name: "Musée du Louvre" },
  benefit: { es: "Entrada gratuita el primer viernes del mes desde las 18:00." }, conditions: { es: "Reservar horario." }, eligibility: { es: "Todos." },
  source: { url: "https://www.louvre.fr/en/visit/hours-admission" }, link: "https://ticket.louvre.fr/en",
  last_verified_at: "2026-10-22T15:00:00Z", ...over,
});

describe("Privé Drops · vigencia", () => {
  it("vence solo al terminar el día de valid_until", () => {
    expect(effectiveDropStatus(drop({ valid_until: "2026-10-22" }), TODAY, NOW)).toBe("activo");
    expect(effectiveDropStatus(drop({ valid_until: "2026-10-21" }), TODAY, NOW)).toBe("vencido");
  });
  it("un Drop futuro es 'programado' y no se muestra", () => {
    expect(effectiveDropStatus(drop({ valid_from: "2026-11-01" }), TODAY, NOW)).toBe("programado");
    expect(visibleDrops([drop({ valid_from: "2026-11-01" })], TODAY, NOW)).toHaveLength(0);
  });
  it("sin revisión en 45 días pasa a 'por verificar' aunque el servidor diga activo (respuesta vieja)", () => {
    expect(effectiveDropStatus(drop({ last_verified_at: "2026-09-01T00:00:00Z" }), TODAY, NOW)).toBe("por_verificar");
    expect(effectiveDropStatus(drop({ last_verified_at: "2026-09-10T00:00:00Z" }), TODAY, NOW)).toBe("activo");
  });
  it("un vencido que llega de caché como 'activo' se descarta", () => {
    expect(visibleDrops([drop({ valid_until: "2026-10-01" }), drop({ id: "d2", slug: "ok" })], TODAY, NOW).map((d) => d.slug)).toEqual(["ok"]);
  });
  it("un beneficio IATOS sin convenio nunca se muestra", () => {
    expect(visibleDrops([drop({ type: "beneficio_iatos", relationship: "ninguna" })], TODAY, NOW)).toHaveLength(0);
  });
  it("sin fuente o enlace https no se muestra", () => {
    expect(visibleDrops([drop({ source: { url: "http://x.test" } }), drop({ link: "javascript:alert(1)" })], TODAY, NOW)).toHaveLength(0);
  });
  it("retirado no se muestra; por verificar sí (con aviso)", () => {
    expect(visibleDrops([drop({ status: "retirado" }), drop({ id: "x", slug: "pv", status: "por_verificar" })], TODAY, NOW).map((d) => d.slug)).toEqual(["pv"]);
  });
  it("localToday usa la fecha local (Ciudad de México), no la UTC", () => {
    expect(localToday(new Date("2026-10-23T03:00:00Z"))).toBe("2026-10-22");
    expect(localToday(new Date("2026-10-23T03:00:00Z"), "Europe/Paris")).toBe("2026-10-23");
  });
});

describe("Privé Drops · ningún descuento sin comparación verificable", () => {
  const price = { offer: 300, reference: 400, currency: "EUR", source: "https://example.test/precios", discount_pct: 25 };
  it("el porcentaje solo existe con referencia, oferta, moneda, fuente y aritmética que cuadra", () => {
    expect(verifiableDiscount(price)).toBe(25);
    expect(verifiableDiscount({ ...price, discount_pct: 40 })).toBeNull();
    expect(verifiableDiscount({ ...price, reference: null })).toBeNull();
    expect(verifiableDiscount({ ...price, source: null })).toBeNull();
    expect(verifiableDiscount({ ...price, offer: 500 })).toBeNull();
    expect(verifiableDiscount({ ...price, currency: null })).toBeNull();
  });
  it("'40 %' en el texto sin comparación: el Drop no se pinta", () => {
    const bad = drop({ title: { es: "Hasta 40% en suites" } });
    expect(hasUnverifiablePercent(bad)).toBe(true);
    expect(visibleDrops([bad], TODAY, NOW)).toHaveLength(0);
    expect(hasUnverifiablePercent(drop({ benefit: { es: "Tarifa 25 % menor" }, price }))).toBe(false);
    expect(hasUnverifiablePercent(drop({ benefit: { es: "50 por ciento menos" } }))).toBe(true);
  });
  it("el precio 'antes' nunca aparece sin el porcentaje verificable (no hay precios anteriores inventados)", () => {
    expect(displayPrice({ ...price, discount_pct: null })).toEqual({ offer: 300, currency: "EUR", reference: null, pct: null, source: price.source });
    expect(displayPrice(price)).toMatchObject({ reference: 400, pct: 25 });
    expect(displayPrice({ offer: 20, currency: "EUR", source: null })).toBeNull();
  });
});

describe("Privilege Radar · estados", () => {
  it("transiciones permitidas", () => {
    expect(nextRadarStates("posible")).toEqual(["por_comprobar", "verificado"]);
    expect(nextRadarStates("por_comprobar")).toEqual(["verificado", "posible"]);
    expect(nextRadarStates("verificado")).toEqual(["utilizado", "por_comprobar"]);
    expect(nextRadarStates("utilizado")).toEqual(["verificado"]);
  });
  it("VERIFICADO exige decir cómo; UTILIZADO exige estar verificado antes", () => {
    const item = { state: "por_comprobar" as const, verified_at: null, verification_note: null };
    expect(radarTransitionError(item, "verificado", "")).toBe("VERIFICATION_REQUIRED");
    expect(radarTransitionError(item, "verificado", "Lo confirmé con mi banco")).toBeNull();
    expect(radarTransitionError(item, "utilizado")).toBe("VERIFY_FIRST");
    expect(radarTransitionError({ state: "verificado", verified_at: "2026-10-22T00:00:00Z", verification_note: "ok banco" }, "utilizado")).toBeNull();
    expect(radarTransitionError({ state: "posible", verified_at: null, verification_note: null }, "utilizado")).toBe("VERIFY_FIRST");
  });
});

describe("The Value of Your Privé · separación honesta", () => {
  const e = (over: Partial<ValueEntry>): ValueEntry => ({ id: Math.random().toString(36), kind: "comprobado", title: "x", ...over });
  const entries: ValueEntry[] = [
    e({ kind: "comprobado", currency: "MXN", reference_amount: 5200, paid_amount: 4100, reference_source: "Tarifa del hotel", evidence_note: "Folio 1" }),
    e({ kind: "comprobado", currency: "EUR", reference_amount: 32, paid_amount: 0, reference_source: "Tarifa oficial", evidence_note: "Primer viernes" }),
    e({ kind: "estimado", currency: "EUR", reference_amount: "300", paid_amount: "250", reference_source: "Menú publicado" }),
    e({ kind: "potencial", radar_item_id: "r1" }),
    e({ kind: "sin_ahorro", title: "Aniversario", non_monetary_note: "Noche organizada" }),
    // Inválidas: no deben contarse nunca.
    e({ kind: "comprobado", currency: "MXN", reference_amount: 1000, paid_amount: 500, reference_source: "x y z" }), // sin evidencia
    e({ kind: "estimado", currency: "MXN", reference_amount: 100, paid_amount: 200, reference_source: "x y z" }),   // "ahorro" negativo
    e({ kind: "comprobado", currency: "MXN", savings_amount: 99999 }),                                           // ahorro escrito a mano
  ];
  it("totales por tipo y por moneda, sin sumar monedas ni tipos", () => {
    const s = splitValue(entries, 2);
    expect(s.proven).toEqual([{ currency: "EUR", amount: 32, count: 1 }, { currency: "MXN", amount: 1100, count: 1 }]);
    expect(s.estimated).toEqual([{ currency: "EUR", amount: 50, count: 1 }]);
    expect(s.potential).toEqual([]);
    expect(s.potentialWithoutAmount).toBe(1);
    expect(s.nonMonetary.map((x) => x.title)).toEqual(["Aniversario"]);
    expect(s.organizedPlans).toBe(2);
    expect(s.isEmpty).toBe(false);
  });
  it("nunca inventa: sin registros, todo vacío", () => {
    expect(splitValue([], 0)).toMatchObject({ proven: [], estimated: [], potential: [], isEmpty: true });
  });
  it("el formulario aplica las reglas de la base", () => {
    expect(valueEntryError({ kind: "comprobado", title: "Hotel", currency: "MXN", reference_amount: 10, paid_amount: 5, reference_source: "Tarifa" })).toBe("evidence_note");
    expect(valueEntryError({ kind: "comprobado", title: "Hotel", currency: "MXN", reference_amount: 10, paid_amount: 5, reference_source: "Tarifa", evidence_note: "Folio" })).toBeNull();
    expect(valueEntryError({ kind: "estimado", title: "Cena", currency: "EUR", reference_amount: 10, paid_amount: 5 })).toBe("reference_source");
    expect(valueEntryError({ kind: "sin_ahorro", title: "Cena", reference_amount: 10, paid_amount: 5, non_monetary_note: "Algo" })).toBe("no_amounts");
    expect(valueEntryError({ kind: "potencial", title: "Algo" })).toBe("link_required");
    expect(valueEntryError({ kind: "estimado", title: "Cena", currency: "EUR", reference_amount: 5, paid_amount: 5, reference_source: "x y z" })).toBe("ref_gt_paid");
  });
});

describe("Insider's Notebook · Before You Go", () => {
  const tip = (over: Partial<InsiderTip>): InsiderTip => ({
    id: Math.random().toString(36), slug: over.slug ?? "t", category: "errores", destination: { slug: "paris" },
    title: { es: "x" }, body: { es: "y" }, source: { url: "https://x.test", name: "X", checked_at: "2026-10-22" }, rank: 50, ...over,
  });
  it("cinco como máximo, primero las marcadas, sin vencidas, sin fuente ni obsoletas", () => {
    const list = [
      tip({ slug: "a", before_you_go: false, rank: 1 }), tip({ slug: "b", before_you_go: true, rank: 9 }), tip({ slug: "c", before_you_go: true, rank: 2 }),
      tip({ slug: "d", before_you_go: true, valid_until: "2026-10-01" }), tip({ slug: "e", before_you_go: true, source: { url: "http://x", name: "X", checked_at: "2026-10-22" } }),
      tip({ slug: "f", stale: true, before_you_go: true }), tip({ slug: "g" }), tip({ slug: "h" }), tip({ slug: "i" }),
    ];
    expect(topFive(list, TODAY).map((x) => x.slug)).toEqual(["c", "b", "a", "g", "h"]);
  });
  it("se destaca desde 30 días antes y durante el viaje", () => {
    expect(beforeYouGoIsNear({ trip: { id: "1", destino: "París", days_until: 10 } })).toBe(true);
    expect(beforeYouGoIsNear({ trip: { id: "1", destino: "París", days_until: 45 } })).toBe(false);
    expect(beforeYouGoIsNear({ trip: null })).toBe(false);
  });
  it("agrupa por categoría en orden de rango", () => {
    const g = groupByCategory([tip({ slug: "x", category: "transporte", rank: 5 }), tip({ slug: "y", category: "errores", rank: 1 })]);
    expect(g.map(([c]) => c)).toEqual(["errores", "transporte"]);
  });
});

describe("Privé Passport · privacidad y criterios", () => {
  it("Founding Member solo si el servidor lo afirma CON fecha de corte", () => {
    expect(isFoundingMember({ founding_member: true, founding_cutoff: "2026-12-31" })).toBe(true);
    expect(isFoundingMember({ founding_member: true, founding_cutoff: null })).toBe(false);
    expect(isFoundingMember({ founding_member: false, founding_cutoff: "2026-12-31" })).toBe(false);
    expect(isFoundingMember(null)).toBe(false);
  });
  it("rechaza números de tarjeta y fechas futuras para lo vivido", () => {
    expect(passportEntryError({ kind: "recuerdo", title: "Cena", place: "Roma", note: "pagué con 4111 1111 1111 1111" }, TODAY)).toBe("card_number");
    expect(passportEntryError({ kind: "visitado", title: "París", place: "París", happened_on: "2027-01-01" }, TODAY)).toBe("future");
    expect(passportEntryError({ kind: "deseo", title: "Cerezos", place: "Tokio", happened_on: "2027-04-01" }, TODAY)).toBeNull();
    expect(passportEntryError({ kind: "favorito", title: "Algo" }, TODAY)).toBe("place");
  });
  it("antigüedad sin redondeos engañosos", () => {
    expect(tenureParts(0)).toEqual({ years: 0, months: 0, days: 0 });
    expect(tenureParts(400)).toEqual({ years: 1, months: 1, days: 5 });
    expect(tenureParts(-1)).toBeNull();
  });
});
