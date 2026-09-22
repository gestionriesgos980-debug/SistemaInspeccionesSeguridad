# CAM-PLANTILLA-08 — ALIMENTACIÓN DEL CHECKLIST

## Intervención 1

Se incorpora al generador Word la información del checklist ya guardado para la inspección seleccionada.

### Cambio puntual
- Se consulta `localStorage.checklists` para la inspección seleccionada.
- Se utiliza el último registro correspondiente a esa inspección.
- Se alimentan las categorías, los ítems y las respuestas en una tabla Word.
- No se modifica la captura, cálculo ni almacenamiento existente del checklist.
- Se conserva la Hoja Maestra como documento base.
- Las fotografías de CAM-PLANTILLA-07 permanecen sin cambios.

### Objetivo de la prueba
Confirmar que la Hoja Maestra puede crecer con contenido real del checklist y que Word mantiene la paginación automática.

### Regla del proyecto
MEJORAR SIN ROMPER — UN PELDAÑO A LA VEZ.
