// Dominios oficiales de Ticketmaster por país (Discovery API v2 devuelve el del mercado del evento). Módulo
// chico: lo usan la lista blanca del servidor (allowlist.ts), la del navegador y _shared/ticketmaster.ts.
export const TM_DOMAINS = [
  "ticketmaster.com", "ticketmaster.com.mx", "ticketmaster.ca", "ticketmaster.co.uk", "ticketmaster.ie", "ticketmaster.es", "ticketmaster.de",
  "ticketmaster.fr", "ticketmaster.it", "ticketmaster.nl", "ticketmaster.be", "ticketmaster.at", "ticketmaster.ch", "ticketmaster.dk",
  "ticketmaster.se", "ticketmaster.no", "ticketmaster.fi", "ticketmaster.pl", "ticketmaster.cz", "ticketmaster.com.au", "ticketmaster.co.nz",
  "ticketmaster.com.br", "ticketmaster.cl", "ticketmaster.com.pe", "ticketmaster.ae",
] as const;
