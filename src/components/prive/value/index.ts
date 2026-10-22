/**
 * privevalor — ranuras que monta el shell de prive-ux (contrato prive_reimagined_contract.md). Todas sin
 * props obligatorias. Sin sesión Privé (o con un código PRIVE_*) no pintan nada: el servidor decide.
 *
 *   <DropsTeaser />        FOR YOU · la oportunidad real más relevante, o una línea honesta al Insider
 *   <PrivateEditTeaser />  FOR YOU · reservado: THE PRIVATE EDIT pasó a THE PRIVATE EDITION (equipo
 *                          edition, /prive/edicion). No pinta nada (no se muestra un botón sin destino).
 *   <PassportCard />       MY PRIVÉ · tarjeta de miembro + THE PRIVÉ PASSPORT
 *   <ValueOfYourPrive />   MY PRIVÉ · THE VALUE OF YOUR PRIVÉ (comprobado / estimado / potencial / sin ahorro)
 *   <PrivilegeRadar />     MY PRIVÉ o /prive/drops · THE PRIVILEGE RADAR sobre la Bóveda
 *   <BeforeYouGo />        FOR YOU (onlyWhenNear) o /prive/insider · las cinco cosas antes de llegar
 *   <PrivePreview />       /prive antes del día 90 · vista previa sin contenido protegido
 */
export { DropsTeaser } from "./DropsTeaser";
export { PassportCard } from "./PassportCard";
export { ValueOfYourPrive } from "./ValueOfYourPrive";
export { PrivilegeRadar } from "./PrivilegeRadar";
export { BeforeYouGo } from "./BeforeYouGo";
export { PrivePreview } from "./PrivePreview";

export function PrivateEditTeaser(_props: { destination?: string | null } = {}) {
  return null;
}
