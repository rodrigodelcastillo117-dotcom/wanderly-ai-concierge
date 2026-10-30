// Preferencias del viajero para avisos: canal preferido y horario de "no molestar". Puro (sin Deno).
//
// Reglas (las respetan el Operador y la vigilancia):
//   · URGENTE (salud, seguridad, vuelo cancelado, el operador lo marca urgente): se avisa YA por TODOS los canales
//     disponibles (push, Telegram, WhatsApp —plantilla si la ventana de 24 h está cerrada— y correo), aunque sea de
//     noche. Un aviso urgente nunca espera.
//   · Normal y dentro del horario de no molestar: no suena nada; queda en la app (bitácora/avisos) y se entrega al
//     terminar el horario (cola channel_deferred).
//   · Normal y fuera del horario: primero el canal preferido; si no está disponible o falla, el siguiente
//     (push → Telegram → WhatsApp → correo). Un solo canal basta.
export type CanalAviso = "app" | "push" | "telegram" | "whatsapp" | "email";
export const CANALES_PREFERIBLES = ["app", "telegram", "whatsapp", "email"] as const;
export type CanalPreferido = typeof CANALES_PREFERIBLES[number];

export type PreferenciasCanal = {
  preferido: CanalPreferido;
  /** "22:00" y "08:00" en la zona del viajero; ambos null = sin horario de no molestar. */
  noMolestarInicio: string | null;
  noMolestarFin: string | null;
  /** Zona IANA del viajero (America/Mexico_City). Sin zona: America/Mexico_City. */
  tz: string | null;
};

export const PREFERENCIAS_POR_OMISION: PreferenciasCanal = { preferido: "app", noMolestarInicio: null, noMolestarFin: null, tz: null };
export const TZ_POR_OMISION = "America/Mexico_City";

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const horaValida = (h: unknown): h is string => typeof h === "string" && HORA.test(h.trim());

export function zonaValida(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Normaliza lo que llega de la base o de la app (valores raros → por omisión, nunca un error). */
export function normalizarPreferencias(raw: unknown): PreferenciasCanal {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pref = String(r.preferido ?? r.preferred ?? "app") as CanalPreferido;
  const ini = String(r.noMolestarInicio ?? r.quiet_start ?? "").slice(0, 5);
  const fin = String(r.noMolestarFin ?? r.quiet_end ?? "").slice(0, 5);
  const tz = r.tz;
  const conHorario = horaValida(ini) && horaValida(fin) && ini !== fin;
  return {
    preferido: (CANALES_PREFERIBLES as readonly string[]).includes(pref) ? pref : "app",
    noMolestarInicio: conHorario ? ini : null,
    noMolestarFin: conHorario ? fin : null,
    tz: zonaValida(tz) ? tz : null,
  };
}

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutos desde la medianoche en la zona del viajero. */
export function minutosLocales(ahora: Date, tz: string | null): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz ?? TZ_POR_OMISION, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(ahora);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return (h % 24) * 60 + m;
}

/** ¿Es horario de no molestar ahora? Soporta horarios que cruzan la medianoche (22:00 → 08:00). */
export function enNoMolestar(p: PreferenciasCanal, ahora: Date): boolean {
  if (!p.noMolestarInicio || !p.noMolestarFin) return false;
  const now = minutosLocales(ahora, p.tz);
  const ini = minutos(p.noMolestarInicio), fin = minutos(p.noMolestarFin);
  return ini < fin ? now >= ini && now < fin : now >= ini || now < fin;
}

/** Cuándo termina el horario de no molestar que está corriendo (instante UTC). null si no aplica. */
export function finDeNoMolestar(p: PreferenciasCanal, ahora: Date): Date | null {
  if (!enNoMolestar(p, ahora)) return null;
  const now = minutosLocales(ahora, p.tz);
  const fin = minutos(p.noMolestarFin!);
  const faltan = ((fin - now) + 24 * 60) % (24 * 60) || 24 * 60;
  const d = new Date(ahora.getTime() + faltan * 60_000);
  d.setUTCSeconds(0, 0);
  return d;
}

export type CanalDisponible = { canal: Exclude<CanalAviso, "app">; destino: string; /** WhatsApp: ventana de 24 h abierta. */ ventanaAbierta?: boolean };

export type PlanEntrega =
  | { modo: "ya"; urgente: boolean; /** En orden. Urgente: todos (se manda por cada uno). Normal: el primero que salga. */ intentos: CanalDisponible[]; todos: boolean }
  | { modo: "diferir"; hasta: Date; motivo: "no_molestar" };

const ORDEN_RESPALDO: Array<CanalDisponible["canal"]> = ["push", "telegram", "whatsapp", "email"];

/**
 * Qué hacer con un aviso. `disponibles`: lo que este usuario tiene (push con suscripción, chats vinculados, correo).
 * El correo en un aviso normal solo va si nada más está disponible (no se le llena el buzón).
 */
export function planDeEntrega(o: { prefs: PreferenciasCanal; urgente: boolean; ahora: Date; disponibles: CanalDisponible[] }): PlanEntrega {
  const disp = o.disponibles.filter((d) => d.destino);
  if (o.urgente) {
    return { modo: "ya", urgente: true, todos: true, intentos: ORDEN_RESPALDO.flatMap((c) => disp.filter((d) => d.canal === c)) };
  }
  const hasta = finDeNoMolestar(o.prefs, o.ahora);
  if (hasta) return { modo: "diferir", hasta, motivo: "no_molestar" };
  const preferido = o.prefs.preferido === "app" ? "push" : o.prefs.preferido;
  const orden = [preferido, ...ORDEN_RESPALDO.filter((c) => c !== preferido)] as Array<CanalDisponible["canal"]>;
  const sinCorreo = disp.filter((d) => d.canal !== "email");
  const usar = sinCorreo.length && preferido !== "email" ? sinCorreo : disp;
  return { modo: "ya", urgente: false, todos: false, intentos: orden.flatMap((c) => usar.filter((d) => d.canal === c)) };
}
