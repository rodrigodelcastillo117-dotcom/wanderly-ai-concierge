import { useRef, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  onParsed: (summary: string, full: any) => void;
  size?: "sm" | "md";
};

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic";
const MAX_MB = 15;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.split(",")[1] ?? "");
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export function TripFileUpload({ onParsed, size = "md" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list).slice(0, 6);
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) {
        toast.error(`${f.name} pesa más de ${MAX_MB}MB`);
        return;
      }
    }
    setLoading(true);
    const tId = toast.loading("Leyendo tu viaje con IA…");
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({
          name: f.name,
          mime: f.type || "application/octet-stream",
          data_base64: await fileToBase64(f),
        })),
      );
      const { data, error } = await supabase.functions.invoke("parse-trip-file", {
        body: { files: payload },
      });
      if (error) throw error;
      if (!data?.ok || !data?.summary) throw new Error(data?.error ?? "No pudimos leer el archivo");
      toast.success("Viaje extraído", { id: tId });
      onParsed(data.summary, data);
    } catch (e: any) {
      toast.error(e.message ?? "Error procesando archivo", { id: tId });
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const dim = size === "sm" ? "h-8 w-8 md:h-9 md:w-9" : "h-10 w-10";
  const icon = size === "sm" ? "w-4 h-4" : "w-5 h-5";

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        aria-label="Adjuntar PDF o imagen del viaje"
        title="Adjuntar PDF o imagen del viaje"
        className={`${dim} shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-primary/10 hover:border-primary/30`}
      >
        {loading
          ? <Loader2 className={`${icon} animate-spin text-primary`} />
          : <Paperclip className={`${icon} text-primary`} />}
      </Button>
    </>
  );
}
