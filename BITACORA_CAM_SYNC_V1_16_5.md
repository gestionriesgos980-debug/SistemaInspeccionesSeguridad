# Bitácora TECCHNEX CAM-INSPECCIONES V25 — V1.16.5

## Objetivo
Cerrar el ciclo de sincronización entre equipos mediante Supabase existente: Equipo A → Supabase → Equipo B.

## Cambios locales
- Conserva el envío de paquetes V1.8 existente.
- La consulta LIST conserva las inspecciones y permite seleccionar una para recepción.
- Incorpora el registro raíz y sus hijos a las estructuras locales existentes.
- Reconstruye `resultadosChecklistCategorias` usando el índice local recién asignado, no el índice del equipo emisor.
- Descarga fotografías mediante `tecchnex-cam-inspecciones-media-read`, verifica tamaño y SHA-256, y las guarda en la bóveda IndexedDB existente.
- Remapea `mediaId` remoto a la referencia local en los hallazgos.
- Bloquea duplicados por UUID y conflictos de puesto+fecha con UUID diferente.
- No crea tablas, buckets, RPC ni funciones Edge. No realiza despliegues ni escrituras Supabase durante la recepción.

## Límites conocidos
- La recepción de fotografías requiere que la función Edge `tecchnex-cam-inspecciones-media-read` ya esté desplegada y devuelva el contrato `PHOTO_URLS_CREATED` usado por la prueba previa.
- La escritura estructurada usa snapshots y rollback de localStorage. Los blobs ya descargados a IndexedDB no se eliminan si falla después la escritura estructurada; quedan como medios huérfanos no referenciados, sin afectar los datos existentes.
- La validación completa entre dos navegadores reales sigue pendiente; no se declara aún producción validada.
- La sincronización bidireccional con resolución de conflictos de ediciones simultáneas no se incorpora en esta entrega. El envío existente y la recepción se mantienen como flujos explícitos.

## Seguridad
No se han ejecutado escrituras ni despliegues remotos.


## Ajuste visual del panel de sincronización — panel compacto

- Se mantiene intacto el identificador del panel y todos los IDs de controles existentes.
- El panel inicia plegado, con estado resumido y botón Abrir/Cerrar.
- Al abrirlo se conservan todas las herramientas de diagnóstico, envío y recepción.
- Ancho máximo ajustado a 310 px; no se modifican llamadas, adaptadores ni operaciones de sincronización.
- Se incrementa únicamente el nombre de caché del Service Worker para que GitHub Pages solicite el HTML actualizado.
- No se modifican datos locales, tablas, funciones ni secretos de Supabase.


## LAB — Continuación de lectura con comprobante temporal V1

- Base: ZIP V7 confirmado como vigente por el usuario; GitHub sin cambios posteriores reportados.
- Se integra `continuation_token` en los cuatro recorridos paginados LIST del cliente.
- Cada recorrido captura el comprobante devuelto por la primera página y lo reenvía en páginas siguientes.
- Se conserva `cursor`, tamaño de página, identidad funcional por nombre+fecha y el resto de la lógica de sincronización.
- La Edge Function `tecchnex-cam-inspecciones-read` V5 y el Universal Bridge central V15 no se modifican.
- No se crean tablas, no se escriben registros, no se envían inspecciones y no se despliega código remoto.
- Estado: preparado en laboratorio; pendiente de prueba controlada de paginación/autorización antes de publicar.
