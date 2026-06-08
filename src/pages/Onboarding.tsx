import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Crown, CreditCard, Plane, Building2, Globe2, Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { toast } from "sonner";
import welcomeImg from "@/assets/onboarding-welcome.jpg";
import tripImg from "@/assets/onboarding-trip.jpg";

const CARDS = [
  "Amex Platinum",
  "Amex Centurion (Black)",
  "Amex Gold",
  "Visa Infinite",
  "Mastercard Black / World Elite",
  "Chase Sapphire Reserve",
  "Citi Prestige",
  "Capital One Venture X",
];

const AIRLINES = [
  "Aeroméxico Rewards Platino/Titanio",
  "American AAdvantage Executive Platinum",
  "United MileagePlus 1K/Premier",
  "Delta SkyMiles Diamond/Platinum",
  "Air France Flying Blue Platinum",
  "Lufthansa Miles & More Senator/HON",
  "Star Alliance Gold",
  "Oneworld Emerald/Sapphire",
];

const HOTELS = [
  "Marriott Bonvoy Titanium/Ambassador",
  "Hilton Honors Diamond",
  "World of Hyatt Globalist",
  "IHG One Rewards Diamond",
  "Accor Platinum/Diamond",
];

function Dots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2 pt-6">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n === step ? "w-6 bg-primary" : "w-1.5 bg-border"
          }`}
        />
      ))}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border px-4 py-3 min-h-[52px] flex items-center justify-between gap-3 transition-all ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border bg-card/50 text-foreground/90 hover:border-primary/40"
      }`}
    >
      <span className="text-sm font-medium">{children}</span>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          active ? "border-primary bg-primary text-primary-foreground" : "border-border"
        }`}
      >
        {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

const fadeSlide = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -24 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
};

const Onboarding = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { status, isLoading, markStepComplete, markOnboardingComplete } = useOnboardingStatus();

  const [step, setStep] = useState(1);
  const [cards, setCards] = useState<string[]>([]);
  const [cardNone, setCardNone] = useState(false);
  const [cardOther, setCardOther] = useState("");
  const [airlines, setAirlines] = useState<string[]>([]);
  const [airlineOther, setAirlineOther] = useState("");
  const [hotels, setHotels] = useState<string[]>([]);
  const [hotelOther, setHotelOther] = useState("");
  const [dnaSeed, setDnaSeed] = useState("");
  const [dnaLoading, setDnaLoading] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);

  // Hydrate from existing record
  useEffect(() => {
    if (!status) return;
    if (status.completed_onboarding) {
      navigate("/dashboard", { replace: true });
      return;
    }
    setStep(status.current_step || 1);
    setCards(status.selected_cards || []);
    setAirlines(status.selected_loyalty_airlines || []);
    setHotels(status.selected_loyalty_hotels || []);
    setDnaSeed(status.travel_dna_seed || "");
  }, [status, navigate]);

  const toggle = (arr: string[], setArr: (v: string[]) => void, val: string) =>
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);

  const cardsFinal = useMemo(() => {
    if (cardNone) return [];
    const out = [...cards];
    if (cardOther.trim()) out.push(cardOther.trim());
    return out;
  }, [cards, cardNone, cardOther]);

  const airlinesFinal = useMemo(() => {
    const out = [...airlines];
    if (airlineOther.trim()) out.push(airlineOther.trim());
    return out;
  }, [airlines, airlineOther]);

  const hotelsFinal = useMemo(() => {
    const out = [...hotels];
    if (hotelOther.trim()) out.push(hotelOther.trim());
    return out;
  }, [hotels, hotelOther]);

  const goNext = () => setStep((s) => Math.min(s + 1, 5));

  const handleStep2 = async () => {
    await markStepComplete(2, { selected_cards: cardsFinal });
    goNext();
  };

  const handleStep3 = async () => {
    await markStepComplete(3, {
      selected_loyalty_airlines: airlinesFinal,
      selected_loyalty_hotels: hotelsFinal,
    });
    goNext();
  };

  const handleStep4 = async () => {
    if (!dnaSeed.trim()) {
      goNext();
      return;
    }
    setDnaLoading(true);
    try {
      await markStepComplete(4, { travel_dna_seed: dnaSeed.trim() });
      // Fire-and-forget: don't block navigation on AI
      supabase.functions.invoke("evolucionar-dna", { body: { seed: dnaSeed.trim() } }).catch(() => {});
      goNext();
    } catch (e) {
      toast.error("No pudimos guardar tu seed. Intenta de nuevo.");
    } finally {
      setDnaLoading(false);
    }
  };

  const finishAndGo = async (target: string) => {
    await markOnboardingComplete({
      selected_cards: cardsFinal,
      selected_loyalty_airlines: airlinesFinal,
      selected_loyalty_hotels: hotelsFinal,
      travel_dna_seed: dnaSeed.trim() || null,
    });
    navigate(target, { replace: true });
  };

  const skipCurrent = () => {
    setSkipOpen(false);
    if (step === 2) handleStep2();
    else if (step === 3) handleStep3();
    else if (step === 4) {
      markStepComplete(4, {});
      goNext();
    }
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      {step > 1 && step < 5 && (
        <div className="absolute top-0 right-0 z-20 p-4">
          <button
            onClick={() => setSkipOpen(true)}
            className="text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
          >
            Saltar
          </button>
        </div>
      )}

      <Dots step={step} />

      <div className="relative z-10 mx-auto w-full max-w-md px-5 pb-10 pt-4 min-h-[calc(100vh-3rem)] flex flex-col">
        <AnimatePresence mode="wait">
          {/* ============ PANTALLA 1 — BIENVENIDA ============ */}
          {step === 1 && (
            <motion.div key="s1" {...fadeSlide} className="relative flex-1 flex flex-col">
              <div className="absolute inset-0 -mx-5 -mt-4 overflow-hidden rounded-none">
                <img
                  src={welcomeImg}
                  alt="Vista premium IATOS"
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/40 to-black/95" />
              </div>
              <div className="relative z-10 mt-auto pt-24 pb-2 space-y-5">
                <p className="text-[11px] uppercase tracking-[0.3em] text-primary font-medium">
                  Tu concierge personal
                </p>
                <h1 className="font-display text-4xl leading-tight text-white">
                  Bienvenido a IATOS
                </h1>
                <p className="text-base text-white/80 leading-relaxed">
                  Iato es tu concierge IA premium para viajes. Vault de tarjetas,
                  Travel DNA evolutivo, sin OTAs intermediarios.
                </p>
                <Button
                  onClick={() => {
                    markStepComplete(1, {});
                    goNext();
                  }}
                  className="w-full h-14 text-base font-semibold bg-gradient-to-r from-primary to-primary-glow text-primary-foreground hover:opacity-95 shadow-[var(--shadow-gold)]"
                >
                  Conoce a Iato
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </div>
            </motion.div>
          )}

          {/* ============ PANTALLA 2 — VAULT ============ */}
          {step === 2 && (
            <motion.div key="s2" {...fadeSlide} className="flex-1 flex flex-col gap-5 mt-4">
              <div className="flex items-center justify-center gap-2 text-primary/80">
                <CreditCard className="h-5 w-5" />
                <CreditCard className="h-5 w-5 opacity-60" />
                <CreditCard className="h-5 w-5 opacity-30" />
              </div>
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.3em] text-primary">
                  Paso 2 de 5 · Vault
                </p>
                <h2 className="font-display text-3xl text-foreground leading-tight">
                  ¿Qué tarjetas premium tienes?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Iato usa tus beneficios para upgrades, créditos, lounges, FHR.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-3 space-y-2 max-h-[44vh] overflow-y-auto">
                {CARDS.map((c) => (
                  <Pill
                    key={c}
                    active={!cardNone && cards.includes(c)}
                    onClick={() => {
                      setCardNone(false);
                      toggle(cards, setCards, c);
                    }}
                  >
                    {c}
                  </Pill>
                ))}
                <Input
                  placeholder="Otra (escríbela)"
                  value={cardOther}
                  onChange={(e) => {
                    setCardOther(e.target.value);
                    if (e.target.value) setCardNone(false);
                  }}
                  className="h-12"
                />
                <Pill
                  active={cardNone}
                  onClick={() => {
                    const next = !cardNone;
                    setCardNone(next);
                    if (next) {
                      setCards([]);
                      setCardOther("");
                    }
                  }}
                >
                  Ninguna por ahora
                </Pill>
              </div>

              <p className="text-xs text-muted-foreground">
                Solo guardamos el TIPO de tarjeta, nunca números. Tu Vault es privado.
              </p>

              <Button
                onClick={handleStep2}
                className="w-full h-14 text-base font-semibold bg-gradient-to-r from-primary to-primary-glow text-primary-foreground hover:opacity-95 shadow-[var(--shadow-gold)] mt-auto"
              >
                Continuar
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </motion.div>
          )}

          {/* ============ PANTALLA 3 — LEALTAD ============ */}
          {step === 3 && (
            <motion.div key="s3" {...fadeSlide} className="flex-1 flex flex-col gap-5 mt-4">
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.3em] text-primary">
                  Paso 3 de 5 · Lealtad
                </p>
                <h2 className="font-display text-3xl text-foreground leading-tight">
                  ¿En qué programas eres miembro o elite?
                </h2>
                <p className="text-sm text-muted-foreground">
                  Iato prioriza acumulación de puntos y status reconocido.
                </p>
              </div>

              <div className="rounded-2xl border border-border bg-card/40 backdrop-blur p-3 space-y-3 max-h-[50vh] overflow-y-auto">
                <div className="flex items-center gap-2 text-primary text-xs uppercase tracking-[0.2em] pb-1">
                  <Plane className="h-4 w-4" /> Aerolíneas
                </div>
                {AIRLINES.map((a) => (
                  <Pill
                    key={a}
                    active={airlines.includes(a)}
                    onClick={() => toggle(airlines, setAirlines, a)}
                  >
                    {a}
                  </Pill>
                ))}
                <Input
                  placeholder="Otra aerolínea"
                  value={airlineOther}
                  onChange={(e) => setAirlineOther(e.target.value)}
                  className="h-12"
                />

                <div className="flex items-center gap-2 text-primary text-xs uppercase tracking-[0.2em] pt-3 pb-1">
                  <Building2 className="h-4 w-4" /> Hoteles
                </div>
                {HOTELS.map((h) => (
                  <Pill
                    key={h}
                    active={hotels.includes(h)}
                    onClick={() => toggle(hotels, setHotels, h)}
                  >
                    {h}
                  </Pill>
                ))}
                <Input
                  placeholder="Otra cadena"
                  value={hotelOther}
                  onChange={(e) => setHotelOther(e.target.value)}
                  className="h-12"
                />
              </div>

              <Button
                onClick={handleStep3}
                className="w-full h-14 text-base font-semibold bg-gradient-to-r from-primary to-primary-glow text-primary-foreground hover:opacity-95 shadow-[var(--shadow-gold)] mt-auto"
              >
                Continuar
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </motion.div>
          )}

          {/* ============ PANTALLA 4 — TRAVEL DNA SEED ============ */}
          {step === 4 && (
            <motion.div key="s4" {...fadeSlide} className="flex-1 flex flex-col gap-5 mt-4">
              <div className="flex justify-center">
                <motion.div
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                  className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center border border-primary/40"
                >
                  <Crown className="h-7 w-7 text-primary" />
                </motion.div>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-[0.3em] text-primary text-center">
                  Paso 4 de 5 · Travel DNA
                </p>
                <h2 className="font-display text-3xl text-foreground leading-tight text-center">
                  Cuéntame de tu último gran viaje
                </h2>
                <p className="text-sm text-muted-foreground text-center">
                  Esto entrena tu Travel DNA. Más natural = mejor.
                </p>
              </div>

              <div className="space-y-2">
                <Textarea
                  value={dnaSeed}
                  onChange={(e) => setDnaSeed(e.target.value.slice(0, 500))}
                  placeholder="Ej: Fui a Madrid con mi pareja en octubre 2024. Nos hospedamos en Hotel Único en Salamanca. Lo mejor fue cenar en Coque (2 Michelin) y un día de Toledo. Buscábamos romance y arte, sin prisas."
                  className="min-h-[140px] resize-none bg-card/50 border-border"
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>150–300 caracteres es ideal.</span>
                  <span>{dnaSeed.length} / 500</span>
                </div>
              </div>

              <Button
                onClick={handleStep4}
                disabled={dnaLoading}
                className="w-full h-14 text-base font-semibold bg-gradient-to-r from-primary to-primary-glow text-primary-foreground hover:opacity-95 shadow-[var(--shadow-gold)] mt-auto"
              >
                {dnaLoading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground animate-spin mr-2" />
                    Iato está aprendiendo de ti…
                  </>
                ) : (
                  <>
                    Crear mi Travel DNA
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>
            </motion.div>
          )}

          {/* ============ PANTALLA 5 — AHA MOMENT ============ */}
          {step === 5 && (
            <motion.div key="s5" {...fadeSlide} className="relative flex-1 flex flex-col">
              <div className="absolute inset-0 -mx-5 -mt-4 overflow-hidden">
                <img
                  src={tripImg}
                  alt="Primer viaje"
                  className="h-full w-full object-cover opacity-70"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/60 to-black/95" />
              </div>

              <div className="relative z-10 flex-1 flex flex-col justify-center gap-5 py-8">
                <div className="space-y-2 text-center">
                  <p className="text-[11px] uppercase tracking-[0.3em] text-primary">
                    Tu aha moment
                  </p>
                  <h2 className="font-display text-3xl text-white leading-tight">
                    Crea tu primer viaje
                  </h2>
                  <p className="text-sm text-white/75">
                    Iato lo arma con vuelos reales, hoteles con tus beneficios y experiencias
                    curadas. 90 segundos.
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() => finishAndGo("/dashboard/planear")}
                    className="w-full text-left rounded-2xl border-2 border-primary bg-card/60 backdrop-blur p-4 hover:bg-card/80 transition-all shadow-[var(--shadow-gold)]"
                  >
                    <div className="flex items-start gap-3">
                      <Globe2 className="h-6 w-6 text-primary shrink-0 mt-0.5" />
                      <div>
                        <div className="font-display text-lg text-foreground">
                          Un viaje que YO quiero hacer
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          Cuéntame destino + fechas y Iato lo arma
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => finishAndGo("/dashboard/descubre")}
                    className="w-full text-left rounded-2xl border border-border bg-card/50 backdrop-blur p-4 hover:border-primary/40 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-6 w-6 text-primary/80 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-display text-lg text-foreground">Sorpréndeme</div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          Iato propone 3 destinos basados en mi Travel DNA
                        </div>
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => finishAndGo("/dashboard")}
                    className="w-full text-left rounded-2xl border border-border/60 bg-card/30 backdrop-blur p-4 hover:border-primary/30 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <Clock className="h-6 w-6 text-muted-foreground shrink-0 mt-0.5" />
                      <div>
                        <div className="font-display text-lg text-foreground">
                          Explorar primero
                        </div>
                        <div className="text-sm text-muted-foreground mt-0.5">
                          Llévame al home, lo creo después
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Skip dialog */}
      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display">¿Seguro?</DialogTitle>
            <DialogDescription>
              {step === 2 &&
                "Sin Vault, Iato no aplica tus beneficios premium (upgrades, créditos, lounges)."}
              {step === 3 && "Sin tus programas, no priorizamos acumulación de puntos ni status."}
              {step === 4 &&
                "Tu Travel DNA se irá refinando con cada viaje. Sin esto, las primeras sugerencias serán más genéricas."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSkipOpen(false)}>
              Volver
            </Button>
            <Button onClick={skipCurrent}>Saltar de todos modos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Onboarding;
