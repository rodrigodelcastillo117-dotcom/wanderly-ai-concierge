// Acceso a IATOS Wrapped desde el inicio y el perfil. En diciembre y enero es un aviso destacado
// ("Tu año en viajes 2026 ya está listo"); el resto del año, un acceso discreto. Ver lib/wrappedPromo.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { wrappedEntry, wrappedPromo, type WrappedPromo } from "@/lib/wrappedPromo";

export function WrappedPromoCard({ promo, className = "" }: { promo: WrappedPromo; className?: string }) {
  if (promo.featured) {
    return (
      <Link to={promo.href} data-testid="wrapped-promo"
        className={`group relative block overflow-hidden rounded-3xl border border-primary/40 p-5 md:p-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
        style={{ background: "radial-gradient(120% 140% at 0% 0%, #3b301c 0%, #15110b 55%, #0A0A0A 100%)" }}>
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl" aria-hidden="true" />
        <p className="relative flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> IATOS Wrapped
        </p>
        <h2 className="relative mt-2 font-display text-2xl italic leading-tight text-[#F5EBDD] md:text-4xl">{promo.title}</h2>
        <p className="relative mt-1.5 max-w-xl text-sm text-[#F5EBDD]/70">{promo.subtitle}</p>
        <span className="relative mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] px-5 text-sm font-bold text-[#0A0A0A]">
          Ver mi año <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </Link>
    );
  }
  return (
    <Link to={promo.href} data-testid="wrapped-promo"
      className={`group flex min-h-14 items-center gap-3 rounded-2xl border border-primary/25 bg-white/[0.02] px-4 py-3 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base leading-tight text-foreground">{promo.title}</span>
        {/* 2 líneas en vez de cortar: a 390 px se leía "viajes, lugares y mome…" (ronda 4, P2-6). */}
        <span className="block line-clamp-2 break-words text-xs text-muted-foreground" data-testid="wrapped-promo-subtitle">{promo.subtitle}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

/** Inicio: solo si el año del aviso tiene viajes que ya empezaron. */
export function DashboardWrappedPromo({ trips, today }: { trips: Array<{ fecha_salida?: string | null }>; today: string }) {
  const fromList = wrappedPromo(today, trips);
  const [extra, setExtra] = useState<WrappedPromo | null>(null);
  // La lista del inicio trae a lo más 50 viajes (los más antiguos): si está llena, se pregunta directo.
  const full = trips.length >= 50;
  useEffect(() => {
    if (fromList || !full) return;
    const entry = wrappedEntry(today);
    if (!entry) return;
    let cancelled = false;
    supabase.from("trips").select("id").gte("fecha_salida", `${entry.year}-01-01`).lte("fecha_salida", today < `${entry.year}-12-31` ? today : `${entry.year}-12-31`).limit(1)
      .then(({ data }) => { if (!cancelled && Array.isArray(data) && data.length) setExtra(entry); }, () => {});
    return () => { cancelled = true; };
  }, [fromList, full, today]);
  const promo = fromList ?? extra;
  return promo ? <WrappedPromoCard promo={promo} /> : null;
}

/** Perfil: siempre visible (la página explica si aún no hay viajes). */
export function ProfileWrappedLink({ today }: { today: string }) {
  const entry = wrappedEntry(today);
  return entry ? <WrappedPromoCard promo={{ ...entry, href: "/wrapped" }} /> : null;
}
