import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() }, from: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import AvatarCreator, { avatarFileError } from "@/components/AvatarCreator";
import { toast } from "sonner";

describe("avatar photo picker", () => {
  it("offers gallery and camera separately; only the camera input forces capture", () => {
    render(<AvatarCreator onSkip={() => {}} onComplete={() => {}} />);
    const gallery = screen.getByLabelText("Elegir foto de la galería") as HTMLInputElement;
    const camera = screen.getByLabelText("Tomar una foto con la cámara") as HTMLInputElement;
    expect(gallery.hasAttribute("capture")).toBe(false); // antes: capture="user" obligaba a usar la cámara
    expect(camera.getAttribute("capture")).toBe("user");
    expect(screen.getByRole("button", { name: /Elegir de mi galería/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tomar una foto/ })).toBeInTheDocument();
    expect(screen.getByText(/Saltar por ahora/)).toBeInTheDocument();
  });

  it("rejects unsupported formats and files over 8 MB", () => {
    expect(avatarFileError({ type: "image/heic", size: 1000 })).toMatch(/Formato/);
    expect(avatarFileError({ type: "image/jpeg", size: 9 * 1024 * 1024 })).toMatch(/8 MB/);
    expect(avatarFileError({ type: "image/png", size: 500_000 })).toBeNull();
  });

  it("cancelling the picker (no file) does nothing and shows no error", () => {
    render(<AvatarCreator onSkip={() => {}} onComplete={() => {}} />);
    fireEvent.change(screen.getByLabelText("Elegir foto de la galería"), { target: { files: [] } });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
