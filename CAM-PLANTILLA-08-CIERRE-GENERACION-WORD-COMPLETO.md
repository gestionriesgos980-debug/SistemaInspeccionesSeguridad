# CAM-PLANTILLA-08 — CIERRE / GENERACIÓN WORD COMPLETO

## Objetivo
Conectar el botón **Generar Word con Hoja Maestra + membrete COTRASER** con el informe completo que ya construye `generarInforme()`.

## Intervención
- Se reutiliza `generarInforme()` como fuente única de información.
- `generarInforme()` devuelve la ventana del informe sin alterar sus cálculos.
- Antes de la paginación visual se conserva el contenido completo para la salida Word.
- La plantilla maestra conserva encabezado, membrete, versión y textos fijos.
- Los marcadores `{{FECHA}}`, `{{CLIENTE}}`, `{{PUESTO}}`, `{{REALIZADO_POR}}` y `{{REVISADO_POR}}` continúan alimentándose desde la inspección.
- El contenido completo se inserta en Word mediante `altChunk` HTML para que Word procese el contenido y su paginación.
- No se modifica el almacenamiento de inspecciones, checklist, hallazgos, matriz ni cálculos.

## Validación técnica realizada
- `generarWordPlantillaMaestra()` existe una sola vez.
- El puente `window.__tecchnexWordHtml` existe una sola vez.
- `generarInforme()` retorna la ventana generada.
- La salida DOCX incorpora relación `aFChunk` y parte HTML `word/afchunk-tecchnex.html`.

## Principio
**MEJORAR SIN ROMPER — reutilizar lo que ya funciona.**
