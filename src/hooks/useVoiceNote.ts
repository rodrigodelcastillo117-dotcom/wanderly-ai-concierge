// Grabar / detener una nota de voz y obtener el texto (src/lib/voiceNote.ts explica los motores).
import { useCallback, useEffect, useRef, useState } from "react";
import {
  blobToBase64, detectVoiceEnv, pickEngine, pickRecorderMime, toWavOrOriginal, VOICE_LANG, VOICE_MAX_SECONDS,
  type VoiceEngine,
} from "@/lib/voiceNote";

export type VoiceStatus = "idle" | "pidiendo" | "grabando" | "transcribiendo" | "denegado";

/** Transcribe audio en el servidor (transcribir-nota). Inyectable para pruebas. */
export type TranscribeFn = (audio: { base64: string; mime: string; seconds: number }) => Promise<string>;

type Options = {
  /** Texto final de la nota (se agrega al borrador para revisarlo). */
  onText: (text: string) => void;
  transcribe: TranscribeFn;
  onError?: (message: string) => void;
  maxSeconds?: number;
  /** Para pruebas: otra "ventana". */
  win?: any;
};

export function useVoiceNote({ onText, transcribe, onError, maxSeconds = VOICE_MAX_SECONDS, win }: Options) {
  const w = win ?? (typeof window !== "undefined" ? window : undefined);
  const [engine] = useState<VoiceEngine>(() => pickEngine(detectVoiceEnv(w)));
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [seconds, setSeconds] = useState(0);
  const [live, setLive] = useState("");
  /** La persona ya tocó el micrófono (para explicar el permiso bloqueado justo ahí). */
  const [attempted, setAttempted] = useState(false);

  const startedAt = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const rec = useRef<any>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  /** Frases finales de sesiones de dictado anteriores (Chrome reinicia tras un silencio). */
  const finals = useRef<string[]>([]);
  const unmounted = useRef(false);
  const wantStop = useRef(false);
  const restarts = useRef(0);
  const statusRef = useRef<VoiceStatus>("idle");
  const cb = useRef({ onText, transcribe, onError });
  cb.current = { onText, transcribe, onError };

  const set = (s: VoiceStatus) => { statusRef.current = s; setStatus(s); };
  const fail = (msg: string) => cb.current.onError?.(msg);

  const stopTimer = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };
  const startTimer = () => {
    startedAt.current = Date.now();
    setSeconds(0);
    stopTimer();
    timer.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(s);
      if (s >= maxSeconds) stopRef.current();
    }, 250);
  };
  const elapsed = () => Math.max(0, Math.round((Date.now() - startedAt.current) / 1000));
  const releaseStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  // Permiso ya bloqueado: el botón lo explica desde el inicio. Si la persona lo activa, se entera solo.
  useEffect(() => {
    const perms = w?.navigator?.permissions;
    if (!perms?.query) return;
    let st: any = null;
    let alive = true;
    perms.query({ name: "microphone" }).then((s: any) => {
      if (!alive) return;
      st = s;
      if (s.state === "denied" && statusRef.current === "idle") set("denegado");
      s.onchange = () => {
        if (s.state === "denied" && statusRef.current === "idle") set("denegado");
        if (s.state !== "denied" && statusRef.current === "denegado") set("idle");
      };
    }).catch(() => {});
    return () => { alive = false; if (st) st.onchange = null; };
  }, [w]);

  useEffect(() => () => {
    // Salir de la página no transcribe (ni cobra) lo que se estaba grabando.
    unmounted.current = true;
    stopTimer();
    try { rec.current?.abort?.(); } catch { /* nada */ }
    try { if (rec.current?.state === "recording") rec.current.stop(); } catch { /* nada */ }
    releaseStream();
  }, []);

  // ── Dictado (Web Speech API) ──
  const startDictado = () => {
    const SR = w?.SpeechRecognition || w?.webkitSpeechRecognition;
    const r = new SR();
    r.lang = VOICE_LANG;
    r.continuous = true;
    r.interimResults = true;
    finals.current = [];
    wantStop.current = false;
    restarts.current = 0;
    let interim = "";
    let session: string[] = [];
    const all = () => [...finals.current, ...session];
    r.onstart = () => {
      if (statusRef.current === "pidiendo") { set("grabando"); startTimer(); }
    };
    r.onresult = (e: any) => {
      // e.results trae TODA la sesión: se reconstruye en cada evento (sin duplicar frases).
      interim = "";
      session = [];
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        const t = String(res[0]?.transcript ?? "").trim();
        if (!t) continue;
        if (res.isFinal) session.push(t);
        else interim += `${interim ? " " : ""}${t}`;
      }
      setLive([...all(), interim].filter(Boolean).join(" "));
    };
    r.onerror = (e: any) => {
      const err = e?.error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        wantStop.current = true;
        stopTimer(); set("denegado"); setLive("");
        return;
      }
      if (err === "audio-capture") { wantStop.current = true; fail("No encontramos un micrófono en este dispositivo."); }
      else if (err === "network") { wantStop.current = true; fail("El dictado necesita internet. Revisa tu conexión."); }
    };
    r.onend = () => {
      // Chrome corta el dictado tras un silencio: si la persona no lo detuvo, sigue grabando.
      if (unmounted.current) return;
      if (!wantStop.current && statusRef.current === "grabando" && restarts.current < 30) {
        restarts.current++;
        finals.current = all();
        session = [];
        try { r.start(); return; } catch { /* termina abajo */ }
      }
      stopTimer();
      const text = all().join(" ").replace(/\s+/g, " ").trim() || interim.trim();
      rec.current = null;
      setLive("");
      if (statusRef.current !== "denegado") set("idle");
      if (text) cb.current.onText(text);
      else if (statusRef.current !== "denegado" && wantStop.current) fail("No escuchamos nada. Intenta de nuevo, cerca del micrófono.");
    };
    rec.current = r;
    set("pidiendo");
    try { r.start(); } catch { set("idle"); fail("No se pudo iniciar el micrófono."); }
  };

  // ── Grabación + transcripción en el servidor ──
  const startGrabacion = async () => {
    set("pidiendo");
    let s: MediaStream;
    try {
      s = await w.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e: any) {
      const name = e?.name;
      if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") { set("denegado"); return; }
      set("idle");
      fail(name === "NotFoundError" || name === "DevicesNotFoundError" ? "No encontramos un micrófono en este dispositivo." : "No se pudo usar el micrófono.");
      return;
    }
    stream.current = s;
    const mime = pickRecorderMime(w.MediaRecorder?.isTypeSupported?.bind(w.MediaRecorder));
    let r: any;
    try {
      r = mime ? new w.MediaRecorder(s, { mimeType: mime }) : new w.MediaRecorder(s);
    } catch {
      releaseStream(); set("idle"); fail("Tu navegador no puede grabar audio."); return;
    }
    chunks.current = [];
    r.ondataavailable = (e: any) => { if (e.data && e.data.size) chunks.current.push(e.data); };
    r.onstop = async () => {
      stopTimer();
      releaseStream();
      if (unmounted.current) { chunks.current = []; return; }
      const secs = elapsed();
      const type = r.mimeType || mime || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];
      rec.current = null;
      if (!blob.size) { set("idle"); fail("No se grabó nada. Intenta de nuevo."); return; }
      set("transcribiendo");
      try {
        const audio = await toWavOrOriginal(blob, w);
        const text = (await cb.current.transcribe({ base64: await blobToBase64(audio.blob), mime: audio.mime, seconds: secs })).trim();
        set("idle");
        if (text) cb.current.onText(text);
        else fail("No escuchamos nada. Intenta de nuevo, cerca del micrófono.");
      } catch (e: any) {
        set("idle");
        fail(e?.message || "No pudimos pasar tu nota a texto. Intenta de nuevo o escríbela.");
      }
    };
    rec.current = r;
    r.start(1000);
    set("grabando");
    startTimer();
  };

  const stop = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    wantStop.current = true;
    try { r.stop(); } catch { /* ya se detuvo */ }
  }, []);
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(() => {
    if (statusRef.current === "grabando" || statusRef.current === "pidiendo" || statusRef.current === "transcribiendo") return;
    setAttempted(true);
    if (engine === "ninguno") { fail("Tu navegador no permite notas de voz. Escribe tu entrada."); return; }
    setLive("");
    if (engine === "dictado") startDictado();
    else void startGrabacion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine]);

  const toggle = useCallback(() => {
    if (statusRef.current === "grabando") stop();
    else start();
  }, [start, stop]);

  return { engine, status, seconds, maxSeconds, live, attempted, start, stop, toggle };
}
