# Pedidos del dueño (22-oct-2026) — rastreador

Cada pedido tiene un equipo responsable y un estado. Nada se publica sin autorización explícita del dueño (regla de la Operación Cierre Total), salvo lo que el dueño autorizó en el momento (marcado "Publicado con OK").

| # | Pedido | Equipo / rama | Estado |
|---|---|---|---|
| 1 | Auditoría independiente: AUD-01 sesiones Privé | aud-prive | VERIFICADO; en la publicación final |
| 2 | AUD-02/03/06 Reservas IA (remitente, confirmaciones ambiguas, evidencia) | aud-reservas | VERIFICADO (3/3 + 8 hallazgos nuevos corregidos); publicado (16:40 UTC); función sigue APAGADA |
| 3 | AUD-04/07 enlaces de compra, dominios y phishing | aud-bridge | VERIFICADO; publicado (16:40 UTC) |
| 4 | AUD-05/08 Stripe atómico/idempotente + certificación comercial | aud-pagos | AUD-05 VERIFICADO; AUD-08 código corregido, certificación BLOQUEADA (la firma el dueño en Stripe); en la publicación final |
| 5 | Fase 2 seguridad completa + Fase 3 calidad de pruebas | aud-seguridad | 5 hallazgos VERIFICADOS, 46 funciones nuevas revisadas sin huecos; en la publicación final |
| 6 | Fase 2 Iato, cotizaciones, operación | aud-iato | 8 hallazgos VERIFICADOS, 11 refutados; publicado (16:40 UTC) |
| 7 | Fase 4 rendimiento: Iato < 4 s al primer texto, carga en 3G, peso inicial | rendimiento | Iato primer texto ~1 s simulado (en vivo por medir); app 199→163 KB; en la publicación final |
| 8 | NEW-01 invitación pendiente tras revocar concesión | aud-prive | VERIFICADO (limpieza única de la cuenta Gmail incluida); en la publicación final |
| 9 | Privé en el idioma de cada persona | wc-prive-ux | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 10 | Privé: fotos/videos en todas las ciudades | wc-prive-ux | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 11 | Privé: lista no infinita (búsqueda, regiones, carruseles) | wc-prive-ux | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 12 | Privé: contraseña "incorrecta" en pestaña nueva | lead (f62466e) | Publicado (antes de la regla) |
| 13 | Volver a la invitación después de iniciar sesión | lead (f62466e) | Publicado (antes de la regla) |
| 14 | "kiwi.com rechazó la conexión" → enlaces externos en pestaña nueva | lead (f62466e) | Publicado (antes de la regla) |
| 15 | Correo de salud: Gemini saturado sin JSON crudo | lead (f62466e) | Publicado (antes de la regla) |
| 16 | "Planea tu primer viaje" con video (versión vieja en pestaña abierta) + aviso de versión nueva | lead (f62466e) | Publicado (antes de la regla) |
| 17 | Invitación Privé a rodrigo.delcastillo@vonhaucke.mx | lead | Enviada con OK (13:44 UTC) |
| 18 | Quitar Privé de la cuenta Gmail | lead | Hecho con OK |
| 19 | Ver con qué correo estás dentro (bajo el nombre) | lead (f6cdc51) | Publicado con OK |
| 20 | Social: "Ver" abre el perfil del amigo con avatar | wc-social | Publicado (16:40 UTC) |
| 21 | Social: viajes juntos, postal de 2 avatares, saludo, próximo viaje juntos, sin "0 %" | wc-social | Publicado (16:40 UTC) |
| 22 | Palomita dorada "verificado" Privé visible para amigos y en Social | wc-social + wc-avatar | Social y perfil de amigo: publicado (16:40 UTC); tu propio perfil: en la publicación final |
| 23 | Avatar que sí se parezca | wc-avatar | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 24 | Avatar que evoluciona con cada país/ciudad visitada | wc-avatar | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 25 | Subir viajes pasados (boletos, reservas) con precios pagados | wc-avatar | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 26 | Travel DNA en español y con datos reales (no 0 %) | wc-avatar | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 27 | Encabezado del perfil: avatar real en vez de "R" + Travel DNA + sello Privé | wc-avatar | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 28 | Avatar circular dentro del anillo dorado | wc-avatar | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 29 | Iato usa tus viajes; Mejores momentos con prioridad | wc-personal | Publicado (16:40 UTC) |
| 30 | "Evolución detectada" en segunda persona | wc-personal | Publicado (16:40 UTC) |
| 31 | Bóveda: membresías y beneficios de cada una | wc-boveda | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 32 | Bóveda: pasaporte, visa, documentos con foto | wc-boveda | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 33 | Gastos: pestañas entendibles + calculadora sin viaje | wc-gastos | Publicado (16:40 UTC) |
| 34 | Members Only sin scroll infinito + videos únicos por ciudad | wc-gastos | Publicado (16:40 UTC) |
| 35 | Invitación Privé "super MEGA ELITE" | wc-prive-email | Publicado (16:40 UTC) |
| 36 | Que los correos no lleguen a spam | wc-prive-email (código) + dueño (DNS) | En curso / acción del dueño |
| 37 | Paquete ZIP + SHA para la segunda auditoría de ChatGPT | lead | Al cierre |
| 38 | Contraseña Privé: nadie debe quedarse fuera (espacios/acentos, guardar en el navegador, restablecer visible) | lead (42f05e8) | Publicado (16:40 UTC) |
| 39 | Mantener sesión Privé en este dispositivo (30 días) | aud-prive | VERIFICADO (opcional, apagado por omisión); en la publicación final |
| 40 | IATOS PRIVÉ — THE WORLD REIMAGINED (rediseño frontend total, fases 0–16) | wc-prive-ux | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 41 | THE PRIVÉ KEY + YOUR WORLD IS READY + Curated for You + Your Next Journey + 48 Hours + Surprise Me | wc-privekey | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 42 | PRIVÉ DROPS, PRIVILEGE RADAR, INSIDER'S NOTEBOOK, PRIVATE EDIT, PASSPORT, vista previa antes del día 90, costos y métricas | wc-privevalor | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 43 | Publicación: el dueño dio su OK y prefiere **una sola salida con todo** | lead | QA final en curso; luego OK del dueño |
| 44 | THE PRIVATE EDITION: revista personalizada (Latest Issue, My Edition, World Briefing, Privé Opportunities, Flight Edition PDF/offline, Library), panel editorial, fuentes y licencias, From Page to Experience | wc-edition (Privé Drops = fuente única de oportunidades; The Private Edit se integra aquí) | Terminado y probado; en la publicación final (claude/cierre-wave2) |
| 45 | Avatar: mujeres nunca con barba; hombres solo si la foto la muestra | lead (8c8bfaf) | Corregido; publicado (16:40 UTC) |
| 46 | Mariela Del Castillo (hermana): PRO + invitación Privé | lead | Hecho con OK (PRO de cortesía ya existente; Privé de por vida; correo enviado 14:46 UTC) |
| 47 | Deploy urgente de lo terminado (autorizado por el dueño) | lead | Publicado 16:40 UTC: 4 migraciones, 64 funciones, app index-BAreo5Yi.js |
