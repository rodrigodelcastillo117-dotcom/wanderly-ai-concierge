import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchFriendProfiles, type FriendProfile } from "@/lib/friendProfiles";
import { FriendAvatar } from "@/components/social/FriendAvatar";
import { PriveSeal } from "@/components/PriveSeal";
import { firstName, parseFriendSummaries, showAfinidad, summaryLine, type FriendSummary } from "@/lib/social";

/**
 * Compatibilidad con amigos (Perfil). Ya no muestra "0 %": la afinidad solo aparece cuando los dos
 * tienen Travel DNA y es alta; si no, una frase de lo que comparten (amigos_resumen).
 */
export const CompatibilityPanel = () => {
  const [amigos, setAmigos] = useState<FriendProfile[]>([]);
  const [resumen, setResumen] = useState<Map<string, FriendSummary> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Solo nombre y avatar de amistades aceptadas (RPC friend_profiles, F-10).
      const profs = await fetchFriendProfiles(supabase);
      setAmigos(profs);
      setLoading(false);
      if (!profs.length) return;
      const { data } = await supabase.rpc("amigos_resumen");
      setResumen(parseFriendSummaries(data));
    })();
  }, []);

  if (loading) {
    return <p className="text-xs text-muted-foreground">Buscando a tu tribu…</p>;
  }
  if (!amigos.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Aún no tienes amigos conectados. Comparte tu código en <Link to="/dashboard/social" className="text-primary">Social</Link> para comparar avatares de viaje.
      </p>
    );
  }

  return (
    <div className="space-y-2.5">
      {amigos.slice(0, 6).map((a) => {
        const r = resumen?.get(a.id);
        const nombre = a.full_name ?? a.username ?? "Amigo";
        return (
          <Link key={a.id} to={`/dashboard/social/amigo/${a.id}`}
            className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-primary/25 transition">
            <FriendAvatar name={nombre} url={a.avatar_url} className="w-10 h-10 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium flex items-center gap-1.5 min-w-0"><span className="truncate">{nombre}</span>{r?.is_prive && <PriveSeal size="sm" />}</p>
              <p className="text-[10px] text-muted-foreground truncate">
                {resumen ? summaryLine(r, firstName(a)) : "Cargando…"}
              </p>
            </div>
            {r && showAfinidad(r.afinidad) && (
              <div className="text-right shrink-0">
                <p className="text-lg font-display leading-none gold-text">{r.afinidad}%</p>
                <p className="text-[9px] tracking-wider uppercase text-muted-foreground mt-0.5">afinidad</p>
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
};
