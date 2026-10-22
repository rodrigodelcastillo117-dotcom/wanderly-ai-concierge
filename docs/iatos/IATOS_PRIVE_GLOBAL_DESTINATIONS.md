# IATOS Privé · Cobertura global

> Parte de la serie Privé. Tablas: [Modelo de datos §2](IATOS_PRIVE_MODELO_DE_DATOS.md#2-catálogo-de-destinos). Proceso de verificación: [Calidad y fuentes](IATOS_PRIVE_CALIDAD_FUENTES.md).

## Resumen para fundadores

- **Una lista de destinos es una meta, no una promesa.**
  - Cada destino lleva un nivel de cobertura visible.
  - Solo un **piloto verificado** se presenta como "selección IATOS".
  - Lo demás dice con honestidad qué tan cubierto está.
- **Hoy se curan 36 ciudades piloto**, unas 550 experiencias:
  - las 18 que ya tenía Members Only;
  - 6 de México;
  - 6 de América;
  - 6 del resto del mundo.
- **Los demás destinos de la lista objetivo** (unos 130 en total) se abren por oleadas. La prioridad la marca lo que los usuarios piden de verdad: cada búsqueda de un destino sin cobertura suma a una cola de demanda.
- **"Descubrimiento bajo demanda".**
  - Si un PRO pide un lugar sin cobertura, Iato busca con las herramientas que ya existen (TripAdvisor o Google Maps vía SerpApi).
  - Respeta el tope de búsquedas en vivo y marca los resultados como "descubierto, no verificado por IATOS".
  - Va **apagado** por omisión porque gasta SerpApi.

> **Aviso [SUPUESTO]:** la lista exacta de unos 130 destinos de la orden del dueño no está en el repo ni en los archivos de trabajo. La sección 4 es una **lista objetivo de trabajo** armada con la misma estructura (Europa, Norteamérica, México, Medio Oriente, Asia-Oceanía, otros). Hay que conciliarla con la lista del dueño. Las reglas de normalización de la sección 2 aplican igual a cualquier lista.

---

## 1. Niveles de cobertura

| Nivel | Cuándo | Qué ve el usuario |
|---|---|---|
| **PILOTO VERIFICADO** | ≥ 12 experiencias activas en ≥ 3 universos; ≥ 80% VERIFICADO o CURADO vigente; muestreo humano aprobado; portada con crédito | "Selección IATOS Privé" y la home completa |
| **COBERTURA PARCIAL** | Hay experiencias publicadas, pero no se cumple el umbral del piloto | La home con aviso discreto: "Selección en crecimiento" |
| **DESCUBRIMIENTO BAJO DEMANDA** | Sin catálogo, pero el destino existe y el descubrimiento está encendido | "Aún no curamos <destino>. Iato puede buscar opciones en vivo; no están verificadas por IATOS." |
| **SIN COBERTURA VALIDADA** | Ni catálogo ni descubrimiento | "Aún no tenemos selección para <destino>." Botón: "Avísame cuando llegue" (suma a la cola de demanda) |

El nivel se recalcula cada noche con una función programada. Los umbrales viven en `app_flags` para cambiarlos sin desplegar.

---

## 2. Reglas de normalización (sin duplicados geográficos)

1. **Una experiencia cuelga de una sola localidad.** Los barrios son hijos de la localidad y los corredores agrupan localidades, nunca las duplican.
2. **Los sobrenombres se resuelven a un solo destino** (`prive_destination_aliases`, con llave única): "CDMX", "Ciudad de México", "Mexico City", "DF" → `cdmx`.
3. **Casos del dueño:**

| Nombre en la lista | Normalizado como |
|---|---|
| Polanco, Roma-Condesa | Barrios (`neighborhood`) de **Ciudad de México**. "Roma-Condesa" se divide en Roma Norte y Condesa, con el sobrenombre "Roma-Condesa" apuntando a Roma Norte [SUPUESTO: lo decide la curaduría]. |
| Punta Mita | Localidad de Bahía de Banderas, **Nayarit**, dentro del corredor "Riviera Nayarit y Vallarta" |
| Puerto Vallarta | Localidad de **Jalisco** (no de Nayarit), en el mismo corredor. La orden del dueño lo agrupa en "Riviera Nayarit"; el catálogo respeta el estado real. |
| Montecarlo | Barrio (*quartier*) de **Mónaco** (país y localidad) |
| San José del Cabo, Cabo San Lucas | Localidades del corredor **Los Cabos** (municipio de BCS) |
| Miami Beach | Localidad propia dentro del corredor **Miami (área)**, junto a Miami |
| Saint-Tropez | Localidad en Var, Francia (Costa Azul es corredor) |
| Riviera Maya, Costa Amalfitana, Lago de Como, Costa Esmeralda | **Corredores**, cada uno con sus localidades |

4. **Llave de ciudad heredada:** `legacy_ciudad_key` guarda el valor viejo de `nightlife_premium.ciudad` ("ciudad de mexico", "saint-tropez"…) para la vista de compatibilidad.
5. **Un destino sin coordenadas no se publica.** Las coordenadas del centro salen de OpenStreetMap Nominatim: gratis, como máximo 1 solicitud por segundo, con `User-Agent` propio, según su política de uso.

---

## 3. Piloto: 36 ciudades en curaduría

**Archivo de curaduría:** `scratchpad/prive/content_g*.json`. Unas 15 experiencias por ciudad (tope 18).

| # | Destino | País | Grupo de región | Archivo | Filas heredadas | Nivel al cargar |
|---|---|---|---|---|---|---|
| 1 | París | Francia | europa | g1–g3 | 13 | COBERTURA PARCIAL → PILOTO tras el muestreo |
| 2 | Londres | Reino Unido | europa | g1–g3 | 15 | ídem |
| 3 | Nueva York | EE. UU. | norteamerica | g1–g3 | 15 | ídem |
| 4 | Las Vegas | EE. UU. | norteamerica | g1–g3 | 11 | ídem |
| 5 | Ciudad de México | México | mexico | g1–g3 | 14 | ídem |
| 6 | Dubái | EAU | medio_oriente_africa | g1–g3 | 9 | ídem |
| 7 | Tokio | Japón | asia_oceania | g1–g3 | 9 | ídem |
| 8 | Berlín | Alemania | europa | g1–g3 | 8 | ídem |
| 9 | Ibiza | España | europa | g1–g3 | 8 | ídem |
| 10 | Miami (área; incluye Miami Beach) | EE. UU. | norteamerica | g1–g3 | 10 | ídem |
| 11 | Madrid | España | europa | g1–g3 | 12 | ídem |
| 12 | Roma | Italia | europa | g1–g3 | 10 | ídem |
| 13 | Milán | Italia | europa | g1–g3 | 11 | ídem |
| 14 | Atenas | Grecia | europa | g1–g3 | 10 | ídem |
| 15 | Bangkok | Tailandia | asia_oceania | g1–g3 | 13 | ídem |
| 16 | Saint-Tropez | Francia | europa | g1–g3 | 10 | ídem |
| 17 | Mykonos | Grecia | europa | g1–g3 | 8 | ídem |
| 18 | Tulum | México | mexico | g1–g3 | 8 | ídem |
| 19 | Los Cabos (corredor: San José del Cabo, Cabo San Lucas) | México | mexico | g4 | 0 | ídem |
| 20 | Riviera Nayarit y Vallarta (corredor: Punta Mita, Puerto Vallarta) | México | mexico | g4 | 0 | ídem |
| 21 | San Miguel de Allende | México | mexico | g4 | 0 | ídem |
| 22 | Oaxaca | México | mexico | g4 | 0 | ídem |
| 23 | Monterrey | México | mexico | g4 | 0 | ídem |
| 24 | Guadalajara | México | mexico | g4 | 0 | ídem |
| 25 | Los Ángeles | EE. UU. | norteamerica | g5 | 0 | ídem |
| 26 | Buenos Aires | Argentina | latam_caribe | g5 | 0 | ídem |
| 27 | São Paulo | Brasil | latam_caribe | g5 | 0 | ídem |
| 28 | Río de Janeiro | Brasil | latam_caribe | g5 | 0 | ídem |
| 29 | Cartagena | Colombia | latam_caribe | g5 | 0 | ídem |
| 30 | Lima | Perú | latam_caribe | g5 | 0 | ídem |
| 31 | Barcelona | España | europa | g6 | 0 | ídem |
| 32 | Lisboa | Portugal | europa | g6 | 0 | ídem |
| 33 | Mónaco (incluye Montecarlo) | Mónaco | europa | g6 | 0 | ídem |
| 34 | Ámsterdam | Países Bajos | europa | g6 | 0 | ídem |
| 35 | Singapur | Singapur | asia_oceania | g6 | 0 | ídem |
| 36 | Marrakech | Marruecos | medio_oriente_africa | g6 | 0 | ídem |

**Totales del piloto:**
- 36 destinos: 12 en Europa, 6 en Norteamérica, 8 en México, 5 en Latam, 2 en Medio Oriente y África, 3 en Asia.
- 194 filas heredadas, que entran como PENDIENTE.
- Unas 550 experiencias nuevas o corregidas [SUPUESTO: 36 × ~15].

Cuando escribimos esto, los archivos `content_g1…g6.json` todavía no estaban en la carpeta de trabajo. El cargador los valida al llegar ([Modelo §9.2](IATOS_PRIVE_MODELO_DE_DATOS.md#92-cargador-de-curaduría-no-es-migración)).

---

## 4. Lista objetivo de trabajo (normalizada) [SUPUESTO: conciliar con la del dueño]

**Leyenda:**
- **P** = piloto (sección 3).
- **C** = corredor; lo que va entre paréntesis son sus localidades.
- **B** = barrio de una ciudad ya listada: no cuenta como destino aparte.

Todo lo que no es P empieza como **SIN COBERTURA VALIDADA**.

**Europa (40):**
- **P:** París, Londres, Berlín, Madrid, Roma, Milán, Atenas, Ibiza, Saint-Tropez, Mykonos, Barcelona, Lisboa, Mónaco (B: Montecarlo), Ámsterdam.
- **Destinos:** Cannes, Niza, Courchevel, St. Moritz, Gstaad, Zúrich, Ginebra, Viena, Praga, Copenhague, Estocolmo, Edimburgo, Florencia, Venecia, Capri, Portofino, Santorini, Marbella, Mallorca, San Sebastián, Sevilla, Oporto, Estambul, Bodrum, Dubrovnik.
- **C:** Costa Amalfitana (Positano, Amalfi, Ravello), Lago de Como (Bellagio, Tremezzo, Cernobbio).

**Norteamérica (18):**
- **P:** Nueva York, Las Vegas, Miami (área; Miami Beach), Los Ángeles.
- **Destinos:** San Francisco, Chicago, Aspen, Palm Beach, Nueva Orleans, Nashville, Washington D. C., Boston, Toronto, Montreal, Vancouver, Whistler, Honolulu.
- **C:** Napa y Sonoma.

**México (22):**
- **P:** Ciudad de México (B: Polanco, Roma Norte, Condesa, Juárez, San Ángel), Tulum, Los Cabos (C), Riviera Nayarit y Vallarta (C), San Miguel de Allende, Oaxaca, Monterrey, Guadalajara.
- **Destinos:** Cancún, Isla Mujeres, Holbox, Bacalar, Mérida, Valle de Guadalupe, Puebla, Valle de Bravo, Acapulco, Huatulco, San Cristóbal de las Casas, Tequila, Querétaro.
- **C:** Riviera Maya (Playa del Carmen, Puerto Aventuras, Akumal).

**Latinoamérica y Caribe (20):**
- **P:** Buenos Aires, São Paulo, Río de Janeiro, Cartagena, Lima.
- **Destinos:** Cusco, Santiago de Chile, Medellín, Bogotá, Ciudad de Panamá, Punta del Este, Trancoso, St. Barth, Turks y Caicos, Nasáu, Punta Cana.
- **C:** Valle Sagrado, Mendoza y Valle de Uco, Patagonia (El Calafate, Torres del Paine), Guanacaste, José Ignacio (B de Punta del Este: alias).

**Medio Oriente y África (11):**
- **P:** Dubái, Marrakech.
- **Destinos:** Abu Dabi, Doha, AlUla, Ciudad del Cabo, Zanzíbar, Seychelles, Mauricio.
- **C:** Winelands del Cabo (Stellenbosch, Franschhoek), Masái Mara.

**Asia y Oceanía (19):**
- **P:** Tokio, Bangkok, Singapur.
- **Destinos:** Kioto, Osaka, Niseko, Hong Kong, Macao, Shanghái, Seúl, Bali (C: Ubud, Seminyak, Uluwatu), Phuket, Maldivas, Sídney, Melbourne, Queenstown, Bora Bora.
- **C:** Polinesia Francesa (Bora Bora, Tahití).

**Total de trabajo:** unos 130 destinos.
- 36 son piloto.
- Los casinos solo se curan donde el juego es legal y está regulado (Las Vegas, Mónaco, Macao, Singapur, Londres…).
- En destinos donde el juego no es legal, `casino_grand_nights` no existe ([Calidad §6](IATOS_PRIVE_CALIDAD_FUENTES.md#6-casinos-cómo-se-marcan-legalmente)).

---

## 5. Descubrimiento bajo demanda (con las herramientas que ya existen)

- **Disparador:** un PRO abre un destino sin cobertura, o le pregunta a Iato por él.
- **Flujo:**
  1. `prive-search` revisa `app_flag('prive_on_demand_discovery')` y el tope `plan_limits('prive_discovery')`. Propuesta: PRO 5 al mes, prueba 2, gratis 0 [SUPUESTO].
  2. Llama a `tripadvisor-search` (`category='restaurants'` o `'attractions'`). Primero intenta TripAdvisor; si no responde, usa **1 búsqueda** de SerpApi Google Maps, guardada 7 días en `serp_cache` y compartida entre usuarios.
  3. Los resultados **no entran al catálogo.** Se muestran con estado PENDIENTE, la etiqueta "Descubierto en búsqueda · no verificado por IATOS" y su enlace de origen.
  4. Se suma 1 a `prive_curation_demand(destination, n_requests, last_requested_at)`.
- **Costo:** USD 0 si la respuesta está en caché. Si no, ~USD 0.015 por búsqueda con el plan Developer ([costos](IATOS_COSTOS_UNITARIOS.md)). Con el tope de 5 al mes, el peor caso es USD 0.075 por PRO al mes.
- **Riesgo:** SerpApi está casi agotado (IATOS-015). Por eso va apagado hasta que el dueño confirme el plan.

---

## 6. Plan de expansión

| Oleada | Cuándo | Destinos | Criterio |
|---|---|---|---|
| 0 | Fase 5 | Las 36 ciudades piloto | Las curan ahora tres equipos más México, Américas y resto del mundo |
| 1 | Piloto + 6 semanas | 12 destinos | Los 12 de mayor `prive_curation_demand` en el piloto. Si no hay datos: Cancún, Riviera Maya, Mérida, Valle de Guadalupe, Florencia, Costa Amalfitana, Niza, Cannes, Abu Dabi, Hong Kong, Kioto, Bali. |
| 2 | + 6 semanas | 12 destinos | Demanda y temporada de los próximos 3 meses |
| 3+ | Cada 6 semanas | 12 por oleada | Hasta cubrir la lista objetivo |

**Capacidad** ([Calidad §2](IATOS_PRIVE_CALIDAD_FUENTES.md#2-proceso-de-verificación-y-cadencia)): una oleada de 12 destinos son unas 180 experiencias.
- Curaduría asistida: unas 2 semanas.
- Muestreo humano del 20% (~36 fichas): unas 6 horas.
- Más la reverificación de lo ya publicado: unas 550 fichas cada 90 días, es decir ~43 por semana.
