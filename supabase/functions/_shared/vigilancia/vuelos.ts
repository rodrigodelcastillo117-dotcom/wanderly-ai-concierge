// Vigilancia proactiva · vuelos. Reglas puras (sin Deno, sin red): qué vuelo se vigila, cada cuánto se revisa
// (nunca antes de 48 h, más seguido el día del vuelo, con el cupo diario de SerpApi), qué cambio es un evento
// (cancelación, retraso grande, cambio de puerta o terminal, desvío), qué derechos tiene el viajero y qué se le
// dice. Nunca se inventa un estado: solo el widget estructurado del día pedido (flight-serpapi.ts) cuenta como
// dato; todo lo demás es "fuente no concluyente" y no crea pánico. Probado en src/test/vigilanciaVuelos.test.ts.
import type { FlightData } from "../flight-serpapi.ts";
import { airportCityName } from "../airports.ts";
import { timeZoneFor, utcOffsetMinutes } from "../worldClock.ts";
import { type CasoVuelo, ETIQUETA_CERTEZA, type Evaluacion, evaluarVuelo } from "../derechos/motor.ts";
import { airlineName } from "../airlines.ts";

const H = 3_600_000;
const MIN = 60_000;

export type ConfigVigilancia = {
  enabled: boolean;
  serp_tope_diario: number;
  avisos_tope_diario: number;
  hora_desde: number;
  hora_hasta: number;
  retraso_aviso_min: number;
  retraso_incidente_min: number;
  incidente_por_puerta: boolean;
  confirmar_desde_horas: number;
  confirmacion_limite_horas: number;
  sin_respuesta_horas: number;
};

export const CONFIG_POR_OMISION: ConfigVigilancia = {
  enabled: true, serp_tope_diario: 30, avisos_tope_diario: 3, hora_desde: 8, hora_hasta: 21, retraso_aviso_min: 60,
  retraso_incidente_min: 120, incidente_por_puerta: false, confirmar_desde_horas: 48, confirmacion_limite_horas: 8, sin_respuesta_horas: 12,
};

export function configDe(raw: unknown): ConfigVigilancia {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof ConfigVigilancia) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? r[k] as number : CONFIG_POR_OMISION[k] as number);
  return {
    enabled: r.enabled === true, serp_tope_diario: n("serp_tope_diario"), avisos_tope_diario: n("avisos_tope_diario"),
    hora_desde: n("hora_desde"), hora_hasta: n("hora_hasta"), retraso_aviso_min: n("retraso_aviso_min"),
    retraso_incidente_min: n("retraso_incidente_min"), incidente_por_puerta: r.incidente_por_puerta === true,
    confirmar_desde_horas: n("confirmar_desde_horas"), confirmacion_limite_horas: n("confirmacion_limite_horas"),
    sin_respuesta_horas: n("sin_respuesta_horas"),
  };
}

// ───────────────────────────── Identificar el vuelo ─────────────────────────────

const VUELO_RE = /^[A-Z0-9]{2}[A-Z]?[0-9]{1,4}[A-Z]?$/;
/** "am 401" → "AM401". null si no parece número de vuelo. */
export function normalizarVuelo(v: unknown): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[\s-]+/g, "");
  return VUELO_RE.test(s) && /\d/.test(s.slice(2)) ? s : null;
}

const IATA = /^[A-Z]{3}$/;
const iata = (v: unknown): string | null => {
  const s = String(v ?? "").trim().toUpperCase();
  return IATA.test(s) ? s : null;
};

/** "MEX-MAD", "MEX → MAD", "MEX MAD" → [MEX, MAD]. */
export function rutaDe(r: unknown): [string | null, string | null] {
  const m = /^\s*([A-Za-z]{3})\s*(?:-|–|→|>|\/|\s)\s*([A-Za-z]{3})\s*$/.exec(String(r ?? ""));
  return m ? [m[1].toUpperCase(), m[2].toUpperCase()] : [null, null];
}

/** Instante UTC de una hora local "HH:MM" del día `fecha` en la zona `tz` (con horario de verano). */
export function localAUtc(fecha: string, hhmm: string, tz: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const [y, mo, d] = fecha.split("-").map(Number);
  const guess = Date.UTC(y, mo - 1, d, Number(m[1]), Number(m[2]));
  if (!Number.isFinite(guess)) return null;
  try {
    let off = utcOffsetMinutes(new Date(guess), tz);
    let t = guess - off * MIN;
    off = utcOffsetMinutes(new Date(t), tz);
    t = guess - off * MIN;
    return new Date(t);
  } catch {
    return null;
  }
}

export type CandidatoVuelo = {
  fuente: "seguimiento" | "viaje";
  user_id: string;
  trip_id?: string | null;
  vuelo: string;
  fecha: string;
  ruta?: string | null;
  hora_salida?: string | null;
  origen?: string | null;
  destino?: string | null;
  ciudad_salida?: string | null;
  ciudad_origen?: string | null;
};

export type FilaNueva = {
  user_id: string; trip_id: string | null; vuelo: string; fecha: string; origen: string | null; destino: string | null;
  fuente: "seguimiento" | "viaje"; zona_origen: string | null; salida_at: string; salida_exacta: boolean; proxima_revision_at: string;
};

/**
 * Del candidato (seguimiento o itinerario) a la fila vigilada. Sin hora conocida se usa el PEOR caso (fin del día
 * en la zona de salida, o en UTC−12 si no se sabe la zona): así nunca se revisa antes de 48 h de la salida real.
 */
export function vueloDeCandidato(c: CandidatoVuelo, ahora: Date): FilaNueva | null {
  const vuelo = normalizarVuelo(c.vuelo);
  if (!vuelo || !c.user_id || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.fecha ?? ""))) return null;
  const [rO, rD] = rutaDe(c.ruta);
  const origen = iata(c.origen) ?? rO;
  const destino = iata(c.destino) ?? rD;
  const zona = (origen ? timeZoneFor(airportCityName(origen)) : null) ?? timeZoneFor(c.ciudad_salida) ?? null;
  const exacta = c.hora_salida && zona ? localAUtc(c.fecha, c.hora_salida, zona) : null;
  const peor = zona ? localAUtc(c.fecha, "23:59", zona) : null;
  const salida = exacta ?? peor ?? new Date(Date.parse(`${c.fecha}T23:59:00Z`) + 12 * H);
  const primera = proximaRevision({ salida_at: salida.toISOString(), salida_exacta: !!exacta, llegada_at: null }, ahora, 0, false, true);
  if (!primera) return null;
  return {
    user_id: c.user_id, trip_id: c.trip_id ?? null, vuelo, fecha: c.fecha, origen, destino, fuente: c.fuente, zona_origen: zona,
    salida_at: salida.toISOString(), salida_exacta: !!exacta, proxima_revision_at: primera.toISOString(),
  };
}

// ───────────────────────────── Frecuencia ─────────────────────────────

/**
 * Cuándo toca la siguiente revisión (null = dejar de vigilar). Costo por vuelo ≈ 15 búsquedas:
 *   > 48 h antes      nada (la primera revisión es a las 48 h)
 *   48–24 h           una (a las 48 h) y la siguiente a las 24 h
 *   24–6 h            cada 6 h
 *   6–2 h             cada hora
 *   2–0 h             cada 30 min
 *   en el aire        cada 90 min hasta 30 min después de la llegada (desvíos); sin llegada conocida, hasta 8 h
 *                     después de la salida (o 2 h si la salida era solo estimada)
 * Tras 3 fallas seguidas de la fuente, al menos 1 h; tras 6, al menos 3 h. Nunca se salta un umbral (48/24/6/2/0 h).
 */
export function proximaRevision(
  v: { salida_at: string | null; salida_exacta: boolean; llegada_at: string | null },
  ahora: Date, fallas: number, terminado: boolean, primera = false,
): Date | null {
  if (terminado) return null;
  const salida = v.salida_at ? Date.parse(v.salida_at) : NaN;
  if (!Number.isFinite(salida)) return null;
  const t = ahora.getTime();
  const h = (salida - t) / H;
  if (h > 48) return new Date(salida - 48 * H);
  if (primera) return ahora;
  let gap: number;
  if (h > 24) gap = 24 * H;
  else if (h > 6) gap = 6 * H;
  else if (h > 2) gap = 1 * H;
  else if (h > 0) gap = 30 * MIN;
  else {
    const llegada = v.llegada_at ? Date.parse(v.llegada_at) : NaN;
    const fin = Number.isFinite(llegada) ? llegada + 30 * MIN : salida + (v.salida_exacta ? 8 : 2) * H;
    if (t >= fin) return null;
    gap = 90 * MIN;
  }
  if (fallas >= 6) gap = Math.max(gap, 3 * H);
  else if (fallas >= 3) gap = Math.max(gap, 1 * H);
  let next = t + gap;
  for (const umbral of [24, 6, 2, 0]) {
    const b = salida - umbral * H;
    if (b > t + 5 * MIN && b < next) next = b;
  }
  return new Date(next);
}

/** Búsquedas de SerpApi que gasta, como máximo, un vuelo con salida exacta y llegada `durH` horas después. */
export function busquedasPorVuelo(durH = 3): number {
  const salida = Date.UTC(2026, 10, 3, 12);
  let t = salida - 48 * H;
  let n = 0;
  let r: Date | null = new Date(t);
  const v = { salida_at: new Date(salida).toISOString(), salida_exacta: true, llegada_at: new Date(salida + durH * H).toISOString() };
  while (r && n < 200) {
    n++;
    t = r.getTime();
    r = proximaRevision(v, new Date(t), 0, false);
  }
  return n;
}

// ───────────────────────────── Eventos ─────────────────────────────

export type EstadoVuelo = {
  status?: string | null;
  gate?: string | null;
  terminal?: string | null;
  delay?: number | null;
  /** Horas de retraso ya avisadas (1 = 60–119 min, 2 = 120–179…). */
  banda?: number | null;
  estimada?: string | null;
  provider_status?: string | null;
  desviado?: boolean;
  origen?: string | null;
  destino?: string | null;
  consultado_at?: string | null;
};

export type TipoEvento = "cancelado" | "retraso" | "puerta" | "terminal" | "desvio";
export type EventoVuelo = {
  tipo: TipoEvento;
  /** Abre (o actualiza) un incidente. */
  incidente: boolean;
  urgente: boolean;
  banda?: number;
  antes?: string | null;
  ahora?: string | null;
  retrasoMin?: number | null;
};

const conocido = (s: unknown) => (typeof s === "string" && s && s !== "desconocido" ? s : null);

/**
 * Compara lo último visto con la lectura nueva. Solo con datos del widget del día pedido. Un estado "desconocido"
 * no borra lo anterior ni genera eventos. La primera puerta asignada NO es un cambio (no se avisa).
 */
export function detectarEventos(prev: EstadoVuelo, d: FlightData, cfg: Pick<ConfigVigilancia, "retraso_aviso_min" | "retraso_incidente_min" | "incidente_por_puerta">, ahoraIso?: string):
  { eventos: EventoVuelo[]; estado: EstadoVuelo; terminado: boolean } {
  const eventos: EventoVuelo[] = [];
  const status = conocido(d.status) ?? conocido(prev.status);
  const desviado = prev.desviado === true || /DIVERT/i.test(String(d.provider_status ?? ""));
  if (desviado && !prev.desviado) eventos.push({ tipo: "desvio", incidente: true, urgente: true, antes: prev.destino ?? null, ahora: d.destination ?? null });

  if (d.status === "cancelado" && prev.status !== "cancelado") {
    eventos.push({ tipo: "cancelado", incidente: true, urgente: true });
  }

  const delay = typeof d.delay_minutes === "number" ? d.delay_minutes : null;
  let banda = prev.banda ?? 0;
  if (d.status !== "cancelado" && delay != null && delay >= cfg.retraso_aviso_min) {
    const b = Math.max(1, Math.floor(delay / 60));
    if (b > banda) {
      eventos.push({ tipo: "retraso", incidente: delay >= cfg.retraso_incidente_min, urgente: true, banda: b, retrasoMin: delay,
        antes: d.scheduled_departure ?? null, ahora: d.estimated_departure ?? null });
      banda = b;
    }
  }

  if (d.gate && prev.gate && d.gate !== prev.gate && d.status !== "cancelado") {
    eventos.push({ tipo: "puerta", incidente: cfg.incidente_por_puerta, urgente: true, antes: prev.gate, ahora: d.gate });
  }
  if (d.terminal && prev.terminal && d.terminal !== prev.terminal && d.status !== "cancelado") {
    eventos.push({ tipo: "terminal", incidente: cfg.incidente_por_puerta, urgente: true, antes: prev.terminal, ahora: d.terminal });
  }

  const estado: EstadoVuelo = {
    status, gate: d.gate ?? prev.gate ?? null, terminal: d.terminal ?? prev.terminal ?? null, delay: delay ?? prev.delay ?? null, banda,
    estimada: d.estimated_departure ?? prev.estimada ?? null, provider_status: d.provider_status ?? prev.provider_status ?? null,
    desviado, origen: d.origin ?? prev.origen ?? null, destino: d.destination ?? prev.destino ?? null, consultado_at: ahoraIso ?? prev.consultado_at ?? null,
  };
  return { eventos, estado, terminado: status === "aterrizado" || status === "cancelado" };
}

/** Clave idempotente del incidente: una por vuelo, fecha, evento y viajero (el retraso que crece es el mismo caso). */
export const claveIncidente = (vuelo: string, fecha: string, tipo: TipoEvento, userId: string) =>
  `vigilancia:${vuelo}:${fecha}:${tipo === "terminal" ? "puerta" : tipo}:${userId}`;

/** Clave del hallazgo en la bitácora (un retraso que pasa de 2 h a 4 h es otro hallazgo). */
export const claveEvento = (vueloId: string, ev: EventoVuelo) =>
  `vuelo:${vueloId}:${ev.tipo}${ev.tipo === "retraso" ? `:${ev.banda}` : ev.tipo === "puerta" || ev.tipo === "terminal" ? `:${ev.ahora}` : ""}`;

// ───────────────────────────── Derechos ─────────────────────────────

export function casoDerechos(ev: EventoVuelo, f: { vuelo: string; fecha: string; origen: string | null; destino: string | null; salida_at?: string | null },
  ahora: Date): CasoVuelo | null {
  if (!f.origen || !f.destino) return null;
  if (ev.tipo !== "cancelado" && ev.tipo !== "retraso" && ev.tipo !== "desvio") return null;
  const salida = f.salida_at ? Date.parse(f.salida_at) : NaN;
  return {
    evento: ev.tipo === "cancelado" ? "cancelacion" : "retraso",
    origen: f.origen, destino: f.destino, aerolinea: f.vuelo, vuelo: f.vuelo, fecha: f.fecha,
    horas_retraso_salida: ev.tipo === "retraso" && ev.retrasoMin ? Math.round((ev.retrasoMin / 60) * 10) / 10 : null,
    aviso_dias: ev.tipo === "cancelado" && Number.isFinite(salida) ? Math.max(0, Math.floor((salida - ahora.getTime()) / (24 * H))) : null,
    hoy: ahora.toISOString().slice(0, 10),
  };
}

export type ResumenDerechos = { texto: string; regimenes: string[]; principal: string | null; ahora: string[]; version: string };

/** Lo esencial de la evaluación para el viajero: qué leyes aplican, lo principal que le corresponde y qué hacer ya. */
export function resumenDerechos(e: Evaluacion): ResumenDerechos {
  const regimenes = e.regimenes.filter((r) => r.aplica !== "depende" || e.regimenes.length <= 2).map((r) => r.nombre);
  const p = e.principal;
  const monto = p?.monto ? ` (${p.monto.tipo === "hasta" ? "hasta " : p.monto.tipo === "minimo" ? "al menos " : ""}${p.monto.valor} ${p.monto.moneda})` : "";
  const principal = p ? `${ETIQUETA_CERTEZA[p.certeza]}: ${p.titulo}${monto}${p.depende_de ? ` — depende de ${p.depende_de}` : ""}` : null;
  const otros = e.derechos.filter((d) => d !== p).slice(0, 3).map((d) => `${ETIQUETA_CERTEZA[d.certeza]}: ${d.titulo}`);
  const ahora = e.ahora.slice(0, 3);
  const texto = [
    regimenes.length ? `Leyes que aplican: ${regimenes.join(", ")}.` : "No identificamos una ley de pasajeros que aplique con certeza.",
    principal, ...otros,
  ].filter(Boolean).join("\n");
  return { texto, regimenes, principal, ahora, version: e.version };
}

export function evaluarDerechos(ev: EventoVuelo, f: Parameters<typeof casoDerechos>[1], ahora: Date): { caso: CasoVuelo; evaluacion: Evaluacion; resumen: ResumenDerechos } | null {
  const caso = casoDerechos(ev, f, ahora);
  if (!caso) return null;
  try {
    const evaluacion = evaluarVuelo(caso);
    return { caso, evaluacion, resumen: resumenDerechos(evaluacion) };
  } catch {
    return null;
  }
}

// ───────────────────────────── Textos para el viajero ─────────────────────────────

const fechaCorta = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" }) : iso;
};

export function horaEn(at: Date, tz: string | null | undefined): string {
  try {
    return at.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz || "UTC" }) + (tz ? "" : " UTC");
  } catch {
    return at.toISOString().slice(11, 16) + " UTC";
  }
}

export const nombreVuelo = (vuelo: string) => {
  const a = airlineName(vuelo.slice(0, 2));
  return a ? `${vuelo} de ${a}` : vuelo;
};

export type ContextoTexto = {
  vuelo: string; fecha: string; origen: string | null; destino: string | null; consultado: Date; zona: string | null;
  folio?: string | null; operadorActivo?: boolean; derechos?: ResumenDerechos | null;
};

const FUENTE = "Fuente: estado del vuelo en Google (datos de la aerolínea, vía SerpApi)";

/** Título y cuerpo del aviso de un evento. Siempre dice la fuente y la hora de consulta; nunca promete. */
export function textoEvento(ev: EventoVuelo, c: ContextoTexto): { titulo: string; cuerpo: string; corto: string } {
  const ruta = c.origen && c.destino ? ` ${c.origen}→${c.destino}` : "";
  const quien = `${nombreVuelo(c.vuelo)}${ruta} del ${fechaCorta(c.fecha)}`;
  const fuente = `${FUENTE}, consultado a las ${horaEn(c.consultado, c.zona)}${c.zona ? " (hora local de tu salida)" : ""}.`;
  const caso = c.folio ? `Abrimos tu caso ${c.folio}: ${c.operadorActivo ? "el operador de IATOS ya está buscando vuelos alternativos y te escribe con opciones" : "una persona del equipo IATOS lo está revisando y te escribe con el siguiente paso"}.` : null;
  const derechos = c.derechos ? `Tus derechos:\n${c.derechos.texto}` : null;
  let titulo: string, corto: string;
  let pasos: string[];
  switch (ev.tipo) {
    case "cancelado":
      titulo = `Tu vuelo ${c.vuelo} aparece cancelado`;
      corto = `${quien} aparece CANCELADO. Abre IATOS: ya trabajamos en alternativas.`;
      pasos = [
        "Confírmalo en la app de la aerolínea o en su mostrador antes de salir al aeropuerto.",
        "Pide por escrito a la aerolínea reubicación en el próximo vuelo o el reembolso; no aceptes un vale si prefieres el dinero.",
        "Guarda boletos, pases de abordar y recibos de comidas, transporte u hotel.",
      ];
      break;
    case "retraso": {
      const h = ev.retrasoMin ? (ev.retrasoMin >= 120 ? `${Math.floor(ev.retrasoMin / 60)} h${ev.retrasoMin % 60 ? ` ${ev.retrasoMin % 60} min` : ""}` : `${ev.retrasoMin} min`) : "";
      titulo = `Tu vuelo ${c.vuelo} viene retrasado${h ? ` ${h}` : ""}`;
      corto = `${quien}: retraso de ${h}${ev.ahora ? `, nueva salida ${ev.ahora}` : ""}.`;
      pasos = [
        ev.ahora ? `Nueva hora estimada de salida: ${ev.ahora}${ev.antes ? ` (programada ${ev.antes})` : ""}. Puede volver a cambiar.` : "La hora estimada aún puede cambiar.",
        "Si tienes conexión, traslado u hotel a la llegada, avísanos para reacomodarlos.",
        (ev.retrasoMin ?? 0) >= 120 ? "Pide a la aerolínea comida y bebida; guarda tus recibos." : "Sigue los anuncios de la aerolínea.",
      ];
      break;
    }
    case "puerta":
      titulo = `Cambio de puerta: ${c.vuelo} sale de la ${ev.ahora}`;
      corto = `${quien}: la puerta cambió de ${ev.antes} a ${ev.ahora}.`;
      pasos = [`La puerta cambió de ${ev.antes} a ${ev.ahora}. Confírmala en las pantallas del aeropuerto.`];
      break;
    case "terminal":
      titulo = `Cambio de terminal: ${c.vuelo} sale de la terminal ${ev.ahora}`;
      corto = `${quien}: la terminal cambió de ${ev.antes} a ${ev.ahora}.`;
      pasos = [`La terminal cambió de ${ev.antes} a ${ev.ahora}. Calcula el tiempo para llegar y confírmala en las pantallas.`];
      break;
    case "desvio":
      titulo = `Tu vuelo ${c.vuelo} aparece desviado`;
      corto = `${quien} aparece desviado${ev.ahora ? ` a ${ev.ahora}` : ""}. Estamos contigo.`;
      pasos = [
        `La fuente marca el vuelo como desviado${ev.ahora ? ` (aeropuerto indicado: ${ev.ahora})` : ""}. Sigue las instrucciones de la tripulación.`,
        "Pide a la aerolínea cómo te llevará a tu destino final y guarda todos tus recibos.",
      ];
      break;
  }
  const cuerpo = [
    `${quien}.`, "Qué hacer ahora:", ...pasos.map((p, i) => `${i + 1}. ${p}`), derechos, caso, fuente,
  ].filter(Boolean).join("\n");
  return { titulo, cuerpo, corto };
}

/** Aviso cuando la fuente no responde cerca de la salida: honesto y sin alarmar. */
export function textoNoConcluyente(c: { vuelo: string; fecha: string; aerolinea?: string | null }): { titulo: string; cuerpo: string } {
  const a = c.aerolinea ?? airlineName(c.vuelo.slice(0, 2)) ?? "la aerolínea";
  return {
    titulo: `No pudimos confirmar el estado de tu vuelo ${c.vuelo}`,
    cuerpo: `Nuestra fuente del estado de vuelos no dio un dato confiable para el ${c.vuelo} del ${fechaCorta(c.fecha)}. Esto NO significa que haya un problema: solo que no lo podemos confirmar. Antes de salir al aeropuerto revisa el estado en la app o el sitio de ${a}. Seguimos intentando y te avisamos si vemos un cambio.`,
  };
}

/** Categoría del incidente para cada evento (las categorías del núcleo de incidentes). */
export const categoriaDe = (t: TipoEvento) => (t === "cancelado" ? "vuelo_cancelado" : t === "retraso" ? "vuelo_retrasado" : "otro") as
  "vuelo_cancelado" | "vuelo_retrasado" | "otro";
