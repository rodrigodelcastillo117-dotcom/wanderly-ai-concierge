// Acabado de cada tarjeta de la Bóveda (estilo cartera: metal según el nivel, papel según el
// documento). Puro y sin React para poder probarlo.
import { COUNTRY_NAME } from "./alerts";
import { KIND_LABEL, type VaultItem } from "./types";

export type Finish = "obsidian" | "diamond" | "platinum" | "gold" | "silver" | "passport" | "visa" | "identity" | "health" | "graphite";

export type CardLook = { finish: Finish; background: string; text: string; muted: string; accent: string; light: boolean };

const LOOKS: Record<Finish, Omit<CardLook, "finish">> = {
  obsidian: { background: "linear-gradient(140deg,#1c1c1c 0%,#0b0b0b 55%,#141414 100%)", text: "#f5f1ea", muted: "rgba(245,241,234,.62)", accent: "#c9a961", light: false },
  diamond: { background: "linear-gradient(140deg,#16243a 0%,#0c1626 50%,#1d2f4a 100%)", text: "#eef4ff", muted: "rgba(226,236,255,.66)", accent: "#bcd4ff", light: false },
  platinum: { background: "linear-gradient(140deg,#e7e8ec 0%,#a9adb5 38%,#eef0f3 58%,#8f939b 100%)", text: "#141518", muted: "rgba(20,21,24,.62)", accent: "#2d2f35", light: true },
  gold: { background: "linear-gradient(140deg,#efd89c 0%,#c39a4c 42%,#f3e1ad 60%,#a97f35 100%)", text: "#1d160a", muted: "rgba(29,22,10,.64)", accent: "#3a2a0e", light: true },
  silver: { background: "linear-gradient(140deg,#d5d8dc 0%,#9aa0a7 50%,#c7cbd0 100%)", text: "#16181b", muted: "rgba(22,24,27,.62)", accent: "#2f3338", light: true },
  passport: { background: "linear-gradient(140deg,#17402f 0%,#0d261c 58%,#0a1d15 100%)", text: "#f3ead6", muted: "rgba(243,234,214,.64)", accent: "#d4b46a", light: false },
  visa: { background: "linear-gradient(140deg,#1a2a4d 0%,#0e1830 60%,#0b1325 100%)", text: "#eef1f8", muted: "rgba(238,241,248,.64)", accent: "#d4b46a", light: false },
  identity: { background: "linear-gradient(140deg,#3b302a 0%,#211a16 60%,#1a1411 100%)", text: "#f4ece4", muted: "rgba(244,236,228,.62)", accent: "#e2b9a0", light: false },
  health: { background: "linear-gradient(140deg,#43151d 0%,#250b10 60%,#1d080c 100%)", text: "#f8ecec", muted: "rgba(248,236,236,.62)", accent: "#e7b6a5", light: false },
  graphite: { background: "linear-gradient(140deg,#2b2b2b 0%,#171717 60%,#111 100%)", text: "#f5f1ea", muted: "rgba(245,241,234,.6)", accent: "#c9a961", light: false },
};

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function tierFinish(text: string): Finish | null {
  const t = norm(text);
  if (!t.trim()) return null;
  if (/centurion|black|infinite|obsidian/.test(t)) return "obsidian";
  if (/diamond|diamante|pinnacle|\b1k\b|emerald|titanium|titanio|ambassador|globalist|executive elite|president|super elite|hon circle|prestige|elite plus/.test(t)) return "diamond";
  if (/platinum|platino|platinium|senator|sapphire|explorist/.test(t)) return "platinum";
  if (/gold|oro|five star|discoverist/.test(t)) return "gold";
  if (/silver|plata|ruby|bronze/.test(t)) return "silver";
  return null;
}

export function cardLook(item: Pick<VaultItem, "kind" | "section" | "tier" | "tier_id" | "title">): CardLook {
  let finish: Finish;
  switch (item.kind) {
    case "pasaporte": finish = "passport"; break;
    case "visa": case "autorizacion": finish = "visa"; break;
    case "ine": case "licencia": case "otro_documento": finish = "identity"; break;
    case "vacuna": finish = "health"; break;
    default:
      if (item.section === "seguro") { finish = "health"; break; }
      finish = tierFinish(`${item.tier ?? ""} ${item.tier_id ?? ""}`) ?? tierFinish(item.title) ?? (item.section === "tarjeta" ? "obsidian" : "graphite");
  }
  return { finish, ...LOOKS[finish] };
}

/** Línea superior de la tarjeta: tipo y país ("Pasaporte · México"). */
export function itemSubtitle(item: VaultItem): string {
  const country = item.country_code ? COUNTRY_NAME[item.country_code] ?? item.country_code : null;
  if (item.kind === "pasaporte") return ["Pasaporte", country].filter(Boolean).join(" · ");
  if (item.kind === "visa" || item.kind === "autorizacion") return [item.kind === "visa" ? "Visa" : "Autorización", country].filter(Boolean).join(" · ");
  return [KIND_LABEL[item.kind], item.section === "tarjeta" ? item.issuer : null].filter(Boolean).join(" · ");
}

