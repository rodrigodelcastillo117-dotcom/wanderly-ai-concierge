// Catálogo de destinos de IATOS Privé: la lista EXACTA del dueño (orden 2026-10-22), normalizada.
// Fuente única: de aquí salen la siembra SQL (gen_destinations_sql.mjs → migración
// 20261023100000) y la resolución de ciudades del cargador de curaduría (load_curation.mjs).
//
// kind:
//   country      país (solo jerarquía, salvo los países-destino: Mónaco, Singapur, Hong Kong, Omán,
//                Seychelles, Mauricio, Maldivas, que el dueño lista como destino)
//   region       región turística que recibe experiencias (Costa Amalfitana, Los Cabos, Bali…)
//   locality     ciudad o pueblo
//   neighborhood barrio dentro de un destino (Polanco, Roma-Condesa, Montecarlo)
//   area         agrupación metropolitana sin experiencias propias (Área de Miami…); sus miembros
//                van en prive_destination_members, nunca se duplican
// dest: true = aparece en la lista del dueño y puede tener experiencias.
// wiki: título de Wikipedia en inglés; las coordenadas salen de Wikidata (P625) por ese artículo
// (ver destinations.coords.json). Si no hay coordenada verificable, queda null y se dice.
// aliases: sobrenombres y faltas comunes; cada uno apunta a UN solo destino (llave única).

const C = (slug, iso, name_es, name_en, tz, currency, extra = {}) =>
  ({ slug, kind: "country", iso, name_es, name_en, tz, currency, dest: false, aliases: [], ...extra });

export const COUNTRIES = [
  C("mc", "MC", "Mónaco", "Monaco", "Europe/Monaco", "EUR", { dest: true, group: "europa", wiki: "Monaco", aliases: ["monaco", "principado de monaco"] }),
  C("fr", "FR", "Francia", "France", "Europe/Paris", "EUR"),
  C("gb", "GB", "Reino Unido", "United Kingdom", "Europe/London", "GBP"),
  C("it", "IT", "Italia", "Italy", "Europe/Rome", "EUR"),
  C("ch", "CH", "Suiza", "Switzerland", "Europe/Zurich", "CHF"),
  C("es", "ES", "España", "Spain", "Europe/Madrid", "EUR"),
  C("gr", "GR", "Grecia", "Greece", "Europe/Athens", "EUR"),
  C("at", "AT", "Austria", "Austria", "Europe/Vienna", "EUR"),
  C("de", "DE", "Alemania", "Germany", "Europe/Berlin", "EUR"),
  C("nl", "NL", "Países Bajos", "Netherlands", "Europe/Amsterdam", "EUR"),
  C("pt", "PT", "Portugal", "Portugal", "Europe/Lisbon", "EUR"),
  C("us", "US", "Estados Unidos", "United States", "America/New_York", "USD"),
  C("ca", "CA", "Canadá", "Canada", "America/Toronto", "CAD"),
  C("mx", "MX", "México", "Mexico", "America/Mexico_City", "MXN"),
  C("ae", "AE", "Emiratos Árabes Unidos", "United Arab Emirates", "Asia/Dubai", "AED"),
  C("qa", "QA", "Catar", "Qatar", "Asia/Qatar", "QAR"),
  C("sa", "SA", "Arabia Saudita", "Saudi Arabia", "Asia/Riyadh", "SAR"),
  C("om", "OM", "Omán · destinos destacados", "Oman · featured destinations", "Asia/Muscat", "OMR", { dest: true, group: "medio_oriente", wiki: "Oman", aliases: ["oman", "destinos destacados de oman", "sultanato de oman"] }),
  C("jp", "JP", "Japón", "Japan", "Asia/Tokyo", "JPY"),
  C("sg", "SG", "Singapur", "Singapore", "Asia/Singapore", "SGD", { dest: true, group: "asia_oceania", wiki: "Singapore", aliases: ["singapur", "singapore"] }),
  C("hk", "HK", "Hong Kong", "Hong Kong", "Asia/Hong_Kong", "HKD", { dest: true, group: "asia_oceania", wiki: "Hong Kong", aliases: ["hong kong", "hongkong"] }),
  C("kr", "KR", "Corea del Sur", "South Korea", "Asia/Seoul", "KRW"),
  C("th", "TH", "Tailandia", "Thailand", "Asia/Bangkok", "THB"),
  C("id", "ID", "Indonesia", "Indonesia", "Asia/Jakarta", "IDR"),
  C("au", "AU", "Australia", "Australia", "Australia/Sydney", "AUD"),
  C("nz", "NZ", "Nueva Zelanda", "New Zealand", "Pacific/Auckland", "NZD"),
  C("co", "CO", "Colombia", "Colombia", "America/Bogota", "COP"),
  C("ar", "AR", "Argentina", "Argentina", "America/Argentina/Buenos_Aires", "ARS"),
  C("uy", "UY", "Uruguay", "Uruguay", "America/Montevideo", "UYU"),
  C("br", "BR", "Brasil", "Brazil", "America/Sao_Paulo", "BRL"),
  C("pe", "PE", "Perú", "Peru", "America/Lima", "PEN"),
  C("ma", "MA", "Marruecos", "Morocco", "Africa/Casablanca", "MAD"),
  C("za", "ZA", "Sudáfrica", "South Africa", "Africa/Johannesburg", "ZAR"),
  C("sc", "SC", "Seychelles", "Seychelles", "Indian/Mahe", "SCR", { dest: true, group: "otras_regiones", wiki: "Seychelles", aliases: ["seychelles", "islas seychelles"] }),
  C("mu", "MU", "Mauricio", "Mauritius", "Indian/Mauritius", "MUR", { dest: true, group: "otras_regiones", wiki: "Mauritius", aliases: ["mauricio", "mauritius", "isla mauricio"] }),
  C("mv", "MV", "Maldivas", "Maldives", "Indian/Maldives", "MVR", { dest: true, group: "otras_regiones", wiki: "Maldives", aliases: ["maldivas", "maldives", "islas maldivas"] }),
  C("pf", "PF", "Polinesia Francesa", "French Polynesia", "Pacific/Tahiti", "XPF"),
];

// D(slug, kind, parent, name_es, name_en, admin_area, group, wiki, aliases, extra)
const D = (slug, kind, parent, name_es, name_en, admin_area, group, wiki, aliases = [], extra = {}) =>
  ({ slug, kind, parent, name_es, name_en, admin_area, group, wiki, aliases, dest: kind !== "area", ...extra });

// Orden = orden de la lista del dueño (sort_order).
export const DESTINATIONS = [
  // ── EUROPA ──
  // Mónaco es país-destino (arriba). Montecarlo es un barrio (quartier) de Mónaco.
  D("monaco-monte-carlo", "neighborhood", "mc", "Montecarlo", "Monte Carlo", "Mónaco", "europa", "Monte Carlo", ["montecarlo", "monte carlo", "monte-carlo"]),
  D("paris", "locality", "fr", "París", "Paris", "Île-de-France", "europa", "Paris", ["paris"]),
  D("londres", "locality", "gb", "Londres", "London", "Inglaterra", "europa", "London", ["londres", "london"]),
  D("milan", "locality", "it", "Milán", "Milan", "Lombardía", "europa", "Milan", ["milan", "milano"]),
  D("roma", "locality", "it", "Roma", "Rome", "Lacio", "europa", "Rome", ["roma", "rome"]),
  D("florencia", "locality", "it", "Florencia", "Florence", "Toscana", "europa", "Florence", ["florencia", "florence", "firenze"]),
  D("venecia", "locality", "it", "Venecia", "Venice", "Véneto", "europa", "Venice", ["venecia", "venice", "venezia"]),
  D("capri", "locality", "it", "Capri", "Capri", "Campania", "europa", "Capri", ["capri", "isla de capri"]),
  D("costa-amalfitana", "region", "it", "Costa Amalfitana", "Amalfi Coast", "Campania", "europa", "Amalfi Coast", ["costa amalfitana", "amalfi coast", "costiera amalfitana", "amalfi", "positano", "ravello"]),
  D("lago-de-como", "region", "it", "Lago de Como", "Lake Como", "Lombardía", "europa", "Lake Como", ["lago de como", "lake como", "lago di como", "bellagio italia", "cernobbio", "tremezzo"]),
  D("saint-tropez", "locality", "fr", "Saint-Tropez", "Saint-Tropez", "Provenza-Alpes-Costa Azul", "europa", "Saint-Tropez", ["saint tropez", "st tropez", "san tropez"]),
  D("cannes", "locality", "fr", "Cannes", "Cannes", "Provenza-Alpes-Costa Azul", "europa", "Cannes", ["cannes"]),
  D("niza", "locality", "fr", "Niza", "Nice", "Provenza-Alpes-Costa Azul", "europa", "Nice", ["niza", "nice francia", "nice"]),
  D("courchevel", "locality", "fr", "Courchevel", "Courchevel", "Auvernia-Ródano-Alpes", "europa", "Courchevel", ["courchevel"]),
  D("megeve", "locality", "fr", "Megève", "Megève", "Auvernia-Ródano-Alpes", "europa", "Megève", ["megeve"]),
  D("gstaad", "locality", "ch", "Gstaad", "Gstaad", "Berna", "europa", "Gstaad", ["gstaad"]),
  D("st-moritz", "locality", "ch", "St. Moritz", "St. Moritz", "Grisones", "europa", "St. Moritz", ["st moritz", "saint moritz", "san moritz", "sankt moritz"]),
  D("zurich", "locality", "ch", "Zúrich", "Zurich", "Zúrich", "europa", "Zurich", ["zurich", "zuerich"]),
  D("ginebra", "locality", "ch", "Ginebra", "Geneva", "Ginebra", "europa", "Geneva", ["ginebra", "geneva", "geneve", "genf"]),
  D("madrid", "locality", "es", "Madrid", "Madrid", "Comunidad de Madrid", "europa", "Madrid", ["madrid"]),
  D("barcelona", "locality", "es", "Barcelona", "Barcelona", "Cataluña", "europa", "Barcelona", ["barcelona"]),
  D("marbella", "locality", "es", "Marbella", "Marbella", "Andalucía", "europa", "Marbella", ["marbella", "puerto banus"]),
  D("ibiza", "locality", "es", "Ibiza", "Ibiza", "Islas Baleares", "europa", "Ibiza", ["ibiza", "eivissa"]),
  D("formentera", "locality", "es", "Formentera", "Formentera", "Islas Baleares", "europa", "Formentera", ["formentera"]),
  D("mallorca", "locality", "es", "Mallorca", "Mallorca", "Islas Baleares", "europa", "Mallorca", ["mallorca", "majorca", "palma de mallorca"]),
  D("mykonos", "locality", "gr", "Mykonos", "Mykonos", "Egeo Meridional", "europa", "Mykonos", ["mykonos", "mikonos", "miconos"]),
  D("santorini", "locality", "gr", "Santorini", "Santorini", "Egeo Meridional", "europa", "Santorini", ["santorini", "santorin", "thira", "oia"]),
  D("atenas", "locality", "gr", "Atenas", "Athens", "Ática", "europa", "Athens", ["atenas", "athens"]),
  D("viena", "locality", "at", "Viena", "Vienna", "Viena", "europa", "Vienna", ["viena", "vienna", "wien"]),
  D("berlin", "locality", "de", "Berlín", "Berlin", "Berlín", "europa", "Berlin", ["berlin"]),
  D("amsterdam", "locality", "nl", "Ámsterdam", "Amsterdam", "Holanda Septentrional", "europa", "Amsterdam", ["amsterdam"]),
  D("lisboa", "locality", "pt", "Lisboa", "Lisbon", "Lisboa", "europa", "Lisbon", ["lisboa", "lisbon"]),
  D("porto", "locality", "pt", "Porto", "Porto", "Norte", "europa", "Porto", ["porto", "oporto"]),
  // ── NORTEAMÉRICA ──
  D("nueva-york", "locality", "us", "Nueva York", "New York", "Nueva York", "norteamerica", "New York City", ["nueva york", "new york", "new york city", "nyc", "ciudad de nueva york"], { tz: "America/New_York" }),
  D("area-miami", "area", "us", "Área de Miami", "Miami area", "Florida", "norteamerica", null, [], { members: ["miami", "miami-beach"] }),
  D("miami", "locality", "us", "Miami", "Miami", "Florida", "norteamerica", "Miami", ["miami"], { tz: "America/New_York" }),
  D("miami-beach", "locality", "us", "Miami Beach", "Miami Beach", "Florida", "norteamerica", "Miami Beach, Florida", ["miami beach", "south beach"], { tz: "America/New_York" }),
  D("area-los-angeles", "area", "us", "Área de Los Ángeles", "Los Angeles area", "California", "norteamerica", null, [], { members: ["los-angeles", "beverly-hills", "malibu"] }),
  D("los-angeles", "locality", "us", "Los Ángeles", "Los Angeles", "California", "norteamerica", "Los Angeles", ["los angeles"], { tz: "America/Los_Angeles" }),
  D("beverly-hills", "locality", "us", "Beverly Hills", "Beverly Hills", "California", "norteamerica", "Beverly Hills, California", ["beverly hills"], { tz: "America/Los_Angeles" }),
  D("malibu", "locality", "us", "Malibu", "Malibu", "California", "norteamerica", "Malibu, California", ["malibu"], { tz: "America/Los_Angeles" }),
  D("las-vegas", "locality", "us", "Las Vegas", "Las Vegas", "Nevada", "norteamerica", "Las Vegas", ["las vegas", "vegas"], { tz: "America/Los_Angeles" }),
  D("aspen", "locality", "us", "Aspen", "Aspen", "Colorado", "norteamerica", "Aspen, Colorado", ["aspen"], { tz: "America/Denver" }),
  D("vail", "locality", "us", "Vail", "Vail", "Colorado", "norteamerica", "Vail, Colorado", ["vail"], { tz: "America/Denver" }),
  D("jackson-hole", "region", "us", "Jackson Hole", "Jackson Hole", "Wyoming", "norteamerica", "Jackson Hole", ["jackson hole"], { tz: "America/Denver" }),
  D("napa-valley", "region", "us", "Napa Valley", "Napa Valley", "California", "norteamerica", "Napa Valley", ["napa valley", "napa", "valle de napa"], { tz: "America/Los_Angeles" }),
  D("san-francisco", "locality", "us", "San Francisco", "San Francisco", "California", "norteamerica", "San Francisco", ["san francisco"], { tz: "America/Los_Angeles" }),
  D("chicago", "locality", "us", "Chicago", "Chicago", "Illinois", "norteamerica", "Chicago", ["chicago"], { tz: "America/Chicago" }),
  D("boston", "locality", "us", "Boston", "Boston", "Massachusetts", "norteamerica", "Boston", ["boston"], { tz: "America/New_York" }),
  D("palm-beach", "locality", "us", "Palm Beach", "Palm Beach", "Florida", "norteamerica", "Palm Beach, Florida", ["palm beach"], { tz: "America/New_York" }),
  D("hamptons", "region", "us", "Hamptons", "The Hamptons", "Nueva York", "norteamerica", "The Hamptons", ["hamptons", "the hamptons", "los hamptons"], { tz: "America/New_York" }),
  D("toronto", "locality", "ca", "Toronto", "Toronto", "Ontario", "norteamerica", "Toronto", ["toronto"], { tz: "America/Toronto" }),
  D("vancouver", "locality", "ca", "Vancouver", "Vancouver", "Columbia Británica", "norteamerica", "Vancouver", ["vancouver"], { tz: "America/Vancouver" }),
  D("whistler", "locality", "ca", "Whistler", "Whistler", "Columbia Británica", "norteamerica", "Whistler, British Columbia", ["whistler"], { tz: "America/Vancouver" }),
  D("montreal", "locality", "ca", "Montreal", "Montreal", "Quebec", "norteamerica", "Montreal", ["montreal"], { tz: "America/Toronto" }),
  // ── MÉXICO ──
  D("area-cdmx", "area", "mx", "Área metropolitana de Ciudad de México", "Mexico City metropolitan area", "CDMX y Estado de México", "mexico", null, [], { members: ["cdmx", "interlomas"] }),
  D("cdmx", "locality", "mx", "Ciudad de México", "Mexico City", "Ciudad de México", "mexico", "Mexico City", ["ciudad de mexico", "cdmx", "mexico city", "df", "distrito federal", "mexico df"], { tz: "America/Mexico_City" }),
  D("cdmx-polanco", "neighborhood", "cdmx", "Polanco", "Polanco", "Ciudad de México", "mexico", "Polanco", ["polanco"], { tz: "America/Mexico_City" }),
  // Barrio compuesto (Roma Norte + Condesa): no hay una coordenada única verificable; queda null.
  D("cdmx-roma-condesa", "neighborhood", "cdmx", "Roma-Condesa", "Roma-Condesa", "Ciudad de México", "mexico", null, ["roma condesa", "roma norte", "colonia roma", "condesa", "la condesa", "colonia condesa", "hipodromo condesa"], { tz: "America/Mexico_City", coord_note: "Barrio compuesto (Roma Norte y Condesa): sin coordenada única verificable." }),
  // Interlomas está en Huixquilucan (Estado de México), dentro del área metropolitana; no es un barrio de la CDMX.
  D("interlomas", "locality", "mx", "Interlomas", "Interlomas", "Estado de México (Huixquilucan)", "mexico", "Interlomas", ["interlomas", "huixquilucan"], { tz: "America/Mexico_City" }),
  D("valle-de-bravo", "locality", "mx", "Valle de Bravo", "Valle de Bravo", "Estado de México", "mexico", "Valle de Bravo", ["valle de bravo"], { tz: "America/Mexico_City" }),
  D("san-miguel-de-allende", "locality", "mx", "San Miguel de Allende", "San Miguel de Allende", "Guanajuato", "mexico", "San Miguel de Allende", ["san miguel de allende", "san miguel", "sma"], { tz: "America/Mexico_City" }),
  D("guadalajara", "locality", "mx", "Guadalajara", "Guadalajara", "Jalisco", "mexico", "Guadalajara", ["guadalajara", "gdl"], { tz: "America/Mexico_City" }),
  // Puerto Vallarta está en Jalisco: no pertenece a la Riviera Nayarit (Nayarit).
  D("puerto-vallarta", "locality", "mx", "Puerto Vallarta", "Puerto Vallarta", "Jalisco", "mexico", "Puerto Vallarta", ["puerto vallarta", "vallarta", "pvr"], { tz: "America/Mexico_City" }),
  D("riviera-nayarit", "region", "mx", "Riviera Nayarit", "Riviera Nayarit", "Nayarit", "mexico", "Riviera Nayarit", ["riviera nayarit", "nuevo vallarta", "bahia de banderas"], { tz: "America/Mexico_City" }),
  D("punta-mita", "locality", "riviera-nayarit", "Punta Mita", "Punta Mita", "Nayarit", "mexico", "Punta Mita", ["punta mita", "punta de mita"], { tz: "America/Mexico_City" }),
  D("los-cabos", "region", "mx", "Los Cabos", "Los Cabos", "Baja California Sur", "mexico", "Los Cabos", ["los cabos", "cabo", "cabo san lucas", "corredor turistico los cabos"], { tz: "America/Mazatlan" }),
  D("san-jose-del-cabo", "locality", "los-cabos", "San José del Cabo", "San José del Cabo", "Baja California Sur", "mexico", "San José del Cabo", ["san jose del cabo", "sjd"], { tz: "America/Mazatlan" }),
  D("todos-santos", "locality", "mx", "Todos Santos", "Todos Santos", "Baja California Sur", "mexico", "Todos Santos, Baja California Sur", ["todos santos"], { tz: "America/Mazatlan" }),
  D("cancun", "locality", "mx", "Cancún", "Cancún", "Quintana Roo", "mexico", "Cancún", ["cancun"], { tz: "America/Cancun" }),
  // Riviera Maya y Tulum son destinos distintos en Quintana Roo (orden del dueño).
  D("riviera-maya", "region", "mx", "Riviera Maya", "Riviera Maya", "Quintana Roo", "mexico", "Riviera Maya", ["riviera maya", "playa del carmen", "puerto aventuras", "akumal"], { tz: "America/Cancun" }),
  D("tulum", "locality", "mx", "Tulum", "Tulum", "Quintana Roo", "mexico", "Tulum", ["tulum"], { tz: "America/Cancun" }),
  D("merida", "locality", "mx", "Mérida", "Mérida", "Yucatán", "mexico", "Mérida, Yucatán", ["merida", "merida yucatan"], { tz: "America/Merida" }),
  D("oaxaca", "locality", "mx", "Oaxaca", "Oaxaca", "Oaxaca", "mexico", "Oaxaca City", ["oaxaca", "oaxaca de juarez"], { tz: "America/Mexico_City" }),
  D("valle-de-guadalupe", "region", "mx", "Valle de Guadalupe", "Valle de Guadalupe", "Baja California", "mexico", "Valle de Guadalupe", ["valle de guadalupe"], { tz: "America/Tijuana" }),
  D("puebla", "locality", "mx", "Puebla", "Puebla", "Puebla", "mexico", "Puebla (city)", ["puebla", "puebla de zaragoza"], { tz: "America/Mexico_City" }),
  D("queretaro", "locality", "mx", "Querétaro", "Querétaro", "Querétaro", "mexico", "Querétaro (city)", ["queretaro", "santiago de queretaro"], { tz: "America/Mexico_City" }),
  D("monterrey", "locality", "mx", "Monterrey", "Monterrey", "Nuevo León", "mexico", "Monterrey", ["monterrey", "mty"], { tz: "America/Monterrey" }),
  // ── MEDIO ORIENTE ──
  D("dubai", "locality", "ae", "Dubái", "Dubai", "Dubái", "medio_oriente", "Dubai", ["dubai"]),
  D("abu-dabi", "locality", "ae", "Abu Dabi", "Abu Dhabi", "Abu Dabi", "medio_oriente", "Abu Dhabi", ["abu dabi", "abu dhabi", "abudabi"]),
  D("doha", "locality", "qa", "Doha", "Doha", "Doha", "medio_oriente", "Doha", ["doha"]),
  D("riad", "locality", "sa", "Riad", "Riyadh", "Riad", "medio_oriente", "Riyadh", ["riad", "riyadh", "riyad"]),
  // Omán (país-destino, arriba) con Mascate como primera localidad.
  D("mascate", "locality", "om", "Mascate", "Muscat", "Mascate", "medio_oriente", "Muscat", ["mascate", "muscat"]),
  // ── ASIA Y OCEANÍA ──
  D("tokio", "locality", "jp", "Tokio", "Tokyo", "Tokio", "asia_oceania", "Tokyo", ["tokio", "tokyo"]),
  D("kioto", "locality", "jp", "Kioto", "Kyoto", "Kioto", "asia_oceania", "Kyoto", ["kioto", "kyoto"]),
  D("osaka", "locality", "jp", "Osaka", "Osaka", "Osaka", "asia_oceania", "Osaka", ["osaka"]),
  D("seul", "locality", "kr", "Seúl", "Seoul", "Seúl", "asia_oceania", "Seoul", ["seul", "seoul"]),
  D("bangkok", "locality", "th", "Bangkok", "Bangkok", "Bangkok", "asia_oceania", "Bangkok", ["bangkok"]),
  D("phuket", "region", "th", "Phuket", "Phuket", "Phuket", "asia_oceania", "Phuket province", ["phuket", "isla de phuket"]),
  D("bali", "region", "id", "Bali", "Bali", "Bali", "asia_oceania", "Bali", ["bali", "ubud", "seminyak", "uluwatu"], { tz: "Asia/Makassar" }),
  D("yakarta", "locality", "id", "Yakarta", "Jakarta", "Yakarta", "asia_oceania", "Jakarta", ["yakarta", "jakarta"]),
  D("sidney", "locality", "au", "Sídney", "Sydney", "Nueva Gales del Sur", "asia_oceania", "Sydney", ["sidney", "sydney"]),
  D("melbourne", "locality", "au", "Melbourne", "Melbourne", "Victoria", "asia_oceania", "Melbourne", ["melbourne"], { tz: "Australia/Melbourne" }),
  D("queenstown", "locality", "nz", "Queenstown", "Queenstown", "Otago", "asia_oceania", "Queenstown, New Zealand", ["queenstown"]),
  // ── OTRAS REGIONES ──
  D("cartagena", "locality", "co", "Cartagena", "Cartagena", "Bolívar", "otras_regiones", "Cartagena, Colombia", ["cartagena", "cartagena de indias"]),
  D("bogota", "locality", "co", "Bogotá", "Bogotá", "Bogotá D. C.", "otras_regiones", "Bogotá", ["bogota"]),
  D("medellin", "locality", "co", "Medellín", "Medellín", "Antioquia", "otras_regiones", "Medellín", ["medellin"]),
  D("buenos-aires", "locality", "ar", "Buenos Aires", "Buenos Aires", "CABA", "otras_regiones", "Buenos Aires", ["buenos aires", "caba", "bsas"]),
  D("mendoza", "locality", "ar", "Mendoza", "Mendoza", "Mendoza", "otras_regiones", "Mendoza, Argentina", ["mendoza", "valle de uco"], { tz: "America/Argentina/Mendoza" }),
  D("punta-del-este", "locality", "uy", "Punta del Este", "Punta del Este", "Maldonado", "otras_regiones", "Punta del Este", ["punta del este", "jose ignacio"]),
  D("rio-de-janeiro", "locality", "br", "Río de Janeiro", "Rio de Janeiro", "Río de Janeiro", "otras_regiones", "Rio de Janeiro", ["rio de janeiro", "rio"]),
  D("sao-paulo", "locality", "br", "São Paulo", "São Paulo", "São Paulo", "otras_regiones", "São Paulo", ["sao paulo", "san pablo"]),
  D("lima", "locality", "pe", "Lima", "Lima", "Lima", "otras_regiones", "Lima", ["lima"]),
  D("cusco", "locality", "pe", "Cusco", "Cusco", "Cusco", "otras_regiones", "Cusco", ["cusco", "cuzco", "valle sagrado"]),
  D("marrakech", "locality", "ma", "Marrakech", "Marrakesh", "Marrakech-Safí", "otras_regiones", "Marrakesh", ["marrakech", "marrakesh", "marraquech"]),
  D("ciudad-del-cabo", "locality", "za", "Ciudad del Cabo", "Cape Town", "Cabo Occidental", "otras_regiones", "Cape Town", ["ciudad del cabo", "cape town"]),
  D("bora-bora", "locality", "pf", "Bora Bora", "Bora Bora", "Islas de Sotavento", "otras_regiones", "Bora Bora", ["bora bora"]),
];

// Orden del dueño para los países-destino (se intercalan donde él los listó).
export const OWNER_ORDER = [
  "mc", "monaco-monte-carlo", "paris", "londres", "milan", "roma", "florencia", "venecia", "capri", "costa-amalfitana",
  "lago-de-como", "saint-tropez", "cannes", "niza", "courchevel", "megeve", "gstaad", "st-moritz", "zurich", "ginebra",
  "madrid", "barcelona", "marbella", "ibiza", "formentera", "mallorca", "mykonos", "santorini", "atenas", "viena",
  "berlin", "amsterdam", "lisboa", "porto",
  "nueva-york", "miami", "miami-beach", "los-angeles", "beverly-hills", "malibu", "las-vegas", "aspen", "vail",
  "jackson-hole", "napa-valley", "san-francisco", "chicago", "boston", "palm-beach", "hamptons", "toronto", "vancouver",
  "whistler", "montreal",
  "cdmx", "cdmx-polanco", "cdmx-roma-condesa", "interlomas", "valle-de-bravo", "san-miguel-de-allende", "guadalajara",
  "puerto-vallarta", "punta-mita", "riviera-nayarit", "los-cabos", "san-jose-del-cabo", "todos-santos", "cancun",
  "riviera-maya", "tulum", "merida", "oaxaca", "valle-de-guadalupe", "puebla", "queretaro", "monterrey",
  "dubai", "abu-dabi", "doha", "riad", "om", "mascate",
  "tokio", "kioto", "osaka", "sg", "hk", "seul", "bangkok", "phuket", "bali", "yakarta", "sidney", "melbourne", "queenstown",
  "cartagena", "bogota", "medellin", "buenos-aires", "mendoza", "punta-del-este", "rio-de-janeiro", "sao-paulo", "lima",
  "cusco", "marrakech", "ciudad-del-cabo", "sc", "mu", "mv", "bora-bora",
];

// Misma tabla que translate() en public.prive_norm (20261023100000): ambos lados dan lo mismo.
const FROM = "ÁÀÂÄÃÅĀĂĄáàâäãåāăąÉÈÊËĒĖĘĚéèêëēėęěÍÌÎÏĪĮíìîïīįÓÒÔÖÕŌŐóòôöõōőÚÙÛÜŪŮŰúùûüūůűÑŃñńÇĆČçćčŚŠśšŽŹŻžźżÝŸýÿĞğŞşİıŁł";
const TO = "AAAAAAAAAaaaaaaaaaEEEEEEEEeeeeeeeeIIIIIIiiiiiiOOOOOOOoooooooUUUUUUUuuuuuuuNNnnCCCcccSSssZZZzzzYYyyGgSsIiLl";
const TR = new Map([...FROM].map((c, i) => [c, TO[i]]));

/** Normalizador idéntico a public.prive_norm(): sin acentos, minúsculas, & → and, no alfanumérico → espacio. */
export function priveNorm(t) {
  return [...String(t ?? "")].map((c) => TR.get(c) ?? c).join("")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Todos los registros (países + destinos) con país ISO resuelto y orden. */
export function allDestinations() {
  const bySlug = new Map();
  for (const c of COUNTRIES) bySlug.set(c.slug, { ...c, parent: null, admin_area: null, group: c.group ?? null });
  for (const d of DESTINATIONS) bySlug.set(d.slug, { ...d });
  const countryOf = (slug) => {
    let cur = bySlug.get(slug);
    while (cur && cur.kind !== "country") cur = bySlug.get(cur.parent);
    return cur;
  };
  const out = [];
  for (const r of bySlug.values()) {
    const country = countryOf(r.slug);
    const idx = OWNER_ORDER.indexOf(r.slug);
    out.push({
      ...r,
      iso: country.iso,
      tz: r.tz ?? country.tz,
      currency: r.currency ?? country.currency,
      group: r.group ?? null,
      sort_order: idx >= 0 ? (idx + 1) * 10 : 5000,
    });
  }
  return out;
}

/** Mapa alias normalizado → slug. Lanza si un alias apunta a dos destinos (no debe haber duplicados). */
export function aliasMap() {
  const m = new Map();
  for (const d of allDestinations()) {
    const names = new Set([d.name_es, d.name_en, d.slug.replace(/-/g, " "), ...(d.aliases ?? [])].map(priveNorm).filter(Boolean));
    // Los países que no son destino no reciben alias de nombre (evita que "México" o "Francia" resuelvan a un país sin experiencias).
    if (d.kind === "country" && !d.dest) continue;
    for (const a of names) {
      if (m.has(a) && m.get(a) !== d.slug) throw new Error(`alias duplicado "${a}": ${m.get(a)} y ${d.slug}`);
      m.set(a, d.slug);
    }
  }
  return m;
}
