# Actualización del aviso de privacidad por WhatsApp

Fecha: 18 de noviembre de 2026.

Entrega v2: incluye la canalización a Recepción cuando el envío del PDF sigue fallando. Sustituye el primer paquete entregado en esta conversación.

El identificador del PDF guardado en producción dejó de ser aceptado por Meta. Cada mensaje entrante del cliente provocaba otro intento y, al fallar, otro texto de error. La corrección renueva el archivo y espacia las solicitudes automáticas de consentimiento.

## Comportamiento de la actualización

- El mismo PDF se vuelve a subir a Meta cuando su identificador no tiene fecha de subida conocida o cumple 29 días. Meta establece una vigencia de 30 días: [documentación de medios](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media).
- Si Meta rechaza explícitamente el identificador, se renueva y se hace un único intento adicional. El intento rechazado queda intacto y la recuperación usa una clave propia y estable terminada en `:media_renovado`.
- Las subidas simultáneas del mismo aviso se coordinan mediante un bloqueo de su versión en PostgreSQL.
- Las solicitudes automáticas se espacian dos minutos por teléfono y versión. La reserva se guarda en PostgreSQL y se conserva entre conversaciones y reinicios. Los mensajes del cliente se siguen reteniendo para retomarlos al aceptar.
- Un error genérico o un timeout no disparan una recuperación inmediata. Si falla la subida o el envío final del aviso obligatorio, se crea una solicitud de atención humana y una alerta para Recepción. El trabajador existente envía un único aviso de canalización y confirma el estado `atencion_humana`. Los siguientes mensajes permanecen en atención humana; no dependen de escribir otra vez cada dos minutos.
- La alerta de Recepción explica que falló el envío del aviso. Este fallo técnico se distingue de un rechazo del cliente y conserva su aceptación pendiente.
- La conversación no entra a agrupación mientras espera consentimiento. Esto evita que se cierre por falta de mensajes procesables mientras se sube el PDF o se prepara la transferencia.
- La opción explícita del menú «Aviso de privacidad» permite consultar el documento y también recupera un identificador inválido.
- Los logs incluyen código, subcódigo, estado HTTP, referencia de Meta y detalle técnico, sujetos al filtro de privacidad existente. Las peticiones a Meta tienen un límite de 30 segundos.

Se conservan el archivo, la versión vigente y las respuestas de consentimiento. Los intentos históricos fallidos se mantienen como evidencia; esta actualización no los reenvía en lote. La renovación ocurre con la siguiente solicitud que necesite el aviso.

La subida del archivo no pasa por revisión manual de plantillas: si la petición tiene éxito, Meta devuelve el identificador del medio en esa misma respuesta. La documentación no establece un plazo fijo de respuesta. El límite de 30 segundos se aplica a cada petición de nuestra aplicación, no al conjunto completo de subida, envío y recuperación.

La canalización usa las reglas habituales de atención humana: su duración se configura con `WHATSAPP_ATENCION_HUMANA_HORAS` (valor por defecto de cinco horas). Un retorno explícito mediante `menú` vuelve a pasar por el aviso pendiente. Durante los primeros dos minutos se conserva la atención de Recepción para evitar que ese comando deje al cliente esperando un envío todavía limitado. La atención humana no marca el aviso como aceptado.

## Archivos y migración

Se añade la migración `20261118000001_renovar_media_y_limitar_avisos_privacidad.js`. Agrega:

- `aviso_privacidad_versiones.media_subido_en`, inicialmente nulo para las versiones existentes.
- `control_envios_aviso_privacidad`, con una reserva por teléfono y versión.

El parche se preparó sobre el commit `422064cafa4efdf07cdbc4481c91ed02613cab03`. No cambia dependencias ni variables de entorno.

## Aplicación en Windows

Estas instrucciones corresponden al servicio WinSW `OmegaVetAdminSite`, observado en los logs proporcionados. Se ejecutan en PowerShell como administrador, desde la carpeta real del proyecto, donde están `package.json`, `src` y `node_modules`.

1. Conserva el respaldo habitual de la base y de la instalación. Extrae el paquete v2 en `C:\OmegaVet-Privacidad-20261118-v2`.
2. Revisa el estado de la instalación y comprueba que el parche se puede aplicar. Si `git apply --check` falla, conserva la salida para revisar la diferencia antes de actualizar.

Si todavía no aplicaste el primer paquete, usa `privacidad.patch`. Si ya instalaste exactamente el primer paquete de esta conversación, usa `desde-v1.patch` en la variable del siguiente bloque. Ambos caminos llegan al mismo código final y emplean la misma migración; si ya está aplicada, Knex la conserva sin repetirla.

```powershell
git status --short
git rev-parse HEAD
$parchePrivacidad = "C:\OmegaVet-Privacidad-20261118-v2\privacidad.patch"
git apply --check $parchePrivacidad
if ($LASTEXITCODE -ne 0) { throw "El parche no coincide con esta instalacion." }
Get-Service -Name OmegaVetAdminSite
```

3. Detén el servicio, aplica el parche y ejecuta únicamente la migración de esta corrección usando el entorno productivo. Los datos iniciales de una base nueva no forman parte de esta actualización.

```powershell
Stop-Service -Name OmegaVetAdminSite
git apply $parchePrivacidad
if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el parche; revisar antes de continuar." }

node --env-file="C:\ProgramData\OmegaVet\.env.production" .\node_modules\knex\bin\cli.js migrate:up 20261118000001_renovar_media_y_limitar_avisos_privacidad.js
if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion; revisar o revertir el parche antes de iniciar." }

Start-Service -Name OmegaVetAdminSite
Get-Service -Name OmegaVetAdminSite
```

Si la instalación de producción no es un checkout de Git, la aplicación de este paquete requiere adaptar el procedimiento a esa instalación. Los comandos anteriores no se han ejecutado en el servidor.

## Comprobación en producción

1. Desde un número de prueba con consentimiento pendiente, escribe cuatro mensajes seguidos. Debe llegar un solo PDF con los botones de aceptación. El primer envío debe guardar un nuevo `media_id` y una fecha `media_subido_en`.
2. Pulsa «Estoy de acuerdo». La conversación debe continuar con lo que habías escrito. Para comprobar el menú inmediatamente, el primer mensaje puede ser `menú`.
3. En el menú, selecciona «Aviso de privacidad». Debe llegar el PDF informativo sin pedir aceptación de nuevo.
4. Ejecuta `verificacion-produccion.sql`, incluido en el paquete. Comprueba que el nuevo intento esté aceptado y después `delivered` o `read`. La aceptación inicial de la API no equivale por sí sola a entrega al teléfono.
5. Comparte el resultado y los logs posteriores a la actualización para cerrar la validación productiva.

Si el PDF continúa fallando, comprueba que aparezca una sola alerta «Problema con el aviso de privacidad» en Recepción y se envíe este aviso al cliente:

> En este momento no pudimos enviarte el aviso de privacidad. Recepción continuará con tu atención mientras resolvemos el envío del documento.

Comprueba que los mensajes posteriores continúen en atención humana y que no se registre aceptación automática. Las consultas del paquete muestran la solicitud, la entrega de su aviso y la alerta. Si falla también el envío del texto de transferencia, la solicitud permanece en cola para reintento y la alerta de Recepción ya existe; los mensajes siguientes continúan asociados a esa atención pendiente.

Si vuelve a fallar, los eventos `Meta rechazo el envio de WhatsApp.` y los errores del servicio de consentimiento incluyen `diagnosticoMeta` y/o `detalleTecnico`. Comparte esos eventos, sin adjuntar archivos de entorno ni credenciales. El evento `Archivo del aviso de privacidad subido a Meta con vigencia renovada.` permite localizar una subida correcta.

## Reversión del código

Si la actualización requiere reversión, desde la misma carpeta del proyecto y conservando `$parchePrivacidad` con el mismo archivo que usaste para actualizar:

```powershell
git apply --reverse --check $parchePrivacidad
if ($LASTEXITCODE -ne 0) { throw "Revisar los cambios posteriores antes de revertir." }
Stop-Service -Name OmegaVetAdminSite
git apply --reverse $parchePrivacidad
if ($LASTEXITCODE -ne 0) { throw "Fallo la reversion del codigo." }
Start-Service -Name OmegaVetAdminSite
Get-Service -Name OmegaVetAdminSite
```

Las adiciones de esquema pueden permanecer: el código anterior las ignora. Así se conserva la evidencia y se evita revertir accidentalmente otras migraciones del mismo lote. La reversión vuelve al comportamiento anterior del bot.

## Alcance de la validación

La corrección se verifica localmente con PostgreSQL de pruebas y respuestas simuladas de Meta. Se cubren renovación de identificadores heredados y antiguos, rechazos explícitos, renovación concurrente, límite de recuperación, consultas informativas, espera entre intentos, retención de mensajes, aceptación, rechazo, canalización por fallo técnico, alerta de Recepción, continuidad de atención humana, retorno explícito al bot y continuación del flujo. La entrega por WhatsApp y el servicio de Windows requieren la comprobación productiva anterior.

La validación ampliada incluye estas suites:

Resultado local: **253 pruebas correctas en 12 suites**.

```bash
pnpm exec jest tests/unit/whatsapp.service.test.js tests/unit/whatsapp.envios.test.js tests/unit/whatsapp.outbox.test.js tests/unit/privacidad.test.js tests/unit/whatsapp.atencionHumana.service.test.js tests/unit/whatsapp.alertas.service.test.js tests/integration/whatsapp.consentimiento.test.js tests/integration/whatsapp.outbox.test.js tests/integration/configuracion.test.js tests/integration/whatsapp.menu-selecciones.test.js tests/integration/whatsapp.atencionHumana.test.js tests/integration/whatsapp.alertas.test.js --runInBand --silent
```
