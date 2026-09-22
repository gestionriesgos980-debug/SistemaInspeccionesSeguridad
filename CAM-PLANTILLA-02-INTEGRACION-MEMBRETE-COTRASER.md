# CAM-PLANTILLA-02 — Integración de membrete COTRASER en Hoja Maestra

**Proyecto:** Sistema de Inspecciones de Seguridad TECCHNEX  
**Principio:** MEJORAR SIN ROMPER / LO QUE FUNCIONA NO SE TOCA / UN PELDAÑO A LA VEZ

## Objetivo
Integrar el membrete COTRASER aprobado visualmente en la Hoja Maestra del informe, para que la aplicación genere nuevos documentos Word usando esta versión como documento base.

## Intervención
- Se conserva la Hoja Maestra original mediante respaldo.
- Se reemplaza únicamente la copia operativa `PLANTILLA_MAESTRA_INFORME_TECCHNEX.docx` por la versión aprobada con membrete COTRASER.
- Se conserva el generador Word existente y su estrategia de sustitución de marcadores.
- Se mantiene el generador PDF existente sin modificación funcional.
- Se actualiza el botón para identificar claramente la salida con Hoja Maestra + membrete COTRASER.

## Respaldos
- `index.html.CAM-PLANTILLA-02-backup`
- `PLANTILLA_MAESTRA_INFORME_TECCHNEX_CAM-PLANTILLA-02-backup.docx`

## Estado
**IMPLEMENTADO EN MESA DE TRABAJO — PENDIENTE DE PRUEBA EN GITHUB/PAGES.**

## Siguiente validación
1. Publicar solo los archivos necesarios.
2. Abrir la aplicación desde GitHub Pages.
3. Seleccionar una inspección de prueba.
4. Generar Word con Hoja Maestra + membrete COTRASER.
5. Verificar visualmente encabezado, pie, datos y paginación.
6. Ejecutar prueba de regresión sobre el flujo existente.
