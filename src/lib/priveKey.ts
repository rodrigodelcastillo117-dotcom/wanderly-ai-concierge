/**
 * Cliente de THE PRIVÉ KEY. El plan lo arma Iato en su modo Privé (concierge-chat, mode "prive_key", sin modelo
 * de IA); guardar, llevar al viaje y el recorrido van por las RPC prive_key_* (con sesión Privé). Nada aquí decide
 * acceso: el servidor revisa cada llamada (prive_require). Ante un código PRIVE_* se lanza PriveLockedError para
 * que la pantalla vuelva al candado.
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { readFunctionError } from "@/lib/functionErrors";
import { isPriveSessionCode } from "@/lib/priveApi";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { localISODate } from "@/lib/localDate";
import type { KeyAnswers, KeyMode, KeyProposal, KeyQuestion, KeyResult, KeyStep } from "../../supabase/functions/_shared/priveKey";
import type { KeyLang } from "@/lib/priveKeyI18n";

export type { KeyAnswers, KeyMode, KeyProposal, KeyQuestion, KeyResult, KeyStep };

export interface KeyResponse extends Partial<KeyResult> {
  ok: boolean;
  code?: string;
  message?: string;
  trip?: { id: string; label: string; reason: string } | null;
  trip_note?: string | null;
  trip_choice?: { id: string; label: string }[];
  destination?: { slug: string; name: string; timezone?: string; currency?: string } | null;
  coverage?: string | null;
  fx_note?: string | null;
  hotel?: { name: string; located: boolean; source: string } | null;
  hotel_note?: string | null;
  cost?: { ai_calls: number; ai_tokens: number; db_rpc_calls: number; cache: "hit" | "miss"; est_usd: number; ms: number };
}

export interface SavedPlanStep {
  experience_id: string; date?: string; start?: string; end?: string; start_iso?: string; intent?: string; transfer_min?: number;
  experience?: Record<string, any> | null; follow_up: string; available: boolean;
}
export interface SavedPlan {
  id: string; mode: KeyMode; tier: KeyProposal["tier"]; wish?: string | null; destination?: string | null; party_size?: number | null;
  trip_id?: string | null; trip_label?: string | null; status: "guardado" | "en_viaje" | "archivado"; created_at: string; steps: SavedPlanStep[];
}

export type KeyEvent = "key_open" | "wish_submitted" | "questions_shown" | "proposals_shown" | "first_option" | "proposal_opened" | "plan_saved"
  | "plan_added_to_trip" | "booking_opened" | "request_started" | "ask_iato" | "surprise_shown" | "surprise_another" | "surprise_love"
  | "world_ready_shown" | "world_ready_open" | "taste_saved" | "limit_reached" | "no_coverage";

const browserTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };

/** Lo que se guarda de una propuesta: solo referencias (el servidor vuelve a leer nombres y estado). */
export function planPayload(p: KeyProposal, wish: { text: string; mode: KeyMode; destination?: string | null; party?: number | null; budget?: { amount: number; currency: string } | null }) {
  return {
    mode: wish.mode, tier: p.tier, wish: wish.text.slice(0, 600), destination: wish.destination ?? null, party_size: wish.party ?? null,
    budget: wish.budget ? { amount: wish.budget.amount, currency: wish.budget.currency } : null,
    steps: p.steps.map((s) => ({ experience_id: s.experience.id, date: s.date, start: s.start, end: s.end, start_iso: s.start_iso, intent: s.intent,
      time_status: s.time_status, transfer_min: s.transfer?.minutes ?? undefined })),
  };
}

export function createPriveKeyApi(getToken: () => string | null, content: <T>(fn: string, args?: Record<string, unknown>) => Promise<{ ok: boolean; data?: T; code?: string }>) {
  const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const r = await content<T>(fn, args);
    if (r.ok) return r.data as T;
    if (isPriveSessionCode(r.code)) throw new PriveLockedError(r.code);
    throw new Error(r.code || "PRIVE_ERROR");
  };
  return {
    /** Un deseo → preguntas o propuestas. Nunca por tecla: solo al enviar o al contestar. */
    async plan(input: { wish: string; answers?: KeyAnswers; mode?: KeyMode | null; tripId?: string | null; exclude?: string[]; lang?: KeyLang }): Promise<KeyResponse> {
      const token = getToken();
      if (!token) throw new PriveLockedError("PRIVE_NO_SESSION");
      const { data, error } = await supabase.functions.invoke("concierge-chat", {
        headers: { "x-prive-session": token },
        body: { mode: "prive_key", wish: input.wish, answers: input.answers ?? {}, key_mode: input.mode ?? undefined, trip_id: input.tripId ?? null,
          exclude: input.exclude ?? [], lang: input.lang ?? "es", client_date: localISODate(), tz: browserTz() },
      });
      if (error) {
        const info = await readFunctionError(error, "PRIVE_ERROR");
        if (isPriveSessionCode(info?.code)) throw new PriveLockedError(info!.code as never);
        return { ok: false, code: info?.code ?? "PRIVE_ERROR", message: info?.message };
      }
      const res = (data ?? { ok: false, code: "PRIVE_ERROR" }) as KeyResponse;
      if (!res.ok && isPriveSessionCode(res.code)) throw new PriveLockedError(res.code as never);
      return res;
    },
    save: (payload: ReturnType<typeof planPayload>) => rpc<{ ok: boolean; id?: string; code?: string }>("prive_key_save", { _plan: payload }),
    plans: () => rpc<SavedPlan[]>("prive_key_plans", {}),
    addToTrip: (planId: string, tripId: string) => rpc<{ ok: boolean; added?: number; already?: boolean; code?: string }>("prive_key_add_to_trip", { _plan_id: planId, _trip_id: tripId }),
    archive: (planId: string) => rpc<{ ok: boolean }>("prive_key_archive", { _plan_id: planId }),
    tasteSave: (taste: { loves: string[]; budget?: string | null }, consent: boolean) => rpc<{ ok: boolean }>("prive_key_taste_save", { _taste: taste, _consent: consent }),
    /** Recorrido sin texto libre. Nunca rompe la pantalla. */
    track: (event: KeyEvent, props: { ms?: number; mode?: KeyMode; tier?: string; destination?: string | null; plan_id?: string } = {}) =>
      rpc<boolean>("prive_key_track", { _event: event, _props: props }).catch(() => false),
  };
}
export type PriveKeyApi = ReturnType<typeof createPriveKeyApi>;

export function usePriveKeyApi(): PriveKeyApi {
  const { content, session } = usePriveAccess();
  const token = session?.token ?? null;
  return useMemo(() => createPriveKeyApi(() => token, content as never), [content, token]);
}

/** Enlace a Iato (el Concierge de siempre) con una pregunta lista, sin enviarla: el usuario decide. */
export function askIatoHref(text: string): string {
  return `/dashboard/concierge?ask=${encodeURIComponent(text.slice(0, 400))}`;
}

/** Texto para preguntarle a Iato por una propuesta concreta (no inventa nada: solo lo que ya está en el plan). */
export function askIatoAbout(p: KeyProposal, lang: KeyLang): string {
  const names = p.steps.map((s) => s.experience.name).join(", ");
  return lang === "en"
    ? `About my Privé Key plan ${p.title} (${names}): what should I confirm first and how do I book it?`
    : `Sobre mi plan ${p.title} de The Privé Key (${names}): ¿qué confirmo primero y cómo lo reservo?`;
}
