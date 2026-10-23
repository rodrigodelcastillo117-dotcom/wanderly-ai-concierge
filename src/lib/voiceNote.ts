// Nota de voz del diario: qué motor usar, contador, permiso del micrófono y audio → WAV.
//
// Dos motores, el mejor que tenga el navegador:
//   "dictado"   Web Speech API (lo mismo que ya usa el micrófono de Concierge): Chrome y Edge en
//               computadora y Android. Gratis y con texto en vivo.
//   "grabacion" MediaRecorder + la función transcribir-nota (Gemini, ya configurado): Safari y
//               cualquier navegador en iPhone/iPad (su dictado web es poco confiable y no funciona
//               en la app de inicio), Firefox y los que no tienen Web Speech.
// En ambos casos el audio NO se guarda: solo queda el texto, que la persona revisa antes de "Agregar".

export type VoiceEngine = "dictado" | "grabacion" | "ninguno";
export const VOICE_MAX_SECONDS = 120;
export const VOICE_LANG = "es-MX";

export type VoiceEnv = { hasSpeech: boolean; hasRecorder: boolean; isIOS: boolean };

export function pickEngine(env: VoiceEnv): VoiceEngine {
  if (env.hasSpeech && !env.isIOS) return "dictado";
  if (env.hasRecorder) return "grabacion";
  if (env.hasSpeech) return "dictado";
  return "ninguno";
}

type Nav = { userAgent?: string; platform?: string; maxTouchPoints?: number; mediaDevices?: { getUserMedia?: unknown } };

/** iPhone, iPad (también el iPad que se presenta como Mac) o iPod. */
export function isIOSDevice(nav: Nav | undefined = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  if (!nav) return false;
  const ua = nav.userAgent ?? "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
}

export function isAndroidDevice(nav: Nav | undefined = typeof navigator !== "undefined" ? navigator : undefined): boolean {
  return /Android/i.test(nav?.userAgent ?? "");
}

/** Lo que tiene ESTE navegador. */
export function detectVoiceEnv(win: any = typeof window !== "undefined" ? window : undefined): VoiceEnv {
  const nav = win?.navigator as Nav | undefined;
  return {
    hasSpeech: !!(win?.SpeechRecognition || win?.webkitSpeechRecognition),
    hasRecorder: typeof win?.MediaRecorder === "function" && typeof nav?.mediaDevices?.getUserMedia === "function",
    isIOS: isIOSDevice(nav),
  };
}

/** "0:07", "1:30". */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const MIC_PROMPT_TEXT = "Permite el micrófono para dictar tu entrada. Solo lo usamos para pasar tu voz a texto; IATOS no guarda el audio.";

/** Cómo activar el micrófono si la persona lo bloqueó, según su dispositivo. */
export function micHelpText(nav: Nav | undefined = typeof navigator !== "undefined" ? navigator : undefined): string {
  if (isIOSDevice(nav)) {
    return "El micrófono está bloqueado. En tu iPhone: toca «aA» en la barra de Safari › Ajustes del sitio web › Micrófono › Permitir (o Ajustes › Safari › Micrófono). Luego toca de nuevo el micrófono.";
  }
  if (isAndroidDevice(nav)) {
    return "El micrófono está bloqueado. Toca el candado junto a la dirección › Permisos › Micrófono › Permitir. Luego toca de nuevo el micrófono.";
  }
  return "El micrófono está bloqueado. Haz clic en el candado junto a la dirección › Micrófono › Permitir y vuelve a tocar el micrófono.";
}

/** Une el texto dictado al borrador sin pisar lo que la persona ya escribió. */
export function appendTranscript(draft: string, text: string): string {
  const t = text.trim();
  if (!t) return draft;
  const d = draft.replace(/\s+$/, "");
  if (!d) return t.charAt(0).toUpperCase() + t.slice(1);
  const sep = /[.!?…]$/.test(d) ? " " : /[,;:]$/.test(d) ? " " : ". ";
  const next = sep === ". " ? t.charAt(0).toUpperCase() + t.slice(1) : t;
  return `${d}${sep}${next}`;
}

/** Tipo de grabación que acepta el navegador (Safari: audio/mp4; Chrome: audio/webm; Firefox: audio/ogg). */
export function pickRecorderMime(isSupported: ((m: string) => boolean) | undefined): string | undefined {
  if (!isSupported) return undefined;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"]) {
    try { if (isSupported(m)) return m; } catch { /* siguiente */ }
  }
  return undefined;
}

// ═══ audio → WAV 16 kHz mono (formato que cualquier modelo acepta) ═══

export const WAV_RATE = 16000;

/** Promedia canales y reduce la frecuencia (promedio por bloque). */
export function downmixResample(channels: Float32Array[], fromRate: number, toRate = WAV_RATE): Float32Array {
  const len = channels[0]?.length ?? 0;
  if (!len) return new Float32Array(0);
  const mono = new Float32Array(len);
  for (const ch of channels) for (let i = 0; i < len; i++) mono[i] += ch[i] / channels.length;
  if (fromRate <= toRate) return mono;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(len / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(len, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += mono[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** PCM 16 bits con cabecera RIFF/WAVE. */
export function encodeWav(samples: Float32Array, rate = WAV_RATE): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/**
 * Convierte la grabación a WAV 16 kHz mono. Si el navegador no puede decodificarla, devuelve la
 * grabación original (el servidor acepta webm/ogg/mp4 también).
 */
export async function toWavOrOriginal(blob: Blob, win: any = typeof window !== "undefined" ? window : undefined): Promise<{ blob: Blob; mime: string }> {
  const original = { blob, mime: (blob.type || "audio/webm").split(";")[0] };
  const Ctx = win?.AudioContext || win?.webkitAudioContext;
  if (!Ctx) return original;
  let ctx: any = null;
  try {
    const bytes = await blobBytes(blob);
    ctx = new Ctx();
    const audio: AudioBuffer = await new Promise((res, rej) => {
      const r = ctx.decodeAudioData(bytes, res, rej);
      if (r && typeof r.then === "function") r.then(res, rej);
    });
    const chans: Float32Array[] = [];
    for (let c = 0; c < audio.numberOfChannels; c++) chans.push(audio.getChannelData(c));
    const wav = encodeWav(downmixResample(chans, audio.sampleRate));
    return { blob: new Blob([wav], { type: "audio/wav" }), mime: "audio/wav" };
  } catch {
    return original;
  } finally {
    try { await ctx?.close?.(); } catch { /* nada */ }
  }
}

/** Bytes de un Blob (FileReader de respaldo: algunos navegadores viejos no tienen blob.arrayBuffer). */
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof (blob as any).arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as ArrayBuffer);
    r.onerror = () => rej(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** Base64 sin el prefijo data:. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blobBytes(blob));
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}
