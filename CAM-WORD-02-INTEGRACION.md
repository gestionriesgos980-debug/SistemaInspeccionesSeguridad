# CAM-WORD-02 — INTEGRACIÓN DE GENERACIÓN WORD + FOTOGRAFÍAS NATIVAS

## Objetivo
Integrar las dos estrategias comprobadas sin sustituir una por la otra:

- Base: generación Word nativa de CAM-PLANTILLA-03 / CAMPO-VISUAL-03, que construye `word/document.xml` con WordprocessingML y conserva la estructura/paginación de Word.
- Aporte de CAM-WORD-01.1: transporte real de fotografías desde `hallazgos[].fotos`.

## Decisión técnica
No se integra `altChunk/MHTML` como mecanismo principal del cuerpo. La prueba demostró que MHTML resuelve las fotografías, pero Word puede reinterpretar HTML/CSS y alterar la distribución de columnas.

La nueva candidata conserva el motor nativo del primer documento y agrega las fotografías directamente al paquete DOCX:

`document.xml -> w:drawing -> r:embed -> document.xml.rels -> word/media/*`

## Hoja Maestra
Se utiliza la Hoja Maestra visual aprobada como base, manteniendo:

- encabezado y pie;
- estructura corporativa;
- bloque legal;
- firmas;
- `{{CONTENIDO_INFORME}}`.

El contenido dinámico se inserta reemplazando exclusivamente ese marcador con WordprocessingML nativo.

## Hallazgos
La candidata utiliza la estructura visual aprobada:

`HALLAZGOS | ACCIÓN PREVENTIVA | REGISTRO FOTOGRÁFICO`

Distribución aproximada: 30% / 30% / 40%.

Máximo 4 fotografías por hallazgo, organizadas en 2 columnas.

## Seguridad de la intervención
No se modifica:

- `generarInforme()`;
- captura de fotografías;
- almacenamiento;
- checklist;
- cálculos;
- matriz de riesgos;
- mapa de calor;
- PDF.

## Validaciones realizadas
- JavaScript extraído de `<script>` validado con `node --check`.
- La candidata queda separada de producción.
- Se conserva `index-CAM-PLANTILLA-03-BASE.html` como punto de retorno.

## Próxima prueba
Probar con una inspección real:

1. Sin fotografías.
2. Un hallazgo con 1 fotografía.
3. Un hallazgo con 2 fotografías.
4. Un hallazgo con 4 fotografías.
5. Varias filas de hallazgos.

La aceptación requiere Word abierto correctamente, fotografías visibles y columnas conservadas.
