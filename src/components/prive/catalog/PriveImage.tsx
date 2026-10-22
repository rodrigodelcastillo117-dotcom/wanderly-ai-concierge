import { PrivePhoto } from "@/components/prive/PrivePhoto";

/**
 * Foto de Pexels de una experiencia o destino (consultas en orden: curador → subcategoría + ciudad →
 * universo). Pasa por PrivePhoto: fila y caché compartidas con el resto de IATOS (antes cada tarjeta
 * llamaba a pexels-image por su cuenta y un 429 quedaba como "sin foto" hasta recargar), reintento
 * de fallos temporales y respaldo de marca, nunca una caja vacía.
 * `linkCredit`: crédito con enlaces a Pexels (portadas y fichas). En una tarjeta que ya es un enlace
 * va como texto: un enlace dentro de otro abría Pexels en otra pestaña al tocar la tarjeta.
 */
export function PriveImage({ queries, illustrative = true, className = "", alt, label, linkCredit = true, eager = false }: {
  queries: string[]; illustrative?: boolean; className?: string; alt: string; label?: string; linkCredit?: boolean; eager?: boolean;
}) {
  return (
    <PrivePhoto queries={queries} alt={alt} label={label ?? alt} illustrative={illustrative} className={className}
      creditLinks={linkCredit} eager={eager} />
  );
}
