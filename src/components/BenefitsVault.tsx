import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trash2, CreditCard, Plane, Building2, Car, Sparkles, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

type CreditCard = { bank: string; card_tier: string; perks_enabled: string[] };
type AirlineAlliance = { alliance_name: string; airline: string; membership_number: string; tier_status: string; seat_preference: string };
type HotelLoyalty = { chain_name: string; member_id: string; status_tier: string; room_preferences: string };
type CarRental = { company_name: string; customer_id: string; preferred_car_type: string };

type Vault = {
  credit_cards: CreditCard[];
  airline_alliances: AirlineAlliance[];
  hotel_loyalty: HotelLoyalty[];
  car_rentals: CarRental[];
};

const empty: Vault = { credit_cards: [], airline_alliances: [], hotel_loyalty: [], car_rentals: [] };

const CARD_TIERS = ["Clásica", "Oro", "Platino", "Black", "Infinite"];
const PERKS = ["Acceso a salas VIP", "Seguro de auto", "Seguro de viaje", "Concierge", "Millas aceleradas"];
const ALLIANCES = ["Star Alliance", "Oneworld", "SkyTeam", "Sin alianza"];
const TIERS_AIR = ["Básico", "Silver", "Gold", "Platinum", "Diamond"];
const SEAT_PREFS = ["Ventana", "Pasillo", "Exit row", "Sin preferencia"];
const HOTEL_TIERS = ["Member", "Silver", "Gold", "Platinum", "Diamond", "Ambassador"];
const CAR_TYPES = ["Compacto", "Sedán", "SUV", "Eléctrico", "Lujo", "Convertible"];

const AI_HINT = "La IA de IATOS AI usará estos datos para aplicar descuentos automáticos, maletas gratis y accesos VIP en tus cotizaciones en tiempo real.";

const sectionMeta = {
  credit_cards: { icon: CreditCard, title: "Finanzas", subtitle: "Tarjetas de crédito y débito" },
  airline_alliances: { icon: Plane, title: "Aerolíneas", subtitle: "Alianzas y programas de viajero frecuente" },
  hotel_loyalty: { icon: Building2, title: "Hoteles", subtitle: "Programas de lealtad" },
  car_rentals: { icon: Car, title: "Renta de autos", subtitle: "Tus cuentas preferenciales" },
} as const;

const BenefitsVault = () => {
  const { user } = useAuth();
  const [vault, setVault] = useState<Vault>(empty);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<keyof Vault | null>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any).from("user_vault_benefits").select("*").eq("user_id", user.id).maybeSingle();
      if (data) {
        setVault({
          credit_cards: data.credit_cards ?? [],
          airline_alliances: data.airline_alliances ?? [],
          hotel_loyalty: data.hotel_loyalty ?? [],
          car_rentals: data.car_rentals ?? [],
        });
      }
      setLoading(false);
    })();
  }, [user]);

  const persist = async (next: Vault) => {
    if (!user) return;
    setVault(next);
    const { error } = await (supabase as any).from("user_vault_benefits").upsert(
      { user_id: user.id, ...next },
      { onConflict: "user_id" }
    );
    if (error) toast.error("No se pudo guardar");
  };

  const removeItem = (key: keyof Vault, index: number) => {
    const next = { ...vault, [key]: (vault[key] as any[]).filter((_, i) => i !== index) };
    persist(next);
    toast.success("Eliminado de tu bóveda");
  };

  const addItem = (key: keyof Vault, item: any) => {
    const next = { ...vault, [key]: [...(vault[key] as any[]), item] };
    persist(next);
    setAdding(null);
    toast.success("Añadido a tu bóveda");
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground py-8">Cargando bóveda…</div>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-3 p-4 rounded-xl border border-primary/30 bg-primary/5">
        <Sparkles className="w-5 h-5 text-primary mt-0.5 shrink-0" />
        <p className="text-sm text-muted-foreground">
          Tu <span className="text-primary font-medium">Bóveda de Beneficios</span> es privada y cifrada. Cada dato que agregues hace que la IA encuentre vuelos, hoteles y autos donde ya tienes ventajas.
        </p>
      </div>

      {(Object.keys(sectionMeta) as (keyof Vault)[]).map((key) => {
        const meta = sectionMeta[key];
        const Icon = meta.icon;
        const items = vault[key] as any[];
        return (
          <section key={key} className="glass-card rounded-2xl gold-border p-6">
            <header className="flex items-start justify-between gap-4 mb-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-xl bg-gradient-gold flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary-foreground" />
                </div>
                <div>
                  <h3 className="font-display text-xl">{meta.title}</h3>
                  <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setAdding(adding === key ? null : key)}
                className="text-primary hover:bg-primary/10">
                <Plus className="w-4 h-4 mr-1" /> Agregar
              </Button>
            </header>

            {items.length === 0 && adding !== key && (
              <p className="text-sm text-muted-foreground italic py-4">Aún no has agregado nada aquí.</p>
            )}

            <div className="space-y-2">
              {items.map((it, i) => (
                <ItemRow key={i} kind={key} item={it} onRemove={() => removeItem(key, i)} />
              ))}
            </div>

            <AnimatePresence>
              {adding === key && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden">
                  <div className="mt-4 pt-4 border-t border-border/40">
                    <AddForm kind={key} onCancel={() => setAdding(null)} onSubmit={(item) => addItem(key, item)} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="text-[11px] text-muted-foreground mt-4 flex items-start gap-1.5 leading-relaxed">
              <Sparkles className="w-3 h-3 text-primary mt-0.5 shrink-0" />
              {AI_HINT}
            </p>
          </section>
        );
      })}
    </div>
  );
};

// ---------------- Items rendering ----------------
const ItemRow = ({ kind, item, onRemove }: { kind: keyof Vault; item: any; onRemove: () => void }) => {
  let title = "";
  let detail = "";
  if (kind === "credit_cards") { title = `${item.bank} · ${item.card_tier}`; detail = (item.perks_enabled ?? []).join(" · "); }
  if (kind === "airline_alliances") { title = `${item.airline} (${item.alliance_name})`; detail = `${item.tier_status} · ${item.seat_preference} · ${item.membership_number}`; }
  if (kind === "hotel_loyalty") { title = `${item.chain_name} · ${item.status_tier}`; detail = `${item.member_id}${item.room_preferences ? " · " + item.room_preferences : ""}`; }
  if (kind === "car_rentals") { title = `${item.company_name} · ${item.preferred_car_type}`; detail = item.customer_id; }
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-surface border border-border/60">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{title}</p>
        {detail && <p className="text-xs text-muted-foreground truncate">{detail}</p>}
      </div>
      <button onClick={onRemove} className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition" aria-label="Eliminar">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};

// ---------------- Add form ----------------
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs text-muted-foreground tracking-wider uppercase mb-1.5 block">{label}</span>
    {children}
  </label>
);

const Select = ({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className="w-full h-11 rounded-md bg-input border border-border px-3 text-sm focus:outline-none focus:border-primary">
    <option value="">{placeholder ?? "Selecciona"}</option>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

const AddForm = ({ kind, onSubmit, onCancel }: { kind: keyof Vault; onSubmit: (v: any) => void; onCancel: () => void }) => {
  const [data, setData] = useState<any>({});
  const set = (k: string, v: any) => setData((d: any) => ({ ...d, [k]: v }));

  const togglePerk = (perk: string) => {
    const cur: string[] = data.perks_enabled ?? [];
    set("perks_enabled", cur.includes(perk) ? cur.filter((p) => p !== perk) : [...cur, perk]);
  };

  const submit = () => {
    if (kind === "credit_cards" && (!data.bank || !data.card_tier)) return toast.error("Completa banco y tipo");
    if (kind === "airline_alliances" && (!data.airline || !data.membership_number)) return toast.error("Completa aerolínea y número");
    if (kind === "hotel_loyalty" && (!data.chain_name || !data.member_id)) return toast.error("Completa cadena y número");
    if (kind === "car_rentals" && (!data.company_name || !data.customer_id)) return toast.error("Completa empresa y número");
    const base: any = data;
    if (kind === "credit_cards") base.perks_enabled = data.perks_enabled ?? [];
    onSubmit(base);
    setData({});
  };

  return (
    <div className="space-y-4">
      {kind === "credit_cards" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Banco"><Input value={data.bank ?? ""} onChange={(e) => set("bank", e.target.value)} placeholder="BBVA, Amex, Santander..." className="bg-input border-border" /></Field>
          <Field label="Tipo de tarjeta"><Select value={data.card_tier ?? ""} onChange={(v) => set("card_tier", v)} options={CARD_TIERS} /></Field>
          <div className="md:col-span-2">
            <Field label="Beneficios activos">
              <div className="flex flex-wrap gap-2">
                {PERKS.map((p) => {
                  const sel = (data.perks_enabled ?? []).includes(p);
                  return (
                    <button key={p} type="button" onClick={() => togglePerk(p)}
                      className={`px-3 py-1.5 rounded-full text-xs border transition ${sel ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:border-primary/40"}`}>
                      {p}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      )}

      {kind === "airline_alliances" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Alianza"><Select value={data.alliance_name ?? ""} onChange={(v) => set("alliance_name", v)} options={ALLIANCES} /></Field>
          <Field label="Aerolínea"><Input value={data.airline ?? ""} onChange={(e) => set("airline", e.target.value)} placeholder="Aeroméxico, United..." className="bg-input border-border" /></Field>
          <Field label="Número de socio"><Input value={data.membership_number ?? ""} onChange={(e) => set("membership_number", e.target.value)} className="bg-input border-border" /></Field>
          <Field label="Estatus"><Select value={data.tier_status ?? ""} onChange={(v) => set("tier_status", v)} options={TIERS_AIR} /></Field>
          <Field label="Asiento preferido"><Select value={data.seat_preference ?? ""} onChange={(v) => set("seat_preference", v)} options={SEAT_PREFS} /></Field>
        </div>
      )}

      {kind === "hotel_loyalty" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Cadena"><Input value={data.chain_name ?? ""} onChange={(e) => set("chain_name", e.target.value)} placeholder="Marriott Bonvoy, Hilton Honors..." className="bg-input border-border" /></Field>
          <Field label="Número de socio"><Input value={data.member_id ?? ""} onChange={(e) => set("member_id", e.target.value)} className="bg-input border-border" /></Field>
          <Field label="Estatus"><Select value={data.status_tier ?? ""} onChange={(v) => set("status_tier", v)} options={HOTEL_TIERS} /></Field>
          <Field label="Preferencia de habitación"><Input value={data.room_preferences ?? ""} onChange={(e) => set("room_preferences", e.target.value)} placeholder="Cama king, vista, piso alto..." className="bg-input border-border" /></Field>
        </div>
      )}

      {kind === "car_rentals" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Empresa"><Input value={data.company_name ?? ""} onChange={(e) => set("company_name", e.target.value)} placeholder="Hertz, Avis, Sixt..." className="bg-input border-border" /></Field>
          <Field label="Número de cliente"><Input value={data.customer_id ?? ""} onChange={(e) => set("customer_id", e.target.value)} className="bg-input border-border" /></Field>
          <Field label="Tipo de auto preferido"><Select value={data.preferred_car_type ?? ""} onChange={(v) => set("preferred_car_type", v)} options={CAR_TYPES} /></Field>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={onCancel}><X className="w-4 h-4 mr-1" /> Cancelar</Button>
        <Button size="sm" onClick={submit} className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow">
          Guardar
        </Button>
      </div>
    </div>
  );
};

export default BenefitsVault;
