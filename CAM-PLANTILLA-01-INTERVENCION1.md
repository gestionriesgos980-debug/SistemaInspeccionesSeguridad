# CAM-PLANTILLA-01 — Integración con plantilla maestra Word

## Base
- Base de desarrollo: `SistemaInspeccionesSeguridad-OM26-Intervencion1`.
- Respaldo previo: `index.html.OM26-base-backup`.
- Respaldo inmediato antes de esta intervención: `index.html.CAM-PLANTILLA-01-backup`.

## Objetivo
Realizar una primera prueba de concepto para que el sistema utilice la plantilla maestra Word como documento base, en lugar de reconstruir su diseño para esta etapa.

## Cambio realizado
1. Se agregaron a la inspección los datos:
   - `revisadoPor`: persona que revisa/aprueba el informe.
   - `nombrePuesto`: nombre del puesto que se mostrará en el encabezado.
2. Se conservó `director` para no romper información histórica ni funciones existentes.
3. Se creó `PLANTILLA_MAESTRA_INFORME_TECCHNEX.docx`, derivada de la plantilla maestra original, con marcadores internos para:
   - `{{FECHA}}`
   - `{{CLIENTE}}`
   - `{{PUESTO}}`
   - `{{REALIZADO_POR}}`
   - `{{REVISADO_POR}}`
4. Se agregó el botón `Generar Word con plantilla maestra` en la ventana del informe.
5. La primera prueba sustituye únicamente los marcadores preparados; no reconstruye el documento ni altera imágenes o estilos.
6. El generador PDF actual se conserva sin modificación funcional.

## Compatibilidad
Para inspecciones antiguas sin `revisadoPor`, la generación Word utiliza temporalmente `director` como respaldo para `Revisado por`.

## Prueba técnica realizada
Se generó una copia de prueba de la plantilla con datos simulados y se convirtió a PDF mediante LibreOffice. Resultado:
- Documento válido.
- 1 página.
- Encabezado conservado.
- `Página 1 de 1` calculado por Word/Writer.
- Cliente, fecha y puesto reemplazados correctamente.
- `Realizado por` y `Revisado por` reemplazados correctamente.
- Texto de cierre y cargos conservados.

## Próxima etapa
Esta intervención NO incorpora todavía checklist, tablas, hallazgos, fotografías, matriz ni mapa de calor dentro del DOCX. Esos componentes se integrarán uno por uno después de validar esta prueba con una inspección real.

## Regla
MEJORAR SIN ROMPER: si la prueba de campo no cumple, se vuelve a `index.html.CAM-PLANTILLA-01-backup` y no se intervienen otras funciones.
