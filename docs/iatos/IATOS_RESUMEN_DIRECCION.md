# IATOS AI: resumen para dirección

Fecha: 2026-10-22. Para: fundadores de IATOS AI. Una página; el detalle está en los documentos citados.

## Dónde estamos

- **La app funciona y ya es más segura que ayer.** Los huecos de seguridad más graves (cualquiera podía meterse a un viaje ajeno, falsificar amistades, listar fotos de todos, mandar correos a nombre de IATOS o quedarse con un viaje) están cerrados **en producción** y verificados.
- **El resto del trabajo está terminado en una rama de desarrollo, con pruebas, y espera tu GO para desplegarse.** Son 114 hallazgos revisados: 5 verificados en producción, 94 corregidos en la rama, 12 que dependen de una acción tuya y 3 menores abiertos. **Ningún problema grave (P0/P1) está abierto.** 737 pruebas automáticas pasan.
- **Lo que cambia para el usuario cuando despleguemos:** el plan gratis ya no "se gasta" cuando falla la plataforma y no muestra errores técnicos; las cotizaciones guardan fuente, fecha y vigencia; Iato pregunta de qué viaje hablas en vez de adivinar; el expediente del viaje junta todo; los cobros, reembolsos y disputas de Stripe se reflejan bien; borrar la cuenta borra de verdad lo que debe y lo dice con honestidad; Members Only deja la contraseña compartida y pasa a ser beneficio PRO.

## Decisión principal

**¿Podemos vender PRO a $99 MXN?** Sí, **después** de desplegar la rama y de cuatro cosas que solo tú puedes hacer: (1) dar el GO y confirmar un respaldo de la base, (2) dejar Stripe listo (IVA incluido, eventos del webhook, una compra real reembolsada), (3) verificar el dominio de correo en Resend, (4) contratar el plan de SerpApi. Detalle en `IATOS_RELEASE_GATE.md`.

**Todavía no:** la prueba de 30 días sin tarjeta (antes hay que exigir la confirmación de correo, si no cualquiera con un correo inventado recibe PRO) y los límites de PRO (falta que apruebes los números).

## Dinero

- Costo variable estimado por usuario PRO: ver `IATOS_COSTOS_UNITARIOS.md`. El margen depende sobre todo de las búsquedas en vivo (SerpApi) y de los análisis completos de viaje; por eso existen los límites propuestos.
- IATOS Privé Digital (incluido en PRO): entre USD 0.02 y 0.05 al mes por usuario típico; el costo real es una persona curando (~8 h por semana para re-verificar los lugares cada 90 días).

## IATOS Privé

- En construcción en desarrollo: acceso tras **90 días de PRO pagado**, invitación cinematográfica, contraseña Privé individual ligada a la cuenta, bienvenida y recorrido guiado, catálogo de 12 universos y ~130 destinos con datos verificables, e Iato armando planes completos sin inventar ni confirmar reservas.
- No retrasa lo crítico: es prioridad P2 y tiene su propia compuerta (`IATOS_PRIVE_RELEASE_GATE.md`).
- No existen todavía acuerdos con hoteles, restaurantes ni clubes; la app no dirá "partner" ni "beneficio exclusivo" hasta que exista un contrato registrado.

## Riesgos que hay que conocer

1. Desplegar todo junto es grande; por eso hay orden, verificación en vivo (V1–V21) y plan de vuelta atrás.
2. El correo (Resend) aún no tiene dominio verificado: bienvenida, alertas, Fixer e invitaciones Privé dependen de eso.
3. Con ~216 búsquedas de SerpApi restantes no alcanza para usuarios de pago.
4. 166 lugares de Members Only se cargaron directo en producción, probablemente generados por IA; quedarán ocultos hasta que una persona los revise.
5. No hemos probado en iPhone ni Android físicos; las pruebas móviles son en navegador con tamaño de teléfono.

## Lo que necesito de ti esta semana

GO de despliegue y respaldo · Stripe (eventos, versión de API, runbook de prueba) · dominio de Resend · secretos `HEALTH_ALERT_EMAIL`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` · números de `plan_limits` · plan de SerpApi · teléfono y horario del Fixer.
