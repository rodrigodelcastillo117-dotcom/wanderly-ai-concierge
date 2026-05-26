import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles, Compass, Wallet, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImg from "@/assets/hero-santorini.jpg";
import kyoto from "@/assets/destination-kyoto.jpg";
import bora from "@/assets/destination-bora.jpg";
import marrakech from "@/assets/destination-marrakech.jpg";
import iatosLogo from "@/assets/iatos-logo.png";

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* NAV */}
      <nav className="fixed top-0 inset-x-0 z-50 backdrop-blur-md bg-background/60 border-b border-border/40">
        <div className="container mx-auto flex items-center justify-between gap-2 py-4 px-4">
          <img src={iatosLogo} alt="IATOS" className="h-8 md:h-10 w-auto object-contain shrink-0" />
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
        <img
          src={heroImg}
          alt="Santorini al atardecer dorado"
          width={1920}
          height={1080}
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-overlay" />
        <div className="absolute inset-0 bg-gradient-radial-gold opacity-60" />

        <div className="container relative z-10 mx-auto pt-32 pb-20">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full glass-card text-sm mb-6">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span className="text-muted-foreground">IA personal de viajes premium</span>
            </div>
            <h1 className="font-display text-5xl md:text-7xl lg:text-8xl leading-[0.95] mb-6">
              Cualquier viaje.
              <br />
              <span className="gold-text italic">Experiencia premium.</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-xl mb-10 leading-relaxed">
              Tu concierge de IA que conoce tus gustos, cotiza con números reales y diseña cada experiencia desde $99 MXN al mes.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <Button
                size="lg"
                onClick={() => navigate("/auth?mode=signup")}
                className="bg-gradient-gold text-primary-foreground hover:opacity-90 gold-glow text-base h-14 px-8"
              >
                Empezar gratis 30 días
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
            <p className="text-xs text-muted-foreground mt-6 tracking-wide uppercase">Sin tarjeta los primeros 30 días · Cancela cuando quieras</p>
          </motion.div>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section id="como-funciona" className="py-32 container mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-2xl mb-20"
        >
          <p className="text-primary text-sm tracking-[0.2em] uppercase mb-4">Cómo funciona</p>
          <h2 className="font-display text-4xl md:text-6xl leading-tight">
            Tres pasos. Una vida<br />de viajes mejores.
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              n: "01",
              icon: Sparkles,
              title: "Cuéntanos quién eres",
              desc: "Una encuesta visual de 2 minutos para descubrir tu estilo, paladar, ritmo y obsesiones de viaje.",
            },
            {
              n: "02",
              icon: Compass,
              title: "La IA aprende",
              desc: "Tu perfil entrena un consultor personal que entiende exactamente qué te emociona y qué te aburre.",
            },
            {
              n: "03",
              icon: Wallet,
              title: "Planes premium ilimitados",
              desc: "Análisis completos con vuelos, hospedaje, itinerarios día por día y presupuestos reales en MXN.",
            },
          ].map((step, i) => (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="glass-card rounded-2xl p-8 hover:gold-border transition-all duration-500"
            >
              <div className="flex items-start justify-between mb-8">
                <step.icon className="w-7 h-7 text-primary" />
                <span className="font-display text-2xl text-muted-foreground/40">{step.n}</span>
              </div>
              <h3 className="font-display text-2xl mb-3">{step.title}</h3>
              <p className="text-muted-foreground leading-relaxed">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* DESTINOS GALERÍA */}
      <section className="py-32 bg-surface/30">
        <div className="container mx-auto">
          <div className="max-w-2xl mb-16">
            <p className="text-primary text-sm tracking-[0.2em] uppercase mb-4">Sin límites</p>
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
              <motion.div
                key={d.name}
                whileHover={{ scale: 1.02 }}
                transition={{ duration: 0.5 }}
                className="relative aspect-[4/5] rounded-2xl overflow-hidden group cursor-pointer"
              >
                <img src={d.img} alt={d.name} loading="lazy" width={1024} height={1280} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
                <div className="absolute inset-0 bg-gradient-overlay" />
                <div className="absolute bottom-6 left-6">
                  <p className="text-xs text-primary tracking-[0.2em] uppercase mb-1">{d.country}</p>
                  <h3 className="font-display text-3xl">{d.name}</h3>
                </div>
              </motion.div>
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

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="max-w-md mx-auto glass-card gold-border rounded-3xl p-10 premium-shadow"
        >
          <div className="text-center mb-8">
            <p className="text-sm tracking-[0.2em] uppercase text-primary mb-3">IATOS AI Premium</p>
            <div className="flex items-baseline justify-center gap-2">
              <span className="font-display text-6xl">$99</span>
              <span className="text-muted-foreground">MXN / mes</span>
            </div>
            <p className="text-sm text-muted-foreground mt-3">Primer mes gratis · Cancela cuando quieras</p>
          </div>
          <div className="space-y-3 mb-8">
            {[
              "Análisis de viaje ilimitados",
              "Itinerarios día por día generados por IA",
              "Presupuestos reales desglosados",
              "Recomendaciones personalizadas a tu perfil",
              "Tips y curaduría tipo concierge",
              "Guarda y exporta tus viajes",
            ].map((f) => (
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
            Empezar gratis 30 días
          </Button>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/40 py-12">
        <div className="container mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={iatosLogo} alt="IATOS AI" className="h-8 w-auto object-contain" />
          <p className="text-sm text-muted-foreground">© 2026 IATOS AI. Diseñado en CDMX.</p>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
