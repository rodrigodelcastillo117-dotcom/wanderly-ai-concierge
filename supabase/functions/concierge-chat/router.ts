// Ruteo de modelos de Iato + circuit breaker. Lógica pura (Vitest).
//
// Antes: cada mensaje iba a Gemini directo (modelo "google/gemini-flash-latest"); con Gemini saturado
// (503 "high demand") CADA petición esperaba esa falla antes de caer al gateway de Lovable, y eso dos
// veces por mensaje (vuelta de herramientas + respuesta final).
// Ahora:
//   * Claude es el cerebro principal: un modelo rápido para turnos simples y uno más capaz para
//     planeación de varios pasos, Modo exigente y Privé. Gemini (gateway de Lovable) solo si Claude
//     no está disponible.
//   * Circuit breaker: si un proveedor/modelo falló (429/5xx/timeout/red) en los últimos minutos, se
//     salta sin esperar. Después del enfriamiento se deja pasar una prueba.
//   * Modelos, esfuerzo y enfriamiento configurables sin desplegar código: variables de entorno o la
//     fila app_flags.concierge_models (gana app_flags, se lee con concierge_runtime_config).

import type { Effort, ProviderErrorKind } from "./anthropic.ts";

export interface ConciergeModelConfig {
  /** Si es false, se usa solo el respaldo (útil si el dueño quiere apagar Claude). */
  anthropic_enabled: boolean;
  fast_model: string;
  smart_model: string;
  fast_effort: Effort;
  smart_effort: Effort;
  exigente_effort: Effort;
  /** Modelo del gateway de Lovable (formato OpenAI) cuando Claude falla. */
  fallback_model: string;
  /** Segundos que un proveedor queda "abierto" (saltado) después de fallar. */
  breaker_cooldown_s: number;
  /** "fast" | "smart" fuerza un nivel para todo (pruebas o control de costos); null = automático. */
  force_tier: "fast" | "smart" | null;
}

export const DEFAULT_MODEL_CONFIG: ConciergeModelConfig = {
  anthropic_enabled: true,
  fast_model: "claude-haiku-5-5",
  smart_model: "claude-sonnet-5-5",
  fast_effort: "low",
  smart_effort: "low",
  exigente_effort: "medium",
  fallback_model: "google/gemini-2.5-flash",
  breaker_cooldown_s: 120,
  force_tier: null,
};

const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];
const MODEL_ID = /^[a-z0-9][a-z0-9./_-]{2,80}$/i;

/**
 * Configuración efectiva: defaults ← variables de entorno ← app_flags.concierge_models. Valores
 * inválidos se ignoran (un typo en app_flags no tumba a Iato).
 */
export function resolveModelConfig(env: Record<string, string | undefined>, flag: unknown): ConciergeModelConfig {
  const out: ConciergeModelConfig = { ...DEFAULT_MODEL_CONFIG };
  const apply = (src: Record<string, unknown>) => {
    for (const k of ["fast_model", "smart_model", "fallback_model"] as const) {
      const v = src[k];
      if (typeof v === "string" && MODEL_ID.test(v.trim())) out[k] = v.trim();
    }
    for (const k of ["fast_effort", "smart_effort", "exigente_effort"] as const) {
      const v = src[k];
      if (typeof v === "string" && (EFFORTS as readonly string[]).includes(v)) out[k] = v as Effort;
    }
    if (typeof src.anthropic_enabled === "boolean") out.anthropic_enabled = src.anthropic_enabled;
    if (src.anthropic_enabled === "false") out.anthropic_enabled = false;
    const cd = Number(src.breaker_cooldown_s);
    if (Number.isFinite(cd) && cd >= 0 && cd <= 3600) out.breaker_cooldown_s = cd;
    if (src.force_tier === "fast" || src.force_tier === "smart") out.force_tier = src.force_tier;
    if (src.force_tier === null) out.force_tier = null;
  };
  apply({
    fast_model: env.CONCIERGE_FAST_MODEL,
    smart_model: env.CONCIERGE_SMART_MODEL,
    fallback_model: env.CONCIERGE_FALLBACK_MODEL,
    fast_effort: env.CONCIERGE_FAST_EFFORT,
    smart_effort: env.CONCIERGE_SMART_EFFORT,
    exigente_effort: env.CONCIERGE_EXIGENTE_EFFORT,
    anthropic_enabled: env.CONCIERGE_ANTHROPIC_ENABLED,
    breaker_cooldown_s: env.CONCIERGE_BREAKER_COOLDOWN_S,
    force_tier: env.CONCIERGE_FORCE_TIER,
  });
  if (flag && typeof flag === "object" && !Array.isArray(flag)) apply(flag as Record<string, unknown>);
  return out;
}

// ═══ Nivel del turno ═══

export type Tier = "fast" | "smart";

/** Intenciones que piden planear o comparar (más de un paso): van al modelo capaz. */
const SMART_INTENTS = new Set(["flight_compare", "flight_disruption", "missed_connection", "trip_overview", "prive_night", "plan"]);

export interface RouteInput {
  message: string;
  intents: string[];
  exigente: boolean;
  config: ConciergeModelConfig;
}

export interface Route {
  tier: Tier;
  model: string;
  effort: Effort;
  maxIterations: number;
  maxTokens: number;
  reason: string;
}

export function routeTurn(i: RouteInput): Route {
  const c = i.config;
  const smart = (reason: string, effort: Effort): Route => ({
    tier: "smart", model: c.smart_model, effort, maxIterations: i.exigente ? 4 : 3, maxTokens: i.exigente ? 32000 : 16000, reason,
  });
  const fast = (reason: string): Route => ({ tier: "fast", model: c.fast_model, effort: c.fast_effort, maxIterations: 3, maxTokens: 12000, reason });
  if (c.force_tier === "fast") return fast("forzado");
  if (c.force_tier === "smart") return smart("forzado", i.exigente ? c.exigente_effort : c.smart_effort);
  if (i.exigente) return smart("modo_exigente", c.exigente_effort);
  const hit = i.intents.find((x) => SMART_INTENTS.has(x));
  if (hit) return smart(`intencion:${hit}`, c.smart_effort);
  // Peticiones largas o con varias preguntas suelen ser planeación.
  const questions = (i.message.match(/\?/g) ?? []).length;
  if (i.message.length > 320 || questions >= 3) return smart("peticion_compleja", c.smart_effort);
  return fast("simple");
}

// ═══ Circuit breaker ═══

/** Fallas que dicen "el proveedor no está bien ahora" (no un error de la petición). */
const TRIPS_BREAKER = new Set<ProviderErrorKind>(["overloaded", "server", "timeout", "network", "auth"]);

export class CircuitBreaker {
  private state = new Map<string, { openUntil: number; failures: number; probeAt: number }>();
  constructor(private now: () => number = Date.now) {}

  /** true = saltarlo sin intentar. Después del enfriamiento deja pasar UNA prueba (half-open). */
  isOpen(key: string): boolean {
    const s = this.state.get(key);
    if (!s || s.openUntil === 0) return false;
    const now = this.now();
    if (now < s.openUntil) return true;
    // Ya hay una prueba en curso (si la prueba se quedó sin resultado 30 s, se permite otra).
    if (s.probeAt && now - s.probeAt < 30_000) return true;
    s.probeAt = now;
    return false;
  }

  recordFailure(key: string, kind: ProviderErrorKind, cooldownMs: number) {
    if (!TRIPS_BREAKER.has(kind)) {
      // Error de la petición: no dice nada del proveedor; libera una prueba pendiente.
      const s = this.state.get(key);
      if (s) s.probeAt = 0;
      return;
    }
    const s = this.state.get(key) ?? { openUntil: 0, failures: 0, probeAt: 0 };
    s.failures += 1;
    // Credenciales malas no se arreglan solas en 2 minutos: más tiempo.
    const ms = kind === "auth" ? Math.max(cooldownMs, 10 * 60_000) : cooldownMs;
    s.openUntil = this.now() + ms;
    s.probeAt = 0;
    this.state.set(key, s);
  }

  recordSuccess(key: string) {
    this.state.delete(key);
  }

  snapshot(): Record<string, { openForMs: number; failures: number }> {
    const out: Record<string, { openForMs: number; failures: number }> = {};
    for (const [k, s] of this.state) out[k] = { openForMs: Math.max(0, s.openUntil - this.now()), failures: s.failures };
    return out;
  }
}

/** Un breaker por instancia de la función (los isolates calientes atienden muchas peticiones seguidas). */
export const sharedBreaker = new CircuitBreaker();

export interface ProviderStep {
  provider: "anthropic" | "lovable";
  model: string;
  effort: Effort;
  key: string;
}

/**
 * Orden de proveedores para este turno, saltando los que tienen el breaker abierto:
 *   1. Claude con el modelo del nivel;  2. Claude con el otro modelo (si el primero está saturado);
 *   3. Gemini por el gateway de Lovable.
 * Si todos están abiertos, se intenta el último (mejor una respuesta lenta que ninguna).
 */
export function providerChain(route: Route, c: ConciergeModelConfig, breaker: CircuitBreaker, opts: { hasAnthropicKey: boolean; hasLovableKey: boolean }): ProviderStep[] {
  const all: ProviderStep[] = [];
  if (c.anthropic_enabled && opts.hasAnthropicKey) {
    all.push({ provider: "anthropic", model: route.model, effort: route.effort, key: `anthropic:${route.model}` });
    const other = route.tier === "fast" ? c.smart_model : c.fast_model;
    if (other !== route.model) {
      all.push({ provider: "anthropic", model: other, effort: route.tier === "fast" ? c.smart_effort : c.fast_effort, key: `anthropic:${other}` });
    }
  }
  if (opts.hasLovableKey) all.push({ provider: "lovable", model: c.fallback_model, effort: "low", key: `lovable:${c.fallback_model}` });
  const open = all.filter((s) => !breaker.isOpen(s.key));
  if (open.length) return open;
  return all.length ? [all[all.length - 1]] : [];
}
