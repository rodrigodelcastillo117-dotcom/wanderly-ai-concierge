import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fetchMembersTeaser, summarizeTeaser, UNLOCK_ERRORS, type TeaserSummary } from "@/lib/membersAccess";
import { PRO_PATH } from "@/lib/functionErrors";
import { PriveEntryLink } from "@/components/PriveEntryLink";
import { OTHER_CATEGORY, isKnownCategory } from "@/lib/membersVenues";

const CATEGORY_LABELS: Record<string, string> = {
  cabaret: "🎭 Cabaret", burlesque: "💃 Burlesque", members_club: "🥃 Members Club", speakeasy: "🍸 Speakeasy",
  rooftop: "🌃 Rooftop", casino_vip: "🎰 Casino VIP", jazz_lounge: "🎷 Jazz Lounge", evento_vip: "🥂 Evento VIP",
  [OTHER_CATEGORY.id]: `${OTHER_CATEGORY.emoji} ${OTHER_CATEGORY.label}`,
};

// Lo curado de Privé trae categorías que la lista no conoce (coctelería, mezcalería…): se suman en "Otros".
function groupCategories(categories: Record<string, number>): [string, number][] {
  const m: Record<string, number> = {};
  for (const [cat, n] of Object.entries(categories)) {
    const k = isKnownCategory(cat) ? cat : OTHER_CATEGORY.id;
    m[k] = (m[k] ?? 0) + n;
  }
  return Object.entries(m);
}

/** Ciudades visibles antes de "Ver las N". */
const TEASER_CITIES = 12;

interface Props {
  /** La contraseña temporal del dueño está encendida y vigente (members_access_state.password_gate). */
  passwordGate: boolean;
  /** Se llama cuando el servidor confirma el acceso (p. ej. tras la contraseña temporal). */
  onUnlocked: () => void;
}

/**
 * Adelanto de Members Only para quien no tiene IATOS PRO: ciudades, categorías y cuántos lugares
 * hay. Los nombres, direcciones, sitios y detalles NO llegan al navegador (RLS + members_teaser).
 */
export function MembersTeaser({ passwordGate, onUnlocked }: Props) {
  const [summary, setSummary] = useState<TeaserSummary | null>(null);
  const [pw, setPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [busy, setBusy] = useState(false);
  const [allCities, setAllCities] = useState(false);

  useEffect(() => {
    fetchMembersTeaser(supabase).then((rows) => setSummary(summarizeTeaser(rows)));
  }, []);

  const unlock = async () => {
    if (!pw.trim() || busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("unlock_members_access", { p_password: pw });
    setBusy(false);
    const r = (data ?? {}) as { ok?: boolean; error?: string };
    if (error || !r.ok) {
      setPwError(UNLOCK_ERRORS[r.error ?? ""] ?? "No pudimos verificar el acceso. Intenta de nuevo.");
      return;
    }
    setPwError("");
    onUnlocked();
  };

  return (
    <div className="px-4 md:px-10 pt-4 md:pt-8 pb-28 md:pb-10 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-primary text-[10px] tracking-[0.25em] uppercase">
            <Sparkles className="w-3 h-3" aria-hidden="true" /> Vida nocturna premium
          </p>
          <h2 className="font-fraunces text-2xl md:text-4xl text-foreground leading-tight">Solo para miembros</h2>
        </div>
        <PriveEntryLink />
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Vida nocturna seleccionada con reservas gestionadas por tu Concierge. Es exclusivo de IATOS PRO:
        aquí ves un adelanto de lo que incluye.
      </p>

      <div className="rounded-2xl border border-primary/25 bg-black/40 p-4 md:p-6 mb-5 flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4">
        <Lock className="w-5 h-5 text-primary shrink-0 hidden sm:block" aria-hidden="true" />
        <p className="text-sm flex-1">
          {summary && summary.total > 0
            ? `${summary.total} lugares en ${summary.cities.length} ${summary.cities.length === 1 ? "ciudad" : "ciudades"}. Los nombres, direcciones y reservas se desbloquean con IATOS PRO.`
            : "Los nombres, direcciones y reservas se desbloquean con IATOS PRO."}
        </p>
        <Button asChild className="bg-gradient-gold text-primary-foreground">
          <Link to={PRO_PATH}>Conocer IATOS PRO</Link>
        </Button>
      </div>

      {summary && summary.total > 0 && (
        <>
          <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2">Por categoría</p>
          <ul className="flex gap-2 mb-5 overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 md:flex-wrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Categorías">
            {groupCategories(summary.categories).map(([cat, n]) => (
              <li key={cat} className="shrink-0 whitespace-nowrap px-3.5 py-1.5 rounded-full text-xs border border-primary/20 text-muted-foreground">
                {CATEGORY_LABELS[cat] ?? cat} <span className="text-muted-foreground">({n})</span>
              </li>
            ))}
          </ul>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground">Ciudades con curaduría</p>
            {summary.cities.length > TEASER_CITIES && (
              <button type="button" onClick={() => setAllCities((v) => !v)} aria-expanded={allCities} className="text-[11px] text-primary hover:underline underline-offset-2">
                {allCities ? "Ver menos" : `Ver las ${summary.cities.length}`}
              </button>
            )}
          </div>
          {/* Chips compactos (antes, una tarjeta por ciudad: 79 ciudades = varias pantallas de scroll). */}
          <ul className="flex flex-wrap gap-1.5 mb-6" aria-label="Ciudades">
            {(allCities ? summary.cities : summary.cities.slice(0, TEASER_CITIES)).map((c) => (
              <li key={c.ciudad} className="rounded-full border border-primary/15 bg-black/30 px-3 py-1.5 text-xs">
                {c.display}<span className="text-muted-foreground"> · {c.total}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {passwordGate && (
        <div className="rounded-2xl border border-primary/15 bg-black/30 p-6 max-w-md">
          <p className="text-sm mb-3">¿Tienes una contraseña temporal de miembro?</p>
          <Input
            type="password" value={pw} placeholder="Contraseña"
            onChange={(e) => { setPw(e.target.value); setPwError(""); }}
            onKeyDown={(e) => e.key === "Enter" && unlock()}
            aria-label="Contraseña temporal de miembro"
          />
          {pwError && <p role="alert" className="text-destructive text-xs mt-2">{pwError}</p>}
          <Button onClick={unlock} disabled={busy} variant="outline" className="mt-3">Desbloquear</Button>
        </div>
      )}
    </div>
  );
}
