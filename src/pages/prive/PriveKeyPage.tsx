// STUB de prive-ux: /prive/key es del equipo `privekey` (The Privé Key), que reemplaza este archivo.
import { PriveComingSoon } from "@/components/prive/shell/PriveComingSoon";
import { usePriveT } from "@/components/prive/PriveLang";

export default function PriveKeyPage() {
  const t = usePriveT();
  return <PriveComingSoon brand={t.home.keyBrand} sub={t.home.keySub} />;
}
