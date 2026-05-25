import { DashboardLayout } from "@/components/DashboardLayout";

export const SoonPage = ({ title, description }: { title: string; description: string }) => (
  <DashboardLayout>
    <div className="p-6 md:p-10">
      <h1 className="font-display text-4xl md:text-5xl mb-3">{title}</h1>
      <p className="text-muted-foreground mb-8 max-w-xl">{description}</p>
      <div className="glass-card rounded-2xl p-10 text-center">
        <p className="text-sm tracking-[0.25em] text-primary uppercase mb-2">Próximamente</p>
        <p className="text-muted-foreground">Estamos preparando esta experiencia para ti.</p>
      </div>
    </div>
  </DashboardLayout>
);

export const Concierge = () => <SoonPage title="AI Concierge" description="Tu asistente personal para planear, reservar y optimizar." />;
export const Pro = () => <SoonPage title="IATOS PRO" description="Desbloquea experiencias exclusivas y beneficios únicos." />;
