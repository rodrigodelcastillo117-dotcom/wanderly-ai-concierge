import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Lock } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { listVault } from "@/lib/boveda/api";
import { SECTION_LABEL, VAULT_SECTIONS, type VaultSection } from "@/lib/boveda/types";

// La bóveda completa vive en /dashboard/beneficios (documentos con foto, membresías, tarjetas y
// seguros en filas propias con RLS). Aquí, en el perfil, solo un resumen con el acceso.
const BenefitsVault = () => {
  const { user } = useAuth();
  const [counts, setCounts] = useState<Record<VaultSection, number> | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void listVault().then(({ items }) => {
      if (!alive) return;
      setCounts(Object.fromEntries(VAULT_SECTIONS.map((s) => [s, items.filter((i) => i.section === s).length])) as Record<VaultSection, number>);
    });
    return () => { alive = false; };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Link to="/dashboard/beneficios" aria-label="Abrir Documentos y tarjetas"
      className="group block rounded-2xl gold-border glass-card p-5 hover:border-primary/60 transition">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.28em] text-primary flex items-center gap-1.5"><Lock className="w-3 h-3" aria-hidden="true" /> Documentos y tarjetas · privado</p>
          <p className="font-display text-xl mt-1">Documentos, membresías, tarjetas y seguros</p>
        </div>
        <ChevronRight className="w-5 h-5 text-primary shrink-0 transition group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {VAULT_SECTIONS.map((s) => (
          <div key={s} className="rounded-xl bg-surface/70 border border-border/50 px-2 py-2 text-center">
            <p className="font-display text-lg tabular-nums">{counts ? counts[s] : "–"}</p>
            <p className="text-[10px] text-muted-foreground truncate">{SECTION_LABEL[s]}</p>
          </div>
        ))}
      </div>
    </Link>
  );
};

export default BenefitsVault;
