// Sin framer-motion: la landing es la primera página y debe cargar ligera (E-23).
import { Reveal } from "@/components/Reveal";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, Sparkles, Compass, Wallet, Check, Receipt, BadgeCheck, FolderHeart } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImg from "@/assets/hero-santorini.jpg";
import heroImg960 from "@/assets/hero-santorini-960.jpg";
import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
// Logo a 320 px de ancho (se muestra a ~40 px de alto): 27 kB en vez de 191 kB.
import iatosLogo from "@/assets/iatos-logo-320.png";
import { FREE_FEATURES, PRICE_LINE, PRO_FEATURES, PRO_PRICE_MXN } from "@/lib/planCopy";

// Qué gana el usuario, en concreto (antes el hero decía "Cualquier viaje. Experiencia premium." y no
// quedaba claro qué hace la app). Solo funciones que existen hoy y sin prometer precios.
const LANDING_BENEFITS = [
  { icon: Receipt, title: "Un total claro en pesos", text: "Vuelos, hospedaje, comida y experiencias en un solo número, por persona y por grupo." },
  { icon: BadgeCheck, title: "Sabes qué precio es real", text: "Cada precio dice si se consultó en vivo con el proveedor o si es una estimación." },
  { icon: FolderHeart, title: "Todo tu viaje en un lugar", text: "Itinerario, documentos, lista de equipaje y gastos compartidos, guardados en Mis viajes." },
] as const;
import { useTrialCopy } from "@/hooks/usePlanConfig";

const Landing = () => {
  const navigate = useNavigate();
  const { copy: trial } = useTrialCopy();
  const { user } = useAuth();

  // La app del celular abre en "/": con la sesión abierta se iba a la bienvenida con "Iniciar
  // sesión" y parecía que se había cerrado. Con sesión, directo a tu Inicio.
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* NAV. En iPhone la página ocupa también la franja de la hora y la Isla Dinámica
          (viewport-fit=cover + barra translúcida): sin este margen, "Iniciar sesión" quedaba debajo
          del wifi y la batería, e iOS se quedaba con los toques de esa franja. */}
      <nav
        data-testid="landing-nav"
        className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-background/60 border-b border-border/40 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      >
        <div className="container mx-auto flex items-center justify-between gap-2 py-4 px-4">
          {/* El logo puede encogerse (min-w-0): a 320 px los dos botones no cabían y "Empezar gratis"
              quedaba cortado fuera de la pantalla. */}
          <img src={iatosLogo} alt="IATOS" className="h-8 md:h-10 w-auto min-w-0 shrink object-contain object-left" />
          <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
            <Button variant="ghost" onClick={() => navigate("/auth")} className="px-2 md:px-4 text-xs md:text-sm">
              Iniciar sesión
            </Button>
            <Button onClick={() => navigate("/auth?mode=signup")} className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow px-3 md:px-5 text-xs md:text-sm whitespace-nowrap">
              Empezar gratis
            </Button>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen flex items-center overflow-hidden">
        {/* Imagen principal (LCP): en móvil baja la versión de 960 px y se pide con prioridad alta. */}
        <img
          src={heroImg}
          srcSet={`${heroImg960} 960w, ${heroImg} 1920w`}
          sizes="100vw"
          alt="Santorini al atardecer dorado"
          width={1920}
          height={1080}
          decoding="async"
          {...{ fetchpriority: "high" }}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-overlay" />
        <div className="absolute inset-0 bg-gradient-radial-gold opacity-60" />

        <div className="container relative z-10 mx-auto pt-32 pb-28">
          <div className="max-w-3xl animate-rise">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-card text-sm mb-6">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-muted-foreground">Tu concierge de viajes con IA</span>
            </div>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl leading-[0.95] mb-6">
              Planea tu viaje.
              <br />
              <span className="gold-text italic">Conoce el costo antes de decidir.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mb-10 leading-relaxed">
              Dinos a dónde y cuándo: IATOS consulta vuelos y hoteles, arma tu itinerario y te da el total en pesos, marcando qué precio se consultó en vivo y cuál es estimado. Empieza gratis; PRO cuesta {PRICE_LINE}.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                onClick={() => navigate("/auth?mode=signup")}
                className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow text-base h-14 px-8"
              >
                {trial.cta}
                <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" })}
                className="border-border/60 bg-background/40 backdrop-blur-md hover:bg-surface text-base h-14 px-8"
              >
                Ver cómo funciona
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-6 tracking-wide uppercase">{trial.line}</p>
          </div>
        </div>
      </section>

      {/* QUÉ GANAS — se entiende en 10 segundos, justo debajo del primer botón. */}
      <section aria-labelledby="que-ganas" className="container mx-auto -mt-16 md:-mt-24 relative z-10 pb-8">
        <h2 id="que-ganas" className="sr-only">Qué ganas con IATOS</h2>
        <ul className="grid gap-3 md:grid-cols-3 md:gap-5">
          {LANDING_BENEFITS.map((b) => (
            <li key={b.title} className="glass-card rounded-2xl p-5 md:p-6 flex gap-4">
              <span className="w-10 h-10 shrink-0 rounded-full bg-primary/15 flex items-center justify-center" aria-hidden>
                <b.icon className="w-5 h-5 text-primary" />
              </span>
              <span className="min-w-0">
                <span className="block font-display text-xl leading-tight">{b.title}</span>
                <span className="block text-sm text-muted-foreground mt-1 leading-relaxed">{b.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* CÓMO FUNCIONA */}
      <section id="como-funciona" className="py-32 container mx-auto">
        <Reveal className="max-w-2xl mb-20">
          <p className="text-primary text-sm tracking-[0.2em] uppercase mb-4">Cómo funciona</p>
          <h2 className="font-display text-4xl md:text-6xl leading-tight">
            Tres pasos. Una vida<br />de viajes mejores.
          </h2>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              n: "01",
              icon: Sparkles,
              title: "Cuéntanos quién eres",
              desc: "Unas preguntas opcionales al empezar y, cuando quieras, una encuesta visual de tu estilo, paladar y ritmo de viaje.",
            },
            {
              n: "02",
              icon: Compass,
              title: "La IA te conoce",
              desc: "Tus respuestas personalizan destinos, hoteles y experiencias para tu estilo de viaje.",
            },
            {
              n: "03",
              icon: Wallet,
              title: "Un plan completo y honesto",
              desc: "Vuelos, hospedaje, itinerario día por día y presupuesto en MXN, con la procedencia de cada precio.",
            },
          ].map((step, i) => (
            <Reveal
              key={step.n}
              delay={i * 100}
              className="glass-card rounded-2xl p-8 hover:gold-border"
            >
              <div className="flex items-start justify-between mb-8">
                <step.icon className="w-7 h-7 text-primary" />
                <span aria-hidden="true" className="font-display text-2xl text-muted-foreground/60">{step.n}</span>
              </div>
              <h3 className="font-display text-2xl mb-3">{step.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{step.desc}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* DESTINOS GALERÍA */}
      <section className="py-32 bg-surface/30">
        <div className="container mx-auto">
          <div className="max-w-2xl mb-16">
            <p className="text-primary text-sm tracking-[0.2em] uppercase mb-4">Destinos</p>
            <h2 className="font-display text-4xl md:text-6xl leading-tight">
              Donde quiera que sueñes ir.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              { img: kyoto, name: "Kioto", country: "Japón" },
              { img: bora, name: "Bora Bora", country: "Polinesia" },
              { img: marrakech, name: "Marrakech", country: "Marruecos" },
            ].map((d) => (
              <div
                key={d.name}
                className="relative aspect-[4/5] rounded-2xl overflow-hidden group hover:scale-[1.02] transition-transform duration-500"
              >
                <img src={d.img} alt={d.name} loading="lazy" decoding="async" width={1024} height={1280} sizes="(min-width: 768px) 33vw, 100vw" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                <div className="absolute inset-0 bg-gradient-overlay" />
                <div className="absolute bottom-6 left-6">
                  <p className="text-xs text-primary tracking-[0.2em] uppercase mb-1">{d.country}</p>
                  <h3 className="font-display text-3xl">{d.name}</h3>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="py-32 container mx-auto">
        <div className="max-w-2xl mx-auto text-center mb-16">
          <p className="text-primary text-sm tracking-[0.2em] uppercase mb-4">Suscripción</p>
          <h2 className="font-display text-4xl md:text-6xl leading-tight mb-6">
            Un precio. <span className="gold-text italic">Todo el mundo.</span>
          </h2>
        </div>

        <div className="max-w-4xl mx-auto grid gap-6 md:grid-cols-2 items-start">
        {/* Plan gratuito (auditoría de cuenta #7): antes solo había tarjeta de PRO y lo que incluye el plan
            gratis solo aparecía en Términos. Mismo texto que Términos y la página PRO (planCopy). */}
        <Reveal className="glass-card rounded-3xl p-10">
          <div className="text-center mb-8">
            <p className="text-sm tracking-[0.2em] uppercase text-muted-foreground mb-3">Plan gratuito</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="font-display text-6xl">$0</span>
              <span className="text-muted-foreground">MXN</span>
            </div>
            <p className="text-sm text-muted-foreground mt-3">Para empezar a planear, sin costo.</p>
          </div>
          <div className="space-y-3 mb-8">
            {FREE_FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-white/[0.06] flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-muted-foreground" />
                </div>
                <span>{f}</span>
              </div>
            ))}
          </div>
          <Button size="lg" variant="outline" onClick={() => navigate("/auth?mode=signup")} className="w-full h-14">
            Empezar gratis
          </Button>
        </Reveal>
        <Reveal className="glass-card gold-border rounded-3xl p-10 premium-shadow">
          <div className="text-center mb-8">
            <p className="text-sm tracking-[0.2em] uppercase text-primary mb-3">IATOS PRO</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="font-display text-6xl">${PRO_PRICE_MXN}</span>
              <span className="text-muted-foreground">MXN / mes · IVA incluido</span>
            </div>
            <p className="text-sm text-muted-foreground mt-3">{trial.line}. {trial.after}</p>
          </div>
          <div className="space-y-3 mb-8">
            {PRO_FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-3 text-sm">
                <div className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-primary" />
                </div>
                <span>{f}</span>
              </div>
            ))}
          </div>
          <Button
            size="lg"
            onClick={() => navigate("/auth?mode=signup")}
            className="w-full bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow h-14"
          >
            {trial.cta}
          </Button>
          <p className="text-[11px] text-muted-foreground text-center mt-3">{trial.conditions}</p>
        </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/40 py-12">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={iatosLogo} alt="IATOS AI" className="h-8 w-auto object-contain" />
          <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <Link to="/terminos" className="hover:text-foreground transition">Términos</Link>
            <Link to="/privacidad" className="hover:text-foreground transition">Privacidad</Link>
            <Link to="/reembolsos" className="hover:text-foreground transition">Reembolsos</Link>
            <Link to="/cookies" className="hover:text-foreground transition">Cookies</Link>
            <Link to="/ayuda" className="hover:text-foreground transition">Ayuda</Link>
            <a href="mailto:hola@traveliatos.life" className="hover:text-foreground transition">Contacto</a>
          </nav>
          <p className="text-sm text-muted-foreground">© 2026 IATOS AI. Diseñado en CDMX.</p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
