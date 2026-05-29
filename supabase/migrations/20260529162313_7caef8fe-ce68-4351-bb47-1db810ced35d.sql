
-- ============ TABLA: nightlife_premium ============
CREATE TABLE public.nightlife_premium (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciudad text NOT NULL,
  ciudad_display text NOT NULL,
  pais text,
  categoria text NOT NULL,
  emoji text,
  nombre text NOT NULL,
  por_que text,
  descripcion text,
  dress_code text,
  precio_estimado text,
  reserva_requerida boolean NOT NULL DEFAULT false,
  tags text[] DEFAULT '{}',
  address text,
  website text,
  lat numeric,
  lng numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nightlife_ciudad ON public.nightlife_premium (ciudad);
CREATE INDEX idx_nightlife_categoria ON public.nightlife_premium (categoria);

GRANT SELECT ON public.nightlife_premium TO authenticated;
GRANT ALL ON public.nightlife_premium TO service_role;

ALTER TABLE public.nightlife_premium ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nightlife_premium_read_authenticated"
  ON public.nightlife_premium FOR SELECT
  TO authenticated
  USING (active = true);

-- ============ TABLA: nightlife_access ============
CREATE TABLE public.nightlife_access (
  user_id uuid PRIMARY KEY,
  confirmed_adult boolean NOT NULL DEFAULT false,
  confirmed_adult_at timestamptz,
  password_unlocked boolean NOT NULL DEFAULT false,
  password_unlocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nightlife_access TO authenticated;
GRANT ALL ON public.nightlife_access TO service_role;

ALTER TABLE public.nightlife_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nightlife_access_select_own"
  ON public.nightlife_access FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "nightlife_access_insert_own"
  ON public.nightlife_access FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nightlife_access_update_own"
  ON public.nightlife_access FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "nightlife_access_delete_own"
  ON public.nightlife_access FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER nightlife_access_updated_at
  BEFORE UPDATE ON public.nightlife_access
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SEED: venues curados ============
INSERT INTO public.nightlife_premium
  (ciudad, ciudad_display, pais, categoria, emoji, nombre, por_que, descripcion, dress_code, precio_estimado, reserva_requerida, tags, address, website) VALUES

-- PARÍS
('paris','París','Francia','cabaret','🎭','Crazy Horse Paris','Cabaret legendario, arte de iluminación y coreografía elevada al nivel de espectáculo de autor.','Show de cabaret artístico fundado en 1951, referente mundial. Cena + show o solo show con champagne.','Smart elegant','€€€€',true,'{icónico,arte,champagne}','12 Avenue George V, 75008','https://www.lecrazyhorseparis.com'),
('paris','París','Francia','speakeasy','🍸','Little Red Door','Coctelería de autor escondida, top 50 mundial constantes años.','Bar íntimo en Le Marais con cocteles narrativos y servicio de altísimo nivel.','Smart casual','€€€',true,'{cocteles,intimo,top50}','60 Rue Charlot, 75003','https://lrdparis.com'),
('paris','París','Francia','rooftop','🌃','Le Perchoir Marais','Vista 360° sobre París, ambiente cuidado.','Rooftop sobre el BHV con vista a Notre-Dame y la Torre Eiffel. Cocteles + DJ atardecer.','Smart casual','€€€',false,'{vista,sunset,dj}','33 Rue de la Verrerie, 75004','https://leperchoir.fr'),
('paris','París','Francia','jazz_lounge','🎷','Duc des Lombards','Templo del jazz parisino, programación de primer nivel.','Club de jazz íntimo en Châtelet, 2 sets por noche. Cena ligera + show.','Smart casual','€€',true,'{jazz,en vivo,intimo}','42 Rue des Lombards, 75001','https://ducdeslombards.com'),

-- LONDRES
('londres','Londres','Reino Unido','members_club','🥃','Annabel''s','Members club más glamoroso de Londres, decoración maximalista.','Club privado en Berkeley Square. Solo miembros o como invitado de uno. Cena + lounge + club.','Black tie / Cocktail','€€€€€',true,'{exclusivo,miembros,iconico}','46 Berkeley Square, W1J 5AT','https://www.annabels.co.uk'),
('londres','Londres','Reino Unido','cabaret','🎭','Cahoots Underground','Cabaret y burlesque en una estación de metro 1940s recreada.','Experiencia inmersiva años 40 con burlesque ligero, cocteles y vodevil. Ambiente teatral.','Cocktail / vintage','€€€',true,'{inmersivo,vintage,teatral}','13 Kingly Court, W1B 5PW','https://www.cahoots-london.com'),
('londres','Londres','Reino Unido','speakeasy','🍸','The Connaught Bar','Best Bar in the World múltiples años, martini icónico al lado de la mesa.','Bar del Hotel Connaught en Mayfair, ritual del martini servido en carrito.','Smart elegant','€€€€',true,'{martini,mayfair,top1}','Carlos Place, W1K 2AL','https://www.the-connaught.co.uk/connaught-bar'),
('londres','Londres','Reino Unido','rooftop','🌃','Sushisamba Heron Tower','Vista 360° desde el piso 38, ambiente vibrante.','Rooftop con cocina nikkei, vista a la City y al Támesis. Reserva con vista garantizada.','Smart casual','€€€€',true,'{vista,nikkei,piso38}','110 Bishopsgate, EC2N 4AY','https://www.sushisamba.com/london'),

-- NUEVA YORK
('nueva york','Nueva York','Estados Unidos','speakeasy','🍸','Please Don''t Tell (PDT)','Speakeasy clásico, entrada por una cabina telefónica dentro de Crif Dogs.','Reservas que se abren a las 3pm cada día. Cocteles impecables, capacidad mínima.','Smart casual','$$$',true,'{speakeasy,iconico,reserva dificil}','113 St Marks Place','https://www.pdtnyc.com'),
('nueva york','Nueva York','Estados Unidos','jazz_lounge','🎷','Village Vanguard','Club de jazz más legendario del mundo, abierto desde 1935.','Sótano en West Village, donde grabaron Coltrane y Evans. Solo jazz puro.','Smart casual','$$$',true,'{jazz,leyenda,historia}','178 Seventh Avenue South','https://villagevanguard.com'),
('nueva york','Nueva York','Estados Unidos','rooftop','🌃','The Top of The Standard','Vista de Hudson + Manhattan desde el High Line, ambiente Studio 54 contemporáneo.','Rooftop del Standard High Line, ambiente cuidado, dress code estricto.','Cocktail','$$$$',true,'{vista,high line,exclusivo}','848 Washington St','https://www.standardhotels.com/new-york/properties/high-line'),
('nueva york','Nueva York','Estados Unidos','cabaret','🎭','The Box NYC','Variety show teatral con burlesque, vodevil y performance art.','Show nocturno con elenco rotativo, mesa con bottle service o barra. Ambiente adulto-artístico.','Cocktail / chic','$$$$',true,'{variety,burlesque,downtown}','189 Chrystie Street','https://www.theboxnyc.com'),

-- LAS VEGAS
('las vegas','Las Vegas','Estados Unidos','casino_vip','🎰','Bellagio Salon Privé','Salones privados de alto límite del Bellagio.','Acceso por invitación o nivel de juego. Servicio dedicado, host personal.','Smart elegant','$$$$$',true,'{vip,high limit,host}','3600 S Las Vegas Blvd','https://bellagio.mgmresorts.com'),
('las vegas','Las Vegas','Estados Unidos','cabaret','🎭','Absinthe at Caesars Palace','Variety show acrobático bajo carpa íntima, premio Best of Las Vegas múltiples años.','Show de circo contemporáneo + comedia adulta. Solo +18.','Smart casual','$$$',true,'{circo,acrobacia,premiado}','3570 S Las Vegas Blvd','https://www.spiegelworld.com/absinthe'),
('las vegas','Las Vegas','Estados Unidos','rooftop','🌃','Skyfall Lounge - Delano','Vista panorámica desde el piso 64, cocteles + DJ.','Lounge del Delano, vista al Strip, ambiente íntimo y elevado.','Cocktail','$$$$',false,'{vista,piso64,dj}','3940 S Las Vegas Blvd','https://delanolasvegas.mgmresorts.com'),

-- CDMX
('ciudad de mexico','Ciudad de México','México','speakeasy','🍸','Hanky Panky','#1 en North America''s 50 Best Bars 2023. Entrada secreta detrás de una cocina.','Speakeasy en Juárez, cocteles narrativos de altísimo nivel. Reserva con varios días.','Smart casual','$$$',true,'{top50,speakeasy,reserva}','Turín 69, Juárez','https://www.hankypanky.mx'),
('ciudad de mexico','Ciudad de México','México','rooftop','🌃','Fifty Mils - Four Seasons','Coctelería premiada en Paseo de la Reforma, ambiente íntimo.','Bar del Four Seasons CDMX, cocteles de autor con producto mexicano. Top 50 LATAM.','Smart casual','$$$',false,'{four seasons,reforma,top50}','Paseo de la Reforma 500','https://www.fourseasons.com/mexico'),
('ciudad de mexico','Ciudad de México','México','jazz_lounge','🎷','Parker & Lenox','Jazz en vivo todas las noches en la Juárez, modelo de NY.','Bar con jazz/blues en vivo, cocina americana ligera. Reserva recomendada en fin de semana.','Smart casual','$$',true,'{jazz,en vivo,juarez}','Milán 14, Juárez','https://parkerandlenox.com'),
('ciudad de mexico','Ciudad de México','México','members_club','🥃','Soho House Mexico City','Members club global con casa en Colonia Juárez.','Acceso solo miembros o como guest. Rooftop, restaurante, eventos curados.','Smart casual','$$$$',true,'{miembros,global,rooftop}','Tampico 32, Roma Norte','https://www.sohohouse.com'),

-- DUBÁI
('dubai','Dubái','Emiratos Árabes Unidos','rooftop','🌃','CÉ LA VI Dubai','Rooftop en Address Sky View, vista a Burj Khalifa.','Restaurante + lounge + club asiático-contemporáneo, vista a la fuente del Burj.','Smart elegant','$$$$',true,'{burj khalifa,vista,asia}','Address Sky View, Downtown','https://celavi.com/en/dubai'),
('dubai','Dubái','Emiratos Árabes Unidos','members_club','🥃','Soho Garden DXB','Complejo con varios conceptos premium: lounge, restaurant, club.','Multi-venue en Meydan, eventos con DJs internacionales.','Smart elegant','$$$$',true,'{multi-concepto,dj,meydan}','Meydan Racecourse','https://sohogardendxb.com'),

-- TOKIO
('tokio','Tokio','Japón','speakeasy','🍸','Bar High Five','Templo del cocktail clásico, dirigido por el maestro Hidetsugu Ueno.','Bar pequeño en Ginza, cocteles a medida según tu gusto. Ritual y silencio.','Smart casual','¥¥¥',false,'{ginza,clasico,maestro}','Efflore Ginza 5 Building B1F','https://barhighfive.com'),
('tokio','Tokio','Japón','jazz_lounge','🎷','Cotton Club Tokyo','Hermana del Blue Note, programación internacional de jazz.','Club de jazz formal en Marunouchi, cena + show de artistas globales.','Smart elegant','¥¥¥¥',true,'{jazz,marunouchi,internacional}','Tokia 2F, 2-7-3 Marunouchi','https://www.cottonclubjapan.co.jp'),

-- BERLÍN
('berlin','Berlín','Alemania','members_club','🥃','Soho House Berlin','Members club en edificio Bauhaus de los 30s.','Acceso miembros/guests. Rooftop, cine, gym, restaurante. Casa imperdible para HNW viajeros.','Smart casual','€€€€',true,'{bauhaus,rooftop,cine}','Torstrasse 1','https://www.sohohouse.com'),

-- IBIZA
('ibiza','Ibiza','España','rooftop','🌃','Experimental Beach Ibiza','Beach club elegante de los Experimental Group (París/NY/Londres).','Cocteles, mediterránea, sunset DJ. Reserva imprescindible en alta temporada.','Resort chic','€€€€',true,'{beach club,sunset,experimental}','Cap des Falcó, Ses Salines','https://www.experimentalgroup.com'),
('ibiza','Ibiza','España','evento_vip','🥂','Pacha VIP Room','VIP del club legendario de Ibiza.','Acceso reservado al área VIP del histórico Pacha, mesa con bottle service.','Smart elegant','€€€€€',true,'{vip,legendario,bottle service}','Avenida 8 de Agosto','https://pacha.com'),

-- MIAMI
('miami','Miami','Estados Unidos','rooftop','🌃','Sugar - EAST Miami','Rooftop asiático en el piso 40 con jardín tropical.','Rooftop garden bar con vista 360° a Brickell, ambiente íntimo y elevado.','Smart casual','$$$',false,'{brickell,jardin,piso40}','788 Brickell Plaza','https://www.east-miami.com'),
('miami','Miami','Estados Unidos','speakeasy','🍸','Sweet Liberty','Bar premiado, top 50 NA Bars varios años.','Bar de neighborhood elevado en Mid-Beach, cocteles consistentes y excelente cocina.','Casual chic','$$$',false,'{top50,mid-beach,vecindario}','237 20th Street','https://mysweetliberty.com');
