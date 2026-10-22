// Qué datos llegan precargados al sitio del proveedor y qué completa el usuario ahí (cierre 2, enlaces).
// Va debajo de cada botón externo: nunca se promete un dato que el sitio no recibe por enlace.
import { Info } from "lucide-react";
import { PREFILL, prefillLine } from "@/lib/affiliateLinks";

export function PrefillNote({ provider, className = "" }: { provider: string; className?: string }) {
  const line = prefillLine(provider);
  if (!line) return null;
  const p = PREFILL[provider];
  return (
    <p className={`flex items-start gap-1 text-[11px] leading-snug text-muted-foreground ${className}`} data-testid={`prefill-${provider}`}>
      <Info className="w-3 h-3 mt-[1px] shrink-0" aria-hidden="true" />
      <span>{line}{p?.estado === "bloqueado" ? "" : ""}</span>
    </p>
  );
}
