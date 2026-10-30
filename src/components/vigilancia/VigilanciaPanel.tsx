// Mesa de operaciones → Vigilancia (mínima): qué viajes y vuelos se vigilan, confirmaciones con proveedores y qué se
// detectó (admin_vigilancia_resumen, solo administradores). Plegada por omisión y solo aparece si la base responde:
// no cambia la Mesa para nadie más. Vigilancia proactiva (_shared/vigilancia/).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Radar } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Vuelo = { id: string; vuelo: string; fecha: string; ruta: string | null; viajero: string; destino: string | null; estado: string | null;
  ultimo_resultado: string | null; ultima_revision_at: string | null; proxima_revision_at: string | null; activo: boolean; incidente_id: string | null };
type Conf = { id: string; tipo: string; proveedor: string; servicio_at: string; estado: string; viajero: string; incidente_id: string | null };
type Ev = { id: number; ambito: string; tipo: string; resumen: string; at: string; viajero: string; incidente_id: string | null };
export type ResumenVigilancia = { enabled: boolean; cupo?: { tope: number; usados: number }; vuelos: Vuelo[]; confirmaciones: Conf[]; eventos: Ev[] };

const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const RESULTADO: Record<string, string> = { ok: "con dato", no_data: "sin dato de la fuente", date_mismatch: "fuente con otra fecha", provider_error: "fuente no respondió", quota: "sin búsquedas" };
const CONF: Record<string, string> = {
  pendiente: "por revisar", sin_consentimiento: "sin permiso del viajero", programada: "programada (horario del proveedor)", enviando: "enviando",
  enviada: "enviada, esperando respuesta", confirmada: "confirmada", problema: "problema", sin_respuesta: "sin respuesta", cancelada: "cancelada", vencida: "vencida",
};

export function VigilanciaPanel() {
  const [r, setR] = useState<ResumenVigilancia | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("admin_vigilancia_resumen" as never);
        const d = data as ResumenVigilancia | null;
        if (vivo && !error && d && Array.isArray(d.vuelos)) setR(d);
      } catch { /* sin sección */ }
    })();
    return () => { vivo = false; };
  }, []);
  if (!r) return null;
  const activos = r.vuelos.filter((v) => v.activo);
  return (
    <details className="rounded-2xl border border-white/[0.06] bg-surface/60 p-4" data-testid="vigilancia-panel">
      <summary className="cursor-pointer flex flex-wrap items-center gap-2 text-sm">
        <Radar className="w-4 h-4 text-primary" aria-hidden="true" />
        <span className="font-medium">Vigilancia</span>
        <span className="text-xs text-muted-foreground">
          {r.enabled ? `${activos.length} vuelo${activos.length === 1 ? "" : "s"} vigilado${activos.length === 1 ? "" : "s"}` : "apagada"}
          {r.cupo ? ` · SerpApi hoy ${r.cupo.usados}/${r.cupo.tope}` : ""} · {r.eventos.length} hallazgo{r.eventos.length === 1 ? "" : "s"} reciente{r.eventos.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="mt-3 space-y-4 text-sm">
        <section aria-label="Vuelos vigilados">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Vuelos</h3>
          {r.vuelos.length === 0 ? <p className="text-xs text-muted-foreground">Ningún vuelo en las próximas 48 h.</p> : (
            <ul className="space-y-1">
              {r.vuelos.map((v) => (
                <li key={v.id} className="flex flex-wrap gap-x-2 text-xs">
                  <span className="font-medium text-foreground">{v.vuelo}</span><span>{v.fecha}{v.ruta ? ` · ${v.ruta}` : ""}</span>
                  <span className="text-muted-foreground">{v.viajero}{v.destino ? ` · ${v.destino}` : ""}</span>
                  <span>{v.estado ?? (v.ultimo_resultado ? RESULTADO[v.ultimo_resultado] ?? v.ultimo_resultado : "aún sin revisar")}</span>
                  <span className="text-muted-foreground">{v.activo ? `próxima ${hora(v.proxima_revision_at)}` : "terminada"}</span>
                  {v.incidente_id ? <Link className="text-primary hover:underline" to={`/admin/operaciones?id=${v.incidente_id}`}>ver caso</Link> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
        {r.confirmaciones.length > 0 && (
          <section aria-label="Confirmaciones con proveedores">
            <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Confirmaciones con proveedores</h3>
            <ul className="space-y-1">
              {r.confirmaciones.map((c) => (
                <li key={c.id} className="flex flex-wrap gap-x-2 text-xs">
                  <span className="font-medium text-foreground">{c.proveedor}</span><span>{c.tipo} · {hora(c.servicio_at)}</span>
                  <span className="text-muted-foreground">{c.viajero}</span><span>{CONF[c.estado] ?? c.estado}</span>
                  {c.incidente_id ? <Link className="text-primary hover:underline" to={`/admin/operaciones?id=${c.incidente_id}`}>ver caso</Link> : null}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-label="Qué se detectó">
          <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Qué se detectó</h3>
          {r.eventos.length === 0 ? <p className="text-xs text-muted-foreground">Nada por ahora.</p> : (
            <ol className="space-y-1 border-l border-white/10 pl-3">
              {r.eventos.map((e) => (
                <li key={e.id} className="text-xs"><span className="text-muted-foreground">{hora(e.at)} · {e.viajero} · </span>{e.resumen}</li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </details>
  );
}

export default VigilanciaPanel;
