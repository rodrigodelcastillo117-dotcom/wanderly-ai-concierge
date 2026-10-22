// Etiquetado ligero de "Mejores momentos" con un modelo de visión. Lógica pura (Vitest).
//
// La foto es una señal explícita de "esto me encantó"; si no trae viaje ni texto, el modelo dice
// de qué es (playa, mercado, atardecer…) para que el perfil de gustos la entienda. Reglas:
//   - Solo se lee el archivo del bucket travel-moments DENTRO de la carpeta de la persona (nunca
//     una URL arbitraria: image_url la escribe el cliente).
//   - Una vez por foto (caché en la fila: ai_tag_status = done) y con tope diario por persona y
//     total (costo acotado). Sin llave o con tope alcanzado se marca "skipped": el momento cuenta
//     igual con su viaje y su texto.
//   - No identifica personas ni describe rasgos físicos.

export const BUCKET = "travel-moments";
export const VISION_MODEL = "google/gemini-flash-latest";
export const DEFAULT_USER_DAILY_CAP = 30;
export const DEFAULT_GLOBAL_DAILY_CAP = 1000;
/** Imágenes más grandes no se mandan completas (costo y tiempo); se intenta la versión reducida. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export const TAG_VOCAB = [
  "playa", "mar", "montaña", "nieve", "naturaleza", "bosque", "desierto", "lago", "ciudad", "arquitectura",
  "historia", "museo", "arte", "cultura", "gastronomía", "restaurante", "comida callejera", "mercado", "vino",
  "café", "coctelería", "vida nocturna", "fiesta", "concierto", "atardecer", "vista", "hotel", "piscina",
  "spa", "relax", "aventura", "senderismo", "buceo", "esquí", "barco", "roadtrip", "compras", "familia",
  "pareja", "amigos", "lujo", "pueblo", "templo", "parque", "deporte", "festival",
] as const;

const VOCAB_KEYS = new Map(TAG_VOCAB.map((t) => [t.normalize("NFD").replace(/[̀-ͯ]/g, ""), t]));

/** Ruta dentro del bucket a partir de la URL pública guardada (sin query ni fragmento). */
export function storagePathFromUrl(url: unknown, bucket = BUCKET): string | null {
  const s = String(url ?? "");
  const marker = `/${bucket}/`;
  const i = s.indexOf(marker);
  if (i < 0) return null;
  const path = decodeURIComponent(s.slice(i + marker.length).split(/[?#]/)[0] ?? "");
  return path || null;
}

/** La ruta es de la carpeta de la persona y no se sale de ella. */
export function ownsPath(path: string | null, userId: string): boolean {
  if (!path || !userId) return false;
  if (path.includes("..") || path.includes("//") || path.startsWith("/")) return false;
  return path.startsWith(`${userId}/`) && path.length > userId.length + 1;
}

export type CapCheck = { allowed: boolean; reason?: "user_cap" | "global_cap" };
export function capCheck(counts: { user: number; global: number }, caps: { user: number; global: number }): CapCheck {
  if (counts.user >= caps.user) return { allowed: false, reason: "user_cap" };
  if (counts.global >= caps.global) return { allowed: false, reason: "global_cap" };
  return { allowed: true };
}

export const intEnv = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export const VISION_PROMPT = `Mira esta foto de viaje que la persona eligió como uno de sus mejores momentos.
Devuelve SOLO JSON:
{"tags": [hasta 6 de esta lista: ${TAG_VOCAB.join(", ")}],
 "ambiente": "2 a 5 palabras en español (ej. 'atardecer tranquilo junto al mar')",
 "lugar_reconocible": "ciudad o lugar SOLO si es un sitio famoso inconfundible (ej. 'Santorini', 'Torre Eiffel'); si no, null",
 "confianza_lugar": número de 0 a 1}
Reglas: no identifiques personas ni describas su físico, edad o ropa. No inventes un lugar: si dudas, null y 0.`;

export function visionBody(dataUrl: string) {
  return {
    model: VISION_MODEL,
    max_tokens: 200,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [{
      role: "user",
      content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    }],
  };
}

export type VisionTags = { tags: string[]; ambiente: string | null; lugar_reconocible: string | null; confianza_lugar: number; modelo: string };

const short = (v: unknown, max: number) => {
  const s = String(v ?? "").replace(/[<>{}`\\]/g, "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** Respuesta del modelo → etiquetas limpias (solo del vocabulario; lugar con su confianza). */
export function parseVisionTags(content: unknown, model = VISION_MODEL): VisionTags | null {
  let data: any = content;
  if (typeof content === "string") {
    try {
      data = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { data = JSON.parse(m[0]); } catch { return null; }
    }
  }
  if (!data || typeof data !== "object") return null;
  const tags: string[] = [];
  for (const t of Array.isArray(data.tags) ? data.tags : []) {
    const k = String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    const v = VOCAB_KEYS.get(k);
    if (v && !tags.includes(v)) tags.push(v);
    if (tags.length >= 6) break;
  }
  const conf = Number(data.confianza_lugar);
  const lugar = short(data.lugar_reconocible, 60);
  const confianza = Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0;
  return {
    tags,
    ambiente: short(data.ambiente, 60),
    lugar_reconocible: lugar && !/^null$/i.test(lugar) ? lugar : null,
    confianza_lugar: lugar ? confianza : 0,
    modelo: model,
  };
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function mimeFor(path: string, fallback = "image/jpeg"): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", gif: "image/gif" } as Record<string, string>)[ext] ?? fallback;
}
