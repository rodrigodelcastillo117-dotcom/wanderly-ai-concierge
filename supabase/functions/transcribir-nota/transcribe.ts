// Reglas de la nota de voz del diario → texto (transcribir-nota). Lógica pura, sin Deno.
//
// Se usa solo cuando el navegador no tiene dictado propio confiable (Safari/iPhone, Firefox): el
// navegador graba, convierte a WAV (16 kHz, mono) y manda el audio; aquí se transcribe con Gemini
// (el mismo proveedor de IA ya configurado, vía _shared/ai.ts) y se devuelve SOLO el texto. El audio
// no se guarda en ningún lado.

export const TRANSCRIBE_MODEL = "google/gemini-flash-latest";
/** Duración máxima de una nota (el botón se detiene solo al llegar). */
export const MAX_SECONDS = 120;
/** 2 min de WAV 16 kHz mono 16 bits ≈ 3.8 MB; con margen para otros formatos. */
export const MAX_AUDIO_BYTES = 4_500_000;
export const NO_SPEECH = "(sin voz)";

const FORMATS: Array<[RegExp, string]> = [
  [/^audio\/(x-)?wav|^audio\/wave/, "wav"],
  [/^audio\/(mpeg|mp3)/, "mp3"],
  [/^audio\/webm/, "webm"],
  [/^audio\/ogg/, "ogg"],
  [/^audio\/(mp4|m4a|x-m4a|aac)/, "mp4"],
  [/^audio\/flac/, "flac"],
];

/** Formato para `input_audio.format` según el tipo MIME; null si no es audio que aceptemos. */
export function audioFormat(mime: unknown): string | null {
  const m = String(mime ?? "").toLowerCase().trim();
  for (const [re, f] of FORMATS) if (re.test(m)) return f;
  return null;
}

/** Bytes que representa un texto base64 (sin decodificarlo); null si no es base64 válido. */
export function base64Bytes(b64: unknown): number | null {
  if (typeof b64 !== "string" || !b64.length) return null;
  if (b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

export type TranscribeInput = { audio_base64?: unknown; mime?: unknown; seconds?: unknown };
export type Checked = { ok: true; data: string; format: string; bytes: number } | { ok: false; error: string; status: number };

export function checkInput(body: TranscribeInput | null): Checked {
  const format = audioFormat(body?.mime);
  if (!format) return { ok: false, status: 400, error: "Formato de audio no compatible." };
  const bytes = base64Bytes(body?.audio_base64);
  if (bytes === null || bytes < 1000) return { ok: false, status: 400, error: "No recibimos audio. Graba de nuevo." };
  if (bytes > MAX_AUDIO_BYTES) return { ok: false, status: 413, error: "La nota es muy larga: máximo 2 minutos." };
  const secs = Number(body?.seconds);
  if (Number.isFinite(secs) && secs > MAX_SECONDS + 5) return { ok: false, status: 413, error: "La nota es muy larga: máximo 2 minutos." };
  return { ok: true, data: body!.audio_base64 as string, format, bytes };
}

export const TRANSCRIBE_SYSTEM = `Transcribe la nota de voz tal cual, en español (de México si aplica), con puntuación y mayúsculas correctas.
- Devuelve SOLO el texto dicho: sin comillas, sin títulos, sin comentarios, sin resumir ni traducir.
- Conserva nombres propios de lugares y platillos como se escuchan.
- Si no hay voz o no se entiende nada, responde exactamente: ${NO_SPEECH}`;

export function transcribeBody(data: string, format: string) {
  return {
    model: TRANSCRIBE_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: TRANSCRIBE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe esta nota de voz de mi diario de viaje." },
          { type: "input_audio", input_audio: { data, format } },
        ],
      },
    ],
  };
}

/** Texto final: sin prefijos tipo "Transcripción:", sin comillas envolventes; "" si no hubo voz. */
export function cleanTranscript(content: unknown): string {
  let s = String(content ?? "")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .trim();
  s = s.replace(/^(transcripci[oó]n|texto)\s*:\s*/i, "").trim();
  s = s.replace(/^["“«']+|["”»']+$/g, "").trim();
  if (!s || s.toLowerCase().includes(NO_SPEECH) || /^\(?(sin voz|silencio|no se entiende)\)?\.?$/i.test(s)) return "";
  return s.slice(0, 4000);
}
