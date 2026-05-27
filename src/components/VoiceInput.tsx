import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  onTranscript: (text: string) => void;
  lang?: string;
  className?: string;
  size?: "sm" | "md";
};

// Web Speech API recognizer (built-in browser, sin API key).
export function VoiceInput({ onTranscript, lang = "es-MX", className, size = "md" }: Props) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const SR: any =
      (typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setSupported(false);
      return;
    }
    const r = new SR();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e: any) => {
      const text = Array.from(e.results)
        .map((x: any) => x[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (text) onTranscript(text);
    };
    r.onerror = (e: any) => {
      if (e?.error === "not-allowed") toast.error("Activa el micrófono para usar voz");
      else if (e?.error !== "no-speech" && e?.error !== "aborted") toast.error("Error con el micrófono");
      setListening(false);
    };
    r.onend = () => setListening(false);
    recRef.current = r;
    return () => {
      try { r.abort(); } catch {}
    };
  }, [lang, onTranscript]);

  const toggle = () => {
    const r = recRef.current;
    if (!r) return;
    if (listening) {
      try { r.stop(); } catch {}
      setListening(false);
      return;
    }
    try {
      r.start();
      setListening(true);
    } catch {
      // si ya está escuchando: ignorar
    }
  };

  if (!supported) return null;

  const dim = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const icon = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={listening ? "Detener grabación" : "Buscar con voz"}
      title={listening ? "Detener" : "Buscar con voz"}
      className={cn(
        "shrink-0 rounded-full flex items-center justify-center border transition",
        dim,
        listening
          ? "bg-primary/20 border-primary text-primary animate-pulse"
          : "bg-white/[0.04] border-white/10 text-primary/80 hover:text-primary hover:border-primary/40",
        className,
      )}
    >
      {listening ? <MicOff className={icon} /> : <Mic className={icon} />}
    </button>
  );
}

export default VoiceInput;
