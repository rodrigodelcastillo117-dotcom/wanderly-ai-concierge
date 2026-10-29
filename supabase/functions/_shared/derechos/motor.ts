// Motor de derechos del pasajero aéreo — determinista, sin red, sin IA. Entrada: los hechos del caso.
// Salida: qué leyes aplican, qué le corresponde (monto, asistencia, reembolso, plazo), qué pruebas
// guardar, qué hacer AHORA y a quién reclamar. Cada derecho trae su certeza y su fuente (fuentes.ts).
//
// Certeza:
//   te_corresponde → los hechos que nos dieron cumplen la regla escrita, sin depender de algo que no sabemos.
//   probablemente  → la regla aplica, pero algo que no podemos comprobar (motivo real, nacionalidad de la
//                    aerolínea, que el retraso sea "atribuible") podría cambiarlo.
//   depende        → falta un dato o la ley deja la decisión a un hecho que hay que probar; se dice de qué.
// Nunca se afirma nada con una fuente NO VERIFICADA. Probado en src/test/derechosMotor.test.ts.
import { airlineCode as codigoAerolinea } from "../airlines.ts";
import {
  AIRLINE_CONTACTS, AIRLINE_COUNTRY, AIRLINE_NAMES, ANAC_BR, CAA_UK, contactoAerolinea, CTA, DOT, EU_261_COUNTRIES, EU_NEB,
  type Organismo, PROFECO, UK,
} from "./datos.ts";
import { aeropuerto, distanciaRuta } from "./distancia.ts";

export const MOTOR_VERSION = "derechos-v1 (fuentes 2026-10-29)";
export const UMA_2026_MXN = 117.31;

export type TipoEvento =
  | "retraso" | "cancelacion" | "sobreventa" | "conexion_perdida" | "clase_inferior"
  | "equipaje_perdido" | "equipaje_danado" | "equipaje_retrasado";
export type Certeza = "te_corresponde" | "probablemente" | "depende";
export type RegimenId = "MX_LAC" | "EU261" | "UK261" | "US_DOT" | "CA_APPR" | "BR_ANAC" | "MONTREAL";
export type Motivo =
  | "clima" | "atc" | "seguridad" | "huelga" | "tecnico" | "tripulacion" | "operativo" | "sobreventa" | "medico" | "fauna"
  | "aeropuerto" | "desconocido";

export type CasoVuelo = {
  evento: TipoEvento;
  /** Códigos IATA del vuelo afectado. */
  origen: string;
  destino: string;
  /** Destino final del viaje si hubo conexión (distancia del art. 7 del 261/2004). */
  destino_final?: string | null;
  /** ISO2 si el aeropuerto no está en la tabla. */
  pais_origen?: string | null;
  pais_destino?: string | null;
  /** Aerolínea que OPERÓ el vuelo: código IATA, nombre o número de vuelo ("IB 6403"). */
  aerolinea: string;
  pais_aerolinea?: string | null;
  vuelo?: string | null;
  fecha?: string | null;
  horas_retraso_llegada?: number | null;
  horas_retraso_salida?: number | null;
  /** Días de anticipación con que avisaron la cancelación o el cambio. */
  aviso_dias?: number | null;
  reubicacion?: { ofrecida: boolean; aceptada?: boolean | null; sale_antes_horas?: number | null; llega_despues_horas?: number | null } | null;
  /** Lo que dijo la aerolínea, tal cual ("mal clima", "falla técnica"…). */
  motivo?: string | null;
  clase?: string | null;
  precio?: { monto: number; moneda: string } | null;
  /** Denegación de embarque: ¿cediste tu lugar de forma voluntaria? */
  voluntario?: boolean | null;
  pernocta?: boolean | null;
  equipaje?: { de_mano?: boolean | null; dias_desde_recibido?: number | null } | null;
  /** Fecha de hoy (YYYY-MM-DD) para plazos; por defecto, la del sistema. */
  hoy?: string | null;
};

export type Monto = { valor: number; moneda: string; tipo: "fijo" | "hasta" | "minimo"; nota?: string };
export type Derecho = {
  id: string;
  regimen: RegimenId;
  titulo: string;
  detalle: string;
  certeza: Certeza;
  depende_de?: string;
  monto?: Monto;
  fuente: string;
};
export type RegimenAplicable = { id: RegimenId; nombre: string; aplica: Certeza; por_que: string; fuente: string };
export type PasoReclamo = {
  paso: number;
  a_quien: "aerolinea" | "organismo" | "banco";
  nombre: string;
  canal: string;
  url: string | null;
  correo: string | null;
  telefono: string | null;
  cuando: string;
  verificacion: string;
  organismo_id?: string;
};
export type Plazo = { que: string; plazo: string; fuente: string; certeza: Certeza };

export type Evaluacion = {
  version: string;
  caso: CasoVuelo;
  aerolinea: { codigo: string | null; nombre: string; pais: string | null; pais_verificado: false };
  ruta: {
    origen: string; destino: string; destino_final: string;
    pais_origen: string | null; pais_destino: string | null;
    distancia_km: number | null; cerca_de_umbral: boolean; nota_distancia: string | null;
    nacional: boolean | null; internacional: boolean | null;
  };
  motivo: Motivo;
  regimenes: RegimenAplicable[];
  derechos: Derecho[];
  /** El derecho en dinero más fuerte (para la carta y el resumen). */
  principal: Derecho | null;
  pruebas: string[];
  ahora: string[];
  reclamar: PasoReclamo[];
  plazos: Plazo[];
  avisos: string[];
  resumen: string;
};

const RANK: Record<Certeza, number> = { te_corresponde: 3, probablemente: 2, depende: 1 };
const menor = (a: Certeza, b: Certeza): Certeza => (RANK[a] <= RANK[b] ? a : b);
export const ETIQUETA_CERTEZA: Record<Certeza, string> = {
  te_corresponde: "Te corresponde",
  probablemente: "Probablemente te corresponde",
  depende: "Depende",
};

// ───────────────────────────── Motivo ─────────────────────────────
const fold = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MOTIVOS: Array<[Motivo, RegExp]> = [
  ["sobreventa", /sobreventa|overbook|oversold|sobrevend/],
  ["clima", /clima|tormenta|nieve|niebla|neblina|huracan|lluvia|viento|meteorolog|weather|storm|snow|fog|ceniza|volcan/],
  ["atc", /control de trafico|trafico aereo|air traffic|\batc\b|espacio aereo|slot|restriccion de (vuelo|trafico)/],
  ["seguridad", /seguridad|security|amenaza|bomba|threat/],
  ["huelga", /huelga|strike|paro (de|laboral)|sindicat/],
  ["medico", /emergencia medica|medical emergency|pasajero enfermo/],
  ["fauna", /\bave\b|aves|bird ?strike|fauna|wildlife/],
  ["aeropuerto", /cierre del aeropuerto|aeropuerto cerrado|pista cerrada|airport closure|problema(s)? del aeropuerto/],
  ["tecnico", /tecnic|mecanic|falla|averia|mantenimiento|technical|maintenance|mechanical/],
  ["tripulacion", /tripulacion|tripulante|piloto|crew|sobrecargo/],
  ["operativo", /operativ|operacion|comercial|programacion|itinerario|reprogram|schedule|logistic|conexion de la aeronave|avion llego tarde|retraso del vuelo anterior|late arriving aircraft/],
];
export function clasificarMotivo(texto: unknown): Motivo {
  const t = fold(texto);
  if (!t.trim()) return "desconocido";
  for (const [m, re] of MOTIVOS) if (re.test(t)) return m;
  return "desconocido";
}
const EXTRA_EU = new Set<Motivo>(["clima", "atc", "seguridad", "huelga", "medico", "fauna", "aeropuerto"]);
const FUERA_CONTROL_CA = new Set<Motivo>(["clima", "atc", "seguridad", "huelga", "medico", "fauna", "aeropuerto"]);

const MOTIVO_ES: Record<Motivo, string> = {
  clima: "mal clima", atc: "control de tráfico aéreo", seguridad: "un riesgo de seguridad", huelga: "una huelga",
  tecnico: "una falla técnica", tripulacion: "falta de tripulación", operativo: "razones operativas de la aerolínea",
  sobreventa: "sobreventa", medico: "una emergencia médica", fauna: "choque con fauna", aeropuerto: "problemas del aeropuerto",
  desconocido: "un motivo que no conocemos",
};

// ───────────────────────────── Utilidades ─────────────────────────────
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pais = (codigo: string, override?: string | null) =>
  (override && /^[A-Za-z]{2}$/.test(override) ? override.toUpperCase() : null) ?? aeropuerto(codigo)?.pais ?? null;

function resolverAerolinea(input: string, override?: string | null) {
  const code = codigoAerolinea(input) ?? (/^[A-Z0-9]{2}$/i.test(input.trim()) ? input.trim().toUpperCase() : null);
  const iso = override && /^[A-Za-z]{2}$/.test(override) ? override.toUpperCase() : code ? AIRLINE_COUNTRY[code] ?? null : null;
  const nombre = (code && (AIRLINE_NAMES[code] ?? AIRLINE_CONTACTS[code]?.nombre)) || input.trim() || "la aerolínea";
  return { codigo: code, nombre, pais: iso, pais_verificado: false as const };
}

type Tramo = "A" | "B" | "C"; // A ≤1500; B intra-UE >1500 o 1500–3500; C el resto
function tramoEU(km: number, intra: boolean): Tramo {
  if (km <= 1500) return "A";
  if (intra || km <= 3500) return "B";
  return "C";
}
function tramoUK(km: number): Tramo {
  if (km <= 1500) return "A";
  if (km <= 3500) return "B";
  return "C";
}
const EU_MONTO: Record<Tramo, number> = { A: 250, B: 400, C: 600 };
const UK_MONTO: Record<Tramo, number> = { A: 220, B: 350, C: 520 };
const HORAS_TRAMO: Record<Tramo, number> = { A: 2, B: 3, C: 4 };
const CLASE_PCT: Record<Tramo, number> = { A: 30, B: 50, C: 75 };

// ───────────────────────────── Motor ─────────────────────────────
export function evaluarVuelo(caso: CasoVuelo): Evaluacion {
  const origen = String(caso.origen ?? "").trim().toUpperCase();
  const destino = String(caso.destino ?? "").trim().toUpperCase();
  const destinoFinal = String(caso.destino_final ?? "").trim().toUpperCase() || destino;
  const pO = pais(origen, caso.pais_origen);
  const pD = pais(destino, caso.pais_destino);
  const pF = destinoFinal === destino ? pD : pais(destinoFinal, null) ?? pD;
  const aer = resolverAerolinea(String(caso.aerolinea ?? ""), caso.pais_aerolinea);
  const dist = distanciaRuta(origen, destinoFinal);
  const nacional = pO && pD ? pO === pD && pD === (pF ?? pD) : null;
  const motivo = caso.evento === "sobreventa" ? "sobreventa" : clasificarMotivo(caso.motivo);
  const derechos: Derecho[] = [];
  const regimenes: RegimenAplicable[] = [];
  const avisos: string[] = [];
  const plazos: Plazo[] = [];
  if (dist.nota) avisos.push(dist.nota);
  const esEquipaje = caso.evento.startsWith("equipaje_");
  const retLleg = num(caso.horas_retraso_llegada);
  const retSal = num(caso.horas_retraso_salida);
  const precio = caso.precio && Number.isFinite(caso.precio.monto) && caso.precio.monto > 0 ? caso.precio : null;
  const add = (d: Derecho) => derechos.push(d);

  // ── ¿Qué regímenes aplican? ──
  const inEU = (p: string | null) => !!p && EU_261_COUNTRIES.has(p);
  const aerEU = !!aer.pais && EU_261_COUNTRIES.has(aer.pais);
  const aerUK = aer.pais === UK;
  // UE: sale de la UE (cualquier aerolínea) o llega a la UE desde fuera en aerolínea comunitaria.
  let eu: Certeza | null = null;
  if (inEU(pO)) eu = "te_corresponde";
  else if (inEU(pD) && aerEU) eu = "probablemente"; // depende de la licencia de la aerolínea (no verificada hoy)
  else if (inEU(pD) && !aer.pais) eu = "depende";
  if (eu) regimenes.push({
    id: "EU261", nombre: "Reglamento (CE) 261/2004 (Unión Europea)", aplica: eu, fuente: "EU261_3",
    por_que: inEU(pO) ? `El vuelo sale de ${pO}, país donde aplica el reglamento, con cualquier aerolínea.`
      : `El vuelo llega a la UE desde fuera; aplica si ${aer.nombre} es aerolínea comunitaria (lo es según nuestra tabla, no verificada hoy) y si no recibiste beneficios por lo mismo en el país de salida.`,
  });
  // Reino Unido.
  let uk: Certeza | null = null;
  if (pO === UK) uk = "te_corresponde";
  else if (pD === UK && (aerUK || aerEU)) uk = "probablemente";
  else if (inEU(pD) && aerUK) uk = "probablemente";
  if (uk) regimenes.push({
    id: "UK261", nombre: "UK261 (Reino Unido)", aplica: uk, fuente: "UK261_3",
    por_que: pO === UK ? "El vuelo sale del Reino Unido." : `Llega a ${pD} en una aerolínea ${aerUK ? "británica" : "comunitaria"} (según nuestra tabla, no verificada hoy).`,
  });
  // México: la LAC obliga a concesionarias (mexicanas) y permisionarias (extranjeras con permiso).
  const tocaMX = pO === "MX" || pD === "MX";
  if (tocaMX) regimenes.push({
    id: "MX_LAC", nombre: "Ley de Aviación Civil (México), art. 47 Bis y relacionados", fuente: "MX_LAC_47BIS_V",
    aplica: aer.pais === "MX" ? "te_corresponde" : "probablemente",
    por_que: aer.pais === "MX" ? `${aer.nombre} es aerolínea mexicana y el vuelo toca México.`
      : `El vuelo toca México; la ley obliga también a las aerolíneas extranjeras con permiso para operar aquí.`,
  });
  // EE. UU.
  const tocaUS = pO === "US" || pD === "US";
  if (tocaUS) regimenes.push({
    id: "US_DOT", nombre: "Reglas del DOT (14 CFR partes 250, 254 y 260)", aplica: "te_corresponde", fuente: "US_260",
    por_que: "Vuelo hacia, desde o dentro de Estados Unidos (\"covered flight\").",
  });
  // Canadá.
  const tocaCA = pO === "CA" || pD === "CA";
  if (tocaCA) regimenes.push({
    id: "CA_APPR", nombre: "Air Passenger Protection Regulations (Canadá)", aplica: "te_corresponde", fuente: "CA_CTA_QUEJA",
    por_que: "Vuelo hacia, desde o dentro de Canadá (incluye conexiones).",
  });
  // Brasil.
  const tocaBR = pO === "BR" || pD === "BR";
  if (tocaBR) regimenes.push({
    id: "BR_ANAC", nombre: "ANAC Resolução 400/2016 (Brasil)", aplica: pO === "BR" && pD === "BR" ? "te_corresponde" : "probablemente",
    fuente: "BR_ANAC400_21", por_que: "Transporte aéreo regular nacional o internacional que opera en Brasil.",
  });
  // Montreal: transporte internacional.
  const internacional = pO && pF ? pO !== pF : null;
  if (internacional && (esEquipaje || caso.evento === "retraso" || caso.evento === "conexion_perdida")) {
    regimenes.push({
      id: "MONTREAL", nombre: "Convenio de Montreal 1999 (equipaje y daños por retraso)", aplica: "probablemente", fuente: "MC99_17_22",
      por_que: "Vuelo internacional; aplica si el país de salida y el de destino son parte del convenio.",
    });
  }
  if (!pO || !pD) avisos.push("No reconocimos el país de algún aeropuerto: dinos el país para revisar qué leyes aplican.");
  const tiene = (id: RegimenId) => regimenes.find((r) => r.id === id);

  // ── Unión Europea / Reino Unido ──
  for (const reg of [tiene("EU261"), tiene("UK261")]) {
    if (!reg || esEquipaje) continue;
    const isUK = reg.id === "UK261";
    const km = dist.km;
    const intra = inEU(pO) && inEU(pF);
    const tramo: Tramo | null = km == null ? null : isUK ? tramoUK(km) : tramoEU(km, intra);
    const montos = isUK ? UK_MONTO : EU_MONTO;
    const moneda = isUK ? "GBP" : "EUR";
    const base = reg.aplica;
    const fuenteComp = isUK ? "UK261_7" : "EU261_7";
    const tramoTxt = km == null ? "" : ` (ruta de ~${km} km${intra && !isUK ? " dentro de la UE" : ""})`;
    // Circunstancias extraordinarias: la aerolínea debe probarlas.
    const extra = EXTRA_EU.has(motivo);
    let certComp: Certeza = extra ? "depende" : motivo === "desconocido" || motivo === "tecnico" ? "probablemente" : "te_corresponde";
    certComp = menor(certComp, base);
    if (dist.cerca_de_umbral) certComp = menor(certComp, "depende");
    const dependeExtra = extra
      ? `La aerolínea dice que fue ${MOTIVO_ES[motivo]}: no paga si PRUEBA que fue una circunstancia extraordinaria que no pudo evitar con todas las medidas razonables. Pídele esa prueba por escrito.`
      : motivo === "tecnico" ? "La mayoría de las fallas técnicas NO son circunstancia extraordinaria; la aerolínea tendría que probar lo contrario."
      : motivo === "desconocido" ? "Que la aerolínea no pruebe una circunstancia extraordinaria (pídele el motivo por escrito)." : undefined;
    const montoComp = (horas: number | null): Monto | null => {
      if (!tramo) return null;
      if (tramo === "C" && !intra && horas != null && horas >= 3 && horas < 4) {
        return { valor: isUK ? 260 : 300, moneda, tipo: "fijo", nota: "Más de 3 500 km con 3 a 4 h de retraso a la llegada" };
      }
      return { valor: montos[tramo], moneda, tipo: "fijo" };
    };
    const compNoTramo = `${isUK ? "£220, £350 o £520" : "250, 400 o 600 €"} según la distancia`;

    if (caso.evento === "retraso" || caso.evento === "conexion_perdida") {
      // Asistencia (art. 6 y 9): por horas de retraso a la SALIDA según el tramo.
      const hSal = retSal ?? retLleg;
      if (tramo && hSal != null && hSal >= HORAS_TRAMO[tramo]) {
        add({
          id: `${reg.id}_asistencia`, regimen: reg.id, titulo: "Comida, bebida y dos comunicaciones gratis",
          detalle: `Con ${hSal} h de retraso${tramoTxt} la aerolínea debe darte comida y bebida según la espera y dos llamadas o correos${caso.pernocta ? ", más hotel y traslado porque tuviste que pasar la noche" : "; si tienes que pasar la noche, también hotel y traslado"}. Si no te la dio, guarda los tickets de lo que pagaste: se reclama.`,
          certeza: menor(retSal != null ? "te_corresponde" : "probablemente", base), fuente: isUK ? "UK261_3" : "EU261_9",
        });
      }
      if (hSal != null && hSal >= 5) {
        add({
          id: `${reg.id}_reembolso_5h`, regimen: reg.id, titulo: "Reembolso si ya no quieres viajar",
          detalle: "Con 5 h o más de retraso puedes renunciar al vuelo y pedir el reembolso completo del boleto en 7 días (y vuelo de regreso al origen si ya no te sirve el viaje).",
          certeza: menor(retSal != null ? "te_corresponde" : "probablemente", base), fuente: isUK ? "UK_CAA_DELAYS" : "EU261_6",
        });
      }
      // Compensación por retraso a la llegada ≥ 3 h.
      if (retLleg == null) {
        add({
          id: `${reg.id}_compensacion`, regimen: reg.id, titulo: "Compensación en dinero por llegar 3 h o más tarde",
          detalle: `Si llegaste a tu destino final 3 h o más tarde, ${compNoTramo}.`, certeza: "depende",
          depende_de: "Las horas de retraso a la LLEGADA al destino final (no a la salida).", fuente: isUK ? "UK_CAA_DELAYS" : "EU_YOUR_EUROPE",
        });
      } else if (retLleg >= 3) {
        const m = montoComp(retLleg);
        add({
          id: `${reg.id}_compensacion`, regimen: reg.id, titulo: "Compensación en dinero por retraso",
          detalle: m
            ? `Llegaste ${retLleg} h tarde${tramoTxt}: ${m.valor} ${m.moneda} por pasajero, en efectivo o transferencia (un vale solo si tú lo aceptas por escrito).`
            : `Llegaste ${retLleg} h tarde: ${compNoTramo} (no pudimos medir la ruta).`,
          certeza: m ? certComp : menor(certComp, "depende"), depende_de: m ? dependeExtra : `La distancia de la ruta. ${dependeExtra ?? ""}`.trim(),
          monto: m ?? undefined, fuente: isUK ? "UK_CAA_DELAYS" : "EU_YOUR_EUROPE",
        });
        if (caso.evento === "conexion_perdida") avisos.push("En una conexión perdida cuenta el retraso al destino FINAL, y solo si todo fue una sola reserva; perderla por las filas de seguridad no da compensación.");
      } else {
        add({
          id: `${reg.id}_sin_compensacion`, regimen: reg.id, titulo: "Sin compensación en dinero por el retraso",
          detalle: `Llegaste ${retLleg} h tarde: la compensación empieza en 3 h de retraso a la llegada. Sí te toca la asistencia si el retraso a la salida pasó el umbral.`,
          certeza: menor("te_corresponde", base), fuente: isUK ? "UK_CAA_DELAYS" : "EU_YOUR_EUROPE",
        });
      }
    }

    if (caso.evento === "cancelacion") {
      add({
        id: `${reg.id}_opciones`, regimen: reg.id, titulo: "Reembolso o vuelo alternativo, a tu elección",
        detalle: "Puedes elegir: reembolso completo del boleto en 7 días, otro vuelo lo antes posible, u otro vuelo en la fecha que te convenga. Mientras esperas: comida, dos comunicaciones y, si toca pasar la noche, hotel y traslado.",
        certeza: base, fuente: isUK ? "UK261_3" : "EU261_8",
      });
      const aviso = num(caso.aviso_dias);
      const r = caso.reubicacion;
      let exento: boolean | null = null;
      let porQue = "";
      if (aviso == null) exento = null;
      else if (aviso >= 14) { exento = true; porQue = "te avisaron con 14 días o más"; }
      else if (aviso >= 7) {
        if (r?.ofrecida && num(r.sale_antes_horas) != null && num(r.llega_despues_horas) != null) {
          exento = r.sale_antes_horas! <= 2 && r.llega_despues_horas! < 4;
          porQue = exento ? "te avisaron entre 14 y 7 días antes y te ofrecieron un vuelo que sale máx. 2 h antes y llega menos de 4 h después" : "";
        } else exento = r?.ofrecida === false ? false : null;
      } else {
        if (r?.ofrecida && num(r.sale_antes_horas) != null && num(r.llega_despues_horas) != null) {
          exento = r.sale_antes_horas! <= 1 && r.llega_despues_horas! < 2;
          porQue = exento ? "te avisaron con menos de 7 días y te ofrecieron un vuelo que sale máx. 1 h antes y llega menos de 2 h después" : "";
        } else exento = r?.ofrecida === false ? false : null;
      }
      if (exento === true) {
        add({ id: `${reg.id}_sin_compensacion`, regimen: reg.id, titulo: "Sin compensación en dinero", detalle: `No hay compensación porque ${porQue}. Sí te toca reembolso o vuelo alternativo.`, certeza: base, fuente: isUK ? "UK261_3" : "EU261_5" });
      } else {
        let m = tramo ? { valor: montos[tramo], moneda, tipo: "fijo" as const } as Monto : null;
        let nota = "";
        const llegaDespues = num(r?.llega_despues_horas);
        if (m && tramo && r?.ofrecida && llegaDespues != null && llegaDespues <= HORAS_TRAMO[tramo]) {
          m = { ...m, valor: m.valor / 2, nota: "La aerolínea puede reducirla 50 % porque el vuelo alternativo llegó dentro del margen del art. 7(2)." };
          nota = " (reducida 50 % por el vuelo alternativo que llegó casi a tiempo)";
        }
        add({
          id: `${reg.id}_compensacion`, regimen: reg.id, titulo: "Compensación en dinero por cancelación",
          detalle: m ? `${m.valor} ${m.moneda} por pasajero${tramoTxt}${nota}.` : `${compNoTramo}.`,
          certeza: exento === null ? "depende" : m ? certComp : menor(certComp, "depende"),
          depende_de: exento === null
            ? "Con cuántos días te avisaron y, si fue con menos de 14, a qué hora salía y llegaba el vuelo alternativo que te ofrecieron."
            : dependeExtra,
          monto: m ?? undefined, fuente: isUK ? "UK261_7" : "EU261_5",
        });
      }
    }

    if (caso.evento === "sobreventa") {
      if (caso.voluntario) {
        add({ id: `${reg.id}_voluntario`, regimen: reg.id, titulo: "Lo que acordaste + reembolso o vuelo alternativo", detalle: "Si cediste tu lugar voluntariamente, te toca lo que acordaste con la aerolínea y además elegir entre reembolso o vuelo alternativo.", certeza: base, fuente: isUK ? "UK261_3" : "EU261_4" });
      } else {
        let m = tramo ? { valor: montos[tramo], moneda, tipo: "fijo" as const } as Monto : null;
        const llega = num(caso.reubicacion?.llega_despues_horas);
        if (m && tramo && caso.reubicacion?.ofrecida && llega != null && llega <= HORAS_TRAMO[tramo]) {
          m = { ...m, valor: m.valor / 2, nota: "Puede reducirse 50 % porque el vuelo alternativo llegó dentro del margen del art. 7(2)." };
        }
        add({
          id: `${reg.id}_compensacion`, regimen: reg.id, titulo: "Compensación inmediata por negarte el embarque",
          detalle: m ? `${m.valor} ${m.moneda} por pasajero${tramoTxt}, que deben pagarte de inmediato, más reembolso o vuelo alternativo y asistencia (comida, comunicación, hotel si toca).` : `${compNoTramo}, más reembolso o vuelo alternativo y asistencia.`,
          certeza: m ? menor(base, dist.cerca_de_umbral ? "depende" : "te_corresponde") : "depende",
          depende_de: m ? undefined : "La distancia de la ruta.", monto: m ?? undefined, fuente: fuenteComp,
        });
      }
    }

    if (caso.evento === "clase_inferior") {
      if (tramo && precio) {
        const pct = CLASE_PCT[tramo];
        add({ id: `${reg.id}_clase`, regimen: reg.id, titulo: "Reembolso parcial por volar en clase inferior", detalle: `${pct} % del precio del boleto, en 7 días.`, certeza: base, monto: { valor: round2(precio.monto * pct / 100), moneda: precio.moneda, tipo: "fijo", nota: `${pct} % del precio` }, fuente: "EU261_10" });
      } else {
        add({ id: `${reg.id}_clase`, regimen: reg.id, titulo: "Reembolso parcial por volar en clase inferior", detalle: "30 %, 50 % o 75 % del precio del boleto según la distancia, en 7 días.", certeza: "depende", depende_de: "El precio del boleto y la distancia.", fuente: "EU261_10" });
      }
    }
  }

  // ── México (LAC) ──
  const mx = tiene("MX_LAC");
  if (mx && !esEquipaje) {
    const base = mx.aplica;
    const fuerza = new Set<Motivo>(["clima", "atc", "seguridad", "medico", "fauna", "aeropuerto", "huelga"]).has(motivo);
    const atribuible: Certeza = fuerza ? "depende" : motivo === "desconocido" || motivo === "tecnico" ? "probablemente" : "te_corresponde";
    const dependeAtrib = fuerza
      ? `La ley da estos derechos cuando la causa es atribuible a la aerolínea. Dijo que fue ${MOTIVO_ES[motivo]}: si de verdad fue caso fortuito o fuerza mayor, no aplican; pide el motivo por escrito.`
      : motivo === "desconocido" || motivo === "tecnico" ? "Que la causa sea atribuible a la aerolínea (una falla técnica o de operación normalmente lo es; pide el motivo por escrito)." : undefined;
    const pct = (p: number): Monto | undefined => (precio ? { valor: round2(precio.monto * p / 100), moneda: precio.moneda, tipo: "minimo", nota: `${p} % del precio del boleto` } : undefined);
    const opcionesCancel = "a tu elección: (a) reembolso del boleto o de la parte no volada; (b) otro vuelo en el primer disponible con llamadas, correos, alimentos según la espera y, si hay que pasar la noche, hotel y traslado; o (c) viajar en la fecha que te convenga";
    if (caso.evento === "retraso" || caso.evento === "conexion_perdida") {
      const h = retSal ?? retLleg;
      const certH: Certeza = retSal != null ? "te_corresponde" : "probablemente";
      if (retSal == null && retLleg != null) avisos.push("La ley mexicana cuenta el retraso desde la hora de SALIDA del boleto; usamos el retraso a la llegada como aproximación.");
      if (h == null) {
        add({ id: "MX_retraso", regimen: "MX_LAC", titulo: "Compensación por retraso (ley mexicana)", detalle: "Más de 1 h: según la política de compensación de la aerolínea; más de 2 h: descuento de al menos 7.5 % del boleto; más de 4 h: las opciones de una cancelación y, si eliges reembolso o viajar otro día, indemnización de al menos 25 %.", certeza: "depende", depende_de: "Las horas de retraso a la salida.", fuente: "MX_LAC_47BIS_V" });
      } else if (h > 4) {
        add({ id: "MX_retraso_4h", regimen: "MX_LAC", titulo: "Más de 4 h: opciones de cancelación", detalle: `Con más de 4 h de retraso tienes, ${opcionesCancel}.`, certeza: menor(menor(base, atribuible), certH), depende_de: dependeAtrib, fuente: "MX_LAC_47BIS_V" });
        add({ id: "MX_indemnizacion_25", regimen: "MX_LAC", titulo: "Indemnización de al menos 25 % del boleto", detalle: "Si eliges el reembolso o viajar en otra fecha, además te deben al menos el 25 % del precio del boleto (o de la parte no volada), pagado en máximo 10 días naturales después de tu reclamación.", certeza: menor(menor(base, atribuible), certH), depende_de: dependeAtrib, monto: pct(25), fuente: "MX_LAC_47BIS_VI" });
      } else if (h > 2 && h < 4) {
        add({ id: "MX_descuento_75", regimen: "MX_LAC", titulo: "Descuento de al menos 7.5 % del boleto", detalle: `Con ${h} h de retraso, la compensación según la política de la aerolínea debe incluir un descuento de al menos 7.5 % del precio del boleto para un vuelo posterior, alimentos y bebidas, o una combinación.`, certeza: menor(menor(base, atribuible), certH), depende_de: dependeAtrib, monto: pct(7.5), fuente: "MX_LAC_47BIS_V" });
      } else if (h > 1 && h < 4) {
        add({ id: "MX_politica", regimen: "MX_LAC", titulo: "Compensación según la política de la aerolínea", detalle: `Con ${h} h de retraso, la aerolínea debe compensarte según su política registrada (mínimo descuentos para otro vuelo, alimentos y bebidas, o una combinación).`, certeza: menor(menor(base, atribuible), certH), depende_de: dependeAtrib, fuente: "MX_LAC_47BIS_V" });
      } else if (h === 4) {
        add({ id: "MX_4h_exactas", regimen: "MX_LAC", titulo: "Retraso de 4 h exactas", detalle: "La ley habla de «inferior a cuatro» y «mayor a cuatro» horas; 4 h exactas quedan en medio. Pide el registro de la hora real de salida: unos minutos cambian el derecho.", certeza: "depende", depende_de: "La hora exacta de salida.", fuente: "MX_LAC_47BIS_V" });
      }
      if (h != null && h <= 1) {
        add({ id: "MX_sin_compensacion", regimen: "MX_LAC", titulo: "Sin compensación por el retraso (ley mexicana)", detalle: `Con ${h} h de retraso la ley mexicana todavía no da compensación: empieza cuando la demora es superior a una hora.`, certeza: menor(base, certH), fuente: "MX_LAC_47BIS_V" });
      }
      if (h != null && h > 1) {
        add({ id: "MX_comunicacion", regimen: "MX_LAC", titulo: "Llamadas y correos sin costo", detalle: "En todos los casos de retraso deben darte acceso a llamadas telefónicas y envío de correos; alimentos y hotel se cubren en el momento, no después.", certeza: menor(base, certH), fuente: "MX_LAC_47BIS_V" });
      }
    }
    if (caso.evento === "cancelacion") {
      add({ id: "MX_cancelacion", regimen: "MX_LAC", titulo: "Reembolso, otro vuelo o viajar otro día", detalle: `Si la cancelación es atribuible a la aerolínea tienes, ${opcionesCancel}.`, certeza: menor(base, atribuible), depende_de: dependeAtrib, fuente: "MX_LAC_47BIS_VI" });
      add({ id: "MX_indemnizacion_25", regimen: "MX_LAC", titulo: "Indemnización de al menos 25 % del boleto", detalle: "Si eliges el reembolso (a) o viajar otro día (c), además te deben al menos el 25 % del precio del boleto o de la parte no volada, en máximo 10 días naturales después de reclamar.", certeza: menor(base, atribuible), depende_de: dependeAtrib, monto: pct(25), fuente: "MX_LAC_47BIS_VI" });
    }
    if (caso.evento === "sobreventa") {
      if (caso.voluntario) {
        add({ id: "MX_voluntario", regimen: "MX_LAC", titulo: "Beneficios acordados (nunca menores a lo que da la ley)", detalle: "Si cediste tu lugar voluntariamente, los beneficios que acordaste no pueden ser inferiores a las opciones de la ley (reembolso, otro vuelo con asistencia u otra fecha).", certeza: base, fuente: "MX_LAC_52" });
      } else {
        add({ id: "MX_sobreventa", regimen: "MX_LAC", titulo: "Reembolso, otro vuelo o viajar otro día", detalle: "Por sobreventa tienes a tu elección: reembolso; otro vuelo en el primer disponible con comunicación, alimentos, hotel y traslado si hay que pasar la noche; o viajar en la fecha que te convenga.", certeza: base, fuente: "MX_LAC_52" });
        add({ id: "MX_indemnizacion_25", regimen: "MX_LAC", titulo: "Indemnización de al menos 25 % del boleto", detalle: "Si eliges el reembolso o viajar otro día, además te deben al menos el 25 % del precio del boleto o de la parte no volada.", certeza: base, monto: pct(25), fuente: "MX_LAC_52" });
      }
    }
    plazos.push({ que: "Pago de indemnizaciones de la ley mexicana", plazo: "Máximo 10 días naturales después de tu reclamación", fuente: "MX_LAC_47BIS_X", certeza: "te_corresponde" });
    plazos.push({ que: "Prescripción de tus derechos ante PROFECO (Ley Federal de Protección al Consumidor)", plazo: "1 año", fuente: "MX_LFPC_14", certeza: "te_corresponde" });
  }

  // ── Equipaje ──
  if (esEquipaje) {
    const deMano = caso.equipaje?.de_mano === true;
    if (mx && nacional === true) {
      if (caso.evento === "equipaje_retrasado") {
        add({ id: "MX_equipaje_retrasado", regimen: "MX_LAC", titulo: "Equipaje retrasado en vuelo nacional", detalle: "La ley mexicana fija montos por pérdida o avería, no por retraso. Reporta de inmediato y guarda los gastos indispensables: se reclaman a la aerolínea y, si no responde, ante PROFECO.", certeza: "depende", depende_de: "Si aparece o se declara perdido.", fuente: "MX_LAC_62" });
      } else {
        const umas = deMano ? 80 : 150;
        add({
          id: "MX_equipaje", regimen: "MX_LAC", titulo: deMano ? "Indemnización por equipaje de mano destruido o averiado" : "Indemnización por equipaje facturado perdido o averiado",
          detalle: deMano ? `Hasta 80 UMA (${(80 * UMA_2026_MXN).toLocaleString("es-MX", { maximumFractionDigits: 2 })} MXN con la UMA 2026).` : `150 UMA: ${(150 * UMA_2026_MXN).toLocaleString("es-MX", { maximumFractionDigits: 2 })} MXN con la UMA 2026 (se toma la UMA de la fecha del daño).`,
          certeza: mx.aplica, monto: { valor: round2(umas * UMA_2026_MXN), moneda: "MXN", tipo: deMano ? "hasta" : "fijo", nota: `${umas} UMA × ${UMA_2026_MXN}` }, fuente: "MX_LAC_62",
        });
      }
    }
    if (tiene("MONTREAL")) {
      const dias = num(caso.equipaje?.dias_desde_recibido);
      if (caso.evento === "equipaje_danado") {
        const tarde = dias != null && dias > 7;
        add({ id: "MC_danado", regimen: "MONTREAL", titulo: "Reclamo por equipaje dañado (por escrito en 7 días)", detalle: tarde ? `Ya pasaron ${dias} días desde que lo recibiste: el convenio exige el reclamo por escrito en 7 días; fuera de plazo solo procede si hubo fraude de la aerolínea.` : "Reclama por escrito a más tardar 7 días después de recibir la maleta; responsabilidad de la aerolínea hasta 1 519 DEG por pasajero (daño probado).", certeza: tarde ? "depende" : "probablemente", monto: tarde ? undefined : { valor: 1519, moneda: "DEG", tipo: "hasta", nota: "Derechos Especiales de Giro (FMI)" }, fuente: tarde ? "MC99_31" : "MC99_LIMITES_2024" });
      } else if (caso.evento === "equipaje_retrasado") {
        add({ id: "MC_retrasado", regimen: "MONTREAL", titulo: "Gastos por equipaje retrasado (por escrito en 21 días)", detalle: "Reclama por escrito a más tardar 21 días después de que te entreguen la maleta: gastos indispensables probados, hasta 1 519 DEG por pasajero. Si no llega en 21 días, se considera perdida.", certeza: "probablemente", monto: { valor: 1519, moneda: "DEG", tipo: "hasta" }, fuente: "MC99_31" });
      } else {
        add({ id: "MC_perdido", regimen: "MONTREAL", titulo: "Indemnización por equipaje perdido", detalle: "Si la aerolínea admite la pérdida o la maleta no llega en 21 días: valor probado de lo perdido, hasta 1 519 DEG por pasajero (más si declaraste un valor especial al documentar).", certeza: "probablemente", monto: { valor: 1519, moneda: "DEG", tipo: "hasta" }, fuente: "MC99_LIMITES_2024" });
      }
      plazos.push({ que: "Demanda contra la aerolínea (Convenio de Montreal)", plazo: "2 años desde la llegada (o desde que debió llegar)", fuente: "MC99_35", certeza: "probablemente" });
    }
    if (tiene("US_DOT")) {
      if (nacional === true) add({ id: "US_equipaje_254", regimen: "US_DOT", titulo: "Responsabilidad mínima por equipaje (vuelo nacional EE. UU.)", detalle: "La aerolínea no puede limitar su responsabilidad por equipaje perdido, dañado o retrasado a menos de 4 700 USD por pasajero (daño probado).", certeza: "te_corresponde", monto: { valor: 4700, moneda: "USD", tipo: "hasta" }, fuente: "US_254" });
      if (caso.evento !== "equipaje_danado") add({ id: "US_cargo_maleta", regimen: "US_DOT", titulo: "Reembolso del cargo por maleta", detalle: "Si la maleta se perdió o llegó con retraso significativo (12 h en vuelo nacional; 15 h o 30 h en internacional según la duración del tramo), te deben reembolsar automáticamente lo que pagaste por documentarla.", certeza: "te_corresponde", fuente: "US_260_BAGS" });
    }
    if (tiene("BR_ANAC")) {
      add({ id: "BR_bagagem", regimen: "BR_ANAC", titulo: "Plazos de la aerolínea con tu maleta (Brasil)", detalle: caso.evento === "equipaje_danado" ? "Reclama en 7 días; la aerolínea debe reparar, reemplazar o indemnizar en 7 días." : "Debe devolver la maleta en 7 días (nacional) o 21 días (internacional); si no aparece, reembolsarte en 7 días. Mientras tanto, gastos indispensables si estás fuera de casa.", certeza: tiene("BR_ANAC")!.aplica, fuente: "BR_ANAC400_32" });
    }
  }

  // Montreal, art. 19: daños por retraso (probados), aparte de la compensación fija de cada país.
  if (tiene("MONTREAL") && !esEquipaje) {
    add({ id: "MC_retraso", regimen: "MONTREAL", titulo: "Daños probados por el retraso", detalle: "Gastos o pérdidas que puedas probar por el retraso (hotel, transporte, una noche perdida ya pagada…), hasta 6 303 DEG por pasajero, salvo que la aerolínea pruebe que tomó todas las medidas razonables para evitarlo.", certeza: "depende", depende_de: "Que puedas probar el daño con tickets y que la aerolínea no pruebe que hizo todo lo razonable.", monto: { valor: 6303, moneda: "DEG", tipo: "hasta" }, fuente: "MC99_17_22" });
  }

  // ── Estados Unidos ──
  const us = tiene("US_DOT");
  if (us && !esEquipaje) {
    const intlUS = !(pO === "US" && pD === "US");
    const umbral = intlUS ? 6 : 3;
    if (caso.evento === "cancelacion") {
      add({ id: "US_reembolso", regimen: "US_DOT", titulo: "Reembolso completo si no aceptas la alternativa", detalle: "Si cancelaron tu vuelo y no aceptas otro vuelo ni un vale, te deben el reembolso completo (tarifa, impuestos y cargos) aunque el boleto no fuera reembolsable: 7 días hábiles si pagaste con tarjeta de crédito, 20 días naturales con otro medio. No pueden tomar como aceptado un vale si tú no lo aceptaste expresamente.", certeza: "te_corresponde", fuente: "US_260" });
    }
    if (caso.evento === "retraso" || caso.evento === "conexion_perdida") {
      const h = retLleg ?? retSal;
      if (h == null) add({ id: "US_reembolso", regimen: "US_DOT", titulo: "Reembolso si el retraso es significativo", detalle: `Si llegas ${umbral} h o más tarde (${intlUS ? "internacional" : "nacional"}) y no aceptas el vuelo cambiado, te deben el reembolso completo.`, certeza: "depende", depende_de: "Las horas de retraso.", fuente: "US_260" });
      else if (h >= umbral) add({ id: "US_reembolso", regimen: "US_DOT", titulo: "Reembolso completo si decides no volar", detalle: `Con ${h} h de retraso (umbral ${umbral} h para vuelo ${intlUS ? "internacional" : "nacional"}) es un "cambio significativo": si no aceptas el vuelo, te deben el reembolso completo con impuestos y cargos.`, certeza: retLleg != null ? "te_corresponde" : "probablemente", fuente: "US_260" });
      add({ id: "US_sin_compensacion_retraso", regimen: "US_DOT", titulo: "Compensación en dinero por retraso: no la fija la regla federal", detalle: "Las reglas federales que revisamos (partes 250 y 260) dan reembolso, no una compensación en dinero por retraso. Lo que ofrezca la aerolínea (comida, hotel, millas) depende de su plan de servicio al cliente.", certeza: "depende", depende_de: "El plan de servicio al cliente de la aerolínea.", fuente: "US_260" });
    }
    if (caso.evento === "sobreventa") {
      if (pO !== "US") {
        add({ id: "US_dbc_no_aplica", regimen: "US_DOT", titulo: "Compensación por denegación de embarque (DOT)", detalle: "La regla del DOT solo cubre vuelos que SALEN de un aeropuerto de EE. UU.; este no sale de EE. UU.", certeza: "te_corresponde", fuente: "US_250" });
      } else if (caso.voluntario) {
        add({ id: "US_dbc_voluntario", regimen: "US_DOT", titulo: "Lo que acordaste al ceder tu lugar", detalle: "Si cediste tu lugar voluntariamente, te toca la compensación que aceptaste (cualquier monto). Pide que te la den por escrito.", certeza: "te_corresponde", fuente: "US_250" });
      } else {
        const llega = num(caso.reubicacion?.llega_despues_horas) ?? (caso.reubicacion?.ofrecida === false ? Infinity : null);
        const corte = intlUS ? 4 : 2;
        if (llega == null) {
          add({ id: "US_dbc", regimen: "US_DOT", titulo: "Compensación por denegación de embarque", detalle: `200 % de la tarifa (máx. 1 075 USD) si el vuelo alternativo llega entre 1 y ${corte} h tarde; 400 % (máx. 2 150 USD) si llega más tarde o no te dan alternativa; nada si llega en menos de 1 h. Pagadero el mismo día en efectivo o cheque.`, certeza: "depende", depende_de: "A qué hora llega el vuelo alternativo.", fuente: "US_250" });
        } else if (llega <= 1) {
          add({ id: "US_dbc", regimen: "US_DOT", titulo: "Sin compensación por denegación de embarque", detalle: "El vuelo alternativo llega a menos de 1 h de lo previsto: la regla no exige compensación (sí el reembolso de cargos opcionales que no usaste).", certeza: "te_corresponde", fuente: "US_250" });
        } else {
          const alto = llega >= corte;
          const pctT = alto ? 400 : 200;
          const tope = alto ? 2150 : 1075;
          const valor = precio && precio.moneda.toUpperCase() === "USD" ? Math.min(round2(precio.monto * pctT / 100), tope) : tope;
          add({ id: "US_dbc", regimen: "US_DOT", titulo: "Compensación por denegación de embarque", detalle: `${pctT} % de la tarifa al destino, con tope de ${tope} USD, pagadero el mismo día en efectivo o cheque (un vale solo si tú lo aceptas sabiendo cuánto sería en efectivo).`, certeza: "te_corresponde", monto: { valor, moneda: "USD", tipo: precio && precio.moneda.toUpperCase() === "USD" ? "fijo" : "hasta", nota: precio && precio.moneda.toUpperCase() === "USD" ? `${pctT} % de ${precio.monto} USD` : `Tope; el monto es ${pctT} % de tu tarifa` }, fuente: "US_250" });
        }
      }
    }
  }

  // ── Canadá ──
  const ca = tiene("CA_APPR");
  if (ca && !esEquipaje && caso.evento !== "clase_inferior") {
    const fuera = FUERA_CONTROL_CA.has(motivo);
    const seguridadOps = motivo === "tecnico";
    const cat: Certeza = fuera ? "depende" : seguridadOps || motivo === "desconocido" ? "probablemente" : "te_corresponde";
    const depCat = fuera
      ? `La aerolínea lo atribuye a ${MOTIVO_ES[motivo]}, situación fuera de su control según el reglamento: en ese caso no hay compensación, solo vuelo alternativo o reembolso. Si no estás de acuerdo, la aerolínea debe probar la categoría.`
      : seguridadOps ? "Que la falla no haya sido «necesaria por seguridad» (en ese caso no hay compensación; el mantenimiento programado no cuenta como seguridad)."
      : motivo === "desconocido" ? "Que el problema haya estado dentro del control de la aerolínea y no fuera por seguridad." : undefined;
    if (caso.evento === "sobreventa" && !caso.voluntario) {
      const h = retLleg;
      const v = h == null ? null : h < 6 ? 900 : h < 9 ? 1800 : 2400;
      add({ id: "CA_dbc", regimen: "CA_APPR", titulo: "Compensación por denegación de embarque", detalle: v ? `CAD ${v} según las horas de retraso con que llegaste (${h} h).` : "CAD 900 (menos de 6 h de retraso a la llegada), 1 800 (6 a 9 h) o 2 400 (9 h o más).", certeza: v ? menor("te_corresponde", cat) : "depende", depende_de: v ? depCat : "Las horas de retraso a la llegada.", monto: v ? { valor: v, moneda: "CAD", tipo: "fijo" } : undefined, fuente: "CA_APPR_20" });
    } else if (caso.evento === "retraso" || caso.evento === "cancelacion" || caso.evento === "conexion_perdida") {
      const aviso = num(caso.aviso_dias);
      if (caso.evento === "cancelacion" && aviso != null && aviso > 14) {
        add({ id: "CA_sin_compensacion", regimen: "CA_APPR", titulo: "Sin compensación en dinero", detalle: "Te avisaron con más de 14 días: no hay compensación por inconvenientes, pero sí vuelo alternativo o reembolso.", certeza: "te_corresponde", fuente: "CA_APPR_12" });
      } else {
        const h = retLleg;
        const v = h == null || h < 3 ? null : h < 6 ? 400 : h < 9 ? 700 : 1000;
        add({ id: "CA_compensacion", regimen: "CA_APPR", titulo: "Compensación por inconvenientes", detalle: v ? `CAD ${v} si la aerolínea es grande (≥ 2 millones de pasajeros al año); CAD ${v === 400 ? 125 : v === 700 ? 250 : 500} si es pequeña. Llegaste ${h} h tarde. Si pediste reembolso en vez de viajar: CAD 400 (grande) o 125 (pequeña). Pídela por escrito antes de 1 año; tienen 30 días para pagar o explicar.` : h != null && h < 3 ? "Llegaste menos de 3 h tarde: no hay compensación por inconvenientes." : "CAD 400 / 700 / 1 000 (aerolínea grande) según 3, 6 o 9 h de retraso a la llegada.", certeza: v ? menor("depende", cat) : h != null && h < 3 ? "te_corresponde" : "depende", depende_de: v ? `El tamaño de la aerolínea. ${depCat ?? ""}`.trim() : h == null ? "Las horas de retraso a la llegada." : undefined, monto: v ? { valor: v, moneda: "CAD", tipo: "fijo", nota: "Aerolínea grande" } : undefined, fuente: "CA_APPR_19" });
        if (caso.evento === "cancelacion" || (h ?? retSal ?? 0) >= 3) {
          add({ id: "CA_alternativa", regimen: "CA_APPR", titulo: "Vuelo alternativo o reembolso en 30 días", detalle: "Sea cual sea la causa: otro vuelo o, si ya no te sirve el viaje, el reembolso en máximo 30 días.", certeza: "te_corresponde", fuente: "CA_APPR_17" });
        }
      }
      plazos.push({ que: "Pedir la compensación a la aerolínea (Canadá)", plazo: "Antes de 1 año desde el retraso o la cancelación; responden en 30 días", fuente: "CA_APPR_19", certeza: "te_corresponde" });
    }
  }

  // ── Brasil ──
  const br = tiene("BR_ANAC");
  if (br && !esEquipaje && caso.evento !== "clase_inferior") {
    const h = retSal ?? retLleg;
    if (h != null && h > 1 || caso.evento === "cancelacion" || caso.evento === "sobreventa") {
      const lineas = [h == null || h > 1 ? "más de 1 h: medios de comunicación" : null, h == null || h > 2 ? "más de 2 h: alimentación" : null, h == null || h > 4 ? "más de 4 h: hotel si hay que pasar la noche y traslado" : null].filter(Boolean);
      add({ id: "BR_assistencia", regimen: "BR_ANAC", titulo: "Asistencia material gratuita", detalle: `Según el tiempo de espera: ${lineas.join("; ")}. Aplica aunque estés a bordo con la puerta abierta.`, certeza: br.aplica, fuente: "BR_ANAC400_27" });
    }
    if ((h != null && h > 4) || caso.evento === "cancelacion" || caso.evento === "sobreventa" || caso.evento === "conexion_perdida") {
      add({ id: "BR_alternativas", regimen: "BR_ANAC", titulo: "Reacomodação, reembolso u otro medio de transporte", detalle: "A tu elección: otro vuelo (incluso de otra aerolínea) o en la fecha que te convenga, reembolso en 7 días desde que lo pidas, u otro medio de transporte.", certeza: caso.evento === "conexion_perdida" ? menor(br.aplica, "probablemente") : br.aplica, fuente: "BR_ANAC400_21" });
    }
    if (caso.evento === "sobreventa" && !caso.voluntario) {
      const nac = pO === "BR" && pD === "BR";
      add({ id: "BR_pretericao", regimen: "BR_ANAC", titulo: "Compensación inmediata por preterição", detalle: `${nac ? 250 : 500} DEG (Derechos Especiales de Giro) por transferencia, vale o efectivo, de inmediato.`, certeza: br.aplica, monto: { valor: nac ? 250 : 500, moneda: "DEG", tipo: "fijo" }, fuente: "BR_ANAC400_24" });
    }
  }

  // ── Principal, pruebas, qué hacer y a quién reclamar ──
  // Los daños probados de Montreal (un tope, no un monto) nunca son "lo que te corresponde".
  const conDinero = derechos.filter((d) => d.monto && d.monto.valor > 0 && d.id !== "MC_retraso");
  const principal = conDinero.sort((a, b) => RANK[b.certeza] - RANK[a.certeza] || ordenRegimen(a.regimen) - ordenRegimen(b.regimen))[0] ?? null;
  const pruebas = pruebasPara(caso);
  const ahora = ahoraPara(caso, derechos, aer.nombre);
  const reclamar = rutaReclamo(regimenes, aer.codigo, aer.nombre, pO, pD);
  if (tiene("EU261")) plazos.push({ que: "Plazo para demandar en la UE", plazo: "Lo fija la ley de cada país; no lo afirmamos", fuente: "EU_YOUR_EUROPE", certeza: "depende" });
  if (tiene("UK261")) plazos.push({ que: "Plazo para reclamar en Reino Unido", plazo: "Según la sección 9 de la Limitation Act 1980 (art. 3(9) UK261)", fuente: "UK261_3", certeza: "te_corresponde" });
  if (esEquipaje && tiene("MONTREAL")) plazos.unshift({ que: "Aviso por escrito a la aerolínea", plazo: caso.evento === "equipaje_danado" ? "7 días desde que recibiste la maleta" : caso.evento === "equipaje_retrasado" ? "21 días desde que te la entregaron" : "Cuanto antes (se considera perdida a los 21 días)", fuente: "MC99_31", certeza: "probablemente" });
  if (!aer.codigo) avisos.push("No reconocimos la aerolínea: dinos su nombre o el número de vuelo para dar el contacto correcto.");

  const resumen = resumenDe(principal, derechos, regimenes);
  return {
    version: MOTOR_VERSION, caso, aerolinea: aer,
    ruta: {
      origen, destino, destino_final: destinoFinal, pais_origen: pO, pais_destino: pD, distancia_km: dist.km, cerca_de_umbral: dist.cerca_de_umbral,
      nota_distancia: dist.nota, nacional, internacional,
    },
    motivo, regimenes, derechos, principal, pruebas, ahora, reclamar, plazos, avisos, resumen,
  };
}

const ORDEN: RegimenId[] = ["EU261", "UK261", "CA_APPR", "US_DOT", "BR_ANAC", "MX_LAC", "MONTREAL"];
const ordenRegimen = (r: RegimenId) => ORDEN.indexOf(r);

function resumenDe(p: Derecho | null, ds: Derecho[], rs: RegimenAplicable[]): string {
  if (!rs.length) return "No encontramos una ley de pasajeros que aplique con los datos que tenemos; dinos los países de salida y llegada y la aerolínea.";
  if (p?.monto) {
    const m = p.monto;
    const cant = `${m.tipo === "hasta" ? "hasta " : m.tipo === "minimo" ? "al menos " : ""}${m.valor.toLocaleString("es-MX", { maximumFractionDigits: 2 })} ${m.moneda}`;
    return `${ETIQUETA_CERTEZA[p.certeza]}: ${cant} (${p.titulo.toLowerCase()}) según ${rs.find((r) => r.id === p.regimen)?.nombre ?? p.regimen}.${p.depende_de ? ` Depende de: ${p.depende_de}` : ""}`;
  }
  const fuerte = ds.find((d) => d.certeza === "te_corresponde") ?? ds[0];
  return fuerte ? `${ETIQUETA_CERTEZA[fuerte.certeza]}: ${fuerte.titulo.toLowerCase()}.` : "Aplica la ley, pero faltan datos para decir qué te corresponde.";
}

function pruebasPara(c: CasoVuelo): string[] {
  const base = [
    "Pase de abordar y boleto electrónico (con el precio pagado y el número de reserva).",
    "Capturas de los avisos de la aerolínea (correo, SMS, app) con fecha y hora.",
  ];
  if (c.evento.startsWith("equipaje_")) {
    return [
      ...base,
      "Reporte de irregularidad de equipaje (PIR) con su número de folio, hecho en el aeropuerto.",
      "Talón de equipaje (etiqueta) que te dieron al documentar.",
      c.evento === "equipaje_danado" ? "Fotos del daño (maleta y contenido) el mismo día." : "Lista de lo que traía la maleta, con tickets o fotos si los tienes.",
      "Tickets de todo lo indispensable que compraste mientras tanto (ropa, artículos de aseo).",
    ];
  }
  return [
    ...base,
    "Motivo del retraso o cancelación POR ESCRITO (pídelo en el mostrador o por correo).",
    "Hora real de llegada (captura de la app de la aerolínea o de Flightradar) — es la que cuenta para la compensación.",
    "Tickets de comida, hotel y transporte que pagaste tú.",
    "Cualquier oferta de vale o vuelo alternativo por escrito (no firmes renuncias sin leerlas).",
    ...(c.evento === "sobreventa" ? ["Constancia de que te negaron el embarque y de si fue voluntario o no."] : []),
  ];
}

function ahoraPara(c: CasoVuelo, ds: Derecho[], aerolinea: string): string[] {
  const out: string[] = [];
  if (c.evento.startsWith("equipaje_")) {
    out.push("Antes de salir de la zona de llegadas, levanta el reporte de equipaje (PIR) en el mostrador de la aerolínea y guarda el folio.");
    out.push(c.evento === "equipaje_danado" ? "Manda el reclamo por escrito antes de 7 días (te preparo la carta)." : "Manda el reclamo por escrito (te preparo la carta); en retrasos, máximo 21 días después de recibir la maleta.");
    out.push("Compra solo lo indispensable y guarda cada ticket.");
    return out;
  }
  if (c.evento === "cancelacion" || c.evento === "sobreventa") {
    out.push(`Pide en el mostrador de ${aerolinea} que te reubiquen en el primer vuelo disponible o el reembolso, lo que prefieras: la elección es tuya.`);
  }
  if (ds.some((d) => /asistencia|comunicacion|assistencia/.test(d.id))) out.push("Pide vales de comida (y hotel si te toca pasar la noche); si no te los dan, paga lo razonable y guarda los tickets.");
  out.push("Pide el motivo por escrito y no aceptes un vale en lugar de dinero si no lo quieres: la ley no te obliga.");
  if (c.evento === "sobreventa" && !c.voluntario) out.push("Si no quieres ceder tu lugar, dilo claramente: solo deben bajar a alguien contra su voluntad si no hubo voluntarios suficientes.");
  out.push("Cuando llegues, te preparo la reclamación formal con su fundamento legal para enviarla con tu permiso.");
  return out;
}

function organismoDe(r: RegimenAplicable, pO: string | null, pD: string | null): Organismo | null {
  switch (r.id) {
    case "EU261": {
      const p = pO && EU_NEB[pO] ? pO : pD && EU_NEB[pD] ? pD : null;
      return p ? EU_NEB[p] : null;
    }
    case "UK261": return CAA_UK;
    case "US_DOT": return DOT;
    case "CA_APPR": return CTA;
    case "BR_ANAC": return ANAC_BR;
    case "MX_LAC": return PROFECO;
    default: return null;
  }
}

function rutaReclamo(rs: RegimenAplicable[], code: string | null, nombre: string, pO: string | null, pD: string | null): PasoReclamo[] {
  const c = contactoAerolinea(code);
  const pasos: PasoReclamo[] = [{
    paso: 1, a_quien: "aerolinea", nombre: c?.nombre ?? nombre,
    canal: c ? (c.canal === "formulario" ? "Formulario oficial (te dejo el texto listo para pegar)" : c.canal === "telefono" ? "Teléfono / centro de atención" : "Correo") : "Canal oficial de su sitio web (no lo tenemos verificado)",
    url: c?.url ?? null, correo: c?.verificacion === "pagina_leida" ? c.correo : null, telefono: c?.telefono ?? null,
    cuando: "Primero, siempre: es requisito antes de ir a un organismo.",
    verificacion: c ? `${c.verificacion}${c.fuente_url ? ` · ${c.fuente_url}` : ""} · ${c.consultado}` : "no_verificado",
  }];
  const vistos = new Set<string>();
  for (const r of [...rs].sort((a, b) => ordenRegimen(a.id) - ordenRegimen(b.id))) {
    const o = organismoDe(r, pO, pD);
    if (!o || vistos.has(o.id)) continue;
    vistos.add(o.id);
    const cuando = r.id === "EU261" ? "Si la aerolínea no responde en 2 meses o te lo niega." : r.id === "CA_APPR" ? "Si no responde en 30 días o no estás conforme." : r.id === "MX_LAC" ? "Si no paga en 10 días naturales o te lo niega." : r.id === "BR_ANAC" ? "Si no responde en 10 días o no lo resuelve." : "Si la aerolínea no lo resuelve.";
    pasos.push({
      paso: pasos.length + 1, a_quien: "organismo", nombre: o.nombre, canal: o.formulario ? "Formulario oficial" : o.correo ? "Correo oficial" : "Sitio oficial",
      url: o.formulario ?? o.url, correo: o.verificacion === "pagina_leida" ? o.correo : null, telefono: o.telefono, cuando,
      verificacion: `${o.verificacion} · ${o.fuente}`, organismo_id: o.id,
    });
  }
  return pasos;
}
