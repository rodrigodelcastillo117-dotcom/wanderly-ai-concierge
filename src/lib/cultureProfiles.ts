// Country/culture cinematic profiles for Travel Avatar evolution
export type CultureProfile = {
  key: string;
  match: RegExp;
  label: string;
  vibe: string;            // for AI prompt
  outfit: string;          // for AI prompt
  accessory: string;       // for AI prompt
  background: string;      // for AI prompt
  lighting: string;        // for AI prompt
  palette: { from: string; via: string; to: string; accent: string };
  emojis: string[];
};

export const CULTURE_PROFILES: CultureProfile[] = [
  {
    key: "france",
    match: /(francia|france|par[ií]s|paris)/i,
    label: "Parisian Elegance",
    vibe: "elegant Parisian luxury, haute couture",
    outfit: "tailored beige trench coat over cashmere knit, silk scarf",
    accessory: "holding a golden croissant on porcelain plate",
    background: "cinematic Paris boulevard at golden hour, blurred Eiffel Tower silhouette, warm café lights bokeh",
    lighting: "warm amber café lighting, soft glow",
    palette: { from: "#3a2820", via: "#1a1208", to: "#0a0604", accent: "#e0b774" },
    emojis: ["🥐", "🗼", "🍷"],
  },
  {
    key: "italy",
    match: /(italia|italy|roma|rome|milan|amalfi|venecia|venice|florence|florencia)/i,
    label: "Italian Riviera",
    vibe: "Italian summer dolce vita, Mediterranean luxury",
    outfit: "linen shirt unbuttoned, sun-kissed glow, designer sunglasses",
    accessory: "espresso cup and Vespa keys",
    background: "cinematic Amalfi coast cliffs, lemon trees, terracotta rooftops, deep blue sea at sunset",
    lighting: "warm Tuscan sunset, orange and gold tones",
    palette: { from: "#3a1a18", via: "#1a0a08", to: "#0a0404", accent: "#e89060" },
    emojis: ["🍝", "🛵", "🌅"],
  },
  {
    key: "japan",
    match: /(japon|japan|tokio|tokyo|kyoto|osaka)/i,
    label: "Neo-Tokyo",
    vibe: "futuristic minimal Tokyo, neon cyberpunk meets zen",
    outfit: "sleek black technical jacket, minimalist silhouette",
    accessory: "ramen bowl with chopsticks, neon glow reflection",
    background: "cinematic Shibuya neon streets, holographic signs, pink and blue neon, light rain reflections",
    lighting: "neon magenta and cyan with rim light",
    palette: { from: "#1a0a3a", via: "#080418", to: "#020208", accent: "#ff5fbf" },
    emojis: ["🍜", "🌸", "🗾"],
  },
  {
    key: "mexico",
    match: /(mexico|méxico|cdmx|oaxaca|tulum|cancun|playa del carmen|guadalajara|merida)/i,
    label: "Mexican Soul",
    vibe: "vibrant Mexican cultural luxury, mezcal lounge energy",
    outfit: "embroidered linen shirt, woven artisan textures",
    accessory: "copita of mezcal and street tacos plate",
    background: "cinematic Tulum jungle cenote with golden hour rays, bohemian luxury",
    lighting: "warm tropical sunset, deep golden glow",
    palette: { from: "#3a2008", via: "#1a0e04", to: "#0a0602", accent: "#f0a040" },
    emojis: ["🌮", "🍹", "🌵"],
  },
  {
    key: "iceland",
    match: /(islandia|iceland|reykjavik)/i,
    label: "Arctic Explorer",
    vibe: "cinematic arctic adventure luxury",
    outfit: "premium technical parka with fur-lined hood, gloves",
    accessory: "thermal flask and aurora-glow camera",
    background: "cinematic Iceland glacier landscape under aurora borealis, deep teal and purple sky",
    lighting: "cold blue moonlight with green aurora glow",
    palette: { from: "#08183a", via: "#04081a", to: "#02040a", accent: "#5fd0c0" },
    emojis: ["❄️", "🌌", "🏔️"],
  },
  {
    key: "bali",
    match: /(bali|indonesia|ubud|seminyak)/i,
    label: "Bali Wellness",
    vibe: "tropical wellness luxury, spiritual sanctuary",
    outfit: "flowing linen kaftan, mala beads, sun-kissed serenity",
    accessory: "tropical coconut and frangipani flowers",
    background: "cinematic Bali rice terraces at sunrise, mist over jungle, infinity pool reflection",
    lighting: "soft golden sunrise, pastel pinks and greens",
    palette: { from: "#1a3018", via: "#0a1808", to: "#040804", accent: "#90e0a0" },
    emojis: ["🌴", "🧘", "🌺"],
  },
  {
    key: "newyork",
    match: /(new york|nueva york|nyc|manhattan|brooklyn)/i,
    label: "Manhattan Nights",
    vibe: "Manhattan rooftop luxury, sophisticated nightlife",
    outfit: "tailored black coat, silver accents, confident pose",
    accessory: "crystal coupe with champagne",
    background: "cinematic NYC skyline from luxury rooftop, Empire State glow, blue hour lights",
    lighting: "cool blue city lights with warm rim",
    palette: { from: "#0a1a3a", via: "#04081a", to: "#02040a", accent: "#a8c8ff" },
    emojis: ["🌃", "🥂", "🗽"],
  },
  {
    key: "spain",
    match: /(espa[nñ]a|spain|barcelona|madrid|sevilla|ibiza)/i,
    label: "Spanish Soul",
    vibe: "Mediterranean Spanish elegance",
    outfit: "warm linen and leather, summer luxury",
    accessory: "glass of rioja and tapas plate",
    background: "cinematic Barcelona rooftop at sunset, Gaudí silhouettes, warm terracotta",
    lighting: "warm Mediterranean golden hour",
    palette: { from: "#3a1810", via: "#1a0a08", to: "#0a0404", accent: "#f0a060" },
    emojis: ["🥘", "🍷", "💃"],
  },
  {
    key: "default",
    match: /.*/,
    label: "Global Traveler",
    vibe: "cinematic luxury wanderer, timeless premium identity",
    outfit: "tailored cashmere coat, leather travel bag",
    accessory: "vintage compass and leather journal",
    background: "cinematic luxury hotel suite with floor-to-ceiling windows, city skyline at blue hour",
    lighting: "soft golden interior light with cool exterior contrast",
    palette: { from: "#1a1410", via: "#0a0806", to: "#040302", accent: "#c9a961" },
    emojis: ["✈️", "🌍", "🧭"],
  },
];

export function detectCulture(destino?: string | null, pais?: string | null): CultureProfile {
  const haystack = `${destino ?? ""} ${pais ?? ""}`.toLowerCase();
  return CULTURE_PROFILES.find(c => c.key !== "default" && c.match.test(haystack)) ?? CULTURE_PROFILES[CULTURE_PROFILES.length - 1];
}

export const PERSONALITY_LABELS: Record<string, { label: string; tag: string }> = {
  food:      { label: "Food Explorer",      tag: "Gastronomic Soul" },
  adventure: { label: "Adventure Seeker",   tag: "Wild Energy" },
  cultural:  { label: "Cultural Explorer",  tag: "Refined Mind" },
  luxury:    { label: "Luxury Traveler",    tag: "Premium Identity" },
  relax:     { label: "Wellness Traveler",  tag: "Serene Aura" },
  nightlife: { label: "Social Traveler",    tag: "Night Energy" },
  hidden:    { label: "Hidden Gem Hunter",  tag: "Curated Vision" },
};
