// /prive/key — THE KEY (una de las seis áreas de Privé). Pantalla premium del modo Privé de Iato.
// Sin sesión Privé desbloqueada no se muestra nada: vuelve a /prive (candado o adelanto según el servidor).
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { usePriveAccess } from "@/hooks/usePriveAccess";
import { Monogram } from "@/components/prive/Monogram";
import { PriveKeyStudio } from "@/components/prive/key/PriveKeyStudio";
import { MyPlans } from "@/components/prive/key/MyPlans";
import { useKeyLang, KEY_TEXT } from "@/lib/priveKeyI18n";
import type { KeyMode } from "@/lib/priveKey";

export default function PriveKeyPage() {
  const { view, loading, status } = usePriveAccess();
  const lang = useKeyLang();
  const t = KEY_TEXT[lang];
  const [sp] = useSearchParams();
  const [refresh, setRefresh] = useState(0);
  if (loading && !status) {
    return <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label={t.brand}><Monogram size={56} className="opacity-60" /></div>;
  }
  if (view !== "unlocked") return <Navigate to="/prive" replace />;
  const w = sp.get("w");
  const m = sp.get("mode");
  const mode: KeyMode | null = m === "h48" || m === "surprise" || m === "key" ? m : null;
  return (
    <div className="mx-auto max-w-6xl space-y-14 px-4 pb-24 sm:px-8" data-testid="prive-key-page">
      <PriveKeyStudio lang={lang} t={t} initialWish={w ? w.slice(0, 600) : null} initialMode={mode} autoSubmit={!!w} onPlanSaved={() => setRefresh((n) => n + 1)} />
      <MyPlans t={t} lang={lang} refreshKey={refresh} />
    </div>
  );
}
