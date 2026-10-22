// Booking Bridge: contrato de datos compartido (sin Deno; lo usan el cliente, las edge functions y
// las pruebas). Diseño y mapeo con las tablas existentes: docs/iatos/IATOS_BOOKING_BRIDGE.md.
//
// Regla de oro: una oferta conserva su procedencia real. Nada de aquí "confirma" una compra: una
// reserva solo es CONFIRMED con evidencia del proveedor o del equipo (ver states.ts).

export type ProductType = "flight" | "hotel" | "restaurant" | "tour" | "experience" | "transport" | "event";

/** Modos del dueño (Fase 2). PROVIDER_SEARCH nunca se presenta como EXACT_DEEP_LINK. */
export type BookingMode =
  | "EXACT_DEEP_LINK"
  | "PROVIDER_SEARCH"
  | "HOSTED_CHECKOUT"
  | "IN_APP_BOOKING"
  | "REQUEST"
  | "UNAVAILABLE";

/** Estados de una intención de reserva (Fase 8). Los mismos que valida la base. */
export type IntentState =
  | "SELECTED"
  | "PRICE_RECHECK_REQUIRED"
  | "READY_TO_BOOK"
  | "REDIRECTED_TO_PROVIDER"
  | "REQUESTED"
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

/**
 * Tipo de acción, en el orden del BookingActionResolver (complemento del dueño, punto 2):
 *  1 exact_offer · 2 equivalent_search · 3 official_booking_page · 4 official_website ·
 *  5 whatsapp/email/sms/phone · 6 maps_listing · 7 assisted_request/save_for_later.
 * recheck_price y view_details son acciones auxiliares (no abren un proveedor para comprar).
 */
export type ActionKind =
  | "exact_offer"
  | "equivalent_search"
  | "official_booking_page"
  | "official_website"
  | "whatsapp"
  | "email"
  | "sms"
  | "phone"
  | "maps_listing"
  | "assisted_request"
  | "prive_request"
  | "save_for_later"
  | "recheck_price"
  | "view_details";

export const ACTION_TIER: Record<ActionKind, number> = {
  exact_offer: 1,
  equivalent_search: 2,
  official_booking_page: 3,
  official_website: 4,
  whatsapp: 5,
  email: 5,
  sms: 5,
  phone: 5,
  maps_listing: 6,
  prive_request: 7,
  assisted_request: 7,
  save_for_later: 7,
  recheck_price: 0,
  view_details: 0,
};

/** De dónde salió un dato. "ai" = lo escribió el modelo: sus URLs pasan por la lista blanca estricta. */
export type SourceTrust = "provider_api" | "curated_catalog" | "google_places" | "official_site_scan" | "builder" | "ai" | "client";

export type AvailabilityStatus = "unknown" | "available_at_check" | "sold_out" | "not_checked";

/** Qué conserva un enlace al llegar al proveedor. Se muestra al usuario antes de salir. */
export type Preserves = {
  product: boolean; // el mismo vuelo / hotel / lugar
  dates: boolean;
  travelers: boolean;
  room_or_fare: boolean; // la habitación o tarifa exacta
};

export type BookingAction = {
  kind: ActionKind;
  tier: number;
  mode: BookingMode;
  /** Texto del botón (copy del dueño): "Comprar esta oferta" SOLO para tier 1. */
  label: string;
  /** URL web (https) o esquema de canal (mailto:, tel:, sms:). null para acciones dentro de IATOS. */
  url: string | null;
  /** Formulario POST (Google Flights booking_request). Solo tier 1 de vuelos con bandera activa. */
  form?: { action: string; fields: Array<[string, string]> } | null;
  host: string | null;
  /** Quién procesa la compra o recibe la solicitud ("Aviasales", "OpenTable", "el restaurante"). */
  processor: string;
  preserves: Preserves;
  /** Avisos que se muestran antes de continuar (siempre incluyen el del precio en acciones web). */
  disclosures: string[];
  trust: SourceTrust;
  /** Por qué es confiable el enlace: id de evidencia en docs/iatos/IATOS_BOOKING_BRIDGE.md §Evidencia. */
  evidence: string;
  /** Solo canales: texto ya preparado y si el número/correo está verificado y por quién. */
  channel?: { value: string; verified_by: string; message?: string; call_script?: string[] } | null;
  verified_at?: string | null;
};

export type TravelDates = { start: string | null; end: string | null; time?: string | null };

/** Contrato mínimo del dueño (Fase 2), adaptado: ver el mapeo en IATOS_BOOKING_BRIDGE.md. */
export type BookingOffer = {
  offer_id: string;
  provider: string; // fuente de datos: google_flights, travelpayouts, google_hotels, prive_catalog, iatos_ai…
  provider_offer_id: string | null; // booking_token, property_token, slug, place_id
  product_type: ProductType;
  title: string;
  subtitle: string | null;
  city: string | null;
  source_url: string | null;
  booking_url: string | null; // URL de la acción principal (si es web)
  booking_mode: BookingMode;
  price: number | null;
  currency: string | null;
  taxes: { included: boolean | null; note: string | null } | null;
  price_checked_at: string | null;
  offer_expires_at: string | null;
  availability_status: AvailabilityStatus;
  traveler_count: number | null;
  travel_dates: TravelDates;
  booking_conditions: string[];
  trip_id: string | null;
  verification_status: "source_verified" | "link_verified" | "unverified" | "estimated";
  /** El precio viene de una estimación (IA o rango): nunca se presenta como boleto disponible. */
  price_is_estimate: boolean;
  /** Recheck posible con la fuente (booking_token / property_token). */
  recheckable: boolean;
  actions: BookingAction[];
  /** Enlaces descartados por inseguros o incoherentes (para pruebas y diagnóstico, no para la UI). */
  rejected: Array<{ url: string; reason: string }>;
  details: Record<string, unknown>;
};

export const PRICE_MAY_CHANGE = "El precio puede cambiar al continuar en el proveedor.";
