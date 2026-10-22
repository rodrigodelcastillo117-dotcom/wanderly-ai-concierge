# IATOS · Entregabilidad del correo (por qué la invitación Privé cayó en Spam y qué hacer)

> Código: `supabase/functions/_shared/prive-email.ts`, `_shared/prive-invite-sender.ts`, `_shared/email.ts`.
> Pruebas: `src/test/priveEmailDeliverability.test.ts`. Diseño: [IATOS_PRIVE_EMAIL_DESIGN.md](IATOS_PRIVE_EMAIL_DESIGN.md).
> **No se envió ningún correo real** para este trabajo: todo se renderizó localmente.

## Resumen para el dueño

- Gmail decide Spam o Bandeja principal sobre todo por **la reputación del dominio** y por **la autenticación**; el contenido pesa menos, pero un correo que "suena a promoción" en un dominio nuevo es la combinación perfecta para Spam.
- **Ya corregido en el código** (se publica con `prive-cron` y `prive-access`): asunto personal en español, nada de palabras de promoción, cero imágenes y cero recursos remotos, sin texto oculto de relleno, todos los enlaces en `traveliatos.life`, texto plano completo, un identificador por invitación para que Gmail no las encadene, y Reply-To solo si hay un buzón que reciba.
- **Lo que solo tú puedes hacer (DNS y cuentas, ~1 hora):** 1) crear un buzón real para `hola@traveliatos.life`; 2) DMARC con reportes; 3) dar de alta el dominio en Google Postmaster Tools; 4) calentar el dominio con poco volumen; 5) en 2–3 semanas, DMARC `quarantine`. Detalle abajo.

## 1. Estado verificado (DNS público, 22-oct-2026, dns.google)

| Registro | Valor actual | Estado |
|---|---|---|
| DKIM `resend._domainkey.traveliatos.life` | Llave publicada (RSA 1024) | OK: los correos salen firmados `d=traveliatos.life` (alineado con el From) |
| SPF del remitente técnico `send.traveliatos.life` | `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all` + MX de rebote | OK |
| SPF de `rsend.traveliatos.life` (el envío real de prueba salió por aquí, Amazon SES) | `v=spf1 include:amazonses.com ~all` | OK |
| DMARC `_dmarc.traveliatos.life` | `v=DMARC1; p=none;` | **Débil**: sin `rua` (nadie recibe reportes) y sin política |
| MX de `traveliatos.life` | **No existe** | **Problema**: `hola@traveliatos.life` no puede recibir; las respuestas rebotan |
| SPF en la raíz `traveliatos.life` | No existe | Normal hoy (el sobre usa los subdominios); habrá que agregarlo al crear el buzón |

Evidencia de un envío anterior a un buzón sintético: `docs/iatos/evidencia/release10/prive/01f_cabeceras_y_dns.md`.

## 2. Qué cambió en el código

| Antes | Ahora | Por qué ayuda |
|---|---|---|
| Asunto en inglés "A private invitation awaits you." | "Rodrigo, tu invitación a IATOS Privé" (≤ 45 caracteres; sin nombre si no cabe) | El patrón "awaits you / private invitation" es típico de fraude; un asunto personal, en el idioma de la persona y sin signos raros parece correo 1-a-1 |
| Cuerpo mezclado inglés/español | Todo en el idioma de la persona (español por defecto; inglés si el perfil dice `en`) | Coherencia de idioma = menos señales de plantilla masiva |
| Preencabezado + **60 repeticiones de caracteres invisibles** | Solo el preencabezado | Los rellenos invisibles cuentan como "texto oculto" para algunos filtros |
| `<link>` a Google Fonts | Sin recursos remotos (pilas tipográficas del sistema) | Una petición remota menos; Gmail ni siquiera las carga |
| Botón "OPEN YOUR PRIVATE INVITATION" en mayúsculas en el código | "Abrir mi invitación" (versalitas solo por CSS) | Los filtros leen la fuente, no el CSS: nada "gritado" |
| From `IATOS AI <hola@…>` | `IATOS Privé <hola@traveliatos.life>` | Mismo buzón y dominio (la reputación se conserva); nombre visible coherente con el contenido |
| Sin encabezados extra | `X-Entity-Ref-ID: prive-invitacion-<id de invitación>` | Gmail no agrupa invitaciones distintas en el mismo hilo; estable por invitación (un reintento conserva el id) |
| Sin Reply-To | `Reply-To` = `PRIVE_REPLY_TO` **solo si está configurado y es válido** | Que la persona pueda responder es una señal positiva; hoy `hola@` no recibe, por eso no se fuerza |
| Pie "Escríbenos a hola@…" (buzón inexistente) | Con `PRIVE_REPLY_TO`: "Basta con responder a este correo"; sin él, igual que antes (`SUPPORT_EMAIL`) | Ningún enlace a un buzón que rebota cuando hay alternativa |

Los **avisos de seguridad y el restablecimiento** (`prive-access`) también salen como `IATOS Privé`, con Reply-To cuando `PRIVE_REPLY_TO` está configurado, y su pie deja de mandar a un buzón que rebota ("Si no fuiste tú, escríbenos de inmediato" ahora se puede responder de verdad). Comparten el marco nuevo, así que tampoco cargan fuentes remotas ni relleno invisible.

Ya estaba bien y se conserva: parte de texto plano completa (ahora con el enlace, el nombre, por qué lo recibe y el aviso de contraseña), cero imágenes, sin píxel de rastreo, todos los enlaces en `traveliatos.life` (la prueba lo exige), el texto del enlace de respaldo es la misma dirección del `href`, sin acortadores.

**No se agregó `List-Unsubscribe`**: es un correo transaccional 1-a-1 (una invitación personal), no un envío masivo; Gmail exige ese encabezado a remitentes masivos (> 5 000/día), que no es el caso.

**Idioma:** la base no guarda hoy el idioma del perfil, así que todas las invitaciones van en español. El código ya acepta `locale` en la fila que devuelve `prive_claim_invitation_emails`; cuando exista un campo (por ejemplo `profiles.preferred_language`, llenado desde `navigator.language` al registrarse), basta con devolverlo en esa función para que quien tenga inglés reciba la versión en inglés.

Pruebas automáticas (`priveEmailDeliverability.test.ts`): tamaño < 30 KB (Gmail recorta a 102 KB; la invitación pesa ~12–13 KB), lista de palabras de promoción en español e inglés, sin `!`, asunto ≤ 45 caracteres, cero imágenes/recursos remotos/relleno invisible, todos los enlaces en el dominio, texto de enlace que no simula otra dirección, `lang`, encabezados (`X-Entity-Ref-ID` estable, sin token, sin `List-Unsubscribe`), Reply-To válido o ninguno, encabezados de una sola línea (no se puede inyectar otro).

## 3. Acciones del dueño (DNS y cuentas)

Hazlas en este orden. Ninguna requiere tocar código.

### 3.1 Un buzón real para `hola@traveliatos.life` (prioridad alta)

Hoy no hay MX: quien responda la invitación recibe un rebote, y los proveedores ven un dominio que envía pero no recibe. Opciones:

| Opción | Costo aprox. | Cuándo elegirla |
|---|---|---|
| **ImprovMX** (reenvío) | Gratis / ~US$9 al mes | Solo quieres que `hola@` llegue a tu Gmail personal. 10 minutos. |
| **Zoho Mail** | Gratis (5 usuarios) / ~US$1 por usuario al mes | Buzón real con webmail, barato |
| **Google Workspace** | ~US$7 por usuario al mes | Quieres Gmail con tu dominio y compartir buzones con el equipo |

Pasos (cualquiera de las tres): agrega los **MX** que te den en la raíz `traveliatos.life`, y su **SPF** en la raíz (por ejemplo Workspace: `v=spf1 include:_spf.google.com ~all`; ImprovMX: `v=spf1 include:spf.improvmx.com ~all`). No toques los registros de `send.`/`rsend.` ni `resend._domainkey` (son de Resend).

Después configura el secreto **`PRIVE_REPLY_TO`** en las funciones (por ejemplo `hola@traveliatos.life` o `concierge@traveliatos.life`): las invitaciones llevarán Reply-To y el pie dirá "basta con responder a este correo". Sin ese secreto todo sigue funcionando, solo sin Reply-To.

### 3.2 DMARC con reportes (hoy)

Cambia el TXT de `_dmarc.traveliatos.life` a:

```
v=DMARC1; p=none; rua=mailto:dmarc@traveliatos.life; adkim=r; aspf=r; pct=100
```

- `rua` necesita un buzón que reciba (3.1). Alternativa sin buzón: un servicio gratuito de reportes (Postmark DMARC Digests, dmarcian, EasyDMARC) que te da su propia dirección `rua`.
- Con reportes ves quién envía en nombre de tu dominio y si todo pasa DKIM/SPF.

### 3.3 Google Postmaster Tools (hoy)

1. Entra a https://postmaster.google.com con tu cuenta de Google, agrega `traveliatos.life` y verifica con el TXT que te pide (en la raíz).
2. En unos días verás reputación del dominio y de IP, tasa de spam reportada y autenticación. Meta: tasa de spam < 0.1 % (nunca > 0.3 %).

### 3.4 Calentamiento del dominio (2–3 semanas)

El dominio es nuevo para Gmail. Antes de enviar invitaciones en lote:
- Semana 1: pocos correos al día (5–20), a personas que los esperan (tú, el equipo, primeros miembros). Pídeles que lo abran, lo **muevan a Principal / marquen "No es spam"** y, si pueden, **respondan** (por eso importa 3.1).
- Semanas 2–3: sube de forma gradual (aprox. ×2 por semana). `prive-cron` envía como máximo 50 invitaciones por corrida (`run.ts`); si el día que se active hay muchas pendientes, conviene bajar ese límite o la frecuencia del cron durante el calentamiento. No hagas reenvíos masivos manuales.
- Evita mandar desde el mismo dominio correos de marketing masivo mientras tanto; si un día los hay, que salgan de un subdominio aparte (p. ej. `news.traveliatos.life`).

### 3.5 DMARC `quarantine` (tras 2–3 semanas de reportes limpios)

Cuando los reportes muestren que todo tu correo legítimo pasa DKIM alineado:

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@traveliatos.life; adkim=r; aspf=r; pct=100
```

Más adelante, `p=reject`. Un DMARC con política es una señal de confianza para Gmail y Yahoo.

### 3.6 Después (opcional)

- **BIMI** (tu logotipo junto al remitente en Gmail): requiere DMARC en `quarantine` o `reject` y un logotipo SVG Tiny PS; el check azul exige un certificado VMC/CMC (~US$1 000+/año). Solo cuando lo anterior esté estable.
- DKIM de 2048 bits si Resend lo ofrece para el dominio (hoy es 1024; funciona, pero 2048 es la recomendación actual).

## 4. Cómo comprobarlo sin riesgo

- Tras 3.1–3.3, envíate **una** invitación de prueba a ti mismo (requiere tu autorización: es un envío real) y en Gmail abre "Mostrar original": deben decir `SPF: PASS`, `DKIM: PASS`, `DMARC: PASS`.
- https://www.mail-tester.com da una calificación de contenido y autenticación con un solo envío.
- Si cae en Spam: márcalo "No es spam" y revisa Postmaster Tools en 48 h.

## 5. Qué publicar

Funciones a volver a publicar (sin migraciones nuevas): **`prive-cron`** y **`prive-access`** (ambas usan `_shared/prive-email.ts`, `_shared/prive-invite-sender.ts` y `_shared/email.ts`). Secreto nuevo opcional: `PRIVE_REPLY_TO`.
