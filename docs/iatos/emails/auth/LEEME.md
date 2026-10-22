# Plantillas premium de los correos de Supabase Auth

Estos correos (confirmar cuenta, enlace mágico, restablecer contraseña, cambio de correo, invitación y
código de reautenticación) **no salen del código de IATOS**: los manda Supabase Auth con las plantillas
configuradas en el panel. Por eso hay que pegarlas a mano. Están hechas con el mismo sistema que el
resto de los correos (`supabase/functions/_shared/email-kit.ts`): negro profundo, dorado champaña,
serif editorial, monograma en texto vivo, botón compatible con Outlook, modo oscuro y sin imágenes
(se ven igual con imágenes bloqueadas).

Se regeneran con `npx tsx scripts/emails/auth-templates.ts`. Capturas de muestra (con las variables
ya sustituidas por datos de ejemplo) en `docs/iatos/evidencia/emails/auth-*.png`.

## Qué pegar en cada plantilla

| Plantilla en el panel | Archivo | Asunto (Subject) |
|---|---|---|
| Confirm signup | `confirmacion.html` | Confirma tu correo para entrar a IATOS |
| Magic Link | `enlace-magico.html` | Tu enlace para entrar a IATOS |
| Reset Password | `restablecer-contrasena.html` | Restablece tu contraseña de IATOS |
| Change Email Address | `cambio-de-correo.html` | Confirma tu nuevo correo en IATOS |
| Invite user | `invitacion.html` | Te invitaron a IATOS |
| Reauthentication | `reautenticacion.html` | Tu código de verificación de IATOS |

## Cómo pegarlas

1. Abre el proyecto en el panel de Supabase (en Lovable Cloud: la sección de autenticación/correos
   del proyecto; si tu plan no muestra el editor de plantillas, pídele a Lovable que pegue estos
   archivos tal cual en las plantillas de Auth).
2. Ve a **Authentication → Emails → Templates** (en versiones anteriores: *Email Templates*).
3. Para cada fila de la tabla: elige la plantilla, pega el **Asunto**, cambia el editor a
   **Source / HTML**, borra lo que haya y pega el contenido completo del archivo `.html`.
4. Guarda y envíate una prueba (por ejemplo, "Olvidé mi contraseña" con tu propio correo).

## Variables que usan (no las cambies)

- `{{ .ConfirmationURL }}` — el enlace que arma Supabase. Respeta los `redirectTo` que ya usa la app
  (`/onboarding` al confirmar, `/reset-password` al restablecer), así que el flujo actual no cambia.
- `{{ .Email }}` y `{{ .NewEmail }}` — solo en el cambio de correo.
- `{{ .Token }}` — el código de 6 dígitos de la reautenticación.

No llevan imágenes externas ni rastreo, y ningún enlace lleva el correo de la persona como parámetro
(solo el enlace firmado de Supabase).

## Remitente

El remitente de estos correos se configura aparte (SMTP propio en Authentication → SMTP Settings).
Mientras se use el SMTP por defecto de Supabase, el remitente y los límites de envío son los de
Supabase. Para que salgan como `IATOS <hola@traveliatos.life>` hay que configurar el SMTP de Resend
con el dominio verificado (decisión y credenciales del dueño).
