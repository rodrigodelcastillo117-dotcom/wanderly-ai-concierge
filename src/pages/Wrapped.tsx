// /wrapped y /wrapped/:year — "Tu año en viajes" (IATOS Wrapped). Cada quien ve solo el suyo: todo se
// carga con la sesión de la persona (RLS) y la RPC wrapped_companions (src/lib/wrappedApi.ts).
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { FileUp, Loader2, Plus, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { localISODate } from "@/lib/localDate";
import { buildWrappedCards } from "@/lib/wrapped";
import { loadWrapped, type WrappedClient, type WrappedLoad } from "@/lib/wrappedApi";
import { defaultWrappedYear } from "@/lib/wrappedPromo";
import { WrappedStories } from "@/components/wrapped/WrappedStories";

const MIN_YEAR = 2000;

export function parseWrappedYear(param: string | undefined, today: string): number | null | "invalid" {
  if (param == null) return null;
  if (!/^\d{4}$/.test(param)) return "invalid";
  const y = Number(param);
  const now = Number(today.slice(0, 4));
  return y >= MIN_YEAR && y <= now ? y : "invalid";
}

const Shell = ({ children, onClose }: { children: React.ReactNode; onClose: () => void }) => (
  <div className="fixed inset-0 z-50 overflow-y-auto bg-black text-[#F5EBDD]" style={{ background: "radial-gradient(120% 70% at 50% 0%, #2b2416 0%, #0A0A0A 60%)" }}>
    <button type="button" onClick={onClose} aria-label="Cerrar"
      className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <X className="h-5 w-5" aria-hidden="true" />
    </button>
    <div className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16 text-center">{children}</div>
  </div>
);

export default function Wrapped() {
  const { year: param } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const today = localISODate();
  const parsed = parseWrappedYear(param, today);
  // Sin año: en enero, el que acaba de terminar; el resto del año, el actual (si no tiene viajes, abajo
  // se abre el más reciente que sí tenga).
  const year = typeof parsed === "number" ? parsed : defaultWrappedYear(today, [Number(today.slice(0, 4)) - 1, Number(today.slice(0, 4))]);
  const [state, setState] = useState<{ status: "loading" } | { status: "error" } | { status: "ready"; data: WrappedLoad }>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const close = () => navigate("/dashboard");

  useEffect(() => {
    if (!user || parsed === "invalid") return;
    let cancelled = false;
    setState({ status: "loading" });
    loadWrapped(supabase as unknown as WrappedClient, user.id, year, today)
      .then((data) => {
        if (cancelled) return;
        // /wrapped sin año y sin viajes este año: abre el año más reciente con viajes.
        if (parsed === null && !data.stats.trips.length && data.years.length && data.years[0] !== year) {
          navigate(`/wrapped/${data.years[0]}`, { replace: true });
          return;
        }
        setState({ status: "ready", data });
      })
      .catch(() => { if (!cancelled) setState({ status: "error" }); });
    return () => { cancelled = true; };
  }, [user?.id, year, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const cards = useMemo(() => (state.status === "ready" ? buildWrappedCards(state.data.stats) : []), [state]);

  useEffect(() => { document.title = `Tu ${year} en viajes · IATOS`; }, [year]);

  if (parsed === "invalid") return <Navigate to="/wrapped" replace />;

  if (state.status === "loading") {
    return (
      <Shell onClose={close}>
        <div role="status" aria-live="polite" className="space-y-4">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">IATOS Wrapped</p>
          <p className="font-display text-3xl italic">Preparando tu {year} en viajes…</p>
        </div>
      </Shell>
    );
  }

  if (state.status === "error") {
    return (
      <Shell onClose={close}>
        <p className="font-display text-3xl italic">No pudimos cargar tu año</p>
        <p className="mt-3 text-sm text-[#F5EBDD]/70">Revisa tu conexión e intenta de nuevo.</p>
        <button type="button" onClick={() => setReload((n) => n + 1)}
          className="mx-auto mt-6 inline-flex min-h-11 items-center rounded-full bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] px-6 text-sm font-bold text-[#0A0A0A]">
          Reintentar
        </button>
      </Shell>
    );
  }

  const { stats, years } = state.data;
  if (!cards.length) {
    const others = years.filter((y) => y !== year);
    return (
      <Shell onClose={close}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">IATOS Wrapped</p>
        <h1 className="mt-3 font-display text-4xl italic leading-tight">Tu {year} en viajes aún está por escribirse</h1>
        <p className="mt-4 text-sm leading-relaxed text-[#F5EBDD]/70">
          Todavía no hay viajes con fechas en {year}. Cuando viajes —o subas un viaje que ya hiciste— aquí verás tus países, kilómetros y mejores momentos.
        </p>
        <div className="mt-7 flex flex-col gap-2">
          <Link to="/dashboard/planear" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#C9A961] to-[#E8D5A0] px-6 text-sm font-bold text-[#0A0A0A]">
            <Plus className="h-4 w-4" aria-hidden="true" /> Planear un viaje
          </Link>
          <Link to="/dashboard/viajes/importar" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-primary/40 px-6 text-sm font-semibold text-primary">
            <FileUp className="h-4 w-4" aria-hidden="true" /> Subir un viaje que ya hice
          </Link>
        </div>
        {others.length > 0 && (
          <nav aria-label="Otros años" className="mt-8">
            <p className="text-xs text-[#F5EBDD]/60">Mira otro año</p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {others.map((y) => (
                <Link key={y} to={`/wrapped/${y}`} className="inline-flex min-h-10 items-center rounded-full border border-white/15 px-4 text-sm hover:border-primary/50">{y}</Link>
              ))}
            </div>
          </nav>
        )}
      </Shell>
    );
  }

  return <WrappedStories key={year} stats={stats} cards={cards} onClose={close} otherYears={years.filter((y) => y !== year)} />;
}
