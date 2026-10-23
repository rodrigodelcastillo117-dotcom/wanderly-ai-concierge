/**
 * Textos de privevalor en el idioma de la persona (español por omisión; inglés si su idioma principal es
 * inglés). Mismo criterio que src/lib/priveI18n.ts del equipo prive-ux (perfil → navigator.languages →
 * español); al integrar, el líder puede unificar detectPriveLang. Los nombres de marca (PRIVÉ DROPS,
 * THE PRIVILEGE RADAR, …) se quedan en inglés con su subtítulo en el idioma de la persona.
 */
import { useMemo } from "react";
import { usePriveLang } from "@/components/prive/PriveLang";
import type { DropStatus, DropType, PassportKind, RadarState, TipCategory, ValueKind } from "@/lib/priveValueModel";

export type ValueLang = "es" | "en";
export const VALUE_LOCALE: Record<ValueLang, string> = { es: "es-MX", en: "en-US" };

export function valueLangFrom(tags: readonly (string | null | undefined)[]): ValueLang {
  for (const t of tags) {
    const base = String(t ?? "").trim().toLowerCase().split(/[-_]/)[0];
    if (base === "es") return "es";
    if (base === "en") return "en";
  }
  return "es";
}
export function detectValueLang(): ValueLang {
  if (typeof navigator === "undefined") return "es";
  const list = Array.isArray(navigator.languages) && navigator.languages.length ? navigator.languages : [navigator.language];
  return valueLangFrom(list);
}

const es = {
  lang: "es" as ValueLang,
  brand: {
    drops: { name: "PRIVÉ DROPS", sub: "Oportunidades verificadas" },
    radar: { name: "THE PRIVILEGE RADAR", sub: "Tus beneficios, con condiciones y fuente" },
    value: { name: "THE VALUE OF YOUR PRIVÉ", sub: "Lo que Privé te ha aportado, sin inventar ahorros" },
    insider: { name: "THE INSIDER'S NOTEBOOK", sub: "Consejos que valen la pena, con fuente" },
    byg: { name: "BEFORE YOU GO", sub: "Cinco cosas que conviene saber antes de llegar" },
    passport: { name: "THE PRIVÉ PASSPORT", sub: "Tu historia de viaje, solo para ti" },
    preview: { name: "IATOS PRIVÉ", sub: "Así es lo que te espera" },
  },
  common: {
    loading: "Cargando…", retry: "Intentar de nuevo", error: "No se pudo cargar. Intenta de nuevo en un momento.",
    source: "Fuente", verified: (d: string) => `Verificado el ${d}`, checked: (d: string) => `Revisado el ${d}`,
    openOfficial: "Abrir el sitio oficial", opensNewTab: "(se abre en otra pestaña)", save: "Guardar", saved: "Guardado",
    remove: "Quitar", cancel: "Cancelar", add: "Agregar", global: "Cualquier destino", all: "Todo", back: "IATOS Privé",
  },
  dropType: {
    promocion_publica: "Promoción pública", tarifa_publicada: "Tarifa publicada por el proveedor", beneficio_lealtad: "Beneficio de lealtad",
    beneficio_tarjeta: "Beneficio de tarjeta · puede aplicar", oferta_temporal: "Oferta por tiempo limitado", beneficio_iatos: "Beneficio IATOS por convenio",
    editorial: "Oportunidad editorial",
  } as Record<DropType, string>,
  dropStatus: { activo: "Vigente", por_verificar: "Por verificar", vencido: "Vencido", programado: "Próximamente", retirado: "No disponible" } as Record<DropStatus, string>,
  drops: {
    intro: "Solo oportunidades reales: cada una con proveedor, condiciones, vigencia, fuente oficial y fecha de verificación. Sin descuentos sin comparación, sin precios \"antes\" inventados y sin urgencias falsas.",
    benefit: "Beneficio", conditions: "Condiciones", eligibility: "Quién puede usarlo", restrictions: "Restricciones",
    validity: "Vigencia", until: (d: string) => `Hasta el ${d}`, from: (d: string) => `Desde el ${d}`, ongoing: "Sin fecha de fin publicada · se revisa cada 45 días",
    price: "Precio publicado", before: "Antes", affiliate: "Enlace de afiliado: IATOS podría recibir una comisión.", advertising: "Publicidad",
    editorialNote: "Selección editorial de IATOS: no es una promoción ni un beneficio.", cardNote: "Puede aplicar según tu tarjeta. La marca no garantiza el beneficio: confírmalo con tu emisor.",
    porVerificar: "Nadie lo ha revisado en más de 45 días: confirma en el sitio oficial antes de contar con él.",
    reasons: { viaje: "Para tu próximo viaje", guardado: "En un destino que guardaste", boveda: "Por un programa de tu Bóveda" },
    filterType: "Tipo de oportunidad", filterDest: "Destino", empty: "Hoy no tenemos oportunidades verificables para este filtro.",
    emptyLead: "Preferimos no mostrar nada antes que inventar una promoción. Mientras tanto, esto sí te sirve:",
    expired: (n: number) => (n === 1 ? "1 oportunidad venció en los últimos 30 días y ya no se muestra." : `${n} oportunidades vencieron en los últimos 30 días y ya no se muestran.`),
    seeAll: "Ver todos los Drops", teaserTitle: "Una oportunidad real para ti", teaserNone: "Sin oportunidades verificables por ahora: mira el cuaderno del insider.",
    follow: "Seguir en mi radar", following: "En tu radar",
  },
  radar: {
    intro: "Revisa los programas y tarjetas que registraste en tu Bóveda. Una coincidencia de marca NO es elegibilidad: cada beneficio trae sus condiciones y su fuente para que lo compruebes.",
    programs: "Programas en tu Bóveda", noPrograms: "Aún no registras programas ni tarjetas en tu Bóveda.", goVault: "Ir a mi Bóveda",
    noNumbers: "Solo usamos nombres y niveles; nunca números de tarjeta ni de socio.",
    suggestions: "Posibles beneficios", noSuggestions: "Ninguna oportunidad verificada coincide hoy con tus programas.",
    tracked: "Beneficios que sigues", noTracked: "Aún no sigues ningún beneficio.",
    matched: (p: string) => `Coincide con ${p} de tu Bóveda`,
    howVerified: "¿Cómo lo verificaste?", howVerifiedHint: "Ej. \"Lo confirmé con mi banco el 3 de noviembre\"",
    usedOn: "Fecha de uso", addManual: "Agregar un beneficio propio", program: "Programa o tarjeta", benefitText: "Beneficio",
    errors: { VERIFICATION_REQUIRED: "Para marcarlo verificado, escribe cómo lo comprobaste.", VERIFY_FIRST: "Primero verifícalo; luego podrás marcarlo como utilizado.",
      NOT_ALLOWED: "Ese cambio no está permitido.", INVALID: "Revisa los datos (sin números de tarjeta).", default: "No se pudo guardar." } as Record<string, string>,
  },
  radarState: { posible: "POSIBLE BENEFICIO", por_comprobar: "ELEGIBILIDAD POR COMPROBAR", verificado: "BENEFICIO VERIFICADO", utilizado: "BENEFICIO UTILIZADO" } as Record<RadarState, string>,
  radarAction: { posible: "Volver a posible", por_comprobar: "Comprobar elegibilidad", verificado: "Marcar verificado", utilizado: "Marcar utilizado" } as Record<RadarState, string>,
  value: {
    intro: "Separamos lo comprobado de lo estimado y de lo potencial. Nunca sumamos monedas distintas ni inventamos ahorros: un ahorro existe solo con un precio de referencia y lo que pagaste.",
    box: { comprobado: "Ahorro comprobado", estimado: "Ahorro estimado", potencial: "Ahorro potencial", sin_ahorro: "Valor sin ahorro" } as Record<ValueKind, string>,
    boxHelp: {
      comprobado: "Referencia con fuente + lo que pagaste + evidencia (folio, recibo).",
      estimado: "Referencia con fuente; aún sin evidencia del pago.",
      potencial: "Beneficios u oportunidades que aún no usas.",
      sin_ahorro: "Experiencias organizadas que valen sin ser dinero.",
    } as Record<ValueKind, string>,
    none: "Sin registros", entries: (n: number) => (n === 1 ? "1 registro" : `${n} registros`),
    potentialNoAmount: (n: number) => (n === 1 ? "1 beneficio sin monto calculable" : `${n} beneficios sin monto calculable`),
    plans: (n: number) => (n === 1 ? "1 plan Privé agregado a tus viajes" : `${n} planes Privé agregados a tus viajes`),
    empty: "Aún no hay valor registrado. No calculamos ahorros sin una referencia.",
    add: "Registrar valor", kind: "Tipo", title: "Qué fue", currency: "Moneda", reference: "Precio de referencia", paid: "Lo que pagaste",
    referenceSource: "Fuente del precio de referencia", evidence: "Evidencia (folio, recibo)", nonMonetary: "Qué te aportó",
    errors: { title: "Escribe qué fue.", amounts_pair: "Escribe el precio de referencia y lo que pagaste.", ref_gt_paid: "Lo pagado debe ser menor que la referencia.",
      currency: "Elige la moneda.", reference_source: "Indica de dónde sale el precio de referencia.", evidence_note: "Un ahorro comprobado necesita evidencia.",
      non_monetary_note: "Describe qué te aportó.", no_amounts: "El valor sin ahorro no lleva montos.", link_required: "Un ahorro potencial se registra desde un beneficio del radar.",
      kind: "Elige el tipo.", default: "No se pudo guardar." } as Record<string, string>,
  },
  insider: {
    intro: "Consejos concretos por destino, cada uno con su fuente oficial y la fecha en que lo revisamos. Calidad antes que cantidad.",
    destinations: "Cuadernos por destino", tips: (n: number) => (n === 1 ? "1 consejo" : `${n} consejos`), empty: "Aún no hay consejos verificados para este destino.",
    notFound: "No encontramos ese destino en el catálogo de IATOS Privé.", addToTrip: "Agregar a las notas del viaje", added: "En las notas de tu viaje",
    chooseTrip: "¿A qué viaje?", noTrips: "Crea un viaje para guardar consejos en sus notas.", stale: "Fuente revisada hace más de 6 meses",
    validUntil: (d: string) => `Válido hasta el ${d}`, savedCount: (n: number) => `${n} guardados`,
    bygFor: (place: string, days: number) => (days > 1 ? `${place} · en ${days} días` : days === 1 ? `${place} · mañana` : days === 0 ? `${place} · hoy` : `${place} · en curso`),
    bygEmpty: "Aún no tenemos consejos verificados para el destino de tu próximo viaje.", bygOpen: "Ver el cuaderno completo",
  },
  tipCategory: {
    cuando_viajar: "Cuándo ir", donde_alojarse: "Dónde alojarse", reservar_antes: "Reserva con anticipación", restaurantes: "Restaurantes",
    vestimenta: "Vestimenta", transporte: "Transporte", costumbres: "Costumbres", seguridad: "Seguridad práctica", errores: "Errores frecuentes",
    temporada: "Temporada", itinerario: "Itinerario", ocasiones: "Ocasiones especiales", llegada: "Al llegar", documentos: "Documentos",
  } as Record<TipCategory, string>,
  passport: {
    member: "Miembro", memberSince: "Miembro desde", memberNumber: "Número de miembro", tenure: "Antigüedad", status: "Estado",
    active: "Activa", inactive: "No activa", founding: "Miembro fundador", cardAria: "IATOS Privé · Tarjeta de miembro",
    foundingCriteria: (d: string) => `Activaste IATOS Privé en o antes del ${d}, la fecha de corte de la primera generación.`,
    tenureText: (y: number, m: number, d: number) => [y ? `${y} ${y === 1 ? "año" : "años"}` : "", m ? `${m} ${m === 1 ? "mes" : "meses"}` : "", !y && !m ? `${d} ${d === 1 ? "día" : "días"}` : ""].filter(Boolean).join(" y "),
    privacy: "Tu pasaporte es privado: solo tú lo ves. Nada se comparte ni se publica.", numberNote: "Tu número de miembro no es sensible: no sirve para entrar.",
    empty: "Tu pasaporte está en blanco. Agrega el primer destino que te marcó.",
    add: "Agregar al pasaporte", kind: "Tipo", place: "Destino o lugar", title: "Título", date: "Fecha", note: "Nota (opcional)",
    countries: (n: number) => (n === 1 ? "1 país" : `${n} países`),
    errors: { title: "Escribe un título.", place: "Indica el destino o lugar.", future: "Lo vivido no puede tener fecha futura.", card_number: "No escribas números de tarjeta.", kind: "Elige el tipo.", default: "No se pudo guardar." } as Record<string, string>,
  },
  passportKind: { visitado: "Destino visitado", experiencia: "Experiencia vivida", favorito: "Favorito", deseo: "Deseo", recuerdo: "Recuerdo" } as Record<PassportKind, string>,
  preview: {
    eyebrow: "Vista previa", title: "Un mundo que se abre con el tiempo",
    lead: "IATOS Privé se abre después de 90 días de IATOS PRO pagado, sin costo adicional. Esto es lo que encontrarás dentro.",
    areas: [
      ["FOR YOU", "Una selección personal según tus viajes y gustos, sin fingir personalización."],
      ["THE PRIVÉ KEY", "Escribe lo que quieres vivir y recibe un plan completo con horarios, costos y cómo reservar."],
      ["PRIVÉ DROPS", "Oportunidades reales con fuente, condiciones y vigencia."],
      ["THE INSIDER'S NOTEBOOK", "Consejos verificados por destino y \"Before You Go\" antes de cada viaje."],
      ["EXPLORE", "Doce universos de experiencias en destinos de todo el mundo."],
      ["MY PRIVÉ", "Tu tarjeta de miembro, tu pasaporte de viajes y lo que Privé te ha aportado."],
    ] as [string, string][],
    progress: (d: number, total: number) => `Llevas ${d} de ${total} días de IATOS PRO pagado.`,
    progressNotPro: "Tu camino a Privé empieza con IATOS PRO.",
    how: "Cómo funciona", howList: ["Cuentan los días de IATOS PRO pagado.", "Al llegar a 90 recibes una invitación personal.", "Creas tu contraseña Privé y entras."],
    destinations: "Algunos destinos del catálogo", examples: "Ejemplos editoriales", exampleTag: "Ejemplo ilustrativo",
    exampleItems: [
      ["The Insider's Notebook · París", "Qué día cierra el museo que quieres ver, cuánto cuesta para visitantes de fuera de Europa y cuándo conviene reservar."],
      ["Before You Go · Mónaco", "Qué documento te pedirán en la puerta del casino y qué ropa no te dejarán usar."],
      ["Privé Drops", "Beneficios de programas de lealtad y promociones públicas, siempre con su fuente oficial."],
    ] as [string, string][],
    pro: "Conocer IATOS PRO", proKeeps: "Mientras tanto, tu PRO conserva todos sus beneficios.",
  },
};

type Dict = typeof es;

const en: Dict = {
  lang: "en",
  brand: {
    drops: { name: "PRIVÉ DROPS", sub: "Verified opportunities" },
    radar: { name: "THE PRIVILEGE RADAR", sub: "Your benefits, with conditions and sources" },
    value: { name: "THE VALUE OF YOUR PRIVÉ", sub: "What Privé has given you, with no invented savings" },
    insider: { name: "THE INSIDER'S NOTEBOOK", sub: "Tips worth knowing, with sources" },
    byg: { name: "BEFORE YOU GO", sub: "Five things worth knowing before you arrive" },
    passport: { name: "THE PRIVÉ PASSPORT", sub: "Your travel story, just for you" },
    preview: { name: "IATOS PRIVÉ", sub: "A look at what awaits" },
  },
  common: {
    loading: "Loading…", retry: "Try again", error: "Could not load. Please try again shortly.",
    source: "Source", verified: (d: string) => `Verified on ${d}`, checked: (d: string) => `Checked on ${d}`,
    openOfficial: "Open the official site", opensNewTab: "(opens in a new tab)", save: "Save", saved: "Saved",
    remove: "Remove", cancel: "Cancel", add: "Add", global: "Any destination", all: "All", back: "IATOS Privé",
  },
  dropType: {
    promocion_publica: "Public promotion", tarifa_publicada: "Rate published by the provider", beneficio_lealtad: "Loyalty benefit",
    beneficio_tarjeta: "Card benefit · may apply", oferta_temporal: "Limited-time offer", beneficio_iatos: "IATOS partner benefit",
    editorial: "Editorial opportunity",
  },
  dropStatus: { activo: "Current", por_verificar: "To verify", vencido: "Expired", programado: "Coming soon", retirado: "Unavailable" },
  drops: {
    intro: "Real opportunities only: each with provider, conditions, validity, official source and verification date. No discounts without a comparison, no invented \"was\" prices and no fake urgency.",
    benefit: "Benefit", conditions: "Conditions", eligibility: "Who can use it", restrictions: "Restrictions",
    validity: "Validity", until: (d: string) => `Until ${d}`, from: (d: string) => `From ${d}`, ongoing: "No published end date · reviewed every 45 days",
    price: "Published price", before: "Was", affiliate: "Affiliate link: IATOS may earn a commission.", advertising: "Advertising",
    editorialNote: "IATOS editorial pick: not a promotion or a benefit.", cardNote: "May apply depending on your card. The brand alone does not guarantee it: confirm with your issuer.",
    porVerificar: "Not reviewed in over 45 days: confirm on the official site before relying on it.",
    reasons: { viaje: "For your next trip", guardado: "In a destination you saved", boveda: "Matches a programme in your Vault" },
    filterType: "Opportunity type", filterDest: "Destination", empty: "No verifiable opportunities for this filter today.",
    emptyLead: "We would rather show nothing than invent a promotion. Meanwhile, this is genuinely useful:",
    expired: (n: number) => (n === 1 ? "1 opportunity expired in the last 30 days and is no longer shown." : `${n} opportunities expired in the last 30 days and are no longer shown.`),
    seeAll: "See all Drops", teaserTitle: "A real opportunity for you", teaserNone: "No verifiable opportunities right now: see the insider's notebook.",
    follow: "Track on my radar", following: "On your radar",
  },
  radar: {
    intro: "We check the programmes and cards you registered in your Vault. A brand match is NOT eligibility: every benefit shows its conditions and source so you can confirm it.",
    programs: "Programmes in your Vault", noPrograms: "You have not registered programmes or cards in your Vault yet.", goVault: "Go to my Vault",
    noNumbers: "We only use names and levels; never card or membership numbers.",
    suggestions: "Possible benefits", noSuggestions: "No verified opportunity matches your programmes today.",
    tracked: "Benefits you track", noTracked: "You are not tracking any benefit yet.",
    matched: (p: string) => `Matches ${p} in your Vault`,
    howVerified: "How did you verify it?", howVerifiedHint: "E.g. \"Confirmed with my bank on 3 November\"",
    usedOn: "Date used", addManual: "Add your own benefit", program: "Programme or card", benefitText: "Benefit",
    errors: { VERIFICATION_REQUIRED: "To mark it verified, write how you confirmed it.", VERIFY_FIRST: "Verify it first; then you can mark it as used.",
      NOT_ALLOWED: "That change is not allowed.", INVALID: "Check the details (no card numbers).", default: "Could not save." },
  },
  radarState: { posible: "POSSIBLE BENEFIT", por_comprobar: "ELIGIBILITY TO CONFIRM", verificado: "VERIFIED BENEFIT", utilizado: "BENEFIT USED" },
  radarAction: { posible: "Back to possible", por_comprobar: "Check eligibility", verificado: "Mark verified", utilizado: "Mark used" },
  value: {
    intro: "We separate proven from estimated and potential. We never add different currencies or invent savings: a saving exists only with a reference price and what you paid.",
    box: { comprobado: "Proven savings", estimado: "Estimated savings", potencial: "Potential savings", sin_ahorro: "Value without savings" },
    boxHelp: {
      comprobado: "Sourced reference + what you paid + evidence (folio, receipt).",
      estimado: "Sourced reference; no proof of payment yet.",
      potencial: "Benefits or opportunities you have not used yet.",
      sin_ahorro: "Organised experiences that matter without being money.",
    },
    none: "No records", entries: (n: number) => (n === 1 ? "1 record" : `${n} records`),
    potentialNoAmount: (n: number) => (n === 1 ? "1 benefit without a computable amount" : `${n} benefits without a computable amount`),
    plans: (n: number) => (n === 1 ? "1 Privé plan added to your trips" : `${n} Privé plans added to your trips`),
    empty: "No value recorded yet. We do not compute savings without a reference.",
    add: "Record value", kind: "Type", title: "What it was", currency: "Currency", reference: "Reference price", paid: "What you paid",
    referenceSource: "Source of the reference price", evidence: "Evidence (folio, receipt)", nonMonetary: "What it gave you",
    errors: { title: "Describe what it was.", amounts_pair: "Enter the reference price and what you paid.", ref_gt_paid: "What you paid must be lower than the reference.",
      currency: "Choose the currency.", reference_source: "Say where the reference price comes from.", evidence_note: "Proven savings need evidence.",
      non_monetary_note: "Describe what it gave you.", no_amounts: "Value without savings has no amounts.", link_required: "Potential savings are recorded from a radar benefit.",
      kind: "Choose the type.", default: "Could not save." },
  },
  insider: {
    intro: "Concrete tips per destination, each with its official source and the date we checked it. Quality over quantity.",
    destinations: "Notebooks by destination", tips: (n: number) => (n === 1 ? "1 tip" : `${n} tips`), empty: "No verified tips for this destination yet.",
    notFound: "We could not find that destination in the IATOS Privé catalogue.", addToTrip: "Add to trip notes", added: "In your trip notes",
    chooseTrip: "Which trip?", noTrips: "Create a trip to keep tips in its notes.", stale: "Source checked over 6 months ago",
    validUntil: (d: string) => `Valid until ${d}`, savedCount: (n: number) => `${n} saved`,
    bygFor: (place: string, days: number) => (days > 1 ? `${place} · in ${days} days` : days === 1 ? `${place} · tomorrow` : days === 0 ? `${place} · today` : `${place} · in progress`),
    bygEmpty: "No verified tips yet for your next trip's destination.", bygOpen: "Open the full notebook",
  },
  tipCategory: {
    cuando_viajar: "When to go", donde_alojarse: "Where to stay", reservar_antes: "Book ahead", restaurantes: "Restaurants",
    vestimenta: "What to wear", transporte: "Getting around", costumbres: "Customs", seguridad: "Practical safety", errores: "Common mistakes",
    temporada: "Season", itinerario: "Itinerary", ocasiones: "Special occasions", llegada: "On arrival", documentos: "Documents",
  },
  passport: {
    member: "Member", memberSince: "Member Since", memberNumber: "Member number", tenure: "Tenure", status: "Status",
    active: "Active", inactive: "Inactive", founding: "Founding Member", cardAria: "IATOS Privé · Member card",
    foundingCriteria: (d: string) => `You activated IATOS Privé on or before ${d}, the first-generation cut-off date.`,
    tenureText: (y: number, m: number, d: number) => [y ? `${y} ${y === 1 ? "year" : "years"}` : "", m ? `${m} ${m === 1 ? "month" : "months"}` : "", !y && !m ? `${d} ${d === 1 ? "day" : "days"}` : ""].filter(Boolean).join(" and "),
    privacy: "Your passport is private: only you can see it. Nothing is shared or published.", numberNote: "Your member number is not sensitive: it cannot be used to sign in.",
    empty: "Your passport is blank. Add the first destination that stayed with you.",
    add: "Add to passport", kind: "Type", place: "Destination or place", title: "Title", date: "Date", note: "Note (optional)",
    countries: (n: number) => (n === 1 ? "1 country" : `${n} countries`),
    errors: { title: "Add a title.", place: "Add the destination or place.", future: "Something you lived cannot have a future date.", card_number: "Do not write card numbers.", kind: "Choose the type.", default: "Could not save." },
  },
  passportKind: { visitado: "Destination visited", experiencia: "Experience lived", favorito: "Favourite", deseo: "Wish", recuerdo: "Memory" },
  preview: {
    eyebrow: "Preview", title: "A world that opens with time",
    lead: "IATOS Privé opens after 90 days of paid IATOS PRO, at no extra cost. This is what you will find inside.",
    areas: [
      ["FOR YOU", "A personal selection based on your trips and tastes, without faking personalisation."],
      ["THE PRIVÉ KEY", "Write what you want to experience and get a complete plan with times, costs and how to book."],
      ["PRIVÉ DROPS", "Real opportunities with sources, conditions and validity."],
      ["THE INSIDER'S NOTEBOOK", "Verified tips per destination and \"Before You Go\" before every trip."],
      ["EXPLORE", "Twelve universes of experiences in destinations worldwide."],
      ["MY PRIVÉ", "Your member card, your travel passport and what Privé has given you."],
    ],
    progress: (d: number, total: number) => `You have ${d} of ${total} days of paid IATOS PRO.`,
    progressNotPro: "Your path to Privé starts with IATOS PRO.",
    how: "How it works", howList: ["Days of paid IATOS PRO count.", "At 90 you receive a personal invitation.", "You create your Privé password and enter."],
    destinations: "Some catalogue destinations", examples: "Editorial examples", exampleTag: "Illustrative example",
    exampleItems: [
      ["The Insider's Notebook · Paris", "Which day the museum you want is closed, what it costs for visitors from outside Europe and when to book."],
      ["Before You Go · Monaco", "Which document the casino door will ask for and which clothes are not allowed."],
      ["Privé Drops", "Loyalty programme benefits and public promotions, always with their official source."],
    ],
    pro: "Discover IATOS PRO", proKeeps: "Meanwhile, your PRO keeps all its benefits.",
  },
};

export const VALUE_TEXT: Record<ValueLang, Dict> = { es, en };
export type ValueText = Dict;

/**
 * Sin `lang`, el MISMO idioma que el resto de /prive (PriveLangProvider). Antes cada pantalla de privevalor
 * volvía a detectar el idioma por su cuenta, así que THE PRIVÉ PASSPORT podía salir en otro idioma que la
 * página que lo contiene.
 */
export function useValueText(lang?: ValueLang): ValueText {
  const shell = usePriveLang();
  return useMemo(() => VALUE_TEXT[lang ?? shell], [lang, shell]);
}

export function formatValueDate(iso: string | null | undefined, lang: ValueLang): string {
  if (!iso) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = dateOnly ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Una fecha sin hora se muestra tal cual; una marca de tiempo, en la hora de la Ciudad de México.
  return new Intl.DateTimeFormat(VALUE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: dateOnly ? "UTC" : "America/Mexico_City" }).format(d);
}
export function formatMoney(amount: number, currency: string, lang: ValueLang): string {
  try {
    // Código ISO siempre ("MXN 1,100", "EUR 64"): "$" es ambiguo entre pesos y dólares para quien viaja.
    return new Intl.NumberFormat(VALUE_LOCALE[lang], { style: "currency", currency, currencyDisplay: "code", maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount).replace(/\u00a0/g, " ");
  } catch {
    return `${amount} ${currency}`;
  }
}
