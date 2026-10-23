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

## Cierre de la liberación `8fbbbcb` — GO (23-oct-2026)
Frontend publicado con Lovable y verificado en traveliatos.life: el JS en vivo contiene "Precio y compra con el operador". Funciones `booking-bridge` y `enviar-seleccion` desplegadas desde `8fbbbcb`.

**Smoke E2E real** (viaje España 09c6b32e, cuenta demo, escritorio 1440 + móvil 390, 0 llamadas de IA, 0 compras):
| Paso | Estado | Evidencia |
|---|---|---|
| Tramos por tierra (taxi, tren, coche, ALSA) | PASS | Cada uno con su modo e ícono; "Aerolínea por confirmar", Google Flights y Kayak aparecen 0 veces |
| Comprar = total | PASS | 49,530 + 73,113 + 9,118 + 53,470 + 15,796 + 2,870 = **$203,897**, igual a la página; el rubro dice "Transporte entre ciudades" |
| Cambiar hotel | PASS | Catalonia ($13,959) → Ibis ($9,849): el total pasa a $199,787 (exacto) |
| Guardado y reapertura | PASS | Navegador nuevo: la selección persiste y el total es $199,787 |
| Volver a la selección original | PASS | El total regresa a $203,897 |
| Móvil 390 | PASS | Sin scroll horizontal |

**Rollback:** no fue necesario.

**Defectos abiertos (ninguno es regresión):**
- MEDIA: el precio del transporte por tierra difiere entre Destinos y Comprar (dos fuentes); el total usa el de Comprar.
- MEDIA-BAJA:
  - el aviso "actualiza la cotización" no desaparece al volver a la selección original;
  - no se puede quitar la selección de un hotel.
- BAJA:
  - las etiquetas "Transporte" y "Tours" del desglose no coinciden con "Transporte entre ciudades" y "Experiencias";
  - "Rentar auto" en un tramo de ida manda la fecha de devolución del final del viaje;
  - restaurantes con USD o € en una página en pesos.

**Pendientes reales (no prometer):** vuelos multidestino con precio estimado; trenes, autobuses y autos sin cotización; ninguna reserva integrada operativa (todo abre al proveedor; Reservas IA por correo y la compra exacta de vuelo siguen apagadas).

## Siguiente mejora pedida por el dueño (empezar con su OK)
**"Planear viaje" igual que Google Flights:**
1. Al pulsar "Planear viaje" se abre una ventana con el buscador simple (ida y vuelta / solo ida / multiciudad, personas, clase, origen ⇄ destino, fechas, botón dorado "Explorar").
2. Debajo, "¿Flexible? Descríbele tu viaje a Iato" (la frase completa → recorrido).
3. Más abajo, "Vuelos baratos desde tu ciudad" (tarjetas "CDMX → Cancún desde $X") y un mapa chico.
4. "Explorar destinos" abre una pantalla completa: lista con foto, fechas, escalas y precio, más el mapa del mundo con precios, igual que Google Flights.

Reglas:
- Negro y dorado de IATOS.
- **El gasto solo ocurre al pulsar "Planear viaje"** (una búsqueda guardada unas horas por ciudad de origen, dentro de la cuota del plan).
- Los precios son "desde $X · consultado a las HH:MM" y se reconsultan antes de comprar.
- Fuente: SerpApi Google Flights, ya contratado (por confirmar si existe la búsqueda Explore; si no, búsquedas normales a destinos populares).

## Etapa 2 (23-oct-2026): integridad + Planear viaje — GO por función
| Función | Commit | Estado | Evidencia |
|---|---|---|---|
| Un precio por traslado (Destinos = Comprar = total) | `f250770` | **GO (probado con fixtures + verificado en vivo)** | Pruebas de regresión con el viaje real de España; el JS en vivo contiene "Quitar mi elección" |
| Renta de auto con la fecha del tramo; monedas con fuente; etiquetas; quitar hotel; aviso obsoleto | `f250770` | **GO (probado con fixtures)** | 15 pruebas nuevas (14 fallan sin el arreglo) |
| Ventana "Planear viaje" (buscador, Iato, ofertas, Explorar destinos) | `3dcfca5` | **GO (E2E real)** | Abre desde el menú y desde la barra móvil con 0 llamadas `live:true`; Madrid → /dashboard/planear con todo lleno y sin análisis; España → /dashboard/ruta con ciudades y noches; Explorar: 40 destinos con foto, escalas, precio y mapa; sin scroll horizontal a 390 |
| Motor `google_travel_explore` | `3dcfca5` | **GO (1 llamada real)** | MEX: 40 destinos (Puerto Vallarta $1,688, Las Vegas $5,070…); la segunda consulta salió de caché. Costo: ≤ 1 búsqueda por origen y mes cada 12 h; abrir la ventana cuesta 0 |
| Fechas al volver a /dashboard/ruta desde la ventana (D1) | este commit | **GO (prueba)** | La página relee la URL cuando llega una marca nueva de la ventana |
| Multidestino `google_flights type=3` | `3dcfca5` | **PENDIENTE** | El servidor lo soporta, pero ningún botón lo usa todavía |

**Pendientes de esta etapa (bajos):**
- En móvil, la lista de Explorar recorta escalas y duración.
- En el mapa, los precios se enciman en Europa y EE. UU.
- "Consultado en vivo" se muestra para la caché de menos de 15 min (lleva la hora; ajustar el texto).
- La clase todavía no filtra en Vuelos.
- Las fotos de Explorar vienen de gstatic (miniaturas de Google vía SerpApi): revisar la licencia o usar Pexels / Places con atribución.
