// Estado compartido de /prive/edicion/*: idioma, preferencias del miembro y el número vigente (una sola
// carga por visita; las pantallas personalizan en el navegador, sin más llamadas ni IA).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PriveLockedError } from "@/lib/priveCatalogApi";
import type { PriveErrorCode } from "@/lib/priveApi";
import { DEFAULT_PREFS, resolveLanguage, type EditionPrefs, type IssuePayload, type Lang } from "@/lib/priveEdition";
import { useEditionApi, type EditionApi } from "@/lib/priveEditionApi";
import { invalidateEditionSection } from "./PrivateEditionTeaser";

const LANG_KEY = "iatos_edition_lang";
const readLocalLang = (): Lang | null => {
  try { const v = localStorage.getItem(LANG_KEY); return v === "en" || v === "es" ? v : null; } catch { return null; }
};

export interface EditionState {
  api: EditionApi;
  lang: Lang;
  setLang: (l: Lang) => void;
  prefs: EditionPrefs;
  prefsSaved: boolean;
  savePrefs: (p: EditionPrefs) => Promise<boolean>;
  issue: IssuePayload | null;
  loading: boolean;
  locked: PriveErrorCode | null;
  error: string | null;
  reload: () => void;
  saved: Set<string>;
  toggleSave: (slug: string) => Promise<void>;
}

const Ctx = createContext<EditionState | null>(null);

export function EditionProvider({ children }: { children: ReactNode }) {
  const api = useEditionApi();
  const [prefs, setPrefs] = useState<EditionPrefs>(DEFAULT_PREFS);
  const [prefsSaved, setPrefsSaved] = useState(false);
  const [localLang, setLocalLang] = useState<Lang | null>(readLocalLang);
  const [issue, setIssue] = useState<IssuePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState<PriveErrorCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    Promise.all([api.prefs(), api.issue(null)])
      .then(([p, iss]) => {
        if (!alive) return;
        setPrefs({ ...DEFAULT_PREFS, ...p, section_order: (p.section_order ?? []) as EditionPrefs["section_order"] });
        setPrefsSaved(!!p.saved);
        setIssue(iss);
        setSaved(new Set(iss.saved ?? []));
        setLocked(null);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof PriveLockedError) setLocked(e.code);
        else setError("load");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [api, tick]);

  const lang = localLang ?? resolveLanguage(prefsSaved ? prefs : null, typeof navigator !== "undefined" ? navigator.language : "es");

  const savePrefs = useCallback(async (p: EditionPrefs) => {
    try {
      const r = await api.savePrefs(p);
      setPrefs({ ...DEFAULT_PREFS, ...r, section_order: (r.section_order ?? []) as EditionPrefs["section_order"] });
      setPrefsSaved(true);
      invalidateEditionSection();
      return true;
    } catch (e) {
      if (e instanceof PriveLockedError) setLocked(e.code);
      return false;
    }
  }, [api]);

  const setLang = useCallback((l: Lang) => {
    setLocalLang(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* modo privado */ }
    if (prefsSaved) void savePrefs({ ...prefs, language: l });
  }, [prefs, prefsSaved, savePrefs]);

  const toggleSave = useCallback(async (slug: string) => {
    const next = !saved.has(slug);
    try {
      const r = await api.save(slug, next);
      if (r.ok) setSaved((s) => { const n = new Set(s); if (next) n.add(slug); else n.delete(slug); return n; });
    } catch (e) {
      if (e instanceof PriveLockedError) setLocked(e.code);
    }
  }, [api, saved]);

  const value = useMemo<EditionState>(() => ({
    api, lang, setLang, prefs, prefsSaved, savePrefs, issue, loading, locked, error, reload: () => setTick((t) => t + 1), saved, toggleSave,
  }), [api, lang, setLang, prefs, prefsSaved, savePrefs, issue, loading, locked, error, saved, toggleSave]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEdition(): EditionState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEdition must be used inside EditionProvider");
  return c;
}
