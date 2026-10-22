/**
 * Título de marca en inglés con su subtítulo en el idioma de la persona (nota del dueño sobre idioma):
 * "Curated for You" + "Elegido para ti". En inglés el subtítulo va vacío y no se dibuja.
 */
export function BrandTitle({ id, brand, sub, note, small = false, as: Tag = "h2" }: {
  id?: string; brand: string; sub?: string; note?: string; small?: boolean; as?: "h1" | "h2" | "h3";
}) {
  return (
    <div className="min-w-0">
      <Tag id={id} className={`${small ? "text-2xl sm:text-3xl" : "text-3xl sm:text-[2.6rem]"} leading-tight`}>
        {brand}
        {sub ? <span className="block prive-eyebrow mt-2 normal-case tracking-[0.18em] text-[12px] text-[color:var(--pv-gold)]" lang="es">{sub}</span> : null}
      </Tag>
      {note && <p className="text-xs prive-muted mt-2 max-w-xl">{note}</p>}
    </div>
  );
}
