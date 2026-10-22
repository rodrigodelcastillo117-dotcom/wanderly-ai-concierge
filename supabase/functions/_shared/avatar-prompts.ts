// Prompts y lectura de respuestas del avatar (sin Deno: se prueba con Vitest).
//
// Por qué el avatar anterior no se parecía (causa raíz, ver docs/iatos/avatar/AVATAR_VIAJES.md):
// 1. "Re-generar" en la tarjeta del Travel DNA llamaba a generate-avatar SIN la selfie: el modelo
//    inventaba a una persona nueva ("androgynous luxury traveler") y la guardaba como tu avatar.
// 2. El prompt pedía cuerpo completo de pies a cabeza en 3:4: la cara quedaba en ~8 % de la imagen y
//    el modelo no tenía píxeles para conservar los rasgos.
// 3. "Caricatura", "ojos estilizados expresivos", outfit y escenario del último viaje competían con
//    la identidad; nada decía qué conservar (lentes, barba, tono de piel, edad).
// 4. La selfie se mandaba tal cual (hasta 8 MB, a veces de lado por la orientación EXIF) y una sola
//    vez, con un modelo que Google anunció como retirado; no había verificación del parecido.
// Aquí: retrato cuadrado de cabeza y hombros (la cara llena el tercio central), reglas explícitas de
// identidad, varias fotos de referencia, verificación del parecido y reintento con correcciones.

export type BuilderTraits = {
  gender?: string; skin?: string; hair_style?: string; hair_color?: string;
  outfit_style?: string; accessory?: string; vibe?: string;
};

const STYLE = `Style: refined, semi-realistic 3D illustrated portrait with premium animated-film quality, soft painterly shading and natural proportions. A stylized RENDERING of the real person — NOT a caricature, no exaggerated or enlarged features, NOT anime, NOT chibi, NOT a generic model face.`;

const FRAMING = `Framing: SQUARE 1:1 image. Head-and-shoulders to upper-chest portrait, the face centered horizontally and slightly above center, filling about 40% of the image height, looking at the camera. Leave a little space around the head so the image can be cropped into a circle without cutting the face or hair.`;

const WARDROBE = `Outfit: elegant smart-casual travel outfit in neutral tones (camel, cream, navy or black) with subtle gold details; a clean lapel or collar area visible on the chest.`;

const BACKDROP = `Background: smooth dark warm gradient (deep espresso to charcoal) with a faint golden glow behind the head. No scenery, no props, no extra people. No text, letters, logos or watermarks.`;

// Una usuaria recibió su avatar con barba (22-oct-2026): el modelo la inventaba. Regla estricta.
export const FACIAL_HAIR_RULE = `FACIAL HAIR (strict rule): if the person is a woman, the avatar must NEVER have any facial hair — absolutely NO beard, NO mustache, NO stubble, NO shadow on chin, jaw or upper lip; smooth clean feminine face. If the person is a man, draw a beard, mustache or stubble ONLY if it is visible in the photo (even slightly visible stubble counts — keep it as subtle as in the photo, same shape and length); if the photo shows a clean-shaven man, the face must be clean-shaven. Never add facial hair that is not in the photo.`;

const isWoman = (g?: string) => /^(female|mujer|woman|femenino)$/i.test(String(g ?? "").trim());

const IDENTITY_RULES = `IDENTITY — the top priority, never trade it for style:
- Same face shape, jawline, chin and cheekbones; same nose, lips and ear shape.
- Same eye shape, eye color, eyelids, and eyebrow shape and thickness.
- Same skin tone and undertone (do not lighten or darken it); keep freckles, moles, dimples, wrinkles and smile lines.
- Same hairstyle, length, hairline, parting, texture and color, including grey hair, receding hairline or baldness.
- ${FACIAL_HAIR_RULE}
- Glasses: if the person wears glasses, keep the same frame shape and color; if not, no glasses.
- Same apparent age, gender presentation and body build. Do NOT beautify, slim, de-age or change ethnicity.`;

/** Prompt para crear el avatar a partir de 1-3 fotos reales de la persona. */
export function identityPrompt(opts: { photos: number; variant?: number; fixes?: string[] }): string {
  const n = Math.max(1, Math.min(3, Math.floor(opts.photos || 1)));
  const lines = [
    n > 1
      ? `The ${n} attached photos all show the SAME real person from different angles. Use them together to understand the face; when they disagree, follow the first (clearest, frontal) photo.`
      : `The attached photo shows a real person.`,
    `Create a premium illustrated travel avatar portrait of THIS EXACT person — friends must recognize them instantly.`,
    IDENTITY_RULES,
    STYLE,
    FRAMING,
    WARDROBE,
    BACKDROP,
  ];
  if (opts.variant && opts.variant > 1) {
    lines.push(`Variation ${opts.variant}: a slightly different head angle and outfit color than other versions; the face must stay identical to the photos.`);
  }
  if (opts.fixes?.length) {
    lines.unshift(`A previous attempt did NOT look enough like this person. Fix these differences: ${opts.fixes.slice(0, 4).join("; ")}. Reduce stylization and stay closer to the photo.`);
  }
  return lines.join("\n\n");
}

/** Prompt para el modo "diséñalo tú" (sin foto): no hay identidad que verificar. */
export function builderPrompt(b: BuilderTraits, variant = 1): string {
  return [
    `Premium illustrated travel avatar portrait of one ${b.gender || "person"}, warm confident expression.`,
    `Traits (must match exactly): skin tone ${b.skin || "natural medium"}; hair ${b.hair_style || "modern"} in ${b.hair_color || "natural"} color.${b.vibe ? ` Mood: ${b.vibe}.` : ""}${b.accessory ? ` Small accessory: ${b.accessory}.` : ""}`,
    `Facial hair: ${isWoman(b.gender) ? "none — woman, smooth clean face, absolutely no facial hair" : "none — smooth clean face, no beard, no stubble"}.`,
    STYLE,
    FRAMING,
    b.outfit_style ? `Outfit: ${b.outfit_style}, refined, with subtle gold details.` : WARDROBE,
    BACKDROP,
    variant > 1 ? `Variation ${variant}: slightly different head angle and outfit color.` : "",
  ].filter(Boolean).join("\n\n");
}

const SLOT_PLACEMENT: Record<string, string> = {
  pin: "pinned on the lapel or upper chest of the outfit",
  dije: "hanging from a slim strap or keyring visible near the shoulder or chest",
  accesorio: "worn on the wrist, neck or chest pocket as described",
};

/** Edición: agrega los recuerdos de viaje a la imagen base sin tocar a la persona. */
export function souvenirPrompt(items: Array<{ prompt: string; slot: string }>, opts: { fixes?: string[] } = {}): string {
  const list = items
    .map((s, i) => `${i + 1}. ${s.prompt} — ${SLOT_PLACEMENT[s.slot] ?? SLOT_PLACEMENT.pin}`)
    .join("\n");
  return [
    opts.fixes?.length
      ? `A previous edit changed the person. Do not repeat that: ${opts.fixes.slice(0, 4).join("; ")}.`
      : "",
    `Edit this image. It is a person's official travel avatar. Keep the person EXACTLY identical: same face, features, skin tone, hair, facial hair, glasses, expression, age, pose, framing, art style, lighting and background. Do not redraw, retouch or re-render the face or hair. Never add a beard, mustache or stubble. Keep the square format.`,
    items.length
      ? `Only add these small, tasteful travel souvenirs, elegantly integrated at a realistic small scale, never covering the face or hair, nothing on the head:\n${list}`
      : `Remove any travel souvenirs (pins, charms, bracelets) and keep everything else identical.`,
    `Keep it premium and minimal: no other new objects, no text, no logos.`,
  ].filter(Boolean).join("\n\n");
}

/** Prompt del juez de parecido (modelo de visión). */
export function likenessPrompt(mode: "selfie" | "identidad"): string {
  const intro = mode === "selfie"
    ? `Image 1 is a real photo of a person. Image 2 is an illustrated avatar. Judge ONLY whether image 2 depicts the same person as image 1, the way a friend would recognize them, ignoring art style, outfit, accessories and background.`
    : `Image 1 is a person's illustrated avatar. Image 2 is an edited version of it. Judge ONLY whether the person is identical (face, hair, skin tone, facial hair, glasses, age), ignoring new small accessories.`;
  return `${intro}
Check: face shape, skin tone, hair (style, length, color, hairline), eyes and eyebrows, nose and mouth, facial hair, glasses, apparent age, gender presentation.
Answer ONLY with JSON: {"score": <integer 0-100>, "diferencias": [<up to 4 short phrases in Spanish naming the most important mismatches>]}
Scale: 90-100 unmistakably the same person; 70-89 clearly recognizable; 50-69 some resemblance; below 50 a different person.`;
}

/** Umbral: por debajo se reintenta una vez con correcciones. */
export const LIKENESS_THRESHOLD = 72;

export type Likeness = { score: number; diferencias: string[] };

/** Lee y valida la respuesta del juez. null si no es JSON válido con un score 0-100. */
export function parseLikeness(raw: unknown): Likeness | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    try { obj = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      try { obj = JSON.parse(m[0]); } catch { return null; }
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  const s = typeof o.score === "string" ? Number(o.score) : o.score;
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0 || s > 100) return null;
  const diferencias = Array.isArray(o.diferencias)
    ? o.diferencias.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map((d) => d.trim().slice(0, 120)).slice(0, 4)
    : [];
  return { score: Math.round(s), diferencias };
}

/** URL de la imagen en una respuesta de chat completions con modalities ["image"]. */
export function extractImageUrl(aiData: unknown): string | null {
  const msg = (aiData as any)?.choices?.[0]?.message;
  if (!msg) return null;
  const candidates: unknown[] = [];
  for (const img of Array.isArray(msg.images) ? msg.images : []) candidates.push(img?.image_url?.url ?? img?.url);
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) if (part?.type === "image_url") candidates.push(part?.image_url?.url);
  }
  for (const c of candidates) {
    if (typeof c === "string" && (/^data:image\/(png|jpeg|jpg|webp);base64,/.test(c) || /^https:\/\//.test(c))) return c;
  }
  return null;
}

/** data:image/...;base64 → bytes + tipo. null si no es una imagen válida. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string; ext: string } | null {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] === "image/jpg" ? "image/jpeg" : m[1];
  const bin = atob(m[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length < 100) return null;
  return { bytes, mime, ext: mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png" };
}

/** Bytes → data URL (para mandar la imagen base como referencia). */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Selfie aceptable: data URL JPEG/PNG/WebP de 2 KB a 4 MB (el cliente la reduce a 1024 px). */
export function validSelfie(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(v)) return false;
  const approxBytes = Math.floor((v.length - v.indexOf(",") - 1) * 0.75);
  return approxBytes >= 2_000 && approxBytes <= 4 * 1024 * 1024;
}
