# Prioridad de Recepción desde el menú de WhatsApp

Entrega del 18 de noviembre de 2026. Implementada y comprobada localmente; pendiente de instalar y validar en producción.

## Problema y comportamiento corregido

En la conversación 231 del 11 de noviembre, el cliente recibió el menú a las 17:20:18, escribió otro mensaje a las 17:20:23 y seleccionó «Recepción» a las 17:20:36. El sistema rechazó `MENU_RECEPCION` a las 17:20:37 y el procesamiento anterior terminó a las 17:20:38 con la conversación cerrada. La reproducción local confirmó que una opción válida se rechazaba cuando el estado cambiaba de `esperando_menu` a `procesando`.

La actualización conserva la vigencia del menú principal después de enviarlo. Si el cliente selecciona «Recepción» mientras se acumula o procesa texto libre, esa selección toma prioridad:

- Se registra la prioridad y se deja sin efecto el trabajo automático pendiente en la misma transacción del mensaje entrante. Los grupos quedan identificados como `interrumpido_por_recepcion`; se conservan los registros y el texto que ya estaba almacenado.
- Los intentos automáticos pendientes o fallidos sin identificador de aceptación de Meta se cancelan. Un envío ya reclamado vuelve a comprobar la prioridad antes de iniciar la petición a Meta.
- Si la clasificación estaba en curso, puede terminar la llamada al clasificador, pero su resultado se descarta: no genera otra respuesta ni una alerta clínica posterior a la elección de Recepción. El consumo realizado se conserva en la auditoría.
- La transferencia utiliza la cola y la alerta de Recepción existentes. Repetir el mismo evento no duplica la solicitud ni su aviso. Si falla el aviso de transferencia, se conserva la prioridad y la cola lo reintenta; los mensajes posteriores permanecen en atención humana pendiente.
- Una respuesta anterior no puede cerrar la conversación, volver a mostrar un menú ni iniciar otro flujo después de esa selección. También se bloquean los recordatorios y cierres automáticos correspondientes.

Si una petición de envío a Meta ya había comenzado, su mensaje todavía podría llegar. La aplicación no puede retirar esa petición o un mensaje aceptado: conserva la entrega registrada y continúa con Recepción. El resultado técnico `respuesta_en_vuelo_recepcion_prioritaria` permite reconocer ese caso.

La prioridad adicional se aplica únicamente al botón/lista `MENU_RECEPCION` de un menú vigente, sin otro flujo activo. Los identificadores desconocidos, las otras opciones durante clasificación y los menús que ya dieron paso a un flujo diferente siguen las validaciones anteriores. Escribir «recepción» como texto libre conserva su ruta actual; no se convierte en un comando nuevo.

La atención humana conserva su duración configurada con `WHATSAPP_ATENCION_HUMANA_HORAS` y el retorno explícito mediante `menú`. Ese retorno crea una conversación nueva, pasa por las reglas de consentimiento existentes y puede mostrar un nuevo menú.

## Migración

Se añade `20261118000002_priorizar_recepcion_desde_menu.js`, con dos columnas en `conversaciones_whatsapp`:

- `menu_principal_vigente_en`: fecha de confirmación de envío del menú principal.
- `recepcion_prioritaria_en`: fecha de la selección que interrumpe las respuestas automáticas.

La migración reconoce los menús que ya estaban en `esperando_menu` sin un flujo activo al actualizar. No intenta reconstruir la vigencia de menús de conversaciones que ya estaban acumulando o procesando; en esos casos puede solicitarse un nuevo menú. No reabre la conversación histórica 231 ni reenvía sus mensajes.

El paquete completo conserva las correcciones anteriores de privacidad, transferencia por fallo del PDF y laboratorio. No hay dependencias ni variables de entorno nuevas.

## Instalación en Windows

Extraer el paquete en `C:\OmegaVet-Recepcion-20261118`. Desde PowerShell como administrador, ejecutar los comandos en la carpeta real del proyecto donde están `package.json`, `src` y `node_modules`. Conservar el respaldo habitual y elegir **un solo parche**:

| Código actualmente instalado                                               | Parche                              |
| -------------------------------------------------------------------------- | ----------------------------------- |
| Exactamente el paquete anterior de laboratorio                             | `recepcion-desde-laboratorio.patch` |
| Exactamente privacidad v2, sin laboratorio                                 | `desde-privacidad-v2.patch`         |
| Exactamente el primer paquete de privacidad                                | `desde-privacidad-v1.patch`         |
| Ninguno de los anteriores; base `422064cafa4efdf07cdbc4481c91ed02613cab03` | `completo-desde-base.patch`         |

```powershell
git status --short
git rev-parse HEAD
# Ajustar el archivo según la tabla anterior.
$parche = "C:\OmegaVet-Recepcion-20261118\recepcion-desde-laboratorio.patch"
git apply --check $parche
if ($LASTEXITCODE -ne 0) { throw "El parche no coincide con esta instalacion; revisar diferencias." }
Get-Service -Name OmegaVetAdminSite

Stop-Service -Name OmegaVetAdminSite
git apply $parche
if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el parche; revisar antes de iniciar." }

node --env-file="C:\ProgramData\OmegaVet\.env.production" .\node_modules\knex\bin\cli.js migrate:up 20261118000001_renovar_media_y_limitar_avisos_privacidad.js
if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion de privacidad; revisar antes de iniciar." }
node --env-file="C:\ProgramData\OmegaVet\.env.production" .\node_modules\knex\bin\cli.js migrate:up 20261118000002_priorizar_recepcion_desde_menu.js
if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion de Recepcion; revisar antes de iniciar." }

Start-Service -Name OmegaVetAdminSite
Get-Service -Name OmegaVetAdminSite
```

Cada comando `migrate:up` aplica únicamente esa migración; si ya está registrada, no la repite. El nuevo código requiere la migración de Recepción antes de iniciar el servicio. El procedimiento no se ha ejecutado en producción. Si el servidor no contiene un checkout de Git, adaptar la aplicación del paquete a esa instalación.

Para revertir el código, conservar `$parche` con el mismo archivo elegido, comprobar `git apply --reverse --check $parche`, detener el servicio, ejecutar `git apply --reverse $parche`, comprobar su código de salida y volver a iniciar el servicio. Las columnas añadidas pueden permanecer; el código anterior las ignora. La reversión elimina la protección nueva frente a este incidente.

## Comprobación en producción

Con un número de prueba y consentimiento resuelto:

1. Escribir `menú` y esperar el menú. Enviar texto libre y seleccionar «Recepción» mientras el bot lo prepara. Debe llegar el aviso de transferencia y aparecer una sola solicitud/alerta de Recepción. No debe recibirse el aviso de opción inválida.
2. Repetirlo entrando por un saludo hasta que el sistema muestre el menú. Seleccionar la opción de Recepción de ese menú mientras se procesa otro texto. La prioridad debe ser la misma.
3. Escribir mensajes adicionales: el bot debe conservar la atención humana. Si una respuesta ya estaba en vuelo, puede llegar, pero la conversación debe permanecer canalizada y no cerrarse por el procesamiento anterior.
4. Escribir `menú` para volver al bot. Se debe crear la nueva conversación conforme a las reglas habituales. Comprobar una nueva selección de Recepción.
5. Ejecutar `verificacion-recepcion.sql` y revisar el estado local y los estados posteriores de Meta. `enviado` indica aceptación inicial; verificar `delivered` o `read` para la entrega. La selección histórica 231 se conserva como evidencia.

También se incluyen las consultas anteriores de privacidad y laboratorio. Su comprobación sigue pendiente si esos cambios todavía no se instalaron.

## Validación local

Se usa PostgreSQL `omega_test` y se simulan las respuestas de Meta y del clasificador. No se enviaron mensajes reales ni se modificó producción. Se cubren la selección durante acumulación y procesamiento, una clasificación en curso, la respuesta ya reclamada, una selección confirmándose en otra transacción, la petición a Meta ya en vuelo, reentregas, fallo y reintento del aviso, protección de cierres y flujos, opciones inválidas y retorno mediante `menú`.

La migración fue aplicada, revertida y reaplicada localmente, comprobando la conservación de los menús existentes en espera. **Resultado local: 735 pruebas correctas en 38 suites**, con lint, formato y `git diff --check` correctos. El SQL se valida en modo de solo lectura. El manifiesto incluye el comando de pruebas y la comprobación de aplicación/reversión de los parches.
