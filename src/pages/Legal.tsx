import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { openCookieSettings } from "@/lib/consent";
// Logo a 320 px de ancho (se muestra a ~40 px de alto): 27 kB en vez de 191 kB.
import iatosLogo from "@/assets/iatos-logo-320.png";
import { FREE_FEATURES, PRICE_LINE, PRO_FEATURES } from "@/lib/planCopy";
import { useTrialCopy } from "@/hooks/usePlanConfig";
import { IatoName, withIatoMark } from "@/lib/iatoMark";
import { useAuth } from "@/contexts/AuthContext";
import { OPINION_CTA, OpinionHost } from "@/components/opinion/OpinionEntry";
import { openOpinion } from "@/lib/opinionBus";

// La prueba se describe según cómo funcione hoy (con o sin tarjeta), igual que en la landing.
const TrialTermsItem = () => {
  const { copy } = useTrialCopy();
  return <li>Prueba: {copy.line}. {copy.conditions} {copy.after}</li>;
};
const TrialPolicyItems = () => {
  const { copy } = useTrialCopy();
  return <>{copy.policy.map((t) => <li key={t}>{t}</li>)}</>;
};

// Promoción de referidos (migración 20261027080000_referidos_promo.sql). La tarjeta de invitar enlaza
// aquí con /terminos#promo-referidos.
export const PROMO_REFERIDOS_ID = "promo-referidos";
const PromoReferidosSection = ({ n }: { n: number }) => {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash === `#${PROMO_REFERIDOS_ID}`) document.getElementById(PROMO_REFERIDOS_ID)?.scrollIntoView?.({ block: "start" });
  }, [hash]);
  return (
    <section id={PROMO_REFERIDOS_ID} className="scroll-mt-6">
      <h2>{n}. Promoción «Invita 5 amigos y gana 1 mes de PRO»</h2>
      <ul>
        <li>Por cada 5 amigos que cuenten ganas 1 mes (30 días) de IATOS PRO. Se acumula: 10 amigos son 2 meses.</li>
        <li>Un amigo cuenta cuando crea su cuenta con tu enlace, confirma su correo y crea su primer viaje. Cada amigo cuenta una sola vez.</li>
        <li>No cuentan tu propia cuenta ni otras cuentas tuyas (mismo correo o misma tarjeta), ni quien ya se unió con el enlace de otra persona.</li>
        <li>Con plan gratuito, el mes se activa al momento como PRO de cortesía; si ya tienes uno de la promoción, se suman los días. Al terminar vuelves al plan gratuito: no se te cobra nada.</li>
        <li>Si ya pagas IATOS PRO, eres miembro Privé o tienes PRO de cortesía sin vencimiento, tu mes queda guardado y no se pierde; te avisaremos cuando se aplique.</li>
        <li>El premio no se cambia por dinero ni se transfiere. Podemos anular premios obtenidos con cuentas falsas o abuso, y cambiar o terminar la promoción avisando en esta página; lo ya ganado se respeta.</li>
      </ul>
    </section>
  );
};

const UPDATED = "24 de agosto de 2026";
// Términos: se agregó la promoción de referidos (sección 5).
const TERMS_UPDATED = "23 de octubre de 2026";
const CONTACT = "hola@traveliatos.life";
// Privacidad: se agregaron Perplexity y la pasarela de IA de Lovable a la lista de proveedores.
const PRIVACY_UPDATED = "28 de octubre de 2026";

/** Dónde se cancela o se gestiona PRO, con el nombre real del menú (no una ruta técnica ni en inglés). */
const ManageSubscriptionPath = () => (
  <>en <Link to="/dashboard/pro" className="text-primary">Plan IATOS PRO</Link> (en el celular, menú <strong>Más → Plan IATOS PRO</strong>), con el botón <strong>Gestionar suscripción</strong>, que abre el portal de Stripe</>
);

/**
 * Con la sesión iniciada (ronda 3, P1-1) se llega aquí desde «Más» o el menú lateral: el botón dice
 * «Volver a la app» y regresa a la pantalla de donde vino (state.from) o a Inicio. Sin sesión, igual que antes.
 */
function useBackToApp(): { to: string; label: string; signedIn: boolean } {
  const { user } = useAuth();
  const { state } = useLocation();
  const from = (state as { from?: unknown } | null)?.from;
  if (!user) return { to: "/", label: "Volver al inicio", signedIn: false };
  const safe = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/dashboard";
  return { to: safe, label: "Volver a la app", signedIn: true };
}

const Shell = ({ title, description, children, updated = UPDATED }: { title: string; description: string; children: React.ReactNode; updated?: string }) => {
  const back = useBackToApp();
  return (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border/40">
      <div className="container mx-auto flex items-center justify-between gap-3 py-5">
        <Link to={back.signedIn ? "/dashboard" : "/"}><img src={iatosLogo} alt="IATOS AI" width={320} height={91} decoding="async" className="h-8 w-auto object-contain" /></Link>
        {back.signedIn ? (
          <Link to={back.to} data-testid="legal-back-to-app"
            className="inline-flex min-h-[44px] items-center rounded-full border border-primary/40 px-4 text-sm text-primary hover:bg-primary/10 transition">
            {back.label}
          </Link>
        ) : (
          <Link to={back.to} className="text-sm text-muted-foreground hover:text-foreground transition">{back.label}</Link>
        )}
      </div>
    </header>
    <main className="container mx-auto max-w-3xl py-12 px-4">
      <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-10">{description} · Última actualización: {updated}</p>
      {/* Enlaces dentro del texto subrayados: se distinguen sin depender del color (accesibilidad, ronda 2 P2-4). */}
      <article className="space-y-8 text-[15px] leading-relaxed text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-medium [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </article>
      <footer className="mt-16 pt-8 border-t border-border/40 text-sm text-muted-foreground flex flex-wrap gap-4">
        <Link to="/terminos" className="hover:text-foreground transition">Términos y Condiciones</Link>
        <Link to="/privacidad" className="hover:text-foreground transition">Aviso de Privacidad</Link>
        <Link to="/reembolsos" className="hover:text-foreground transition">Reembolsos y Cancelación</Link>
        <Link to="/cookies" className="hover:text-foreground transition">Cookies</Link>
        <Link to="/ayuda" className="hover:text-foreground transition">Ayuda</Link>
        {/* En el celular los enlaces bajan de renglón y el "·" quedaba suelto al final de una línea (ronda 4). */}
        <span aria-hidden="true" className="hidden sm:inline" data-testid="legal-footer-sep">·</span>
        <a href={`mailto:${CONTACT}`} className="hover:text-foreground transition">{CONTACT}</a>
      </footer>
    </main>
    {/* El buzón se puede abrir desde Ayuda (Contacto) cuando hay sesión. */}
    {back.signedIn ? <OpinionHost /> : null}
  </div>
  );
};

export const Terminos = () => (
  <Shell title="Términos y Condiciones" description="Condiciones de uso de IATOS AI" updated={TERMS_UPDATED}>
    <section>
      <h2>1. Qué es IATOS AI</h2>
      <p>IATOS AI es una plataforma de planeación de viajes asistida por inteligencia artificial. Nuestro concierge digital, <IatoName />, genera itinerarios, cotizaciones estimadas y recomendaciones personalizadas. <strong>IATOS AI no es una agencia de viajes ni una OTA:</strong> no vendemos boletos de avión, hospedaje, tours ni seguros, y no emitimos reservaciones a tu nombre.</p>
    </section>
    <section>
      <h2>2. Enlaces de afiliado</h2>
      <p>Cuando reservas a través de los enlaces que te mostramos, la transacción ocurre directamente con el proveedor final (aerolínea, hotel, plataforma de reservas, etc.). IATOS AI puede recibir una comisión de afiliado por esa transacción, sin costo adicional para ti. Los términos, cancelaciones, reembolsos y responsabilidad del servicio contratado corresponden exclusivamente al proveedor final.</p>
    </section>
    <section>
      <h2>3. Precios y disponibilidad</h2>
      <p>Los precios mostrados son estimaciones obtenidas de fuentes de terceros o generadas por IA y pueden cambiar en cualquier momento. Cuando un precio proviene de una consulta en vivo lo marcamos como "Precio verificado en vivo"; cuando es una estimación lo marcamos como "Estimado". En ningún caso constituyen una oferta vinculante.</p>
    </section>
    <section>
      <h2>4. Suscripción IATOS PRO</h2>
      <ul>
        <li>Precio: {PRICE_LINE}.</li>
        <TrialTermsItem />
        <li>Al contratar PRO, el cobro mensual se realiza a través de Stripe y se renueva cada mes hasta que canceles. IATOS AI no almacena los datos de tu tarjeta.</li>
        <li>Puedes cancelar en cualquier momento <ManageSubscriptionPath />. Al cancelar conservas el acceso hasta el fin del periodo pagado.</li>
        <li>Plan gratuito: {withIatoMark(FREE_FEATURES.join("; "))}.</li>
        <li>IATOS PRO incluye: {withIatoMark(PRO_FEATURES.join("; "))}. Los límites se aplican por cuenta y pueden ajustarse con aviso previo.</li>
      </ul>
    </section>
    <PromoReferidosSection n={5} />
    <section>
      <h2>6. Uso aceptable</h2>
      <p>No puedes usar la plataforma para actividades ilícitas, para extraer datos de forma automatizada, ni para saturar nuestros servicios. Aplicamos límites de uso por usuario y por dirección IP; el abuso puede resultar en suspensión de la cuenta sin reembolso.</p>
    </section>
    <section>
      <h2>7. Contenido generado por IA</h2>
      <p>Las respuestas de <IatoName /> pueden contener errores u omisiones. Verifica siempre requisitos de visa, vacunas, horarios, direcciones y condiciones de reserva con fuentes oficiales antes de viajar.</p>
    </section>
    <section>
      <h2>8. Limitación de responsabilidad</h2>
      <p>IATOS AI se ofrece "tal cual". No somos responsables por pérdidas derivadas de vuelos cancelados, reservaciones no honradas, cambios de precio o decisiones tomadas con base en recomendaciones de la plataforma. Nuestra responsabilidad máxima se limita al monto que hayas pagado por la suscripción en los últimos 3 meses.</p>
    </section>
    <section>
      <h2>9. Cambios y contacto</h2>
      <p>Podemos actualizar estos términos; publicaremos la fecha de la última actualización en esta página. Dudas: <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a>.</p>
    </section>
  </Shell>
);

export const Privacidad = () => (
  <Shell title="Aviso de Privacidad" description="Cómo tratamos tus datos personales" updated={PRIVACY_UPDATED}>
    <section>
      <h2>1. Responsable</h2>
      <p>IATOS AI, con domicilio en Ciudad de México, es responsable del tratamiento de tus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).</p>
    </section>
    <section>
      <h2>2. Datos que recabamos</h2>
      <ul>
        <li><strong>Cuenta:</strong> nombre, correo electrónico, ciudad de origen, fecha de nacimiento (opcional) y foto de perfil.</li>
        <li><strong>Preferencias de viaje (tu perfil de viajero):</strong> gustos gastronómicos, restricciones alimentarias, ritmo de viaje, presupuesto y programas de lealtad que decidas registrar.</li>
        <li><strong>Documentos y tarjetas:</strong> los documentos de viaje que decidas guardar (pasaporte, visas, INE, licencia, certificados de vacunación y pólizas de seguro, con su número, vigencia y, si quieres, su foto o PDF), tus membresías y programas de lealtad con sus beneficios, y el nombre y nivel de tus tarjetas (a lo mucho sus últimos 4 dígitos). <strong>Nunca pedimos ni almacenamos números completos de tarjeta, CVV ni fechas de vencimiento de tarjetas.</strong> Las fotos y PDF se guardan en almacenamiento privado al que solo tú accedes, y a las fotos les quitamos la ubicación y otros datos ocultos antes de subirlas. Tus documentos, sus fotos y sus números no se envían a proveedores de IA: para personalizar recomendaciones solo usamos el nombre, el nivel y los beneficios de tus membresías, tarjetas y seguros.</li>
        <li><strong>Fotografías para tu avatar:</strong> si subes una selfie para generar tu avatar, la imagen se procesa con nuestro proveedor de IA para crear el avatar y no se usa para entrenar modelos ni se comparte con terceros con fines publicitarios. Puedes eliminar tu avatar y tu foto desde tu perfil.</li>
        <li><strong>Contenido de viajes:</strong> destinos, fechas, itinerarios, gastos, notas y conversaciones con el Concierge.</li>
        <li><strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo y registros de error para seguridad y diagnóstico.</li>
      </ul>
      <p>No almacenamos números de tarjeta: los pagos se procesan íntegramente en Stripe.</p>
    </section>
    <section>
      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Personalizar itinerarios y recomendaciones (tu perfil de viajero).</li>
        <li>Operar tu suscripción y facturación.</li>
        <li>Enviarte notificaciones sobre tus viajes y tu cuenta.</li>
        <li>Detectar abuso, fraude y errores de la plataforma.</li>
      </ul>
    </section>
    <section>
      <h2>4. Con quién los compartimos</h2>
      <p>Compartimos únicamente lo necesario con proveedores que operan la plataforma: Supabase (base de datos y autenticación), Stripe (pagos), Anthropic y Google (modelos de IA que procesan tus consultas), la pasarela de IA de Lovable (Lovable AI Gateway, que hace llegar algunas consultas a esos modelos), Perplexity (búsqueda en internet con IA para algunas consultas, como estado de vuelos, promociones, vida nocturna y análisis de viaje), SerpApi y Travelpayouts (búsqueda de precios), Resend (correo), Sentry (monitoreo de errores), PostHog (analítica de uso, solo si la aceptas) y Google Maps (mapas y lugares). A Sentry y PostHog solo les enviamos un identificador interno, no tu correo. No vendemos tus datos personales.</p>
    </section>
    <section>
      <h2>5. Conservación y eliminación de tu cuenta</h2>
      <p>Conservamos tus datos mientras tu cuenta esté activa. Si eliminas tu cuenta desde tu perfil:</p>
      <ul>
        <li>Borramos tu perfil, viajes, conversaciones, preferencias, tu bóveda (documentos, membresías y sus fotos) y los archivos que subiste.</li>
        <li>Cancelamos tu suscripción y quitamos tus métodos de pago guardados en Stripe, para que no haya cobros nuevos.</li>
        <li>Pedimos a PostHog que borre tu historial de uso, y en Stripe quitamos tu nombre, correo, teléfono y dirección de tu ficha de cliente.</li>
        <li><strong>Lo que no podemos borrar:</strong> Stripe conserva las facturas y los cargos ya hechos (con los datos con que se emitieron) porque la ley lo exige para fines fiscales y para atender aclaraciones o contracargos. También guardamos un registro de pagos, reembolsos y de la solicitud de eliminación que no incluye tu nombre ni tu correo.</li>
        <li>Los correos que ya te enviamos y las copias de seguridad se borran conforme vencen sus plazos de retención, no al instante.</li>
      </ul>
      <p>Algunos pasos con proveedores externos pueden tardar unos días; si alguno falla, lo volvemos a intentar automáticamente.</p>
    </section>
    <section>
      <h2>6. Tus derechos ARCO</h2>
      <p>Puedes solicitar el Acceso, Rectificación, Cancelación u Oposición al tratamiento de tus datos, así como revocar tu consentimiento, escribiendo a <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a>. Responderemos en un plazo máximo de 20 días hábiles. También puedes editar o borrar buena parte de tu información desde tu perfil en la app.</p>
    </section>
    <section>
      <h2>7. Seguridad</h2>
      <p>Aplicamos cifrado en tránsito, control de acceso por usuario a nivel de base de datos (RLS) y límites de uso para prevenir abuso. Ningún sistema es infalible; te notificaremos ante cualquier incidente que afecte tus datos.</p>
    </section>
  </Shell>
);

export const Cookies = () => (
  <Shell title="Política de Cookies" description="Uso de cookies y almacenamiento local">
    <section>
      <h2>1. Qué usamos</h2>
      <ul>
        <li><strong>Esenciales:</strong> almacenamiento local para mantener tu sesión iniciada. Sin ellas la app no funciona.</li>
        <li><strong>Preferencias:</strong> recordar ajustes como tu ciudad de origen o los tooltips ya vistos.</li>
        <li><strong>Diagnóstico:</strong> registros anónimos de errores (Sentry) para detectar fallas.</li>
        <li><strong>Afiliados:</strong> al hacer clic en un enlace de reserva, el proveedor final puede colocar su propia cookie de atribución. Esa cookie se rige por la política del proveedor.</li>
        <li><strong>Analítica y medición (solo si aceptas):</strong> PostHog (uso de la app) y, cuando está activo, el script de Travelpayouts (medición de conversiones de afiliado). No se cargan hasta que eliges "Aceptar" en el aviso de cookies.</li>
      </ul>
    </section>
    <section>
      <h2>2. Cómo controlarlas</h2>
      <p>Puedes cambiar tu elección cuando quieras:{" "}
        <button type="button" onClick={openCookieSettings} className="text-primary underline">Cambiar preferencias de cookies</button>.
        También puedes borrar el almacenamiento del sitio desde tu navegador (se cerrará tu sesión).</p>
    </section>
    <section>
      <h2>3. Contacto</h2>
      <p>Dudas sobre cookies: <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a>.</p>
    </section>
  </Shell>
);

export const Reembolsos = () => (
  <Shell title="Política de Reembolsos y Cancelación" description="Suscripción IATOS PRO — $99 MXN al mes, IVA incluido">
    <section>
      <h2>1. Qué estás contratando</h2>
      <p>IATOS PRO es una suscripción digital de {PRICE_LINE}. Incluye: {withIatoMark(PRO_FEATURES.join("; "))}. Es un servicio de software: <strong>no incluye vuelos, hoteles, tours ni seguros</strong>. Esas reservas las haces tú directamente con el proveedor final a través de los enlaces que te entregamos.</p>
    </section>
    <section>
      <h2>2. Periodo de prueba de 30 días</h2>
      <ul>
        <TrialPolicyItems />
      </ul>
    </section>
    <section>
      <h2>3. Cancelación</h2>
      <ul>
        <li>Puedes cancelar en cualquier momento, sin penalización, <ManageSubscriptionPath />.</li>
        <li>La cancelación surte efecto al final del periodo ya pagado: conservas el acceso PRO hasta esa fecha y no se generan cargos posteriores.</li>
        <li>También puedes solicitar la cancelación escribiendo a <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a>; la procesamos dentro de los 5 días hábiles siguientes.</li>
      </ul>
    </section>
    <section>
      <h2>4. Reembolsos</h2>
      <ul>
        <li><strong>Garantía de 7 días:</strong> si solicitas el reembolso dentro de los 7 días naturales posteriores a tu primer cargo, te devolvemos el 100% de ese cargo, sin preguntas.</li>
        <li><strong>Cargo duplicado o error de facturación:</strong> reembolso íntegro siempre, sin importar cuándo lo detectes, en cuanto lo verifiquemos.</li>
        <li><strong>Falla del servicio:</strong> si la plataforma estuvo inoperante por una causa atribuible a nosotros durante una parte significativa del mes, reembolsamos la parte proporcional.</li>
        <li>Fuera de esos supuestos, los meses ya iniciados no son reembolsables de forma prorrateada; lo que hacemos es cancelar la renovación y dejarte el acceso hasta el fin del periodo.</li>
        <li>Si te reembolsamos un cargo completo, la suscripción se cancela y el acceso PRO que pagaba ese cargo termina en ese momento (salvo que tengas otro acceso vigente, como una cortesía). Un reembolso parcial no cambia tu acceso.</li>
        <li>Si abres un contracargo con tu banco, tu acceso sigue mientras se resuelve; si el banco lo resuelve a tu favor, el acceso de ese cargo termina.</li>
      </ul>
    </section>
    <section>
      <h2>5. Cómo solicitarlo</h2>
      <p>Escribe a <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a> desde el correo de tu cuenta, indicando la fecha del cargo. Respondemos en un máximo de 5 días hábiles. Los reembolsos aprobados se procesan por Stripe al mismo método de pago y suelen reflejarse en tu estado de cuenta en 5 a 10 días hábiles, según tu banco.</p>
    </section>
    <section>
      <h2>6. Reservas con proveedores externos</h2>
      <p>Los cobros de vuelos, hoteles, tours, traslados o seguros los realiza el proveedor final, no IATOS AI. Cualquier cambio, cancelación o reembolso de esas reservas se rige por las políticas de ese proveedor y debe gestionarse directamente con él. Podemos ayudarte a ubicar el canal correcto, pero no tenemos facultad para cancelar ni reembolsar en su nombre.</p>
    </section>
    <section>
      <h2>7. Cambios de precio</h2>
      <p>Si modificamos el precio de la suscripción, te avisaremos por correo con al menos 30 días de anticipación. Puedes cancelar antes de que aplique el nuevo precio sin ningún cargo adicional.</p>
    </section>
  </Shell>
);

// ───────────── Ayuda (auditoría de cuenta #9) ─────────────
// Antes /ayuda, /faq y /precios daban 404 y el pie solo ofrecía un mailto. Respuestas cortas y reales:
// todo sale de lo que la app hace hoy y de los mismos textos de planes (planCopy) que Términos y la landing.
export const AYUDA_UPDATED = "29 de octubre de 2026";

const Faq = ({ id, q, children }: { id?: string; q: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-6">
    <h2>{q}</h2>
    {children}
  </section>
);

/** Contacto → el buzón "¿Algo no se entiende? Cuéntanos" (ronda 3, P2-9): dónde está y, con sesión, el botón. */
const ContactOpinion = () => {
  const { user } = useAuth();
  return (
    <>
      <p>
        <strong>¿Algo no se entiende o no funciona?</strong> Dentro de la app toca <strong>«{OPINION_CTA}»</strong>: está en el menú
        {" "}<strong>«Más»</strong> (en el celular), en el menú lateral (en la computadora) y al pie de las pantallas principales. Lo lee una persona
        del equipo IATOS y, si te responde, lo verás en Concierge › Mis solicitudes.{user ? "" : " Necesitas haber iniciado sesión."}
      </p>
      {user ? (
        <p>
          <button type="button" onClick={openOpinion} aria-haspopup="dialog"
            className="mt-1 inline-flex min-h-[44px] items-center rounded-full border border-primary/40 px-4 text-sm text-primary hover:bg-primary/10 transition">
            {OPINION_CTA}
          </button>
        </p>
      ) : null}
    </>
  );
};

export const Ayuda = () => {
  const { copy } = useTrialCopy();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: "start" });
  }, [hash]);
  return (
    <Shell title="Ayuda y preguntas frecuentes" description="Cómo funciona IATOS, qué es real y qué es estimado, planes y contacto" updated={AYUDA_UPDATED}>
      <Faq id="como-funciona" q="¿Cómo funciona IATOS?">
        <p>Le dices a <IatoName />, tu concierge con IA, a dónde y cuándo quieres viajar. IATOS consulta vuelos y hoteles con proveedores, arma un itinerario día por día y te da el total estimado en pesos mexicanos. Puedes guardar el viaje, editarlo, compartirlo y seguirlo durante el viaje (clima, vuelos, gastos y diario).</p>
        <p>IATOS no es una agencia de viajes: no vendemos boletos ni hospedaje. Cuando decides reservar, te llevamos al sitio del proveedor y la compra la haces allí, con sus condiciones.</p>
      </Faq>
      <Faq id="real-o-estimado" q="¿Qué es real y qué es estimado?">
        <ul>
          <li><strong>Consultado en vivo:</strong> un precio que el proveedor nos dio en ese momento. Lo marcamos así y con la hora de la consulta. Aun así puede cambiar al reservar.</li>
          <li><strong>Estimado:</strong> un cálculo (por ejemplo, comidas, transporte local o un precio de referencia sin disponibilidad confirmada). Siempre lo marcamos como estimado.</li>
          <li>Si un proveedor no responde, te lo decimos en lugar de inventar un dato.</li>
          <li>Una recomendación o una solicitud no es una reserva: solo lo es cuando el proveedor la confirma.</li>
        </ul>
      </Faq>
      <Faq id="planes" q="¿Qué incluye cada plan?">
        <ul>
          <li><strong>Plan gratuito:</strong> {withIatoMark(FREE_FEATURES.join("; "))}.</li>
          <li><strong>IATOS PRO ({PRICE_LINE}):</strong> {withIatoMark(PRO_FEATURES.join("; "))}.</li>
          <li><strong>Prueba:</strong> {copy.line}. {copy.after}</li>
          <li>Puedes cancelar cuando quieras <ManageSubscriptionPath />. Detalles en la <Link to="/reembolsos" className="text-primary">Política de Reembolsos</Link>.</li>
        </ul>
      </Faq>
      <Faq id="prive" q="¿Qué es IATOS Privé?">
        <p>Es un espacio para miembros con experiencias seleccionadas y revisadas por IATOS, cada una con su fuente y su fecha de revisión. Se abre por invitación al sumar 90 días de IATOS PRO pagado; la prueba gratuita y el PRO de cortesía no suman. En la app, en <strong>IATOS Privé</strong>, ves tu estado.</p>
      </Faq>
      <Faq id="cuenta" q="Mi cuenta">
        <ul>
          <li><strong>Olvidé mi contraseña:</strong> en la pantalla de inicio de sesión escribe tu correo y toca «¿Olvidaste tu contraseña?». Te enviamos un enlace.</li>
          <li><strong>Mis datos:</strong> en <Link to="/dashboard/perfil" className="text-primary">Mi perfil</Link> puedes editar tus preferencias y borrar tu avatar (pestaña Avatar), elegir qué ven tus amigos (pestaña Amigos) y eliminar tu cuenta (pestaña Ajustes). Lo que se borra y lo que no está en el <Link to="/privacidad" className="text-primary">Aviso de Privacidad</Link>.</li>
          <li><strong>Cookies:</strong> puedes cambiar tu elección en la <Link to="/cookies" className="text-primary">Política de Cookies</Link>.</li>
        </ul>
      </Faq>
      <Faq id="contacto" q="Contacto">
        <ContactOpinion />
        <p>También puedes escribirnos a <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a> desde el correo de tu cuenta. Respondemos en un máximo de 5 días hábiles. Para un cobro, indica la fecha del cargo.</p>
      </Faq>
    </Shell>
  );
};
