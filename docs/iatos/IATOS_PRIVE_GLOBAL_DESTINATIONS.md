# IATOS Privé · Destinos globales (Global Destinations)

> Parte de la serie Privé (antes `IATOS_PRIVE_COBERTURA_GLOBAL.md`). Tablas: [Modelo de datos §2](IATOS_PRIVE_MODELO_DE_DATOS.md#2-catálogo-de-destinos). Reglas de evidencia: [Estándar de curaduría](IATOS_PRIVE_CURATION_STANDARD.md).
> Estado: construido en la rama `claude/wc-prive-catalog` y probado en una réplica local. **En producción todavía no hay catálogo**: se crea al aplicar las migraciones con el GO del dueño.

## Resumen para fundadores

- **La lista es la del dueño, exacta:** 110 destinos (34 de Europa, 20 de Norteamérica, 22 de México, 5 de Medio Oriente, 13 de Asia y Oceanía, 16 de otras regiones) + **Mascate** como primera localidad de "destinos destacados de Omán" = **111 destinos**.
- **Sin duplicados geográficos:** Montecarlo es un barrio de Mónaco; Polanco y Roma-Condesa son barrios de la Ciudad de México; Interlomas está en Huixquilucan, dentro del área metropolitana de la CDMX; Punta Mita está en la Riviera Nayarit; San José del Cabo, en Los Cabos; Miami Beach, en el Área de Miami; Beverly Hills y Malibu, en el Área de Los Ángeles; Riviera Maya y Tulum son destinos distintos de Quintana Roo. Cada sobrenombre ("Monte Carlo", "CDMX", "Cabo San Lucas", "NYC") apunta a un solo destino: la base no deja crear un segundo.
- **La cobertura no se declara: se calcula** con el contenido que tiene fuente y fecha. Hoy en producción todos estarían en SIN COBERTURA VERIFICADA.
- **Con la curaduría de octubre de 2026 cargada en una réplica local**, los **111 destinos quedan en COBERTURA PARCIAL** (1,097 fichas curadas). **Ninguno llega a PILOTO VERIFICADO**: hace falta el muestreo humano que convierte CURADO en VERIFICADO.
- **Coordenadas:** de Wikidata, con el enlace en cada fila. Tres quedan vacías porque no se pudieron verificar: Riviera Nayarit (Wikidata no la tiene), Roma-Condesa (barrio compuesto) e Interlomas (el dato de Wikidata cae fuera de Interlomas).

---

## 1. Niveles de cobertura (calculados por `prive_destination_coverage`)

| Nivel | Regla (umbrales en `app_flags`) | Qué ve el usuario |
|---|---|---|
| **PILOTO VERIFICADO** | ≥ 12 experiencias publicables, en ≥ 3 universos, y ≥ 80% en VERIFICADO vigente | "Selección IATOS Privé" |
| **COBERTURA PARCIAL** | Al menos una experiencia VERIFICADO o CURADO con fuente y revisión de ≤ 90 días | "Selección en crecimiento" |
| **DESCUBRIMIENTO BAJO DEMANDA** | Nada publicable, pero `app_flag('prive_on_demand_discovery')` encendido (hoy **apagado**: gasta SerpApi) | "Aún no curamos este destino: Iato puede buscar opciones en vivo, no verificadas por IATOS" |
| **SIN COBERTURA VERIFICADA** | Lo demás | "Aún no tenemos selección verificada para este destino" |

- Lo PENDIENTE, DESACTUALIZADO o NO DISPONIBLE **no cuenta**: una ciudad solo con lugares heredados sin revisar o con revisiones de más de 90 días sale como SIN COBERTURA VERIFICADA (prueba C2).
- Un barrio cuenta sus propias fichas; un área (Miami, Los Ángeles, CDMX metropolitana) cuenta las de sus miembros; un país-destino (Mónaco, Singapur, Hong Kong, Omán, Seychelles, Mauricio, Maldivas) cuenta las suyas.
- No existe una columna de cobertura que alguien pueda editar (prueba C6).

## 2. Normalización

| Tipo | Qué es | Ejemplos |
|---|---|---|
| `country` | País. Solo es destino si el dueño lo lista como tal | Mónaco, Singapur, Hong Kong, Omán (destinos destacados), Seychelles, Mauricio, Maldivas |
| `region` | Región turística que recibe experiencias | Costa Amalfitana, Lago de Como, Jackson Hole, Napa Valley, Hamptons, Riviera Nayarit, Los Cabos, Riviera Maya, Valle de Guadalupe, Phuket, Bali |
| `locality` | Ciudad o pueblo | París, Punta Mita (en Riviera Nayarit), San José del Cabo (en Los Cabos), Mascate (en Omán), Interlomas |
| `neighborhood` | Barrio de un destino | Montecarlo (Mónaco), Polanco y Roma-Condesa (CDMX) |
| `area` | Agrupación metropolitana sin fichas propias | Área de Miami (Miami + Miami Beach), Área de Los Ángeles (Los Ángeles + Beverly Hills + Malibu), Área metropolitana de CDMX (CDMX + Interlomas) |

Reglas (las hace cumplir la base):
1. Una región cuelga de un país; una localidad, de un país o una región; un barrio, de un destino; un área, de un país (trigger `prive_destinations_guard`).
2. Un sobrenombre normalizado (`prive_norm`: sin acentos, minúsculas) apunta a un solo destino (llave primaria).
3. No hay dos destinos con el mismo nombre bajo el mismo padre.
4. Una experiencia cuelga de un destino (país-destino, región o localidad) y, opcionalmente, de un barrio de ese destino. Nunca de un área.
5. Puerto Vallarta es de Jalisco: no pertenece a la Riviera Nayarit (Nayarit). El cargador mueve a Puerto Vallarta las fichas archivadas en "Riviera Nayarit" cuya dirección dice "Puerto Vallarta, Jal.".
6. Fuente única de la lista: `scripts/prive/destinations.mjs` → `gen_destinations_sql.mjs` → migración `20261023100010_prive_destinations_seed.sql`.

## 3. Estado de cada destino

Columna final: resultado de cargar `data/prive/curaduria/2026-10/` (13 archivos) en una réplica local el 2026-10-22. "Publicables" = CURADO (todavía ninguna VERIFICADO). En producción, hasta aplicar y cargar, todos están en SIN COBERTURA VERIFICADA.

**Europa**

| # | Destino | Tipo | Dentro de | Coordenadas (Wikidata) | Tras cargar la curaduría de oct-2026 (réplica local) |
|---|---|---|---|---|---|
| 1 | Mónaco | país-destino | — | 43.7311, 7.42 ([Q235](https://www.wikidata.org/wiki/Q235)) | COBERTURA PARCIAL · 17 publicables en 9 universos · 2 pendientes (ocultas) |
| 2 | Montecarlo | barrio | Mónaco | 43.7389, 7.4252 ([Q45240](https://www.wikidata.org/wiki/Q45240)) | COBERTURA PARCIAL · 12 publicables en 6 universos |
| 3 | París | localidad | Francia | 48.8567, 2.3522 ([Q90](https://www.wikidata.org/wiki/Q90)) | COBERTURA PARCIAL · 16 publicables en 4 universos |
| 4 | Londres | localidad | Reino Unido | 51.5072, -0.1275 ([Q84](https://www.wikidata.org/wiki/Q84)) | COBERTURA PARCIAL · 15 publicables en 4 universos · 1 pendientes (ocultas) |
| 5 | Milán | localidad | Italia | 45.4669, 9.19 ([Q490](https://www.wikidata.org/wiki/Q490)) | COBERTURA PARCIAL · 14 publicables en 5 universos · 2 pendientes (ocultas) |
| 6 | Roma | localidad | Italia | 41.8931, 12.4828 ([Q220](https://www.wikidata.org/wiki/Q220)) | COBERTURA PARCIAL · 16 publicables en 4 universos |
| 7 | Florencia | localidad | Italia | 43.7714, 11.2542 ([Q2044](https://www.wikidata.org/wiki/Q2044)) | COBERTURA PARCIAL · 8 publicables en 5 universos · 1 pendientes (ocultas) |
| 8 | Venecia | localidad | Italia | 45.4397, 12.3319 ([Q641](https://www.wikidata.org/wiki/Q641)) | COBERTURA PARCIAL · 10 publicables en 6 universos |
| 9 | Capri | localidad | Italia | 40.55, 14.2333 ([Q173292](https://www.wikidata.org/wiki/Q173292)) | COBERTURA PARCIAL · 9 publicables en 6 universos · 1 pendientes (ocultas) |
| 10 | Costa Amalfitana | región | Italia | 40.6333, 14.6 ([Q212214](https://www.wikidata.org/wiki/Q212214)) | COBERTURA PARCIAL · 11 publicables en 7 universos · 1 cerradas por temporada |
| 11 | Lago de Como | región | Italia | 46, 9.2667 ([Q15523](https://www.wikidata.org/wiki/Q15523)) | COBERTURA PARCIAL · 8 publicables en 5 universos · 2 pendientes (ocultas) |
| 12 | Saint-Tropez | localidad | Francia | 43.2697, 6.6386 ([Q1813](https://www.wikidata.org/wiki/Q1813)) | COBERTURA PARCIAL · 15 publicables en 4 universos · 1 pendientes (ocultas) · 1 cerradas por temporada |
| 13 | Cannes | localidad | Francia | 43.5525, 7.0214 ([Q39984](https://www.wikidata.org/wiki/Q39984)) | COBERTURA PARCIAL · 6 publicables en 5 universos · 3 pendientes (ocultas) |
| 14 | Niza | localidad | Francia | 43.7019, 7.2683 ([Q33959](https://www.wikidata.org/wiki/Q33959)) | COBERTURA PARCIAL · 7 publicables en 5 universos · 3 pendientes (ocultas) |
| 15 | Courchevel | localidad | Francia | 45.415, 6.6339 ([Q290817](https://www.wikidata.org/wiki/Q290817)) | COBERTURA PARCIAL · 9 publicables en 5 universos · 2 pendientes (ocultas) |
| 16 | Megève | localidad | Francia | 45.8569, 6.6175 ([Q259283](https://www.wikidata.org/wiki/Q259283)) | COBERTURA PARCIAL · 7 publicables en 6 universos · 3 pendientes (ocultas) |
| 17 | Gstaad | localidad | Suiza | 46.4667, 7.2833 ([Q37149](https://www.wikidata.org/wiki/Q37149)) | COBERTURA PARCIAL · 9 publicables en 6 universos · 1 pendientes (ocultas) |
| 18 | St. Moritz | localidad | Suiza | 46.4972, 9.8378 ([Q68986](https://www.wikidata.org/wiki/Q68986)) | COBERTURA PARCIAL · 10 publicables en 5 universos · 2 pendientes (ocultas) |
| 19 | Zúrich | localidad | Suiza | 47.3744, 8.5411 ([Q72](https://www.wikidata.org/wiki/Q72)) | COBERTURA PARCIAL · 10 publicables en 6 universos |
| 20 | Ginebra | localidad | Suiza | 46.2, 6.15 ([Q71](https://www.wikidata.org/wiki/Q71)) | COBERTURA PARCIAL · 9 publicables en 6 universos |
| 21 | Madrid | localidad | España | 40.4169, -3.7033 ([Q2807](https://www.wikidata.org/wiki/Q2807)) | COBERTURA PARCIAL · 15 publicables en 4 universos · 1 pendientes (ocultas) |
| 22 | Barcelona | localidad | España | 41.3825, 2.1769 ([Q1492](https://www.wikidata.org/wiki/Q1492)) | COBERTURA PARCIAL · 16 publicables en 4 universos |
| 23 | Marbella | localidad | España | 36.5114, -4.8834 ([Q484799](https://www.wikidata.org/wiki/Q484799)) | COBERTURA PARCIAL · 9 publicables en 5 universos · 1 pendientes (ocultas) |
| 24 | Ibiza | localidad | España | 38.98, 1.43 ([Q52631](https://www.wikidata.org/wiki/Q52631)) | COBERTURA PARCIAL · 13 publicables en 5 universos · 3 pendientes (ocultas) · 2 cerradas por temporada |
| 25 | Formentera | localidad | España | 38.7, 1.45 ([Q52626](https://www.wikidata.org/wiki/Q52626)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 2 pendientes (ocultas) |
| 26 | Mallorca | localidad | España | 39.6167, 2.9833 ([Q8828](https://www.wikidata.org/wiki/Q8828)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 1 pendientes (ocultas) |
| 27 | Mykonos | localidad | Grecia | 37.446, 25.3286 ([Q190210](https://www.wikidata.org/wiki/Q190210)) | COBERTURA PARCIAL · 16 publicables en 5 universos · 4 cerradas por temporada |
| 28 | Santorini | localidad | Grecia | 36.415, 25.4325 ([Q129296](https://www.wikidata.org/wiki/Q129296)) | COBERTURA PARCIAL · 9 publicables en 4 universos · 1 pendientes (ocultas) |
| 29 | Atenas | localidad | Grecia | 37.9842, 23.7281 ([Q1524](https://www.wikidata.org/wiki/Q1524)) | COBERTURA PARCIAL · 12 publicables en 4 universos · 4 pendientes (ocultas) |
| 30 | Viena | localidad | Austria | 48.2083, 16.3725 ([Q1741](https://www.wikidata.org/wiki/Q1741)) | COBERTURA PARCIAL · 6 publicables en 5 universos · 2 pendientes (ocultas) |
| 31 | Berlín | localidad | Alemania | 52.5167, 13.3833 ([Q64](https://www.wikidata.org/wiki/Q64)) | COBERTURA PARCIAL · 14 publicables en 5 universos · 2 pendientes (ocultas) |
| 32 | Ámsterdam | localidad | Países Bajos | 52.3667, 4.8833 ([Q727](https://www.wikidata.org/wiki/Q727)) | COBERTURA PARCIAL · 15 publicables en 4 universos · 1 pendientes (ocultas) |
| 33 | Lisboa | localidad | Portugal | 38.708, -9.139 ([Q597](https://www.wikidata.org/wiki/Q597)) | COBERTURA PARCIAL · 16 publicables en 5 universos |
| 34 | Porto | localidad | Portugal | 41.15, -8.6108 ([Q36433](https://www.wikidata.org/wiki/Q36433)) | COBERTURA PARCIAL · 10 publicables en 5 universos |

**Norteamérica**

| # | Destino | Tipo | Dentro de | Coordenadas (Wikidata) | Tras cargar la curaduría de oct-2026 (réplica local) |
|---|---|---|---|---|---|
| 35 | Nueva York | localidad | Estados Unidos | 40.7128, -74.0061 ([Q60](https://www.wikidata.org/wiki/Q60)) | COBERTURA PARCIAL · 15 publicables en 5 universos · 1 pendientes (ocultas) · 1 cerradas por temporada |
| 36 | Miami | localidad | Estados Unidos · Área de Miami | 25.7742, -80.1936 ([Q8652](https://www.wikidata.org/wiki/Q8652)) | COBERTURA PARCIAL · 14 publicables en 4 universos · 2 pendientes (ocultas) |
| 37 | Miami Beach | localidad | Estados Unidos · Área de Miami | 25.8139, -80.1325 ([Q201516](https://www.wikidata.org/wiki/Q201516)) | COBERTURA PARCIAL · 7 publicables en 5 universos · 1 pendientes (ocultas) |
| 38 | Los Ángeles | localidad | Estados Unidos · Área de Los Ángeles | 34.0522, -118.2437 ([Q65](https://www.wikidata.org/wiki/Q65)) | COBERTURA PARCIAL · 15 publicables en 4 universos · 1 pendientes (ocultas) |
| 39 | Beverly Hills | localidad | Estados Unidos · Área de Los Ángeles | 34.0731, -118.3994 ([Q127856](https://www.wikidata.org/wiki/Q127856)) | COBERTURA PARCIAL · 8 publicables en 4 universos |
| 40 | Malibu | localidad | Estados Unidos · Área de Los Ángeles | 34.035, -118.695 ([Q387047](https://www.wikidata.org/wiki/Q387047)) | COBERTURA PARCIAL · 7 publicables en 5 universos |
| 41 | Las Vegas | localidad | Estados Unidos | 36.1672, -115.1486 ([Q23768](https://www.wikidata.org/wiki/Q23768)) | COBERTURA PARCIAL · 14 publicables en 5 universos · 2 pendientes (ocultas) |
| 42 | Aspen | localidad | Estados Unidos | 39.1922, -106.8244 ([Q205842](https://www.wikidata.org/wiki/Q205842)) | COBERTURA PARCIAL · 9 publicables en 5 universos · 1 pendientes (ocultas) |
| 43 | Vail | localidad | Estados Unidos | 39.6358, -106.3631 ([Q747987](https://www.wikidata.org/wiki/Q747987)) | COBERTURA PARCIAL · 10 publicables en 6 universos · 1 pendientes (ocultas) |
| 44 | Jackson Hole | región | Estados Unidos | 43.5167, -110.8333 ([Q1677361](https://www.wikidata.org/wiki/Q1677361)) | COBERTURA PARCIAL · 9 publicables en 6 universos · 2 pendientes (ocultas) |
| 45 | Napa Valley | región | Estados Unidos | 38.5, -122.32 ([Q6159125](https://www.wikidata.org/wiki/Q6159125)) | COBERTURA PARCIAL · 11 publicables en 6 universos · 1 pendientes (ocultas) |
| 46 | San Francisco | localidad | Estados Unidos | 37.7775, -122.4164 ([Q62](https://www.wikidata.org/wiki/Q62)) | COBERTURA PARCIAL · 12 publicables en 5 universos |
| 47 | Chicago | localidad | Estados Unidos | 41.8819, -87.6278 ([Q1297](https://www.wikidata.org/wiki/Q1297)) | COBERTURA PARCIAL · 12 publicables en 5 universos |
| 48 | Boston | localidad | Estados Unidos | 42.3603, -71.0578 ([Q100](https://www.wikidata.org/wiki/Q100)) | COBERTURA PARCIAL · 11 publicables en 6 universos |
| 49 | Palm Beach | localidad | Estados Unidos | 26.7056, -80.0364 ([Q695411](https://www.wikidata.org/wiki/Q695411)) | COBERTURA PARCIAL · 10 publicables en 6 universos |
| 50 | Hamptons | región | Estados Unidos | 40.8849, -72.5011 ([Q1574020](https://www.wikidata.org/wiki/Q1574020)) | COBERTURA PARCIAL · 12 publicables en 6 universos |
| 51 | Toronto | localidad | Canadá | 43.6703, -79.3867 ([Q172](https://www.wikidata.org/wiki/Q172)) | COBERTURA PARCIAL · 10 publicables en 5 universos · 1 pendientes (ocultas) |
| 52 | Vancouver | localidad | Canadá | 49.2608, -123.1139 ([Q24639](https://www.wikidata.org/wiki/Q24639)) | COBERTURA PARCIAL · 10 publicables en 5 universos |
| 53 | Whistler | localidad | Canadá | 50.1208, -122.9544 ([Q203122](https://www.wikidata.org/wiki/Q203122)) | COBERTURA PARCIAL · 9 publicables en 6 universos · 1 pendientes (ocultas) · 1 cerradas por temporada |
| 54 | Montreal | localidad | Canadá | 45.5033, -73.5868 ([Q340](https://www.wikidata.org/wiki/Q340)) | COBERTURA PARCIAL · 10 publicables en 5 universos · 1 pendientes (ocultas) · 1 cerradas por temporada |

**México**

| # | Destino | Tipo | Dentro de | Coordenadas (Wikidata) | Tras cargar la curaduría de oct-2026 (réplica local) |
|---|---|---|---|---|---|
| 55 | Ciudad de México | localidad | México · Área metropolitana de Ciudad de México | 19.3538, -99.1359 ([Q1489](https://www.wikidata.org/wiki/Q1489)) | COBERTURA PARCIAL · 25 publicables en 5 universos · 3 pendientes (ocultas) |
| 56 | Polanco | barrio | Ciudad de México | 19.4333, -99.2 ([Q785318](https://www.wikidata.org/wiki/Q785318)) | COBERTURA PARCIAL · 5 publicables en 5 universos |
| 57 | Roma-Condesa | barrio | Ciudad de México | NULL — Barrio compuesto (Roma Norte y Condesa): sin coordenada única verificable. | COBERTURA PARCIAL · 11 publicables en 4 universos |
| 58 | Interlomas | localidad | México · Área metropolitana de Ciudad de México | NULL — Wikidata da 19.2299,-99.2816, que cae al sur de la CDMX y no coincide con Interlomas (Huixquilucan, al poniente). No se pudo verificar con una segunda fuente: queda sin coordenada. | COBERTURA PARCIAL · 5 publicables en 3 universos |
| 59 | Valle de Bravo | localidad | México | 19.1925, -100.1306 ([Q3058725](https://www.wikidata.org/wiki/Q3058725)) | COBERTURA PARCIAL · 7 publicables en 4 universos · 1 pendientes (ocultas) · 1 cerradas por temporada |
| 60 | San Miguel de Allende | localidad | México | 20.9153, -100.7439 ([Q753891](https://www.wikidata.org/wiki/Q753891)) | COBERTURA PARCIAL · 16 publicables en 4 universos · 1 pendientes (ocultas) |
| 61 | Guadalajara | localidad | México | 20.6764, -103.3422 ([Q9022](https://www.wikidata.org/wiki/Q9022)) | COBERTURA PARCIAL · 8 publicables en 5 universos · 7 pendientes (ocultas) |
| 62 | Puerto Vallarta | localidad | México | 20.6413, -105.2233 ([Q853258](https://www.wikidata.org/wiki/Q853258)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 3 pendientes (ocultas) |
| 63 | Punta Mita | localidad | Riviera Nayarit | 20.7752, -105.527 ([Q7260546](https://www.wikidata.org/wiki/Q7260546)) | COBERTURA PARCIAL · 5 publicables en 4 universos |
| 64 | Riviera Nayarit | región | México | NULL — Wikidata no tiene coordenada (P625) para este elemento | COBERTURA PARCIAL · 1 publicables en 1 universos · 1 pendientes (ocultas) |
| 65 | Los Cabos | región | México | 23.2667, -109.7667 ([Q659516](https://www.wikidata.org/wiki/Q659516)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 1 pendientes (ocultas) · 1 cerradas por temporada |
| 66 | San José del Cabo | localidad | Los Cabos | 23.0617, -109.7114 ([Q2088134](https://www.wikidata.org/wiki/Q2088134)) | COBERTURA PARCIAL · 16 publicables en 7 universos · 1 cerradas por temporada |
| 67 | Todos Santos | localidad | México | 23.4469, -110.2231 ([Q1658489](https://www.wikidata.org/wiki/Q1658489)) | COBERTURA PARCIAL · 6 publicables en 5 universos · 1 pendientes (ocultas) |
| 68 | Cancún | localidad | México | 21.1614, -86.8248 ([Q8969](https://www.wikidata.org/wiki/Q8969)) | COBERTURA PARCIAL · 7 publicables en 5 universos · 2 pendientes (ocultas) |
| 69 | Riviera Maya | región | México | 20.6314, -87.0731 ([Q2061038](https://www.wikidata.org/wiki/Q2061038)) | COBERTURA PARCIAL · 6 publicables en 5 universos · 3 pendientes (ocultas) |
| 70 | Tulum | localidad | México | 20.2147, -87.4289 ([Q725883](https://www.wikidata.org/wiki/Q725883)) | COBERTURA PARCIAL · 14 publicables en 5 universos · 2 pendientes (ocultas) |
| 71 | Mérida | localidad | México | 20.97, -89.62 ([Q165204](https://www.wikidata.org/wiki/Q165204)) | COBERTURA PARCIAL · 9 publicables en 4 universos |
| 72 | Oaxaca | localidad | México | 17.0606, -96.7253 ([Q131429](https://www.wikidata.org/wiki/Q131429)) | COBERTURA PARCIAL · 8 publicables en 3 universos · 8 pendientes (ocultas) |
| 73 | Valle de Guadalupe | región | México | 32.0978, -116.5669 ([Q834310](https://www.wikidata.org/wiki/Q834310)) | COBERTURA PARCIAL · 8 publicables en 3 universos · 3 pendientes (ocultas) |
| 74 | Puebla | localidad | México | 19.0514, -98.2178 ([Q125293](https://www.wikidata.org/wiki/Q125293)) | COBERTURA PARCIAL · 7 publicables en 3 universos · 2 pendientes (ocultas) |
| 75 | Querétaro | localidad | México | 20.5881, -100.3881 ([Q173121](https://www.wikidata.org/wiki/Q173121)) | COBERTURA PARCIAL · 7 publicables en 3 universos · 2 pendientes (ocultas) |
| 76 | Monterrey | localidad | México | 25.6844, -100.3181 ([Q81033](https://www.wikidata.org/wiki/Q81033)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 8 pendientes (ocultas) |

**Medio Oriente**

| # | Destino | Tipo | Dentro de | Coordenadas (Wikidata) | Tras cargar la curaduría de oct-2026 (réplica local) |
|---|---|---|---|---|---|
| 77 | Dubái | localidad | Emiratos Árabes Unidos | 25.2697, 55.3094 ([Q612](https://www.wikidata.org/wiki/Q612)) | COBERTURA PARCIAL · 13 publicables en 3 universos · 3 pendientes (ocultas) · 1 cerradas por temporada |
| 78 | Abu Dabi | localidad | Emiratos Árabes Unidos | 24.4511, 54.3969 ([Q1519](https://www.wikidata.org/wiki/Q1519)) | COBERTURA PARCIAL · 7 publicables en 4 universos · 2 pendientes (ocultas) |
| 79 | Doha | localidad | Catar | 25.2861, 51.5294 ([Q3861](https://www.wikidata.org/wiki/Q3861)) | COBERTURA PARCIAL · 8 publicables en 5 universos · 1 pendientes (ocultas) |
| 80 | Riad | localidad | Arabia Saudita | 24.6383, 46.715 ([Q3692](https://www.wikidata.org/wiki/Q3692)) | COBERTURA PARCIAL · 6 publicables en 2 universos · 3 pendientes (ocultas) |
| 81 | Omán · destinos destacados | país-destino | — | 21, 57 ([Q842](https://www.wikidata.org/wiki/Q842)) | COBERTURA PARCIAL · 2 publicables en 2 universos · 3 pendientes (ocultas) |
| 82 | Mascate | localidad | Omán · destinos destacados | 23.6139, 58.5922 ([Q3826](https://www.wikidata.org/wiki/Q3826)) | COBERTURA PARCIAL · 3 publicables en 3 universos · 1 pendientes (ocultas) |

**Asia y Oceanía**

| # | Destino | Tipo | Dentro de | Coordenadas (Wikidata) | Tras cargar la curaduría de oct-2026 (réplica local) |
|---|---|---|---|---|---|
| 83 | Tokio | localidad | Japón | 35.6894, 139.6917 ([Q1490](https://www.wikidata.org/wiki/Q1490)) | COBERTURA PARCIAL · 15 publicables en 6 universos · 1 pendientes (ocultas) |
| 84 | Kioto | localidad | Japón | 35.0116, 135.7681 ([Q34600](https://www.wikidata.org/wiki/Q34600)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 1 pendientes (ocultas) |
| 85 | Osaka | localidad | Japón | 34.6938, 135.5021 ([Q35765](https://www.wikidata.org/wiki/Q35765)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 2 pendientes (ocultas) |
| 86 | Singapur | país-destino | — | 1.3, 103.8 ([Q334](https://www.wikidata.org/wiki/Q334)) | COBERTURA PARCIAL · 16 publicables en 5 universos |
| 87 | Hong Kong | país-destino | — | 22.2783, 114.1586 ([Q8646](https://www.wikidata.org/wiki/Q8646)) | COBERTURA PARCIAL · 10 publicables en 6 universos |
| 88 | Seúl | localidad | Corea del Sur | 37.56, 126.99 ([Q8684](https://www.wikidata.org/wiki/Q8684)) | COBERTURA PARCIAL · 6 publicables en 4 universos · 3 pendientes (ocultas) |
| 89 | Bangkok | localidad | Tailandia | 13.75, 100.5167 ([Q1861](https://www.wikidata.org/wiki/Q1861)) | COBERTURA PARCIAL · 16 publicables en 5 universos · 1 cerradas por temporada |
| 90 | Phuket | región | Tailandia | 7.89, 98.3983 ([Q182565](https://www.wikidata.org/wiki/Q182565)) | COBERTURA PARCIAL · 10 publicables en 5 universos |
| 91 | Bali | región | Indonesia | -8.5, 115 ([Q3125978](https://www.wikidata.org/wiki/Q3125978)) | COBERTURA PARCIAL · 9 publicables en 5 universos |
| 92 | Yakarta | localidad | Indonesia | -6.1753, 106.8269 ([Q3630](https://www.wikidata.org/wiki/Q3630)) | COBERTURA PARCIAL · 8 publicables en 5 universos · 1 pendientes (ocultas) |
| 93 | Sídney | localidad | Australia | -33.8678, 151.21 ([Q3130](https://www.wikidata.org/wiki/Q3130)) | COBERTURA PARCIAL · 10 publicables en 6 universos |
| 94 | Melbourne | localidad | Australia | -37.8142, 144.9631 ([Q3141](https://www.wikidata.org/wiki/Q3141)) | COBERTURA PARCIAL · 11 publicables en 6 universos |
| 95 | Queenstown | localidad | Nueva Zelanda | -45.0311, 168.6625 ([Q613602](https://www.wikidata.org/wiki/Q613602)) | COBERTURA PARCIAL · 7 publicables en 4 universos · 4 pendientes (ocultas) |

**Otras regiones**

| # | Destino | Tipo | Dentro de | Coordenadas (Wikidata) | Tras cargar la curaduría de oct-2026 (réplica local) |
|---|---|---|---|---|---|
| 96 | Cartagena | localidad | Colombia | 10.4236, -75.5253 ([Q657461](https://www.wikidata.org/wiki/Q657461)) | COBERTURA PARCIAL · 9 publicables en 4 universos · 7 pendientes (ocultas) |
| 97 | Bogotá | localidad | Colombia | 4.6097, -74.0817 ([Q2841](https://www.wikidata.org/wiki/Q2841)) | COBERTURA PARCIAL · 9 publicables en 5 universos · 2 pendientes (ocultas) |
| 98 | Medellín | localidad | Colombia | 6.2502, -75.5676 ([Q48278](https://www.wikidata.org/wiki/Q48278)) | COBERTURA PARCIAL · 7 publicables en 4 universos · 1 pendientes (ocultas) |
| 99 | Buenos Aires | localidad | Argentina | -34.5997, -58.3819 ([Q1486](https://www.wikidata.org/wiki/Q1486)) | COBERTURA PARCIAL · 15 publicables en 5 universos · 2 pendientes (ocultas) |
| 100 | Mendoza | localidad | Argentina | -32.8897, -68.8444 ([Q44237](https://www.wikidata.org/wiki/Q44237)) | COBERTURA PARCIAL · 7 publicables en 3 universos · 2 pendientes (ocultas) · 1 cerradas por temporada |
| 101 | Punta del Este | localidad | Uruguay | -34.9557, -54.9381 ([Q56069](https://www.wikidata.org/wiki/Q56069)) | COBERTURA PARCIAL · 8 publicables en 3 universos · 2 pendientes (ocultas) |
| 102 | Río de Janeiro | localidad | Brasil | -22.9111, -43.2056 ([Q8678](https://www.wikidata.org/wiki/Q8678)) | COBERTURA PARCIAL · 14 publicables en 4 universos · 3 pendientes (ocultas) |
| 103 | São Paulo | localidad | Brasil | -23.5504, -46.6339 ([Q174](https://www.wikidata.org/wiki/Q174)) | COBERTURA PARCIAL · 15 publicables en 5 universos · 1 pendientes (ocultas) |
| 104 | Lima | localidad | Perú | -12.06, -77.0375 ([Q2868](https://www.wikidata.org/wiki/Q2868)) | COBERTURA PARCIAL · 15 publicables en 5 universos · 1 pendientes (ocultas) |
| 105 | Cusco | localidad | Perú | -13.5169, -71.9786 ([Q5582862](https://www.wikidata.org/wiki/Q5582862)) | COBERTURA PARCIAL · 8 publicables en 4 universos · 1 pendientes (ocultas) |
| 106 | Marrakech | localidad | Marruecos | 31.6295, -7.9811 ([Q101625](https://www.wikidata.org/wiki/Q101625)) | COBERTURA PARCIAL · 15 publicables en 5 universos · 1 pendientes (ocultas) |
| 107 | Ciudad del Cabo | localidad | Sudáfrica | -33.9253, 18.4239 ([Q5465](https://www.wikidata.org/wiki/Q5465)) | COBERTURA PARCIAL · 11 publicables en 5 universos · 1 pendientes (ocultas) |
| 108 | Seychelles | país-destino | — | -7.1, 52.7667 ([Q1042](https://www.wikidata.org/wiki/Q1042)) | COBERTURA PARCIAL · 6 publicables en 4 universos · 2 pendientes (ocultas) |
| 109 | Mauricio | país-destino | — | -20.2, 57.5 ([Q1027](https://www.wikidata.org/wiki/Q1027)) | COBERTURA PARCIAL · 6 publicables en 4 universos · 2 pendientes (ocultas) |
| 110 | Maldivas | país-destino | — | 4.18, 73.51 ([Q826](https://www.wikidata.org/wiki/Q826)) | COBERTURA PARCIAL · 9 publicables en 4 universos · 1 pendientes (ocultas) |
| 111 | Bora Bora | localidad | Polinesia Francesa | -16.498, -151.736 ([Q183113](https://www.wikidata.org/wiki/Q183113)) | COBERTURA PARCIAL · 3 publicables en 3 universos · 4 pendientes (ocultas) |

## 4. Qué se reutilizó, qué se construyó y qué se corrigió

- **Reutilizado:** `app_flags` para los umbrales; el normalizador de textos del viaje activo como referencia; Wikidata (fuente pública) para coordenadas.
- **Construido:** `prive_destinations`, `prive_destination_aliases` (254 sobrenombres), `prive_destination_members`, `prive_resolve_destination`, `prive_destination_root` (familia de destinos para duplicados) y `prive_destination_coverage`.
- **Corregido:** ya no hay ciudades escritas a mano como fuente de verdad del catálogo (Members Only conserva su lista mientras siga activo); la lista de trabajo supuesta del diseño (~130 destinos) se reemplazó por la exacta del dueño.

## 5. Pruebas (resultado real)

`supabase/tests/prive_catalog/run.sh`: D1–D13 (alias, jerarquía, 111 destinos sin duplicados, coordenadas con fuente, alias duplicado rechazado, barrio de barrio rechazado, experiencia en un área rechazada) y C1–C6 (cobertura calculada, PENDIENTE y DESACTUALIZADO no cuentan, piloto con 12 VERIFICADO en 3 universos, baja a parcial con 75%) → **todas OK** dentro de las 110 de la suite. `src/test/priveCuration.test.ts` (normalización y resolución de las dos formas de curaduría) → OK.

## 6. No verificado, costos, riesgos y autorizaciones

- **No verificado:** las coordenadas NULL de la sección 3; los nombres en español de algunas regiones administrativas (no afectan la búsqueda).
- **Costo:** USD 0 (Wikidata, consulta única).
- **Riesgos:** un destino nuevo fuera de la lista se rechaza en el cargador hasta que se agregue a `destinations.mjs`; el descubrimiento bajo demanda sigue apagado.
- **Requiere autorización productiva:** aplicar `20261023100000` y `20261023100010`; encender `prive_on_demand_discovery` (gasta SerpApi) es una **decisión del dueño**.
