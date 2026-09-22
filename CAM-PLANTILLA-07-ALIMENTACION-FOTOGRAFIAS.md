# CAM-PLANTILLA-07 — Alimentación de fotografías en la Hoja Maestra

**TECCHNEX — Sistema de Inspecciones de Seguridad**

## 1. Identificación
- **ID del cambio:** CAM-PLANTILLA-07
- **Intervención:** 1
- **Fecha:** 22/09/2026
- **Estado:** En prueba

## 2. Ubicación
- **Archivo:** `index.html`
- **Función:** `generarWordPlantillaMaestra()`
- **Líneas intervenidas:** 8830–9132 aproximadamente.

## 3. Objetivo
Continuar la alimentación progresiva de la Hoja Maestra Word incorporando, como segunda prueba controlada, las fotografías de los hallazgos de la inspección seleccionada.

## 4. Alcance
- Se conserva la lógica existente de almacenamiento y captura de fotografías.
- Se consultan únicamente las fotografías asociadas a la inspección seleccionada.
- Las imágenes se agregan al paquete DOCX como archivos de `word/media/`.
- Se agregan únicamente sus relaciones en `word/_rels/document.xml.rels` y los tipos MIME necesarios en `[Content_Types].xml`.
- La Hoja Maestra, su encabezado, pie de página y estructura general no se reconstruyen.
- La información general de CAM-PLANTILLA-06 permanece funcionando y se mantiene.

## 5. Control
- JavaScript validado con `node --check` sobre los bloques `<script>`.
- No se modifican módulos de captura, edición ni almacenamiento de fotografías.
- No se reemplaza el `index.html` publicado hasta completar la prueba de mesa y posterior validación.

## 6. Próxima prueba
Generar un informe desde una inspección que tenga al menos una fotografía asociada a un hallazgo y comprobar:
1. que Word abra el documento;
2. que la información general siga presente;
3. que la fotografía aparezca dentro del documento;
4. que la Hoja Maestra conserve su estructura.

## 7. Regla TECCHNEX
**MEJORAR SIN ROMPER — UN PELDAÑO A LA VEZ.**
