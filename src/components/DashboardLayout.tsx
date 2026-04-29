import { Link, NavLink, useNavigate } from "react-router-dom";
import { Home, Map, Sparkles, User, LogOut, Compass } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

const links = [
  { to: "/dashboard", icon: Home, label: "Inicio" },
  { to: "/dashboard/viajes", icon: Map, label: "Mis viajes" },
  { to: "/dashboard/descubre", icon: Sparkles, label: "Descubre" },
  { to: "/dashboard/perfil", icon: User, label: "Perfil de gustos" },
];

export const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen flex w-full bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-64 border-r border-border/40 bg-surface/30 backdrop-blur-sm">
        <Link to="/dashboard" className="flex items-center gap-2 p-6 border-b border-border/40">
          <div className="w-8 h-8 rounded-full bg-gradient-gold flex items-center justify-center">
            <Compass className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-display text-xl">Wanderly</span>
        </Link>
        <nav className="flex-1 p-3 space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.to === "/dashboard"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-surface"
                }`
              }
            >
              <l.icon className="w-4 h-4" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-7 py-5 text-sm text-muted-foreground hover:text-foreground border-t border-border/40 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
    </div>
  );
};
