// Vigilancia proactiva · avisos de viaje. Reglas puras (sin Deno, sin red): zona y hora local del viajero, cuándo
// se entrega un aviso (una sola vez, a buena hora local, con tope diario por viajero; lo urgente del vuelo no
// espera), check-in en línea (aviso genérico honesto: no tenemos un dato verificado por aerolínea), documentos
// que faltan (las MISMAS reglas con fuente que la Bóveda: _shared/entryRulesMx.ts), clima extremo del día del
// viaje (MET Norway, weatherCore.ts) y alertas oficiales de seguridad nuevas (GOV.UK / State Dept,
// travelAdvisories.ts). Probado en src/test/vigilanciaAvisos.test.ts.
import { timeZoneFor } from "../worldClock.ts";
import { cityAirports } from "../airports.ts";
import { airlineName } from "../airlines.ts";
import { countryFromText, ENTRY_RULES_MX, SCHENGEN } from "../entryRulesMx.ts";
import { dailyFromMet, type MetDay, type MetForecast, MET_ATTRIBUTION } from "../weatherCore.ts";
import type { AvisoFuente } from "../travelAdvisories.ts";
import { SRE_GUIA_LABEL, SRE_GUIA_URL } from "../sre.ts";
import type { ConfigVigilancia } from "./vuelos.ts";

const H = 3_600_000;
const MIN = 60_000;
const DIA = 24 * H;

export type TipoAviso = "vuelo" | "fuente" | "checkin" | "documentos" | "clima" | "seguridad" | "confirmacion";

export type AvisoNuevo = {
  user_id: string; trip_id: string | null; clave: string; tipo: TipoAviso; titulo: string; cuerpo: string; url: string;
  urgente: boolean; zona_horaria: string | null; programado_para?: string; expira_at?: string | null; incidente_id?: string | null;
};

export type ViajeVentana = {
  id: string; user_id: string; destino: string; pais_destino?: string | null; fecha_salida: string; fecha_regreso?: string | null;
  ciudad_origen?: string | null;
  vuelos?: Array<{ id: string; vuelo: string; fecha: string; origen: string | null; destino: string | null; salida_at: string | null;
    salida_exacta: boolean; zona_origen: string | null; activo: boolean; estado?: Record<string, unknown> }>;
  documentos?: Array<{ id: string; kind: string; title: string; country_code: string | null; expires_on: string | null; valid_from: string | null }>;
};

// ───────────────────────────── Hora local del viajero ─────────────────────────────

/** Fecha (YYYY-MM-DD) y hora de `at` en la zona `tz`. */
export function partesLocales(at: Date, tz: string): { fecha: string; h: number; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) % 24, min: Number(p.minute) };
}

/**
 * Dónde está el viajero: en el destino si el viaje ya empezó (día de salida en adelante), si no en su ciudad de
 * origen; sin dato, Ciudad de México (el mercado de IATOS). Nunca se adivina una zona que no se reconoce.
 */
export function zonaViajero(t: Pick<ViajeVentana, "destino" | "ciudad_origen" | "fecha_salida" | "fecha_regreso">, ahora: Date): string {
  const origen = timeZoneFor(t.ciudad_origen) ?? "America/Mexico_City";
  const destino = timeZoneFor(t.destino) ?? origen;
  const hoy = partesLocales(ahora, origen).fecha;
  const enViaje = t.fecha_salida && hoy >= t.fecha_salida && hoy <= (t.fecha_regreso ?? t.fecha_salida);
  return enViaje ? destino : origen;
}

/** Siguiente instante en que la hora local de `tz` está dentro de [desde, hasta). Si ya lo está, `ahora`. */
export function siguienteHoraDecente(ahora: Date, tz: string | null | undefined, desde: number, hasta: number): Date {
  let lp: { h: number; min: number };
  try {
    lp = partesLocales(ahora, tz || "America/Mexico_City");
  } catch {
    lp = partesLocales(ahora, "America/Mexico_City");
  }
  if (lp.h >= desde && lp.h < hasta) return ahora;
  const m = lp.h * 60 + lp.min;
  const espera = m < desde * 60 ? desde * 60 - m : 24 * 60 - m + desde * 60;
  return new Date(ahora.getTime() + espera * MIN);
}

export type Decision = { accion: "enviar" } | { accion: "esperar"; hasta: Date; motivo: "hora" | "tope" } | { accion: "vencer" };

/**
 * Entrega de un aviso: lo urgente del vuelo sale ya (a cualquier hora, sin contar para el tope). Lo demás, solo a
 * buena hora local y sin pasar el tope diario por viajero (si se pasa, se recorre; si ya no sirve, se vence).
 */
export function decidirEnvio(a: { urgente: boolean; zona_horaria: string | null; expira_at: string | null }, enviados24h: number,
  cfg: Pick<ConfigVigilancia, "avisos_tope_diario" | "hora_desde" | "hora_hasta">, ahora: Date): Decision {
  const expira = a.expira_at ? Date.parse(a.expira_at) : NaN;
  if (Number.isFinite(expira) && ahora.getTime() >= expira) return { accion: "vencer" };
  if (a.urgente) return { accion: "enviar" };
  const decente = siguienteHoraDecente(ahora, a.zona_horaria, cfg.hora_desde, cfg.hora_hasta);
  let hasta: Date | null = null;
  let motivo: "hora" | "tope" = "hora";
  if (decente.getTime() > ahora.getTime()) hasta = decente;
  else if (enviados24h >= cfg.avisos_tope_diario) {
    motivo = "tope";
    hasta = siguienteHoraDecente(new Date(ahora.getTime() + 3 * H), a.zona_horaria, cfg.hora_desde, cfg.hora_hasta);
  }
  if (!hasta) return { accion: "enviar" };
  if (Number.isFinite(expira) && hasta.getTime() >= expira) return { accion: "vencer" };
  return { accion: "esperar", hasta, motivo };
}

// ───────────────────────────── Check-in en línea ─────────────────────────────

/**
 * Ventanas de check-in VERIFICADAS en el sitio oficial de cada aerolínea (código IATA → horas y fuente). Vacío a
 * propósito: el 30-oct-2026 no pudimos leer las páginas oficiales (Aeroméxico en mantenimiento, United 503,
 * Iberia 403). Mientras no haya fuente, el aviso es genérico y lo dice. Agregar aquí SOLO con URL leída.
 */
export const CHECKIN_VERIFICADO: Record<string, { horas: number; fuente: string; consultado: string }> = {};

export function avisoCheckin(t: Pick<ViajeVentana, "id" | "user_id">, v: NonNullable<ViajeVentana["vuelos"]>[number], tz: string, ahora: Date): AvisoNuevo | null {
  if (!v.activo || !v.salida_at) return null;
  const st = String(v.estado?.status ?? "");
  if (st === "cancelado" || st === "en vuelo" || st === "aterrizado") return null;
  const salida = Date.parse(v.salida_at);
  if (!Number.isFinite(salida)) return null;
  const code = v.vuelo.slice(0, 2);
  const nombre = airlineName(code) ?? "tu aerolínea";
  const ver = CHECKIN_VERIFICADO[code];
  const horas = ver?.horas ?? 24;
  // Sin hora exacta la salida guardada es el peor caso (fin del día): se avisa con margen (30 h antes).
  const desde = salida - (v.salida_exacta ? horas : Math.max(horas, 30)) * H;
  const expira = salida - (v.salida_exacta ? 2 : 12) * H;
  if (ahora.getTime() >= expira) return null;
  const cuerpo = ver
    ? `El check-in en línea de ${nombre} abre ${horas} h antes de la salida (fuente: ${ver.fuente}, consultada el ${ver.consultado}). Ya puedes hacerlo para tu vuelo ${v.vuelo} en su app o sitio. Así eliges asiento y evitas filas.`
    : `Tu vuelo ${v.vuelo} sale pronto. En la mayoría de las aerolíneas el check-in en línea abre 24 h antes de la salida (algunas antes); no tenemos verificado el horario exacto de ${nombre}. Revisa en su app o sitio si ya puedes hacerlo: así eliges asiento y evitas filas.`;
  return {
    user_id: t.user_id, trip_id: t.id, clave: `checkin:${v.id}`, tipo: "checkin", titulo: `Check-in en línea · ${v.vuelo}`,
    cuerpo, url: `/dashboard/viajes/${t.id}`, urgente: false, zona_horaria: tz,
    programado_para: new Date(Math.max(desde, ahora.getTime())).toISOString(), expira_at: new Date(expira).toISOString(),
  };
}

// ───────────────────────────── Documentos ─────────────────────────────

const addMonths = (iso: string, months: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
};
const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Documentos que faltan para ESTE viaje (internacional), con las mismas reglas con fuente que la Bóveda. Solo lo
 * accionable (crítico o aviso); lo informativo se queda en la Bóveda. Cada uno, una vez por viaje.
 */
export function avisosDocumentos(t: ViajeVentana, tz: string, ahora: Date): AvisoNuevo[] {
  const docs = t.documentos ?? [];
  const pais = countryFromText(t.pais_destino) ?? countryFromText(t.destino);
  const passports = docs.filter((d) => d.kind === "pasaporte").sort((a, b) => (b.expires_on ?? "9999").localeCompare(a.expires_on ?? "9999"));
  const pp = passports[0] ?? null;
  const nacionalidad = pp?.country_code ?? null;
  if (!pais || (pais === "MX" && (nacionalidad === "MX" || nacionalidad === null))) return [];
  const fin = t.fecha_regreso ?? t.fecha_salida;
  const out: AvisoNuevo[] = [];
  const base = { user_id: t.user_id, trip_id: t.id, tipo: "documentos" as const, url: "/dashboard/beneficios", urgente: false, zona_horaria: tz,
    expira_at: new Date(Date.parse(`${t.fecha_salida}T23:59:00Z`)).toISOString() };
  const donde = t.destino;
  if (!pp) {
    out.push({ ...base, clave: `docs:${t.id}:sin_pasaporte`, titulo: `Agrega tu pasaporte para ${donde}`,
      cuerpo: `Tu viaje a ${donde} sale el ${fmt(t.fecha_salida)} y no tenemos tu pasaporte en Documentos y tarjetas. Agrégalo para revisar su vigencia contra tus fechas.` });
  } else if (pp.expires_on && pp.expires_on < fin) {
    out.push({ ...base, clave: `docs:${t.id}:pasaporte_vence`, titulo: `Tu pasaporte vence antes de terminar tu viaje a ${donde}`,
      cuerpo: `Vence el ${fmt(pp.expires_on)} y regresas el ${fmt(fin)}. Renuévalo antes de viajar (fuente: SRE, https://www.gob.mx/sre).` });
  } else if (pp.expires_on && pp.expires_on < addMonths(fin, 6)) {
    out.push({ ...base, clave: `docs:${t.id}:pasaporte_6m`, titulo: `Pasaporte con menos de 6 meses de vigencia · ${donde}`,
      cuerpo: `Vence el ${fmt(pp.expires_on)}. Muchos países piden 6 meses de vigencia al entrar: confirma el requisito de tu destino en la ${SRE_GUIA_LABEL} (${SRE_GUIA_URL}).` });
  }
  const llave = SCHENGEN.has(pais) ? "SCHENGEN" : pais;
  const visaKey = SCHENGEN.has(pais) ? ["EU", pais] : [pais];
  const visas = docs.filter((d) => (d.kind === "visa" || d.kind === "autorizacion") && d.country_code && visaKey.includes(d.country_code));
  for (const v of visas) {
    if (v.expires_on && v.expires_on < fin) {
      out.push({ ...base, clave: `docs:${t.id}:visa_vence:${v.id}`, titulo: `${v.title} vence antes de tu viaje a ${donde}`,
        cuerpo: `Vence el ${fmt(v.expires_on)} y regresas el ${fmt(fin)}.` });
    }
  }
  const regla = nacionalidad === "MX" ? ENTRY_RULES_MX[llave] : undefined;
  if (regla && regla.needs && regla.level !== "info") {
    const vigente = (kinds: string[]) => visas.some((v) => kinds.includes(v.kind) && (!v.expires_on || v.expires_on >= fin));
    const ok = regla.needs === "visa" ? vigente(["visa"]) : vigente(["visa", "autorizacion"]);
    if (!ok) {
      out.push({ ...base, clave: `docs:${t.id}:entrada:${llave}`, titulo: `${regla.title} · ${donde}`,
        cuerpo: `${regla.detail} Fuente: ${regla.sourceLabel} (${regla.sourceUrl}). Los requisitos cambian: confírmalo en la fuente oficial.` });
    }
  }
  const programado = siguienteHoraDecente(ahora, tz, 9, 20);
  return out.map((a) => ({ ...a, programado_para: programado.toISOString() }));
}

// ───────────────────────────── Clima extremo ─────────────────────────────

export type Extremo = { motivos: string[]; dia: MetDay };

/** Umbrales de clima extremo (para avisar, no para alarmar): tormenta, lluvia ≥ 30 mm, viento ≥ 60 km/h, nevada, calor ≥ 38 °C, frío ≤ −10 °C. */
export function climaExtremo(d: MetDay): string[] {
  const m: string[] = [];
  if (d.code >= 95) m.push("tormenta eléctrica");
  if (d.precipMm >= 30) m.push(`lluvia intensa (${d.precipMm} mm en el día)`);
  if (d.windKmh >= 60) m.push(`viento fuerte (hasta ${d.windKmh} km/h)`);
  if (d.code >= 71 && d.code <= 77 && d.precipMm >= 5) m.push("nevada");
  if (d.tmax >= 38) m.push(`calor extremo (máxima ${d.tmax} °C)`);
  if (d.tmin <= -10) m.push(`frío extremo (mínima ${d.tmin} °C)`);
  return m;
}

/** Lugares y días a revisar: el día de salida (origen y destino) y el de regreso (destino), si son hoy o mañana. */
export function climaPorRevisar(t: ViajeVentana, ahora: Date): Array<{ ciudad: string; fecha: string; lat: number; lng: number; papel: "salida" | "llegada" | "regreso" }> {
  const out: Array<{ ciudad: string; fecha: string; lat: number; lng: number; papel: "salida" | "llegada" | "regreso" }> = [];
  const hoy = ahora.toISOString().slice(0, 10);
  const manana = new Date(ahora.getTime() + DIA).toISOString().slice(0, 10);
  const pasado = new Date(ahora.getTime() + 2 * DIA).toISOString().slice(0, 10);
  const ok = (f?: string | null) => !!f && [hoy, manana, pasado].includes(f);
  const add = (ciudad: string | null | undefined, fecha: string, papel: "salida" | "llegada" | "regreso") => {
    const c = cityAirports(String(ciudad ?? "").split(",")[0]?.trim());
    if (c) out.push({ ciudad: c.name, fecha, lat: c.lat, lng: c.lng, papel });
  };
  if (ok(t.fecha_salida)) { add(t.ciudad_origen, t.fecha_salida, "salida"); add(t.destino, t.fecha_salida, "llegada"); }
  if (t.fecha_regreso && t.fecha_regreso !== t.fecha_salida && ok(t.fecha_regreso)) add(t.destino, t.fecha_regreso, "regreso");
  return out;
}

export function avisoClima(t: Pick<ViajeVentana, "id" | "user_id">, lugar: { ciudad: string; fecha: string; lng: number; papel: string },
  met: MetForecast | null, tz: string, consultado: Date): AvisoNuevo | null {
  const dia = dailyFromMet(met, lugar.lng).find((d) => d.date === lugar.fecha);
  if (!dia) return null;
  const motivos = climaExtremo(dia);
  if (!motivos.length) return null;
  const papel = lugar.papel === "salida" ? "el día que sales" : lugar.papel === "regreso" ? "el día de tu regreso" : "el día que llegas";
  return {
    user_id: t.user_id, trip_id: t.id, clave: `clima:${t.id}:${lugar.fecha}:${lugar.ciudad}`, tipo: "clima",
    titulo: `Clima extremo en ${lugar.ciudad} ${papel}`,
    cuerpo: `Pronóstico para ${lugar.ciudad} el ${fmt(lugar.fecha)}: ${motivos.join(", ")}. Máx ${dia.tmax} °C / mín ${dia.tmin} °C. Puede afectar vuelos y traslados: revisa el estado de tu vuelo y date tiempo extra. ${MET_ATTRIBUTION.label}, consultado el ${consultado.toISOString().slice(0, 16).replace("T", " ")} UTC; un pronóstico puede cambiar.`,
    url: `/dashboard/viajes/${t.id}/clima`, urgente: false, zona_horaria: tz,
    expira_at: new Date(Date.parse(`${lugar.fecha}T23:59:00Z`)).toISOString(),
  };
}

// ───────────────────────────── Alertas oficiales de seguridad ─────────────────────────────

export const firmaAviso = (f: Pick<AvisoFuente, "fuente" | "nivel" | "ultimo_cambio" | "actualizado_at">) =>
  `${f.fuente}|${f.nivel.valor ?? "?"}|${String(f.ultimo_cambio ?? f.actualizado_at ?? "").slice(0, 200)}`;

/** Nivel alto: State Dept 3–4 ("reconsidera" / "no viajes"); GOV.UK 3–4 (desaconseja viajar a todo el país). */
export const nivelAlto = (f: Pick<AvisoFuente, "nivel">) => (f.nivel.valor ?? 0) >= 3;

export type DecisionSeguridad = { registrar: { tipo: "seguridad_linea_base" | "seguridad_cambio"; clave: string; datos: Record<string, unknown> } | null; aviso: AvisoNuevo | null };

/**
 * Alerta oficial NUEVA del destino. La primera vez que se ve un viaje se guarda la línea base y solo se avisa si el
 * nivel ya es alto. Después, se avisa si sube el nivel o si la fuente publica un cambio (con nivel ≥ 1).
 */
export function decidirSeguridad(t: Pick<ViajeVentana, "id" | "user_id" | "destino">, f: AvisoFuente, previo: { firma: string; nivel: number | null } | null, tz: string): DecisionSeguridad {
  const firma = firmaAviso(f);
  if (previo && previo.firma === firma) return { registrar: null, aviso: null };
  const nivel = f.nivel.valor ?? null;
  const datos = { fuente: f.fuente, firma, nivel, etiqueta: f.nivel.etiqueta, url: f.url, ultimo_cambio: f.ultimo_cambio ?? null, actualizado_at: f.actualizado_at };
  const h = firma.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);
  const registrar = { tipo: previo ? "seguridad_cambio" as const : "seguridad_linea_base" as const, clave: `seguridad:${t.id}:${f.fuente}:${h}`, datos };
  const sube = previo ? (nivel ?? 0) > (previo.nivel ?? 0) : false;
  // Tras la línea base: sube el nivel, o la fuente publica un cambio sin bajarlo (con nivel ≥ 1).
  const avisar = previo ? sube || ((nivel ?? 0) >= 1 && (nivel ?? 0) >= (previo.nivel ?? 0)) : nivelAlto(f);
  if (!avisar) return { registrar, aviso: null };
  const cambio = f.ultimo_cambio ? ` Último cambio publicado: «${f.ultimo_cambio.slice(0, 240)}» (en inglés, tal cual).` : "";
  return {
    registrar,
    aviso: {
      user_id: t.user_id, trip_id: t.id, clave: `aviso:${registrar.clave}`, tipo: "seguridad",
      titulo: `${previo ? "Nueva alerta oficial" : "Alerta oficial"} para ${t.destino}`,
      cuerpo: `${f.fuente_nombre} (para ${f.para_quien}) indica: ${f.nivel.etiqueta}.${cambio} Revisa la fuente: ${f.url}. Para mexicanos, consulta también la ${SRE_GUIA_LABEL}: ${SRE_GUIA_URL}. No sustituye asesoría consular.`,
      url: `/dashboard/viajes/${t.id}`, urgente: false, zona_horaria: tz,
    },
  };
}
