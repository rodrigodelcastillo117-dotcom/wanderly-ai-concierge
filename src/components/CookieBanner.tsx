import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getConsent, setConsent, OPEN_SETTINGS_EVENT, type ConsentChoice } from "@/lib/consent";

// Aviso de cookies con elección real. Mientras no haya elección, NO se carga PostHog
// ni el script de Travelpayouts (ver lib/consent.ts). La elección se puede cambiar
// desde la Política de Cookies.
export const CookieBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (getConsent() === null) setVisible(true);
    const open = () => setVisible(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, []);

  const choose = (choice: ConsentChoice) => {
    setConsent(choice);
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-3 md:p-4" role="region" aria-label="Aviso de cookies">
      <div className="max-w-3xl mx-auto glass-card rounded-xl border border-white/10 p-4 md:p-5 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <p className="text-xs md:text-sm text-muted-foreground flex-1">
          Usamos almacenamiento esencial para mantener tu sesión. Con tu permiso, también usamos analítica de
          uso (PostHog) y medición de afiliados (Travelpayouts) para mejorar IATOS. Al abrir un enlace de reserva,
          el proveedor final puede colocar su propia cookie.{" "}
          <Link to="/cookies" className="text-primary hover:underline whitespace-nowrap">
            Más información
          </Link>
          .
        </p>
        <div className="flex gap-2 w-full sm:w-auto shrink-0">
          <Button onClick={() => choose("essential")} size="sm" variant="outline" className="flex-1 sm:flex-none min-h-[44px]">
            Solo esenciales
          </Button>
          <Button onClick={() => choose("accepted")} size="sm" className="flex-1 sm:flex-none min-h-[44px] bg-gradient-gold text-primary-foreground hover:opacity-90">
            Aceptar
          </Button>
        </div>
      </div>
    </div>
  );
};
