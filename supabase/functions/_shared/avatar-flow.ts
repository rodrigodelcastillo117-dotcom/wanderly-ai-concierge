// Orquestación del avatar, sin Deno ni red: todo lo externo llega por `deps` (pruebas en Vitest con
// dobles; nunca se llama a la IA real en pruebas).
//
// createVariants        → 2 variantes desde la selfie, cada una verificada; si una no se parece,
//                          se reintenta UNA vez con las diferencias que encontró el juez.
// composeWithSouvenirs  → edita la imagen BASE (sin recuerdos) con los recuerdos visibles; verifica
//                          que la persona siga idéntica y reintenta una vez si cambió.
// processTripEvolution  → un viaje terminado/importado → su recuerdo. Idempotente por viaje: la
//                          base de datos (avatar_claim_trip) decide quién lo procesa.
import { builderPrompt, identityPrompt, LIKENESS_THRESHOLD, souvenirPrompt, type BuilderTraits, type Likeness } from "./avatar-prompts.ts";
import type { ImageResult } from "./avatar-image.ts";
import { resolveSouvenir, visibleSouvenirs, type Souvenir, type TripLike } from "./souvenirs.ts";
import type { UsageEntry } from "./usage.ts";

/** Uso registrado de un resultado (éxito: una entrada; fallo: lista). Sin depender del narrowing estricto. */
type ImageFailure = Extract<ImageResult, { ok: false }>;
const failCode = (r: ImageResult) => (r as ImageFailure).code;
const usageList = (r: ImageResult): UsageEntry[] => (Array.isArray(r.usage) ? r.usage : [r.usage]);

export type GenFn = (prompt: string, images: string[]) => Promise<ImageResult>;
export type CheckFn = (reference: string, candidate: string, mode: "selfie" | "identidad") =>
  Promise<{ likeness: Likeness | null; usage: UsageEntry | null }>;

export type CoreDeps = {
  generate: GenFn;
  check: CheckFn;
  /** Reserva n imágenes del cupo diario; regresa cuántas se permitieron (0..n). */
  take: (n: number) => Promise<number>;
  logUsage: (u: UsageEntry) => void;
  threshold?: number;
};

export type Variant = { url: string; model: string; score: number | null; diferencias: string[]; intentos: number };

export type VariantsResult =
  | { ok: true; variants: Variant[]; imagenes: number }
  | { ok: false; code: "limite_diario" | "sin_creditos" | "saturado" | "sin_imagen" | "error"; imagenes: number };

const better = (a: Variant, b: Variant) => (b.score ?? -1) > (a.score ?? -1) ? b : a;

export async function createVariants(
  deps: CoreDeps,
  input: { selfies: string[] | null; builder: BuilderTraits | null; variants?: number },
): Promise<VariantsResult> {
  const want = Math.max(1, Math.min(2, input.variants ?? 2));
  const allowed = await deps.take(want);
  if (allowed <= 0) return { ok: false, code: "limite_diario", imagenes: 0 };
  const threshold = deps.threshold ?? LIKENESS_THRESHOLD;
  const selfies = input.selfies?.length ? input.selfies : null;
  let imagenes = 0;
  let firstError: Exclude<VariantsResult, { ok: true }>["code"] | null = null;

  const one = async (i: number): Promise<Variant | null> => {
    const prompt = selfies ? identityPrompt({ photos: selfies.length, variant: i }) : builderPrompt(input.builder ?? {}, i);
    const gen = await deps.generate(prompt, selfies ?? []);
    if (!gen.ok) {
      usageList(gen).forEach(deps.logUsage);
      firstError ??= failCode(gen);
      return null;
    }
    imagenes++;
    deps.logUsage(gen.usage);
    let best: Variant = { url: gen.url, model: gen.model, score: null, diferencias: [], intentos: 1 };
    if (!selfies) return best;

    const first = await deps.check(selfies[0], gen.url, "selfie");
    if (first.usage) deps.logUsage(first.usage);
    if (!first.likeness) return best;
    best = { ...best, score: first.likeness.score, diferencias: first.likeness.diferencias };
    if (first.likeness.score >= threshold) return best;

    // No se parece lo suficiente: un solo reintento, con las diferencias como correcciones.
    if ((await deps.take(1)) <= 0) return best;
    const fixes = first.likeness.diferencias.length ? first.likeness.diferencias : ["the face does not resemble the photo"];
    const retry = await deps.generate(identityPrompt({ photos: selfies.length, variant: i, fixes }), selfies);
    if (!retry.ok) { usageList(retry).forEach(deps.logUsage); return best; }
    imagenes++;
    deps.logUsage(retry.usage);
    const second = await deps.check(selfies[0], retry.url, "selfie");
    if (second.usage) deps.logUsage(second.usage);
    const cand: Variant = {
      url: retry.url, model: retry.model, score: second.likeness?.score ?? null,
      diferencias: second.likeness?.diferencias ?? [], intentos: 2,
    };
    return { ...better(best, cand), intentos: 2 };
  };

  const results = await Promise.all(Array.from({ length: allowed }, (_, k) => one(k + 1)));
  const variants = results.filter((v): v is Variant => !!v).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  if (!variants.length) return { ok: false, code: firstError ?? "error", imagenes };
  return { ok: true, variants, imagenes };
}

export type SouvenirLite = Pick<Souvenir, "key" | "prompt" | "slot">;

export type ComposeResult =
  | { ok: true; url: string; model: string; score: number | null; imagenes: number }
  | { ok: false; code: "sin_cupo" | "no_identico" | "sin_imagen" | "sin_creditos" | "saturado" | "error"; imagenes: number; score?: number | null };

/** Avatar base + recuerdos visibles. La cara sale de la base, nunca de la versión anterior. */
export async function composeWithSouvenirs(deps: CoreDeps, base: string, visible: SouvenirLite[]): Promise<ComposeResult> {
  const threshold = deps.threshold ?? LIKENESS_THRESHOLD;
  if ((await deps.take(1)) <= 0) return { ok: false, code: "sin_cupo", imagenes: 0 };
  const gen = await deps.generate(souvenirPrompt(visible), [base]);
  if (!gen.ok) {
    usageList(gen).forEach(deps.logUsage);
    return { ok: false, code: failCode(gen), imagenes: 0 };
  }
  deps.logUsage(gen.usage);
  let imagenes = 1;
  const c1 = await deps.check(base, gen.url, "identidad");
  if (c1.usage) deps.logUsage(c1.usage);
  let best = { url: gen.url, model: gen.model, score: c1.likeness?.score ?? null };
  if (c1.likeness && c1.likeness.score < threshold && (await deps.take(1)) > 0) {
    const retry = await deps.generate(souvenirPrompt(visible, { fixes: c1.likeness.diferencias }), [base]);
    if (retry.ok) {
      imagenes++;
      deps.logUsage(retry.usage);
      const c2 = await deps.check(base, retry.url, "identidad");
      if (c2.usage) deps.logUsage(c2.usage);
      const s2 = c2.likeness?.score ?? null;
      if ((s2 ?? -1) > (best.score ?? -1)) best = { url: retry.url, model: retry.model, score: s2 };
    } else {
      usageList(retry).forEach(deps.logUsage);
    }
  }
  // Si el juez dice que la persona cambió, NO se publica: la cara importa más que el recuerdo.
  if (best.score !== null && best.score < threshold) return { ok: false, code: "no_identico", imagenes, score: best.score };
  return { ok: true, ...best, imagenes };
}

// aplicado = en la colección (visible = dibujado ahora en el avatar); sin_avatar = desbloqueado antes de
// tener avatar (se dibuja al crearlo); sin_cupo/fallido/pendiente = se reintenta (lease de 20 min).
export type SouvenirStatus = "pendiente" | "aplicado" | "repetido" | "sin_avatar" | "sin_cupo" | "fallido";

export type OwnedSouvenir = SouvenirLite & { status: SouvenirStatus; visible: boolean };

export type EvolutionDeps = CoreDeps & {
  /** Reclama el viaje (avatar_claim_trip). null = ya procesado o lo está procesando otra corrida. */
  claim: (s: Souvenir) => Promise<{ id: string } | null>;
  /** Imagen base (sin recuerdos) como data URL, o null si aún no hay avatar. */
  loadBase: () => Promise<string | null>;
  /** Publica la imagen nueva como avatar actual; regresa su URL pública. */
  publish: (imageUrl: string, meta: { visibleKeys: string[]; model: string; score: number | null }) => Promise<string>;
  finish: (id: string, patch: { status: SouvenirStatus; visible?: boolean; score?: number | null; model?: string | null; error?: string | null }) => Promise<void>;
  /** Deja visibles solo estas llaves (las demás quedan en la colección). */
  setVisible: (keys: string[]) => Promise<void>;
  notify: (title: string, body: string) => Promise<void>;
};

export type EvolutionOutcome = { status: SouvenirStatus | "ya_procesado"; souvenir: Souvenir; url?: string; dibujado?: boolean };

/** Ya se tiene un recuerdo si quedó en la colección de cualquier forma (no si falló o espera cupo). */
const UNLOCKED: SouvenirStatus[] = ["aplicado", "sin_avatar"];

export async function processTripEvolution(
  deps: EvolutionDeps,
  input: { trip: TripLike; owned: OwnedSouvenir[] },
): Promise<EvolutionOutcome> {
  const ownedKeys = input.owned.filter((o) => UNLOCKED.includes(o.status)).map((o) => o.key);
  const souvenir = resolveSouvenir(input.trip, ownedKeys);
  const claimed = await deps.claim(souvenir);
  if (!claimed) return { status: "ya_procesado", souvenir };

  if (ownedKeys.includes(souvenir.key)) {
    await deps.finish(claimed.id, { status: "repetido", visible: false });
    return { status: "repetido", souvenir };
  }

  const base = await deps.loadBase();
  if (!base) {
    await deps.finish(claimed.id, { status: "sin_avatar", visible: false });
    await deps.notify(`Desbloqueaste un detalle de ${souvenir.lugar}`, `${souvenir.nombre} ${souvenir.emoji} — crea tu avatar en tu perfil para lucirlo.`);
    return { status: "sin_avatar", souvenir };
  }

  const applied = input.owned.filter((o) => o.status === "aplicado");
  const visible = visibleSouvenirs<SouvenirLite>([...applied, souvenir]);
  const res = await composeWithSouvenirs(deps, base, visible);
  if (!res.ok) {
    const fail = res as Extract<ComposeResult, { ok: false }>;
    if (fail.code === "sin_cupo" || fail.code === "saturado") {
      await deps.finish(claimed.id, { status: "sin_cupo", error: fail.code });
      return { status: "sin_cupo", souvenir };
    }
    if (fail.code === "no_identico") {
      // Se gana el recuerdo (colección) aunque no se dibuje: no se publica una cara distinta.
      await deps.finish(claimed.id, { status: "aplicado", visible: false, score: fail.score ?? null });
      await deps.notify(`Ganaste un detalle de ${souvenir.lugar}`, `${souvenir.nombre} ${souvenir.emoji} quedó en tu colección.`);
      return { status: "aplicado", souvenir };
    }
    await deps.finish(claimed.id, { status: "fallido", error: fail.code });
    return { status: "fallido", souvenir };
  }
  const keys = visible.map((v) => v.key);
  const url = await deps.publish(res.url, { visibleKeys: keys, model: res.model, score: res.score });
  await deps.finish(claimed.id, { status: "aplicado", visible: true, score: res.score, model: res.model, error: null });
  await deps.setVisible(keys);
  await deps.notify(`Tu avatar ganó un detalle de ${souvenir.lugar}`, `${souvenir.nombre} ${souvenir.emoji} — míralo en tu perfil.`);
  return { status: "aplicado", souvenir, url, dibujado: true };
}

/**
 * Rehace el avatar con los recuerdos de la colección (al elegir un avatar nuevo o al importar viajes
 * de golpe): una sola imagen con los últimos AVATAR_MAX_VISIBLE. Si falla, el avatar queda sin
 * recuerdos dibujados (la colección no se pierde).
 */
export async function rebuildAvatar(
  deps: Pick<EvolutionDeps, "generate" | "check" | "take" | "logUsage" | "threshold" | "publish" | "setVisible">,
  base: string,
  appliedOldestFirst: SouvenirLite[],
): Promise<{ ok: boolean; url?: string; visibleKeys: string[] }> {
  const visible = visibleSouvenirs<SouvenirLite>(appliedOldestFirst);
  if (!visible.length) return { ok: true, visibleKeys: [] };
  const res = await composeWithSouvenirs(deps, base, visible);
  if (!res.ok) {
    await deps.setVisible([]);
    return { ok: false, visibleKeys: [] };
  }
  const keys = visible.map((v) => v.key);
  const url = await deps.publish(res.url, { visibleKeys: keys, model: res.model, score: res.score });
  await deps.setVisible(keys);
  return { ok: true, url, visibleKeys: keys };
}
