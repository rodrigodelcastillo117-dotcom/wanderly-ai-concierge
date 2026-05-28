import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Home, Map, MapPin, Heart, Wallet, Crown, ChevronRight, User, Mail, Plus, Globe, Users, LogOut, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";
import { NotificationBell } from "@/components/NotificationBell";
import iatosLogo from "@/assets/iatos-logo.png";

const links = [
  { to: "/dashboard", icon: Home, label: "Inicio", end: true },
  { to: "/dashboard/viajes", icon: Map, label: "Mis viajes" },
  { to: "/dashboard/cercanos", icon: MapPin, label: "Cercanos" },
  { to: "/dashboard/favoritos", icon: Heart, label: "Favoritos" },
  { to: "/dashboard/social", icon: Users, label: "Social" },
  { to: "/dashboard/gastos", icon: Wallet, label: "Smart Spend" },
  { to: "/dashboard/concierge", icon: Crown, label: "Concierge Pro" },
];

// Mobile bottom nav — all 7 tabs + floating (+) above the bar
const mobileNav = [
  { to: "/dashboard", icon: Home, label: "Inicio", end: true },
  { to: "/dashboard/viajes", icon: Map, label: "Viajes" },
  { to: "/dashboard/cercanos", icon: MapPin, label: "Cerca" },
  { to: "/dashboard/favoritos", icon: Heart, label: "Favs" },
  { to: "/dashboard/social", icon: Users, label: "Social" },
  { to: "/dashboard/gastos", icon: Wallet, label: "Gastos" },
  { to: "/dashboard/concierge", icon: Crown, label: "Pro" },
];

export const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<{ full_name?: string | null; avatar_url?: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      setProfile(data);
    })();
  }, [user]);

  const firstName = profile?.full_name?.split(" ")[0] ?? "Viajero";
  const initial = firstName.charAt(0).toUpperCase();
  const avatarUrl = profile?.avatar_url ?? null;

  return (
    <div className="min-h-screen flex w-full bg-background relative overflow-x-hidden">
      {/* Ambient gold glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[480px] h-[480px] rounded-full bg-primary/[0.05] blur-[160px]" />
      </div>

      {/* Sidebar — black glassmorphism luxury */}
      <aside className="hidden md:flex flex-col w-[260px] shrink-0 border-r border-white/[0.04] bg-black/40 backdrop-blur-2xl">
        {/* Brand */}
        <Link to="/dashboard" className="flex items-center justify-center px-6 pt-9 pb-7 border-b border-white/[0.04]">
          <img src={iatosLogo} alt="IATOS" className="w-full max-w-[170px] h-auto object-contain drop-shadow-[0_0_24px_rgba(201,169,97,0.18)]" />
        </Link>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-3 px-4 py-3 rounded-2xl text-sm transition-all duration-300 ${
                  isActive
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.03]"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-2xl bg-gradient-gold shadow-[0_8px_28px_-8px_hsl(41_47%_59%/0.55),inset_0_1px_0_hsl(41_60%_75%/0.4)]"
                    />
                  )}
                  <l.icon className={`relative w-[18px] h-[18px] ${isActive ? "" : "opacity-80 group-hover:opacity-100"}`} />
                  <span className="relative tracking-wide">{l.label}</span>
                </>
              )}
            </NavLink>
          ))}

          {/* IATOS PRO card */}
          <div className="mt-7 mx-1 rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/[0.08] via-primary/[0.02] to-transparent p-5 text-center relative overflow-hidden">
            <div aria-hidden className="absolute inset-x-0 -top-16 h-32 bg-primary/20 blur-3xl" />
            <div className="relative">
              <p className="font-display text-primary tracking-[0.3em] text-[11px] mb-2">IATOS PRO</p>
              <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
                Identidad de viaje sin límites. Experiencias curadas para ti.
              </p>
              <button
                onClick={() => navigate("/dashboard/pro")}
                className="px-4 py-1.5 rounded-full border border-primary/40 text-primary text-[11px] hover:bg-primary/10 transition tracking-wider"
              >
                Conocer más
              </button>
              <div className="mt-4 flex justify-center">
                <Crown className="w-7 h-7 text-primary/70" />
              </div>
            </div>
          </div>
        </nav>

        {/* User */}
        <button
          onClick={() => navigate("/dashboard/perfil")}
          className="flex items-center gap-3 px-5 py-4 border-t border-white/[0.04] hover:bg-white/[0.03] transition"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-medium shadow-[0_6px_20px_-6px_hsl(41_47%_59%/0.5)]">
            {initial}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-medium truncate">{firstName}</p>
            <p className="text-[11px] text-muted-foreground truncate tracking-wide">Explorador frecuente</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={async () => { await signOut(); navigate("/"); }}
          className="flex items-center gap-2 px-5 py-3 text-[11px] text-muted-foreground hover:text-foreground border-t border-white/[0.04] transition-colors tracking-wide"
        >
          <LogOut className="w-3.5 h-3.5" />
          Cerrar sesión
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-x-hidden pb-28 md:pb-0 relative">
        {/* Mobile top bar — notifications + profile avatar */}
        <div className="md:hidden sticky top-0 z-40 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 bg-background/80 backdrop-blur-xl border-b border-white/[0.04]">
          <Link to="/dashboard" className="flex items-center">
            <img src={iatosLogo} alt="IATOS" className="h-7 w-auto object-contain" />
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button
              onClick={() => navigate("/dashboard/perfil")}
              aria-label="Ajustes"
              className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition"
            >
              <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
            </button>
            <button
              onClick={() => navigate("/dashboard/perfil")}
              aria-label="Mi perfil"
              className="ml-1 w-9 h-9 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-medium text-sm shadow-[0_6px_20px_-6px_hsl(41_47%_59%/0.5)] ring-1 ring-primary/30 active:scale-95 transition"
            >
              {initial}
            </button>
          </div>
        </div>
        <div className="hidden md:flex absolute top-4 right-4 z-40 items-center gap-1">
          <NotificationBell />
          <button
            onClick={() => navigate("/dashboard/perfil")}
            aria-label="Ajustes"
            className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition"
          >
            <Settings className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        </div>
        <BackButton />
        {children}
      </main>

      {/* Mobile bottom nav — labels under icons, centered floating gold (+) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="relative mx-2 rounded-[28px] border border-white/[0.06] bg-black/75 backdrop-blur-2xl shadow-[0_18px_60px_-12px_rgba(0,0,0,0.85)]">
          <div className="grid grid-cols-7 items-end px-1.5 pt-2 pb-2 gap-0.5">
            {mobileNav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`
                }
              >
                <n.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                <span className="text-[9px] tracking-wide leading-none">{n.label}</span>
              </NavLink>
            ))}
          </div>

          {/* Floating gold (+) — sits above the bar */}
          <button
            onClick={() => navigate("/dashboard/planear")}
            aria-label="Crear nuevo viaje"
            className="absolute left-1/2 -top-7 -translate-x-1/2 w-14 h-14 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground shadow-[0_14px_36px_-8px_hsl(41_47%_59%/0.65),inset_0_1px_0_hsl(41_60%_80%/0.5)] ring-4 ring-background active:scale-95 transition"
          >
            <span aria-hidden className="absolute inset-0 rounded-full bg-primary/30 blur-xl -z-10" />
            <Plus className="w-6 h-6" strokeWidth={2.25} />
          </button>
        </div>
      </nav>
    </div>
  );
};
