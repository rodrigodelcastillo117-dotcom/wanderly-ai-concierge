-- Bóveda "vieja" (jsonb, antes de 20261023190000): números de pasaporte y de socio en la tabla que
-- lee la IA, una fecha imposible, un número con símbolos y un elemento que no es objeto.
RESET ROLE;
INSERT INTO auth.users(id,email) VALUES ('b0000000-0000-4000-8000-0000000000c3','b-legacy@example.test') ON CONFLICT DO NOTHING;
INSERT INTO public.user_vault_benefits (user_id, credit_cards, airline_alliances, hotel_loyalty, car_rentals, travel_documents)
VALUES ('b0000000-0000-4000-8000-0000000000c3',
  '[{"bank":"American Express","card_name":"The Platinum Card","card_tier":"Platino","network":"Amex","perks_enabled":["Acceso a salas",{"raro":1}],"lounge_access":["Centurion"],"ai_autofilled":true}]',
  '[{"alliance_name":"SkyTeam","airline":"Aeroméxico","membership_number":"AM<123>456","tier_status":"Gold","seat_preference":"Pasillo"}]',
  '[{"chain_name":"Marriott Bonvoy","member_id":"MB998877","status_tier":"Platinum","room_preferences":"Piso alto"}]',
  '[{"company_name":"Hertz","customer_id":"HZ5544","preferred_car_type":"SUV"}, "texto suelto"]',
  '[{"doc_type":"Pasaporte","number":"G12345678","country":"México","expires":"2027-03-01"},{"doc_type":"Visa USA","number":"V9988","expires":"2031-02-30"},{"doc_type":"Global Entry","number":"KTN15151515"}]')
ON CONFLICT (user_id) DO NOTHING;
