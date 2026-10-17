# Eliminación de cuenta y sincronización del esquema

## Resultado
- Sección **Eliminar mi cuenta** en Perfil, con dos confirmaciones y advertencia irreversible.
- Eliminar datos personales, fotos y archivos propios, relaciones de amistad y colaboraciones; conservar los datos de otros usuarios.
- Cerrar sesión y regresar a la landing cuando termine.
- Versionar las definiciones faltantes detectadas contra el esquema real, sin recrear ni borrar tablas existentes.

## Detalles técnicos
- `delete-account` valida la sesión y las dos confirmaciones; nunca acepta un identificador de usuario del cliente.
- Limpieza de datos en una operación transaccional protegida, usando el esquema real: tablas con `user_id`, `profiles.id`, amistades por ambos lados, autoría, invitaciones y registros de límites. Los hijos de viajes propios se eliminan mediante sus relaciones; los viajes ajenos no se eliminan.
- Archivos mediante Storage API; eliminación final de la identidad mediante Auth Admin API. Si falla una etapa, no anunciar éxito.
- Revisar suscripciones externas para evitar cobros posteriores, y señalar límites de borrado fuera de IATOS (emails enviados y respaldos).
- Pruebas automatizadas y flujo completo con una cuenta desechable, nunca con la cuenta de Rodrigo.