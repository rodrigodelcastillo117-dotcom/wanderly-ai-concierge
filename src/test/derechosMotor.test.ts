// Motor de derechos del pasajero (supabase/functions/_shared/derechos/motor.ts): escenarios reales con
// la respuesta esperada y su fuente oficial (consultada el 29-oct-2026; ver fuentes.ts y
// docs/iatos/IATOS_DERECHOS_RECLAMOS.md). Sin red.
import { describe, expect, it } from "vitest";
import { type CasoVuelo, clasificarMotivo, evaluarVuelo, UMA_2026_MXN } from "../../supabase/functions/_shared/derechos/motor";
import { FUENTES } from "../../supabase/functions/_shared/derechos/fuentes";

type Espera = { derecho: string; certeza?: "te_corresponde" | "probablemente" | "depende"; monto?: [number, string]; fuente: string; sin?: string[]; regimenes?: string[] };
type Escenario = { n: string; caso: CasoVuelo; espera: Espera };

const E = (n: string, caso: CasoVuelo, espera: Espera): Escenario => ({ n, caso, espera });

const ESCENARIOS: Escenario[] = [
  // ── Unión Europea (Reglamento 261/2004) ──
  E("1 · Cancelación MAD-MEX (Iberia) con 3 días de aviso, sin vuelo alternativo → 600 €", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 3, reubicacion: { ofrecida: false }, motivo: "razones operativas" },
    { derecho: "EU261_compensacion", certeza: "te_corresponde", monto: [600, "EUR"], fuente: "EU261_5", regimenes: ["EU261", "MX_LAC"] }),
  E("2 · Cancelación MAD-MEX con 3 días y vuelo que sale 1 h antes y llega 1.5 h después → sin compensación", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 3, reubicacion: { ofrecida: true, sale_antes_horas: 1, llega_despues_horas: 1.5 } },
    { derecho: "EU261_sin_compensacion", certeza: "te_corresponde", fuente: "EU261_5", sin: ["EU261_compensacion"] }),
  E("3 · Cancelación MAD-MEX avisada con 20 días → sin compensación, sí reembolso u otro vuelo", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 20 },
    { derecho: "EU261_sin_compensacion", fuente: "EU261_5" }),
  E("4 · Cancelación con 10 días y alternativa 1.5 h antes / 3 h después → sin compensación", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 10, reubicacion: { ofrecida: true, sale_antes_horas: 1.5, llega_despues_horas: 3 } },
    { derecho: "EU261_sin_compensacion", fuente: "EU261_5" }),
  E("5 · Cancelación con 10 días y alternativa que llega 5 h tarde → 600 €", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 10, reubicacion: { ofrecida: true, sale_antes_horas: 0, llega_despues_horas: 5 }, motivo: "programación" },
    { derecho: "EU261_compensacion", certeza: "te_corresponde", monto: [600, "EUR"], fuente: "EU261_5" }),
  E("6 · Cancelación con 2 días y alternativa que llega 3 h tarde (>3 500 km) → 300 € (reducción 50 %)", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 2, reubicacion: { ofrecida: true, sale_antes_horas: 0, llega_despues_horas: 3 }, motivo: "operativo" },
    { derecho: "EU261_compensacion", monto: [300, "EUR"], fuente: "EU261_5" }),
  E("7 · Cancelación con 3 días sin saber del vuelo alternativo → depende", { evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 3 },
    { derecho: "EU261_compensacion", certeza: "depende", fuente: "EU261_5" }),
  E("8 · Retraso de 4 h a la llegada CDG-MEX (Air France) → 600 €", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 4, horas_retraso_salida: 4 },
    { derecho: "EU261_compensacion", certeza: "probablemente", monto: [600, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("9 · Retraso de 3.5 h a la llegada CDG-MEX → 300 € (más de 3 500 km, 3 a 4 h)", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 3.5, motivo: "tripulación" },
    { derecho: "EU261_compensacion", certeza: "te_corresponde", monto: [300, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("10 · Retraso de 2.5 h CDG-MEX → sin compensación", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 2.5 },
    { derecho: "EU261_sin_compensacion", fuente: "EU_YOUR_EUROPE", sin: ["EU261_compensacion"] }),
  E("11 · Retraso de 5 h CDG-MEX por mal clima → depende (circunstancia extraordinaria)", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 5, horas_retraso_salida: 5, motivo: "Mal clima en París" },
    { derecho: "EU261_compensacion", certeza: "depende", monto: [600, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("12 · Retraso de 5 h CDG-MEX por falla técnica → probablemente 600 €", { evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 5, motivo: "falla técnica del avión" },
    { derecho: "EU261_compensacion", certeza: "probablemente", monto: [600, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("13 · Retraso de 3 h MAD-BCN (≤1 500 km) por falta de tripulación → 250 €", { evento: "retraso", origen: "MAD", destino: "BCN", aerolinea: "IB", horas_retraso_llegada: 3, horas_retraso_salida: 3, motivo: "falta de tripulación" },
    { derecho: "EU261_compensacion", certeza: "te_corresponde", monto: [250, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("14 · Retraso de 3 h MAD-ATH (dentro de la UE, >1 500 km) → 400 €", { evento: "retraso", origen: "MAD", destino: "ATH", aerolinea: "IB", horas_retraso_llegada: 3, motivo: "operativo" },
    { derecho: "EU261_compensacion", monto: [400, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("15 · Retraso de 3 h MAD-IST (fuera de la UE, 1 500–3 500 km) → 400 €", { evento: "retraso", origen: "MAD", destino: "IST", aerolinea: "TK", horas_retraso_llegada: 3, motivo: "operativo" },
    { derecho: "EU261_compensacion", monto: [400, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("16 · MEX-MAD en Aeroméxico (no comunitaria) con 5 h → el 261 no aplica; sí la ley mexicana", { evento: "retraso", origen: "MEX", destino: "MAD", aerolinea: "AM", horas_retraso_llegada: 5, horas_retraso_salida: 5, motivo: "operativo", precio: { monto: 20000, moneda: "MXN" } },
    { derecho: "MX_indemnizacion_25", monto: [5000, "MXN"], fuente: "MX_LAC_47BIS_VI", sin: ["EU261_compensacion"], regimenes: ["MX_LAC", "MONTREAL"] }),
  E("17 · MEX-MAD en Iberia (comunitaria) con 5 h → 600 € como máximo «probablemente» (nacionalidad no verificada)", { evento: "retraso", origen: "MEX", destino: "MAD", aerolinea: "IB", horas_retraso_llegada: 5, motivo: "operativo" },
    { derecho: "EU261_compensacion", certeza: "probablemente", monto: [600, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("18 · Sobreventa MAD-MEX involuntaria con vuelo que llega 3 h tarde → 300 € (50 %)", { evento: "sobreventa", origen: "MAD", destino: "MEX", aerolinea: "IB", voluntario: false, reubicacion: { ofrecida: true, llega_despues_horas: 3 } },
    { derecho: "EU261_compensacion", certeza: "te_corresponde", monto: [300, "EUR"], fuente: "EU261_7" }),
  E("19 · Clase inferior MAD-MEX, boleto de 1 000 € → 75 % = 750 €", { evento: "clase_inferior", origen: "MAD", destino: "MEX", aerolinea: "IB", precio: { monto: 1000, moneda: "EUR" } },
    { derecho: "EU261_clase", monto: [750, "EUR"], fuente: "EU261_10" }),
  E("20 · Conexión perdida MAD→CDG→MEX con 5 h al destino final → 600 € (distancia al destino final)", { evento: "conexion_perdida", origen: "MAD", destino: "CDG", destino_final: "MEX", aerolinea: "AF", horas_retraso_llegada: 5, motivo: "retraso del vuelo anterior" },
    { derecho: "EU261_compensacion", monto: [600, "EUR"], fuente: "EU_YOUR_EUROPE" }),
  E("21 · MAD-DUB (~1 454 km, cerca del umbral de 1 500) → depende del tramo", { evento: "retraso", origen: "MAD", destino: "DUB", aerolinea: "EI", horas_retraso_llegada: 4, motivo: "tripulación" },
    { derecho: "EU261_compensacion", certeza: "depende", fuente: "EU_YOUR_EUROPE" }),
  E("22 · Solo sabemos el retraso a la salida (4 h) → la compensación depende del retraso a la llegada", { evento: "retraso", origen: "MAD", destino: "MEX", aerolinea: "IB", horas_retraso_salida: 4 },
    { derecho: "EU261_asistencia", certeza: "te_corresponde", fuente: "EU261_9" }),
  // ── Reino Unido (UK261) ──
  E("23 · LHR-MEX (British Airways) con 4.5 h → £520", { evento: "retraso", origen: "LHR", destino: "MEX", aerolinea: "BA", horas_retraso_llegada: 4.5, motivo: "operativo" },
    { derecho: "UK261_compensacion", certeza: "te_corresponde", monto: [520, "GBP"], fuente: "UK_CAA_DELAYS", sin: ["EU261_compensacion"] }),
  E("24 · LHR-MEX con 3.5 h → £260", { evento: "retraso", origen: "LHR", destino: "MEX", aerolinea: "BA", horas_retraso_llegada: 3.5, motivo: "operativo" },
    { derecho: "UK261_compensacion", monto: [260, "GBP"], fuente: "UK_CAA_DELAYS" }),
  E("25 · LHR-MAD (Iberia) con 3 h → UK261 £220 y el 261 de la UE (probablemente) 250 €", { evento: "retraso", origen: "LHR", destino: "MAD", aerolinea: "IB", horas_retraso_llegada: 3, motivo: "operativo" },
    { derecho: "UK261_compensacion", certeza: "te_corresponde", monto: [220, "GBP"], fuente: "UK_CAA_DELAYS", regimenes: ["EU261", "UK261"] }),
  // ── México (Ley de Aviación Civil) ──
  E("26 · Retraso de 3 h en vuelo nacional MEX-CUN (Aeroméxico) por tripulación → descuento ≥7.5 %", { evento: "retraso", origen: "MEX", destino: "CUN", aerolinea: "Aeroméxico", horas_retraso_salida: 3, motivo: "tripulación", precio: { monto: 3000, moneda: "MXN" } },
    { derecho: "MX_descuento_75", certeza: "te_corresponde", monto: [225, "MXN"], fuente: "MX_LAC_47BIS_V", regimenes: ["MX_LAC"] }),
  E("27 · Retraso de 1.5 h MEX-GDL → compensación según la política de la aerolínea", { evento: "retraso", origen: "MEX", destino: "GDL", aerolinea: "Volaris", horas_retraso_salida: 1.5, motivo: "operativo" },
    { derecho: "MX_politica", certeza: "te_corresponde", fuente: "MX_LAC_47BIS_V" }),
  E("28 · Retraso de 5 h MEX-MTY por falla técnica, boleto 2 000 → 25 % = 500 MXN probablemente", { evento: "retraso", origen: "MEX", destino: "MTY", aerolinea: "VB", horas_retraso_salida: 5, motivo: "falla técnica", precio: { monto: 2000, moneda: "MXN" } },
    { derecho: "MX_indemnizacion_25", certeza: "probablemente", monto: [500, "MXN"], fuente: "MX_LAC_47BIS_VI" }),
  E("29 · Retraso de 5 h MEX-CUN por mal clima → depende (caso fortuito)", { evento: "retraso", origen: "MEX", destino: "CUN", aerolinea: "Y4", horas_retraso_salida: 5, motivo: "tormenta" },
    { derecho: "MX_retraso_4h", certeza: "depende", fuente: "MX_LAC_47BIS_V" }),
  E("30 · Retraso de 4 h exactas en México → depende (la ley dice «inferior a 4» y «mayor a 4»)", { evento: "retraso", origen: "MEX", destino: "CUN", aerolinea: "AM", horas_retraso_salida: 4 },
    { derecho: "MX_4h_exactas", certeza: "depende", fuente: "MX_LAC_47BIS_V" }),
  E("31 · Retraso de 40 min en México → sin compensación", { evento: "retraso", origen: "MEX", destino: "GDL", aerolinea: "AM", horas_retraso_salida: 0.67 },
    { derecho: "MX_sin_compensacion", certeza: "te_corresponde", fuente: "MX_LAC_47BIS_V" }),
  E("32 · Cancelación MEX-CUN atribuible (operativa), boleto 4 000 → reembolso + 25 % = 1 000 MXN", { evento: "cancelacion", origen: "MEX", destino: "CUN", aerolinea: "AM", motivo: "razones operativas", precio: { monto: 4000, moneda: "MXN" } },
    { derecho: "MX_indemnizacion_25", certeza: "te_corresponde", monto: [1000, "MXN"], fuente: "MX_LAC_47BIS_VI" }),
  E("33 · Sobreventa en Volaris GDL-TIJ (involuntaria), boleto 2 500 → 25 % = 625 MXN", { evento: "sobreventa", origen: "GDL", destino: "TIJ", aerolinea: "Volaris", voluntario: false, precio: { monto: 2500, moneda: "MXN" } },
    { derecho: "MX_indemnizacion_25", certeza: "te_corresponde", monto: [625, "MXN"], fuente: "MX_LAC_52" }),
  E("34 · Sobreventa voluntaria en Volaris → beneficios acordados, nunca menores a la ley", { evento: "sobreventa", origen: "GDL", destino: "TIJ", aerolinea: "Y4", voluntario: true },
    { derecho: "MX_voluntario", certeza: "te_corresponde", fuente: "MX_LAC_52", sin: ["MX_indemnizacion_25"] }),
  E("35 · Equipaje facturado perdido en vuelo nacional MEX-CUN → 150 UMA", { evento: "equipaje_perdido", origen: "MEX", destino: "CUN", aerolinea: "AM" },
    { derecho: "MX_equipaje", certeza: "te_corresponde", monto: [Math.round(150 * UMA_2026_MXN * 100) / 100, "MXN"], fuente: "MX_LAC_62" }),
  E("36 · Equipaje de mano dañado en vuelo nacional → hasta 80 UMA", { evento: "equipaje_danado", origen: "MEX", destino: "GDL", aerolinea: "Y4", equipaje: { de_mano: true } },
    { derecho: "MX_equipaje", monto: [Math.round(80 * UMA_2026_MXN * 100) / 100, "MXN"], fuente: "MX_LAC_62" }),
  // ── Convenio de Montreal ──
  E("37 · Equipaje perdido MEX-MAD (internacional) → hasta 1 519 DEG", { evento: "equipaje_perdido", origen: "MEX", destino: "MAD", aerolinea: "AM" },
    { derecho: "MC_perdido", certeza: "probablemente", monto: [1519, "DEG"], fuente: "MC99_LIMITES_2024", sin: ["MX_equipaje"] }),
  E("38 · Equipaje dañado CDG-MEX recibido hace 10 días → fuera del plazo de 7 días", { evento: "equipaje_danado", origen: "CDG", destino: "MEX", aerolinea: "AF", equipaje: { dias_desde_recibido: 10 } },
    { derecho: "MC_danado", certeza: "depende", fuente: "MC99_31" }),
  E("39 · Equipaje retrasado CDG-MEX → reclamo por escrito en 21 días", { evento: "equipaje_retrasado", origen: "CDG", destino: "MEX", aerolinea: "AF" },
    { derecho: "MC_retrasado", fuente: "MC99_31" }),
  // ── Estados Unidos (DOT) ──
  E("40 · Reembolso DOT por cancelación de United ORD-MEX → reembolso completo", { evento: "cancelacion", origen: "ORD", destino: "MEX", aerolinea: "UA" },
    { derecho: "US_reembolso", certeza: "te_corresponde", fuente: "US_260", regimenes: ["US_DOT", "MX_LAC"] }),
  E("41 · Cancelación United JFK-LAX (nacional EE. UU.) → reembolso; sin ley mexicana", { evento: "cancelacion", origen: "JFK", destino: "LAX", aerolinea: "UA" },
    { derecho: "US_reembolso", certeza: "te_corresponde", fuente: "US_260", sin: ["MX_cancelacion"] }),
  E("42 · Retraso de 3 h DFW-ORD (nacional) → cambio significativo: reembolso si no vuelas", { evento: "retraso", origen: "DFW", destino: "ORD", aerolinea: "AA", horas_retraso_llegada: 3 },
    { derecho: "US_reembolso", certeza: "te_corresponde", fuente: "US_260" }),
  E("43 · Retraso de 4 h MEX-MIA (internacional) → aún no es cambio significativo (6 h); sin compensación federal", { evento: "retraso", origen: "MEX", destino: "MIA", aerolinea: "AA", horas_retraso_llegada: 4 },
    { derecho: "US_sin_compensacion_retraso", certeza: "depende", fuente: "US_260", sin: ["US_reembolso"] }),
  E("44 · Sobreventa JFK-LAX, tarifa 300 USD, llega 1.5 h tarde → 200 % = 600 USD", { evento: "sobreventa", origen: "JFK", destino: "LAX", aerolinea: "DL", voluntario: false, reubicacion: { ofrecida: true, llega_despues_horas: 1.5 }, precio: { monto: 300, moneda: "USD" } },
    { derecho: "US_dbc", certeza: "te_corresponde", monto: [600, "USD"], fuente: "US_250" }),
  E("45 · Sobreventa JFK-LAX, tarifa 300 USD, llega 3 h tarde → 400 % = 1 200 USD", { evento: "sobreventa", origen: "JFK", destino: "LAX", aerolinea: "DL", voluntario: false, reubicacion: { ofrecida: true, llega_despues_horas: 3 }, precio: { monto: 300, moneda: "USD" } },
    { derecho: "US_dbc", monto: [1200, "USD"], fuente: "US_250" }),
  E("46 · Sobreventa JFK-LAX, tarifa 800 USD, llega 3 h tarde → tope 2 150 USD", { evento: "sobreventa", origen: "JFK", destino: "LAX", aerolinea: "DL", voluntario: false, reubicacion: { ofrecida: true, llega_despues_horas: 3 }, precio: { monto: 800, moneda: "USD" } },
    { derecho: "US_dbc", monto: [2150, "USD"], fuente: "US_250" }),
  E("47 · Sobreventa JFK-MEX (internacional), 400 USD, llega 3 h tarde → 200 % = 800 USD", { evento: "sobreventa", origen: "JFK", destino: "MEX", aerolinea: "AM", voluntario: false, reubicacion: { ofrecida: true, llega_despues_horas: 3 }, precio: { monto: 400, moneda: "USD" } },
    { derecho: "US_dbc", monto: [800, "USD"], fuente: "US_250" }),
  E("48 · Sobreventa MEX-JFK: la regla del DOT no cubre vuelos que salen de fuera de EE. UU.", { evento: "sobreventa", origen: "MEX", destino: "JFK", aerolinea: "AM", voluntario: false },
    { derecho: "US_dbc_no_aplica", fuente: "US_250" }),
  E("49 · Equipaje retrasado JFK-LAX → responsabilidad mínima 4 700 USD y reembolso del cargo", { evento: "equipaje_retrasado", origen: "JFK", destino: "LAX", aerolinea: "AA" },
    { derecho: "US_cargo_maleta", certeza: "te_corresponde", fuente: "US_260_BAGS" }),
  // ── Canadá (APPR) ──
  E("50 · YYZ-MEX (Air Canada) llega 7 h tarde por tripulación → CAD 700 si es aerolínea grande", { evento: "retraso", origen: "YYZ", destino: "MEX", aerolinea: "AC", horas_retraso_llegada: 7, motivo: "tripulación" },
    { derecho: "CA_compensacion", certeza: "depende", monto: [700, "CAD"], fuente: "CA_APPR_19" }),
  E("51 · YVR-YYZ con 4 h por clima → sin compensación; sí otro vuelo o reembolso", { evento: "retraso", origen: "YVR", destino: "YYZ", aerolinea: "WS", horas_retraso_llegada: 4, horas_retraso_salida: 4, motivo: "tormenta de nieve" },
    { derecho: "CA_alternativa", certeza: "te_corresponde", fuente: "CA_APPR_17" }),
  E("52 · Cancelación en Canadá avisada con 20 días → sin compensación", { evento: "cancelacion", origen: "YYZ", destino: "YVR", aerolinea: "AC", aviso_dias: 20 },
    { derecho: "CA_sin_compensacion", certeza: "te_corresponde", fuente: "CA_APPR_12" }),
  E("53 · Denegación de embarque YYZ-YVR, llega 5 h tarde → CAD 900", { evento: "sobreventa", origen: "YYZ", destino: "YVR", aerolinea: "AC", voluntario: false, horas_retraso_llegada: 5 },
    { derecho: "CA_dbc", certeza: "te_corresponde", monto: [900, "CAD"], fuente: "CA_APPR_20" }),
  // ── Brasil (ANAC 400) ──
  E("54 · GRU-GIG (nacional) con 3 h → asistencia material (comunicación y alimentación)", { evento: "retraso", origen: "GRU", destino: "GIG", aerolinea: "G3", horas_retraso_salida: 3 },
    { derecho: "BR_assistencia", certeza: "te_corresponde", fuente: "BR_ANAC400_27", sin: ["BR_alternativas"] }),
  E("55 · Preterição GRU-GIG → 250 DEG inmediatos", { evento: "sobreventa", origen: "GRU", destino: "GIG", aerolinea: "LA", voluntario: false },
    { derecho: "BR_pretericao", certeza: "te_corresponde", monto: [250, "DEG"], fuente: "BR_ANAC400_24" }),
  E("56 · Preterição GRU-MEX (internacional) → 500 DEG", { evento: "sobreventa", origen: "GRU", destino: "MEX", aerolinea: "AM", voluntario: false },
    { derecho: "BR_pretericao", monto: [500, "DEG"], fuente: "BR_ANAC400_24" }),
];

describe("motor de derechos · escenarios reales con su fuente", () => {
  it("hay al menos 40 escenarios", () => {
    expect(ESCENARIOS.length).toBeGreaterThanOrEqual(40);
  });
  for (const esc of ESCENARIOS) {
    it(esc.n, () => {
      const e = evaluarVuelo(esc.caso);
      const d = e.derechos.find((x) => x.id === esc.espera.derecho);
      expect(d, `${esc.espera.derecho} en ${e.derechos.map((x) => x.id).join(", ")}`).toBeTruthy();
      if (esc.espera.certeza) expect(d!.certeza).toBe(esc.espera.certeza);
      if (esc.espera.monto) {
        expect(d!.monto?.valor).toBeCloseTo(esc.espera.monto[0], 2);
        expect(d!.monto?.moneda).toBe(esc.espera.monto[1]);
      }
      expect(d!.fuente).toBe(esc.espera.fuente);
      // Toda afirmación cita una fuente verificada hoy (nunca una NO VERIFICADA).
      for (const x of e.derechos) expect(FUENTES[x.fuente]?.estado, x.fuente).toBe("verificado");
      for (const id of esc.espera.sin ?? []) expect(e.derechos.some((x) => x.id === id), `no debe haber ${id}`).toBe(false);
      for (const r of esc.espera.regimenes ?? []) expect(e.regimenes.map((x) => x.id)).toContain(r);
      // Siempre: pruebas, qué hacer ahora y a quién reclamar (la aerolínea primero).
      expect(e.pruebas.length).toBeGreaterThan(2);
      expect(e.ahora.length).toBeGreaterThan(0);
      expect(e.reclamar[0].a_quien).toBe("aerolinea");
    });
  }
});

describe("motor de derechos · reglas transversales", () => {
  it("clasifica el motivo que da la aerolínea", () => {
    expect(clasificarMotivo("Mal clima en el aeropuerto")).toBe("clima");
    expect(clasificarMotivo("Restricción de control de tráfico aéreo")).toBe("atc");
    expect(clasificarMotivo("falla mecánica")).toBe("tecnico");
    expect(clasificarMotivo("falta de tripulación")).toBe("tripulacion");
    expect(clasificarMotivo("")).toBe("desconocido");
  });
  it("la ruta a quién reclamar sigue el país: MAD → AESA; CDG → DGAC; México → PROFECO; EE. UU. → DOT", () => {
    const madrid = evaluarVuelo({ evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 3 });
    expect(madrid.reclamar.map((p) => p.organismo_id)).toEqual([undefined, "NEB_ES", "PROFECO"]);
    const paris = evaluarVuelo({ evento: "retraso", origen: "CDG", destino: "MEX", aerolinea: "AF", horas_retraso_llegada: 4 });
    expect(paris.reclamar[1].organismo_id).toBe("NEB_FR");
    const united = evaluarVuelo({ evento: "cancelacion", origen: "ORD", destino: "MEX", aerolinea: "UA" });
    expect(united.reclamar.map((p) => p.organismo_id)).toContain("DOT");
  });
  it("NUNCA da un correo de aerolínea que no se leyó en su página oficial (United: no verificado)", () => {
    const e = evaluarVuelo({ evento: "cancelacion", origen: "ORD", destino: "MEX", aerolinea: "UA" });
    expect(e.reclamar[0].correo).toBeNull();
    expect(e.reclamar[0].url).toBeNull();
    expect(e.reclamar[0].verificacion).toMatch(/^no_verificado/);
  });
  it("aerolínea desconocida o aeropuerto sin coordenadas → lo dice, no inventa", () => {
    const e = evaluarVuelo({ evento: "retraso", origen: "XYZ", destino: "MAD", pais_origen: "ES", aerolinea: "Aerolínea Fantasma", horas_retraso_llegada: 5 });
    expect(e.avisos.join(" ")).toMatch(/No reconocimos la aerolínea/);
    expect(e.ruta.distancia_km).toBeNull();
    expect(e.derechos.find((d) => d.id === "EU261_compensacion")?.certeza).toBe("depende");
  });
  it("sin ninguna ley aplicable (vuelo dentro de Japón) lo dice", () => {
    const e = evaluarVuelo({ evento: "retraso", origen: "HND", destino: "KIX", aerolinea: "NH", horas_retraso_llegada: 5 });
    expect(e.regimenes).toHaveLength(0);
    expect(e.resumen).toMatch(/No encontramos una ley/);
  });
  it("el resumen dice la certeza y la cantidad", () => {
    const e = evaluarVuelo({ evento: "cancelacion", origen: "MAD", destino: "MEX", aerolinea: "IB", aviso_dias: 3, reubicacion: { ofrecida: false }, motivo: "operativo" });
    expect(e.resumen).toMatch(/^Te corresponde: 600 EUR/);
  });
  it("en México avisa que el retraso legal cuenta desde la salida si solo dimos la llegada", () => {
    const e = evaluarVuelo({ evento: "retraso", origen: "MEX", destino: "CUN", aerolinea: "AM", horas_retraso_llegada: 3 });
    expect(e.avisos.join(" ")).toMatch(/hora de SALIDA/);
    expect(e.derechos.find((d) => d.id === "MX_descuento_75")?.certeza).toBe("probablemente");
  });
});
