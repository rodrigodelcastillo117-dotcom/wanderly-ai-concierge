// Perfil → Ajustes: por dónde le avisa IATOS (canal preferido) y su horario de no molestar. Lo respetan el operador y
// la vigilancia de vuelos; lo URGENTE (salud, seguridad, vuelo cancelado o de hoy) llega por todos los canales aunque
// sea de noche. Mínimo indispensable: un selector, el horario y Guardar (función canales, la base valida todo).
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Prefs = { preferido: "app" | "telegram" | "whatsapp" | "email"; noMolestarInicio: string | null; noMolestarFin: string | null; tz: string | null };
type Estado = { telegram?: { vinculado?: boolean }; whatsapp?: { vinculado?: boolean }; preferencias?: Prefs };

async function canales(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("canales", { body });
    if (error) return null;
    return (data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

const zonaDelDispositivo = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
};

export function PreferenciasCanal() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [preferido, setPreferido] = useState<Prefs["preferido"]>("app");
  const [noMolestar, setNoMolestar] = useState(false);
  const [inicio, setInicio] = useState("22:00");
  const [fin, setFin] = useState("08:00");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void canales({ accion: "estado" }).then((r) => {
      const e = (r ?? {}) as Estado;
      setEstado(e);
      const p = e.preferencias;
      if (p) {
        setPreferido(p.preferido ?? "app");
        setNoMolestar(!!(p.noMolestarInicio && p.noMolestarFin));
        if (p.noMolestarInicio) setInicio(p.noMolestarInicio);
        if (p.noMolestarFin) setFin(p.noMolestarFin);
      }
    });
  }, []);

  const guardar = async () => {
    setBusy(true); setMsg(null);
    const r = await canales({
      accion: "preferencias", preferido, tz: zonaDelDispositivo(),
      noMolestarInicio: noMolestar ? inicio : null, noMolestarFin: noMolestar ? fin : null,
    });
    setBusy(false);
    setMsg(r?.ok === true ? "Guardado." : typeof r?.message === "string" ? r.message : "No se pudo guardar. Inténtalo de nuevo.");
  };

  if (!estado) return null;
  const opciones: Array<{ v: Prefs["preferido"]; t: string; ok: boolean }> = [
    { v: "app", t: "Notificaciones de la app", ok: true },
    { v: "telegram", t: "Telegram", ok: !!estado.telegram?.vinculado },
    { v: "whatsapp", t: "WhatsApp", ok: !!estado.whatsapp?.vinculado },
    { v: "email", t: "Correo", ok: true },
  ];
  return (
    <section className="glass-card rounded-xl p-4 space-y-3" aria-labelledby="avisos-title" data-testid="preferencias-canal">
      <div className="flex items-center gap-2">
        <BellRing className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 id="avisos-title" className="font-medium">Avisos de IATOS</h3>
      </div>
      <label className="block text-xs text-muted-foreground" htmlFor="canal-preferido">Prefiero que me avisen por</label>
      <select id="canal-preferido" value={preferido} onChange={(e) => setPreferido(e.target.value as Prefs["preferido"])}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
        {opciones.filter((o) => o.ok || o.v === preferido).map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={noMolestar} onChange={(e) => setNoMolestar(e.target.checked)} className="accent-[hsl(var(--primary))]" />
        No molestar
      </label>
      {noMolestar && (
        <div className="flex items-center gap-2 text-sm">
          <label className="sr-only" htmlFor="nm-inicio">Desde</label>
          <input id="nm-inicio" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1" />
          <span className="text-muted-foreground">a</span>
          <label className="sr-only" htmlFor="nm-fin">Hasta</label>
          <input id="nm-fin" type="time" value={fin} onChange={(e) => setFin(e.target.value)} className="rounded-md border border-input bg-background px-2 py-1" />
        </div>
      )}
      <p className="text-xs text-muted-foreground">Lo urgente (salud, seguridad, un vuelo cancelado o de hoy) te llega por todos tus canales aunque sea de noche. Lo demás espera a que termine tu horario.</p>
      <Button size="sm" disabled={busy} onClick={() => void guardar()}>Guardar</Button>
      {msg && <p role="status" className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}

export default PreferenciasCanal;
