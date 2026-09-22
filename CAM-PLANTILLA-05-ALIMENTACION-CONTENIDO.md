# CAM-PLANTILLA-05 — Alimentación progresiva de la Hoja Maestra

## Intervención 1

Objetivo: establecer un único punto controlado de inserción para el contenido variable de la inspección, conservando el encabezado/membrete, pie de página, márgenes y texto fijo de la Hoja Maestra.

Cambio de esta intervención: se agrega el marcador `{{CONTENIDO_INFORME}}` en el cuerpo del documento, antes del bloque legal fijo.

No se modifica `index.html` en esta intervención.

No se modifica el generador PDF, almacenamiento, Directorio de Clientes, checklist, matriz, hallazgos ni la lógica de consecutivos.

La siguiente intervención deberá sustituir exclusivamente el marcador por contenido WordprocessingML generado a partir de los datos de la inspección, sin reconstruir la plantilla completa.
