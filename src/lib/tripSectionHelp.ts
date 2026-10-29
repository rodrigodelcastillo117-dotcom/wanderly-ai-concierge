// Orientación en la página del viaje (feedback de Álvaro, 28-oct-2026: "me perdí un poco, me tomó
// entender qué estaba pasando en cada sección"). Cada pestaña dice en una línea para qué sirve y cuál es
// el siguiente paso; cada paso de "Comprar" dice qué hacer con sus opciones. Textos cortos, sin jerga.
import type { TripSection } from "@/components/TripSectionNav";

export type SectionHelpCtx = {
  /** Viaje traído ("Ya tengo mi viaje"): vuelos y hotel ya los tiene la persona. */
  brought?: boolean;
  /** Viaje importado de documentos: ya está pagado. */
  documento?: boolean;
  /** Se llega por tierra (coche, autobús): no hay vuelo. */
  byLand?: boolean;
  /** Varias ciudades. */
  multi?: boolean;
};

/** Nombre visible de cada pestaña ("destinos" es el itinerario día por día). */
export const TRIP_SECTION_LABEL: Record<TripSection, string> = {
  resumen: "Resumen",
  comprar: "Comprar",
  ruta: "Ruta",
  destinos: "Itinerario",
  experiencias: "Experiencias",
  documentos: "Documentos",
};

/** Una línea: para qué sirve la pestaña y qué hacer ahí. */
export function tripSectionHelp(id: TripSection, ctx: SectionHelpCtx = {}): string {
  switch (id) {
    case "resumen":
      return ctx.documento
        ? "Lo esencial de tu viaje y lo que ya pagaste."
        : "Lo esencial de tu viaje: cuánto cuesta y qué sigue. El botón dorado te lleva al siguiente paso.";
    case "comprar":
      if (ctx.documento) return "Este viaje viene de tus documentos: ya está pagado.";
      if (ctx.brought) return "Tus vuelos y hotel ya los tienes; aquí puedes agregar restaurantes y experiencias.";
      return `Elige ${ctx.byLand ? "cómo llegar" : "vuelo"} y hotel paso a paso; cada uno se paga directo en su sitio.`;
    case "ruta":
      return "Tu recorrido en coche por tramos: distancias, costos y renta del auto.";
    case "destinos":
      return ctx.multi
        ? "Tu plan día por día en cada ciudad. Toca un día para ver mañana, tarde y noche."
        : "Tu plan día por día. Toca un día para ver mañana, tarde y noche.";
    case "experiencias":
      // Una sola introducción (R3 viajes P2-10: esta línea y «Lo TOP de cada ciudad…» iban seguidas).
      return "Lo mejor de cada ciudad: restaurantes, museos y tours. Reservas en su sitio y aquí marcas lo ya reservado.";
    case "documentos":
      return "Guarda boletos, pasaportes y reservas para tenerlos a la mano en el viaje.";
  }
}

/** Una línea bajo cada paso de "Comprar" con opciones para elegir. */
export function purchaseStepHint(kind: "vuelo" | "hospedaje" | "traslado" | "auto", opts: { ground?: boolean } = {}): string {
  switch (kind) {
    case "vuelo":
      return opts.ground ? "Formas de llegar: toca una para elegirla." : "Opciones para tus fechas: toca una para elegirla.";
    case "hospedaje":
      return "Hoteles para tus noches: toca uno para elegirlo.";
    case "traslado":
      return "Cómo pasar a la siguiente ciudad: toca una opción para elegirla.";
    case "auto":
      return "Opcional: renta un auto solo si vas a manejar.";
  }
}

/** Recorrido de primer uso de la página del viaje: 3 pasos como máximo. */
export type TripTourStep = { section: TripSection | null; title: string; text: string };

export function tripTourSteps(ctx: SectionHelpCtx & { sections: TripSection[] }): TripTourStep[] {
  const has = (s: TripSection) => ctx.sections.includes(s);
  const steps: TripTourStep[] = [
    {
      section: "resumen",
      title: "Resumen",
      // «Abajo»: la guía va arriba de «Tu viaje en 30 segundos» (R3 viajes P2-2 decía «Arriba»).
      text: "Abajo ves tu viaje en 30 segundos, el total y el botón dorado con lo que sigue.",
    },
  ];
  if (has("comprar") && !ctx.documento) {
    steps.push({
      section: "comprar",
      title: "Comprar",
      text: ctx.brought
        ? "Agrega restaurantes y experiencias. Pagas directo en cada sitio; IATOS no cobra."
        : `Elige ${ctx.byLand ? "cómo llegar" : "vuelo"} y hotel paso a paso. Pagas directo en cada sitio; IATOS no cobra.`,
    });
  }
  if (has("destinos")) {
    steps.push({
      section: "destinos",
      title: "Itinerario",
      text: "Tu plan día por día, con un resumen de cada día. Los botones de la foto: guardar, PDF, invitar y editar con IA.",
    });
  }
  return steps.slice(0, 3);
}

export const TRIP_TOUR_KEY = "iatos_trip_tour_v1";

/** ¿Ya vio (o descartó) el recorrido? Sin almacenamiento disponible no se muestra (no insistir). */
export function tripTourSeen(storage: Pick<Storage, "getItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null): boolean {
  try {
    if (!storage) return true;
    return storage.getItem(TRIP_TOUR_KEY) === "done";
  } catch {
    return true;
  }
}

export function markTripTourSeen(storage: Pick<Storage, "setItem"> | null | undefined = typeof window !== "undefined" ? window.localStorage : null): void {
  try {
    storage?.setItem(TRIP_TOUR_KEY, "done");
  } catch {
    /* sin almacenamiento: se oculta solo en esta visita */
  }
}
