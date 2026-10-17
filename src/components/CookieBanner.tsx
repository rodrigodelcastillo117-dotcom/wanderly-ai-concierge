import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "iatos_cookie_notice_v1";

export const CookieBanner = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage bloqueado (modo privado, etc.): no mostramos el aviso para no romper la UI
    }
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignorar si no se puede persistir
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 z-[100] p-3 md:p-4">
      <div className="max-w-3xl mx-auto glass-card rounded-xl border border-white/10 p-4 md:p-5 shadow-2xl flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4">
        <p className="text-xs md:text-sm text-muted-foreground flex-1">
          Usamos almacenamiento esencial para mantener tu sesión y, al dar clic en un enlace de reserva,
          el proveedor final puede colocar su propia cookie de atribución.{" "}
          <Link to="/cookies" className="text-primary hover:underline whitespace-nowrap">
            Más información
          </Link>
          .
        </p>
        <Button onClick={dismiss} size="sm" className="bg-gradient-gold text-primary-foreground hover:opacity-90 shrink-0 w-full sm:w-auto">
          Entendido
        </Button>
      </div>
    </div>
  );
};
