# Pedidos del dueño (22-oct-2026) — rastreador

Cada pedido tiene un equipo responsable y un estado. Nada se publica sin autorización explícita del dueño (regla de la Operación Cierre Total), salvo lo que el dueño autorizó en el momento (marcado "Publicado con OK").

| # | Pedido | Equipo / rama | Estado |
|---|---|---|---|
| 1 | Auditoría independiente: AUD-01 sesiones Privé | aud-prive | En curso |
| 2 | AUD-02/03/06 Reservas IA (remitente, confirmaciones ambiguas, evidencia) | aud-reservas | VERIFICADO (3/3 + 8 hallazgos nuevos corregidos); en deploy urgente; función sigue APAGADA |
| 3 | AUD-04/07 enlaces de compra, dominios y phishing | aud-bridge | VERIFICADO; en deploy urgente |
| 4 | AUD-05/08 Stripe atómico/idempotente + certificación comercial | aud-pagos | En curso |
| 5 | Fase 2 seguridad completa + Fase 3 calidad de pruebas | aud-seguridad | En curso |
| 6 | Fase 2 Iato, cotizaciones, operación | aud-iato | 8 hallazgos VERIFICADOS, 11 refutados; en deploy urgente |
| 7 | Fase 4 rendimiento: Iato < 4 s al primer texto, carga en 3G, peso inicial | rendimiento | En curso |
| 8 | NEW-01 invitación pendiente tras revocar concesión | aud-prive | En curso |
| 9 | Privé en el idioma de cada persona | wc-prive-ux | En curso |
| 10 | Privé: fotos/videos en todas las ciudades | wc-prive-ux | En curso |
| 11 | Privé: lista no infinita (búsqueda, regiones, carruseles) | wc-prive-ux | En curso |
| 12 | Privé: contraseña "incorrecta" en pestaña nueva | lead (f62466e) | Publicado (antes de la regla) |
| 13 | Volver a la invitación después de iniciar sesión | lead (f62466e) | Publicado (antes de la regla) |
| 14 | "kiwi.com rechazó la conexión" → enlaces externos en pestaña nueva | lead (f62466e) | Publicado (antes de la regla) |
| 15 | Correo de salud: Gemini saturado sin JSON crudo | lead (f62466e) | Publicado (antes de la regla) |
| 16 | "Planea tu primer viaje" con video (versión vieja en pestaña abierta) + aviso de versión nueva | lead (f62466e) | Publicado (antes de la regla) |
| 17 | Invitación Privé a rodrigo.delcastillo@vonhaucke.mx | lead | Enviada con OK (13:44 UTC) |
| 18 | Quitar Privé de la cuenta Gmail | lead | Hecho con OK |
| 19 | Ver con qué correo estás dentro (bajo el nombre) | lead (f6cdc51) | Publicado con OK |
| 20 | Social: "Ver" abre el perfil del amigo con avatar | wc-social | Terminado; en deploy urgente |
| 21 | Social: viajes juntos, postal de 2 avatares, saludo, próximo viaje juntos, sin "0 %" | wc-social | Terminado; en deploy urgente |
| 22 | Palomita dorada "verificado" Privé visible para amigos y en Social | wc-social + wc-avatar | En curso |
| 23 | Avatar que sí se parezca | wc-avatar | En curso |
| 24 | Avatar que evoluciona con cada país/ciudad visitada | wc-avatar | En curso |
| 25 | Subir viajes pasados (boletos, reservas) con precios pagados | wc-avatar | En curso |
| 26 | Travel DNA en español y con datos reales (no 0 %) | wc-avatar | En curso |
| 27 | Encabezado del perfil: avatar real en vez de "R" + Travel DNA + sello Privé | wc-avatar | En curso |
| 28 | Avatar circular dentro del anillo dorado | wc-avatar | En curso |
| 29 | Iato usa tus viajes; Mejores momentos con prioridad | wc-personal | Terminado; en deploy urgente |
| 30 | "Evolución detectada" en segunda persona | wc-personal | Terminado; en deploy urgente |
| 31 | Bóveda: membresías y beneficios de cada una | wc-boveda | En curso |
| 32 | Bóveda: pasaporte, visa, documentos con foto | wc-boveda | En curso |
| 33 | Gastos: pestañas entendibles + calculadora sin viaje | wc-gastos | Terminado; en deploy urgente |
| 34 | Members Only sin scroll infinito + videos únicos por ciudad | wc-gastos | Terminado; en deploy urgente |
| 35 | Invitación Privé "super MEGA ELITE" | wc-prive-email | Terminado; en deploy urgente |
| 36 | Que los correos no lleguen a spam | wc-prive-email (código) + dueño (DNS) | En curso / acción del dueño |
| 37 | Paquete ZIP + SHA para la segunda auditoría de ChatGPT | lead | Al cierre |
| 38 | Contraseña Privé: nadie debe quedarse fuera (espacios/acentos, guardar en el navegador, restablecer visible) | lead (42f05e8) | Listo en rama; sale en la publicación única |
| 39 | Mantener sesión Privé en este dispositivo (30 días) | aud-prive | En curso |
| 40 | IATOS PRIVÉ — THE WORLD REIMAGINED (rediseño frontend total, fases 0–16) | wc-prive-ux | En curso |
| 41 | THE PRIVÉ KEY + YOUR WORLD IS READY + Curated for You + Your Next Journey + 48 Hours + Surprise Me | wc-privekey | En curso |
| 42 | PRIVÉ DROPS, PRIVILEGE RADAR, INSIDER'S NOTEBOOK, PRIVATE EDIT, PASSPORT, vista previa antes del día 90, costos y métricas | wc-privevalor | En curso |
| 43 | Publicación: el dueño dio su OK y prefiere **una sola salida con todo** | lead | Pendiente de cerrar todo |
| 44 | THE PRIVATE EDITION: revista personalizada (Latest Issue, My Edition, World Briefing, Privé Opportunities, Flight Edition PDF/offline, Library), panel editorial, fuentes y licencias, From Page to Experience | wc-edition (Privé Drops = fuente única de oportunidades; The Private Edit se integra aquí) | En curso |
| 45 | Avatar: mujeres nunca con barba; hombres solo si la foto la muestra | lead (8c8bfaf) | Corregido; en deploy urgente |
| 46 | Mariela Del Castillo (hermana): PRO + invitación Privé | lead | Hecho con OK (PRO de cortesía ya existente; Privé de por vida; correo enviado 14:46 UTC) |
| 47 | Deploy urgente de lo terminado (autorizado por el dueño) | lead | En curso |
