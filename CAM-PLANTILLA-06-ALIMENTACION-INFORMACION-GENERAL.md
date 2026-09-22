# CAM-PLANTILLA-06 — Alimentación de información general

## Intervención 1

Se modifica exclusivamente `generarWordPlantillaMaestra()` para que la aplicación alimente el marcador `{{CONTENIDO_INFORME}}` de la Hoja Maestra con información general ya almacenada en la inspección.

### Incluye
- ID de inspección
- Cliente y NIT
- Dirección y ciudad/municipio
- Contacto, teléfono y correo
- Fecha
- Inspector y revisado por
- Tipo y sector de inspección
- Objetivo
- Latitud, longitud y entorno

### Regla
No se modifican otras funciones de la aplicación. La Hoja Maestra conserva su estructura, encabezado, pie de página y texto fijo.
