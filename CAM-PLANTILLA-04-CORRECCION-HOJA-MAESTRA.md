# CAM-PLANTILLA-04 — Corrección de la Hoja Maestra publicada

**Módulo:** Sistema de Inspecciones de Seguridad TECCHNEX  
**Objetivo:** Restituir en GitHub la Hoja Maestra aprobada y evitar que la generación DOCX trabaje sobre una copia distinta de la plantilla validada.

## Hallazgo
La prueba real generada desde GitHub tenía una estructura distinta a la Hoja Maestra aprobada: incorporaba `header2.xml`, `header3.xml`, `footer2.xml` y `footer3.xml`, mientras la plantilla aprobada conserva una sola sección con `header1.xml` y `footer1.xml`.

La causa quedó localizada en la **plantilla publicada**, no en las 15.000 líneas de la aplicación.

## Intervención quirúrgica
- Se conserva la función `generarWordPlantillaMaestra()` de CAM-PLANTILLA-03.
- No se modifica el generador PDF.
- No se modifica almacenamiento, clientes, hallazgos, matriz ni interfaz.
- Se restaura como `PLANTILLA_MAESTRA_INFORME_TECCHNEX.docx` la copia maestra aprobada con membrete COTRASER.
- La plantilla conserva su estructura original, márgenes, encabezado y pie de página.

## Validación técnica previa
Se generó una copia de prueba a partir de la Hoja Maestra aprobada, sustituyendo únicamente:
- `{{FECHA}}`
- `{{CLIENTE}}`
- `{{PUESTO}}`
- `{{REALIZADO_POR}}`
- `{{REVISADO_POR}}`

La copia resultante mantiene la estructura de la plantilla y fue abierta correctamente por LibreOffice para conversión a PDF.

## Estado
**EN PRUEBA — pendiente de validación final en Microsoft Word desde GitHub Pages.**
