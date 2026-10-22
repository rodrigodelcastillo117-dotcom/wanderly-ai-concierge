import { Link } from "react-router-dom";
import { Gem } from "lucide-react";

/** Acceso discreto a IATOS Privé desde Members Only (no cambia nada del flujo de Members). */
export function PriveEntryLink() {
  return (
    <Link
      to="/prive"
      className="inline-flex items-center gap-2 min-h-[44px] text-[11px] tracking-[0.22em] uppercase text-muted-foreground hover:text-primary transition mb-2"
    >
      <Gem className="w-3.5 h-3.5 text-primary/80" aria-hidden="true" /> IATOS Privé
    </Link>
  );
}
