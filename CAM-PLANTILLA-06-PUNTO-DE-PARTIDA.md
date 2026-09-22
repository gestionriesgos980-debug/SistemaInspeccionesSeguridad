# CAM-PLANTILLA-06 — PUNTO DE PARTIDA CONTROLADO

## Motivo del retorno
Se establece CAM-PLANTILLA-06 como punto de partida controlado para salir del bucle de intervenciones CAM-07/CAM-08.

## Por qué CAM-06
Esta versión conserva el flujo que ya había demostrado avance funcional en Word: la plantilla maestra recibía información general de la inspección, incluyendo objetivo, y Word generaba páginas adicionales de forma natural.

## Qué NO se modifica en este punto
- No se modifica `generarInforme()`.
- No se modifica almacenamiento de inspecciones.
- No se modifica checklist.
- No se modifica hallazgos.
- No se modifica matriz de riesgos.
- No se modifica paginación existente.
- No se introduce `window.open()` adicional desde el generador Word.
- No se introduce `altChunk` en esta etapa.

## Próximo avance
Desde esta base se estudiará una única integración: transferir el contenido del informe ya generado hacia la plantilla maestra, reutilizando la ventana de informe existente cuando corresponda y sin alterar las funciones operativas que ya funcionan.

## Regla
MEJORAR SIN ROMPER — LO QUE FUNCIONA NO SE TOCA — UN PELDAÑO A LA VEZ.
