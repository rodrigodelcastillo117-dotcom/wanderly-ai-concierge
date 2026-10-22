# Paquete para auditoría externa (ChatGPT u otro auditor)

## Cómo usarlo

1. Sube a ChatGPT el archivo `iatos_auditoria_<fecha>.zip` (código de la app, funciones del servidor, migraciones, pruebas y todos los documentos de `docs/iatos/`, sin imágenes pesadas).
2. Pega el texto de la sección "Instrucción para el auditor".
3. Si ChatGPT pide algo que no está en el zip (capturas, evidencia en imagen), las capturas están en `docs/iatos/evidencia/` del repositorio.

## Instrucción para el auditor (pegar tal cual)

> Eres un auditor técnico y de producto senior. Audita IATOS AI, una app mexicana de concierge de viajes con IA (React + Vite + TypeScript en el frontend; Supabase con Postgres, RLS y funciones Edge en Deno en el backend; Stripe; Resend; Google Places; SerpApi; Claude como modelo principal con respaldo de Gemini).
>
> Empieza por `docs/iatos/IATOS_ESTADO_FINAL.md`: ahí está lo que el equipo afirma, con calificación 0–100 por área y GO/NO-GO. Tu trabajo es **verificar o refutar esas afirmaciones contra el código y las pruebas del zip**, no repetirlas.
>
> Revisa, con archivo y línea en cada hallazgo:
> 1. **Seguridad:** políticas RLS y permisos en `supabase/migrations/`; funciones `SECURITY DEFINER` y a quién se les concede `EXECUTE`; funciones Edge que no validan la sesión o la firma; inyección en correos (HTML/encabezados); redirecciones abiertas (`booking-go`); manejo de secretos.
> 2. **Honestidad de datos:** que ningún precio, disponibilidad o reserva se presente como real sin fuente (`_shared/provenance*`, `concierge-chat/cards.ts`, `guard.ts`, `analizar-viaje`). Busca cualquier ruta en la que la IA pueda inventar un lugar, un precio o decir "reservado".
> 3. **Pagos y cuotas:** `stripe-webhook`, `reserve_quota`/cuotas, idempotencia, qué pasa si Stripe reintenta eventos.
> 4. **Privé:** acceso tras 90 días PRO pagados + contraseña individual; que la revocación al terminar PRO sea inmediata en el servidor (`prive_require`).
> 5. **Iato (concierge-chat):** enrutamiento de modelos, timeouts, circuit breaker, que las acciones requieran confirmación del usuario y se revaliden en el servidor.
> 6. **Booking Bridge y Reservas IA:** máquina de estados (nunca CONFIRMED sin evidencia), lista blanca de dominios, verificación del remitente en correos entrantes.
> 7. **Calidad:** pruebas que no prueban nada (aserciones vacías, mocks que siempre pasan), código muerto, duplicación.
> 8. **Producto:** contra `docs/iatos/IATOS_PLAN_COMERCIAL.md`, ¿qué promesas de la app o del plan no están respaldadas por el código?
>
> Entrega: (a) tabla de hallazgos con severidad P0–P3, archivo:línea, escenario concreto de falla y arreglo sugerido; (b) tu propia calificación 0–100 por área con una línea de justificación, comparada con la del equipo; (c) GO/NO-GO para vender PRO a $99 MXN al público. No des por buenas afirmaciones que no puedas comprobar en el código; márcalas "no verificable con el zip".

## Qué contiene el zip

- `src/` (frontend), `supabase/functions/` (63 funciones + `_shared`), `supabase/migrations/` (90 en producción), `supabase/tests/` (suites SQL), `scripts/`, `package.json`, `vite.config.ts`, `vite.chunks.ts`.
- `docs/iatos/` completo en texto (incluye resultados de las verificaciones en producción `evidencia/release10/*/RESULTADOS.md`).
- No contiene: secretos, `.env`, `node_modules`, imágenes ni videos.

## Resultados de pruebas al cerrar (para comparar)

- Vitest: 157 archivos, 1,464 pruebas, todas pasan.
- TypeScript sin errores; build de producción correcto; `deno check` correcto en las funciones cambiadas (Deno 2.1, el del runtime de Supabase).
- SQL (Postgres local): seguridad 95, pagos 63, costo 16, Privé 89, catálogo Privé 110, Members 30, Reservas IA 43, Concierge 7, Booking Bridge 35. Sin fallas.
- En producción: seguridad 70/70; ensayo Privé 50 PASS (P1 y P2 corregidos y desplegados); evaluación en vivo de Iato: los 8 escenarios del dueño y Centurion responden con herramientas reales; 2 se pasan del largo pedido (8 líneas vs 6); Modo exigente supera al normal en cenas, no en vuelos (la búsqueda real trae 2 opciones).
