# IATOS — Reporte de la operación nocturna autónoma (23-oct-2026)

**SHA inicial:** `3b57d49` (último observado en Lovable) · **SHA final:** el commit que contiene este archivo, en main.
**Hosting real:** el frontend se publica con Lovable (`deploy_project` → traveliatos.life). **Vercel no sirve IATOS:** no hubo despliegues en Vercel.
**Migraciones:** ninguna esta noche (todas las correcciones son de código).
**Sin:** cobros, Stripe live, reservas reales, correos masivos, cambios de claves ni de permisos. No hubo rollback.

## Qué se publicó (verificado en vivo, buscando el texto nuevo dentro de los JS de traveliatos.life)
| Commit | Qué arregla | Funciones desplegadas (vía Lovable) |
|---|---|---|
| `8edb300` | `track-flight`: el "hoy" del cliente se acota a ±1 día (cierra el bypass del plan gratuito) | track-flight |
| `5d63a60` | Tipos de cambio solo con fuente (BCE) y fecha: fuera GBP/JPY/AED fijos; los rangos de México ya no se usan para destinos internacionales | concierge-chat, analizar-viaje |
| `016ca3e` | La entrada de Privé muestra la tarjeta del rango (Rose Gold / Special Edition) | — |
| `1859f28` | Comprar suma las mismas partidas que el total; "Incluye estimados: vuelos."; Iato compra en la misma fuente que dio el precio; "solo ida" honesto | flights-search, concierge-chat |
| `e2e4319` | Precio verificable: `en_vivo` (≤15 min) / `cache` ("Consultado hace 3 h") / `obsoleto` / `estimado`; vuelo redondo completo (elegir regreso); "Actualizar precio" con la diferencia y "Acepto el nuevo precio"; Booking genérico marcado como "la tarifa puede variar" | flights-search, hotels-search, booking-bridge, concierge-chat, serpapi-quote |
| `7221df5` | **P0** multidestino: `logistics-plan` daba 504 (pasaba 150 s). Ahora usa un modelo rápido, topes de tiempo y entrega parcial | logistics-plan |
| `38a9b47` | **P0** contexto de Iato: ubicación física, viaje seleccionado y destino pedido van separados (caso Interlomas/India). Botón **"Llévame"** (Google Maps `api=1` + `place_id`) | concierge-chat |
| este commit | Traslados honestos: tren, taxi, coche y autobús ya no se muestran como vuelos ni llevan enlace de Google Flights; Comprar coincide con el total en los tramos entre ciudades | booking-bridge, enviar-seleccion |

Gates de cada paquete: tsc PASS · vitest PASS (de 3,049 a 3,135 pruebas) · build PASS · deno check PASS · sin migraciones.

## E2E reales en producción (cuenta sintética de demo, sin compras)
| Flujo | Estado | Evidencia |
|---|---|---|
| Multidestino España, 15 días (MEX→Madrid→Córdoba→Sevilla→Granada→Barcelona→MEX) | **PASS** (antes FAIL 504) | Viaje creado en 47 s; ida a Madrid y regreso desde Barcelona (open-jaw); hotel en cada ciudad con sus fechas; el total cuadra a mano ($203,897) y dice "Incluye estimados: vuelos" |
| Iato "restaurantes cerca de mí" (Interlomas, con viaje futuro a otro país) | **PASS** | Lugares de Interlomas, etiqueta "cerca de ti", "Llévame" con `destination_place_id` |
| Iato "restaurantes en Madrid" | **PASS** | Madrid, sin cambiar el viaje activo |
| Vuelos (Tokio) | **PASS** | United, en vivo, con hora de consulta; coincide con lo que devuelve el servidor |
| Hoteles | **PASS** | SerpApi con las fechas y los adultos; el enlace de Booking lleva fechas y huéspedes |
| Booking Bridge | **PASS** | Google Flights (`tfs` decodificado) y Booking conservan los parámetros |
| Guardado y reapertura | **PASS** | La selección persiste entre sesiones y dispositivos |
| Privé (cuenta demo) | **BLOCKED (legítimo)** | La cuenta demo no tiene 90 días de PRO pagado |
| Francia y Japón completos | **BLOCKED** | Las generaciones se gastaron mientras existía el 504; ya no se repitieron para cuidar créditos |
| Traslados honestos / Comprar = total en tramos | **Probado con fixtures** (respuesta real) | E2E pendiente |

## Qué NO funciona todavía (no prometer)
- **Vuelos del multidestino:** el precio es un estimado de la IA ("Aerolínea por confirmar"); falta una cotización open-jaw real.
- **Trenes, autobuses y autos:** sin precio verificable; se muestra "precio y compra con el operador".
- **Reservas reales:** ninguna se completa dentro de IATOS. Todo abre al proveedor. Reservas IA por correo y la compra exacta de vuelo (BB-08) siguen apagadas por bandera.
- **Planear viaje (asistente):** si escribes la frase completa en el destino no la entiende. Hay que llenar destino y fechas en sus campos.
- **Iato:** no hay botón de "conversación nueva".
- **Pequeños:** descripciones de algunos hoteles inexactas (vienen del modelo); "€€€ (40-60 USD)" mezcla monedas.

## Qué puedes enseñar a amigos y familia
Pedirle a Iato lugares cerca o en otra ciudad (con "Llévame"); crear un viaje a una ciudad o multidestino (con fechas en sus campos); ver vuelos y hoteles con fuente y hora; "Actualizar precio" antes de ir al proveedor; guardar y reabrir; Privé con cuentas que tienen acceso.

## Siguientes prioridades (después del martes 27)
1. Vuelos open-jaw reales para multidestino (SerpApi multi-city).
2. Que el asistente de Planear entienda la frase completa.
3. Mission Engine con estados de reserva verificables.
4. Optimizar costos de Google Places.
5. Avatar por capas (rama lista).
6. Build My Perfect Trip.

El detalle completo está en `docs/iatos/IATOS_HALLAZGOS_PRIORIZADOS.md`.
