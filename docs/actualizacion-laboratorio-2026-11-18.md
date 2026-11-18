# Resultados de laboratorio por WhatsApp

Entrega del 18 de noviembre de 2026. Cambios locales, pendientes de instalar y comprobar en producción.

## Problema confirmado

El intento 516 del 13 de noviembre a las 16:44:26 fue rechazado con el código `132001`: Meta no tenía disponible `resultados_laboratorio_listos_v2` en la traducción solicitada. El código usa `es_MX`; el usuario confirmó que la plantilla sigue en revisión en WhatsApp Manager. No hay evidencia de entrega de ese intento.

Se conserva el nombre Meta `resultados_laboratorio_listos_v2` y la intención interna `default_resultados_laboratorio_listos_v2`. El catálogo histórico del repositorio usa el slug `resultados-laboratorio-listos-v2`; esta actualización no cambia ninguno de esos identificadores.

## Comportamiento

- Cuando hay un mensaje entrante real del tutor al número oficial configurado en las últimas 24 horas, el resultado se envía directamente con el nombre de la mascota y el folio: los PDF como documento, los JPG y PNG como imagen. La revisión de la plantilla no es necesaria para esa respuesta dentro de la ventana de atención.
- Sin ese mensaje reciente se conserva el envío con la plantilla v2 en `es_MX`, que debe estar aprobada en la cuenta de producción. No se fuerza un documento fuera de la ventana.
- La comprobación usa los mensajes entrantes persistidos y el número oficial configurado. Excluye ecos salientes, continuaciones internas del consentimiento y fechas futuras. Una conversación cerrada puede tener una ventana de Meta aún válida.
- La ventana se revisa de nuevo antes de enviar cada documento. Si vence entre la preparación y el envío, se bloquea el documento y se pide que el tutor escriba otra vez o se use correo.
- Se mantienen la verificación de teléfono del tutor en consultas por WhatsApp y la confirmación de destinatarios del panel. La misma intención conserva su contenido original y no vuelve a enviar un documento aceptado por Meta.
- El panel recibe una explicación concreta para `132001` y para la ventana vencida, en lugar del error genérico. El correo sigue siendo un canal independiente.
- Si el bot no consigue adjuntar los resultados, responde «No pudimos adjuntar tus resultados en este momento. Por favor, solicita apoyo de recepción.». No afirma que se hayan enviado porque el folio tenga un envío histórico. Este texto pide apoyo; no crea por sí mismo una transferencia automática a atención humana.
- La auditoría distingue `documento_resultados_laboratorio` e `imagen_resultados_laboratorio` de la plantilla real. Los logs conservan código, estado HTTP y referencia técnica de Meta. No se reenvían automáticamente intentos históricos ni se modifica o vuelve a presentar la plantilla a revisión.

Un rechazo `132001` por sí solo no demuestra que siga en revisión: también puede ser un nombre, idioma o cuenta incorrectos. Se debe consultar el estado real. La aceptación inicial de la API tampoco prueba entrega; comprobar después `delivered` o `read`.

## Consulta de la plantilla y fecha de modificación

Después de instalar el código, ejecutar desde la carpeta real del proyecto en producción:

```powershell
node --env-file="C:\ProgramData\OmegaVet\.env.production" .\scripts\diagnosticar-plantilla-resultados.js
```

Este script hace únicamente un GET a Meta con las credenciales de esa instalación. Muestra el nombre, idioma, estado, categoría y motivo de rechazo, sin imprimir credenciales. No actualiza el catálogo ni registra o modifica plantillas. `disponible_para_envio` será verdadero si la respuesta contiene esa plantilla `APPROVED` en `es_MX`. Si `consulta_completa` es falso, el listado se paginó y debe revisarse WhatsApp Manager para completar el diagnóstico.

La consulta no informa la fecha de la última edición en Meta. Revisar el historial o las notificaciones en WhatsApp Manager. El SQL incluido muestra creación y actualización del catálogo local; esos tiempos no prueban cuándo se editó o presentó una plantilla en Meta, y una actualización local puede corresponder a datos de aprobación.

Meta indica que la revisión puede tardar hasta 24 horas desde su presentación. Sin la fecha de presentación no puede calcularse cuánto lleva en revisión. Véase la [documentación de revisión](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review). La ventana de respuesta de 24 horas es un concepto distinto: [documentación de envío de mensajes](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).

## Instalación en Windows

El paquete incluye la corrección de privacidad y recepción preparada antes. Los paquetes anteriores permanecen intactos. Extraer este paquete en `C:\OmegaVet-Laboratorio-20261118` y elegir **un solo parche**:

| Estado de la instalación                                                                 | Archivo                      |
| ---------------------------------------------------------------------------------------- | ---------------------------- |
| Ya se instaló exactamente el paquete de privacidad v2                                    | `laboratorio-desde-v2.patch` |
| Solo se instaló exactamente el primer paquete de privacidad                              | `desde-v1.patch`             |
| No se instaló ninguno de los anteriores, base `422064cafa4efdf07cdbc4481c91ed02613cab03` | `completo-desde-base.patch`  |

La corrección de laboratorio no requiere otra migración, dependencia o variable de entorno. El paquete completo conserva la migración de privacidad `20261118000001_renovar_media_y_limitar_avisos_privacidad.js`. Si ya está aplicada, Knex no la repite.

Desde PowerShell como administrador, en la carpeta real del proyecto con `package.json`, `src` y `node_modules`, conservar el respaldo habitual y ejecutar:

```powershell
git status --short
git rev-parse HEAD
# Elegir el archivo correspondiente de la tabla anterior.
$parche = "C:\OmegaVet-Laboratorio-20261118\laboratorio-desde-v2.patch"
git apply --check $parche
if ($LASTEXITCODE -ne 0) { throw "El parche no coincide con esta instalacion; revisar diferencias." }
Get-Service -Name OmegaVetAdminSite

Stop-Service -Name OmegaVetAdminSite
git apply $parche
if ($LASTEXITCODE -ne 0) { throw "No se pudo aplicar el parche; revisar antes de iniciar." }
node --env-file="C:\ProgramData\OmegaVet\.env.production" .\node_modules\knex\bin\cli.js migrate:up 20261118000001_renovar_media_y_limitar_avisos_privacidad.js
if ($LASTEXITCODE -ne 0) { throw "Fallo la migracion; revisar antes de iniciar." }
Start-Service -Name OmegaVetAdminSite
Get-Service -Name OmegaVetAdminSite
```

Si el servidor no contiene un checkout de Git, se requiere adaptar la aplicación del paquete a esa instalación. Los comandos no se han ejecutado en producción.

Para revertir solo el código, conservar `$parche` con el mismo archivo elegido, comprobar `git apply --reverse --check $parche`, detener el servicio, ejecutar `git apply --reverse $parche` y volver a iniciarlo. Revisar el código de salida de cada comando. Conservar las adiciones de esquema de privacidad; así se evita revertir otras migraciones.

## Comprobación productiva

1. Ejecutar el diagnóstico de Meta y conservar el resultado. Verificar especialmente `es_MX` y la cuenta de producción.
2. Con un folio y tutor de prueba cuyos resultados estén cargados, hacer que el tutor escriba al WhatsApp oficial. Si su aceptación está pendiente, resolver primero el consentimiento o la atención correspondiente. Desde el panel, revisar y confirmar destinatarios y enviar. Debe llegar un documento aunque la plantilla esté `PENDING`.
3. Desde ese WhatsApp, consultar el mismo folio por el menú «Resultados de laboratorio». El teléfono debe coincidir con el tutor registrado y debe recibirse el archivo. Probar también la entrada mediante el comando `menú`.
4. Para un tutor de prueba que no haya escrito en más de 24 horas, el panel debe usar la plantilla. Mientras Meta la rechace con `132001`, debe explicar el bloqueo; el canal WhatsApp no debe marcarse exitoso. Si el correo está habilitado y funciona, puede completar ese canal. No es necesario provocar mensajes a clientes reales para esta comprobación.
5. Ejecutar `verificacion-laboratorio.sql`: comprobar tipo de mensaje, estado local y estado posterior de Meta. Un nuevo envío confirmado desde el panel o una nueva consulta son solicitudes nuevas; no se modifica el intento histórico 516.

Hasta completar estas comprobaciones no se considera resuelto el incidente en producción.

## Validación local

Se usan PostgreSQL de pruebas y respuestas simuladas de Meta; no se enviaron resultados reales ni se consultaron credenciales de producción. Las pruebas cubren las rutas de plantilla y documento, destinatario, reloj de la ventana, ecos, aislamiento por número oficial, revalidación antes de envío, idempotencia, errores y continuidad del correo, junto con las regresiones de consentimiento, recepción y menú. **Resultado: 464 pruebas correctas en 20 suites; lint, formato de archivos modificados y `git diff --check` correctos.** El SQL se ejecutó en modo de solo lectura contra `omega_test`. El manifiesto del paquete contiene el listado de suites y la comprobación de los parches.
