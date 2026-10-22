/**
 * Cliente de privevalor sobre usePriveAccess().content (equipo ui): sin sesión Privé no se llama al
 * servidor y un código PRIVE_* se vuelve PriveLockedError (el hook ya borró la sesión). El servidor decide
 * siempre (prive_require en cada RPC). La vista previa (antes del día 90) usa una RPC sin sesión Privé que
 * solo registra un evento.
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { isPriveSessionCode, type PriveResult } from "@/lib/priveApi";
import { PriveLockedError, type ContentFn } from "@/lib/priveCatalogApi";
import type {
  BeforeYouGoData, DropsResponse, DropType, InsiderIndex, InsiderPage, PassportData, PassportEntry, PriveDrop,
  RadarItem, RadarResponse, RadarState, ValueEntry, ValueSummary,
} from "@/lib/priveValueModel";

export type ValueEvent = "drops_view" | "drop_open" | "drop_link_open" | "radar_view" | "value_view" | "insider_view"
  | "before_you_go_view" | "passport_view" | "edition_teaser_click";
export type ValueSurface = "for_you" | "drops" | "insider" | "my_prive" | "radar" | "trip" | "edition";
// Las dos ramas declaran `code` para leer r.code sin depender de strictNullChecks (la app compila sin modo estricto).
type Ok<T> = { ok: true; code?: undefined } & T;
type Fail = { ok: false; code: string };

function unwrap<T>(r: PriveResult<T>): T {
  if (r.ok) return r.data;
  if (isPriveSessionCode(r.code)) throw new PriveLockedError(r.code);
  throw new Error(r.code || "SERVICE_UNAVAILABLE");
}

export function createPriveValueApi(content: ContentFn) {
  const c = async <T,>(fn: string, args: Record<string, unknown> = {}) => unwrap<T>(await content<T>(fn, args));
  return {
    drops: (opts: { destination?: string | null; types?: DropType[] | null; interests?: string[] | null; limit?: number } = {}) =>
      c<DropsResponse>("prive_drops", { _destination: opts.destination ?? null, _types: opts.types ?? null, _interests: opts.interests ?? null, _limit: opts.limit ?? 30 }),
    drop: (slug: string) => c<{ found: boolean; drop?: PriveDrop }>("prive_drop", { _slug: slug }),
    radar: (destination?: string | null) => c<RadarResponse>("prive_radar", { _destination: destination ?? null }),
    radarSave: (item: Partial<RadarItem> & { drop_id?: string | null; state?: RadarState; verification_note?: string | null; used_at?: string | null }) =>
      c<Ok<{ item: RadarItem }> | Fail>("prive_radar_save", { _item: item }),
    radarDelete: (id: string) => c<{ ok: boolean }>("prive_radar_delete", { _id: id }),
    valueSummary: () => c<ValueSummary>("prive_value_summary"),
    valueSave: (entry: Partial<ValueEntry>) => c<Ok<{ entry: ValueEntry }> | Fail>("prive_value_save", { _entry: entry }),
    valueDelete: (id: string) => c<{ ok: boolean }>("prive_value_delete", { _id: id }),
    insiderIndex: () => c<InsiderIndex>("prive_insider_index"),
    insider: (destination: string) => c<InsiderPage>("prive_insider", { _destination: destination }),
    beforeYouGo: (tripId?: string | null) => c<BeforeYouGoData & { code?: string }>("prive_before_you_go", { _trip: tripId ?? null }),
    tipSave: (tipId: string, saved = true) => c<{ ok: boolean; saved?: boolean; code?: string }>("prive_tip_save", { _tip: tipId, _saved: saved }),
    tipAddToTrip: (tipId: string, tripId: string) => c<{ ok: boolean; added?: boolean; already_present?: boolean; code?: string }>("prive_tip_add_to_trip", { _tip: tipId, _trip: tripId }),
    passport: () => c<PassportData>("prive_passport"),
    passportSave: (entry: Omit<Partial<PassportEntry>, "destination"> & { destination?: string | null }) => c<Ok<{ entry: PassportEntry }> | Fail>("prive_passport_save", { _entry: entry }),
    passportDelete: (id: string) => c<{ ok: boolean }>("prive_passport_delete", { _id: id }),
    /** Métricas de producto: solo códigos e ids internos, nunca texto. Nunca lanza. */
    track: (event: ValueEvent, opts: { ref?: string | null; destination?: string | null; surface?: ValueSurface } = {}) =>
      c<boolean>("prive_value_track", { _event: event, _ref: opts.ref ?? null, _destination: opts.destination ?? null, _surface: opts.surface ?? null }).catch(() => false),
  };
}
export type PriveValueApi = ReturnType<typeof createPriveValueApi>;

export function usePriveValue(): PriveValueApi {
  const { content } = usePriveAccess();
  return useMemo(() => createPriveValueApi(content), [content]);
}

/** Vista previa antes del día 90: solo registra el evento (sin sesión Privé). Nunca lanza. */
export async function trackPreview(event: "preview_view" | "preview_pro_click"): Promise<boolean> {
  try {
    const { data, error } = await (supabase.rpc as unknown as (f: string, p: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)(
      "prive_preview_track", { _event: event });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Adelanto público (destinos del catálogo, sin contenido protegido). */
export async function previewDestinations(): Promise<{ slug: string; name: string; region_group: string }[]> {
  try {
    const { data, error } = await (supabase.rpc as unknown as (f: string, p: Record<string, unknown>) => Promise<{ data: { destinations?: { slug: string; name: string; region_group: string }[] } | null; error: unknown }>)(
      "prive_teaser", {});
    if (error || !data?.destinations) return [];
    return data.destinations;
  } catch {
    return [];
  }
}
