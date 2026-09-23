# CAM-PLANTILLA-10 — Hoja Maestra limpia + generación Word controlada

## Objetivo
Separar la plantilla corporativa Word del contenido dinámico de la inspección.

## Hoja Maestra
La plantilla `PLANTILLA_MAESTRA_INFORME_TECCHNEX.docx` conserva:
- encabezado corporativo COTRASER;
- código fijo PSOF004;
- confidencialidad;
- paginación;
- tres campos dinámicos: `{{VERSION_DOCUMENTO}}`, `{{TITULO_DOCUMENTO}}` y `{{PUESTO}}`.

Se retiraron del cuerpo de la plantilla los textos finales, firmas y el marcador `{{CONTENIDO_INFORME}}`.

## Generación
La información final que antes estaba fija en la plantilla se incorpora al contenido generado por TECCHNEX.

## Regla
No se modifican captura de datos, cálculos, localStorage, checklist, hallazgos, matriz ni generación PDF.

## Siguiente paso
Construir y validar el primer bloque (`Información general`) como contenido Word nativo, sustituyendo progresivamente el uso de `altChunk` sin romper las demás funciones.
