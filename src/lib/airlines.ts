// Aerolínea → código IATA → logo. La lógica vive en supabase/functions/_shared/airlines.ts para que el
// Booking Bridge (offers.ts, también en el servidor) filtre Google Flights por la misma aerolínea.
export * from "../../supabase/functions/_shared/airlines.ts";
