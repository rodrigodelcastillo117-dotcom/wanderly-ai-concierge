// STUB de prive-ux: /prive/insider es del equipo `privevalor` (The Insider's Notebook), que reemplaza este archivo.
import { PriveComingSoon } from "@/components/prive/shell/PriveComingSoon";
import { usePriveT } from "@/components/prive/PriveLang";

export default function PriveInsiderPage() {
  const t = usePriveT();
  return <PriveComingSoon brand="The Insider's Notebook" sub={t.shell.insiderSub} />;
}
