import { Link } from "react-router-dom";
import iatosLogo from "@/assets/iatos-logo.png";

const UPDATED = "24 de agosto de 2026";
const CONTACT = "hola@traveliatos.life";

const Shell = ({ title, description, children }: { title: string; description: string; children: React.ReactNode }) => (
  <div className="min-h-screen bg-background">
    <header className="border-b border-border/40">
      <div className="container mx-auto flex items-center justify-between py-5">
        <Link to="/"><img src={iatosLogo} alt="IATOS AI" className="h-8 w-auto object-contain" /></Link>
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition">Volver al inicio</Link>
      </div>
    </header>
    <main className="container mx-auto max-w-3xl py-12 px-4">
      <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-2">{title}</h1>
      <p className="text-sm text-muted-foreground mb-10">{description} · Última actualización: {UPDATED}</p>
      <article className="space-y-8 text-[15px] leading-relaxed text-muted-foreground [&_h2]:text-foreground [&_h2]:text-lg [&_h2]:font-medium [&_h2]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
        {children}
      </article>
      <footer className="mt-16 pt-8 border-t border-border/40 text-sm text-muted-foreground flex flex-wrap gap-4">
        <Link to="/terminos" className="hover:text-foreground transition">Términos y Condiciones</Link>
        <Link to="/privacidad" className="hover:text-foreground transition">Aviso de Privacidad</Link>
        <Link to="/reembolsos" className="hover:text-foreground transition">Reembolsos y Cancelación</Link>
        <Link to="/cookies" className="hover:text-foreground transition">Cookies</Link>
        <span>·</span>
        <a href={`mailto:${CONTACT}`} className="hover:text-foreground transition">{CONTACT}</a>
      </footer>
    </main>
  </div>
);

export const Terminos = () => (
  <Shell title="Términos y Condiciones" description="Condiciones de uso de IATOS AI">
    <section>
      <h2>1. Qué es IATOS AI</h2>
      <p>IATOS AI es una plataforma de planeación de viajes asistida por inteligencia artificial. Nuestro concierge digital, Iato, genera itinerarios, cotizaciones estimadas y recomendaciones personalizadas. <strong>IATOS AI no es una agencia de viajes ni una OTA:</strong> no vendemos boletos de avión, hospedaje, tours ni seguros, y no emitimos reservaciones a tu nombre.</p>
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
        <li>Precio: $99 MXN mensuales, con 30 días de prueba gratis al activar la suscripción con tarjeta.</li>
        <li>El cobro se realiza a través de Stripe. IATOS AI no almacena los datos de tu tarjeta.</li>
        <li>Puedes cancelar en cualquier momento desde el portal de facturación en /dashboard/pro. Al cancelar conservas el acceso hasta el fin del periodo pagado.</li>
        <li>Si cancelas durante el periodo de prueba, no se genera ningún cargo.</li>
        <li>La versión gratuita incluye un cupo limitado de mensajes al Concierge y de análisis de viaje.</li>
      </ul>
    </section>
    <section>
      <h2>5. Uso aceptable</h2>
      <p>No puedes usar la plataforma para actividades ilícitas, para extraer datos de forma automatizada, ni para saturar nuestros servicios. Aplicamos límites de uso por usuario y por dirección IP; el abuso puede resultar en suspensión de la cuenta sin reembolso.</p>
    </section>
    <section>
      <h2>6. Contenido generado por IA</h2>
      <p>Las respuestas de Iato pueden contener errores u omisiones. Verifica siempre requisitos de visa, vacunas, horarios, direcciones y condiciones de reserva con fuentes oficiales antes de viajar.</p>
    </section>
    <section>
      <h2>7. Limitación de responsabilidad</h2>
      <p>IATOS AI se ofrece "tal cual". No somos responsables por pérdidas derivadas de vuelos cancelados, reservaciones no honradas, cambios de precio o decisiones tomadas con base en recomendaciones de la plataforma. Nuestra responsabilidad máxima se limita al monto que hayas pagado por la suscripción en los últimos 3 meses.</p>
    </section>
    <section>
      <h2>8. Cambios y contacto</h2>
      <p>Podemos actualizar estos términos; publicaremos la fecha de la última actualización en esta página. Dudas: <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a>.</p>
    </section>
  </Shell>
);

export const Privacidad = () => (
  <Shell title="Aviso de Privacidad" description="Cómo tratamos tus datos personales">
    <section>
      <h2>1. Responsable</h2>
      <p>IATOS AI, con domicilio en Ciudad de México, es responsable del tratamiento de tus datos personales conforme a la Ley Federal de Protección de Datos Personales en Posesión de los Particulares (LFPDPPP).</p>
    </section>
    <section>
      <h2>2. Datos que recabamos</h2>
      <ul>
        <li><strong>Cuenta:</strong> nombre, correo electrónico, ciudad de origen, fecha de nacimiento (opcional) y foto de perfil.</li>
        <li><strong>Preferencias de viaje:</strong> gustos gastronómicos, restricciones alimentarias, ritmo de viaje, presupuesto y programas de lealtad que decidas registrar.</li>
        <li><strong>Contenido de viajes:</strong> destinos, fechas, itinerarios, gastos, notas y conversaciones con el Concierge.</li>
        <li><strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo y registros de error para seguridad y diagnóstico.</li>
      </ul>
      <p>No almacenamos números de tarjeta: los pagos se procesan íntegramente en Stripe.</p>
    </section>
    <section>
      <h2>3. Para qué los usamos</h2>
      <ul>
        <li>Personalizar itinerarios y recomendaciones (Travel DNA).</li>
        <li>Operar tu suscripción y facturación.</li>
        <li>Enviarte notificaciones sobre tus viajes y tu cuenta.</li>
        <li>Detectar abuso, fraude y errores de la plataforma.</li>
      </ul>
    </section>
    <section>
      <h2>4. Con quién los compartimos</h2>
      <p>Compartimos únicamente lo necesario con proveedores que operan la plataforma: Supabase (base de datos y autenticación), Stripe (pagos), Anthropic y Google (modelos de IA que procesan tus consultas), SerpApi y Travelpayouts (búsqueda de precios), Resend (correo), Sentry (monitoreo de errores) y Google Maps (mapas y lugares). No vendemos tus datos personales.</p>
    </section>
    <section>
      <h2>5. Conservación</h2>
      <p>Conservamos tus datos mientras tu cuenta esté activa y hasta 12 meses después de su eliminación por obligaciones fiscales y de seguridad.</p>
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
      </ul>
    </section>
    <section>
      <h2>2. Cómo controlarlas</h2>
      <p>Puedes borrar el almacenamiento del sitio desde la configuración de tu navegador. Ten en cuenta que al hacerlo se cerrará tu sesión.</p>
    </section>
    <section>
      <h2>3. Contacto</h2>
      <p>Dudas sobre cookies: <a href={`mailto:${CONTACT}`} className="text-primary">{CONTACT}</a>.</p>
    </section>
  </Shell>
);
