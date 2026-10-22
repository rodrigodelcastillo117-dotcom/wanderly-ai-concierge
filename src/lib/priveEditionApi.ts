/**
 * Cliente de THE PRIVATE EDITION. Lectura: RPC prive_edition_* con la sesión Privé (usePriveAccess().content):
 * sin sesión no se llama al servidor y un PRIVE_* manda al candado. El servidor decide siempre.
 * Panel: RPC edition_admin_* con la sesión de IATOS (el servidor exige public.admins).
 */
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isPriveSessionCode, type PriveResult } from "@/lib/priveApi";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import type { EditionArticle, EditionImage, EditionIssue, EditionPrefs, EditionSource, IssuePayload, Opportunity } from "@/lib/priveEdition";

export type ContentFn = <T = unknown>(fn: string, args?: Record<string, unknown>) => Promise<PriveResult<T>>;

export class EditionError extends Error {
  constructor(public code: string) { super(code); this.name = "EditionError"; }
}

function unwrap<T>(r: PriveResult<T>): T {
  if (r.ok) return r.data;
  if (isPriveSessionCode(r.code)) throw new PriveLockedError(r.code);
  throw new EditionError(r.code || "SERVICE_UNAVAILABLE");
}

export interface LibraryPayload { issues: (EditionIssue & { article_count: number })[]; images: Record<string, EditionImage>; saved_count: number; generated_at: string }
export interface BriefPayload { items: EditionArticle[]; expired_count: number; today: string; generated_at: string }
export interface SavedPayload { items: (EditionArticle & { saved_at: string })[]; images: Record<string, EditionImage>; generated_at: string }
export interface ArticlePayload { found: boolean; article?: EditionArticle; images?: Record<string, EditionImage>; saved?: boolean;
  retracted?: { slug: string; title: { es: string; en?: string }; note: string; at: string }; generated_at?: string }
export interface OpportunitiesPayload { available: boolean; items: Opportunity[]; expired_recent: number; generated_at: string | null }

export function createEditionApi(content: ContentFn) {
  const c = async <T,>(fn: string, args: Record<string, unknown> = {}) => unwrap<T>(await content<T>(fn, args));
  return {
    library: () => c<LibraryPayload>("prive_edition_library"),
    issue: (slug?: string | null) => c<IssuePayload>("prive_edition_issue", { _slug: slug ?? null }),
    article: (slug: string) => c<ArticlePayload>("prive_edition_article", { _slug: slug }),
    worldBrief: () => c<BriefPayload>("prive_edition_world_brief"),
    prefs: () => c<EditionPrefs & { saved: boolean }>("prive_edition_prefs"),
    savePrefs: (prefs: Partial<EditionPrefs>) => c<EditionPrefs & { saved: boolean }>("prive_edition_prefs_save", { _prefs: prefs }),
    save: (slug: string, saved: boolean) => c<{ ok: boolean; saved?: boolean; code?: string }>("prive_edition_save", { _slug: slug, _saved: saved }),
    saved: () => c<SavedPayload>("prive_edition_saved"),
    logDownload: (input: { issue: string; format: "pdf" | "offline"; kind: "issue" | "flight"; articles: number; images: number; bytes?: number; ms?: number; lang?: string }) =>
      content<boolean>("prive_edition_log_download", { _issue: input.issue, _format: input.format, _kind: input.kind, _article_count: input.articles,
        _image_count: input.images, _bytes: input.bytes ?? null, _duration_ms: input.ms ?? null, _language: input.lang ?? null }).then((r) => r.ok && r.data === true),
    /**
     * Privé Opportunities = PRIVÉ DROPS del equipo privevalor (prive_drops). Interfaz estrecha: si la RPC no
     * existe todavía (NOT_AVAILABLE) la respuesta es "no disponible" con cero elementos; jamás datos inventados.
     */
    async opportunities(opts: { destination?: string | null; interests?: string[] | null; limit?: number } = {}): Promise<OpportunitiesPayload> {
      const r = await content<{ items?: Opportunity[]; expired_recent?: number; generated_at?: string }>("prive_drops", {
        _destination: opts.destination ?? null, _types: null, _interests: opts.interests?.length ? opts.interests : null, _limit: opts.limit ?? 20,
      });
      if (!r.ok) {
        if (isPriveSessionCode(r.code)) throw new PriveLockedError(r.code);
        if (r.code === "NOT_AVAILABLE") return { available: false, items: [], expired_recent: 0, generated_at: null };
        throw new EditionError(r.code);
      }
      return { available: true, items: Array.isArray(r.data?.items) ? r.data.items : [], expired_recent: Number(r.data?.expired_recent ?? 0), generated_at: r.data?.generated_at ?? null };
    },
  };
}
export type EditionApi = ReturnType<typeof createEditionApi>;

/** Cliente de lectura dentro de /prive/edicion (PriveProvider). */
export function useEditionApi(): EditionApi {
  const { content } = usePriveAccess();
  return useMemo(() => createEditionApi(content), [content]);
}

// ───────────────────────────── panel editorial ─────────────────────────────
export interface AdminOverview {
  issues: (EditionIssue & { checks: { blocking: string[]; warnings: string[] } })[];
  articles: (EditionArticle & { checks: { blocking: string[]; warnings: string[] }; source_count: number; updated_at?: string; scheduled_for?: string })[];
  sources: (EditionSource & { verification?: string; link_http?: number; link_checked_at?: string; used_by: string[] })[];
  images: (EditionImage & { license_note?: string; verification?: string })[];
  reviews: { entity: string; key: string; action: string; note?: string; at: string; by_me: boolean }[];
  downloads: { pdf_30d: number; offline_30d: number; avg_pdf_bytes: number | null; avg_pdf_ms: number | null };
  generated_at: string;
}
type RpcClient = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; details?: string } | null }> };

export function createEditionAdminApi(client: RpcClient = supabase as unknown as RpcClient) {
  const call = async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      const code = /EDITION_[A-Z_]+/.exec(error.message ?? "")?.[0] ?? "SERVICE_UNAVAILABLE";
      const err = new EditionError(code);
      (err as EditionError & { detail?: string }).detail = error.details ?? "";
      throw err;
    }
    return data as T;
  };
  return {
    overview: () => call<AdminOverview>("edition_admin_overview"),
    preview: (issue?: string | null) => call<IssuePayload>("edition_admin_preview", { _issue_slug: issue ?? null }),
    updateArticle: (slug: string, patch: Record<string, unknown>, note?: string) => call<{ ok: boolean }>("edition_admin_article_update", { _slug: slug, _patch: patch, _note: note ?? null }),
    correctArticle: (slug: string, patch: Record<string, unknown>, note: string) => call<{ ok: boolean }>("edition_admin_article_correct", { _slug: slug, _patch: patch, _note: note }),
    articleTransition: (slug: string, action: string, opts: { note?: string; when?: string; label?: string } = {}) =>
      call<{ ok: boolean }>("edition_admin_article_transition", { _slug: slug, _action: action, _note: opts.note ?? null, _when: opts.when ?? null, _label: opts.label ?? null }),
    issueTransition: (slug: string, action: string, opts: { note?: string; when?: string; label?: string } = {}) =>
      call<{ ok: boolean }>("edition_admin_issue_transition", { _slug: slug, _action: action, _note: opts.note ?? null, _when: opts.when ?? null, _label: opts.label ?? null }),
    imageLicense: (key: string, decision: "approve" | "block", note?: string) => call<{ ok: boolean }>("edition_admin_image_license", { _key: key, _decision: decision, _note: note ?? null }),
    markSource: (key: string, status: "ok" | "broken" | "blocked" | "unchecked", http?: number) => call<boolean>("edition_record_link_check", { _key: key, _status: status, _http: http ?? null }),
    async checkLinks(): Promise<{ checked: number; broken: number } | null> {
      const { data, error } = await supabase.functions.invoke("edition-link-check", { body: {} });
      if (error) return null;
      return data as { checked: number; broken: number };
    },
  };
}
export type EditionAdminApi = ReturnType<typeof createEditionAdminApi>;

/** Mensajes de las reglas que bloquean una aprobación, en lenguaje de editor. */
export function describeCheck(code: string): string {
  const [k, arg] = code.split(":");
  const m: Record<string, string> = {
    no_sources: "Sin fuentes registradas.",
    sensitive_needs_two_sources: "Tema sensible: necesita al menos dos fuentes.",
    broken_source: `Fuente con enlace roto: ${arg}.`,
    unchecked_source: `Enlace de fuente sin comprobar: ${arg}.`,
    source_blocks_robots: `La fuente bloquea la comprobación automática: ${arg} (revisar a mano).`,
    image_missing: `Imagen inexistente: ${arg}.`,
    image_not_licensed: `Imagen sin licencia aprobada: ${arg}.`,
    brief_without_date: "Breve sin fecha del hecho.",
    brief_fact_too_old: "El hecho tiene más de 90 días: no se presenta como noticia.",
    brief_fact_in_future: "La fecha del hecho está en el futuro.",
    expired: "Vigencia terminada.",
    action_unknown: `Acción desconocida: ${arg}.`,
    action_link_not_https: "Enlace oficial no https.",
    action_link_without_source: `Enlace a ${arg}, que no es dominio de ninguna fuente del artículo.`,
    ai_draft_needs_human_read: "Borrador de IA: requiere lectura humana completa.",
    not_enough_content: `Contenido insuficiente: ${arg} piezas aprobadas (mínimo 4).`,
    cover_article_not_approved: "El artículo de portada no está aprobado.",
    cover_image_not_licensed: "La foto de portada no tiene licencia aprobada.",
    articles_pending_review: `${arg} piezas siguen en revisión (no se publicarán).`,
  };
  return m[k] ?? code;
}
