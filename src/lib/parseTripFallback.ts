// Interpretación local de una frase de viaje para cuando la IA no responde.
// No pretende igualar a parsear-viaje: solo evita perder lo que escribió el usuario.

export type TripFallback = {
  destino: string | null;
  fechaSalida: string | null;
  fechaRegreso: string | null;
  viajeros: number | null;
};

const DAYS: Record<string, number> = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
};

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const titleCase = (s: string) =>
  s.split(/\s+/).map((w) => (/^(de|del|la|las|los|el|y)$/i.test(w) ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join(" ");

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const nextWeekday = (from: Date, day: number) => {
  const d = new Date(from);
  d.setDate(d.getDate() + (((day - d.getDay() + 7) % 7) || 7));
  return d;
};

const STOP = "a|al|en|con|de|del|desde|para|por|el|la|los|las|este|esta|proximo|proxima|unos?|unas?|hotel|hospedaje|airbnb|todo";

export function parseTripFallback(query: string, today = new Date()): TripFallback {
  const text = strip(query.trim());
  const original = query.trim();

  let destino: string | null = null;
  const m = text.match(
    new RegExp(`(?:viaje|viajar|ir|irme|escapada|vacaciones|vuelo|volar)\\s+(?:a|al|en|para|hacia)\\s+(.+?)(?=\\s+(?:${STOP})\\b|[,.;!?]|$)`),
  );
  if (m) {
    // Recuperar acentos y mayúsculas del texto original en la misma posición.
    const start = text.indexOf(m[1], m.index);
    destino = titleCase(original.slice(start, start + m[1].length));
  } else if (original.split(/\s+/).length <= 3) {
    destino = titleCase(original);
  }

  let fechaSalida: string | null = null;
  let fechaRegreso: string | null = null;
  const range = text.match(/de\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+a\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)/);
  if (range) {
    const salida = nextWeekday(today, DAYS[range[1]]);
    fechaSalida = iso(salida);
    fechaRegreso = iso(nextWeekday(salida, DAYS[range[2]]));
  } else if (/fin de semana/.test(text)) {
    const viernes = nextWeekday(today, 5);
    fechaSalida = iso(viernes);
    fechaRegreso = iso(nextWeekday(viernes, 0));
  }

  let viajeros: number | null = null;
  const n = text.match(/(\d{1,2})\s*(?:personas|viajeros|adultos|pax)/);
  if (n) viajeros = Number(n[1]);
  else if (/\b(pareja|novi[oa]|espos[oa]|luna de miel)\b/.test(text)) viajeros = 2;
  else if (/\b(solo|sola)\b/.test(text)) viajeros = 1;

  return { destino, fechaSalida, fechaRegreso, viajeros };
}
