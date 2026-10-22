// Datos de MUESTRA para renderizar los correos (docs/iatos/evidencia/emails/). No son datos reales:
// nombres, folios y precios son inventados para la evidencia visual; las fotos son de Wikimedia
// Commons con su crédito real (en producción la portada sale de Pexels con su crédito).
import type { HeroImage } from "../../supabase/functions/_shared/email-templates";

export const NOW = new Date("2026-10-22T20:08:00Z"); // 14:08 h CDMX
export const SITE = "https://traveliatos.life";

export const PHOTOS: Record<string, HeroImage> = {
  tokyo: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/75/Minato_City%2C_Tokyo%2C_Japan_%28Night%29.jpg/1280px-Minato_City%2C_Tokyo%2C_Japan_%28Night%29.jpg",
    alt: "Vista nocturna de Minato, Tokio",
    credit: "Foto de muestra · Wikimedia Commons · David Kernan (CC BY 4.0)",
    creditUrl: "https://commons.wikimedia.org/wiki/File:Minato_City,_Tokyo,_Japan_(Night).jpg",
  },
  tokyoTower: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Tokyo_Tower%2C_Minato_City.jpg/1280px-Tokyo_Tower%2C_Minato_City.jpg",
    alt: "Torre de Tokio al atardecer",
    credit: "Foto de muestra · Wikimedia Commons · David Kernan (CC BY 4.0)",
    creditUrl: "https://commons.wikimedia.org/wiki/File:Tokyo_Tower,_Minato_City.jpg",
  },
  barcelona: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Aerial_view_of_La_Sagrada_Familia%2C_Barcelona%2C_Spain_%2851227006134%29.jpg/1280px-Aerial_view_of_La_Sagrada_Familia%2C_Barcelona%2C_Spain_%2851227006134%29.jpg",
    alt: "Vista aérea de la Sagrada Familia, Barcelona",
    credit: "Foto de muestra · Wikimedia Commons · dronepicr (CC BY 2.0)",
    creditUrl: "https://commons.wikimedia.org/wiki/File:Aerial_view_of_La_Sagrada_Familia,_Barcelona,_Spain_(51227006134).jpg",
  },
};
export const HOTEL_PHOTO = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b1/Lobby_lounge_of_Amantaka_Suite_Amantaka_luxury_Resort_%26_Hotel_Luang_Prabang_Laos.jpg/1280px-Lobby_lounge_of_Amantaka_Suite_Amantaka_luxury_Resort_%26_Hotel_Luang_Prabang_Laos.jpg";

/** Ruta local de cada foto de muestra (las capturas no salen a internet). */
export const LOCAL_ASSETS: Record<string, string> = {
  [PHOTOS.tokyo.url]: "tokyo.jpg",
  [PHOTOS.tokyoTower.url]: "tokyotower.jpg",
  [PHOTOS.barcelona.url]: "barcelona.jpg",
  [HOTEL_PHOTO]: "hotel.jpg",
};
