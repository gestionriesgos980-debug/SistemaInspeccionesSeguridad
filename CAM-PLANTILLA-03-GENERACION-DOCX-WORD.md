# CAM-PLANTILLA-03 — Generación DOCX compatible con Microsoft Word

## Objetivo
Corregir de forma puntual la generación del documento Word desde la aplicación, sin intervenir funcionalidades ajenas al generador.

## Intervención
- Se conserva la Hoja Maestra aprobada con membrete COTRASER.
- Se limita la modificación de XML a `word/document.xml` y `word/header1.xml`, que contienen los marcadores dinámicos utilizados por la aplicación.
- Se mantiene intacto el resto del paquete DOCX.
- Se cambia únicamente el método de compresión de salida de `DEFLATE` a `STORE`, buscando minimizar la transformación del archivo y mejorar compatibilidad con Microsoft Word.
- Se conserva el generador PDF y el resto de módulos sin cambios.

## Respaldo
`index.html.CAM-PLANTILLA-03-backup`

## Criterio de validación
La prueba queda aprobada únicamente si el archivo generado por la aplicación abre directamente en Microsoft Word sin advertencia y conserva el membrete, estructura y campos dinámicos de la Hoja Maestra.
