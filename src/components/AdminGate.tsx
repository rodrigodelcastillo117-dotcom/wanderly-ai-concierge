// Puerta de las pantallas de administración (/dashboard/admin, mesa de operaciones, panel editorial).
// Antes la pantalla llamaba directo a sus RPC y, para quien no es admin, el servidor respondía 403/400:
// la denegación era correcta, pero la consola quedaba con errores rojos y el mensaje no explicaba nada
// ni ofrecía salida (auditorías de cuenta #20 y técnica #8). Ahora primero se lee la propia fila de
// public.admins (RLS: cada quien solo ve la suya; responde 200 con o sin fila) y solo un admin monta la
// pantalla. El servidor sigue exigiendo public.admins en cada RPC: esto no da acceso a nada.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export type AdminCheck = "loading" | "admin" | "not_admin";

export function useIsAdmin(): AdminCheck {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [state, setState] = useState<{ uid: string | null; check: AdminCheck }>({ uid: null, check: "loading" });
  useEffect(() => {
    if (!uid) { setState({ uid: null, check: "not_admin" }); return; }
    let alive = true;
    setState({ uid, check: "loading" });
    Promise.resolve(supabase.from("admins").select("user_id").eq("user_id", uid).maybeSingle())
      .then(({ data, error }) => {
        if (!alive) return;
        // Si la lectura falla, se deja pasar a la pantalla: su propia denegación (la del servidor) decide.
        setState({ uid, check: error ? "admin" : data ? "admin" : "not_admin" });
      })
      .catch(() => { if (alive) setState({ uid, check: "admin" }); });
    return () => { alive = false; };
  }, [uid]);
  return state.uid === uid ? state.check : "loading";
}

export function AdminDenied() {
  return (
    <DashboardLayout>
      <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4" data-testid="admin-denied" role="status">
        <ShieldAlert className="w-8 h-8 text-primary mx-auto" aria-hidden="true" />
        <h1 className="font-display text-2xl">Acceso solo para administradores</h1>
        <p className="text-sm text-muted-foreground">
          Esta sección es para el equipo de IATOS. Tu cuenta no tiene permiso de administración, así que no se muestra
          ningún dato. Si crees que deberías tenerlo, escríbenos a{" "}
          <a href="mailto:hola@traveliatos.life" className="text-primary">hola@traveliatos.life</a>.
        </p>
        <Link to="/dashboard" className="inline-flex items-center rounded-xl bg-gradient-gold px-5 py-3 text-sm font-medium text-primary-foreground">
          Ir al inicio
        </Link>
      </div>
    </DashboardLayout>
  );
}

export function AdminGate({ children }: { children: ReactNode }) {
  const check = useIsAdmin();
  if (check === "loading") {
    return (
      <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-label="Comprobando permisos">
        <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }
  if (check === "not_admin") return <AdminDenied />;
  return <>{children}</>;
}
