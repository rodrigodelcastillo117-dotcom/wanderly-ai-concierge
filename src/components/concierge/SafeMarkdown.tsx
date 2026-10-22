// Markdown mínimo y seguro para las respuestas de Iato (N-05).
//
// Por qué: el modelo responde con Markdown y la burbuja lo mostraba crudo (asteriscos literales,
// saltos de línea perdidos). No usamos dangerouslySetInnerHTML ni una librería de HTML: el texto
// del modelo se convierte en elementos de React (que escapan todo), y solo se reconoce un
// subconjunto: párrafos, saltos de línea, listas (- * • y 1.), **negritas**, *cursivas*,
// `código` y enlaces [texto](https://…). Cualquier otro esquema (javascript:, data:, http:) se
// muestra como texto sin enlace.
import { Fragment, type ReactNode } from "react";

/** Solo enlaces https absolutos; todo lo demás se descarta. */
export function safeHttpsUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

type InlineRule = { re: RegExp; render: (m: RegExpExecArray, key: string) => ReactNode };

const INLINE: InlineRule[] = [
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    render: (m, key) => {
      const href = safeHttpsUrl(m[2]);
      const label = renderInline(m[1], `${key}l`, false);
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary underline underline-offset-2">
          {label}
        </a>
      ) : (
        <Fragment key={key}>{label}</Fragment>
      );
    },
  },
  { re: /`([^`\n]+)`/, render: (m, key) => <code key={key} className="px-1 rounded bg-muted text-[0.9em]">{m[1]}</code> },
  { re: /\*\*(?=\S)([^*\n]+?)\*\*|__(?=\S)([^_\n]+?)__/, render: (m, key) => <strong key={key}>{renderInline(m[1] ?? m[2], `${key}b`)}</strong> },
  // Cursiva con * o con _ (este último solo entre no-letras, para no romper palabras_con_guion).
  // Sin "lookbehind" en la expresión: Safari anterior a 16.4 no lo soporta y tumbaría la página.
  {
    re: /\*(?=\S)([^*\n]+?)\*|(^|[^\p{L}\p{N}_])_(?=\S)([^_\n]+?)_(?![\p{L}\p{N}_])/u,
    render: (m, key) => (
      <Fragment key={key}>
        {m[2] ?? ""}
        <em>{renderInline(m[1] ?? m[3], `${key}i`)}</em>
      </Fragment>
    ),
  },
];

function renderInline(text: string, keyBase: string, allowLinks = true): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: { m: RegExpExecArray; rule: InlineRule } | null = null;
    for (const rule of INLINE) {
      if (!allowLinks && rule === INLINE[0]) continue;
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyBase}-${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const UL = /^\s*[-*•]\s+(.*)$/;
const OL = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const push = (b: Block) => blocks.push(b);
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const last = blocks[blocks.length - 1];
    if (!raw.trim()) {
      // Línea vacía: cierra el bloque actual.
      if (last && !(last.kind === "p" && last.lines.length === 0)) push({ kind: "p", lines: [] });
      continue;
    }
    const ul = UL.exec(raw);
    const ol = !ul ? OL.exec(raw) : null;
    if (ul) {
      if (last?.kind === "ul") last.items.push(ul[1]);
      else push({ kind: "ul", items: [ul[1]] });
    } else if (ol) {
      if (last?.kind === "ol") last.items.push(ol[1]);
      else push({ kind: "ol", items: [ol[1]] });
    } else {
      // Los títulos (# …) se muestran como una línea en negritas.
      const h = HEADING.exec(raw);
      const line = h ? `**${h[1].replace(/\*\*/g, "")}**` : raw;
      if (last?.kind === "p") last.lines.push(line);
      else push({ kind: "p", lines: [line] });
    }
  }
  return blocks.filter((b) => (b.kind === "p" ? b.lines.length > 0 : b.items.length > 0));
}

export function SafeMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind;
          return (
            <List key={key} className={`${b.kind === "ul" ? "list-disc" : "list-decimal"} pl-5 space-y-1`}>
              {b.items.map((it, j) => <li key={j}>{renderInline(it, `${key}-${j}`)}</li>)}
            </List>
          );
        }
        return (
          <p key={key}>
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(l, `${key}-${j}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
