# IATOS AI: pitch en 10 láminas

- **Fecha:** 22 de octubre de 2026, para la reunión del viernes 23 de octubre.
- **Se deriva de:** [`IATOS_PLAN_COMERCIAL.md`](./IATOS_PLAN_COMERCIAL.md). Cada cifra lleva ahí su fuente (F#) o la etiqueta [ESTIMADO].
- **Regla de la presentación:** nada se dice como hecho si es una meta. Lo que no existe en producción se dice así.

---

## 1. IATOS AI: tu concierge de viajes que no inventa

- Un concierge con IA (Iato), en español y pensado primero para México.
- Cotiza con fuente y fecha, vigila precios y vuelos, organiza viajes en grupo.
- Cuando la IA no basta, escala a una persona (Fixer).
- **IATOS Privé:** la lealtad que se gana con 90 días de PRO pagado.

> **Nota del orador:** abrir con la promesa central: honestidad. "Si un precio no es en vivo, te lo decimos." Presentarse y decir el objetivo de la reunión: pedirle consejo y contactos en tres temas concretos (lámina 10).

---

## 2. El problema

- Planear es disperso: vuelos, hotel, actividades y el grupo de WhatsApp, cada uno en un lugar distinto.
- Los precios no son confiables y las IA genéricas inventan con seguridad.
- Cuando algo falla en el viaje, nadie responde por ti.
- Las herramientas de IA de viaje nacen en inglés y en dólares.

> **Nota del orador:** contar el caso propio: nuestro chat llegó a ofrecer "jets privados" con precios inventados. Lo encontramos en la auditoría y lo corregimos. Esa experiencia es la razón de la regla de procedencia.

---

## 3. Por qué ahora

- Los turistas mexicanos gastaron **USD 9,677 millones** en el extranjero en 2025 (**+19.7%**); los que viajan por avión, +22.9% (INEGI).
- Los residentes gastaron **MXN 3.74 billones** en turismo dentro del país en 2024 (INEGI, Cuenta Satélite).
- El 69.1% de los adultos con cuenta bancaria usa la app del banco (ENIF 2024). El 35.8% de los usuarios de internet compra en línea (ENDUTIH 2024).
- **Los grandes validan la categoría:** apps de Expedia y Booking dentro de ChatGPT (2025), Google AI Mode en viajes (2026), Expedia compra Layla (julio de 2026).

> **Nota del orador:** el mensaje es "la ventana existe, pero no es eterna". Los grandes llegan primero en inglés y en EUA, sin servicio humano local. Aclarar que las cifras de mercado son de INEGI y que en el plan está la fuente de cada una.

---

## 4. Producto: lo que ya funciona y lo que falta

- **En producción:** Iato, búsqueda en vivo de vuelos y hoteles, análisis de viaje, alertas y seguimiento de vuelos, viajes compartidos y división de gastos. Varias piezas tienen defectos conocidos.
- **Terminado en la rama, sin desplegar:** 94 correcciones con 737 pruebas automáticas, cotizaciones con historial y vigencia, etiquetas de procedencia y cuotas por plan.
- **Privé, en la rama:** 1,272 fichas curadas, 1,097 publicables, 108 destinos con fichas y 12 universos. **Todavía ninguna VERIFICADA.**
- **Pendiente:** Stripe en modo real, el dominio de correo, el plan de SerpApi, el teléfono y horario del Fixer, y pruebas en teléfonos físicos.

> **Nota del orador:** ser muy claro: no hay clientes que paguen. Los 11 usuarios tienen PRO de cortesía y Stripe está en modo de prueba. Lo que separa al producto de vender es una compuerta de cuatro pasos que depende de nosotros, no de construir más.

---

## 5. Diferenciación

- **En español y primero para México:** MXN con IVA incluido, autobuses, puentes, Travel DNA.
- **Honestidad verificable:** cada precio dice si es en vivo, de referencia o estimado, con su fuente y fecha. La base de datos impide publicar sin fuente.
- **Humano en el circuito:** un Fixer sujeto a disponibilidad, nunca "24/7" falso.
- **Lealtad que se gana:** Privé tras 90 días pagados. No se compra con descuentos.

> **Nota del orador:** contrastar en una frase con cada rival: Google y ChatGPT son genéricos; Expedia y Booking solo venden su propio inventario; Mindtrip y Layla son en inglés y para EUA (y Layla ya es de Expedia); Despegar es una agencia y puede ser socio. Nosotros somos la capa de confianza y servicio.

---

## 6. Mercado

- **TAM (gasto):** ~MXN 4.03 billones que gastan los residentes en viajes en 2024; ~MXN 1.19 billones son vacaciones (INEGI).
- **SAM [ESTIMADO]:** de 4 a 8 millones de viajeros digitales que vuelan. Ancla: 8.05 millones de viajes al extranjero por avión en 2025.
- **SOM a 36 meses [ESTIMADO]:** de 2,000 a 24,000 PRO, igual a un ingreso neto de MXN 1.8 a 22 millones al año a $99.
- **Expansión:** 68 millones de hispanos en EUA (Pew, 2024) y LatAm hispana.

> **Nota del orador:** decir de frente que el SAM es una estimación nuestra y por qué: no hay una cifra pública de viajeros únicos en línea en México; está en reportes de pago. Pedir al asesor su lectura del tamaño.

---

## 7. Modelo de negocio y unit economics

- **PRO Fundadores, $99 al mes, IVA incluido:** nos quedan **MXN 76.35**. Un PRO típico cuesta **MXN 33**: margen de **56%** (37% con una mezcla de usuarios pesados).
- **PRO Regular, $149 (futuro, pendiente de aprobación):** nos quedan MXN 116.67; margen de 71%.
- **Equilibrio con los costos fijos de lanzamiento (USD 170 al mes):** de 73 a 111 PRO a $99, o de 38 a 46 a $149. Con personas de operación, ~470 a 710 a $99.
- **Afiliados como complemento:** Viator 8%, GetYourGuide 8%, Booking hasta 4%, Aviasales ~1.1%. **La atribución no está verificada: no está en el plan base.**

> **Nota del orador:** la sensibilidad clave: si la IA cuesta el doble (Gemini sube en enero de 2027), el margen a $99 baja a 32%. Por eso fijamos modelos y medimos el costo real. El riesgo número uno no es el costo, es la cancelación: los benchmarks de apps de IA implican ~20% al mes.

---

## 8. Go-to-market

- **Semanas 0 a 2:** pasar la compuerta (despliegue, Stripe real, correo, SerpApi).
- **Días 0 a 90 (MXN 60 a 180 mil):** lista de Fundadores, 6 a 10 microcreadores pagados por resultado, comunidades de viaje, referidos, contenido de "cotización honesta" y piloto con un banco.
- **Meta a 90 días:** 100 PRO; costo por cliente de MXN 180 o menos; conversión de 2% o más; 3 a 5 socios Privé.
- **Meses 6 a 12:** escalar el canal ganador; primer acuerdo B2B2C con un banco o tarjeta; primeros miembros Privé; piloto con agencias. **Meta: 1,000 a 2,000 PRO.**

> **Nota del orador:** el costo máximo por cliente se calcula desde la retención: a $99 y con 20% de cancelación, un cliente deja MXN 215. Por eso empezamos con canales casi orgánicos y proponemos un plan anual (decisión pendiente).

---

## 9. Cómo vamos a liderar

- **Datos curados y verificados**, revisados cada 90 días.
- **Confianza:** cero precios inventados, como métrica pública.
- **Privé + red de Fixers + alianzas por escrito:** lo que un modelo de IA no replica.
- **IA que hace cosas con confirmación:** Iato prepara y la persona o el proveedor confirma con folio.

> **Nota del orador:** ser honestos con lo que falta en cada ventaja: 0 fichas VERIFICADAS, 0 alianzas firmadas y un Fixer que hoy es un correo. Las ventajas son el plan, no un logro. Frente a las grandes: ser la capa en español que puede vivir dentro de ellas (una app en ChatGPT como canal).

---

## 10. Lo que pedimos

- **Equipo:** growth y alianzas, curaduría Privé, Fixer de medio tiempo, ingeniería de IA.
- **Capital [ESTIMADO]:** de MXN 1.5 a 3.5 millones para 12 meses, sin sueldos de los fundadores.
- **Al asesor:**
  1. arquitectura de agentes que reservan con confirmación;
  2. bajar el costo por PRO de USD 1.8 a menos de 1.2 con ruteo y evaluación;
  3. presentaciones con bancos, aerolíneas y agencias en línea;
  4. talento de IA senior;
  5. inversionistas y cuándo levantar.
- **Riesgos que vigilamos:** PROFECO (precio total), la nueva LFPDPPP, la dependencia de proveedores y la llegada de las grandes en español.

> **Nota del orador:** cerrar con una pregunta concreta: "¿Cuál de estas tres puertas, banco, aerolínea o inversionista, nos puede abrir primero?". Ofrecerle enviar el plan completo y la compuerta de liberación.
