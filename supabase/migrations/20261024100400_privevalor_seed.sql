-- IATOS Privé · privevalor 5/6 · Siembra verificada (2026-10). GENERADA por scripts/prive/load_value_curation.mjs
-- desde data/prive/valor/2026-10/drops.json e insider.json: solo oportunidades y consejos leídos en páginas
-- oficiales públicas, con URL y fecha de verificación (ver docs/iatos/prive_reimagined/PRIVEVALOR.md §Fuentes).
-- Pasa por los mismos importadores que la curaduría mensual (validación de la base por fila). Upsert por slug:
-- idempotente. Los Drops se vuelven "por verificar" solos a los 45 días y desaparecen al vencer.
-- Ningún beneficio de tarjeta ni beneficio IATOS: no hay ninguno verificable / no hay convenios.
DO $seed$
DECLARE r jsonb;
BEGIN
  r := public.prive_drops_import_batch($pv$[
 {
  "slug": "louvre-primer-viernes-gratis",
  "type": "promocion_publica",
  "destination_slug": "paris",
  "title_es": "Museo del Louvre: entrada gratuita el primer viernes del mes desde las 18:00",
  "title_en": "Louvre Museum: free admission on the first Friday of the month after 6 p.m.",
  "provider_name": "Musée du Louvre",
  "provider_url": "https://www.louvre.fr",
  "benefit_es": "Entrada gratuita para todos los visitantes el primer viernes de cada mes después de las 18:00 (excepto en julio y agosto) y el 14 de julio.",
  "benefit_en": "Free admission for all visitors on the first Friday of every month after 6 p.m. (except July and August) and on 14 July.",
  "conditions_es": "El museo recomienda reservar horario también para la entrada gratuita. Del 17 de octubre al 1 de noviembre de 2026 la reservación es obligatoria para todos los visitantes. Toda salida del museo es definitiva.",
  "conditions_en": "The museum recommends booking a time slot even for free admission. From 17 October to 1 November 2026 a reservation is required for all visitors. Any exit is final.",
  "eligibility_es": "Todos los visitantes.",
  "eligibility_en": "All visitors.",
  "restrictions_es": "No aplica en julio ni en agosto (salvo el 14 de julio). Los martes el museo cierra.",
  "restrictions_en": "Not available in July or August (except 14 July). The museum is closed on Tuesdays.",
  "source_url": "https://www.louvre.fr/en/visit/hours-admission",
  "source_name": "Musée du Louvre · Hours & admission",
  "link_url": "https://ticket.louvre.fr/en",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "universes": [
   "culture_access"
  ],
  "interests": [
   "arte",
   "cultura",
   "viajes_internacionales"
  ]
 },
 {
  "slug": "mna-domingos-sin-costo",
  "type": "promocion_publica",
  "destination_slug": "cdmx",
  "title_es": "Museo Nacional de Antropología: domingos sin costo para mexicanos y residentes",
  "title_en": "National Museum of Anthropology: free Sundays for Mexican nationals and residents",
  "provider_name": "INAH · Museo Nacional de Antropología",
  "provider_url": "https://www.inah.gob.mx",
  "benefit_es": "Los domingos la entrada es gratuita para las personas mexicanas y para extranjeros residentes en México.",
  "benefit_en": "On Sundays admission is free for Mexican nationals and for foreign residents of Mexico.",
  "conditions_es": "Abre de martes a domingo de 9:00 a 18:00 h. Los extranjeros residentes presentan un documento probatorio de residencia. La entrada general publicada es de $210 MXN.",
  "conditions_en": "Open Tuesday to Sunday, 9 a.m. to 6 p.m. Foreign residents must show proof of residency. The published general admission is MXN 210.",
  "eligibility_es": "Personas mexicanas y extranjeros con residencia en México. Quien no tiene residencia paga la tarifa general.",
  "eligibility_en": "Mexican nationals and foreign residents of Mexico. Visitors without residency pay the general rate.",
  "restrictions_es": "El precio entre semana para nacionales y residentes no coincide entre dos publicaciones oficiales del INAH; confírmalo en taquilla.",
  "restrictions_en": "The weekday price for nationals and residents differs between two official INAH publications; confirm it at the ticket office.",
  "valid_from": "2026-01-01",
  "valid_until": "2026-12-31",
  "source_url": "https://www.inah.gob.mx/images/boletines/2026/6/Boletin%206.pdf",
  "source_name": "INAH · Boletín No. 6 (6 de enero de 2026) y ficha oficial del museo",
  "link_url": "https://www.inah.gob.mx/museos/museo-nacional-de-antropologia",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "universes": [
   "culture_access",
   "signature_mexico"
  ],
  "interests": [
   "cultura",
   "arte",
   "mexico"
  ],
  "curation_notes": "valid_until = fin del año de tarifas 2026 verificado; revisar en enero de 2027."
 },
 {
  "slug": "casino-monte-carlo-entrada-tarde",
  "type": "tarifa_publicada",
  "destination_slug": "mc",
  "title_es": "Casino de Monte-Carlo: entrada de la tarde con €10 incluidos",
  "title_en": "Monte-Carlo Casino: afternoon entry with €10 included",
  "provider_name": "Monte-Carlo Société des Bains de Mer",
  "provider_url": "https://www.montecarlosbm.com",
  "benefit_es": "La entrada a las salas de juego desde las 14:00 cuesta €20 e incluye €10 para usar en las máquinas, el bar o el restaurante Le Salon Rose.",
  "benefit_en": "Entry to the gaming rooms from 2 p.m. costs €20 and includes €10 to use on the slot machines, at the bar or at Le Salon Rose restaurant.",
  "conditions_es": "Para usar los €10 en Le Salon Rose hay que consumir €40 o más. Salas de juego solo para mayores de 18 años con pasaporte vigente con foto (no se aceptan copias ni identificaciones digitales) y respetando el código de vestimenta.",
  "conditions_en": "To use the €10 at Le Salon Rose you must spend €40 or more. Gaming rooms are for adults over 18 with a valid photo passport (no photocopies or digital ID) and the dress code applies.",
  "eligibility_es": "Visitantes mayores de 18 años. Es la tarifa publicada para cualquier visitante.",
  "eligibility_en": "Visitors over 18. This is the published rate for any visitor.",
  "offer_price": 20,
  "price_currency": "EUR",
  "price_source_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "source_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "source_name": "Monte-Carlo SBM · Prices and conditions of entry",
  "link_url": "https://www.montecarlosbm.com/en/casino-monaco/casino-monte-carlo",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "universes": [
   "casino_grand_nights"
  ],
  "interests": [
   "experiencias_extraordinarias",
   "viajes_internacionales"
  ]
 },
 {
  "slug": "my-monte-carlo-entrada-casino",
  "type": "beneficio_lealtad",
  "destination_slug": "mc",
  "title_es": "My Monte-Carlo: entrada al casino sin costo para niveles Silver, Gold y Platinum",
  "title_en": "My Monte-Carlo: free casino entry for Silver, Gold and Platinum members",
  "provider_name": "Monte-Carlo Société des Bains de Mer · My Monte-Carlo",
  "provider_url": "https://www.montecarlosbm.com",
  "benefit_es": "La entrada al Casino de Monte-Carlo es gratuita para miembros My Monte-Carlo Silver, Gold o Platinum.",
  "benefit_en": "Entry to the Monte-Carlo Casino is free for My Monte-Carlo Silver, Gold or Platinum members.",
  "conditions_es": "El acceso gratuito de miembros solo aplica cuando abren las mesas de juego. Aplican la edad mínima de 18 años, el pasaporte con foto y el código de vestimenta.",
  "conditions_en": "Members' free access only applies once the gaming tables open. The 18+ age rule, photo passport and dress code apply.",
  "eligibility_es": "Miembros My Monte-Carlo con nivel Silver, Gold o Platinum. Confirma tu nivel en tu cuenta: otros niveles no lo incluyen.",
  "eligibility_en": "My Monte-Carlo members at Silver, Gold or Platinum level. Check your level in your account: other levels are not included.",
  "source_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "source_name": "Monte-Carlo SBM · Prices and conditions of entry",
  "link_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "program_match": [
   "my monte carlo",
   "monte carlo sbm"
  ],
  "universes": [
   "casino_grand_nights"
  ],
  "interests": [
   "experiencias_extraordinarias"
  ]
 },
 {
  "slug": "marriott-bonvoy-nightly-upgrade-awards",
  "type": "beneficio_lealtad",
  "title_es": "Marriott Bonvoy: mejoras de habitación con puntos para Gold Elite y superiores",
  "title_en": "Marriott Bonvoy: Nightly Upgrade Awards for Gold Elite and above",
  "provider_name": "Marriott Bonvoy",
  "provider_url": "https://www.marriott.com",
  "benefit_es": "Canjea puntos por una mejora de habitación por noche (Nightly Upgrade Award): después de reservar, se solicita desde la página de confirmación o de detalles de la reservación.",
  "benefit_en": "Redeem points for a Nightly Upgrade Award: after booking, request it from the Confirmation or Reservation Details page.",
  "conditions_es": "La página oficial de canje lo indica para miembros Gold Elite y superiores. Revisa las condiciones completas en las preguntas frecuentes oficiales de Nightly Upgrade Awards antes de contar con la mejora.",
  "conditions_en": "The official redemption page lists it for Gold Elite members and above. Review the full terms in the official Nightly Upgrade Awards FAQ before relying on an upgrade.",
  "eligibility_es": "Miembros Marriott Bonvoy Gold Elite o de nivel superior.",
  "eligibility_en": "Marriott Bonvoy Gold Elite members or higher.",
  "source_url": "https://www.marriott.com/loyalty/redeem.mi",
  "source_name": "Marriott Bonvoy · Redeem points",
  "link_url": "https://www.marriott.com/loyalty/nightly-upgrade-awards.mi",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "program_match": [
   "marriott",
   "bonvoy"
  ],
  "universes": [
   "private_stays"
  ],
  "interests": [
   "hoteles_y_villas",
   "viajes_internacionales"
  ]
 },
 {
  "slug": "marriott-bonvoy-noches-con-puntos",
  "type": "beneficio_lealtad",
  "title_es": "Marriott Bonvoy: noches de hotel con puntos desde 12,000 por noche",
  "title_en": "Marriott Bonvoy: free nights from 12,000 points per night",
  "provider_name": "Marriott Bonvoy",
  "provider_url": "https://www.marriott.com",
  "benefit_es": "Canjea puntos Marriott Bonvoy por noches de hotel; la página oficial publica estancias desde 12,000 puntos por noche.",
  "benefit_en": "Redeem Marriott Bonvoy points for hotel nights; the official page lists stays starting at 12,000 points per night.",
  "conditions_es": "Los puntos necesarios varían según el hotel y la fecha. Los Free Night Awards se aplican al reservar y se pueden usar en miles de hoteles, con valores distintos.",
  "conditions_en": "Points required vary by hotel and date. Free Night Awards are applied during booking and can be used at thousands of properties with varying point values.",
  "eligibility_es": "Miembros Marriott Bonvoy con puntos suficientes en su cuenta.",
  "eligibility_en": "Marriott Bonvoy members with enough points.",
  "source_url": "https://www.marriott.com/loyalty/redeem.mi",
  "source_name": "Marriott Bonvoy · Redeem points",
  "link_url": "https://www.marriott.com/loyalty/redeem.mi",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "program_match": [
   "marriott",
   "bonvoy"
  ],
  "universes": [
   "private_stays"
  ],
  "interests": [
   "hoteles_y_villas",
   "viajes_internacionales"
  ]
 },
 {
  "slug": "japon-tarjetas-ic-visitantes-sin-deposito",
  "type": "tarifa_publicada",
  "destination_slug": "tokio",
  "title_es": "Japón: tarjetas IC para visitantes sin depósito (Welcome Suica y TOURIST PASMO)",
  "title_en": "Japan: visitor IC cards with no deposit (Welcome Suica and TOURIST PASMO)",
  "provider_name": "JNTO · Japan National Tourism Organization",
  "provider_url": "https://www.japan.travel",
  "benefit_es": "La mayoría de las tarjetas IC piden un depósito de 500 yenes; las tarjetas especiales para visitantes internacionales, como Welcome Suica y TOURIST PASMO, se venden sin depósito.",
  "benefit_en": "Most IC cards require a 500-yen deposit; special cards for international visitors such as Welcome Suica and TOURIST PASMO are sold without one.",
  "conditions_es": "Sirven en trenes, autobuses y barcos, en muchas máquinas expendedoras, tiendas de conveniencia y algunos taxis. PASMO indica venta en los aeropuertos de Haneda y Narita.",
  "conditions_en": "They work on trains, buses and boats, at many vending machines, convenience stores and some taxis. PASMO lists sales at Haneda and Narita airports.",
  "eligibility_es": "Visitantes internacionales.",
  "eligibility_en": "International visitors.",
  "source_url": "https://www.japan.travel/es/plan/ic-card/",
  "source_name": "JNTO · Tarjetas IC de viaje",
  "link_url": "https://www.pasmo.co.jp/visitors/en/",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "universes": [],
  "interests": [
   "viajes_internacionales"
  ]
 },
 {
  "slug": "editorial-gp-monaco-2027",
  "type": "editorial",
  "destination_slug": "mc",
  "title_es": "Gran Premio de Mónaco 2027: del 4 al 6 de junio",
  "title_en": "Monaco Grand Prix 2027: 4–6 June",
  "provider_name": "Formula 1",
  "provider_url": "https://www.formula1.com",
  "benefit_es": "Fechas publicadas en el calendario oficial de Fórmula 1 2027. Si quieres vivirlo, tómalo en cuenta al planear hotel y mesas; si no vienes por la carrera, considera otras fechas.",
  "benefit_en": "Dates from the official 2027 Formula 1 calendar. If you want to be there, factor it into hotel and dinner plans; if you are not coming for the race, consider other dates.",
  "valid_until": "2027-06-06",
  "source_url": "https://www.formula1.com/en/racing/2027",
  "source_name": "Formula 1 · Calendario 2027",
  "link_url": "https://www.formula1.com/en/racing/2027",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "universes": [
   "iconic_events",
   "sport_leisure"
  ],
  "interests": [
   "formula_1",
   "deportes",
   "eventos_internacionales"
  ]
 },
 {
  "slug": "editorial-gp-cdmx-2027",
  "type": "editorial",
  "destination_slug": "cdmx",
  "title_es": "Gran Premio de la Ciudad de México 2027: del 29 al 31 de octubre",
  "title_en": "Mexico City Grand Prix 2027: 29–31 October",
  "provider_name": "Formula 1",
  "provider_url": "https://www.formula1.com",
  "benefit_es": "Fechas publicadas en el calendario oficial de Fórmula 1 2027. Útil para planear con tiempo si quieres ir, o para evitar esas fechas si viajas por otros motivos.",
  "benefit_en": "Dates from the official 2027 Formula 1 calendar. Useful to plan ahead if you want to go, or to avoid those dates if you travel for other reasons.",
  "valid_until": "2027-10-31",
  "source_url": "https://www.formula1.com/en/racing/2027",
  "source_name": "Formula 1 · Calendario 2027",
  "link_url": "https://www.formula1.com/en/racing/2027",
  "last_verified_at": "2026-10-22T15:00:00Z",
  "verified_by": "privevalor · lectura de la página oficial",
  "universes": [
   "iconic_events",
   "sport_leisure"
  ],
  "interests": [
   "formula_1",
   "deportes",
   "mexico"
  ]
 }
]$pv$::jsonb, 'valor-2026-10', false);
  IF jsonb_array_length(r->'rejected') > 0 THEN RAISE EXCEPTION 'siembra de Drops rechazada: %', r->'rejected'; END IF;
  r := public.prive_insider_import_batch($pv$[
 {
  "slug": "paris-louvre-cierra-martes",
  "destination_slug": "paris",
  "category": "errores",
  "before_you_go": true,
  "rank": 1,
  "title_es": "El Louvre cierra los martes",
  "title_en": "The Louvre is closed on Tuesdays",
  "body_es": "Abre lunes, jueves, sábado y domingo de 9:00 a 18:00, y miércoles y viernes hasta las 21:00. El último acceso es una hora antes del cierre. Cierra el 1 de enero, el 1 de mayo y el 25 de diciembre.",
  "body_en": "Open Monday, Thursday, Saturday and Sunday 9 a.m.–6 p.m., and until 9 p.m. on Wednesday and Friday. Last entry is one hour before closing. Closed on 1 January, 1 May and 25 December.",
  "source_url": "https://www.louvre.fr/en/visit/hours-admission",
  "source_name": "Musée du Louvre · Hours & admission",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "paris-louvre-reserva-obligatoria-otono-2026",
  "destination_slug": "paris",
  "category": "reservar_antes",
  "before_you_go": true,
  "rank": 2,
  "valid_until": "2026-11-01",
  "title_es": "Louvre: reservación obligatoria hasta el 1 de noviembre de 2026",
  "title_en": "Louvre: reservation required until 1 November 2026",
  "body_es": "Del 17 de octubre al 1 de noviembre de 2026 todos los visitantes deben reservar horario (con excepciones para algunos titulares de tarjetas, con comprobante). Fuera de esas fechas el museo recomienda reservar horario, incluso con entrada gratuita.",
  "body_en": "From 17 October to 1 November 2026 every visitor must book a time slot (some cardholders are exempt with proof). Outside those dates the museum recommends booking a slot, even for free admission.",
  "source_url": "https://www.louvre.fr/en/visit/hours-admission",
  "source_name": "Musée du Louvre · Hours & admission",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "paris-louvre-tarifa-fuera-eee",
  "destination_slug": "paris",
  "category": "reservar_antes",
  "before_you_go": true,
  "rank": 3,
  "title_es": "Louvre: la entrada para visitantes de fuera del EEE cuesta €32",
  "title_en": "Louvre: admission for non-EEA visitors is €32",
  "body_es": "Desde el 14 de enero de 2026 la entrada cuesta €32 para quienes no residen ni son ciudadanos del Espacio Económico Europeo, y €22 para residentes y ciudadanos del EEE. Los menores de 18 años entran gratis con identificación.",
  "body_en": "Since 14 January 2026 admission is €32 for non-residents and non-citizens of the European Economic Area, and €22 for EEA residents and citizens. Under-18s enter free with ID.",
  "source_url": "https://www.louvre.fr/en/visit/hours-admission",
  "source_name": "Musée du Louvre · Hours & admission",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "paris-louvre-salida-definitiva",
  "destination_slug": "paris",
  "category": "itinerario",
  "before_you_go": true,
  "rank": 4,
  "title_es": "En el Louvre, salir es definitivo",
  "title_en": "At the Louvre, leaving is final",
  "body_es": "La página oficial lo advierte: cualquier salida es final. Decide qué quieres ver, y dónde vas a comer, antes de entrar.",
  "body_en": "The official page is clear: any exit is final. Decide what you want to see, and where you will eat, before you go in.",
  "source_url": "https://www.louvre.fr/en/visit/hours-admission",
  "source_name": "Musée du Louvre · Hours & admission",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "paris-louvre-primer-viernes",
  "destination_slug": "paris",
  "category": "ocasiones",
  "before_you_go": false,
  "rank": 10,
  "title_es": "Primer viernes del mes: el Louvre de noche y sin costo",
  "title_en": "First Friday of the month: the Louvre at night, free",
  "body_es": "El primer viernes de cada mes después de las 18:00 la entrada es gratuita para todos (excepto en julio y agosto), igual que el 14 de julio. El museo recomienda reservar horario.",
  "body_en": "On the first Friday of every month after 6 p.m. admission is free for everyone (except July and August), as on 14 July. The museum recommends booking a slot.",
  "source_url": "https://www.louvre.fr/en/visit/hours-admission",
  "source_name": "Musée du Louvre · Hours & admission",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "monaco-casino-pasaporte-fisico",
  "destination_slug": "mc",
  "category": "documentos",
  "before_you_go": true,
  "rank": 1,
  "title_es": "Casino de Monte-Carlo: lleva tu pasaporte físico",
  "title_en": "Monte-Carlo Casino: bring your physical passport",
  "body_es": "Para entrar a las salas de juego (desde las 14:00) hay que haber cumplido 18 años y presentar un pasaporte vigente con foto (o identificación nacional si eres ciudadano de la UE). No aceptan fotocopias ni identificaciones digitales.",
  "body_en": "To enter the gaming rooms (from 2 p.m.) you must be over 18 and show a valid photo passport (or national ID for EU citizens). Photocopies and digital ID are not accepted.",
  "source_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "source_name": "Monte-Carlo SBM · Prices and conditions of entry",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "monaco-casino-codigo-vestimenta",
  "destination_slug": "mc",
  "category": "vestimenta",
  "before_you_go": true,
  "rank": 2,
  "title_es": "El código de vestimenta del casino se aplica en la puerta",
  "title_en": "The casino dress code is enforced at the door",
  "body_es": "En las salas de juego no se permiten shorts ni bermudas, jeans rotos, ropa deportiva, tenis, sandalias para hombre, camisetas sin mangas ni ropa de playa; después de las 19:00 tampoco playeras ni sudaderas. El personal del casino decide.",
  "body_en": "Gaming rooms do not allow shorts, ripped jeans, sportswear, trainers, men's flip-flops or sandals, vest tops or beachwear; after 7 p.m. T-shirts and sweatshirts are not allowed either. Casino staff decide.",
  "source_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "source_name": "Monte-Carlo SBM · Prices and conditions of entry",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "monaco-casino-visita-matutina",
  "destination_slug": "mc",
  "category": "itinerario",
  "before_you_go": true,
  "rank": 3,
  "title_es": "Para conocer el casino sin jugar, ve por la mañana",
  "title_en": "To see the casino without gambling, go in the morning",
  "body_es": "Las visitas patrimoniales son de 10:00 a 13:00 (último acceso 12:15): adultos €20, de 13 a 17 años €15 y de 6 a 12 años gratis. En la mañana no hay límite de edad y se permiten playeras y tenis.",
  "body_en": "Heritage visits run 10 a.m.–1 p.m. (last entry 12:15): adults €20, ages 13–17 €15, ages 6–12 free. Mornings have no age limit and T-shirts and trainers are allowed.",
  "source_url": "https://www.montecarlosbm.com/en/casino/game/prices-and-conditions-entry",
  "source_name": "Monte-Carlo SBM · Prices and conditions of entry",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "monaco-gran-premio-2027",
  "destination_slug": "mc",
  "category": "temporada",
  "before_you_go": true,
  "rank": 4,
  "valid_until": "2027-06-06",
  "title_es": "Gran Premio de Mónaco 2027: 4 al 6 de junio",
  "title_en": "Monaco Grand Prix 2027: 4–6 June",
  "body_es": "Según el calendario oficial de Fórmula 1, la carrera de 2027 es del 4 al 6 de junio. Si tu viaje cae en esas fechas, tómalo en cuenta al reservar hotel y mesas.",
  "body_en": "According to the official Formula 1 calendar, the 2027 race runs 4–6 June. If your trip falls on those dates, factor it into hotel and dinner bookings.",
  "source_url": "https://www.formula1.com/en/racing/2027",
  "source_name": "Formula 1 · Calendario 2027",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "cdmx-antropologia-cierra-lunes",
  "destination_slug": "cdmx",
  "category": "errores",
  "before_you_go": true,
  "rank": 1,
  "title_es": "El Museo Nacional de Antropología cierra los lunes",
  "title_en": "The National Museum of Anthropology is closed on Mondays",
  "body_es": "Abre de martes a domingo de 9:00 a 18:00 h. Es de los museos más visitados del país: el INAH reporta 5,048,893 visitantes en 2025, así que conviene llegar temprano.",
  "body_en": "Open Tuesday to Sunday, 9 a.m.–6 p.m. It is one of Mexico's most visited museums: INAH reports 5,048,893 visitors in 2025, so arrive early.",
  "source_url": "https://www.inah.gob.mx/museos/museo-nacional-de-antropologia",
  "source_name": "INAH · Museo Nacional de Antropología (ficha y Boletín No. 6/2026)",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "cdmx-antropologia-domingos",
  "destination_slug": "cdmx",
  "category": "costumbres",
  "before_you_go": true,
  "rank": 2,
  "valid_until": "2026-12-31",
  "title_es": "Domingos: entrada libre para mexicanos y residentes",
  "title_en": "Sundays: free entry for Mexican nationals and residents",
  "body_es": "Los domingos la entrada al Museo Nacional de Antropología es gratuita para personas mexicanas y extranjeros residentes (con documento probatorio). Quien no tiene residencia paga la tarifa general de $210 MXN.",
  "body_en": "On Sundays the National Museum of Anthropology is free for Mexican nationals and foreign residents (with proof). Visitors without residency pay the general MXN 210 rate.",
  "source_url": "https://www.inah.gob.mx/images/boletines/2026/6/Boletin%206.pdf",
  "source_name": "INAH · Boletín No. 6 (6 de enero de 2026)",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "cdmx-gran-premio-2027",
  "destination_slug": "cdmx",
  "category": "temporada",
  "before_you_go": true,
  "rank": 3,
  "valid_until": "2027-10-31",
  "title_es": "Gran Premio de la Ciudad de México 2027: 29 al 31 de octubre",
  "title_en": "Mexico City Grand Prix 2027: 29–31 October",
  "body_es": "Según el calendario oficial de Fórmula 1, la carrera de 2027 es del 29 al 31 de octubre. Si viajas esos días por otro motivo, tenlo presente al planear hotel y traslados.",
  "body_en": "According to the official Formula 1 calendar, the 2027 race runs 29–31 October. If you travel those days for another reason, keep it in mind for hotels and transfers.",
  "source_url": "https://www.formula1.com/en/racing/2027",
  "source_name": "Formula 1 · Calendario 2027",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "los-cabos-banderas-y-playas",
  "destination_slug": "los-cabos",
  "category": "seguridad",
  "before_you_go": true,
  "rank": 1,
  "title_es": "No todas las playas son para nadar: guíate por las banderas",
  "title_en": "Not every beach is for swimming: follow the flags",
  "body_es": "Visit Los Cabos advierte que algunas playas tienen oleaje fuerte, corrientes de resaca y contracorrientes. Para nadar recomienda bahías protegidas como Médano y Playa del Amor, o Acapulquito y Chileno en el corredor. Bandera verde: aguas seguras; negra o roja: peligro.",
  "body_en": "Visit Los Cabos warns that some beaches have rough surf, rip currents and undertows. For swimming it points to protected bays such as Medano and Lovers Beach, or Acapulquito and Chileno on the corridor. Green flag: safe; black or red: danger.",
  "source_url": "https://www.visitloscabos.travel/things-to-do/beaches/swimming-and-safety/",
  "source_name": "Visit Los Cabos · Swimming & Safety",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "los-cabos-temporada-ballenas",
  "destination_slug": "los-cabos",
  "category": "temporada",
  "before_you_go": true,
  "rank": 2,
  "months": [
   12,
   1,
   2,
   3,
   4
  ],
  "title_es": "Temporada de ballenas: de diciembre a abril",
  "title_en": "Whale season: December to April",
  "body_es": "Ballenas gris y jorobada se observan de diciembre a abril, igual que el tiburón ballena. La oficina de turismo recomienda reservar los tours con anticipación porque suelen llenarse.",
  "body_en": "Gray and humpback whales can be seen from December to April, as can whale sharks. The tourism board advises booking tours early because they tend to fill up.",
  "source_url": "https://www.visitloscabos.travel/things-to-do/tours-and-activities/whale-watching/",
  "source_name": "Visit Los Cabos · Whale Watching",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "nueva-york-taxi-jfk-tarifa-fija",
  "destination_slug": "nueva-york",
  "category": "transporte",
  "before_you_go": true,
  "rank": 1,
  "title_es": "Taxi entre JFK y Manhattan: tarifa fija de $70",
  "title_en": "JFK–Manhattan taxi: $70 flat fare",
  "body_es": "Los taxis cobran $70 fijos entre JFK y Manhattan, más recargos publicados por la TLC: $0.50 MTA, $1 de mejora, $5 en hora pico (16:00–20:00 entre semana), el recargo de congestión al sur de la calle 96, peajes y propina.",
  "body_en": "Taxis charge a $70 flat fare between JFK and Manhattan, plus TLC surcharges: $0.50 MTA, $1 improvement, $5 rush hour (4–8 p.m. weekdays), the congestion surcharge south of 96th Street, tolls and tip.",
  "source_url": "https://www.nyc.gov/site/tlc/passengers/taxi-fare.page",
  "source_name": "NYC Taxi & Limousine Commission · Taxi Fare",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "nueva-york-taxi-sin-cargo-maletas",
  "destination_slug": "nueva-york",
  "category": "transporte",
  "before_you_go": true,
  "rank": 2,
  "title_es": "Taxi: sin cargo por maletas ni por pagar con tarjeta",
  "title_en": "Taxi: no charge for bags or for paying by card",
  "body_es": "La TLC indica que no hay cargo extra por pasajeros adicionales, equipaje ni por pagar con tarjeta. En la pantalla debe aparecer \"Rate #01 – Standard City Rate\" y conviene pedir siempre el recibo.",
  "body_en": "The TLC says there is no extra charge for additional passengers, luggage or paying by card. The screen should read \"Rate #01 – Standard City Rate\", and always take your receipt.",
  "source_url": "https://www.nyc.gov/site/tlc/passengers/taxi-fare.page",
  "source_name": "NYC Taxi & Limousine Commission · Taxi Fare",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "tokio-tarjeta-ic",
  "destination_slug": "tokio",
  "category": "transporte",
  "before_you_go": true,
  "rank": 1,
  "title_es": "Una tarjeta IC te resuelve trenes, autobuses y compras pequeñas",
  "title_en": "An IC card handles trains, buses and small purchases",
  "body_es": "Con una tarjeta IC cambias de línea sin comprar boletos y pagas autobuses, barcos, muchas máquinas expendedoras, tiendas de conveniencia y algunos taxis. La mayoría pide un depósito de 500 yenes; Welcome Suica y TOURIST PASMO, para visitantes, no.",
  "body_en": "With an IC card you switch lines without buying tickets and pay for buses, boats, many vending machines, convenience stores and some taxis. Most require a 500-yen deposit; the visitor cards Welcome Suica and TOURIST PASMO do not.",
  "source_url": "https://www.japan.travel/es/plan/ic-card/",
  "source_name": "JNTO · Tarjetas IC de viaje",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "tokio-aduana-en-linea",
  "destination_slug": "tokio",
  "category": "llegada",
  "before_you_go": true,
  "rank": 2,
  "title_es": "Aduana de Japón: puedes declarar en línea con código QR",
  "title_en": "Japan customs: you can declare online with a QR code",
  "body_es": "Al llegar se entrega una declaración de aduana; el formulario está en el avión o en el aeropuerto, y también se puede hacer en línea (web o código QR).",
  "body_en": "On arrival you hand in a customs declaration; the form is available on the plane or at the airport, and it can also be filed online (web or QR code).",
  "source_url": "https://www.japan.travel/en/plan/customs-and-duty/",
  "source_name": "JNTO · Customs and duty",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "tokio-prohibido-carne-plantas",
  "destination_slug": "tokio",
  "category": "errores",
  "before_you_go": true,
  "rank": 3,
  "title_es": "No lleves carne, embutidos ni plantas a Japón",
  "title_en": "Do not bring meat, cured meats or plants into Japan",
  "body_es": "Ingresar carne, productos cárnicos, plantas y productos vegetales está estrictamente prohibido. La multa puede llegar a 3 millones de yenes o hasta 3 años de prisión.",
  "body_en": "Bringing meat, meat products, plants and plant products into Japan is strictly prohibited. Fines reach up to 3 million yen, or up to 3 years in prison.",
  "source_url": "https://www.japan.travel/en/plan/customs-and-duty/",
  "source_name": "JNTO · Customs and duty",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 },
 {
  "slug": "londres-eta-antes-de-volar",
  "destination_slug": "londres",
  "category": "documentos",
  "before_you_go": true,
  "rank": 1,
  "title_es": "Reino Unido: revisa si necesitas ETA o visa",
  "title_en": "United Kingdom: check whether you need an ETA or a visa",
  "body_es": "La ETA permite viajar al Reino Unido hasta por 6 meses y cuesta £20 en el sitio oficial del gobierno (otros sitios cobran más e imitan al gobierno). Cada persona necesita la suya, incluidos bebés y niños, y no garantiza la entrada.",
  "body_en": "An ETA lets you travel to the UK for up to 6 months and costs £20 on the official government site (other sites charge more and imitate it). Every traveller needs one, babies and children included, and it does not guarantee entry.",
  "source_url": "https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta",
  "source_name": "GOV.UK · Apply for an electronic travel authorisation (ETA)",
  "source_checked_at": "2026-10-22",
  "verified_by": "privevalor"
 }
]$pv$::jsonb, 'valor-2026-10', false);
  IF jsonb_array_length(r->'rejected') > 0 THEN RAISE EXCEPTION 'siembra del Insider rechazada: %', r->'rejected'; END IF;
END $seed$;
