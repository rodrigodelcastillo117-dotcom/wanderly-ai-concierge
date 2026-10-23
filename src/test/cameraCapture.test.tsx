// Cámara en la computadora (getUserMedia simulado): vista previa, tomar, repetir y usar; sin permiso o
// sin cámara se dice claro y se ofrece la galería. En el celular se usa el input con capture.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

import { CameraDialog, isMobileCaptureDevice, cameraErrorKind, useCameraCapture } from "@/components/camera/CameraCapture";
import AvatarCreator from "@/components/AvatarCreator";

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] } as unknown as MediaStream;

beforeEach(() => {
  track.stop.mockClear();
  // jsdom no tiene video ni canvas reales.
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", { configurable: true, get: () => 480 });
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({ drawImage: vi.fn() }) as never);
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) { cb(new Blob(["jpeg"], { type: "image/jpeg" })); };
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:foto");
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe("¿celular o computadora?", () => {
  it("reconoce celulares y iPad (que se presenta como Mac)", () => {
    expect(isMobileCaptureDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" })).toBe(true);
    expect(isMobileCaptureDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile" })).toBe(true);
    expect(isMobileCaptureDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 })).toBe(true);
    expect(isMobileCaptureDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 0 })).toBe(false);
    expect(isMobileCaptureDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
    expect(cameraErrorKind({ name: "NotAllowedError" })).toBe("permiso");
    expect(cameraErrorKind({ name: "NotFoundError" })).toBe("sin_camara");
  });
});

describe("diálogo de cámara (computadora)", () => {
  it("vista previa en vivo → Tomar foto → Repetir → Usar esta foto; apaga la cámara al cerrar", async () => {
    const gum = vi.fn(async () => stream);
    const onCapture = vi.fn();
    const onOpenChange = vi.fn();
    const { rerender } = render(<CameraDialog open onOpenChange={onOpenChange} facing="user" onCapture={onCapture} getUserMedia={gum} />);
    await waitFor(() => expect(gum).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: "user" }), audio: false })));
    const preview = screen.getByTestId("camera-preview") as HTMLVideoElement;
    await waitFor(() => expect(preview.srcObject).toBe(stream));
    const shoot = screen.getByRole("button", { name: /Tomar foto/ });
    await waitFor(() => expect(shoot).not.toBeDisabled());
    fireEvent.click(shoot);
    expect(await screen.findByAltText("Foto tomada")).toHaveAttribute("src", "blob:foto");
    fireEvent.click(screen.getByRole("button", { name: /Repetir/ }));
    expect(screen.getByTestId("camera-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Tomar foto/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Usar esta foto/ }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    const file = onCapture.mock.calls[0][0] as File;
    expect(file.type).toBe("image/jpeg");
    expect(file.name).toMatch(/^foto-\d+\.jpg$/);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<CameraDialog open={false} onOpenChange={onOpenChange} facing="user" onCapture={onCapture} getUserMedia={gum} />);
    expect(track.stop).toHaveBeenCalled();
  });

  it("sin permiso: lo dice claro y ofrece «Elegir de mi galería»", async () => {
    const gum = vi.fn(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); });
    const onPickGallery = vi.fn();
    render(<CameraDialog open onOpenChange={() => {}} onCapture={() => {}} onPickGallery={onPickGallery} getUserMedia={gum} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/No diste permiso para usar la cámara/);
    fireEvent.click(screen.getByRole("button", { name: /Elegir de mi galería/ }));
    expect(onPickGallery).toHaveBeenCalled();
  });

  it("sin cámara: lo dice y no ofrece reintentar", async () => {
    const gum = vi.fn(async () => { throw Object.assign(new Error("none"), { name: "NotFoundError" }); });
    render(<CameraDialog open onOpenChange={() => {}} onCapture={() => {}} onPickGallery={() => {}} getUserMedia={gum} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/No encontramos una cámara/);
    expect(screen.queryByRole("button", { name: /Intentar de nuevo/ })).toBeNull();
  });

  it("navegador sin getUserMedia: «no puede usar la cámara» y galería", async () => {
    const md = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<CameraDialog open onOpenChange={() => {}} onCapture={() => {}} onPickGallery={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/no puede usar la cámara/);
    if (md) Object.defineProperty(navigator, "mediaDevices", md); else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  });
});

function Harness({ mobile, onClickInput }: { mobile: boolean; onClickInput: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const cam = useCameraCapture({ inputRef: ref, onFile: () => {}, isMobile: mobile });
  return (
    <>
      <button type="button" onClick={cam.openCamera}>abrir</button>
      <input ref={ref} type="file" capture="user" aria-label="input" onClick={onClickInput} />
      {cam.dialog}
    </>
  );
}

describe("useCameraCapture", () => {
  it("en el celular usa el input con capture (cámara del sistema), sin diálogo", () => {
    const onClickInput = vi.fn();
    render(<Harness mobile onClickInput={onClickInput} />);
    fireEvent.click(screen.getByText("abrir"));
    expect(onClickInput).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("en la computadora abre el diálogo de cámara", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
    const onClickInput = vi.fn();
    render(<Harness mobile={false} onClickInput={onClickInput} />);
    await act(async () => { fireEvent.click(screen.getByText("abrir")); });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(onClickInput).not.toHaveBeenCalled();
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  });
});

describe("Travel Avatar: «Tomar una foto» en la computadora", () => {
  it("abre la cámara en vivo (no el selector de archivos); el input del celular conserva capture=user", async () => {
    const gum = vi.fn(async () => stream);
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: gum } });
    render(<AvatarCreator onSkip={() => {}} onComplete={() => {}} />);
    const input = screen.getByLabelText("Tomar una foto con la cámara") as HTMLInputElement;
    expect(input.getAttribute("capture")).toBe("user");
    const click = vi.spyOn(input, "click");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Tomar una foto/ })); });
    expect(await screen.findByRole("dialog", { name: /Tómate una selfie/ })).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
    await waitFor(() => expect(gum).toHaveBeenCalledWith(expect.objectContaining({ video: expect.objectContaining({ facingMode: "user" }) })));
    delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
  });
});
