# Avatar automático y conservación de la imagen de perfil

Entrega del 18 de noviembre de 2026. Cambio local, pendiente de instalar y validar en producción.

Cuando una sesión no tiene un avatar válido, se utiliza automáticamente `icon_hospvet`, el ícono de Omega que ya existe entre las opciones disponibles. La elección de respaldo es estable: no cambia al navegar. Los avatares válidos elegidos por el usuario se conservan.

## Corrección

El inicio de sesión con contraseña temporal no incluía el avatar; después del cambio obligatorio se conservaba esa sesión incompleta y las páginas podían pedir `/assets/imgs/.png`. Ahora el inicio de sesión restringido incluye los datos de avatar y doctor, manteniendo sus permisos vacíos hasta completar el cambio de contraseña.

Se usa un catálogo compartido con las cinco opciones existentes: `icon_hospvet`, `icon_cat`, `icon_dog`, `img_doctor` e `img_doctora`. Tanto el login normal como el restringido resuelven cualquier valor ausente o inválido al ícono de Omega.

También se completa el avatar de las sesiones abiertas con el código anterior, en su siguiente petición dinámica. Esta protección está antes del renderizado de las páginas, incluida la página 404. El archivo que se muestre ya no tendrá un nombre vacío. Las imágenes estáticas ya cargadas en el navegador se actualizan al navegar o recargar.

Mi perfil muestra el respaldo como opción seleccionada si el valor guardado está vacío o es inválido. Esta corrección elige el respaldo para la sesión y la presentación; no modifica masivamente los avatares guardados en la base. El usuario puede guardar su elección desde Mi perfil mediante la validación habitual.

## Paquete e instalación

El paquete conserva las correcciones anteriores de privacidad, laboratorio y prioridad de Recepción. Los paquetes anteriores permanecen intactos. Extraerlo en `C:\OmegaVet-Correcciones-20261118` y elegir **un solo parche**, según el código instalado:

| Estado de la instalación                                                   | Archivo                        |
| -------------------------------------------------------------------------- | ------------------------------ |
| Exactamente el último paquete de Recepción prioritaria                     | `avatar-desde-recepcion.patch` |
| Exactamente el paquete anterior de laboratorio                             | `desde-laboratorio.patch`      |
| Exactamente privacidad v2, sin laboratorio                                 | `desde-privacidad-v2.patch`    |
| Exactamente el primer paquete de privacidad                                | `desde-privacidad-v1.patch`    |
| Ninguno de los anteriores; base `422064cafa4efdf07cdbc4481c91ed02613cab03` | `completo-desde-base.patch`    |

El ajuste de avatar no requiere migraciones, dependencias o variables nuevas. Los parches acumulados conservan las dos migraciones anteriores; ejecutar los comandos siguientes las aplica solo si aún faltan.

Desde PowerShell como administrador, en la carpeta real del proyecto con `package.json`, `src` y `node_modules`, conservar el respaldo habitual y ejecutar:

```powershell
git status --short
git rev-parse HEAD
# Elegir el archivo de la tabla anterior.
$parche = "C:\OmegaVet-Correcciones-20261118\avatar-desde-recepcion.patch"
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

Los comandos no se han ejecutado en producción. Si la instalación no contiene un checkout de Git, adaptar la aplicación del paquete a esa instalación. Las adiciones de esquema deben estar presentes antes de iniciar el código acumulado.

Para revertir el código, conservar `$parche` con el mismo archivo elegido, comprobar `git apply --reverse --check $parche`, detener el servicio, ejecutar `git apply --reverse $parche`, revisar su código de salida y volver a iniciar el servicio. Las adiciones de esquema pueden permanecer. Al revertir el parche incremental de avatar vuelve únicamente el comportamiento anterior de ese ajuste; al revertir uno acumulado también se retiran los demás cambios incluidos en ese parche.

## Comprobación en producción

1. En una sesión que presentaba el ícono vacío, navegar a Inicio. Debe aparecer el ícono de Omega y dejar de solicitarse `/assets/imgs/.png`.
2. Con una cuenta de prueba, seleccionar un avatar distinto en Mi perfil, cerrar sesión e iniciar de nuevo. Debe conservarse la elección.
3. Con una cuenta de prueba que requiera cambio obligatorio de contraseña, completar ese flujo y entrar a Inicio. El avatar debe conservarse y los permisos seguir las reglas habituales.
4. Comprobar la página 404 estando autenticado. Debe mostrar un avatar disponible.

Las comprobaciones anteriores de privacidad, laboratorio y Recepción siguen siendo necesarias si aún no se instalaron. El paquete incluye sus instrucciones y consultas; las correcciones locales no prueban por sí mismas el resultado en producción.

## Validación local

**106 pruebas correctas en seis suites**, incluidas nueve pruebas de integración específicas del avatar. Se comprobaron las cinco imágenes por HTTP con respuesta 200 y tipo PNG, el cambio obligatorio de contraseña, las sesiones antiguas, la página 404 y la selección visible en Mi perfil. Lint, formato y `git diff --check` correctos.

```bash
pnpm exec jest tests/unit/auth.service.test.js tests/unit/perfil.service.test.js tests/integration/avatarSesion.test.js tests/integration/auth.test.js tests/integration/perfil.test.js tests/integration/resetearPassword.test.js --runInBand --silent
```

La corrección anterior de WhatsApp y laboratorio conserva su validación de 735 pruebas en 38 suites, realizada antes de este ajuste de avatar. No se presenta como una nueva ejecución conjunta. El manifiesto distingue ambas validaciones y documenta la comprobación de los parches acumulados.
