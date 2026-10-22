import type { LucideProps } from "lucide-react";
import {
  Armchair, BadgeCheck, BookUser, Car, CreditCard, FileBadge, Fingerprint, Hotel, IdCard, Plane,
  ShieldPlus, Ship, Stamp, Syringe, Umbrella, LifeBuoy, ScrollText,
} from "lucide-react";
import type { VaultKind } from "@/lib/boveda/types";

const ICONS: Record<VaultKind, React.ComponentType<LucideProps>> = {
  pasaporte: BookUser,
  visa: Stamp,
  autorizacion: BadgeCheck,
  ine: IdCard,
  licencia: Car,
  vacuna: Syringe,
  otro_documento: FileBadge,
  aerolinea: Plane,
  hotel: Hotel,
  auto: Car,
  crucero: Ship,
  sala: Armchair,
  viajero_confiable: Fingerprint,
  otra_membresia: BadgeCheck,
  tarjeta: CreditCard,
  seguro_viaje: Umbrella,
  seguro_medico: ShieldPlus,
  asistencia: LifeBuoy,
  otro_seguro: ScrollText,
};

export function KindIcon({ kind, ...props }: { kind: VaultKind } & LucideProps) {
  const Icon = ICONS[kind] ?? FileBadge;
  return <Icon {...props} />;
}
