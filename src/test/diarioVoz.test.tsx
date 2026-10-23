// Diario de viaje: nota de voz (grabar, detener, contador, transcribir, permisos) y "IATOS aprendió
// de tu viaje" en la página (aprender en segundo plano, mostrar, corregir y borrar cada punto).
// Micrófono, MediaRecorder, Web Speech API y las funciones del servidor van simulados.
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendTranscript, downmixResample, encodeWav, formatTimer, isIOSDevice, micHelpText, pickEngine, pickRecorderMime,
  VOICE_MAX_SECONDS,
} from "@/lib/voiceNote";

const TRIP = "22222222-2222-4222-8222-222222222222";
const ME = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  invokes: [] as Array<{ name: string; body: any }>,
  inserts: [] as Array<{ table: string; row: any }>,
  deletes: [] as Array<{ table: string; id: string }>,
  updates: [] as Array<{ table: string; patch: any; id: string }>,
  learnings: [] as any[],
  transcript: "Me encantó la cacio e pepe de Roscioli",
  transcribeError: null as null | string,
  learnResult: [] as any[],
  toasts: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    const rows = table === "trips" ? [{ id: "22222222-2222-4222-8222-222222222222", destino: "Roma", user_id: "11111111-1111-4111-8111-111111111111" }]
      : table === "journal_learnings" ? h.learnings : [];
    const api: any = {
      select: () => api, eq: () => api, order: () => api, limit: () => api,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      insert: (row: any) => {
        h.inserts.push({ table, row });
        return { select: () => ({ single: async () => ({ data: { id: "33333333-3333-4333-8333-333333333333", created_at: new Date().toISOString(), ...row }, error: null }) }) };
      },
      delete: () => ({ eq: async (_c: string, id: string) => { h.deletes.push({ table, id }); return { error: null }; } }),
      update: (patch: any) => ({ eq: async (_c: string, id: string) => { h.updates.push({ table, patch, id }); return { error: null }; } }),
      then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  };
  return {
    supabase: {
      from,
      storage: { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) },
      functions: {
        invoke: async (name: string, opts: any) => {
          h.invokes.push({ name, body: opts?.body });
          if (name === "transcribir-nota") {
            if (h.transcribeError) return { data: null, error: { message: "x", context: { json: async () => ({ error: h.transcribeError }) } } };
            return { data: { text: h.transcript }, error: null };
          }
          if (name === "aprender-diario") return { data: { ok: true, status: "done", learnings: h.learnResult }, error: null };
          return { data: null, error: null };
        },
      },
      auth: { getUser: async () => ({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } }) },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" }, loading: false }) }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/Tooltip", () => ({ FeatureTooltip: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: (m: string) => h.toasts.push(m) } }));

import TripJournal from "@/pages/TripJournal";

// ── Simuladores del navegador ──
class FakeRecorder {
  static last: FakeRecorder | null = null;
  static isTypeSupported = (m: string) => m === "audio/webm;codecs=opus";
  state = "inactive";
  mimeType: string;
  ondataavailable: ((e: any) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: any, opts?: { mimeType?: string }) { this.mimeType = opts?.mimeType ?? "audio/webm"; FakeRecorder.last = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000).fill(7)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeSpeech {
  static last: FakeSpeech | null = null;
  lang = ""; continuous = false; interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  constructor() { FakeSpeech.last = this; }
  start() { this.started++; setTimeout(() => this.onstart?.(), 0); }
  stop() { setTimeout(() => this.onend?.(), 0); }
  abort() {}
  say(final: string[], interim = "") {
    const results: any[] = final.map((t) => Object.assign([{ transcript: t }], { isFinal: true }));
    if (interim) results.push(Object.assign([{ transcript: interim }], { isFinal: false }));
    this.onresult?.({ resultIndex: 0, results });
  }
}

const tracks: Array<{ stop: ReturnType<typeof vi.fn> }> = [];
const w = window as any;
const nav = navigator as any;
let now = 1_700_000_000_000;

function setupRecorder(getUserMedia?: () => Promise<any>) {
  delete w.SpeechRecognition; delete w.webkitSpeechRecognition;
  w.MediaRecorder = FakeRecorder;
  Object.defineProperty(nav, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(getUserMedia ?? (async () => {
        const t = { stop: vi.fn() };
        tracks.push(t);
        return { getTracks: () => [t] };
      })),
    },
  });
}
function setupSpeech() {
  w.webkitSpeechRecognition = FakeSpeech;
  delete w.MediaRecorder;
}

beforeEach(() => {
  h.invokes = []; h.inserts = []; h.deletes = []; h.updates = []; h.learnings = []; h.learnResult = []; h.toasts = [];
  h.transcript = "Me encantó la cacio e pepe de Roscioli"; h.transcribeError = null;
  FakeRecorder.last = null; FakeSpeech.last = null; tracks.length = 0;
  now = 1_700_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  Object.defineProperty(nav, "permissions", { configurable: true, value: undefined });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete w.SpeechRecognition; delete w.webkitSpeechRecognition; delete w.MediaRecorder;
});

const renderJournal = () => render(
  <MemoryRouter initialEntries={[`/dashboard/viajes/${TRIP}/diario`]}>
    <Routes><Route path="/dashboard/viajes/:id/diario" element={<TripJournal />} /></Routes>
  </MemoryRouter>,
);
const box = () => screen.getByLabelText("Entrada del diario") as HTMLTextAreaElement;

describe("nota de voz: reglas puras", () => {
  it("elige dictado en Chrome/Android, grabación + servidor en iPhone y Firefox, y nada sin soporte", () => {
    expect(pickEngine({ hasSpeech: true, hasRecorder: true, isIOS: false })).toBe("dictado");
    expect(pickEngine({ hasSpeech: true, hasRecorder: true, isIOS: true })).toBe("grabacion");
    expect(pickEngine({ hasSpeech: false, hasRecorder: true, isIOS: false })).toBe("grabacion");
    expect(pickEngine({ hasSpeech: true, hasRecorder: false, isIOS: true })).toBe("dictado");
    expect(pickEngine({ hasSpeech: false, hasRecorder: false, isIOS: false })).toBe("ninguno");
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
    expect(isIOSDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe(false);
  });

  it("contador, unión con el borrador y tipo de grabación", () => {
    expect(formatTimer(0)).toBe("0:00");
    expect(formatTimer(7.9)).toBe("0:07");
    expect(formatTimer(VOICE_MAX_SECONDS)).toBe("2:00");
    expect(appendTranscript("", "me encantó roma")).toBe("Me encantó roma");
    expect(appendTranscript("Día 2", "me encantó roma")).toBe("Día 2. Me encantó roma");
    expect(appendTranscript("Día 2.", "comimos pasta")).toBe("Día 2. comimos pasta");
    expect(appendTranscript("Hola", "  ")).toBe("Hola");
    expect(pickRecorderMime((m) => m === "audio/mp4")).toBe("audio/mp4");
    expect(pickRecorderMime(undefined)).toBeUndefined();
  });

  it("WAV 16 kHz mono con cabecera RIFF correcta", () => {
    const left = new Float32Array(48000).fill(0.5);
    const right = new Float32Array(48000).fill(-0.5);
    const mono = downmixResample([left, right], 48000);
    expect(mono.length).toBe(16000);
    expect(Math.abs(mono[100])).toBeLessThan(1e-6);
    const wav = encodeWav(new Float32Array([0, 1, -1]));
    const txt = String.fromCharCode(...wav.slice(0, 4)) + String.fromCharCode(...wav.slice(8, 12));
    expect(txt).toBe("RIFFWAVE");
    const v = new DataView(wav.buffer);
    expect(v.getUint32(24, true)).toBe(16000);
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getInt16(46, true)).toBe(0x7fff);
    expect(wav.length).toBe(44 + 6);
  });

  it("explica cómo activar el micrófono según el dispositivo", () => {
    expect(micHelpText({ userAgent: "iPhone" })).toMatch(/Safari.*Micrófono.*Permitir/);
    expect(micHelpText({ userAgent: "Linux; Android 14" })).toMatch(/candado.*Permisos.*Micrófono/);
    expect(micHelpText({ userAgent: "Windows NT 10.0" })).toMatch(/candado.*Micrófono.*Permitir/);
  });
});

describe("nota de voz en el diario (grabación + transcripción en el servidor)", () => {
  it("grabar → contador visible → detener → transcribe en español y queda en el cuadro para revisar", async () => {
    setupRecorder();
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.change(box(), { target: { value: "Día 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await screen.findByTestId("voice-timer");
    expect(screen.getByTestId("voice-timer").textContent).toBe("0:00 / 2:00");
    expect(screen.getByRole("button", { name: /Agregar/ })).toBeDisabled(); // no se agrega a medio grabar
    now += 7_400;
    await waitFor(() => expect(screen.getByTestId("voice-timer").textContent).toBe("0:07 / 2:00"));
    fireEvent.click(screen.getByRole("button", { name: /Detener grabación \(0:07\)/ }));
    await waitFor(() => expect(box().value).toBe("Día 3. Me encantó la cacio e pepe de Roscioli"));
    const call = h.invokes.find((i) => i.name === "transcribir-nota")!;
    expect(call.body.mime).toBe("audio/webm"); // sin AudioContext (jsdom) se manda la grabación original
    expect(call.body.seconds).toBe(7);
    expect(call.body.audio_base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(tracks[0].stop).toHaveBeenCalled(); // se apaga el micrófono
    expect(h.inserts).toHaveLength(0); // solo se agrega cuando la persona toca "Agregar"
    expect(screen.getByRole("button", { name: /Agregar/ })).not.toBeDisabled();
  });

  it("se detiene sola a los 2 minutos", async () => {
    setupRecorder();
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await screen.findByTestId("voice-timer");
    now += (VOICE_MAX_SECONDS + 1) * 1000;
    await waitFor(() => expect(box().value).toBe("Me encantó la cacio e pepe de Roscioli"));
    expect(h.invokes.find((i) => i.name === "transcribir-nota")!.body.seconds).toBe(VOICE_MAX_SECONDS + 1);
  });

  it("mientras pide permiso explica para qué es el micrófono", async () => {
    let allow!: (v: any) => void;
    setupRecorder(() => new Promise((r) => { allow = r; }));
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    expect(await screen.findByText(/Permite el micrófono para dictar tu entrada.*no guarda el audio/)).toBeInTheDocument();
    await act(async () => { allow({ getTracks: () => [] }); });
    await screen.findByTestId("voice-timer");
  });

  it("si niega el permiso, el botón explica cómo activarlo y no se rompe nada", async () => {
    setupRecorder(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); });
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    const btn = await screen.findByRole("button", { name: "Micrófono bloqueado: cómo activarlo" });
    expect(screen.getByRole("status").textContent).toMatch(/El micrófono está bloqueado/);
    expect(h.invokes).toHaveLength(0);
    fireEvent.change(box(), { target: { value: "Lo escribo" } });
    expect(screen.getByRole("button", { name: /Agregar/ })).not.toBeDisabled();
    expect(btn).not.toBeDisabled(); // tocar otra vez reintenta (por si ya lo activó)
  });

  it("si el permiso ya estaba bloqueado, se nota desde el inicio", async () => {
    setupRecorder();
    Object.defineProperty(nav, "permissions", { configurable: true, value: { query: async () => ({ state: "denied", onchange: null }) } });
    renderJournal();
    await screen.findByRole("button", { name: "Micrófono bloqueado: cómo activarlo" });
  });

  it("sin micrófono o si el servidor falla, avisa con un mensaje claro y deja escribir", async () => {
    setupRecorder(async () => { throw Object.assign(new Error("none"), { name: "NotFoundError" }); });
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await waitFor(() => expect(h.toasts).toContain("No encontramos un micrófono en este dispositivo."));
    expect(screen.getByRole("button", { name: "Grabar nota de voz" })).toBeInTheDocument();
  });

  it("error del servidor al transcribir: mensaje del servidor y el borrador queda igual", async () => {
    setupRecorder();
    h.transcribeError = "La nota es muy larga: máximo 2 minutos.";
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.change(box(), { target: { value: "Borrador" } });
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await screen.findByTestId("voice-timer");
    fireEvent.click(screen.getByRole("button", { name: /Detener grabación/ }));
    await waitFor(() => expect(h.toasts).toContain("La nota es muy larga: máximo 2 minutos."));
    expect(box().value).toBe("Borrador");
  });
});

describe("nota de voz en el diario (dictado del navegador, Web Speech API)", () => {
  it("dicta en es-MX, muestra lo que va oyendo y al detener lo deja en el cuadro (sin llamar al servidor)", async () => {
    setupSpeech();
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await screen.findByTestId("voice-timer");
    const sr = FakeSpeech.last!;
    expect(sr.lang).toBe("es-MX");
    expect(sr.continuous).toBe(true);
    act(() => sr.say(["No me gustaron las filas del Vaticano."], "prefiero caminar"));
    expect(await screen.findByText(/“No me gustaron las filas del Vaticano\. prefiero caminar”/)).toBeInTheDocument();
    act(() => sr.say(["No me gustaron las filas del Vaticano.", "Prefiero caminar de noche."]));
    fireEvent.click(screen.getByRole("button", { name: /Detener grabación/ }));
    await waitFor(() => expect(box().value).toBe("No me gustaron las filas del Vaticano. Prefiero caminar de noche."));
    expect(h.invokes.filter((i) => i.name === "transcribir-nota")).toHaveLength(0);
  });

  it("si Chrome corta tras un silencio, sigue grabando hasta que la persona lo detiene", async () => {
    setupSpeech();
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    await screen.findByTestId("voice-timer");
    const sr = FakeSpeech.last!;
    act(() => sr.onend?.());
    expect(sr.started).toBe(2);
    expect(screen.getByTestId("voice-timer")).toBeInTheDocument();
  });

  it("permiso negado en el dictado: explica cómo activarlo", async () => {
    setupSpeech();
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.click(screen.getByRole("button", { name: "Grabar nota de voz" }));
    const sr = FakeSpeech.last!;
    act(() => { sr.onerror?.({ error: "not-allowed" }); sr.onend?.(); });
    await screen.findByRole("button", { name: "Micrófono bloqueado: cómo activarlo" });
    expect(screen.getByRole("status").textContent).toMatch(/candado/);
  });
});

describe("IATOS aprendió de tu viaje (en el diario)", () => {
  const L = (over: any = {}) => ({
    id: "l1", entry_id: "e0", trip_id: TRIP, categoria: "comida", sentimiento: "positivo",
    texto: "Te encantó la cacio e pepe de Roscioli", lugar: "Roscioli", ciudad: "Roma", cita: "Me encantó la cacio e pepe", created_at: "2026-10-20T10:00:00Z", ...over,
  });

  it("al agregar, aprende en segundo plano (sin bloquear) y muestra lo aprendido", async () => {
    setupRecorder();
    h.learnResult = [L({ id: "n1", entry_id: "33333333-3333-4333-8333-333333333333" }), L({ id: "n2", entry_id: "33333333-3333-4333-8333-333333333333", sentimiento: "negativo", texto: "No te gustaron las filas del Vaticano", lugar: "Vaticano", categoria: "lugar" })];
    renderJournal();
    await screen.findByText("Roma");
    expect(screen.queryByText("IATOS aprendió de tu viaje")).toBeNull(); // sin nada aprendido no estorba
    fireEvent.change(box(), { target: { value: "Me encantó la cacio e pepe de Roscioli. No me gustaron las filas del Vaticano." } });
    fireEvent.click(screen.getByRole("button", { name: /Agregar/ }));
    await waitFor(() => expect(h.inserts).toHaveLength(1));
    expect(h.inserts[0].row).toMatchObject({ author_id: ME, trip_id: TRIP });
    expect(box().value).toBe(""); // la entrada se guardó sin esperar a la IA
    await screen.findByText("Te encantó la cacio e pepe de Roscioli");
    expect(screen.getByText("No te gustaron las filas del Vaticano")).toBeInTheDocument();
    expect(h.invokes.find((i) => i.name === "aprender-diario")!.body).toEqual({ entry_id: "33333333-3333-4333-8333-333333333333" });
    expect(screen.getByText(/Solo tú lo ves/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Lo que te gustó" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Lo que no te gustó" })).toBeInTheDocument();
  });

  it("si la entrada no dice nada útil, no aparece nada aprendido", async () => {
    setupRecorder();
    h.learnResult = [];
    renderJournal();
    await screen.findByText("Roma");
    fireEvent.change(box(), { target: { value: "Llegamos al hotel" } });
    fireEvent.click(screen.getByRole("button", { name: /Agregar/ }));
    await waitFor(() => expect(h.invokes.some((i) => i.name === "aprender-diario")).toBe(true));
    await waitFor(() => expect(screen.queryByText("IATOS aprendió de tu viaje")).toBeNull());
  });

  it("muestra lo aprendido antes, y se puede borrar cada punto y corregir su texto", async () => {
    setupRecorder();
    h.learnings = [L(), L({ id: "l2", sentimiento: "negativo", texto: "Evitas las filas largas", lugar: null, categoria: "ambiente" })];
    renderJournal();
    await screen.findByText("Te encantó la cacio e pepe de Roscioli");
    fireEvent.click(screen.getByRole("button", { name: "Borrar: Evitas las filas largas" }));
    await waitFor(() => expect(screen.queryByText("Evitas las filas largas")).toBeNull());
    expect(h.deletes).toEqual([{ table: "journal_learnings", id: "l2" }]);

    fireEvent.click(screen.getByRole("button", { name: "Corregir: Te encantó la cacio e pepe de Roscioli" }));
    fireEvent.change(screen.getByLabelText("Corregir lo aprendido"), { target: { value: "Te encantó Roscioli" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await screen.findByText("Te encantó Roscioli");
    expect(h.updates).toEqual([{ table: "journal_learnings", patch: { texto: "Te encantó Roscioli" }, id: "l1" }]);
  });
});
