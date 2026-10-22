// BookingActionResolver (complemento del dueño, punto 2). Sin Deno: el cliente lo usa para pintar
// los botones y booking-bridge lo vuelve a correr en el servidor (con los datos que él mismo cargó)
// antes de guardar el destino de una intención. Mismas entradas → mismas acciones.
//
// Orden fijo de la mejor acción disponible:
//  1. Enlace exacto de reserva que dio la fuente y está vigente.
//  2. Búsqueda equivalente oficial con parámetros documentados.
//  3. Página oficial de reservas del lugar.
//  4. Sitio oficial general.
//  5. WhatsApp / correo / SMS / teléfono oficiales verificados (el usuario envía con un toque).
//  6. Ficha de Google Maps.
//  7. Solicitud asistida o guardar para después.
// Cada botón dice exactamente lo que hace: "Comprar esta oferta" solo existe en el nivel 1.
import { checkAllowlisted, checkTrustedSource, checkUntrusted, processorLabel, unwrapAffiliate, type UrlVerdict } from "./allowlist.ts";
import { mailtoLink, normalizePhone, smsLink, telLink, whatsappLink } from "./channels.ts";
import { EVIDENCE, mapsListingUrl } from "./links.ts";
import { draftRequest, type RequestDraftInput, type RequestLang } from "./messages.ts";
import {
  ACTION_TIER, type ActionKind, type BookingAction, type BookingMode, PRICE_MAY_CHANGE, type Preserves, type ProductType,
  type SourceTrust,
} from "./types.ts";

export type LinkCandidate = {
  url: string | null | undefined;
  trust: SourceTrust;
  evidence: string;
  preserves?: Partial<Preserves>;
  verified_at?: string | null;
  /** Nombre del proveedor si no se deduce del dominio (p. ej. "Aeroméxico"). */
  provider_label?: string | null;
};

export type ExactCandidate = LinkCandidate & {
  form?: { action: string; fields: Array<[string, string]> } | null;
  checked_at: string | null;
  expires_at?: string | null;
  seller?: string | null;
};

export type ChannelCandidate = { value: string; verified_by: string; trust: SourceTrust };

export type ResolverInput = {
  product_type: ProductType;
  title: string;
  city?: string | null;
  country?: string | null;
  price_is_estimate?: boolean;
  recheckable?: boolean;
  exact?: ExactCandidate[];
  searches?: LinkCandidate[];
  official_booking?: LinkCandidate[];
  website?: LinkCandidate | null;
  whatsapp?: ChannelCandidate | null; // dígitos E.164 sin "+"
  phone?: ChannelCandidate | null; // número tal como lo da la fuente
  email?: ChannelCandidate | null;
  maps?: { query: string; place_id?: string | null } | null;
  prive_experience_id?: string | null;
  allow_assisted?: boolean;
  /** Datos para pre-llenar los mensajes de los canales. */
  draft?: (RequestDraftInput & { lang: RequestLang }) | null;
  now?: number;
  flags?: { exact_flight_form?: boolean };
};

export type ResolvedActions = {
  actions: BookingAction[];
  primary: BookingAction | null;
  booking_mode: BookingMode;
  /** La fuente dio una oferta exacta pero ya venció: hay que comprobar el precio antes. */
  exact_expired: boolean;
  rejected: Array<{ url: string; reason: string }>;
};

/** Cuánto vale un enlace exacto sin volver a consultar (horas). Igual que la caché de SerpApi. */
export const EXACT_MAX_AGE_H: Record<string, number> = { flight: 6, hotel: 12, default: 12 };

const FULL: Preserves = { product: true, dates: true, travelers: true, room_or_fare: true };
const NONE: Preserves = { product: false, dates: false, travelers: false, room_or_fare: false };

function labelFor(kind: ActionKind, p: ProductType, provider: string): string {
  switch (kind) {
    case "exact_offer":
      return p === "hotel" ? "Reservar esta tarifa" : "Comprar esta oferta";
    case "equivalent_search":
      if (p === "flight") return "Buscar este vuelo";
      if (p === "hotel") return "Ver tarifas del hotel";
      if (p === "restaurant") return "Buscar mesa";
      if (p === "transport") return "Buscar boletos";
      if (p === "event") return "Buscar entradas";
      return `Buscar en ${provider}`;
    case "official_booking_page":
      return p === "event" ? "Ver entradas oficiales" : "Abrir reservas";
    case "official_website":
      return p === "flight" ? `Sitio de ${provider}` : "Sitio oficial";
    case "whatsapp":
      return p === "restaurant" ? "Escribir por WhatsApp" : "Contactar al operador por WhatsApp";
    case "email":
      return p === "restaurant" ? "Escribir al restaurante" : "Contactar al operador por correo";
    case "sms":
      return "Enviar SMS";
    case "phone":
      return p === "restaurant" ? "Llamar al restaurante" : p === "hotel" ? "Llamar al hotel" : "Contactar al operador";
    case "maps_listing":
      return "Ver en Google Maps";
    case "prive_request":
    case "assisted_request":
      return "Solicitar asistencia";
    case "save_for_later":
      return "Guardar en el viaje";
    case "recheck_price":
      return "Comprobar precio";
    case "view_details":
      return "Ver detalles";
  }
}

function modeFor(kind: ActionKind): BookingMode {
  const t = ACTION_TIER[kind];
  if (t === 1) return "EXACT_DEEP_LINK";
  if (t === 2 || t === 3) return "PROVIDER_SEARCH";
  if (t === 5 || kind === "prive_request" || kind === "assisted_request") return "REQUEST";
  return "UNAVAILABLE";
}

const UNTRUSTED: SourceTrust[] = ["ai", "client"];

function check(c: LinkCandidate): UrlVerdict {
  // Lo que escribió la IA o mandó el cliente solo puede salir a dominios de la lista blanca y nunca
  // por un redirect opaco (google.com/aclk, /travel/clk) cuyo destino final no se ve (AUD-04).
  const untrusted = UNTRUSTED.includes(c.trust);
  const v = untrusted ? checkUntrusted(c.url) : checkTrustedSource(c.url);
  // tp.media/click responde 400 (ver links.ts): se abre su destino, que también pasó la lista blanca.
  if (v.ok && v.provider?.redirector === "wrapper") return untrusted ? checkUntrusted(unwrapAffiliate(v.url)) : checkAllowlisted(unwrapAffiliate(v.url));
  return v;
}

/**
 * Un sitio fuera de la lista blanca cuyo dato vive en trips.*_json (Google Places guardado al
 * cotizar): el dueño o un colaborador lo pueden editar, así que no se presenta como "oficial" ni
 * verificado (AUD-04). Se ofrece igual (no se bloquean sitios reales), con su dominio a la vista.
 */
function editableTripData(c: LinkCandidate, v: UrlVerdict): boolean {
  return v.ok && v.trust === "trusted_source" && c.trust === "google_places";
}

function preservesNotes(p: Preserves, product: ProductType): string[] {
  const out: string[] = [];
  if (!p.product) out.push("Es una búsqueda: confirma en el proveedor que sea el mismo lugar o vuelo.");
  if (!p.dates) out.push("Revisa las fechas en el proveedor: este enlace no las lleva.");
  if (!p.travelers) out.push("Revisa el número de viajeros en el proveedor.");
  if (!p.room_or_fare && (product === "flight" || product === "hotel")) {
    out.push(product === "flight"
      ? "No podemos llevar la tarifa exacta: tendrás que elegir el vuelo de nuevo."
      : "No podemos llevar la habitación ni la tarifa exactas: elígelas de nuevo.");
  }
  return out;
}

export function resolveBookingActions(input: ResolverInput): ResolvedActions {
  const now = input.now ?? Date.now();
  const p = input.product_type;
  const actions: BookingAction[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  const seen = new Set<string>();
  const estimateNote = input.price_is_estimate ? ["El precio mostrado es una estimación, no una tarifa disponible."] : [];
  let exactExpired = false;

  const push = (kind: ActionKind, a: Omit<BookingAction, "kind" | "tier" | "mode" | "label"> & { label?: string }) => {
    const key = a.url ?? a.form?.action ?? `${kind}`;
    if (a.url && seen.has(a.url)) return;
    if (a.url) seen.add(a.url);
    actions.push({ kind, tier: ACTION_TIER[kind], mode: modeFor(kind), label: a.label ?? labelFor(kind, p, a.processor), ...a });
    return key;
  };

  const web = (kind: ActionKind, c: LinkCandidate, extra: string[] = [], form?: ExactCandidate["form"]) => {
    if (!c.url && !form) return;
    let host: string | null = null;
    let url: string | null = null;
    let unverified = false;
    const trust: SourceTrust = c.trust;
    if (form) {
      const v = checkAllowlisted(form.action);
      if (!v.ok) { rejected.push({ url: form.action, reason: v.reason }); return; }
      host = v.host;
    } else {
      const v = check(c);
      if (!v.ok) { rejected.push({ url: String(c.url), reason: v.reason }); return; }
      url = v.url; host = v.host;
      unverified = editableTripData(c, v);
    }
    const processor = c.provider_label || (url ? processorLabel(url) : (host ?? "el proveedor"));
    const preserves: Preserves = { ...(kind === "exact_offer" ? FULL : NONE), ...(c.preserves ?? {}) };
    const disclosures: string[] = [];
    if (kind === "exact_offer" || kind === "equivalent_search") {
      disclosures.push(`La compra la procesa ${processor}. IATOS no cobra ni emite boletos.`, PRICE_MAY_CHANGE);
    } else if (kind === "official_booking_page") {
      disclosures.push(`La reserva la gestiona ${processor}.`);
      if (p === "restaurant") disclosures.push("Esta página no garantiza disponibilidad: elige fecha y hora ahí.");
      else disclosures.push(PRICE_MAY_CHANGE);
    } else if (kind === "official_website") {
      disclosures.push("Es la página general del lugar: busca ahí su botón de reservas o contacto.");
    }
    if (kind !== "official_website") disclosures.push(...preservesNotes(preserves, p));
    disclosures.push(...extra, ...estimateNote);
    if (unverified) {
      disclosures.unshift(`IATOS no lo verificó: el enlace viene de los datos guardados en el viaje. Antes de dar datos personales o de pago, revisa que ${host} sea el sitio del lugar.`);
    }
    const label = unverified ? (kind === "official_booking_page" ? "Abrir página de reservas (sin verificar)" : "Sitio web del lugar (sin verificar)") : undefined;
    push(kind, { url, form: form ?? null, host, processor, preserves, disclosures, trust, evidence: c.evidence, verified_at: unverified ? null : c.verified_at ?? null,
      ...(label ? { label } : {}) });
  };

  // 1) Exacto: solo si sigue vigente (si no, se pide comprobar el precio).
  for (const e of input.exact ?? []) {
    if (e.form && !input.flags?.exact_flight_form) continue;
    const maxH = EXACT_MAX_AGE_H[p] ?? EXACT_MAX_AGE_H.default;
    const checked = e.checked_at ? Date.parse(e.checked_at) : NaN;
    const expired = !Number.isFinite(checked) || now - checked > maxH * 3600_000
      || (e.expires_at != null && Date.parse(e.expires_at) <= now);
    if (expired) {
      exactExpired = true;
      rejected.push({ url: String(e.url ?? e.form?.action ?? ""), reason: "oferta_vencida" });
      continue;
    }
    web("exact_offer", e, e.seller ? [`Vendido por ${e.seller}.`] : [], e.form ?? undefined);
  }
  // 2) Búsquedas equivalentes.
  for (const s of input.searches ?? []) web("equivalent_search", s);
  // 3) Página oficial de reservas.
  for (const b of input.official_booking ?? []) web("official_booking_page", b);
  // 4) Sitio oficial general.
  if (input.website) web("official_website", input.website);

  // 5) Canales oficiales (el usuario envía desde su app). Solo con fuente verificada.
  const draft = input.draft ? draftRequest(input.draft, input.draft.lang) : null;
  const channelNote = "Se abrirá tu app con el mensaje listo: tú lo envías. No es una reserva hasta que el lugar te confirme.";
  if (input.whatsapp?.value && input.whatsapp.verified_by) {
    const url = whatsappLink(input.whatsapp.value, draft?.body);
    if (url) {
      push("whatsapp", {
        url, host: "wa.me", processor: "WhatsApp", preserves: { ...NONE, product: true, dates: !!input.draft?.date, travelers: !!input.draft?.party_size },
        disclosures: [channelNote], trust: input.whatsapp.trust, evidence: EVIDENCE.WHATSAPP_CLICK_TO_CHAT,
        channel: { value: input.whatsapp.value, verified_by: input.whatsapp.verified_by, message: draft?.body },
      });
    }
  }
  if (input.email?.value && input.email.verified_by) {
    const url = mailtoLink(input.email.value, draft?.subject ?? input.title, draft?.body ?? "");
    if (url) {
      push("email", {
        url, host: null, processor: "tu correo", preserves: { ...NONE, product: true, dates: !!input.draft?.date, travelers: !!input.draft?.party_size },
        disclosures: [channelNote], trust: input.email.trust, evidence: EVIDENCE.MAILTO,
        channel: { value: input.email.value, verified_by: input.email.verified_by, message: draft?.body },
      });
    }
  }
  if (input.phone?.value && input.phone.verified_by) {
    const n = normalizePhone(input.phone.value, input.country ?? null);
    if (n.ok) {
      const tel = telLink(n.e164);
      if (tel) {
        push("phone", {
          url: tel, host: null, processor: input.title, preserves: { ...NONE, product: true },
          disclosures: ["Una llamada no se puede pre-llenar: te dejamos un guion para leerlo."], trust: input.phone.trust, evidence: EVIDENCE.TEL,
          channel: { value: n.e164, verified_by: input.phone.verified_by, call_script: draft?.call_script ?? [] },
        });
      }
      const sms = draft ? smsLink(n.e164, draft.body) : null;
      // SMS solo si el número es móvil conocido como WhatsApp/SMS: no se puede saber; se ofrece como
      // secundario únicamente cuando ya hay WhatsApp verificado del mismo número.
      if (sms && input.whatsapp?.value && n.digits === input.whatsapp.value) {
        push("sms", {
          url: sms, host: null, processor: "SMS", preserves: { ...NONE, product: true, dates: !!input.draft?.date, travelers: !!input.draft?.party_size },
          disclosures: [channelNote, "Si tu teléfono no pega el texto, cópialo de la pantalla."], trust: input.phone.trust, evidence: EVIDENCE.SMS,
          channel: { value: n.e164, verified_by: input.phone.verified_by, message: draft?.body },
        });
      }
    } else {
      rejected.push({ url: `tel:${input.phone.value}`, reason: `telefono_${n.reason}` });
    }
  }

  // 6) Google Maps.
  if (input.maps?.query) {
    const url = mapsListingUrl(input.maps.query, input.maps.place_id);
    if (url) {
      push("maps_listing", {
        url, host: "www.google.com", processor: "Google Maps",
        preserves: { ...NONE, product: !!input.maps.place_id },
        disclosures: input.maps.place_id ? ["Abre la ficha exacta del lugar en Google Maps."] : ["Es una búsqueda por nombre: confirma que sea el lugar correcto (puede haber homónimos)."],
        trust: input.maps.place_id ? "google_places" : "builder", evidence: EVIDENCE.MAPS_SEARCH,
      });
    }
  }

  // 7) Solicitud asistida / guardar.
  if (input.prive_experience_id) {
    push("prive_request", {
      url: null, host: null, processor: "el equipo de IATOS", preserves: { ...NONE, product: true },
      disclosures: ["Es una solicitud, no una reserva: te avisaremos cuando el proveedor confirme."], trust: "curated_catalog", evidence: EVIDENCE.CATALOG_BOOKING_URL,
    });
  } else if (input.allow_assisted) {
    push("assisted_request", {
      url: null, host: null, processor: "el equipo de IATOS", preserves: { ...NONE, product: true },
      disclosures: ["Es una solicitud, no una reserva: una persona te responderá con disponibilidad real."], trust: "builder", evidence: "EV-ASSISTED",
    });
  }
  push("save_for_later", {
    url: null, host: null, processor: "IATOS", preserves: { ...NONE, product: true }, disclosures: [], trust: "builder", evidence: "EV-SAVE",
  });

  actions.sort((a, b) => a.tier - b.tier);
  const bookable = actions.find((a) => a.tier >= 1 && a.tier <= 3) ?? actions.find((a) => a.mode === "REQUEST") ?? null;
  const primary = bookable ?? actions.find((a) => a.tier === 4 || a.tier === 6) ?? null;
  const booking_mode: BookingMode = bookable ? bookable.mode : "UNAVAILABLE";

  // Auxiliares: comprobar precio (solo si la fuente lo permite) y ver detalles (dentro de IATOS).
  if (input.recheckable) {
    actions.unshift({
      kind: "recheck_price", tier: 0, mode: booking_mode, label: labelFor("recheck_price", p, ""), url: null, host: null,
      processor: "IATOS", preserves: NONE, disclosures: ["Consulta de nuevo la fuente original; puede gastar una búsqueda en vivo de tu plan."],
      trust: "provider_api", evidence: p === "hotel" ? EVIDENCE.GOOGLE_HOTELS_PRICE_LINK : EVIDENCE.GOOGLE_FLIGHTS_BOOKING_REQUEST,
    });
  }
  return { actions, primary, booking_mode, exact_expired: exactExpired, rejected };
}
