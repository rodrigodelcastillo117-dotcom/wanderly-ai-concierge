// Tiempos (ms) de la ceremonia y de la Grand Welcome con movimiento completo. Con "reducir
// movimiento" no hay escenas automáticas largas (ver IATOS_PRIVE_CINEMATIC_WELCOME.md).
export const CEREMONY_TIMINGS = { arrival: 3200, arrivalReduced: 900, revealButton: 1800, enterButton: 1400 } as const;
export const WELCOME_TIMINGS = { dark: 700, title: 2300, bigger: 2300, destinations: 3600 } as const;
