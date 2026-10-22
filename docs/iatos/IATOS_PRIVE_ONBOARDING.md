# IATOS Privé · Guía de inicio (mini onboarding)

> Parte de la serie Privé. Ceremonia y Grand Welcome: [Cinematic Welcome](IATOS_PRIVE_CINEMATIC_WELCOME.md). Textos permitidos: [Calidad §4](IATOS_PRIVE_CALIDAD_FUENTES.md#4-lenguaje-permitido-y-prohibido).
> Rama `claude/wc-prive-ui`. Componente: `src/components/prive/PriveOnboarding.tsx`; estado: `src/lib/priveOnboarding.ts`.

## Resumen para fundadores

- **Seis pasos cortos** después de la Grand Welcome, la primera vez que el miembro entra a Privé:
  1. Tu mundo · 2. Elegido para ti (Travel DNA, con permiso) · 3. Las 12 colecciones · 4. Tu planeador de experiencias · 5. Reservas y Concierge · 6. Tu membresía.
- **Termina con** **WELCOME TO YOUR WORLD.** y el botón **EXPLORE PRIVÉ** (textos del dueño).
- **Deja claro qué es cada cosa:** recomendación, enlace externo, solicitud de reserva, reserva confirmada y beneficio exclusivo comprobado. Nada se presenta como reserva garantizada.
- **Pide permiso** para usar el Travel DNA ("Sí, personalizar con mi DNA" / "Ahora no") y dice dónde editar las preferencias. Se puede cambiar después en Membresía.
- **Se puede saltar, regresar y retomar:** el avance se guarda en el servidor, así que si cierra la app en el paso 3, la próxima vez empieza en el paso 3, en cualquier dispositivo.
- **Accesible:** teclado completo (← → y Esc), foco en el título de cada paso, progreso anunciado, botones de 48 px, pantallas chicas y movimiento reducido.
- **Sin video ni datos de terceros.** No requiere autorización extra: se publica con el resto de Privé.

---

## 1. Qué se reutilizó, qué se construyó y qué se corrigió

| | Detalle |
|---|---|
| **Reutilizado** | La ruta de Travel DNA de `Mi perfil` (`/dashboard/perfil`), los Términos (`/terminos`), framer-motion y `lucide-react`, y el patrón de estado en el servidor de `useOnboardingStatus` (onboarding general de la app). |
| **Construido** | `PriveOnboarding.tsx` (6 pasos + cierre), `priveOnboarding.ts` (reanudar, completar, omitir), la orquestación en `PriveHub.tsx` (bienvenida → guía) y las opciones "Ver la guía de inicio" y "Usar mi Travel DNA" en `/prive/membresia`. |
| **Corregido** | Nada existente: es nuevo. No toca el onboarding general de la app (`/onboarding`). |

## 2. Pasos y textos

Encabezado de cada paso: una línea de marca en inglés (como el resto de Privé) y el título en español.

| # | Línea | Título | Texto (resumen fiel) |
|---|---|---|---|
| 1 | YOUR WORLD | Tu mundo | Privé reúne experiencias en destinos del mundo, elegidas y revisadas por el equipo de IATOS. Cada ficha dice de dónde viene la información y cuándo se revisó; lo que no se pudo comprobar, se marca. |
| 2 | CURATED FOR YOU | Elegido para ti | Con tu permiso usamos tu Travel DNA (gustos, presupuesto, ritmo) para ordenar lo que ves primero; sin permiso, la selección del editor. Botones **Sí, personalizar con mi DNA** / **Ahora no**. Enlace a **Mi perfil → Travel DNA**; el permiso se cambia en Membresía. |
| 3 | THE COLLECTIONS | Las 12 colecciones | Los doce universos: The Table, After Dark (18+), Casino Grand Nights (18+, solo información), Yacht & Sea, Private Stays, Iconic Events, Culture Access, Wellness Escape, Adventure Elite, Sport & Leisure, Celebrations, Signature México. |
| 4 | YOUR EXPERIENCE PLANNER | Tu planeador de experiencias | Guardar y agregar al itinerario. Antes de agregar, aviso si choca el **horario**, el **presupuesto** o un **traslado** que no da tiempo; los traslados son aproximados hasta calcularlos. |
| 5 | RESERVATIONS & CONCIERGE | Reservas y Concierge | Cinco etiquetas: **Recomendación** (nada apartado ni pagado) · **Enlace externo** (reservas en el sitio oficial, con sus condiciones) · **Solicitud de reserva** (Iato y el equipo la gestionan; aún no es reserva) · **Reserva confirmada** (solo cuando el lugar la confirma, con folio y fecha) · **Beneficio exclusivo comprobado** (solo con acuerdo firmado y vigente; si no, no se muestra). "IATOS no garantiza reservas: depende de cada lugar." |
| 6 | YOUR MEMBERSHIP | Tu membresía | Tarjeta digital, estado y preferencias; cambiar la contraseña Privé, cerrar todas las sesiones, volver a ver la bienvenida, ayuda y términos. |
| — | — | **WELCOME TO YOUR WORLD.** | Botón **EXPLORE PRIVÉ** (cierra la guía y la marca como terminada). |

Controles: **Atrás** (deshabilitado en el paso 1), **Siguiente** / **Terminar**, **Saltar guía** (arriba a la derecha), "Paso N de 6" y una barra de 6 segmentos.

## 3. Modelo de estado

**Fuente de verdad:** el servidor. `prive_status().onboarding` (columna `prive_memberships.onboarding`, JSON) y `welcome_version_seen`. Escritura con `prive-access → save_progress {prive_session, onboarding}`, que exige una sesión Privé válida. **Nunca `localStorage`.**

```text
onboarding = {
  version:      1            // ONBOARDING_VERSION (src/lib/priveCopy.ts)
  step:         0..5         // último paso visto
  completed_at: ISO | null   // EXPLORE PRIVÉ
  skipped_at:   ISO | null   // Saltar guía / Esc
  dna_consent:  true | false | null   // paso 2 o Membresía
}
```

| Situación | Qué hace la interfaz |
|---|---|
| `welcome_version_seen < 1` | Grand Welcome primero; al cerrarla, la guía |
| `version = 1` y sin `completed_at`/`skipped_at` | Se abre sola en `step` |
| `version = 1` con `completed_at` o `skipped_at` | No se abre sola |
| `version` distinta (o `{}`) | Se abre desde el paso 1 (si un día cambia la guía, se sube `ONBOARDING_VERSION`) |
| Cada Atrás / Siguiente / consentimiento | `save_progress` con el paso nuevo (sin bloquear la pantalla) |
| El guardado responde `PRIVE_*` | Se borra la sesión local y se vuelve al candado (regla general de Privé) |
| El guardado falla por red | En esta visita no se repite; la próxima visita reanuda desde lo último guardado |
| Membresía → "Ver la guía de inicio" | Se abre desde el paso 1 sin borrar `completed_at` |

Funciones puras con pruebas: `onboardingResumeStep`, `onboardingProgress`, `onboardingCompleted`, `onboardingSkipped`, `shouldAutoPlayWelcome`.

## 4. Lista de accesibilidad (WCAG 2.2 AA)

| Criterio | Cómo se cumple | Prueba |
|---|---|---|
| Diálogo modal | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` = título del paso | `priveHub.test.tsx` (teclado) |
| Foco | Al abrir, en el diálogo; al cambiar de paso, en el `h2` del paso (`tabIndex=-1`); trampa de Tab/Shift+Tab dentro del diálogo | `priveHub.test.tsx` comprueba `document.activeElement` |
| Teclado | → siguiente, ← atrás, Esc saltar; todos los controles son `button`/`a` nativos | `priveHub.test.tsx` |
| Progreso anunciado | "Paso N de 6" en `aria-live="polite"`; ayuda de teclado en texto solo para lectores | `priveHub.test.tsx` (`prive-onb-progress`) |
| Estados con texto | Consentimiento con `aria-pressed`; nada depende solo del color | revisión de código |
| Tamaño táctil | Botones ≥ 44 px (los principales 48 px) | `prive.css` (`.prive-btn`) |
| Contraste | Texto `#F5F2EA`/`#E8DCC2`/`#A8A299` sobre `#030303`–`#0D0D0E` (≥ 7:1); oro `#C9A961` solo en acentos | revisión de tokens |
| Pantallas chicas | Una columna, margen de 16 px, sin desplazamiento horizontal a 390 px | capturas 390×844 y 412×915 |
| Texto al 200 % | Sin alturas fijas en el contenido; el diálogo se desplaza | revisión de código |
| Movimiento reducido | Fundido de 80 ms, sin desplazamientos; el monograma final aparece ya dibujado | capturas `__reduced-motion` y prueba de la Grand Welcome reducida |
| Sin contenido pesado | Sin video, audio ni imágenes en la guía | `priveBundle.test.ts` |

## 5. Pruebas

| Prueba (`src/test/priveHub.test.tsx`, bloque "guía de inicio") | Resultado |
|---|---|
| Reanuda en el paso guardado; Siguiente y Atrás guardan el avance en el servidor | ✓ |
| Teclado: flechas, foco en el título y Esc para saltar (guarda `skipped_at`) | ✓ |
| El consentimiento del Travel DNA se guarda; el paso 5 muestra las cinco etiquetas y "no garantiza reservas" | ✓ |
| Al terminar: WELCOME TO YOUR WORLD. → EXPLORE PRIVÉ guarda `completed_at` | ✓ |
| Después de la bienvenida sigue la guía si no está terminada | ✓ |
| `src/test/priveLib.test.ts`: reanudar, completada/omitida no vuelve, versión nueva desde el inicio | ✓ |

## 6. Evidencia

`docs/iatos/evidencia/prive/ui/guia-paso-1…6__<viewport>.png` y `guia-final-welcome-to-your-world__<viewport>.png`, en 390×844, 412×915 y 1440×900, más las variantes `__reduced-motion`. Generadas con `scripts/prive/ui_evidence.mjs` contra el servidor de Vite con la API simulada. **Son viewports emulados en Chromium, no dispositivos iOS o Android reales.**

## 7. Qué no se pudo verificar

- Con lectores de pantalla reales (VoiceOver, TalkBack, NVDA): solo se verificaron roles, nombres y foco con Testing Library.
- El guardado real en `prive_memberships` (lo implementa la rama core; aquí se simula según el contrato).
- Que el catálogo respete `dna_consent` (lo debe leer la personalización del grupo catalog).

## 8. Costos

Ninguno adicional: una llamada a `prive-access` por cambio de paso (sin IA, sin terceros).

## 9. Riesgos

- Un miembro que cambie de paso muy rápido genera varias llamadas `save_progress`; son idempotentes (la última gana) y la rama core limita el tamaño del JSON a 2 KB.
- Si en el futuro se agrega un paso, hay que subir `ONBOARDING_VERSION` para que los miembros lo vean.

## 10. Cambios que requieren autorización productiva

Ninguno propio: se publica con el resto de Privé (front + rama core). No hay migraciones ni funciones en esta rama.
