# Pedidos del dueño (22-oct-2026) — rastreador

Cada pedido tiene un equipo responsable y un estado. Nada se publica sin autorización explícita del dueño (regla de la Operación Cierre Total), salvo lo que el dueño autorizó en el momento (marcado "Publicado con OK").

| # | Pedido | Equipo / rama | Estado |
|---|---|---|---|
| 1 | Auditoría independiente: AUD-01 sesiones Privé | aud-prive | En curso |
| 2 | AUD-02/03/06 Reservas IA (remitente, confirmaciones ambiguas, evidencia) | aud-reservas | En curso |
| 3 | AUD-04/07 enlaces de compra, dominios y phishing | aud-bridge | En curso |
| 4 | AUD-05/08 Stripe atómico/idempotente + certificación comercial | aud-pagos | En curso |
| 5 | Fase 2 seguridad completa + Fase 3 calidad de pruebas | aud-seguridad | En curso |
| 6 | Fase 2 Iato, cotizaciones, operación | aud-iato | En curso |
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
| 20 | Social: "Ver" abre el perfil del amigo con avatar | wc-social | En curso |
| 21 | Social: viajes juntos, postal de 2 avatares, saludo, próximo viaje juntos, sin "0 %" | wc-social | En curso |
| 22 | Palomita dorada "verificado" Privé visible para amigos y en Social | wc-social + wc-avatar | En curso |
| 23 | Avatar que sí se parezca | wc-avatar | En curso |
| 24 | Avatar que evoluciona con cada país/ciudad visitada | wc-avatar | En curso |
| 25 | Subir viajes pasados (boletos, reservas) con precios pagados | wc-avatar | En curso |
| 26 | Travel DNA en español y con datos reales (no 0 %) | wc-avatar | En curso |
| 27 | Encabezado del perfil: avatar real en vez de "R" + Travel DNA + sello Privé | wc-avatar | En curso |
| 28 | Avatar circular dentro del anillo dorado | wc-avatar | En curso |
| 29 | Iato usa tus viajes; Mejores momentos con prioridad | wc-personal | En curso |
| 30 | "Evolución detectada" en segunda persona | wc-personal | En curso |
| 31 | Bóveda: membresías y beneficios de cada una | wc-boveda | En curso |
| 32 | Bóveda: pasaporte, visa, documentos con foto | wc-boveda | En curso |
| 33 | Gastos: pestañas entendibles + calculadora sin viaje | wc-gastos | En curso |
| 34 | Members Only sin scroll infinito + videos únicos por ciudad | wc-gastos | En curso |
| 35 | Invitación Privé "super MEGA ELITE" | wc-prive-email | En curso |
| 36 | Que los correos no lleguen a spam | wc-prive-email (código) + dueño (DNS) | En curso / acción del dueño |
| 37 | Paquete ZIP + SHA para la segunda auditoría de ChatGPT | lead | Al cierre |
