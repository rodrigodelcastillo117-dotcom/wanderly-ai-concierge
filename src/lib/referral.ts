import { supabase } from "@/integrations/supabase/client";

const KEY = "iatos_ref";
const MAX_AGE_MS = 30 * 86_400_000;
const CODE_RE = /^[A-Za-z0-9]{4,16}$/;

// Remember an invite code from ?ref= so it survives browsing until signup.
export function captureReferral(search: string): void {
  const code = new URLSearchParams(search).get("ref")?.trim();
  if (!code || !CODE_RE.test(code)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code: code.toUpperCase(), at: Date.now() }));
  } catch {
    // storage blocked: attribution is best-effort
  }
}

export function pendingReferral(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const { code, at } = JSON.parse(raw) as { code?: string; at?: number };
    if (!code || !at || Date.now() - at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return code;
  } catch {
    return null;
  }
}

// The database only attributes accounts created in the last 24h and ignores
// self-referrals, so calling this on every login is safe.
export async function claimPendingReferral(): Promise<void> {
  const code = pendingReferral();
  if (!code) return;
  const { error } = await supabase.rpc("claim_referral", { p_code: code });
  if (!error) {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  }
}

export function inviteLink(code: string): string {
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}
