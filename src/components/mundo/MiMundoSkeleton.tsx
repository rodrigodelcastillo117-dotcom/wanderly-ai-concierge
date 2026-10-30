import { Globe2 } from "lucide-react";

/** Lugar del globo mientras carga (misma altura: la página no brinca). */
export function MiMundoSkeleton({ label = "Cargando tu mundo…" }: { label?: string }) {
  return (
    <div className="h-[340px] rounded-2xl bg-black/60 border border-white/[0.04] animate-pulse flex items-center justify-center" role="status" aria-label={label}>
      <Globe2 className="w-8 h-8 text-primary/40" aria-hidden="true" />
    </div>
  );
}
