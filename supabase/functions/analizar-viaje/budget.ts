// Presupuesto del análisis de viaje (sin dependencias de Deno, para probar el código real).
//
// El modelo propone un desglose; aquí se recalcula de forma determinista con las opciones que
// el usuario va a ver, respetando lo que el usuario excluyó, y total = suma exacta del desglose.

export const TIER_ORDER = ["ahorro", "equilibrio", "premium"];

/** Una habitación doble por cada 2 viajeros (mismo criterio que logistics-plan). */
export const roomsFor = (travelers: number) => Math.max(1, Math.ceil((Number(travelers) || 1) / 2));

/** Techo de comida por persona y día (fine dining: hasta $4,000 MXN por comida, 3 comidas). */
export const COMIDA_TECHO_DIA_PP = 12000;

/**
 * Agrupa los vuelos en los 3 tiers. Si el modelo devolvió varios tramos del mismo tier, se suman
 * (el precio de un tier es la ruta completa por persona). El tier se compara sin mayúsculas: antes
 * "Premium" no coincidía, caía en "equilibrio" y se sumaba ahí, inflando el vuelo base.
 */
export function normalizarVuelos(vuelos: any[]): any[] {
  if (!Array.isArray(vuelos)) return [];

  const agrupados = new Map<string, any>();
  for (const vuelo of vuelos) {
    const raw = String(vuelo?.tier ?? "").trim().toLowerCase();
    const tier = TIER_ORDER.includes(raw) ? raw : "equilibrio";
    const precio = Number(vuelo?.precio_por_persona) || 0;
    const existente = agrupados.get(tier);

    if (!existente) {
      agrupados.set(tier, { ...vuelo, tier, precio_por_persona: precio, _segmentos: [vuelo] });
      continue;
    }
    existente.precio_por_persona += precio;
    existente._segmentos.push(vuelo);
  }

  return TIER_ORDER.map((tier) => agrupados.get(tier))
    .filter(Boolean)
    .map((vuelo) => {
      const segmentos = vuelo._segmentos ?? [];
      const aerolineas = [...new Set(segmentos.map((s: any) => s?.aerolinea).filter(Boolean))];
      const notasSegmentos = segmentos
        .map((s: any) => `${s?.aerolinea ?? "Vuelo"}: $${Math.round(Number(s?.precio_por_persona) || 0).toLocaleString("es-MX")} MXN`)
        .join(" + ");
      const normalizado = {
        ...vuelo,
        aerolinea: segmentos.length > 1 ? aerolineas.join(" + ") : vuelo.aerolinea,
        duracion: segmentos.length > 1 ? "Ruta completa, varios segmentos" : vuelo.duracion,
        escalas: segmentos.length > 1 ? `${segmentos.length} segmentos sumados` : vuelo.escalas,
        // Varios tramos sumados ya no son "el" vuelo de una lista en vivo: es un total armado.
        ...(segmentos.length > 1 ? { fuente_precio: "estimado" } : {}),
        precio_por_persona: Math.round(vuelo.precio_por_persona),
        notas: segmentos.length > 1 ? `Total por persona sumando todos los tramos: ${notasSegmentos}` : vuelo.notas,
      };
      delete normalizado._segmentos;
      return normalizado;
    });
}

export type Exclusions = {
  vuelos: boolean;
  /** "all": sin hospedaje en todo el viaje · "partial": solo en alguna ciudad · false: incluido. */
  hospedaje: "all" | "partial" | false;
  tours: boolean;
  comida: boolean;
};

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ");

/**
 * Lo que el usuario dijo que NO quiere cotizar ("ya tengo vuelo", "sin hotel en París", "solo
 * vuelos"). Antes el recálculo del servidor volvía a sumar esos renglones aunque el modelo los
 * hubiera dejado en 0.
 */
export function detectExclusions(notas: unknown): Exclusions {
  const t = norm(notas);
  const out: Exclusions = { vuelos: false, hospedaje: false, tours: false, comida: false };
  if (!t) return out;

  const LODGING = "(hotel(es)?|hospedaje|alojamiento|donde (quedarme|quedarnos|dormir)|airbnb)";
  const FLIGHT = "(vuelos?|avion|boletos? de avion)";

  if (new RegExp(`(ya tengo|ya tenemos|ya compre|ya compramos|sin|no (necesito|necesitamos|quiero|queremos|incluyas|cotices)) (el |los |mi |mis |nuestro |nuestros )?${FLIGHT}`).test(t) ||
      new RegExp(`\\bsolo (el |los )?${LODGING}`).test(t) ||
      /\b(vamos|voy|iremos|ire) (en|por) (carro|coche|auto|camion|autobus|tren)\b/.test(t)) {
    out.vuelos = true;
  }

  // Exclusión de hospedaje por frase: "sin hotel", "ya tengo hotel", "París sin hospedaje"… Es
  // parcial si la frase nombra una ciudad ("en Roma", o "París sin hospedaje").
  const lodgingRe = new RegExp(`(ya tengo|ya tenemos|sin|no (necesito|necesitamos|quiero|queremos|incluyas|cotices)) (el |los |un |mi |nuestro )?${LODGING}`);
  for (const clause of String(notas ?? "").split(/[,.;\n]| pero | y luego /i)) {
    const c = norm(clause);
    if (!lodgingRe.test(c)) continue;
    const cityAfter = /\b(en|para) (?!todo|ningun|ninguna|nada|el viaje)[a-z]/.test(c);
    const cityBefore = /[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+(sin|no)\b/.test(clause.trim());
    const partial = cityAfter || cityBefore;
    out.hospedaje = partial ? (out.hospedaje === "all" ? "all" : "partial") : "all";
  }
  if (new RegExp(`\\bsolo (el |los )?${FLIGHT}`).test(t)) {
    out.hospedaje = "all";
    out.tours = true;
  }
  if (/\b(sin|no (quiero|queremos|incluyas|cotices)) (tours?|actividades|experiencias|excursiones)\b/.test(t)) out.tours = true;
  if (/\b(sin|no (quiero|queremos|incluyas|cotices)) (la |las )?(comidas?|alimentos)\b/.test(t)) out.comida = true;
  return out;
}

export type BudgetInput = {
  /** Noches del viaje (diferencia entre fechas). */
  dias: number;
  viajeros: number;
  notas?: string | null;
};

export type BudgetResult = {
  desglose: Record<string, number>;
  total: number;
  valido: boolean;
  exclusions: Exclusions;
  rooms: number;
  /** Hotel usado como referencia del renglón de hospedaje (precio medio). */
  hotelReferencia: any | null;
  /** Vuelo usado como referencia del renglón de vuelos (tier equilibrio). */
  vueloReferencia: any | null;
};

/**
 * Desglose final de analizar-viaje:
 * - vuelos = vuelo "equilibrio" × viajeros, salvo que el usuario lo excluyó o el modelo lo dejó en 0.
 * - hospedaje = hotel de precio medio × noches × habitaciones (ceil(viajeros/2)); antes era una
 *   sola habitación sin importar cuántos viajaban. Si el usuario excluyó una ciudad se respeta el
 *   monto del modelo (que ya descontó esas noches) y nunca se sube por encima del cálculo completo.
 * - comida: acotada al techo por persona y día.
 * - total = suma exacta del desglose; si la suma es 0 la cotización no es válida.
 */
export function reconcileBudget(a: any, input: BudgetInput): BudgetResult {
  const dias = Math.max(1, Math.round(Number(input.dias) || 1));
  const viajeros = Math.max(1, Math.round(Number(input.viajeros) || 1));
  const exclusions = detectExclusions(input.notas);
  const rooms = roomsFor(viajeros);
  const desglose: Record<string, number> = {};
  for (const [k, v] of Object.entries(a?.desglose_presupuesto ?? {})) desglose[k] = Number(v) || 0;

  const vuelos: any[] = Array.isArray(a?.vuelos) ? a.vuelos : [];
  const vueloReferencia = vuelos.find((v) => v?.tier === "equilibrio") ?? vuelos[0] ?? null;
  if (exclusions.vuelos) {
    desglose.vuelos = 0;
  } else if ((desglose.vuelos ?? 0) > 0) {
    const vuelosGrupo = Math.round((Number(vueloReferencia?.precio_por_persona) || 0) * viajeros);
    if (vuelosGrupo > 0) desglose.vuelos = vuelosGrupo;
  }

  const hoteles: any[] = Array.isArray(a?.hospedaje) ? a.hospedaje : [];
  const ordenados = [...hoteles].sort((x, y) => (Number(x?.precio_por_noche) || 0) - (Number(y?.precio_por_noche) || 0));
  const hotelReferencia = ordenados.length ? ordenados[Math.floor(ordenados.length / 2)] : null;
  const hospedajeCompleto = Math.round((Number(hotelReferencia?.precio_por_noche) || 0) * dias * rooms);
  if (exclusions.hospedaje === "all") {
    desglose.hospedaje = 0;
  } else if (exclusions.hospedaje === "partial") {
    if (hospedajeCompleto > 0) desglose.hospedaje = Math.min(desglose.hospedaje ?? 0, hospedajeCompleto);
  } else if ((desglose.hospedaje ?? 0) > 0 && hospedajeCompleto > 0) {
    desglose.hospedaje = hospedajeCompleto;
  }

  if (exclusions.tours) desglose.tours = 0;
  if (exclusions.comida) desglose.comida = 0;
  const comidaTecho = COMIDA_TECHO_DIA_PP * dias * viajeros;
  if ((desglose.comida ?? 0) > comidaTecho) desglose.comida = comidaTecho;

  for (const k of ["vuelos", "hospedaje", "comida", "tours", "transporte_local", "extras"]) {
    desglose[k] = Math.max(0, Math.round(desglose[k] ?? 0));
  }
  for (const k of Object.keys(desglose)) desglose[k] = Math.max(0, Math.round(desglose[k]));
  const total = Object.values(desglose).reduce((s, v) => s + v, 0);
  return { desglose, total, valido: total > 0, exclusions, rooms, hotelReferencia, vueloReferencia };
}
