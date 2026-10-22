// Genera las plantillas premium de los correos de Supabase Auth (confirmación, enlace mágico,
// restablecer contraseña, cambio de correo, invitación y reautenticación) en docs/iatos/emails/auth/.
// Esas plantillas viven en el panel de Supabase / Lovable Cloud: aquí solo se generan para pegarlas.
// Uso: npx tsx scripts/emails/auth-templates.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  button, EK, eyebrow, gap, goldRule, headline, masthead, monogram, para, SANS, SERIF, shell,
} from "../../supabase/functions/_shared/email-kit";

const OUT = join(process.cwd(), "docs/iatos/emails/auth");
const EVID = join(process.cwd(), "docs/iatos/evidencia/emails");
mkdirSync(OUT, { recursive: true });
// El sistema solo acepta URLs https: se arma con una URL de marcador y luego se cambia por la
// variable de Supabase ({{ .ConfirmationURL }}), que Supabase sustituye al enviar.
const PLACEHOLDER = "https://iatos-marcador.invalid/confirmation-url";

type Tpl = { file: string; subject: string; eyebrow: string; title: string; lines: string[]; cta?: string; code?: boolean; reason: string; preheader: string };
const T: Tpl[] = [
  {
    file: "confirmacion.html", subject: "Confirma tu correo para entrar a IATOS", eyebrow: "Bienvenido a IATOS",
    title: "Confirma tu correo.", preheader: "Un paso más y tu concierge de viajes queda listo.",
    lines: ["Un paso más y tu concierge de viajes queda listo. Confirma que este correo es tuyo con el botón de abajo."],
    cta: "Confirmar mi correo", reason: "Recibes este correo porque alguien se registró en IATOS con esta dirección. Si no fuiste tú, ignóralo: sin confirmar no se crea la cuenta.",
  },
  {
    file: "enlace-magico.html", subject: "Tu enlace para entrar a IATOS", eyebrow: "Acceso a tu cuenta",
    title: "Tu enlace para entrar.", preheader: "Vence pronto y solo sirve una vez.",
    lines: ["Usa este enlace para entrar a IATOS sin contraseña. Vence pronto y solo sirve una vez."],
    cta: "Entrar a IATOS", reason: "Recibes este correo porque se pidió un enlace de acceso para esta dirección. Si no fuiste tú, ignóralo: nadie puede entrar sin este enlace.",
  },
  {
    file: "restablecer-contrasena.html", subject: "Restablece tu contraseña de IATOS", eyebrow: "Seguridad de tu cuenta",
    title: "Crea una nueva contraseña.", preheader: "El enlace vence pronto y solo sirve una vez.",
    lines: ["Pediste restablecer tu contraseña de IATOS. El enlace vence pronto y solo sirve una vez.", "Si no lo pediste, ignora este correo: tu contraseña no cambia."],
    cta: "Crear nueva contraseña", reason: "Recibes este correo porque se pidió restablecer la contraseña de la cuenta de IATOS de esta dirección.",
  },
  {
    file: "cambio-de-correo.html", subject: "Confirma tu nuevo correo en IATOS", eyebrow: "Seguridad de tu cuenta",
    title: "Confirma tu nuevo correo.", preheader: "Confirma el cambio de correo de tu cuenta.",
    lines: ["Pediste cambiar el correo de tu cuenta de IATOS de {{ .Email }} a {{ .NewEmail }}.", "Confírmalo con el botón de abajo. Si no fuiste tú, no lo confirmes y escríbenos de inmediato."],
    cta: "Confirmar el cambio", reason: "Recibes este correo porque se pidió cambiar el correo de una cuenta de IATOS a esta dirección.",
  },
  {
    file: "invitacion.html", subject: "Te invitaron a IATOS", eyebrow: "Una invitación",
    title: "Te invitaron a IATOS.", preheader: "Tu concierge de viajes con inteligencia artificial te espera.",
    lines: ["Te invitaron a IATOS, el concierge de viajes que cotiza vuelos y hoteles en vivo y te dice de dónde sale cada cifra.", "Acepta la invitación para crear tu cuenta."],
    cta: "Aceptar la invitación", reason: "Recibes este correo porque alguien del equipo de IATOS te invitó con esta dirección.",
  },
  {
    file: "reautenticacion.html", subject: "Tu código de verificación de IATOS", eyebrow: "Seguridad de tu cuenta",
    title: "Tu código de verificación.", preheader: "Escríbelo en IATOS para confirmar que eres tú.",
    lines: ["Escribe este código en IATOS para confirmar que eres tú. Vence pronto."], code: true,
    reason: "Recibes este correo porque se pidió confirmar una acción sensible en tu cuenta de IATOS. Si no fuiste tú, cambia tu contraseña.",
  },
];

for (const t of T) {
  const body = [
    masthead(t.eyebrow),
    gap(56),
    `<tr><td align="center">${monogram("I", 64)}</td></tr>`,
    gap(32),
    eyebrow(t.eyebrow, { align: "center" }),
    gap(14),
    headline(t.title, { align: "center" }),
    gap(20),
    goldRule(48, "center"),
    gap(24),
    ...t.lines.flatMap((l) => [para(l, { align: "center" }), gap(10)]),
    gap(24),
    t.code
      ? `<tr><td align="center" style="padding:0 40px;"><span style="display:inline-block;padding:18px 28px;border:1px solid ${EK.goldDeep};font-family:${SERIF};font-size:40px;line-height:44px;letter-spacing:0.3em;color:${EK.ivory};font-variant-numeric:lining-nums;">{{ .Token }}</span></td></tr>`
      : button(PLACEHOLDER, t.cta!),
    t.code ? "" : gap(22) + `<tr><td class="ek-pad" align="center" style="padding:0 56px;font-family:${SANS};font-size:12px;line-height:19px;color:${EK.muted};">
      Si el botón no abre, copia este enlace en tu navegador:<br>
      <a href="${PLACEHOLDER}" style="color:${EK.goldSoft};word-break:break-all;text-decoration:underline;">${PLACEHOLDER}</a></td></tr>`,
    gap(48),
    `<tr><td class="ek-pad" align="center" style="padding:0 56px;font-family:${SERIF};font-size:20px;line-height:26px;font-style:italic;color:${EK.gold};">Tu concierge, Iato</td></tr>`,
  ];
  const html = shell({ title: t.subject, preheader: t.preheader, body, reason: t.reason })
    .split(PLACEHOLDER).join("{{ .ConfirmationURL }}");
  if (html.includes("iatos-marcador")) throw new Error("quedó el marcador");
  writeFileSync(join(OUT, t.file), html);
  // Copia de MUESTRA con las variables ya sustituidas, para las capturas de evidencia.
  const sample = html
    .split("{{ .ConfirmationURL }}").join("https://traveliatos.life/auth/confirmar#muestra-no-es-un-enlace-real")
    .split("{{ .Token }}").join("482913").split("{{ .Email }}").join("ana@correo-muestra.mx").split("{{ .NewEmail }}").join("ana.nuevo@correo-muestra.mx");
  writeFileSync(join(EVID, `auth-${t.file}`), sample);
  console.log(`${t.file} · ${html.length} bytes · Asunto: ${t.subject}`);
}
