// Arnés LOCAL de evidencia visual de privevalor (scripts/prive/value_evidence.mjs). No es parte del build ni de
// la app: monta las ranuras de MY PRIVÉ (PassportCard, ValueOfYourPrive) y la vista previa antes del día 90
// dentro del marco real de Privé (AuthProvider + PriveProvider + prive.css), contra el Supabase simulado.
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { PriveProvider } from "@/hooks/usePriveAccess";
import { PassportCard, PrivePreview, ValueOfYourPrive } from "@/components/prive/value";
import "@/index.css";
import "@/components/prive/prive.css";

const preview = new URLSearchParams(location.search).has("preview");
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <PriveProvider>
        <div className="prive-root">
          {preview ? <PrivePreview /> : (
            <main className="mx-auto max-w-6xl space-y-14 px-4 pb-24 pt-8 sm:px-8">
              <PassportCard />
              <ValueOfYourPrive />
            </main>
          )}
        </div>
      </PriveProvider>
    </AuthProvider>
  </BrowserRouter>,
);
