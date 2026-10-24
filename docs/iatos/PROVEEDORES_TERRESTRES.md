# Trenes, autobuses, ferris, autos y yates: qué es real hoy en IATOS

**Para:** el dueño de IATOS. **Fecha:** 24 de octubre de 2026. **Rama:** `claude/terrestre` (no está en producción).

## En corto

- **Ferris: precio real en vivo desde hoy.** IATOS consulta a Ferryhopper (35 países, más de 220 navieras) y muestra las salidas del día con la naviera, la hora y el precio "desde" de un asiento, con la etiqueta "en vivo · consultado HH:MM". No pide contrato ni llave.
- **Trenes, autobuses, autos y yates: todavía sin precio en IATOS.** Ningún proveedor da precios en vivo sin un contrato. Lo que sí cambió: los botones ahora abren el sitio oficial **con la búsqueda ya escrita** (origen, destino, fecha y pasajeros) y dicen "Ver horarios y precio en {operador}". IATOS nunca inventa un precio ni dice "Reservado".
- **Arreglo:** "Rentar auto" en un tramo de ida ya no pone como devolución el último día del viaje. Ahora usa el día del tramo.

## Tabla de proveedores

| Categoría | Qué usa IATOS hoy | ¿Precio real en IATOS? | Qué falta para tener precio | Cómo solicitarlo |
|---|---|---|---|---|
| **Ferry** | Ferryhopper en vivo: salidas, hora, naviera y precio "desde" (EUR, 1 pasajero). El botón abre Ferryhopper con la salida elegida. | **Sí**, en vivo, con fuente y hora de consulta | Nada para usarlo. Conviene formalizar el uso comercial y tener un código de afiliado propio (hoy los clics van con el código de Ferryhopper para asistentes de IA). | [partners.ferryhopper.com/mcp](https://partners.ferryhopper.com/mcp) (escribirles desde ahí) |
| **Tren en España** | Renfe con origen, destino, fecha y pasajeros ya escritos | No | API de venta: no existe una pública. Para precio en vivo hace falta un mayorista (abajo). | — |
| **Tren en Alemania** | Deutsche Bahn con estaciones, fecha, hora y pasajeros ya escritos | No | Igual que España | — |
| **Tren en Francia, Italia, Reino Unido, Suiza, Países Bajos, Portugal, Japón** | Portada oficial del operador (SNCF Connect, Trenitalia, Italo, National Rail, SBB, NS, CP, JR) con la instrucción "escribe origen → destino y la fecha". Ninguno recibe la ruta por enlace. | No | Un mayorista de trenes con API | Ver "Trenes en toda Europa" |
| **Trenes en toda Europa (mayoristas)** | Trainline y Omio como alternativa (sin datos precargados: sus enlaces piden códigos internos) | No | Contrato con un mayorista que dé precios en vivo | Trainline Partner Solutions: [tps.thetrainline.com](https://tps.thetrainline.com/) (contrato comercial). Omio: programa de afiliados en [Travelpayouts · Omio](https://www.travelpayouts.com/en/offers/omio-affiliate-program); su API de búsqueda en vivo se aprueba caso por caso (Omio B2B, omio.com/corporate/omio-b2b). |
| **Tren en EE. UU. (Amtrak)** | Sin cambios. No encontramos una API pública ni un enlace precargado; su sitio bloquea la verificación automática. | No | API: no pública | — |
| **Tren y autobús en el Sudeste Asiático** | 12Go con ruta, fecha y pasajeros ya escritos (Bangkok, Chiang Mai, Phuket, Krabi, Koh Samui, Hanói, Ha Long, Sapa, Ho Chi Minh, Da Lat, Siem Reap, Phnom Penh, Kuala Lumpur, Singapur) | No | Su API de precios pide aprobación | Afiliado en [Travelpayouts · 12Go](https://www.travelpayouts.com/en/offers/12go-affiliate-program) |
| **Autobús en México** | ADO: página de la ruta con origen y destino (la fecha se elige en ADO; solo las rutas que ADO publica). FlixBus: CDMX, Puebla, Querétaro, Monterrey, León, San Luis Potosí, Aguascalientes y Veracruz con fecha y pasajeros ya escritos. | No | ADO no tiene API pública; su sitio internacional usa **Distribusion**, que sí vende acceso por API a revendedores | Distribusion: [docs.distribusion.com](https://docs.distribusion.com/dt/api/getting-started/intro) (pedir llave de prueba a partner@distribusion.com) |
| **Autobús en Europa y EE. UU.** | FlixBus con ruta, fecha y pasajeros ya escritos (unas 60 ciudades); ALSA y otros: su portada | No | FlixBus da API solo a agregadores, con alta en su programa | [FlixBus · afiliados](https://global.flixbus.com/company/partners/affiliate-partners) o [Travelpayouts · FlixBus](https://www.travelpayouts.com/en/offers/flixbus-affiliate-program). Busbud (más líneas): [Travelpayouts · Busbud](https://www.travelpayouts.com/en/offers/busbud-affiliate-program) |
| **Renta de auto** | Kayak con ciudad (o recoger en una y devolver en otra) y fechas ya escritas; Discover Cars y Rentalcars abren su buscador (no reciben datos por enlace) | No | Una API de autos con precio en vivo. Hoy Travelpayouts no lista ninguna de autos con acceso abierto. | Discover Cars (dicen tener API para afiliados avanzados): [discovercars.com/affiliate](https://www.discovercars.com/affiliate). Booking.com (Rentalcars): [programa de afiliados](https://www.booking.com/affiliate-program/v2/index.html). CarTrawler (solo empresas): [cartrawler.com](https://www.cartrawler.com/). EconomyBookings y QEEQ por Travelpayouts: [EconomyBookings](https://www.travelpayouts.com/en/offers/economybookings-affiliate-program), [QEEQ](https://www.travelpayouts.com/en/offers/qeeq-affiliate-program). |
| **Yate o lancha** | Click&Boat con destino, fechas y personas ya escritos (pantalla Ferris → "Yate o lancha" y cards de Iato). En Privé, los yates siguen en el Privé Desk (solicitud manual, sin prometer disponibilidad). | No | Click&Boat no publica API; su programa de afiliados (plataforma Impact) da enlaces y comisión | [Click&Boat · afiliados](https://blog.clickandboat.com/en/?p=10461). Samboat y GetMyBoat: no encontramos programa público. |
| **Traslado (aeropuerto–hotel)** | Welcome Pickups (sin datos por enlace) y la ruta en Google Maps | No | GetTransfer da precios reales por API vía Travelpayouts, con token que entrega soporte | [GetTransfer API](https://support.travelpayouts.com/hc/en-us/articles/360016375920-GetTransfer-API) (pedir el token a support@travelpayouts.com) y [Travelpayouts · GetTransfer](https://www.travelpayouts.com/en/offers/gettransfer-affiliate-program) |

## Lo que se puede usar ya, sin contrato nuevo

1. **Ferryhopper en vivo** (ya integrado).
2. **Enlaces precargados** de Renfe, Deutsche Bahn, FlixBus, 12Go, ADO (rutas), Ferryhopper, Click&Boat y Kayak (ya integrados).
3. **Omio**: Travelpayouts da una lista de rutas populares con "precio mínimo". No es el precio del día del viaje, así que **no** se usó como precio.

## Lo que el dueño tendría que solicitar (en orden de impacto)

1. **Distribusion** (autobuses de ADO y otras líneas de México, más trenes y ferris en 70 países): un contrato da precios y venta en vivo.
2. **Trainline Partner Solutions** u **Omio B2B**: trenes de toda Europa con precio en vivo.
3. **GetTransfer** (por Travelpayouts): precios reales de traslados. Solo hay que pedir el token.
4. **Discover Cars** (API de afiliados) o **Booking.com Cars**: precio real de renta de auto.
5. **Ferryhopper**: confirmar el uso comercial y pedir código de afiliado propio.
6. **Click&Boat** (Impact): comisión por yates; no da precio por API.

## Programas de Travelpayouts que ya están en el código

Marker de IATOS **533299** en Aviasales, Hotellook, GetYourGuide, Discover Cars, Rentalcars, Trainline, Omio, Rail Europe, Ferryhopper, Direct Ferries, AFerry, Airalo, Holafly, Heymondo, Vacations To Go y CruiseDirect, y el seguimiento de Welcome Pickups. Viator va con el afiliado directo de IATOS. El redirect `tp.media` sigue roto desde octubre (responde 400): los enlaces abren el sitio directo y la atribución depende del script Drive de Travelpayouts (pendiente BB-02).

## Cómo se comprobó

Cada enlace precargado se abrió con un navegador real el 24 de octubre de 2026. Las capturas están en `docs/iatos/evidencia/terrestre/`:

- `T-RENFE.jpg`: Madrid (Todas) → Barcelona (Todas), martes 10 de noviembre.
- `T-RENFE-CORDOBA.jpg`: Madrid → Córdoba-Julio Anguita, viernes 7 de mayo.
- `T-FLIXBUS-EU.jpg` y `T-FLIXBUS-MX.jpg`: Berlín → Múnich y CDMX → Puebla, con fecha y 2 adultos.
- `T-12GO.jpg`: Bangkok → Chiang Mai.
- `T-FERRYHOPPER.jpg`: Barcelona → Palma, 2 pasajeros, 3 salidas.
- `T-CLICKANDBOAT.jpg`: Cancún, México, con fechas.
- Deutsche Bahn: su formulario quedó lleno ("Berlin Hbf → München Hbf, 10. Nov"), pero DB bloquea la lista de trenes a navegadores automáticos (`T-DB-BLOQUEADO.jpg`). Conviene abrirlo una vez a mano.

Lo que **no** funcionó y por eso no se usa:

- DB sin número de estación (`A-DB-SIN-ID.jpg`).
- ADO con fecha (`A-ADO-SIN-FECHA.jpg`).
- Click&Boat sin país (`A-CLICKANDBOAT-SIN-PAIS.jpg`).

Los códigos de estación salen de los propios sitios: la lista pública de estaciones de renfe.com, los números de estación de bahnhof.de (Deutsche Bahn) y el buscador de ciudades de FlixBus.
