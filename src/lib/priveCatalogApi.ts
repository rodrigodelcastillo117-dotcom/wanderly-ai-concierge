/**
 * Cliente del catálogo de IATOS Privé (grupo catalog), montado sobre usePriveAccess().content del
 * grupo ui: sin sesión Privé no llama al servidor, y ante un código PRIVE_* borra la sesión y regresa al
 * candado de /prive. El servidor decide siempre (prive_require). Nada aquí da acceso.
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionErrors";
import { isPriveSessionCode, type PriveErrorCode, type PriveResult } from "@/lib/priveApi";
import { usePriveAccess } from "@/hooks/usePriveAccess";

export type PriveUniverse =
  | "the_table" | "after_dark" | "casino_grand_nights" | "yacht_sea" | "private_stays" | "iconic_events"
  | "culture_access" | "wellness_escape" | "adventure_elite" | "sport_leisure" | "celebrations" | "signature_mexico";

export type PriveState = "VERIFICADO" | "CURADO" | "ESTIMADO" | "PENDIENTE" | "DESACTUALIZADO" | "NO_DISPONIBLE";
export type PriveLabel = "EXPERIENCIA_CURADA" | "PARTNER_VERIFICADO" | "BENEFICIO_EXCLUSIVO" | "EXPERIENCIA_PRIVADA" | "ACCESO_CONFIRMADO";
export type PriveCoverage = "PILOTO_VERIFICADO" | "COBERTURA_PARCIAL" | "DESCUBRIMIENTO_BAJO_DEMANDA" | "SIN_COBERTURA_VERIFICADA";

export interface PriveExperience {
  id: string;
  slug: string;
  name: string;
  universe: PriveUniverse;
  subcategory: string;
  destination?: { slug: string; name: string; timezone?: string | null; currency?: string | null };
  neighborhood?: string;
  state: PriveState;
  verified_at?: string;
  label?: PriveLabel;
  label_evidence?: Record<string, unknown>;
  why?: string;
  address?: string;
  lat?: number;
  lng?: number;
  website?: string;
  booking_url?: string;
  booking_method?: string;
  reservation_required?: boolean;
  age_policy?: "todas" | "18+" | "21+";
  dress_code?: string;
  price_level?: number;
  price_note?: string;
  price?: { min?: number; max?: number; currency?: string; basis?: string; source: string; checked_at?: string; stale?: boolean };
  opening_hours?: { hours: Record<string, [string, string][]>; source: string; checked_at?: string };
  duration_min?: number;
  season?: { state?: "cerrado_por_temporada" | "en_temporada"; note?: string; months?: number[]; reopens_on?: string; closes_on?: string; source?: string };
  availability?: { state: string; checked_at?: string };
  operating_status?: string;
  restrictions?: string;
  members_only_venue?: boolean;
  accolades?: { name: string; year: number; url: string; rank?: number }[];
  image?: { source: string; query?: string; url?: string; photographer?: string; photographer_url?: string; page_url?: string; illustrative?: boolean; alt?: string };
  description?: string;
  sources?: (string | { url: string })[];
  safety?: string;
  operator?: string;
  license?: { authority?: string; ref?: string; source?: string };
  booking_policy?: string;
  cancellation?: string;
  event_start?: string;
  event_end?: string;
  tags?: string[];
  score?: { score: number; reasons: string[] } | number;
  reasons?: string[];
  saved?: boolean;
  requested?: boolean;
  can_request?: boolean;
}

export interface PriveDestinationPage {
  found: boolean;
  destination?: { slug: string; name: string; name_en?: string; kind: string; admin_area?: string; lat?: number; lng?: number; timezone?: string;
    currency?: string; region_group?: string; intro?: string; cover_query?: string; parent?: { slug: string; name: string };
    neighborhoods?: { slug: string; name: string }[]; areas?: { slug: string; name: string }[] };
  coverage?: { level: PriveCoverage; publicables: number; verificadas: number; universos: number };
  experiences?: PriveExperience[];
  age_locked_count?: number;
  adult_confirmed?: boolean;
}

export class PriveLockedError extends Error {
  constructor(public code: PriveErrorCode) { super(code); this.name = "PriveLockedError"; }
}

export type ContentFn = <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<PriveResult<T>>;

/** Resultado de prive_* → dato, o error: PriveLockedError si es un código de sesión Privé. */
function unwrap<T>(r: PriveResult<T>): T {
  if (r.ok) return r.data;
  if (isPriveSessionCode(r.code)) throw new PriveLockedError(r.code);
  throw new Error(r.code || "No se pudo cargar IATOS Privé");
}

/** RPC sin sesión Privé (adelanto y solicitudes propias): el servidor solo devuelve lo permitido. */
async function plainRpc<T>(fn: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (f: string, p: Record<string, unknown>) => Promise<{ data: T; error: { message?: string } | null }>)(fn, params);
  if (error) {
    const m = /PRIVE_[A-Z_]+/.exec(error.message ?? "")?.[0];
    if (m && isPriveSessionCode(m)) throw new PriveLockedError(m);
    throw new Error(error.message || "No se pudo cargar IATOS Privé");
  }
  return data;
}

type DestList = { slug: string; name: string; region_group: string; kind: string; coverage: PriveCoverage; count: number }[];

export function createPriveCatalogApi(content: ContentFn, getToken: () => string | null) {
  const c = async <T,>(fn: string, args: Record<string, unknown> = {}) => unwrap<T>(await content<T>(fn, args));
  return {
    /** Adelanto para quien aún no tiene Privé: universos, destinos y conteos (sin nombres). */
    teaser: () => plainRpc<{ universes: { key: PriveUniverse; count: number }[]; destinations: DestList; total: number }>("prive_teaser", {}),
    home: () => c<{ universes: { key: PriveUniverse; count: number }[]; destinations: DestList; total: number; adult_confirmed: boolean; adult_terms_version: string }>("prive_home"),
    destination: (slug: string) => c<PriveDestinationPage>("prive_destination", { _slug: slug }),
    universe: (universe: PriveUniverse, destination?: string | null) =>
      c<{ found: boolean; universe: PriveUniverse; experiences: PriveExperience[]; age_locked_count: number; adult_confirmed: boolean; adult_terms_version?: string }>(
        "prive_universe", { _universe: universe, _destination: destination ?? null }),
    experience: (idOrSlug: string) => c<{ found: boolean; age_locked?: boolean; age_policy?: string; experience?: PriveExperience }>("prive_experience", { _id_or_slug: idOrSlug }),
    forYou: (destination: string, from?: string | null, to?: string | null) => c<PriveExperience[]>("prive_for_you", { _destination: destination, _from: from ?? null, _to: to ?? null }),
    confirmAdult: (termsVersion: string) => c<boolean>("prive_confirm_adult", { _terms_version: termsVersion }),
    save: (experienceId: string, saved = true) => c<{ ok: boolean; saved?: boolean; code?: string }>("prive_save", { _experience_id: experienceId, _saved: saved }),
    saved: () => c<PriveExperience[]>("prive_saved"),
    addToTrip: (tripId: string, items: { experience_id: string; start_at?: string | null; end_at?: string | null; template?: string | null; transfer_estimate_min?: number | null }[]) =>
      c<{ ok: boolean; added: number; skipped: string[]; plan_group?: string; code?: string }>("prive_add_to_trip", { _trip_id: tripId, _items: items }),
    track: (event: string, opts: { experience?: string; destination?: string; surface?: string; trip?: string } = {}) =>
      c<boolean>("prive_track", { _event: event, _experience: opts.experience ?? null, _destination: opts.destination ?? null, _surface: opts.surface ?? null, _trip: opts.trip ?? null })
        .catch(() => false),
    myRequests: () => plainRpc<PriveRequest[]>("prive_my_requests", {}),
    cancelRequest: (id: string, note?: string) => plainRpc<{ ok: boolean; code?: string; status?: string }>("prive_request_cancel", { _id: id, _note: note ?? null }),
    /** Solicitar con Iato: pasa por concierge-action (avisa al equipo). Crea una SOLICITUD, no una reserva. */
    async request(input: { experienceId: string; title: string; requestedFor?: string | null; partySize?: number | null; preferences?: string | null;
      contactMethod?: "app" | "email" | "telefono" | "whatsapp"; tripId?: string | null; planGroup?: string | null }) {
      const token = getToken();
      if (!token) throw new PriveLockedError("PRIVE_NO_SESSION");
      const { data, error } = await supabase.functions.invoke("concierge-action", {
        headers: { "x-prive-session": token },
        body: {
          type: "prive_request", title: input.title.slice(0, 200), trip_id: input.tripId ?? null,
          payload: { experience_id: input.experienceId, requested_for: input.requestedFor ?? null, party_size: input.partySize ?? null,
            preferences: input.preferences ?? null, contact_method: input.contactMethod ?? "app", plan_group: input.planGroup ?? null },
        },
      });
      // Un 4xx llega como error con el cuerpo en error.context: se lee el `code` estable.
      const info = error ? await readFunctionError(error, "No se pudo enviar la solicitud") : null;
      const rawCode = (data as { code?: string } | null)?.code ?? info?.code ?? null;
      if (isPriveSessionCode(rawCode)) throw new PriveLockedError(rawCode);
      if (error || !(data as { ok?: boolean })?.ok) throw new Error(rawCode ?? "No se pudo enviar la solicitud");
      return data as { ok: true; request: { id: string; status: string }; human_notified: boolean; confirmation_required: true };
    },
  };
}
export type PriveCatalogApi = ReturnType<typeof createPriveCatalogApi>;

/** El cliente del catálogo dentro de las pantallas /prive/* (PriveProvider). */
export function usePriveCatalog(): PriveCatalogApi {
  const { content, session } = usePriveAccess();
  const token = session?.token ?? null;
  return useMemo(() => createPriveCatalogApi(content, () => token), [content, token]);
}

export interface PriveRequest {
  id: string; title: string; status: string; status_text: string; is_confirmed: boolean; label?: "ACCESO_CONFIRMADO" | null;
  confirmation_code?: string | null; requested_for?: string | null; party_size?: number | null; trip_id?: string | null;
  experience_id: string; created_at: string; history: { from: string | null; to: string; actor: string; at: string }[];
}
