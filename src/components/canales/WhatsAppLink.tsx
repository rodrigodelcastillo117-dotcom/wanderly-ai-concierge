// Perfil → Ajustes: vincular WhatsApp con la cuenta IATOS, igual que Telegram (código de un solo uso; el enlace abre
// WhatsApp con "IATOS <código>" ya escrito). Mínimo indispensable: estado, vincular, desvincular. Si WhatsApp no está
// activo (faltan sus secretos), lo dice y no ofrece nada. Administradores: datos para conectar el webhook en Meta.
import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Estado = { activo: boolean; numero: string | null; vinculado: boolean; telefono: string | null };
type Codigo = { codigo: string; enlace: string; expira: string; numero: string };
type Config = { ok: boolean; proveedor: string; faltan: string[]; webhook_url: string; verify_token: string | null; numero: string | null };

async function canales(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("canales", { body });
    if (error) return null;
    return (data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export function WhatsAppLink({ isAdmin = false }: { isAdmin?: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [codigo, setCodigo] = useState<Codigo | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    const r = await canales({ accion: "estado" });
    setEstado((r?.whatsapp ?? null) as Estado | null ?? { activo: false, numero: null, vinculado: false, telefono: null });
  };
  useEffect(() => { void cargar(); }, []);

  const pedirCodigo = async () => {
    setBusy(true); setMsg(null);
    const r = await canales({ accion: "codigo", canal: "whatsapp" });
    setBusy(false);
    if (r?.ok === true && typeof r.codigo === "string") setCodigo(r as unknown as Codigo);
    else setMsg(typeof r?.message === "string" ? r.message : "No se pudo crear el código. Inténtalo de nuevo.");
  };
  const desvincular = async () => {
    setBusy(true);
    await canales({ accion: "desvincular", canal: "whatsapp" });
    setBusy(false); setCodigo(null);
    await cargar();
  };
  const verConfig = async () => {
    setBusy(true);
    const r = await canales({ accion: "configurar_whatsapp" });
    setBusy(false);
    setConfig(r ? (r as unknown as Config) : null);
  };

  if (!estado) return null;
  return (
    <section className="glass-card rounded-xl p-4 space-y-3" aria-labelledby="whatsapp-title" data-testid="whatsapp-link">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 id="whatsapp-title" className="font-medium">WhatsApp</h3>
      </div>
      {!estado.activo ? (
        <p className="text-xs text-muted-foreground">Pronto podrás escribirle a IATOS por WhatsApp. Todavía no está activo.</p>
      ) : estado.vinculado ? (
        <div className="space-y-2">
          <p className="text-sm">Vinculado{estado.telefono ? ` (${estado.telefono})` : ""}. Escríbele a IATOS{estado.numero ? ` al ${estado.numero}` : ""}: Iato te ayuda con tu viaje y, si algo sale mal, el operador te contesta ahí 24/7.</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void desvincular()}>Desvincular</Button>
        </div>
      ) : codigo ? (
        <div className="space-y-2" data-testid="whatsapp-code">
          <p className="text-xs text-muted-foreground">Abre WhatsApp y envía el mensaje que ya viene escrito (o este código). Vence en 15 minutos y sirve una sola vez.</p>
          <p className="font-mono text-2xl tracking-[0.3em] text-primary" aria-label={`Código ${codigo.codigo.split("").join(" ")}`}>{codigo.codigo}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild><a href={codigo.enlace} target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a></Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cargar().then(() => setCodigo(null))}>Ya lo envié</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Vincula tu número para hablar con Iato por WhatsApp: planear, preguntar por tu viaje, gastos (también con la foto del ticket), clima y eventos. Si algo sale mal, el operador de IATOS te contesta ahí, 24/7.</p>
          <Button size="sm" disabled={busy} onClick={() => void pedirCodigo()}>Vincular WhatsApp</Button>
        </div>
      )}
      {isAdmin && (
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" disabled={busy} onClick={() => void verConfig()}>
          Datos para conectar WhatsApp en Meta (administradores)
        </button>
      )}
      {config && (
        <dl className="text-xs text-muted-foreground space-y-1 break-all" data-testid="whatsapp-config">
          <div><dt className="inline font-medium">Proveedor: </dt><dd className="inline">{config.proveedor === "meta" ? "Meta (Cloud API)" : "Twilio"}</dd></div>
          {config.faltan.length > 0 && <div><dt className="inline font-medium">Faltan los secretos: </dt><dd className="inline">{config.faltan.join(", ")}</dd></div>}
          <div><dt className="inline font-medium">URL del webhook: </dt><dd className="inline">{config.webhook_url}</dd></div>
          {config.verify_token && <div><dt className="inline font-medium">Token de verificación: </dt><dd className="inline font-mono">{config.verify_token}</dd></div>}
        </dl>
      )}
      {msg && <p role="status" className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}

export default WhatsAppLink;
