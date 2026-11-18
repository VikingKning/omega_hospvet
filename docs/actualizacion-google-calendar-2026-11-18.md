# Conservar al tutor al completar una reserva de Google

Entrega del 18 de noviembre de 2026. Implementada y comprobada localmente; instalación y comprobación de notificaciones en producción pendientes.

## Incidente y corrección

El usuario reporta que, cuando una reserva de estética llega desde el enlace de WhatsApp y el tutor todavía no está registrado, Recepción completa tutor y mascota y confirma la cita. Omega mantiene la cita confirmada, pero el tutor recibe una cancelación de Google.

La importación deja `mascota_id` vacío mientras falta registrar o vincular al paciente. La consulta para sincronizar requiere una mascota; al completar ese dato desde Recepción, `agenda.service.editar` dispara el envío al evento original. El código usaba `events.update` con un cuerpo que no contiene `attendees`.

Google documenta que `update` reemplaza el recurso completo, mientras que `patch` conserva los campos omitidos. La corrección utiliza `events.patch` para los eventos existentes. Se siguen enviando el título, motivo, horario, color e identificador de cita de Omega; se conservan los invitados y los demás campos que Omega no envía. No se añaden ni se reconstruyen invitados a partir del registro local del tutor.

La creación de eventos y la cancelación explícita conservan sus operaciones anteriores. También se conserva la recuperación existente ante un identificador que devuelve 404/410. Este cambio se aplica al envío inmediato después de editar y al reintento periódico, porque ambos utilizan `pushCita`.

Fuentes oficiales: [Google Events.update](https://developers.google.com/workspace/calendar/api/v3/reference/events/update) y [Google Events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).

## Archivos e instalación

- `src/modules/agenda/agenda.googleSync.js`
- `tests/unit/agenda.googleSync.test.js`

El paquete completo actualizado contiene 33 archivos: los 31 anteriores sin cambios y estos dos adicionales. El ZIP incluye directamente las carpetas con los 33 archivos y cuatro auxiliares: instrucciones de PowerShell, manifiesto, hashes y validación. La copia instala únicamente los 33 archivos indicados en el manifiesto. Los documentos y consultas de verificación quedan fuera del código para instalar.

Seguir `INSTRUCCIONES.txt`: respaldo, parada del servicio WinSW `OmegaVetAdminSite`, copia verificada y reinicio. Se mantienen las dos migraciones anteriores de privacidad y Recepción. Esta corrección de Google no añade migraciones, dependencias ni variables de entorno. Si ya se instalaron los 31 archivos y sus migraciones, se puede aplicar el procedimiento del nuevo paquete completo: los 31 archivos son idénticos y Knex no repite las migraciones registradas.

## Validación y comprobación productiva

Las dos regresiones nuevas fallaron contra el código anterior. Tras la corrección pasan 109 pruebas unitarias en cuatro suites de agenda y 27 pruebas de integración en dos suites de agenda/WhatsApp. También pasan ESLint, Prettier y `git diff --check`.

Las regresiones utilizan un servicio de Google simulado según el contrato de reemplazo/actualización parcial. Cubren la conservación de los invitados y otros datos del evento al actualizar horario/datos, y el flujo de una cita pendiente sin tutor vinculado, asignación de mascota y confirmación desde Recepción. Las integraciones utilizan PostgreSQL `omega_test`. No se enviaron correos ni se modificaron citas reales en Google.

Tras instalar:

1. Con un tutor de prueba sin registro, reservar estética desde el enlace de WhatsApp. Comprobar que el evento original de Google tiene al tutor como invitado y que Omega presenta la cita pendiente.
2. Registrar o vincular al tutor y a su mascota; completar y confirmar desde Recepción.
3. Comprobar que Omega conserva la cita confirmada, que se mantiene el mismo evento de Google y que el tutor sigue invitado. Verificar en su calendario/correo que no haya una cancelación por retirar la invitación.
4. Editar o reagendar la cita de prueba y volver a comprobar la conservación del invitado. Una actualización de horario puede producir un aviso de cambio.
5. Esperar un ciclo de sincronización y comprobar que ambas agendas siguen consistentes. Si Google no es accesible o el identificador pertenece a otro calendario, revisar los logs y la recuperación existente.

La corrección previene nuevas pérdidas de invitados durante esta actualización. Los invitados que ya se eliminaron deben revisarse en el evento original y restituirse manualmente cuando corresponda; instalar el paquete no revierte correos anteriores ni reconstruye automáticamente esas invitaciones.
