// Datos secundarios después de los críticos (login → inicio, E2E 28-oct-2026).
//
// Al entrar al inicio salían ~15 consultas a la vez (viajes, nombre, notificaciones, Privé, tarjeta
// de miembro, recomendaciones, gastos, video de portada…). En red lenta todas se estorbaban y el
// viaje y el nombre llegaban hasta segundos después. Ahora la pantalla marca lo crítico
// (beginCritical: viajes y nombre) y lo secundario (afterCritical) espera a que termine, con tope,
// y a que el navegador esté libre. Nada se quita: solo se pide un momento después, con su esqueleto.

let pending = 0;
const waiters = new Set<() => void>();

/** Hay trabajo crítico en curso (lo pide la pantalla visible). Devuelve la función para terminarlo. */
export function beginCritical(): () => void {
  pending++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending = Math.max(0, pending - 1);
    if (pending === 0) for (const w of [...waiters]) w();
  };
}

/** Solo para pruebas. */
export function __resetIdleGate() {
  pending = 0;
  waiters.clear();
}

export function criticalPending(): number {
  return pending;
}

type Env = {
  immediate: boolean;
  idle?: (cb: () => void, timeout: number) => () => void;
  timer: (cb: () => void, ms: number) => () => void;
};

const defaultEnv = (): Env => {
  // Pruebas (Vitest): igual que antes, sin esperar (las pruebas de cada pantalla no dependen de esto).
  const immediate = import.meta.env?.MODE === "test";
  const w = typeof window !== "undefined" ? (window as any) : null;
  return {
    immediate,
    idle: w?.requestIdleCallback
      ? (cb, timeout) => { const id = w.requestIdleCallback(cb, { timeout }); return () => w.cancelIdleCallback?.(id); }
      : undefined,
    timer: (cb, ms) => { const id = setTimeout(cb, ms); return () => clearTimeout(id); },
  };
};

/**
 * Corre `cb` cuando terminó lo crítico (o pasó `maxWaitMs`) y el navegador está libre. Devuelve
 * cómo cancelarlo (desmontaje). Sin requestIdleCallback (Safari) usa un temporizador corto.
 */
export function afterCritical(cb: () => void, { maxWaitMs = 2500, idleTimeoutMs = 800 } = {}, env: Env = defaultEnv()): () => void {
  if (env.immediate) { cb(); return () => {}; }
  let cancelled = false;
  let cancelStep: () => void = () => {};
  let ran = false;
  const run = () => { if (cancelled || ran) return; ran = true; cleanup(); cb(); };
  const onIdle = () => {
    if (cancelled) return;
    // Lo crítico se registra en el mismo montaje (efectos del padre corren después): se revisa aquí.
    if (pending === 0) return run();
    waiters.add(onGate);
    cancelStep = env.timer(run, maxWaitMs);
  };
  const onGate = () => { waiters.delete(onGate); run(); };
  const cleanup = () => { waiters.delete(onGate); cancelStep(); };
  cancelStep = env.idle ? env.idle(onIdle, idleTimeoutMs) : env.timer(onIdle, 50);
  return () => { cancelled = true; cleanup(); };
}
