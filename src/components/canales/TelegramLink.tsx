// Perfil → Ajustes: vincular Telegram con la cuenta IATOS (código de un solo uso que el bot canjea). Mínimo
// indispensable: estado, «Vincular Telegram» (código + abrir el bot), desvincular. Si Telegram no está activo (falta
// el token del bot), lo dice y no ofrece nada. Administradores: conectar el bot una vez (registra el webhook).
import { useEffect, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

type Estado = { activo: boolean; bot: string | null; vinculado: boolean; usuario: string | null };
type Codigo = { codigo: string; enlace: string; expira: string; bot: string };

async function canales(accion: string): Promise<Record<string, unknown> | null> {
  try {
    const { data, error } = await supabase.functions.invoke("canales", { body: { accion } });
    if (error) return null;
    return (data ?? null) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export function TelegramLink({ isAdmin = false }: { isAdmin?: boolean }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [codigo, setCodigo] = useState<Codigo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cargar = async () => {
    const r = await canales("estado");
    const t = (r?.telegram ?? null) as Estado | null;
    setEstado(t ?? { activo: false, bot: null, vinculado: false, usuario: null });
  };
  useEffect(() => { void cargar(); }, []);

  const pedirCodigo = async () => {
    setBusy(true); setMsg(null);
    const r = await canales("codigo");
    setBusy(false);
    if (r?.ok === true && typeof r.codigo === "string") setCodigo(r as unknown as Codigo);
    else setMsg(typeof r?.message === "string" ? r.message : "No se pudo crear el código. Inténtalo de nuevo.");
  };
  const desvincular = async () => {
    setBusy(true);
    await canales("desvincular");
    setBusy(false); setCodigo(null);
    await cargar();
  };
  const conectarBot = async () => {
    setBusy(true); setMsg(null);
    const r = await canales("configurar_telegram");
    setBusy(false);
    setMsg(r?.ok === true ? `Bot conectado${r.bot ? `: @${String(r.bot)}` : ""}. Ya pueden vincularse.` : typeof r?.error === "string" ? String(r.error) : "No se pudo conectar el bot.");
  };

  if (!estado) return null;
  return (
    <section className="glass-card rounded-xl p-4 space-y-3" aria-labelledby="telegram-title" data-testid="telegram-link">
      <div className="flex items-center gap-2">
        <Send className="w-4 h-4 text-primary" aria-hidden="true" />
        <h3 id="telegram-title" className="font-medium">Telegram</h3>
      </div>
      {!estado.activo ? (
        <p className="text-xs text-muted-foreground">Pronto podrás escribirle a IATOS por Telegram si algo sale mal en tu viaje. Todavía no está activo.</p>
      ) : estado.vinculado ? (
        <div className="space-y-2">
          <p className="text-sm">Vinculado{estado.usuario ? ` como @${estado.usuario}` : ""}. Si algo sale mal en tu viaje, escríbele a{estado.bot ? ` @${estado.bot}` : "l bot de IATOS"}: el operador te contesta ahí 24/7.</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void desvincular()}>Desvincular</Button>
        </div>
      ) : codigo ? (
        <div className="space-y-2" data-testid="telegram-code">
          <p className="text-xs text-muted-foreground">Abre el bot y toca «Iniciar», o envíale este código. Vence en 15 minutos y sirve una sola vez.</p>
          <p className="font-mono text-2xl tracking-[0.3em] text-primary" aria-label={`Código ${codigo.codigo.split("").join(" ")}`}>{codigo.codigo}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" asChild><a href={codigo.enlace} target="_blank" rel="noopener noreferrer">Abrir @{codigo.bot}</a></Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cargar().then(() => setCodigo(null))}>Ya lo envié</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Vincula tu cuenta para escribirle a IATOS por Telegram si tienes un problema en tu viaje (vuelo, traslado, hotel, equipaje, documentos). El operador de IATOS te contesta ahí, 24/7.</p>
          <Button size="sm" disabled={busy} onClick={() => void pedirCodigo()}>Vincular Telegram</Button>
        </div>
      )}
      {isAdmin && estado.activo && (
        <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground" disabled={busy} onClick={() => void conectarBot()}>
          Conectar el bot (administradores, una sola vez)
        </button>
      )}
      {msg && <p role="status" className="text-xs text-muted-foreground">{msg}</p>}
    </section>
  );
}

export default TelegramLink;
