# CAM-PLANTILLA-08 — CORRECCIÓN DE VENTANA DEL INFORME

## Objetivo
Evitar que Chrome bloquee la generación Word cuando el usuario pulsa el botón desde la ventana del informe ya abierta.

## Corrección
El botón del informe reutiliza la ventana actual y la entrega a `generarWordPlantillaMaestra(window)`. Así se evita abrir una segunda ventana mediante `window.open()`.

## Principio
Se conserva la generación del informe existente y no se modifican sus datos, cálculos, checklist, hallazgos, matriz ni fotografías.
