import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureException } from "@/lib/sentry";

/**
 * Si el globo 3D no puede dibujarse (equipo sin WebGL, textura que no cargó), solo el globo se cambia por
 * un aviso: la página del viaje o el Perfil siguen funcionando completos.
 */
export class GlobeBoundary extends Component<{ children: ReactNode; height?: number; mensaje?: string }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { componentStack: info.componentStack, where: "globo-3d" });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rounded-2xl border border-border bg-black/60 flex items-center justify-center px-4 text-center text-xs text-muted-foreground"
        style={{ minHeight: Math.min(this.props.height ?? 160, 160) }} role="status" data-testid="globo-no-disponible">
        {this.props.mensaje ?? "Este dispositivo no pudo mostrar el globo 3D."}
      </div>
    );
  }
}
