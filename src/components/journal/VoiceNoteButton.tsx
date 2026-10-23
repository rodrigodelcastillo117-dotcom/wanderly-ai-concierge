// Nota de voz del diario: tocar para grabar, tocar otra vez para detener; contador visible.
// El texto se agrega al cuadro de la entrada para que la persona lo revise o edite antes de "Agregar".
import { Loader2, Mic, MicOff, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTimer, MIC_PROMPT_TEXT, micHelpText } from "@/lib/voiceNote";
import type { useVoiceNote } from "@/hooks/useVoiceNote";

type Voice = ReturnType<typeof useVoiceNote>;

export function VoiceNoteButton({ voice }: { voice: Voice }) {
  if (voice.engine === "ninguno") return null;
  const { status, seconds, maxSeconds } = voice;
  const recording = status === "grabando";
  const denied = status === "denegado";

  const label = recording ? `Detener grabación (${formatTimer(seconds)})`
    : status === "transcribiendo" ? "Pasando tu nota a texto"
    : status === "pidiendo" ? "Esperando permiso del micrófono"
    : denied ? "Micrófono bloqueado: cómo activarlo"
    : "Grabar nota de voz";

  return (
    <button
      type="button"
      onClick={voice.toggle}
      disabled={status === "transcribiendo"}
      aria-label={label}
      aria-pressed={recording}
      title={label}
      className={cn(
        "inline-flex items-center gap-2 text-sm rounded-full transition",
        recording
          ? "px-3 py-1 -my-1 bg-destructive/15 text-destructive border border-destructive/40"
          : denied ? "text-muted-foreground/70 hover:text-primary" : "text-muted-foreground hover:text-primary",
      )}
    >
      {recording ? (
        <>
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-60 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          <Square className="w-3 h-3 fill-current" aria-hidden="true" />
          <span className="tabular-nums" data-testid="voice-timer">{formatTimer(seconds)}<span className="opacity-60"> / {formatTimer(maxSeconds)}</span></span>
        </>
      ) : status === "transcribiendo" ? (
        <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Pasando a texto…</>
      ) : status === "pidiendo" ? (
        <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Voz</>
      ) : (
        <>{denied ? <MicOff className="w-4 h-4" aria-hidden="true" /> : <Mic className="w-4 h-4" aria-hidden="true" />} Voz</>
      )}
    </button>
  );
}

/** Línea de ayuda bajo los botones: permiso, cómo activarlo si se bloqueó, o lo que se va oyendo. */
export function VoiceNoteStatus({ voice }: { voice: Voice }) {
  if (voice.engine === "ninguno") return null;
  const { status } = voice;
  const denied = status === "denegado" && voice.attempted;
  const text = status === "pidiendo" ? MIC_PROMPT_TEXT
    : denied ? micHelpText()
    : status === "grabando" ? (voice.live ? `“${voice.live}”` : voice.engine === "grabacion" ? "Grabando… toca el botón para terminar y pasarlo a texto." : "Te escucho… toca el botón para terminar.")
    : "";
  if (!text) return null;
  return (
    <p role="status" className={cn("text-xs leading-snug", denied ? "text-destructive" : "text-muted-foreground", status === "grabando" && voice.live && "italic")}>
      {text}
    </p>
  );
}

export default VoiceNoteButton;
