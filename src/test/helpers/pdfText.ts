// Texto de un PDF hecho con jsPDF, como lo copiaría un lector: decodifica cada Tj/TJ con el mapa
// ToUnicode de su fuente (Identity-H con fuentes TTF incrustadas) o como texto literal (fuentes
// estándar). Sirve para comprobar que "→" y "★" salen como tales y no como "!'" o "&".
import { inflateSync } from "node:zlib";

type Obj = { num: number; dict: string; stream: Buffer | null };

function parseObjects(pdf: Buffer): Map<number, Obj> {
  const s = pdf.toString("latin1");
  const out = new Map<number, Obj>();
  const re = /(\d+) 0 obj([\s\S]*?)endobj/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const body = m[2];
    const si = body.indexOf("stream");
    let stream: Buffer | null = null;
    let dict = body;
    if (si >= 0) {
      dict = body.slice(0, si);
      let start = si + "stream".length;
      if (body[start] === "\r") start++;
      if (body[start] === "\n") start++;
      const end = body.lastIndexOf("endstream");
      let raw = Buffer.from(body.slice(start, end), "latin1");
      if (/\/FlateDecode/.test(dict)) {
        try { raw = inflateSync(raw); } catch { /* flujo sin comprimir */ }
      }
      stream = raw;
    }
    out.set(Number(m[1]), { num: Number(m[1]), dict, stream });
  }
  return out;
}

function parseCMap(src: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => {
    let r = "";
    for (let i = 0; i < h.length; i += 4) r += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
    return r;
  };
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(p[1], 16), hexToStr(p[2]));
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      const a = parseInt(p[1], 16);
      const b = parseInt(p[2], 16);
      if (p[3].startsWith("[")) {
        const items = [...p[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexToStr(x[1]));
        for (let c = a; c <= b; c++) map.set(c, items[c - a] ?? "");
      } else {
        const base = parseInt(p[3].slice(1, -1), 16);
        for (let c = a; c <= b; c++) map.set(c, String.fromCodePoint(base + (c - a)));
      }
    }
  }
  return map;
}

const unescapeLiteral = (s: string) => s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, e) => {
  const map: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
  return map[e] ?? String.fromCharCode(parseInt(e, 8));
});

/** Texto de cada página (un elemento por página). */
export function pdfPagesText(bytes: Uint8Array): string[] {
  const objs = parseObjects(Buffer.from(bytes));
  // fuente (objeto) → mapa ToUnicode
  const cmaps = new Map<number, Map<number, string>>();
  for (const o of objs.values()) {
    const tu = /\/ToUnicode (\d+) 0 R/.exec(o.dict);
    if (tu) {
      const c = objs.get(Number(tu[1]));
      if (c?.stream) cmaps.set(o.num, parseCMap(c.stream.toString("latin1")));
    }
  }
  // nombres de recurso (/F12) → objeto
  const fontNames = new Map<string, number>();
  for (const o of objs.values()) {
    const fd = /\/Font\s*<<([\s\S]*?)>>/.exec(o.dict);
    if (fd) for (const f of fd[1].matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) fontNames.set(f[1], Number(f[2]));
  }
  const pages: string[] = [];
  const pageObjs = [...objs.values()].filter((o) => /\/Type\s*\/Page\b/.test(o.dict)).sort((a, b) => a.num - b.num);
  for (const pg of pageObjs) {
    const contents = /\/Contents (\d+) 0 R/.exec(pg.dict);
    const stream = contents ? objs.get(Number(contents[1]))?.stream : null;
    if (!stream) { pages.push(""); continue; }
    const src = stream.toString("latin1");
    let font: Map<number, string> | null = null;
    const parts: string[] = [];
    const tokenRe = /\/(F\d+)\s+[\d.]+\s+Tf|<([0-9a-fA-F]*)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g;
    let t: RegExpExecArray | null;
    const decodeHex = (h: string) => {
      let r = "";
      for (let i = 0; i < h.length; i += 4) {
        const code = parseInt(h.slice(i, i + 4), 16);
        r += font?.get(code) ?? "";
      }
      return r;
    };
    while ((t = tokenRe.exec(src))) {
      if (t[1]) { const n = fontNames.get(t[1]); font = n != null ? cmaps.get(n) ?? null : null; continue; }
      if (t[2] != null) parts.push(font ? decodeHex(t[2]) : "");
      else if (t[3] != null) parts.push(unescapeLiteral(t[3]));
      else if (t[4] != null) {
        parts.push([...t[4].matchAll(/<([0-9a-fA-F]*)>|\(((?:\\.|[^\\)])*)\)/g)].map((x) => (x[1] != null ? decodeHex(x[1]) : unescapeLiteral(x[2]))).join(""));
      }
    }
    pages.push(parts.join("\n"));
  }
  return pages;
}

/** URLs de los enlaces clicables del PDF. */
export function pdfLinkUrls(bytes: Uint8Array): string[] {
  const s = Buffer.from(bytes).toString("latin1");
  return [...s.matchAll(/\/URI \(((?:\\.|[^\\)])*)\)/g)].map((m) => unescapeLiteral(m[1]));
}
