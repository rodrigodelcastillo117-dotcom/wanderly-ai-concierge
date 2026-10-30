// Comisiones del mes (solo administradores): lo ganado por proveedor y por producto, los clics a socios, las reservas
// gestionadas y las solicitudes de cambio/cancelación que el Operador pidió con el sí del viajero (una persona las
// aprueba aquí). Lee public.admin_commissions_summary() y decide con public.admin_managed_request_decide(); ambas
// rechazan a quien no está en public.admins. Montos tal cual los reporta cada programa, por moneda (no se suman monedas).
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Monto = { moneda: string; ganado: number; pendiente: number; pagado?: number; rechazado?: number; ventas: number };
type Fila = { moneda: string; ganado: number; pendiente: number; ventas: number; proveedor?: string; producto?: string };
type Solicitud = {
  id: string; kind: "cancelacion" | "cambio"; status: string; created_at: string; consent_text: string | null; ref_code: string; title: string;
  provider: string; environment: string; start_at: string | null; sell_amount: number | null; currency: string | null;
  policy_check: { gratis?: boolean; gratis_hasta?: string | null; motivo?: string } | null;
};
export type CommissionsSummary = {
  generated_at: string;
  mes: string;
  totales: Monto[];
  por_proveedor: Fila[];
  por_producto: Fila[];
  clics: { total: number; por_red: { red: string; clics: number }[]; por_producto: { producto: string; clics: number }[] };
  gestionadas: { total: number; confirmadas: number; canceladas: number; sandbox: number };
  solicitudes: Solicitud[];
  sincronizacion: { source: string; finished_at: string; ok: boolean; error: string | null }[];
  banderas: Record<string, boolean>;
};

const PRODUCTO: Record<string, string> = {
  vuelo: "Vuelos", hotel: "Hoteles", tour: "Tours", traslado: "Traslados", seguro: "Seguros", auto: "Autos", esim: "eSIM",
  transporte: "Trenes y ferris", restaurante: "Restaurantes", otro: "Otro",
};
const ESTADO: Record<string, string> = {
  pendiente_aprobacion: "Por aprobar", aprobada: "Aprobada (espera a la tarea)", ejecutando: "Ejecutando", revisar: "Revisar a mano", fallida: "Falló",
};
const BANDERA: Record<string, string> = {
  comisiones_sync_enabled: "Lectura de Travelpayouts", proveedores_reservas_enabled: "Reservar/cancelar en producción",
  reservas_gestionadas_cambios_enabled: "Ejecutar cambios aprobados", cargo_servicio_enabled: "Cargo por servicio",
};

const dinero = (v: number | null | undefined, moneda: string | null | undefined) => {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  try {
    return new Intl.NumberFormat("es-MX", { style: "currency", currency: moneda || "USD", minimumFractionDigits: 2 }).format(Number(v));
  } catch {
    return `${Number(v).toFixed(2)} ${moneda ?? ""}`.trim();
  }
};
const n = (v: number | null | undefined) => (v == null ? "—" : Number(v).toLocaleString("es-MX"));
const fecha = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "—");

function isSummary(v: unknown): v is CommissionsSummary {
  const m = v as CommissionsSummary | null;
  return !!m && typeof m === "object" && typeof m.mes === "string" && Array.isArray(m.totales) && Array.isArray(m.por_proveedor)
    && Array.isArray(m.por_producto) && !!m.clics && Array.isArray(m.solicitudes);
}

const box = "rounded-xl bg-surface/60 border border-white/[0.06] p-4";

export function AdminCommissionsCard() {
  const [data, setData] = useState<CommissionsSummary | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [deciding, setDeciding] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nueva, aún no está en los tipos generados
    const { data: d, error } = await supabase.rpc("admin_commissions_summary" as any, { _month: null });
    if (error || !isSummary(d)) {
      setState("error");
      return;
    }
    setData(d);
    setState("ok");
  }, []);

  useEffect(() => { load(); }, [load]);

  const decidir = async (id: string, aprobar: boolean) => {
    setDeciding(id);
    setAviso(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC nueva, aún no está en los tipos generados
    const { data: r, error } = await supabase.rpc("admin_managed_request_decide" as any, { _id: id, _approve: aprobar, _note: null });
    setDeciding(null);
    const ok = !error && (r as { ok?: boolean } | null)?.ok;
    setAviso(ok ? (aprobar ? "Aprobada: la tarea la hará con el proveedor (si la ejecución está prendida)." : "Rechazada.") : "No se pudo guardar la decisión.");
    await load();
  };

  const ganado = data?.totales ?? [];
  const apagadas = Object.entries(data?.banderas ?? {}).filter(([, v]) => !v).map(([k]) => BANDERA[k] ?? k);
  const sync = data?.sincronizacion?.find((s) => s.source === "travelpayouts") ?? null;

  return (
    <section className="space-y-3">
      <h2 className="text-primary text-[11px] tracking-[0.3em] uppercase">Comisiones · {data?.mes ?? "este mes"}</h2>
      {state === "loading" && (
        <div className={`${box} flex justify-center`}><Loader2 className="w-4 h-4 animate-spin text-primary" /></div>
      )}
      {state === "error" && (
        <p className={`${box} text-xs text-muted-foreground`}>No pudimos cargar las comisiones (¿falta aplicar la migración de comisiones?).</p>
      )}
      {state === "ok" && data && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={box}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Ganado este mes</p>
              {ganado.length === 0 ? <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">—</p> : ganado.map((t) => (
                <p key={t.moneda} className="font-display text-2xl md:text-3xl mt-1 text-foreground">{dinero(t.ganado, t.moneda)}</p>
              ))}
              <p className="text-xs text-muted-foreground mt-0.5">confirmado + pagado</p>
            </div>
            <div className={box}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pendiente</p>
              {ganado.length === 0 ? <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">—</p> : ganado.map((t) => (
                <p key={t.moneda} className="font-display text-2xl md:text-3xl mt-1 text-foreground">{dinero(t.pendiente, t.moneda)}</p>
              ))}
              <p className="text-xs text-muted-foreground mt-0.5">puede confirmarse o caerse</p>
            </div>
            <div className={box}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Clics a socios</p>
              <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{n(data.clics.total)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">en el mes</p>
            </div>
            <div className={box}>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Reservas gestionadas</p>
              <p className="font-display text-2xl md:text-3xl mt-1 text-foreground">{n(data.gestionadas.confirmadas)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                confirmadas · {n(data.gestionadas.canceladas)} canceladas{data.gestionadas.sandbox ? ` · ${n(data.gestionadas.sandbox)} de prueba` : ""}
              </p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <div className={box}>
              <p className="text-sm font-medium mb-2">Por proveedor</p>
              {data.por_proveedor.length === 0 ? <p className="text-xs text-muted-foreground">Sin ventas este mes.</p> : (
                <ul className="space-y-1.5 text-sm">
                  {data.por_proveedor.map((f) => (
                    <li key={`${f.proveedor}-${f.moneda}`} className="flex justify-between gap-2">
                      <span className="text-muted-foreground truncate">{f.proveedor}</span>
                      <span className="text-right">{dinero(f.ganado, f.moneda)}{f.pendiente ? <span className="text-xs text-muted-foreground"> · {dinero(f.pendiente, f.moneda)} pend.</span> : null}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={box}>
              <p className="text-sm font-medium mb-2">Por producto</p>
              {data.por_producto.length === 0 ? <p className="text-xs text-muted-foreground">Sin ventas este mes.</p> : (
                <ul className="space-y-1.5 text-sm">
                  {data.por_producto.map((f) => (
                    <li key={`${f.producto}-${f.moneda}`} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{PRODUCTO[f.producto ?? ""] ?? f.producto}</span>
                      <span>{dinero(f.ganado, f.moneda)} · {n(f.ventas)} ventas</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={box}>
              <p className="text-sm font-medium mb-2">Clics por red</p>
              {data.clics.por_red.length === 0 ? <p className="text-xs text-muted-foreground">Sin clics este mes.</p> : (
                <ul className="space-y-1.5 text-sm">
                  {data.clics.por_red.map((c) => (
                    <li key={c.red} className="flex justify-between"><span className="text-muted-foreground">{c.red}</span><span>{n(c.clics)}</span></li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className={box}>
            <p className="text-sm font-medium mb-2">Cambios y cancelaciones por aprobar</p>
            {aviso && <p className="text-xs text-primary mb-2" role="status">{aviso}</p>}
            {data.solicitudes.length === 0 ? <p className="text-xs text-muted-foreground">No hay solicitudes.</p> : (
              <ul className="space-y-3 text-sm">
                {data.solicitudes.map((s) => (
                  <li key={s.id} className="border-t border-white/[0.05] pt-3 first:border-0 first:pt-0">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{s.kind === "cancelacion" ? "Cancelar" : "Cambiar"} {s.ref_code} · {s.title}</span>
                      <span className="text-xs text-muted-foreground">{ESTADO[s.status] ?? s.status}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.provider}{s.environment === "sandbox" ? " (prueba)" : ""} · {dinero(s.sell_amount, s.currency)} · inicia {fecha(s.start_at)}
                      {s.policy_check?.gratis ? ` · gratis hasta ${fecha(s.policy_check.gratis_hasta)}` : s.kind === "cancelacion" ? " · puede tener cargo" : ""}
                    </p>
                    {s.consent_text && <p className="text-xs mt-1">Viajero: «{s.consent_text}»</p>}
                    {s.status === "pendiente_aprobacion" && (
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90" disabled={deciding === s.id} onClick={() => decidir(s.id, true)}>Aprobar</Button>
                        <Button size="sm" variant="outline" disabled={deciding === s.id} onClick={() => decidir(s.id, false)}>Rechazar</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Travelpayouts: {sync ? `${sync.ok ? "sincronizado" : `falló (${sync.error ?? "sin detalle"})`} el ${fecha(sync.finished_at)}` : "aún sin sincronizar"}.
            {apagadas.length ? ` Apagado: ${apagadas.join(", ")}.` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
