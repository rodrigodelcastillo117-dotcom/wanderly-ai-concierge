import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { Home, Map, MapPin, Heart, Wallet, Crown, ChevronRight, Plus, Users, LogOut, Settings, Sparkles, Menu, BookmarkCheck, User, Gem, Vault } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { BackButton } from "@/components/BackButton";
import { useSubscription } from "@/hooks/useSubscription";
import { NotificationBell } from "@/components/NotificationBell";
import { AvatarCircle } from "@/components/avatar/AvatarCircle";
import { useMyAvatar } from "@/hooks/useMyAvatar";
import { usePriveSeal } from "@/hooks/usePriveSeal";
import { useMemberCard, tierText } from "@/lib/memberCard";
import { MemberCardButton } from "@/components/membercard/MemberCardButton";
// Logo a 320 px de ancho (se muestra a ~40 px de alto): 27 kB en vez de 191 kB.
import iatosLogo from "@/assets/iatos-logo-320.png";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";

const links = [
  { to: "/dashboard", icon: Home, label: "Inicio", end: true },
  { to: "/dashboard/viajes", icon: Map, label: "Mis viajes" },
  { to: "/dashboard/cercanos", icon: MapPin, label: "Cercanos" },
  { to: "/dashboard/favoritos", icon: Heart, label: "Favoritos" },
  { to: "/dashboard/social", icon: Users, label: "Social" },
  { to: "/dashboard/gastos", icon: Wallet, label: "Gastos" },
  // Documentos, membresías, tarjetas y seguros (antes "Beneficios").
  { to: "/dashboard/beneficios", icon: Vault, label: "Bóveda" },
  // "Concierge", no "Concierge Pro": la pestaña está abierta a todas las cuentas.
  { to: "/dashboard/concierge", icon: Crown, label: "Concierge" },
];

// Barra inferior móvil: máximo 5 elementos (antes eran 7 con etiquetas de 9px y un
// botón (+) flotante que tapaba "Favoritos"). Lo demás vive en "Más", así que todos
// los destinos anteriores siguen a un toque de distancia.
export const mobilePrimaryNav = [
  { to: "/dashboard", icon: Home, label: "Inicio", end: true },
  { to: "/dashboard/viajes", icon: Map, label: "Viajes" },
  // El centro es "Planear" (el antiguo +), ver render.
  { to: "/dashboard/concierge", icon: Crown, label: "Concierge" },
];

export const mobileMoreNav = [
  { to: "/dashboard/cercanos", icon: MapPin, label: "Cercanos" },
  { to: "/dashboard/favoritos", icon: Heart, label: "Favoritos" },
  { to: "/dashboard/social", icon: Users, label: "Social" },
  { to: "/dashboard/gastos", icon: Wallet, label: "Gastos y ahorro" },
  { to: "/dashboard/reservas", icon: BookmarkCheck, label: "Mis reservas" },
  { to: "/dashboard/beneficios", icon: Vault, label: "Bóveda (documentos y membresías)" },
  { to: "/dashboard/pro", icon: Sparkles, label: "Plan IATOS PRO" },
  // Entrada discreta a IATOS Privé: /prive muestra a cada cuenta lo que le corresponde (adelanto,
  // progreso, invitación o candado), así que no se oculta a nadie.
  { to: "/prive", icon: Gem, label: "IATOS Privé" },
  { to: "/dashboard/perfil", icon: User, label: "Mi perfil" },
];

export const DashboardLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, signOut } = useAuth();
  const { loading: subLoading, isPro, isTrialing, isComped, trialDaysLeft } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<{ full_name?: string | null } | null>(null);
  // Avatar: la misma fuente que el perfil y la tarjeta del Travel DNA (useMyAvatar).
  const { url: avatarUrl } = useMyAvatar();
  const prive = usePriveSeal();
  // Tu tarjeta de rango (la calcula el servidor: my_member_card).
  const { card, loading: cardLoading } = useMemberCard(user?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = mobileMoreNav.some((n) => location.pathname.startsWith(n.to));
  // En el chat del Concierge el área de escritura va pegada abajo: reservamos el alto
  // de la barra inferior y del área segura para que no quede oculta debajo.
  const isChatRoute = location.pathname.startsWith("/dashboard/concierge");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
      setProfile({ full_name: prof?.full_name ?? null });
    })();
  }, [user]);

  const firstName = profile?.full_name?.split(" ")[0] ?? "Viajero";

  return (
    <div className="min-h-screen flex w-full bg-background relative overflow-x-hidden">
      {/* Teclado y lectores de pantalla: saltar la navegación e ir directo al contenido. */}
      <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
        Saltar al contenido
      </a>
      {/* Ambient gold glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-primary/[0.06] blur-[140px]" />
        <div className="absolute top-1/3 -right-40 w-[480px] h-[480px] rounded-full bg-primary/[0.05] blur-[160px]" />
      </div>

      {/* Sidebar — black glassmorphism luxury (fixed) */}
      <aside className="hidden lg:flex flex-col w-[200px] border-r border-white/[0.04] bg-black/40 backdrop-blur-2xl fixed left-0 top-0 h-screen z-30">

        {/* Brand */}
        <Link to="/dashboard" className="flex items-center justify-center px-4 pt-6 pb-5 border-b border-white/[0.04]">
          <img src={iatosLogo} alt="IATOS" className="w-full max-w-[130px] h-auto object-contain drop-shadow-[0_0_24px_rgba(201,169,97,0.18)]" />
        </Link>

        {/* Acción principal también en escritorio (en móvil es el botón dorado del centro). */}
        <NavLink
          to="/dashboard/planear"
          className={({ isActive }) =>
            `mx-2 mt-3 mb-1 flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-gradient-gold text-primary-foreground text-[13px] font-medium tracking-wide shadow-[0_8px_24px_-8px_hsl(41_47%_59%/0.6)] hover:opacity-90 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background ${isActive ? "ring-1 ring-primary/60" : ""}`
          }
        >
          <Plus className="w-4 h-4" strokeWidth={2.25} aria-hidden="true" />
          Planear viaje
        </NavLink>

        {/* Nav */}
        <nav aria-label="Secciones" className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `group relative flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] transition-all duration-300 ${
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
                      className="absolute inset-0 rounded-xl bg-gradient-gold shadow-[0_6px_20px_-6px_hsl(41_47%_59%/0.55),inset_0_1px_0_hsl(41_60%_75%/0.4)]"
                    />
                  )}
                  <l.icon className={`relative w-[16px] h-[16px] ${isActive ? "" : "opacity-80 group-hover:opacity-100"}`} />
                  <span className="relative tracking-wide">{l.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Tu tarjeta de rango (mini): al tocarla se abre grande con el detalle. */}
        <div className="mx-3 mb-2.5" data-testid="sidebar-member-card">
          <MemberCardButton card={card} loading={cardLoading} testId="sidebar-card" />
        </div>

        {/* Estado de membresía */}
        <Link
          to="/dashboard/pro"
          className="mx-2 mb-2 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] px-3 py-2 text-[11px] hover:bg-primary/[0.1] transition"
        >
          <Sparkles className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate text-muted-foreground">
            {subLoading
              ? "Cargando…"
              : isComped
                ? "PRO de cortesía"
                : isTrialing
                  ? `Prueba · ${trialDaysLeft ?? 0} días`
                  : isPro
                    ? "IATOS PRO activo"
                    : "Activar IATOS PRO"}
          </span>
        </Link>
        <Link
          to="/prive"
          className="mx-2 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] tracking-[0.18em] uppercase text-muted-foreground hover:text-primary transition"
        >
          <Gem className="w-3.5 h-3.5 text-primary/80 shrink-0" aria-hidden="true" />
          <span className="truncate">IATOS Privé</span>
        </Link>

        {/* User */}
        <button
          onClick={() => navigate("/dashboard/perfil")}
          className="flex items-center gap-2 px-3 py-3 border-t border-white/[0.04] hover:bg-white/[0.03] transition"
        >
          <AvatarCircle url={avatarUrl} name={firstName} size="sm" prive={prive} glow={false} />
          <div className="flex-1 text-left min-w-0">
            <p className="text-[13px] font-medium truncate">{firstName}</p>
            {/* Con qué cuenta estás dentro (antes no se veía en ningún lado). */}
            <p className="text-[10px] text-muted-foreground truncate tracking-wide" title={user?.email ?? undefined} data-testid="sidebar-signed-in-email">{user?.email ?? "Explorador"}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        </button>
        <button
          onClick={async () => { await signOut(); navigate("/"); }}
          className="flex items-center gap-2 px-3 py-2.5 text-[11px] text-muted-foreground hover:text-foreground border-t border-white/[0.04] transition-colors tracking-wide"
        >
          <LogOut className="w-3.5 h-3.5" />
          Cerrar sesión
        </button>
      </aside>

      {/* Main */}
      <main
        id="contenido"
        tabIndex={-1}
        className={`focus:outline-none flex-1 min-w-0 overflow-x-hidden lg:pb-0 lg:pl-[200px] relative ${
          isChatRoute
            ? "flex flex-col h-screen supports-[height:100dvh]:h-[100dvh] overflow-y-hidden pb-[calc(76px+env(safe-area-inset-bottom))]"
            : "pb-32"
        }`}
      >
        {/* Mobile top bar — notifications + profile avatar. El body ya deja la franja de la hora
            (index.css); el margen negativo evita sumarla dos veces en reposo y la barra la cubre al fijarse. */}
        <div className="lg:hidden sticky top-0 z-40 -mt-[env(safe-area-inset-top)] flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 bg-background/80 backdrop-blur-xl border-b border-white/[0.04]">
          <Link to="/dashboard" className="flex items-center min-h-10" aria-label="IATOS, inicio">
            <img src={iatosLogo} alt="" className="h-7 w-auto object-contain" />
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
              className="ml-1 w-10 h-10 rounded-full flex items-center justify-center active:scale-95 transition"
            >
              <AvatarCircle url={avatarUrl} name={firstName} size="sm" prive={prive} glow={false} />
            </button>
          </div>
        </div>
        <div className="hidden lg:flex absolute top-4 right-4 z-40 items-center gap-1">
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
        {isChatRoute ? (
          // El hijo directo (la página) ocupa exactamente el alto restante; así el
          // compositor del chat queda visible sobre la barra inferior.
          <div data-testid="chat-viewport" className="flex-1 min-h-0 [&>*]:!h-full [&>*]:min-h-0">
            {children}
          </div>
        ) : (
          children
        )}
      </main>

      {/* Barra inferior móvil: 5 elementos, etiquetas de 12px, áreas táctiles ≥44px */}
      <nav aria-label="Navegación principal" className="lg:hidden fixed bottom-0 inset-x-0 z-50 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        <div className="relative mx-2 rounded-[28px] border border-white/[0.06] bg-black/80 backdrop-blur-2xl shadow-[0_18px_60px_-12px_rgba(0,0,0,0.85)]">
          <div className="grid grid-cols-5 items-stretch px-1 py-1.5 gap-0.5">
            {[mobilePrimaryNav[0], mobilePrimaryNav[1]].map((n) => (
              <BottomNavLink key={n.to} {...n} />
            ))}

            {/* Planear: botón dorado redondo DENTRO de su propia columna (no tapa otras pestañas) */}
            <NavLink
              to="/dashboard/planear"
              aria-label="Planear un viaje nuevo"
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 min-h-[52px] min-w-[44px] rounded-xl ${isActive ? "text-primary" : "text-foreground"}`
              }
            >
              <span className="w-11 h-11 -mt-1 rounded-full bg-gradient-gold flex items-center justify-center text-primary-foreground shadow-[0_10px_28px_-8px_hsl(41_47%_59%/0.65)] active:scale-95 transition">
                <Plus className="w-5 h-5" strokeWidth={2.25} aria-hidden="true" />
              </span>
              <span className="text-xs leading-none">Planear</span>
            </NavLink>

            <BottomNavLink {...mobilePrimaryNav[2]} />

            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`flex flex-col items-center justify-center gap-1 min-h-[52px] min-w-[44px] rounded-xl transition-colors ${
                moreActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Menu className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
              <span className="text-xs leading-none">Más</span>
            </button>
          </div>
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="lg:hidden rounded-t-3xl pb-[max(env(safe-area-inset-bottom),1rem)]">
          <SheetHeader className="text-left">
            <SheetTitle>Más opciones</SheetTitle>
            <SheetDescription>Todas las secciones de IATOS.</SheetDescription>
          </SheetHeader>
          {card || cardLoading ? (
            <div className="mt-4 flex items-center gap-4" data-testid="more-member-card">
              <div className="w-[148px] shrink-0">
                <MemberCardButton card={card} loading={cardLoading} testId="more-card" />
              </div>
              {card ? (
                <div className="min-w-0">
                  <p className="text-[10px] tracking-[0.24em] uppercase text-muted-foreground">Tu tarjeta</p>
                  <p className="font-display text-xl leading-tight">{tierText(card.tier).name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Tócala para ver el detalle</p>
                </div>
              ) : null}
            </div>
          ) : null}
          <ul className="mt-4 grid grid-cols-2 gap-2">
            {mobileMoreNav.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 min-h-[48px] px-3 rounded-xl border border-white/[0.06] text-sm ${
                      isActive ? "text-primary border-primary/40" : "text-foreground hover:bg-white/[0.04]"
                    }`
                  }
                >
                  <n.icon className="w-5 h-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                  {n.label}
                </NavLink>
              </li>
            ))}
            {user?.email && (
              <li className="col-span-2 px-1 pt-1 text-xs text-muted-foreground truncate" data-testid="more-signed-in-email">
                Sesión iniciada como <span className="text-foreground">{user.email}</span>
              </li>
            )}
            <li className="col-span-2">
              <button
                type="button"
                onClick={async () => { setMoreOpen(false); await signOut(); navigate("/"); }}
                className="w-full flex items-center gap-3 min-h-[48px] px-3 rounded-xl border border-white/[0.06] text-sm text-muted-foreground hover:text-foreground"
              >
                <LogOut className="w-5 h-5" aria-hidden="true" /> Cerrar sesión
              </button>
            </li>
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
};

const BottomNavLink = ({ to, icon: Icon, label, end }: { to: string; icon: any; label: string; end?: boolean }) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) =>
      `flex flex-col items-center justify-center gap-1 min-h-[52px] min-w-[44px] rounded-xl transition-colors ${
        isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
      }`
    }
  >
    <Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden="true" />
    <span className="text-xs leading-none">{label}</span>
  </NavLink>
);
