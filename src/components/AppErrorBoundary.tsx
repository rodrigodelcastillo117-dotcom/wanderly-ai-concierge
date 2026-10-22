import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "@/lib/sentry";

/**
 * Red de seguridad de última instancia. Sin esto, CUALQUIER error de render en
 * CUALQUIER pantalla (un campo null, un chunk que no cargó, lo que sea) tumba
 * todo el árbol de React y deja la pantalla completamente en negro — el usuario
 * no ve nada, no hay forma de recuperarse salvo cerrar y volver a abrir a ciegas.
 *
 * Envuelve toda la app. Si Sentry está configurado (VITE_SENTRY_DSN), reporta
 * el error; si no, igual muestra una pantalla de recuperación en vez de una negra.
 * Es un error boundary propio (antes Sentry.ErrorBoundary) para no cargar @sentry/react en
 * el paquete inicial.
 */
type State = { error: Error | null };

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div role="alert" className="max-w-sm text-center space-y-4">
          <p className="text-primary text-[11px] tracking-[0.35em] uppercase">IATOS AI</p>
          <h1 className="font-display text-2xl text-foreground">Algo no cargó bien</h1>
          <p className="text-sm text-muted-foreground">
            Tuvimos un problema mostrando esta pantalla. Recarga para intentar de nuevo — tu
            información no se perdió.
          </p>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
