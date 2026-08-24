import { Sentry } from "@/lib/sentry";

/**
 * Red de seguridad de última instancia. Sin esto, CUALQUIER error de render en
 * CUALQUIER pantalla (un campo null, un chunk que no cargó, lo que sea) tumba
 * todo el árbol de React y deja la pantalla completamente en negro — el usuario
 * no ve nada, no hay forma de recuperarse salvo cerrar y volver a abrir a ciegas.
 *
 * Envuelve toda la app. Si Sentry está configurado (VITE_SENTRY_DSN), reporta
 * el error automáticamente; si no, igual muestra una pantalla de recuperación
 * en vez de una negra.
 */
export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div className="min-h-screen flex items-center justify-center bg-background px-6">
          <div className="max-w-sm text-center space-y-4">
            <p className="text-primary text-[11px] tracking-[0.35em] uppercase">IATOS AI</p>
            <h1 className="font-display text-2xl text-foreground">Algo no cargó bien</h1>
            <p className="text-sm text-muted-foreground">
              Tuvimos un problema mostrando esta pantalla. Recarga para intentar de nuevo — tu
              información no se perdió.
            </p>
            <button
              onClick={() => {
                resetError();
                window.location.reload();
              }}
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition"
            >
              Recargar
            </button>
          </div>
        </div>
      )}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
