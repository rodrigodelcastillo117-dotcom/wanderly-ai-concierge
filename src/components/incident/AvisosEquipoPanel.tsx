// Mesa de operaciones → «Avisos a mi celular» (solo administradores): a quién le llegan los avisos cuando el Operador IA
// pasa un caso a una persona, activar el celular, mandar una prueba a toda la guardia y entrar/salir de ella.
// La lógica vive en supabase/functions/_shared/avisosEquipo.ts (función ops-desk). Si la función no responde, no se
// muestra nada (no cambia la Mesa para nadie más).
import { useCallback, useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { subscribePush } from "@/lib/pushNotifications";

export type EstadoAvisos = {
  ok: true; configurada: boolean;
  guardia: Array<{ email: string; nombre: string | null; rol: "primario" | "respaldo"; celular: boolean; de_turno: boolean }>;
  yo: { email: string | null; en_guardia: boolean; celular: boolean };
  faltan: string[];
};
type Prueba = { ok: boolean; code?: string; resultados: Array<{ email: string; correo: boolean; error: string | null; celular: boolean }> };

async function opsDesk<T>(body: Record<string, unknown>): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke("ops-desk", { body });
  if (error) return null;
  return data as T;
}

export function AvisosEquipoPanel() {
  const [e, setE] = useState<EstadoAvisos | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [nota, setNota] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    const r = await opsDesk<EstadoAvisos>({ accion: "avisos_estado" }).catch(() => null);
    if (r?.ok && Array.isArray(r.guardia)) setE(r);
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);
  if (!e) return null;

  const hacer = async (clave: string, f: () => Promise<string>) => {
    setOcupado(clave); setNota(null);
    try { setNota(await f()); } catch { setNota("No se pudo. Intenta de nuevo."); } finally { setOcupado(null); }
  };
  const activar = () => hacer("celular", async () => {
    const r = await subscribePush();
    await cargar();
    return r.ok ? "Listo: este celular ya recibe los avisos urgentes." : `No se activó: ${r.error ?? "inténtalo desde el navegador del celular"}.`;
  });
  const prueba = () => hacer("prueba", async () => {
    const r = await opsDesk<Prueba>({ accion: "avisos_prueba" });
    if (!r) return "No se pudo mandar la prueba.";
    if (r.code === "SIN_GUARDIA") return "No hay nadie en la guardia.";
    return r.resultados.map((x) => `${x.email}: correo ${x.correo ? "enviado" : `no salió (${x.error})`}${x.celular ? " · celular ✓" : ""}`).join(" — ");
  });
  const guardia = (accion: "avisos_unirme" | "avisos_salir", rol?: "primario" | "respaldo") => hacer(accion, async () => {
    const r = await opsDesk<EstadoAvisos | { ok: false }>({ accion, rol });
    if (r && r.ok) { setE(r as EstadoAvisos); return accion === "avisos_salir" ? "Saliste de la guardia." : "Ya estás en la guardia."; }
    return "No se guardó.";
  });

  const alerta = e.faltan.length > 0;
  return (
    <details open={alerta} className={`rounded-2xl border p-4 ${alerta ? "border-amber-400/40 bg-amber-400/[0.04]" : "border-white/[0.06] bg-surface/60"}`} data-testid="avisos-equipo">
      <summary className="cursor-pointer flex flex-wrap items-center gap-2 text-sm">
        <BellRing className="w-4 h-4 text-primary" aria-hidden="true" />
        <span className="font-medium">Avisos a mi celular</span>
        <span className="text-xs text-muted-foreground">
          {e.yo.celular ? "este celular activado" : "celular sin activar"} · guardia: {e.guardia.length}
        </span>
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-xs text-muted-foreground">Cuando el Operador IA pasa un caso a una persona (salud, seguridad, algo que pagar o reservar, o si el viajero lo pide), avisa a la guardia por correo y al celular.</p>
        {e.faltan.map((f) => <p key={f} className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{f}</p>)}
        <ul className="space-y-1" aria-label="Guardia">
          {e.guardia.map((g) => (
            <li key={g.email} className="flex flex-wrap items-center gap-x-2 text-xs">
              <span className="text-foreground">{g.nombre || g.email}</span>
              {g.nombre && <span className="text-muted-foreground">{g.email}</span>}
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-muted-foreground">{g.rol}</span>
              <span className={g.celular ? "text-emerald-300" : "text-muted-foreground"}>{g.celular ? "celular ✓" : "solo correo"}</span>
            </li>
          ))}
          {!e.guardia.length && <li className="text-xs text-muted-foreground">Nadie en la guardia.</li>}
        </ul>
        <div className="flex flex-wrap gap-2">
          {!e.yo.celular && <Button size="sm" onClick={activar} disabled={!!ocupado}>{ocupado === "celular" ? "Activando…" : "Activar en este celular"}</Button>}
          <Button size="sm" variant="outline" onClick={prueba} disabled={!!ocupado || !e.guardia.length}>{ocupado === "prueba" ? "Mandando…" : "Mandar aviso de prueba"}</Button>
          {e.yo.en_guardia && e.configurada
            ? <Button size="sm" variant="ghost" onClick={() => guardia("avisos_salir")} disabled={!!ocupado}>Salir de la guardia</Button>
            : <>
                <Button size="sm" variant="outline" onClick={() => guardia("avisos_unirme", "primario")} disabled={!!ocupado}>Entrar a la guardia</Button>
                <Button size="sm" variant="ghost" onClick={() => guardia("avisos_unirme", "respaldo")} disabled={!!ocupado}>Entrar como respaldo</Button>
              </>}
        </div>
        {!e.configurada && <p className="text-[11px] text-muted-foreground">Al entrar el primero, la guardia deja de usar el correo del secreto FIXER_EMAIL y avisa a quienes estén aquí.</p>}
        {nota && <p role="status" className="text-xs text-primary break-words">{nota}</p>}
      </div>
    </details>
  );
}
