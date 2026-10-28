// ¿Mostrar el sello dorado de Privé en MI perfil? Solo si prive_status() dice que la membresía está
// activa y el acceso vigente (elegible). Cualquier error o campo faltante = sin sello.
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { priveApi, type PriveStatus } from "@/lib/priveApi";
import { afterCritical } from "@/lib/idleGate";

export function isActivePrive(s: Pick<PriveStatus, "membership_status" | "eligible"> | null | undefined): boolean {
  return !!s && s.membership_status === "active" && s.eligible === true;
}

const cache = new Map<string, Promise<boolean>>();

export function usePriveSeal(): boolean {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!uid) { setActive(false); return; }
    let cancelled = false;
    const read = () => {
      let p = cache.get(uid);
      if (!p) {
        p = priveApi.status().then((r) => (r.ok ? isActivePrive(r.data) : false)).catch(() => false);
        cache.set(uid, p);
      }
      p.then((v) => { if (!cancelled) setActive(v); });
    };
    // El sello es secundario: ya pedido → al instante; si no, después de lo principal de la pantalla.
    const cancel = cache.has(uid) ? (read(), () => {}) : afterCritical(read);
    return () => { cancelled = true; cancel(); };
  }, [uid]);
  return active;
}
