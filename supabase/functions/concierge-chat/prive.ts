// Herramienta search_prive de Iato (IATOS Privé). Lógica sin Deno: se prueba con Vitest
// (src/test/searchPrive.test.ts) con un rpc simulado.
//
// Reglas (contrato §5):
//  * la sesión Privé viaja en el encabezado x-prive-session del cliente y se manda a las RPC con el JWT
//    del usuario (la RLS y prive_require deciden; nada aquí da acceso);
//  * sin sesión válida responde {available:false, reason} y una instrucción para desbloquear, SIN
//    nombres de lugares;
//  * con sesión devuelve, por ciudad, solo lo verificado/curado vigente (PENDIENTE, DESACTUALIZADO y NO
//    DISPONIBLE ya los excluye la base), con su estado;
//  * si se pide `plan`, arma la propuesta con el planificador determinista (horarios con fuente,
//    traslados ESTIMADOS, precios con fuente). Nunca reserva ni confirma.
import { INTENTS, parseIntents, planExperiences, planSummary, type Candidate, type IntentKey } from "../_shared/privePlanner.ts";

export const PRIVE_UNIVERSES = ["the_table", "after_dark", "casino_grand_nights", "yacht_sea", "private_stays", "iconic_events",
  "culture_access", "wellness_escape", "adventure_elite", "sport_leisure", "celebrations", "signature_mexico"] as const;

export const SEARCH_PRIVE_TOOL = {
  type: "function",
  function: {
    name: "search_prive",
    description:
      "Busca SOLO en el catálogo verificado de IATOS Privé (experiencias curadas por ciudad y universo, con su estado de datos). " +
      "Úsala cuando el usuario pida gastronomía, vida nocturna, casinos, yates, estancias, eventos, cultura, bienestar, aventura, " +
      "deporte, celebraciones o experiencias de México de nivel Privé, o un plan compuesto (ej. 'cena + casino + beach club + barco'). " +
      "Reglas: recomienda solo lo que devuelva esta herramienta (nunca nombres de memoria); respeta la ciudad de cada elemento; di el " +
      "estado si no es VERIFICADO; precio y horario solo si vienen con fuente, si no di 'por confirmar'; traslados siempre 'aprox.'; " +
      "no digas reservado, confirmado, VIP, exclusivo ni garantizado; los casinos son solo información práctica (sin apuestas) y con su " +
      "regla de edad. Si responde available:false, explica que el usuario debe desbloquear IATOS Privé en la app y no menciones lugares. " +
      "Para pedir algo, el usuario usa 'Solicitar' en la ficha: el equipo lo gestiona y avisa cuando el lugar confirme.",
    parameters: {
      type: "object",
      properties: {
        cities: { type: "array", items: { type: "string" }, maxItems: 5, description: "Ciudades o barrios (ej. 'Mónaco', 'Montecarlo', 'Polanco')" },
        universes: { type: "array", items: { type: "string", enum: [...PRIVE_UNIVERSES] } },
        intents: { type: "array", items: { type: "string" }, description: "Lo que pide en palabras: 'cena espectacular', 'casino elegante', 'beach club', 'paseo en barco'" },
        date_from: { type: "string", description: "YYYY-MM-DD" },
        date_to: { type: "string", description: "YYYY-MM-DD" },
        party_size: { type: "integer" },
        budget_level: { type: "integer", minimum: 1, maximum: 4 },
        plan: {
          type: "object",
          description: "Pide una propuesta compuesta validada (días, horarios, traslados, presupuesto). Solo si el usuario quiere un plan.",
          properties: {
            date_from: { type: "string", description: "YYYY-MM-DD del primer día" },
            nights: { type: "integer", minimum: 1, maximum: 14 },
            request: { type: "string", description: "Lo que pidió el usuario, tal cual" },
            hotel: { type: "object", properties: { name: { type: "string" }, lat: { type: "number" }, lng: { type: "number" } } },
            template: { type: "string", enum: ["cena_espectaculo_lounge", "restaurante_traslado_concierto", "beach_navegacion_cena", "golf_spa_restaurante",
              "arte_gastronomia_evento", "casino_espectaculo_regreso", "propuesta_fotografia_cena", "cultural_traslado_hotel"] },
          },
        },
      },
      required: ["cities"],
    },
  },
} as const;

export type RpcFn = (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;

const PRIVE_CODES = ["PRIVE_NO_SESSION", "PRIVE_NOT_PRO", "PRIVE_NOT_ELIGIBLE", "PRIVE_NOT_ACTIVATED", "PRIVE_REVOKED",
  "PRIVE_SESSION_INVALID", "PRIVE_SESSION_EXPIRED"] as const;
export type PriveCode = typeof PRIVE_CODES[number];

const LOCK_TEXT: Record<PriveCode, string> = {
  PRIVE_NO_SESSION: "IATOS Privé está bloqueado en esta sesión: el usuario debe abrir Privé en la app y desbloquearlo con su contraseña Privé.",
  PRIVE_SESSION_INVALID: "La sesión de IATOS Privé no es válida: el usuario debe volver a desbloquear Privé en la app.",
  PRIVE_SESSION_EXPIRED: "La sesión de IATOS Privé venció: el usuario debe volver a desbloquear Privé en la app.",
  PRIVE_NOT_PRO: "IATOS Privé es para miembros con IATOS PRO vigente.",
  PRIVE_NOT_ELIGIBLE: "IATOS Privé se abre después de 90 días de IATOS PRO pagado. El usuario puede ver su avance en la sección Privé.",
  PRIVE_NOT_ACTIVATED: "La invitación a IATOS Privé está lista pero no se ha activado: el usuario la activa en la sección Privé.",
  PRIVE_REVOKED: "El acceso a IATOS Privé no está activo en esta cuenta. El usuario puede escribir a soporte.",
};

export function priveCodeOf(message: unknown): PriveCode | null {
  const m = String(message ?? "");
  return PRIVE_CODES.find((c) => m.includes(c)) ?? null;
}

/** Respuesta sin contenido: nunca lleva nombres, direcciones ni conteos de lugares. */
export function unavailable(reason: PriveCode | "PRIVE_ERROR") {
  return {
    available: false, disponible: false, reason,
    motivo: reason === "PRIVE_ERROR" ? "El catálogo de IATOS Privé no respondió ahora; no muestres lugares de memoria." : LOCK_TEXT[reason],
  };
}

/** Intenciones del usuario → universos y palabras clave del catálogo (tabla fija del planificador). */
export function intentsToFilters(intents: unknown[] | undefined, universes: unknown[] | undefined) {
  const keys = new Set<IntentKey>();
  for (const t of intents ?? []) for (const k of parseIntents(String(t ?? ""))) keys.add(k);
  const uni = new Set<string>((universes ?? []).map(String).filter((u) => (PRIVE_UNIVERSES as readonly string[]).includes(u)));
  const keywords = new Set<string>();
  for (const k of keys) {
    const def = INTENTS[k];
    if (def.derived) continue;
    if (k === "beach_club") { keywords.add("beach"); keywords.add("playa"); keywords.add("plage"); continue; }
    if (def.match) {
      // Palabras de la expresión de la intención (sin metacaracteres).
      for (const w of def.match.source.replace(/[()\\]/g, "").split("|")) if (/^[a-z ]{3,}$/.test(w)) keywords.add(w);
    }
    // El universo propio de la intención también entra (la base une universo O palabra clave); el
    // planificador después descarta lo que no encaja (un salón náutico no es un paseo en barco).
    def.universes.forEach((u) => uni.add(u));
  }
  return { universes: uni.size ? [...uni] : null, keywords: keywords.size ? [...keywords].slice(0, 20) : null, intents: [...keys] };
}

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Elemento compacto para el modelo (y candidato para el planificador). */
function compact(x: any) {
  return {
    id: x.id, name: x.name, universe: x.universe, subcategory: x.subcategory, state: x.state,
    label: x.label ?? null, neighborhood: x.neighborhood ?? null, why: x.why ?? null,
    age_policy: x.age_policy, dress_code: x.dress_code ?? null, booking_method: x.booking_method,
    price: x.price ? `${x.price.min ?? ""}${x.price.max && x.price.max !== x.price.min ? `–${x.price.max}` : ""} ${x.price.currency ?? ""} (con fuente)`.trim() : "por confirmar",
    price_level: x.price_level ?? null,
    hours: x.opening_hours ? "según horario publicado" : "horario por confirmar",
    season: x.season?.state ?? null, season_note: x.season?.note ?? null,
    license: x.license?.authority ?? null, restrictions: x.restrictions ?? null,
    reasons: Array.isArray(x.reasons) ? x.reasons.slice(0, 5) : [],
  };
}

export function toCandidate(x: any, city?: any): Candidate {
  return {
    id: x.id, slug: x.slug, name: x.name, universe: x.universe, subcategory: x.subcategory, state: x.state, label: x.label ?? null,
    age_policy: x.age_policy, dress_code: x.dress_code ?? null, booking_method: x.booking_method ?? null,
    reservation_required: x.reservation_required ?? null, restrictions: x.restrictions ?? null, safety: x.safety ?? null,
    price_level: x.price_level ?? null, price: x.price ?? null,
    opening_hours: x.opening_hours?.source ? { hours: x.opening_hours.hours ?? {}, source: x.opening_hours.source } : null,
    duration_min: x.duration_min ?? null, lat: x.lat ?? null, lng: x.lng ?? null, season: x.season ?? null,
    website: x.website ?? null, booking_url: x.booking_url ?? null, tags: x.tags ?? null,
    destination: x.destination ?? (city ? { slug: city.slug, name: city.name, timezone: city.timezone, currency: city.currency } : null),
  };
}

export interface SearchPriveDeps { rpc: RpcFn; priveSession: string | null | undefined; todayISO?: string }

export async function runSearchPrive(args: Record<string, unknown>, deps: SearchPriveDeps) {
  const ps = typeof deps.priveSession === "string" && deps.priveSession.trim() ? deps.priveSession.trim().slice(0, 200) : null;
  if (!ps) return unavailable("PRIVE_NO_SESSION");
  const cities = (Array.isArray(args.cities) ? args.cities : [args.cities]).map((c) => String(c ?? "").trim()).filter(Boolean).slice(0, 5);
  if (!cities.length) return { available: true, disponible: false, motivo: "Falta la ciudad: pregúntale al usuario dónde estará." };
  const f = intentsToFilters(Array.isArray(args.intents) ? args.intents : [], Array.isArray(args.universes) ? args.universes : []);
  const planReq = args.plan && typeof args.plan === "object" ? (args.plan as Record<string, any>) : null;
  const planIntents = planReq ? parseIntents(String(planReq.request ?? "")) : [];
  const fromPlan = planReq ? intentsToFilters([String(planReq.request ?? "")], []) : null;
  const universes = [...new Set([...(f.universes ?? []), ...(fromPlan?.universes ?? [])])];
  const keywords = [...new Set([...(f.keywords ?? []), ...(fromPlan?.keywords ?? [])])];
  const { data, error } = await deps.rpc("prive_search", {
    _ps: ps, _cities: cities, _universes: universes.length ? universes : null, _keywords: keywords.length ? keywords : null,
    _date_from: isoDate(args.date_from) ?? isoDate(planReq?.date_from), _date_to: isoDate(args.date_to),
    _party: Number.isFinite(Number(args.party_size)) ? Math.round(Number(args.party_size)) : null,
    _budget: Number.isFinite(Number(args.budget_level)) ? Math.round(Number(args.budget_level)) : null,
    _per_universe: planReq ? 4 : 3,
  });
  if (error) {
    const code = priveCodeOf(error.message);
    return unavailable(code ?? "PRIVE_ERROR");
  }
  const res = data as any;
  if (!res || res.available !== true || !Array.isArray(res.cities)) return unavailable("PRIVE_ERROR");
  const out: Record<string, unknown> = {
    available: true, disponible: true,
    adult_confirmed: !!res.adult_confirmed,
    cities: res.cities.map((c: any) => ({
      query: c.query, resolved: !!c.resolved, city: c.city?.name ?? null, coverage: c.coverage,
      age_locked: !!c.age_locked,
      items: (c.items ?? []).map(compact),
      nota: !c.resolved || !(c.items ?? []).length ? "Sin selección verificada de IATOS Privé aquí: dilo tal cual y no inventes lugares." : undefined,
    })),
  };
  if (planReq) {
    const city = res.cities.find((c: any) => c.resolved && (c.items ?? []).length);
    if (city) {
      const plan = planExperiences((city.items ?? []).map((x: any) => toCandidate(x, city.city)), {
        dateFrom: isoDate(planReq.date_from) ?? isoDate(args.date_from) ?? deps.todayISO ?? new Date().toISOString().slice(0, 10),
        nights: Math.max(1, Math.min(14, Math.round(Number(planReq.nights) || 1))),
        hotel: planReq.hotel && Number.isFinite(Number(planReq.hotel.lat)) ? { name: planReq.hotel.name ?? null, lat: Number(planReq.hotel.lat), lng: Number(planReq.hotel.lng) } : null,
        partySize: Number(args.party_size) || 2,
        budgetLevel: Number(args.budget_level) || null,
        intents: planIntents.length ? planIntents : f.intents,
        template: typeof planReq.template === "string" ? planReq.template : null,
        timeZone: city.city?.timezone ?? null,
      });
      out.plan = {
        status: plan.status, template: plan.template, resumen: planSummary(plan).split("\n").slice(0, 30),
        sin_colocar: plan.unplaced, presupuesto: plan.budget.text, requisitos: plan.requirements.slice(0, 8),
        nota: "Propuesta, no reserva: preséntala así y ofrece guardarla en el viaje o solicitarla.",
      };
    } else {
      out.plan = { status: "sin_datos", nota: "No hay experiencias verificadas para armar el plan en esa ciudad: dilo tal cual." };
    }
  }
  return out;
}
