// Perfil → Ajustes: consentimiento GENERAL para que IATOS contacte a tus proveedores en tu nombre (reconfirmar un
// traslado, un tour o una mesa 24–48 h antes). Apagado por omisión; se guarda el texto exacto que aceptaste
// (my_vigilancia_prefs_set). Mínimo indispensable: un interruptor con texto claro. Vigilancia proactiva
// (_shared/vigilancia/confirmaciones.ts).
import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";

export const TEXTO_CONSENTIMIENTO =
  "Autorizo a IATOS a escribir por correo, en mi nombre, a los proveedores de mis reservas (traslados, tours, restaurantes) para reconfirmarlas antes de mi llegada. Solo a correos verificados, en su horario local, sin pagar, cambiar ni cancelar nada. Puedo apagarlo cuando quiera.";

export function ContactoProveedoresPref() {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("my_vigilancia_prefs" as never);
        if (!vivo) return;
        setOn(error ? null : (data as { contactar_proveedores?: boolean } | null)?.contactar_proveedores === true);
      } catch {
        if (vivo) setOn(null);
      }
    })();
    return () => { vivo = false; };
  }, []);

  const cambiar = async (v: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const { data, error } = await supabase.rpc("my_vigilancia_prefs_set" as never, { _contactar: v, _texto: v ? TEXTO_CONSENTIMIENTO : null } as never);
      if (error || (data as { ok?: boolean } | null)?.ok !== true) throw new Error("no");
      setOn(v);
      setMsg(v ? "Listo: reconfirmaremos tus reservas con el proveedor antes de que llegues." : "Apagado: no escribiremos a tus proveedores.");
    } catch {
      setMsg("No se pudo guardar. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  if (on === null) return null;
  return (
    <section className="glass-card rounded-xl p-4 space-y-2" aria-labelledby="contacto-proveedores-title" data-testid="contacto-proveedores">
      <div className="flex items-start gap-3">
        <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <label id="contacto-proveedores-title" htmlFor="contacto-proveedores-switch" className="font-medium block">Que IATOS contacte a mis proveedores en mi nombre</label>
          <p className="text-xs text-muted-foreground mt-0.5">{TEXTO_CONSENTIMIENTO}</p>
        </div>
        <Switch id="contacto-proveedores-switch" checked={on} disabled={busy} onCheckedChange={(v) => void cambiar(v)} />
      </div>
      {msg && <p role="status" className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}

export default ContactoProveedoresPref;
