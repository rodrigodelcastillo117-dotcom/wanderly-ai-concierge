// STUB de prive-ux: /prive/drops es del equipo `privevalor` (Privé Drops), que reemplaza este archivo.
import { PriveComingSoon } from "@/components/prive/shell/PriveComingSoon";
import { usePriveT } from "@/components/prive/PriveLang";

export default function PriveDropsPage() {
  const t = usePriveT();
  return <PriveComingSoon brand="Privé Drops" sub={t.shell.dropsSub} />;
}
