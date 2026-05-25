import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { Home, Map, MapPin, Heart, Wallet, Crown, ChevronRight, User, Mail, Plus, Globe, Users, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";

const links = [
  { to: "/dashboard", icon: Home, label: "Inicio", end: true },
  { to: "/dashboard/viajes", icon: Map, label: "Mis viajes" },
  { to: "/dashboard/cercanos", icon: MapPin, label: "Cercanos" },
  { to: "/dashboard/favoritos", icon: Heart, label: "Favoritos" },
  { to: "/dashboard/gastos", icon: Wallet, label: "Gastos" },
];

const mobileNav = [
  { to: "/dashboard", icon: Home, label: "Inicio", end: true },
  { to: "/dashboard/perfil", icon: User, label: "Perfil" },
  { to: "/dashboard/concierge", icon: Mail, label: "Concierge Pro" },
  { to: "/dashboard/planear", icon: Plus, label: "Nuevo", primary: true },
  { to: "/dashboard/descubre", icon: Globe, label: "Descubre" },
  { to: "/dashboard/cercanos", icon: Users, label: "Cercanos" },
];

export const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<{ full_name?: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      setProfile(data);
    })();
  }, [user]);

  const firstName = profile?.full_name?.split(" ")[0] ?? "Viajero";
  const initial = firstName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border/40 bg-surface/30 backdrop-blur-sm">
        {/* Brand */}
        <Link to="/dashboard" className="flex flex-col items-center gap-2 px-6 pt-8 pb-6 border-b border-border/40">
          <div className="relative w-14 h-14 rounded-full border border-primary/40 flex items-center justify-center">
            <Crown className="w-6 h-6 text-primary" />
          </div>
          <span className="font-display text-2xl tracking-[0.35em] text-foreground">IATOS</span>
        </Link>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                }`
              }
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </NavLink>
          ))}

          {/* IATOS PRO card */}
          <div className="mt-6 mx-1 rounded-2xl border border-primary/25 bg-gradient-to-b from-primary/5 to-transparent p-5 text-center">
            <p className="font-display text-primary tracking-[0.25em] text-sm mb-2">IATOS PRO</p>
            <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
              Desbloquea experiencias exclusivas y beneficios únicos.
            </p>
            <button
              onClick={() => navigate("/dashboard/pro")}
              className="px-4 py-1.5 rounded-full border border-primary/40 text-primary text-xs hover:bg-primary/10 transition"
            >
              Conocer más
            </button>
            <div className="mt-4 flex justify-center">
              <Crown className="w-8 h-8 text-primary/70" />
            </div>
          </div>
        </nav>

        {/* User */}
        <button
          onClick={() => navigate("/dashboard/perfil")}
          className="flex items-center gap-3 px-5 py-4 border-t border-border/40 hover:bg-surface/60 transition"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground font-medium">
            {initial}
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="text-sm font-medium truncate">{firstName}</p>
            <p className="text-xs text-muted-foreground truncate">Explorador frecuente</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </button>
        <button
          onClick={async () => { await signOut(); navigate("/"); }}
          className="flex items-center gap-2 px-5 py-3 text-xs text-muted-foreground hover:text-foreground border-t border-border/40 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Cerrar sesión
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-x-hidden pb-24 md:pb-0 relative">
        <BackButton />
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-border/40 bg-background/95 backdrop-blur-lg">
        <div className="grid grid-cols-6 items-end px-2 py-2">
          {mobileNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2 text-[10px] ${
                  n.primary
                    ? "text-primary-foreground"
                    : isActive
                      ? "text-primary"
                      : "text-muted-foreground"
                }`
              }
            >
              {n.primary ? (
                <span className="w-12 h-12 -mt-6 rounded-full bg-gradient-gold flex items-center justify-center gold-glow">
                  <n.icon className="w-5 h-5 text-primary-foreground" />
                </span>
              ) : (
                <n.icon className="w-5 h-5" />
              )}
              <span className="truncate">{n.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
};
