import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fetchMembersTeaser, summarizeTeaser, UNLOCK_ERRORS, type TeaserSummary } from "@/lib/membersAccess";
import { PRO_PATH } from "@/lib/functionErrors";
import { PriveEntryLink } from "@/components/PriveEntryLink";

const CATEGORY_LABELS: Record<string, string> = {
  cabaret: "🎭 Cabaret", burlesque: "💃 Burlesque", members_club: "🥃 Members Club", speakeasy: "🍸 Speakeasy",
  rooftop: "🌃 Rooftop", casino_vip: "🎰 Casino VIP", jazz_lounge: "🎷 Jazz Lounge", evento_vip: "🥂 Evento VIP",
};

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
    <div className="px-4 md:px-10 py-8 md:py-10 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-primary text-xs tracking-[0.2em] uppercase mb-3">
        <Sparkles className="w-3.5 h-3.5" /> Nightlife Premium
      </div>
      <h2 className="font-fraunces text-3xl md:text-5xl text-foreground mb-2">Members Only</h2>
      <PriveEntryLink />
      <p className="text-muted-foreground mb-6">
        Vida nocturna seleccionada con reservas gestionadas por tu Concierge. Es exclusivo de IATOS PRO:
        aquí ves un adelanto de lo que incluye.
      </p>

      <div className="rounded-2xl border border-primary/25 bg-black/40 p-6 mb-8 flex flex-col sm:flex-row sm:items-center gap-4">
        <Lock className="w-6 h-6 text-primary shrink-0" />
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
          <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground mb-3">Por categoría</p>
          <ul className="flex flex-wrap gap-2 mb-8" aria-label="Categorías">
            {Object.entries(summary.categories).map(([cat, n]) => (
              <li key={cat} className="px-4 py-2 rounded-full text-xs border border-primary/20 text-muted-foreground">
                {CATEGORY_LABELS[cat] ?? cat} <span className="opacity-60">({n})</span>
              </li>
            ))}
          </ul>
          <p className="text-xs tracking-[0.18em] uppercase text-muted-foreground mb-3">Ciudades con curaduría</p>
          <ul className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-8" aria-label="Ciudades">
            {summary.cities.map((c) => (
              <li key={c.ciudad} className="rounded-xl border border-primary/15 bg-black/30 px-4 py-3 text-sm">
                {c.display}{c.pais ? <span className="text-muted-foreground">, {c.pais}</span> : null}
                <span className="block text-xs text-muted-foreground">{c.total} {c.total === 1 ? "lugar" : "lugares"}</span>
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
