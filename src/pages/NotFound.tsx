import { Link } from "react-router-dom";
import { Compass } from "lucide-react";

// 404 con el fondo negro de la app (antes gris, bg-muted) y sin console.error: una ruta inexistente no es
// un error de la app (auditorías de cuenta #9 y técnica #7). Lovable sirve la SPA con HTTP 200 en
// cualquier ruta; el estado 404 real no se puede configurar desde el código (docs/ops/LEEME.md).
const NotFound = () => (
  <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground" data-testid="not-found">
    <div className="max-w-md text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-gold mb-6">
        <Compass className="w-5 h-5 text-primary-foreground" aria-hidden="true" />
      </div>
      <p className="text-xs tracking-[0.25em] uppercase text-primary mb-3">Error 404</p>
      <h1 className="font-display text-4xl mb-3">No encontramos esta página</h1>
      <p className="text-muted-foreground mb-8">Puede que el enlace esté incompleto o que la página ya no exista.</p>
      <div className="flex flex-wrap justify-center gap-3">
        {/* Link (no <a href>) para no recargar toda la app */}
        <Link to="/" className="inline-flex items-center rounded-xl bg-gradient-gold px-5 py-3 text-sm font-medium text-primary-foreground">
          Volver al inicio
        </Link>
        <Link to="/ayuda" className="inline-flex items-center rounded-xl border border-border px-5 py-3 text-sm hover:border-primary/50 transition">
          Ayuda
        </Link>
      </div>
    </div>
  </main>
);

export default NotFound;
