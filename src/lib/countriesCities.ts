// Curated list of countries with their main cities for the origin picker.
// Keeps the UX fast: pick country → pick city. A free-text "Otra ciudad" option
// is offered at the component level for anything not listed.

export type Country = {
  code: string;
  name: string;
  flag: string;
  cities: string[];
};

export const COUNTRIES: Country[] = [
  {
    code: "MX", name: "México", flag: "🇲🇽",
    cities: ["Ciudad de México", "Guadalajara", "Monterrey", "Cancún", "Mérida", "Puebla", "Querétaro", "Tijuana", "León", "Puerto Vallarta", "Los Cabos", "Oaxaca", "San Luis Potosí", "Aguascalientes", "Chihuahua", "Hermosillo"],
  },
  {
    code: "US", name: "Estados Unidos", flag: "🇺🇸",
    cities: ["Nueva York", "Los Ángeles", "Miami", "Chicago", "San Francisco", "Las Vegas", "Houston", "Dallas", "Boston", "Seattle", "Washington D.C.", "Orlando", "Atlanta", "Denver", "San Diego", "Austin"],
  },
  {
    code: "CA", name: "Canadá", flag: "🇨🇦",
    cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Quebec"],
  },
  {
    code: "ES", name: "España", flag: "🇪🇸",
    cities: ["Madrid", "Barcelona", "Valencia", "Sevilla", "Málaga", "Bilbao", "Palma de Mallorca", "Granada", "San Sebastián"],
  },
  {
    code: "FR", name: "Francia", flag: "🇫🇷",
    cities: ["París", "Niza", "Lyon", "Marsella", "Burdeos", "Toulouse", "Estrasburgo"],
  },
  {
    code: "IT", name: "Italia", flag: "🇮🇹",
    cities: ["Roma", "Milán", "Florencia", "Venecia", "Nápoles", "Turín", "Bolonia", "Verona"],
  },
  {
    code: "GB", name: "Reino Unido", flag: "🇬🇧",
    cities: ["Londres", "Manchester", "Edimburgo", "Liverpool", "Birmingham", "Glasgow"],
  },
  {
    code: "DE", name: "Alemania", flag: "🇩🇪",
    cities: ["Berlín", "Múnich", "Hamburgo", "Fráncfort", "Colonia", "Düsseldorf"],
  },
  {
    code: "PT", name: "Portugal", flag: "🇵🇹",
    cities: ["Lisboa", "Oporto", "Faro", "Madeira"],
  },
  {
    code: "NL", name: "Países Bajos", flag: "🇳🇱",
    cities: ["Ámsterdam", "Róterdam", "La Haya", "Utrecht"],
  },
  {
    code: "CH", name: "Suiza", flag: "🇨🇭",
    cities: ["Zúrich", "Ginebra", "Berna", "Basilea", "Lucerna"],
  },
  {
    code: "AT", name: "Austria", flag: "🇦🇹",
    cities: ["Viena", "Salzburgo", "Innsbruck", "Graz"],
  },
  {
    code: "GR", name: "Grecia", flag: "🇬🇷",
    cities: ["Atenas", "Tesalónica", "Santorini", "Mykonos"],
  },
  {
    code: "TR", name: "Turquía", flag: "🇹🇷",
    cities: ["Estambul", "Ankara", "Izmir", "Antalya"],
  },
  {
    code: "AR", name: "Argentina", flag: "🇦🇷",
    cities: ["Buenos Aires", "Córdoba", "Mendoza", "Rosario", "Bariloche", "Ushuaia"],
  },
  {
    code: "BR", name: "Brasil", flag: "🇧🇷",
    cities: ["São Paulo", "Río de Janeiro", "Brasilia", "Salvador", "Florianópolis", "Recife"],
  },
  {
    code: "CL", name: "Chile", flag: "🇨🇱",
    cities: ["Santiago", "Valparaíso", "Viña del Mar", "Puerto Montt"],
  },
  {
    code: "CO", name: "Colombia", flag: "🇨🇴",
    cities: ["Bogotá", "Medellín", "Cartagena", "Cali", "Barranquilla", "Santa Marta"],
  },
  {
    code: "PE", name: "Perú", flag: "🇵🇪",
    cities: ["Lima", "Cusco", "Arequipa", "Trujillo"],
  },
  {
    code: "UY", name: "Uruguay", flag: "🇺🇾",
    cities: ["Montevideo", "Punta del Este"],
  },
  {
    code: "EC", name: "Ecuador", flag: "🇪🇨",
    cities: ["Quito", "Guayaquil", "Cuenca"],
  },
  {
    code: "CR", name: "Costa Rica", flag: "🇨🇷",
    cities: ["San José", "Liberia", "Tamarindo"],
  },
  {
    code: "PA", name: "Panamá", flag: "🇵🇦",
    cities: ["Ciudad de Panamá"],
  },
  {
    code: "DO", name: "Rep. Dominicana", flag: "🇩🇴",
    cities: ["Santo Domingo", "Punta Cana", "Santiago"],
  },
  {
    code: "JP", name: "Japón", flag: "🇯🇵",
    cities: ["Tokio", "Osaka", "Kioto", "Nagoya", "Sapporo", "Fukuoka"],
  },
  {
    code: "CN", name: "China", flag: "🇨🇳",
    cities: ["Pekín", "Shanghái", "Hong Kong", "Cantón", "Shenzhen"],
  },
  {
    code: "KR", name: "Corea del Sur", flag: "🇰🇷",
    cities: ["Seúl", "Busan", "Incheon", "Jeju"],
  },
  {
    code: "TH", name: "Tailandia", flag: "🇹🇭",
    cities: ["Bangkok", "Chiang Mai", "Phuket", "Krabi"],
  },
  {
    code: "SG", name: "Singapur", flag: "🇸🇬",
    cities: ["Singapur"],
  },
  {
    code: "AE", name: "Emiratos Árabes Unidos", flag: "🇦🇪",
    cities: ["Dubái", "Abu Dabi"],
  },
  {
    code: "AU", name: "Australia", flag: "🇦🇺",
    cities: ["Sídney", "Melbourne", "Brisbane", "Perth", "Adelaida"],
  },
  {
    code: "NZ", name: "Nueva Zelanda", flag: "🇳🇿",
    cities: ["Auckland", "Wellington", "Queenstown"],
  },
  {
    code: "ZA", name: "Sudáfrica", flag: "🇿🇦",
    cities: ["Ciudad del Cabo", "Johannesburgo", "Durban"],
  },
  {
    code: "MA", name: "Marruecos", flag: "🇲🇦",
    cities: ["Marrakech", "Casablanca", "Fez", "Tánger"],
  },
  {
    code: "EG", name: "Egipto", flag: "🇪🇬",
    cities: ["El Cairo", "Alejandría", "Luxor"],
  },
];

export function findCountryByCity(city: string): Country | undefined {
  const norm = city.trim().toLowerCase();
  if (!norm) return undefined;
  return COUNTRIES.find((c) => c.cities.some((x) => x.toLowerCase() === norm));
}
